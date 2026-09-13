/**
 * **界面文案的唯一术语表** —— 内部标识到玩家语言的翻译，全站**只在这里定义一次**。
 *
 * ## 为什么单独一个文件
 *
 * 用户定的第 1 条规则：**界面不出现内部标识**（`unit_*` / `modifier_*` / `canAttack` /
 * `burstTiming` / `*.lua` / findings 编号…），第 2 条：**不出现 `**` 与反引号**。
 * 这些翻译散在十几个组件里迟早会走形，所以：
 *
 * | 输入 | 输出 | 例子 |
 * | --- | --- | --- |
 * | 武器槽名（`rifle` / `gasWeapon` …） | 中文 | `rifle` → **机炮**、`gasWeapon` → **毒气罐** |
 * | 目标类型（`Aircraft` …） | 中文 | `Aircraft` → **空军** |
 * | 覆写标签（`override_vehicle`） | 中文 | → **对载具** |
 * | 交付方式（`one_member` …） | 中文 | → **只打最后一名成员** |
 *
 * ⚠️ **不认识的标识不要硬翻**：返回 `""`（由调用方决定隐藏或退回中性说法），
 * 绝不把内部名原样吐到界面上。想补一条就往表里加，并把出处写在旁边。
 *
 * ⚠️ **机制事实要留、计算口径要删**（用户第 3 条规则）："只打最后一名成员"、"只对地面"、
 * "载具免疫"是**机制**，保留；"含在周期里"、"时间相加"、"从第一发开始算"是**我们怎么算的**，删。
 */

import type { Target } from "@rivals/core/model/unit-def";

/** 目标类型 → 中文（`combatant.tags` 里那 5 类） */
export const TARGET_ZH: Record<string, string> = {
  Infantry: "步兵",
  Vehicle: "载具",
  Aircraft: "空军",
  Structure: "建筑",
  Harvester: "采集车",
};

/** `Aircraft` → `空军`；不认识就返回空串（**不把英文原样漏出去**） */
export function targetZh(t: Target | string): string {
  return TARGET_ZH[t] ?? "";
}

/**
 * **武器槽名一律不翻译成"看上去像正式名"的中文**。
 *
 * 踩过的坑：我按槽名做过一张平面映射（`rifle → 机炮`），但**槽名是源码内部标识，
 * 同一名字在不同单位上是不同武器** —— 摩托的 `rifle` 其实是双联火箭，而产物里
 * **没有**武器的本地化名（`weapon.name` 全缺，`data/locale/*` 里也没有对应词条）。
 * 编一个名字上去就是伪造数据。
 *
 * ⇒ 界面上一律用**由数据决定的序数**：单武器单位叫「主武器」，多武器单位叫「武器 N」
 * （全库只有 5 个多武器单位：猛犸坦克 / 利爪 / 圣灵 / 催化剂炮艇 / 寡妇制造者）。
 * 需要点名的场合（日志）只在多武器时才写，单武器不写。
 */
export function weaponOrdinalZh(index: number, total: number): string {
  return total <= 1 ? "主武器" : `武器 ${index + 1}`;
}

/** 覆写标签（`override_vehicle`）→ `对载具` */
export function overrideZh(label: string): string {
  const m = /^override_(\w+)$/.exec(label);
  const base = m === null ? label : m[1]!;
  const zh = TARGET_ZH[base.charAt(0).toUpperCase() + base.slice(1)];
  return zh === undefined ? "" : `对${zh}`;
}

/**
 * **伤害对象**（`damage.ts` 的 `Delivery` + 弹头里的 `per_combatant`）→ 玩家语言。
 *
 * 用户定的词：这一族统一叫「伤害对象」，其中默认那条是「**攻击单个成员**」
 * （源码里是"只打最后一名成员"，但那是实现细节，玩家只关心"打一个还是打一片"）。
 */
export const DELIVERY_ZH: Record<string, string> = {
  one_member: "攻击单个成员",
  squad_each: "攻击整队（每人各一份）",
  per_combatant: "逐个成员点名",
  falloff: "范围内按距离衰减",
};

/** 交付方式 → 中文；不认识返回空串 */
export function deliveryZh(kind: string): string {
  return DELIVERY_ZH[kind] ?? "";
}

/** 把一串目标类型写成 `步兵 / 载具 / 建筑`（不认识的整条丢掉，不夹英文） */
export function targetListZh(list: readonly string[]): string {
  return list.map(targetZh).filter((s) => s !== "").join(" / ");
}

/**
 * **免疫名单**里的类型名 → 中文单位名。
 *
 * 名单是源码里的 Lua 类型名（`aura_gas_cloud.condition` 的 `IMMUNE_UNIT1/2`），
 * 与我们的单位 id 只差大小写（`Unit_Nod_ChemQuad` → `unit_nod_chemquad`）。
 * ⚠️ **只列已经核过的那两个**（毒气免疫的实际成员）—— 认不出来就返回空串，
 * 由调用方丢掉，**绝不把 `Nod_ChemQuad` 这种内部名漏到界面上**。
 */
const IMMUNE_ZH: Record<string, string> = {
  unit_nod_chemquad: "生化越野车",
  unit_nod_chemicalwarrior: "生化战士",
};

export function immuneZh(luaTypeName: string): string {
  return IMMUNE_ZH[luaTypeName.toLowerCase()] ?? "";
}
