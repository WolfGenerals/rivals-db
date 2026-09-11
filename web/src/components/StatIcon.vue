<script setup lang="ts">
/**
 * 数值标签图标（HP / DPS / 射程 / 视野 / 速度 / 造价 / 攻击间隔）。
 *
 * 内联的理由和 `TypeIcon` 一样：这些 SVG 是 `stroke="currentColor"` 画的，
 * 当 `<img>` 引用时没有可继承的颜色，会一律渲染成黑色。
 */
import { computed } from "vue";

import { STAT_ICONS } from "../icons.ts";

const props = defineProps<{ name: string }>();

const icon = computed(() => STAT_ICONS[props.name]);
</script>

<template>
  <svg v-if="icon" class="stat-icon" :viewBox="icon.viewBox" role="img" :aria-label="name">
    <g v-html="icon.body" />
  </svg>
</template>

<style scoped>
.stat-icon {
  display: block;
  width: 1.15em;
  height: 1.15em;
  flex: 0 0 auto;
  color: var(--stat-icon-color, #7f8aa6);
}
</style>
