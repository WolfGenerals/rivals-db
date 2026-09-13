/**
 * **弹头定义（导出格式）** —— 弹头是数据，这里定义"从源码导出成什么形状"。
 *
 * ⚠️ **弹头里一律不出现伤害**。伤害归武器（`damageTuning`）；催化剂那种武器上也没有的，
 * 归被请求的那个 ability 的调参。弹头只描述"命中时做哪几件事"。
 * ⚠️ 数值一律是**基础值**：等级由消费方按 `levels.ts` 现套，不写进产物。
 */

import type { Override, ModifyStat, Damage } from "./unit-def.ts";

export type EffectKindDef =
  | "squad_each"
  | "one_member"
  | "per_combatant"
  | "falloff"
  | "catalyst_explosion"
  | "catalyst_chained_explosion"
  | "place_modifier"
  | "refresh_modifier"
  | "remove_modifier"
  | "modify";

/** 整队每人各一份 —— `AoeDamageSquad*` */
export type SquadEachEffectDef = { kind: "squad_each" };

/** 只掉一员 —— `DamageSquadList*` → `GetLastCombatant()` */
export type OneMemberEffectDef = { kind: "one_member" };

/** 逐个战斗员 —— `DamageCombatantList*` */
export type PerCombatantEffectDef = { kind: "per_combatant" };

/** 圆内每人、按距离打折 —— `DamageCombatantsFalloff` */
export type FalloffEffectDef = {
  kind: "falloff";
  /** **世界单位** */
  radius: number;
  curve: Array<{ distance: number; percent: number }>;
};

/** 爆炸的触发条件（或关系） */
export type CatalystTriggerDef =
  | { kind: "tileHasModifier"; modifier: string }
  | { kind: "tileHasUnit"; unitId: string };

/** 爆炸的两个时刻（见 `warhead.ts` 的 `CatalystTiming`） */
export interface CatalystTimingDef {
  /**
   * 视觉开演的时刻；直升机 = `visual.EXPLOSION_START_TIME`。
   * **不出现** = 读不到（那在视觉块里，提取器还没收）—— 别拿扣血时刻顶替。
   */
  explosionStartMs?: number;
  /** 真正扣血的时刻；源码 `DAMAGE_TIME`（直升机 300ms） */
  damageMs?: number;
  /** 整段事件活多久；**不出现** = 读不到 */
  durationMs?: number;
}

/**
 * 催化爆炸 —— 直升机。整格每人各一份、延迟扣血、只扣一次。
 *
 * ⚠️ 它的伤害也不在这里：数值来自**被请求的那个 ability 的调参**（`tiberiumExplosionTuning`），
 * 既不在武器上也不在弹体上。
 * ⚠️ 它的调参里也写着 `NUM_RINGS_EXPLOSION = 2`，但实现**不读**该值，所以没有 `rings`。
 * ⚠️ **`timing` 可以不出现**：那两个时刻来自**视觉/原型常量**（不在单位脚本里），
 * 机器转换时读不到 ⇒ 宁可空着并记 gap，也不编（`core/src/convert/unit-def.ts`）。
 */
export interface CatalystExplosionEffectDef {
  kind: "catalyst_explosion";
  /** 绑定的 Lua 实现名 */
  impl: string;
  timing?: CatalystTimingDef;
  /** 触发条件（或关系）；直升机恒为空 */
  triggers: CatalystTriggerDef[];
  /**
   * **这次爆炸自己的伤害表**（直升机：800 / 建筑 800 / 步兵 300）。
   *
   * ⚠️ 它是**被请求的那个 ability 的调参**（`tiberiumExplosionTuning`），既不是武器的、
   * 也不是弹体的 —— J52 那条"弹头不带伤害"说的是**武器自己**的伤害，这条是例外，
   * 所以放在这个效果上（不然界面根本没法把爆炸的伤害显示出来）。
   */
  damage?: Damage;
  /** **只打地面**（源码 `DESCRIPTOR_FILTERS = Ground`）⇒ 空军那格要画 `—` */
  groundOnly?: boolean;
}

/**
 * 催化连锁爆炸 —— 捷德。主格 + **只第 1 环**，并对符合条件的格子递归请求自己。
 *
 * ⚠️ 它的伤害也不在这里：数值来自**被请求的那个 ability 的调参**（`tiberiumExplosionTuning`），
 * 既不在武器上也不在弹体上。
 */
export interface CatalystChainedExplosionEffectDef {
  kind: "catalyst_chained_explosion";
  /** 绑定的 Lua 实现名 */
  impl: string;
  timing?: CatalystTimingDef;
  triggers: CatalystTriggerDef[];
  /** 触发后从拥有者身上摘掉的修饰器；**不出现** = 不需要摘 */
  consumeOnTrigger?: string;
  /** `NUM_RINGS_EXPLOSION` 减 1 */
  rings: number;
}

/** 格子效果的数值（**来自 `auras/*.lua`**：`modifier_fire_bomber_fire` 自己不含数字） */
export interface TileEffectDef {
  tickMs: number;
  tickDamage: number;
  persistMs: number;
  /** 值为 0 = 这一类完全不吃（毒气对载具就是 0）；**不出现** = 没有逐类覆写 */
  vs?: Array<[Override, number]>;
  immune?: string[];
  groundOnly: boolean;
  /** 不是"铺得慢"，是"要连续开打这么久才铺得出"（毒车 2100）；**不出现** = 没这道门槛 */
  spawnDelayMs?: number;
}

/** 在格上铺修饰器（火、毒） */
export interface PlaceModifierEffectDef {
  kind: "place_modifier";
  name: string;
  effect: TileEffectDef;
}

/** 刷新已有修饰器（续时） */
export interface RefreshModifierEffectDef {
  kind: "refresh_modifier";
  name: string;
}

/** 移除修饰器（引爆会消耗毒气） */
export interface RemoveModifierEffectDef {
  kind: "remove_modifier";
  name: string;
}

/** 给被打目标挂属性修改（EMP / stun） */
export interface ModifyEffectDef {
  kind: "modify";
  /** 时长（毫秒；`-1` = 无时限） */
  durationMs: number;
  stats: Array<[ModifyStat, number]>;
}

export type WarheadEffectDef =
  | SquadEachEffectDef
  | OneMemberEffectDef
  | PerCombatantEffectDef
  | FalloffEffectDef
  | CatalystExplosionEffectDef
  | CatalystChainedExplosionEffectDef
  | PlaceModifierEffectDef
  | RefreshModifierEffectDef
  | RemoveModifierEffectDef
  | ModifyEffectDef;

/**
 * **弹头** —— 就是一个效果列表。
 *
 * ⚠️ 顺序 = 源码里调用的顺序（火焰轰炸机是"先铺火、再触发连锁爆炸"）。
 * ⚠️ 它不是包装对象：`impl` / `hitFilter` / `army` 那些属于"哪把武器、能打谁"，
 * 归武器层；这里只有"命中时做哪几件事"。
 */
export type WarheadDef = WarheadEffectDef[];
