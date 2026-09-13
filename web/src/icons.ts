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

/**
 * **战斗时间线的标志**（`BattleTimeline.vue`）。
 *
 * 图形是**自己画的**（参考了常见图标语汇，没有照抄任何第三方文件 —— 许可干净）：
 *
 * | 名 | 语义 | 画法 |
 * | --- | --- | --- |
 * | `sword` | **攻击** | 斜向剑：剑尖 + 剑刃 + 护手 + 剑柄 + 圆头 |
 * | `blast` | **受伤** | 放射爆裂：尖边 + 上下两个缺口，像挨了一下 |
 * | `skull` | **死亡** | 骷髅：圆颅（两侧下颌缺口）+ 两眼 + 牙 |
 * | `burst` | **自爆** | 实心八角星 + 中心圆孔：攻击之后自己炸掉（圣甲虫） |
 * | `gas` | **中毒气** | 三角毒气符号：三叶轮 + 圆心孔（催化剂/化武兵/毒车留下的毒雾） |
 *
 * 三条设计约束（都是为了在 **10~13px** 这个尺寸下还能分辨）：
 * ① 只用**大块几何**，不画细碎装饰；
 * ② 姿态**斜向 / 放射 / 正面**各不相同 —— 缩到 12px 时靠轮廓就能区分，不依赖颜色；
 * ③ 全部单色 `currentColor`，颜色交给 CSS（左右方、AoE 各一色）。
 *
 * ⚠️ 填充型的路径里带挖空（眼窝、上下缺口）时**必须写 `fill-rule="evenodd"`**，
 * 否则内圈会被填实，缩到 12px 就变成一坨黑。
 */
export const MARK_ICONS: Record<string, IconDef> = {
  // 攻击：斜向的剑（剑尖朝右上）
  sword: {
    viewBox: "0 0 24 24",
    body: `<g transform="rotate(45 12 12)" fill="currentColor">
      <path d="M12 2 L14.4 5.4 L14.4 13.6 L9.6 13.6 L9.6 5.4 Z"/>
      <path d="M6.6 13.6 H17.4 A0.9 0.9 0 0 1 17.4 15.4 H6.6 A0.9 0.9 0 0 1 6.6 13.6 Z"/>
      <path d="M10.9 15.4 H13.1 V19.6 H10.9 Z"/>
      <circle cx="12" cy="21" r="1.6"/>
    </g>`,
  },
  // 受伤：放射爆裂（尖边 + 上下缺口）
  blast: {
    viewBox: "0 0 24 24",
    body: `<path fill="currentColor" fill-rule="evenodd" d="M12 1.5 L14.8 6.5 L19.5 2.8 L18.4 8.4 L23.5 7.6 L19.6 11.6 L23.5 15.6 L18.4 14.8 L19.5 20.4 L14.8 16.7 L12 21.7 L9.2 16.7 L4.5 20.4 L5.6 14.8 L0.5 15.6 L4.4 11.6 L0.5 7.6 L5.6 8.4 L4.5 2.8 L9.2 6.5 Z M12 8.4 L10.6 10.2 L9 9.4 L9.6 11.2 L8.4 11.9 L9.7 12.4 L9.3 14.2 L10.9 13.3 L12 14.9 L13.1 13.3 L14.7 14.2 L14.3 12.4 L15.6 11.9 L14.4 11.2 L15 9.4 L13.4 10.2 Z"/>`,
  },
  // 死亡：骷髅（圆颅 + **大**眼窝 + 宽下颌缺口）
  //
  // ⚠️ 眼窝尺寸是这份图形里唯一真正要紧的参数：真渲染出来比对过（`out/marks2.png`），
  // 眼窝 r=1.9 时缩到 13px 只剩轮廓、r=3 才勉强看出"两个洞"。这里取 r=3.5（几乎顶满
  // 颅腔宽度），因为**标志的实际显示尺寸只有 13~14px**，细节多一分就多糊一分。
  skull: {
    viewBox: "0 0 24 24",
    body: `<path fill="currentColor" fill-rule="evenodd" d="M12 2.5 C6.8 2.5 3 6.4 3 11.4 C3 14.7 4.4 17.4 6.7 19 L6.7 20.5 C6.7 21.4 7.5 22 8.5 22 L15.5 22 C16.5 22 17.3 21.4 17.3 20.5 L17.3 19 C19.6 17.4 21 14.7 21 11.4 C21 6.4 17.2 2.5 12 2.5 Z M7.9 8.6 A3.5 3.5 0 1 0 7.9 15.6 A3.5 3.5 0 1 0 7.9 8.6 Z M16.1 8.6 A3.5 3.5 0 1 0 16.1 15.6 A3.5 3.5 0 1 0 16.1 8.6 Z M10.2 16.6 L13.8 16.6 L13.8 19.8 L10.2 19.8 Z"/>`,
  },
  // 打不到该类型 / 该武器无节奏：一条灰杠（保留，仍有用）
  miss: {
    viewBox: "0 0 4 10",
    body: `<rect x="0" y="0" width="4" height="10" rx="1" fill="currentColor"/>`,
  },
  /*
   * **自爆**（圣甲虫打完一发就 `TakeHiddenDestroyDamage`）。
   *
   * 与 `blast`（受伤）的区别靠**内部结构**：`blast` 是"外面一圈尖、里面再一个尖角星"
   * 的空心轮廓，`burst` 是**整块实心、只挖一个中心圆孔**。缩到 14px 时
   * 「实心带孔」与「空心」是一眼能分开的，这比靠颜色区分可靠（两色都在橙红系里）。
   * 姿态换成**正八角**（正面对称），也和 `blast` 的不规则略偏斜不同。
   */
  burst: {
    viewBox: "0 0 24 24",
    body: `<path fill="currentColor" fill-rule="evenodd" d="M9.9 2.6 L12 5.3 L14.1 2.6 L15.3 6.1 L18.1 4.4 L18.2 8.1 L21.4 7.6 L20.1 11.1 L23.4 12 L20.1 12.9 L21.4 16.4 L18.2 15.9 L18.1 19.6 L15.3 17.9 L14.1 21.4 L12 18.7 L9.9 21.4 L8.7 17.9 L5.9 19.6 L5.8 15.9 L2.6 16.4 L3.9 12.9 L0.6 12 L3.9 11.1 L2.6 7.6 L5.8 8.1 L5.9 4.4 L8.7 6.1 Z M12 8.9 A3.1 3.1 0 1 0 12 15.1 A3.1 3.1 0 1 0 12 8.9 Z"/>`,
  },
  /*
   * **毒气**（催化剂/化武兵/毒车留下的毒雾）。
   *
   * 画法：**毒气符号**（三角警示牌 + 三叶轮 + 圆心孔）。为什么不用"骷髅+交叉骨"：
   * 那跟 `skull`（阵亡）在 14px 下会撞脸，而这两个标志的语义完全相反
   * （一个是"这员死了"，一个是"这员站在毒里挨了一下"）。
   * 三角 + 三叶轮靠**外轮廓**就能和骷髅分开，符合这份图标的第 ② 条约束。
   */
  gas: {
    viewBox: "0 0 24 24",
    body: `<path fill="currentColor" fill-rule="evenodd" d="M12 1.6 L23 21.2 L1 21.2 Z M12 5.6 L4.1 19.4 L19.9 19.4 Z M12 8.1 A3.5 3.5 0 1 0 12 15.1 A3.5 3.5 0 1 0 12 8.1 Z M12 8.9 A2.7 2.7 0 1 0 12 14.3 A2.7 2.7 0 1 0 12 8.9 Z M11.1 7.3 A1.55 1.55 0 1 1 9.8 8.9 A1.55 1.55 0 1 0 11.1 7.3 Z M11.1 15.9 A1.55 1.55 0 1 1 9.8 14.3 A1.55 1.55 0 1 0 11.1 15.9 Z M14.2 11.1 A1.55 1.55 0 1 1 11.7 9.5 A1.55 1.55 0 1 0 14.2 11.1 Z"/>`,
  },
};
