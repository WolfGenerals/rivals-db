/**
 * **部署机（架设 / 撤收）** —— 挂在**单位（战斗员）自己**身上。
 *
 * ## 为什么是单位的，不是武器的（这一条是用户点出来的，源码也站这边）
 *
 * 数据**写在武器槽里**（`weaponTunings[i].modifier_intro/outro`，`CombatUnitTuning.lua:143-144`）
 * 只是因为那儿有个现成的挂件槽 —— **那个槽可以是空的**：壁虱坦克的部署就挂在
 * `unit_nod_ticktank.lua:52-97` 的 `weaponTunings[2]`，那个槽 `name = "hidden"`、
 * `descriptors = { }`（打不了任何东西）、旁边还写着「hidden weapon should not use burst timing」；
 * 连面板取数都得专门指到槽 2 去读（`:173`）。空槽当然不是"某个武器的行为"。
 *
 * 引擎自己也是把状态记在**战斗员**上的：`combatant:GetKillingDeployState() == CombatantDeployState.Packed`
 * （`death/modifier_ticktank_death.lua:8-9`、`death/modifier_mgsquad_death.lua:8-9`）。
 * 而 `self.weapon:GetRemainingUnpackPercent()` 那一串（`common/modifier_simple_intro.lua:15,33`）
 * 是引擎**把动画/进度 API 挂在武器对象上**，不代表语义归属。
 *
 * ⇒ 一台单位**只有一份**部署状态；武器那边只有一条**只读依赖**：没架好不许开火（`readyToFire`）。
 *
 * ## 状态与事件
 *
 * | 状态 | 什么时候 |
 * | --- | --- |
 * | `packed` | 收着 |
 * | `unpacking` | 架设中（源码 `modifier_simple_intro`） |
 * | `unpacked` | 架好了 |
 * | `packing` | 撤收中（源码 `modifier_simple_outro`） |
 *
 * | 事件 | 什么时候 |
 * | --- | --- |
 * | `unpack_done` | 架好那一刻 |
 * | `pack_done` | 收好那一刻 |
 *
 * ⚠️ **移动 / 停止不在这里** —— 它们是**引擎的状态**，Lua 只能读（`modifier_self_heal.lua:32`
 * 的 `IsIdle() or (IsMoving() and not InCombat())`；另外两处 `IsMoving()` 只是选播哪个动画：
 * `ability_avatar_laser_weapon_sequence.lua:65`、`ability_avatar_fire_weapon_sequence.lua:86`），
 * 全树**没有任何一处指挥移动**。所以它们是**喂进来的入参**（`update(wantDeployed)`），
 * 不是本机算出来的状态。
 *
 * ## 进度只有**一个标量**（照抄源码的打断-续做）
 *
 * 源码用 `GetRemainingPackupPercent()` / `GetRemainingUnpackPercent()` 表达同一个进度
 * （前者 = 已架设比例，后者 = 还要架多少），两个 modifier 都只在 `OnDestroy` 里回写：
 *
 * ```lua
 * -- modifier_simple_intro.lua:15,31-33  记：还要架多久 / 总时长
 * local remainingUnpackPercent = Fixed32(1) - self.weapon:GetRemainingPackupPercent()
 * self.timeToWait = Fixed32.toInt(Fixed32(self.tuning.durationMs) * remainingUnpackPercent)
 * ... local remainingUnpackPercent = Fixed32(remainingUnpackMs) / Fixed32(self.tuning.durationMs)
 * self.weapon:SetRemainingUnpackPercent(remainingUnpackPercent)
 * ```
 *
 * ⇒ 打断之后**再从当前比例接着做**：架了 60% 就收，收的时间是 `packMs × 60%`。
 * 本机就是这个形状（一个 `#progressMs` + 换算）。
 *
 * ⚠️ 源码里那个 `< 100`（`modifier_simple_intro.lua:35`）**只决定播哪个动画**，
 * 进度照样回写 ⇒ 我们**不**在最后 100ms 内"算作已架好"。
 *
 * ## 顺带一条真机制：壁虱 / 机枪队的**架设减伤**
 *
 * `common/modifier_damagereduction_intro.lua:33-40`（继承 `modifier_simple_intro`）：
 * `WaitForAge(DAMAGE_REDUCTION_TIME_MS)` 之后才 `AddStatModifier(IncomingDamageReduction, 0.70)`，
 * 而 `modifier_damagereduction_outro.lua:33-40` 在收的过程中**移除**它，
 * 并且 `IM_ASSERT(DAMAGE_REDUCTION_TIME_MS < durationMs)`。
 * 数据：壁虱 intro `durationMs = 2000` / `DAMAGE_REDUCTION_TIME_MS = 1750`、outro `500 / 250`
 * （`unit_nod_ticktank.lua:72-92`）。
 *
 * ⇒ **不是"部署中全程减伤"**：是**架到最后 250ms 起开盾，直到开始收之后 250ms 撤盾**。
 * 本机只报窗口（`shieldActive` / `shieldPercent`），**加不加 stat 是伤害层的事**。
 */

import { TimelineRecorder } from "../timeline.ts";
import type { Clock } from "../clock.ts";

/** 四个状态 —— 与源码的 `Packed` 及"架/收"两个过程一一对应 */
export type DeployPhase = "packed" | "unpacking" | "unpacked" | "packing";

/**
 * 架设期间那面盾（只有壁虱 / 机枪队有）。
 *
 * ⚠️ 两个时刻都是**从该过程开始算起**（源码两条线程都是 `WaitForAge(...)` 等自己的 age），
 * **不是"离结束还剩多少"** —— 壁虱 intro 的 `1750` 是"架了 1750ms 之后开盾"。
 */
export interface DeployShield {
  /** 减伤幅度（**原始小数**；源码 `damageReductionPercent = 70/100`） */
  percent: number;
  /** **从开始架**算起等这么久⇒开盾（源码 intro 的 `DAMAGE_REDUCTION_TIME_MS` = 1750） */
  unpackAfterMs: number;
  /** **从开始收**算起等这么久⇒撤盾（源码 outro 的 `DAMAGE_REDUCTION_TIME_MS` = 250） */
  packAfterMs: number;
}

/** 部署参数（构造只吃数）—— 就是 `UnitDef.deploy` */
export interface DeployParams {
  /** 架起来要多久；源码 `weaponTuning.modifier_intro.tuning.durationMs` */
  unpackMs: number;
  /** 收起来要多久；源码 `weaponTuning.modifier_outro.tuning.durationMs` */
  packMs: number;
  /**
   * **架设能不能被打断**；源码 `weaponTuning.canInterruptIntro`
   * —— 岩石巨虫是 `false`（`unit_nod_rockwyrm.lua:50`），其余部署单位都是 `true`。
   * ⚠️ 反方向（收着的时候反悔再架）源码**没有**对应旗标 ⇒ 本机一律允许（推断）。
   */
  canInterruptIntro?: boolean;
  /**
   * **不架好就不许开火**。派生规则（数据支持）：**有 intro 且没有 `canShootWhileMoving`** ——
   * 只有壁虱坦克写了 `canShootWhileMoving = true`（面板上叫 Raider），所以只有它 `false`。
   */
  mustDeployToFire?: boolean;
  /** 架设减伤窗口（壁虱 / 机枪队） */
  shield?: DeployShield;
  /** **出处**（J52 的硬约束：没有锚点的数不可信） */
  source?: { script?: string; anchors?: string[] };
}

export class DeployMachine extends TimelineRecorder {
  readonly params: DeployParams;

  #phase: DeployPhase;
  /** 当前这个过程已经花了多久（`packing` 时就是"已收多久"） */
  #progressMs = 0;
  /** 那面盾现在挂着吗（**闩锁**，见 `shieldActive`） */
  #shieldOn = false;
  /** **架好那一刻**（毫秒）；`null` = 还没架好 */
  #deployedAtMs: number | null = null;
  /** 上一帧的时钟 —— 本机自己算 `dt`（时钟是注入的绝对时刻） */
  #lastMs: number;

  constructor(clock: Clock, params: DeployParams) {
    super(clock);
    this.params = params;
    this.#lastMs = clock.nowMs;
    // 有 `modifier_intro` 的单位**都从「收着」开始**（还没架过）——
    // 边跑边打的壁虱也一样（它的 `canShootWhileMoving` 只影响"能不能开火"，不影响出生状态）
    this.#phase = "packed";
    this.setState(clock.nowMs, this.#phase);
  }

  // ─────────────────────────────────────────────────────────────
  // 问状态
  // ─────────────────────────────────────────────────────────────

  get phase(): DeployPhase {
    return this.#phase;
  }

  /** 架好了吗（过程中不算） */
  get deployed(): boolean {
    return this.#phase === "unpacked";
  }

  /** 收着吗 */
  get packed(): boolean {
    return this.#phase === "packed";
  }

  /** 正在架或正在收 */
  get transitioning(): boolean {
    return this.#phase === "unpacking" || this.#phase === "packing";
  }

  /**
   * **能不能边跑边打** —— 由 `mustDeployToFire` 决定，**不影响出生状态**。
   *
   * 数据支持：只有壁虱坦克写了 `canShootWhileMoving = true`（面板上叫 Raider），
   * 所以只有它 `mustDeployToFire = false` ⇒ 收着 / 架设中也照样能开火。
   * ⚠️ 但它**照样是要架的单位**（架了才有那 70% 减伤）—— 出生仍是 `packed`。
   */
  get mustDeployToFire(): boolean {
    return this.params.mustDeployToFire ?? true;
  }

  /** **现在能不能开火** */
  get readyToFire(): boolean {
    return this.mustDeployToFire ? this.#phase === "unpacked" : true;
  }

  /** 当前过程还要多久（毫秒）；没在过程中返回 0 */
  get remainingMs(): number {
    if (!this.transitioning) return 0;
    return Math.max(0, this.#totalMs - this.#progressMs);
  }

  /**
   * **架好那一刻**（毫秒）；还没架好就是 `null`。
   *
   * 调用方用它算"架好之后才开始算的相位" —— 队内错开是**从架好那一刻起算**的
   * （用户实测：两只圣甲虫不是同时自爆，第二只要等第一只 2s ⇒ 错开叠加在部署之后）。
   */
  get deployedAtMs(): number | null {
    return this.#deployedAtMs;
  }

  /** 当前过程完成了百分之多少（0–1） */
  get progress(): number {
    if (!this.transitioning) return this.deployed ? 1 : 0;
    return this.#totalMs <= 0 ? 1 : Math.min(1, this.#progressMs / this.#totalMs);
  }

  /**
   * 架设减伤现在生效吗（没配盾的单位恒 `false`）。
   *
   * ⚠️ **是闩锁，不是"照状态算"**：源码那面盾就是一枚**挂在基地黑板上的 stat**
   * （`AddStatModifier` 有 `HasInt` 守卫 ⇒ 不会重复加，`modifier_damagereduction_intro.lua:37-39`），
   * **只由 outro 的那条线程摘掉**（`:37-41`）⇒ 它一旦开了就一直在，直到收的过程走过
   * `packAfterMs`。所以"架好了就一定有盾"是**错的**：没架过的单位（出生就是 `packed`
   * 且从没 `deploy()`）永远没有盾。
   *
   * 直通路径与源码逐项对齐：架设中"已架 ≥ `unpackAfterMs`"开盾（壁虱 1750/2000）、
   * 之后一直挂着、收的过程中"已收 ≥ `packAfterMs`"撤盾（壁虱 250/500）。
   *
   * ⚠️ **打断的情形是近似**：源码的闩锁不随打断丢失（进度也回写），本机用"累计进度"维护
   * 同一枚闩锁 —— 效果一致（打断不会误开/误撤）。
   */
  get shieldActive(): boolean {
    return this.#shieldOn;
  }

  /** 减伤幅度（没配盾时 `0`） */
  get shieldPercent(): number {
    return this.params.shield?.percent ?? 0;
  }

  get #totalMs(): number {
    return this.#phase === "unpacking" ? this.params.unpackMs : this.params.packMs;
  }

  // ─────────────────────────────────────────────────────────────
  // 每帧驱动
  // ─────────────────────────────────────────────────────────────

  /**
   * **每帧驱动一次。**
   *
   * @param wantDeployed **想不想架着** —— 由调用方按引擎侧的情况算好喂进来
   *   （站着 / 有目标 / 在射程内 ⇒ 想架；要跑 ⇒ 不想架）。
   *   `null` = **没意见**（保持现状，引擎没下这个指令）。
   *
   * ⚠️ 顺序是"**先推进时间，再听指令**"：于是"这一帧刚架好"这一刻的 `state` 已经是
   * `unpacked` ⇒ 同一帧开火是被允许的（`Battle` 的 tick 顺序注释里那条）。
   */
  update(wantDeployed: boolean | null): void {
    const nowMs = this.nowMs;
    this.#advance(Math.max(0, nowMs - this.#lastMs));
    this.#lastMs = nowMs;

    if (wantDeployed === null) return;
    if (wantDeployed) this.deploy();
    else this.packup();
  }

  /** **要求架起来** —— 已经在架 / 架好了就什么都不做 */
  deploy(): void {
    if (this.#phase === "unpacked" || this.#phase === "unpacking") return;
    // 从"收"切过来 ⇒ 反解出还要架多久：正在收 = 已经架好了 packMs 里的一部分
    this.#progressMs = this.#phase === "packing" ? this.#unpackMsFromPacking() : 0;
    this.#phase = "unpacking";
    this.setState(this.nowMs, "unpacking");
    if (this.#progressMs >= this.params.unpackMs) this.#finishUnpack();
  }

  /**
   * **出生就是架好的** —— 对战页的「初始已部署」开关用它（用户要求：
   * 「战斗界面允许单独设置…是否初始部署」）。
   *
   * 语义：这一台单位**不是刚落地**，而是已经架在那儿、随时能打 ⇒ 部署时长整个跳过。
   * ⚠️ 它是**开局就写进时间线**的一段（不是"事后改参数"）：`unpacking` 一段都不会记，
   * 状态直接从 `unpacked` 起算，并补一条 `unpack_done` 事件，界面上"架好那一刻"落在 0。
   */
  startDeployed(): void {
    if (this.#phase === "unpacked") return;
    this.#phase = "unpacked";
    this.#progressMs = 0;
    this.#deployedAtMs = this.nowMs;
    // 有盾的单位：源码里那面盾是"架到最后 `unpackAfterMs` 才挂上"的，这里等价于已经挂上
    if (this.params.shield !== undefined) this.#shieldOn = true;
    this.setState(this.nowMs, "unpacked");
    this.addEvent(this.nowMs, "unpack_done");
  }

  /**
   * **要求收起来** —— 已经在收 / 收好了就什么都不做。
   *
   * ⚠️ 架设中反悔要过 `canInterruptIntro`（岩石巨虫 `false` ⇒ 架完为止）。
   */
  packup(): void {
    if (this.#phase === "packed" || this.#phase === "packing") return;
    if (this.#phase === "unpacking" && this.params.canInterruptIntro === false) return;
    this.#progressMs = this.#phase === "unpacking" ? this.#packMsFromUnpacking() : 0;
    this.#phase = "packing";
    this.setState(this.nowMs, "packing");
    if (this.#progressMs >= this.params.packMs) this.#finishPack();
  }

  // ─────────────────────────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────────────────────────

  /** 推进时间；到点就结清（同一帧内不会连着跨两个过程 —— 方向只有听指令才会换） */
  #advance(deltaMs: number): void {
    if (!this.transitioning) return;
    this.#progressMs += deltaMs;
    this.#latchShield();
    if (this.#progressMs < this.#totalMs) return;
    if (this.#phase === "unpacking") this.#finishUnpack();
    else this.#finishPack();
  }

  /** 唯一在动那面盾的地方（源码：intro 的一条线程加上去、outro 的一条线程摘下来） */
  #latchShield(): void {
    const shield = this.params.shield;
    if (shield === undefined) return;
    if (this.#phase === "unpacking" && this.#progressMs >= shield.unpackAfterMs) this.#shieldOn = true;
    if (this.#phase === "packing" && this.#progressMs >= shield.packAfterMs) this.#shieldOn = false;
  }

  /**
   * **从"收"反解出"还要架多久"**：收了多少 = 架设进度走到了反面
   * ⇒ 还要架 `unpackMs × (已收比例)`（源码 `modifier_simple_intro.lua:15-16` 那个式子）。
   *
   * ⚠️ 源码在这一步是 `Fixed32.toInt(...)`（**取整到毫秒**），本机照做 —— 于是
   * "架了 60% 改收" 得到的就是干净的 200ms，而不是 200.00000000000003。
   */
  #unpackMsFromPacking(): number {
    const packedPercent = this.params.packMs <= 0 ? 1 : this.#progressMs / this.params.packMs;
    return Math.trunc(this.params.unpackMs * Math.min(1, packedPercent));
  }

  /** 反过来：已架设比例 ⇒ 还要收 `packMs × 已架设比例`（源码 `modifier_simple_outro.lua:15-16`） */
  #packMsFromUnpacking(): number {
    const unpackedPercent = this.params.unpackMs <= 0 ? 1 : this.#progressMs / this.params.unpackMs;
    return Math.trunc(this.params.packMs * Math.min(1, unpackedPercent));
  }

  #finishUnpack(): void {
    this.#phase = "unpacked";
    this.#progressMs = 0;
    this.#deployedAtMs = this.nowMs;
    this.setState(this.nowMs, "unpacked");
    this.addEvent(this.nowMs, "unpack_done");
  }

  #finishPack(): void {
    this.#phase = "packed";
    this.#progressMs = 0;
    this.setState(this.nowMs, "packed");
    this.addEvent(this.nowMs, "pack_done");
  }
}

/**
 * 按单位 def 造一台部署机 —— 单位**没有** `modifier_intro`（绝大多数）时返回 `null`。
 *
 * 与武器那边同一个分工：**构造只吃参数、不认识单位**，谁在什么时候驱动由调用方决定。
 */
export function deployMachineFor(
  params: DeployParams | undefined,
  clock: Clock,
): DeployMachine | null {
  return params === undefined ? null : new DeployMachine(clock, params);
}
