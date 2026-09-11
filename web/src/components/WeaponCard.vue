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

/** 时序的一行文字 */
function timingText(t: Track): string {
  const tm = t.timing;
  if (tm.kind === "装填") {
    const parts = [`弹夹 ${tm.clip} 发`, `装填 ${(tm.reload_ms / 1000).toFixed(1)}s`];
    if (tm.interval_ms) parts.push(`间隔 ${tm.interval_ms}ms`);
    return parts.join(" · ");
  }
  if (tm.kind === "一次") return `蓄力 ${tm.charge_ms}ms 后一次性`;
  const parts = [`一轮 ${tm.hits} 发`, `周期 ${(tm.cycle_ms / 1000).toFixed(2)}s`];
  if (tm.interval_ms) parts.push(`间隔 ${tm.interval_ms}ms`);
  if (tm.gap_ms) parts.push(`空档 ${(tm.gap_ms / 1000).toFixed(2)}s`);
  return parts.join(" · ");
}

/** 轨道的时间定位（`sequence` 用） */
function whenText(t: Track): string {
  const parts: string[] = [];
  if (t.charge_ms) parts.push(`前摇 ${t.charge_ms}ms`);
  if (t.after_ms !== undefined) parts.push(`${(t.after_ms / 1000).toFixed(2)}s 起`);
  if (t.lasts_ms === null) parts.push("持续");
  else if (t.lasts_ms !== undefined) parts.push(`持续 ${(t.lasts_ms / 1000).toFixed(1)}s`);
  if (t.when?.target?.length) parts.push(`目标：${t.when.target.join("/")}`);
  return parts.join(" · ");
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
  // 引擎内部的逐武器距离。**不是**面板的「攻击距离」（那个在单位总览行）—— 见 findings I126
  if (props.weapon.range_tiles !== undefined) out.push(["武器射程（引擎值）", `${props.weapon.range_tiles} 格`]);
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

    <!-- ② 时序 -->
    <table v-if="tracks.length" class="timing">
      <thead>
        <tr>
          <th>时序</th>
          <th>时机</th>
          <th>节奏</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(t, i) in tracks" :key="i">
          <td>{{ t.timing.kind }}</td>
          <td class="dim">{{ whenText(t) || "—" }}</td>
          <td>{{ timingText(t) }}</td>
        </tr>
      </tbody>
    </table>

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
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-bottom: 8px;
}
.timing th {
  text-align: left;
  font-weight: 500;
  color: #7f8aa6;
  font-size: 11px;
  padding: 2px 8px 4px 0;
  border-bottom: 1px solid var(--line, #2a3550);
}
.timing td {
  padding: 3px 8px 3px 0;
  border-bottom: 1px solid #232b3d;
  color: #b9c4dc;
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
