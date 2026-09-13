<script setup lang="ts">
/**
 * 战斗时间线 —— 每个队员一行：**阶段条 + 上下两侧的标志**。
 *
 * ## 一行长什么样
 *
 * ```
 *          ⚔        ⚔            ← 攻击标志（条上方的槽位，从相位条向上伸出）
 *   [队员 3 ▓▓▓▓▓░░░░░░░░]        ← 血量细条（剩余量）
 *   [队员 3 ████░░░░████░░]       ← 阶段条（前摇/开火/冷却/装填，与单位页时序图同色同义）
 *          💥       ☠             ← 受击（爆炸）/ 死亡（骷髅）（条下方的槽位）
 * ```
 *
 * **左右两侧共用同一比例尺**，所以"同一时刻的攻击与受伤"在纵向是对齐的 ——
 * 只有敌对两方，不必画连线指认方向（用户决定）。
 *
 * ## 交互（用户要求）
 *
 * · **鼠标移到任一标志上** ⇒ 该次攻击与它造成的**全部受伤/死亡标志成对亮起**
 *   （连同参与的两行），其余淡出。移开即恢复。
 * · **悬停文案**：攻击标志写"谁开火、打谁、打了几员"；
 *   受伤/死亡标志写**本次伤害 + 该员剩余 HP / 总 HP**。
 *
 * ## 与单位页时序图一致
 *
 * 段的算法与配色**共用** `web/src/squad-timeline.ts`（`baseSegsOf`），
 * 图形共用 `web/src/icons.ts` 的 `MARK_ICONS`（图例与主图同源）。
 *
 * ⚠️ 这是"在给定假设下算出来的"时间线，不是对战回放：未建模项由页面上的
 * `SIM_CAVEATS` 原样列出。
 */
import { computed, ref } from "vue";

import type { DatasetEntry } from "@rivals/core/derive";

import { fmtSec } from "../format.ts";
import type { SimResult } from "../sim.ts";
import { baseSegsOf } from "../squad-timeline.ts";
import { buildChart, type ChartRow } from "../sim-chart.ts";
import MarkIcon from "./MarkIcon.vue";

const props = defineProps<{
  result: SimResult;
  entries: [DatasetEntry, DatasetEntry];
  labels: [string, string];
  spanMs: number;
}>();

const chart = computed(() =>
  buildChart(
    props.entries[0].derived.attack.tracks,
    props.entries[1].derived.attack.tracks,
    props.result,
  ),
);
const rows = computed(() => chart.value.rows);

/*
 * **架设不再是"标注"，改回时间轴上真占位置的段**（在 `sim-chart.ts` 里生成）——
 * 用户给的模型："加入部署段,第一只加入前摇段第二只根据自己在小队的位置加入 (2-1)*2s 的等待段"。
 * 所以这里不再需要单独的标注层。
 */

const span = computed(() => Math.max(1, props.spanMs));
const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / span.value) * 100))}%`;

/* ── 行几何（像素，与 CSS 里的高度一致）────────────────────── */
/**
 * 一行布局（自上而下）：
 *
 * ```
 *    0 ┌ 上槽（攻击图标中心 9）          ┐ 图标取 18~20px、**比槽位大**，
 *   16 ├ 血量细条 3px                    │ 会微微压到相邻行 —— 这是刻意的：
 *   20 ├ 阶段条 10px                     │ 标志是这一行的主要信息，缩到 12px 时
 *   36 └ 下槽（受伤/阵亡图标中心 36）    ┘ 骷髅与爆炸都只剩轮廓（见 out/marks*.png）
 * ```
 *
 * 上一个版本图标只有 12~14px，用户反馈"图标小了"，所以整体放大到 18/20。
 */
const ROW_H = 42;
/**
 * ⚠️ 行间距必须**够放两个半高图标**：上一行"受伤/阵亡"图标中心在下槽（距行顶 36、
 * 图标 18px ⇒ 底边到 45），下一行"攻击"图标中心在上槽（距行顶 9、图标 20px ⇒ 顶边到 −1）。
 * 所以两行之间的净间距至少要 `45 − 42 + 1 ≈ 4`，实际取 **14** 才不会看着挤在一起
 * （用户："条之间距离拉大，不然下面的攻击和受击重叠了"）。
 */
const ROW_GAP = 14;
const PAD_TOP = 10;
/** 攻击图标中心距行顶 */
const ATK_CY = 9;
/** 血量条顶 */
const HP_TOP = 16;
const HP_H = 3;
/** 阶段条顶 */
const BAR_TOP = 20;
const BAR_H = 10;
/** 受击/死亡图标中心距行顶 */
const HIT_CY = 36;

const rowTop = (side: 0 | 1, member: number) => {
  const index = rows.value.findIndex((r) => r.side === side && r.member === member);
  return index < 0 ? 0 : PAD_TOP + index * (ROW_H + ROW_GAP);
};
const totalH = computed(() => PAD_TOP + Math.max(1, rows.value.length) * (ROW_H + ROW_GAP) + 4);

/* ── 悬停联动：成对亮起 ───────────────────────────────────── */
interface Pair {
  /** 攻击方（开火那一员） */
  aSide: 0 | 1;
  aMember: number;
  aT: number;
  /** 被打的那几员（AoE 会有多个） */
  targets: Array<{ side: 0 | 1; member: number; t: number }>;
}
const hover = ref<Pair | null>(null);

/** 该标志是否参与当前悬停（参与 = 亮起，其余淡出） */
const isAtkActive = (side: 0 | 1, member: number, t: number) =>
  hover.value !== null && hover.value.aSide === side && hover.value.aMember === member && hover.value.aT === t;

const isDmgActive = (side: 0 | 1, member: number, t: number) =>
  hover.value !== null &&
  hover.value.targets.some((x) => x.side === side && x.member === member && x.t === t);

/** 有悬停时，与本次无关的行淡出 */
const isRowActive = (side: 0 | 1, member: number) => {
  const h = hover.value;
  if (!h) return true;
  if (h.aSide === side && h.aMember === member) return true;
  return h.targets.some((x) => x.side === side && x.member === member);
};
const isAnyHover = computed(() => hover.value !== null);

/* ── 血量：算"挨打前 / 挨打后" ─────────────────────────────── */
/** 某一员在时刻 t 的剩余血量（含 t 这一次伤害之后） */
function hpAfter(row: ChartRow, t: number): number {
  let hp = row.maxHp;
  for (const h of row.hits) {
    hp -= h.damage;
    if (h.t === t) break;
  }
  return Math.max(0, hp);
}
const hpAfterRow = (side: 0 | 1, member: number, t: number) =>
  hpAfter(rows.value.find((r) => r.side === side && r.member === member)!, t);

/** 结束时剩余血量比例（血量细条用） */
function hpPct(row: ChartRow) {
  const lost = row.hits.reduce((n, h) => n + h.damage, 0);
  return Math.max(0, (row.maxHp - lost) / row.maxHp) * 100;
}

/** 阶段条（与 WeaponTimeline 共用段算法） */
function segsOf(row: ChartRow) {
  /*
   * **自杀式单位只发一轮** ⇒ 不画冷却（`hits: 1` 的圣甲虫，`cooldown = 5s` 是"下次还要等"，
   * 但它开火即自爆、**没有下次**）。见 `squad-timeline.ts` 的 `repeat` 说明。
   */
  const info = props.result.sideInfo[row.side]!;
  const once = info.selfDestruct;
  return baseSegsOf(props.entries[row.side]!.derived.attack.tracks, { repeat: !once }).map((s) => {
    const ms = Math.min(s.ms, Math.max(0, span.value - s.at));
    const w = pct(ms);
    /*
     * ⚠️ **"一击"的宽度是 0 毫秒**（`fireSpan = 0`），按百分比算就是 0 像素 ⇒ 完全看不见。
     * 一击/齐射这类武器**只有开火瞬间没有开火跨度**，所以给它一个**最小可见宽度**
     * （3px 的实心块），而不是靠"金刻度"单独表达 —— 用户看的是"哪里在开火"。
     */
    const minW = `max(${w}, 3px)`;
    return {
      kind: s.kind,
      dead: false,
      title: s.title,
      left: pct(s.at),
      width: s.kind === "fire" ? minW : w,
    };
  });
}

/** 段自带的伤害落点刻度 */
function ticksOf(row: ChartRow) {
  const out: Array<{ left: string; title: string }> = [];
  for (const s of row.segs) {
    for (const t of s.ticks ?? []) {
      if (t > span.value) continue;
      out.push({ left: pct(t), title: s.title });
    }
  }
  return out;
}

/* ── 标志 ① 攻击（条上方）────────────────────────────────── */
interface AtkMark {
  left: string;
  side: 0 | 1;
  member: number;
  t: number;
  aoe: boolean;
  title: string;
  pair: Pair;
}
const atkMarks = computed<AtkMark[]>(() => {
  const out: AtkMark[] = [];
  for (const sh of props.result.shots) {
    if (sh.hazard) continue; // 格子效果不是"开火"，走下面的 hazardMarks
    if (!sh.reachable) continue; // 打不到的走 miss 标志
    const targets = sh.hits.map((h) => ({ side: h.side, member: h.member, t: sh.t }));
    const who = (x: { side: 0 | 1; member: number }) =>
      `${x.side === 0 ? props.labels[0] : props.labels[1]} 队员 ${x.member + 1}`;
    out.push({
      left: pct(sh.t),
      side: sh.side,
      member: sh.member,
      t: sh.t,
      aoe: sh.aoe,
      title: `${fmtSec(sh.t)}　${sh.weaponName} 开火${sh.aoe ? "（范围）" : ""} → ${
        targets.length > 1 ? `${targets.length} 名队员` : who(targets[0]!)
      }`,
      pair: { aSide: sh.side, aMember: sh.member, aT: sh.t, targets },
    });
  }
  return out;
});

/* ── 标志 ② 受伤 / ③ 死亡（条下方）────────────────────────── */
interface DmgMark {
  left: string;
  side: 0 | 1;
  member: number;
  t: number;
  aoe: boolean;
  killed: boolean;
  damage: number;
  title: string;
  pair: Pair;
  /**
   * 该次受伤**之后**剩余的血量 —— 用来算悬停提示里的 `HP 剩余/总HP`。
   * （数值不再画在图上了，所以这里只服务提示文案。）
   */
  hpLeft: number;
  hpMax: number;
}
const dmgMarks = computed<DmgMark[]>(() => {
  const out: DmgMark[] = [];
  for (const sh of props.result.shots) {
    for (const h of sh.hits) {
      const maxHp = rows.value.find((r) => r.side === h.side && r.member === h.member)?.maxHp ?? 0;
      const hpLeft = hpAfterRow(h.side, h.member, sh.t);
      out.push({
        left: pct(sh.t),
        side: h.side,
        member: h.member,
        t: sh.t,
        aoe: sh.aoe,
        killed: h.killed,
        damage: h.damage,
        hpLeft,
        hpMax: maxHp,
        title: `${fmtSec(sh.t)}　${sh.weaponName} 造成 ${h.damage} 伤害　HP ${hpLeft}/${maxHp}${
          h.killed ? "　阵亡" : ""
        }`,
        pair: {
          aSide: sh.side,
          aMember: sh.member,
          aT: sh.t,
          targets: [{ side: h.side, member: h.member, t: sh.t }],
        },
      });
    }
  }
  return out;
});

/** 同一行的伤害数字竖直错开 —— **已不再需要**（用户："伤害数字不要了"，
 *  数值走悬停提示）。这个函数连同 `DmgMark.lane` 的车道计算一起删掉了，
 *  留个说明免得以后有人再把它加回来又踩"忽上忽下"那个坑（见 findings I237 ⑥）。 */

/* ── 标志 ④ 自爆（自杀式单位打完最后那一发）───────────────── */
/**
 * **自爆标志** —— 每一员**自己**开火后销毁的那一刻（`Death.cause === "selfDestruct"`）。
 *
 * ⚠️ 早先这里是按"一方"画的（读 `sideInfo.selfDestructAtMs` 一个标量），
 * 于是 2 员的圣甲虫**只有第一只会出标志**（用户："第一只圣甲虫攻击和自杀式攻击两个图标提示出现,
 * 第二个只有攻击"）。两只是一前一后各炸一次的，必须**逐员**来自 `deaths`。
 *
 * 画在**该员的开火位置**（上槽，与攻击标志同槽）：它是"我打完之后我炸了"，不是"我挨了一下"。
 */
const selfDestructMarks = computed(() => {
  const out: Array<{ side: 0 | 1; member: number; left: string; title: string }> = [];
  for (const row of rows.value) {
    if (!row.selfDestruct || row.deathT === null) continue;
    const info = props.result.sideInfo[row.side]!;
    out.push({
      side: row.side,
      member: row.member,
      left: pct(row.deathT),
      title:
        `${fmtSec(row.deathT)}　${row.label} 开火后自爆（TakeHiddenDestroyDamage）` +
        `　该员销毁（${info.label} 全队 ${info.members} 员，逐员各炸一次）`,
    });
  }
  return out;
});

/* ── 打不到该类型：条下方一条灰杠 ─────────────────────────── */
const missMarks = computed(() =>
  props.result.shots
    .filter((s) => !s.reachable && !s.hazard)
    .map((s) => ({
      side: s.side,
      member: s.member,
      left: pct(s.t),
      title: `${fmtSec(s.t)}　${s.weaponName} 打不到该类型（0 伤害）`,
    })),
);

/**
 * **格子效果的那一跳** —— 火（圣甲虫/火焰轰炸机）与毒气（催化剂/化武兵/毒车）。
 *
 * 它们算在 `result.shots` 里、但**不是开火**（`Shot.hazard` 有值），所以：
 * ① 不进 `atkMarks`（否则会在"谁开的火"那个槽位上凭空多出攻击标志）；
 * ② 画在**受害方那一行**的下槽（与受伤同槽），图标按种类分（`burst` / `gas`）。
 */
const hazardMarks = computed(() =>
  props.result.shots
    .filter((s) => s.hazard && s.hits.length)
    .flatMap((s) =>
      s.hits.map((h) => ({
        side: h.side,
        member: h.member,
        left: pct(s.t),
        kind: s.hazard!,
        killed: h.killed,
        title:
          `${fmtSec(s.t)}　${s.weaponName}造成 ${h.damage} 伤害　HP ${hpAfterRow(h.side, h.member, s.t)}/${rows.value.find((r) => r.side === h.side && r.member === h.member)?.maxHp ?? 0}` +
          (h.killed ? "　阵亡" : "") +
          (s.hazard === "gas" ? "　（毒气：只对步兵，载具免疫）" : "　（火：只对地面）"),
      })),
    ),
);

const timeGrid = computed(() => {
  const step = span.value > 40_000 ? 10_000 : 5_000;
  const out: number[] = [];
  for (let t = 0; t <= span.value; t += step) out.push(t);
  return out;
});
</script>

<template>
  <div class="tl">
    <div class="head">
      <b class="side left">{{ labels[0] }}</b>
      <span class="muted">每员一行 · 上 = 攻击 · 下 = 受伤/阵亡 · 悬停任一标志成对亮起</span>
      <b class="side right">{{ labels[1] }}</b>
    </div>

    <div class="stack" :style="{ height: `${totalH}px` }" @mouseleave="hover = null">
      <!-- 时间网格 -->
      <span v-for="t in timeGrid" :key="`g${t}`" class="grid" :style="{ left: pct(t) }" />

      <!-- 行：血量细条 + 阶段条 -->
      <div
        v-for="row in rows"
        :key="`${row.side}-${row.member}`"
        class="row"
        :class="[row.side === 0 ? 'l' : 'r', { dim: isAnyHover && !isRowActive(row.side, row.member) }]"
        :style="{ top: `${rowTop(row.side, row.member)}px` }"
      >
        <span class="who" :class="row.side === 0 ? 'l' : 'r'">{{ row.label }}</span>
        <div class="track">
          <div class="hp" :style="{ top: `${HP_TOP}px` }">
            <span class="hp-fill" :class="row.side === 0 ? 'l' : 'r'" :style="{ width: `${hpPct(row)}%` }" />
          </div>
          <div class="bar" :style="{ top: `${BAR_TOP}px` }">
            <span
              v-for="(s, k) in segsOf(row)"
              :key="k"
              class="seg"
              :class="[s.kind, { dead: s.dead }]"
              :style="{ left: s.left, width: s.width }"
              :data-tip="s.title"
              data-float
            />
          </div>
          <span
            v-for="(t, k) in ticksOf(row)"
            :key="`t${k}`"
            class="tick"
            :style="{ left: t.left, top: `${BAR_TOP - 4}px` }"
            :data-tip="t.title"
            data-float
          />
        </div>
      </div>

      <!-- 标志 ① 攻击（条上方） -->
      <MarkIcon
        v-for="(m, k) in atkMarks"
        :key="`a${k}`"
        class="mark mark-atk"
        :class="{ aoe: m.aoe, on: isAtkActive(m.side, m.member, m.t) }"
        name="sword"
        :size="20"
        :style="{ left: m.left, top: `${rowTop(m.side, m.member) + ATK_CY}px` }"
        :data-tip="m.title"
        data-float
        @mouseenter="hover = m.pair"
      />

      <!-- 标志 ② 受伤（爆炸）/ ③ 死亡（骷髅）—— 条下方。
           伤害数值不再画在图上（用户："伤害数字不要了"），一律走悬停提示。 -->
      <MarkIcon
        v-for="(m, k) in dmgMarks"
        :key="`d${k}`"
        class="mark mark-dmg"
        :class="{ aoe: m.aoe, killed: m.killed, on: isDmgActive(m.side, m.member, m.t) }"
        :name="m.killed ? 'skull' : 'blast'"
        :size="18"
        :style="{ left: m.left, top: `${rowTop(m.side, m.member) + HIT_CY}px` }"
        :data-tip="m.title"
        data-float
        @mouseenter="hover = m.pair"
      />

      <!-- 打不到该类型 -->
      <MarkIcon
        v-for="(m, k) in missMarks"
        :key="`m${k}`"
        class="mark mark-miss"
        name="miss"
        :size="14"
        :style="{ left: m.left, top: `${rowTop(m.side, m.member) + HIT_CY}px` }"
        :data-tip="m.title"
        data-float
      />

      <!-- 标志 ④ 自爆（自杀式单位，画在自己那一行的**上槽**＝开火位置） -->
      <MarkIcon
        v-for="(m, k) in selfDestructMarks"
        :key="`s${k}`"
        class="mark mark-self"
        name="burst"
        :size="20"
        :style="{ left: m.left, top: `${rowTop(m.side, m.member) + ATK_CY}px` }"
        :data-tip="m.title"
        data-float
      />

      <!-- 标志 ⑤ 格子效果（火 / 毒气）—— 画在**受害方**那一行的下槽 -->
      <MarkIcon
        v-for="(m, k) in hazardMarks"
        :key="`h${k}`"
        class="mark"
        :class="m.kind === 'gas' ? 'mark-gas' : 'mark-fire'"
        :name="m.kind === 'gas' ? 'gas' : 'burst'"
        :size="15"
        :style="{ left: m.left, top: `${rowTop(m.side, m.member) + HIT_CY}px` }"
        :data-tip="m.title"
        data-float
      />

    </div>

    <p class="legend">
      <span><i class="sw charge" />前摇</span>
      <span><i class="sw fire" />开火</span>
      <span><i class="sw gap" />冷却</span>
      <span><i class="sw reload" />装填</span>
      <span><i class="sw deploy" />部署/架设</span>
      <span><MarkIcon class="lg atk" name="sword" :size="16" />攻击</span>
      <span><MarkIcon class="lg dmg" name="blast" :size="16" />受伤（悬停看伤害与剩余 HP）</span>
      <span><MarkIcon class="lg aoe" name="blast" :size="16" />范围伤害</span>
      <span><MarkIcon class="lg skull" name="skull" :size="16" />阵亡（致死的那一下用它，不再画受伤）</span>
      <span><MarkIcon class="lg self" name="burst" :size="16" />攻击后自爆（圣甲虫，打完这发自己全队销毁）</span>
      <span><MarkIcon class="lg fire" name="burst" :size="16" />火（站在格里每 0.25s 掉血，只对地面）</span>
      <span><MarkIcon class="lg gas" name="gas" :size="16" />毒气（每 0.2s 掉血，只对步兵，载具免疫）</span>
      <span class="dim">横轴 = {{ fmtSec(span) }} · {{ rows.length }} 条</span>
    </p>
  </div>
</template>

<style scoped>
/*
 * ⚠️ 段样式**与 `WeaponTimeline.vue` 逐条对应**（同色值、同斜纹）。
 * 两处必须长得一样；scoped 无法跨组件复用，所以这里保持字面一致。
 */
.tl {
  margin: 6px 0 8px;
  padding: 6px 8px;
  background: #171b23;
  border: 1px solid var(--line, #2b3038);
  border-radius: 6px;
  overflow-x: auto;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  margin-bottom: 4px;
}
.head .right {
  margin-left: auto;
}
.side.left {
  color: #8cc4ff;
}
.side.right {
  color: #ffab7a;
}
.stack {
  position: relative;
  margin-left: 52px; /* 给"队员 N"留列 */
}
.grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #232a35;
}
.row {
  position: absolute;
  left: 0;
  right: 0;
  height: 42px;
  transition: opacity 0.12s;
}
/*
 * 行分组：给每一条"队员行"加一条极淡的底 + 左侧色条 —— 间距拉大后（见 `ROW_GAP`），
 * 光靠留白不容易看清"上下两个图标属于同一行"。
 *
 * ⚠️ 用**半透明**底色（不用实色 + `z-index: -1`）：`extend` 到行外的实色块会把时间网格线盖掉，
 * 半透明则网格仍隐约可见。
 */
.row::before {
  content: "";
  position: absolute;
  left: -54px;
  right: -4px;
  top: -3px;
  bottom: -3px;
  background: #ffffff08;
  border-radius: 4px;
  pointer-events: none;
}
.row.l::before {
  border-left: 2px solid #2f6fa855;
}
.row.r::before {
  border-left: 2px solid #a85a3455;
}
.row.dim {
  opacity: 0.22;
}
.who {
  position: absolute;
  left: -52px;
  top: 14px;
  width: 48px;
  font-size: 10px;
  color: var(--dim, #9aa5b8);
}
.who.l {
  color: #7fb4e8;
}
.who.r {
  color: #d99a72;
}
.track {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
}
.hp {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: #10131a;
  border-radius: 2px;
  overflow: hidden;
}
.hp-fill {
  display: block;
  height: 100%;
}
.hp-fill.l {
  background: #4da8ff;
}
.hp-fill.r {
  background: #e0774a;
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  height: 10px;
  background: #10131a;
  border-radius: 4px;
}
.seg {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 3px;
  /*
   * 段的悬停：**只纵向加粗、宽度不变**（用户要求）。
   *
   * ⚠️ 不能靠全局 `[data-float]:hover { transform: scale(1.06) }` —— 那会横向也变宽，
   * 而横轴是时间、**宽度是有意义的量**（变宽等于谎报时长）。这里用 `scaleY`：
   * 宽度严格不动，只上下各溢出约 2px，像"这一格被压厚了一点"。
   */
  transition: transform 0.1s ease-out;
  transform-origin: center;
}
.seg:hover {
  transform: scaleY(1.45);
  z-index: 3;
}
/* —— 段色：与 WeaponTimeline 完全一致 —— */
.seg.fire {
  background: linear-gradient(#4da8ff, #2f7fd0);
  /*
   * ⚠️ **一击的开火段宽度只有 3px**（见 `segsOf` 的说明），必须**画在最上层**，
   * 否则会被同起点的 `gap`（单发武器的冷却从开火那一刻就算）整条盖住，
   * 表现成"先冷却、再开火"（用户："圣甲虫看起来就是前摇0.1+冷却然后才开火"）。
   */
  z-index: 2;
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
 * **部署/架设**（`modifier_intro` 那段）—— 与其它段**明显不同**的青色斜纹：
 * 它既不是"在输出"（fire）也不是"在等"（gap/charge），而是**停下来做一件事**，
 * 而且对 MLRS 这类单位这段时间**战斗力为零**（没架完不能开火）。
 */
.seg.deploy {
  background: repeating-linear-gradient(45deg, #1d4a48, #1d4a48 4px, #2f8a84 4px, #2f8a84 8px);
}
.seg.gap.dead {
  background: #2a2f3a;
}
/* 段自带的伤害落点刻度 */
.tick {
  position: absolute;
  height: 16px;
  width: 3px;
  background: #ffcc55;
  border-radius: 1px;
  box-shadow: 0 0 3px #ffcc5588;
  pointer-events: none;
}

/*
 * ── 标志（图形在 `web/src/icons.ts` 的 `MARK_ICONS`，这里只管位置与颜色）──
 * `top`/`left` 给的是图标中心，所以用 `translate(-50%, -50%)` 对齐到那一格。
 * ⚠️ 悬停**只放大、不位移**（`scale`）—— 全局 `[data-float]:hover` 也改成 scale 了，
 * 因为它原先的 `translateY(-2px)` 会把这句居中位移整条替换掉、图标直接跳走。
 */
.mark {
  position: absolute;
  transform: translate(-50%, -50%);
  opacity: 0.7;
  /*
   * ⚠️ **必须给层级**：标志是 `.stack` 的直接子元素，而行的底色带（`.row::before`）
   * 与后渲染的兄弟节点都会盖在它上面 —— 连同挂在它身上的 tooltip（`[data-tip]:hover::after`）
   * 一起被压住，表现就是"悬停没反应、提示出不来"。
   */
  z-index: 7;
  transition:
    opacity 0.12s,
    filter 0.12s;
}
/* 悬停放大：绕自身中心（`transform-origin` 默认就是中心），位置不变 */
.mark:hover {
  transform: translate(-50%, -50%) scale(1.45);
  opacity: 1;
  z-index: 6;
}
/* ① 攻击：金色剑（左方略偏黄、右方略偏橙，与血量条同色系） */
.mark-atk {
  color: #ffcc55;
}
.mark-atk.aoe {
  color: #ff8a3d;
}
/* ② 受伤：橙红爆裂 */
.mark-dmg {
  color: #ff8a3d;
}
.mark-dmg.aoe {
  color: #ff6a2d;
}
/* ③ 死亡：红骷髅 */
.mark-dmg.killed {
  color: #ff5555;
}
.mark-miss {
  color: #6a7285;
  opacity: 0.6;
}
/* ④ 自爆：亮黄芯（比攻击的金更白、比受伤的橙更亮，配上实心带孔的图形即可分辨） */
.mark-self {
  color: #ffe08a;
  opacity: 0.85;
}
/*
 * ⑥ 架设标注的样式已删 —— 架设改回**时间轴上一段真占位置的段**
 * （由 `sim-chart.ts` 生成，`kind: "deploy"`），页面上不再有单独的标注层。
 */
.deploy-mark {
  display: none;
}
/* ⑤ 格子效果：火（黄）与毒气（黄绿）—— 比直击的火力色更"脏"，一眼分得出不是子弹 */
.mark-fire {
  color: #ffb347;
  opacity: 0.6;
}
.mark-gas {
  color: #b6e34a;
  opacity: 0.6;
}
/* 成对亮起（悬停时）—— 与 `:hover` 同样的"原地放大"，只加发光 */
.mark.on {
  transform: translate(-50%, -50%) scale(1.45);
  opacity: 1;
  filter: drop-shadow(0 0 4px currentColor);
}
/* ⚠️ 伤害数字的样式已删（用户："伤害数字不要了"）：数值统一走 `[data-tip]` 悬停提示。
   若以后要加回来，注意偏移量必须由"时刻"唯一决定，不能用一个随列表增长的下标
   —— 那会让固定位置的数字每次都换高度（findings I237 ⑥）。 */
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
  background: repeating-linear-gradient(45deg, #1d4a48, #1d4a48 3px, #2f8a84 3px, #2f8a84 6px);
}
/* ⚠️ 图例里的标志**用同一个 `MarkIcon`**（同一份图形定义），不另画色块 ——
   否则图例与主图会有两套画法、迟早不一致。 */
.lg {
  position: static;
  transform: none;
  flex: 0 0 auto;
}
.lg.atk {
  color: #ffcc55;
}
.lg.dmg {
  color: #ff8a3d;
}
.lg.aoe {
  color: #ff6a2d;
}
.lg.skull {
  color: #ff5555;
}
.lg.self {
  color: #ffe08a;
}
.lg.fire {
  color: #ffb347;
}
.lg.gas {
  color: #b6e34a;
}
.dim {
  margin-left: auto;
}
</style>
