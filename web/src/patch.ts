/**
 * **手写补丁**（`data/units.patch.json`）—— 把"游戏里的事实"与"提取产物"分开。
 *
 * ## 为什么要这一层
 *
 * `data/units.json` 是**提取器的产物**（跑一遍 Lua 就有）。但有一类事实
 * **源码里读不出来**，只有玩过才知道，例如：
 *
 *   · 圣甲虫自爆**只销毁开火那一员**，不是全队
 *   · 壁虱坦克可以**不架设、边跑边打**（架设只是可选收益）
 *   · 毒车要**连续开打 2.1 秒**才铺得出毒气
 *
 * 之前这些是**写死在提取器/模拟器代码里的**，于是"发现一条事实 ⇒ 改一次代码"，
 * 改错还会连带弄坏别的东西。现在把它们挪进这份**手写** JSON：
 *
 * ```
 * data/units.json         ← 产物（可随时重跑覆盖）
 * data/units.patch.json   ← 手写（入库、按 id + 路径覆盖产物）
 * ```
 *
 * ## 规则（刻意做得极简，便于审查）
 *
 * 1. **按路径深合并**：只覆盖 patch 写到的叶子字段，其余一律以产物为准
 * 2. **对象递归合并；数组整体替换**（数组的"部分修改"语义不清，不如整条换掉）
 * 3. **空 patch（或文件不存在）= 现状**，保证可逆
 * 4. **覆盖过的路径记进 `patchedPaths`**，让界面能标出"这条是手填的"，不被误当成提取结果
 *
 * ⚠️ 模拟器与页面**一律读合并结果**——否则会出现"改了 patch 却没生效"这种最难查的问题。
 */

/** patch 文件里一条单位的覆盖内容（结构自由，按路径合并） */
export type UnitPatch = Record<string, unknown>;

export interface PatchFile {
  /** 可选的说明字段，读的时候忽略 */
  _note?: string;
  /** `id` → 覆盖片段 */
  units?: Record<string, UnitPatch>;
}

export interface PatchResult<T> {
  /** 合并后的数据 */
  data: T;
  /** 被 patch 覆盖到的路径（`unit_nod_scarab.derived.stats.self_destruct` 这种） */
  patchedPaths: Set<string>;
  /** patch 里的单位 id（界面可以据此列出"哪些单位有手填修正"） */
  ids: string[];
}

/** 把 `patch` 深合并进 `base`，并记录被覆盖的路径 */
function mergeInto(
  base: unknown,
  patch: unknown,
  path: string,
  out: Set<string>,
): unknown {
  /* 对象 → 递归合并（patch 里没提到的键保持原值） */
  if (
    base !== null &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    patch !== null &&
    typeof patch === "object" &&
    !Array.isArray(patch)
  ) {
    const dst = base as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const child = path ? `${path}.${k}` : k;
      dst[k] = k in dst ? mergeInto(dst[k], v, child, out) : (out.add(child), v);
    }
    return dst;
  }
  /* 其余（含数组、标量）= 整体替换 */
  out.add(path);
  return patch;
}

/**
 * 把 patch 应用到数据集上。
 *
 * @param dataset `data/units.json` 解析后的对象（**会被就地修改**，调用方持有的是同一个引用）
 * @param patch   `data/units.patch.json` 的内容；`null`/缺省时原样返回
 */
export function applyPatch<T extends { units?: unknown[]; commanders?: unknown[] }>(
  dataset: T,
  patch: PatchFile | null | undefined,
): PatchResult<T> {
  const patchedPaths = new Set<string>();
  const units = patch?.units;
  if (!patch || !units || !Object.keys(units).length) {
    return { data: dataset, patchedPaths, ids: [] };
  }

  const byId = new Map<string, unknown>();
  for (const list of [dataset.units, dataset.commanders]) {
    for (const entry of list ?? []) {
      const id = (entry as { id?: string }).id;
      if (id) byId.set(id, entry);
    }
  }

  const ids: string[] = [];
  for (const [id, overrides] of Object.entries(units)) {
    const target = byId.get(id);
    if (!target) {
      // patch 指向了不存在的 id：不猜、跳过，但把路径记下来便于排查
      patchedPaths.add(`${id}.<未找到该单位>`);
      continue;
    }
    ids.push(id);
    mergeInto(target, overrides, id, patchedPaths);
  }
  return { data: dataset, patchedPaths, ids };
}
