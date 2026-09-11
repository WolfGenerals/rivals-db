/**
 * `data/` 产物的类型定义与访问器。
 *
 * 这一层的作用是**让文档记录的坑难以踩中**：
 *
 * | 坑 | 由什么防住 |
 * | --- | --- |
 * | `health` 是每员血量，不是小队总血 | `squadHealth()` 而非裸读字段 |
 * | `goodAgainstTags` 是索敌偏好，不是伤害加成 | 类型上叫 `targetingIntent`，注释写明 |
 * | `overrides` 大多比 `default` **低** | `damageAgainst()` 统一取值 |
 * | `muzzleCount` 多数不生效 | `baseDps()` 内置 `muzzleStrategy` 判断 |
 * | `descriptors` 是编造的占位值 | 标成 `Placeholder` 类型并在注释警告 |
 *
 * 原始数据不在这里重新解释，只是给出形状 + 安全取值。
 * 字段语义与陷阱的完整说明见 docs/data-semantics.md，
 * 等级换算见 docs/level-scaling.md。
 */

// ── 1. 枚举（值是名字字符串，数字值缺失）────────────────────────────

/** 单位类型。注意采集车的基础类型也是 `Vehicle`，靠 `override_harvester` 区分。 */
export type UnitTag =
  | "Structure"
  | "Vehicle"
  | "Aircraft"
  | "Infantry"
  | "Harvester"
  | "override_structure"
  | "override_vehicle"
  | "override_aircraft"
  | "override_infantry"
  | "override_harvester";

/** 伤害覆写的目标类型。 */
export type DamageOverrideTag = "Infantry" | "Vehicle" | "Aircraft" | "Structure" | "Harvester";

/** 基础单位类型：`tags` 里去掉 `override_` 前缀的那个。 */
export type BaseUnitType = "Structure" | "Vehicle" | "Aircraft" | "Infantry" | "Harvester";

export type Faction = "GDI" | "NOD" | "UNKNOWN";

/**
 * 位掩码占位值 —— **不可用于任何计算**。
 *
 * `CombatantDescriptor` 的枚举定义在宿主 C++ 里，Lua 源码只有名字，
 * 提取时用「访问即返回 2 的幂」保证位运算不报错，所以数字是编造的。
 */
export type Placeholder = number | number[];

// ── 2. 武器 ───────────────────────────────────────────────────────

export interface DamageOverrideEntry {
  0: DamageOverrideTag;
  1: number;
}

/** `overrides` 的条目对象形式（`pickDamage` 用）。 */
export interface DamageOverride {
  tag: string;
  damage: number;
}

export interface DamageTuning {
  /** 基础伤害（对未列在 `overrides` 中的目标） */
  default?: number;
  /** 对特定类型的伤害覆写。**多数比 `default` 低** —— 那才是真实克制关系 */
  overrides?: DamageOverrideEntry[];
}

export interface BurstTiming {
  /** 每轮发数（83/83 个武器都有） */
  numToBurst?: number;
  /**
   * 攻击冷却（秒）。
   *
   * ⚠ 与 `chargeUpDuration` 的关系未确证：可能是「两轮之间的间隔」，
   * 也可能是「整轮周期」。用 `refireInterval()` 取保守估计。
   */
  cooldown?: number;
  /**
   * **每次攻击的前摇**（秒）—— 蓄力/瞄准阶段。
   *
   * 65/83 个武器有，其中 36 个非零。最长的几个：方尖碑 3s、
   * 巨无霸 0.25s、捕食者 1s、土狼 0.75s。
   *
   * ⚠ 与 `modifier_intro`（架设时间）**不是一回事**：这个是每发都有，
   * 那个是切换形态的一次性耗时。
   */
  chargeUpDuration?: number;
  /** 蓄力期间需要锁定目标的时间（秒），仅 8/83 */
  chargeUpLockOnTime?: number;
  /** 每秒射速，仅 2/83 有；多数武器用 `cooldown` */
  fireRate?: number;
}

/** 弹夹式武器（仅 7/83 个）。打空弹夹后装填，爆发集中在弹夹前段。 */
export interface ReloadTuning {
  clipSize?: number;
  reloadTimeMs?: number;
  idleTimeBeforeReloadMs?: number;
  autoReload?: boolean;
  doNotDisplayInUI?: boolean;
}

export interface ProjectileTuning {
  /** `false` 表示可被走位躲开 */
  homing?: boolean;
  initialSpeed?: number;
  maxSpeed?: number;
  acceleration?: number;
  minRangeTimeToHit?: number;
  maxRangeTimeToHit?: number;
  calculateSpeedFromTimeToHit?: boolean;
  modifier?: { name?: string; [k: string]: unknown };
}

export interface TargetingTuning {
  /** `kDirect` / `kClosest` / `kRandom` / `kCenter` */
  targetMode?: string;
  centerSpread?: number;
  randomBurstMin?: number;
  randomBurstMax?: number;
  [k: string]: unknown;
}

export interface WeaponTuning {
  /** 内部名（`cannon` / `rifle` / `rockets`），不是显示文本 */
  name?: string;
  /** 本地化 key，不是显示文本 */
  displayName?: string;
  /** `projectile` / `instant` */
  weaponType?: string;
  damageTuning?: DamageTuning;
  burstTiming?: BurstTiming;
  reloadTuning?: ReloadTuning;
  projectile?: ProjectileTuning;
  targetingTuning?: TargetingTuning;
  turret?: Record<string, unknown>;
  /** 射程（格） */
  maxRangeInTiles?: number;
  /**
   * 枪口数。**只有 `muzzleStrategy === "All"` 时才计入 DPS**，
   * 所以多数单位写了它也不生效（见 docs/data-semantics.md 第 5 节）。
   */
  muzzleCount?: number;
  /** 仅 15/83 个武器有，取值 `All` */
  muzzleStrategy?: string;
  /**
   * ⚠ 全部 83 个武器都是同一个值 `unit_antiInfantry`，**不是有效判别字段**。
   */
  targetSelector?: string;
  /** ⚠ 位掩码占位值，不可用 */
  descriptors?: Placeholder;

  // ── 架设 / 收起 / 动画（与「每次攻击前摇」是不同概念）─────────

  /**
   * **架设**（展开）状态：`{ tuning: { durationMs } }`。仅 9/83。
   *
   * 这是「从移动形态切换到可开火形态」的一次性耗时，例如巨无霸
   * `5000ms`、MLRS `2000ms`。**不是每发的后摇。**
   */
  modifier_intro?: { name?: string; tuning?: { durationMs?: number; [k: string]: unknown }; [k: string]: unknown };
  /** **收起**状态，结构同 `modifier_intro`。仅 9/83 */
  modifier_outro?: { name?: string; tuning?: { durationMs?: number; [k: string]: unknown }; [k: string]: unknown };
  /** 架设期间能否被打断重新移动。仅 10/83 */
  canInterruptIntro?: boolean;
  /**
   * 与「受限射界」相关的引入时长（秒），仅 4/83（炮塔、方尖碑及其变体）。
   * 语义见 `CombatTuningInfo.TryGetLimitedFireArc`。
   */
  introDuration?: number;
  /**
   * 开火动画时长（秒），仅 5/83。最接近「攻击动作耗时」的字段，
   * 但巨无霸的是 `0.01`，说明它并非通用的后摇。
   */
  fireAnimTime?: number;

  /** 未单独建模的透传字段 */
  [k: string]: unknown;
}

// ── 3. 调参树 ─────────────────────────────────────────────────────

export interface CombatantTuning {
  /** ⚠ **每员**血量，不是小队总血。用 `squadHealth()` 取总血 */
  health?: number;
  speed?: number;
  angularSpeed?: number;
  aggroRadiusInTiles?: number;
  avoidanceRadius?: number;
  flyingHeight?: number;
  minFlyingHeight?: number;
  /** 单位类型，形如 `["Vehicle", "override_vehicle"]` */
  tags?: UnitTag[];
  /**
   * ⚠ **AI 的索敌偏好**，不产生伤害加成。真实克制看
   * `weaponTunings[].damageTuning.overrides`。
   */
  goodAgainstTags?: DamageOverrideTag[];
  weaponTunings?: WeaponTuning[];
  /** ⚠ 位掩码占位值，不可用 */
  descriptors?: Placeholder;
  [k: string]: unknown;
}

export interface SquadTuning {
  /** 小队人数。步兵 3~5，载具 1 */
  waveSize?: number;
  visionRangeInTiles?: number;
  maxAttackRangeInTiles?: number;
  minAttackRangeInTiles?: number;
  /** 能否被碾压 */
  canBeCrushed?: boolean;
  /** 反隐范围 */
  stealthDetectionRangeInTiles?: number;
  stealthTuning?: Record<string, unknown>;
  /** 被击杀时对方获得的矿 */
  killAwardTiberium?: number;
  /**
   * 小队成员之间的开火错开（毫秒）。
   *
   * 每个队员按 `t = i × 本值 + k × cooldown` 各自开火，数据里**没有分组逻辑**
   * —— 「齐射」是相位漂移自然撞出来的（见 `WeaponTimeline.vue`）。
   * 本值 × 人数 不一定等于 cooldown：攻击摩托是 0.75s vs 4.25s（有意打爆发），
   * 狂信徒是 2.25s vs 0.85s（会跨轮重叠）。
   */
  attackSeparationDurationMS?: number;
  deathTimer?: number;
  deathCooldownMs?: number;
  repurchaseDiscountFlat?: number;
  [k: string]: unknown;
}

export interface CombatStoreTuning {
  /** 泰伯利亚矿造价。采集车/炮塔等不参与商店的单位没有此字段 */
  tiberiumCost?: number;
  startCooldownMS?: number;
  purchaseCooldownMS?: number;
  useGlobalCooldown?: boolean;
  addIncreaseCountOnPurchase?: boolean;
  subtractIncreaseCountOnDeath?: boolean;
  [k: string]: unknown;
}

/** 引擎指针与历史别名，提取时已剔除。 */
export interface Config {
  name?: string;
  combatantTuning?: CombatantTuning;
  squadTuning?: SquadTuning;
  combatStoreTuning?: CombatStoreTuning;
  /** 指挥官的技能调参（离子炮/恐怖术等），形状随技能而异 */
  [k: string]: unknown;
}

/**
 * 稀有度与起始等级。
 *
 * 来源是 `game-config.pb`（Lua 源码里没有）。**pb 里没有条目的单位就是没有**，
 * 不会凭空补：采集车、修理无人机、炮塔、方尖碑、钻地车这类不参与商店
 * 等级体系的单位没有此字段。
 */
export interface RarityInfo {
  /**
   * 稀有度名。已知取值见 `Rarity`，但从 pb 解出的原始值是字符串，
   * 所以这里放宽为 `string` 以免上游数据变了就编译不过。
   */
  rarity?: string;
  /** 起始 major 等级 = 2×稀有度编号−1（Common→1 / Rare→3 / Epic→5） */
  start_major?: number;
}

/** 已知的稀有度取值。 */
export type Rarity = "Common" | "Rare" | "Epic";

/** 一个单位或指挥官的产物文件。 */
export interface EntityRecord {
  /** Lua 全局名，等于源文件名去掉 `.lua` */
  id: string;
  faction: Faction;
  /** 去掉变体后缀的基础名 */
  variant: string;
  /** 变体后缀，如 `["ST"]` / `["CR"]` / `["mayhem"]`；无后缀时省略 */
  suffixes?: string[];
  /** 相对 scripts 根的源文件路径，可回溯核对 */
  source: string;
  /** 提取时被丢弃的占位/未解析字段 */
  warnings?: string[];
  pb?: RarityInfo;
  config: Config;
  /**
   * 开火装备表（`unit_<id>_visual` / `cmdr_<id>_visual`）的**摘要**，按能力序列名分组。
   *
   * 只留 `MUZZLE_INFO`，因为**一轮发数 = `#MUZZLE_INFO`** —— 这是引擎自己的规则，
   * 见 `ability_kodiak_weapon_sequence.lua:19` 的断言与 `docs/attack-mechanics.md` 9.1。
   * `muzzleInfo[i]` 是「逻辑枪口号 → 物理枪口号」的映射值，**枪口数不乘 DPS**。
   *
   * 只对定义了该全局的单位存在（全库 4 个：神像 ×2、沙暴 ×2）。
   */
  visual?: Record<string, { muzzleInfo?: number[] }>;
  /** 仅出现在 `unit_example` / `unit_dlc_test` 这类非调参表上 */
  raw_value?: unknown;
  _note?: string;
  /**
   * 本地化字段：由本地化构建步骤按 pb 里的 loc key 回填
   * （见 `_build_locale.py`）。不是 extract 产出的，所以是可选的。
   */
  name_en?: string;
  name_zh?: string;
  desc_en?: string;
  desc_zh?: string;
}

// ── 4. index.json ─────────────────────────────────────────────────

export interface UnitSummary {
  id: string;
  faction: Faction;
  variant: string;
  suffixes?: string[];
  rarity?: string;
  start_major?: number;
  /** ⚠ 每员血量，总血 = health × wave_size */
  health?: number;
  speed?: number;
  cost?: number;
  damage?: number;
  damage_overrides?: DamageOverrideEntry[];
  range?: number;
  cooldown?: number;
  weapon_count?: number;
  tags?: UnitTag[];
  /** ⚠ 索敌偏好，不是克制关系 */
  good_against?: DamageOverrideTag[];
  wave_size?: number;
  vision_range?: number;
}

export interface UnitIndex {
  _note?: string;
  unit_count: number;
  gdi_count: number;
  nod_count: number;
  misc_count?: number;
  units: UnitSummary[];
}

export interface FactionInfo {
  name: string;
  component: {
    /** 所有指挥官共用的基地血量（实测 30000） */
    standardBaseHealth: number | null;
    /** 矿车单位名（实测 `Unit_Gdi_Harvester`） */
    harvesterUnitName: string | null;
    conYard: string | null;
    protoPad: string | null;
  };
}

export interface CommanderIndex {
  _note?: string;
  commander_count: number;
  /** 阵营基础数据，全部指挥官共用 */
  factions: FactionInfo[];
  commanders: UnitSummary[];
}

// ── 5. 访问器（避免踩坑的统一入口）────────────────────────────────

/**
 * 小队总血 = 每员血量 × 人数。**这是游戏面板显示的那个数。**
 *
 * 同时接受完整记录（`{ config }`）与 `index.json` 的扁平概览
 * （`{ health, wave_size }`），省得调用方自己拼形状。
 */
export function squadHealth(entity: {
  config?: Config;
  health?: number;
  wave_size?: number;
}): number | undefined {
  const cfg = entity.config;
  if (cfg) {
    const per = cfg.combatantTuning?.health;
    if (per === undefined) return undefined;
    return per * (cfg.squadTuning?.waveSize ?? 1);
  }
  if (entity.health === undefined) return undefined;
  return entity.health * (entity.wave_size ?? 1);
}

/** `tags` 里的基础单位类型（去掉 `override_` 前缀的那个）。 */
export function baseUnitType(rec: { config: Config }): BaseUnitType | undefined {
  for (const t of rec.config.combatantTuning?.tags ?? []) {
    if (!t.startsWith("override_")) return t as BaseUnitType;
  }
  return undefined;
}

/** `tags` 里的伤害覆写键（`override_harvester` -> `Harvester`）。 */
export function overrideTag(rec: { config: Config }): DamageOverrideTag | undefined {
  for (const t of rec.config.combatantTuning?.tags ?? []) {
    if (t.startsWith("override_")) {
      return (t.slice("override_".length).charAt(0).toUpperCase() +
        t.slice("override_".length + 1)) as DamageOverrideTag;
    }
  }
  return undefined;
}

/**
 * 取对目标类型的**实际伤害**。
 *
 * 对应 `nTuningUtil.GetDamageOverrideWS`：无匹配用 `default`；
 * **多条同时匹配时取最大值**（不是最先匹配的）。
 */
export function damageAgainst(
  weapon: WeaponTuning,
  targetTag: DamageOverrideTag,
): number {
  const dt = weapon.damageTuning;
  if (!dt) return 0;
  const fallback = dt.default ?? 0;
  let best: number | undefined;
  for (const entry of dt.overrides ?? []) {
    if (entry[0] !== targetTag) continue;
    if (best === undefined || entry[1] > best) best = entry[1];
  }
  return best ?? fallback;
}

// ── 目标的伤害查找链与可攻击判定 ────────────────────────────────
//
// ⚠️ 下面是**数据语义**，不是展示逻辑，所以放在 core 而不是网页组件里：
// CLI、对比页、以后的数据校验脚本都要用同一套判定。
//
// 两个概念必须分开，混起来就是错的：
//   1. **打不打得到**（`canAttackTarget`）—— 由武器自己的 `descriptors` 位掩码决定
//   2. **打多少**（`damageAgainstTarget`）—— 由目标类型的回退链决定

/**
 * 武器描述符里「能打地面」的位。
 *
 * 位值由 `extract/luaRuntime.ts` 的 `DESCRIPTOR_BITS` 钉死。
 * 原来这套位值是**按首次访问顺序自增**的（`Ground` 拿到 8 纯属巧合），
 * 加一个引用新名字的脚本就会让整张映射平移 —— 见 docs/findings.md I33。
 */
export const DESCRIPTOR_GROUND = 8;

/** 武器描述符里「能打空中」的位（`TransportTypeMask_Flying`）。 */
export const DESCRIPTOR_FLYING = 4096;

/**
 * 武器描述符里「能打一切非隐形目标」的位（`NotHiddenTypeMask`）。
 *
 * **地空通吃**。漏了这个位会误判一大类武器 —— 例如飞弹小队的武器是
 * `{NotHiddenTypeMask, AttackableTypeMask}`，既没有 `Ground` 也没有
 * `Flying`，只看那两位会得出"它只能打建筑"，而它实际 `goodAgainst = [Vehicle, Aircraft]`。
 * 全库有 32 处用到这个位。
 */
export const DESCRIPTOR_NOT_HIDDEN = 128;

/** 武器描述符里 `AllMask`，同样表示通吃。 */
export const DESCRIPTOR_ALL = 1024;

/**
 * 目标类型的**伤害查找链**。
 *
 * `override` 的含义是「优先匹配」，不是排他过滤器 —— 目标身上可以挂多个
 * `override_*` 标签，按这条链从具体到宽泛依次找，都没有才吃 `default`。
 *
 * 运矿车的 `tags` 是 `[Vehicle, override_harvester, override_vehicle]`，
 * 同时写两个 override 正是在声明 `Harvester → Vehicle → default` 这条链。
 * 于是「反步兵打不动矿车」得到解释：步枪兵只有 `Vehicle: 15`，
 * 打矿车回退到 15（相对对步兵的 38 确实打不动），不是零。
 */
export const DAMAGE_CASCADE: Record<DamageOverrideTag, DamageOverrideTag[]> = {
  Infantry: ["Infantry"],
  Vehicle: ["Vehicle"],
  Structure: ["Structure"],
  Aircraft: ["Aircraft"],
  Harvester: ["Harvester", "Vehicle"],
};

/**
 * 这把武器**能不能打到**这类目标。
 *
 *   建筑 Structure         → 任何武器都能打（独立轴）
 *   步兵 / 载具 / 运矿车    → 需 `Ground` 位；矿车是载具的一种
 *   空中 Aircraft          → 需 `TransportTypeMask_Flying` 位
 *
 * 判据是武器自己的 `descriptors`，**不是** `goodAgainstTags`（那是 AI 索敌
 * 偏好、不产生伤害加成），**也不是** `targetSelector`（83/83 都是
 * `unit_antiInfantry`，毫无区分度）。
 *
 * ⚠️ 不能只看 `damageTuning.overrides` 里有没有值 —— 弹弓有 `Vehicle: 25`
 * 但打不到载具（descriptors 只有 `Flying`），那条是够不着的死数据。
 */
/**
 * 该武器的**索敌方式未知** —— `descriptors` 是空表。
 *
 * 全库 6 把，且这组是**杂项、没有统一含义**（见 docs/findings.md I71）：
 * `orcabomber.bomb`（爆炸，靠 `modifier_spawn`）、`catalystgunship.catalystWeapon`
 * （爆炸由毒雾触发）、`msv.rockets` / `ticktank.hidden`（带部署用的 `modifier_intro/outro`）、
 * `repairdrone.guns`（压根不是武器）。
 *
 * 已试过三版解释（空=全能打 / 空=只对地 / 空=modifier 驱动），**全不成立**。
 * 所以这里不猜：调用方应当**先问这个函数**，是未知就如实显示"未知"，
 * 而不是拿 `canAttackTarget` 的返回值当结论。
 */
export function targetingUnknown(weapon: WeaponTuning): boolean {
  const bits = weapon.descriptors;
  return !Array.isArray(bits) || bits.length === 0;
}

/**
 * 这把武器**能不能打到**这类目标。
 *
 *   建筑 Structure         → 任何武器都能打（独立轴）
 *   步兵 / 载具 / 运矿车    → 需 `Ground` 位；矿车是载具的一种
 *   空中 Aircraft          → 需 `TransportTypeMask_Flying` 位
 *   地空通吃               → `NotHiddenTypeMask` / `AllMask`（**防空单位都靠这个**）
 *
 * ⚠️ **`descriptors` 为空表时返回 `false`，但这个结果没有意义** ——
 * 那 6 把的索敌方式未知。**调用方必须先判断 `targetingUnknown()`**，
 * 否则会把它们误显示成"什么也打不到"。
 *
 * ⚠️ 判据是武器自己的 `descriptors`，**不是** `goodAgainstTags`（AI 索敌偏好）、
 * **也不是** `targetSelector`（83/83 都是 `unit_antiInfantry`，无区分度）。
 */
export function canAttackTarget(weapon: WeaponTuning, target: DamageOverrideTag): boolean {
  if (targetingUnknown(weapon)) return false;
  if (target === "Structure") return true;
  const bits = weapon.descriptors as number[];
  if (bits.includes(DESCRIPTOR_NOT_HIDDEN) || bits.includes(DESCRIPTOR_ALL)) return true;
  if (target === "Aircraft") return bits.includes(DESCRIPTOR_FLYING);
  return bits.includes(DESCRIPTOR_GROUND);
}

/** 按 `DAMAGE_CASCADE` 回退链算这把武器对某类目标的伤害。 */
export function damageAgainstTarget(weapon: WeaponTuning, target: DamageOverrideTag): number {
  const dt = weapon.damageTuning;
  const fallback = dt?.default ?? 0;
  for (const tag of DAMAGE_CASCADE[target]) {
    const hit = (dt?.overrides ?? []).find((e) => e[0] === tag);
    if (hit) return hit[1];
  }
  return fallback;
}

/**
 * 基础 DPS（1-0 级，未套等级倍率）。
 *
 * 内置两个容易写错的判断：
 * - 有 `reloadTuning` 走弹夹式公式，否则走爆发式
 * - `muzzleCount` **只在 `muzzleStrategy === "All"` 时**才乘进去
 *
 * 返回值是 1-0 级的值；等级换算见 docs/level-scaling.md。
 */
export function baseDps(weapon: WeaponTuning, waveSize = 1, targetTag?: DamageOverrideTag): number {
  const damage = targetTag ? damageAgainst(weapon, targetTag) : (weapon.damageTuning?.default ?? 0);
  if (damage === 0) return 0;

  const reload = weapon.reloadTuning;
  if (reload) {
    const clip = reload.clipSize ?? 0;
    const ms = reload.reloadTimeMs ?? 0;
    if (!clip || !ms) return 0;
    return (damage * clip * waveSize * 1000) / ms;
  }

  const burst = weapon.burstTiming ?? {};
  const cooldown = burst.cooldown ?? 0;
  if (!cooldown) return 0;
  let mult = ((burst.numToBurst ?? 1) * waveSize) / cooldown;
  // 只有这个组合才计入 muzzleCount —— Pitbull 写了 muzzleCount=2 但不生效
  if (weapon.muzzleStrategy === "All") mult *= weapon.muzzleCount ?? 1;
  return damage * mult;
}

/**
 * `cooldown + chargeUpDuration` 的**字面和**。
 *
 * ⚠ **这不是开火周期。** 实测已确认（见下），默认武器的开火周期**就是
 * `cooldown`**，`chargeUpDuration` 是周期末尾的前摇段落，**不再叠加**。
 * 这个函数只做字面相加，保留给「万一某个单位确实需要相加」的场景，
 * 不要用它当周期。
 *
 * 实测依据（`unit_gdi_predatortank`）：`cooldown = 3.44s`、
 * `chargeUpDuration = 1.00s`，游戏内观测为「开火间隔 3 秒多、
 * 开火前约 1 秒激光瞄准」—— 两个数都对应上，说明周期 = 3.44s，
 * 瞄准是周期内最后 1 秒。
 *
 * 开火周期请用 `fireCycleSec()`。
 */
export function cooldownPlusChargeUp(weapon: WeaponTuning): number | undefined {
  const burst = weapon.burstTiming;
  if (!burst) return undefined;
  const cd = burst.cooldown;
  const charge = burst.chargeUpDuration;
  if (cd === undefined && charge === undefined) return undefined;
  return (cd ?? 0) + (charge ?? 0);
}

/**
 * 开火周期（秒）—— 两次开火之间的时间。
 *
 * 默认就是 `burstTiming.cooldown`（实测确认，见 `cooldownPlusChargeUp`）。
 *
 * ⚠ 有 `modifier_sequence` 的 22 个单位（Avatar、Basilisk、巨无霸等）
 * 不走这套：它们的时序写在 `modifier_sequence.tuning` 里，字段是
 * `burstCooldown` / `initialChargeUpMs`（**毫秒**），本函数不覆盖。
 */
export function fireCycleSec(weapon: WeaponTuning): number | undefined {
  return weapon.burstTiming?.cooldown;
}

/** `weapon.modifier_intro.tuning.durationMs`（毫秒）；没有则 0。仅 9/83。 */
export function modifierIntroMs(weapon: WeaponTuning): number {
  return weapon.modifier_intro?.tuning?.durationMs ?? 0;
}

/** `weapon.modifier_outro.tuning.durationMs`（毫秒）；没有则 0。仅 9/83。 */
export function modifierOutroMs(weapon: WeaponTuning): number {
  return weapon.modifier_outro?.tuning?.durationMs ?? 0;
}

/**
 * 单位的武器里最高的 1-0 级基础 DPS。
 *
 * 注意 21/82 个单位算不出 DPS：伤害写在 `modifier_sequence` 指向的 ability
 * 脚本里，或 `damageTuning.default` 为 0（修理无人机这类辅助单位）。
 * 这种情况返回 0。
 */
export function unitBaseDps(rec: { config: Config }, targetTag?: DamageOverrideTag): number {
  const wave = rec.config.squadTuning?.waveSize ?? 1;
  let best = 0;
  for (const w of rec.config.combatantTuning?.weaponTunings ?? []) {
    best = Math.max(best, baseDps(w, wave, targetTag));
  }
  return best;
}

/** 按造价筛选（省略 cost 的单位不匹配任何上限）。 */
export function cheaperThan(index: UnitIndex, maxCost: number): UnitSummary[] {
  return index.units.filter((u) => u.cost !== undefined && u.cost <= maxCost);
}

/**
 * 找出标注针对指定类型的单位。
 *
 * ⚠ **这是索敌偏好，不是伤害克制。** 要找真正的克制关系，
 * 应该用 `damageAgainst` / `unitBaseDps` 比较同一单位对不同目标的伤害。
 */
export function targetingIntent(index: UnitIndex, tag: DamageOverrideTag): UnitSummary[] {
  return index.units.filter((u) => (u.good_against ?? []).includes(tag));
}
