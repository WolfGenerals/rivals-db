import { describe, expect, it } from "vitest";

import {
  baseDps,
  cheaperThan,
  cooldownPlusChargeUp,
  damageAgainst,
  fireCycleSec,
  modifierIntroMs,
  modifierOutroMs,
  pickDamage,
  squadHealth,
  targetingIntent,
  unitBaseDps,
  type DamageOverrideTag,
  type UnitIndex,
  type WeaponTuning,
} from "../src/index.ts";

/** baseDps 要同时给武器与 waveSize，包一层省得每个用例都写 */
const dps = (w: WeaponTuning, wave: number, target?: DamageOverrideTag) => baseDps(w, wave, target);

describe("pickDamage（对应 nTuningUtil.GetDamageOverrideWS）", () => {
  const overrides = [
    { tag: "Infantry", damage: 96 },
    { tag: "Vehicle", damage: 250 },
  ];
  const fallback = 830;

  it("无匹配时返回 default", () => {
    expect(pickDamage(["Structure"], overrides, fallback)).toBe(fallback);
  });

  it("单条匹配", () => {
    expect(pickDamage(["Vehicle"], overrides, fallback)).toBe(250);
  });

  it("多条同时匹配时取最大值，而非最先匹配的", () => {
    // 顺序反过来也应得同样结果 —— 这是最容易写错的地方
    expect(pickDamage(["Infantry", "Vehicle"], overrides, fallback)).toBe(250);
    expect(pickDamage(["Vehicle", "Infantry"], overrides, fallback)).toBe(250);
  });

  it("无覆写表时返回 default", () => {
    expect(pickDamage(["Infantry"], undefined, fallback)).toBe(fallback);
    expect(pickDamage(["Infantry"], [], fallback)).toBe(fallback);
  });
});

describe("damageAgainst：按目标类型取实际伤害", () => {
  const weapon: WeaponTuning = {
    damageTuning: { default: 340, overrides: [["Infantry", 27]] },
  };

  it("有覆写时用覆写值（通常比 default 低得多）", () => {
    expect(damageAgainst(weapon, "Infantry")).toBe(27);
    expect(damageAgainst(weapon, "Vehicle")).toBe(340);
  });

  it("无 damageTuning 时返回 0", () => {
    expect(damageAgainst({}, "Infantry")).toBe(0);
  });
});

describe("baseDps：1-0 级基础 DPS", () => {
  it("爆发式：damage × numToBurst × waveSize / cooldown", () => {
    // riflemen: 38 × 1 × 5 / 1.72 = 110.465
    const w: WeaponTuning = {
      damageTuning: { default: 38 },
      burstTiming: { numToBurst: 1, cooldown: 1.72 },
    };
    expect(dps(w, 5)).toBeCloseTo(110.465, 2);
  });

  it("弹夹式：damage × clipSize × waveSize / reloadTimeMs × 1000", () => {
    // mlrs: 666 × 3 × 1 / 5000 × 1000 = 399.6
    const w: WeaponTuning = {
      damageTuning: { default: 666 },
      reloadTuning: { clipSize: 3, reloadTimeMs: 5000 },
    };
    expect(dps(w, 1)).toBeCloseTo(399.6, 3);
  });

  it("muzzleCount 只在 muzzleStrategy === 'All' 时生效", () => {
    // Pitbull 写了 muzzleCount=2 但没有 muzzleStrategy，所以不翻倍
    const base: WeaponTuning = {
      damageTuning: { default: 250 },
      burstTiming: { numToBurst: 1, cooldown: 1.8 },
      muzzleCount: 2,
    };
    const withAll: WeaponTuning = { ...base, muzzleStrategy: "All" };
    expect(dps(base, 1)).toBeCloseTo(138.889, 2);
    expect(dps(withAll, 1)).toBeCloseTo(277.778, 2);
  });

  it("无 cooldown 且无 reloadTuning 时返回 0", () => {
    expect(dps({ damageTuning: { default: 100 } }, 1)).toBe(0);
  });

  it("指定目标类型时用覆写伤害", () => {
    const w: WeaponTuning = {
      damageTuning: { default: 340, overrides: [["Infantry", 27]] },
      burstTiming: { numToBurst: 1, cooldown: 2.64 },
    };
    expect(dps(w, 3, "Infantry")).toBeCloseTo(30.682, 2);
  });
});

describe("squadHealth：总血 = 每员血量 × 人数", () => {
  it("riflemen 存 130，游戏显示 650", () => {
    expect(
      squadHealth({ config: { combatantTuning: { health: 130 }, squadTuning: { waveSize: 5 } } }),
    ).toBe(650);
  });

  it("无 waveSize 时按 1 人算", () => {
    expect(squadHealth({ config: { combatantTuning: { health: 1611 } } })).toBe(1611);
  });

  it("无 health 时返回 undefined", () => {
    expect(squadHealth({ config: {} })).toBeUndefined();
  });
});

describe("unitBaseDps：取多武器里最高的", () => {
  it("双武器单位取较大者", () => {
    const rec = {
      config: {
        squadTuning: { waveSize: 1 },
        combatantTuning: {
          weaponTunings: [
            { damageTuning: { default: 100 }, burstTiming: { cooldown: 1 } },
            { damageTuning: { default: 400 }, burstTiming: { cooldown: 1 } },
          ],
        },
      },
    };
    expect(unitBaseDps(rec)).toBe(400);
  });
});

describe("单位索引查询", () => {
  const index: UnitIndex = {
    unit_count: 3,
    gdi_count: 2,
    nod_count: 1,
    units: [
      { id: "a", faction: "GDI", variant: "a", cost: 10, health: 130 },
      { id: "b", faction: "GDI", variant: "b", cost: 70, good_against: ["Vehicle"] },
      // 采集车没有造价，不应被任何上限匹配到
      { id: "c", faction: "NOD", variant: "c", health: 3400 },
    ],
  };

  it("cheaperThan 排除没有造价的单位", () => {
    expect(cheaperThan(index, 100).map((u) => u.id)).toEqual(["a", "b"]);
    expect(cheaperThan(index, 5)).toEqual([]);
  });

  it("targetingIntent 按索敌偏好筛选（不是伤害克制）", () => {
    expect(targetingIntent(index, "Vehicle").map((u) => u.id)).toEqual(["b"]);
    expect(targetingIntent(index, "Aircraft")).toEqual([]);
  });
});

describe("开火周期与节奏字段", () => {
  it("fireCycleSec 默认就是 cooldown（实测确认）", () => {
    // 捕食者：游戏内观测「开火间隔 3 秒多、开火前约 1 秒激光瞄准」
    // cooldown=3.44 chargeUp=1.00 —— 两个数都对应上
    const predator: WeaponTuning = { burstTiming: { cooldown: 3.44, chargeUpDuration: 1 } };
    expect(fireCycleSec(predator)).toBe(3.44);
    // ⚠ 字面和 4.44 不是周期：前摇发生在周期内，不叠加
    expect(cooldownPlusChargeUp(predator)).toBeCloseTo(4.44, 6);
  });

  it("cooldownPlusChargeUp 只是字面和，保留给特殊场景", () => {
    expect(cooldownPlusChargeUp({ burstTiming: { cooldown: 4, chargeUpDuration: 3 } })).toBe(7);
    expect(cooldownPlusChargeUp({ burstTiming: { cooldown: 1.72, chargeUpDuration: 0 } })).toBe(1.72);
    expect(cooldownPlusChargeUp({ burstTiming: { numToBurst: 1 } })).toBeUndefined();
  });

  it("modifierIntroMs / modifierOutroMs 读架设与收起（毫秒）", () => {
    // 巨无霸：展开 5s、收起 2s，但每发前摇只有 0.25s
    const juggernaut: WeaponTuning = {
      burstTiming: { cooldown: 4, chargeUpDuration: 0.25 },
      modifier_intro: { tuning: { durationMs: 5000 } },
      modifier_outro: { tuning: { durationMs: 2000 } },
    };
    expect(modifierIntroMs(juggernaut)).toBe(5000);
    expect(modifierOutroMs(juggernaut)).toBe(2000);
    // 架设是形态切换的一次性成本，不属于每发节奏
    expect(fireCycleSec(juggernaut)).toBe(4);
  });

  it("没有架设/收起的武器返回 0", () => {
    expect(modifierIntroMs({ burstTiming: { cooldown: 1 } })).toBe(0);
    expect(modifierOutroMs({ burstTiming: { cooldown: 1 } })).toBe(0);
  });
});