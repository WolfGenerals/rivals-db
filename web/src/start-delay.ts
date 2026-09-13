/**
 * **起始行动延迟**的算式 —— 把"谁先到位"变成一个**可核对的默认值**。
 *
 * ## 这是什么（以及不是什么）
 *
 * ⚠️ **它是假设，不是源码数据**：源码里没有地图、没有位置，`Duel` 也把双方当作
 * "已接触、互相锁定"（J40）。所以"谁先开火"只能**近似**：
 *
 * ```
 * 走过去的格数 = max(0, 对方射程 − 我射程)          ← 手短的一方要走这段才能还手
 *              + (能边跑边打 ? 0 : 0.5)             ← 不能边跑边打 ⇒ 还要走到格中心停下来
 * 毫秒        = 格数 × 14（一格的世界单位）÷ 速度 × 1000
 * ```
 *
 * 三条口径（用户定的）：
 * 1. **不低于 0 格**（手长的那一方不会得到负的位移）；
 * 2. **+0.5 是"格"**，不是秒；**它是"走到格中心停下"的代价，所以只要不能边跑边打就要付** ——
 *    哪怕射程差是 0（犀牛 vs 飞弹小队：射程都是 1 格 ⇒ `0 + 0.5 = 0.5 格`）。
 *    ⚠️ 我一开始自作主张写成"手不短就不罚那半格"，被用户当场问回来了，这里不再加例外；
 * 3. **不能移动的单位（没有 `speed` 的建筑 / 炮塔）不给"按路程"这个选项** ——
 *    它们走不了，套公式会算出一个它根本执行不了的位移时间（固定时间仍然可以填）。
 *
 * 射程取 **`squadTuning.maxAttackRangeInTiles`**（小队级，源码里真正生效的那个；
 * 武器级的 `maxRangeInTiles` 全树没人读）；移速取 `combatantTuning.speed`（世界单位/秒）。
 */

import type { UnitDef } from "@rivals/core/model/unit-def";

/** 一格 = 多少个世界单位（全站唯一常数，与 `format.ts` 的换算同源） */
import { WORLD_UNITS_PER_TILE } from "@rivals/core/types";

/** 这一侧能不能边跑边打（任一武器写了 `canShootWhileMoving`） */
export function isRaider(def: UnitDef): boolean {
  return def.combatant.weapons.some((w) => w.usage.flags.canShootWhileMoving === true);
}

/** 这一侧能不能移动（没有 `speed` 的建筑 / 炮塔不能） */
export function isMobile(def: UnitDef): boolean {
  return def.combatant.speed !== undefined && def.combatant.speed > 0;
}

export interface WalkDelay {
  /** 算出来的格数（≥ 0） */
  tiles: number;
  /** 换算成毫秒（**不能移动**时是 `null` —— 这一档不给用） */
  ms: number | null;
  /** 射程差（格，≥ 0） */
  rangeGap: number;
  /** 我是手短的一方吗（射程差 > 0） */
  outRanged: boolean;
  /** 不能边跑边打 ⇒ 多走半格到格中心 */
  stopPenalty: number;
  /** 我自己的射程（格）；读不到就是 `undefined` */
  myRange?: number;
  /** 对方的射程（格）；读不到就是 `undefined` */
  theirRange?: number;
  /** 我自己的移速（世界单位/秒）；不能移动就没有 */
  speed?: number;
  /** 读不到必要数据时的说明（页面直接显示，不猜） */
  missing?: string;
}

/**
 * 算出"这一侧要走多久才能开火"。
 *
 * @param mine 我这一侧的单位定义
 * @param theirs 对面那一侧的单位定义
 */
export function walkDelay(mine: UnitDef, theirs: UnitDef): WalkDelay {
  const myRange = mine.squad.maxAttackRangeInTiles;
  const theirRange = theirs.squad.maxAttackRangeInTiles;
  const speed = mine.combatant.speed;

  // 射程数据缺失 ⇒ **不猜**，返回 0 并说明（用户口径：缺数据取 0）
  if (myRange === undefined || theirRange === undefined) {
    const which = myRange === undefined ? "这一侧" : "对面";
    return {
      tiles: 0,
      ms: 0,
      rangeGap: 0,
      outRanged: false,
      stopPenalty: 0,
      ...(myRange === undefined ? {} : { myRange }),
      ...(theirRange === undefined ? {} : { theirRange }),
      ...(speed === undefined ? {} : { speed }),
      missing: `${which}的射程数据缺失 ⇒ 默认按 0 处理`,
    };
  }

  const rangeGap = Math.max(0, theirRange - myRange);
  /*
   * 不能边跑边打 ⇒ 走到格中心停下来（半格）。
   * ⚠️ **不加"手不短就免掉半格"的例外**：犀牛 vs 飞弹小队两边射程都是 1 格，
   * 射程差 0，但它照样要走到格中心停下 ⇒ `0.5 格`（用户给的公式就是这么写的）。
   */
  const stopPenalty = isRaider(mine) ? 0 : 0.5;
  const finalTiles = Math.max(0, rangeGap + stopPenalty);

  if (!isMobile(mine)) {
    return {
      tiles: finalTiles,
      ms: null, // 不能移动 ⇒ "按路程"这一档不给用（用户定的）
      rangeGap,
      outRanged: rangeGap > 0,
      stopPenalty,
      myRange,
      theirRange,
      missing: "不能移动（源码里没有移速）⇒ 只能按时间填",
    };
  }
  if (speed === undefined) {
    return { tiles: finalTiles, ms: null, rangeGap, outRanged: rangeGap > 0, stopPenalty, myRange, theirRange };
  }
  const ms = Math.round((finalTiles * WORLD_UNITS_PER_TILE) / speed * 1000);
  return { tiles: finalTiles, ms, rangeGap, outRanged: rangeGap > 0, stopPenalty, myRange, theirRange, speed };
}

/** 把一格数换算成毫秒（页面在"按路程"那一档里改格数时用） */
export function tilesToMs(def: UnitDef, tiles: number): number | null {
  const speed = def.combatant.speed;
  if (!isMobile(def) || speed === undefined) return null;
  return Math.round((Math.max(0, tiles) * WORLD_UNITS_PER_TILE) / speed * 1000);
}

/** 一行算式说明（页面上显示，便于核对） */
export function walkDelayNote(mine: UnitDef, theirs: UnitDef): string {
  const d = walkDelay(mine, theirs);
  if (d.missing !== undefined) return d.missing;
  const parts = [`射程差 ${d.rangeGap} 格`];
  if (d.stopPenalty > 0) parts.push(`+${d.stopPenalty} 格（不能边跑边打 ⇒ 走到格中心停下）`);
  if (d.speed !== undefined) parts.push(`÷ 速度 ${d.speed}`);
  return `${parts.join(" ")} ⇒ ${d.tiles} 格${d.ms === null ? "" : ` = ${(d.ms / 1000).toFixed(2)}s`}`;
}
