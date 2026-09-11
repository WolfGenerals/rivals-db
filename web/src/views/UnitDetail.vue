<script setup lang="ts">
/**
 * 详情页 —— 只是「按 id 取数据 + 放进页面主体」的薄壳。
 *
 * 真正的展示逻辑在 `components/UnitPanel.vue`：那是个纯展示组件，
 * 只吃 `unit` + `level`，可以嵌在任何地方（详情页、对比页、弹层）。
 *
 * 页面这一层负责三件事：读路由参数、取数据、**给容器定宽**。
 * 定宽是必须的 —— `main` 铺满视口时一行太长，读起来很累。
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import type { DatasetEntry } from "@rivals/core/derive";

import UnitPanel from "../components/UnitPanel.vue";
import { findEntryById } from "../data.ts";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

const props = defineProps<{
  id: string;
  /** 嵌入模式（对比页并排两个）—— 不画面包屑，容器宽度交给外面那栏 */
  embedded?: boolean;
}>();

const data = useData();
// 单文件数据集：按 id 查表即可，没有异步加载
const rec = computed<DatasetEntry | null>(() =>
  data.value ? (findEntryById(data.value, props.id) ?? null) : null,
);
const loading = computed(() => !data.value);
const level = computed(() => displayLevel());
const backTo = computed(() => "/");
const title = computed(() => rec.value?.name_zh || rec.value?.name_en || props.id);
</script>

<template>
  <div class="page" :class="{ embedded }">
    <p v-if="!embedded" class="crumb">
      <RouterLink :to="backTo">单位</RouterLink> / {{ title }}
    </p>

    <p v-if="loading" class="muted">正在加载…</p>

    <template v-else-if="!rec">
      <h2 class="title">找不到条目</h2>
      <p class="muted">没有 id 为 <code>{{ id }}</code> 的条目。</p>
      <p><RouterLink :to="backTo">← 返回</RouterLink></p>
    </template>

    <UnitPanel v-else :unit="rec" :level="level" />
  </div>
</template>

<style scoped>
/* 并排时那栏已经很窄，别再加页面的定宽与上边距 */
.page.embedded {
  max-width: none;
  padding-top: 0;
}
</style>
