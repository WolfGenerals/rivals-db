<script setup lang="ts">
/**
 * 单位等级徽标 —— 还原游戏里的圆圈表示法。
 *
 * 几何：圆环按 **4 等分**，去掉底部那一块，剩下「左 / 上 / 右」三段：
 *
 *              ┌───┐
 *           ╱         ╲        · 4 等分，每块 90°，分界在 45°/135°/225°/315°
 *          │   等级    │       · 去掉中心在 180°（正下方）的那块 → 底部 90° 缺口
 *          │    15     │       · 点亮段数 = minor，从左往右（顺时针）依次点
 *           ╲         ╱        · 圈心大字 = major
 *              └───┘
 *             ★ 3/3            · 星级行坐在底部缺口里
 *
 * 底衬：整个徽标有**深色圆盘 + 描边**，不然弧线直接压在卡面美术上会读不出来。
 *
 * 两个版本：
 *   `full`  详情页用，含「等级」二字与星级行
 *   `mini`  卡片角标用，只留圈 + 大级数字，并为小尺寸单独调比例
 *
 * 全用 SVG 画（连文字也在 SVG 里），只要给宽度就能**严格等比缩放** ——
 * 卡片角标给 cqw、详情页给 px，比例完全一致。
 *
 * 依据：`core/src/levels.ts` 的 `MINOR_MAX = 3`，满级 `levelOrdinal(15,3)`，
 * 与游戏内截图（15 + 3/3）吻合。
 */
import { computed } from "vue";

import { MINOR_MAX, type Level } from "@rivals/core/levels";

const props = withDefaults(
  defineProps<{
    level: Level;
    variant?: "full" | "mini";
  }>(),
  { variant: "full" },
);

interface Geo {
  vb: string;
  cx: number;
  cy: number;
  r: number;
  sw: number;
  /** 每段弧在各自 90° 槽位里两侧各内缩多少度，形成段间缝隙 */
  inset: number;
  label: boolean;
  stars: boolean;
  majorSize: number;
  majorY: number;
  labelSize: number;
  labelY: number;
}

const GEO: Record<"full" | "mini", Geo> = {
  // 「等级」与小字数字的基线要拉开：数字字号 30 时上缘约在 majorY-21，
  // 标签基线若高于这个值就会压字。曾用 cy±9 导致「等级」叠在数字上。
  full: {
    vb: "0 0 100 112",
    cx: 50,
    cy: 48,
    r: 36,
    sw: 11,
    inset: 4,
    label: true,
    stars: true,
    majorSize: 30,
    majorY: 63,
    labelSize: 11,
    labelY: 34,
  },
  // 小尺寸下：圆环占比更大、描边更粗、数字更大，否则缩到 30px 就糊
  mini: {
    vb: "0 0 100 100",
    cx: 50,
    cy: 50,
    r: 34,
    sw: 12,
    inset: 4,
    label: false,
    stars: false,
    majorSize: 40,
    majorY: 64,
    labelSize: 0,
    labelY: 0,
  },
};

const g = computed(() => GEO[props.variant]);

/**
 * 三段可见弧的名字。底部那块（中心 180°）被去掉。
 * 顺序按顺时针：左(-90°) → 上(0°) → 右(90°)，minor 依次点亮。
 */
const SLOTS = [-90, 0, 90];

const ARCS = computed(() =>
  SLOTS.map((c) => [c - 45 + g.value.inset, c + 45 - g.value.inset] as [number, number]),
);

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180; // 0° = 12 点方向，顺时针为正
  return [g.value.cx + r * Math.cos(rad), g.value.cy + r * Math.sin(rad)];
}

function arcPath(a0: number, a1: number): string {
  const [x0, y0] = polar(g.value.r, a0);
  const [x1, y1] = polar(g.value.r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${g.value.r} ${g.value.r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** 底衬圆盘半径：正好把圆环包住 */
const bgR = computed(() => g.value.r + g.value.sw / 2 + 1.5);
/** 内圈「井」半径 */
const wellR = computed(() => g.value.r - g.value.sw / 2 - 1.5);

/** 星级行：坐在底部缺口里 */
const starRow = computed(() => ({ y: g.value.cy + g.value.r + 13, star: g.value.cx - 13, text: g.value.cx + 1 }));

function starPoints(cx: number, cy: number, ro: number, ri: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const rad = ((i * 36 - 90) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** 已点亮段数 = minor（0 段就是全灭） */
const lit = computed(() => Math.max(0, Math.min(MINOR_MAX, props.level.minor)));
</script>

<template>
  <svg
    class="level-badge"
    :class="variant"
    :viewBox="g.vb"
    role="img"
    :aria-label="`等级 ${level.major}-${level.minor}`"
  >
    <defs>
      <linearGradient :id="`lb-lit-${variant}`" x1="0" y1="0" x2="1" y2="0.5">
        <stop offset="0%" stop-color="#e2662f" />
        <stop offset="55%" stop-color="#f09540" />
        <stop offset="100%" stop-color="#f6c14a" />
      </linearGradient>
    </defs>

    <!-- 圆形背景：深色圆盘 + 外描边，保证压在任意卡面上都能读出来 -->
    <circle
      :cx="g.cx"
      :cy="g.cy"
      :r="bgR"
      fill="#161a21"
      stroke="#05070a"
      stroke-width="2.5"
    />

    <!-- 圆环槽位：先铺灰色打底 -->
    <path
      v-for="([a0, a1], i) in ARCS"
      :key="`bg${i}`"
      :d="arcPath(a0, a1)"
      fill="none"
      stroke="#3d434d"
      :stroke-width="g.sw"
      stroke-linecap="butt"
    />
    <!-- 已点亮的段叠上去 -->
    <path
      v-for="([a0, a1], i) in ARCS.slice(0, lit)"
      :key="`lit${i}`"
      :d="arcPath(a0, a1)"
      fill="none"
      :stroke="`url(#lb-lit-${variant})`"
      :stroke-width="g.sw"
      stroke-linecap="butt"
    />

    <!-- 内圈「井」 -->
    <circle
      :cx="g.cx"
      :cy="g.cy"
      :r="wellR"
      fill="#232935"
      stroke="#39414f"
      stroke-width="1.5"
    />

    <!-- 圈心：大级数字（full 版上方还有「等级」二字） -->
    <text
      v-if="g.label"
      :x="g.cx"
      :y="g.labelY"
      text-anchor="middle"
      class="label"
      :style="{ fontSize: `${g.labelSize}px` }"
    >
      等级
    </text>
    <text
      :x="g.cx"
      :y="g.majorY"
      text-anchor="middle"
      class="major"
      :style="{ fontSize: `${g.majorSize}px` }"
    >
      {{ level.major }}
    </text>

    <!-- 底部缺口里的星级行 -->
    <template v-if="g.stars">
      <polygon :points="starPoints(starRow.star, starRow.y, 8, 3.3)" fill="#ffffff" />
      <text :x="starRow.text" :y="starRow.y + 5" class="stars">{{ lit }}/{{ MINOR_MAX }}</text>
    </template>
  </svg>
</template>

<style scoped>
.level-badge {
  display: block;
  width: 100%;
  height: auto;
}
/* 字号写在 SVG 用户坐标系里，跟着 viewBox 等比缩放 */
.label {
  fill: #9aa6c2;
}
.major {
  fill: #ffffff;
  font-weight: 800;
}
.stars {
  fill: #ffffff;
  font-size: 16px;
  font-weight: 700;
}
/* mini 缩到 30px 时白字容易糊，加描边增强对比 */
.level-badge.mini .major {
  paint-order: stroke;
  stroke: #000000b0;
  stroke-width: 2.5px;
}
</style>
