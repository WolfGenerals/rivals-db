/**
 * **步枪兵**（GDI 步兵）—— **手写 def，不走 `data/units.json`**。
 *
 * 方针（findings J52）：**形状是我们的、数字从源码抠、出处逐项标注**。
 * 全部数值来自 `gameplay/units/unit_gdi_riflemen.lua`（行号见字段旁与 `source.anchors`）。
 *
 * ## 这里放什么
 *
 * 只放**静态调参**：
 *
 * - `timing` → 交给**武器机**（`core/src/model/weapons/`）跑出"什么时候开火"
 * - `damage` / `warhead` / `splash` / `flightMs` → 交给**伤害层**（还没写）
 * - `usage` → 能不能打 / 打谁 / 几口
 *
 * ## 按方针**故意不建模**的源码字段
 *
 * | 源码字段 | 为什么不收 |
 * | --- | --- |
 * | `maxRangeInTiles = 2.5`（`:29`） | 引擎不读；**生效的是小队级 `maxAttackRangeInTiles = 1`**（`:60`） |
 * | `weaponType = "projectile"`（`:30`） | 不能用来判断有没有弹体（findings J17） |
 * | `targetSelector`（`:31`） | 83/83 把同值，无区分度（findings J3） |
 * | `turret`（`:24-28`） | 源码自己写着 `-- This is unsed` |
 * | `projectile.homing` / `min`/`maxRangeTimeToHit`（`:19-21`） | `5/10` 是 boilerplate（findings J45）；`homing` 无人读 |
 * | `oldTuning = unit_gdi_riflemen`（`:2`） | 自引用 |
 */

import { Damage } from "../model/unit-def.ts";
import type { UnitDef } from "../model/unit-def.ts";
import type { WeaponDef } from "../model/weapon-def.ts";

/** 步枪兵的武器 `rifle`（源码 `unit_gdi_riflemen.lua:8-45`） */
const RIFLE: WeaponDef = {
  id: "rifle",
  // `name` 不填 —— 源码没有 `displayName`

  /*
   * 节奏 ← `:32-37` `burstTiming = { cooldown = 1.72, chargeUpDuration = 0, numToBurst = 1 }`
   * ⇒ 周期 1720ms（**秒已换成毫秒**）、无前摇、一轮一发。
   * `initialChargeUpMs` 源码没写 ⇒ 0。
   * `impl` 不填 —— 常规族由**引擎**驱动，没有 Lua 序列（findings J20）。
   */
  timing: { kind: "cyclic", cooldownMs: 1720, chargeUpMs: 0, initialChargeUpMs: 0, hits: 1, intervalMs: 0 },

  /*
   * 伤害 ← `:11-15` `damageTuning = { default = 38, overrides = { { DamageOverride.Vehicle, 15 } } }`
   * ⇒ 基础 38；打**载具**改成 **15（绝对伤害，不是倍率）**。没有副伤 ⇒ `side`/`sideTargetCount` 不填。
   */
  damage: [{ main: new Damage(38, [["override_vehicle", 15]]) }],

  // `warhead` / `splash` / `flightMs` 都不填：
  // · 武器上没有 `projectile.modifier` ⇒ 命中后没有额外效果
  // · 没有副目标
  // · 开火→命中待算（`:18` `initialSpeed = 125`，1 格 = 8 世界单位 ⇒ 1 格 ≈ 64ms；J45）

  usage: {
    /*
     * 能打谁 ← `:10` `descriptors = { Ground(8), AttackableTypeMask(16) }`
     * 按 `canAttackTarget`（`core/src/types.ts:800-808`）展开：
     * **建筑恒可打**；有 `Ground` 位 ⇒ 步兵 / 载具 / 采集车；**没有飞行位(4096)** ⇒ **打不到空中**。
     */
    canAttack: ["Infantry", "Vehicle", "Structure", "Harvester"],
    muzzleCount: 1, // `:38`
    // `muzzleStrategy` 不填 —— 源码没写 ⇒ 轮流（单口无所谓）
    targeting: { mode: "kRandom", randomBurstMin: 2, randomBurstMax: 5 }, // `:39-44`（无 centerSpread）
    /*
     * ⚠️ 那 10 个射击控制旗标，**这个武器块里一个都没写** ⇒ **整个 `flags` 是空的**。
     * 旗标是引擎直接读的、不在这份 Lua 里（findings J15）。
     */
    flags: {},
  },

  /** **出处**（J52 的硬约束：没有锚点的数不可信） */
  source: {
    script: "gameplay/units/unit_gdi_riflemen.lua",
    anchors: [
      "timing ← :32-37 `burstTiming`（秒 → 毫秒；`initialChargeUpMs` 缺失 ⇒ 0）",
      "damage ← :11-15 `damageTuning.default = 38` + `overrides = {{DamageOverride.Vehicle, 15}}`",
      "usage.canAttack ← :10 `descriptors`，按 `core/src/types.ts:800-808` 的 `canAttackTarget` 规则展开",
      "usage.muzzleCount / targeting ← :38-44",
      "flightMs ← 待按 :18 `initialSpeed = 125` 与交火距离算（findings J45）",
      "周期口径与单位行为：findings J20 / J44（产物 `data/units.json` 的 `derived.attack` 与之一致）",
    ],
  },
};

/**
 * 步枪兵的**单位定义**（源码 `unit_gdi_riflemen.lua` 全文）。
 *
 * ⚠️ 血量是**单个战斗员**的（130），不是小队总和；小队满血 = `level.hp(130 × 5)`
 * —— 两个取整顺序不同，`827`（先乘后取整）而不是 `825`（findings J25）。
 */
export const unit_gdi_riflemen: UnitDef = {
  id: "unit_gdi_riflemen", // 源码顶层 `name`（`:3`）
  name: "unit_gdi_riflemen", // 本地化键；中文名从 `data/locale/` 取

  combatant: {
    health: 130, // `:53`
    tags: ["Infantry", "override_infantry"], // `:48`
    // `:47` `{ Ground(8), Infantry(256), ApplyAvoidance(2), Offensive(4) }`（位值见 `DESCRIPTOR_BITS`）
    descriptors: [8, 256, 2, 4],
    speed: 6.928, // `:54`
    angularSpeed: 300, // `:51`
    avoidanceRadius: 1.7, // `:50`
    aggroRadiusInTiles: 2.5, // `:52`
    goodAgainstTags: ["Infantry"], // `:49` —— **AI 索敌偏好，不是伤害加成**
    // `flyingHeight` / `minFlyingHeight` / `healthBarWidthOverride` / `maxSimultaneousTargets` 都不填（源码没写）
    weapons: [RIFLE],
  },

  squad: {
    waveSize: 5, // `:58`
    maxAttackRangeInTiles: 1, // `:60` —— **生效的那个射程**（不是武器上的 2.5）
    visionRangeInTiles: 3, // `:59`
    accelerationDistance: 1, // `:62`
    decelerationDistance: 1, // `:63`
    hexReservationRadius: 3, // `:64`
    attackSeparationDurationMS: 344, // `:61` —— 队员轮流开火的错开（引擎侧，Lua 零读取，J26）
    canBeCrushed: true, // `:66`
    stealthDetectionRangeInTiles: 1, // `:65`
    // `priority` / `killAwardTiberium` / `repurchaseDiscountFlat` 都不填（源码没写）
  },

  store: {
    tiberiumCost: 10, // `:71`
    useGlobalCooldown: true, // `:70`
    addIncreaseCountOnPurchase: true, // `:72`
    subtractIncreaseCountOnDeath: true, // `:73`
    // `purchaseCooldownMS` / `startCooldownMS` / `addDecreaseCountOnPurchase` 都不填（源码没写）
  },

  /** 源码里没有 `modifier_spawn` / `modifier_death` / 小队级 `modifier_spawn` ⇒ 空对象 */
  modifiers: {},

  /** 没有顶层 `*Tuning` 块（这块本来就是"待读的债"，findings J22） */
  tunings: {},
};
