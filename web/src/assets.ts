/**
 * 静态资源路径的唯一出处。
 *
 * 全部走 `import.meta.env.BASE_URL`，所以 `base: "./"` 部署到任意子路径、
 * 甚至用 `file://` 直接打开都能找到文件。**不要在组件里手拼路径。**
 *
 * 目录分工：
 *   data/img/    每个单位的卡面，`<unit_id>.webp`，统一 270×324
 *   data/icon/   UI 图标（兵种 / 阵营 / 数值），见 data/icon/README.md
 */

const BASE = import.meta.env.BASE_URL;

/** 单位卡面。缺失时 `<img>` 会触发 error，由调用方回退。 */
export function unitIconUrl(id: string): string {
  return `${BASE}data/img/${id}.webp`;
}

/** 阵营标志。`GDI` / `NOD` */
export function factionIconUrl(faction: string): string {
  return `${BASE}data/icon/faction-${faction.toLowerCase()}.webp`;
}

/** 兵种图标。`Infantry` / `Vehicle` / `Aircraft` / `Structure` / `Harvester` */
export function typeIconUrl(type: string): string {
  return `${BASE}data/icon/type-${type.toLowerCase()}.webp`;
}

/** 造价用的泰伯利亚矿图标。 */
export function tiberiumIconUrl(): string {
  return `${BASE}data/icon/cost-tiberium.webp`;
}

/** 稀有度卡框。`Common` / `Rare` / `Epic` */
export function rarityIconUrl(rarity: string): string {
  return `${BASE}data/icon/rarity-${rarity.toLowerCase()}.webp`;
}

/** 数值标签图标（本地绘制的 SVG）。`health` / `dps` / `range` / `vision` / `speed` / `cost` / `cooldown` */
export function statIconUrl(name: string): string {
  return `${BASE}data/icon/stat-${name}.svg`;
}
