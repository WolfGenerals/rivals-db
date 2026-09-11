<script setup lang="ts">
/**
 * 应用外壳：数据加载 + 顶栏（导航 / 等级控制）+ 路由出口。
 *
 * 列表页与详情页是**真正分开的路由**（hash 模式），刷新与分享链接都能落到同一处。
 */
import { computed, onMounted, provide, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

import LevelControls from "./components/LevelControls.vue";
import { loadIndex, type LoadedData } from "./data.ts";
import { DATA_KEY } from "./useData.ts";

const data = ref<LoadedData | null>(null);
const error = ref<string | null>(null);
const route = useRoute();

onMounted(async () => {
  try {
    data.value = await loadIndex();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

// 子组件通过 useData() 注入拿索引，省得逐层传 prop
provide(DATA_KEY, data);

const unitCount = computed(() => data.value?.unitIndex.unit_count ?? 0);
const commanderCount = computed(() => data.value?.commanderIndex?.commander_count ?? 0);
const activeNav = computed(() => (String(route.name ?? "").startsWith("commander") ? "commanders" : "units"));
</script>

<template>
  <header class="topbar">
    <RouterLink class="brand" to="/">Rivals 图鉴</RouterLink>

    <nav>
      <RouterLink to="/" :class="{ active: activeNav === 'units' }">
        单位<span v-if="unitCount" class="count">{{ unitCount }}</span>
      </RouterLink>
      <RouterLink v-if="commanderCount" to="/commander" :class="{ active: activeNav === 'commanders' }">
        指挥官<span class="count">{{ commanderCount }}</span>
      </RouterLink>
    </nav>

    <LevelControls />
  </header>

  <main>
    <p v-if="error" class="warn">
      加载数据失败：{{ error }}<br />
      <span class="muted">
        请先运行 <code>pnpm extract</code> 生成 data/，再执行 <code>pnpm --filter @rivals/web sync-data</code>。
      </span>
    </p>
    <p v-else-if="!data" class="muted" style="margin-top: 20px">正在加载数据…</p>
    <RouterView v-else />
  </main>
</template>
