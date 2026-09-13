/**
 * **小队与单位实例** —— 定义是数据，这里是**运行中的那一份**。
 *
 * | | 是什么 | 从哪来 |
 * | --- | --- | --- |
 * | `UnitDef` | 源码 `ItemTuning` 的静态调参 | `unit-def.ts` |
 * | **`Unit` / `Squad`（本文件）** | 吃 buff、带等级、有血量的实例 | 定义 + 等级构造出来 |
 *
 * ⚠️ **血量是"每个成员一份"** —— 源码的 `combatantTuning.health` 是**单个战斗员**的
 * （步枪兵 130、总部 30000），等级倍率也套在那个数上（`levels.ts` 的 `hp()`）。
 * 小队总血 = 每员 × `waveSize`。
 *
 * 依据（`DamageUtil.lua`）：
 * - `squad:TakeAOEDamage(dmg, …)` —— 整队**每人各吃一份**
 * - `combatant:GetSquad():TakeDirectDamage(combatant, …)` —— 只打到**某一员**
 * - `squad:GetLastCombatant():TakeRedirectDamage(…)` —— 只掉**最后一员**
 *
 * ⚠️ **行为不在这些类里**。它们只管"状态 + 数值"；"什么时候做什么"由实现承担
 * （全库 43 个武器专属实现 + 单位级 modifier，见 findings J19）。
 */

import type { Level } from "../levels.ts";
import type { Tile, UnitDef } from "./unit-def.ts";

/** 一个战斗员 —— 定义 + 所属小队 + 自己在队里的序号 + 当前血量 */
export class Unit {
  readonly def: UnitDef;
  /** 所属小队。⚠️ 等级挂在小队上（源码里 `GetRank()` 是能力的量，不是战斗员的） */
  readonly squad: Squad;
  /**
   * **自己在小队里的序号**（从 0 起）。
   *
   * ⚠️ 序号**不因有人阵亡而重排** —— 存活的人保留原序号。
   * 依据：`attackSeparationDurationMS` 表达的是"**每个枪口错开多久**"，
   * 不是"第几个开枪"，所以死一个不该让其余人的相位整体前移。
   */
  readonly index: number;
  /**
   * **自己该等多久才开火** —— `index × squad.attackSeparationMs`。
   *
   * 实测：全库 25 个单位有 `attackSeparationDurationMS`，且**恰好等于全部
   * `waveSize > 1` 的单位**（73 个没有的，`waveSize` 全是 1）。Lua 侧**零读取**它
   * ⇒ 错开是引擎做的，我们照这个公式还原。
   */
  readonly startDelayMs: number;
  /**
   * **当前**血量。上限由等级决定：`level.hp(def.combatant.health)`（已向下取整）。
   * ⚠️ 按**单个成员**算，不是小队总和。
   */
  hp: number;
  /**
   * **这个成员一共开过几次火** —— 跨交战保持。
   *
   * 源码里它存在**武器黑板**上（`weapon:GetWeaponObject()`），
   * 序列每次开跑都 `self:LoadAttackCount(blackboard)` 读回来。
   * 用途：`initialChargeUpMs` **只在没打过之前付一次**
   * （`ability_beamcannon_weapon_sequence.lua:69,77` 的 `if self.attackInfo.count <= 1 then`），
   * 以及分阶段推进的计数（`stage1/2/3`）。
   *
   * ⚠️ 放在**成员**上而不是序列实例上：序列每次重新交战会新建，这个计数不该跟着清空。
   */
  firedCount = 0;

  constructor(def: UnitDef, squad: Squad, index: number, hp: number) {
    this.def = def;
    this.squad = squad;
    this.index = index;
    this.startDelayMs = index * squad.attackSeparationMs;
    this.hp = hp;
  }

  /** 按等级算出的满血 */
  get maxHp(): number {
    return this.squad.level.hp(this.def.combatant.health);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /**
   * 吃一份伤害 —— 对应引擎的 `TakeDirectDamage` / `TakeRedirectDamage` / `TakeAOEDamage`。
   *
   * ⚠️ 传**已经算好的数**（伤害已过 `Damage.against()` 与等级倍率）。
   * 下限 0，超杀不回血。
   */
  hurt(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
  }
}

/**
 * 一支小队 —— 若干战斗员 + 一个等级。
 *
 * ⚠️ **等级在小队上**：同队成员同等级。源码里 `GetRank()` 从能力 / 物品拿，
 * 不是每个战斗员各带一份。
 */
export class Squad {
  readonly def: UnitDef;
  readonly level: Level;
  readonly units: Unit[];
  /**
   * **所占的地块** —— 火 / 泰矿 / 毒气都挂在格子上。
   *
   * ⚠️ 可以换（队伍会移动），所以在构造之后仍可赋值。
   *
   * 源码依据：`squad:GetSquadTile()` 拿自己所在格；
   * 火焰坦克 `ability_flametank_weapon_sequence.lua:122` 拿**被打那格**的 `GetSquadsInHex(tile:CenterPos())`
   * 来打范围；圣甲虫/火焰轰炸机命中后是往格子上 `RequestModifier(tile, …)`。
   */
  tile: Tile | null;

  constructor(def: UnitDef, level: Level, units: Unit[], tile: Tile | null = null) {
    this.def = def;
    this.level = level;
    this.units = units;
    this.tile = tile;
  }

  /**
   * **成员之间错开多久开火** —— `squadTuning.attackSeparationDurationMS`。
   *
   * ⚠️ 小队**不用它排班**，成员拿它算自己的 `startDelayMs` 就够了
   * （源码里 Lua 也不读它，见 `Unit.startDelayMs`）。
   * 没有这个字段的单位（全是 `waveSize = 1`）给 0。
   */
  get attackSeparationMs(): number {
    return this.def.squad.attackSeparationDurationMS ?? 0;
  }

  get size(): number {
    return this.units.length;
  }

  get aliveUnits(): Unit[] {
    return this.units.filter((u) => u.alive);
  }

  /** 小队总血 = 各员当前血量之和 */
  get hp(): number {
    return this.units.reduce((sum, u) => sum + u.hp, 0);
  }

  /** 小队满血 = `health × waveSize` 套等级（与 `levels.ts` 的 `hp()` 同一算法） */
  get maxHp(): number {
    return this.level.hp(this.def.combatant.health * this.def.squad.waveSize);
  }

  get alive(): boolean {
    return this.units.some((u) => u.alive);
  }

  /**
   * **整队每人各吃一份** —— 对应 `squad:TakeAOEDamage`。
   *
   * ⚠️ `amount` 是**每员**那一份，不是总数。调用方若要按总数分摊会自己除
   * （源码 `modifier_drillpod_intro.lua:69` 就是
   * `TakeAOEDamage(totalDamage / spawnedSquad:CountCombatants(), …)`）。
   */
  hurtEach(amount: number): void {
    for (const u of this.units) if (u.alive) u.hurt(amount);
  }

  /** **只掉一员** —— 对应 `squad:GetLastCombatant():TakeRedirectDamage` */
  hurtLast(amount: number): void {
    const alive = this.aliveUnits;
    const last = alive[alive.length - 1];
    if (last) last.hurt(amount);
  }

  /** **只打某一员** —— 对应 `combatant:GetSquad():TakeDirectDamage(combatant, …)` */
  hurtOne(unit: Unit, amount: number): void {
    unit.hurt(amount);
  }
}

/**
 * 按定义与等级拉起一支小队。
 *
 * ⚠️ 成员数就是 `squadTuning.waveSize`；满血按**每员**算
 * （`level.hp(def.combatant.health)`）。
 * 每个成员拿到自己的 `index`，于是**自己知道该等多久**（`index × sep`）。
 *
 * `tile` 是它落下时所占的格子（火 / 泰矿 / 毒气都在格子上）。
 */
export function spawn(def: UnitDef, level: Level, tile: Tile | null = null): Squad {
  const squad = new Squad(def, level, [], tile);
  const perMemberHp = level.hp(def.combatant.health);
  for (let i = 0; i < def.squad.waveSize; i++) {
    squad.units.push(new Unit(def, squad, i, perMemberHp));
  }
  return squad;
}
