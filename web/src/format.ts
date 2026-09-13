/**
 * 时间显示 —— **秒**，全站唯一实现。
 *
 * 早先每个组件各写一份（`WeaponCard` 有 `fmtMs`/`fmtSec`、`WeaponTimeline` 有 `fmt`、
 * `UnitPanel` 有 `sec`），于是同一个数在三处显示成三种样子：`250ms` / `0.25s` / `0.3s`。
 * 用户要求**统一用秒**，所以收到这里。
 *
 * 位数规则：
 *   · ≥ 1s  —— 固定两位（`2.00s` / `13.00s`），和游戏面板的 `chargeUpDuration` 记法一致
 *   · < 1s  —— 最多三位、去掉多余的零，但**至少两位**（`0.25s` / `0.04s` / `0.035s`）
 *     —— 三位的必要性：飞影的每发间隔 35ms，写成 `0.04s` 就看不出与 40ms 的差别了
 */
export function fmtSec(ms: number): string {
  const v = ms / 1000;
  if (v >= 1) return `${v.toFixed(2)}s`;
  let s = v.toFixed(3).replace(/0+$/, "");
  if (s.endsWith(".")) s += "00";
  else if (s.split(".")[1]!.length === 1) s += "0";
  return `${s}s`;
}

/**
 * **统一的时长写法** —— 界面上**只有一个入口**（用户定的规则）。
 *
 * ```
 *   < 200ms  ⇒ 毫秒（`180ms` / `40ms`）         —— 短节拍（每跳间隔、短前摇）写成秒读不出来
 *   ≥ 200ms  ⇒ 秒（`0.20s` / `1.60s` / `10.00s`）—— 与游戏面板口径一致
 * ```
 *
 * ⚠️ **不要在别处再写 `xxx + "ms"` 或直接 `fmtSec()`**：早先两种写法混排，
 * 同一屏上出现 `每 200ms 跳 6` 与 `持续 10.00s`、`0.30s 扣血` 与 `@ 2100ms`。
 * 阈值只有这一个数（用户要求"走统一格式化函数"）。
 */
export const MS_THRESHOLD = 200;

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const v = Math.round(ms);
  if (Math.abs(v) < MS_THRESHOLD) return `${v}ms`;
  return fmtSec(v);
}

/**
 * **段长/刻度上的短记法** —— 与 {@link fmtTime} 同一条阈值规则，只是秒那一侧去掉末尾的 0
 * （`3.00s` → `3s`）。用户要求：「标注带里的段长不要末尾的 0」。
 */
export function fmtTimeShort(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const v = Math.round(ms);
  if (Math.abs(v) < MS_THRESHOLD) return `${v}ms`;
  return fmtSecShort(v);
}

/**
 * **短记法秒** —— 去掉末尾的 0（`3.00s` → `3s`、`1.50s` → `1.5s`、`0.25s` 不变）。
 */
export function fmtSecShort(ms: number): string {
  const v = ms / 1000;
  const s = v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}s`;
}

/**
 * 「格」与世界单位的换算 —— **常数在 core，这里只做展示格式化**。
 *
 * ⚠️ **不要在本文件再定义一个数**：`WORLD_UNITS_PER_TILE` 从 `@rivals/core/types`
 * 导入，全仓库只有一处定义（`core/src/types.ts`，附完整标定过程与两难说明）。
 * 这里曾经写死 `8`，而 `core/src/derive.ts` 又另写了一个 `PER_TILE = 8`——
 * 同一个常数两处定义，改一处就会留下另一处错值。
 *
 * 引擎里并存两套空间，字段名就是分界线：
 *   · **带 `InTiles` 的**（`attack_range_tiles` / `aggro_radius_tiles` / `vision_tiles` /
 *     `stealth_detect_tiles`）**本来就是格**，直接用，**不要再除**；
 *   · **其余裸数字**（`speed`、`avoidance_radius`、`hexReservationRadius`、`crusherRadius`、
 *     `flyingHeight`、弹体的 `damageRadius`/`fireRadius`/`empRadius`…）是**世界单位**，
 *     除以这个常数才是格。
 *
 * ⚠️ `libapp.so` 里那个 `mTileSize` **不是**这个换算 —— 它是 UI 组件 `HexMapAnchor`
 * 的屏幕尺寸（I210），别拿来算。
 */
import { WORLD_UNITS_PER_TILE } from "@rivals/core/types";

export { WORLD_UNITS_PER_TILE };

/**
 * 世界单位 → 格（**2 位小数**）—— **全站唯一的格数换算入口**。
 *
 * ⚠️ 换算**只在展示层发生**（用户决定："换算应该前端进行"）：产物里存的一律是
 * 引擎原始的世界单位（奥卡的 `damageRadius` 就是 18），所以
 * `WORLD_UNITS_PER_TILE` 这个实测标定值被推翻时，**只需改一个数，不用重跑提取**。
 * 反过来，产物里带 `_tiles` 后缀的字段（`attack_range_tiles` / `vision_tiles`…）
 * **本来就是格，不要再除** —— 这正是当初把量纲搞错的地方。
 */
export function toTiles(worldUnits: number): number {
  return Math.round((worldUnits / WORLD_UNITS_PER_TILE) * 100) / 100;
}

/** 世界单位长度 → `0.12 格` */
export function fmtTiles(worldUnits: number): string {
  return `${toTiles(worldUnits)} 格`;
}

/** 世界单位/秒 → `0.28 格/秒` */
export function fmtTilesPerSec(worldUnitsPerSec: number): string {
  return `${toTiles(worldUnitsPerSec)} 格/秒`;
}

/**
 * 移动速度 → **`3.54s/格`**（走一格要多久）。
 *
 * **为什么加这个**：`speed` 是"世界单位/秒"，除以格边长才是格/秒；但玩家真正想知道的是
 * "走过去要多久"。而 `格/秒 = speed ÷ 14` 与 `秒/格 = 14 ÷ speed` 是同一个数取倒数，
 * **直接给秒更不容易被误读**，也正好是标定这个常数时用的那把尺子（采集车 3.51s/格）。
 *
 * 参见 `WORLD_UNITS_PER_TILE` 的注释与 findings I224。
 */
export function fmtSecPerTile(worldUnitsPerSec: number): string {
  if (!(worldUnitsPerSec > 0)) return "—";
  const v = WORLD_UNITS_PER_TILE / worldUnitsPerSec;
  return `${v >= 1 ? v.toFixed(2) : v.toFixed(3)}s/格`;
}
