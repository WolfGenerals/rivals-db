<script setup lang="ts">
/**
 * 单位数据面板 —— 可复用的「一组数据一张卡」。
 *
 * **纯展示组件**：入参 `unit` + `level`，不做 IO、不读路由。
 * 页面负责按 id 取数据与定宽；对比页将来可以并排放几个 `UnitPanel`。
 *
 * 卡片按**数据是关于什么的**分组，而不是按「是不是数字」：
 *   ① 单位总览   大卡 + 名称 + 标签 + **本单位的等级选择** + 随等级变的关键值 + 描述
 *   ② 基本信息   不随等级变的单位固有属性 + 敌人应对（索敌偏好 / 克制）
 *   ③ 小队       仅多成员单位：人数 / 每员血量 / 队员开火错开
 *   ④ 武器       数量不定，有武器才出现（拆到 `UnitWeapons.vue`）
 *   ⑤ 能力调参   指挥官专属
 *   ⑥ 元信息     source / warnings
 *
 * 某组没数据就**整张卡不出现**，而不是渲染一排 `—`。
 *
 * 关键取舍：血量与 DPS 是**随等级变**的，提到总览最显眼处；
 * 射程、开火间隔、单发伤害归武器卡，不在总览重复。
 */
import { computed, ref } from "vue";

import { level as makeLevel, startingMajorOfRarity, type Level } from "@rivals/core/levels";
import type { DatasetEntry } from "@rivals/core/derive";
import { TARGET_LABELS, TARGET_TYPES } from "../damageTiers.ts";
import { unitDpsVs } from "../dps.ts";
import { fmtSec, fmtSecPerTile, fmtTiles, fmtTilesPerSec } from "../format.ts";
import { dpsMode } from "../state.ts";
import { useData } from "../useData.ts";

import StatIcon from "./StatIcon.vue";
import TypeIcon from "./TypeIcon.vue";
import UnitAffinity from "./UnitAffinity.vue";
import UnitCard from "./UnitCard.vue";
import UnitLevelPicker from "./UnitLevelPicker.vue";
import UnitWeapons from "./UnitWeapons.vue";

const props = defineProps<{
  unit: DatasetEntry;
  /** 全局等级；开了「独立等级」后本面板会用自己的那套 */
  level: Level;
}>();

const waveSize = computed(() => props.unit.derived.health?.wave_size ?? 1);

/** 该单位是否能攻击 —— 决定「敌人应对」那一块显不显示 */
const canAttack = computed(() =>
  props.unit.derived.weapons.some((w) => w.damage > 0 && w.can_attack.length > 0),
);

/** 本面板的独立等级。默认关闭开关，跟随全局 */
const independent = ref(false);
const localLevel = ref<Level>(props.level);

/** 实际生效的等级 */
const lv = computed(() => (independent.value ? localLevel.value : props.level));

function onLevelChange(v: Level) {
  localLevel.value = v;
}

const rarity = computed(() => props.unit.pb?.rarity);
const startMajor = computed(() => startingMajorOfRarity(rarity.value));

const name = computed(
  () => props.unit.name_zh || props.unit.name_en || props.unit.id.replace(/^(unit|cmdr)_/, ""),
);
const nameEn = computed(() => props.unit.name_en ?? "");

const unitType = computed(() => {
  const tags = props.unit.derived.stats.tags ?? [];
  if (tags.includes("override_harvester")) return "harvester";
  const first = tags.find((t) => !t.startsWith("override_"));
  return first ? first.toLowerCase() : "";
});

/**
 * 本地化文本里的 `<stat|X>` 是**游戏运行时替换的数值占位符**（全库 13 种、37 处）。
 *
 * 游戏的做法是**每个单位在自己的 `GetStatInfo` 里**定义 `overrideTable["X"]` 函数
 * （如 `unit_nod_ticktank.lua:172` 取 `modifier_intro.tuning.damageReductionPercent`）。
 * 我们只解出来源明确的那些，值在**提取时**算好放进 `derived.stats`。
 *
 * ⚠️ **没解出来的不编**（AGENTS.md 第 6 条）—— 显示成 `⟨X⟩` 让读者看出"这里有个
 * 未解码的占位符"，而不是一个看着像正常内容的 `—`。
 */
const STAT_TOKENS: Record<string, (r: DatasetEntry) => string | undefined> = {
  VisionRange: (r) => {
    const v = r.derived.stats.vision_tiles;
    return v === undefined ? undefined : `${v}`;
  },
  ExtendedAttackRange: (r) => {
    const v = r.derived.stats.attack_range_tiles;
    return v === undefined ? undefined : `${v}`;
  },
  /** 壁虱坦克的壕沟：`modifier_intro.tuning.damageReductionPercent`×100 = 70 */
  BuffEffect: (r) => {
    const v = r.derived.stats.damage_reduction_pct;
    return v === undefined ? undefined : String(v);
  },
  BuffEffect2: (r) => {
    const v = r.derived.stats.damage_reduction_pct;
    return v === undefined ? undefined : String(v);
  },
};

const desc = computed(() => {
  const r = props.unit;
  if (!r.desc_zh) return "";
  return r.desc_zh.replace(/<stat\|([A-Za-z0-9_]+)>/g, (_, key: string) => {
    const v = STAT_TOKENS[key]?.(r);
    return v ?? `⟨${key}⟩`; // 未解码：显式标出，不写 —
  });
});

/** 总览里的关键值：随等级变 */
const totalHealth = computed(() => {
  const total = props.unit.derived.health?.total;
  return total === undefined ? undefined : lv.value.hp(total);
});
/**
 * 面板的 DPS = **游戏面板值**（`derived.dps`）—— 与游戏内面板逐字一致，别自己另算一个。
 *
 * 官方那套口径不是"长期平均"：`TryGetBaseDps` 对持续光束取 `damage ÷ tickPeriod`
 * （音波坦克 26/0.04 = **650**，把 3 秒蓄力完全忽略 —— findings I164），
 * 对「遍历枪口齐射」的单位还会漏乘（烈焰之手 112.5）。**这些就是游戏显示的，照搬。**
 *
 * 想看真实输出看下面那排「对目标 DPS」（那个跟着顶栏的爆发/平均口径）。
 * 固定值 = 不跟顶栏切换走（用户要求：同一个数不该随显示口径漂）。
 */
const dps = computed(() => {
  const base = props.unit.derived.dps;
  return base === null || base === 0 ? undefined : lv.value.dps(base);
});

/**
 * **对五种目标的实际 DPS** —— 能打该目标的每把武器**相加**（利爪两把武器同时打建筑）。
 * **跟着顶栏的爆发/平均口径**（用户要求）：那里是"打起来多猛 / 长期能打出多少"的对比。
 * 逐武器明细放进悬停提示；打不到的显示 `—`。
 */
const vsTargets = computed(() =>
  TARGET_TYPES.map((t) => ({
    type: t,
    label: TARGET_LABELS[t],
    set: unitDpsVs(props.unit, t, dpsMode.value),
  })),
);

/** 悬停：把"每把武器各打多少 → 合计"写清楚 */
function vsTip(v: (typeof vsTargets.value)[number]): string {
  if (!v.set) return `${v.label}：打不到`;
  const parts = v.set.per.map((p) => `${p.label} ${lv.value.dps(p.dps).toFixed(0)}`);
  return `${v.label}：${parts.join(" + ")} = ${lv.value.dps(v.set.total).toFixed(0)}`;
}

/**
 * 基本信息：不随等级变的单位固有属性。空值不收集。行 = `[标签, 值, 悬停提示?]`。
 *
 * ⚠️ 两件事别搞错：
 * ① **单位逐字段核对**：带 `InTiles` 的是**格**，其余裸数字是**世界单位**
 *    （换算常数只有一处：`@rivals/core/types` 的 `WORLD_UNITS_PER_TILE`）——
 *    早先把 `avoidance_radius = 1.7` 写成「1.7 格」是错的（实为 0.12 格）。
 * ② **悬停提示是给用户看的文案**，不是注释：最多一句"这个数是什么"，
 *    不写字段名、不写台账编号、不用 markdown（`attr()` 是纯文本，`**` 不加粗）。
 */
const basics = computed(() => {
  const rows: Array<[string, string, string?]> = [];
  const st = props.unit.derived.stats;
  if (st.cost !== undefined) rows.push(["造价", String(st.cost)]);
  /*
   * **溅射 / 范围伤害** —— 这是"打几个"的图鉴信息，用户指出它此前只长在武器卡里、
   * 单位详情页看不到（"光束炮火焰这样的溅射伤害在单位细节里也没有展示"）。
   *
   * 汇总规则：**尽量给出覆盖范围**，而不是把各武器的机制罗列一遍：
   *   · 有 `multi_hex`（多格图案，格内全额）→ 报图案形状与尺寸
   *   · 有 `side_targets`（万钧巨炮 stage2/3 那种"再溅 N 个目标"）→ 取最大 N
   *   · 有 `side_damage`（火焰坦克锥形，相邻格伤害）→ 报"相邻格 N"
   *   · 有 `radius`（奥卡 / 自行火炮 / 催化炮艇的圆形范围）→ 报半径（世界单位 → 格）
   */
  const ws = props.unit.derived.weapons;
  const areas = ws.map((w) => w.area);
  const multi = areas.find((a) => a.kind === "multi_hex");
  const sideTargets = Math.max(0, ...areas.map((a) => (a.kind === "side_targets" ? (a.targets ?? 0) : 0)));
  const sideDamage = areas.find((a) => a.kind === "side_damage");
  const radius = areas.find((a) => a.kind === "radius");
  if (multi) {
    const SHAPE: Record<string, string> = { Circle: "圆", Diamond: "菱形", Line: "直线" };
    rows.push(["范围", `${SHAPE[multi.shape ?? ""] ?? multi.shape}图案 ${multi.size} 格`, "格子内全额伤害、无衰减"]);
  }
  if (sideTargets > 0) {
    rows.push(["溅射", `额外 ${sideTargets} 个目标`, "主目标之外还会打到附近的目标"]);
  }
  if (sideDamage) {
    rows.push(["溅射", `相邻格 ${sideDamage.side_value}`, "攻击时对相邻格造成这个伤害"]);
  }
  if (radius) {
    const f = radius.falloff?.length
      ? `，${radius.falloff.map((x) => `${fmtTiles(x.distance)}${x.percent}%`).join(" → ")}`
      : "";
    rows.push(["范围", `半径 ${fmtTiles(radius.radius ?? 0)}`, `圆形范围伤害${f}`]);
  }
  /*
   * 移动速度：主显示用**秒/格**（"走过去要多久"），悬停里再给格/秒。
   * 两个是同一个数的倒数 —— 给秒是因为玩家真正关心的是耗时，而且它正是标定
   * 换算常数时用的那把尺子（采集车 3.51s/格，见 findings I224）。
   */
  if (st.speed !== undefined) {
    rows.push(["移动速度", fmtSecPerTile(st.speed), `约 ${fmtTilesPerSec(st.speed)}`]);
  }
  if (st.turn_speed !== undefined) rows.push(["转向速度", `${st.turn_speed}°/秒`]);
  if (st.vision_tiles !== undefined) rows.push(["视野", `${st.vision_tiles} 格`]);
  // ⚠️ 攻击距离（格，整数）与武器射程（实际距离）**不是一回事** —— 万钧巨炮 2 vs 2.5
  /*
   * 攻击距离：**1 格是基线**（78 个单位里 65 个是 1，只 13 个是 2/3）。
   * 游戏面板 `<= 1` 时整行不显示（`CombatTuningInfo.lua:440`），所以那 13 个才是
   * 游戏里看得见射程的单位。这里仍然列出来 —— 否则一页全是「攻击距离 1 格」。
   */
  if (st.attack_range_tiles !== undefined) {
    rows.push([
      "攻击距离",
      `${st.attack_range_tiles} 格`,
      st.attack_range_tiles <= 1 ? "只打相邻格" : undefined,
    ]);
  }
  if (st.aggro_radius_tiles !== undefined) {
    rows.push(["索敌半径", `${st.aggro_radius_tiles} 格`, "自动索敌走进这个范围的敌人"]);
  }
  if (st.avoidance_radius !== undefined) {
    rows.push(["避让半径", fmtTiles(st.avoidance_radius), "含义未知"]);
  }
  if (st.can_be_crushed !== undefined) rows.push(["能否被碾压", st.can_be_crushed ? "是" : "否"]);
  if (st.stealth_detect_tiles !== undefined) rows.push(["反隐范围", `${st.stealth_detect_tiles} 格`]);
  if (st.kill_award_tiberium !== undefined) rows.push(["被击杀给矿", String(st.kill_award_tiberium)]);

  /*
   * 部署 / 解除时间。
   *
   * 语义是**单位整体**的 —— 多管火箭必须架起来才能打，这是这个单位最重要的特征之一，
   * 埋在武器卡的次要参数里没人看得到。
   */
  if (st.deploy_ms || st.undeploy_ms) {
    rows.push(["部署 / 解除", `${fmtSec(st.deploy_ms ?? 0)} / ${fmtSec(st.undeploy_ms ?? 0)}`]);
  }
  return rows;
});

/** 小队：仅多成员单位有意义 */
const squadRows = computed(() => {
  if (waveSize.value <= 1) return [] as Array<[string, string]>;
  const rows: Array<[string, string]> = [["小队人数", String(waveSize.value)]];
  const per = props.unit.derived.health?.per_member;
  if (per !== undefined) rows.push(["队员血量", String(lv.value.hp(per))]);
  const sep = props.unit.derived.stats.separation_ms;
  if (sep !== undefined) rows.push(["队员开火错开", fmtSec(sep)]);
  return rows;
});

/**
 * **场地效果（火 / 毒气）** —— 用户："单位详情里要引用火和毒气等场地效果，说明一下什么条件触发"。
 *
 * ## 数值从哪来
 *
 * 单位里**只有引用名**（`stats.leaves_fire` / `stats.leaves_gas`），
 * 数值在数据集顶层的 `auras` 共享表里（见 findings I245）。这张卡就是"把引用解开给人看"。
 *
 * ## 触发条件（每一句都能对到源码）
 *
 * | 效果 | 谁铺 | 触发条件 |
 * | --- | --- | --- |
 * | 火 | 圣甲虫 / 火焰轰炸机 | 命中即铺（`modifier_scarab_projectile.lua:71`） |
 * | 毒气 | 催化剂 | 命中即铺（蓄力条 4.5s 决定"什么时候轮到大毒气弹"） |
 * | 毒气 | 生化越野车 | **`GetAgeMS() > spawnGasTimeMs`（2100ms）** —— 要连续开打 2.1s 才铺得出 |
 * | 毒气 | 化武兵 | 同上，750ms |
 *
 * 三者共同的两条附加条件：**与目标相距 ≤ 1 格**（`GetDistance(tile, myTile) <= 1`）·
 * 每次满足条件的命中都只是 **`ResetPersistTime()` 续时**（不叠加、不重新生成）。
 */
interface FieldEffect {
  kind: string;
  /** 谁铺的（modifier 名） */
  ref: string;
  /** 触发条件那句话 */
  trigger: string;
  /** 每跳每员伤害（已套等级） */
  tickDamage: number;
  tickMs: number;
  persistMs: number;
  /** 打谁 */
  hits: string;
  /** 能不能铺（有 `spawn_gas_ms` 时的那条限制） */
  note?: string;
}

/** 场地效果的数值在**数据集顶层的 `auras` 共享表**里，单位只带引用名（findings I245） */
const data = useData();


/** 场地效果的 modifier 名 → 源码位置（悬停里给出处，方便核对） */
function fieldSource(ref: string): string {
  if (ref === "modifier_fire_bomber_fire") return "gameplay/auras/aura_fire.lua";
  if (ref === "modifier_chem_warrior_gas_cloud") return "gameplay/auras/aura_gas_cloud.lua";
  return `gameplay/auras/${ref}.lua`;
}

/*
 * **不再转储原始 config** —— 那正是被淘汰的冗长部分。
 * 要核对原始数据请直接看 Lua 源码，或重跑提取。
 */
</script>

<template>
  <div class="unit-panel">
    <!-- ① 单位总览 -->
    <section class="panel hero">
      <div class="hero-art">
        <UnitCard :unit="unit" :level="lv" :fields="['type', 'level', 'faction', 'cost']" />
      </div>
      <div class="hero-info">
        <!-- 等级选择器与标题**同一行**（它只有 26px 高，不该独占一行） -->
        <div class="title-row">
          <h2 class="title">{{ name }}</h2>
          <UnitLevelPicker
            :level="lv"
            :global-level="level"
            :independent="independent"
            @update:independent="independent = $event"
            @update:level="onLevelChange"
          />
        </div>
        <p v-if="nameEn && nameEn !== name" class="subtitle">{{ nameEn }}</p>
        <p class="chips">
          <span class="chip">{{ unit.faction }}</span>
          <span v-if="rarity" class="chip">{{ rarity }}</span>
          <span v-if="startMajor !== null" class="chip">起始 {{ makeLevel(startMajor, 0).format() }}</span>
        </p>

        <!--
          血量 / DPS 与基本信息**并排**：前者随等级变、后者不变，
          但都属于「这个单位是什么样」，分两张卡反而要来回看。
        -->
        <div class="facts">
          <div v-if="totalHealth !== undefined" class="fact big">
            <StatIcon name="health" />
            <span>{{ waveSize > 1 ? "总血" : "血量" }}</span>
            <b>{{ totalHealth }}</b>
          </div>
          <div v-if="dps !== undefined" class="fact big">
            <StatIcon name="dps" />
            <span>面板 DPS</span>
            <b>{{ dps.toFixed(1) }}</b>
          </div>

          <span v-if="basics.length && (totalHealth !== undefined || dps !== undefined)" class="divider" />

          <div
            v-for="row in basics"
            :key="row[0]"
            class="fact"
            :data-float="row[2] ? '' : undefined"
            :data-tip="row[2]"
          >
            <span>{{ row[0] }}</span>
            <b>{{ row[1] }}</b>
          </div>
        </div>

        <!-- 对五种目标的**实际** DPS：能打该目标的每把武器相加，悬停看逐武器明细 -->
        <div v-if="vsTargets.some((v) => v.set)" class="vs">
          <span class="cap">对目标实际 DPS</span>
          <span
            v-for="v in vsTargets"
            :key="v.type"
            class="cell"
            :class="{ off: !v.set }"
            data-float
            :data-tip="vsTip(v)"
          >
            <TypeIcon :type="v.type.toLowerCase()" />
            <b>{{ v.set ? lv.dps(v.set.total).toFixed(0) : "—" }}</b>
          </span>
        </div>

        <p v-if="desc" class="desc">{{ desc }}</p>
      </div>
    </section>

    <!--
      ② 附加：敌人应对（索敌偏好 / 克制）
      **不能攻击的单位不显示** —— 采集车、无武器的指挥官等，"克制什么"没有意义。
    -->
    <section v-if="canAttack" class="panel">
      <h3>敌人应对</h3>
      <UnitAffinity :unit="unit" />
    </section>

    <!-- ③ 小队 -->
    <section v-if="squadRows.length" class="panel">
      <h3>小队</h3>
      <div class="kv">
        <div v-for="[k, v] in squadRows" :key="k"><span>{{ k }}</span><b>{{ v }}</b></div>
      </div>
    </section>

    <!-- ④ 武器 -->
    <UnitWeapons :unit="unit" :level="lv" />

    <!-- ⑥ 元信息 -->
    <p v-if="unit.warnings?.length" class="warn">⚠ 提取告警：{{ unit.warnings.join("；") }}</p>
    <p v-if="unit.source" class="muted source">来源：<code>{{ unit.source }}</code></p>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.hero-art {
  flex: 0 0 150px;
}
.hero-info {
  min-width: 0;
  flex: 1 1 340px;
}
.hero-info .title {
  margin: 0;
}
/* 标题 + 紧凑等级选择器同一行；选择器自带 `margin-left:auto` 靠右 */
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.subtitle {
  margin: 2px 0 8px;
  color: #7f8aa6;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 0 0 10px;
}
.chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--line, #2a3550);
  color: #9aa6c2;
}
.facts {
  display: flex;
  align-items: flex-end;
  gap: 8px 18px;
  flex-wrap: wrap;
  margin: 0 0 10px;
}
.fact {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.fact span {
  color: #9aa6c2;
  font-size: 12px;
}
.fact b {
  font-variant-numeric: tabular-nums;
  font-size: 14px;
}
/* 随等级变的两项加大，和不变的固有属性拉开层次 */
.fact.big b {
  font-size: 22px;
  line-height: 1.1;
}
/* 口径小字（"游戏面板"）—— 一个词说明这个数是哪个口径 */
.fact .sub {
  margin-left: 4px;
  font-size: 10px;
  color: #6f7c99;
}
/* 对五种目标的实际 DPS —— 图标 + 数字，打不到的压暗 */
.vs {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 10px;
}
.vs .cap {
  color: #9aa6c2;
  font-size: 12px;
}
.vs .cell {
  display: flex;
  align-items: center;
  gap: 5px;
}
.vs .cell :deep(.icon),
.vs .cell svg {
  width: 18px;
}
.vs .cell b {
  font-variant-numeric: tabular-nums;
  font-size: 14px;
}
.vs .cell.off {
  opacity: 0.35;
}
.divider {
  width: 1px;
  align-self: stretch;
  background: var(--line, #2a3550);
  margin: 2px 4px;
}
.desc {
  margin: 0;
  color: #b9c4dc;
  line-height: 1.7;
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px 18px;
}
.kv > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid var(--line, #232b3d);
}
.kv span {
  color: #9aa6c2;
  font-size: 12px;
}
.tuning {
  border: 1px solid var(--line, #2a3550);
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}
.tuning-head {
  padding: 6px 10px;
  background: #171e2e;
  border-bottom: 1px solid var(--line, #2a3550);
}
.tuning pre {
  margin: 0;
  padding: 10px;
  overflow: auto;
  max-height: 340px;
  font-size: 12px;
}
.source {
  font-size: 11px;
  margin-top: 14px;
}
/* ── 场地效果（火 / 毒气）──────────────────────────────── */
.field {
  padding: 6px 0;
  border-bottom: 1px solid var(--line, #232b3d);
}
.field:last-of-type {
  border-bottom: none;
}
.field-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.field-head .kind {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.field-head .kind.fire {
  background: #4a2f12;
  color: #ffb347;
}
.field-head .kind.gas {
  background: #2f4a12;
  color: #b6e34a;
}
.field-head .trigger {
  font-size: 12px;
  color: #b9c4dc;
}
.field-head .ref {
  margin-left: auto;
  font-size: 11px;
  color: #6f7c99;
}
.field-body {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  margin: 4px 0 0;
  font-size: 12px;
  color: #9aa6c2;
}
.field-body b {
  color: #e6ecf7;
  font-variant-numeric: tabular-nums;
}
.field-body .sep {
  color: #4a5163;
}
.field .scope {
  margin: 2px 0 0;
  font-size: 11px;
  color: #7f8aa6;
}
.warn-inline {
  color: #d8c07a;
}
.small {
  font-size: 11px;
}
.fields .small {
  margin: 6px 0 0;
}
</style>

