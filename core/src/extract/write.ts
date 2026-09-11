/**
 * 把提取结果写成 JSON 产物。
 *
 * 布局：
 *   data/
 *   ├── index.json                        汇总索引，按造价升序（= 游戏内商店顺序）
 *   ├── unit/*.lua.json                   单位，文件名 = 源 Lua 文件名
 *   └── commander/*.lua.json              指挥官
 *
 * JSON 没有注释，所以把注意事项写进文件本身，避免脱离文档后误用。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { deriveAttack } from "../derive.ts";
import type { EntityRecord } from "./extract.ts";

export const FILE_NOTE =
  "combatantTuning.descriptors / weaponTunings[].descriptors 是位掩码占位值" +
  "（枚举定义在宿主 C++ 中，Lua 源码里没有），不要当作真实数值使用。" +
  "tags / goodAgainstTags 是枚举名字符串，语义正确。" +
  "注意 health 是每员血量，小队总血 = health × squadTuning.waveSize；" +
  "goodAgainstTags 是 AI 索敌偏好而非伤害加成，真实伤害见 damageTuning.overrides。";

export const INDEX_NOTE =
  "health 是每员血量，小队总血 = health × wave_size。start_major 为起始 major 等级" +
  "（= 2×稀有度编号−1，经验式）。damage 取第一件武器的基础伤害；" +
  "多武器单位 weapon_count > 1，具体伤害需读单位文件。" +
  "⚠ good_against 是 AI 索敌偏好，不是克制关系；真实克制看 damage_overrides。";

/** 按路径取值，容忍中途缺失。 */
function pick(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * 空容器归一成 undefined，好在概览里被省略。
 *
 * 原因：Lua 的空表无法区分「空数组」和「空字典」，提取时统一变成 `{}`。
 * 对扁平概览没有语义，留着会让消费者拿到 `{}` 却以为是数组
 * （真实踩过：`(u.good_against ?? []).includes is not a function`）。
 * 完整 config 树里仍保留 `{}`，那里要求保真。
 */
function nonEmptyArray(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v.length ? v : undefined;
  if (v !== null && typeof v === "object" && Object.keys(v as object).length === 0) return undefined;
  return v === undefined ? undefined : (v as unknown[]);
}

/** 给 index.json 用的扁平概览。 */
function summarize(rec: EntityRecord): Record<string, unknown> {
  const weapons = pick(rec.config, "combatantTuning", "weaponTunings");
  const first = Array.isArray(weapons) && weapons.length ? weapons[0] : undefined;

  const out: Record<string, unknown> = {
    id: rec.id,
    faction: rec.faction,
    variant: rec.variant,
  };
  const suffixes = rec.suffixes;
  if (suffixes?.length) out.suffixes = suffixes;

  const fields: Array<[string, unknown]> = [
    ["health", pick(rec.config, "combatantTuning", "health")],
    ["speed", pick(rec.config, "combatantTuning", "speed")],
    ["cost", pick(rec.config, "combatStoreTuning", "tiberiumCost")],
    ["damage", pick(first, "damageTuning", "default")],
    ["damage_overrides", pick(first, "damageTuning", "overrides")],
    ["range", pick(first, "maxRangeInTiles")],
    ["cooldown", pick(first, "burstTiming", "cooldown")],
    ["weapon_count", Array.isArray(weapons) && weapons.length ? weapons.length : undefined],
    ["tags", nonEmptyArray(pick(rec.config, "combatantTuning", "tags"))],
    ["good_against", nonEmptyArray(pick(rec.config, "combatantTuning", "goodAgainstTags"))],
    ["wave_size", pick(rec.config, "squadTuning", "waveSize")],
    ["vision_range", pick(rec.config, "squadTuning", "visionRangeInTiles")],
  ];
  for (const [key, value] of fields) {
    if (value !== undefined) out[key] = value;
  }
  if (rec.pb) {
    if (rec.pb.rarity) out.rarity = rec.pb.rarity;
    if (rec.pb.start_major !== undefined) out.start_major = rec.pb.start_major;
  }
  return out;
}

/**
 * 单个实体的输出载荷。
 *
 * **两块**：
 *   · `derived` —— 已决策的展示数据（武器 + 时序），**消费方只读这里**
 *   · `config`  —— 原始树，保留供审计与再推导，消费方不应解析
 *
 * 见 `docs/data-schema.md`。
 */
export function payloadFor(rec: EntityRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    _schema: 2,
    _note: FILE_NOTE,
    id: rec.id,
    faction: rec.faction,
    variant: rec.variant,
  };
  if (rec.suffixes?.length) out.suffixes = rec.suffixes;
  out.source = rec.source;
  if (rec.pb) out.pb = rec.pb;
  if (rec.visual) out.visual = rec.visual;
  if (rec.warnings?.length) out.warnings = rec.warnings;

  // 迁移：官方结构 → 我们的规范格式（武器 + 时序）
  const { weapons, attack, primary, dps, notes } = deriveAttack(rec);
  const cfg = rec.config;
  const wave = cfg.squadTuning?.waveSize ?? 1;
  const per = cfg.combatantTuning?.health;
  out.derived = {
    _note: "已按引擎算法算好的最终值。消费方只读这里，不要解析 config。",
    health:
      per === undefined
        ? undefined
        : { per_member: per, wave_size: wave, total: per * wave },
    dps: dps > 0 ? Number(dps.toFixed(4)) : null,
    squad: wave > 1 ? { wave_size: wave, member_offset_ms: attack.member_offset_ms } : undefined,
    weapons,
    attack,
    primary,
    notes,
  };

  out.config = rec.config;
  return out;
}

/**
 * 稳定的 JSON 文本。
 *
 * `sortKeys` 让字段顺序稳定（数值表没有固有序，Lua 表遍历顺序也不确定），
 * 从而保证多次运行逐字节一致，产物可 diff。
 */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/** index.json 的载荷（不含序列化）。 */
export function indexPayload(records: EntityRecord[]): Record<string, unknown> {
  const rows = records.map(summarize);
  rows.sort((a, b) => {
    const ca = asNumber(a.cost);
    const cb = asNumber(b.cost);
    if (ca === undefined && cb !== undefined) return 1;
    if (ca !== undefined && cb === undefined) return -1;
    if (ca !== cb) return (ca ?? 0) - (cb ?? 0);
    return String(a.id).localeCompare(String(b.id));
  });
  const count = (f: string) => records.filter((r) => r.faction === f).length;
  const out: Record<string, unknown> = {
    _note: INDEX_NOTE,
    unit_count: records.length,
    gdi_count: count("GDI"),
    nod_count: count("NOD"),
  };
  const misc = records.length - count("GDI") - count("NOD");
  if (misc) out.misc_count = misc;
  out.units = rows;
  return out;
}

export interface WriteOptions {
  /** 输出根目录，通常是仓库的 data/ */
  outDir: string;
}

/** 写出全部产物，返回写出的文件路径列表。 */
export async function writeAll(
  result: { units: EntityRecord[]; commanders: EntityRecord[]; factions: unknown[] },
  opts: WriteOptions,
): Promise<string[]> {
  const written: string[] = [];
  const write = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true });
    // newline: \n，避免在 Windows 上写出 CRLF 造成产物不稳定
    await writeFile(path, text.replace(/\r\n/g, "\n"), "utf8");
    written.push(path);
  };

  for (const [dir, records] of [
    ["unit", result.units],
    ["commander", result.commanders],
  ] as const) {
    for (const rec of records) {
      await write(join(opts.outDir, dir, `${rec.id}.lua.json`), stableJson(payloadFor(rec)));
    }
  }

  await write(join(opts.outDir, "index.json"), stableJson(indexPayload(result.units)));
  if (result.commanders.length) {
    await write(
      join(opts.outDir, "commander-index.json"),
      stableJson({
        _note: INDEX_NOTE,
        commander_count: result.commanders.length,
        factions: result.factions,
        commanders: result.commanders.map(summarize),
      }),
    );
  }
  return written;
}
