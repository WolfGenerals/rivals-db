<script setup lang="ts">
/**
 * 等级控制器。放在顶栏而不是各页面里，因为等级是**全局单例状态**
 * （`state.ts`），列表、卡片、详情页都读同一个值。
 */
import { levelLabel, MAX_ORDINAL, ordinal, relativeToStart } from "../state.ts";
</script>

<template>
  <div class="level-controls">
    <label class="slider">
      <span class="cap">等级</span>
      <input v-model.number="ordinal" type="range" min="0" :max="MAX_ORDINAL" />
      <b class="value">{{ levelLabel }}</b>
    </label>
    <label class="toggle" title="勾选后，滑块 0 = 该条目自己的起始等级（普通 1-0 / 稀有 3-0 / 史诗 5-0）">
      <input v-model="relativeToStart" type="checkbox" />
      <span>从各自起始等级算</span>
    </label>
  </div>
</template>

<style scoped>
.level-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.slider {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cap {
  color: #7f8aa6;
  font-size: 12px;
}
input[type="range"] {
  width: 180px;
}
.value {
  font-variant-numeric: tabular-nums;
  min-width: 3.2em;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #9aa6c2;
  cursor: pointer;
}
</style>
