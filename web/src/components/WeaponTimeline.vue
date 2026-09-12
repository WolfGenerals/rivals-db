<script setup lang="ts">
/**
 * 开火时序条 —— 一把武器（含小队各成员）什么时候造成伤害。
 *
 * **为什么要有它**：时序是一条时间线，用文字描述必然产生歧义 ——
 * "前摇 3s + 每 0.04s 一发"读不出前摇是在周期**内**还是**外**；
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

import { fmtSec } from "../format.ts";

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

// 时间一律用秒 —— 格式化只有一处实现（`web/src/format.ts`，用户要求统一单位）


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
        title: `蓄力 ${fmtSec(tm.charge_ms)} 后一次性`,
      });
      continue;
    }

    const start = t.after_ms ?? 0;
    const charge = t.charge_ms ?? 0;

    if (tm.kind === "装填") {
      const iv = tm.interval_ms ?? 0;
      const fireMs = tm.clip * iv;
      /*
       * ⚠️ **装填窗口从首发就开始**（面板公式 `clip ÷ reloadTimeMs` 即整轮周期，findings I201），
       * 所以这一轮的总长就是 `reload_ms`：连打段之后画的是**剩余**的装填段，
       * 而不是「连打 + 完整装填」叠起来（那会把周期画长 3~15%）。
       */
      const reloadRest = Math.max(0, tm.reload_ms - fireMs);
      // `chargeInCycle` 为假时前摇在连打之前，为真时并入周期末尾（这里按"之前"画更直观）
      const fireAt = start + charge;
      const ticks = Array.from({ length: tm.clip }, (_, i) => fireAt + i * iv);
      out.push({
        kind: "fire",
        at: fireAt,
        ms: fireMs,
        ticks,
        title: `连打 ${tm.clip} 发（每 ${fmtSec(iv)} 一发，共 ${fmtSec(fireMs)}）`,
      });
      out.push({
        kind: "reload",
        at: fireAt + fireMs,
        ms: reloadRest,
        title: `剩余装填 ${fmtSec(reloadRest)}（共 ${fmtSec(tm.reload_ms)}）`,
      });
      continue;
    }

    // 单发
    const iv = tm.interval_ms ?? tm.cycle_ms;
    /*
     * **同轮各发同时出膛**（`interval_ms === 0`）—— 两种情况都归到这里：
     *   · 数据写明齐射的（烈焰之手 `MuzzleStrategy.All`，两枪口同时）
     *   · 数据**没写**每发间隔的（网际光轮 `numToBurst=2` 无 `fireRate`）—— 用户决定
     *     "没写当作 0"，与齐射同处理（`derive.ts` 里已写成 0，见 findings I203）
     *
     * ⚠️ 它**不是"连打"**：几发落在同一毫秒，没有"打完再等"的两段结构 ——
     * 和 `hits === 1` 一样，开火是**一瞬间**（只有金刻度，没有开火条）。
     * 早先按 `hits × interval` 画，`hits × 0 = 0` 让段宽塌成 0，只好硬塞一个
     * 2% 宽的窄条，于是同样节奏的音波突击队是满条蓝、烈焰之手只剩一根细线（用户报"蓝条不正常"）；
     * 而 `interval_ms` **缺失**时又退回"用周期当每发间隔"，开火段变成 `hits × 周期`
     * —— **比周期还长**（网际光轮 3000>1500、猛犸 8000>4000、寡妇火箭 9000>1500）。
     */
    const simultaneous = tm.hits > 1 && iv <= 0;
    const inCycleCharge = t.chargeInCycle === true && charge > 0;
    /*
     * **条子表达「阶段结构」，不是「占空比」。**
     *
     * 只有 `hits > 1` 且**有每发间隔**时才有"开火跨度"这个阶段：一轮 `hits × interval`
     * 打完（沙暴 12 发 × 200ms = 2.40s），剩下的空档是**另一个阶段**（冷却 1.60s）。
     * 一击（弹弓）或同轮齐射（烈焰之手 / 网际光轮）时开火是**一瞬间**，没有跨度，
     * 自然也不该有开火条 —— 只画金刻度，其余时间全是冷却（用户："开火就一瞬间的怎么还有条"）。
     *
     * 早先给"`hits === 1` 且无前摇"开了特例：把 `hits × iv` 里 `iv` 缺失退回周期、
     * 于是开火条 = 整轮，还美其名曰"弹弓只有攻击一个行为"（I169）。结果就是
     * 同一个语义（这一轮里不开火的那段）在弹弓身上是实心蓝、在掠食者身上是蓝色斜纹 ——
     * 用户："有前摇的单位蓝条和没有的长得不一样，他们是同一个语义啊"。现在特例已删。
     */
    const cadenced = !simultaneous && tm.hits > 1;
    const fireSpan = cadenced ? tm.hits * iv : 0;
    /*
     * **冷却段 = 一轮里"既不在前摇、也不在开火跨度里"的剩余时间**，一律同一种长相（蓝色斜纹）。
     * 统一算式：`周期 − 周期内的前摇 − 开火跨度`，**不给任何单位开特例**。
     *
     * ⚠️ 减的必须是**周期内**的前摇：`chargeInCycle` 为假时（音波坦克 3s 蓄力、序列武器的
     * `initialChargeUpMs`）蓄力是连打**之前**的独立阶段、时间相加，不属于这一轮，不能减。
     * 台账 B7 的实测（捕食者「开火间隔约 3 秒多，开火前约 1 秒激光瞄准」）对应的就是这条：
     * 3.44s 的轮里，前 1.00s 抬枪、然后一瞬间开火、其余 2.44s 冷却。
     */
    const coolMs = Math.max(0, tm.cycle_ms - (inCycleCharge ? charge : 0) - fireSpan);
    const chargeAt = start; // 周期内/外的前摇都在开头（周期内的："开火前抬枪"；周期外的："连打之前"）
    const fireAt = start + charge;
    const ticks = Array.from(
      { length: Math.max(1, tm.hits) },
      (_, i) => fireAt + (simultaneous ? 0 : i * iv),
    );

    // 冷却段（蓝色斜纹）—— 先推，它在开火段下面
    if (coolMs > 0) {
      out.push({
        kind: "gap",
        at: fireAt + fireSpan,
        ms: coolMs,
        // 悬停文案是**给用户看的**（不是给开发的注释）：只说这一格是什么、多长
        title: `冷却 ${fmtSec(coolMs)}（一轮 ${fmtSec(tm.cycle_ms)}）`,
      });
    }
    /*
     * 开火段：**只有真有跨度时才画**（连打）；一击 / 同轮齐射是一瞬间，只留刻度（`ms: 0`）。
     */
    out.push({
      kind: "fire",
      at: fireAt,
      ms: fireSpan,
      ticks,
      title: fireSpan > 0
        ? `连打 ${tm.hits} 发（每 ${fmtSec(iv)} 一发）`
        : simultaneous
          ? `开火：${tm.hits} 发同时出膛`
          : "开火：一击",
    });
    if (charge > 0) {
      out.push({
        kind: "charge",
        at: chargeAt,
        ms: charge,
        title: `前摇 ${fmtSec(charge)}（开火前）`,
      });
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
    // 装填型的一轮总长 = `reload_ms`（装填窗口从首发开始，连打在窗口内，见 findings I201）
    else if (tm.kind === "装填") spans.push(tm.reload_ms);
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

/**
 * 该队员的段（整体后移 `i × separationMs`，**并按周期重复若干轮**）。
 *
 * ⚠️ **必须重复**：`错开 × 人数` 超过一个周期时（狂热者 750×4=3000 vs 周期 850），
 * 第一个人**先转回第二轮**而最后一个人还没打第一轮 —— 只画一轮就看不到这种交叠。
 * 重复的轮次**故意画超出横轴**，由 `.bar` 的 `overflow: hidden` 裁掉
 * （用户给的方案："不管够不够都使劲往后面加时序，超出截断"）。
 */
function segsOf(i: number): Array<Seg & { left: string; width: string; tickPct: string[] }> {
  const shift = i * props.separationMs;
  const cyc = cycleMs.value;
  const reps = cyc > 0 ? Math.ceil((spanMs.value - shift) / cyc) + 1 : 1;
  const out: Array<Seg & { left: string; width: string; tickPct: string[] }> = [];
  for (let k = 0; k < reps; k++) {
    const off = shift + k * cyc;
    for (const s of baseSegs.value) {
      /*
       * 宽度 0 的段本来要丢掉（早先画成 0 宽的段会连刻度一起消失，见 I168）。
       * 但现在**开火是一瞬间**的那种段（`ms: 0`）**必须保留它的刻度** ——
       * 它不画条、只出刻度（用户："开火就一瞬间的怎么还有条"）。
       * 所以：宽度 0 且**没有刻度**才丢。
       */
      if (s.ms <= 0 && !(s.ticks?.length)) continue;
      /*
       * ⚠️ **刻度要按横轴过滤掉超出的**，不能只靠 CSS 裁 ——
       * 第 2 轮之后的刻度 `left` 会大于 100%，绝对定位元素会**把页面撑出横向滚动条**
       * （用户报"飞出去了"）。段本身在 `.bar` 里被 `overflow:hidden` 裁掉没问题，
       * 但刻度挂在 `.track` 上（为了伸出条子上下），所以必须在生成时就剔除。
       */
      const ticks = (s.ticks ?? []).map((x) => x + off).filter((x) => x <= spanMs.value);
      // 段整体在横轴右侧之外的，连段也不用生成
      if (s.at + off > spanMs.value) continue;
      out.push({
        ...s,
        left: pct(s.at + off),
        // 段宽也不超过横轴剩余部分
        width: pct(Math.max(0, Math.min(s.ms, spanMs.value - (s.at + off)))),
        tickPct: ticks.map((x) => pct(x)),
      });
    }
  }
  return out;
}
</script>

<template>
  <div v-if="tracks.length" class="tl">
    <div v-for="i in members" :key="i" class="row">
      <span class="who">{{ waveSize > 1 ? `队员 ${i + 1}` : "" }}</span>
      <div class="track">
        <!--
          段放在 `.bar` 里（它负责圆角与裁剪）；**开火标记放在 `.track` 上** ——
          标记要伸出条子上下，放在被 `overflow:hidden` 裁剪的层里会被剪掉。
        -->
        <div class="bar">
          <span
            v-for="(s, k) in segsOf(i)"
            :key="k"
            class="seg"
            :class="s.kind"
            :style="{ left: s.left, width: s.width }"
            :data-tip="s.title"
            data-float
          />
        </div>
        <template v-for="(s, k) in segsOf(i)" :key="`t${k}`">
          <span
            v-for="(tp, m) in s.tickPct"
            :key="m"
            class="tick"
            :style="{ left: tp }"
            :data-tip="s.title"
            data-float
          />
        </template>
      </div>
    </div>

    <p class="legend">
      <span><i class="sw charge" />前摇</span>
      <span><i class="sw fire" />开火</span>
      <span><i class="sw gap" />冷却</span>
      <span><i class="sw reload" />装填</span>
      <span class="dim">横轴 = {{ fmtSec(spanMs) }}<template v-if="waveSize > 1">（{{ waveSize }} 人 × 错开 {{ fmtSec(separationMs) }}）</template></span>
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
  /* 高一点，让开火标记伸出的部分不会被相邻行挤到 */
  height: 18px;
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
  /*
   * ⚠️ 这里**不能** `overflow: hidden` —— 开火标记要伸出条子上下。
   * 横向的越界由**生成时过滤**解决（见 `segsOf`），不靠 CSS 裁：
   * `overflow-x: hidden` + `overflow-y: visible` 在 CSS 里是无效组合。
   */
}
/* 圆角与裁剪在这一层，只作用于段 */
.bar {
  position: absolute;
  inset: 0;
  background: #10131a;
  border-radius: 4px;
  /*
   * ⚠️ **不能 `overflow: hidden`** —— 段的 tooltip 会被剪掉。
   * 段宽已经在 `segsOf` 里夹到横轴以内，越界元素也过滤掉了，所以不需要裁。
   */
}
.seg {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 3px;
}
/*
 * 段色（用户定的语义）：
 *   · `fire`  实心蓝 —— **开火**：只在"有发与发之间的间隔"时才有条
 *     （连打跨度 = 发数 × 间隔）；一击 / 同轮齐射是一瞬间，没有条，只有金色刻度
 *   · `gap`   **蓝色斜纹 —— 冷却**（"冷却蓝条"）：这一轮里剩下的等待时间，
 *     `周期 − 周期内前摇 − 开火跨度`。**所有单位同一种长相**（弹弓这种"一发 + 无前摇"
 *     的整条就是冷却，不再另用实心样式）
 *   · `charge` 黄褐斜纹 —— 前摇
 *   · `reload` 暗红斜纹 —— 装填
 */
.seg.fire {
  background: linear-gradient(#4da8ff, #2f7fd0);
}
.seg.gap {
  background: repeating-linear-gradient(45deg, #1d3a5c, #1d3a5c 4px, #2f6fa8 4px, #2f6fa8 8px);
}
.seg.charge {
  background: repeating-linear-gradient(45deg, #6b5a2a, #6b5a2a 4px, #8a7434 4px, #8a7434 8px);
}
.seg.reload {
  background: repeating-linear-gradient(45deg, #3a2a2a, #3a2a2a 4px, #5a3a3a 4px, #5a3a3a 8px);
}
/*
 * 开火标记 —— **矩形，且比条子高**，让它在蓝条上跳出来。
 * 原来是 1px 的竖线，在 8px 高的条子里几乎看不见（用户报"不显眼"）。
 */
.tick {
  position: absolute;
  top: -4px;
  height: 16px; /* 条子 8px，上下各露出 4px */
  width: 3px;
  background: #ffcc55;
  border-radius: 1px;
  box-shadow: 0 0 3px #ffcc5588;
  pointer-events: none;
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
.sw.gap {
  background: repeating-linear-gradient(45deg, #1d3a5c, #1d3a5c 3px, #2f6fa8 3px, #2f6fa8 6px);
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
