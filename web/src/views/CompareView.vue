<script setup lang="ts">
/**
 * 左右分栏对比 —— 两个单位并排，共用一个等级（顶栏控制）。
 *
 * **为什么自带走查**：对比的选择状态属于本页，不该散到列表页去。两个 `<select>`
 * 直接放在面板顶上，从任何入口进来（含分享链接 `/compare/a/b`）都能立刻换。
 *
 * ⚠️ 两侧都是完整的 `UnitPanel`（含武器卡、时序、逐目标伤害），所以每栏**必须有
 * `min-width: 0`** —— 不然 flex 子项不肯收缩，内容会撑破分栏。
 */
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

import type { DatasetEntry } from "@rivals/core/derive";

import UnitPanel from "../components/UnitPanel.vue";
import { displayLevel } from "../state.ts";
import { useData } from "../useData.ts";

const route = useRoute();
const router = useRouter();
const data = useData();

/** 可选单位：**排除指挥官**（无武器、不是战场单位，对比没有意义） */
const choices = computed<DatasetEntry[]>(() => data.value?.dataset.units ?? []);
const byId = computed(() => new Map(choices.value.map((e) => [e.id, e])));

const leftId = computed(() => String(route.params.left ?? ""));
const rightId = computed(() => String(route.params.right ?? ""));

const left = computed(() => byId.value.get(leftId.value));
const right = computed(() => byId.value.get(rightId.value));

/**
 * 两侧共用**顶栏的全局等级**（`displayLevel(undefined)` 就是不按稀有度偏移的那个）。
 * `UnitPanel` 仍可各自勾「独立」在栏内单独调。
 */
const sideLevel = computed(() => displayLevel(undefined));

function go(side: "left" | "right", id: string) {
  const l = side === "left" ? id : leftId.value;
  const r = side === "right" ? id : rightId.value;
  if (l && r) router.push(`/compare/${encodeURIComponent(l)}/${encodeURIComponent(r)}`);
  else if (l) router.push(`/compare/${encodeURIComponent(l)}`);
  else router.push("/compare");
}

function label(e: DatasetEntry): string {
  return e.name_zh ? `${e.name_zh}（${e.id.replace(/^unit_/, "")}）` : e.id;
}
</script>

<template>
  <div class="compare">
    <div class="bar">
      <h2>对比</h2>
      <span class="muted">等级由顶栏统一控制，左右同步</span>
    </div>

    <div class="cols">
      <!-- 左 -->
      <section class="col">
        <select :value="leftId" @change="go('left', ($event.target as HTMLSelectElement).value)">
          <option value="">— 选左边 —</option>
          <option v-for="e in choices" :key="e.id" :value="e.id">{{ label(e) }}</option>
        </select>
        <UnitPanel v-if="left" :unit="left" :level="sideLevel" />
        <p v-else class="empty">从上面选一个单位</p>
      </section>

      <!-- 右 -->
      <section class="col">
        <select :value="rightId" @change="go('right', ($event.target as HTMLSelectElement).value)">
          <option value="">— 选右边 —</option>
          <option v-for="e in choices" :key="e.id" :value="e.id">{{ label(e) }}</option>
        </select>
        <UnitPanel v-if="right" :unit="right" :level="sideLevel" />
        <p v-else class="empty">从上面选一个单位</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.compare {
  padding-top: 12px;
}
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

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
/* 窄屏（<1100px）堆成一列 —— 两栏挤在一起比单栏还难读 */
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: 1fr;
  }
}

/* ⚠️ min-width:0 是关键：不加的话 grid 子项不肯收缩，长内容会撑破分栏 */
.col {
  min-width: 0;
}
.col select {
  width: 100%;
  margin-bottom: 8px;
  padding: 5px 8px;
  font-size: 13px;
  color: #e6ecf5;
  background: #1d2430;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
}
.empty {
  padding: 24px;
  text-align: center;
  color: #6b7a99;
  border: 1px dashed var(--line, #2b3038);
  border-radius: 8px;
}
.muted {
  color: #7f8aa6;
  font-size: 12px;
}
</style>
