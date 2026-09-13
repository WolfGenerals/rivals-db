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

import { applyPatch, type PatchFile } from "./patch.ts";
import { loadDefs, type LoadedDefs } from "./defs.ts";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** patch 文件**不是必需**的：没有就当作空（404 不算错误） */
async function fetchPatch(): Promise<PatchFile | null> {
  try {
    const res = await fetch("data/units.patch.json");
    if (!res.ok) return null;
    return (await res.json()) as PatchFile;
  } catch {
    return null;
  }
}

export interface LoadedData {
  dataset: Dataset;
  /** 单位 + 指挥官的全部条目 */
  all: DatasetEntry[];
  /** id → 条目 */
  byId: Map<string, DatasetEntry>;
  /**
   * **被 `data/units.patch.json` 覆盖过的路径**（`unit_x.derived.stats.…`）。
   *
   * 界面可以据此标出"这条是手填的、不是提取出来的"——见 `patch.ts` 的说明。
   */
  patchedPaths: Set<string>;
  /** 有手写修正的单位 id */
  patchedIds: string[];
  /**
   * **新格式：单位 def**（`data/units.def.json`）—— 单位数据的**真相来源**。
   *
   * `dataset` 那份旧产物只剩**非单位数据**（本地化 / 图标 / 稀有度 / `auras`）。
   * 用法：`data.defs.byId.get(entry.id)`（`Damage` 已是实例，能直接算伤害）。
   */
  defs: LoadedDefs;
}

let cache: Promise<LoadedData> | null = null;

/** 加载数据集（只请求一次，之后走缓存）。 */
export function loadDataset(): Promise<LoadedData> {
  cache ??= Promise.all([fetchJson<Dataset>("data/units.json"), fetchPatch(), loadDefs()]).then(
    ([raw, patch, defs]) => {
      /*
       * **手写补丁在读取侧合并**（用户的想法："分成 unit.json 和 unit.patch.json"）。
       * 产物不动、提取器不动；空 patch 时行为与没有这层时**完全一致**。
       * 模拟器与页面拿到的都是这个合并结果 —— 否则会出现"改了 patch 却没生效"。
       */
      const { data: dataset, patchedPaths, ids } = applyPatch(raw, patch);
      const all = allEntries(dataset);
      return {
        dataset,
        all,
        byId: new Map(all.map((e) => [e.id, e])),
        patchedPaths,
        patchedIds: ids,
        defs,
      };
    },
  );
  return cache;
}

export function findEntryById(data: LoadedData, id: string): DatasetEntry | undefined {
  return data.byId.get(id) ?? findEntry(data.dataset, id);
}

export function isCommander(data: LoadedData, id: string): boolean {
  return data.dataset.commanders.some((c) => c.id === id);
}
