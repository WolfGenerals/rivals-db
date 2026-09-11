<script setup lang="ts">
/**
 * 兵种图标（步兵 / 载具 / 空军 / 建筑 / 采集车）。
 *
 * **分工**：`icons.ts` 里是**手绘的剪影图形**（纯数据）；**圆底由本组件画**。
 * 这样圆底能单独跟阵营换色（烘进图形里就只能整体一色）。
 *
 * **为什么内联 SVG 而不是 `<img src="...svg">`**：
 * `<img>` 引用的 SVG 是独立文档，外部 CSS 改不了它内部颜色，
 * 想给两个阵营各一套配色就只能准备两份位图。
 *
 * 配色：圆底 `--icon-bg`、剪影 `--icon-glyph`、描边 `--icon-ring`。
 */
import { computed, useId } from "vue";

import { TYPE_ICONS } from "../icons.ts";

const props = defineProps<{ type: string; color?: string }>();

/** `clipPath` 的 id **必须每个实例都不同** —— 同页多个图标共用 id 会互相串 */
const clipId = `type-icon-clip-${useId()}`;

const icon = computed(() => TYPE_ICONS[props.type.toLowerCase()]);

const size = computed(() => {
  const parts = icon.value?.viewBox.split(/\s+/).map(Number) ?? [];
  return Number.isFinite(parts[2]) ? parts[2]! : 64;
});
</script>

<template>
  <svg
    v-if="icon"
    class="type-icon"
    :viewBox="icon.viewBox"
    role="img"
    :aria-label="type"
    :style="color ? { '--icon-bg': color } : undefined"
  >
    <!--
      圆底。`r = size/2` 正好顶满 viewBox，**同时用作图形的裁切边界** ——
      图形按原尺寸画，超出圆的部分被裁掉。比缩小图形好看得多（保持饱满），
      也是常规做法。`clipPath` 的 id 每个实例都不同，避免同页互相串。
    -->
    <defs>
      <clipPath :id="clipId">
        <circle :cx="size / 2" :cy="size / 2" :r="size / 2" />
      </clipPath>
    </defs>
    <circle
      :cx="size / 2"
      :cy="size / 2"
      :r="size / 2"
      fill="var(--icon-bg, #33518f)"
      stroke="var(--icon-ring, #0b1020)"
      :stroke-width="size * 0.03"
    />
    <!-- 图形用 currentColor 画，所以这里把 color 设成剪影色 -->
    <g class="glyph" :clip-path="`url(#${clipId})`" v-html="icon.body" />
  </svg>
</template>

<style scoped>
.type-icon {
  display: block;
  width: 100%;
  height: auto;
  filter: drop-shadow(0 0.3cqw 0.7cqw #000a);
}
.glyph {
  color: var(--icon-glyph, #fff);
}
</style>
