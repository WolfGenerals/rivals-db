# UI 图标

三类来源，**不要混**：

| 前缀 | 来源 | 说明 |
| --- | --- | --- |
| `cost-*` / `rarity-*` / `faction-*` | C&C Wiki 文件 | 和游戏内一致，直接可用 |
| `type-*.webp` | C&C Wiki 文件（游戏内原版兵种图标） | 仅作设计参考，**页面不用它** |
| `type-*.svg` | **自行设计/绘制** | 见下方「兵种图标」 |
| `stat-*.svg` | **自行绘制** | 见下方说明 |

> ⚠️ 从 wiki 拉下来的文件**扩展名按真实字节走**（多为 `.webp`）。
> Fandom 无论原格式一律返回 WebP，若硬写成 `.png` 会得到「后缀 png、内容是 webp」的假文件。

## 兵种图标（`type-*.svg`）

64×64 统一画布，**只有剪影**，圆底由 `web/src/components/TypeIcon.vue` 画
（这样圆底能单独跟阵营换色）。图形的唯一真相是这些 SVG 文件；
`_svg_icons.py` 只负责把它们的内联标记提取成 `web/src/typeIcons.ts`。

改完图形跑一次：

```powershell
python _svg_icons.py
```

**注意**：`<svg>` 根节点上的呈现属性（如 `fill="currentColor"`）会被提取脚本包一层
`<g>` 带过来 —— 只取内部标记会丢掉它。

素材来源：

| 图标 | 来源 |
| --- | --- |
| `type-infantry.svg` | Material Design Icons `directions-run`（24×24 放大 2.667 倍） |
| `type-vehicle.svg` | Material Design Icons（24×24 放大 2.667 倍） |
| `type-aircraft.svg` | 自行绘制 |
| `type-structure.svg` | 自行绘制 |
| `type-harvester.svg` | 自行绘制 |

> Material Design Icons 采用 **Apache License 2.0**（Pictogrammers）。
> 若本仓库需要更宽松的授权，把这两个换成自绘版本即可，不影响其他部分。

### 为什么不直接描摹游戏原版位图

试过用 `vtracer` 描摹 `type-*.webp`，结论是**不该这么做**：位图只有 64px，
描摹会把抗锯齿的抖动一起矢量化，实测一个房子能出 **115 段三次贝塞尔曲线**，
放大看全是台阶。而且原版的战机是斜 45° 的实心块，缩到 24px 认不出是什么 ——
兵种图标的价值在「表意」，不在「还原」。

## 从 wiki 拉取的

| 文件 | 原始 wiki 文件 | 分辨率 | 用途 |
| --- | --- | --- | --- |

## 本地绘制的（`stat-*.svg`）

HP / DPS / 射程 / 视野 / 速度 / 造价 / 攻击间隔 这几种**数值标签图标 wiki 上没有**。
游戏本体把它们打包在 `published.2x/texturepacks_ui/icons.sba` 这个贴图图集里，
名字是明文可读的：

```
images/icons/Stat/Icon_Stat_Health.png
images/icons/Stat/Icon_Stat_DPS.png
images/icons/Stat/Icon_Stat_Speed.png
images/icons/Stat/Icon_Stat_Base_Health.png
images/icons/Stat/Icon_Stat_HarvesterHealth.png
images/icons/Stat/Icon_Stat_Ability.png
images/icons/Stat/Icon_Stat_Built_From.png
images/icons/Stat/Icon_Stat_Excite.png
images/icons/Stat/Icon_Stat_Strength.png
images/icons/Battle/Icon_Battle_{Infantry,Vehicle,Aircraft,Structure}[_Strong|_NoAttack].png
```

但这些精灵存在 **ETC 压缩的图集里**（`.sba` 是 SBIN 容器，内含 TexturePack 元数据 +
一张压缩纹理，**没有 KTX 头**），要取出得先逆向纹理格式。

权衡后改为**本地画 SVG**：24×24 视口、`stroke="currentColor"`，跟着 CSS 主题色变，
任意缩放不糊，也没有素材版权问题。小尺寸符号图标这样比抠图集划算。

若日后确实需要游戏原版图标，`.sba` 里的精灵名与 `source_rect` 都是明文，
缺的只是 ETC 解码那一步。

