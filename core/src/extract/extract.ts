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
  /**
   * **`gameplay/auras/*.lua` 里那些"格子效果"的数值**（键是 aura 名）。
   *
   * 它们不属于任何单位，却被单位引用（圣甲虫/火焰轰炸机的 `MODIFIER_FIRE` 指向
   * `modifier_fire_bomber_fire`，真正的时长与每跳伤害在 `aura_fire.fire_tuning` /
   * `burn_tuning` 里）。所以单独提出来放在数据集顶层，而不是硬编码进 UI。
   */
  auraTables: Record<string, Record<string, unknown>>;
  /**
   * **按"单位侧引用的名字"索引的共享效果表** —— 写进产物的 `auras` 就是它。
   * 键是 `modifier_fire_bomber_fire` / `modifier_chem_warrior_gas_cloud` 这种
   * （即 `stats.leaves_fire` / `stats.leaves_gas` 的值），值是归一后的字段
   * （`tick_ms` / `tick_damage` / `persist_ms` / `ground_only` / `vs` / `immune`）。
   */
  sharedAuras: Record<string, Record<string, unknown>>;
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
    (parts[0] === "unit" || parts[0] === "cmdr" || parts[0] === "bldg") &&
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

/** 从文件名推断派系。`cmdr_*` / `unit_*` / `bldg_*` 都适用。 */
export function factionOf(stem: string): Faction {
  if (/^(unit|cmdr|bldg)_gdi_/.test(stem)) return "GDI";
  if (/^(unit|cmdr|bldg)_nod_/.test(stem)) return "NOD";
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
    /*
     * `gameplay/buildings/` —— **16 个建筑**，含**基地车（MCV）**与全部生产建筑
     * （兵营/战车工厂/直升机坪/机器人实验室/建造厂、Nod 之手/神殿/机场/坦克厂…）。
     * 这些和 `units/` 里的炮台、激光方尖碑一样是**战场实体**，所以并入 `units`。
     * 文件名前缀不统一（`bldg_*` / `gdi_mcv` / `nod_protopad`），故不按前缀筛。
     */
    const bldgSources = await readSources(join(root, "gameplay", "buildings"), root, /\.lua$/);
    // 能力实现（`TranslateToken` 里硬编码读本体）—— 给 `attachReadsUnit` 用
    const abilitySources = await readSources(join(root, "gameplay", "abilities"), root, /\.lua$/);
    /**
     * **实现文件的并集：`abilities/` + `modifiers/`**。
     *
     * ⚠️ 只读 `abilities/` 是不够的 —— **大量伤害是在 `modifiers/` 里施加的**：
     * 神像的 `modifier_juggernaut_projectile`、火焰轰炸机的 `modifier_fire_bomber_explosion`、
     * 圣甲虫的 `modifier_scarab_projectile`、自行火炮的 `modifier_artillery_projectile` 全在那里。
     * 判定"整队伤害"（`attachSquadDamage`）必须两个目录都扫，否则会**漏掉一半**
     * （第一版只扫 `abilities/`，6 个条目里只认出 2 个）。
     */
    const implSources = [
      ...abilitySources,
      ...(await readSources(join(root, "gameplay", "modifiers"), root, /\.lua$/)),
    ];

    const failures = await evalTwoPass(lua, [...unitSources, ...cmdrSources, ...bldgSources], onError);
    /** 全部实体来源（单位 + 指挥官 + 建筑）—— 变体沿 `readsUnit` 找本体时用 */
    const allSources: SourceFile[] = [...unitSources, ...cmdrSources, ...bldgSources];

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

    /**
     * 把 `modifier_sequence.behaviour = <Lua 函数名>` 补进对应武器。
     *
     * 它在 JSON 里是 `{}`（函数无法序列化），但**这是精确的行为派发键**：
     * 15 份共享实现，名字直接对应 `gameplay/abilities/<名>.lua`。
     * 没有它就只能靠字段嗅探（`if ("stage1" in tuning)`），而嗅探已经错过多次。
     *
     * 提取方式：源码里每张表都是 `name = "..."` 紧跟 `behaviour = <标识符>`。
     */
    const attachBehaviour = (rec: EntityRecord, text: string): void => {
      const before = /name\s*=\s*"([^"]+)"\s*,\s*\n\s*behaviour\s*=\s*(\w+)/g;
      const map = new Map<string, string>();
      for (const m of text.matchAll(before)) map.set(m[1]!, m[2]!);
      if (!map.size) return;
      const ct = rec.config["combatantTuning"] as { weaponTunings?: unknown[] } | undefined;
      if (!Array.isArray(ct?.weaponTunings)) return;
      for (const w of ct.weaponTunings) {
        const ms = (w as { modifier_sequence?: { name?: string; behaviourName?: string; readsUnit?: string } })
          .modifier_sequence;
        const b = ms?.name ? map.get(ms.name) : undefined;
        // 只认开火序列，别把 `modifier_*` 之类的表也写进来
        if (b && b.includes("weapon_sequence")) ms!.behaviourName = b;
      }
    };

    /**
     * **各实现的 `TranslateToken` 是硬编码读「本体」的 tuning 的** —— 记下来。
     *
     * 例：`ability_sandstorm_weapon_sequence:TranslateToken` 里写的是
     * `nTuningUtil.GetWeaponSequenceTuning(unit_gdi_sandstorm, 1)`（不是 self 的所有者），
     * `ability_juggernaut_weapon_sequence` 同理读 `unit_gdi_juggernaut`。
     *
     * 于是**变体（`_ST`）的面板值等于本体**：钢爪沙暴按本体 4000ms 算得 450（自己写的是 3000），
     * 钢爪神像按本体 2.5s 算得 480（自己的 `durationBetweenVolley` 是 0）。
     * 真跑游戏 Lua 逐单位核对时发现的（71 个一致 / 2 个差异，差异全是这个原因）。
     */
    const abilityCache = new Map<string, string | null>();
    const attachReadsUnit = (rec: EntityRecord): void => {
      const ct = rec.config["combatantTuning"] as { weaponTunings?: unknown[] } | undefined;
      if (!Array.isArray(ct?.weaponTunings)) return;
      for (const w of ct.weaponTunings) {
        const ms = (w as { modifier_sequence?: { behaviourName?: string; readsUnit?: string } }).modifier_sequence;
        const beh = ms?.behaviourName;
        if (!beh) continue;
        const rel = `gameplay/abilities/${beh.replace(/_behaviour$/, "")}.lua`;
        let body = abilityCache.get(rel);
        if (body === undefined) {
          body = abilitySources.find((s) => s.rel === rel)?.text ?? null;
          abilityCache.set(rel, body);
        }
        if (!body) continue;
        const m = /Get\w*Tuning\(\s*(unit_\w+|cmdr_\w+)\s*,/.exec(body);
        if (m && m[1] !== rec.id) ms!.readsUnit = m[1];
      }
    };

    /**
     * `GetStatInfo` 里的**多格伤害图案**。
     *
     * 有 9 个单位在自己的 `GetStatInfo` 里写 `CombatTuningInfo.CreateMultiHexDamage(StyleID.X, N)`
     * —— 这是一种**无衰减**的范围伤害：格子图案内的目标全吃全额伤害。
     * 与"圆形范围 + 距离衰减"（虎鲸轰炸机的 `damageRadius`/`damageFalloff`）是**两种不同机制**。
     *
     * 静态解析即可：调用是字面量，不用跑 Lua。见 findings I125。
     */
    const attachMultiHex = (rec: EntityRecord, text: string): void => {
      const m = /CreateMultiHexDamage\(\s*StyleID\.(\w+)\s*,\s*(\d+)\s*\)/.exec(text);
      if (m) (rec as { multiHex?: unknown }).multiHex = { shape: m[1]!, size: Number(m[2]!) };
    };

    /**
     * **判断这把武器的伤害是不是"整队每人一份"**（用户："哪些武器是全队伤害"）。
     *
     * 判据**不是** `area`（那只说"打到几个目标"），而是**伤害走哪个 API**：
     *
     *   · `nDamageUtil.AoeDamageSquad*`  ⇒ `squad:TakeAOEDamage(...)` —— **整队每人各吃一份**
     *   · `DamageCombatant(List)` / `DamageSquad(List)` ⇒ `TakeDirectDamage` / `TakeRedirectDamage`
     *     —— **只打到具体某一员**（`DamageSquadList` 打 `GetLastCombatant()`）
     *
     * 反直觉的实例（findings I239）：**火焰坦克与万钧巨炮的"溅射"都只掉一员**
     * （`ability_flametank_weapon_sequence.lua:89,123`、`ability_beamcannon_weapon_sequence.lua:335`
     * 全走 `DamageSquadList`/`DamageSquadOverride`）；而**音波坦克/神像/火焰轰炸机/圣甲虫**才是整队伤害。
     *
     * ## 判据的粒度：**整个单位**，不是逐把武器
     *
     * 伤害实现常常隔着一两层才被引用，而且有些是**别名**（地狱火的 `MODIFIER_FIRE` 指向
     * `modifier_fire_bomber_fire`，真正的实现在它指向的 `modifier_fire_bomber_explosion`），
     * 逐把武器追链会漏（第一版就只认出 2/6）。
     * 所以改成：**扫该单位源码里所有被引用的 `modifier_*`/`ability_*` 名字，
     * 逐个实现文件看有没有 `AoeDamageSquad`** —— 命中就把该单位**所有有伤害的武器**标上。
     *
     * ⚠️ 这个粒度是**有意的取舍**：全库命中这条判据的单位**都只有一把武器**
     * （音波坦克 / 神像 / 深岩巨虫 / 圣甲虫 / 地狱火 / 催化剂炮艇），所以"单位级"在这里
     * 等于"武器级"。将来若出现"一把单挑、一把 AOE"的多武器单位，这里要改回逐武器归因。
     *
     * ## 变体传染
     *
     * `_ST` 这类变体自己**不写**实现，它复用本体的能力（`TranslateToken` 硬编码读本体，
     * 见 findings I196/I197）—— 所以若 `readsUnit` 指向的**本体**被标了，变体也一起标。
     */
    /** 该单位源码里引用到的全部实现名（`"modifier_x"` 与 `behaviour = x` 两种写法） */
    const implRefsOf = (src: string): Set<string> => {
      const refs = new Set<string>();
      for (const m of src.matchAll(/"((?:modifier|ability)_[a-z0-9_]+)"/g)) {
        refs.add(m[1]!.replace(/_behaviour$/, ""));
      }
      /*
       * ⚠️ **`RequiredHash("modifier_x")` 里的名字也要收**。
       *
       * 伤害经常经 `MODIFIER_FIRE` / `EXPLOSION_MODIFIER` 这类**常量字段**引用别的实现，
       * 例如催化剂：`EXPLOSION_MODIFIER = RequiredHash("ability_catalyst_explosion")`。
       * 字符串本身长得跟上面那条一样，但**在 `tuning` 表里**、且 `RequiredHash(...)` 是
       * 运行期求值 —— 早先的 `"..."` 扫描只覆盖了源码里**直接写名字**的位置，
       * 于是催化剂/音波坦克的整队伤害全都归因不到（实测：只剩 4 条）。
       */
      for (const m of src.matchAll(/RequiredHash\(\s*"([^"]+)"/g)) {
        if (/^(modifier|ability)_/.test(m[1]!)) refs.add(m[1]!.replace(/_behaviour$/, ""));
      }
      // `behaviour = <标识符>` 形式（函数名不带引号）也要算
      for (const m of src.matchAll(/behaviour\s*=\s*(\w+)/g)) {
        refs.add(m[1]!.replace(/_behaviour$/, ""));
      }
      return refs;
    };
    /** 被引用的实现里，有没有一个含整队伤害 */
    const refsHaveAoe = (src: string): boolean => {
      const implHasAoe = (bare: string): boolean => {
        for (const dir of ["abilities", "modifiers"]) {
          const body = implSources.find((s) => s.rel === `gameplay/${dir}/${bare}.lua`)?.text;
          if (body !== undefined && /AoeDamageSquad/.test(body)) return true;
        }
        return false;
      };
      return [...implRefsOf(src)].some(implHasAoe);
    };

    /**
     * **独立的伤害组** —— 从两处源码结构里解出来（都不是"字段嗅探"，是文件里真实写着的）：
     *
     * ① `SetupModifierTuning { name = "X", behaviour = Y, tuning = <表达式> }`
     * ② `SetupCombatAbility(<名>, <tuning 表达式>, …)`
     *
     * 为什么需要它：**伤害不一定挂在那把武器自己的 `projectile.modifier.tuning` 上**。
     * 催化剂炮艇就是反例（用户指出："实际上是用小炮打，5s 后发毒气弹，小炮打毒气会炸"）：
     *
     * ```lua
     * -- unit_nod_catalystgunship.lua
     * tiberiumExplosionTuning = { damageMain = { default = 800, override = { Structure:800, Infantry:300 } } }
     * SetupModifierTuning { name = "ability_catalyst_explosion", tuning = unit_nod_catalystgunship.tiberiumExplosionTuning }
     * ```
     *
     * `ability_catalyst_explosion.lua:33` 用 **`damageMain`** 打整队 —— 那个 800 在任何武器上
     * 都读不到，只有把 `SetupModifierTuning` 解出来才拿得到。
     *
     * 同时把 `unit_x.tiberiumExplosionTuning` 这种**点号引用**解析到已求值的 config 里
     * （那些 tuning 本来就是单位表的成员，`toPlain` 之后的普通对象可以直接查）。
     */
    const attachGroups = (rec: EntityRecord, config: Record<string, unknown>, text: string): void => {
      /**
       * 把 `unit_nod_catalystgunship.tiberiumExplosionTuning` 解析到**该单位**的 config 上。
       *
       * ⚠️ 表达式里**带单位自己的全局名做前缀**（Lua 里 `unit_x` 就是那张表本身），
       * 而我们在 JS 侧拿到的是它的内容 ⇒ 必须把第一段（等于 `rec.id`）剥掉，
       * 否则 `config["unit_nod_catalystgunship"]` 恒为 undefined。
       * 第一版就是这么错的：组解出来了，`tuning` 却是 undefined。
       */
      const resolveDot = (expr: string): unknown => {
        const parts = expr.split(".");
        const keys = parts[0] === rec.id ? parts.slice(1) : parts;
        return keys.reduce<unknown>((cur, key) => {
          if (cur === null || typeof cur !== "object") return undefined;
          return (cur as Record<string, unknown>)[key];
        }, config);
      };

      const groups: Array<{ name: string; behaviour?: string; tuning?: unknown }> = [];
      for (const m of text.matchAll(
        /SetupModifierTuning\s*\{([\s\S]*?)\n\}/g,
      )) {
        const body = m[1]!;
        const name = /name\s*=\s*"([^"]+)"/.exec(body)?.[1];
        if (!name) continue;
        const behaviour = /behaviour\s*=\s*(\w+)/.exec(body)?.[1];
        const expr = /tuning\s*=\s*([A-Za-z_][\w.]*)/.exec(body)?.[1];
        const tuning = expr ? resolveDot(expr) : undefined;
        groups.push({
          name,
          ...(behaviour ? { behaviour } : {}),
          ...(tuning !== undefined ? { tuning } : {}),
        });
      }
      for (const m of text.matchAll(/SetupCombatAbility\s*\(\s*([\w.]+)\s*,\s*([\w.]+)\s*,/g)) {
        const name = m[1]!.split(".").pop()!;
        if (groups.some((g) => g.name === name)) continue;
        const tuning = resolveDot(m[2]!);
        groups.push({ name, ...(tuning !== undefined ? { tuning } : {}) });
      }
      if (groups.length) (rec as { groups?: unknown }).groups = groups;
    };
    /**
     * **被引用的实现里，有没有一个会让**自己**原地消失**。
     *
     * 圣甲虫的 `ability_scarab_weapon_sequence.lua:51` 打完最后一发后直接
     * `self:GetOwnerCombatant():TakeHiddenDestroyDamage()` —— **自爆不是"受到伤害"**，
     * 所以它不受减伤、也不会漏给周围（用户实测："自爆不会杀死自己, 也不会对全队造成伤害"）。
     *
     * ⚠️ **判据必须窄到"开火序列自己那一个文件"，不能像 `attachSquadDamage` 那样扫全部引用**：
     * 全库有两处 `TakeHiddenDestroyDamage`，另一处是钻地车的
     * `modifier_drillpod_intro.lua:74` —— 那是**部署动作**里的自毁（钻地车钻出来就没了本体），
     * 不是"打完一枪就死"。第一版扫全部引用，于是钻地车 ×2 被误标。
     */
    const refsHaveSelfDestruct = (behaviourName: string): boolean => {
      const rel = `gameplay/abilities/${behaviourName.replace(/_behaviour$/, "")}.lua`;
      const body = implSources.find((s) => s.rel === rel)?.text;
      return body !== undefined && /TakeHiddenDestroyDamage/.test(body);
    };

    /**
     * **实现名 → 源码**，以及从源码里预抽好的**引用集合**。
     *
     * ⚠️ **为什么不能从求值后的 config 里找引用**：`RequiredHash("ability_catalyst_explosion")`
     * 是**运行期**求值，而 `toPlain()` 会把函数丢掉、把值搬位置 —— 走完 Lua 之后
     * "谁引用了谁"这条信息就没有了。判引用关系**只能读源码**（`initImplRefs` 扫一遍存下来）。
     */
    const implText = new Map<string, string>();
    const implRefs = new Map<string, Set<string>>();
    /** 见 `implRefs` 的说明：从**源码**预抽引用，求值后的 config 里找不回来 */
    const initImplRefs = (): void => {
      for (const s of implSources) {
        const key = s.stem.replace(/_behaviour$/, "");
        implText.set(key, s.text);
        implRefs.set(key, implRefsOf(s.text));
      }
    };
    initImplRefs();

    /**
     * **整队伤害（一次性打对面全队）—— 逐把武器归因，不再按"整个单位"一刀切。**
     *
     * 判据是**伤害走哪个 API**（`DamageUtil.lua`）：
     *
     * | 实现 | API | 效果 |
     * | --- | --- | --- |
     * | `AoeDamageSquad*` | `squad:TakeAOEDamage` | **整队每人各一份** |
     * | `DamageCombatantList*` | `combatant:TakeDirectDamage` | 列表里每个战斗员各一份 |
     * | `DamageSquadList*` | `GetLastCombatant():TakeRedirectDamage` | **只掉一员** |
     *
     * ⚠️ **只认这把武器自己的实现**。早先是"整个单位引用的实现里有一个含 `AoeDamageSquad`
     * 就把该单位所有武器都标上"——单武器单位上等价，但**催化剂炮艇有两把武器**
     * （gasWeapon 铺毒气、catalystWeapon 引爆），一刀切会把**铺毒气的小炮也标成整队伤害**（错的）。
     *
     * ⚠️ **还要沿一层"引爆"跳转**：催化剂的小炮自己不含 `AoeDamageSquad`，它只是
     * `RequestAbility(EXPLOSION_MODIFIER = ability_catalyst_explosion)`，
     * 真正打整队的是那个被引爆的实现（`ability_catalyst_explosion.lua:33`）。
     * 所以：武器自己的实现里若引用了别的 `ability_*`/`modifier_*`，那些也一起看。
     *
     * 变体传染照旧：`readsUnit` 指向的本体被标了，变体也标（`unit_gdi_juggernaut_ST`）。
     */
    const attachSquadDamage = (rec: EntityRecord, text: string): void => {
      /**
       * 一个实现（**以及它引用的实现，最多再跳两跳**）里有没有 `AoeDamageSquad`。
       *
       * 为什么必须跳：催化剂那条链是
       * `modifier_catalystgunship_projectile`（只 `RequestAbility`）
       *   → `ability_catalyst_explosion`（**这里才 `AoeDamageSquadListOverride`**）
       * —— 只看武器自己那一个文件会**漏掉催化剂 800 那个整队爆炸**（第一版修完就是这样）。
       *
       * 为什么限制跳数：`modifier_catalystgunship_projectile` 里引用了
       * `modifier_chem_warrior_gas_cloud`，那是**无限递归**（它引回来），必须定深。
       */
      const depth = 2;
      const implHasAoe = (bare: string, seen: Set<string>, left: number): boolean => {
        const key = bare.replace(/_behaviour$/, "");
        if (seen.has(key) || left < 0) return false;
        seen.add(key);
        const body = implText.get(key);
        // 没在 `abilities/`+`modifiers/` 里的（`inherits(...)` 之类）当成"看不见"，不猜
        if (body === undefined) return false;
        if (/AoeDamageSquad/.test(body)) return true;
        return [...(implRefs.get(key) ?? [])].some((r) => implHasAoe(r, seen, left - 1));
      };

      const ct = rec.config["combatantTuning"] as { weaponTunings?: unknown[] } | undefined;
      if (!Array.isArray(ct?.weaponTunings)) return;

      for (const w of ct.weaponTunings) {
        const ww = w as {
          squadDamage?: boolean;
          projectile?: { modifier?: { name?: string; behaviour?: string } };
          modifier_spawn?: { name?: string; behaviour?: string };
          modifier_shot?: { name?: string; behaviour?: string };
          modifier_sequence?: { name?: string; behaviourName?: string; readsUnit?: string };
        };
        /** 这把武器自己挂的实现名（弹体 modifier / spawn / shot） */
        const own: string[] = [ww.projectile?.modifier, ww.modifier_spawn, ww.modifier_shot]
          .map((m) => m?.name)
          .filter((n): n is string => typeof n === "string");
        let flag = own.some((n) => implHasAoe(n, new Set(), depth));
        /*
         * **变体传染**：`readsUnit` 指向本体的那把武器 —— 变体自己不写实现
         * （`TranslateToken` 硬编码读本体，见 I196/I197），所以照本体的实现判。
         */
        const readsUnit = ww.modifier_sequence?.readsUnit;
        if (!flag && readsUnit) {
          const baseText = allSources.find((s) => s.stem === readsUnit)?.text;
          if (baseText) {
            const baseRec = buildRecord(
              { stem: readsUnit, rel: `gameplay/units/${readsUnit}.lua`, text: baseText },
              lua.get(readsUnit),
              pbByLuaName,
              [],
            );
            const bct = baseRec.config["combatantTuning"] as { weaponTunings?: unknown[] } | undefined;
            flag = (bct?.weaponTunings ?? []).some((bw) => {
              const b = bw as {
                projectile?: { modifier?: { name?: string } };
                modifier_spawn?: { name?: string };
              };
              return [b.projectile?.modifier?.name, b.modifier_spawn?.name]
                .filter((n): n is string => typeof n === "string")
                .some((n) => implHasAoe(n, new Set(), depth));
            });
          }
        }
        if (flag) ww.squadDamage = true;
      }
      void text;
    };

    /**
     * **命中后会在目标格留下一层火**（`modifier_scarab_projectile.lua:71-72` 的
     * `RequestModifier(tile, …, MODIFIER_FIRE, …)`）。
     *
     * 用户指出圣甲虫"会在对面格子留下火焰，就像毒车在对面格子留下毒雾"。
     * 铺下的是 `modifier_fire_bomber_fire`（`unit_nod_scarab.lua:31` 的 `MODIFIER_FIRE`），
     * **和火焰轰炸机同一个**（`unit_nod_firebomber.lua:39`）。
     *
     * 判据：单位源码里引用了 `modifier_fire_bomber_fire`（含变体沿 `readsUnit` 传染）。
     */
    const attachLeavesFire = (rec: EntityRecord, text: string): void => {
      const FIRE = "modifier_fire_bomber_fire";
      const hit = text.includes(FIRE)
        ? true
        : (rec.config["combatantTuning"] as { weaponTunings?: unknown[] } | undefined)?.weaponTunings?.some(
            (w) => {
              const reads = (w as { modifier_sequence?: { readsUnit?: string } }).modifier_sequence
                ?.readsUnit;
              if (!reads) return false;
              return allSources.find((s) => s.stem === reads)?.text.includes(FIRE) === true;
            },
          ) === true;
      if (!hit) return;
      (rec as { leavesFire?: string }).leavesFire = FIRE;
      /*
       * ⚠️ **不往单位里写数值副本** —— 数值只活在顶层 `auras` 表里，
       * 单位侧只有 `stats.leaves_fire` 这个**引用**（名字就是那个 modifier）。
       */
      void fireOf();
    };

    /**
     * **命中后会在目标格铺一层毒气** —— 三个单位：催化剂炮艇 / 化武兵 / 生化越野车（毒车）。
     *
     * 判据：源码里引用了 `modifier_chem_warrior_gas_cloud`
     * （`unit_nod_catalystgunship.lua:56` 的 `gasCloudModifierId`、
     * `unit_nod_chemquad.lua:51`、`unit_nod_chemicalwarrior.lua:46`）。
     * 数值同样来自 `auras/aura_gas_cloud.lua`（见 `gasOf`）。
     */
    const attachLeavesGas = (rec: EntityRecord, text: string): void => {
      const GAS = "modifier_chem_warrior_gas_cloud";
      if (!text.includes(GAS)) return;
      (rec as { leavesGas?: string }).leavesGas = GAS;
    };

    /**
     * **火/毒这类「格子效果」的数值** —— 从 `gameplay/auras/*.lua` 提取。
     *
     * ⚠️ 这些数**不在 `units/` 里**：圣甲虫只是 `MODIFIER_FIRE = RequiredHash("modifier_fire_bomber_fire")`，
     * 真正的持续时间/每跳伤害/跳间隔在 `auras/aura_fire.lua`：
     *
     * ```
     * fire_tuning  = { PERSIST_DURATION_MS = 10000, condition = { DESCRIPTOR_MASK = Ground } }
     * burn_tuning  = { damage = { default = 25, override = { Vehicle = 25 } }, tickPeriodMs = 250 }
     * ```
     *
     * **必须在提取期解出来**（而不是在 UI 里硬编码）：`auras/` 是原样分发的 Lua，
     * 跑一遍 `wasmoon` 就能拿到真值；硬编码等于把这个项目的立身之本
     * （"数值来自游戏源码"）丢掉。见 findings I243。
     *
     * ⚠️ 求值 `auras/` 一度**整体失败**：`aura_fire.lua` 的
     * `bit32.bor(CombatantDescriptor.Ground)` 在 autotable 桩上报
     * "attempt to call a table value (field 'bor')"。修 `luaRuntime` 的 `bit32` 之后才有数据。
     */
    const auraSources = await readSources(join(root, "gameplay", "auras"), root, /\.lua$/);
    /** aura 名 → 求值后的普通对象（键名与 Lua 里一致，数值原样） */
    const auraTables: Record<string, Record<string, unknown>> = {};
    for (const src of auraSources) {
      try {
        lua.exec(src.text);
      } catch {
        continue; // 单个 aura 解析失败不该拖垮整轮提取
      }
      const raw = lua.get(src.stem);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const dropped: string[] = [];
      const plain = toPlain(raw, dropped);
      if (plain && typeof plain === "object") {
        auraTables[src.stem] = plain as Record<string, unknown>;
      }
    }
    /**
     * **顶层 `auras` 表的最终形状** —— 单位只引用它的键，数值全在这里。
     *
     * 键用**单位侧引用的那个名字**（不是 `aura_fire` 这种文件 stem），
     * 因为单位源码里写的是 `RequiredHash("modifier_fire_bomber_fire")`：
     *
     * | 键 | 来源 aura | 谁铺的 |
     * | --- | --- | --- |
     * | `modifier_fire_bomber_fire` | `aura_fire` | 圣甲虫 / 火焰轰炸机 |
     * | `modifier_chem_warrior_gas_cloud` | `aura_gas_cloud` | 催化剂 / 化武兵 / 毒车 |
     */
    const sharedAuras: Record<string, Record<string, unknown>> = {};
    /**
     * 把一个 aura 的两段 tuning 归一成一组字段。
     *
     * | aura | 触发条件 | 每跳 | 持续 |
     * | --- | --- | --- | --- |
     * | `aura_fire` | `DESCRIPTOR_MASK = Ground` | 25/250ms | 10000 |
     * | `aura_gas_cloud` | `Ground + Infantry`，且**化武兵/毒车免疫** | 6/200ms（**载具 0**） | 10000 |
     *
     * `vs` 是"这个效果打谁"：火只记 `ground_only`；毒气把 `override` 读成明确的逐类型表
     * （`Vehicle: 0` ⇒ 载具**完全不吃**），并记下免疫名单 —— 免疫是**单位 id**，
     * 不在本页的 1v1 建模范围内，但产物要如实留着。
     */
    const auraEffectOf = (
      auraName: string,
      /** "铺"那段的 key，带 `PERSIST_DURATION_MS` / `condition`，如 `gas_tuning` */
      coatKey: string,
      /** "跳"那段的 key，带 `damage` / `tickPeriodMs`，如 `poison_tuning` */
      tickKey: string,
    ): Record<string, unknown> | undefined => {
      const raw = auraTables[auraName] as Record<string, unknown> | undefined;
      if (!raw) return undefined;
      const coat = raw[coatKey] as Record<string, unknown> | undefined;
      const tick = raw[tickKey] as
        | { damage?: { default?: number; override?: unknown }; tickPeriodMs?: number }
        | undefined;
      const persist = coat?.["PERSIST_DURATION_MS"];
      const tickMs = tick?.tickPeriodMs;
      const dmg = tick?.damage?.default;
      if (typeof persist !== "number" || typeof tickMs !== "number" || typeof dmg !== "number") {
        return undefined;
      }
      const cond = coat?.["condition"] as Record<string, unknown> | undefined;
      const overrides = Array.isArray(tick?.damage?.override)
        ? (tick.damage.override as Array<[string, number]>)
        : [];
      const out: Record<string, unknown> = {
        tick_ms: tickMs,
        tick_damage: dmg,
        persist_ms: persist,
        ground_only: cond !== undefined,
      };
      if (overrides.length) out.vs = Object.fromEntries(overrides);
      const immune: string[] = [];
      for (const k of Object.keys(cond ?? {})) {
        if (/^IMMUNE_UNIT\d+$/.test(k)) immune.push(String(cond![k]));
      }
      if (immune.length) out.immune = immune;
      return out;
    };
    const fireOf = () => auraEffectOf("aura_fire", "fire_tuning", "burn_tuning");
    const gasOf = () => auraEffectOf("aura_gas_cloud", "gas_tuning", "poison_tuning");
    /*
     * 键用**单位侧引用的那个名字**（不是 `aura_fire` 这种文件 stem），
     * 因为单位源码里写的是 `RequiredHash("modifier_fire_bomber_fire")`。
     */
    const fireStats = fireOf();
    if (fireStats) sharedAuras["modifier_fire_bomber_fire"] = fireStats;
    const gasStats = gasOf();
    if (gasStats) sharedAuras["modifier_chem_warrior_gas_cloud"] = gasStats;
    /*
     * **其余 aura 也收**（太伯利亚力场这种没有任何单位"拥有"的）——
     * 按"文件 stem + 归一字段"进表。它们现在没有单位引用，但**产物里要有**：
     * 结算是"查共享表"，将来谁引用了就能直接用，不必再改提取器。
     */
    for (const [name, raw] of Object.entries(auraTables)) {
      if (name === "aura_fire" || name === "aura_gas_cloud") continue;
      const head = Object.values(raw).find(
        (v) => v !== null && typeof v === "object" && !Array.isArray(v),
      ) as Record<string, unknown> | undefined;
      if (!head) continue;
      const tuningKeys = Object.keys(head).filter((k) => k.endsWith("_tuning"));
      if (tuningKeys.length < 2) continue;
      const fields = auraEffectOf(name, tuningKeys[0]!, tuningKeys[1]!);
      if (fields) sharedAuras[name] = fields;
    }

    /**
     * **攻击后自身消失**（自杀式单位）—— 记在单位上，`stats.self_destruct`。
     *
     * 与 `attachSquadDamage` 一样带**变体传染**：变体自己不写实现、由 `readsUnit` 指回本体
     * （`TranslateToken` 硬编码读本体，见 I196/I197），所以本体自杀 ⇒ 变体也自杀。
     */
    const attachSelfDestruct = (rec: EntityRecord): void => {
      const ct = rec.config["combatantTuning"] as { weaponTunings?: unknown[] } | undefined;
      for (const w of ct?.weaponTunings ?? []) {
        const beh = (w as { modifier_sequence?: { behaviourName?: string; readsUnit?: string } })
          .modifier_sequence;
        if (!beh) continue;
        /*
         * ① 自己文件里的开火序列实现；② `readsUnit` 指向的本体的开火序列实现
         * （本体的 `behaviourName` 要从本体源码里重新解析 —— 提取结果里只有变体那份）。
         */
        if (beh.behaviourName && refsHaveSelfDestruct(beh.behaviourName)) {
          (rec as { selfDestruct?: boolean }).selfDestruct = true;
          return;
        }
        const base = beh.readsUnit ? allSources.find((s) => s.stem === beh.readsUnit) : undefined;
        if (base && /TakeHiddenDestroyDamage/.test(base.text)) {
          (rec as { selfDestruct?: boolean }).selfDestruct = true;
          return;
        }
      }
    };

    const collect = (sources: SourceFile[]): EntityRecord[] => {
      const out: EntityRecord[] = [];
      for (const src of sources) {
        if (failures.has(src.stem)) continue;
        try {
          const rec = buildRecord(src, lua.get(src.stem), pbByLuaName, []);
          attachBehaviour(rec, src.text);
          attachReadsUnit(rec);
          attachMultiHex(rec, src.text);
          attachSquadDamage(rec, src.text);
          attachSelfDestruct(rec);
          attachLeavesFire(rec, src.text);
          attachLeavesGas(rec, src.text);
          attachGroups(rec, rec.config as unknown as Record<string, unknown>, src.text);
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
      /*
       * ✅ **只收「总部 / 基地」** —— `bldg_<faction>_conyard`。
       *
       * 依据：全库只有建造厂是 **30000 血**（其余建筑一律 520），且本地化键
       * `UI_GDI_CONYARD` = **"Headquarters" / "总部"** —— 它就是要看血量的那个基地。
       * 其余 14 个建筑（兵营/工厂/机场/Nod 神殿…）**不要**（用户决定）。
       *
       * 已解决：前缀 `bldg_` 的解析（`splitVariant` / `factionOf` 都已支持）→
       * `faction=GDI`、`variant=conyard`，于是 `_build_locale.py` 能算出 `UI_GDI_CONYARD`。
       * 图标仍缺（`data/img/` 没有），UI 需容忍。
       */
      units: collect([...unitSources, ...bldgSources.filter((s) => /^bldg_(gdi|nod)_conyard$/.test(s.stem))]),
      commanders: collect(cmdrSources),
      factions,
      failures: [...failures.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      skippedModules,
      root,
      auraTables,
      sharedAuras,
    };
  } finally {
    lua.close();
  }
}
