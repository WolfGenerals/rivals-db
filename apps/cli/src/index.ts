#!/usr/bin/env node
/**
 * 命令行：查询 data/ 下的提取产物。
 *
 * 这里刻意**不**调用 Python —— Python 只负责从 Lua 提取（离线跑一次），
 * 日常查询由这个 CLI 在 data/ 上完成。共享逻辑来自 @rivals/core。
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { cheaperThan, counters, pickDamage, type UnitIndex, type UnitSummary } from "@rivals/core";

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/cli/src/ -> 上溯 3 级到仓库根
const REPO_ROOT = resolve(HERE, "../../..");
const DEFAULT_DATA = join(REPO_ROOT, "data");

const USAGE = `
用法: rivals <命令> [选项]

命令:
  list                     列出全部单位
  counter <类型>           列出克制指定类型的单位（Infantry|Vehicle|Aircraft|Structure）
  cheap <造价>             列出造价不超过指定值的单位
  damage <单位> <目标类型> 计算某单位对目标类型的伤害

选项:
  --data <目录>            数据目录（默认仓库根的 data/）
  --json                   以 JSON 输出
  -h, --help               显示帮助

例子:
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
  const faction = unitId.includes("_gdi_") ? "gdi" : unitId.includes("_nod_") ? "nod" : "misc";
  const raw = await readFile(join(dataDir, faction, `${unitId}.json`), "utf8");
  return JSON.parse(raw);
}

function row(u: UnitSummary): string {
  const hp = u.health ?? "-";
  const cost = u.cost ?? "-";
  const dmg = u.damage ?? "-";
  return `${u.unit_id.padEnd(34)} ${u.faction.padEnd(4)} HP ${String(hp).padStart(5)}  造价 ${String(cost).padStart(4)}  伤害 ${String(dmg).padStart(5)}`;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      data: { type: "string" },
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
        const hits = counters(index, tag);
        if (values.json) console.log(JSON.stringify(hits, null, 2));
        else {
          console.log(`克制 ${tag} 的单位：${hits.length} 个\n`);
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
        else console.log(`${unitId} 对 ${targetTag} 的伤害：${amount}（0 表示无覆写，值为 default）`);
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
    if (msg.includes("ENOENT")) {
      console.error(`提示：找不到数据目录 ${dataDir}。先运行 reference/ 里的提取器生成 data/。`);
    }
    return 1;
  }
}

process.exit(await main());
