/**
 * game-config.pb 的最小 wire-format 解码器 + 常用查询。
 *
 * 文件是裸 protobuf（无 .proto 定义），所以只能按 wire format 手工解析。
 * 本脚本只依赖 node:buffer，不引入 protobuf 库。
 *
 * 用法：
 *   node tools/pb-probe.mjs <game-config.pb> [命令]
 *
 * 命令：
 *   shape            顶层字段形状
 *   units            全部单位的稀有度 / Lua 名
 *   faction <名字>   展开某个 Faction_Info_* 条目
 *   find <数字>      搜索某个 varint 值
 *   path <$.a.b.c>   展开指定路径
 *
 * 已确证的关键路径见 docs/data-semantics.md 第 7 节。
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// ── 解码核心 ──────────────────────────────────────────────────────

/** 读 varint，返回 [BigInt, 新偏移]；越界返回 null */
export function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  while (p < buf.length) {
    const byte = buf[p++];
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [result, p];
    shift += 7n;
    if (shift > 70n) return null;
  }
  return null;
}

/** 解一层字段。所有 wire 类型都做边界检查，越界即停（不抛异常）。 */
export function decodeFields(buf, start = 0, end = buf.length) {
  const out = [];
  let p = start;
  while (p < end) {
    const kv = readVarint(buf, p);
    if (!kv) break;
    let [key, np] = kv;
    p = np;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) break;
    if (wire === 0) {
      const t = readVarint(buf, p);
      if (!t) break;
      p = t[1];
      out.push({ field, wire, value: t[0] });
    } else if (wire === 2) {
      const t = readVarint(buf, p);
      if (!t) break;
      p = t[1];
      const n = Number(t[0]);
      if (n < 0 || p + n > end) break;
      out.push({ field, wire, raw: buf.subarray(p, p + n) });
      p += n;
    } else if (wire === 1) {
      if (p + 8 > end) break;
      out.push({ field, wire, value: buf.readDoubleLE(p) });
      p += 8;
    } else if (wire === 5) {
      if (p + 4 > end) break;
      out.push({ field, wire, value: buf.readFloatLE(p) });
      p += 4;
    } else break; // 不支持的 wire 类型，停止
  }
  return out;
}

/** 若 raw 是可打印 ASCII，返回字符串，否则 null。设长度上限避免把二进制当字符串。 */
export function asString(raw, maxLen = 120) {
  if (!raw || raw.length === 0 || raw.length > maxLen) return null;
  for (const c of raw) if (c < 0x20 || c >= 0x7f) return null;
  return raw.toString("latin1");
}

export const first = (fields, n) => fields.find((f) => f.field === n);
export const sub = (fields, n) => {
  const f = first(fields, n);
  return f && f.wire === 2 ? decodeFields(f.raw, 0, f.raw.length) : null;
};

// ── 已确证的路径常量 ──────────────────────────────────────────────

export const PATH = {
  /** 条目容器：每个单位/Faction 是一个 field 55 条目 */
  ITEM_CONTAINER: 55,
  /** 条目内：1 = 标识名 */
  ITEM_NAME: 1,
  /** 条目内：2 = 负载 */
  ITEM_PAYLOAD: 2,
  /** 单位条目负载内：19 = Lua 全局名（unit_gdi_riflemen） */
  UNIT_LUA_NAME: 19,
  /** 单位条目负载内：3 = 稀有度组 */
  UNIT_RARITY_GROUP: 3,
  /** 稀有度组内：1 = unitCommon / unitRare / unitEpic；2 = 编号 1/2/3 */
  RARITY_NAME: 1,
  RARITY_INDEX: 2,
  /** Faction 条目负载内：16 = factionInformationComponent */
  FACTION_COMPONENT: 16,
  /** factionInformationComponent 内：7 = standardBaseHealth */
  FACTION_BASE_HEALTH: 7,
};

export const RARITY_BY_INDEX = { 1: "Common", 2: "Rare", 3: "Epic" };

/**
 * 抽取全部单位的稀有度。
 * @returns {Array<{name: string, luaName: string, rarity: string, rarityIndex: number|null}>}
 */
export function extractUnits(buf) {
  const out = [];
  for (const entry of decodeFields(buf).filter((f) => f.field === PATH.ITEM_CONTAINER)) {
    const head = decodeFields(entry.raw, 0, entry.raw.length);
    const name = asString(first(head, PATH.ITEM_NAME)?.raw);
    if (!name || !/^Unit_/.test(name)) continue;
    const payload = sub(head, PATH.ITEM_PAYLOAD);
    if (!payload) continue;
    const group = sub(payload, PATH.UNIT_RARITY_GROUP);
    const idxField = group ? first(group, PATH.RARITY_INDEX) : null;
    const rarityIndex = idxField ? Number(idxField.value) : null;
    out.push({
      name,
      luaName: asString(first(payload, PATH.UNIT_LUA_NAME)?.raw) ?? "",
      rarity: rarityIndex ? (RARITY_BY_INDEX[rarityIndex] ?? `#${rarityIndex}`) : "",
      rarityIndex,
    });
  }
  return out;
}

/** 起始 major 等级 = 2r-1（r 为稀有度编号）。经验式，见文档。 */
export const startingMajor = (rarityIndex) => (rarityIndex ? 2 * rarityIndex - 1 : null);

/** 递归收集所有「值为 target 的 varint」的路径。 */
export function findVarint(buf, target, { maxDepth = 7, limit = 200 } = {}) {
  const hits = [];
  const want = BigInt(target);
  (function walk(start, end, path, depth) {
    if (depth > maxDepth || hits.length >= limit) return;
    for (const f of decodeFields(buf, start, end)) {
      if (f.wire === 0) {
        if (f.value === want) hits.push(`${path}.${f.field}`);
      } else if (f.wire === 2 && !asString(f.raw) && hits.length < limit) {
        walk(0, f.raw.length, `${path}.${f.field}`, depth + 1);
      }
    }
  })(0, buf.length, "$", 0);
  return hits;
}

/** 顶层某字段的全部条目，返回 [{index, fields}] */
export function topEntries(buf, field) {
  return decodeFields(buf)
    .filter((f) => f.field === field)
    .map((f, index) => ({ index, fields: decodeFields(f.raw, 0, f.raw.length) }));
}

// ── CLI ───────────────────────────────────────────────────────────

async function main() {
  const [file, command = "shape", ...args] = process.argv.slice(2);
  if (!file) {
    console.error("用法: node tools/pb-probe.mjs <game-config.pb> [shape|units|faction|find|path]");
    return 2;
  }
  const buf = await readFile(file);

  if (command === "shape") {
    const counts = new Map();
    for (const f of decodeFields(buf)) counts.set(f.field, (counts.get(f.field) ?? 0) + 1);
    console.log(`顶层字段 ${counts.size} 种，共 ${[...counts.values()].reduce((a, b) => a + b, 0)} 个`);
    for (const [k, n] of [...counts].sort((a, b) => a[0] - b[0])) {
      console.log(`  field ${String(k).padStart(4)}  ×${n}`);
    }
    return 0;
  }

  if (command === "units") {
    const units = extractUnits(buf);
    const byRarity = new Map();
    for (const u of units) {
      if (!byRarity.has(u.rarity)) byRarity.set(u.rarity, []);
      byRarity.get(u.rarity).push(u);
    }
    console.log(`单位条目 ${units.length} 个`);
    for (const [r, list] of [...byRarity].sort((a, b) => b[1].length - a[1].length)) {
      const idx = list[0].rarityIndex;
      console.log(`\n=== ${r || "(无稀有度)"}  起始 major ${startingMajor(idx) ?? "-"}  (${list.length}) ===`);
      console.log("  " + list.map((u) => u.luaName.replace(/^unit_/, "")).join(", "));
    }
    return 0;
  }

  if (command === "faction") {
    const want = args[0] ?? "Faction_Info_GDI";
    for (const e of topEntries(buf, PATH.ITEM_CONTAINER)) {
      if (asString(first(e.fields, PATH.ITEM_NAME)?.raw) !== want) continue;
      const payload = sub(e.fields, PATH.ITEM_PAYLOAD);
      const comp = sub(payload, PATH.FACTION_COMPONENT);
      const health = first(comp, PATH.FACTION_BASE_HEALTH);
      console.log(`${want}: standardBaseHealth = ${health?.value}`);
      for (const f of comp) {
        const s = asString(f.raw);
        console.log(`  .${f.field} = ${s !== null ? `"${s}"` : f.wire === 0 ? f.value : `<${f.raw.length}B>`}`);
      }
    }
    return 0;
  }

  if (command === "find") {
    const hits = findVarint(buf, Number(args[0]));
    console.log(`varint ${args[0]}: ${hits.length} 处`);
    for (const h of hits.slice(0, 40)) console.log("  " + h);
    return 0;
  }

  if (command === "path") {
    const parts = args[0].split(".").filter(Boolean).map((s) => Number(s.replace("$", "")));
    let cur = buf;
    let path = "$";
    for (const p of parts) {
      const f = first(decodeFields(cur, 0, cur.length), p);
      if (!f) { console.error(`路径 ${path}.${p} 不存在`); return 1; }
      path += `.${p}`;
      if (f.wire !== 2) { console.log(`${path} = ${f.value}`); return 0; }
      cur = f.raw;
    }
    const fields = decodeFields(cur, 0, cur.length);
    console.log(`${path}  (${cur.length}B, ${fields.length} 字段)`);
    for (const f of fields) {
      const s = asString(f.raw);
      console.log(`  .${f.field} = ${s !== null ? `"${s}"` : f.wire === 0 ? f.value : `<${f.raw.length}B>`}`);
    }
    return 0;
  }

  console.error(`未知命令: ${command}`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
