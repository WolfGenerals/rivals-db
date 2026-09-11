<script setup lang="ts">
/**
 * 逐目标伤害 —— 一行列出这把武器对五类目标各打多少。
 *
 * 格式：`[兵种图标] 伤害 百分比▲▼`，**图标圆底和文字都用同一套档位颜色**，
 * 和「敌人应对」的克制行完全一致（共用 `damageTiers.ts`）。
 *
 * 百分比是**相对这把武器自己的默认伤害**，不是相对别的武器 ——
 * 见 docs/findings.md I51。
 */
import { computed } from "vue";

import type { Weapon } from "@rivals/core/derive";
import type { Level } from "@rivals/core/levels";

import { TARGET_LABELS, TARGET_TYPES, targetDamage } from "../damageTiers.ts";
import TypeIcon from "./TypeIcon.vue";

const props = defineProps<{
  weapon: Weapon;
  level: Level;
}>();

interface Row {
  key: string;
  label: string;
  type: string;
  color: string;
  reachable: boolean;
  /** 索敌方式未知（`descriptors` 空表）—— 不显示具体结论 */
  unknown: boolean;
  /** 该等级下的单发伤害 */
  damage: number;
  /** 百分比整数 */
  percent: number;
  /** 相对正常的三角：▲ 高 / ▼ 低 / 空 持平 */
  arrow: string;
  title: string;
}

const rows = computed<Row[]>(() => {
  const factor = props.level.factor();
  return TARGET_TYPES.map((type) => {
    const d = targetDamage([props.weapon], type);
    const percent = Math.round(d.ratio * 100);
    // 单发伤害按同一倍率缩放；游戏里 HP 走截断、DPS 走保留一位，
    // 单发伤害没有直接证据，这里用四舍五入
    const damage = Math.round(d.damage * factor);
    const arrow = percent > 100 ? "▲" : percent < 100 ? "▼" : "";
    return {
      key: type,
      label: TARGET_LABELS[type],
      type: type.toLowerCase(),
      color: d.color,
      reachable: d.reachable,
      unknown: d.unknown,
      damage,
      percent,
      arrow,
      title: d.unknown
        ? `${TARGET_LABELS[type]}：索敌方式未知（该武器 descriptors 为空，不走常规索敌）`
        : d.reachable
          ? `${TARGET_LABELS[type]}：${damage}（该武器正常的 ${percent}%）`
          : `${TARGET_LABELS[type]}：打不到`,
    };
  });
});
</script>

<template>
  <div class="matrix">
    <div
      v-for="r in rows"
      :key="r.key"
      class="cell"
      :class="{ dead: !r.reachable && !r.unknown, unknown: r.unknown }"
      :style="{ '--c': r.color }"
      :data-tip="r.title"
            data-float
    >
      <span class="icon">
        <TypeIcon :type="r.type" />
        <i v-if="!r.reachable && !r.unknown" class="slash" aria-hidden="true" />
        <i v-if="r.unknown" class="qmark" aria-hidden="true">?</i>
      </span>
      <span class="txt">
        <b>{{ r.unknown ? "?" : r.reachable ? r.damage : "—" }}</b>
        <em v-if="r.reachable">{{ r.percent }}%<i class="arrow">{{ r.arrow }}</i></em>
        <em v-else-if="r.unknown">未知</em>
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
  width: 30px;
  /* 圆底用档位颜色 */
  --icon-bg: var(--c);
}
.cell.dead .icon {
  opacity: 0.3;
}
/* 文字也用档位颜色 —— 颜色是这套界面的主要语言 */
.txt {
  display: flex;
  align-items: baseline;
  gap: 5px;
  color: var(--c);
}
.txt b {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.txt em {
  font-style: normal;
  font-size: 11px;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}
.txt .arrow {
  font-style: normal;
  font-size: 9px;
  margin-left: 1px;
}
.cell.dead .txt {
  color: #6b7a99;
}
/* 索敌方式未知：紫色问号，别用红斜杠（那是"确定打不到"的意思） */
.cell.unknown .icon {
  opacity: 0.75;
}
.qmark {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-style: normal;
  font-size: 15px;
  font-weight: 700;
  color: #c9b6ff;
  text-shadow: 0 0 3px #000, 0 0 6px #000;
}
.cell.unknown .txt {
  color: #9b86c9;
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
