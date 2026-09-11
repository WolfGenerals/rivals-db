/// <reference types="vite/client" />

/**
 * 让 TS 认识 `.vue` 单文件组件。
 *
 * 这里用 `DefineComponent<{}, {}, any>` 这种宽松签名，而不是
 * `vue-tsc` 提供的完整模板类型推导 —— 项目只做 `tsc --noEmit`，
 * 不引入 vue-tsc，所以组件内部的模板类型不会被检查。
 * 组件内部逻辑仍受 TS 检查（`<script setup lang="ts">`）。
 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
