/**
 * **显示名** —— 把内部标识（`modifier_chem_warrior_gas_cloud`、`ability_catalyst_explosion` …）
 * 换成中文，界面上一律**不直接出现内部名**（用户要求：「这样的名字别直接出现，汉化掉」）。
 *
 * ⚠️ **只翻译"已经核过的东西"**：每条中文名都对应一个我们读过的 Lua 文件（见注释里的出处）。
 * **不认识的 id 原样返回** —— 宁可在界面上露出一个内部名（并说明"未汉化"），也不能瞎起中文名。
 * 想补名字：往 `EXACT` 里加一条，并把出处写在旁边。
 */

/** 精确映射：**id → 中文名**（都读过源码） */
const EXACT: Record<string, string> = {
  /** `modifiers/modifier_chem_warrior_gas_cloud.lua` + `auras/aura_gas_cloud.lua`：格上的毒气，每 200ms 一跳 */
  modifier_chem_warrior_gas_cloud: "毒气云",
  /** `auras/aura_fire.lua`：格上的火，每 250ms 一跳（地狱火 / 圣甲虫铺的） */
  modifier_fire_bomber_fire: "火焰",
  /** `abilities/ability_catalyst_explosion.lua`：催化剂打进毒气格引发的爆炸 */
  ability_catalyst_explosion: "催化爆炸",
  /** `abilities/ability_catalyst_chemical_weapon_sequence.lua` 里的连锁引爆（捷德） */
  ability_catalyst_chained_explosion: "连锁催化爆炸",
};

/**
 * 名字 → 显示名。
 *
 * - 命中 `EXACT` ⇒ 中文名；
 * - 否则按**种类**给一个中文描述（`…_weapon_sequence` ⇒ 武器序列脚本），但**不带 id**；
 * - 都不认识 ⇒ **原样返回 id**（界面会带一个"未汉化"的提示色，别假装它叫别的）。
 */
export function displayName(id: string): string {
  const hit = EXACT[id];
  if (hit !== undefined) return hit;
  if (/_weapon_sequence$/.test(id)) return "专属武器序列脚本";
  if (/_projectile$/.test(id)) return "弹体命中处理";
  if (/_intro$/.test(id)) return "架设动作";
  if (/_outro$/.test(id)) return "撤收动作";
  if (/_death$/.test(id)) return "阵亡表现";
  return id;
}

/** 这个 id 有没有中文名（没有的话界面给个小标记，别让读者以为那是中文） */
export function isLocalized(id: string): boolean {
  return EXACT[id] !== undefined || /_(weapon_sequence|projectile|intro|outro|death)$/.test(id);
}
