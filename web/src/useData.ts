/**
 * 取 App 注入的数据。
 *
 * `provide` 的 key 用字符串常量集中在这里，避免各处手写拼错。
 */

import { inject, type Ref } from "vue";

import type { LoadedData } from "./data.ts";

export const DATA_KEY = Symbol("rivals-data");

export function useData(): Ref<LoadedData | null> {
  const data = inject<Ref<LoadedData | null>>(DATA_KEY);
  if (!data) throw new Error("useData() 必须在 App 之内使用");
  return data;
}
