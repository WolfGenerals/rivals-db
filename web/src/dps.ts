/**
 * DPS 计算 —— **唯一实现**。
 *
 * 之前 `WeaponCard`、`UnitPanel`、`UnitList` 各自算一遍，于是顶栏切了 DPS 口径
 * **只有武器卡变**，总览和表格纹丝不动（用户报的 bug）。
 *
 * ## 两个口径（**都是时间轴算的实际值**）
 *
 * | 口径 | 公式 | 用途 |
 * | --- | --- | --- |
 * | `burst` | 射击期间的速率 | 打起来多猛 |
 * | `avg` | `damage × hits ÷ 完整周期` | **实际**能打出多少（默认） |
 *
 * `avg` 会把「前摇在周期外」的蓄力（音波坦克 3 秒）加进周期，这正是它和 `burst` 的差别。
 *
 * ⚠️ **没有「游戏面板」这个口径**（用户要求去掉）：面板值 `derived.dps` 不进这个切换。
 * 它固定出现在两处 —— **表格的 DPS 列**与**单位页的 DPS 格**（都要能和游戏内面板对号，
 * 已用真跑游戏 Lua 逐单位核过 73/73）；「对目标 DPS」列、武器卡、卡片墙排序之外的地方
 * 才是这套口径算的实际值。
 */

import type { DatasetEntry, Track, Weapon } from "@rivals/core/derive";
import type { DamageOverrideTag } from "@rivals/core/types";

import { damageOf } from "./damageTiers.ts";

export type DpsMode = "burst" | "avg";

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
    /*
     * 爆发 = 射击期间的速率。分母是**一轮内的开火跨度**：
     *   · 有每发间隔 → `hits × 间隔`（沙暴 12×200ms、音波坦克 20×40ms）
     *   · 间隔为 0 → **遍历枪口同时出膛**（烈焰之手 2 发落在同一毫秒），
     *     跨度就是整轮周期；沿用 `hits × 0` 会把 2 发算成"平均每发隔 0ms"而得出 112.5
     */
    const span = iv > 0 ? h * iv : cycle;
    if (span > 0) burst = Math.max(burst, (dmg * h * waveSize * 1000) / span);
    // 「前摇在周期外」时（`chargeInCycle === false`）把蓄力加进周期
    const full = t.chargeInCycle === false ? cycle + (t.charge_ms ?? 0) : cycle;
    if (full > 0) avg = Math.max(avg, (dmg * h * waveSize * 1000) / full);
  }
  return { volley, hits, burst, avg };
}

/**
 * 单位级 DPS（**1-0 基准，未套等级倍率**）—— 主武器的实际值。
 *
 * ⚠️ **表格的 DPS 列与单位页的 DPS 格不用这个函数** —— 那两处要的是**游戏面板值**
 * （`derived.dps`），直接读产物字段。（早先这里有个 `unitBaseDps(entry, mode)`，
 * 既能返回面板值又能返回实际值，结果同一行混口径；已删。）
 */
function primaryOf(entry: DatasetEntry): { weapon: Weapon; tracks: Track[] } | null {
  const w = entry.derived.weapons.find((x) => x.id === entry.derived.primary) ?? entry.derived.weapons[0];
  if (!w) return null;
  return { weapon: w, tracks: entry.derived.attack.tracks.filter((t) => t.weapon === w.id) };
}

export interface TargetDps {
  /** 合计 = 各武器之和 */
  total: number;
  /** 逐武器明细（相加即 `total`）—— 悬停时列出来 */
  per: Array<{ label: string; dps: number }>;
}

/**
 * 单位对某类目标的**实际 DPS** —— 能打它的每把武器**相加**（1-0 基准，已乘人数）。
 *
 * **为什么是相加而不是取最大**：多武器单位是各自按自己的节奏开火的，只要目标在它的
 * 可攻击集里就会一起打。利爪（机枪 + 火箭）打建筑时两把**同时**开火 —— 用户指出
 * 「利爪的两个武器会同时打建筑」。取最大会漏掉一半输出。
 *
 * 逐武器：`该武器对目标的实际 DPS × (对该目标的伤害 ÷ 它自己的 default)`。
 *
 * ⚠️ **例外：`composition === "sequence"`**（音波坦克/蛇怪/万钧巨炮）—— 那些"武器"
 * 是**接替的阶段**（stage1→2→3），相加会把三段叠在一起。稳态取主武器（末段）。
 *
 * 无可打武器（含 `targeting_unknown` 的 6 把 —— 它们的 `can_attack` 是空集）→ `null`。
 */
export function unitDpsVs(entry: DatasetEntry, target: DamageOverrideTag, mode: DpsMode): TargetDps | null {
  const usable = entry.derived.weapons.filter((w) => w.damage > 0 && w.can_attack.includes(target));
  if (!usable.length) return null;
  const staged = entry.derived.attack.composition === "sequence";
  const weapons = staged ? usable.filter((w) => w.id === entry.derived.primary) : usable;
  if (!weapons.length) return null;

  const m = mode;
  const wave = entry.derived.health?.wave_size ?? 1;
  const per = weapons
    .map((w) => {
      const tracks = entry.derived.attack.tracks.filter((t) => t.weapon === w.id);
      const set = weaponDps(w, tracks, wave);
      const v = m === "avg" ? set.avg : set.burst;
      const ratio = damageOf(w, target) / w.damage;
      return { label: w.name, dps: v * ratio };
    })
    // 节奏不明的武器（找不到攻击间隔 → 0）不参与，否则会显示成"打得到但 0 伤害"
    .filter((p) => p.dps > 0);
  if (!per.length) return null;
  return { total: per.reduce((s, p) => s + p.dps, 0), per };
}
