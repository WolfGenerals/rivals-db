<script setup lang="ts">
/**
 * 单件武器。
 *
 * 数据全部来自 `derived`：`weapon`（打出去的**是什么**）+ `tracks`（**什么时候**打）。
 * **不再有 `WeaponAttack`**，也不在这里重算伤害。
 *
 * 排版按「读者想知道什么」分层：
 *   ① 结论行     类型 · 单发伤害 · DPS · 射程
 *   ② 时序       该武器的轨道（一轮打几下 / 一轮多长 / 一轮内间隔 / 空档）
 *   ③ 范围       范围伤害机制（溅射目标数 / 半径衰减 / 相邻格伤害）
 *   ④ 逐目标伤害 五类目标各打多少
 */
import { computed } from "vue";

import type { Track, Weapon } from "@rivals/core/derive";
import { weaponDps } from "../dps.ts";
import { DPS_MODES, dpsMode } from "../state.ts";
import type { Level } from "@rivals/core/levels";

import DamageMatrix from "./DamageMatrix.vue";
import StatIcon from "./StatIcon.vue";
import WeaponTimeline from "./WeaponTimeline.vue";

const props = defineProps<{
  weapon: Weapon;
  /** 指向这把武器的时序轨道（`sequence` 下每把武器各一条） */
  tracks: Track[];
  index: number;
  /** 是否是单位的主武器 */
  primary?: boolean;
  level: Level;
  /** 小队人数与成员错开 —— 时序条要按它们画每条队员的轴 */
  waveSize?: number;
  separationMs?: number;
}>();

/**
 * 时序条 —— 现在**所有**有时序的武器都画。
 *
 * 旧版只吃 `{cycle, chargeUp}` 两个数，于是 `sequence`（万钧巨炮多段）与装填型
 * （虎鲸轰炸机）都被挡在外面。新版 `WeaponTimeline` 直接消费 `tracks`，所以这里
 * 不再有"能不能画"的判断 —— 只要有时序就画。
 */

/**
 * 一把武器的两个 DPS 口径 + 单轮总伤害（**都是时间轴算的实际值**）。
 *
 * ```
 * 单轮总伤害 = damage × hits
 * burst（爆发） = damage × hits ÷ (hits × interval) = damage ÷ interval
 * avg（平均）   = damage × hits ÷ 完整周期      ← 蓄力/装填/空档都摊进去
 * ```
 *
 * 音波坦克最能说明差别：`burst` = 650，`avg` = **137**（3 秒蓄力摊进去）。见 findings I164。
 * 游戏面板值（650 那个）不在这里 —— 它是面板口径，只在单位页显示。
 */
const dpsSet = computed(() => weaponDps(props.weapon, props.tracks, props.waveSize ?? 1));

/** 按顶栏选的 DPS 口径取 1-0 基准值 */
const baseDps = computed(() => (dpsMode.value === "avg" ? dpsSet.value.avg : dpsSet.value.burst));

const levelDps = computed(() => (baseDps.value > 0 ? props.level.dps(baseDps.value) : undefined));

/** 当前口径的显示名，用在 DPS 标签上 */
const DPS_LABEL = computed(() => DPS_MODES.find((m) => m.key === dpsMode.value)?.label ?? "");

/** 单轮总伤害也随等级缩放（与单发、DPS 同一个系数） */
const levelVolley = computed(() => {
  const v = dpsSet.value.volley;
  return v > 0 ? Math.round(props.level.dps(v)) : 0;
});

/**
 * **单发伤害也要随等级缩放。**
 *
 * `weapon.damage` 是 **1-0 基准值**，必须乘上同样的等级系数 —— 否则会出现
 * "单发伤害 45 但 DPS 180" 这种对不上的组合（DPS 变了、单发没变）。
 * 用 `level.dps()` 而不是 `level.hp()`：伤害与 DPS 同一个系数，与血量无关。
 */
const levelDamage = computed(() => {
  const d = props.weapon.damage;
  return d > 0 ? Math.round(props.level.dps(d)) : d;
});

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 1 : 2)}s`;

/**
 * 把一条时序**按顺序读成一句话**。
 *
 * ⚠️ **必须说清前摇与周期的关系** —— 用户指出"光说前摇+冷却让人不知道前摇是否在冷却内"。
 * 靠两个符号区分，不靠形容词：
 *
 *   · **`含`** —— 前摇**在周期之内**（普通武器的 `chargeUpDuration`，周期不因它变长）
 *     `每 3.44s 一发（含前摇 0.60s）`
 *   · **`→`** —— 前摇在连打**之前**，时间**相加**（序列武器的 `initialChargeUpMs`）
 *     `前摇 3.00s → 连打 20 发（每 40ms 一发，共 0.80s）`
 */
function describeTiming(tm: Track["timing"]): string {
  if (tm.kind === "一次") return `蓄力 ${fmtMs(tm.charge_ms)} 后一次性`;
  if (tm.kind === "装填") {
    const fire = tm.interval_ms ? `每 ${fmtMs(tm.interval_ms)} 一发，` : "";
    return `${fire}弹夹 ${tm.clip} 发，打空后装填 ${fmtSec(tm.reload_ms)}`;
  }
  // 单发
  if (tm.hits <= 1) {
    return `每 ${fmtSec(tm.cycle_ms)} 一发`;
  }
  /*
   * `interval_ms === 0` = **同轮各发同时出膛**（遍历枪口的齐射，烈焰之手两管）。
   * 不能读成"每 0ms 一发" —— 它不是连打，是齐射。
   */
  if ((tm.interval_ms ?? -1) <= 0) {
    // 前摇由 `describeWhen` 负责（它拿得到 Track 上的 charge_ms），这里只说齐射本身
    return `同时 ${tm.hits} 发（一轮 ${fmtSec(tm.cycle_ms)}）`;
  }
  const iv = tm.interval_ms ?? tm.cycle_ms;
  const span = tm.hits * iv;
  const head = `连打 ${tm.hits} 发（每 ${fmtMs(iv)} 一发，共 ${fmtSec(span)}）`;
  return tm.gap_ms ? `${head}，然后停 ${fmtSec(tm.gap_ms)}（周期 ${fmtSec(tm.cycle_ms)}）` : head;
}

/** 这条轨在整轮里的位置（`sequence` 才是按时间接替） */
function describeWhen(t: Track): string {
  const parts: string[] = [];
  if (t.charge_ms) parts.push(`前摇 ${fmtMs(t.charge_ms)}`);
  /*
   * 前摇用 `含` 还是 `→` 由 `chargeInCycle` 决定：
   *   · 含 —— 在周期内，周期不因它变长（普通武器的 `chargeUpDuration`）
   *   · →  —— 在连打之前，与连打时间相加（序列武器的 `initialChargeUpMs`）
   *
   * ⚠️ **分段轨的 `charge_ms` 与 `after_ms` 是同一个数**（第一段的 `after_ms` 就是它自己的
   * 前摇），两个都说会变成「前摇 500ms、前摇 500ms →、0.50s 起」。有 `after_ms` 时
   * 由它表达位置，不再单独说前摇。
   */
  const hasAfter = t.after_ms !== undefined && t.after_ms > 0;
  if (t.charge_ms && !hasAfter) {
    parts.push(t.chargeInCycle ? `（含前摇 ${fmtMs(t.charge_ms)}）` : `前摇 ${fmtMs(t.charge_ms)} →`);
  }
  if (hasAfter) parts.push(`${fmtSec(t.after_ms!)} 起`);
  if (t.lasts_ms === null) parts.push("之后持续");
  else if (t.lasts_ms !== undefined) parts.push(`持续 ${fmtSec(t.lasts_ms)}`);
  if (t.when?.target?.length) parts.push(`目标 ${t.when.target.join("/")}`);
  return parts.join("、");
}

/** 一条轨的完整句子 */
function describeTrack(t: Track): string {
  const when = describeWhen(t);
  const what = describeTiming(t.timing);
  if (!when) return what;
  // 前摇在周期**内**时，`（含…）` 要贴在周期后面才读得通，所以放句尾
  if (t.chargeInCycle) return `${what}${when}`;
  // 前摇在连打**之前**：`前摇 3.00s → 连打 …`
  return `${when} ${what}`;
}

/** 范围伤害机制 */
const areaText = computed(() => {
  const a = props.weapon.area;
  if (a.kind === "side_targets") return `溅射 ${a.targets} 个目标`;
  if (a.kind === "radius") {
    const f = a.falloff?.length ? `，衰减 ${a.falloff.map((x) => `${x.distance}格${x.percent}%`).join(" → ")}` : "";
    return `半径 ${a.radius_tiles} 格${f}`;
  }
  if (a.kind === "side_damage") return `相邻格 ${a.side_value}`;
  // 多格伤害图案：格内全额、无衰减 —— 与 `radius` 的渐衰机制不同（findings I125）
  if (a.kind === "multi_hex") {
    const SHAPE: Record<string, string> = { Circle: "圆", Diamond: "菱形", Line: "直线" };
    return `${SHAPE[a.shape ?? ""] ?? a.shape} 图案 ${a.size}`;
  }
  return null;
});

const minor = computed(() => {
  const out: Array<[string, string]> = [];
  /*
   * ⚠️ **不展示 `weapon.range_tiles`。**
   *
   * 它是 `weapon.maxRangeInTiles`，但**无法作为射程使用**：步枪兵（基础步兵，攻击距离 1）
   * 与 MLRS（炮兵，攻击距离 2）**都是 2.5** —— 连最基本的角色差异都区分不了。
   * 游戏面板的攻击距离用的是 `squadTuning.maxAttackRangeInTiles`（单位总览行已显示）。
   * 见 findings I126/I127/I129。
   */
  if (props.weapon.homing !== undefined) out.push(["弹道", props.weapon.homing ? "追踪" : "不追踪"]);
  if (props.weapon.targeting_unknown) out.push(["索敌", "未知"]);
  return out;
});
</script>

<template>
  <div class="weapon" :class="{ primary }">
    <div class="head">
      <b>{{ weapon.name }}</b>
      <span class="dim">{{ weapon.type }}</span>
      <span v-if="primary" class="tag primary" title="面板 DPS 显示的是这把武器">主武器</span>
      <span v-if="weapon.targeting_unknown" class="tag warn">索敌未知</span>
      <span class="idx">武器 {{ index + 1 }}</span>
    </div>

    <!-- ① 结论行 -->
    <div class="key">
      <div class="key-item">
        <StatIcon name="dps" />
        <span>单发伤害</span>
        <b>{{ levelDamage }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="dps" />
        <span>单轮总伤害</span>
        <b>{{ levelVolley }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="dps" />
        <span>DPS（{{ DPS_LABEL }}）</span>
        <b>{{ levelDps?.toFixed(1) ?? "—" }}</b>
      </div>
    </div>

    <!--
      ⚠️ **`weapon.range_tiles` 已从结论行撤到下面的小字行。**
      它是 `weapon.maxRangeInTiles` —— 引擎内部字段。游戏面板显示的攻击距离用的是
      `squadTuning.maxAttackRangeInTiles`（整数字数，≤1 不显示，见 findings I126/I127）。
      两者不是同一个量：步枪兵 攻击距离 1 却射程 2.5、破坏者 攻击距离 2 却射程 1.25。
      但**它不是伪造值**（4 个取值：2.5/1.25/1.1/3.5，与攻击距离松散相关），
      Lua 侧无读取说明是 C++ 在读，所以**数据保留，只是不摆在结论行**。
    -->

    <!--
      ② 时序条 —— **段与段的位置关系自己就说明了"前摇在不在周期内"**，不需要措辞。
      这是图，下面是字：图给形状、字给数字，互补而不互相替代。
    -->
    <WeaponTimeline
      v-if="tracks.length"
      :tracks="tracks"
      :wave-size="waveSize ?? 1"
      :separation-ms="separationMs ?? 0"
    />

    <!-- ② 时序 —— 图给形状、字给数字，互补而不互相替代 -->
    <ul v-if="tracks.length" class="timing">
      <li v-for="(t, i) in tracks" :key="i">
        <span class="step">{{ tracks.length > 1 ? i + 1 : "" }}</span>
        <span>{{ describeTrack(t) }}</span>
      </li>
    </ul>

    <!-- ③ 范围 -->
    <p v-if="areaText" class="area"><span class="dim">范围</span>{{ areaText }}</p>

    <!-- ④ 逐目标伤害 -->
    <DamageMatrix :weapon="weapon" :level="level" :tracks="tracks" :wave-size="waveSize ?? 1" />

    <p v-if="minor.length" class="minor">
      <span v-for="[k, v] in minor" :key="k"><i>{{ k }}</i>{{ v }}</span>
    </p>
  </div>
</template>

<style scoped>
.weapon {
  border: 1px solid var(--line, #2a3550);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.weapon.primary {
  border-left: 3px solid #4a9eff;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.head b {
  font-size: 14px;
}
.dim {
  color: #7f8aa6;
  font-size: 12px;
}
.tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.tag.primary {
  background: #1d3a5c;
  color: #8fc4ff;
}
.tag.warn {
  background: #4a3a1d;
  color: #e0b050;
}
.idx {
  margin-left: auto;
  font-size: 11px;
  color: #6b7a99;
}

.key {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.key-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.key-item span {
  color: #9aa6c2;
  font-size: 12px;
}
.key-item b {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.timing {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  font-size: 12.5px;
  color: #b9c4dc;
}
.timing li {
  padding: 3px 0;
  border-bottom: 1px solid #232b3d;
}
.timing li:last-child {
  border-bottom: none;
}
/* 多段时用序号标出顺序 */
.timing .step {
  display: inline-block;
  min-width: 18px;
  margin-right: 6px;
  color: #6b7a99;
  font-variant-numeric: tabular-nums;
}

.area {
  margin: 0 0 8px;
  font-size: 12px;
  color: #b9c4dc;
}
.area .dim {
  margin-right: 8px;
}

.minor {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 8px 0 0;
  font-size: 11px;
  color: #b9c4dc;
}
.minor i {
  font-style: normal;
  color: #6b7a99;
  margin-right: 4px;
}
</style>
