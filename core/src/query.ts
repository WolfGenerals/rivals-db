/**
 * 基于游戏 Lua 语义重写的纯函数（保留兼容）。
 *
 * 新代码建议直接用 `./types` 的访问器。这里只保留与 Lua 一一对应的原语，
 * 以及 `pickDamage` 这个名字的历史 API —— 它等价于
 * `types.damageAgainst` 但不依赖武器对象形状。
 */

import type { DamageOverride } from "./types.ts";

export type { DamageOverride } from "./types.ts";

/**
 * 选择对目标生效的伤害值。
 *
 * 对应 `nTuningUtil.GetDamageOverrideWS`：
 * - 无覆写表或无匹配 -> 用 fallback
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