/**
 * 路由（vue-router 4 + hash 模式）。
 *
 * 用 **hash 历史**而不是 HTML5 History，有两个硬理由：
 *   1. `base: "./"` 的产物要能放在任意子路径（GitHub Pages 的 `/<repo>/`）
 *   2. 直接 `file://` 打开 `dist/index.html` 也要能跑
 *
 * 路由表：
 *   /                  单位图鉴（卡片墙）
 *   /commander         指挥官图鉴
 *   /unit/:id          单位详情
 *   /commander/:id     指挥官详情
 *   /table             旧的表格预览（保留，方便横向对比数值）
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

import Arsenal from "./views/Arsenal.vue";
import NotFound from "./views/NotFound.vue";
import UnitDetail from "./views/UnitDetail.vue";
import UnitList from "./views/UnitList.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "units", component: Arsenal },
  { path: "/commander", name: "commanders", component: Arsenal, props: { commandersOnly: true } },
  // props: true 把 :id 直接作为 prop 传给详情页，页面不必自己读 route
  { path: "/unit/:id", name: "unit", component: UnitDetail, props: true },
  { path: "/commander/:id", name: "commander", component: UnitDetail, props: true },
  { path: "/table", name: "table", component: UnitList },
  { path: "/:pathMatch(.*)*", name: "notFound", component: NotFound },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 切换页面回到顶部；否则从长列表点进详情会停在半空
  scrollBehavior: () => ({ top: 0 }),
});

/** 按 id 生成详情页链接（自动区分单位与指挥官）。 */
export function detailPath(id: string): string {
  return id.startsWith("cmdr_") ? `/commander/${encodeURIComponent(id)}` : `/unit/${encodeURIComponent(id)}`;
}
