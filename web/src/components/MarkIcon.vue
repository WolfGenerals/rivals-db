<script setup lang="ts">
/**
 * 战斗时间线的标志图标（攻击 / 受伤 / 阵亡 / 打不到）—— 图形定义在 `web/src/icons.ts`
 * 的 `MARK_ICONS`，与主图**共用同一份定义**（图例也是它渲染的）。
 *
 * ⚠️ **只设 `fill`，不设 `stroke`** —— 图形全是填充型，多一句 `stroke="currentColor"`
 * 会在缩小时把挖空（骷髅的眼窝、爆裂的缺口）**描边填掉**：描边宽度 1 用户单位 ≈ 0.5px，
 * 而眼窝只有 3px，一描就成实心球（真渲染出来看过，见 `out/marks.png`）。
 * 颜色一律交给外部 CSS（`.mark-atk` / `.mark-dmg` / `.mark-dmg.killed` …）。
 */
import { computed } from "vue";

import { MARK_ICONS } from "../icons.ts";

const props = defineProps<{
  name: keyof typeof MARK_ICONS | string;
  /** 高度（像素）；宽度按比例（`preserveAspectRatio` 默认即可） */
  size?: number;
}>();

const icon = computed(() => MARK_ICONS[props.name as string]);
</script>

<template>
  <svg
    v-if="icon"
    class="mark-icon"
    :viewBox="icon.viewBox"
    :width="size ?? 10"
    :height="size ?? 10"
    preserveAspectRatio="xMidYMid meet"
    fill="currentColor"
    role="img"
    :aria-label="String(name)"
  >
    <g v-html="icon.body" />
  </svg>
</template>

<style scoped>
.mark-icon {
  display: block;
  overflow: visible;
}
</style>
