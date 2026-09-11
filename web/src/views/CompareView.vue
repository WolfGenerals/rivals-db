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
  /*
   * 选完把**该栏滚回顶部**。
   *
   * 卡片墙很高（限高 62vh + 内部滚动），点卡片时墙内部可能滚了很远；
   * 换成详情后那点滚动量就没了，视觉上像"跳回卡片墙的某个位置"。
   */
  requestAnimationFrame(() => {
    const el = document.querySelector(side === "left" ? ".col-left" : ".col-right");
    el?.scrollIntoView({ block: "start" });
  });
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
      <section class="col col-left">
        <div class="col-head">
          <span>左</span>
          <b v-if="left">{{ left.replace(/^unit_/, "") }}</b>
          <button v-if="left && !pickingLeft" type="button" @click="pickingLeft = true">换</button>
        </div>
        <div v-if="pickingLeft" key="l-wall" class="wall"><Arsenal pickable :picked="picked" @pick="pick('left', $event)" /></div>
        <UnitDetail v-else-if="left" key="l-detail" :id="left" embedded />
      </section>

      <!-- 右 -->
      <section class="col col-right">
        <div class="col-head">
          <span>右</span>
          <b v-if="right">{{ right.replace(/^unit_/, "") }}</b>
          <button v-if="right && !pickingRight" type="button" @click="pickingRight = true">换</button>
        </div>
        <div v-if="pickingRight" key="r-wall" class="wall"><Arsenal pickable :picked="picked" @pick="pick('right', $event)" /></div>
        <UnitDetail v-else-if="right" key="r-detail" :id="right" embedded />
      </section>
    </div>
  </div>
</template>

<style scoped>
.compare {
  padding-top: 12px;
  /*
   * **占满视口剩余高度**，让两栏的卡片墙一直撑到底、由墙内部滚动。
   *
   * 数值来源：顶栏 `padding: 12px` ×2 + 内容 ≈ 49px，`main` 底部内边距 60px，
   * 再加本组件 `padding-top: 12px`。`dvh` 而非 `vh` —— 移动端地址栏收起时 `vh` 会偏大。
   * `min-height` 兜底：窗口太矮时不要让墙塌成一条。
   */
  height: calc(100dvh - 121px);
  min-height: 460px;
  display: flex;
  flex-direction: column;
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
  /* 吃掉 .compare 里标题行剩下的高度；`min-height:0` 让子项的 overflow 生效 */
  flex: 1;
  min-height: 0;
  align-items: stretch;
}
/* 窄屏（<1200px）堆成一列 */
@media (max-width: 1200px) {
  .cols {
    grid-template-columns: 1fr;
  }
  /*
   * ⚠️ **堆成一列时必须释放固定高度** ——
   * 两栏上下叠起来必然超过一屏，再锁 `calc(100dvh - 121px)` 会把两栏各压成半屏、
   * 底部那栏被裁掉（用户报的「不适配窄页面」）。
   * 改为让页面正常滚动，每栏的墙各自限高。
   */
  .compare {
    height: auto;
    min-height: 0;
  }
  .wall {
    flex: none;
    max-height: 55vh;
  }
}
/*
 * 卡片墙**限高 + 内部滚动**。不限高的话两栏各 86 张卡 → 页面极高，
 * 选完之后一栏塌成小详情，滚动位置就错位了（用户报的 bug）。
 */
.wall {
  /* 撑满该栏剩余高度（不再用 max-height:62vh —— 那会留出一截空白） */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* ⚠️ min-width:0 不能省 —— grid 子项默认不肯收缩，长内容会撑破分栏 */
.col {
  min-width: 0;
  /* 纵向 flex：头部固定、墙撑满 */
  display: flex;
  flex-direction: column;
  min-height: 0;
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
