#!/usr/bin/env node
/**
 * 命令行：提取游戏数据，以及查询 data/ 下的产物。
 *
 * 提取（`extract`）执行游戏 Lua 调参脚本 + 解析 game-config.pb；
 * 查询（`list` / `counter` / ...）只读 data/，共享逻辑来自 @rivals/core。
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  cheaperThan,
  targetingIntent,
  extractAll,
  pickDamage,
  writeAll,
  RivalsError,
  type DamageOverrideTag,
  type UnitIndex,
  type UnitSummary,
} from "@rivals/core";
import { ALL_UNIT_DEFS } from "@rivals/core/units";
import { encodeDef, DEF_SCHEMA } from "@rivals/core/def-json";
import type { DefFileJson, LocaleJson, UnitDefJson, UnitRecordJson } from "@rivals/core/def-json";
import { convertUnit } from "@rivals/core/convert";
import { patchDefJson } from "@rivals/core/units";

/**
 * `data/units.json` 里一条记录的**展示部分**（旧形状）。
 *
 * ⚠️ 只读这几个"新格式要带走"的字段 —— 机械数值**不从这儿读**（那走 `core/src/units/`）。
 */
interface ProductEntry {
  id: string;
  faction?: string;
  variant?: string;
  suffixes?: string[];
  source?: string;
  name_zh?: string;
  name_en?: string;
  desc_zh?: string;
  desc_en?: string;
  pb?: Record<string, unknown>;
}

/** `overrides` 能作为目标的有效类型（= 单位的 override_* 标签去掉前缀）。 */
const DAMAGE_TARGETS = ["Infantry", "Vehicle", "Aircraft", "Structure", "Harvester"] as const;

const isDamageOverrideTag = (s: string): s is DamageOverrideTag =>
  (DAMAGE_TARGETS as readonly string[]).includes(s);

const HERE = dirname(fileURLToPath(import.meta.url));
// cli/src/ -> 上溯 2 级到仓库根
const REPO_ROOT = resolve(HERE, "../..");
const DEFAULT_DATA = join(REPO_ROOT, "data");
/** 默认 pb 位置，相对仓库根 */
const DEFAULT_PB_REL = "tmp/com.ea.gp.candcwarzones/files/game-config.pb";

const USAGE = `
用法: rivals <命令> [选项]

命令:
  extract <输入目录>       从游戏数据目录提取 JSON 产物
  emit-defs                把 core/src/units 里的 def 导出成 data/units.def.json
  list                     列出全部单位
  counter <类型>           列出标注针对指定类型的单位（Infantry|Vehicle|Aircraft|Structure）
  cheap <造价>             列出造价不超过指定值的单位
  damage <单位> <目标类型> 计算某单位对目标类型的伤害

选项:
  --out <目录>             extract 的输出目录（默认仓库根的 data/）
  --pb <文件>              game-config.pb 路径（默认 tmp/ 下的约定位置）
  --strict                 extract 时任一实体求值失败即中止
  --data <目录>            查询命令的数据目录（默认仓库根的 data/）
  --json                   以 JSON 输出
  -h, --help               显示帮助

例子:
  rivals extract tmp/com.ea.gp.candcwarzones
  rivals list
  rivals counter Aircraft
  rivals cheap 30
  rivals damage unit_gdi_predatortank Infantry
`.trim();

async function loadIndex(dataDir: string): Promise<UnitIndex> {
  const raw = await readFile(join(dataDir, "index.json"), "utf8");
  return JSON.parse(raw) as UnitIndex;
}

async function loadUnitConfig(dataDir: string, unitId: string): Promise<any> {
  const raw = await readFile(join(dataDir, "unit", `${unitId}.lua.json`), "utf8");
  return JSON.parse(raw);
}

/** 起始等级显示成游戏内的 `major-minor` 记法 */
function startLevel(u: UnitSummary): string {
  return u.start_major === undefined ? "-" : `${u.start_major}-0`;
}

function row(u: UnitSummary): string {
  const hp = u.health ?? "-";
  const cost = u.cost ?? "-";
  const dmg = u.damage ?? "-";
  return (
    `${u.id.padEnd(34)} ${u.faction.padEnd(4)} ${(u.rarity ?? "-").padEnd(7)}` +
    ` 起始 ${startLevel(u).padEnd(5)} HP ${String(hp).padStart(5)}` +
    `  造价 ${String(cost).padStart(4)}  伤害 ${String(dmg).padStart(5)}`
  );
}

/**
 * `emit-defs` 命令：把**单位数据**导出成新格式产物（`data/units.def.json`）。
 *
 * ## 新格式是完整的一条记录，不只是机械 def
 *
 * 用户定的硬约束：**单位数据一律走新格式**。所以一条记录里除了机械 `def`
 * （`core/src/units/*.ts`，含 `source.anchors` 出处），还必须自己带着：
 *
 * | 块 | 从哪来 |
 * | --- | --- |
 * | `locale`（中英文名 / 描述） | `data/units.json` 的条目顶层（源头是 `data/locale/*`） |
 * | `pb`（稀有度等） | 同上（源头是 `game-config.pb`） |
 * | `art.card` | **按 `data/img/` 实际盘点**（没有这张图就不写，别让页面靠 404 发现） |
 * | `faction` / `variant` / `suffixes` / `source` | 同上 |
 *
 * ⚠️ **还没有 def 的单位也照写**（只有展示三件套）—— 于是页面现在就能整站读这一份文件，
 * 机械细节随批量转换逐步补齐（`def` 不出现 = 还没转，不是"没有武器"）。
 */
async function runEmitDefs(dataDir: string): Promise<number> {
  const product = JSON.parse(await readFile(join(dataDir, "units.json"), "utf8")) as {
    units?: ProductEntry[];
    commanders?: ProductEntry[];
  };
  const icons = new Set(await readdir(join(dataDir, "img")).catch(() => [] as string[]));
  const defs = new Map(ALL_UNIT_DEFS.map((d) => [d.id, d]));

  /*
   * **机器转换的机械 def**（`convert-defs` 的产物）—— 兜底用：手写的 def 优先，
   * 其余单位用它补齐。没有这个文件也能跑（那就只有手写的那些）。
   */
  let generated: {
    units?: Record<string, UnitDefJson>;
    gaps?: Record<string, string[]>;
    patched?: Record<string, string[]>;
    patchNotes?: Record<string, string>;
  } = {};
  try {
    generated = JSON.parse(await readFile(join(dataDir, "units.def.gen.json"), "utf8")) as typeof generated;
  } catch {
    console.log("提示：没有 data/units.def.gen.json（先跑 `rivals convert-defs <游戏目录>`）—— 这次只导出有手写 def 的单位");
  }
  const generatedUnits = generated.units ?? {};
  const generatedGaps = generated.gaps ?? {};
  const generatedPatched = generated.patched ?? {};
  const generatedPatchNotes = generated.patchNotes ?? {};

  const build = (entries: ProductEntry[]): Record<string, UnitRecordJson> => {
    const out: Record<string, UnitRecordJson> = {};
    for (const e of entries) {
      const rec: UnitRecordJson = { id: e.id };
      if (e.faction !== undefined) rec.faction = e.faction;
      if (e.variant !== undefined) rec.variant = e.variant;
      if (e.suffixes !== undefined) rec.suffixes = e.suffixes;
      if (e.source !== undefined) rec.source = e.source;
      const locale: LocaleJson = {};
      if (e.name_zh !== undefined) locale.name_zh = e.name_zh;
      if (e.name_en !== undefined) locale.name_en = e.name_en;
      if (e.desc_zh !== undefined) locale.desc_zh = e.desc_zh;
      if (e.desc_en !== undefined) locale.desc_en = e.desc_en;
      if (Object.keys(locale).length) rec.locale = locale;
      if (e.pb !== undefined) rec.pb = e.pb;
      if (icons.has(`${e.id}.webp`)) rec.art = { card: `img/${e.id}.webp` };
      // **手写的 def 优先**（人核对过），机器转换的兜底，最后叠**手写 patch**（逐字段修正）
      const hand = defs.get(e.id);
      if (hand !== undefined) {
        rec.def = encodeDef(hand);
      } else if (generatedUnits[e.id] !== undefined) {
        // patch 已在 `convert-defs` 那一步叠好（见那边的注释）—— 这里只把痕迹搬进产物
        rec.def = generatedUnits[e.id]!;
        const g = generatedGaps[e.id];
        if (g?.length) rec.defGaps = g;
        const p = generatedPatched[e.id];
        if (p?.length) {
          rec.defPatched = p;
          const note = generatedPatchNotes[e.id];
          if (note !== undefined) rec.defPatchNote = note;
        }
      }
      out[e.id] = rec;
    }
    return out;
  };

  const units = build(product.units ?? []);
  const commanders = build(product.commanders ?? []);
  // 有 def 但产物里没这条记录（新单位刚写好、还没重跑 extract）⇒ 也要出现
  for (const def of ALL_UNIT_DEFS) {
    if (units[def.id] === undefined) units[def.id] = { id: def.id, def: encodeDef(def) };
  }
  for (const [id, json] of Object.entries(generatedUnits)) {
    if (units[id] === undefined) units[id] = { id, def: json, ...(generatedGaps[id]?.length ? { defGaps: generatedGaps[id]! } : {}) };
  }

  const file: DefFileJson = {
    _note:
      "单位数据（新格式）—— `rivals emit-defs` 生成。机械定义：手写 def（core/src/units/*.ts）优先，" +
      "其余由 `rivals convert-defs` 从 Lua 转换（带 source.anchors 出处；`defGaps` = 还没转出来的东西）；" +
      "本地化/稀有度/图标来自 data/units.json 与 data/img/。" +
      "读取要过 decodeRecord()（Damage 是 class，见 core/src/model/def-json.ts）。",
    _schema: DEF_SCHEMA,
    units,
    commanders,
  };

  const outPath = join(dataDir, "units.def.json");
  await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");

  const list = Object.values(units);
  const withDef = list.filter((r) => r.def !== undefined);
  const handIds = new Set([...defs.keys()]);
  const withLocale = list.filter((r) => r.locale?.name_zh !== undefined);
  const withArt = list.filter((r) => r.art !== undefined);
  const withPb = list.filter((r) => r.pb !== undefined);
  const withGaps = list.filter((r) => (r.defGaps ?? []).length > 0);
  console.log(`写出       : ${outPath}`);
  console.log(`单位 ${list.length} 条 · 指挥官 ${Object.keys(commanders).length} 条`);
  console.log(`  有机械 def : ${withDef.length} / ${list.length}（手写 ${list.filter((r) => handIds.has(r.id)).length}）`);
  console.log(`  有本地化   : ${withLocale.length} / ${list.length}`);
  console.log(`  有卡面     : ${withArt.length} / ${list.length}（按 data/img/ 盘点）`);
  console.log(`  有稀有度   : ${withPb.length} / ${list.length}`);
  console.log(`  带 defGaps : ${withGaps.length} 个单位（机器转换还没吃下的部分，见产物里的 defGaps）`);
  return 0;
}

/**
 * `convert-defs` 命令：**真跑 Lua → 我们的 def**（批量转换），写 `data/units.def.gen.json`。
 *
 * 与 `emit-defs` 的分工：
 *
 * | 文件 | 谁写的 | 内容 |
 * | --- | --- | --- |
 * | `data/units.def.gen.json` | **机器**（本命令） | 全部单位的机械 def + 每个单位**没转出来的东西**（`gaps`） |
 * | `data/units.def.json` | `emit-defs` | 展示三件套 + def（**手写的优先**，机器转换的兜底） |
 *
 * 值全部来自 `extractAll` 的原始 `config`（wasmoon 真跑 Lua），锚点扫**同一份 Lua 原文**
 * （值对不上就不写行号，见 `core/src/convert/unit-def.ts`）。
 */
async function runConvertDefs(input: string, values: Record<string, unknown>): Promise<number> {
  const dataDir = values.out ? resolve(String(values.out)) : DEFAULT_DATA;
  const pb = values.pb ? resolve(String(values.pb)) : resolve(REPO_ROOT, DEFAULT_PB_REL);

  const result = await extractAll({
    input: resolve(input),
    gameConfigPb: pb,
    onError: values.strict ? "raise" : "warn",
  });

  const defs: Record<string, UnitDefJson> = {};
  const gaps: Record<string, string[]> = {};
  const patched: Record<string, string[]> = {};
  const patchNotes: Record<string, string> = {};
  let anchors = 0;
  let gapCount = 0;
  const byKind = new Map<string, number>();
  let warheadCount = 0;

  /**
   * 挂件 Lua 的原文缓存 —— 弹头分类要看它那次调用（`AoeDamageSquad*` 之类）。
   *
   * ⚠️ `result.root` 是**脚本根**（`…/scripts`），挂件在它下面的 `gameplay/modifiers|abilities/`。
   * 两处都要找：`projectile.modifier` 大多在 `modifiers/`，泰坦那种 `modifier_shot` 是
   * `ability_titan_energy_shot`（在 `abilities/`）。
   */
  const modifierCache = new Map<string, string | undefined>();
  const modifierText = (name: string): string | undefined => {
    if (!modifierCache.has(name)) {
      let text: string | undefined;
      for (const dir of ["modifiers", "abilities", "common", "auras"]) {
        try {
          text = readFileSync(join(result.root, "gameplay", dir, `${name}.lua`), "utf8");
          break;
        } catch {
          /* 换下一个目录 */
        }
      }
      modifierCache.set(name, text);
    }
    return modifierCache.get(name);
  };

  // 格子效果表（火 / 毒气的每跳伤害与持续）—— 提取器已收进 `data/units.json` 顶层 `auras`
  let auras: Record<string, { tickMs?: number; tickDamage?: number; persistMs?: number; vs?: Array<[string, number]>; immune?: string[]; groundOnly?: boolean }> = {};
  try {
    const product = JSON.parse(await readFile(join(dataDir, "units.json"), "utf8")) as {
      auras?: Record<string, { tick_ms?: number; tick_damage?: number; persist_ms?: number; vs?: Record<string, number>; immune?: string[]; ground_only?: boolean }>;
    };
    for (const [name, a] of Object.entries(product.auras ?? {})) {
      auras[name] = {
        ...(a.tick_ms === undefined ? {} : { tickMs: a.tick_ms }),
        ...(a.tick_damage === undefined ? {} : { tickDamage: a.tick_damage }),
        ...(a.persist_ms === undefined ? {} : { persistMs: a.persist_ms }),
        // ⚠️ `TileEffectDef.vs` 的键是**目标身上的标签**（`override_vehicle`），
        // 而 `auras` 表里写的是 `DamageOverride.X` 的名字（`Vehicle`）—— 在这里正名
        ...(a.vs === undefined
          ? {}
          : { vs: Object.entries(a.vs).map(([tag, v]) => [tag.startsWith("override_") ? tag : `override_${tag.toLowerCase()}`, v] as [string, number]) }),
        ...(a.immune === undefined ? {} : { immune: a.immune }),
        ...(a.ground_only === undefined ? {} : { groundOnly: a.ground_only }),
      };
    }
  } catch {
    console.log("提示：读不到 data/units.json 的 auras（格子效果的数值会缺）");
  }

  for (const unit of result.units) {
    const luaPath = join(result.root, unit.source);
    let text: string;
    try {
      text = await readFile(luaPath, "utf8");
    } catch {
      gaps[unit.id] = [`读不到源码 ${unit.source} ⇒ 锚点全缺`];
      const { def } = convertUnit(unit, "");
      defs[unit.id] = encodeDef(def);
      gapCount += 1;
      continue;
    }
    const { def, gaps: unitGaps } = convertUnit(unit, text, { modifierText, auras });
    /*
     * **手写 patch 在"造 def"这一步就叠上**（不是等 emit）—— 否则 `gen` 与最终产物会有两个真相。
     * 命中路径与理由一起写进产物，页面/`convert-check` 都从产物里读。
     */
    const { def: patchedDef, patched: paths, note } = patchDefJson(unit.id, encodeDef(def));
    defs[unit.id] = patchedDef;
    if (paths.length) {
      patched[unit.id] = paths;
      if (note !== undefined) patchNotes[unit.id] = note;
    }
    if (unitGaps.length) gaps[unit.id] = unitGaps;
    gapCount += unitGaps.length;
    anchors += (def.source?.anchors?.length ?? 0) + def.combatant.weapons.reduce((n, w) => n + w.source.anchors.length, 0);
    for (const w of def.combatant.weapons) {
      byKind.set(w.timing.kind, (byKind.get(w.timing.kind) ?? 0) + 1);
      if (w.warhead !== undefined && w.warhead.length > 0) warheadCount++;
    }
  }

  const file = {
    _note:
      "机器批量转换的机械 def（`rivals convert-defs`）—— 源：真跑 Lua 的 config + 扫 Lua 原文定锚点。" +
      "`gaps` 里是这个单位**没转出来**的东西（见 core/src/convert/unit-def.ts）。" +
      "读取要过 decodeDef()。",
    _schema: DEF_SCHEMA,
    _stats: {
      units: Object.keys(defs).length,
      anchors,
      gaps: gapCount,
      timingKinds: Object.fromEntries(byKind),
      warheadWeapons: warheadCount,
      deployUnits: result.units.filter((u) => defs[u.id] && (defs[u.id] as UnitDefJson).deploy !== undefined).length,
    },
    units: defs,
    gaps,
    patched,
    patchNotes,
  };
  const outPath = join(dataDir, "units.def.gen.json");
  await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");

  console.log(`写出       : ${outPath}`);
  console.log(`单位       : ${Object.keys(defs).length} 个 · 锚点 ${anchors} 条 · 待办(gaps) ${gapCount} 条`);
  console.log(`节奏分布   : ${[...byKind].map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  console.log(`带弹头     : ${warheadCount} 把武器`);
  const patchedCount = Object.keys(patched).length;
  if (patchedCount) console.log(`手写 patch : ${patchedCount} 个单位（${Object.keys(patched).join(", ")}）`);
  const deployCount = result.units.filter((u) => defs[u.id] && (defs[u.id] as UnitDefJson).deploy !== undefined).length;
  console.log(`可部署     : ${deployCount} 个`);
  const worst = Object.entries(gaps).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  if (worst.length) {
    console.log("gaps 最多的 5 个：");
    for (const [id, list] of worst) console.log(`  ${id.padEnd(30)} ${list.length} 条（例：${list[0]?.slice(0, 70)}）`);
  }
  return 0;
}

/** extract 命令：提取并写出。返回进程退出码。 */
async function runExtract(input: string, values: Record<string, unknown>): Promise<number> {
  // 默认值相对仓库根解析；显式给出的路径按 cwd 解析（符合直觉）
  const outDir = values.out ? resolve(String(values.out)) : DEFAULT_DATA;
  const pb = values.pb ? resolve(String(values.pb)) : resolve(REPO_ROOT, DEFAULT_PB_REL);

  const result = await extractAll({
    input: resolve(input),
    gameConfigPb: pb,
    onError: values.strict ? "raise" : "warn",
  });

  const written = await writeAll(result, { outDir });

  const gdi = result.units.filter((u) => u.faction === "GDI").length;
  const nod = result.units.filter((u) => u.faction === "NOD").length;
  const warned = result.units.filter((u) => u.warnings?.length).length;
  const withPb = result.units.filter((u) => u.pb).length;

  console.log(`脚本根目录 : ${result.root}`);
  console.log(`输出目录   : ${outDir}`);
  console.log(`单位       : ${result.units.length} 个（GDI ${gdi} / NOD ${nod}）`);
  console.log(`指挥官     : ${result.commanders.length} 个`);
  console.log(`带稀有度   : ${withPb} 个`);
  console.log(`写出文件   : ${written.length} 个`);
  console.log(`带告警     : ${warned} 个`);
  if (result.skippedModules.length) {
    console.log(`跳过的模块 : ${result.skippedModules.length} 个`);
    for (const s of result.skippedModules.slice(0, 5)) console.log(`  - ${s}`);
  }
  if (result.failures.length) {
    console.log(`求值失败   : ${result.failures.length} 个`);
    for (const [id, err] of result.failures.slice(0, 10)) console.log(`  ! ${id}: ${err.slice(0, 140)}`);
  }
  const byRarity = new Map<string, number>();
  for (const u of result.units) {
    const r = u.pb?.rarity ?? "(无)";
    byRarity.set(r, (byRarity.get(r) ?? 0) + 1);
  }
  console.log(`稀有度分布 : ${[...byRarity].map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      data: { type: "string" },
      out: { type: "string" },
      pb: { type: "string" },
      strict: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return positionals.length === 0 && !values.help ? 2 : 0;
  }

  const dataDir = values.data ? resolve(values.data) : DEFAULT_DATA;
  const [command, ...rest] = positionals;

  try {
    if (command === "extract") {
      const input = rest[0];
      if (!input) {
        console.error("错误：需要指定输入目录，例如 extract tmp/com.ea.gp.candcwarzones");
        return 2;
      }
      return await runExtract(input, values as Record<string, unknown>);
    }

    if (command === "emit-defs") return await runEmitDefs(dataDir);

    if (command === "convert-defs") {
      const input = rest[0];
      if (!input) {
        console.error("错误：需要指定输入目录，例如 convert-defs tmp/com.ea.gp.candcwarzones");
        return 2;
      }
      return await runConvertDefs(input, values as Record<string, unknown>);
    }

    const index = await loadIndex(dataDir);

    switch (command) {
      case "list": {
        if (values.json) {
          console.log(JSON.stringify(index, null, 2));
        } else {
          console.log(`${index.unit_count} 个单位（GDI ${index.gdi_count} / NOD ${index.nod_count}）\n`);
          for (const u of index.units) console.log(row(u));
        }
        return 0;
      }

      case "counter": {
        const tag = rest[0];
        if (!tag) {
          console.error("错误：需要指定类型，例如 counter Aircraft");
          return 2;
        }
        if (!isDamageOverrideTag(tag)) {
          console.error(`错误：未知类型 ${tag}。可用：${DAMAGE_TARGETS.join(" / ")}`);
          return 2;
        }
        const hits = targetingIntent(index, tag);
        if (values.json) console.log(JSON.stringify(hits, null, 2));
        else {
          console.log(
            `标注针对 ${tag} 的单位：${hits.length} 个\n` +
              `⚠ 这是 AI 索敌偏好，不是伤害克制。真实伤害看 damageTuning.overrides。\n`,
          );
          for (const u of hits) console.log(row(u));
        }
        return 0;
      }

      case "cheap": {
        const max = Number(rest[0]);
        if (!Number.isFinite(max)) {
          console.error("错误：需要指定造价上限，例如 cheap 30");
          return 2;
        }
        const hits = cheaperThan(index, max);
        if (values.json) console.log(JSON.stringify(hits, null, 2));
        else {
          console.log(`造价 <= ${max} 的单位：${hits.length} 个\n`);
          for (const u of hits) console.log(row(u));
        }
        return 0;
      }

      case "damage": {
        const [unitId, targetTag] = rest;
        if (!unitId || !targetTag) {
          console.error("错误：用法 damage <unit_id> <目标类型>");
          return 2;
        }
        const unit = await loadUnitConfig(dataDir, unitId);
        const weapons = unit.config?.combatantTuning?.weaponTunings;
        if (!Array.isArray(weapons) || weapons.length === 0) {
          console.error(`错误：${unitId} 没有武器`);
          return 1;
        }
        const dt = weapons[0]?.damageTuning;
        const amount = pickDamage(
          [targetTag],
          dt?.overrides?.map(([tag, damage]: [string, number]) => ({ tag, damage })),
          dt?.default ?? 0,
        );
        if (values.json) console.log(JSON.stringify({ unit_id: unitId, target: targetTag, damage: amount }));
        else console.log(`${unitId} 对 ${targetTag} 的伤害：${amount}（无覆写时即 default）`);
        return 0;
      }

      default:
        console.error(`未知命令：${command}\n`);
        console.error(USAGE);
        return 2;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`错误：${msg}`);
    if (err instanceof RivalsError) return 2;
    if (msg.includes("ENOENT")) {
      console.error(`提示：找不到数据目录 ${dataDir}。先运行 rivals extract <游戏数据目录>。`);
    }
    return 1;
  }
}

process.exit(await main());

