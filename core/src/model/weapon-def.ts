/**
 * **武器定义（我们的形状）** —— 按"**消费者需要什么**"分块，**不照抄源码的组织方式**。
 *
 * ## 方针（用户定，findings J52）
 *
 * **形状是我们的、数字由机器从源码抠、出处必须留着。** 所以这里：
 *
 * - ❌ **没有 `DamageEntry` 那 6 种 kind** —— 那 6 种只在描述"数字写在源码哪个字段里"
 *   （`own`=`damageTuning`、`stage`=`modifier_sequence.stageN`、`flat`=序列上平铺、
 *   `projectile`=`projectile.modifier`、`shot`=`modifier_shot`、`intro`=`modifier_intro`），
 *   **没有任何消费者需要知道**。真正不同的只有两个机制，已各自归位：**分段**（每段伤害不同
 *   ⇒ 跟段放一起）与**两次命中 / 延迟命中**（⇒ 归 `warhead`）。
 * - ❌ **没有 `other` 那种"原样留的挂件调参袋"**（`modifiers{intro,outro,spawn,shot}` /
 *   `turret` / `art` / `dormant`）—— 要用的值必须**解好、落到字段上**
 *   （例：虎鲸轰炸机的弹夹间隔已解进 `timing.gapMs`）。
 * - ❌ 没有 `weaponType`（源码那个标签**不能**用来判断有没有弹体，J17）；
 *   要表达"命中滞后"就用 `flightMs`。
 * - ❌ 没有 `descriptors` 位掩码（解成 `usage.canAttack: Target[]`）；
 *   没有武器级 `maxRangeInTiles`（**全树无人读**，生效的是小队级 `maxAttackRangeInTiles`）。
 *
 * ## 分块与消费者
 *
 * | 块 | 谁吃 |
 * | --- | --- |
 * | `timing` | **武器机**（什么时候开火）—— 三类：`cyclic` / `magazine` / `staged` |
 * | `damage` | 伤害层（打多少）。⚠️ **分段武器为 `null`** —— 它的伤害在 `timing.stages[]` 里 |
 * | `warhead` | 伤害层（打中之后做什么） |
 * | `splash` | 伤害层（还打谁 / 怎么衰减）。**副伤就是 `damage.side`**，不再另设引用 |
 * | `flightMs` | 伤害层（开火到命中差多久） |
 * | `usage` | 双方（能不能打、打谁、几口） |
 * | `source` | **人**（半手动转换时的锚点） |
 */

import type { Damage, Target } from "./unit-def.ts";
import type { WarheadDef } from "./warhead-def.ts";

// ─────────────────────────────────────────────────────────────
// ① 伤害（定义得最早 —— 分段武器的每段要带它）
// ─────────────────────────────────────────────────────────────

/**
 * **这把武器的伤害** —— **就一处**（副伤也在这一处）。
 *
 * 不再有"数字住在源码哪儿"的 kind，也不再套一层"伤害档"包装：
 * 分段武器的每段伤害就是 `WeaponDef.damage[]` 里的一项。
 */
export interface WeaponDamage {
  /** 主目标吃多少 */
  main: Damage;
  /** 副目标（溅射 / 链）吃多少；`null` = 没有副伤 */
  side?: Damage;
  /**
   * **副目标最多点名几个**（光束炮段 2 是 2 个、段 3 是 3 个）；`null` = 没有副目标。
   * ⚠️ 它按档位变，所以跟着伤害走，而不是写在 `splash.pick` 上。
   */
  sideTargetCount?: number;
}

// ─────────────────────────────────────────────────────────────
// ② 节奏 —— 三种，与武器机三个小类一一对应
// ─────────────────────────────────────────────────────────────

/**
 * **节奏 —— 只有三种**，与三个武器机小类**一一对应**（findings J49）：
 *
 * | `kind` | 谁 | 状态机 |
 * | --- | --- | --- |
 * | `cyclic` | 单发 + 多发（一轮 `hits` 发、间隔 `intervalMs`） | `CyclicWeapon` |
 * | `magazine` | 弹夹（打空装填，补满按比例） | `MagazineWeapon` |
 * | `staged` | 分段（光束炮/蛇怪，逐段变强） | `StagedWeapon` |
 *
 * ⚠️ **字段全是毫秒、全是"已经解好的"** —— "节奏散在哪儿、是秒还是毫秒、从哪个键读"
 * 全在提取端解决（J18）。武器机**构造时直接吃这个对象**，不需要"挑选器"。
 *
 * `impl` 是**出处**（哪个源码脚本给的节奏；引擎驱动 ⇒ 不写），只给溯源用，**不参与分派**。
 */
export type Timing =
  | {
      kind: "cyclic";
      /** 一轮的周期（**从轮首起算**） */
      cooldownMs: number;
      /** 轮首到首发之间的前摇 */
      chargeUpMs: number;
      /** **第一次**开火之前的一次性蓄力 */
      initialChargeUpMs: number;
      /** 一轮扣几次扳机（多发 > 1；枪口展开是**伤害侧**的事） */
      hits: number;
      /** 一轮内两发之间的间隔 */
      intervalMs: number;
      impl?: string;
    }
  | {
      kind: "magazine";
      /** 一夹几发 */
      clipSize: number;
      /** 装填时长 —— **从弹夹第一发起算**（用户实测：MLRS 打光 3 发 = 首发 + 5s） */
      reloadTimeMs: number;
      /** 弹夹内每发之间的间隔 */
      gapMs: number;
      /** 弹夹第一发之前的前摇（落在装填那段的尾巴里） */
      chargeUpMs: number;
    }
  | {
      kind: "staged";
      /** 首轮蓄力（只在"还没打过"时付） */
      initialChargeUpMs: number;
      /** 段进度保质期；`null` = 按"重来"处理 */
      storeChargeTimeMs?: number;
      /** 按顺序的段；**`attackCount` 不出现** = 末段（无限）。伤害不在这里（见 `damage[]`） */
      stages: Array<{ attackCount?: number; tickPeriodMs: number }>;
      impl?: string;
    };

// ─────────────────────────────────────────────────────────────
// ③ 溅射 —— 主目标之外还打哪些
// ─────────────────────────────────────────────────────────────

/**
 * **还打谁** —— 挑法与衰减。
 *
 * ⚠️ **不持伤害** —— 副伤就是 `damage.side`（也不再需要 `damageRef` 那种字符串引用）。
 */
export interface SplashDef {
  /**
   * 副目标怎么挑。
   * ⚠️ **"挑几个"不在这里** —— 它按档位变（光束炮段 2 是 2 个、段 3 是 3 个），
   * 所以写在 `DamageTier.sideTargetCount` 上。
   */
  pick:
    /** 主目标格的第 1 环里再点名若干个队伍（光束炮） */
    | { kind: "ring" }
    /** 主目标格 + 朝目标方向的相邻格（火焰坦克的楔形） */
    | { kind: "wedge" }
    /** 主目标与目标之间的一条线（干扰者 `GetCombatantsInLine`） */
    | { kind: "line" };
  /** 按距离打折的曲线（离子炮 / 虎鲸轰炸机）；`null` = 不打折 */
  falloff?: Array<{ distance: number; percent: number }>;
  ramped?: boolean;
}

// ─────────────────────────────────────────────────────────────
// ④ 使用规则
// ─────────────────────────────────────────────────────────────

/**
 * **射击控制旗标** —— 这批**确实按武器写**，存在理由就是"同一单位多把武器规则不同"
 * —— 利爪 `machineGun` 写 `priority = 0`、`rockets` 写 `priority = 1`（findings J15）。
 */
export interface FireControlFlags {
  canShootWhileMoving?: boolean;
  canInterruptIntro?: boolean;
  canShootOverWalls?: boolean;
  disableSpawnGrace?: boolean;
  onlyFireWhenPrimary?: boolean;
  faceTargetBeforePackup?: boolean;
  ignoreFacing?: boolean;
  useAlternateAirTarget?: boolean;
  /** ⚠️ 武器之间的相对先后（利爪 0/1） */
  priority?: number;
  minIdleTimeBeforeUnpack?: number;
}

/** **打几个、怎么散**（源码 `targetingTuning`，27 把有） */
export interface TargetingDef {
  mode: "kCenter" | "kRandom" | "kDirect";
  centerSpread?: number;
  randomBurstMin?: number;
  randomBurstMax?: number;
}

/** **用它的规矩** */
export interface WeaponUsage {
  /**
   * **能打谁** —— 从源码 `descriptors` 位掩码**解好**的 5 类目标。
   * 空数组 = 索敌方式未知（全库 6 把）。
   */
  canAttack: Target[];
  /** 枪口数（**伤害侧**用：`All` 时每口各出一份伤害） */
  muzzleCount: number;
  /** 实测只有两种值：`All` 16 / `RoundRobin` 2（弹弓 / 狼獾） */
  muzzleStrategy?: "All" | "RoundRobin";
  targeting?: TargetingDef;
  flags: FireControlFlags;
}

// ─────────────────────────────────────────────────────────────
// ⑤ 出处
// ─────────────────────────────────────────────────────────────

/**
 * **出处** —— 半手动转换的锚点（J52 的硬约束：**没有锚点的数不可信**）。
 *
 * 例：`"cooldownMs ← unit_gdi_riflemen.lua:34"`、`"面板公式 CombatTuningInfo.lua:705"`、`"游戏内实测"`。
 */
export interface WeaponSource {
  /**
   * 源码脚本（相对 `gameplay/`）；**不出现 = 引擎驱动**（这个族没有 Lua 脚本）。
   */
  script?: string;
  anchors: string[];
}

// ─────────────────────────────────────────────────────────────
// 默认 warhead —— "没写"不等于"什么都不做"
// ─────────────────────────────────────────────────────────────

/**
 * **没写 `warhead` 的武器，命中后果是"只打最后一员"。**
 *
 * ⚠️ **不是"没有效果"**（用户给的实测口径：「没写就是从最后一个逐个打」）。
 * 源码对应 `DamageUtil.lua:43` 的 `squad:GetLastCombatant():TakeRedirectDamage(...)`
 * —— 也就是**从最后一个活着的成员开始，逐个打掉**，而不是"第一个"。
 *
 * 三条路径在 Lua 里分得很清楚（findings J55）：
 *
 * | 路径 | 打谁 | Lua 里谁在用 |
 * | --- | --- | --- |
 * | `DamageCombatant*`（`TakeDirectDamage`） | **指定的某一员** | 光束炮主伤 · 蛇怪主伤 · 幻影激光 · 干扰者（一条线）· 泰坦 · 离子炮 |
 * | **`DamageSquad*`（`GetLastCombatant`）** | **只掉最后一员** | 圣灵开火 · 光束炮**副伤** · 火焰坦克链 · 寡妇制造者 —— 以及**默认**（纯弹道武器由引擎打，没有 Lua） |
 * | `AoeDamageSquad*`（`TakeAOEDamage`） | **整队每人各一份** | 催化爆炸 · 深岩巨虫 · 泰矿爆炸/打击 · 持续伤害（火/毒） |
 * | `nDamage.DamageCombatantsFalloff` | 一串目标 + **按距离衰减** | 离子炮 · 虎鲸轰炸机 |
 */
export const DEFAULT_WARHEAD: WarheadDef = [{ kind: "one_member" }];

/** **"伤害怎么交付"那几个 kind** —— 弹头里写了其中之一，才算显式指定了交付方式 */
const DELIVERY_KINDS: ReadonlySet<string> = new Set(["one_member", "squad_each", "per_combatant", "falloff"]);

/**
 * **实际生效的 warhead** —— 没写就是 {@link DEFAULT_WARHEAD}（别自己判 `undefined` 当没效果）。
 *
 * ⚠️ **写了弹头、但没写"伤害怎么交付"时，默认那条照样生效**（用户指出：
 * 「只打最后一个成员这种在毒车等都没出现，怀疑没写分配伤害就默认加入只打最后一个成员」）：
 * 生化越野车 / 化武兵的弹头里只有"铺毒气"（`place_modifier` / `refresh_modifier`），
 * **没有**交付方式 ⇒ 它那点直接伤害仍走引擎的默认路径（`GetLastCombatant` = **只打最后一员**）。
 * 所以这里把默认那条**并到最前面**，而不是"有弹头就整个替换掉"。
 */
export function warheadOf(w: WeaponDef): WarheadDef {
  const own = w.warhead;
  if (own === undefined) return DEFAULT_WARHEAD;
  if (own.some((e) => DELIVERY_KINDS.has(e.kind))) return own;
  return [...DEFAULT_WARHEAD, ...own];
}

/** 这份弹头是"源码没写、整个走默认"，还是"写了但缺交付方式、默认并进来" */
export function warheadOrigin(w: WeaponDef): "default" | "default-plus-effects" | "explicit" {
  const own = w.warhead;
  if (own === undefined) return "default";
  return own.some((e) => DELIVERY_KINDS.has(e.kind)) ? "explicit" : "default-plus-effects";
}

// ─────────────────────────────────────────────────────────────
// 武器
// ─────────────────────────────────────────────────────────────

/**
 * **武器定义** —— 七个字段，按消费者分。
 *
 * ⚠️ 字段清单的权威来源是 `CombatUnitTuning.lua` 的 `SetupWeaponTuning`
 * **加上**它不管的 10 个射击控制旗标（引擎直接读）；但**形状是我们定的**，
 * 需要用的值必须解好（见文件头）。
 */
export interface WeaponDef {
  /** 武器槽名（`rifle` / `cannon` / `catalystWeapon` …） */
  id: string;
  /** 本地化键；**不出现** = 源码没写 `displayName` */
  name?: string;

  /** 什么时候开火（**武器机直接吃**） */
  timing: Timing;
  /**
   * **打多少** —— 分段武器**每段一项**（与 `timing.stages` 同序），其余武器就 1 项。
   * 武器机看不到这一块。
   */
  damage: WeaponDamage[];
  /**
   * 打中之后做什么。
   *
   * ⚠️ **不写 ≠ 没有后果** —— 不写就是 {@link DEFAULT_WARHEAD}（**只打最后一员**，
   * 从最后一个活着的成员开始逐个打）。要"真的什么都不做"得显式写一个空数组。
   * 12/83 把武器显式写了 `projectile.modifier`。
   */
  warhead?: WarheadDef;
  /** 还打谁（副伤在 `damage[].side`）；**不出现** = 没有副目标 */
  splash?: SplashDef;
  /** **开火到命中**差多久（毫秒）；`null` = 还不知道（用全局占位，见 findings J45） */
  flightMs?: number;
  /**
   * **自杀式**：这一轮打完，**使用者自己就没了**（只有一轮，没有第二轮）。
   *
   * 依据：圣甲虫的武器序列结束时 `self:GetOwnerCombatant():TakeHiddenDestroyDamage()`
   * （`ability_scarab_weapon_sequence.lua:51`）—— 直接销毁，**不吃减伤、不溅射**（findings J50）。
   * 对界面的影响：时序图**不能按周期重复画**（画第二轮等于说"它还会再打一发"）。
   */
  selfDestruct?: boolean;
  /** 能不能打 / 打谁 / 几口 */
  usage: WeaponUsage;
  /** 出处（半手动转换的锚点） */
  source: WeaponSource;
}
