<script setup lang="ts">
/**
 * 单位等级选择器 —— 两个滑块（大级 / 小级）+ 一个「用独立等级」开关。
 *
 * 默认**跟随全局等级**（顶栏那个滑块），开关默认关闭；打开后本单位用自己的一套等级，
 * 便于在同一页里横向比较不同等级的表现。
 *
 * 用 `v-model:level` 双向绑定本单位的有效等级，用 `v-model:independent` 绑定开关状态，
 * 由调用方（`UnitPanel`）决定怎么合并全局等级。
 */
import { computed } from "vue";

import { level as makeLevel, MAX_MAJOR, MINOR_MAX } from "@rivals/core/levels";

const props = defineProps<{
  /** 当前生效的等级（只读展示用；改动通过 `level` 事件回传） */
  level: { major: number; minor: number };
  independent: boolean;
  /** 跟随全局时的等级，开关关闭时用来提示用户现在是多少 */
  globalLevel: { major: number; minor: number };
}>();

const emit = defineEmits<{
  (e: "update:independent", v: boolean): void;
  (e: "update:level", v: ReturnType<typeof makeLevel>): void;
}>();

/** 被 15-3 截断时提示一下 */
const capped = computed(() => props.level.major >= MAX_MAJOR);

function setMajor(v: number) {
  const minor = v >= MAX_MAJOR ? Math.min(props.level.minor, MINOR_MAX) : props.level.minor;
  emit("update:level", makeLevel(v, minor));
}
function setMinor(v: number) {
  emit("update:level", makeLevel(props.level.major, v));
}
</script>

<template>
  <div class="picker" :class="{ follow: !independent }">
    <label class="toggle">
      <input
        type="checkbox"
        :checked="independent"
        @change="emit('update:independent', ($event.target as HTMLInputElement).checked)"
      />
      <span>独立等级</span>
    </label>

    <div class="sliders">
      <label>
        <span class="cap">大级</span>
        <input
          type="range"
          min="1"
          :max="MAX_MAJOR"
          :value="level.major"
          :disabled="!independent"
          @input="setMajor(Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <label>
        <span class="cap">小级</span>
        <input
          type="range"
          min="0"
          :max="MINOR_MAX"
          :value="level.minor"
          :disabled="!independent"
          @input="setMinor(Number(($event.target as HTMLInputElement).value))"
        />
      </label>
    </div>

    <span class="now">
      <b>{{ level.major }}-{{ level.minor }}</b>
      <em v-if="!independent">跟随全局（{{ globalLevel.major }}-{{ globalLevel.minor }}）</em>
      <em v-else-if="capped">已到满级上限</em>
    </span>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--line, #2b3038);
  border-radius: 8px;
  background: #171c26;
}
/* 跟随全局时整体压暗，一眼看出这几个控件现在不生效 */
.picker.follow .sliders {
  opacity: 0.4;
  pointer-events: none;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #9aa6c2;
  cursor: pointer;
  white-space: nowrap;
}
.sliders {
  display: flex;
  align-items: center;
  gap: 14px;
}
.sliders label {
  display: flex;
  align-items: center;
  gap: 7px;
}
.cap {
  font-size: 11px;
  color: #7f8aa6;
}
.sliders input[type="range"] {
  width: 128px;
}
.now {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
.now b {
  font-size: 16px;
}
.now em {
  font-style: normal;
  font-size: 11px;
  color: #7f8aa6;
}
</style>
