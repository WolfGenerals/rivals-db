/**
 * **弹夹类武器** —— 记录状态与事件，**补满弹药时刻由它推**。
 *
 * ## 公式（用户给的，findings J47）
 *
 * ```
 * 补满弹药时刻 = 本次连射的**首发时刻** + (已打出的发数 / 弹夹容量) × 装填时间
 * ```
 *
 * 口径与自证：用户原话「剩下弹药比例 × 装填时间 + 发射时刻 = 补满弹药时刻」+
 * 「按照打第一发去时间，MLRS 装填 5S」。MLRS 打光 3 发 ⇒ `首发 + 3/3 × 5000 = 首发 + 5s` ✓
 * （若按"剩下的比例"读，打光时剩下 0 ⇒ 补满时刻 = 发射时刻，与 5S 矛盾 ⇒ 取"**打出去的比例**"）。
 *
 * ## 状态（四段）与事件（两个）
 *
 * ```
 * charging      ← 弹夹**第一发**之前的前摇（出生时一次；之后落在装填那段的尾巴里）
 * cooling       ← 弹夹内两发之间（还有弹，等下一发）
 * wait_reload   ← **弹夹空了，在等补满**（只有这一族有）
 * idle          ← 没得打（`update(null)`）；⚠️ 只有弹夹满了才算 idle，没弹时仍是 wait_reload
 * firing        ← **事件**：开火那一瞬
 * reload        ← **事件**：**补满那一刻**（"装填中"那段是 wait_reload 状态）
 * ```
 *
 * ## 一轮的时间线（MLRS 真数：弹夹 3 / 间隔 250 / 前摇 250 / 装填 5000）
 *
 * ```
 * charging[0,250)  cooling[250,750)  wait_reload[750,5000)  charging[5000,5250)
 *   └ 首发 250        └ 500、750       └ 空夹等补满(5250)      └ 前摇落在装填尾巴
 * 事件：firing@250 · firing@500 · firing@750 · reload@5250 · firing@5250 …
 * ```
 *
 * ⚠️ **周期 = `reloadTimeMs`**（从弹夹第一发到下一轮第一发）：5250 − 250 = 5000 ✓
 * —— 前摇落在装填那段的尾巴里，**不额外叠加**，所以面板公式
 * （`伤害 × clipSize × waveSize × 1000 ÷ reloadTimeMs`）是精确的。
 */

import { WeaponMachine } from "./weapon-machine.ts";
import type { MagazineParams } from "./weapon-machine.ts";
import type { Clock } from "../clock.ts";

export class MagazineWeapon extends WeaponMachine {
  readonly params: MagazineParams;

  /** 弹夹里现在还有几发 */
  #ammo: number;
  /** 本次连射的**首发时刻**（`null` = 这一轮还没开过火） */
  #burstFirstAtMs: number | null = null;
  /** 本次连射已经打出去几发 */
  #burstShots = 0;
  /** 下一发不早于这个时刻 */
  #nextShotAtMs: number;
  /** **补满弹药时刻**（`null` = 没在装填） */
  #refillAtMs: number | null = null;
  /** 下一发是不是这一夹的**第一发**（第一发之前是 `charging`，其余是 `cooling`） */
  #clipStartPending = true;
  /** 还没被驱动过 */
  #started = false;
  /** 首次驱动时刻（出生那次前摇从它算） */
  #startedAtMs = 0;

  constructor(clock: Clock, params: MagazineParams) {
    super(clock);
    this.params = params;
    this.#ammo = params.clipSize;
    this.#nextShotAtMs = 0;
  }

  get ammo(): number {
    return this.#ammo;
  }
  /** **补满弹药时刻** —— 时间轴/进度条直接读它 */
  get refillAtMs(): number | null {
    return this.#refillAtMs;
  }
  /** 本次连射打了多少发（打一半就停时，补满时刻是按它算的） */
  get burstShots(): number {
    return this.#burstShots;
  }

  update(target: unknown | null): boolean {
    const nowMs = this.nowMs;

    // ① 首次驱动 ⇒ 弹夹第一发之前要付一次前摇（`init_charging`）
    if (!this.#started) {
      this.#started = true;
      this.#startedAtMs = nowMs;
      this.#nextShotAtMs = nowMs + this.params.chargeUpMs;
    }

    // ② 补满：到点就一次性回满，并记下**装填事件**（不看有没有目标 —— 它是时间，照走）
    if (this.#refillAtMs !== null && nowMs >= this.#refillAtMs) {
      this.#ammo = this.params.clipSize;
      this.#refillAtMs = null;
      this.#burstFirstAtMs = null;
      this.#burstShots = 0;
      this.#clipStartPending = true;
      this.#nextShotAtMs = nowMs; // 补满即能打（前摇已在上一段的尾巴里付过）
      this.addEvent(nowMs, "reload");
    }

    // ③ 没弹 ⇒ 在等补满：尾巴那一段是前摇，其余是 wait_reload
    if (this.#ammo <= 0) {
      const chargeFromMs = this.#refillAtMs === null ? null : this.#refillAtMs - this.params.chargeUpMs;
      this.setState(nowMs, chargeFromMs !== null && nowMs >= chargeFromMs ? "charging" : "wait_reload");
      return false;
    }
    // ④ 没得打就不打
    if (target === null) {
      this.setState(nowMs, "idle");
      return false;
    }
    // ⑤ 数据错就别连喷
    if (this.params.clipSize <= 0 || this.params.reloadTimeMs <= 0) {
      this.setState(nowMs, "idle");
      return false;
    }
    // ⑥ 还没到下一发：**出生那一次**是 init_charging，之后第一发之前是 charging，其余是 cooling
    if (nowMs < this.#nextShotAtMs) {
      const isFirstShotEver = this.shots.length === 0;
      const initUntilMs = this.#startedAtMs + this.params.chargeUpMs;
      if (isFirstShotEver && nowMs < initUntilMs) {
        this.setState(nowMs, "init_charging");
      } else {
        this.setState(nowMs, this.#clipStartPending ? "charging" : "cooling");
      }
      return false;
    }

    // ⑦ 开火 —— 记事件、扣弹、并把**新的补满时刻**算出来
    if (this.#burstFirstAtMs === null) this.#burstFirstAtMs = nowMs;
    this.#burstShots++;
    this.#ammo--;
    this.#clipStartPending = false;
    this.#nextShotAtMs = nowMs + this.params.gapMs;
    this.#refillAtMs = this.#burstFirstAtMs + (this.#burstShots / this.params.clipSize) * this.params.reloadTimeMs;
    this.addEvent(nowMs, "firing");
    // 这一发打完：还有弹 ⇒ 等下一发（cooling）；打空了 ⇒ 等补满（wait_reload）
    this.setState(nowMs, this.#ammo > 0 ? "cooling" : "wait_reload");
    return true;
  }
}
