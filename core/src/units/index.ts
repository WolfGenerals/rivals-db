/**
 * **我们有 def 的单位清单** —— 手写的 + （将来）机器批量转换出来的。
 *
 * 这里是 `rivals emit-defs` 的输入：跑一遍就把全部 def 编码进
 * `data/units.def.json`（网页与模拟器都读那个文件，见 `model/def-json.ts`）。
 *
 * ## 加一个单位 = 加一行
 *
 * 手工族：`core/src/units/unit_<id>.ts` 里手写 def（逐字段标 `file:line` 锚点）。
 * 机器族（还没写）：批量转换器产出同样形状的 def，挂到这个清单里 —— **下游零改动**。
 */

import type { UnitDef } from "../model/unit-def.ts";
import { unit_gdi_riflemen } from "./unit_gdi_riflemen.ts";

/** 目前有 def 的全部单位（顺序 = 产物里的顺序） */
export const ALL_UNIT_DEFS: UnitDef[] = [unit_gdi_riflemen];

/**
 * **手写 patch**（逐字段修正机器转换的结果）—— 与 def 是两件事，见 `patches.ts`：
 *
 * - `ALL_UNIT_DEFS`：**整份**手写 def（人逐项核过的单位，优先级最高）
 * - `UNIT_DEF_PATCHES`：只改**几个字段**（机器转换只差一两个数时用，其余仍随机器更新）
 */
export { UNIT_DEF_PATCHES, applyDefPatch, patchDefJson } from "./patches.ts";
export type { UnitDefPatch } from "./patches.ts";