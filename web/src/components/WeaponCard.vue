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
import type { Level } from "@rivals/core/levels";

import DamageMatrix from "./DamageMatrix.vue";
import StatIcon from "./StatIcon.vue";

const props = defineProps<{
  weapon: Weapon;
  /** 指向这把武器的时序轨道（`sequence` 下每把武器各一条） */
  tracks: Track[];
  index: number;
  /** 是否是单位的主武器 —— 面板 DPS 显示的是它 */
  primary?: boolean;
  level: Level;
  waveSize?: number;
}>();

/**
 * 一把武器的 DPS —— **统一式子**：
 *
 * ```
 * dps = damage × hits × waveSize × 1000 / cycle_ms
 * ```
 *
 * `interval_ms` / `gap_ms` 只是展示细化，不参与计算。
 */
const baseDps = computed(() => {
  const wave = props.waveSize ?? 1;
  let best = 0;
  for (const t of props.tracks) {
    const tm = t.timing;
    let hits: number;
    let cycle: number;
    if (tm.kind === "一次") continue; // 一次性不计持续输出
    else if (tm.kind === "装填") {
      hits = tm.clip;
      cycle = tm.reload_ms;
    } else {
      hits = tm.hits;
      cycle = tm.cycle_ms;
    }
    if (cycle > 0) best = Math.max(best, (props.weapon.damage * hits * wave * 1000) / cycle);
  }
  return best;
});
const levelDps = computed(() => (baseDps.value > 0 ? props.level.dps(baseDps.value) : undefined));

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 1 : 2)}s`;

/**
 * 把一条时序**按顺序读成一句话**。
 *
 * 原先是一张「时序 / 时机 / 节奏」三列表格，三个格子之间要读者自己拼 —— 但时序本来就是
 * **一条时间线**，读成句子才自然：
 *
 * ```
 * 每 250ms 一发，一轮 12 发（3.00s）
 * 每 500ms 投一发，弹夹 6 发，打空后装填 12.00s
 * ```
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
  const span = tm.hits * (tm.interval_ms ?? tm.cycle_ms);
  const head = `每 ${fmtMs(tm.interval_ms ?? tm.cycle_ms)} 一发，一轮 ${tm.hits} 发（${fmtSec(span)}）`;
  return tm.gap_ms ? `${head}，然后停 ${fmtSec(tm.gap_ms)}（周期 ${fmtSec(tm.cycle_ms)}）` : head;
}

/** 这条轨在整轮里的位置（`sequence` 才是按时间接替） */
function describeWhen(t: Track): string {
  const parts: string[] = [];
  if (t.charge_ms) parts.push(`前摇 ${fmtMs(t.charge_ms)}`);
  if (t.after_ms !== undefined && t.after_ms > 0) parts.push(`${fmtSec(t.after_ms)} 起`);
  if (t.lasts_ms === null) parts.push("之后持续");
  else if (t.lasts_ms !== undefined) parts.push(`持续 ${fmtSec(t.lasts_ms)}`);
  if (t.when?.target?.length) parts.push(`目标 ${t.when.target.join("/")}`);
  return parts.join("、");
}

/** 一条轨的完整句子 */
function describeTrack(t: Track): string {
  const when = describeWhen(t);
  const what = describeTiming(t.timing);
  return when ? `${when}：${what}` : what;
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
  // 多格伤害图案：**格内全额、无衰减** —— 与 `radius` 的渐衰机制不同（findings I125）
  if (a.kind === "multi_hex") {
    const SHAPE: Record<string, string> = { Circle: "圆", Diamond: "菱形", Line: "直线" };
    return `${SHAPE[a.shape ?? ""] ?? a.shape} 图案，尺寸 ${a.size}（格内全额、无衰减）`;
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
  if (props.weapon.homing !== undefined) out.push(["弹道", props.weapon.homing ? "追踪（难躲）" : "不追踪（可走位躲）"]);
  if (props.weapon.targeting_unknown) out.push(["索敌", "未知（数据缺失，不猜）"]);
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
        <b>{{ weapon.damage }}</b>
      </div>
      <div class="key-item">
        <StatIcon name="dps" />
        <span>DPS @{{ level.format() }}</span>
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

    <!-- ② 时序 —— 按顺序读成句子，不用表格 -->
    <ul v-if="tracks.length" class="timing">
      <li v-for="(t, i) in tracks" :key="i">
        <span class="step">{{ tracks.length > 1 ? i + 1 : "" }}</span>
        <span>{{ describeTrack(t) }}</span>
      </li>
    </ul>

    <!-- ③ 范围 -->
    <p v-if="areaText" class="area"><span class="dim">范围</span>{{ areaText }}</p>

    <!-- ④ 逐目标伤害 -->
    <DamageMatrix :weapon="weapon" :level="level" />

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
