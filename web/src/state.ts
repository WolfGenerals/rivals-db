/**
 * 全局显示状态：等级滑块与「相对起始等级」开关。
 *
 * 用模块级 `ref` 而不是 provide/inject：列表页与详情页都要用同一个等级，
 * 而且切换页面不该把等级重置，所以做成单例并持久化到 localStorage。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

import { fromOrdinal, level, MAX_ORDINAL, startingMajorOfRarity, type Level } from "@rivals/core/levels";
import type { UnitSummary } from "@rivals/core/types";

export { MAX_ORDINAL };

const KEY_LEVEL = "rivals.level";
const KEY_RELATIVE = "rivals.relativeToStart";

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

/** 滑块位置（0 = 见 `displayLevel` 的说明）。 */
export const ordinal: Ref<number> = ref(clamp(storedLevel));

/** 是否从「各自起始等级」起算。 */
export const relativeToStart: Ref<boolean> = ref(read(KEY_RELATIVE) === "1");

watch(ordinal, (v) => write(KEY_LEVEL, String(v)));
watch(relativeToStart, (v) => write(KEY_RELATIVE, v ? "1" : "0"));

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
 * 某条目在当前设置下应显示的等级。
 *
 * - **绝对**（默认）：滑块就是游戏内的 `major-minor`，所有条目同等级对比。
 * - **相对起始**：滑块 0 = 该条目**自己的起始等级**（普通 1-0 / 稀有 3-0 /
 *   史诗 5-0），用于比较「升同样级数的收益」。
 */
export function displayLevel(u: Pick<UnitSummary, "rarity"> | undefined): LevelDisplay {
  const base = fromOrdinal(ordinal.value);
  const start = relativeToStart.value ? startingMajorOfRarity(u?.rarity) : null;
  if (start === null) return withCapped(base, false);

  const shifted = level(start, 0).ordinal() + ordinal.value;
  return withCapped(fromOrdinal(Math.min(shifted, MAX_ORDINAL)), shifted > MAX_ORDINAL);
}

/** 该条目从起始等级到当前等级升了几级。 */
export function upgradeSteps(u: Pick<UnitSummary, "rarity"> | undefined): number {
  const start = startingMajorOfRarity(u?.rarity);
  if (start === null) return 0;
  return Math.max(0, displayLevel(u).stepsFrom(level(start, 0)));
}

/** 滑块旁边的文字。 */
export const levelLabel: ComputedRef<string> = computed(() =>
  relativeToStart.value ? `起始 ${fromOrdinal(ordinal.value).format()} 级起` : fromOrdinal(ordinal.value).format(),
);
