/**
 * **单位定义层的全部基础类型**。
 *
 * 这里放三样东西：
 * 1. **基础值类型** —— `Override` / `Target` / `Modify` / `Damage` / `TileEffect`（谁都要用）
 * 2. **地块** —— `Tile`（火 / 泰矿 / 毒气）
 * 3. **单位定义** —— `UnitDef`
 */

// ─────────────────────────────────────────────────────────────
// 伤害覆写
// ─────────────────────────────────────────────────────────────

/**
 * **伤害覆写键** —— 覆写表（`override` / `overrides`）能用的键，全库只用这 5 个。
 *
 * 名字对应源码 `DamageOverride.X`：`MakeOverride(DamageOverride.Vehicle, 45)`
 * （`MakeOverride` 在 `WeaponSequenceUtil.lua:61`）产出的是**目标身上的实际标签**，
 * 也就是 `override_vehicle`。所以每个键都带前缀，**不留任何需要拼接的中间形态**。
 */
export type Override =
  | "override_infantry"
  | "override_vehicle"
  | "override_aircraft"
  | "override_structure"
  | "override_harvester";

/**
 * **5 种目标** —— "我要问哪一类目标多少伤害"，不依赖任何单位实例。
 *
 * 与 `Override` 是**两件不同的事**：`Override` 是覆写表里的键（带 `override_` 前缀），
 * `Target` 是问话时的目标分类。
 */
export type Target = "Infantry" | "Vehicle" | "Aircraft" | "Structure" | "Harvester";

/**
 * **每种目标会匹配到的覆写键** —— `Target` → `Override`，一问一答。
 *
 * ⚠️ **Harvester 两条都要** —— 采集车带 `override_vehicle` + `override_harvester`
 * 两个标签，所以打采集车时两条都算，**取最大**。
 *
 * `Structure` 对应 `override_structure`：16 个 `bldg_*` 只有它、炮塔/方尖碑两个都有。
 * （采集车在游戏里显示**载具图标** —— 它没有 `UnitTag.Harvester`，基础标签就是 `Vehicle`，
 * 见 findings M17。）
 */
export const TARGET_TAGS: Record<Target, readonly Override[]> = {
  Infantry: ["override_infantry"],
  Vehicle: ["override_vehicle"],
  Aircraft: ["override_aircraft"],
  Structure: ["override_structure"],
  Harvester: ["override_vehicle", "override_harvester"],
};

/**
 * 伤害 —— 基础伤害 + **可空**的逐目标覆写。
 *
 * ⚠️ 覆写值是**该目标下的绝对伤害**，不是倍率。
 * ⚠️ **只定义形状，不含"怎么从源码读出来"的知识** —— 源码里那些不统一
 * （`overrides` / `override` 单复数、基础值叫 `default` / `damage`、条目是
 * `[tag,value]` / `{tag,damage}`）全部由**提取端**消化，见 findings J18。
 */
export class Damage {
  readonly base: number;
  /**
   * ⚠️ **没写就是不出现**（`undefined`），不写 `null` —— 消费方不该判断两种"空"
   * （旧产物那边也是这条规矩：`derive.ts` 的"缺的字段不出现"）。
   */
  readonly overrides?: ReadonlyArray<readonly [Override, number]>;

  constructor(base: number, overrides?: ReadonlyArray<readonly [Override, number]>) {
    this.base = base;
    this.overrides = overrides;
  }

  /**
   * 这个目标吃多少伤害 —— **逐行复刻** `nTuningUtil.GetDamageOverrideWS`
   * （`gameplay/tuning/TuningUtil.lua:46-67`）：
   *
   * ```lua
   * if combatant == nil or damageTable.override == nil then return damageTable.default end
   * local actualDamage = nil
   * for index = 1, #damageTable.override, 1 do
   *   if combatant:HasTag(damageTable.override[index].tag) then
   *     if actualDamage == nil or overrideDamage > actualDamage then actualDamage = overrideDamage end
   *   end
   * end
   * return actualDamage ~= nil and actualDamage or damageTable.default
   * ```
   *
   * ⚠️ `actualDamage` 初值是 **`nil`**（不是 `-1`）⇒ **覆写值为 `0` 是合法结果**，
   * 不会被当成"没命中"退回 `base`。毒气与泰矿的 `Vehicle: 0` 依赖这一点
   * （同文件那个已被取代的 `GetDamageOverride` 用 `-1` + `> 0`，会把 0 当成没命中 —— 见 findings M1a）。
   *
   * ⚠️ 遍历的是**伤害表的覆写列表**，不是目标的标签列表（findings M16）；
   * 多条同时命中取最大值，不是"先写先赢"。
   */
  against(target: Target): number {
    if (this.overrides === undefined) return this.base;
    const wanted = TARGET_TAGS[target] as readonly string[];
    let actual: number | null = null;
    for (const [key, damage] of this.overrides) {
      if (!wanted.includes(key)) continue;
      if (actual === null || damage > actual) actual = damage;
    }
    return actual ?? this.base;
  }
}

// ─────────────────────────────────────────────────────────────
// 属性修改
// ─────────────────────────────────────────────────────────────

/**
 * 属性名（`Stat.*`）。
 *
 * ⚠️ 前 9 个是**效果类**（挂在攻击/移动节奏上）；后 3 个是**伤害类**（J51 补的：
 * 壁虱壕沟用 `IncomingDamageReduction`、受方被标记用 `IncomingDamageAddition`、
 * 攻击方增伤用 `OutgoingDamagePercentIncrease` —— 一个都不能少，否则伤害层算不出来）。
 */
export type ModifyStat =
  | "AttackSpeedDecrease"
  | "ReloadSpeedPercentDecrease"
  | "MovementSpeedPercentDecrease"
  | "AngularSpeedPercentDecrease"
  | "AttackSpeedIncrease"
  | "ReloadSpeedPercentIncrease"
  | "MovementSpeedPercentIncrease"
  | "MovementSpeedFlatIncrease"
  | "AngularSpeedPercentIncrease"
  /** **受方**减伤（壁虱壕沟 70%）—— `modifier_damagereduction_intro.lua:38` */
  | "IncomingDamageReduction"
  /** **受方**增伤（被标记/削弱） */
  | "IncomingDamageAddition"
  /** **攻击方**增伤 */
  | "OutgoingDamagePercentIncrease";

/**
 * 属性修改 —— EMP / stun 这类，**只看效果本身**。
 *
 * ⚠️ 程度是**原始小数**（`Fixed32.fromValue(0.25)`），不是百分数。
 */
export class Modify {
  /** 时长（毫秒；`-1` = 无时限） */
  readonly durationMs: number;
  /** Stat 名 → 程度 */
  readonly stats: Partial<Record<ModifyStat, number>>;

  constructor(durationMs: number, stats: Partial<Record<ModifyStat, number>>) {
    this.durationMs = durationMs;
    this.stats = stats;
  }
}

// ─────────────────────────────────────────────────────────────
// 地块
// ─────────────────────────────────────────────────────────────

/**
 * **场地效果** —— 火 / 毒气 / 泰矿在格子上每 `tickMs` 打一次的那份伤害。
 *
 * ⚠️ `damage` 是**完整的伤害对象**，不是数值 —— 源头的 `damage` 就带 `override`
 * （`aura_gas_cloud.lua:20` 与 `aura_tiberium_field.lua:22` 都是 `Vehicle: 0`，
 * 即载具免疫；火是 `Vehicle: 25`）。用 `damage.against(目标)` 取值。
 *
 * ⚠️ **只有"被铺上去"的才有持续时间**。全库 `PERSIST_DURATION_MS` 只有 2 处
 * （`aura_fire.lua:5`、`aura_gas_cloud.lua:5`，都是 10000），而那两个 modifier 各自手写了
 * `persistTimeRemainingMs` 倒计时与 `ResetPersistTime()`。
 * **泰矿是地图自带的永久触发器**（`modifier_tiberium_field_gas_cloud` 是
 * `modifier_triggered` + `trigger_single_tile_aura`，没有任何 Lua 创建它、也没有倒计时），
 * 所以它的 `durationMs` / `expiresAtMs` **不出现**。
 */
export class TileEffect {
  /** 每跳的伤害（含逐目标覆写） */
  readonly damage: Damage;
  /** 每跳间隔；源码 `tickPeriodMs` */
  readonly tickMs: number;
  /** 铺一次持续多久（源码 `PERSIST_DURATION_MS`）；**不出现 = 永久，不参与倒计时** */
  readonly durationMs?: number;
  /** 什么时候过期；**不出现 = 永不过期**。铺/续时都推到「现在 + `durationMs`」 */
  expiresAtMs?: number;

  constructor(damage: Damage, tickMs: number, durationMs?: number, expiresAtMs?: number) {
    this.damage = damage;
    this.tickMs = tickMs;
    this.durationMs = durationMs;
    this.expiresAtMs = expiresAtMs;
  }
}

/** 一块地上能有的三种场地效果 —— 三者都可能共存，也都可以没有 */
export class Tile {
  /** 火焰（圣甲虫 / 火焰轰炸机铺的） */
  fire?: TileEffect;
  /** 泰伯利亚矿床（地图自带） */
  tiberium?: TileEffect;
  /** 毒气（催化剂 / 化武兵 / 毒车铺的） */
  gas?: TileEffect;

  constructor(fire?: TileEffect, tiberium?: TileEffect, gas?: TileEffect) {
    this.fire = fire;
    this.tiberium = tiberium;
    this.gas = gas;
  }
}

// ─────────────────────────────────────────────────────────────
// 单位定义
// ─────────────────────────────────────────────────────────────

import type { WeaponDef } from "./weapon-def.ts";
import type { DeployParams } from "./behaviors/deploy-machine.ts";

/**
 * **战斗员本体** —— 源码 `combatantTuning`（98 个实体有）。
 *
 * 实测出现次数：`health` 98 · `descriptors` 98 · `tags` 98 · `angularSpeed` 98 ·
 * `avoidanceRadius` 98 · `aggroRadiusInTiles` 94 · `goodAgainstTags` 82 · `speed` 76 ·
 * `weaponTunings` 76 · `flyingHeight` 21 · `minFlyingHeight` 19 · `modifier_spawn` 5 ·
 * `healthBarWidthOverride` 4 · `modifier_death` 4 · `maxSimultaneousTargets` 3 · 其余各 1–2。
 */
export interface CombatantBase {
  /**
   * 源码 `health` —— **单个战斗员的血量**（如步枪兵 130、总部 30000）。
   *
   * ⚠️ 源码就这一个数。**`per_member` / `total` 是派生**（`total = health × waveSize`），
   * 旧产物把它算进去过；那是消费方的事，不是源码字段。
   */
  health: number;
  /** 源码 `tags` —— 那 9 个标签（4 基础 + 5 `override_*`），见 findings M17 */
  tags: string[];
  /** 源码 `descriptors` 位掩码（`DESCRIPTOR_BITS` 钉死每个位的值） */
  descriptors: number[];
  /** 源码 `speed` —— 只在 76 个上（建筑 / 炮塔没有） */
  speed?: number;
  /** 源码 `angularSpeed`（转向） */
  angularSpeed: number;
  /** 源码 `avoidanceRadius` */
  avoidanceRadius: number;
  /** 源码 `aggroRadiusInTiles`（94 个） */
  aggroRadiusInTiles?: number;
  /**
   * 源码 `goodAgainstTags` —— **AI 索敌偏好，不是伤害加成**
   * （真实克制看武器的 `overrides`；`extract/write.ts` 早就写过这句）。
   */
  goodAgainstTags: string[];
  /** 源码 `flyingHeight`（21 个，空中单位） */
  flyingHeight?: number;
  /** 源码 `minFlyingHeight`（19 个） */
  minFlyingHeight?: number;
  /** 源码 `healthBarWidthOverride`（4 个：总部/建筑类的血条加宽） */
  healthBarWidthOverride?: number;
  /** 源码 `maxSimultaneousTargets`（3 个：火焰坦克 1 / 猛犸 1 / APC 2）—— ⚠️ **单位级**，武器级没有 */
  maxSimultaneousTargets?: number;

  /**
   * **这个单位持有哪些武器** —— 源码 `combatantTuning.weaponTunings`。
   *
   * ⚠️ 武器**不是独立实体**：`TuningUtil.lua:70-96` 的每个 getter 都是 `(unit, weaponIndex)`。
   * 76 个实体有武器（69 个单武器 / 7 个双武器）；其余（采集车、钻地车、指挥官、建筑）没有。
   */
  weapons: WeaponDef[];
}

/**
 * **小队层** —— 源码 `squadTuning`（98 个实体有）。
 *
 * 实测出现次数：`visionRangeInTiles` 98 · `waveSize` 98 · `maxAttackRangeInTiles` 94 ·
 * `accelerationDistance` 78 · `decelerationDistance` 78 · `hexReservationRadius` 60 ·
 * `attackSeparationDurationMS` 25 · `canBeCrushed` 21 · `stealthDetectionRangeInTiles` 20 ·
 * `priority` 8 · `deathTimer` 6 · `killAwardTiberium` 4 · `repurchaseDiscountFlat` 4 · 其余各 1–3。
 */
export interface SquadBase {
  /** 源码 `waveSize` —— 一队几人 */
  waveSize: number;
  /**
   * 源码 `maxAttackRangeInTiles` —— **体感射程**。
   * ⚠️ 这才是**生效**的那个（`CombatTuningInfo.lua:439-449` 的面板读它）；
   * 武器级的 `maxRangeInTiles` 全树无人读。
   */
  maxAttackRangeInTiles?: number;
  /** 源码 `visionRangeInTiles`（视野） */
  visionRangeInTiles: number;
  /** 源码 `accelerationDistance`（78 个） */
  accelerationDistance?: number;
  /** 源码 `decelerationDistance`（78 个） */
  decelerationDistance?: number;
  /** 源码 `hexReservationRadius`（60 个）—— 占地半径 */
  hexReservationRadius?: number;
  /** 源码 `attackSeparationDurationMS`（25 个）—— 队员轮流开火的间隔 */
  attackSeparationDurationMS?: number;
  /** 源码 `canBeCrushed`（21 个） */
  canBeCrushed?: boolean;
  /** 源码 `stealthDetectionRangeInTiles`（20 个）—— 反隐范围 */
  stealthDetectionRangeInTiles?: number;
  /** 源码 `priority`（8 个）—— ⚠️ **单位级**索敌优先，与武器级的 `usage.flags.priority` 不是一回事 */
  priority?: number;
  /** 源码 `killAwardTiberium`（4 个：采集车之类被杀给矿） */
  killAwardTiberium?: number;
  /** 源码 `repurchaseDiscountFlat`（4 个） */
  repurchaseDiscountFlat?: number;
}

/** **商店层** —— 源码 `combatStoreTuning`（102 个实体有）。⚠️ 这块**没有长尾**，7 个字段全部 ≥18 次 */
export interface StoreBase {
  tiberiumCost: number;
  useGlobalCooldown?: boolean;
  addIncreaseCountOnPurchase?: boolean;
  subtractIncreaseCountOnDeath?: boolean;
  purchaseCooldownMS?: number;
  startCooldownMS?: number;
  addDecreaseCountOnPurchase?: boolean;
}

/**
 * **单位定义**。
 *
 * ⚠️ 字段清单的权威来源是 `CombatUnitTuning.lua` 的 `SetupCombatantTuning` /
 * `SetupSquadTuning` / `SetupCombatStoreTuning`（`:39` / `:72` / `:123`）。
 */
export interface UnitDef {
  /** 实体 id（= 源码里的全局名，如 `unit_gdi_riflemen`） */
  id: string;
  /** 源码顶层 `name` */
  name: string;

  combatant: CombatantBase;
  squad: SquadBase;
  store: StoreBase;

  /**
   * **部署（架设 / 撤收）** —— 源码 `weaponTunings[i].modifier_intro/outro`。
   *
   * ⚠️ **归单位，不归武器**（用户点的，源码也站这边）：那个 `modifier_intro` 挂在哪把武器上
   * 是**容器问题** —— 壁虱坦克就挂在 `weaponTunings[2]`，一个 `name = "hidden"`、
   * `descriptors = { }` 的**空武器槽**上（`unit_nod_ticktank.lua:52-97`，连面板都专门指到槽 2
   * 去读 70% 减伤，`:173`）。引擎自己也是记在战斗员上
   * （`combatant:GetKillingDeployState()`，`death/modifier_ticktank_death.lua:8`）。
   *
   * **没写 = 这个单位不能部署**（绝大多数单位）。
   */
  deploy?: DeployParams;

  /**
   * **出处** —— 手写/机器转换的锚点（J52 的硬约束：没有锚点的数不可信）。
   *
   * 例：`"combatant.health ← :53 `health = 130`"`、`"deploy.unpackMs ← :58 `modifier_intro`"`。
   * 武器自己的锚点在 `WeaponDef.source`（那把武器的账）。
   */
  source?: { script?: string; anchors?: string[] };

  /**
   * **`modifier_*` 块** —— 与武器上的挂件槽同源，只留**引用与原样调参**。
   * 实测：`combatantTuning.modifier_spawn` 5 · `squadTuning.modifier_spawn` 10 ·
   * `combatantTuning.modifier_death` 4。
   */
  modifiers: {
    spawn?: Record<string, unknown>;
    death?: Record<string, unknown>;
    squadSpawn?: Record<string, unknown>;
  };

  /**
   * **顶层 `<X>Tuning` 块** —— 原样留，按源码名字索引。
   *
   * ⚠️ 这 16 种里 **12 种只用 ≤3 次**，而且它们**不是单位属性**：
   * `ionCannonTuning` / `tiberiumExplosionTuning` / `tiberiumStrikeTuning` 是**某个 ability 的参数**；
   * `resonanceFieldTuning` / `tiberiumInfusionTuning` / `fanaticismTuning` /
   * `coordinatedAssaultTuning` 是**某个 modifier 的参数**（`applyXxx` 那半是"施加方"的）。
   * ⇒ **待读的债，不是设计**。
   */
  tunings: Record<string, Record<string, unknown>>;
}
