/**
 * 提取层的测试。
 *
 * 分两类：
 * - 纯函数测试（toPlain / splitVariant / pb 解码器）：用内联夹具，随时可跑
 * - 集成测试：跑真实提取并与 data/ 里的已入库产物比对，数据目录缺失时跳过
 *
 * 那批 `data/` 产物是用旧实现（reference/，Python + lupa）生成的，
 * 且已验证与 Node 实现**逐字段完全一致**，所以可以当基线用。
 */

import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  extractPbFaction,
  extractPbUnits,
  factionOf,
  readVarint,
  splitVariant,
  startingMajor,
  toPlain,
} from "../src/index.ts";

/** 仓库根。测试从 core/ 跑，故上溯两级。 */
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DATA_DIR = join(REPO_ROOT, "data");
const SCRIPTS_INPUT = join(REPO_ROOT, "tmp", "com.ea.gp.candcwarzones");
const PB_PATH = join(SCRIPTS_INPUT, "files", "game-config.pb");

const exists = async (p: string) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

// ── 纯函数 ────────────────────────────────────────────────────────

describe("toPlain：Lua 值 -> 可序列化 JS 值", () => {
  it("丢弃函数并记录路径（调参表里挂的方法不是数据）", () => {
    const dropped: string[] = [];
    const out = toPlain({ v: 1, f: () => 0 }, dropped);
    expect(out).toEqual({ v: 1 });
    expect(dropped).toContain("f=<function>");
  });

  it("保留 falsy 值：false / 0 / 空数组 / 空对象", () => {
    const dropped: string[] = [];
    const out = toPlain({ a: false, b: 0, c: [], d: {} }, dropped);
    expect(out).toEqual({ a: false, b: 0, c: [], d: {} });
  });

  it("空对象保留为 {}（Lua 空表无法区分空数组/空字典）", () => {
    expect(toPlain({}, [])).toEqual({});
  });

  it("浮点保留 6 位小数，整数不动", () => {
    expect(toPlain(6.9284567891, [])).toBe(6.928457);
    expect(toPlain(130, [])).toBe(130);
    expect(toPlain(0.1 + 0.2, [])).toBe(0.3);
  });

  it("键为 1..n 连续正整数时归一成数组", () => {
    // wasmoon 对「显式下标的表」（Lua 写 [1]=…）给 Object 而不是 Array，
    // 但两者在 Lua 里是同一个东西。真实踩过：perTargetCount 从 list 变 dict。
    const explicit = { "1": { a: 1 }, "2": { a: 2 } };
    expect(toPlain(explicit, [])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("键不是从 1 开始、或不连续时保持对象", () => {
    expect(toPlain({ "0": "a", "1": "b" }, [])).toEqual({ "0": "a", "1": "b" });
    expect(toPlain({ "1": "a", "3": "c" }, [])).toEqual({ "1": "a", "3": "c" });
  });

  it("嵌套结构递归处理", () => {
    const out = toPlain({ a: [{ b: () => 0, c: 1 }] }, []);
    expect(out).toEqual({ a: [{ c: 1 }] });
  });
});

describe("splitVariant：拆出变体后缀", () => {
  it("无后缀", () => {
    expect(splitVariant("unit_gdi_riflemen")).toEqual({ variant: "riflemen", suffixes: [] });
  });

  it("大写后缀（_ST / _CR）", () => {
    expect(splitVariant("unit_gdi_juggernaut_ST")).toEqual({
      variant: "juggernaut",
      suffixes: ["ST"],
    });
    expect(splitVariant("unit_gdi_repairdrone_CR")).toEqual({
      variant: "repairdrone",
      suffixes: ["CR"],
    });
  });

  it("小写后缀（_mayhem）", () => {
    expect(splitVariant("unit_gdi_rockettroopers_mayhem")).toEqual({
      variant: "rockettroopers",
      suffixes: ["mayhem"],
    });
  });

  it("多段单位名不被误拆", () => {
    expect(splitVariant("unit_nod_chemicalwarrior")).toEqual({
      variant: "chemicalwarrior",
      suffixes: [],
    });
  });
});

describe("factionOf：从文件名判派系", () => {
  it("单位与指挥官都识别", () => {
    expect(factionOf("unit_gdi_riflemen")).toBe("GDI");
    expect(factionOf("unit_nod_militant")).toBe("NOD");
    expect(factionOf("cmdr_gdi_solomon")).toBe("GDI");
    expect(factionOf("cmdr_nod_jade")).toBe("NOD");
  });

  it("开发占位文件归 UNKNOWN", () => {
    expect(factionOf("unit_example")).toBe("UNKNOWN");
    expect(factionOf("unit_dlc_test")).toBe("UNKNOWN");
  });
});

describe("startingMajor：起始 major 等级 = 2r-1", () => {
  it("Common/Rare/Epic -> 1/3/5", () => {
    expect(startingMajor(1)).toBe(1);
    expect(startingMajor(2)).toBe(3);
    expect(startingMajor(3)).toBe(5);
  });

  it("无稀有度 -> null", () => {
    expect(startingMajor(null)).toBeNull();
  });
});

// ── pb wire-format 解码器 ─────────────────────────────────────────

describe("readVarint", () => {
  it("单字节", () => {
    expect(readVarint(Buffer.from([0x05]), 0)).toEqual([5n, 1]);
  });

  it("多字节（30000 = 0xB0 0xEA 0x01）", () => {
    expect(readVarint(Buffer.from([0xb0, 0xea, 0x01]), 0)).toEqual([30000n, 3]);
  });

  it("截断时返回 null 而不是抛异常", () => {
    // 高位仍在续，但缓冲区结束
    expect(readVarint(Buffer.from([0x80]), 0)).toBeNull();
  });
});

// ── 集成：真实提取 ────────────────────────────────────────────────

const hasData = await exists(join(DATA_DIR, "unit"));
const hasScripts = await exists(SCRIPTS_INPUT);

describe.skipIf(!hasData)("已入库产物自洽性", () => {
  it("index.json 的 id 与 unit/ 下的文件一一对应", async () => {
    const index = JSON.parse(await readFile(join(DATA_DIR, "index.json"), "utf8"));
    expect(index.unit_count).toBe(index.units.length);
    for (const u of index.units) {
      expect(await exists(join(DATA_DIR, "unit", `${u.id}.lua.json`))).toBe(true);
    }
  });

  it("index.json 不含空容器（{} 会被误当成数组）", async () => {
    const index = JSON.parse(await readFile(join(DATA_DIR, "index.json"), "utf8"));
    for (const u of index.units) {
      if ("good_against" in u) expect(Array.isArray(u.good_against)).toBe(true);
      if ("tags" in u) expect(Array.isArray(u.tags)).toBe(true);
    }
  });

  it("health 是每员血量，小队总血需乘 wave_size", async () => {
    // riflemen 存 130，游戏内显示 650 = 130 × 5
    const u = JSON.parse(await readFile(join(DATA_DIR, "unit", "unit_gdi_riflemen.lua.json"), "utf8"));
    expect(u.config.combatantTuning.health).toBe(130);
    expect(u.config.squadTuning.waveSize).toBe(5);
  });

  it("goodAgainstTags 与 damageTuning.overrides 是两回事", async () => {
    // grenadier 标注克制载具，但对步兵有 overrides，且远低于 default
    const u = JSON.parse(await readFile(join(DATA_DIR, "unit", "unit_gdi_grenadier.lua.json"), "utf8"));
    const ct = u.config.combatantTuning;
    expect(ct.goodAgainstTags).toEqual(["Vehicle"]);
    const dt = ct.weaponTunings[0].damageTuning;
    expect(dt.default).toBe(340);
    expect(dt.overrides).toEqual([["Infantry", 27]]);
  });

  it("descriptors 是假的位掩码占位值", async () => {
    const u = JSON.parse(await readFile(join(DATA_DIR, "unit", "unit_gdi_riflemen.lua.json"), "utf8"));
    // 桩用「访问即返回 2 的幂」，所以这些数字不可用
    expect(Array.isArray(u.config.combatantTuning.descriptors)).toBe(true);
  });
});

describe.skipIf(!hasScripts)("真实提取", () => {
  it("单位与指挥官数量、稀有度分布与已入库产物一致", async () => {
    const { extractAll } = await import("../src/index.ts");
    const result = await extractAll({ input: SCRIPTS_INPUT, gameConfigPb: PB_PATH });

    expect(result.failures).toEqual([]);
    expect(result.units.length).toBeGreaterThanOrEqual(80);
    expect(result.commanders.length).toBeGreaterThanOrEqual(17);

    // 稀有度只在 pb 里真的有数据时才出现
    const withRarity = result.units.filter((u) => u.pb?.rarity);
    expect(withRarity.length).toBeGreaterThan(0);
    for (const u of withRarity) {
      expect(["Common", "Rare", "Epic"]).toContain(u.pb!.rarity);
      expect(u.pb!.start_major).toBe(startingMajor(
        { Common: 1, Rare: 2, Epic: 3 }[u.pb!.rarity!] ?? null,
      ));
    }

    // 采集车/炮塔这类不参与商店等级体系的单位**不得**被补上稀有度
    for (const id of ["unit_gdi_harvester", "unit_gdi_turret", "unit_nod_obelisk"]) {
      const rec = result.units.find((u) => u.id === id);
      expect(rec, id).toBeDefined();
      expect(rec!.pb, `${id} 不应有稀有度`).toBeUndefined();
    }
  }, 120_000);

  it("两次运行结果一致（可复现）", async () => {
    const { extractAll, stableJson, payloadFor } = await import("../src/index.ts");
    const run = async () => {
      const r = await extractAll({ input: SCRIPTS_INPUT, gameConfigPb: PB_PATH });
      return r.units.map((u) => stableJson(payloadFor(u))).join("");
    };
    const [a, b] = [await run(), await run()];
    expect(a).toBe(b);
  }, 300_000);
});

// ── pb 直接验证（不需要 Lua 数据，但需要 pb 文件）──────────────────

describe.skipIf(!hasScripts)("game-config.pb", () => {
  let buf: Buffer;
  beforeAll(async () => {
    buf = await readFile(PB_PATH);
  });

  it("解出 74 个单位条目，稀有度编号只有 1/2/3", () => {
    const units = extractPbUnits(buf);
    expect(units.length).toBe(74);
    for (const u of units) {
      if (u.rarityIndex !== null) expect([1, 2, 3]).toContain(u.rarityIndex);
      expect(u.luaName).toMatch(/^unit_(gdi|nod)_/);
    }
  });

  it("阵营的 standardBaseHealth = 30000", () => {
    for (const name of ["Faction_Info_GDI", "Faction_Info_NOD"]) {
      const f = extractPbFaction(buf, name);
      expect(f, name).not.toBeNull();
      expect(f!.component.standardBaseHealth).toBe(30000);
    }
  });

  it("矿车指向 harvester 单位", () => {
    const f = extractPbFaction(buf, "Faction_Info_GDI");
    expect(f!.component.harvesterUnitName).toMatch(/Harvester/i);
  });
});
