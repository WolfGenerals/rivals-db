/**
 * 等级缩放公式（已用 28 个单位观测点 + 6 个指挥官观测点验证）。
 *
 * ```
 * F(major, minor) = 1.05 ** min(major-1, 3)
 *                 * 1.10 ** max(0, major-4)
 *                 * c(major) ** minor
 *
 * c(major) = C_LO  (major <= 4)      C_LO = 1.01^0.83
 *          = C_HI  (major >= 5)      C_HI = 1.01
 *
 * HP  = floor(baseHP  * F)
 * DPS = round(baseDPS * F, 1)
 * ```
 *
 * **两段共用同一个拐点 `major 4 → 5`**：大等级步长与 minor 步长同时切换。
 *
 * 为什么 HP 是 floor 而 DPS 是 round：源码里 HP 走
 * `nRankedStatsUtil...(...):toInt()`（截断），DPS 走 `:toFloat()`（保留）。
 * 详见 docs/level-scaling.md。
 *
 * API 有两种等价写法：
 *
 * ```ts
 * const lv = fromOrdinal(40);      // 或者 level(11, 0)
 * lv.hp(650);                      // 面向对象写法，推荐
 * hpAtLevel(650, lv.major, lv.minor);  // 自由函数写法，CLI / 内部实现用
 * ```
 *
 * 自由函数保留是有意的：它们是纯函数、便于单测，也是上面那些方法的实现。
 */

/** minor 跨度的上界（0~3）。 */
export const MINOR_MAX = 3;

/** 游戏内满级的大级。 */
export const MAX_MAJOR = 15;

/** 等级滑块的上界：`levelOrdinal(15, 3)`。 */
export const MAX_ORDINAL = levelOrdinal(MAX_MAJOR, MINOR_MAX);

/**
 * 游戏内的等级：`major-minor`，与稀有度无关，范围 1-0 ~ 15-3。
 *
 * 用 `level()` / `fromOrdinal()` 构造，别手写字面量 —— 字面量没有下面这些方法。
 */
export interface Level {
  readonly major: number;
  readonly minor: number;

  /** 等级换算倍率 `F`。 */
  factor(): number;
  /** 该等级下的血量（`baseHP` 传 `squadHealth()` 的结果），向下取整。 */
  hp(baseHP: number): number;
  /** 该等级下的 DPS，保留 1 位小数。 */
  dps(baseDPS: number): number;
  /** 在等级序列上的位置，用于排序与滑块。 */
  ordinal(): number;
  /** 游戏内记法 `major-minor`。 */
  format(): string;
  /** 是否严格高于另一个等级。 */
  isAbove(other: Level): boolean;
  /** 比 `other` 高几个小级（可为负）。 */
  stepsFrom(other: Level): number;
  /** 提高 `n` 个小级；超出 15-3 会被截断。 */
  plus(n: number): Level;
}

/** 每小级步长（低段，major ≤ 4）。由实测区间 [1.0082850, 1.0083140] 锁定。 */
export const C_LO = 1.01 ** 0.83;

/** 每小级步长（高段，major ≥ 5）。实测锁到 1.01。 */
export const C_HI = 1.01;

/** 等级换算用的倍率。 */
export function levelFactor(major: number, minor: number): number {
  const m = major - 1;
  const c = major <= 4 ? C_LO : C_HI;
  return 1.05 ** Math.min(m, 3) * 1.1 ** Math.max(0, m - 3) * c ** minor;
}

/**
 * 当前等级的 HP（小队总血）。
 *
 * `baseHP` 传 `health × waveSize`（用 `squadHealth()` 取）。
 */
export function hpAtLevel(baseHP: number, major: number, minor: number): number {
  return Math.floor(baseHP * levelFactor(major, minor));
}

/** 当前等级的 DPS，保留 1 位小数。 */
export function dpsAtLevel(baseDPS: number, major: number, minor: number): number {
  return Math.round(baseDPS * levelFactor(major, minor) * 10) / 10;
}

/**
 * 起始 major 等级 = 2 × 稀有度编号 − 1。
 *
 * Common→1、Rare→3、Epic→5。这是**从实测反推的经验式**，
 * 与全部实测点吻合，但尚未在 pb 里找到 GetMinRank 表项直接印证。
 * 无稀有度（采集车/炮塔等）时返回 null。
 */
export function startingMajor(rarityIndex: number | null): number | null {
  return rarityIndex === null ? null : 2 * rarityIndex - 1;
}

/** 稀有度名 → 编号。 */
export const RARITY_INDEX: Record<string, number> = { Common: 1, Rare: 2, Epic: 3 };

/** 由稀有度名推出起始 major；未知稀有度返回 null。 */
export function startingMajorOfRarity(rarity: string | undefined): number | null {
  if (!rarity) return null;
  const idx = RARITY_INDEX[rarity];
  return idx === undefined ? null : startingMajor(idx);
}

/**
 * 等级在序列上的位置，用于排序与滑块。
 *
 * 一个大级占 4 个小级：`major=1,minor=0` → 0。
 */
export function levelOrdinal(major: number, minor: number): number {
  return (major - 1) * (MINOR_MAX + 1) + minor;
}

/**
 * 构造一个带方法的等级对象。
 *
 * 方法闭包捕获 `major`/`minor` 而不是读 `this`，所以解构、传参、当 prop 传都不会丢。
 */
export function level(major: number, minor: number): Level {
  const o = () => levelOrdinal(major, minor);
  return {
    major,
    minor,
    factor: () => levelFactor(major, minor),
    hp: (baseHP) => hpAtLevel(baseHP, major, minor),
    dps: (baseDPS) => dpsAtLevel(baseDPS, major, minor),
    ordinal: o,
    format: () => formatLevel(major, minor),
    isAbove: (other) => o() > levelOrdinal(other.major, other.minor),
    stepsFrom: (other) => o() - levelOrdinal(other.major, other.minor),
    plus: (n) => fromOrdinal(Math.min(o() + n, MAX_ORDINAL)),
  };
}

/** `levelOrdinal` 的逆运算。 */
export function fromOrdinal(ordinal: number): Level {
  const span = MINOR_MAX + 1;
  return level(Math.floor(ordinal / span) + 1, ordinal % span);
}

/** 显示成游戏内的 `major-minor` 记法。 */
export function formatLevel(major: number, minor: number): string {
  return `${major}-${minor}`;
}
