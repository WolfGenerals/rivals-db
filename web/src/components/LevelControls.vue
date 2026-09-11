<script setup lang="ts">
/**
 * 顶栏的等级控制器（**全局单例**，`state.ts`）。
 *
 * 与单位详情页那个 `UnitLevelPicker` **用同一套交互**：点开 15×4 网格直选，
 * 外加步进按钮。之前这里是「一个滑块 + 一个数字」，滑块落点不准（60 个等级压进
 * 180px），而且**两处等级控件的操作方式不一样**，学一次不能通用。
 *
 * ⚠️ 这里操作的是**全局序数**（`ordinal`），`UnitLevelPicker` 操作的是单条记录自己的等级
 * —— 状态不同源，但交互一致。
 *
 * 三处按用户要求调整（2025）：
 *   1. **删掉「从各自起始等级算」开关** —— 判定没人用，PC 与手机都不留（连带
 *      `state.ts` 的 `relativeToStart` 与分支一起删除，不留死状态）。
 *   2. **步进按钮按大级/小级分开** —— 原先只有一对 `−`/`+` 改序数，跨大级时
 *      小级会跟着回绕（`1-3` 再 +1 变成 `2-0`），想「只升大级、保住小级」做不到。
 *      现在左边一对改大级（±4 个序数 = `MINOR_MAX + 1`），右边一对改小级。
 *   3. **手机上的 DPS 口径改成下拉** —— 三连分段按钮在窄屏占掉一整行；下拉与等级
 *      并排放得下。桌面仍用分段按钮（一眼看出是三选一，比下拉好）。同一个 `dpsMode`。
 */
import { computed, ref } from "vue";

import { MAX_MAJOR, MINOR_MAX } from "@rivals/core/levels";

import { DPS_MODES, dpsMode, MAX_ORDINAL, ordinal } from "../state.ts";

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
const clampOrdinal = (n: number) => Math.max(0, Math.min(MAX_ORDINAL, n));

/** 改大级：小级保持不变（这正是拆开按钮的目的）。越界时按钮本身已 `disabled`。 */
const stepMajor = (d: number) => (ordinal.value = clampOrdinal(ordinal.value + d * PER_MAJOR));

/**
 * 改小级：**不跨大级**。
 *
 * 直接 `ordinal + 1` 会在 `1-3` 处翻到 `2-0`（上个版本的滑块行为），这与「小级 +1」
 * 的字面意思不符 —— 小级到顶就该停住，想升大级请按大级的 `+`。
 */
function stepMinor(d: number) {
  const next = minor.value + d;
  if (next < 0 || next > MINOR_MAX) return;
  ordinal.value = clampOrdinal(ordinal.value + d);
}
</script>

<template>
  <div class="level-controls">
    <!--
      DPS 统计口径 —— **全局设置**（`state.ts` 的 `dpsMode`），所以放顶栏而不是某个武器区。
      面板页右上角、任何页面都能切，切了所有 DPS 数字一起变。
      下面这一组是**桌面**形态，窄屏由 `.dps-select` 顶替（两者共用 `dpsMode`）。
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

    <!-- 窄屏形态：下拉。与等级并排 -->
    <label class="dps-select">
      <span class="cap">DPS</span>
      <select v-model="dpsMode">
        <option v-for="m in DPS_MODES" :key="m.key" :value="m.key" :title="m.title">{{ m.label }}</option>
      </select>
    </label>

    <div class="picker">
      <span class="cap">等级</span>

      <!--
        排布按用户要求：**按「改哪一级」分组** ——
        `大 [−][+]  1-0  小 [−][+]`（大级一组在左、小级一组在右，`1-0` 在中间）。
        组内是「先减后加」，符合步进器的常规读法。
        ⚠️ 两组按钮字形完全相同，光看是分不出哪组是大级哪组是小级的 ——
        所以每组前面挂一个 `大` / `小` 的小字标签（不是装饰，是必需的区分），
        另外每个按钮都有 `title`。
      -->
      <div class="stepper">
        <span class="unit-cap">大</span>
        <button type="button" class="nav" :disabled="major <= 1" title="降一个大级" @click="stepMajor(-1)">−</button>
        <button type="button" class="nav" :disabled="major >= MAX_MAJOR" title="升一个大级" @click="stepMajor(1)">
          +
        </button>

        <button type="button" class="value" title="点击选择等级" @click="open = !open">
          {{ major }}-{{ minor }}<i class="caret">▾</i>
        </button>

        <span class="unit-cap">小</span>
        <button type="button" class="nav" :disabled="minor <= 0" title="降一个小级" @click="stepMinor(-1)">−</button>
        <button type="button" class="nav" :disabled="minor >= MINOR_MAX" title="升一个小级" @click="stepMinor(1)">+</button>
      </div>

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

/* 窄屏才显示的 DPS 下拉（桌面用上面的分段按钮） */
.dps-select {
  display: none;
  align-items: center;
  gap: 5px;
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

/*
 * `大 [−][+] 1-0 小 [−][+]` 一行。
 * `.value` 两侧留 4px 额外间距，把两个按钮组和等级值分开。
 */
.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
}
/* 「大」/「小」—— 两组按钮字形相同，靠它区分改的是哪一级 */
.unit-cap {
  font-size: 11px;
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
  gap: 3px;
  /* `1-0` 这种 `大级-小级` 写法，大级最多两位（15-3） */
  min-width: 52px;
  margin: 0 4px;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
}
.caret {
  font-style: normal;
  font-size: 8px;
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

/*
 * ── 窄屏（手机）───────────────────────────────────────
 *
 * 实测 390px 下这一段是顶栏撑破的直接原因：
 *   · `.level-controls` 自己是 flex 但**不换行**，内部 5 组控件只会被压缩 ——
 *     于是「游戏/爆发/平均」被压成竖排的两个字、`等级` 拆成上下两行、
 *     最右边的步进器被切在屏幕外（截图见 `out/`）
 *   · 15×4 的等级网格宽约 448px（15 × 26px + 间隙 + 行标签），
 *     绝对不能塞进 390px 的屏幕：它会以 `right: 0` 锚在 `.picker` 上向左溢出，左边被切掉
 *
 * 2025 追加：DPS 由三连分段按钮改成**下拉**（省掉一整行），与等级并排；
 * 步进按钮拆成大级/小级两组后数量翻倍，靠 `flex-wrap` 兜底 —— 极窄屏会折行，不会溢出。
 */
@media (max-width: 820px) {
  .level-controls {
    /* 整行独占 + 允许内部换行，这样每组控件都不会被压变形 */
    flex: 1 1 100%;
    flex-wrap: wrap;
    margin-left: 0;
    gap: 8px 10px;
  }
  /* 控件内的文字一律不折行（折行就会竖排单字） */
  .cap,
  .unit-cap {
    white-space: nowrap;
  }
  /* 桌面形态让位给下拉 */
  .dps-modes {
    display: none;
  }
  .dps-select {
    display: flex;
  }
  .dps-select select {
    /* 顶栏里空间紧：内边距收一点，但仍保留 16px 字号（iOS 聚焦不缩放）与 34px 高 */
    padding: 4px 6px;
  }
  /* 步进按钮：原先 22×22 —— 手指点不中 */
  .nav {
    width: 32px;
    height: 34px;
    font-size: 16px;
  }
  .value {
    height: 34px;
    min-width: 52px;
    font-size: 14px;
  }

  /*
   * 等级网格改成**贴底的浮层**，并让格子变大、超宽时自己横滚。
   * 原先 `position: absolute; right: 0` 锚在 `.picker` 上：窄屏下会向左溢出屏幕，
   * 15 列里左边几列永远点不到。格子 26×16px 也远低于能稳妥点中的尺寸。
   */
  .grid {
    position: fixed;
    top: auto;
    left: 8px;
    right: 8px;
    bottom: 8px;
    max-height: 62dvh;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .cell {
    width: 34px;
    height: 30px;
    /* 全局窄屏规则里有 `button { min-height: 34px }`，网格格子要显式放开 */
    min-height: 0;
    font-size: 11px;
  }
  .col {
    width: 34px;
  }
}
</style>
