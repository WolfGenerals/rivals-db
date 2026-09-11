<script setup lang="ts">
/**
 * 开火时序条 —— 一把武器（含小队各成员）什么时候造成伤害。
 *
 * **为什么要有它**：时序是一条时间线，用文字描述必然产生歧义 ——
 * "前摇 3s + 每 40ms 一发"读不出前摇是在周期**内**还是**外**；
 * 画成条子，段与段的**位置关系**自己就说明了。
 *
 * ## 模型：直接把 `derived.attack.tracks` 画出来
 *
 * 旧版只吃 `{cycle, chargeUp}` 两个数，**表达不了 `sequence`（多段接替）和装填**。
 * 现在按轨道逐条画：
 *
 *   · `sequence`（万钧巨炮 3 段、蛇怪 2 段）—— 每段按 `after_ms` 摆在时间轴上
 *   · 装填型（虎鲸轰炸机 6 发 + 12s 装填）—— 连打后接一段醒目的装填
 *   · `chargeInCycle` 为真（掠食者）—— 前摇画在周期**末尾**，段总长仍等于周期
 *   · `chargeInCycle` 为假（音波坦克 3s 蓄力）—— 前摇画在连打**之前**，时间相加
 *
 * 每名队员一条：成员 `i` 的整条轴**整体后移 `i × separationMs`** —— 小队是脉冲式输出
 * 还是相位漂移，只有把所有人的条画出来才看得见（findings I166）。
 */
import { computed } from "vue";

import type { Track } from "@rivals/core/derive";

const props = defineProps<{
  /** 该武器的全部轨道（`sequence` 下每把武器各一条，`sequence` 本身是多条） */
  tracks: Track[];
  waveSize: number;
  separationMs: number;
}>();

interface Seg {
  kind: "charge" | "fire" | "gap" | "reload";
  /** 左边界（毫秒，相对该队员的时间轴起点） */
  at: number;
  /** 宽度（毫秒） */
  ms: number;
  /** 段上的刻度（伤害落点） */
  ticks?: number[];
  title: string;
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

/** 一名队员在一个周期内的段 */
const baseSegs = computed<Seg[]>(() => {
  const out: Seg[] = [];
  for (const t of props.tracks) {
    const tm = t.timing;
    if (tm.kind === "一次") {
      out.push({
        kind: "charge",
        at: 0,
        ms: tm.charge_ms,
        title: `蓄力 ${fmt(tm.charge_ms)} 后一次性`,
      });
      continue;
    }

    const start = t.after_ms ?? 0;
    const charge = t.charge_ms ?? 0;

    if (tm.kind === "装填") {
      const iv = tm.interval_ms ?? 0;
      const fireMs = tm.clip * iv;
      // `chargeInCycle` 为假时前摇在连打之前，为真时并入周期末尾（这里按"之前"画更直观）
      const fireAt = start + charge;
      const ticks = Array.from({ length: tm.clip }, (_, i) => fireAt + i * iv);
      out.push({
        kind: "fire",
        at: fireAt,
        ms: fireMs || tm.reload_ms * 0.1,
        ticks,
        title: `连打 ${tm.clip} 发（每 ${fmt(iv)} 一发，共 ${fmt(fireMs)}）`,
      });
      out.push({
        kind: "reload",
        at: fireAt + fireMs,
        ms: tm.reload_ms,
        title: `装填 ${fmt(tm.reload_ms)}`,
      });
      continue;
    }

    // 单发
    const iv = tm.interval_ms ?? tm.cycle_ms;
    /*
     * ⚠️ **`hits === 1` 也要画出来。**
     *
     * 单发武器的"打一下"是瞬时的（宽度理应 0），但宽度 0 就等于**什么都没画** ——
     * 弹弓、狼獾这类绝大多数常规武器整条会变成空的（用户报"好多单位的条搞坏了"）。
     * 给一个可见的最小宽度，真正的"打在哪一刻"靠金色刻度线表达。
     */
    const fireMs = tm.hits > 1 ? tm.hits * iv : Math.max(1, tm.cycle_ms * 0.04);
    const ticks = Array.from(
      { length: Math.max(1, tm.hits) },
      (_, i) => start + charge + (tm.hits > 1 ? i * iv : 0),
    );
    out.push({
      kind: "fire",
      at: start + charge,
      ms: fireMs,
      ticks,
      title:
        tm.hits > 1
          ? `连打 ${tm.hits} 发（每 ${fmt(iv)} 一发，共 ${fmt(tm.hits * iv)}）`
          : `开火（周期 ${fmt(tm.cycle_ms)}）`,
    });
    if (t.chargeInCycle && charge > 0) {
      // 周期**末尾**的前摇：画在末尾，段总长仍等于周期
      out.push({ kind: "charge", at: start, ms: charge, title: `周期末尾的前摇 ${fmt(charge)}` });
    } else if (!t.chargeInCycle && charge > 0) {
      out.push({ kind: "charge", at: start, ms: charge, title: `前摇 ${fmt(charge)}（在连打之前）` });
    }
  }
  return out;
});

/**
 * 一名队员的时间轴总长（毫秒）。
 *
 * ⚠️ **必须把每条的 `cycle_ms` 也算进来** —— 只取「段终点」是错的：单发武器的
 * 段只有几毫秒（`hits === 1` 给的最小宽度），整条跨度就塌成几毫秒，于是那一点点
 * 伤害段**铺满全宽**，看起来像"一直在打"（弹弓就是这样被画坏的）。
 * 周期才是这条轴的真正长度。
 */
const cycleMs = computed(() => {
  const spans = baseSegs.value.map((s) => s.at + s.ms);
  for (const t of props.tracks) {
    const tm = t.timing;
    if (tm.kind === "单发") spans.push(tm.cycle_ms);
    else if (tm.kind === "装填") spans.push(tm.clip * (tm.interval_ms ?? 0) + tm.reload_ms);
    else spans.push(tm.charge_ms);
  }
  return Math.max(1, ...spans);
});

/** 横轴跨度：最后一名队员的起点 + 一个周期 */
const spanMs = computed(() => {
  const shift = Math.max(0, props.waveSize - 1) * props.separationMs;
  return Math.max(cycleMs.value, shift + cycleMs.value) || 1;
});

const pct = (ms: number) => `${(ms / spanMs.value) * 100}%`;

/** 每个队员一条 */
const members = computed(() => Array.from({ length: Math.max(1, props.waveSize) }, (_, i) => i));

/** 该队员的段（整体后移 `i × separationMs`） */
function segsOf(i: number): Array<Seg & { left: string; width: string; tickPct: string[] }> {
  const shift = i * props.separationMs;
  return baseSegs.value
    .map((s) => ({
      ...s,
      left: pct(s.at + shift),
      width: pct(s.ms),
      tickPct: (s.ticks ?? []).map((x) => pct(x + shift)),
    }))
    .filter((s) => s.ms > 0);
}
</script>

<template>
  <div v-if="tracks.length" class="tl">
    <div v-for="i in members" :key="i" class="row">
      <span class="who">{{ waveSize > 1 ? `队员 ${i + 1}` : "" }}</span>
      <div class="track">
        <template v-for="(s, k) in segsOf(i)" :key="k">
          <span
            class="seg"
            :class="s.kind"
            :style="{ left: s.left, width: s.width }"
            :title="s.title"
          />
          <span
            v-for="(tp, m) in s.tickPct"
            :key="`t${m}`"
            class="tick"
            :style="{ left: tp }"
            :title="s.title"
          />
        </template>
      </div>
    </div>

    <p class="legend">
      <span><i class="sw charge" />前摇</span>
      <span><i class="sw fire" />伤害</span>
      <span><i class="sw reload" />装填</span>
      <span class="dim">横轴 = {{ fmt(spanMs) }}<template v-if="waveSize > 1">（{{ waveSize }} 人 × 错开 {{ separationMs }}ms）</template></span>
    </p>
  </div>
</template>

<style scoped>
.tl {
  margin: 6px 0 8px;
  padding: 6px 8px;
  background: #171b23;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 14px;
}
.who {
  width: 44px;
  flex: none;
  font-size: 10px;
  color: var(--dim, #9aa5b8);
}
.track {
  position: relative;
  flex: 1;
  height: 8px;
  background: #10131a;
  border-radius: 4px;
  overflow: hidden;
}
.seg {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 3px;
}
.seg.fire {
  background: linear-gradient(#4da8ff, #2f7fd0);
}
.seg.charge {
  background: repeating-linear-gradient(45deg, #6b5a2a, #6b5a2a 4px, #8a7434 4px, #8a7434 8px);
}
.seg.reload {
  background: repeating-linear-gradient(45deg, #3a2a2a, #3a2a2a 4px, #5a3a3a 4px, #5a3a3a 8px);
}
.seg.gap {
  background: #232a36;
}
/* 伤害落点 */
.tick {
  position: absolute;
  top: -2px;
  width: 0;
  height: 12px;
  border-left: 1px solid #ffcc55;
}

.legend {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0 0;
  font-size: 10px;
  color: var(--dim, #9aa5b8);
}
.legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sw {
  width: 10px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}
.sw.fire {
  background: #4da8ff;
}
.sw.charge {
  background: #8a7434;
}
.sw.reload {
  background: #5a3a3a;
}
.dim {
  margin-left: auto;
}
</style>
