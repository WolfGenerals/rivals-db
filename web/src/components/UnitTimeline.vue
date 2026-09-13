<script setup lang="ts">
/**
 * **单位状态条** —— 一个单位一条，画**单位级**的东西（现在只有部署 / 撤收）。
 *
 * 与武器条分开（用户：「一个自身条 + 每个独立武器一个」）：武器条只管那把武器的节奏；
 * 部署在源码里是**单位级**动作（`modifier_intro/outro`，**全队同时**，J81），
 * 挂在武器槽上只是借容器 —— 画进武器条会让两把武器的图各画一遍。
 *
 * ⚠️ 以后加**移动 / 停止**时：那些是**引擎报的只读事实**（J40），由驱动喂进来，
 * 与本条现在"算出来的"部署相位并列 —— 见 `web/src/def-timeline.ts` 的 `unitStateTimeline`。
 */
import { computed } from "vue";

import type { UnitDef } from "@rivals/core/model/unit-def";

import { unitStateTimeline } from "../def-timeline.ts";
import WeaponTimeline from "./WeaponTimeline.vue";

const props = defineProps<{ def: UnitDef; unitName?: string }>();

const view = computed(() => unitStateTimeline(props.def));
</script>

<template>
  <div v-if="view.segs.length" class="unit">
    <h4>单位状态 <span class="dim">{{ unitName }}</span></h4>
    <WeaponTimeline
      :segs="view.segs"
      :cycle-ms="view.spanMs"
      :initial-ms="0"
      :span-ms="view.spanMs"
      :wave-size="1"
      :separation-ms="0"
      :axis-note="view.axisNote"
    />
  </div>
</template>

<style scoped>
.unit {
  margin-bottom: 10px;
}
/* 区块标题：与武器卡 `WeaponCard.vue` 的 `.block h4` 同一套（更大 / 加粗 / 上色 + 左侧色条） */
h4 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 6px;
  padding-left: 9px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #a8c8f0;
  border-left: 3px solid #4a9eff;
}
.dim {
  font-weight: 400;
  color: #7f8aa6;
}
</style>
