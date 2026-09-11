/**
 * 伤害分档 —— 逐目标伤害与「克制/敌人应对」共用。
 *
 * ⚠️ **不再自己解析伤害**。早先这里要读 weapon.damageTuning、还要走
 * effectiveDamage() 的四处回退链 —— 那正是反复出错的来源（weaponBaseline 曾漏改，
 * 导致 7 把序列武器的百分比全显示 0%）。
 *
 * 现在吃 derived.weapons：damage 已是**解析好的单次命中伤害**，
 * overrides 已是**归一后的补正**，can_attack 已是**算好的可攻击集**。
 */

import type { Weapon } from "@rivals/core/derive";
import type { DamageOverrideTag } from "@rivals/core/types";

import { DAMAGE_CASCADE } from "@rivals/core/types";

/** 档位：按「伤害 ÷ 该武器自己的 default」划。顺序即从冷到暖。 */
export const TIERS = [
  { key: "tiny", max: 0.35, label: "极低", color: "#4a5163" },
  { key: "low", max: 0.65, label: "中等", color: "#3f6fa8" },
  { key: "near", max: 0.9, label: "偏低", color: "#3f8f8f" },
  { key: "normal", max: 1.05, label: "正常", color: "#4f9e5f" },
  { key: "high", max: Infinity, label: "偏高", color: "#d8a13c" },
] as const;

export type TierKey = (typeof TIERS)[number]["key"] | "dead" | "unknown";

/** 打不到时的颜色 */
export const DEAD_COLOR = "#2a2f3a";

/** 索敌方式未知时的颜色（`descriptors` 空表，全库 6 把） */
export const UNKNOWN_COLOR = "#5a4a7a";

export interface TargetDamage {
  type: DamageOverrideTag;
  tier: TierKey;
  color: string;
  /** 打得到时是该类型能打出的最高伤害 */
  damage: number;
  /** 相对那把武器自己的默认伤害；打不到时为 0 */
  ratio: number;
  /** 这个数值来自哪把武器（多武器单位用） */
  from: string;
  reachable: boolean;
  /** 索敌方式未知：不该显示"打得到/打不到"的结论 */
  unknown: boolean;
}

export function tierOf(ratio: number): (typeof TIERS)[number] {
  return TIERS.find((t) => ratio < t.max) ?? TIERS[TIERS.length - 1]!;
}

/** 一把武器的「正常伤害」基准 —— derived.weapons 里已解析好的 damage */
function weaponBaseline(w: Weapon): number {
  return w.damage;
}

/**
 * 一堆武器里，对某类目标能打出多少。
 *
 * 逐武器算 `damageAgainstTarget(w,type) / weaponBaseline(w)`，取倍率最高的那把。
 * 打不打得到由 core 的 `canAttackTarget` 判定（武器 descriptors 位掩码），
 * **不是**"有没有写 override" —— 弹弓有 `Vehicle: 25` 却打不到载具。
 */
/** 按 DAMAGE_CASCADE 回退链算这把武器对某类目标的伤害。补正值已在 overrides 里 */
function damageOf(w: Weapon, target: DamageOverrideTag): number {
  for (const tag of DAMAGE_CASCADE[target]) {
    const hit = w.overrides.find((e) => e[0] === tag);
    if (hit) return hit[1];
  }
  return w.damage;
}

export function targetDamage(weapons: Weapon[], type: DamageOverrideTag): TargetDamage {
  // 索敌方式未知：如实返回"未知"，不猜能打还是不能打（见 findings I71）
  if (weapons.length > 0 && weapons.every((w) => w.targeting_unknown)) {
    return {
      type,
      tier: "unknown",
      color: UNKNOWN_COLOR,
      damage: 0,
      ratio: 0,
      from: "",
      reachable: false,
      unknown: true,
    };
  }
  const usable = weapons.filter((w) => w.can_attack.includes(type));
  if (!usable.length) {
    return { type, tier: "dead", color: DEAD_COLOR, damage: 0, ratio: 0, from: "", reachable: false, unknown: false };
  }
  let damage = 0;
  let ratio = 0;
  let from = "";
  for (const w of usable) {
    const dmg = damageOf(w, type);
    const base = weaponBaseline(w);
    const r = base > 0 ? dmg / base : 0;
    if (r > ratio || (r === ratio && dmg > damage)) {
      damage = dmg;
      ratio = r;
      from = w.name;
    }
  }
  const t = tierOf(ratio);
  return {
    type,
    tier: t.key,
    color: t.color,
    damage,
    ratio,
    from,
    reachable: true,
    unknown: false,
  };
}

export const TARGET_LABELS: Record<DamageOverrideTag, string> = {
  Infantry: "步兵",
  Vehicle: "载具",
  Aircraft: "空军",
  Structure: "建筑",
  Harvester: "采集车",
};

export const TARGET_TYPES: DamageOverrideTag[] = [
  "Infantry",
  "Vehicle",
  "Aircraft",
  "Structure",
  "Harvester",
];

