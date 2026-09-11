/**
 * 数据加载与缓存。
 *
 * 数据源是构建时从仓库根 `data/` 复制到 `public/data/` 的静态 JSON。
 *
 * ⚠️ **只有一个文件 `data/units.json`**（约 170 KB），含全部单位与指挥官。
 * 每条只有**解析好的内容**（`derived`）—— 没有原始 `config` 树。
 * 一次拉取、按 id 查表，不再按 id 发请求。
 *
 * 这里刻意不做顶层 await —— 让 `loadDataset()` 由 App 的挂载流程调用，
 * 加载失败时页面能给出提示而不是整站白屏。
 */

import {
  allEntries,
  findEntry,
  type Dataset,
  type DatasetEntry,
} from "@rivals/core/derive";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LoadedData {
  dataset: Dataset;
  /** 单位 + 指挥官的全部条目 */
  all: DatasetEntry[];
  /** id → 条目 */
  byId: Map<string, DatasetEntry>;
}

let cache: Promise<LoadedData> | null = null;

/** 加载数据集（只请求一次，之后走缓存）。 */
export function loadDataset(): Promise<LoadedData> {
  cache ??= fetchJson<Dataset>("data/units.json").then((dataset) => {
    const all = allEntries(dataset);
    return { dataset, all, byId: new Map(all.map((e) => [e.id, e])) };
  });
  return cache;
}

export function findEntryById(data: LoadedData, id: string): DatasetEntry | undefined {
  return data.byId.get(id) ?? findEntry(data.dataset, id);
}

export function isCommander(data: LoadedData, id: string): boolean {
  return data.dataset.commanders.some((c) => c.id === id);
}
