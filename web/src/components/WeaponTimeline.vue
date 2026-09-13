<script setup lang="ts">
/**
 * **开火时序条** —— 一把武器（含小队各成员）什么时候造成伤害。
 *
 * **为什么要有它**：时序是一条时间线，用文字描述必然产生歧义 ——
 * "前摇 3s + 每 0.04s 一发"读不出前摇是在周期**内**还是**外**；
 * 画成条子，段与段的**位置关系**自己就说明了。
 *
 * ## 段从哪来（本组件不管算法）
 *
 * 段由**调用方**给：新格式是 `web/src/def-timeline.ts`（`defTimeline(w, …)`），
 * 战斗时间线走 `web/src/sim-chart.ts` —— 两者共用 `squad-timeline.ts` 的 `Seg` 语义与配色。
 * 早先这套算式只活在本组件里、战斗时间线又抄了一遍样式，同一个语义两处实现
 * （用户："为什么不能直接用和时序图那边一样的样式"）。现在段语义、配色、DOM 结构统一。
 *
 * ## 每个队员一条
 *
 * 成员 `i` 的整条轴**整体后移 `i × separationMs`** —— 小队是脉冲式输出还是相位漂移，
 * 只有把所有人的条画出来才看得见（findings I166）。
 *
 * ⚠️ **这里的 `i` 是"满员时"的成员下标，本组件不建模减员**（findings I229/I230）。
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { layoutSegs, type PlacedSeg, type Seg } from "../def-timeline.ts";

const props = defineProps<{
  /** 一名队员**一轮内**的段（未错开、未重复） */
  segs: Seg[];
  /** 一轮多长（重复的步长） */
  cycleMs: number;
  /**
   * **首发前的一次性充能**（`initialChargeUpMs`）—— 只有第一轮之前有，
   * 之后的每一轮从上一发开始算（用户要求：首发前摇也要画出来）。
   */
  initialMs?: number;
  /** 横轴总长 */
  spanMs: number;
  waveSize: number;
  separationMs: number;
  /** 图例右侧那行小字（"横轴 = … · N 轮 · N 人 × 错开 …"） */
  axisNote?: string;
}>();

const pct = (ms: number) => `${(ms / Math.max(1, props.spanMs)) * 100}%`;
void pct;

/** 每个队员一条 */
const members = computed(() => Array.from({ length: Math.max(1, props.waveSize) }, (_, i) => i));

/**
 * 该队员这一行的段 —— **位置算式不在这里**（在 `web/src/def-timeline.ts` 的 `layoutSegs`）：
 * 用户报过一次"MLRS 的开火刻度落在部署条里"，位置这种东西只有能测才不会错。
 */
function segsOf(i: number): PlacedSeg[] {
  return layoutSegs(props.segs, {
    cycleMs: props.cycleMs,
    initialMs: props.initialMs ?? 0,
    spanMs: props.spanMs,
    memberIndex: i,
    separationMs: props.separationMs,
  });
}

/** 有没有"剩余装填"那条 —— 有色例才画图例项（弹夹武器才有） */
const hasReload = computed(() => props.segs.some((s) => s.kind === "reload"));

/**
 * 标注带：**只取第一名队员、且只取第一轮**里带说明的段。
 *
 * ⚠️ 两个"只取"都是必要的（用户报过图上糊成一片：
 * `蓄力 3s段 1段 1蓄力 3s` 那种 —— 周期的每一轮都重标一遍同样的字）：
 * · **只第一名队员** —— 每名队员的段结构完全一样；
 * · **只第一轮** —— 结构是周期的，第二轮开始标同样的字没有信息量。
 */
const annoSegs = computed<PlacedSeg[]>(() =>
  segsOf(0).filter((s) => (s.label ?? "") !== "" && (s.cycle ?? 0) === 0),
);

/**
 * 标注的**排布**（像素）—— 先按段的左边界摆，量出每条的宽度后**冲突就右推**。
 *
 * ⚠️ 早先是"把标注夹在段宽里 + 省略号"，于是**短段的字根本看不见**：
 * 奥卡攻击机的前摇只有 0.1s，在 9s 的横轴上是 1% 宽 ⇒ 直接变省略号（用户报的）。
 * 标注是给人读的，**宁可右推错开、也不许裁掉**；顺序仍然是从左到右跟着段走。
 */
interface AnnoItem {
  label: string;
  kind: string;
  title: string;
  leftPx: number;
}
const annoEl = ref<HTMLElement | null>(null);
const annoPlaced = ref<AnnoItem[]>([]);

async function placeAnno(): Promise<void> {
  const el = annoEl.value;
  const segs = annoSegs.value;
  if (el === null || segs.length === 0) {
    annoPlaced.value = [];
    return;
  }
  const laneW = el.clientWidth;
  if (laneW <= 0) return;
  /** 第一遍：先按段左边界摆出来（要渲染出来才知道文字多宽） */
  annoPlaced.value = segs.map((s) => ({
    label: s.label ?? "",
    kind: s.kind,
    title: s.title,
    leftPx: (Number(s.left.replace("%", "")) / 100) * laneW,
  }));
  await nextTick();
  /** 第二遍：量宽度，冲突右推（`cursor` = 上一条的右边界），最后把整条夹进车道内 */
  const kids = Array.from(el.children) as HTMLElement[];
  let cursor = 0;
  annoPlaced.value = segs.map((s, i) => {
    const w = kids[i]?.offsetWidth ?? 56;
    const want = (Number(s.left.replace("%", "")) / 100) * laneW;
    // ⚠️ **夹在车道里靠 JS 算，不靠 CSS 裁** —— 一裁就会把悬浮提示一起剪掉（见 `.anno` 的说明）
    const leftPx = Math.min(Math.max(want, cursor), Math.max(0, laneW - w));
    cursor = leftPx + w + 5;
    return { label: s.label ?? "", kind: s.kind, title: s.title, leftPx };
  });
}

onMounted(() => void placeAnno());
watch(
  () => [props.segs, props.spanMs, props.cycleMs, props.initialMs, props.waveSize, props.separationMs],
  () => void placeAnno(),
  { deep: true },
);
</script>
<template>
  <div v-if="segs.length" class="tl">
    <!-- 图例与横轴说明放在**条上方**（用户要求：文字说明别塞进条里） -->
    <p class="legend">
      <span><i class="sw charge" />前摇</span>
      <span><i class="sw fire" />开火</span>
      <span><i class="sw gap" />冷却</span>
      <span v-if="hasReload"><i class="sw reload" />剩余装填</span>
      <span v-if="segs.some((s) => s.kind === 'deploy')"><i class="sw deploy" />部署</span>
      <span v-if="segs.some((s) => s.kind === 'stage')"><i class="sw stage" />分段</span>
      <span v-if="segs.some((s) => s.kind === 'death')"><i class="sw death" />自爆</span>
      <span class="dim">{{ axisNote }}</span>
    </p>

    <!--
      **段长标注带** —— 段的说明（`前摇 0.1s` / `装填 9s` / `段 1（无限）`）画在**条的上方**：
      条本身只有 8px 高，塞进去既看不清也容易被窄段裁掉。
      只画**第一名队员的第一轮**（结构是周期的，重复标只是噪声）；
      位置先按段左边界、冲突再右推 —— **宁可错开也不裁字**（短的段也得看得见）。
    -->
    <div ref="annoEl" class="anno">
      <span
        v-for="(s, k) in annoPlaced"
        :key="k"
        class="note"
        :class="s.kind"
        :style="{ left: `${s.leftPx}px` }"
        :data-tip="s.title"
        data-float
      >{{ s.label }}</span>
    </div>

    <div v-for="i in members" :key="i" class="row">
      <span class="who">{{ waveSize > 1 ? `队员 ${i + 1}` : "" }}</span>
      <div class="track">
        <!--
          段放在 `.bar` 里（它负责圆角与裁剪）；**开火标记放在 `.track` 上** ——
          标记要伸出条子上下，放在被裁剪的层里会被剪掉。
        -->
        <div class="bar">
          <!--
            ⚠️ **段不挂 `data-float`**：全局那条 `[data-float]:hover { transform: scale(1.06) }`
            会让段**横向也变长** —— 横轴是时间，宽度变了就等于谎报时长
            （用户：「鼠标悬停在条上看提示，条还是会往两边变长」）。
            段自己的悬停反馈在 scoped 样式里：提亮 + 内描边（尺寸一格不动）。
          -->
          <span
            v-for="(s, k) in segsOf(i)"
            :key="k"
            class="seg"
            :class="s.kind"
            :style="{ left: s.left, width: s.width }"
            :data-tip="s.title"
          />
        </div>
        <template v-for="(s, k) in segsOf(i)" :key="`t${k}`">
          <span
            v-for="(tp, m) in s.tickPct"
            :key="m"
            class="tick"
            :style="{ left: tp }"
            :data-tip="s.title"
          />
        </template>
      </div>
    </div>
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
/*
 * **段长标注带** —— 在条的上方，高度给足一行小字。
 * 标注按段的左边界对齐（`left` 是百分比），文字**可以溢出窄段**（`nowrap` + 不裁），
 * 因为窄段的说明往往比段本身宽（例：`前摇 0.25s` 只占 2%）。
 */
.anno {
  position: relative;
  height: 14px;
  margin: 2px 0 3px 50px; /* 左边空出 `.who` 那一栏，与条对齐 */
  /*
   * ⚠️ **不能 `overflow: hidden`** —— 标注自己带 `data-tip` 悬浮提示，
   * 一裁就把它剪没了（用户：「武器时序图是有悬浮提示吧，现在看不见」）。
   * "标注别撑破卡片"由 `placeAnno()` **把整条夹进车道内**保证，不靠 CSS 裁。
   */
  overflow: visible;
}
.anno .note {
  position: absolute;
  top: 0;
  /* 文字**完整显示**（宽度不夹、不省略号）—— 位置由 `placeAnno()` 负责不重叠 */
  white-space: nowrap;
  padding-left: 3px;
  font-size: 9.5px;
  line-height: 14px;
  color: #9aa6c2;
  pointer-events: auto;
}
.anno .note.charge {
  color: #d8b45c;
}
.anno .note.fire {
  color: #7fc0ff;
}
.anno .note.reload {
  color: #d98c8c;
}
.anno .note.deploy {
  color: #b79af0;
}
.anno .note.stage {
  color: #6fd3e0;
}
.anno .note.death {
  color: #ff9b8a;
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
.bar {
  position: absolute;
  inset: 0;
  background: #10131a;
  border-radius: 4px;
  /* ⚠️ 不能 `overflow: hidden` —— 段的 tooltip 会被剪掉（段宽已在生成时夹住） */
}
.seg {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * ⚠️ **这里不能 `overflow: hidden`**：段自己带 `data-tip`，提示框是它的 `::after`，
   * 被自己裁掉就永远看不见（用户报的"时序图的悬浮提示看不见"）。
   * 段里的文字早就不画了（说明在条上方的标注带里），所以裁不裁都不影响版式。
   */
  overflow: visible;
  /*
   * 段的悬停：**只加亮 + 内描边**，宽度与高度都**不变**。
   *
   * ⚠️ 不能用 `transform: scaleY(1.45)`：段自己带 `data-tip`，提示框是它的 `::after`，
   * **父级的变换会连提示框一起拉长**（用户报的"文字被 y 方向拉长"）。
   * 也不能用 `scale(1.06)`：横轴是时间、**宽度是有意义的量**（变宽等于谎报时长）。
   * 内描边画在边界**里面** ⇒ 外廓尺寸一格不动，看起来仍然是"这一段被压厚了"。
   */
  transition:
    filter 0.1s ease-out,
    box-shadow 0.1s ease-out;
}
.seg:hover {
  filter: brightness(1.5);
  box-shadow: inset 0 0 0 2px #ffffff7a;
  z-index: 3;
}
/* 段里不再放文字（说明在条上方的标注带里） */
.seg em {
  font-style: normal;
  font-size: 9px;
  line-height: 1;
  color: #dbe6f7;
  white-space: nowrap;
  pointer-events: none;
}

/*
 * 段色（语义与战斗时间线一致）：
 *   · `fire`   实心蓝 —— 开火（只在"发与发之间有间隔"时才有条；一击/齐射只有金刻度）
 *   · `gap`    蓝色斜纹 —— 冷却（这一轮剩下的等待）
 *   · `charge` 黄褐斜纹 —— 前摇
 *   · `reload` 暗红斜纹 —— 装填
 *   · `deploy` 紫 —— 架设/撤收（这段时间不能开火）
 *   · `stage`  青 —— 分段武器的各段
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
.seg.deploy {
  background: repeating-linear-gradient(45deg, #3a2a55, #3a2a55 4px, #5b3f86 4px, #5b3f86 8px);
}
.seg.stage {
  background: linear-gradient(#2a8a99, #1d6470);
}
/* `death`（自爆）**只出标注、不出条**（`ms: 0`，见 `def-timeline.ts`） */
/*
 * 开火标记 —— **矩形，且比条子高**，让它在蓝条上跳出来。
 * 原来 1px 的竖线在 8px 高的条子里几乎看不见（用户报"不显眼"）。
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
  flex-wrap: wrap;
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
.sw.deploy {
  background: #5b3f86;
}
.sw.stage {
  background: #2a8a99;
}
.sw.death {
  background: #f87171;
}
.dim {
  margin-left: auto;
}
</style>
