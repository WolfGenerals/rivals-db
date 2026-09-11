/**
 * 内联 SVG 图标。
 *
 * 由 `_svg_icons.py` 从 `data/icon/*.svg` 提取生成，**不要手改**；
 * 改图形请改那些 SVG 文件，然后重跑脚本。
 *
 * 为什么要内联而不是 `<img src=...svg>`：`<img>` 引用的 SVG 是独立文档，
 * 外部 CSS 改不了它内部颜色。这些图标都用 `currentColor` 画，
 * 当 `<img>` 用时没有可继承的颜色，会一律渲染成黑色。
 *
 * `TYPE_ICONS` 只有剪影，圆底由 `TypeIcon.vue` 画
 * （这样圆底能单独跟阵营换色，烘进图形里就只能整体一色）。
 */

export interface IconDef {
  viewBox: string;
  body: string;
}

export const TYPE_ICONS: Record<string, IconDef> = {
  infantry: { viewBox: "0 0 64 64", body: `<path d="M13.49,5.48 C14.59,5.48 15.49,4.58 15.49,3.48 C15.49,2.38 14.59,1.48 13.49,1.48 C12.39,1.48 11.49,2.38 11.49,3.48 C11.49,4.58 12.39,5.48 13.49,5.48 Z M10.32,17.48 L10.89,14.98 L12.99,16.98 L12.99,21.98 C12.99,22.53 13.44,22.98 13.99,22.98 C14.54,22.98 14.99,22.53 14.99,21.98 L14.99,16.34 C14.99,15.79 14.77,15.27 14.37,14.89 L12.89,13.48 L13.49,10.48 C14.56,11.72 16.11,12.61 17.85,12.89 C18.45,12.98 18.99,12.5 18.99,11.89 C18.99,11.4 18.63,10.99 18.14,10.91 C16.62,10.66 15.36,9.76 14.69,8.58 L13.69,6.98 C13.29,6.38 12.69,5.98 11.99,5.98 C11.69,5.98 11.49,6.08 11.19,6.08 L7.21,7.76 C6.47,8.08 5.99,8.8 5.99,9.61 L5.99,11.98 C5.99,12.53 6.44,12.98 6.99,12.98 C7.54,12.98 7.99,12.53 7.99,11.98 L7.99,9.58 L9.79,8.88 L8.19,16.98 L4.27,16.18 C3.73,16.07 3.2,16.42 3.09,16.96 L3.09,17 C2.98,17.54 3.33,18.07 3.87,18.18 L7.98,19 C9.04,19.21 10.08,18.54 10.32,17.48 Z" fill="currentColor" transform="scale(2.6666667)"/>` },
  vehicle: { viewBox: "0 0 64 64", body: `<g fill="currentColor"><path d="M16,6H6L1,12V15H3A3,3 0 0,0 6,18A3,3 0 0,0 9,15H15A3,3 0 0,0 18,18A3,3 0 0,0 21,15H23V12C23,10.89 22.11,10 21,10H19L16,6M6.5,7.5H10.5V10H4.5L6.5,7.5M12,7.5H15.5L17.46,10H12V7.5M6,13.5A1.5,1.5 0 0,1 7.5,15A1.5,1.5 0 0,1 6,16.5A1.5,1.5 0 0,1 4.5,15A1.5,1.5 0 0,1 6,13.5M18,13.5A1.5,1.5 0 0,1 19.5,15A1.5,1.5 0 0,1 18,16.5A1.5,1.5 0 0,1 16.5,15A1.5,1.5 0 0,1 18,13.5Z" transform="scale(2.6666667)"/></g>` },
  aircraft: { viewBox: "0 0 64 64", body: `<!-- 空军：俯视战机。尖机头 + 后掠主翼 + 尾翼，全部用直线折角 --> <path fill="currentColor" d=" M30 5 L34 5 L37 26 L58 30 L58 35.5 L37 39 L36 48 L44 55 L44 59.5 L32 54 L20 59.5 L20 55 L28 48 L27 39 L6 35.5 L6 30 L27 26 Z"/>` },
  structure: { viewBox: "0 0 64 64", body: `<!-- 建筑：坡顶房子 + 门洞 + 两扇窗。建筑类最通用的符号 --> <path fill="currentColor" fill-rule="evenodd" d=" M32 7 L57 28 L57 57 L7 57 L7 28 Z M26 57 L26 42 L38 42 L38 57 Z M18 33 L26 33 L26 41 L18 41 Z M38 33 L46 33 L46 41 L38 41 Z"/>` },
  harvester: { viewBox: "0 0 64 64", body: `<!-- 采集车：敞口矿斗（里面露出矿石）+ 驾驶室 + 三个轮子。 斗里露矿石是为了和普通「载具」区分开 --> <path fill="currentColor" d="M6 18h26v22H6z"/> <path fill="currentColor" d="M33 24h11l9 9v7H33z"/> <g fill="none" stroke="currentColor" stroke-width="8"> <circle cx="14" cy="44" r="2"/> <circle cx="27" cy="44" r="2"/> <circle cx="45" cy="44" r="2"/> </g>` },
};

export const STAT_ICONS: Record<string, IconDef> = {
  health: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.6-9-9.2A5.2 5.2 0 0 1 12 6.5a5.2 5.2 0 0 1 9 5.3C19 16.4 12 21 12 21z"/></g>` },
  dps: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 14 9l7-2-5 5 5 5-7-2-2 7-2-7-7 2 5-5-5-5 7 2z"/></g>` },
  range: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></g>` },
  vision: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></g>` },
  speed: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11M3 12h16M3 17h8"/><path d="M18 4l3 3-3 3"/></g>` },
  cost: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/></g>` },
  cooldown: { viewBox: "0 0 24 24", body: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M8 2v4l4 4 4-4V2M8 22v-4l4-4 4 4v4"/></g>` },
};
