<script setup lang="ts">
/**
 * 应用外壳：数据加载 + 顶栏（导航 / 等级控制）+ 路由出口。
 *
 * 列表页与详情页是**真正分开的路由**（hash 模式），刷新与分享链接都能落到同一处。
 */
import { computed, onMounted, provide, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";

import LevelControls from "./components/LevelControls.vue";
import { loadDataset, type LoadedData } from "./data.ts";
import { DATA_KEY } from "./useData.ts";

const data = ref<LoadedData | null>(null);
const error = ref<string | null>(null);
const route = useRoute();

/**
 * 顶栏的实际高度写进 `--topbar-h`，供 `thead` 的 sticky 偏移使用。
 *
 * 这个数字**不能写死**：桌面顶栏是一行（实测 51px），手机窄屏会折成两行（实测 105px）。
 * 原先 `style.css` 里写死 `top: 51px`，手机上表头就会钻到顶栏底下。
 * 用 ResizeObserver 而不是只在挂载时量一次 —— 窗口缩放、字体加载完、导航栏换行动都会变。
 */
const topbar = ref<HTMLElement | null>(null);

onMounted(() => {
  const el = topbar.value;
  if (!el) return;
  const apply = () =>
    document.documentElement.style.setProperty(
      "--topbar-h",
      `${Math.round(el.getBoundingClientRect().height)}px`,
    );
  apply();
  new ResizeObserver(apply).observe(el);
});

onMounted(async () => {
  try {
    data.value = await loadDataset();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

// 子组件通过 useData() 注入拿索引，省得逐层传 prop
provide(DATA_KEY, data);

const unitCount = computed(() => data.value?.dataset.unit_count ?? 0);
const activeNav = computed(() => {
  const n = String(route.name ?? "");
  if (n === "compare") return "compare";
  if (n === "table") return "table";
  return "units";
});
</script>

<template>
  <header ref="topbar" class="topbar">
    <RouterLink class="brand" to="/">Rivals 图鉴</RouterLink>

    <nav>
      <RouterLink to="/" :class="{ active: activeNav === 'units' }">
        单位
      </RouterLink>
      <RouterLink to="/table" :class="{ active: activeNav === 'table' }">表格</RouterLink>
      <RouterLink to="/compare" :class="{ active: activeNav === 'compare' }">对比</RouterLink>
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
