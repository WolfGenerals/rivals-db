/**
 * DPS 计算 —— **唯一实现**。
 *
 * 之前 `WeaponCard`、`UnitPanel`、`UnitList` 各自算一遍，于是顶栏切了 DPS 口径
 * **只有武器卡变**，总览和表格纹丝不动（用户报的 bug）。
 *
 * ## 三个口径
 *
 * | 口径 | 公式 | 用途 |
 * | --- | --- | --- |
 * | `game` | `derived.dps`（面板口径） | **核对**我们的数据对不对 |
 * | `burst` | `damage ÷ interval`（射击期间） | 打起来多猛 |
 * | `avg` | `damage × hits ÷ 完整周期` | **实际**能打出多少 |
 *
 * `avg` 会把「前摇在周期外」的蓄力（音波坦克 3 秒）加进周期，这正是它和 `game` 的差别。
 */

import type { DatasetEntry, Track, Weapon } from "@rivals/core/derive";

export type DpsMode = "game" | "burst" | "avg";

export interface DpsSet {
  /** **单轮总伤害**（已乘人数） */
  volley: number;
  /** 一轮打几下 */
  hits: number;
  burst: number;
  avg: number;
}

/** 一把武器在给定人数下的三个口径与单轮总伤害。**未套等级倍率** */
export function weaponDps(weapon: Weapon, tracks: Track[], waveSize: number): DpsSet {
  let volley = 0;
  let hits = 0;
  let burst = 0;
  let avg = 0;
  for (const t of tracks) {
    const tm = t.timing;
    if (tm.kind === "一次") continue; // 一次性不计持续输出
    const h = tm.kind === "装填" ? tm.clip : tm.hits;
    const iv = tm.interval_ms ?? (tm.kind === "单发" ? tm.cycle_ms : 0);
    const cycle = tm.kind === "装填" ? tm.clip * iv + tm.reload_ms : tm.cycle_ms;
    const dmg = weapon.damage;
    // 单轮总伤害要**乘人数** —— 小队每人各打各的
    volley += dmg * h * waveSize;
    hits += h;
    if (iv > 0) burst = Math.max(burst, (dmg * h * waveSize * 1000) / (h * iv));
    // 「前摇在周期外」时（`chargeInCycle === false`）把蓄力加进周期
    const full = t.chargeInCycle === false ? cycle + (t.charge_ms ?? 0) : cycle;
    if (full > 0) avg = Math.max(avg, (dmg * h * waveSize * 1000) / full);
  }
  return { volley, hits, burst, avg };
}

/** 该条目的主武器与该武器的轨道 */
function primaryOf(entry: DatasetEntry): { weapon: Weapon; tracks: Track[] } | null {
  const w = entry.derived.weapons.find((x) => x.id === entry.derived.primary) ?? entry.derived.weapons[0];
  if (!w) return null;
  return { weapon: w, tracks: entry.derived.attack.tracks.filter((t) => t.weapon === w.id) };
}

/**
 * 单位级 DPS（**1-0 基准，未套等级倍率**）—— 按口径取主武器的值。
 *
 * `game` 口径直接返回面板值（`derived.dps`），便于与游戏内核对。
 */
export function unitBaseDps(entry: DatasetEntry, mode: DpsMode): number | null {
  if (mode === "game") return entry.derived.dps;
  const p = primaryOf(entry);
  if (!p) return null;
  const set = weaponDps(p.weapon, p.tracks, entry.derived.health?.wave_size ?? 1);
  const v = mode === "avg" ? set.avg : set.burst;
  return v > 0 ? v : null;
}

/** 主武器的单轮总伤害（1-0 基准，已乘人数） */
export function unitVolleyDamage(entry: DatasetEntry): number | null {
  const p = primaryOf(entry);
  if (!p) return null;
  return weaponDps(p.weapon, p.tracks, entry.derived.health?.wave_size ?? 1).volley;
}
