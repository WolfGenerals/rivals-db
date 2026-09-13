/**
 * 小队时序的**段算法** —— `WeaponTimeline`（单位页武器卡）与 `BattleTimeline`（战斗时间线）
 * **共用这一份**，不允许各自再算一遍。
 *
 * 段语义（两边完全一致）：
 *
 * | 段 | 含义 | 算式 |
 * | --- | --- | --- |
 * | `charge` 前摇 | 开火前的蓄力 | `charge_ms`；`chargeInCycle` 为真时它**在周期内** |
 * | `fire` 开火 | 真正在输出 | `hits × interval_ms`；`interval = 0`（齐射/一击）时**跨度为 0**，只出金刻度 |
 * | `gap` 冷却 | 一轮里剩下的等待 | `周期 − 周期内前摇 − 开火跨度` |
 * | `reload` 装填 | 弹夹打空后的装填 | **剩余** = `reload_ms − charge_ms − (容量 − 1) × interval_ms`（窗口从首发开始，I201） |
 *
 * ⚠️ **零宽度的开火段是有意的**：一击 / 同轮齐射没有"开火跨度"这个阶段，
 * 硬塞一个可见宽度就会盖住冷却段，于是"有前摇的单位蓝条和没有的长得不一样"
 * —— 这正是 `WeaponTimeline` 当初修掉的问题（findings I168/I169/I204）。
 * 它的可见性由**金刻度**承担，本模块照样返回那条 `ms: 0` 的记录（带 `ticks`）。
 */

import type { Track } from "@rivals/core/derive";

import { fmtSec } from "./format.ts";

export interface Seg {
  kind: "charge" | "fire" | "gap" | "reload" | "deploy" | "stage" | "death";
  /** 左边界（毫秒，相对该队员的时间轴起点） */
  at: number;
  /** 宽度（毫秒）；`fire` 的一瞬间为 0 */
  ms: number;
  /** 段上的伤害落点（毫秒，相对时间轴起点） */
  ticks?: number[];
  title: string;
  /**
   * 段里写的小字（分段武器标"段 1/2/3"；其余不用）。
   *
   * ⚠️ 加这个字段而不是另建一套段模型 —— `WeaponTimeline` / `BattleTimeline`
   * 共用这里的 `Seg`，两边的段语义与配色必须一直保持一致。
   */
  label?: string;
  /**
   * **这个动作是谁做的** —— 决定它要不要按队员错开。
   *
   * | 值 | 含义 | 例子 |
   * | --- | --- | --- |
   * | `"member"`（默认） | **成员级**：每个队员各自错开 `attackSeparationDurationMS` | 开火、首发充能（每把武器各付一次） |
   * | `"squad"` | **单位级**：全队**同时**发生，**不按队员错开** | 部署 / 撤收（用户：「部署不是同时（游戏里是同时）」「部署条依旧没有上下对齐」） |
   */
  scope?: "squad" | "member";
  /**
   * **只画在第一轮**（不随周期重复）。
   *
   * 用于"一次性"的东西：**首发的充能**（`initialChargeUpMs`，只付一次）、**部署**（架一次）。
   * 它们不是周期的一部分，重复画就是谎报"每轮都要等 4.5 秒"。
   */
  once?: boolean;
}

/**
 * **部署/架设动作** —— `modifier_intro` 那一段（`stats.deploy_ms`）。
 *
 * 用户指出"时序条怎么没有部署动作"：它确实不该缺席 —— 对 MLRS 这类单位，
 * **没架完根本不能开火**，那 2~5 秒是战斗力为零的窗口；对壁虱坦克，
 * 它是"停下来才拿到的 70% 减伤"。两种情况的时长都来自 `modifier_intro.durationMs`。
 *
 * 画法：一条**在相位条最前面**的独立段（颜色另给），后面才接前摇/开火/冷却。
 */
export function deploySeg(deployMs: number, title: string): Seg {
  return { kind: "deploy", at: 0, ms: deployMs, title };
}

/**
 * 一名队员在**一个周期内**的段。
 *
 * ⚠️ **段在返回数组里的顺序 = DOM 渲染顺序 = 叠放次序**（后画的在上面）。
 * 单发武器的刀口是"冷却从开火那一刻就开始"（`coolMs = cycle − charge`、`fireSpan = 0`），
 * 所以 `gap` 与 `fire` **完全重合**；早先先推 `fire` 后推 `gap`，结果**冷却盖住了开火**，
 * 画出来像"先冷却、再开火"（用户："圣甲虫看起来就是前摇0.1+冷却然后才开火"）。
 * 所以全部改成：**先推 gap，最后推 fire**（fire 永远在最上层）。
 */
export function baseSegsOf(tracks: Track[], opts: { repeat?: boolean } = {}): Seg[] {
  /*
   * **只发一轮的轨不画冷却** —— 圣甲虫是代表：`hits: 1`（发完就自爆），
   * `cooldown = 5s` 是"下次还要等 5 秒"，但它**根本没有下次**。
   * 早先按周期照铺，于是"人都炸了，后面还挂着一条冷却"（用户："导致出现了冷却条(尽管死了)"）。
   *
   * 判据来自**卡组自己的"开火序列"语义**：`ability_*_weapon_sequence` 跑完一遍就结束，
   * 没有下一轮；只有**周期型**的武器才有"第二轮"。调用方按
   * `self_destruct`（自杀式）= 一轮 传入 `repeat: false`。
   */
  const repeat = opts.repeat !== false;
  const out: Seg[] = [];
  for (const t of tracks) {
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
      /*
       * ⚠️ **连打跨度 = `(容量 − 1) × 间隔`，不是 `容量 × 间隔`** —— 3 发的弹夹只有 **2 个**间隔
       * （首发落在连打的左端点上）。写成 `clip × iv` 会多算一个间隔，把"剩余装填"画短。
       *
       * ⚠️ **装填窗口从首发就开始**（面板公式 `clip ÷ reloadTimeMs` 即整轮周期，I201），
       * 所以这一轮的总长就是 `reload_ms`：连打段之后画的是**剩余**的装填段，
       * 而不是「连打 + 完整装填」叠起来（那会把周期画长 3~15%）。
       * 剩余量 = `reload − 前摇 − 连打跨度`（前摇也在窗口内，落在首发的左边）。
       */
      const fireMs = Math.max(0, tm.clip - 1) * iv;
      const reloadRest = Math.max(0, tm.reload_ms - charge - fireMs);
      const fireAt = start + charge;
      const ticks = Array.from({ length: tm.clip }, (_, i) => fireAt + i * iv);
      out.push({
        kind: "reload",
        at: fireAt + fireMs,
        ms: reloadRest,
        title: `剩余装填 ${fmtSec(reloadRest)}（共 ${fmtSec(tm.reload_ms)}）`,
      });
      out.push({
        kind: "fire",
        at: fireAt,
        ms: fireMs,
        ticks,
        title: `连打 ${tm.clip} 发（每 ${fmtSec(iv)} 一发，共 ${fmtSec(fireMs)}）`,
      });
      if (charge > 0) {
        out.push({
          kind: "charge",
          at: start,
          ms: charge,
          title: `前摇 ${fmtSec(charge)}（开火前）`,
        });
      }
      continue;
    }

    const iv = tm.interval_ms ?? tm.cycle_ms;
    /*
     * **同轮各发同时出膛**（`interval_ms === 0` 或缺失）—— 数据写明齐射的（烈焰之手
     * `MuzzleStrategy.All`）与**没写**每发间隔的（网际光轮）都按此处理，见 I203。
     * 它**不是"连打"**：几发落在同一毫秒，开火是**一瞬间**（只有金刻度）。
     */
    const simultaneous = tm.hits > 1 && iv <= 0;
    const inCycleCharge = t.chargeInCycle === true && charge > 0;
    const cadenced = !simultaneous && tm.hits > 1;
    const fireSpan = cadenced ? tm.hits * iv : 0;
    /*
     * **冷却段 = 一轮里"既不在前摇、也不在开火跨度里"的剩余时间**：
     * `周期 − 周期内的前摇 − 开火跨度`，不给任何单位开特例（I204）。
     * ⚠️ 减的必须是**周期内**的前摇：`chargeInCycle` 为假时蓄力是连打**之前**的独立阶段。
     */
    const coolMs = Math.max(0, tm.cycle_ms - (inCycleCharge ? charge : 0) - fireSpan);
    const fireAt = start + charge;
    const ticks = Array.from(
      { length: Math.max(1, tm.hits) },
      (_, i) => fireAt + (simultaneous ? 0 : i * iv),
    );

    // 冷却段先推 —— 单发武器的 gap 起点与 fire 起点**重合**，所以 fire 必须后推（后画在上层）
    if (coolMs > 0 && repeat) {
      out.push({
        kind: "gap",
        at: fireAt + fireSpan,
        ms: coolMs,
        title: `冷却 ${fmtSec(coolMs)}（一轮 ${fmtSec(tm.cycle_ms)}）`,
      });
    }
    out.push({
      kind: "fire",
      at: fireAt,
      ms: fireSpan,
      ticks,
      title:
        fireSpan > 0
          ? `连打 ${tm.hits} 发（每 ${fmtSec(iv)} 一发）`
          : simultaneous
            ? `开火：${tm.hits} 发同时出膛`
            : "开火：一击",
    });
    if (charge > 0) {
      out.push({
        kind: "charge",
        /*
         * ⚠️ **起点是 `start`，不是 `fireAt`** —— 前摇是"开火**之前**的那段时间"，
         * 早先写成 `at: fireAt`（= `start + charge`）于是它**被放在了开火之后**、
         * 宽度为 0 完全看不见，图上只剩"等待 + 一击"，前摇整段丢失。
         */
        at: start,
        ms: charge,
        title: `前摇 ${fmtSec(charge)}（开火前）`,
      });
    }
  }
  return out;
}

/**
 * 一段基础周期里"**这一轮从哪一刻开始**" —— 即所有段里最靠左的起点（通常是 0）。
 *
 * 它是"把整条周期锚定到某个真实开火时刻"用的：`fire` 落在 `charge` 之后，
 * 所以锚点 = `首发时刻 − baseStart`。用 `min(at)` 而不是写死 0 —— 多段
 * （`sequence` / `reload`）时各段的 `at` 不都是从 0 起的。
 */
export function baseStart(segs: Seg[]): number {
  if (!segs.length) return 0;
  return Math.min(...segs.map((s) => s.at));
}

/**
 * 一个队员的时间轴总长（毫秒）—— **周期才是这条轴的真正长度**。
 *
 * ⚠️ 只取"段终点"是错的：单发武器的段只有几毫秒，整条跨度会塌成几毫秒，
 * 那一点点伤害段就**铺满全宽**，看起来像"一直在打"（弹弓被这么画坏过，I168）。
 */
export function cycleMsOf(tracks: Track[], segs: Seg[]): number {
  const spans = segs.map((s) => s.at + s.ms);
  for (const t of tracks) {
    const tm = t.timing;
    if (tm.kind === "单发") spans.push(tm.cycle_ms);
    // 装填型的一轮总长 = `reload_ms`（装填窗口从首发开始，连打在窗口内，I201）
    else if (tm.kind === "装填") spans.push(tm.reload_ms);
    else spans.push(tm.charge_ms);
  }
  return Math.max(1, ...spans);
}

/** 横轴跨度：最后一名队员的起点 + 一个周期 */
export function spanMsOf(tracks: Track[], waveSize: number, separationMs: number): number {
  const cycle = cycleMsOf(tracks, baseSegsOf(tracks));
  const shift = Math.max(0, waveSize - 1) * separationMs;
  return Math.max(cycle, shift + cycle) || 1;
}
