/**
 * **时间线记录器** —— 状态段 + 事件，**两层共用**（武器机 · 单位/效果行为）。
 *
 * 用户定的形状（findings J47/J56）：**状态是"有持续的一段"，事件是"瞬时一点"**，
 * 两者**分开存**：
 *
 * | 存什么 | 形状 | 例子 |
 * | --- | --- | --- |
 * | `states` | `{ start, state }` | 武器 `charging/cooling` · 效果 `idle/waiting/active` · 部署 `packing/unpacked` |
 * | `events` | `{ at, event }` | 武器 `firing/reload/stage` · 效果 `tick/end` · 部署 `deploy_done` |
 *
 * ⚠️ **"开火""跳一跳""生成"都是事件，不是状态** —— 它们没有持续。
 * ⚠️ **同名状态到同名状态也是一次变更**（MLRS 打一发后又是一段 `cooling`）：
 * 记过事件之后状态段被打断，下一次 `setState`（哪怕同名）开新的一段。
 *
 * ⚠️ 这里**只有记录**，没有驱动、没有指令流、没有生成器 —— 谁在什么时候喊
 * `setState`/`addEvent`，由各层自己的 `update(情况)` 决定。
 */

import type { Clock } from "./clock.ts";

/** 时间轴上的一段**状态**（有持续；末条结束于下一条开始，或调用方给的上界） */
export interface StateEntry {
  /** 这一段从这一刻开始 */
  readonly start: number;
  readonly state: string;
}

/** 时间轴上的一个**事件**（瞬时一点） */
export interface EventEntry {
  readonly at: number;
  readonly event: string;
}

/** 记录器 + 时钟 —— 武器机与效果机都从这里继承 */
export abstract class TimelineRecorder {
  /** **时间从哪来** —— 构造时注入（等价源码 `nTime.GetFixedElapsedMs(gWorld)`） */
  readonly clock: Clock;

  /** **状态序列** —— 每一步"在干什么"从什么时候开始（⚠️ 同名状态可以连着出现多段） */
  readonly states: StateEntry[] = [];

  /** **事件序列** —— 瞬时发生的事（开火 / 跳一跳 / 生成 / 结束…） */
  readonly events: EventEntry[] = [];

  #state: string | null = null;
  /** 记过事件之后要重开一段状态（哪怕同名） */
  #redeclare = false;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** 现在在干什么 */
  get state(): string {
    return this.#state ?? "idle";
  }

  /** 现在几点 */
  protected get nowMs(): number {
    return this.clock.nowMs;
  }

  /** 这一类事件的时刻（时间轴/检索用，不另存一份数组） */
  protected timesOf(event: string): number[] {
    return this.events.filter((e) => e.event === event).map((e) => e.at);
  }

  /**
   * 换状态。
   *
   * ⚠️ **同名也要记**：只要中间发生过事件，就是**新的一段**（MLRS 打一发进 `cooling`、
   * 再打一发又进 `cooling`，那是两段）。
   */
  protected setState(nowMs: number, state: string): void {
    if (!this.#redeclare && this.#state === state) return;
    this.#redeclare = false;
    this.#state = state;
    this.states.push({ start: nowMs, state });
  }

  /** 记一个事件（瞬时）；它会**打断当前状态段** */
  protected addEvent(nowMs: number, event: string): void {
    this.events.push({ at: nowMs, event });
    this.#redeclare = true;
  }
}
