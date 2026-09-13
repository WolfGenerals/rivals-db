/**
 * **持续效果机** —— 挂在单位 / 小队上、"条件满足就按节拍生效"的东西：
 * 持续伤害（火 / 毒 / 泰矿）、回血、护盾之类的**带节拍**效果。
 *
 * ## 状态与事件（**从源码读出来的**，不是造的）
 *
 * `modifier_self_heal.lua:29-64` 的 `repeat … until` 里就是三段：
 *
 * ```lua
 * idle = squad:IsIdle() or (squad:IsMoving() and not squad:InCombat())
 * if idle and not self.wasIdle then waitForAgeHeal = curAge + healingDelayMs end  -- 刚闲下来 ⇒ 起倒计时
 * if waitForAgeHeal > curAge then thread:WaitForAge(waitForAgeHeal) end           -- 等
 * ... if idle and damaged then 回血 ... thread:WaitForDuration(tickPeriodMs)      -- 生效 + 每周期再试
 * ```
 *
 * | 状态 | 什么时候 |
 * | --- | --- |
 * | `idle` | **条件不满足**（在战斗 / 在移动 / 没受伤…）—— 什么都不做，倒计时也清掉 |
 * | `waiting` | 条件满足了，但还在等 `delayMs`（回血是 `healingDelayMs`） |
 * | `active` | 到点了，正在生效（每 `tickMs` 一跳） |
 *
 * | 事件 | 什么时候 |
 * | --- | --- |
 * | `tick` | **每一跳**（消费方在这里去结算伤害/治疗） |
 * | `end` | 被外部叫停（源码 `RemoveReference` → `MarkForDelete`） |
 *
 * ## 两个源码细节，都照抄
 *
 * 1. **补跳**：DoT 是 `while lastDamageTime + tickPeriodMs < age do … end`（`modifier_unstackable_damage_over_time.lua:33-36`）
 *    ⇒ 一帧里该跳几跳就跳几跳，**帧长不影响总量**。所以这里也是 `while`，不是 `if`。
 *    ⚠️ 源码里这几跳是**在同一个 `OnUpdate` 里连着结算**的 ⇒ 它们的 `at` 都是**发现它们的那一帧**，
 *    不是各自"本该"的节拍时刻（补跳只保证**次数/总量**，不保证**时刻**）。
 * 2. **首次生效时刻**：回血是"等完 `healingDelayMs` **立刻**生效"；DoT 是
 *    `lastDamageTime` 从 0 起算 ⇒ **一个 `tickPeriodMs` 之后**才第一跳。
 *    两者用同一个口径表达：**首次在 `条件满足 + delayMs`**（回血填 `healingDelayMs`、DoT 填 `tickPeriodMs`）。
 *
 * ## 它不做什么
 *
 * 不碰伤害数值、不认识 `Unit`、不看格子 —— 它只回答"**这一帧跳没跳**"，
 * 由调用方（伤害层）拿 `tick` 事件去结算。和武器机一个分工（J47）。
 */

import { TimelineRecorder } from "../timeline.ts";
import type { Clock } from "../clock.ts";

/** 效果参数（构造只吃数） */
export interface EffectParams {
  /** 每一跳的间隔（源码 `tickPeriodMs`） */
  tickMs: number;
  /**
   * **首次生效前**要等多久（不填 = 立刻）。
   * 回血填 `healingDelayMs`；DoT 填 `tickPeriodMs`（源码 `lastDamageTime` 从 0 起算）。
   */
  delayMs?: number;
}

export class EffectMachine extends TimelineRecorder {
  readonly params: EffectParams;

  /** 条件从什么时候开始满足的（`null` = 现在不满足） */
  #conditionSinceMs: number | null = null;
  /** 下一跳不早于这个时刻（`null` = 还没起算） */
  #nextTickAtMs: number | null = null;
  /** 被外部叫停了吗 */
  #done = false;

  constructor(clock: Clock, params: EffectParams) {
    super(clock);
    this.params = params;
  }

  /** 每一跳的时刻（消费方要"补跳"时按它结算） */
  get ticks(): number[] {
    return this.timesOf("tick");
  }

  /** 现在还在生效吗 */
  get alive(): boolean {
    return !this.#done;
  }

  /**
   * **每帧驱动一次。**
   *
   * @param conditionMet **条件满足吗** —— 由调用方按源码口径算好喂进来
   *   （回血是 `IsIdle() or (IsMoving() and not InCombat())` 且受过伤）
   * @returns 这一帧跳了没有（事件里已经记下 `tick`）
   */
  update(conditionMet: boolean): boolean {
    if (this.#done) return false;
    const nowMs = this.nowMs;

    // ① 条件不满足 ⇒ 闲着，倒计时清掉（下次满足要重新等）
    if (!conditionMet) {
      this.#conditionSinceMs = null;
      this.#nextTickAtMs = null;
      this.setState(nowMs, "idle");
      return false;
    }
    // ② 条件刚满足 ⇒ 起倒计时
    if (this.#conditionSinceMs === null) {
      this.#conditionSinceMs = nowMs;
      this.#nextTickAtMs = nowMs + (this.params.delayMs ?? 0);
    }
    // ③ 还在等
    if (nowMs < (this.#nextTickAtMs ?? 0)) {
      this.setState(nowMs, "waiting");
      return false;
    }

    // ④ 生效 —— **补跳**：一帧里该跳几跳就跳几跳（源码是 `while`）
    this.setState(nowMs, "active");
    const period = this.params.tickMs;
    let fired = false;
    if (period > 0) {
      while (nowMs >= (this.#nextTickAtMs ?? 0)) {
        this.addEvent(nowMs, "tick");
        this.#nextTickAtMs = (this.#nextTickAtMs ?? 0) + period;
        fired = true;
      }
    } else {
      // 周期为 0 的坏数据：一帧一跳，别死循环
      this.addEvent(nowMs, "tick");
      this.#nextTickAtMs = nowMs + 1;
      fired = true;
    }
    return fired;
  }

  /** **外部叫停**（源码 `RemoveReference` → `MarkForDelete`）——记下 `end` 事件后不再跳 */
  stop(): void {
    if (this.#done) return;
    this.#done = true;
    this.addEvent(this.nowMs, "end");
  }
}
