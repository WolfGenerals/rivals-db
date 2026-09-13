/**
 * **手写 patch** —— 机器转换结果之上的**逐字段**修正（用户点的：一次性的事实别写成通用启发式）。
 *
 * ## 为什么要有它（与"手写 def"的区别）
 *
 * | 做法 | 什么时候用 | 代价 |
 * | --- | --- | --- |
 * | **手写 def**（`core/src/units/unit_*.ts`） | 整个单位已经逐项核过（步枪兵） | 要写全，机器后续的改进进不来 |
 * | **手写 patch（本文件）** | 机器只差**一两个数**（沙暴的一轮发数） | 只写差的那几个字段，其余仍随机器转换更新 |
 *
 * ## 规矩（与 `web/src/patch.ts` 同一套，刻意做得极简）
 *
 * 1. **按路径深合并**：只覆盖写到的叶子，其余以机器产物为准；
 * 2. **数组整体替换**（数组的"部分修改"语义不清）；
 * 3. **每条都要写清"为什么"与出处**（J52：没有锚点的数不可信）——`note` 字段是必填的；
 * 4. `emit-defs` 把命中路径记进产物的 `defPatched`，页面据此标出"这个是手填的"。
 *
 * ## patch 里能写什么
 *
 * 写的是**产物形态**（`UnitDefJson`，见 `core/src/model/def-json.ts`）的一部分，
 * 所以 `{"timing": {"hits": 12}}` 会**只改** `hits`（`timing` 是对象 ⇒ 深合并）。
 */

import type { UnitDefJson } from "../model/def-json.ts";

/** 一个单位的修正（`UnitDefJson` 的任意深度的片段）+ **必填的出处说明** */
export interface UnitDefPatch {
  /** **为什么这么改**（一句话）+ 出处（`file:line` / 游戏内实测 / 面板公式） */
  note: string;
  /** 要覆盖的字段（深合并；数组整体替换） */
  set: DeepPartial<UnitDefJson>;
}

/** 深片段（对象与**数组元素**都逐层可选；合并时数组按下标走） */
export type DeepPartial<T> = T extends (infer U)[]
  ? Array<DeepPartial<U>>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * `id` → 修正。
 *
 * ⚠️ 每条 patch 都必须是"**机器读不到、但源码里写着**"或"**只有游戏内/人的核对才知道**"的东西；
 * 能机器读的一律回转换器（别在这里堆一次性启发式）。
 */
export const UNIT_DEF_PATCHES: Record<string, UnitDefPatch> = {
  unit_gdi_sandstorm: {
    note:
      "沙暴导弹车：一轮发数与间隔**随交战队数变**（源码 `unit_gdi_sandstorm.lua:61-66` 的 `perTargetCount`：" +
      "1 队 12 发 ×200ms / 2 队 24 发 ×100ms / 3 队 36 发 ×66ms，由 " +
      "`ability_sandstorm_weapon_sequence.lua:274-280` 按 `attackStrength` 取档）；" +
      "模型只有一个 `hits`/`intervalMs` ⇒ **这里填第 1 档**（1 队）。周期 4000ms 与伤害 150 机器已转对，不改。",
    set: {
      combatant: {
        // ⚠️ **只写差的那两个字段** —— 其余（周期 4000 / 前摇 0 / 伤害 150 / 出处）仍归机器，
        // 机器那边以后改进了这里也不会挡着（`defPatched` 里也只记这两条路径）
        weapons: [{ timing: { hits: 12, intervalMs: 200 } }],
      },
    },
  },

  /**
   * **神像机甲（3 连发）** —— 用户点名要 patch 的。
   *
   * 源码写得**明明白白**：序列里连着打三发，每发打目标格的一个角
   * （`ability_juggernaut_weapon_sequence.lua:69,73,77` 的 `Fire(0,1)` / `Fire(2,2)` / `Fire(4,3)`，
   * 之间 `WaitForAge(delayAfterShot)`）；单位自己的视觉块 `MUZZLE_INFO` 也是 **3 条**
   * （`unit_gdi_juggernaut.lua:148-153`，全是 `muzzleIndex = 0`）。
   * 面板 DPS 公式同样按 `#MUZZLE_INFO` 算（`:18`）。
   *
   * 转换器读不到的原因是：**发数在 `*_visual` 全局表里**，而提取器只收 `ItemTuning`
   * （`combatantTuning`/`squadTuning`/`combatStoreTuning`），没收视觉块 ⇒ 这是**提取侧的缺口**，
   * 以后把 visual 收进来就能机器转、这条 patch 可以删。
   *
   * ⚠️ **一处待确认**：武器级 `burstTiming.chargeUpDuration = 0.25s` 与序列的 `initialChargeUpMs = 500ms`
   * 都像是"齐射前的前摇"。机器现在是 250ms（取武器级）；序列那句 `:60` 在每个 volley 都会等到，
   * 所以**更可能是 500ms** —— 我没改，等你按游戏内表现定（改这里一行即可）。
   */
  unit_gdi_juggernaut: {
    note:
      "神像机甲：**一轮 3 连发**（`ability_juggernaut_weapon_sequence.lua:69,73,77` 三个 `Fire`，" +
      "间隔 `delayAfterShot`；`unit_gdi_juggernaut.lua:148-153` 的 `MUZZLE_INFO` 也是 3 条）—— " +
      "发数在**视觉块**里，提取器还没收 `*_visual`，所以机器按 1 占位。" +
      "另有待确认：齐射前摇是武器级 250ms 还是序列的 `initialChargeUpMs = 500ms`（后者更像真值，未改）。",
    set: { combatant: { weapons: [{ timing: { hits: 3 } }] } },
  },

  /** **钢爪神像机甲** —— 与神像机甲**共用同一个 sequence behaviour**（ST 文件 `:70`），只是数值不同。 */
  unit_gdi_juggernaut_ST: {
    note:
      "钢爪神像机甲：与神像机甲**共用 `ability_juggernaut_weapon_sequence_behaviour`**" +
      "（`unit_gdi_juggernaut_ST.lua:70`）⇒ 同样是**一轮 3 连发**；它的 `MUZZLE_INFO` 也是 3 条（`:148-153`）。",
    set: { combatant: { weapons: [{ timing: { hits: 3 } }] } },
  },
};

/**
 * 把 patch 深合并进 def（**就地修改**），返回被覆盖的路径（`combatant.weapons.0.timing.hits`）。
 *
 * ⚠️ **与本仓库另一处 patch（`web/src/patch.ts`，作用于旧产物）的唯一区别**：
 * 那边**数组整体替换**，这边**按下标逐个合并** —— 因为 def 里的数组是**有位置的**
 * （武器槽 / 每段伤害 / 每段时序），"只改第 2 把武器的 `hits`"语义明确；
 * 而旧产物那种"数组的部分修改"确实说不清。这条差异是故意的，别去"统一"它们。
 */
export function applyDefPatch(base: unknown, patch: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(base) && Array.isArray(patch)) {
    for (let i = 0; i < patch.length; i++) {
      const child = `${path}.${i}`;
      if (i < base.length) applyDefPatch(base[i], patch[i], child, out);
      else {
        base[i] = patch[i];
        out.push(child);
      }
    }
    return out;
  }
  if (
    base !== null &&
    typeof base === "object" &&
    patch !== null &&
    typeof patch === "object" &&
    !Array.isArray(base) &&
    !Array.isArray(patch)
  ) {
    const dst = base as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      const child = path ? `${path}.${k}` : k;
      if (k in dst && typeof dst[k] === "object" && dst[k] !== null) applyDefPatch(dst[k], v, child, out);
      else {
        dst[k] = v;
        out.push(child);
      }
    }
    return out;
  }
  out.push(path);
  return out;
}

/** 对一份 def 产物形态应用某单位的 patch（没有 patch 就原样返回，`patched` 为空） */
export function patchDefJson(id: string, def: UnitDefJson): { def: UnitDefJson; patched: string[]; note?: string } {
  const patch = UNIT_DEF_PATCHES[id];
  if (patch === undefined) return { def, patched: [] };
  const patched = applyDefPatch(def, patch.set, "", []);
  return { def, patched, note: patch.note };
}
