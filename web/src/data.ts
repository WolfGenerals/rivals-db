/**
 * 数据加载与缓存。
 *
 * 数据源是构建时从仓库根 `data/` 复制到 `public/data/` 的静态 JSON。
 * 索引在启动时加载一次；单位/指挥官详情按需加载并缓存。
 *
 * 这里刻意不做顶层 await —— 让 `loadIndex()` 由 App 的挂载流程调用，
 * 加载失败时页面能给出提示而不是整站白屏。
 */

import type { CommanderIndex, EntityRecord, UnitIndex, UnitSummary } from "@rivals/core/types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LoadedData {
  unitIndex: UnitIndex;
  /** 指挥官索引是可选的：只有单位数据时不该让整站挂掉 */
  commanderIndex: CommanderIndex | null;
  /** 单位 + 指挥官的全部概要（列表页用） */
  all: UnitSummary[];
}

export async function loadIndex(): Promise<LoadedData> {
  const [unitIndex, commanderIndex] = await Promise.all([
    fetchJson<UnitIndex>("data/index.json"),
    fetchJson<CommanderIndex>("data/commander-index.json").catch(() => null),
  ]);
  return {
    unitIndex,
    commanderIndex,
    all: [...unitIndex.units, ...(commanderIndex?.commanders ?? [])],
  };
}

export function findSummary(data: LoadedData, id: string): UnitSummary | undefined {
  return data.all.find((u) => u.id === id);
}

export function isCommander(data: LoadedData, id: string): boolean {
  return (data.commanderIndex?.commanders ?? []).some((c) => c.id === id);
}

const cache = new Map<string, Promise<EntityRecord | null>>();

/** 按 id 加载详情；失败返回 null（路由层会渲染「找不到」）。 */
export function loadRecord(id: string): Promise<EntityRecord | null> {
  let hit = cache.get(id);
  if (!hit) {
    const dir = id.startsWith("cmdr_") ? "commander" : "unit";
    hit = fetchJson<EntityRecord>(`data/${dir}/${id}.lua.json`).catch(() => null);
    cache.set(id, hit);
  }
  return hit;
}

let allCache: Promise<EntityRecord[]> | null = null;

/**
 * 一次把所有记录取回来（103 个文件，合计约 0.3 MiB）。
 *
 * 卡片只吃 `unit` + `level` 两个入参，所以需要**完整记录**（含武器配置，
 * 才能算准弹夹式武器的 DPS），不能只用 44 KiB 的索引概览。
 * 体积上完全划算，并发拉取即可。
 */
export function loadAllRecords(data: LoadedData): Promise<EntityRecord[]> {
  if (!allCache) {
    allCache = Promise.all(data.all.map((s) => loadRecord(s.id))).then((rs) =>
      rs.filter((r): r is EntityRecord => r !== null),
    );
  }
  return allCache;
}
