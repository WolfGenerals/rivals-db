/**
 * **武器状态机（基类 + 挑选器）** —— 几个**小类**，各自管一种类型的武器。
 *
 * ## 三条原则（用户定的，findings J47）
 *
 * 1. **取决于实际情况** —— 每帧 `update(target)` **现查**，**不预排时间表**。
 * 2. **状态与事件分开记** —— 状态是**有持续**的一段，事件是**瞬时**一点；
 *    ⚠️ **同状态到同状态也算一次变更**（MLRS 打一发 → cooling，再打一发 → **又一段** cooling），
 *    所以"事件会打断状态段"：记过事件之后，下一次 `setState`（哪怕是同名）开一段新的。
 * 3. **只依赖入参构建，不依赖单位** —— 构造只吃**时钟 + 数**；"在打谁"由 `update(target)` 喂。
 *
 * ## 状态 vs 事件
 *
 * | 类 | 状态（有持续） | 事件（瞬时） |
 * | --- | --- | --- |
 * | **循环**（单发/多发/常规） | `charging` · `cooling` · `idle` | `firing` |
 * | **弹夹** | `charging` · `cooling` · `wait_reload` · `idle` | `firing` · `reload` |
 * | **分段**（光束炮/蛇怪） | `charging` · `cooling` · `idle` | `firing` · `stage` |
 *
 * - `charging` = 前摇（要开火了，正在起手）
 * - `cooling` = 冷却 / 等下一发
 * - `wait_reload` = 弹夹空了在等补满（只有弹夹类）
 * - `idle` = 没得打
 * - `firing` = 开火那一瞬 · `reload` = 补满那一刻 · `stage` = 换段那一刻
 *
 * ## 所以这里**没有**什么
 *
 * 没有单位引用、没有指令流、没有命令队列、没有生成器、没有黑板对象
 * （跨交战的持久状态就住在武器机自己身上）、没有"枪口"这个概念。
 */

import type { Clock } from "../clock.ts";
import type { WeaponDef } from "../weapon-def.ts";
import { TimelineRecorder } from "../timeline.ts";
import type { StateEntry, EventEntry } from "../timeline.ts";

/** 时间轴上的一段**状态**（= 共用记录器的 `StateEntry`） */
export type WeaponState = StateEntry;

/** 时间轴上的一个**事件**（瞬时一点）（= 共用记录器的 `EventEntry`） */
export type WeaponEvent = EventEntry;

export abstract class WeaponMachine extends TimelineRecorder {
  /** **发射时机** —— 从事件里筛，不另存一份 */
  get shots(): number[] {
    return this.timesOf("firing");
  }

  /** **每帧驱动一次** —— 唯一的入口 */
  abstract update(target: unknown | null): boolean;
}

// ─────────────────────────────────────────────────────────────
// 参数 = `WeaponDef.timing` 里对应的那一支（**不另设一套字段、不需要挑选器**）
// ─────────────────────────────────────────────────────────────

import type { Timing } from "../weapon-def.ts";

/** 循环类的参数 —— 就是 `timing` 的 `cyclic` 那一支 */
export type CyclicParams = Extract<Timing, { kind: "cyclic" }>;
/** 弹夹类的参数 —— 就是 `timing` 的 `magazine` 那一支 */
export type MagazineParams = Extract<Timing, { kind: "magazine" }>;
/** 分段类的参数 —— 就是 `timing` 的 `staged` 那一支 */
export type StagedParams = Extract<Timing, { kind: "staged" }>;
