<script setup lang="ts">
/**
 * 等级选择器 —— 紧凑 + **可精确选择**。
 *
 * 为什么不用滑块：有效等级只有 **60 个**（大级 1~15 × 小级 0~3），而滑块再宽也会把
 * 相邻等级压到不足 2px，**落点天生不可能准**。改成**点开一张 15×4 的网格直接点** ——
 * 一次点击选中，还能一眼看到全部等级。
 *
 * 三个控件各司其职：
 *   `−` / `+`  快速微调（相邻一两级）
 *   `5-3`      当前值，**点它展开网格**（远距离跳转）
 *   `独立`      是否脱离顶栏的全局等级
 */
import { computed, ref } from "vue";

import { level as makeLevel, MAX_MAJOR, MINOR_MAX } from "@rivals/core/levels";

const props = defineProps<{
  level: { major: number; minor: number };
  independent: boolean;
  /** 跟随全局时的等级（未勾独立时提示实际生效值） */
  globalLevel: { major: number; minor: number };
}>();

const emit = defineEmits<{
  (e: "update:independent", v: boolean): void;
  (e: "update:level", v: ReturnType<typeof makeLevel>): void;
}>();

/** 大级 1..MAX_MAJOR；小级从高到低排，符合"往下越长"的直觉 */
const MAJORS = Array.from({ length: MAX_MAJOR }, (_, i) => i + 1);
const MINORS = Array.from({ length: MINOR_MAX + 1 }, (_, i) => MINOR_MAX - i);

const open = ref(false);

const label = computed(() => `${props.level.major}-${props.level.minor}`);

function pick(major: number, minor: number) {
  emit("update:level", makeLevel(major, minor));
  open.value = false;
}
function step(d: number) {
  const n = (props.level.major - 1) * (MINOR_MAX + 1) + props.level.minor + d;
  const max = (MAX_MAJOR - 1) * (MINOR_MAX + 1) + MINOR_MAX;
  const c = Math.max(0, Math.min(max, n));
  emit("update:level", makeLevel(Math.floor(c / (MINOR_MAX + 1)) + 1, c % (MINOR_MAX + 1)));
}
const onToggle = (e: Event) => emit("update:independent", (e.target as HTMLInputElement).checked);
</script>

<template>
  <div class="picker" :class="{ follow: !independent }">
    <label class="toggle" title="勾选后本单位用自己的等级，否则跟随顶栏">
      <input type="checkbox" :checked="independent" @change="onToggle" />
      <span>独立</span>
    </label>

    <button type="button" class="nav" :disabled="!independent" title="降一级" @click="step(-1)">−</button>

    <button
      type="button"
      class="value"
      :disabled="!independent"
      :title="independent ? '点击选择等级' : '未勾选独立，当前跟随全局'"
      @click="open = !open"
    >
      <span :class="{ dim: !independent }">{{ label }}</span>
      <i v-if="independent" class="caret">▾</i>
    </button>

    <button type="button" class="nav" :disabled="!independent" title="升一级" @click="step(1)">+</button>

    <span v-if="!independent" class="note">全局 {{ globalLevel.major }}-{{ globalLevel.minor }}</span>

    <!-- 网格：15 列（大级）× 4 行（小级） -->
    <template v-if="open">
      <div class="backdrop" @click="open = false" />
      <div class="grid">
        <div class="grid-head">
          <span class="corner" />
          <span v-for="m in MAJORS" :key="m" class="col">{{ m }}</span>
        </div>
        <div v-for="mi in MINORS" :key="mi" class="grid-row">
          <span class="row-cap">{{ mi }}</span>
          <button
            v-for="m in MAJORS"
            :key="m"
            type="button"
            class="cell"
            :class="{ on: m === level.major && mi === level.minor }"
            @click="pick(m, mi)"
          >
            {{ m }}-{{ mi }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
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

.nav,
.value {
  /* 底色/边框/字色交给全局 button 样式（保证"看得出能点"），这里只定尺寸 */
  height: 20px;
  padding: 0 5px;
  font-size: 12px;
}
.nav {
  width: 20px;
  padding: 0;
  line-height: 1;
  font-size: 13px;
}
.nav:disabled,
.value:disabled {
  opacity: 0.35;
  cursor: default;
}
.value {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 46px;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
.value .dim {
  color: #6b7a99;
}
.caret {
  font-style: normal;
  font-size: 8px;
  color: #6b7a99;
}

.note {
  font-size: 10px;
  color: #6b7a99;
  white-space: nowrap;
}

/* 点空白关闭 */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.grid {
  position: absolute;
  top: 24px;
  right: 0;
  z-index: 21;
  padding: 6px;
  background: #131820;
  border: 1px solid var(--line, #2b3038);
  border-radius: 8px;
  box-shadow: 0 8px 24px #000a;
}
.grid-head,
.grid-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.grid-head {
  margin-bottom: 2px;
}
.corner,
.row-cap {
  width: 16px;
  font-size: 9px;
  color: #6b7a99;
  text-align: center;
}
.col {
  width: 26px;
  font-size: 9px;
  color: #6b7a99;
  text-align: center;
}
.cell {
  width: 26px;
  height: 16px;
  margin: 1px 0;
  padding: 0;
  font-size: 9px;
  color: #7f8aa6;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.cell:hover {
  background: #26303f;
  color: #e6ecf5;
}
.cell.on {
  background: #1d3a5c;
  border-color: #4a9eff;
  color: #8fc4ff;
}
</style>
