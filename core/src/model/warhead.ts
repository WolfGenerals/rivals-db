/**
 * **弹头** —— 命中那一刻造成什么。
 *
 * 伤害两步算（`gameplay/DamageUtil.lua:15-17`）：
 * `GetDamageOverrideWS(目标, damage)` ⇒ 基础伤害；`GetRankedStatExponential(…, rank)` ⇒ 套等级。
 *
 * ⚠️ 这里全是**数据**：命中时要做什么由消费方读了 `Warhead.effects` 之后自己处理。
 */

import type { Level } from "../levels.ts";
import { Damage } from "./unit-def.ts";
import type { Modify, Target } from "./unit-def.ts";

/** **弹头效果** —— 命中时做的一件事；一个弹头可以带多条 */
export abstract class WarheadEffect {
  /** 判别键，给消费方窄化用 */
  abstract readonly kind: string;
}

/** 造成伤害的四种方式（判据：那一刻调了 `DamageUtil` 的哪个 API） */
export abstract class DealDamage extends WarheadEffect {
  readonly kind = "damage" as const;
  readonly damage: Damage;
  readonly level: Level;

  constructor(damage: Damage, level: Level) {
    super();
    this.damage = damage;
    this.level = level;
  }
}

/** 整队每人各一份 —— `AoeDamageSquad*` */
export class SquadEachDamage extends DealDamage {
  readonly mode = "squad_each" as const;
}

/** 只掉一员 —— `DamageSquadList*` → `GetLastCombatant()` */
export class OneMemberDamage extends DealDamage {
  readonly mode = "one_member" as const;
}

/** 逐个战斗员 —— `DamageCombatantList*` */
export class PerCombatantDamage extends DealDamage {
  readonly mode = "per_combatant" as const;
}

/** 圆内每人、按距离打折 —— `DamageCombatantsFalloff` */
export class FalloffDamage extends DealDamage {
  readonly mode = "falloff" as const;
  /** **世界单位** */
  readonly radius: number;
  readonly curve: Array<{ distance: number; percent: number }>;

  constructor(damage: Damage, level: Level, radius: number, curve: Array<{ distance: number; percent: number }>) {
    super(damage, level);
    this.radius = radius;
    this.curve = curve;
  }
}

/** 催化爆炸的触发条件（或关系）：格上有某个修饰器，或格上有**特定单位** */
export type CatalystTrigger =
  | { kind: "tileHasModifier"; modifier: string }
  | { kind: "tileHasUnit"; unitId: string };

/** 爆炸的两个时刻：视觉先响、`damageMs` 后扣血，`durationMs` 之后自己删掉 */
export interface CatalystTiming {
  /** 视觉开演的时刻；源码 `visual.EXPLOSION_START_TIME` */
  explosionStartMs: number;
  /** 真正扣血的时刻；源码 `tuning.DAMAGE_TIME` */
  damageMs: number;
  /** 整段事件活多久（之后 `MarkForDelete`）；源码 `visual.DURATION` */
  durationMs: number;
}

/**
 * **催化爆炸** —— 直升机（`ability_catalyst_explosion.lua`）。
 *
 * ⚠️ 它是一个**携带伤害的事件**，不是"伤害的分配方式"：有延迟、可能带触发条件、只扣一次。
 * 所以直接继承 `WarheadEffect`，**不继承 `DealDamage`**。
 *
 * ⚠️ 伤害内嵌为静态常量：这个数既不在武器上也不在弹体上（武器 270、弹体 50 都不是实际伤害），
 * 而在**被请求的那个 ability 的调参**里；构造时只传**等级**，实际伤害 = 常量 × 等级系数。
 */
export class CatalystExplosion extends WarheadEffect {
  readonly kind = "catalystExplosion" as const;
  /** 内嵌的基础伤害（源码 `unit_nod_catalystgunship.tiberiumExplosionTuning.damageMain`） */
  static readonly DAMAGE = new Damage(800, [
    ["override_structure", 800],
    ["override_infantry", 300],
  ]);

  readonly level: Level;
  readonly timing: CatalystTiming;
  /** 直升机不读触发条件，恒为空数组 */
  readonly triggers: CatalystTrigger[];
  /** 绑定的 Lua 实现名（可回溯） */
  readonly impl: string;

  constructor(level: Level, timing: CatalystTiming, triggers: CatalystTrigger[], impl: string) {
    super();
    this.level = level;
    this.timing = timing;
    this.triggers = triggers;
    this.impl = impl;
  }

  /** 这一发对这一类目标的实际伤害（`target` 见 `Damage.against`） */
  amountFor(target: Target): number {
    return Math.round(CatalystExplosion.DAMAGE.against(target) * this.level.factor());
  }

  /** 命中这一格是否满足触发条件 */
  triggeredBy(tileModifiers: ReadonlySet<string>, tileUnitIds: ReadonlySet<string>): boolean {
    return this.triggers.some((t) =>
      t.kind === "tileHasModifier" ? tileModifiers.has(t.modifier) : tileUnitIds.has(t.unitId),
    );
  }
}

/**
 * **催化连锁爆炸** —— 捷德（`ability_tiberium_explosion.lua`）。
 *
 * ⚠️ 与直升机**是两个实现**，不是同一个的开关版本（字段名相同、代码不同）：
 * 多一个只打**第 1 环**的 `side`，还会对符合条件的格子 `RequestAbility` **自己**真正的递归下去。
 */
export class CatalystChainedExplosion extends WarheadEffect {
  readonly kind = "catalystChainedExplosion" as const;
  /** 主格伤害（源码 `cmdr_nod_jade.tiberiumExplosionTuning.damageMain`） */
  static readonly DAMAGE = new Damage(2500, [
    ["override_harvester", 500],
    ["override_structure", 2500],
  ]);
  /** 相邻第 1 环的伤害（同上的 `damageSide`） */
  static readonly SIDE = new Damage(3000, [
    ["override_harvester", 500],
    ["override_structure", 2500],
  ]);

  readonly level: Level;
  /** ⚠️ 捷德没有独立的视觉起爆时刻：VFX 和扣血都卡 `DAMAGE_TIME` */
  readonly timing: CatalystTiming;
  readonly triggers: CatalystTrigger[];
  /**
   * 触发后从**拥有者**身上摘掉的修饰器（`TEMPORAL_MODIFIER_THAT_ACTIVATES_EXPLOSION`）；
   * 源码在 `OnStart` 与 `OnDestroy` 各摘一次
   */
  readonly consumeOnTrigger: string | null;
  /** `NUM_RINGS_EXPLOSION` 减 1 = `GetTilesInArea` 的半径 */
  readonly rings: number;
  /** 绑定的 Lua 实现名（可回溯） */
  readonly impl: string;

  constructor(
    level: Level,
    timing: CatalystTiming,
    triggers: CatalystTrigger[],
    consumeOnTrigger: string | null,
    rings: number,
    impl: string,
  ) {
    super();
    this.level = level;
    this.timing = timing;
    this.triggers = triggers;
    this.consumeOnTrigger = consumeOnTrigger;
    this.rings = rings;
    this.impl = impl;
  }

  /** 这一发对某一类目标的实际伤害；`ring === 0` 是主格 */
  amountFor(target: Target, ring: number): number {
    const base = ring === 0 ? CatalystChainedExplosion.DAMAGE : CatalystChainedExplosion.SIDE;
    return Math.round(base.against(target) * this.level.factor());
  }

  /** 命中这一格是否满足触发条件 */
  triggeredBy(tileModifiers: ReadonlySet<string>, tileUnitIds: ReadonlySet<string>): boolean {
    return this.triggers.some((t) =>
      t.kind === "tileHasModifier" ? tileModifiers.has(t.modifier) : tileUnitIds.has(t.unitId),
    );
  }
}

/** 在格上铺 / 刷新修饰器（火、毒） */
export class PlaceModifier extends WarheadEffect {
  readonly kind = "placeModifier" as const;
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }
}

/** 移除格上的修饰器（引爆会消耗毒气） */
export class RemoveModifier extends WarheadEffect {
  readonly kind = "removeModifier" as const;
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }
}

/**
 * **刷新已有修饰器** —— 已存在就重置时长（火/毒被续时）。
 *
 * ⚠️ 源码里它总是和"不存在就新建"成对出现：
 * `if not RestartModifierByNameId(tile, X) then RequestModifier(tile, …, X, …) end`，
 * 且**只有火与毒气自己手写了 `ResetPersistTime`**（重置剩余时长 + 重放 VFX），
 * 其余挂在单位上的由引擎的 `RestartModifierByNameId` 按各自 `durationMs` 重置。
 */
export class RefreshModifier extends WarheadEffect {
  readonly kind = "refreshModifier" as const;
  readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }
}

/**
 * **给被打目标挂属性修改** —— EMP / stun 这类。效果内容看 `unit-def.ts` 的 `Modify`。
 */
export class ModifyEffect extends WarheadEffect {
  readonly kind = "modify" as const;
  readonly modify: Modify;
  /** 挂给哪一方 */
  readonly army: "Enemy" | "Friendly" | "None";

  constructor(modify: Modify, army: "Enemy" | "Friendly" | "None" = "Enemy") {
    super();
    this.modify = modify;
    this.army = army;
  }
}

/** 弹头的源头（可选）—— 这个弹头是由谁发出的 */
export interface WarheadSource {
  kind: "weapon" | "ability";
  /** 单位 / 指挥官 id */
  ownerId: string;
  /** 武器下标或能力名 */
  ref: string | number;
}

/**
 * **弹头** —— 纯数据。消费方遍历 `effects` 逐条执行。
 */
export class Warhead {
  /** 命中时要做的效果（可多条并存） */
  readonly effects: WarheadEffect[];
  /** 源头（可选）—— 这个弹头由谁发出 */
  readonly source?: WarheadSource;
  /** 绑定的 Lua 实现名（可回溯；也是"能不能换载体"的线索） */
  readonly impl: string;

  constructor(effects: WarheadEffect[] = [], source?: WarheadSource, impl = "") {
    this.effects = effects;
    this.source = source;
    this.impl = impl;
  }
}
