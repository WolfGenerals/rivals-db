<script setup lang="ts">
/**
 * **逐目标伤害矩阵（新格式 def 版）** —— 一行五格，每格四个数，用竖线隔开：
 *
 * ```
 * [图标] 单发 | 单轮 | DPS | 伤害补正
 * ```
 *
 * | 数 | 口径 |
 * | --- | --- |
 * | **单发** | 这一击打在它身上多少（随等级缩放，四舍五入） |
 * | **单轮** | 一轮打完的总量 = 单发 × 一轮发数 × **队伍人数**（小队每人各打各的）；分段武器是**单跳** |
 * | **DPS** | 对它的**实际**输出，跟随顶栏的爆发/平均口径（不是游戏面板值） |
 * | **伤害补正** | 相对**这把武器自己的基础伤害**的百分比，**档位色 + ▲/▼** |
 *
 * 配色、图标、悬停提示与旧版逐条一致（`damageTiers.ts` 是共用语言）：
 * 打不到 ⇒ 暗格 + 红斜杠 + `—`；索敌未知（`descriptors` 空表）⇒ 紫问号。
 *
 * ⚠️ **"能不能打"看 `usage.canAttack`，"打多少"才看覆写表**（findings J53）：
 * 步枪兵对空 `against("Aircraft")` 返回 38，但它没有飞行位 ⇒ 这里是暗格，不是 38。
 */
import { computed } from "vue";

import type { Level } from "@rivals/core/levels";
import type { WeaponDef } from "@rivals/core/model/weapon-def";

import { DEAD_COLOR, TARGET_LABELS, TARGET_TYPES, TIERS, tierOf, UNKNOWN_COLOR } from "../damageTiers.ts";
import { dpsMode } from "../state.ts";
import { TARGETS, damageRatio, dpsOf, headlineTier, scaled, targetingUnknown, volleyCount, volleyWord } from "../weapon-view.ts";
import TypeIcon from "./TypeIcon.vue";

const props = defineProps<{
  weapon: WeaponDef;
  level: Level;
  /** 队伍人数（小队每人各打各的，单轮与 DPS 都要乘） */
  waveSize?: number;
}>();

const wave = computed(() => Math.max(1, props.waveSize ?? 1));
const unknown = computed(() => targetingUnknown(props.weapon));
const tier = computed(() => headlineTier(props.weapon));
const stageNote = computed(() => (props.weapon.timing.kind === "staged" ? `末段（段 ${props.weapon.damage.length}）` : ""));

interface Col {
  key: string;
  label: string;
  type: string;
  color: string;
  reachable: boolean;
  single: string;
  volley: string;
  dps: string;
  percent: string;
  arrow: string;
  tip: string;
}

const cols = computed<Col[]>(() =>
  TARGET_TYPES.map((type) => {
    const d = tier.value?.main;
    const label = TARGET_LABELS[type];
    const reachable = !unknown.value && props.weapon.usage.canAttack.includes(type);
    if (d === undefined || !reachable) {
      const why = unknown.value
        ? `${label}：索敌方式未知`
        : `${label}：打不到这类目标`;
      return {
        key: type,
        label,
        type: type.toLowerCase(),
        color: unknown.value ? UNKNOWN_COLOR : DEAD_COLOR,
        reachable: false,
        single: "—",
        volley: "—",
        dps: "—",
        percent: "—",
        arrow: "",
        tip: why,
      };
    }
    const ratio = damageRatio(d, type as (typeof TARGETS)[number]);
    const single = scaled(props.level, d.against(type as (typeof TARGETS)[number]));
    const volley = single * volleyCount(props.weapon) * wave.value;
    const dps = dpsOf(props.weapon, props.level, dpsMode.value) * ratio;
    const percent = Math.round(ratio * 100);
    const arrow = percent > 100 ? "▲" : percent < 100 ? "▼" : "";
    return {
      key: type,
      label,
      type: type.toLowerCase(),
      color: tierOf(ratio).color,
      reachable: true,
      single: String(single),
      volley: String(Math.round(volley)),
      dps: dps.toFixed(1),
      percent: `${percent}%`,
      arrow,
      tip: [
        `${label} —— ${props.weapon.id}${stageNote.value ? ` · ${stageNote.value}` : ""}`,
        `单发 ${single}`,
        `${props.weapon.timing.kind === "staged" ? "单跳" : "单轮"} ${Math.round(volley)}`,
        `每秒 ${dps.toFixed(1)}（${dpsMode.value === "avg" ? "平均" : "爆发"}口径）`,
        `伤害补正 ${percent}%`,
      ].join("\n"),
    };
  }),
);

const legend = computed(() =>
  TIERS.map((t) => ({ label: t.label, color: t.color })),
);
/** 分段武器那格叫「单跳」（它不是"一轮打完"，是一跳） */
const volleyLabel = computed(() => volleyWord(props.weapon));
</script>

<template>
  <div class="wrap">
    <div class="matrix">
      <div
        v-for="c in cols"
        :key="c.key"
        class="cell"
        :class="{ dead: !c.reachable && !unknown, unknown }"
        :style="{ '--c': c.color }"
        :data-tip="c.tip"
        data-float
      >
        <span class="icon">
          <TypeIcon :type="c.type" />
          <i v-if="!c.reachable && !unknown" class="slash" aria-hidden="true" />
          <i v-if="unknown" class="qmark" aria-hidden="true">?</i>
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
    <p class="hint">
      <span class="dim">每格：单发 | {{ volleyLabel }} | DPS | 伤害补正</span>
      <span v-for="t in legend" :key="t.label" class="tier"><i :style="{ background: t.color }" />{{ t.label }}</span>
    </p>
  </div>
</template>

<style scoped>
.wrap {
  margin-bottom: 6px;
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

.hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 6px 0 0;
  font-size: 10.5px;
  color: #7f8aa6;
}
.hint .dim {
  margin-right: 4px;
}
.tier {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tier i {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}
</style>
