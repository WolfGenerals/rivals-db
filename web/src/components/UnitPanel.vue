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
 *   ③ 小队       仅多成员单位：人数 / 每员血量 / 小队攻击间隔
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
 * 本地化文本里的 `<stat|X>` 是**游戏运行时替换的数值占位符**（全库仅 14 种、37 处，
 * 集中在指挥官技能描述）。能算的算，算不出的换 `—`。
 */
const STAT_TOKENS: Record<string, (r: DatasetEntry) => string | undefined> = {
  VisionRange: (r) => {
    const v = r.derived.stats.vision_tiles;
    return v === undefined ? undefined : `${v} 格`;
  },
  ExtendedAttackRange: (r) => {
    const v = r.derived.stats.range_tiles;
    return v === undefined ? undefined : `${v} 格`;
  },
};

const desc = computed(() => {
  const r = props.unit;
  if (!r.desc_zh) return "";
  return r.desc_zh.replace(/<stat\|([A-Za-z0-9_]+)>/g, (_, key: string) => STAT_TOKENS[key]?.(r) ?? "—");
});

/** 总览里的关键值：随等级变 */
const totalHealth = computed(() => {
  const total = props.unit.derived.health?.total;
  return total === undefined ? undefined : lv.value.hp(total);
});
/**
 * 单位 DPS = **主武器的 DPS**（不是各武器取最大），与游戏内面板一致。
 *
 * 见 `findings.md` I103：面板显示的是主武器。寡妇制造者面板是 280（喷火器）
 * 而火箭是 320 —— 取最大会算错。
 */
const dps = computed(() => {
  const base = props.unit.derived.dps;
  return base === null || base === 0 ? undefined : lv.value.dps(base);
});

/** 基本信息：不随等级变的单位固有属性。空值不收集 */
const basics = computed(() => {
  const rows: Array<[string, string]> = [];
  const st = props.unit.derived.stats;
  if (st.cost !== undefined) rows.push(["造价", String(st.cost)]);
  if (st.speed !== undefined) rows.push(["移动速度", String(st.speed)]);
  if (st.turn_speed !== undefined) rows.push(["转向速度", String(st.turn_speed)]);
  if (st.vision_tiles !== undefined) rows.push(["视野", `${st.vision_tiles} 格`]);
  // ⚠️ 攻击距离（格，整数）与武器射程（实际距离）**不是一回事** —— 万钧巨炮 2 vs 2.5
  /*
   * 攻击距离：**1 格是基线**（78 个单位里 65 个是 1，只 13 个是 2/3）。
   * 游戏面板 `<= 1` 时整行不显示（`CombatTuningInfo.lua:440`），所以那 13 个才是
   * 游戏里看得见射程的单位。这里仍然列出来，但把基线标出来 —— 否则一页全是「攻击距离 1 格」。
   */
  if (st.attack_range_tiles !== undefined) {
    rows.push([
      "攻击距离",
      st.attack_range_tiles > 1 ? `${st.attack_range_tiles} 格` : `${st.attack_range_tiles} 格（基线）`,
    ]);
  }
  if (st.aggro_radius_tiles !== undefined) rows.push(["索敌半径", `${st.aggro_radius_tiles} 格`]);
  if (st.avoidance_radius !== undefined) rows.push(["避让半径", `${st.avoidance_radius} 格`]);
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
    const sec = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
    rows.push(["部署 / 解除", `${sec(st.deploy_ms ?? 0)} / ${sec(st.undeploy_ms ?? 0)}`]);
  }
  return rows;
});

/** 小队：仅多成员单位有意义 */
const squadRows = computed(() => {
  if (waveSize.value <= 1) return [] as Array<[string, string]>;
  const rows: Array<[string, string]> = [["小队人数", String(waveSize.value)]];
  const per = props.unit.derived.health?.per_member;
  if (per !== undefined) rows.push(["每员血量", String(lv.value.hp(per))]);
  const sep = props.unit.derived.stats.separation_ms;
  if (sep !== undefined) rows.push(["小队攻击间隔", `${sep} ms`]);
  return rows;
});

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
        <h2 class="title">{{ name }}</h2>
        <p v-if="nameEn && nameEn !== name" class="subtitle">{{ nameEn }}</p>
        <p class="chips">
          <span class="chip">{{ unit.faction }}</span>
          <span v-if="rarity" class="chip">{{ rarity }}</span>
          <span v-if="startMajor !== null" class="chip">起始 {{ makeLevel(startMajor, 0).format() }}</span>
        </p>

        <UnitLevelPicker
          :level="lv"
          :global-level="level"
          :independent="independent"
          @update:independent="independent = $event"
          @update:level="onLevelChange"
        />

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
            <span>DPS</span>
            <b>{{ dps.toFixed(1) }}</b>
          </div>

          <span v-if="basics.length && (totalHealth !== undefined || dps !== undefined)" class="divider" />

          <div v-for="[k, v] in basics" :key="k" class="fact">
            <span>{{ k }}</span>
            <b>{{ v }}</b>
          </div>
        </div>

        <p v-if="desc" class="desc">{{ desc }}</p>
      </div>
    </section>

    <!-- ② 附加：敌人应对（索敌偏好 / 克制） -->
    <section class="panel">
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
</style>

