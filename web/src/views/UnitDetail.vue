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

const props = defineProps<{ id: string }>();

const data = useData();
const rec = ref<DatasetEntry | null>(null);
const loading = ref(true);

watch(
  () => props.id,
  async (id) => {
    loading.value = true;
    rec.value = await loadRecord(id);
    loading.value = false;
  },
  { immediate: true },
);

const summary = computed(() => (data.value ? findSummary(data.value, props.id) : undefined));
const isCommander = computed(() => props.id.startsWith("cmdr_"));
const level = computed(() => displayLevel(summary.value));
const backTo = computed(() => (isCommander.value ? "/commander" : "/"));
const backLabel = computed(() => (isCommander.value ? "指挥官" : "单位"));
const title = computed(() => rec.value?.name_zh || rec.value?.name_en || props.id);
</script>

<template>
  <div class="page">
    <p class="crumb">
      <RouterLink :to="backTo">{{ backLabel }}</RouterLink> / {{ title }}
    </p>

    <p v-if="loading" class="muted">正在加载…</p>

    <template v-else-if="!rec">
      <h2 class="title">找不到条目</h2>
      <p class="muted">没有 id 为 <code>{{ id }}</code> 的条目。它可能是只有索引、没有详情文件的变体。</p>
      <p><RouterLink :to="backTo">← 返回</RouterLink></p>
    </template>

    <UnitPanel v-else :unit="rec" :level="level" />
  </div>
</template>
