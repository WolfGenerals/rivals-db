<script setup lang="ts">
/**
 * 左右分栏对比。
 *
 * **每边一个卡片墙**（复用 `Arsenal`，搜索/筛选/类型分组都在），各自选自己那一边：
 *   · 未选 → 该栏显示卡片墙，点任意一张即选中
 *   · 已选 → 该栏显示该单位的完整详情（`UnitDetail`），点「换」回到卡片墙
 *
 * ⚠️ **选择只存本地 ref，不写进路由、不导航** —— 每次点卡片都 `router.push`
 * 会触发导航回顶，在长卡片墙里点完一张就得重新往下翻（用户报过这个 bug）。
 */
import { computed, ref } from "vue";

import Arsenal from "./Arsenal.vue";
import UnitDetail from "./UnitDetail.vue";

const left = ref("");
const right = ref("");

/** 每栏独立的「正在选」状态 —— 选完切详情，点「换」切回墙 */
const pickingLeft = ref(true);
const pickingRight = ref(true);

const picked = computed(() => [left.value, right.value].filter(Boolean));

/** 卡片墙是共用的：哪一栏在选，`pick` 就落到哪一栏 */
function pick(side: "left" | "right", id: string) {
  if (side === "left") {
    left.value = id;
    pickingLeft.value = false;
  } else {
    right.value = id;
    pickingRight.value = false;
  }
}
</script>

<template>
  <div class="compare">
    <p class="bar">
      <b>对比</b>
      <span class="muted">左右各选一个单位；等级由顶栏统一控制</span>
      <button v-if="picked.length" type="button" @click="((left = ''), (right = ''), (pickingLeft = true), (pickingRight = true))">
        清空
      </button>
    </p>

    <div class="cols">
      <!-- 左 -->
      <section class="col">
        <div class="col-head">
          <span>左</span>
          <b v-if="left">{{ left.replace(/^unit_/, "") }}</b>
          <button v-if="left && !pickingLeft" type="button" @click="pickingLeft = true">换</button>
        </div>
        <Arsenal v-if="pickingLeft" pickable :picked="picked" @pick="pick('left', $event)" />
        <UnitDetail v-else-if="left" :id="left" embedded />
      </section>

      <!-- 右 -->
      <section class="col">
        <div class="col-head">
          <span>右</span>
          <b v-if="right">{{ right.replace(/^unit_/, "") }}</b>
          <button v-if="right && !pickingRight" type="button" @click="pickingRight = true">换</button>
        </div>
        <Arsenal v-if="pickingRight" pickable :picked="picked" @pick="pick('right', $event)" />
        <UnitDetail v-else-if="right" :id="right" embedded />
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
  margin: 0 0 10px;
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
/* 窄屏（<1200px）堆成一列 */
@media (max-width: 1200px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
/* ⚠️ min-width:0 不能省 —— grid 子项默认不肯收缩，长内容会撑破分栏 */
.col {
  min-width: 0;
  border: 1px solid var(--line, #2b3038);
  border-radius: 8px;
  padding: 8px;
}
.col-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #7f8aa6;
}
.col-head b {
  color: #cfd8e6;
}
.col-head button {
  margin-left: auto;
  padding: 1px 8px;
  font-size: 11px;
  color: #b9c4dc;
  background: #1d2430;
  border: 1px solid var(--line, #2b3038);
  border-radius: 5px;
  cursor: pointer;
}
.muted {
  color: #7f8aa6;
  font-size: 12px;
}
</style>
