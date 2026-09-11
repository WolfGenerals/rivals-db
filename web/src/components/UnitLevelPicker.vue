<script setup lang="ts">
/**
 * 等级选择器 —— **单行紧凑版**。
 *
 * 设计取舍：
 *   · **一个滑块（按序数 0~59）、一对步进按钮、一个数值** —— 取代原来的两个滑块。
 *     大级/小级用滑块各调一次很别扭（滑完大级再滑小级），而**序数**是一条连续轴，
 *     拖一下就能到任意等级。
 *   · **步进 `−`/`+` 走序数** —— 精确选 `15-3` 这类边界值比拖滑块可靠。
 *   · 数值永远是 `大级-小级`，与游戏内写法一致。
 *
 * 默认**跟随全局**（顶栏那个），勾「独立」后本单位用自己的等级，便于同页横向比较。
 */
import { computed } from "vue";

import { fromOrdinal, level as makeLevel, MAX_ORDINAL, MINOR_MAX } from "@rivals/core/levels";

const props = defineProps<{
  /** 当前生效的等级 */
  level: { major: number; minor: number };
  independent: boolean;
  /** 跟随全局时的等级（未勾独立时用来提示现在实际是多少） */
  globalLevel: { major: number; minor: number };
}>();

const emit = defineEmits<{
  (e: "update:independent", v: boolean): void;
  (e: "update:level", v: ReturnType<typeof makeLevel>): void;
}>();

/** 每大级有 `MINOR_MAX + 1` 个小级（0 也算一级） */
const PER_MAJOR = MINOR_MAX + 1;

/** 当前等级在连续轴上的位置 */
const ordinal = computed(() => (props.level.major - 1) * PER_MAJOR + props.level.minor);

const atMax = computed(() => ordinal.value >= MAX_ORDINAL);

function go(n: number) {
  emit("update:level", fromOrdinal(Math.max(0, Math.min(MAX_ORDINAL, n))));
}
const onSlide = (e: Event) => go(Number((e.target as HTMLInputElement).value));
const onToggle = (e: Event) => emit("update:independent", (e.target as HTMLInputElement).checked);
</script>

<template>
  <div class="picker" :class="{ follow: !independent }">
    <label class="toggle" title="勾选后本单位用自己的等级，否则跟随顶栏">
      <input type="checkbox" :checked="independent" @change="onToggle" />
      <span>独立</span>
    </label>

    <div class="stepper">
      <button type="button" :disabled="!independent || ordinal <= 0" title="降一级" @click="go(ordinal - 1)">
        −
      </button>
      <b :class="{ dim: !independent }">
        {{ level.major }}-{{ level.minor }}
        <em v-if="atMax" title="已到满级上限">满</em>
      </b>
      <button type="button" :disabled="!independent || atMax" title="升一级" @click="go(ordinal + 1)">
        +
      </button>
    </div>

    <input
      class="slide"
      type="range"
      min="0"
      :max="MAX_ORDINAL"
      :value="ordinal"
      :disabled="!independent"
      :title="`0 – ${MAX_ORDINAL}`"
      @input="onSlide"
    />

    <span v-if="!independent" class="note">跟随全局 {{ globalLevel.major }}-{{ globalLevel.minor }}</span>
  </div>
</template>

<style scoped>
/* 单行、低矮 —— 这一块不该占掉一整行 */
.picker {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  margin-left: auto; /* 靠右，不抢单位名的位置 */
  font-variant-numeric: tabular-nums;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #9aa6c2;
  cursor: pointer;
  white-space: nowrap;
}
.toggle input {
  margin: 0;
  width: 12px;
  height: 12px;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}
.stepper button {
  width: 18px;
  height: 18px;
  padding: 0;
  line-height: 1;
  font-size: 13px;
  color: #b9c4dc;
  background: #1d2430;
  border: 1px solid var(--line, #2b3038);
  border-radius: 4px;
  cursor: pointer;
}
.stepper button:hover:not(:disabled) {
  background: #26303f;
  color: #fff;
}
.stepper button:disabled {
  opacity: 0.3;
  cursor: default;
}
.stepper b {
  min-width: 42px;
  text-align: center;
  font-size: 14px;
  color: #e6ecf5;
}
.stepper b.dim {
  color: #6b7a99; /* 跟随全局时压暗，一眼看出这个数不由自己控制 */
}
.stepper em {
  margin-left: 3px;
  font-style: normal;
  font-size: 9px;
  color: #d8a13c;
  vertical-align: super;
}

/* 比原来两个 128px 滑块窄得多，但仍能拖到任意等级 */
.slide {
  width: 96px;
  height: 14px;
  accent-color: #4a9eff;
}
.slide:disabled {
  opacity: 0.35;
}

.note {
  font-size: 10px;
  color: #6b7a99;
  white-space: nowrap;
}
</style>
