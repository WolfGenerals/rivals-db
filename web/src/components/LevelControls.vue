<script setup lang="ts">
/**
 * 顶栏的等级控制器（**全局单例**，`state.ts`）。
 *
 * 与单位详情页那个 `UnitLevelPicker` **用同一套交互**：一个数值按钮 + 点开 15×4 网格直选，
 * 外加 `−`/`+` 步进。之前这里是「一个滑块 + 一个数字」，滑块落点不准（60 个等级压进
 * 180px），而且**两处等级控件的操作方式不一样**，学一次不能通用。
 *
 * ⚠️ 这里操作的是**全局序数**（`ordinal`），`UnitLevelPicker` 操作的是单条记录自己的等级
 * —— 状态不同源，但交互一致。
 */
import { computed, ref } from "vue";

import { MAX_MAJOR, MINOR_MAX } from "@rivals/core/levels";

import { DPS_MODES, dpsMode, levelLabel, MAX_ORDINAL, ordinal, relativeToStart } from "../state.ts";

const MAJORS = Array.from({ length: MAX_MAJOR }, (_, i) => i + 1);
const MINORS = Array.from({ length: MINOR_MAX + 1 }, (_, i) => MINOR_MAX - i);

const open = ref(false);

/** 序数 → 大级-小级（每大级 `MINOR_MAX + 1` 个小级） */
const PER_MAJOR = MINOR_MAX + 1;
const major = computed(() => Math.floor(ordinal.value / PER_MAJOR) + 1);
const minor = computed(() => ordinal.value % PER_MAJOR);

function pick(m: number, mi: number) {
  ordinal.value = (m - 1) * PER_MAJOR + mi;
  open.value = false;
}
const step = (d: number) =>
  (ordinal.value = Math.max(0, Math.min(MAX_ORDINAL, ordinal.value + d)));
</script>

<template>
  <div class="level-controls">
    <!--
      DPS 统计口径 —— **全局设置**（`state.ts` 的 `dpsMode`），所以放顶栏而不是某个武器区。
      面板页右上角、任何页面都能切，切了所有 DPS 数字一起变。
    -->
    <div class="dps-modes">
      <span class="cap">DPS</span>
      <button
        v-for="m in DPS_MODES"
        :key="m.key"
        type="button"
        :class="{ on: dpsMode === m.key }"
        :title="m.title"
        @click="dpsMode = m.key"
      >
        {{ m.label }}
      </button>
    </div>

    <label class="toggle" title="勾选后，等级从该条目自己的起始等级算起（普通 1-0 / 稀有 3-0 / 史诗 5-0）">
      <input v-model="relativeToStart" type="checkbox" />
      <span>从各自起始等级算</span>
    </label>

    <div class="picker">
      <span class="cap">等级</span>

      <button type="button" class="nav" :disabled="ordinal <= 0" title="降一级" @click="step(-1)">−</button>

      <button type="button" class="value" title="点击选择等级" @click="open = !open">
        <span>{{ major }}-{{ minor }}</span>
        <i class="caret">▾</i>
      </button>

      <button type="button" class="nav" :disabled="ordinal >= MAX_ORDINAL" title="升一级" @click="step(1)">
        +
      </button>

      <!-- 与详情页同一张 15×4 网格 -->
      <template v-if="open">
        <div class="backdrop" @click="open = false" />
        <div class="grid">
          <div class="grid-head">
            <span class="corner" />
            <span v-for="m in MAJORS" :key="m" class="col">{{ m }}</span>
          </div>
          <div v-for="mi in MINORS" :key="mi" class="grid-row">
            <span class="row-cap">{{ mi }}</span>
            <button
              v-for="m in MAJORS"
              :key="m"
              type="button"
              class="cell"
              :class="{ on: m === major && mi === minor }"
              @click="pick(m, mi)"
            >
              {{ m }}-{{ mi }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <span class="label">{{ levelLabel }}</span>
  </div>
</template>

<style scoped>
/* 靠到顶栏最右（顶栏是 flex，`margin-left:auto` 把它推到底） */
.level-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

/* DPS 口径：分段按钮 */
.dps-modes {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dps-modes button {
  padding: 2px 9px;
  font-size: 11px;
}
.dps-modes button:first-of-type {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.dps-modes button:last-of-type {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.dps-modes button + button {
  border-left: none;
}
.dps-modes button.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: #cfe4ff;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--dim);
  cursor: pointer;
  white-space: nowrap;
}
.toggle input {
  margin: 0;
  width: 13px;
  height: 13px;
}

.picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}
.cap {
  font-size: 12px;
  color: var(--dim);
}

.nav,
.value {
  height: 22px;
  padding: 0 6px;
  font-size: 12px;
}
.nav {
  width: 22px;
  padding: 0;
  line-height: 1;
  font-size: 14px;
}
.value {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 52px;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
.caret {
  font-style: normal;
  font-size: 8px;
  color: var(--dim);
}

.label {
  min-width: 5.5em;
  font-size: 11px;
  color: var(--dim);
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
}
.grid {
  position: absolute;
  top: 26px;
  right: 0;
  z-index: 31;
  padding: 6px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px #000c;
}
.grid-head,
.grid-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.grid-head {
  margin-bottom: 2px;
}
.corner,
.row-cap {
  width: 16px;
  font-size: 9px;
  color: var(--dim);
  text-align: center;
}
.col {
  width: 26px;
  font-size: 9px;
  color: var(--dim);
  text-align: center;
}
.cell {
  width: 26px;
  height: 16px;
  margin: 1px 0;
  padding: 0;
  font-size: 9px;
  color: var(--dim);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
}
.cell:hover {
  background: #2e3a4d;
  color: #fff;
}
.cell.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: #cfe4ff;
}
</style>
