/**
 * `files/game-config.pb` 的最小 protobuf wire-format 解码器。
 *
 * 这个文件是**裸 protobuf**（随包没有 `.proto` 定义），所以只能按 wire format
 * 手工解析。只依赖 node:buffer，不引入 protobuf 库。
 *
 * 从中取的是 **Lua 源码里拿不到** 的数据：
 * - 每个单位的稀有度 → 起始等级
 * - 阵营的基地血量 / 矿车单位名
 *
 * 已确证的路径见 docs/data-semantics.md 第 7 节。
 */

import { startingMajor } from "../levels.ts";

// ── wire format 原语 ──────────────────────────────────────────────

/** 读 varint，返回 [值, 新偏移]；越界或过长返回 null。 */
export function readVarint(buf: Buffer, pos: number): [bigint, number] | null {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  while (p < buf.length) {
    const byte = buf[p++]!;
    result |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [result, p];
    shift += 7n;
    if (shift > 70n) return null;
  }
  return null;
}

export type WireField =
  | { field: number; wire: 0; value: bigint }
  | { field: number; wire: 2; raw: Buffer }
  | { field: number; wire: 1; value: number }
  | { field: number; wire: 5; value: number };

/**
 * 解一层字段。
 *
 * 所有 wire 类型都做边界检查，越界即停（不抛异常）——因为这是
 * 无 schema 的解析，遇到非预期数据时「停下来」比「崩掉」有用。
 */
export function decodeFields(buf: Buffer, start = 0, end = buf.length): WireField[] {
  const out: WireField[] = [];
  let p = start;
  while (p < end) {
    const kv = readVarint(buf, p);
    if (!kv) break;
    const [key, afterKey] = kv;
    p = afterKey;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (field === 0) break;

    if (wire === 0) {
      const t = readVarint(buf, p);
      if (!t) break;
      p = t[1];
      out.push({ field, wire: 0, value: t[0] });
    } else if (wire === 2) {
      const t = readVarint(buf, p);
      if (!t) break;
      p = t[1];
      const n = Number(t[0]);
      if (n < 0 || p + n > end) break;
      out.push({ field, wire: 2, raw: buf.subarray(p, p + n) });
      p += n;
    } else if (wire === 1) {
      if (p + 8 > end) break;
      out.push({ field, wire: 1, value: buf.readDoubleLE(p) });
      p += 8;
    } else if (wire === 5) {
      if (p + 4 > end) break;
      out.push({ field, wire: 5, value: buf.readFloatLE(p) });
      p += 4;
    } else break; // 不支持的 wire 类型（group 等），停止
  }
  return out;
}

/** raw 若是可打印 ASCII 则返回字符串，否则 null。长度上限避免把二进制当字符串。 */
export function asString(raw: Buffer | undefined, maxLen = 120): string | null {
  if (!raw || raw.length === 0 || raw.length > maxLen) return null;
  for (const c of raw) if (c < 0x20 || c >= 0x7f) return null;
  return raw.toString("latin1");
}

export const firstField = (fields: WireField[], n: number): WireField | undefined =>
  fields.find((f) => f.field === n);

/** 取某字段作为嵌套消息再解一层；不是 wire=2 则返回 null。 */
export function subFields(fields: WireField[], n: number): WireField[] | null {
  const f = firstField(fields, n);
  return f && f.wire === 2 ? decodeFields(f.raw, 0, f.raw.length) : null;
}

const varintValue = (fields: WireField[], n: number): number | null => {
  const f = firstField(fields, n);
  return f && f.wire === 0 ? Number(f.value) : null;
};

const stringValue = (fields: WireField[], n: number): string | null =>
  asString((firstField(fields, n) as { raw?: Buffer } | undefined)?.raw);

// ── 已确证的路径 ──────────────────────────────────────────────────

export const PB_PATH = {
  /** 条目容器：每个单位/Faction 都是它的一个条目，条目形如 { 1: 名称, 2: 负载 } */
  ITEM_CONTAINER: 55,
  ITEM_NAME: 1,
  ITEM_PAYLOAD: 2,
  /** 单位条目负载 */
  UNIT_LUA_NAME: 19,
  UNIT_RARITY_GROUP: 3,
  /** 稀有度组 */
  RARITY_NAME: 1,
  RARITY_INDEX: 2,
  /** Faction 条目负载 */
  FACTION_COMPONENT: 16,
  FACTION_BASE_HEALTH: 7,
} as const;

export const RARITY_BY_INDEX: Record<number, string> = {
  1: "Common",
  2: "Rare",
  3: "Epic",
};

export interface PbUnit {
  /** pb 内的标识名，如 `Unit_Gdi_Riflemen` */
  name: string;
  /** Lua 全局名，如 `unit_gdi_riflemen`；可对应源文件名 */
  luaName: string;
  /** 稀有度名；无稀有度（采集车/建筑等）时为空串 */
  rarity: string;
  /** 稀有度编号 1/2/3；缺失为 null */
  rarityIndex: number | null;
  /** 起始 major 等级 = 2r-1；无稀有度时为 null */
  startMajor: number | null;
}

export interface PbFaction {
  name: string;
  /** factionInformationComponent */
  component: {
    standardBaseHealth: number | null;
    harvesterUnitName: string | null;
    conYard: string | null;
    protoPad: string | null;
  };
}

/**
 * 起始 major 等级 = 2 × 稀有度编号 − 1（定义在 `../levels.ts`）。
 * 这里 re-export 方便 pb 模块的使用者。
 */
export { startingMajor };

/** 抽取全部单位的稀有度与起始等级。 */
export function extractPbUnits(buf: Buffer): PbUnit[] {
  const out: PbUnit[] = [];
  for (const entry of decodeFields(buf)) {
    if (entry.field !== PB_PATH.ITEM_CONTAINER || entry.wire !== 2) continue;
    const head = decodeFields(entry.raw, 0, entry.raw.length);
    const name = stringValue(head, PB_PATH.ITEM_NAME);
    if (!name || !/^Unit_/.test(name)) continue;

    const payload = subFields(head, PB_PATH.ITEM_PAYLOAD);
    if (!payload) continue;
    const group = subFields(payload, PB_PATH.UNIT_RARITY_GROUP);
    const rarityIndex = group ? varintValue(group, PB_PATH.RARITY_INDEX) : null;

    out.push({
      name,
      luaName: stringValue(payload, PB_PATH.UNIT_LUA_NAME) ?? "",
      rarity: rarityIndex === null ? "" : (RARITY_BY_INDEX[rarityIndex] ?? `#${rarityIndex}`),
      rarityIndex,
      startMajor: startingMajor(rarityIndex),
    });
  }
  return out;
}

/** 抽取 Faction_Info_* 的关键信息。 */
export function extractPbFaction(buf: Buffer, want: string): PbFaction | null {
  for (const entry of decodeFields(buf)) {
    if (entry.field !== PB_PATH.ITEM_CONTAINER || entry.wire !== 2) continue;
    const head = decodeFields(entry.raw, 0, entry.raw.length);
    if (stringValue(head, PB_PATH.ITEM_NAME) !== want) continue;

    const payload = subFields(head, PB_PATH.ITEM_PAYLOAD);
    const comp = payload ? subFields(payload, PB_PATH.FACTION_COMPONENT) : null;
    if (!comp) continue;

    return {
      name: want,
      component: {
        standardBaseHealth: varintValue(comp, PB_PATH.FACTION_BASE_HEALTH),
        // 观察到的顺序：1=阵营、2=主基地、3=矿车、4=protoPad、5=proto、6=MCV、7=血量
        harvesterUnitName: stringValue(comp, 3),
        conYard: stringValue(comp, 2),
        protoPad: stringValue(comp, 4),
      },
    };
  }
  return null;
}
