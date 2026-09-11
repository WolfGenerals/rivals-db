/**
 * 路由（vue-router 4 + hash 模式）。
 *
 * 用 **hash 历史**而不是 HTML5 History，有两个硬理由：
 *   1. `base: "./"` 的产物要能放在任意子路径（GitHub Pages 的 `/<repo>/`）
 *   2. 直接 `file://` 打开 `dist/index.html` 也要能跑
 *
 * 路由表：
 *   /                  单位列表（表格，按数值排序）
 *   /cards             单位图鉴（卡片墙）
 *   /compare           左右分栏对比（可选两侧单位）
 *   /compare/:left/:right  对比指定两个单位（可分享）
 *   /unit/:id          单位详情
 *
 * ⚠️ **指挥官已从界面移除**（用户决定）—— 它们没有武器、不是战场单位，
 * 详情页除了技能调参没什么可看。数据里仍保留（`data/units.json` 的 `commanders`），
 * 只是不再有入口与路由。
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

import Arsenal from "./views/Arsenal.vue";
import CompareView from "./views/CompareView.vue";
import NotFound from "./views/NotFound.vue";
import UnitDetail from "./views/UnitDetail.vue";
import UnitList from "./views/UnitList.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "units", component: Arsenal },
  { path: "/table", name: "table", component: UnitList },
  { path: "/compare/:left?/:right?", name: "compare", component: CompareView },
  // props: true 把 :id 直接作为 prop 传给详情页，页面不必自己读 route
  { path: "/unit/:id", name: "unit", component: UnitDetail, props: true },
  { path: "/:pathMatch(.*)*", name: "notFound", component: NotFound },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 切换页面回到顶部；否则从长列表点进详情会停在半空
  scrollBehavior: () => ({ top: 0 }),
});

/** 按 id 生成详情页链接（**只有单位** —— 指挥官已无路由）。 */
export function detailPath(id: string): string {
  return `/unit/${encodeURIComponent(id)}`;
}

/** 与某单位对比的链接 */
export function comparePath(id: string): string {
  return `/compare/${encodeURIComponent(id)}`;
}
