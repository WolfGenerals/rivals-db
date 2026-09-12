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
 * 「格」与世界单位的换算 —— **1 格 = 8 世界单位**，全站唯一实现（台账 I205）。
 *
 * 引擎里并存两套空间，字段名就是分界线：
 *   · **带 `InTiles` 的**（`attack_range_tiles` / `aggro_radius_tiles` / `vision_tiles` /
 *     `stealth_detect_tiles`）**本来就是格**，直接用，不要再除；
 *   · **其余裸数字**（`speed`、`avoidance_radius`、`hexReservationRadius`、`crusherRadius`、
 *     `flyingHeight`、弹体的 `damageRadius`/`fireRadius`/`empRadius`…）是**世界单位**，
 *     除以 8 才是格。
 *
 * 为什么是 8：奥卡轰炸机 `damageRadius = 18` 玩家游戏内实测约 2 格（18 ÷ 8 = 2.25）——
 * 另有 7 条一致性检验（幽灵 EMP 18 对应文案"相邻"、火炮炮弹 Fixed16(6)、建筑避让 6、
 * 猛犸碾压 7、占位半径 5 ≈ 六边形外接半径…），详见 I205 与 `docs/unit-dimensions.md`。
 *
 * ⚠️ `libapp.so` 里那个 `mTileSize` **不是**这个换算 —— 它是 UI 组件 `HexMapAnchor`
 * 的屏幕尺寸（I210），别拿来算。
 */
export const WORLD_UNITS_PER_TILE = 8;

/** 世界单位 → 格（2 位小数，去掉多余的零：6.928 → 0.87、8 → 1、1.7 → 0.21） */
export function toTiles(worldUnits: number): number {
  return Math.round((worldUnits / WORLD_UNITS_PER_TILE) * 100) / 100;
}

/** 世界单位长度 → `0.87 格` */
export function fmtTiles(worldUnits: number): string {
  return `${toTiles(worldUnits)} 格`;
}

/** 世界单位/秒 → `0.87 格/秒` */
export function fmtTilesPerSec(worldUnitsPerSec: number): string {
  return `${toTiles(worldUnitsPerSec)} 格/秒`;
}
