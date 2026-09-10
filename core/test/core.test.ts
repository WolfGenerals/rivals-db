import { describe, expect, it } from "vitest";
import { cheaperThan, counters, pickDamage, type UnitIndex } from "../src/index.js";

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

describe("单位索引查询", () => {
  const index: UnitIndex = {
    unit_count: 3,
    gdi_count: 2,
    nod_count: 1,
    units: [
      { unit_id: "a", faction: "GDI", variant: "a", cost: 10, health: 130 },
      { unit_id: "b", faction: "GDI", variant: "b", cost: 70, good_against: ["Vehicle"] },
      // 采集车没有造价，不应被任何上限匹配到
      { unit_id: "c", faction: "NOD", variant: "c", health: 3400 },
    ],
  };

  it("cheaperThan 排除没有造价的单位", () => {
    expect(cheaperThan(index, 100).map((u) => u.unit_id)).toEqual(["a", "b"]);
    expect(cheaperThan(index, 5)).toEqual([]);
  });

  it("counters 按克制关系筛选", () => {
    expect(counters(index, "Vehicle").map((u) => u.unit_id)).toEqual(["b"]);
    expect(counters(index, "Aircraft")).toEqual([]);
  });
});
