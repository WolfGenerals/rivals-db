/**
 * **循环类武器** —— "周期 + 前摇，一轮打 `hits` 发"。覆盖 `单发` 那 79 条轨道。
 *
 * | 族 | 数从哪来 |
 * | --- | --- |
 * | `simple`（弹弓/狼獾/忏悔者/烈焰之手…） | 序列调参 `burstCooldown` / `chargeUpDuration` / `initialChargeUpMs` |
 * | `burst`（步枪兵…） | `burstTiming`（秒） |
 * | 多发（科迪亚克 3 发 / 沙暴 12 发 / 干扰者 20 跳…） | `numToBurst`/`attackCount` + `fireRate`/`tickPeriodMs`… |
 *
 * ## 一轮的形状
 *
 * ```
 * 轮首 ──前摇──→ 第 1 发 ──间隔──→ 第 2 发 ──间隔──→ … ──→ 轮首 + 周期
 * ```
 *
 * **周期 = `cooldownMs`**（前摇与轮内间隔都在它**之内**，不额外叠加）；
 * `initialChargeUpMs` 是**第一次**开火之前的一次性蓄力（首次驱动起算）。
 *
 * ## 状态与事件
 *
 * ```
 * init_charging ← **首轮蓄力**（`initialChargeUpMs`，一辈子只付一次）
 * charging      ← **每轮前摇**（`chargeUpMs`，每轮都要付）
 * cooling       ← 其余时间（轮内两发之间 + 一轮打完到下一轮前摇）
 * idle          ← `update(null)`
 * firing        ← **事件**：开火那一瞬
 * ```
 *
 * ⚠️ **首轮蓄力与每轮前摇是两段**（用户指出）—— 哪怕首轮只打一发，
 * 时间轴上也看得到"先 init_charging 再 charging"。
 *
 * ⚠️ **多发时每发之间算新的一段 `cooling`**（同名也记）—— 那是不同的间隔，
 * 时间轴要能一段段画出来。
 */

import { WeaponMachine } from "./weapon-machine.ts";
import type { CyclicParams } from "./weapon-machine.ts";
import type { Clock } from "../clock.ts";

export class CyclicWeapon extends WeaponMachine {
  readonly params: CyclicParams;

  /** **本轮**第一发不早于这个时刻（轮首 + 前摇） */
  #roundFirstAtMs: number;
  /** 本轮已经打了几发 */
  #shotsThisRound = 0;
  /** 首次驱动时刻（首轮蓄力从这里算）；`null` = 还没驱动过 */
  #cycleStartMs: number | null = null;

  /** 上一次是"没得打"吗（断了再回来 ⇒ 前摇重付） */
  #targetWasMissing = false;
  #resumeAtMs: number | null = null;

  constructor(clock: Clock, params: CyclicParams) {
    super(clock);
    this.params = params;
    this.#roundFirstAtMs = Number.POSITIVE_INFINITY; // 首次 update 时定下来
  }

  /** 下一发不早于这个时刻（进度条/时间轴用） */
  get nextFireAtMs(): number {
    return this.#roundFirstAtMs + this.#shotsThisRound * this.params.intervalMs;
  }

  update(target: unknown | null): boolean {
    const nowMs = this.nowMs;

    // ① 首次驱动 ⇒ 首轮蓄力 + 首轮前摇从这一刻起算
    if (this.#cycleStartMs === null) {
      this.#cycleStartMs = nowMs;
      this.#roundFirstAtMs = nowMs + this.params.initialChargeUpMs + this.params.chargeUpMs;
    }

    // ② 没得打就不打（计时照常走）
    if (target === null) {
      this.#targetWasMissing = true;
      this.#resumeAtMs = null;
      this.setState(nowMs, "idle");
      return false;
    }
    // ③ 刚恢复 ⇒ 记下时刻，并把**轮首重新锚到这里**（不然过期锚点会让下一轮连喷）
    if (this.#targetWasMissing) {
      this.#resumeAtMs = nowMs;
      this.#roundFirstAtMs = Math.max(this.#roundFirstAtMs, nowMs);
      this.#targetWasMissing = false;
    }
    // ④ 周期为 0 会一帧一发的连喷，数据错；宁可不打
    if (this.params.cooldownMs <= 0 && this.params.chargeUpMs <= 0) {
      this.setState(nowMs, "idle");
      return false;
    }

    /*
     * ⑤ 这一发到点了没？
     *
     * ⚠️ **前摇是"开火之前要等的最后一段"**：正常轮次它含在 `#roundFirstAtMs` 里
     * （所以周期 = `cooldown`）。但**断了再回来**时那些时刻早成过去式，
     * 直接拉到现在会**跳过前摇** ⇒ 必须取 `max(下一发, 恢复时刻 + 前摇)`。
     */
    const scheduledMs = this.nextFireAtMs;
    const readyAt = this.#resumeAtMs === null ? scheduledMs : Math.max(scheduledMs, this.#resumeAtMs + this.params.chargeUpMs);

    // ⑥ 记状态（三种之一）
    if (nowMs < readyAt) {
      // 前摇有两段：**首轮蓄力**（一辈子一次）与**每轮前摇**（每轮都有）
      const initUntilMs = this.#cycleStartMs + this.params.initialChargeUpMs;
      if (this.shots.length === 0 && nowMs < initUntilMs) {
        this.setState(nowMs, "init_charging");
        return false;
      }
      // ⚠️ **只有本轮第一发之前才是 charging**；多发武器轮内两发之间是 cooling
      const chargingFromMs = this.shots.length === 0 ? initUntilMs : this.#roundFirstAtMs - this.params.chargeUpMs;
      const isRoundFirst = this.#shotsThisRound === 0;
      this.setState(nowMs, isRoundFirst && nowMs >= chargingFromMs ? "charging" : "cooling");
      return false;
    }

    // ⑦ 开火（**事件**），并推进本轮/本周期
    this.addEvent(nowMs, "firing");
    this.#shotsThisRound++;
    this.#resumeAtMs = null;
    this.setState(nowMs, "cooling"); // 发完就是冷却（多发时每发之间又是一段新的 cooling）
    if (this.#shotsThisRound >= this.params.hits) {
      // 本轮打完 ⇒ 下一轮。⚠️ **轮首 += 周期**（不是"上一发 + 周期"）——
      // 周期是从轮首起算的，所以光束炮/巨无霸的 `cycle_ms` 才等于 `hits×间隔 + 余量`。
      this.#shotsThisRound = 0;
      this.#roundFirstAtMs = Math.max(this.#roundFirstAtMs + this.params.cooldownMs, nowMs);
    }
    return true;
  }
}
