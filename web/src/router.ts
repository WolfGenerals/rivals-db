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
 *   /battle            战斗时间线（1v1 伤害赛跑，"假设计算器"）
 *   /unit/:id          单位详情
 *
 * ⚠️ **指挥官已从界面移除**（用户决定）—— 它们没有武器、不是战场单位，
 * 详情页除了技能调参没什么可看。数据里仍保留（`data/units.json` 的 `commanders`），
 * 只是不再有入口与路由。
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

import Arsenal from "./views/Arsenal.vue";
import BattleView from "./views/BattleView.vue";
import CompareView from "./views/CompareView.vue";
import NotFound from "./views/NotFound.vue";
import UnitDetail from "./views/UnitDetail.vue";
import UnitList from "./views/UnitList.vue";

const routes: RouteRecordRaw[] = [
  { path: "/", name: "units", component: Arsenal },
  { path: "/table", name: "table", component: UnitList },
  { path: "/compare/:left?/:right?", name: "compare", component: CompareView },
  { path: "/battle", name: "battle", component: BattleView },
  // props: true 把 :id 直接作为 prop 传给详情页，页面不必自己读 route
  { path: "/unit/:id", name: "unit", component: UnitDetail, props: true },
  { path: "/:pathMatch(.*)*", name: "notFound", component: NotFound },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  /**
   * 滚动行为。
   *
   * ⚠️ **不能无条件 `{ top: 0 }`** —— 那样"从列表进详情再返回"会丢掉列表位置，
   * 长列表里翻到一半点进去、返回就得重新找（用户报的 bug）。
   *
   * `savedPosition` 由 vue-router 在**前进/后退**时给出，有就恢复。
   * 只有**新导航**（点链接去另一个页面）才回顶。
   */
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    return { top: 0 };
  },
});

/** 按 id 生成详情页链接（**只有单位** —— 指挥官已无路由）。 */
export function detailPath(id: string): string {
  return `/unit/${encodeURIComponent(id)}`;
}

/** 与某单位对比的链接 */
export function comparePath(id: string): string {
  return `/compare/${encodeURIComponent(id)}`;
}
