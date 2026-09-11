/**
 * 等级换算公式的回归测试。
 *
 * 这些期望值全部来自**游戏内实测**（见 docs/level-scaling.md 第 6 节），
 * 不是从本体算出来的 —— 所以它们能真正锁住公式，而不是自我印证。
 */

import { describe, expect, it } from "vitest";

import {
  C_HI,
  C_LO,
  dpsAtLevel,
  formatLevel,
  fromOrdinal,
  hpAtLevel,
  levelFactor,
  levelOrdinal,
  startingMajor,
  startingMajorOfRarity,
} from "../src/levels.ts";

describe("levelFactor：三段倍率", () => {
  it("1-0 是基准，倍率为 1", () => {
    expect(levelFactor(1, 0)).toBe(1);
  });

  it("低段每大级 ×1.05", () => {
    expect(levelFactor(2, 0)).toBeCloseTo(1.05, 10);
    expect(levelFactor(3, 0)).toBeCloseTo(1.1025, 10);
    expect(levelFactor(4, 0)).toBeCloseTo(1.05 ** 3, 10);
  });

  it("高段每大级 ×1.1", () => {
    // major 5 = 1.05^3 × 1.1
    expect(levelFactor(5, 0)).toBeCloseTo(1.05 ** 3 * 1.1, 10);
    expect(levelFactor(8, 0)).toBeCloseTo(1.05 ** 3 * 1.1 ** 4, 10);
  });

  it("两段共用同一个拐点 major 4→5：minor 步长同时切换", () => {
    // 低段 minor 步长是 C_LO，高段是 C_HI，两者不同
    expect(C_LO).toBeLessThan(C_HI);
    expect(C_LO).toBeCloseTo(1.01 ** 0.83, 12);
    expect(C_HI).toBe(1.01);
    expect(levelFactor(4, 1) / levelFactor(4, 0)).toBeCloseTo(C_LO, 10);
    expect(levelFactor(5, 1) / levelFactor(5, 0)).toBeCloseTo(C_HI, 10);
  });
});

describe("hpAtLevel / dpsAtLevel：对比游戏内实测", () => {
  // 每项：[单位, baseHP, major, minor, 实测值]
  const HP_CASES: Array<[string, number, number, number, number]> = [
    ["droneswarm 3-0", 635, 3, 0, 700],
    ["droneswarm 3-1", 635, 3, 1, 705],
    ["droneswarm 3-2", 635, 3, 2, 711],
    ["droneswarm 3-3", 635, 3, 3, 717],
    ["droneswarm 4-0", 635, 4, 0, 735],
    ["droneswarm 4-1", 635, 4, 1, 741],
    ["robodogs 9-0", 1200, 9, 0, 2237],
    ["robodogs 14-0", 1200, 14, 0, 3603],
    ["riflemen 9-0", 650, 9, 0, 1211],
    ["apc 5-0", 3300, 5, 0, 4202],
  ];

  for (const [label, base, major, minor, expected] of HP_CASES) {
    it(`${label} = ${expected}`, () => {
      expect(hpAtLevel(base, major, minor)).toBe(expected);
    });
  }

  it("HP 用 floor，DPS 用 round(1)", () => {
    // apc 5-0：3300 × 1.273388 = 4202.18 → floor 4202
    expect(hpAtLevel(3300, 5, 0)).toBe(4202);
    // mlrs 15-0：399.6 × 3.302839 = 1319.81 → round 1319.8
    expect(dpsAtLevel(399.6, 15, 0)).toBe(1319.8);
  });
});

describe("指挥官实测点（底数 30000 / 3400）", () => {
  const CASES: Array<[number, number, number, number]> = [
    // major, minor, 基地, 矿车
    [3, 0, 33075, 3748],
    [3, 1, 33349, 3779],
    [7, 0, 46223, 5238],
    [12, 1, 75188, 8521],
  ];

  for (const [major, minor, base, mine] of CASES) {
    it(`${major}-${minor}：基地 ${base} / 矿车 ${mine}`, () => {
      expect(hpAtLevel(30000, major, minor)).toBe(base);
      expect(hpAtLevel(3400, major, minor)).toBe(mine);
    });
  }
});

describe("起始等级与序数换算", () => {
  it("起始 major = 2r-1", () => {
    expect(startingMajor(1)).toBe(1);
    expect(startingMajor(2)).toBe(3);
    expect(startingMajor(3)).toBe(5);
    expect(startingMajor(null)).toBeNull();
  });

  it("由稀有度名推出起始 major；无稀有度返回 null", () => {
    expect(startingMajorOfRarity("Common")).toBe(1);
    expect(startingMajorOfRarity("Rare")).toBe(3);
    expect(startingMajorOfRarity("Epic")).toBe(5);
    expect(startingMajorOfRarity(undefined)).toBeNull();
    expect(startingMajorOfRarity("Unknown")).toBeNull();
  });

  it("序数与等级可逆（每大级 4 个小级）", () => {
    for (const [major, minor] of [[1, 0], [1, 3], [2, 0], [5, 2], [15, 3]] as const) {
      const ord = levelOrdinal(major, minor);
      expect(fromOrdinal(ord)).toEqual({ major, minor });
      expect(formatLevel(major, minor)).toBe(`${major}-${minor}`);
    }
  });

  it("序数边界", () => {
    expect(levelOrdinal(1, 0)).toBe(0);
    expect(levelOrdinal(1, 3)).toBe(3);
    expect(levelOrdinal(2, 0)).toBe(4);
    expect(levelOrdinal(15, 3)).toBe(59);
  });
});
