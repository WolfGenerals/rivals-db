/**
 * 全局显示状态：等级 + DPS 口径 + 各页面的筛选/排序。
 *
 * 用模块级 `ref` 而不是 provide/inject：列表页与详情页都要用同一个等级，
 * 而且切换页面不该把等级重置，所以做成单例并持久化到 localStorage。
 *
 * ⚠️ 这里**曾经**有一个「从各自起始等级算」开关（`relativeToStart`），
 * 用户判定没人用、要求彻底去掉（PC 与手机都不留），已删除 —— 现在等级一律是
 * 游戏内的绝对 `大级-小级`。注意 localStorage 里可能还残留 `rivals.relativeToStart`，
 * 现在没有任何代码读它，无害。
 */

import { ref, watch, type Ref } from "vue";

import { fromOrdinal, level, MAX_ORDINAL, startingMajorOfRarity, type Level } from "@rivals/core/levels";


export { MAX_ORDINAL };

const KEY_LEVEL = "rivals.level";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 无痕模式等场景写入会失败；内存里的状态仍然有效，忽略即可
  }
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_ORDINAL, Math.trunc(n))) : 0;
}

const storedLevel = Number(read(KEY_LEVEL) ?? "0");

/** 当前等级（序数，0 = `1-0`，见 `displayLevel` 的说明）。 */
export const ordinal: Ref<number> = ref(clamp(storedLevel));

watch(ordinal, (v) => write(KEY_LEVEL, String(v)));

/** 展示用的等级 = 等级对象 + 一个「是否被 15-3 上限截断」的标记。 */
export interface LevelDisplay extends Level {
  /** 是否被 15-3 上限截断 */
  capped: boolean;
}

/** 给新造出来的等级对象挂上 `capped`。用 `Object.assign` 而不是展开 —— 展开会丢方法。 */
function withCapped(lv: Level, capped: boolean): LevelDisplay {
  return Object.assign(lv, { capped });
}

/**
 * DPS 统计口径 —— **两个，都是时间轴算的实际值**。
 *
 *   `burst` —— 射击**期间**的速率，看"打起来多猛"
 *   `avg`   —— 含蓄力/装填/空档的长期平均，看"实际能打出多少"（默认）
 *
 * ⚠️ **没有「游戏面板」这一项**（用户要求去掉）：面板值 `derived.dps` 只在单位页的
 * DPS 格显示，不进这个切换 —— 官方面板没有"逐目标"版本，选它时逐目标只能退回平均，
 * 同一张表里混两种口径；而音波坦克面板 650 / 实际平均 137 差 4.75 倍（findings I164），
 * 混着看极易读错。
 */
export const dpsMode: Ref<"burst" | "avg"> = ref("avg");
export const DPS_MODES: Array<{ key: "burst" | "avg"; label: string; title: string }> = [
  { key: "burst", label: "爆发", title: "射击期间的速率 = 伤害 ÷ 两下之间的间隔" },
  { key: "avg", label: "平均", title: "含蓄力/装填/空档的长期平均 = 实际输出" },
];

/**
 * 表格的排序状态。
 *
 * ⚠️ **必须是模块级单例，不能放在 `UnitList` 组件内** —— 点单位进详情页再返回会
 * 重新挂载列表组件，组件内的 `ref` 会被重置，排序就丢了（用户报的 bug）。
 * 放这里之后会话内切换路由/页面都不会丢。
 */
export const tableSortKey: Ref<string> = ref("cost");
export const tableSortDir: Ref<"asc" | "desc"> = ref("asc");

/** 表格「对目标 DPS / 伤害补正」的切换 */
export const tableCellMode: Ref<"dps" | "ratio"> = ref("dps");

/*
 * 列表页的筛选与排序 —— 同样放模块级。
 *
 * 这些是**界面状态**，不是某个组件实例的私有数据：换路由回来应当保持原样。
 * 放组件内的话，点进单位详情再返回，筛选就被清空了。
 */
export const listQuery: Ref<string> = ref("");
export const listFaction: Ref<string> = ref("");
export const listRarity: Ref<string> = ref("");
export const listType: Ref<string> = ref("");
export const listHidden: Ref<"hide" | "only" | "all"> = ref("hide");
export const listGroup: Ref<"none" | "type" | "faction"> = ref("type");
export const listSort: Ref<"cost" | "name" | "hp" | "dps"> = ref("cost");

/** 对比页已选的两个单位与"正在选"状态 —— 同样不该因路由切换而清空 */
export const compareLeft: Ref<string> = ref("");
export const compareRight: Ref<string> = ref("");
export const comparePickingLeft: Ref<boolean> = ref(true);
export const comparePickingRight: Ref<boolean> = ref(true);

/**
 * 当前应显示的等级。
 *
 * 就是游戏内的绝对 `大级-小级`（顶栏那个「从各自起始等级算」的开关已按用户要求删除，
 * 所以这里不再依赖具体条目）。返回带 `capped` 标记的对象 —— 15-3 是上限。
 */
export function displayLevel(): LevelDisplay {
  return withCapped(fromOrdinal(ordinal.value), false);
}

/** 该条目从起始等级到当前等级升了几级。 */
export function upgradeSteps(u: { pb?: { rarity?: string } } | undefined): number {
  const start = startingMajorOfRarity(u?.pb?.rarity);
  if (start === null) return 0;
  return Math.max(0, displayLevel().stepsFrom(level(start, 0)));
}
