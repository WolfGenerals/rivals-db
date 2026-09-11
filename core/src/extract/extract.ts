/**
 * 从游戏的 Lua 调参源码提取单位与指挥官数据。
 *
 * 为什么必须真求值 Lua 而不是正则解析：见 docs/extraction.md。
 * 产物的字段语义与陷阱：见 docs/data-semantics.md。
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { createLuaRuntime, firstLine, stripBom, type LuaRuntime } from "./luaRuntime.ts";
import { extractPbFaction, extractPbUnits, type PbFaction, type PbUnit } from "./gameConfigPb.ts";
import type { EntityRecord, Faction, RarityInfo } from "../types.ts";

// ── 类型 ──────────────────────────────────────────────────────────
// 产物形状的权威定义在 ../types.ts；这里只补充提取过程用的类型。

export type { EntityRecord, Faction, RarityInfo } from "../types.ts";

export interface ExtractResult {
  units: EntityRecord[];
  commanders: EntityRecord[];
  factions: PbFaction[];
  /** id → 求值或读取失败原因 */
  failures: Array<[string, string]>;
  /** 被跳过/加载出错的真实模块 */
  skippedModules: string[];
  /** 用到的基础路径信息 */
  root: string;
}

export class RivalsError extends Error {}

// ── 路径解析 ──────────────────────────────────────────────────────

/**
 * 在给定目录内查找 `nfd/scripts`。
 *
 * 接受解包根目录、包名目录、`published/nfd/scripts`，或直接是 `scripts`。
 * **只在给定目录内部查找，不向父目录上溯** —— 否则指向任意目录都会命中
 * 仓库里的游戏数据，把错路径当成对的。
 */
export async function findScriptsRoot(start: string): Promise<string> {
  const probes = [
    join(start, "gameplay"), // 直接就是 scripts/
    join(start, "scripts", "gameplay"),
    join(start, "nfd", "scripts", "gameplay"),
    join(start, "published", "nfd", "scripts", "gameplay"),
    join(start, "com.ea.gp.candcwarzones", "published", "nfd", "scripts", "gameplay"),
  ];
  for (const probe of probes) {
    if (await isDir(join(probe, "units"))) {
      return probe.slice(0, -"gameplay".length - 1);
    }
  }
  throw new RivalsError(
    `在 ${start} 下找不到 gameplay/units，请指向解包目录、包名目录、` +
      `published/nfd/scripts 或 gameplay`,
  );
}

async function isDir(p: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// ── 变体拆分 ──────────────────────────────────────────────────────

const LOWER_SUFFIXES = new Set(["mayhem"]);

/**
 * `unit_gdi_juggernaut_ST` → `{ variant: "juggernaut", suffixes: ["ST"] }`
 *
 * 去掉派系前缀（`unit_` / `cmdr_`）与变体后缀，得到可比较的基础名。
 * **`cmdr_` 也要剥** —— 指挥官的名字形态是 `cmdr_gdi_jackson`，
 * 早先只剥 `unit_` 导致指挥官的 `variant` 是整个名字。
 */
export function splitVariant(stem: string): { variant: string; suffixes: string[] } {
  let parts = stem.split("_");
  const hasPrefix =
    parts.length >= 3 &&
    (parts[0] === "unit" || parts[0] === "cmdr") &&
    (parts[1] === "gdi" || parts[1] === "nod");
  if (hasPrefix) parts = parts.slice(2);
  const suffixes: string[] = [];
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    const isUpper = /^[A-Z]+$/.test(last) && last.length <= 6;
    if (isUpper || LOWER_SUFFIXES.has(last)) {
      suffixes.unshift(parts.pop()!);
    } else break;
  }
  return { variant: parts.join("_"), suffixes };
}

/** 从文件名推断派系。`cmdr_*` 与 `unit_*` 都适用。 */
export function factionOf(stem: string): Faction {
  if (/^(unit|cmdr)_gdi_/.test(stem)) return "GDI";
  if (/^(unit|cmdr)_nod_/.test(stem)) return "NOD";
  return "UNKNOWN";
}

// ── 求值与读取 ────────────────────────────────────────────────────

interface SourceFile {
  stem: string;
  /** 相对 scripts 根 */
  rel: string;
  text: string;
}

async function readSources(dir: string, root: string, pattern: RegExp): Promise<SourceFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: SourceFile[] = [];
  for (const name of names.filter((n) => pattern.test(n)).sort()) {
    const full = join(dir, name);
    out.push({
      stem: name.replace(/\.lua$/, ""),
      rel: relative(root, full).replace(/\\/g, "/"),
      text: stripBom(await readFile(full, "utf8")),
    });
  }
  return out;
}

/**
 * 两遍求值。
 *
 * 实体文件之间存在引用（`nTuningUtil.GetWeaponTuning(unit_x, 1)` 会去取
 * `unit_x` 这个全局表），所以要照引擎的加载顺序：
 * 第一遍让全部 tuning 注册到全局，第二遍解跨文件引用。
 * 第二遍的结果更新，所以失败列表以第二遍为准。
 */
async function evalTwoPass(
  lua: LuaRuntime,
  sources: SourceFile[],
  onError: "warn" | "raise",
): Promise<Map<string, string>> {
  let failures = new Map<string, string>();
  for (let pass = 0; pass < 2; pass++) {
    failures = new Map();
    for (const src of sources) {
      try {
        await lua.exec(src.text);
      } catch (err) {
        const msg = firstLine(err);
        failures.set(src.stem, msg);
        if (onError === "raise") throw new RivalsError(`${src.stem}: ${msg}`);
      }
    }
  }
  return failures;
}

/**
 * 把 Lua 值转成可序列化的普通 JS 值。
 *
 * wasmoon 已自动把 Lua 表转成 JS 对象/数组，所以这里只需：
 * - 丢弃函数（调参表里挂的 GetStatInfo / SetStatOverrides 等方法不是数据）
 * - 浮点保留 6 位小数（与 Python 版一致，保证产物逐字节可比）
 * - 记录丢弃路径，让产物里的缺口**可见**而不是静默丢数据
 */
export function toPlain(
  value: unknown,
  dropped: string[],
  path = "",
  depth = 0,
): unknown {
  if (depth > 64) {
    dropped.push(`${path}=<max-depth>`);
    return undefined;
  }
  if (typeof value === "function") {
    dropped.push(`${path}=<function>`);
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => toPlain(v, dropped, `${path}[${i}]`, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const keys = Object.keys(src);

    // 键为 1..n 连续正整数 -> 数组。wasmoon 对「隐式序列」给 Array，对
    // 「显式下标的表」（Lua 里写 [1]=…）给 Object，但两者在 Lua 里是同一
    // 个东西，这里统一成数组，与旧实现（Python）的规则一致。
    // 否则 JSON 形状会变（真实踩过：perTargetCount 从 list 变成 dict）。
    if (keys.length > 0 && keys.every((k) => /^[1-9]\d*$/.test(k))) {
      const nums = keys.map(Number).sort((a, b) => a - b);
      if (nums.every((n, i) => n === i + 1)) {
        return nums.map((n) => toPlain(src[String(n)], dropped, `${path}[${n}]`, depth + 1));
      }
    }

    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = toPlain(src[k], dropped, path ? `${path}.${k}` : k, depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  return value;
}

/** 顶层要剔除的字段：引擎指针与历史别名，不是调参数据。 */
const TOP_LEVEL_DROP = new Set(["oldTuning", "cPtr"]);

function buildRecord(
  src: SourceFile,
  rawValue: unknown,
  pbByLuaName: Map<string, PbUnit>,
  droppedBase: string[],
): EntityRecord {
  const dropped = [...droppedBase];
  const raw = toPlain(rawValue, dropped);
  let config: Record<string, unknown>;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    config = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!TOP_LEVEL_DROP.has(k)) config[k] = v;
    }
  } else {
    // unit_example / unit_dlc_test 之类：不是调参表，仍如实输出并告警
    config = raw === undefined || raw === null ? {} : { raw_value: raw };
    dropped.push("<顶层不是调参表>");
  }

  const { variant, suffixes } = splitVariant(src.stem);
  const warnings: string[] = [];
  const combatant = config["combatantTuning"];
  const hasHealth =
    combatant !== null &&
    typeof combatant === "object" &&
    Boolean((combatant as Record<string, unknown>)["health"]);
  if (!hasHealth) warnings.push("缺少 combatantTuning.health（可能是占位/测试单位）");
  if (dropped.length) {
    // 对象键序在 JS 里稳定，但排序更能保证跨运行一致
    const shown = [...dropped].sort().slice(0, 6).join(", ");
    const more = dropped.length > 6 ? ` 等 ${dropped.length} 处` : "";
    warnings.push(`已丢弃占位/未解析字段：${shown}${more}`);
  }

  const split = { variant, suffixes };
  const pbUnit = resolveRarity(src.stem, pbByLuaName, split);
  const record: EntityRecord = {
    id: src.stem,
    faction: factionOf(src.stem),
    variant,
    source: src.rel,
    config,
  };
  if (suffixes.length) record.suffixes = suffixes;
  if (pbUnit?.rarityIndex !== null && pbUnit?.rarityIndex !== undefined) {
    record.pb = { rarity: pbUnit.rarity, start_major: pbUnit.startMajor ?? undefined };
  }
  if (warnings.length) record.warnings = warnings;
  return record;
}

/**
 * 找出该实体的稀有度。
 *
 * pb 只给**本体**（`unit_gdi_mohawkgunship`）而不是变体
 * （`unit_gdi_mohawkgunship_ST`）条目，所以变体要回退到本体名再查。
 * 不回退的话变体会被误判成「无稀有度」。
 *
 * 若本体也查不到，返回 null —— 那是真的没有稀有度：采集车、修理无人机、
 * 炮塔、方尖碑、钻地车这些不参与商店的等级成长体系。
 */
function resolveRarity(
  stem: string,
  byLuaName: Map<string, PbUnit>,
  variant: { variant: string; suffixes: string[] },
): PbUnit | null {
  const direct = byLuaName.get(stem);
  if (direct) return direct;

  if (!variant.suffixes.length) return null;
  const prefix = /^cmdr_/.test(stem) ? "cmdr" : "unit";
  const faction = factionOf(stem).toLowerCase();
  if (faction === "unknown") return null;
  return byLuaName.get(`${prefix}_${faction}_${variant.variant}`) ?? null;
}

// ── 入口 ──────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** 输入目录（解包根、包名目录、published/nfd/scripts 或 gameplay） */
  input: string;
  /** game-config.pb 路径；不给则跳过稀有度与基地血量 */
  gameConfigPb?: string;
  onError?: "warn" | "raise";
}

/**
 * 提取全部单位与指挥官。
 *
 * 单位与指挥官的定义是**完全分开**的（`gameplay/units/` 与
 * `gameplay/commanders/`），所以分别收集。
 */
export async function extractAll(opts: ExtractOptions): Promise<ExtractResult> {
  const root = await findScriptsRoot(opts.input);
  const onError = opts.onError ?? "warn";

  const load = async (rel: string): Promise<string | null> => {
    try {
      return stripBom(await readFile(join(root, rel), "utf8"));
    } catch {
      return null;
    }
  };
  const skippedModules: string[] = [];
  const lua = await createLuaRuntime(load, skippedModules);

  try {
    const unitSources = await readSources(join(root, "gameplay", "units"), root, /^unit_.*\.lua$/);
    if (!unitSources.length) {
      throw new RivalsError(`在 ${join(root, "gameplay", "units")} 下没有 unit_*.lua`);
    }
    const cmdrSources = await readSources(join(root, "gameplay", "commanders"), root, /^cmdr_.*\.lua$/);

    const failures = await evalTwoPass(lua, [...unitSources, ...cmdrSources], onError);

    // pb 提供 Lua 里没有的稀有度
    const pbByLuaName = new Map<string, PbUnit>();
    const factions: PbFaction[] = [];
    if (opts.gameConfigPb) {
      const buf = await readFile(opts.gameConfigPb);
      for (const u of extractPbUnits(buf)) {
        if (u.luaName) pbByLuaName.set(u.luaName, u);
      }
      for (const name of ["Faction_Info_GDI", "Faction_Info_NOD"]) {
        const f = extractPbFaction(buf, name);
        if (f) factions.push(f);
      }
    }

    /**
     * `unit_<stem>_visual` 里每个能力序列的 `MUZZLE_INFO` 摘要。
     *
     * 这张表在 `SetupModifierVisuals` 调用里，名字看着像纯美术，其实**决定了发数** ——
     * `ability_kodiak_weapon_sequence.lua:19` 的断言直接用 `#self.visual.MUZZLE_INFO`
     * 算一轮几发。不提取它就永远推不出神像机甲那个"3"。
     */
    const visualOf = (stem: string): EntityRecord["visual"] | undefined => {
      // 变体（`_ST` / `_CR` / `_mayhem`）常常没有自己的 visual 全局，回退到基础名。
      // 已知的游戏数据 bug：`unit_gdi_sandstorm_ST.lua:103` 写的是
      // `unit_gdi_sandstorm_visual`（少了 `_ST`），把基础单位的 visual 覆盖掉了。
      //
      // ⚠️ 不能用「全局是否为 null」判断存在性 —— 运行时给未定义全局返回 autotable，
      // 永远不是 null。改成：**哪一份能解析出 MUZZLE_INFO 就用哪一份**。
      for (const b of [stem, stem.replace(/_(ST|CR|mayhem)$/, "")]) {
        const raw = lua.get(`${b}_visual`);
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
        const out: Record<string, { muzzleInfo?: number[] }> = {};
        for (const [seqName, entry] of Object.entries(raw as Record<string, unknown>)) {
          if (entry === null || typeof entry !== "object") continue;
          const mi = (entry as Record<string, unknown>)["MUZZLE_INFO"];
          if (mi === null || typeof mi !== "object") continue;
          /*
           * wasmoon 对「纯整数键」的 Lua 表有时转成 JS 数组、有时转成数字键对象
           * （神像的 `MUZZLE_INFO` 是对象、沙暴的是数组），两种都要收。
           */
          const items: unknown[] = Array.isArray(mi)
            ? mi
            : Object.keys(mi as object)
                .filter((k) => /^\d+$/.test(k))
                .sort((a, c) => Number(a) - Number(c))
                .map((k) => (mi as Record<string, unknown>)[k]);
          const indices: number[] = [];
          for (const e of items) {
            const v = e !== null && typeof e === "object" ? (e as Record<string, unknown>)["muzzleIndex"] : undefined;
            if (typeof v === "number") indices.push(v);
          }
          if (indices.length) out[seqName] = { muzzleInfo: indices };
        }
        if (Object.keys(out).length) return out;
      }
      return undefined;
    };

    const collect = (sources: SourceFile[]): EntityRecord[] => {
      const out: EntityRecord[] = [];
      for (const src of sources) {
        if (failures.has(src.stem)) continue;
        try {
          const rec = buildRecord(src, lua.get(src.stem), pbByLuaName, []);
          const visual = visualOf(src.stem);
          if (visual) rec.visual = visual;
          out.push(rec);
        } catch (err) {
          failures.set(src.stem, firstLine(err));
        }
      }
      out.sort((a, b) =>
        a.faction === b.faction
          ? a.variant === b.variant
            ? (a.suffixes?.join() ?? "").localeCompare(b.suffixes?.join() ?? "")
            : a.variant.localeCompare(b.variant)
          : a.faction.localeCompare(b.faction),
      );
      return out;
    };

    return {
      units: collect(unitSources),
      commanders: collect(cmdrSources),
      factions,
      failures: [...failures.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      skippedModules,
      root,
    };
  } finally {
    lua.close();
  }
}
