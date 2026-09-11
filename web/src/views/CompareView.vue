<script setup lang="ts">
/**
 * 左右分栏对比。
 *
 * **两个阶段，同一个路由**：
 *   `/compare`      —— **卡片墙选单位**（复用 `Arsenal` 的卡片墙 + 筛选/分组），
 *                      点第一张选左边、点第二张选右边
 *   `/compare/a/b`  —— **左右并排两个 `UnitDetail`**，与单独看某个单位的页面完全一致
 *
 * 为什么不自己做一套选择界面：卡片墙已经有搜索、阵营/稀有度筛选、类型分组、排序 ——
 * 再造一套只会更差。
 */
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import Arsenal from "./Arsenal.vue";
import UnitDetail from "./UnitDetail.vue";
import { useData } from "../useData.ts";

const route = useRoute();
const router = useRouter();
const data = useData();

/**
 * 第一阶段的选择**先攒在本地，两个都选了才导航**。
 *
 * ⚠️ 每选一个就 `router.push` 的话，每次都会触发导航 → 页面滚回顶部，
 * 在长卡片墙里点完第一个就得重新往下翻（用户报的 bug）。
 */
const localLeft = ref("");
const localRight = ref("");

const routeLeft = computed(() => String(route.params.left ?? ""));
const routeRight = computed(() => String(route.params.right ?? ""))
const left = computed(() => routeLeft.value || localLeft.value);
const right = computed(() => routeRight.value || localRight.value);
const picking = computed(() => !left.value || !right.value);

/** 已选的（用于在卡片墙上画高亮） */
const picked = computed(() => [left.value, right.value].filter(Boolean));

function onPick(id: string) {
  if (!left.value) {
    localLeft.value = id;
    return;
  }
  if (!right.value && id !== left.value) {
    localRight.value = id;
    router.push(`/compare/${encodeURIComponent(left.value)}/${encodeURIComponent(id)}`);
  }
}

const reset = () => {
  localLeft.value = "";
  localRight.value = "";
  router.push("/compare");
};
const swap = () =>
  router.push(`/compare/${encodeURIComponent(right.value)}/${encodeURIComponent(left.value)}`);
const byId = computed(() => new Map((data.value?.dataset.units ?? []).map((e) => [e.id, e])));
const nameOf = (id: string) => byId.value.get(id)?.name_zh ?? id.replace(/^unit_/, "");
</script>

<template>
  <div class="compare">
    <!-- 阶段二：两个完整详情页并排 -->
    <template v-if="!picking">
      <div class="bar">
        <h2>对比</h2>
        <span class="muted">{{ nameOf(left) }} ↔ {{ nameOf(right) }}</span>
        <button type="button" @click="swap">交换</button>
        <button type="button" @click="reset">重选</button>
      </div>
      <div class="cols">
        <!--
          ⚠️ `min-width: 0` 不能省 —— grid 子项默认不肯收缩到内容以下，
          少了这行长内容（武器时序那句长文本）会撑破分栏。
        -->
        <section class="col"><UnitDetail :id="left" embedded /></section>
        <section class="col"><UnitDetail :id="right" embedded /></section>
      </div>
    </template>

    <!-- 阶段一：卡片墙选单位 -->
    <template v-else>
      <div class="bar">
        <h2>选两个单位对比</h2>
        <span class="muted">
          已选 {{ picked.length }}/2
          <template v-if="left">　左边：{{ nameOf(left) }}</template>
        </span>
        <button v-if="picked.length" type="button" @click="reset">清空</button>
      </div>
      <Arsenal pickable :picked="picked" @pick="onPick" />
    </template>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 10px;
}
.bar h2 {
  margin: 0;
  font-size: 16px;
}
.bar button {
  padding: 2px 10px;
  font-size: 12px;
  color: #b9c4dc;
  background: #1d2430;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
  cursor: pointer;
}
.bar button:hover {
  background: #26303f;
  color: #fff;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
}
/* 窄屏（<1200px）堆成一列 —— 两个详情页挤在一起比单栏还难读 */
@media (max-width: 1200px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.col {
  min-width: 0;
}
.muted {
  color: #7f8aa6;
  font-size: 12px;
}
</style>
