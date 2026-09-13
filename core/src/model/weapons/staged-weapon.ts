/**
 * **分段类武器** —— 光束炮 / 蛇怪：一跳一跳地打，**逐段变强**。
 *
 * 源码 `ability_beamcannon_weapon_sequence.lua:48-154`（findings J33 逐行核过）：
 *
 * - 段进度 `attackInfo.count` **跨交战保持**，`storeChargeTimeMs` 之内有效
 *   （`LoadAttackCount` / `SaveAttackCount`）；**过期就从第 1 跳重来**
 * - 每段的循环上界是**累计计数**（光束炮：段 1 是 1..12、段 2 是 13..36、段 3 无限）
 * - 每跳 = `SetCooldown(tickPeriodMs)` + 扣血 + 等 `tickPeriodMs`
 * - **`initialChargeUpMs` 只在 `count <= 1` 时付**（`:69-79`）
 *
 * ## 状态（三段）与事件（两个）
 *
 * ```
 * charging   ← 首轮蓄力（只在"还没打过"时）
 * cooling    ← 两跳之间
 * idle       ← `update(null)`
 * firing     ← **事件**：跳一跳（光柱每 tickPeriodMs 跳一次）
 * stage      ← **事件**：换段那一刻（伤害/副目标数在这里变）
 * ```
 *
 * ⚠️ 段进度不再需要"武器黑板"这种东西 —— **状态就住在武器机自己身上**（J47）。
 */

import { WeaponMachine } from "./weapon-machine.ts";
import type { StagedParams } from "./weapon-machine.ts";
import type { Clock } from "../clock.ts";

export class StagedWeapon extends WeaponMachine {
  readonly params: StagedParams;

  /** 下一跳是第几跳（1 起，累计计数 —— 源码 `attackInfo.count`） */
  #count = 1;
  /** 当前段号（0 起） */
  #stageIndex = 0;
  /** 下一跳不早于这个时刻；`null` = 还没开始 */
  #nextTickAtMs: number | null = null;
  /** 首轮蓄力结束时刻（在这之前是 `charging`） */
  #chargingUntilMs = 0;
  /** 上一跳时刻（进度保质期用它算） */
  #lastAttackAtMs = 0;

  constructor(clock: Clock, params: StagedParams) {
    super(clock);
    this.params = params;
  }

  /** 现在打到第几段（从 1 起） */
  get stage(): number {
    return this.#stageIndex + 1;
  }
  /** 累计跳到第几跳（源码 `attackInfo.count`） */
  get attackCount(): number {
    return this.#count;
  }

  /** 第 `i` 段的**累计**上界（`null` 的末段 ⇒ 无限） */
  #stageEnd(i: number): number {
    const stage = this.params.stages[i];
    if (stage === undefined || stage.attackCount === null) return Number.POSITIVE_INFINITY;
    let end = 0;
    for (let k = 0; k <= i; k++) end += this.params.stages[k]?.attackCount ?? 0;
    return end;
  }

  #period(): number {
    return this.params.stages[this.#stageIndex]?.tickPeriodMs ?? 0;
  }

  update(target: unknown | null): boolean {
    const nowMs = this.nowMs;

    // ① 段进度过期 ⇒ 从第 1 跳重来（源码 `LoadAttackCount`：`lastTime + storeChargeTimeMs >= now`）
    const store = this.params.storeChargeTimeMs;
    if (this.#lastAttackAtMs > 0 && store !== undefined && nowMs - this.#lastAttackAtMs > store) {
      this.#count = 1;
      this.#stageIndex = 0;
      this.#nextTickAtMs = null;
    }

    // ② 首次（或重来）：**只在 `count <= 1` 时付首轮蓄力**
    if (this.#nextTickAtMs === null) {
      const initial = this.#count <= 1 ? this.params.initialChargeUpMs : 0;
      this.#nextTickAtMs = nowMs + initial;
      this.#chargingUntilMs = nowMs + initial;
    }

    // ③ 没得打就不打
    if (target === null) {
      this.setState(nowMs, "idle");
      return false;
    }
    // ④ 还没到下一跳：**首轮蓄力**那一段是 init_charging，其余是 cooling
    if (nowMs < this.#nextTickAtMs) {
      this.setState(nowMs, nowMs < this.#chargingUntilMs ? "init_charging" : "cooling");
      return false;
    }

    // ⑤ 跳一跳
    this.addEvent(nowMs, "firing");
    this.#lastAttackAtMs = nowMs;
    this.#count++;

    // ⑥ 打满了本段 ⇒ 进下一段（末段无限，会一直呆在那儿）
    if (this.#count > this.#stageEnd(this.#stageIndex) && this.#stageIndex + 1 < this.params.stages.length) {
      this.#stageIndex++;
      this.addEvent(nowMs, "stage");
    }

    this.#nextTickAtMs = nowMs + this.#period();
    this.setState(nowMs, "cooling");
    return true;
  }
}
