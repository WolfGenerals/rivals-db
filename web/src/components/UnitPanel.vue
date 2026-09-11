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
import { UnitAttack } from "@rivals/core/attack";
import { modifierIntroMs, modifierOutroMs, squadHealth, type EntityRecord } from "@rivals/core/types";

import StatIcon from "./StatIcon.vue";
import TypeIcon from "./TypeIcon.vue";
import UnitAffinity from "./UnitAffinity.vue";
import UnitCard from "./UnitCard.vue";
import UnitLevelPicker from "./UnitLevelPicker.vue";
import UnitWeapons from "./UnitWeapons.vue";

const props = defineProps<{
  unit: EntityRecord;
  /** 全局等级；开了「独立等级」后本面板会用自己的那套 */
  level: Level;
}>();

const cfg = computed(() => props.unit.config);
const combatant = computed(() => cfg.value.combatantTuning);
const squad = computed(() => cfg.value.squadTuning);
const waveSize = computed(() => squad.value?.waveSize ?? 1);

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
  const tags = combatant.value?.tags ?? [];
  if (tags.includes("override_harvester")) return "harvester";
  const first = tags.find((t) => !t.startsWith("override_"));
  return first ? first.toLowerCase() : "";
});

/**
 * 本地化文本里的 `<stat|X>` 是**游戏运行时替换的数值占位符**（全库仅 14 种、37 处，
 * 集中在指挥官技能描述）。能算的算，算不出的换 `—`。
 */
const STAT_TOKENS: Record<string, (r: EntityRecord) => string | undefined> = {
  VisionRange: (r) => {
    const v = r.config.squadTuning?.visionRangeInTiles;
    return v === undefined ? undefined : `${v} 格`;
  },
  ExtendedAttackRange: (r) => {
    const ranges = (r.config.combatantTuning?.weaponTunings ?? [])
      .map((w) => w.maxRangeInTiles)
      .filter((v): v is number => v !== undefined);
    return ranges.length ? `${Math.max(...ranges)} 格` : undefined;
  },
};

const desc = computed(() => {
  const r = props.unit;
  if (!r.desc_zh) return "";
  return r.desc_zh.replace(/<stat\|([A-Za-z0-9_]+)>/g, (_, key: string) => STAT_TOKENS[key]?.(r) ?? "—");
});

/** 总览里的关键值：随等级变 */
const totalHealth = computed(() => {
  const total = squadHealth(props.unit);
  return total === undefined ? undefined : lv.value.hp(total);
});
const unitAttack = computed(() => UnitAttack.of(props.unit));
/**
 * 单位 DPS = **主武器的 DPS**（不是各武器取最大），与游戏内面板一致。
 *
 * 见 `findings.md` I103：面板显示的是主武器。寡妇制造者面板是 280（喷火器）
 * 而火箭是 320 —— 取最大会算错。
 */
const dps = computed(() => {
  const base = unitAttack.value.dps();
  return base > 0 ? lv.value.dps(base) : undefined;
});

/** 基本信息：不随等级变的单位固有属性。空值不收集 */
const basics = computed(() => {
  const rows: Array<[string, string]> = [];
  const cost = cfg.value.combatStoreTuning?.tiberiumCost;
  if (cost !== undefined) rows.push(["造价", String(cost)]);
  const speed = combatant.value?.speed;
  if (speed !== undefined) rows.push(["移动速度", String(speed)]);
  const vision = squad.value?.visionRangeInTiles;
  if (vision !== undefined) rows.push(["视野", `${vision} 格`]);
  if (squad.value?.canBeCrushed !== undefined) rows.push(["能否被碾压", squad.value.canBeCrushed ? "是" : "否"]);
  const stealth = squad.value?.stealthDetectionRangeInTiles;
  if (stealth !== undefined) rows.push(["反隐范围", `${stealth} 格`]);
  const award = squad.value?.killAwardTiberium;
  if (award !== undefined) rows.push(["被击杀给矿", String(award)]);

  /*
   * 部署 / 解除时间。
   *
   * 数据挂在武器的 `modifier_intro` / `modifier_outro` 上，但语义是**单位整体**的
   * —— 多管火箭必须架起来才能打，这是这个单位最重要的特征之一，
   * 埋在武器卡的次要参数里没人看得到。多武器单位取各武器的最大值。
   */
  const intros = (combatant.value?.weaponTunings ?? []).map(modifierIntroMs).filter((v) => v > 0);
  const outros = (combatant.value?.weaponTunings ?? []).map(modifierOutroMs).filter((v) => v > 0);
  if (intros.length || outros.length) {
    const sec = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
    rows.push(["部署 / 解除", `${sec(Math.max(0, ...intros))} / ${sec(Math.max(0, ...outros))}`]);
  }
  return rows;
});

/** 小队：仅多成员单位有意义 */
const squadRows = computed(() => {
  if (waveSize.value <= 1) return [] as Array<[string, string]>;
  const rows: Array<[string, string]> = [["小队人数", String(waveSize.value)]];
  const per = combatant.value?.health;
  if (per !== undefined) rows.push(["每员血量", String(lv.value.hp(per))]);
  const sep = squad.value?.attackSeparationDurationMS;
  if (sep !== undefined) rows.push(["小队攻击间隔", `${sep} ms`]);
  return rows;
});

const abilityKeys = computed(() =>
  Object.keys(cfg.value).filter(
    (k) => k.endsWith("Tuning") && !["combatantTuning", "squadTuning", "combatStoreTuning"].includes(k),
  ),
);
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

    <!-- ⑤ 指挥官技能调参 -->
    <section v-if="abilityKeys.length" class="panel">
      <h3>能力调参</h3>
      <div v-for="k in abilityKeys" :key="k" class="tuning">
        <div class="tuning-head"><b>{{ k }}</b></div>
        <pre>{{ JSON.stringify(cfg[k], null, 2) }}</pre>
      </div>
    </section>

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

