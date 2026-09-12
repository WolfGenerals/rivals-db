<script setup lang="ts">
/**
 * 逐目标伤害 —— **一行五格**，每格是这把武器对一类目标的四个数，用竖线隔开：
 *
 * ```
 * [图标] 单发 | 单轮 | DPS | 伤害补正
 * ```
 *
 * 四个数的口径（**悬停提示里逐条写清**，行内只留数字免得太挤）：
 *   · **单发** —— 这一击打在它身上多少（随等级缩放，四舍五入）
 *   · **单轮** —— 一轮打完的总量 = 单发 × 一轮发数 × **队伍人数**（小队每人各打各的，见 I172）
 *   · **DPS** —— 对它的**实际**输出，**跟顶栏的爆发/平均口径**（不是单位面板值）
 *   · **伤害补正** —— 相对**这把武器自己的默认伤害**的百分比（不是相对别的武器，见 I51），
 *     用档位色 + ▲/▼
 *
 * 档位色与「敌人应对」的克制行共用 `damageTiers.ts`（颜色是这套界面的主要语言）。
 */
import { computed } from "vue";

import type { Track, Weapon } from "@rivals/core/derive";
import type { Level } from "@rivals/core/levels";

import { TARGET_LABELS, TARGET_TYPES, targetDamage } from "../damageTiers.ts";
import { weaponDps } from "../dps.ts";
import { dpsMode } from "../state.ts";
import TypeIcon from "./TypeIcon.vue";

const props = defineProps<{
  weapon: Weapon;
  level: Level;
  /** 这把武器的时序轨道 —— 一轮发数、射击间隔都在里面 */
  tracks: Track[];
  /** 队伍人数（小队每人各打各的，单轮与 DPS 都要乘） */
  waveSize?: number;
}>();

interface Col {
  key: string;
  label: string;
  type: string;
  color: string;
  reachable: boolean;
  /** 索敌方式未知（`descriptors` 空表）—— 不显示具体结论 */
  unknown: boolean;
  single: string;
  volley: string;
  dps: string;
  percent: string;
  arrow: string;
  /** 悬停提示：逐条说明每个数字是什么 */
  tip: string;
}

const set = computed(() => weaponDps(props.weapon, props.tracks, props.waveSize ?? 1));
const wave = computed(() => props.waveSize ?? 1);
const modeLabel = computed(() => (dpsMode.value === "avg" ? "平均" : "爆发"));
const modeWhy = computed(() =>
  dpsMode.value === "avg" ? "含蓄力/装填/空档的长期平均" : "射击期间的速率（伤害 ÷ 两下之间的间隔）",
);

const cols = computed<Col[]>(() => {
  const factor = props.level.factor();
  const base = dpsMode.value === "avg" ? set.value.avg : set.value.burst;
  return TARGET_TYPES.map((type) => {
    const label = TARGET_LABELS[type];
    const td = targetDamage([props.weapon], type);
    const percent = Math.round(td.ratio * 100);
    // 单发/单轮按等级系数缩放（游戏里 HP 截断、DPS 保留一位；单发没有直接证据，四舍五入）
    const single = Math.round(td.damage * factor);
    const volley = Math.round(set.value.volley * td.ratio * factor);
    // DPS 走 `level.dps()` —— 与武器卡同一个缩放与舍入
    const dps = props.level.dps(base * td.ratio);
    const arrow = percent > 100 ? "▲" : percent < 100 ? "▼" : "";
    const tip = td.unknown
      ? `${label}：索敌方式未知\n该武器的 descriptors 是空表，不走常规索敌 —— 不猜能不能打`
      : !td.reachable
        ? `${label}：打不到\n该武器的可攻击集里没有这类目标`
        : [
            `${label} —— ${props.weapon.name}`,
            `单发 ${single}`,
            `单轮 ${volley}`,
            `DPS ${dps.toFixed(1)}`,
            `伤害补正 ${percent}%，${percent > 100 ? "更高" : percent < 100 ? "更低" : "持平"}`,
          ].join("\n");
    return {
      key: type,
      label,
      type: type.toLowerCase(),
      color: td.color,
      reachable: td.reachable,
      unknown: td.unknown,
      single: td.reachable ? String(single) : "—",
      volley: td.reachable ? String(volley) : "—",
      dps: td.reachable ? dps.toFixed(1) : "—",
      percent: td.reachable ? `${percent}%` : "—",
      arrow,
      tip,
    };
  });
});
</script>

<template>
  <div class="matrix">
    <div
      v-for="c in cols"
      :key="c.key"
      class="cell"
      :class="{ dead: !c.reachable && !c.unknown, unknown: c.unknown }"
      :style="{ '--c': c.color }"
      :data-tip="c.tip"
      data-float
    >
      <span class="icon">
        <TypeIcon :type="c.type" />
        <i v-if="!c.reachable && !c.unknown" class="slash" aria-hidden="true" />
        <i v-if="c.unknown" class="qmark" aria-hidden="true">?</i>
      </span>
      <span class="nums">
        <b>{{ c.single }}</b>
        <i class="sep">|</i>
        <b>{{ c.volley }}</b>
        <i class="sep">|</i>
        <b>{{ c.dps }}</b>
        <i class="sep">|</i>
        <b class="ratio">{{ c.percent }}<i class="arrow">{{ c.arrow }}</i></b>
      </span>
    </div>
  </div>
</template>

<style scoped>
.matrix {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
}
.cell {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-right: 12px;
  border-right: 1px solid var(--line, #232b3d);
}
.cell:last-child {
  border-right: none;
  padding-right: 0;
}
.icon {
  position: relative;
  display: block;
  width: 28px;
  /* 圆底用档位颜色 */
  --icon-bg: var(--c);
}
.cell.dead .icon,
.cell.dead .nums {
  opacity: 0.35;
}
.nums {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}
.nums b {
  font-size: 13px;
  font-weight: 500;
  color: #cdd6e6;
}
/* 伤害补正：档位色的主要落点（颜色是这套界面的主要语言） */
.nums b.ratio {
  color: var(--c);
  font-weight: 600;
}
.nums .sep {
  font-style: normal;
  color: #3f4a60;
  font-size: 11px;
}
.nums .arrow {
  font-style: normal;
  font-size: 9px;
  margin-left: 1px;
}
.cell.dead .nums {
  color: #6b7a99;
}
/* 索敌方式未知：紫色问号，别用红斜杠（那是"确定打不到"的意思） */
.cell.unknown .icon {
  opacity: 0.8;
}
.cell.unknown .nums b {
  color: #9b86c9;
}
.qmark {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-style: normal;
  font-size: 14px;
  font-weight: 700;
  color: #c9b6ff;
  text-shadow: 0 0 3px #000, 0 0 6px #000;
}
.slash {
  position: absolute;
  inset: 8% 46% 8% 46%;
  background: #f87171;
  transform: rotate(-45deg);
  border-radius: 1px;
  box-shadow: 0 0 0 1px #0b1020;
}
</style>
