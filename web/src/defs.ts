/**
 * **单位数据（新格式）的读取** —— `data/units.def.json`。
 *
 * ## 这是单位数据的唯一入口
 *
 * 用户定的硬约束：**单位数据一律走新格式**。一条记录里装齐五块
 * （`core/src/model/def-json.ts` 的 `UnitRecordJson`）：
 *
 * | 块 | 装什么 |
 * | --- | --- |
 * | 身份 | `id` / `faction` / `variant` / `suffixes` / `source` |
 * | `locale` | 中英文名与描述（**新格式自己带着**，不再去旧产物顶层拿） |
 * | `pb` | 稀有度等（`game-config.pb`） |
 * | `art` | 卡面路径（**按 `data/img/` 实际盘点**） |
 * | **`def`** | **机械定义**（血量/武器/节奏/伤害/部署/出处锚点） |
 *
 * ⚠️ **`def` 可能不出现** = 这个单位还没转换出新格式的机械定义（批量转换的进度）。
 * 此时页面照样能显示名字/图标/稀有度，只是没有武器细节与时间轴。
 *
 * ## 与 patch 同一个套路
 *
 * 文件**不是必需**的（404 当作没有），产物没生成时页面只是少一块，不白屏。
 * ⚠️ **读回来必须过 `decodeRecord()`**：`Damage` 是 class，JSON 里没有 `against()`。
 */

import { decodeRecord, type DefFileJson, type UnitRecord } from "@rivals/core/def-json";

/** `data/units.def.json` 的解码结果 */
export interface LoadedDefs {
  /** `id` → 完整记录（`record.def` 里的 `Damage` 已补回实例） */
  byId: Map<string, UnitRecord>;
  /** 有机械 def 的单位 id */
  defIds: string[];
}

const EMPTY: LoadedDefs = { byId: new Map(), defIds: [] };

/** 拉取并解码新格式产物；没有这个文件时返回空（不算错误） */
export async function loadDefs(): Promise<LoadedDefs> {
  try {
    const res = await fetch("data/units.def.json");
    if (!res.ok) return EMPTY;
    const file = (await res.json()) as DefFileJson;
    const byId = new Map<string, UnitRecord>();
    for (const zone of [file.units, file.commanders]) {
      for (const [id, json] of Object.entries(zone ?? {})) byId.set(id, decodeRecord(json));
    }
    return { byId, defIds: [...byId.values()].filter((r) => r.def !== undefined).map((r) => r.id) };
  } catch {
    return EMPTY;
  }
}
