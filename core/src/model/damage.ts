/**
 * **伤害结算层** —— 把"开火事件"变成"扣血事件"（J39③ / J51 缺的那一块）。
 *
 * ## 逐行对着源码那四步（`DamageUtil.lua:15-17`，三个入口 `:3` / `:28` / `:53` 一模一样）
 *
 * ```
 * ① GetDamageOverrideWS(target, damageTable)          → 覆写表按目标标签取，多条命中取最大
 * ② GetRankedStatExponential(…, baseDamage)           → **等级指数缩放**（伤害也吃等级，J50）
 * ③ × ability:GetDamageModifier()                     → 能力级倍率（❗ 值从哪来没有证据，见下）
 * ④ 组 {id, damage, attackerSnapshot, damageInfo}     → 交出去
 * ```
 *
 * ## 交付方式（"打谁"）—— 三条路径，都在 `DamageUtil.lua` 里
 *
 * | 路径 | 打谁 | 源码 |
 * | --- | --- | --- |
 * | `DamageCombatant*` | **指定的某一员** | `:18` `TakeDirectDamage` |
 * | `DamageSquad*` | **只掉最后一员** | `:43` `GetLastCombatant():TakeRedirectDamage` |
 * | `AoeDamageSquad*` | **整队每人各一份** | `:67` `TakeAOEDamage` |
 * | `DamageCombatantsFalloff` | 一串目标 + 按距离衰减 | 需要位置 ⇒ **本层做不了**（记事件说明） |
 *
 * ⇒ 交付方式**从弹头里读**（`warheadOf()` 的 `one_member` / `squad_each` / `per_combatant` / `falloff`），
 * 因为那正是源码里"这条伤害走哪条路"的表达；**没写就是 `one_member`**（默认打最后一员，J55）。
 *
 * ## ⚠️ 本层**明确不假装**的两件事
 *
 * 1. `ability:GetDamageModifier()`（第 ③ 步）**全库没有任何 Lua 写它**（只有 `DamageUtil.lua` 读），
 *    值从哪来没有证据 ⇒ 这里恒按 **1** 处理，并把这件事记在 `NOTES` 里（findings J51）。
 * 2. **按距离衰减**（`falloff`）需要位置 ⇒ 没有空间层就不做，只发一条 `falloff_unmodeled` 事件。
 */

import type { Level } from "../levels.ts";
import type { Target, UnitDef } from "./unit-def.ts";
import { warheadOf } from "./weapon-def.ts";
import type { WeaponDamage, WeaponDef } from "./weapon-def.ts";
import type { WarheadEffectDef } from "./warhead-def.ts";
import type { Squad, Unit } from "./unit-instance.ts";

/** 本层已知的"没建模/没证据"之处（会随事件一起露出来，不藏在注释里） */
export const NOTES = {
  damageModifier: "`ability:GetDamageModifier()` 恒按 1（全库没有 Lua 写它，J51）",
  falloff: "按距离衰减需要位置 ⇒ 未建模，按「每人各一份」处理并标 `falloff_unmodeled`",
} as const;

/** 伤害怎么交付 —— 与 `warhead-def.ts` 里那几个 kind 一一对应 */
export type Delivery = "one_member" | "squad_each" | "per_combatant" | "falloff";

const DELIVERIES: readonly Delivery[] = ["one_member", "squad_each", "per_combatant", "falloff"];

/**
 * **这件武器打出去时，伤害怎么交付** —— 读弹头；弹头里没写就按默认（**只打最后一员**）。
 *
 * ⚠️ `warheadOf()` 已经把"没写"和"写了但缺交付"两种情况都补上了默认那条（J80），
 * 所以这里只需要找到第一条交付类效果。
 */
export function deliveryOf(w: WeaponDef): Delivery {
  for (const e of warheadOf(w)) {
    if ((DELIVERIES as readonly string[]).includes(e.kind)) return e.kind as Delivery;
  }
  return "one_member";
}

/** 弹头里**除了交付方式**之外的效果（铺格子 / 催化爆炸 / 属性修改…）—— 由调用方去执行 */
export function sideEffectsOf(w: WeaponDef): WarheadEffectDef[] {
  return warheadOf(w).filter((e) => !(DELIVERIES as readonly string[]).includes(e.kind));
}

/**
 * **一类目标** —— 从单位定义推它属于哪一类（武器覆写表就是按这个查的）。
 *
 * 优先取 `tags` 里那个**基础标签**（`Infantry` / `Vehicle` / `Aircraft` / `Structure` / `Harvester`）；
 * 建筑只有 `override_structure` 这种 `override_*` 标签时，从它反推。
 */
export function targetTypeOf(def: UnitDef): Target {
  const base: readonly string[] = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"];
  for (const t of def.combatant.tags) {
    if (base.includes(t)) return t as Target;
  }
  // 建筑 / 采集车这类：只有 `override_*`
  for (const t of def.combatant.tags) {
    const m = /^override_(\w+)$/.exec(t);
    if (m === null) continue;
    const name = m[1]!;
    const hit = base.find((b) => b.toLowerCase() === name);
    if (hit !== undefined) return hit as Target;
  }
  // 兜底：源码里没有基础标签的（极少），按步兵算，并让调用方自己知道（返回类型不给"未知"）
  return "Infantry";
}

/**
 * **这把武器打不打得到这一类目标** —— 读武器自己的 `usage.canAttack`（从 `descriptors` 位掩码解出来）。
 *
 * 三种答案都要能表达，**不许把"不知道"混进"能打"**：
 *
 * | 返回 | 含义 | 来源 |
 * | --- | --- | --- |
 * | `"yes"` | `canAttack` 里有这一类 | `descriptors` 解出来的 5 类目标 |
 * | `"no"` | 有 `canAttack`、但没有这一类 —— **它锁不上这种目标** | 例：MLRS / 催化剂炮艇的 `canAttack` 都不含 `Aircraft` |
 * | `"unknown"` | `canAttack` 是空数组 —— `descriptors` 没解出来（全库 6 把） | 不能当"能打"用，也不能当"不能打"用 |
 *
 * ⚠️ 这**不是射程判定**（射程是引擎侧的、Lua 里没有，J40）：它是"**这种目标压根不在它的打击清单里**"。
 * 用户实测提出：MLRS 打不掉催化剂直升机（直升机是 `Aircraft`，而 MLRS 的 `rockets` 没有这一类）。
 */
export function reachesType(w: WeaponDef, target: Target): "yes" | "no" | "unknown" {
  const can = w.usage.canAttack;
  if (can.length === 0) return "unknown";
  return can.includes(target) ? "yes" : "no";
}

/** 在飞的一发 —— 开火时生成，落地时结算 */export interface Shot {
  /** 开火时刻 */
  firedAtMs: number;
  /** 落地时刻（= 开火 + 飞行时间） */
  landAtMs: number;
  /** 谁打的（成员；`null` = 来源不是具体成员，例如格子效果） */
  shooter: Unit | null;
  /** 射手所属小队（等级挂在它身上 —— 伤害按**射手的等级**缩放） */
  attacker: Squad;
  /** 打谁 */
  target: Squad;
  /** 这把武器（伤害表 / 弹头都从它读） */
  weapon: WeaponDef;
  /** 这一发用哪一档伤害（分段武器每段不同；其余就是第 0 档） */
  tier: WeaponDamage;
}

/** 交付出去的一份伤害（结算结果） */
export interface HitResult {
  victim: Unit;
  damage: number;
  /** 挨完这一下之后剩多少血 */
  hpAfter: number;
  killed: boolean;
}

/**
 * **一发打出去，扣多少血** —— 第 ② 步（等级缩放）+ 第 ① 步（覆写取最大）。
 *
 * 调用方负责把结果交给对应的交付方式（见 {@link deliver}）。
 */
export function damageOf(shot: Shot, level: Level, target: Target = targetTypeOf(shot.target.def)): number {
  const base = shot.tier.main.against(target);
  // ② 等级指数缩放（与血量同一套公式，`levels.ts`）· ③ 能力倍率恒 1（没证据，见文件头）
  return Math.round(level.dps(base));
}

/**
 * **把一份伤害交付出去** —— 三条路径之一（源码 `DamageUtil.lua:18 / :43 / :67`）。
 *
 * ⚠️ `falloff`（一串目标 + 按距离衰减）**需要位置**，本层做不了 ⇒ 退化成"每人各一份"，
 * 并在返回里标记，让上层能把它记成"未建模"而不是当成转译。
 */
export function deliver(shot: Shot, level: Level, damage: number): { hits: HitResult[]; falloffUnmodeled: boolean } {
  const mode = deliveryOf(shot.weapon);
  const hits: HitResult[] = [];
  const record = (victim: Unit): void => {
    victim.hurt(damage);
    hits.push({ victim, damage, hpAfter: victim.hp, killed: !victim.alive });
  };

  switch (mode) {
    case "one_member": {
      // `:43` `squad:GetLastCombatant():TakeRedirectDamage(…)` —— **只掉最后一员**
      const alive = shot.target.aliveUnits;
      const last = alive[alive.length - 1];
      if (last !== undefined) record(last);
      break;
    }
    case "squad_each":
      // `:67` `squad:TakeAOEDamage(…)` —— **整队每人各一份**
      for (const u of shot.target.aliveUnits) record(u);
      break;
    case "per_combatant":
      // `:18` `combatant:GetSquad():TakeDirectDamage(…)` —— 逐个战斗员各一份
      //（"点名哪几个"是战场查询；这里目标只有一队 ⇒ 队里每个活人各一下）
      for (const u of shot.target.aliveUnits) record(u);
      break;
    case "falloff":
      // `nDamage.DamageCombatantsFalloff(…)` —— 距离衰减，需要位置
      for (const u of shot.target.aliveUnits) record(u);
      return { hits, falloffUnmodeled: true };
  }
  void level;
  return { hits, falloffUnmodeled: false };
}

/** 一发打出去的完整账（供时间线使用） */
export interface ShotOutcome {
  shot: Shot;
  damage: number;
  hits: HitResult[];
  falloffUnmodeled: boolean;
}

/** 结算一发（算伤害 + 交付） */
export function resolveShot(shot: Shot): ShotOutcome {
  const level = shot.attacker.level;
  const damage = damageOf(shot, level);
  const { hits, falloffUnmodeled } = deliver(shot, level, damage);
  return { shot, damage, hits, falloffUnmodeled };
}
