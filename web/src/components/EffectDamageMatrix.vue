<script setup lang="ts">
/**
 * **效果伤害矩阵**（火 / 毒气 / 催化爆炸）—— 与武器卡**同一套**显示语言。
 *
 * 用户要求：「毒气云/火焰也用标准的伤害显示」「催化爆炸也要的」——
 * 所以这里不是一段散文，而是五格（步兵 / 载具 / 空军 / 建筑 / 采集车），
 * 每格四个数、竖线隔开、**伤害补正用档位色**，与 `WeaponDamageMatrix` 长得一样。
 *
 * | 数 | `tick`（火/毒气） | `once`（催化爆炸） |
 * | --- | --- | --- |
 * | ① | 每跳伤害（**已按等级缩放**） | 单次伤害（同上） |
 * | ② | 每秒（每跳 ÷ 跳间隔） | `—`（一次性，没有"每秒"） |
 * | ③ | **持续几秒** | `—` |
 * | ④ | 伤害补正（相对这个效果自己的基础值，档位色） | 同左 |
 *
 * ⚠️ **只对地**（`groundOnly`）时，空军那格是 **打不到**（`—` + 红斜杠），不是"伤害 0"。
 * ⚠️ **补正的基准是"未缩放"的基础值**，而格子里显示的数是"按等级缩放后"的 ——
 * 两个数都要摆出来（用户：「相对基础伤害 6，但是缩放后基础 18」），否则看着像对不上。
 */
import { computed } from "vue";

import { DEAD_COLOR, TARGET_LABELS, tierOf } from "../damageTiers.ts";
import { fmtTime, fmtTimeShort } from "../format.ts";
import type { EffectDamageView } from "../weapon-view.ts";
import TypeIcon from "./TypeIcon.vue";

const props = defineProps<{
  view: EffectDamageView;
  /** 这个效果叫什么（悬停里用，已经是中文名） */
  title: string;
}>();

interface Cell {
  key: string;
  label: string;
  type: string;
  color: string;
  reachable: boolean;
  hit: string;
  perSec: string;
  lasts: string;
  percent: string;
  arrow: string;
  tip: string;
}

const cols = computed<Cell[]>(() =>
  props.view.cells.map((c) => {
    const label = TARGET_LABELS[c.target];
    if (!c.reachable) {
      return {
        key: c.target,
        label,
        type: c.target.toLowerCase(),
        color: DEAD_COLOR,
        reachable: false,
        hit: "—",
        perSec: "—",
        lasts: "—",
        percent: "—",
        arrow: "",
        tip: `${label}：打不到\n${props.title}只作用于地面`,
      };
    }
    const percent = Math.round(c.ratio * 100);
    const arrow = percent > 100 ? "▲" : percent < 100 ? "▼" : "";
    // ⚠️ **持续用秒，不是跳数**（用户：「持续用秒不是跳」）—— 与全站时间单位一致
    const lasts =
      props.view.mode === "tick" && props.view.persistMs !== undefined ? fmtTimeShort(props.view.persistMs) : "—";
    return {
      key: c.target,
      label,
      type: c.target.toLowerCase(),
      color: tierOf(c.ratio).color,
      reachable: true,
      hit: String(c.perHit),
      perSec: c.perSec === undefined ? "—" : c.perSec.toFixed(1),
      lasts,
      percent: `${percent}%`,
      arrow,
      tip: [
        `${label} —— ${props.title}`,
        `${props.view.mode === "tick" ? "每跳" : "单次"} ${c.perHit}`,
        c.perSec === undefined ? "" : `每秒 ${c.perSec.toFixed(1)}`,
        lasts === "—" ? "" : `持续 ${fmtTime(props.view.persistMs ?? 0)}`,
        `伤害补正 ${percent}%（基准是基础值 ${props.view.base}）`,
      ]
        .filter((x) => x !== "")
        .join("\n"),
    };
  }),
);
</script>

<template>
  <div class="wrap">
    <div class="matrix">
      <div
        v-for="c in cols"
        :key="c.key"
        class="cell"
        :class="{ dead: !c.reachable }"
        :style="{ '--c': c.color }"
        :data-tip="c.tip"
        data-float
      >
        <span class="icon">
          <TypeIcon :type="c.type" />
          <i v-if="!c.reachable" class="slash" aria-hidden="true" />
        </span>
        <span class="nums">
          <b>{{ c.hit }}</b>
          <!-- 一次性效果（催化爆炸）**只有"单发"这一个数**：没有每秒、也没有持续 -->
          <template v-if="view.mode === 'tick'">
            <i class="sep">|</i>
            <b>{{ c.perSec }}</b>
            <i class="sep">|</i>
            <b>{{ c.lasts }}</b>
          </template>
          <i class="sep">|</i>
          <b class="ratio">{{ c.percent }}<i class="arrow">{{ c.arrow }}</i></b>
        </span>
      </div>
    </div>
    <p class="hint">
      <span class="dim">每格：{{ view.mode === "tick" ? "每跳 | 每秒 | 持续 | 伤害补正" : "单发 | 伤害补正" }}</span>
      <span class="base">
        基础 {{ view.mode === "tick" ? "每跳" : "单发" }} {{ view.base }}
        <template v-if="view.scaledBase !== view.base">→ 按当前等级 {{ view.scaledBase }}</template>
      </span>
    </p>
  </div>
</template>

<style scoped>
.wrap {
  margin: 4px 0 6px;
}
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
.slash {
  position: absolute;
  inset: 8% 46% 8% 46%;
  background: #f87171;
  transform: rotate(-45deg);
  border-radius: 1px;
  box-shadow: 0 0 0 1px #0b1020;
}
.hint {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #7f8aa6;
}
/* 基准值：未缩放 →（按等级）缩放后，两个数都摆出来，免得跟格子里的数对不上 */
.hint .base {
  color: #c8a86a;
}
</style>
