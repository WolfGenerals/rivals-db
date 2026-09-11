#!/usr/bin/env node
/**
 * 命令行：提取游戏数据，以及查询 data/ 下的产物。
 *
 * 提取（`extract`）执行游戏 Lua 调参脚本 + 解析 game-config.pb；
 * 查询（`list` / `counter` / ...）只读 data/，共享逻辑来自 @rivals/core。
 */
import { readFile } from "node:fs/promises";
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

