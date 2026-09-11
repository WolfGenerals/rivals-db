/**
 * 伤害档位 —— 「敌人应对」和武器卡里的「逐目标伤害」共用同一套。
 *
 * **倍率必须逐武器除以它自己的 `default`**，不能拿所有武器的最大 default
 * 当统一分母。反例（利爪直升机）：机枪 default 57、火箭 default 345，
 * 拿 345 当分母时机枪的 57 会算成 16% 判成"极低"，可 57 本来就是机枪的正常伤害
 * —— 整把机枪等于白算。见 docs/findings.md I51。
 */
import {
  canAttackTarget,
  targetingUnknown,
  damageAgainstTarget,
  type DamageOverrideTag,
  type WeaponTuning,
} from "@rivals/core/types";

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

/**
 * 一把武器的「正常伤害」基准 = `damageTuning.default`。
 *
 * `default` 的含义是「**没写 override 时的全额伤害**」，override 绝大多数是**减伤**
 * （少数是增伤，如多管火箭对建筑 default 666 → Structure 1000）。所以它就是"正常"。
 *
 * ⚠️ **不能用「能打到的目标里伤害最大值」当基准。** 试过，会把反载具武器显示成反建筑：
 * 多管火箭 default 666 / Structure 1000，取最大值当分母后载具变成 67%、建筑 100%，
 * 而它的 `goodAgainst = [Vehicle, Structure]`。（用户发现）
 *
 * ⚠️ **也不能用「所有武器的最大 default」当统一分母。** 那是更早一版的错误：
 * 利爪机枪 default 57、火箭 default 345，统一分母会让机枪整把武器白算成"极低"。
 * 见 docs/findings.md I51。
 *
 * 所以基准是**逐武器取它自己的 `default`**。
 */
function weaponBaseline(w: WeaponTuning): number {
  return w.damageTuning?.default ?? 0;
}

/**
 * 一堆武器里，对某类目标能打出多少。
 *
 * 逐武器算 `damageAgainstTarget(w,type) / weaponBaseline(w)`，取倍率最高的那把。
 * 打不打得到由 core 的 `canAttackTarget` 判定（武器 descriptors 位掩码），
 * **不是**"有没有写 override" —— 弹弓有 `Vehicle: 25` 却打不到载具。
 */
export function targetDamage(weapons: WeaponTuning[], type: DamageOverrideTag): TargetDamage {
  // 索敌方式未知：如实返回"未知"，不猜能打还是不能打（见 findings I71）
  if (weapons.length > 0 && weapons.every(targetingUnknown)) {
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
  const usable = weapons.filter((w) => canAttackTarget(w, type));
  if (!usable.length) {
    return { type, tier: "dead", color: DEAD_COLOR, damage: 0, ratio: 0, from: "", reachable: false, unknown: false };
  }
  let damage = 0;
  let ratio = 0;
  let from = "";
  for (const w of usable) {
    const dmg = damageAgainstTarget(w, type);
    const base = weaponBaseline(w);
    const r = base > 0 ? dmg / base : 0;
    if (r > ratio || (r === ratio && dmg > damage)) {
      damage = dmg;
      ratio = r;
      from = w.name ?? "";
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
  Harvester: "运矿车",
};

export const TARGET_TYPES: DamageOverrideTag[] = [
  "Infantry",
  "Vehicle",
  "Aircraft",
  "Structure",
  "Harvester",
];

