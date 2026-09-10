/**
 * 重写自游戏 Lua 的纯函数。
 *
 * 真值来源：reference/rivals（Python + lupa，直接执行游戏 Lua 源码）。
 * 这里的每个函数都必须有对应的校验测试，比对 Lua 侧结果。
 */

/** 伤害覆写：目标类型 + 伤害值 */
export interface DamageOverride {
  tag: string;
  damage: number;
}

/**
 * 选择对目标生效的伤害值。
 *
 * 对应 nTuningUtil.GetDamageOverrideWS：
 * - 无覆写表或无匹配 -> 用 default
 * - 目标同时匹配多条 -> 取**最大**伤害（不是最先匹配的）
 */
export function pickDamage(
  targetTags: readonly string[],
  overrides: readonly DamageOverride[] | undefined,
  fallback: number,
): number {
  if (overrides === undefined || overrides.length === 0) return fallback;

  let best: number | undefined;
  for (const o of overrides) {
    if (!targetTags.includes(o.tag)) continue;
    if (best === undefined || o.damage > best) best = o.damage;
  }
  return best ?? fallback;
}

/** 单位在 index.json 里的扁平概览 */
export interface UnitSummary {
  unit_id: string;
  faction: string;
  variant: string;
  health?: number;
  speed?: number;
  cost?: number;
  damage?: number;
  range?: number;
  cooldown?: number;
  weapon_count?: number;
  tags?: string[];
  good_against?: string[];
  wave_size?: number;
  vision_range?: number;
}

/** index.json 的整体形状 */
export interface UnitIndex {
  unit_count: number;
  gdi_count: number;
  nod_count: number;
  misc_count?: number;
  units: UnitSummary[];
}

/** 按造价筛选（省略 cost 的单位不匹配任何上限） */
export function cheaperThan(index: UnitIndex, maxCost: number): UnitSummary[] {
  return index.units.filter((u) => u.cost !== undefined && u.cost <= maxCost);
}

/** 找出克制指定类型的单位 */
export function counters(index: UnitIndex, tag: string): UnitSummary[] {
  return index.units.filter((u) => (u.good_against ?? []).includes(tag));
}
