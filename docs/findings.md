# 结论台账

**这个文件的用途：本项目每得出一个结论，都要在这里留一条记录。**

约定：

- 一条结论 = 一行，包含 **结论 / 证据 / 状态**。证据必须是可复查的东西：
  文件路径 + 行号、命令、实测数据、或产物字段。
- 状态只有四种：
  - `✅ 已确认` —— 有直接证据，或已被实测数据验证
  - `⚠️ 推断` —— 逻辑上成立但缺直接证据，写明推断依据
  - `❓ 待验证` —— 有假设，需要下一步动作去证实/证伪
  - `❌ 已推翻` —— 曾经认为是这样，后来被证据否定（**保留不删**，避免重复踩坑）
- 推翻旧结论时，把旧那条的状态改成 `❌ 已推翻`，并写清是**什么证据**推翻的。
- 详细展开写在对应的 `docs/*.md` 专题文档里，这里只放指针。

专题文档：

| 文档 | 内容 |
| --- | --- |
| `docs/level-scaling.md` | 等级倍率公式（最终式 + 推导过程） |
| `docs/data-semantics.md` | 字段语义与陷阱 |
| `docs/extraction.md` | 数据提取原理（Python 版） |
| `docs/output-format.md` | JSON 产物格式 |

---

## A. 数据源与提取

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| A1 | 单位数值的权威来源是随客户端分发的**原始 Lua 开发源码**，不是反编译产物 | `tmp/.../gameplay/units/*.lua`；保留开发注释（`unit_gdi_riflemen.lua:23 -- This is unsed`）、tab 缩进、`oldTuning = unit_gdi_riflemen,` 调试残留 | ✅ 已确认 |
| A2 | 必须用**真实 Lua 运行时**求值，正则/手写解析必失败 | 文件含 `CombatantDescriptor.Vehicle \| CombatantDescriptor.Infantry` 原生位运算、`Fixed32.fromValue()`、`MakeOverride()`、`nTuningUtil.GetProjectileTuning(...)` 跨文件引用 | ✅ 已确认 |
| A3 | Node 侧用 **wasmoon 1.16.0**（Lua 5.4 + WASM）可行；但**只加载真实模块** `TuningUtil.lua` + `CombatTuningInfo.lua`，其余用桩 | 见 `core/src/extract/luaRuntime.ts` 的 `REAL_MODULES` | ✅ 已确认 |
| A4 | 桩的行为：未定义全局返回「自动表」；枚举返回名字字符串；`CombatantDescriptor` 返回 2 的幂数字；`Fixed32` 走元表 | `core/src/extract/luaRuntime.ts` | ✅ 已确认 |
| A5 | 两遍求值：第一遍注册全部 tuning，第二遍再跑需要解引用的代码 | `core/src/extract/extract.ts` `loadUnits` | ✅ 已确认 |
| A6 | `game-config.pb` 是**裸 protobuf**（无 `.proto`），可按 wire format 手写解析 | `core/src/extract/gameConfigPb.ts`；路径 `$.55` 道具容器、`$.55.2.19` = luaName、`$.55.2.2.1` = name loc key | ✅ 已确认 |
| A7 | 本地化 `app.sb` 是 **SBIN 容器**，记录区是 **NUL 分隔的 `key\0value\0` 交替** | `data/locale/*.json`（en 3187 / zh 3107 / cht 3111 / ja 3124 条） | ✅ 已确认 |
| A8 | 本地化解析必须用**前瞻**，因为存在「只有 key 没有 value」的条目 | `UI_GDI_SLINGSHOT` 与 `UI_GDI_SLINGSHOT_COMBAT` 相邻导致简单交替错位 | ✅ 已确认 |

---

## B. 等级倍率

公式与完整推导见 `docs/level-scaling.md`。结论摘要：

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| B1 | 等级由 major/minor 两段组成，**minor 的底数在 major 4→5 处分段** | 实测 28/28 血量为整数吻合 | ✅ 已确认 |
| B2 | `F = 1.05^min(major-1,3) × 1.10^max(0,major-4) × c(major)^minor`，其中 `c = 1.008293 (major≤4) / 1.01 (major≥5)` | `docs/level-scaling.md` | ✅ 已确认 |
| B3 | HP 用 `floor`（定点的 `:toInt()` 截断），DPS 用 `round(...,1)`（`:toFloat()`） | `FIX32` 命名暗示定点取整；28/28 HP、26/28 DPS 吻合 | ✅ 已确认 |
| B4 | 面板 DPS 的官方定义就是 `damage / cooldown` | `gameplay/tuning/TokenUtil.lua:5`：`return { "dps", mainWeapon.damageTuning.default / mainWeapon.burstTiming.cooldown }` | ✅ 已确认 |
| B5 | 起始 major = `2 × 稀有度编号 − 1`（Common→1 / Rare→3 / Epic→5） | 经验式，实测吻合 | ⚠️ 推断（未在 pb 中找到直接定义） |
| B6 | `chargeUpDuration` **不**包含在 `cooldown` 里，开火间隔就是 `cooldown` | 36 把武器 `chargeUp > 0`；`unit_nod_wraith` 甚至 `chargeUp 0.1 > cooldown 0.035`，若相加则自相矛盾。C++ `FUN_01a256d4` 把它们存在不同 struct 偏移 | ✅ 已确认 |
| B7 | ~~开火周期 = `chargeUp + cooldown` 相加~~ | ❌ 被 B6 推翻。玩家在游戏中实测：捕食者「开火间隔约 3 秒多，开火前约 1 秒激光瞄准」= `cooldown 3.44` 为周期，1.00s 蓄力是**尾部**而非前置相加 | ❌ 已推翻 |
| B8 | ~~minor 全段统一底数 1.01~~ | ❌ 被 B1 推翻：只有 major≥5 段是 1.01，major≤4 段是 1.008293 | ❌ 已推翻 |
| B9 | ~~逐级取整（每级 round 后再乘下一级）~~ | ❌ 被实测数据推翻，必须一次性乘完再取整 | ❌ 已推翻 |

---

## C. 字段语义陷阱

完整版见 `docs/data-semantics.md`。

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| C1 | `health` 是**每员**血量，小队总血 = `health × waveSize` | 实测：riflemen 9-0 = 1211 ≈ 130 × 5 × F(9,0) | ✅ 已确认 |
| C2 | `goodAgainstTags` 是 **AI 索敌偏好，不是伤害克制** | 80 把武器里 `goodAgainstTags` 与 `overrides` 一致数 = 0；只有 13/80 的 overrides 高于默认伤害 | ✅ 已确认 |
| C3 | 真实克制关系只看 `damageTuning.overrides` | 同 C2 | ✅ 已确认 |
| C4 | `muzzleCount` 只在 `muzzleStrategy == "All"` 时才算多管 | `docs/data-semantics.md` | ✅ 已确认 |
| C5 | `targetSelector` 几乎全是 `unit_antiInfantry`（83/83），不能用它判断兵种定位 | 全部单位文件 | ✅ 已确认 |
| C6 | `descriptors` 里的 `CombatantDescriptor` 数字是**桩编造的 2 的幂**，不可当作真实掩码 | `core/src/extract/luaRuntime.ts` 的 `autoattr` | ✅ 已确认 |
| C7 | 只有 `modifier_sequence` 单位（22 个）的时序在 Lua 里（`ability_simple_weapon_sequence`，字段单位是 **ms**）；捕食者/犀牛/虫车/方尖碑/APC/MLRS 走引擎 C++ 时序，未逆向 | 对照 22 个文件与其余文件 | ✅ 已确认 |
| C8 | 后摇 / 攻击冷却的**动作级**含义尚未逐帧核对，暂按原变量名保留 | 用户提议日后用视频逐动作统计 | ❓ 待验证 |

---

## D. 单位与指挥官条目

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| D1 | 单位/指挥官记录共 **103** 条（84 单位 + 19 指挥官） | `data/unit/` 84 个 + `data/commander/` 19 个 | ✅ 已确认 |
| D2 | 其中 **84 条真正随客户端发布**（在 `game-config.pb` 里能按名字命中），19 条不在 | `_pb_presence.py` 输出 84/103 | ✅ 已确认 |
| D3 | `unit_example` / `unit_dlc_test` / `cmdr_dlc_test` 不在 pb 内，且无本地化，是**模板文件**，不是真实单位 | `_pb_presence.py`；`game-config.pb` 中无这三个字符串 | ✅ 已确认 |
| D4 | `_CR` 后缀条目（8 个指挥官 + 4 个单位）**不在 pb 内**，未注册为道具；但与基础单位**显示名完全相同** | `_pb_presence.py`；`cmdr_nod_jade` 与 `cmdr_nod_jade_CR` 的 `name_en` 都是 `'Jade'` | ✅ 已确认 |
| D5 | `_CR` 具体含义**仍未确定**，但已确认它**不是可解锁条目**：`game-config.pb` 里**完全没有** `_CR` 变体的条目（搜 `_CR` 得到的 74 次全是 `CRATE` / `CREDITS` 之类巧合子串）。它们只是随包分发的 Lua 调参源码，从未注册成道具，所以游戏里根本不会出现 | `_pb_presence.py`；`_pb_release.py`；pb 全量字符串扫描 | ✅ 已确认（含义仍 ❓） |
| D6 | `_ST` 后缀（4 个 GDI 单位）**在 pb 内**，且显示名独立：`Steel Talon Juggernaut` / `Steel Talon Mohawk` / `Steel Talon Sandstorm` / `Steel Talon Zone Trooper` | `_pb_presence.py`；`data/locale/*/UI_GDI_*_ST` | ✅ 已确认 |
| D7 | `_mayhem` 后缀（3 个单位）不在 pb 内，是 **Mayhem 活动模式**专用条目 | `_pb_presence.py`；本地化键 `LOC_RIVALS_MAYHEM_EVENT_TITLE`、`UI_EVENTS_BATTLEMODE_BODY_MAYHEM` | ✅ 已确认 |
| D8 | `unit_nod_stormtroopers` **在 pb 内**但**没有本地化键**（`UI_NOD_STORMTROOPERS` 不存在），显示名为空 | `_pb_presence.py`；`_show.py stormtroopers` 的 `name_en=None` | ❓ 待验证（是被砍掉又残留的单位？） |
| D10 | `unit_nod_stormtroopers` 的**游戏内身份是「Laser Squad / 激光小队」**。证据分三层：<br>① pb 记录里显示名 key 是 `UI_NOD_STORMTROOPERS_COMBAT`（本地化表里没有这个键），但描述键落在 `UI_NOD_LASERTROOPER_ITEM_DESCRIPTION` / `..._FLAVOR_DESCRIPTION`；<br>② en 表 `UI_NOD_LASERTROOPER` = `"Laser Squad"`、zh 表 = `"激光小队"`；VO 事件名 `Play_VO_Laser_Squad_Equip`；<br>③ **数值逐项吻合**：游戏 220 血/员、造价 20、对步兵 35、开火间隔 5s、索敌 Vehicle+Aircraft ↔ wiki `Laser squad` 页写 "220 per squad memeber, 880 total / 20 / 35 (28 DPS) / 5 seconds / Anti-armor/anti-air infantry / Laser guns" | pb 偏移 282727 dump；`data/locale/{en,zh}.json`；`data/unit/unit_nod_stormtroopers.lua.json`；`tmp/cnc-central/page-wikitext.json` 的 `Laser squad` | ✅ 已确认 |
| D10b | 显示名已按 D10 回填为 `Laser Squad` / `激光小队`，做法是在 `_build_locale.py` 里加 `NAME_KEY_ALIAS`（pb 的显示名 key 是改名没改干净的残留） | `_build_locale.py`；`_show.py stormtroopers` 输出 `name_en='Laser Squad' name_zh='激光小队'` | ✅ 已确认 |
| D11 | pb 里每个道具的字段：`2.1` = 显示名 loc key（如 `UI_NOD_SCORPIONTANK_COMBAT`），`2.19` = lua 名，另有 key art / portrait 素材路径、稀有度、解锁等级、发布日期。**显示名 key 是 `_COMBAT` 后缀那一个**，不是 `UI_<FACTION>_<VARIANT>` | pb 偏移 282727 / 362460 附近 dump | ✅ 已确认 |
| D12 | **钻地舱 `unit_nod_drillpod` 就是塞斯的潜地仓**：`cmdr_nod_seth.lua` 里 `spawnUnitTuning.unitNameId = "Unit_Nod_DrillPod"`，技能名 `ability_drill_pod`。它召出的单位：本体 = `Unit_Nod_FlameTroopers`，`_CR` 变体 = `Unit_Nod_Cyborg` | `gameplay/commanders/cmdr_nod_seth.lua`；`gameplay/units/unit_nod_drillpod.lua` 的 `modifier_drillpod_intro.tuning.unitNameId`；`unit_nod_drillpod_CR.lua` 同字段 | ✅ 已确认 |
| D13 | 潜地舱的显示名同样是**改名残留**：pb 的 key 是 `UI_NOD_DRILLPOD_COMBAT`（zh/en 表里都没有），真正的名字挂在技能键 `UI_ABILITY_DRILL_POD` 上（zh = **潜地舱**、en = Drill Pod）。已按 D10b 的同样办法加进 `NAME_KEY_ALIAS` | pb 偏移 351736 dump；`data/locale/{zh,en}.json` 的 `UI_ABILITY_DRILL_POD` | ✅ 已确认 |
| D14 | **中文本地化本身缺一条**：`UI_GDI_ZONETROOPER_ST` 在 zh 表里不存在（cht「鋼爪區域裝甲兵」/ ja / en 都有），导致 `unit_gdi_zonetrooper_ST` 没有中文名。补救方式是套用同族规律 —— 其余三个 `_ST` 键都是「钢爪 + 本体名」（`UI_GDI_JUGGERNAUT_ST` = 钢爪神像机甲 等），于是补成 **钢爪区域装甲兵**，与 cht 值一致 | `data/locale/*.json` 的 `*_ST` 键对照；`_build_locale.py` 里的 ST 兜底 | ✅ 已确认 |
| D15 | 补完后**只有 3 条没有显示名**：`unit_example` / `unit_dlc_test` / `cmdr_dlc_test`（模板文件，不在 pb 内） | 全量扫描 `data/{unit,commander}/*.lua.json` | ✅ 已确认 |
| D16 | **pb 里能判定「是否上线」**：每条道具记录的 luaName **之前 <160 字节**处有一个 ISO 时间戳；**3030 年是「永不发布」的哨兵值**，已上线条目的日期都在 2018~2022。⚠️ 取日期必须限制距离——不设上限的话，没有日期字段的记录会捞到上一条的日期（曾把 Confessor / Scorpion Tank / Kane 误判成未上线） | `_pb_release.py`；`unit_gdi_mohawkgunship_ST` 的 `3030-02-05T09:00:00-08:00` | ✅ 已确认 |
| D17 | **4 个 `_ST`（Steel Talon / 钢爪）单位都没上线**：`unit_gdi_{juggernaut,mohawkgunship,sandstorm,zonetrooper}_ST` 的发布日期都是 3030。所以本地化表里「钢爪莫霍克武装直升机」这类名字是真实存在的**预备文案**，但玩家在游戏里永远看不到 —— 这解释了用户「游戏里没看到钢爪两个字」的观察 | `_pb_release.py` 的未上线清单 | ✅ 已确认 |
| D18 | 103 条的最终可见性分布：**已上线 79**（30 条带 2018~2022 日期 + 49 条首发批次无日期字段）；**永不发布 5**（4 个 `_ST` + `cmdr_nod_marcion`）；**不在客户端 19**（16 个 `_CR`/`_mayhem` 变体 + 3 个模板） | `_pb_release.py`；`_pb_presence.py` | ✅ 已确认 |
| D19 | 两类「看不到」的原因不同，别混为一谈：<br>· **`_CR` / `_mayhem`** = pb 里根本没注册，是只存在于 Lua 源码里的死代码（数值与本体不同，应当是服务端改动用的）<br>· **`_ST`** = pb 里注册了（`unitEpic` / `unitCommon`），但发布日 3030 = 永不发布 | 同上 | ✅ 已确认 |
| D9 | `unit_nod_stormtroopers` 不是 `unit_nod_militant` 的旧名：数值完全不同（storm: cost 20 / 220hp / waveSize 4 / dmg 250 / cd 5s；militant: cost 10 / 130hp / waveSize 5 / dmg 38 / cd 1.72s） | 两份 lua 对照 | ✅ 已确认 |

---

## E. 美术资源

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| E1 | 之前抓图只拿到 174 张，是**不完整**的；分页重抓 `aiprefix=CNCRiv` 得到 **731 张** | `_art_full.py list`；`cnc.fandom.com` 731 / `cnc-central.fandom.com` 只有 174 | ✅ 已确认 |
| E2 | 卡片图尺寸是 **270×324**，且卡框颜色编码稀有度（紫 = Epic） | 尺寸分布统计：270×324 共 82 张 | ✅ 已确认 |
| E3 | 图名命名规律：`CNCRiv_<名>.png` 卡面 / `_art`/`_concept_art`/`_art_promo_crop` 立绘 / `_stand`/`_engage`/`_rear`/`_move`/`_deployed` 动作图 | `_ls_imgs.py` 全量清单 | ✅ 已确认 |
| E4 | 匹配必须用**游戏内显示名**（`name_en`），不能用 Lua 变量名 | `rangers`→"Sniper Team"、`firebomber`→"Inferno"、`viper`→"Phantom"、`wraith`→"Shade"、`beamcannon`→"Giga-Cannon"、`rockettroopers`→"Missile Squad" | ✅ 已确认 |
| E5 | Fandom API 返回的标题会把 `_` 规范化成空格，必须用 `normalized` 字段才能对上 key | 见踩坑记录 | ✅ 已确认 |
| E6 | `prop=images` **不可用**：会把 navbox 里的图片也算进来，导致每页都命中同一个文件 | 实测每页都取到 `CNCRiv A.P.C..png` | ✅ 已确认 |
| E7 | 多词 / `intitle:` 搜索返回 0 条，只能搜单词 `Rivals`；`allimages` 分页才可靠 | `_confirm_missing.py` 的多词查询全空 | ✅ 已确认 |
| E8 | Fandom 实际按 **WebP** 提供图片，与返回的 `mime` 无关，必须嗅探魔数决定扩展名 | `_art_full.py` 的 `sniff()` | ✅ 已确认 |
| E9 | 指挥官技能图挂在**技能名**下而非指挥官名下 | Strongarm→`Minigun Turret`、Dr. Liang→`Repair Drone`、Solomon→`Ion Cannon`、Jackson→`Heroic Charge` | ✅ 已确认 |
| E10 | 指挥官异画皮肤存在（652×366），共 12 张：Jade/Kane/Liang/Oxanna/Seth/Solomon 各 2 | `CNCRiv_Jade_obsidian.jpg` 等 | ✅ 已确认 |
| E11 | ~~GDI 基地炮台 `unit_gdi_turret` 对应的 wiki 图是 `CNCRiv_Minigun_Turret.png`~~ | ❌ **已推翻**。那是 **Strongarm 的技能卡**，不是炮台的图。炮台是基地建筑，**游戏里本来就没有商店卡面** | ❌ 已推翻 |
| E11b | **不是所有条目都该有图标**。`game-config.pb` 里有没有**稀有度**就是「是不是收集品」的判据：<br>· 收集单位 70 条 → **70/70 有卡面**<br>· 指挥官 18 条 → 17 有<br>· **非收集品 12 条 → 本来就没有卡面**<br>· 模板 3 条 → 没有 | `_wiki_page_art.py report` → `docs/art-coverage.md`；判据来自 `data/index.json` 的 `rarity` 字段 | ✅ 已确认 |
| E11c | 12 条非收集品是：运矿车 4（GDI/Nod × 普通/mayhem）、GDI 炮台 2（`unit_gdi_turret`/`_CR`）、Nod 方尖碑 2、钻地舱 2（Seth 技能）、修理无人机 2（梁博士技能）。它们是基地建筑或技能召唤物，不进卡组 | 同上 | ✅ 已确认 |
| E11d | 非收集品在 wiki 上能搜到的同名图（`CNCRiv Harvester.png` 64×64、`CNCRiv Drill Pod.png`、`CNCRiv Repair Drone.png`、`CNCRiv Obelisk of Light.png`）都是**技能图 / 建筑图**，不能当单位图标用 | 同上 | ✅ 已确认 |
| E12 | 运矿车没有 270×324 卡面，只有 `CNCRiv_GDI_Harvester.png` / `CNCRiv_Nod_Harvester.png`（300×300 渲染图） | `_ls_imgs.py Harvester` | ✅ 已确认 |
| E13 | `cmdr_nod_marcion` 在 wiki 上**没有 Rivals 立绘**，只有凯恩之怒时代的图 | `_confirm_missing.py` 穷尽搜索；731 张清单中无 `Marcion` 相关 Rivals 图 | ✅ 已确认 |
| E14 | `data/art/` 里仓库内自带 wiki/EA 素材，需在 README 标注来源与授权 | wiki 内容通常 CC-BY-SA | ⚠️ 待处理 |
| E15 | 用 731 张完整清单按**文件名**匹配的结果：103 条里 99 条有图标、79 条有立绘。⚠️ 此法按名字猜，不如 E22 的字段法可靠，已被 E23 取代 | `_art_full.py report`（旧） | ❌ 已推翻（改用 E22/E23 的字段法） |
| E16 | 缺图标的只有 **4 条**：`cmdr_dlc_test` / `unit_dlc_test` / `unit_example`（模板，非真实单位）+ `cmdr_nod_marcion` | 同上 | ✅ 已确认 |
| E17 | 图标分辨率 **95 张是 270×324**（标准卡面），另 **4 张退化为 300×300** 三维渲染图 | `_art_full.py report` 分辨率统计 | ✅ 已确认 |
| E18 | 立绘共 13 种分辨率，主流是 1184×608（29 张）/ 1685×867（12 张）/ 1920×1530（9 张）/ 1683×864（7 张） | 同上 | ✅ 已确认 |
| E19 | 映射共 249 项，其中 **198 项本地已下载**，只需补 **51 项（涉及 34 个单位）** | `_art_status.py`（不联网，查 `data/art` + `tmp/art2` + `tmp/art3`） | ✅ 已确认 |
| E20 | pb 里存有每个条目的**游戏内素材路径**（`images/commander/key_art/*.png`、`images/portraits/<阵营>/ui_portrait_*.png`、`images/progressionUI/keyart/*.png`），但这些图**不在 APK 内** | `.idx/asset_list_*.txt` 全量搜索无 `ui_portrait_*`/`key_art/*` 命中；`published.texture_etc/UI` 只有 13 个贴图（格子背景之类） | ✅ 已确认 |
| E21 | `cmdr_nod_marcion` 从未上线，所以 wiki 没有它的 Rivals 立绘 | pb 条目里 `Marcion needs a description -- FIXME 1/2`，且发布日字段是 `3030-05-07T09:00:00-07:00` | ✅ 已确认 |
| E22 | **取图的权威位置是 wiki 页面的固定字段**，不是文件名猜测：<br>· 单位图标 = `{{UnitBox}}` 的 `\|name = [[File:CNCRiv X.png\|100px]]`<br>· 指挥官图标 = `{{CharBox}}` 的 `\|image`，或卡面 `CNCRiv <名> card.png`<br>· **立绘 = `== Gallery ==` 段里 `<gallery>` 块的条目**<br>· 动作图 = `{{UnitBox}}` 的 `\|slides = File:X stand.png {{!}} Stand` | `tmp/cnc-central/page-wikitext.json`；例：`Avatar (Rivals)` 的 Gallery 是 `CNCRiv Avatar art.png\|Art` 与 `CNCRiv Avatar concept art.jpg\|Design by Joseph Carabajal` | ✅ 已确认 |
| E23 | 按上述字段解析 + 按「有无稀有度」分类后的最终结果：**收集单位 70/70 有卡面**；指挥官 17/18（只缺 `cmdr_nod_marcion`）；非收集品 12 条**本来就没有卡面**；模板 3 条没有 | `_wiki_page_art.py report` → `docs/art-coverage.md` | ✅ 已确认 |
| E24 | **真实可获得图标的条目只有一个缺口：`cmdr_nod_marcion`**（从未上线）。除此之外所有收集品与指挥官都有图 | 同上 | ✅ 已确认 |
| E25 | navbox 给出 **69 个页面 ≈ 真实单位数**（84 条记录 − 2 个模板 − 12 个变体 − 建筑/运矿车 ≈ 70），所以**它作为"单位清单"是够的**。但 navbox 里的标题大量是**重定向名或红链**（`Rifleman squad (Rivals)`→实际页 `Riflemen (Rivals)`、`Machine Gun Squad (Rivals)`→`MG squad`、`Mobile Rocket Launcher System (Rivals)` 是红链），按标题精确匹配只能覆盖 **58/84** 个单位记录 | `_wiki_page_art.py fetch`；navbox-only 匹配统计 | ✅ 已确认 |
| E25b | ~~navbox 会漏页，所以不能用~~ | ❌ 说过头了。navbox 的数量本身正常；真正的问题是**标题不规范**（重定向/红链）以及**指挥官在另一个模板里**。分类并集（106 页）的价值是给出**规范页面标题**，不是"页数更多" | ❌ 已推翻 |
| E25c | 取规范页面标题用 wiki 分类：`Category:Rivals vehicles`(33) / `infantry`(18) / `aircraft`(17) / `buildings` / `characters`(9 个指挥官页) / `support powers`，并集 106 页 | `tmp/cnc-central/rivals-page-titles.json` | ✅ 已确认 |
| E26 | 单位页面的 infobox 有两种闭合写法：`Avatar` 是换行后 `\n}}`，**`A.P.C. (Rivals)` 是同行 `\|turnspeed=400}}`**。按 `\n}}` 找结尾会整页解析失败，必须用「框开始后第一个空行」当边界 | `tmp/cnc-central/page-wikitext.json` 的 `A.P.C. (Rivals)`，全文不含 `\n}}` | ✅ 已确认 |
| E27 | 指挥官在 wiki 上的页面名和游戏内 lua 名不一致，需手工挂：`cmdr_gdi_jackson`→`Jackson`、`cmdr_gdi_liang`→`Liang`、`cmdr_gdi_solomon`→`James Solomon`、`cmdr_gdi_strongarm`→`Strongarm`、`cmdr_nod_jade`→`Jade Liang`（Jade 和梁博士共用一个页面）、`cmdr_nod_kane`→`Kane`、`cmdr_nod_oxanna`→`Oxanna Kristos`、`cmdr_nod_seth`→`Seth`；`cmdr_gdi_mcneil` / `cmdr_nod_marcion` **没有页面** | `tmp/cnc-central/rivals-page-titles.json` | ✅ 已确认 |
| E28 | 少数单位 wiki 只给了低分辨率图标，需要另行挑图：`unit_gdi_harvester` / `unit_nod_harvester`（只有 64×64 的 `CNCRiv Harvester.png`，另有 300×300 的 `CNCRiv GDI/Nod Harvester.png`） | `docs/art-coverage.md` | ⚠️ 待处理 |
| E29 | **`data/img/` 只放图标，不放立绘**（用户决定）。最终 **87 个文件 / 2.0 MiB**，命名 `<id>.webp` | `_build_img.py build`；`data/img/` | ✅ 已确认 |
| E30 | 图标覆盖率：**收集单位 70/70**；指挥官 17/19（缺 `cmdr_dlc_test` 模板与 `cmdr_nod_marcion`）；12 条非收集品本来就没有；3 条模板没有 | 同上 | ✅ 已确认 |
| E31 | 变体（`_CR`/`_ST`/`_mayhem`）在 wiki 上没有自己的图，落盘时**复用本体文件**；同一张 wiki 图只下载一次（先落 `tmp/img-cache/`，再复制到各 id）。只写图标时：本地可复制 68 项，仅需下载 5 张唯一图 | `_build_img.py` 的 `build_targets()` / `DL_CACHE` | ✅ 已确认 |
| E32 | 踩坑：判断「文件已存在」不能用 `glob(f"{stem}.*")`——对图标 `stem=<id>` 来说它还会匹配到 `<id>.art.webp`，会把图标误判成已存在而永久跳过（`cmdr_gdi_liang_CR` / `cmdr_gdi_solomon_CR` 就这么丢的）。必须比较 `f.stem == stem` | `_build_img.py` 写盘循环 | ✅ 已确认 |
| E33 | **wiki 上不少单位就是没有立绘**。立绘只存在于页面 `== Gallery ==` 段，而 22 个页面的 Gallery 里没有任何 Rivals 图，包括 `Drill pod`、`Minigun turret`、`Obelisk of Light (Rivals)`、`Ion cannon (Rivals)`、`Heroic charge`、`Fanaticism`、`Mobile construction vehicle (Rivals)` 以及各类建筑/元页面。所以"art 不全"是 wiki 的上传缺失，不是提取漏了 | `_wiki_page_art.py` 解析 `tmp/cnc-central/page-art-parsed.json`；22 个页面 Gallery 为空或无 `CNCRiv` 条目 | ✅ 已确认 |
| E34 | 全量立绘（不设上限时）共 239 张，其中大部分本地已有；`_build_img.py build all` 可随时补落盘 | `tmp/cnc-central/art-plan.json`（324 项 = 85 图标 + 239 立绘） | ✅ 已确认 |
| E35 | **踩坑：`cmdr_gdi_jackson` / `_liang` / `_solomon` / `_strongarm` 曾被写成技能图**（Heroic Charge / Repair Drone / Ion Cannon / Minigun Turret），而不是指挥官本人卡面。原因：早期 `_build_art2.py` 里有 `COMMANDER_ABILITY_IMAGES` 把技能图挂到了指挥官上，产物落在 `data/art/` 与 `tmp/art2/`；落盘脚本按 unit_id 兜底取材时抄到了这些错误文件。**验证方法**：`_cmp_cmdr.py` 对比 wiki 原图 sha1 —— `cmdr_gdi_strongarm.webp` 曾是 `420fefb18860`（= `CNCRiv_Minigun_Turret.png`），现为 `959fa171e7ee`（= `CNCRiv_Strongarm_card.png`） | `_cmp_cmdr.py CNCRiv_Strongarm_card.png …`；`data/img/cmdr_gdi_strongarm.webp` | ✅ 已确认（已修） |
| E36 | **修法**：图标取材**只认 wiki 原名精确匹配，绝不按 unit_id 兜底**；`LOCAL_DIRS` 剔除 `data/art/`；`resolved` 缓存的第一轮循环也不能用 by_unit 兜底（否则错误文件会被缓存下来并复用）。修完 9 个指挥官与 wiki `_card.png` 哈希**全部一致** | `_build_img.py`；`_cmp_cmdr.py` 输出 9/9 匹配 | ✅ 已确认 |
| E37 | 踩坑：`url_of` 字典用 `norm(name)` 建键（保留 `CNCRiv` 前缀），查询用 `wiki_key()`（去前缀），键不一致导致 5 张图找不到 URL 而全部下载失败。必须两边都用 `wiki_key()` | `_build_img.py` 的 `url_of` 构造 | ✅ 已确认 |
| E38 | 图标**不能**从 `tmp/art2` / `tmp/art3` / `data/art` 按 unit_id 取材，这些暂存目录里混有早期错误产物。修完的最终取材数：本地可复制 63 项，需下载 10 张唯一 wiki 图 | `_build_img.py build` 输出 | ✅ 已确认 |
| E39 | **运矿车没有卡面，改用艺术图截取**：wiki 上只有横构图 `Rivals_GDI_Harvester.jpg`(909×465) 与 `Rivals_Nod_Harvester.jpg`(1184×608)（cnc.fandom 上叫 `CNCRiv_GDI_Harvester_art.jpg` / `CNCRiv_Nod_Harvester_art_early.jpg`）。截法：手工量车体窗口 → 放大模糊铺底 → 等比缩放置中贴前景，得到 270×324 不变形 | `_crop_harvester.py`；`data/img/unit_{gdi,nod}_harvester*.webp` | ✅ 已确认 |
| E40 | **非收集品的图标用指挥官技能图代替**（用户决定）：GDI 炮台→`Minigun Turret`(Strongarm)、Nod 方尖碑→`Obelisk of Light`(Kane)、修理无人机→`Repair Drone`(Liang)、钻地舱→`Drill Pod`(Seth)。这些技能图正好也是 270×324，视觉统一 | `_build_img.py` 的 `ICON_SUBSTITUTE`；`data/img/unit_gdi_turret.webp`、`unit_nod_drillpod.webp` 已目视确认 | ✅ 已确认 |
| E41 | 补完后 **`data/img/` 共 95 个图标**，仍无图标的只剩 4 个：3 个模板（`unit_example` / `unit_dlc_test` / `cmdr_dlc_test`）+ `cmdr_nod_marcion`（从未上线）。**收集单位 70/70、指挥官 17/19** | `data/img`；覆盖率统计 | ✅ 已确认 |

---

## F. 工程与流程

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| F1 | `tmp/` 是 gitignore 的，**不要动**（含约 3 GB 的 `tmp/ghidra`） | 用户明确要求 | ✅ 已确认 |
| F2 | 仓库内脚本必须**无 BOM**：`Set-Content -Encoding UTF8` 在 Windows PowerShell 5 下会写 BOM，导致 Vite/PostCSS 报 `Unexpected token ''` | 曾污染 8 个文件 | ✅ 已确认 |
| F3 | Node 24 原生 TS type-stripping 下，import 必须带 **`.ts` 扩展名**，并开 `allowImportingTsExtensions` | `tsconfig.base.json` | ✅ 已确认 |
| F4 | `@rivals/core` 若 barrel 里 re-export Node-only 的 `./extract`，Vite 会把 wasmoon 外部化导致浏览器构建失败 → 必须拆 subpath exports | `core/package.json` exports 映射 | ✅ 已确认 |
| F5 | `name_en` 只有 **78/84** 个单位文件有；缺的正是上面 D3/D8 那些模板与无名条目 | `_show.py` 扫描 | ✅ 已确认 |

---

## G. 网页

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| G1 | 路由改用 **vue-router 4 + `createWebHashHistory`**（用户决定）。选 hash 模式的硬理由：`base: "./"` 的产物要能放在任意子路径（GitHub Pages 的 `/<repo>/`），且 `file://` 直接打开也要能跑 | `web/src/router.ts`；`web/package.json` 新增 `vue-router` | ✅ 已确认 |
| G2 | **单位展示卡片只需要两个入参**：`unit: EntityRecord` 与 `level: Level`。组件内部**不做任何 IO**、不读全局状态 | `web/src/components/UnitCard.vue` | ✅ 已确认 |
| G3 | 之所以不用改 extract，是因为单条记录里已经自带渲染所需的一切：`name_zh` / `name_en`（由 `_build_locale.py` 回填）、`pb.rarity`、完整的 `config`（所以 DPS 能用 `unitBaseDps()` 精确算，正确处理 MLRS 那类弹夹武器）、图标路径由 `id` 推出 | `data/unit/unit_gdi_mlrs.lua.json`；`web/src/components/UnitCard.vue` | ✅ 已确认 |
| G4 | 图标路径约定：`data/img/<id>.webp`，用 `import.meta.env.BASE_URL` 拼接，从而在子路径部署与 `file://` 下都能找到 | `UnitCard.vue` 的 `icon` computed | ✅ 已确认 |
| G5 | 一次取回全部 103 条记录只要 **0.29 MiB**（unit 84 个 0.26 MiB + commander 19 个 0.03 MiB，平均 3.1 KiB / 1.5 KiB），比索引 44.7 KiB 大不了多少。所以「为了少发请求而把 DPS/名字塞进索引」不值得，直接并发拉全量记录即可 | `data/unit`、`data/commander` 体积统计；`web/src/data.ts` 的 `loadAllRecords()` | ✅ 已确认 |
| G6 | 等级控制提到顶栏成为**全局唯一**控件（`state.ts` 本就是单例），列表页与详情页不再各自放一份 | `web/src/components/LevelControls.vue`、`web/src/App.vue` | ✅ 已确认 |
| G7 | 旧的表格预览页没删，挪到 `#/table`。原因：横向对比数值时表格比卡片墙好用 | `web/src/router.ts` 路由表 | ✅ 已确认 |
| G8 | **踩坑：开发服务器运行时不能跑 `sync-data`**。`sync-data.mjs` 会 `rm -rf web/public/data`，而 Vite 正在 watch 该目录，Windows 上直接抛 `EBUSY: resource busy or locked` 并让 dev server 退出。改完数据要重跑 `pnpm dev`（脚本本身开头就会先 sync） | `job_output pwsh-7` 的 `EBUSY ... cmdr_dlc_test.lua.json` 栈 | ✅ 已确认 |
| G9 | **同类坑（更隐蔽）：在 `web/src/` 下编辑文件也会崩 dev server**。工具保存文件是「先写 `.X.vue.<pid>.<guid>.tmpdir/X.vue.tmp`，再原子替换」，Vite 会去 watch 那个临时文件，文件被删时 `EBUSY`。**修法**：`vite.config.ts` 里 `server.watch.ignored` 忽略 `**/.*.tmpdir/**` `**/*.tmpdir/**` `**/*.tmp` | `job_output pwsh-11` 的 `EBUSY ... .UnitCard.vue.1972.*.tmpdir\UnitCard.vue.tmp`；`web/vite.config.ts` | ✅ 已确认（已修） |

---

## H. UI 图标

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| H1 | **兵种图标 wiki 上有现成的**，就是游戏里属性条前面那几个（蓝/红圆底剪影）：`CNCRiv_infantry.png` / `_vehicle` / `_aircraft` / `_structure` / `_harvester`，均 64×64。已汇总到 `data/icon/type-*.webp` | `_build_icon.py fetch`；`data/icon/type-infantry.webp` 目视确认为士兵剪影 | ✅ 已确认 |
| H2 | 造价图标 `CNCRiv_Tiberium.png`(133×158)、稀有度卡 `CNCRiv_{Common,Rare,Epic}_card.png`(≈153×190)、阵营标志 `CNCR GDI logo.png`(907×926) / `CNCR Nod logo.png`(1037×912) 也都从 wiki 取到 | `data/icon/`；`data/icon/README.md` 有逐条来源表 | ✅ 已确认 |
| H3 | **HP / DPS / 速度 这类数值标签图标 wiki 上没有**，但**游戏本体里有**：`published.2x/texturepacks_ui/icons.sba` 是可解析的 SBIN 容器，内含 TexturePack 元数据，**精灵名是明文**（如 `images/icons/Stat/Icon_Stat_Health.png`、`Icon_Stat_DPS.png`、`Icon_Stat_Speed.png`、`Icon_Stat_Base_Health.png`、`Icon_Stat_HarvesterHealth.png`；`images/icons/Battle/Icon_Battle_{Infantry,Vehicle,Aircraft,Structure}[_Strong\|_NoAttack].png`），共 575 个图标 | `icons.sba` 的块结构 `SBIN/ENUM/STRU/FIEL/DATA`；明文名列表 | ✅ 已确认 |
| H4 | 但 `icons.sba` 里**没有 KTX 头**（`\xabKTX` 搜不到），精灵存在 ETC 压缩纹理里，取出需先逆向纹理格式。权衡后数值标签图标**改为本地画 SVG**（24×24、`currentColor`、可跟主题变色、无版权问题） | `data/icon/stat-*.svg`；`_build_icon.py svg` | ⚠️ 取舍（若日后要原版图标，缺的只是 ETC 解码） |
| H5 | **踩坑：Fandom 无论原格式一律返回 WebP**，按 `.png` 命名会得到「后缀 png、内容 webp」的假文件。落盘必须用嗅探出的真实扩展名 | `data/icon/*.webp`；`_build_icon.py` 的 `sniff()` | ✅ 已确认 |
| H6 | **踩坑：wiki 上有只差大小写的同名文件**——`CNCRiv_harvester.png`(64×64 兵种图标) 与 `CNCRiv_Harvester.png`(153×187 另一张)。用「全小写」建索引会撞车取错，必须先按精确名匹配 | `data/icon/type-harvester.webp` 第一次拿到 153×187，改精确匹配后为 64×64 | ✅ 已确认 |
| H7 | **兵种图标是自行设计的表意图标**，不追求还原原版。唯一真相是 `data/icon/type-*.svg`（64×64 统一画布），`_svg_icons.py` 只把内部标记提取成 `web/src/typeIcons.ts`。设计约定：粗壮填充形、每图 2~4 个元素、24px 下仍可辨认 | `data/icon/type-*.svg`；`tmp/shapes2.png` 是 128/64/40/26px 四档尺寸的验收图 | ✅ 已确认 |
| H7b | ~~用 vtracer 描摹 64px 原图~~ | ❌ **已推翻**。描摹会把抗锯齿抖动一起矢量化 —— 实测**一个房子出了 115 段三次贝塞尔**（`C×115`）、步兵 224 段、载具 289 段。放大看全是台阶 | `data/icon/type-structure.svg` 描摹版 3705 字符 / 115 段曲线 | ❌ 已推翻 |
| H7c | ~~照原版原样重画（房子/矿车/步兵/载具/战机都按原图几何复刻）~~ | ❌ **已推翻**。复刻出来的东西「像但不好认」——比如原版战机是斜 45° 的实心块，缩到 24px 认不出是什么。改成按**表意**设计：步兵→戴盔士兵胸像、载具→坦克、空军→俯视后掠翼战机、建筑→坡顶房+门窗、运矿车→斗里露矿石的矿车 | 用户反馈「还不如刚才，抛开观念自己绘制可以传达含义的 svg」 | ❌ 已推翻 |
| H8 | **职责划分**：`typeIcons.ts` 里**只有剪影图形**（纯数据）；**圆底由 `TypeIcon.vue` 画**。理由：① 圆是几何图形，一个 `<circle>` 就够；② 圆底要能单独换色（GDI 蓝 / Nod 红），烘进图形就只能整体一色；③ 图形数据保持「只有剪影」这件单纯的事 | `web/src/components/TypeIcon.vue`；配色变量 `--icon-bg` / `--icon-glyph` / `--icon-ring` | ✅ 已确认 |
| H9 | **必须内联 SVG，不能 `<img src="...svg">`**：`<img>` 引用的 SVG 是独立文档，外部 CSS 改不了它内部颜色，想给两个阵营各一套配色就只能备两份位图。内联后图形里的 `currentColor` 由外层 `color` 驱动 | `TypeIcon.vue` 的 `<g class="glyph" v-html="body"/>`；`tmp/card6-zoom.png`（GDI 蓝圈 / Nod 红圈） | ✅ 已确认 |
| H10 | **踩坑：卡片上的阵营色要设 `--icon-bg`，不能设 `color`。** 圆底读的是 `var(--icon-bg)`、剪影读的是 `color`（通过 `.glyph { color: var(--icon-glyph) }`），设错了阵营色不生效（曾出现两个阵营都是蓝色） | `UnitCard.vue` 的 `.card.f-gdi .tl { --icon-bg: #33518f }` / `.card.f-nod .tl { --icon-bg: #8e2b2b }` | ✅ 已确认 |
| H11 | 生成 TS 时图形里的双引号要处理：用**模板字符串**（反引号）包，别用双引号再逐个转义（第一次生成直接语法错误 TS1005） | `_svg_icons.py` 的 `OUT_TS` 写入段 | ✅ 已确认 |
| H12 | **提取 SVG 内部标记时必须把根 `<svg>` 上的呈现属性一起带过来**：`type-vehicle.svg` 把 `fill="currentColor"` 写在根节点上，只取内部标记会让那条 path 失去填充色（渲染成默认黑色）。做法是把这些属性（除 `xmlns`/`viewBox`/`width`/`height`）包一层 `<g>` | `_svg_icons.py` 的 `body_of()` | ✅ 已确认 |
| H13 | 兵种图标最终素材：`infantry` / `vehicle` 用 **Material Design Icons**（24×24 放大 2.667 倍，**Apache-2.0 / Pictogrammers**），`aircraft` / `structure` / `harvester` 自绘。来源与授权已写进 `data/icon/README.md` | `data/icon/README.md`；`tmp/shapes3.png`（128/64/40/26px 四档验收）；`tmp/card7-zoom.png`（GDI 蓝圈 / Nod 红圈） | ✅ 已确认 |

---

## I. 组件设计

| # | 结论 | 证据 | 状态 |
| --- | --- | --- | --- |
| I1 | **不单独抽 `UnitIcon`**。它只做「图片 + 描边」，为一个 `<img>` 加个 `border-color` 建组件不值当 | 用户判断；`web/src/components/UnitCard.vue` 内联了卡面 | ✅ 已确认 |
| I2 | **`UnitCard` 的含义 = 游戏里那张可点的卡**：卡面图 + 稀有度色边框 + 基础信息。数值（总血 / DPS）不属于它 —— 那些是"看数据"的需求，和"看卡"是两种意图 | 用户定义 | ✅ 已确认 |
| I3 | `UnitCard` 的可选信息**位置固定**（和游戏一致），不随 `fields` 书写顺序变：`type` 左上 / `level` 右上 / `faction` 左下 / `cost` 右下 / `name` 图下方。前四个是**绝对定位覆盖层**（不参与布局，卡片再窄也不会被徽标挤变形），名称在图下方 | `UnitCard.vue` 的 `.badge` / `.caption` | ✅ 已确认 |
| I4 | `UnitCard` 入参为 **`unit` + `level?` + `fields?`**。`level` **可选**：不传就不画等级角标（商店预览、卡组缩略图用不着）。等级做成独立对象 `{ major, minor }`（`core/src/levels.ts` 的 `Level`），因为它是全局滑块推出来的、和具体单位无关 | `UnitCard.vue` 的 `levelText` computed；`fields` 默认 `["name","cost"]`（= 游戏商店那张卡的样子） | ✅ 已确认 |
| I5 | 兵种图标选择要**优先看 `override_harvester`**：运矿车的 `tags` 是 `[Vehicle, override_harvester, override_vehicle]`，直接用 `baseUnitType()` 会得到 Vehicle，但游戏里运矿车有单独图标 | `UnitCard.vue` 的 `unitType` computed；`unit_gdi_harvester` 的记录 | ✅ 已确认 |
| I6 | 卡面缺失回退用**运行时 `@error`**，禁止硬编码「哪些 id 没图」—— 后者每加一个缺图单位都要改代码，改漏就在页面上留破图 | `UnitCard.vue` 的 `iconFailed` | ✅ 已确认 |
| I7 | 所有资源路径集中在 `web/src/assets.ts`（`unitIconUrl` / `factionIconUrl` / `typeIconUrl` / `tiberiumIconUrl` / `statIconUrl`），全走 `import.meta.env.BASE_URL`。**组件里不许手拼路径** | `web/src/assets.ts` | ✅ 已确认 |
| I8 | **`vue-tsc` 已装并接入 `pnpm typecheck`**（原来只用 `tsc`，`.vue` 模板完全没被类型检查）。已验证它确实在检查 `.vue`：`vue-tsc --listFiles` 输出里含 `web/src/components/UnitCard.vue` 等 | `web/package.json` 的 `typecheck` 脚本；`vue-tsc --listFiles` | ✅ 已确认 |
| I9 | **卡内所有尺寸必须用 `cqw`（容器查询单位）而非 px**，卡片才能等比缩放。做法：`.card { container-type: inline-size }`，内部一切尺寸写成「卡宽的百分比」。用固定 px 时同一个组件在 268px 卡片墙和 170px 网格里角标占比不同 —— 实测卡片放大后角标显得过小就是这个问题。改后角标相对卡面放大约 35~40%（类型图标 8.1%→11%、阵营 8.9%→12%、等级字号 4.1%→5.6%、费用 4.4%→6%） | `UnitCard.vue` 的 `<style>`；`web/src/views/Arsenal.vue` 的栅格 `minmax(170px, 210px)` | ✅ 已确认 |
| I10 | **踩坑：不能靠 `GET /src/xxx.vue` 判断样式是否更新**。Vite 把 SFC 的 `<style>` 拆成独立模块（`/src/xxx.vue?vue&type=style&index=0&scoped=…&lang.css`），脚本模块里永远没有 CSS。要验证样式得先从脚本模块里正则取出 style 导入的 URL 再请求 | 曾据此误判「dev server 在吐旧缓存」并杀掉了一个健康的进程；实际 `container-type`、`cqw` 都在 | ✅ 已确认 |
| I11 | **等级徽标（`LevelBadge`）的几何是「4 等分圆环 + 去掉底部那块」**，不是「3 段各 85° 加额外间隙」。每块 90°，分界在 45°/135°/225°/315°；去掉中心在 180°（正下方）的那块，剩下左/上/右三段，底部天然形成 90° 缺口。每段两侧各内缩 4° 形成段间缝隙。点亮顺序：左 → 上 → 右（顺时针），点亮段数 = `minor` | `web/src/components/LevelBadge.vue` 的 `SLOTS = [-90, 0, 90]`；用户指出原版是四等分 | ✅ 已确认（先写错，已修） |
| I12 | 徽标必须带**深色圆盘底衬 + 外描边**，否则弧线直接压在卡面美术上读不出来。结构是三层：外圆盘（`#161a21` + `#05070a` 描边）→ 弧线槽位 → 内圈「井」（`#232935`） | `LevelBadge.vue`；用户指出「角标没做圆形背景加描边」 | ✅ 已确认（先漏了，已补） |
| I13 | **踩坑：「等级」标签与数字会压字**。数字字号 30 时上缘约在基线 −21，标签基线若在 `cy-9` 就会叠在数字上。要显式给 `labelY` / `majorY`，不能用 `cy ± 常数` 凑 | `LevelBadge.vue` 的 `GEO.full`（`labelY: 34`、`majorY: 63`）；曾用 `cy-9` 导致「等级」叠在「15」上 | ✅ 已确认 |
| I14 | **验证 UI 的可行手段：无头 Edge 截图**。`msedge --headless=new --disable-gpu --hide-scrollbars --window-size=W,H --virtual-time-budget=9000 --screenshot=out.png <url>`，`--virtual-time-budget` 是必须的（SPA 要等数据加载）。截图再用 Pillow 裁剪放大检查细节。本机路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` | `tmp/shot-list.png`、`tmp/badge2.png` 等；据此发现并修掉了 I13 的压字问题 | ✅ 已确认 |
| I15 | **角标要「骑在角的顶点上、一半探到卡外」**，不是内切在图里，也不是贴死外沿。做法分两层：<br>① `.frame`（`position: relative`，**不裁剪**，只当定位参照）+ `.art`（只管把卡面裁进圆角）。角标必须挂 `.frame` —— `.art` 上的 `overflow: hidden` 会把探出的角标切掉，且它自带的 `border` 会让 `top/right: 0` 落在边框内侧，看着就是浮在图里<br>② 定位用 `top/right/bottom/left: 0` + `transform: translate(±50%, ±50%)`，让角标**自身的中心落在角的顶点上**。探出比例由 `--over` 控制 | `UnitCard.vue` 的 `.frame` / `.art` / `.badge` | ✅ 已确认 |
| I16 | 角标探出会**吃进网格间隙**，`Arsenal` 的 `gap` 必须留够（现为 `38px 40px`），否则相邻两张卡的角标会撞在一起。同时卡片下方的名称要留出造价角标下探的高度（`.caption { margin-top: 4.5cqw }`），" | `web/src/views/Arsenal.vue` 的 `.grid`；`UnitCard.vue` 的 `.caption` | ✅ 已确认 |
| I17 | 矩形的造价角标要让它**外角跟着卡框圆角**（`border-top-left-radius` / `border-bottom-right-radius: 2.2cqw`），才像嵌进去；四角都给圆角反而会看出是"贴上去了"。另外它是长条，`--over` 取 16%（比圆形的 24% 小），免得下探过多压到名字 | `UnitCard.vue` 的 `.cost` | ✅ 已确认 |
| I18 | **`--over` 不等于露出面积，会严重高估。** 圆形角标的圆心若正好落在角的顶点（`--over: 50%`），圆只有 **1/4** 面积在卡内 —— 角只占一个象限，所以 **3/4 露在外面**。实测换算：15%→约 19% 在外，**24%→约 30%**，35%→约 53%，50%→75%。现用 24% | `UnitCard.vue` 的 `--over`；用户先反馈「3/4 面积都出去了」 | ✅ 已确认（先设 50%，已调） |
| I19 | 兵种图标必须**内联 SVG**（`TypeIcon.vue`）而不是 `<img src=...svg>`：`<img>` 引用的 SVG 是独立文档，外部 CSS 改不了内部颜色，想给 GDI 蓝 / Nod 红各一套就只能备两份位图。内联后圆底走 `currentColor`、剪影走 `--icon-glyph`，一行 CSS 换色 | `web/src/components/TypeIcon.vue`；`UnitCard.vue` 里 `.card.f-gdi .tl { color: #2f4f9e }` / `.card.f-nod .tl { color: #8e2b2b }` | ✅ 已确认 |
| I20 | **`Level` 是带行为的值对象**，不再是一堆 `xxxAtLevel(base, lv.major, lv.minor)`。方法：`factor()` / `hp(base)` / `dps(base)` / `ordinal()` / `format()` / `isAbove(other)` / `stepsFrom(other)` / `plus(n)`。构造用 `level(major, minor)` 或 `fromOrdinal(n)`；`MAX_ORDINAL` 也收归 core（原在 `web/src/state.ts`） | `core/src/levels.ts`；冒烟验证：`fromOrdinal(40).format()='11-0'`、`.factor()=2.255884`、`.hp(650)=1466`、`level(5,0).stepsFrom(level(15,3))=-43`、`level(15,3).plus(4).format()='15-3'` | ✅ 已确认 |
| I21 | **方法用闭包捕获 `major`/`minor`，不读 `this`**：这样解构、当 prop 传、跨组件都不会丢方法。同时 `fromOrdinal` 返回的是带方法的对象，**任何地方都不能用展开 `{...lv}` 复制它**（展开只复制可枚举自有属性，方法会丢）—— 需要附加字段时用 `Object.assign(lv, {...})`，例如 `state.ts` 的 `displayLevel()` 给等级挂 `capped` | `core/src/levels.ts` 的 `level()`；`web/src/state.ts` 的 `withCapped()` | ✅ 已确认 |
| I22 | 自由函数（`hpAtLevel` / `dpsAtLevel` / `levelOrdinal` / `formatLevel` …）**保留**，是方法的实现，也是 CLI 与单测的入口。两种写法等价，不必二选一 | `core/src/levels.ts`；`cli/` 仍用自由函数且类型检查通过 | ✅ 已确认 |
| I23 | **详情页按「一组数据一张卡」组织，某组没数据就整张卡不渲染**，而不是渲染一排 `—`。空缺是数据本身的性质（采集车没有武器、指挥官没有小队调参），摆空表格只会淹没真正有意义的数字。分组：身份 / 数值 / 小队 / 敌人应对 / 武器 / 能力调参 / 元信息；组内单个字段缺也单独隐藏（`.stats` 里 `stats.length === 0` 时整块为空） | `web/src/views/UnitDetail.vue`、`web/src/components/UnitStats.vue`；`tmp/d3c.png`（采集车：数值只剩 4 项、无武器卡、无敌人应对卡） | ✅ 已确认 |
| I24 | `StatIcon` 也必须**内联**：`stat-*.svg` 是 `stroke="currentColor"` 画的，当 `<img>` 引用时没有可继承的颜色，会一律渲染成黑色。`TYPE_ICONS` 与 `STAT_ICONS` 现由 `_svg_icons.py` 一起生成到 `web/src/icons.ts` | `web/src/components/StatIcon.vue`、`web/src/icons.ts` | ✅ 已确认 |
| I25 | **本地化文本含游戏运行时替换的占位符 `<stat\|X>`**：全库仅 **14 种 / 37 处**（集中在指挥官技能描述；另有两条是鸣谢里的邮箱，属误报）。我们能算的算（`VisionRange` / `ExtendedAttackRange`），算不出的换 `—` —— 直接把 `<stat\|VisionRange>` 原样显示太糙 | 统计 `data/locale/{zh,en}.json`；`UnitDetail.vue` 的 `STAT_TOKENS` / `desc` | ✅ 已确认 |
| I26 | **`waveSize === 1` 时不算「小队」**：`waveSize` 是 1 的单位没有小队可言，所以<br>· 数值块里血量标签叫**「血量」**而不是「总血」，「每员」整行不出现<br>· 详情页原本的「小队」卡改标题为**「其他属性」**，且「小队人数」「小队攻击间隔」两行只在多成员时出现<br>· 剩余几项（能否被碾压 / 反隐 / 被击杀给矿）是**单位属性不是小队属性**，不能因为「不是小队」就一起消失<br>· 数值卡的说明文字也跟着换 | `web/src/components/UnitStats.vue`、`web/src/components/UnitPanel.vue`；`tmp/d4c.png`（掠夺者坦克显示「血量 2823」，无小队卡） | ✅ 已确认 |
| I27 | **展示逻辑抽成 `UnitPanel`，页面只当薄壳**。`components/UnitPanel.vue` 是纯展示组件（只吃 `unit` + `level`，不做 IO、不读路由、不读全局状态），`views/UnitDetail.vue` 只负责「读路由参数 → 取数据 → 给容器定宽」。这样面板能嵌到任何地方（对比页并排、弹层），以后不用把详情页复制一份 | `web/src/components/UnitPanel.vue`、`web/src/views/UnitDetail.vue` | ✅ 已确认 |
| I28 | **`main` 必须限宽**：原来没设 `max-width`，宽屏上一行能拉到 1400px+，读起来很累。现在 `main` 封顶 1180px 居中；以「读」为主的详情页再收一档到 `.page` 的 900px。卡片墙不用 `.page` —— 它靠列数自适应，宽点更好 | `web/src/style.css` 的 `main` / `.page`；`tmp/panelc.png` | ✅ 已确认 |
| I29 | **详情面板按「数据是关于什么的」分组，不按「是不是数字」**：<br>① 单位总览 = 大卡 + 名称 + 标签 + **本单位的等级选择** + 随等级变的关键值（血量 / DPS）+ 描述<br>② 基本信息 = **不随等级变**的单位固有属性（造价 / 移动速度 / 视野 / 能否被碾压 / 反隐 / 被击杀给矿）<br>③ 小队 = 仅多成员：人数 / **每员血量** / 小队攻击间隔<br>④ 武器 = 拆到 `UnitWeapons.vue`，数量不定<br>⑤ 能力调参 ⑥ 元信息<br>关键取舍：血量与 DPS 随等级变所以提到总览；射程/开火间隔/单发伤害归武器卡，**不在总览重复** | `web/src/components/UnitPanel.vue`；`tmp/p2c.png` | ✅ 已确认 |
| I30 | **等级选择器放进单位总览**（`UnitLevelPicker.vue`）：大级、小级两个滑块 + 一个**默认关闭**的「独立等级」开关。关闭时跟随顶栏全局等级（滑块压暗 + `pointer-events: none` 明示不生效），打开后本单位用自己那套，便于同页横向比较不同等级。`UnitPanel` 内部持有 `independent` / `localLevel`，对外仍只暴露 `unit` + `level` | `web/src/components/UnitLevelPicker.vue`；`tmp/p2c.png` | ✅ 已确认 |
| I31 | **「索敌偏好」与「克制」用点亮/熄灭的兵种图标表达，两行必须分开**：索敌偏好 = `goodAgainstTags`（官方文案「强于」的那个，实为 **AI 索敌意图、不产生伤害加成**）；克制 = 逐目标算 `damageAgainst` 后**伤害最高**的那几类。80 把武器里两者一致数为 **0**，混成一行就是错的 | `web/src/components/UnitAffinity.vue`；`core/src/types.ts:397` 的 `damageAgainst` | ✅ 已确认 |
| I32 | **算克制时必须先判断这把武器打不打得到该目标**。只看伤害数字大小是错的：防空武器对地面单位算出来的"默认伤害"根本不存在。判据是**武器自己的 `descriptors` 位掩码**（不是 `goodAgainstTags`、不是 `targetSelector`——后者 83/83 都是 `unit_antiInfantry`） | `unit_gdi_slingshot.lua:10` = `{TransportTypeMask_Flying, AttackableTypeMask}`（防空）；`unit_gdi_predatortank.lua:10` = `{Ground, AttackableTypeMask}`（对地）；`unit_gdi_talon.lua:11,45` 两把武器分别是 Ground 与 Flying | ✅ 已确认（**修法中**） |
| I33 | **`CombatantDescriptor` 的位值原来是按首次访问顺序自增的（`i = i + 1; 2^i`），语义不稳定**：`Ground` 拿到 8 只是因为它恰好是第 3 个被访问的名字。往单位目录加一个引用新名字的文件就会让整张映射平移，已有数据里所有 `descriptors` 数字的含义全部改变，**而且不报错**。已改成显式钉死的表（只有 `Ground=8`、`TransportTypeMask_Flying=4096` 沿用历史值，其余重新固定）。改后 `AttackableTypeMask` 从 4 变成 16 —— 印证了旧值确实是随机的 | `core/src/extract/luaRuntime.ts` 的 `DESCRIPTOR_BITS`；重跑 extract 对比 `tmp/before-sling.json`：`[4096, 4]` → `[4096, 16]` | ✅ 已确认 |
| I34 | **踩坑：Lua 引导串是 TS 模板字符串，里面不能出现反引号**。我在 Lua 注释里写了 `` `descriptors` ``、`` `Ground` ``，直接把模板字符串提前终止，报 `ERR_INVALID_TYPESCRIPT_SYNTAX` 且错误行号指向注释本身，很难看出是引号问题 | `core/src/extract/luaRuntime.ts` 的 `BOOTSTRAP` | ✅ 已确认 |
| I35 | **武器的「能打哪些目标」是三条规则**（由用户实测逐步逼出，我前四版模型都错了）：<br>· **建筑 Structure** → 任何武器都能打（独立轴）<br>· **步兵 / 载具 / 运矿车** → 需武器带 `Ground` 位（8）；矿车是载具的一种<br>· **空中 Aircraft** → 需武器带 `TransportTypeMask_Flying` 位（4096）<br><br>证据：弹弓 `{Flying}` 打空中 ✅、打建筑 ✅（25）、**打地面单位 ❌**（用户实测）；利爪火箭 `{Flying}` 打空中 + 建筑 ✅；掠食者 `{Ground}` 打地面 + 建筑、打不到空中 ✅ | 用户实测 + `unit_gdi_slingshot.lua:10`、`unit_gdi_talon.lua:11,45` | ✅ 已确认 |
| I35b | ~~`TransportTypeMask_Flying` = 只能打空中~~ | ❌ **已推翻**（用户指出利爪火箭能打建筑、弹弓能打建筑） | ❌ 已推翻 |
| I35c | ~~地面是基线能力，`Ground` 位冗余~~ | ❌ **已推翻**（用户：弹弓打不了建筑以外的地面） | ❌ 已推翻 |
| I35d | ~~运矿车「必须在 overrides 里显式写 Harvester 才打得到」~~ | ❌ **已推翻**。见 I40：矿车按载具规则就能打，只是伤害走回退链 | ❌ 已推翻 |
| I40 | **`override` 的含义是「优先匹配」，不是排他过滤器**（用户提出，与数据吻合）。伤害查找按目标类型的**回退链**：<br>· 步兵 → `Infantry`<br>· 载具 → `Vehicle`<br>· 建筑 → `Structure`<br>· 空中 → `Aircraft`<br>· **运矿车 → `Harvester` → `Vehicle` → `default`**<br><br>矿车的 `tags` 是 `[Vehicle, override_harvester, override_vehicle]`，同时写两个 override 正是在**声明这条回退链**。于是"反步兵打不动矿车"得到解释：步枪兵只有 `Vehicle: 15`，打矿车回退到 **15**（相对对步兵的 38 确实"打不动"），不是零 | `web/src/components/UnitAffinity.vue` 的 `CASCADE` + `damageFor()`；`unit_gdi_riflemen` 的 `overrides = [[Vehicle, 15]]` | ✅ 已确认 |
| I39 | **弹弓的 `Vehicle: 25` override 是够不着的死数据** —— 它有对载具的伤害值，但武器根本打不到载具（descriptors 只有 `Flying`）。这类字段不能按"有值就能打"来解读 | `unit_gdi_slingshot.lua` 的 overrides vs descriptors；I35 规则 | ⚠️ 推断（未逐一核对全部武器） |
| I41 | **「能打哪些目标」与「打多少」的判定属于 core，不属于网页组件**：已在 `core/src/types.ts` 落地 `DAMAGE_CASCADE` / `canAttackTarget()` / `damageAgainstTarget()` / `DESCRIPTOR_GROUND` / `DESCRIPTOR_FLYING`。理由是这是**数据语义**不是展示逻辑 —— CLI、对比页、以后的数据校验脚本都要用同一套规则，放组件里既用不到也没法单测。`UnitAffinity.vue` / `DamageMatrix.vue` 现在只负责画 | `core/src/types.ts`（紧随 `damageAgainst` 之后） | ✅ 已确认 |
| I43 | **部署 / 解除时间归「基本信息」，不放在武器卡里**。数据虽然挂在武器的 `modifier_intro` / `modifier_outro` 上，但语义是**单位整体**行为 —— 多管火箭的描述原文就是「必须事先进行部署」，这是它的定义性特征，埋在武器卡的次要参数里没人看得到。多武器单位取各武器最大值。实测：多管火箭 2s/0.5s、自行火炮 4s/0.5s、神像机甲 5s/2s；粉碎者与万钧巨炮无此项 | `web/src/components/UnitPanel.vue` 的 `basics`；`WeaponCard.vue` 的 `minor` 已删掉这一项避免重复；`tmp/dpc.png` | ✅ 已确认 |
| I44 | **小队开火是「每人各自按 `t = i × 错开 + k × 周期` 开火」，数据里没有任何分组逻辑**，「齐射」是相位漂移自然撞出来的。用户实测印证：狂信徒（错开 750 / 周期 850）是「先 1 人发射，然后 2 人齐射、3 人齐射」—— 算出来正是 1500/1600/1700 三发挤在 200ms 内；攻击摩托（错开 250 / 周期 4250）三人 0.5s 内打完再等 3.75s，是**有意为之的爆发**。<br>⚠️ 因此 **`错开 × 人数` 不一定等于周期**：19 个多成员单位里 13 个正好（步枪兵 344×5=1720=周期），6 个不等（游侠 0.3s vs 2.7s、狂信徒 2.25s vs 0.85s、军犬 1.2s vs 1.7s、攻击摩托 0.75s vs 4.25s、激光无人机 1.6s vs 1.5s、圣甲虫 4.0s vs 5s）。时序条横轴必须取 `max(周期, (人数-1)×错开)` | `web/src/components/WeaponTimeline.vue`；全量扫描 `waveSize` / `attackSeparationDurationMS` / `burstTiming.cooldown`；`tmp/tlf3.png`（狂信徒 0 / 750 / 1500ms 三轴） | ✅ 已确认 |
| I46 | **时序条：每名队员各一条彩色条**，顺位是 **前摇 → 开火 → 冷却**（前摇是开火**之前**的蓄力，必须画在伤害点左边）。早先版本把标记放在周期开头、前摇放在周期末尾，结果前摇跑到了伤害点后面 —— 被用户一眼看出。**横轴跨度取 `max(周期, (人数-1)×错开 + 前摇)`**，于是常规小队正好铺一个周期，只有狂信徒这类超周期的才铺第二个 | `web/src/components/WeaponTimeline.vue`；`tmp/t3c.png`（震荡兵 3 轴）、`tmp/t2c-unit_nod_fanatic.png` | ✅ 已确认 |
| I48 | **踩坑：重跑 `extract` 后必须重新 `sync-data`，否则网页读的是旧数据副本**。`web/public/data/` 是构建时从仓库根 `data/` 复制的（唯一真相在根），我钉死 `CombatantDescriptor` 位值后重跑了 extract，但没重新同步 —— 网页里 `unit_gdi_rockettroopers` 的 descriptors 还是旧的 `[2, 4]`（钉死前按访问顺序自增的值），而新代码查的是 `128`（通吃位），于是判成"只能打建筑"。**这种错不报错、只是结果悄悄变错，最难查** | `web/public/data/unit/unit_gdi_rockettroopers.lua.json` 的 `descriptors` 旧为 `[2,4]`、同步后 `[128,16]`；`tmp/v1c.png`（错）vs `tmp/v2c.png`（对） | ✅ 已确认 |
| I49 | **「打不到」不能压得太暗**：原来 `.slot.dead` 用 `opacity: 0.12`，连那道红斜杠一起淡到看不见，于是"打不到"和"打得到但非最高"在视觉上分不出来，看着就像"只能打建筑"。现改成 `opacity: 0.3`，靠斜杠表达"打不到" | `web/src/components/UnitAffinity.vue` 的 `.slot.dead` / `.slash` | ✅ 已确认 |
| I50 | **敌人应对改成左右两栏一行、一律用颜色表达**：左「克制」（逐类型真实伤害）右「索敌偏好」（AI 意图），中间竖分隔线，**去掉长文字说明**，只在右下角留一排极简色块图例。克制的档位按「伤害 ÷ 该武器默认伤害」划五档＋「打不到」：<br>`<0.35` 极低 · `<0.65` 中等 · `<0.9` 偏低 · `<=1.05` 正常 · `>1.05` 偏高 · 打不到（压暗+红斜杠）<br>颜色从冷到暖：`#4a5163 → #3f6fa8 → #3f8f8f → #4f9e5f → #d8a13c`。悬停显示具体伤害、倍率与来自哪把武器 | `web/src/components/UnitAffinity.vue`；`tmp/a5c.png`（图标 34px，两栏+图例同一行） | ✅ 已确认 |
| I51 | **多武器单位的伤害倍率必须「逐武器除以它自己的 default」，不能拿所有武器的最大 default 当统一分母**。反例（利爪直升机，用户发现"克制似乎只取了最后一把武器"）：机枪 default 57、火箭 default 345。拿 345 当分母时机枪的 57 算成 16% 判成"极低"，可 57 本来就是机枪的正常伤害 —— 整把机枪等于白算。改成逐武器算 `damageAgainstTarget(w,type) / w.damageTuning.default` 后取最高倍率，利爪得到：步兵 100%(机枪) / 载具 35%(机枪) / 空中 100%(火箭) / 建筑 100%(火箭) / 运矿车 35%(机枪) | `web/src/components/UnitAffinity.vue` 的 `cells`；`unit_gdi_talon.lua` 两把武器的 `damageTuning` | ✅ 已确认（用户发现，已修） |
| I53 | **档位定义抽到共用模块 `web/src/damageTiers.ts`**（`TIERS` / `tierOf` / `targetDamage` / `TARGET_TYPES` / `TARGET_LABELS`），「敌人应对」的克制行与武器卡的逐目标伤害**共用同一套颜色**，不再各写一份。逐目标伤害格式改为 `[兵种图标] 伤害 百分比▲▼`，竖线分隔各类目标，**图标圆底与数字文字都用档位色**（颜色是这套界面的主要语言），▲ 表示高于正常、▼ 低于正常、持平不显示 | `web/src/damageTiers.ts`、`web/src/components/DamageMatrix.vue`、`UnitAffinity.vue`；`tmp/b1-wpn.png`（利爪两把武器各自的五格） | ✅ 已确认 |
| I54 | **伤害档位的基准就是 `damageTuning.default`**（逐武器取自己的）。`default` 的含义是「**没写 override 时的全额伤害**」，override 绝大多数是**减伤**（少数增伤，如多管火箭对建筑 666→1000），所以它就是"正常伤害"。<br>· ~~用「所有武器的最大 default」当统一分母~~ ❌ 会让利爪机枪白算（57/345=16%）→ 见 I51<br>· ~~用「能打到的目标里伤害最大值」当基准~~ ❌ **会把反载具武器显示成反建筑**：多管火箭 default 666 / Structure 1000，取最大值当分母后载具变 67%、建筑 100%，而它 `goodAgainst = [Vehicle, Structure]`（用户发现） | `web/src/damageTiers.ts` 的 `weaponBaseline()`；`tmp/c1c.png`（多管火箭：载具 100%、建筑 150%▲） | ✅ 已确认 |
| I55 | **攻击摩托（`unit_nod_attackbike`）的数据本身如此，属特例，不是 bug**：`default=244`，overrides `{Infantry:40, Harvester:200, Vehicle:210, Aircraft:223}`。它的**对建筑伤害（244）确实是全场最高**，对空中 223、载具 210 只略低 —— 所以 100% 落在建筑上是真实数据。它的"反载具/反空军"身份来自 `goodAgainstTags`（AI 索敌意图），以及"对步兵被砍到 16%"这个对比。用户确认按数据呈现即可 | `data/unit/unit_nod_attackbike.lua.json` 的 `damageTuning`；`goodAgainstTags = [Vehicle, Aircraft]` | ✅ 已确认 |
| I56 | **提取缺口：`burstTiming.cooldown` 不是可靠字段，开火间隔还藏在 `modifier_sequence` 里，并由 `useGlobalCooldown` 决定归属。** 弹弓的 `burstTiming` 只有 `{ numToBurst = 1 }`，真正的间隔在 `modifier_sequence.tuning.burstCooldown`（弹弓 180 → 54/0.18 ≈ 300 DPS 持续速射；狼獾 190 → ≈237；火焰兵 2000 → 37.5）。对照掠食者：`burstTiming.cooldown = 3.44s`、无 `modifier_sequence`。**用户语义澄清**：这批武器要么是「一轮打好多发才停」，要么是「持续性攻击」。<br>**影响**：产物里 **18/83 把武器没有 `cooldown`**，网页上它们**开火周期显示 `—`、时间轴整块不渲染，DPS 很可能也是错的**（`baseDps` 依赖 cooldown） | `tmp/.../unit_gdi_slingshot.lua:38-58`；全量扫描 `burstTiming.cooldown` | ✅ 已确认（用户发现，**待修**） |
| I57 | **18 把缺 `cooldown` 的武器分三类，不是一个原因**（`tmp/_check_timing.py` 逐单位扫源码得出）：<br>**A 类 · `modifier_sequence.tuning.burstCooldown`（10 把）**：沙暴 4000、沙暴_ST 3000、弹弓 180、狼獾 190、化学战士 500、化学越野车 500、忏悔者 400、火焰坦克 500、火焰兵 2000、岩蛇 3750/1000<br>**B 类 · 只有 `initialChargeUpMs`、没有间隔（5 把）**：破坏者 3000、科迪亚克 500、蛇怪 300、光束炮 500、天启 300 —— 属"蓄力后打一轮就停"型<br>**C 类 · 数据里有 `cooldown` 但提取器漏了（2 把）**：催化炮艇 `cooldown = 1600/6000/3.0`、黑寡妇 `cooldown = 1.5`（`numToBurst = 6`）—— **这是另一类 bug，与 A/B 无关** | `tmp/_check_timing.py`（只读脚本）；`unit_gdi_sandstorm.lua`、`unit_gdi_disruptor.lua`、`unit_nod_catalystgunship.lua`、`unit_nod_widowmaker.lua` | ✅ 已确认 |
| I58 | **贯穿 18 把的共同标志是 `useGlobalCooldown = true`（18/18）**，推测含义为"本武器不自己管冷却、用全局冷却"，因此周期不写在 `burstTiming` 里。**"全局冷却"的值存在哪个块尚未找到**（怀疑在 `squadTuning`），找它之前不要动手改提取器 | `tmp/_check_timing.py` 输出；`unit_gdi_slingshot.lua:82` 的 `useGlobalCooldown = true` | ⚠️ 推断（待定位全局冷却字段） |
| I59 | **`burstCooldown` 不是统一的「射击间隔」，含义随武器行为而异**（用户提供语义，逐条对照数据）：<br>· **弹弓** `burstCooldown=180` —— "对准目标**持续射击**到目标消失" → 180ms 是**射击间隔**（54/0.18 ≈ 300 DPS）<br>· **火焰兵** `burstCooldown=2000` —— 同类持续型 → 射击间隔<br>· **沙暴** `burstCooldown=4000` —— "**持续倾泻大量导弹到周围，然后停一会**" → 见 I60：4000ms 是**整轮周期**（倾泻+停顿都在内）<br>· **光束炮** 无 `burstCooldown`、`initialChargeUpMs=500` —— "**短暂前摇后一直射击**" → 前摇在 `initialChargeUpMs`，射击间隔在别处（未定位）<br>· **催化炮艇** `cooldown = 1600/6000/3.0` —— "**两种武器交替射击**" → 多个值对应两把武器的交替节奏<br><br>⚠️ **不能简单把 `burstCooldown` 映射成"开火周期"**，要先按行为分类 | 用户口述 + `tmp/_check_timing.py` | ✅ 已确认 |
| I60 | **沙暴（`unit_gdi_sandstorm`）的 DPS 公式已用游戏内面板数值反推验证**：<br>`DPS = missileCount × damage / burstCooldown_s`，即 `12 × 150 / 4.0 = 450`（1-0 级），乘 `F(5,0)=1.2733875` = **573.0** —— 与用户报的游戏内 5-0 面板数值 **573 完全吻合**。<br>参数在 `weapon.modifier_sequence.tuning`：`burstCooldown = 4000`（**整轮周期**，倾泻+停顿都含在内）、`perTargetCount[1] = { timePerMissile = 200, missileCount = 12 }`（按目标小队数分档，2 个→24 发/100ms，3 个→36 发/66ms）。<br>⚠️ 注意 `baseDps()` 目前对这类武器**返回 0**（因为 `burstTiming.cooldown` 缺失会直接 `return 0`），所以游戏内 573 这个数**我们的代码现在算不出来** | `data/unit/unit_gdi_sandstorm.lua.json` 的 `weapon.modifier_sequence`；`tmp/.../unit_gdi_sandstorm.lua:51-71`；`core/src/types.ts` 的 `baseDps` | ✅ 已确认 |
| I61 | ❌ **更正 I56/I57 的一处错误结论**：当时写"我们的提取器没有读 `modifier_sequence` 这个块"是**错的** —— 产物 JSON 里 `modifier_sequence` / `missileCount` / `timePerMissile` / `perTargetCount` / `4000` **全都在**。真正的问题是它**没进 `core/src/types.ts` 的类型定义、也没有任何代码使用它**。当时只 grep 了 `burstTiming.cooldown` 就下了结论，属样本偏差 | `data/unit/unit_gdi_sandstorm.lua.json`（搜 `missileCount` 命中）；对照 `WeaponTuning` 类型定义 | ❌ 已推翻（I56/I57 中该句作废，其余分类结论仍成立） |
| I62 | **四类攻击方式的 DPS 公式已全部用游戏内面板数值反推验证**（用户各提供一个观测点，误差均 < 0.3%）：<br>· **持续型**（弹弓）：`DPS = 单发伤害 ÷ modifier_sequence.tuning.burstCooldown_s`。`54/0.18 = 300`，`×F(8,0)=1.69490` = **508.5** ✅<br>· **前摇+分段持续**（万钧巨炮）：取 `stage3.damageMain ÷ (tickPeriodMs/1000)`。`150/0.25 = 600`，`×F(9,0)=1.86401` = **1118.6** ✅（前摇 `initialChargeUpMs=500` 不计入）<br>· **倾泻+停顿**（沙暴）：`missileCount × damage ÷ burstCooldown_s` = `12×150/4.0 = 450`，`×F(5,0)` = **573** ✅（见 I60）<br>· **交替型**（催化炮艇）：`主动武器伤害 ÷ catalystBurst.cooldown_s` = `270/1.6 = 168.75`，`×F(3,0)=1.1025` = **186.0** ✅<br>⚠️ 交替型那条**只是数值吻合**，机制（为何用 `catalystBurst.cooldown` 而不是主动武器自己的 `burstTiming.cooldown = 3`）尚未从源码确认 | 用户提供的四个游戏内观测点 + `unit_{slingshot,beamcannon,sandstorm,catalystgunship}.lua`；`core/src/levels.ts` 的 `levelFactor` | ⚠️ 推断（前三条已确认；交替型待确认机制） |
| I63 | **催化炮艇（`unit_nod_catalystgunship`）的两把武器是「瓦斯铺场 + 火箭引爆」，不是轮流开火**：<br>· **[0] `gasWeapon`**（瓦斯喷洒，伤害 25／对载具 20）：`gasBurst.cooldown = 6000`、前摇 4500、`fullChargeLostMs = 6000`；命中留下瓦斯云（`gasCloudModifierId = modifier_chem_warrior_gas_cloud`）<br>· **[1] `catalystWeapon`**（催化剂火箭，伤害 **270**／对载具 50）：`burstTiming.cooldown = 3`、前摇 0.08；弹体带爆炸 modifier `damage {default:50, override:[Structure,Infantry]}`、`radius = 6`，但**必须由瓦斯云触发**（`MODIFIER_THAT_ACTIVATES_EXPLOSION = modifier_chem_warrior_gas_cloud`）<br>单位描述原文印证："每5秒发射一发泰晶瓦斯榴弹，命中后会留下一片泰晶瓦斯。对处于泰晶瓦斯内的单位造成额外伤害。" | `data/unit/unit_nod_catalystgunship.lua.json` 的两把武器；`r.desc_zh` | ✅ 已确认 |
| I64 | **`catalystWeapon.descriptors = {}` 在源码里字面就是空表**（`unit_nod_catalystgunship.lua:75`），**不是提取缺失** —— 原怀疑排除。全库仅 **6/83** 把武器是空的：`gdi_msv.rockets`、`gdi_orcabomber.bomb`、`gdi_repairdrone.guns`(+`_CR`)、`nod_catalystgunship.catalystWeapon`、`nod_ticktank.hidden`。看名字（炸弹/维修臂/潜伏武器）可知它们本就不靠 `descriptors` 选目标。<br>⚠️ **因此「空 descriptors」不能解读成"打不到任何东西"** —— 催化火箭明明打出 270 伤害。现有 `canAttackTarget` 对空数组只对建筑返回 true，是错的 | `tmp/.../unit_nod_catalystgunship.lua:75`；全量扫描 `data/{unit,commander}/*.lua.json` 的 `weaponTunings[].descriptors` | ✅ 已确认 |
| I66 | **83 把武器用到的 `descriptors` 位值全清单**：`8 Ground` ×49、`16 AttackableTypeMask` ×72、`32 Vehicle` ×3、`64 Air` ×2、`128 NotHiddenTypeMask` ×22、`256 Infantry` ×1、`512 Building` ×2、`4096 TransportTypeMask_Flying` ×5 | 全量扫描 `data/{unit,commander}/*.lua.json`；位值定义见 `core/src/extract/luaRuntime.ts` 的 `DESCRIPTOR_BITS` | ✅ 已确认 |
| I67 | ❌ **`TransportTypeMask_Flying`(4096) 不是「能打空中」的判据** —— 带这个位的只有 **5 把**武器（hammerhead/mammothtank/slingshot/talon 的火箭或机炮 + `nod_viper.rocketLauncher`），而 `goodAgainst` 含 Aircraft 的有 **27 个单位**。用户确认其中斗牛犬、炮塔、区域装甲兵等**都能防空**。此前 I35 的"Flying 位 = 能打空中"是**拿弹弓/利爪两个样本推全体**得出的，不成立 | 全量扫描对比；用户实测确认 | ❌ 已推翻 |
| I69 | **`canAttackTarget` 的规则（截至当前）**：<br>· **`descriptors` 为空 → 只对地**（等同 `Ground`）。依据：催化炮艇 `catalystWeapon` 源码 `unit_nod_catalystgunship.lua:75` 是空表，**用户实测它只能对地**<br>· **含 `NotHiddenTypeMask`(128) 或 `AllMask`(1024) → 地空通吃**（22 把，**防空单位全在这一类**：斗牛犬 / 炮塔 / 区域装甲兵 / 飞弹小队 …）<br>· **含 `TransportTypeMask_Flying`(4096) → 只打空中 + 建筑**（5 把：hammerhead / mammothtank / slingshot / talon 火箭 / viper）<br>· **含 `Ground`(8) → 打地面单位 + 建筑，打不到空中**（49 把）<br>· **建筑：一律可打**<br><br>验算：`[16,128]` 斗牛犬/炮塔/区域装甲兵 全能打 ✓（用户实测能防空）；`[8,16]` 掠食者 空中不可打 ✓；`[4096,16]` 弹弓 只空中+建筑 ✓（用户实测） | `core/src/types.ts` 的 `canAttackTarget`；全量扫描 `data/unit/*.lua.json`；用户实测 | ⚠️ 推断（空表那条已由用户实测确认；其余四条待更多观测复核） |
| I70 | ❌ **更正 I69 的前一版：`descriptors = {}` 不是「NO TYPE · 全能打」**。我误读了用户口中"NO TYPE 全能打"的含义，写成空表=全能打并改了代码，随即被"催化剂只能对地"推翻。<br>⚠️ **用户提到的「NO TYPE 全能打」到底指哪个字段/机制，目前仍未定位**。在定位清楚之前不要再改 `canAttackTarget` | `core/src/types.ts`；用户实测 | ❌ 已推翻（该版解释作废） |
| I71 | **`descriptors = {}` 的 6 把武器是一组「杂项」，没有统一含义**（逐把核查，用户假说"催化剂用的是另一套逻辑、毒雾不靠索敌"只部分成立）：<br>· `orcabomber.bomb` —— **弹体带 modifier + `modifier_spawn`**（爆炸类）✅ 支持<br>· `catalystgunship.catalystWeapon` —— **弹体带 modifier**（爆炸由毒雾触发）✅ 支持<br>· `msv.rockets` / `ticktank.hidden` —— 只有 `modifier_intro/outro`（部署/形态切换）❌<br>· `repairdrone.guns`(+`_CR`) —— 无任何 modifier，压根不是武器 ❌<br>**结论：无统一规则**（"空=全能打""空=只对地""空=modifier 驱动"三版全不成立）。现按用户决定：**代码里视作「索敌方式未知」**，`core/src/types.ts` 新增 `targetingUnknown()`，`damageTiers.ts` 给 `unknown` 档位（紫色问号），UI 显示"未知"而不是猜的结论 | `core/src/types.ts`、`web/src/damageTiers.ts`、`DamageMatrix.vue`；用户决定 | ✅ 已确认（已实现） |
| I72 | **游戏里没有"N 种可复用攻击方法"——是 `61` 把常规武器 + `22` 把单位专属能力序列。** 全量扫描 `modifier_sequence.behaviour.name` 得出：**61/83 无 `modifier_sequence`**；**22 把各有一个 `ability_<单位>_weapon_sequence`，名字全是单位专属、无通用名**（slingshot / wolverine / sandstorm(_ST) / beamcannon / catalystgunship / avatar_laser / avatar_fire / basilisk / disruptor / kodiak / confessor / flametank / flame_trooper / chemical_warrior / chem_quad / rockwyrm / scarab / widowmaker_fire / juggernaut(_ST) / empty(orcabomber)）。<br>⚠️ **这推翻了"归一到五种形态"的设计** —— 那五种只是从 4 个样本归纳的表象。正确做法是：61 把常规走通用函数，**22 把逐个读、建「单位→处理函数」表**。好消息是这 22 个有限且可穷举 | 全量扫描 `data/{unit,commander}/*.lua.json` 的 `weaponTunings[].modifier_sequence.behaviour.name` | ✅ 已确认 |
| I73 | **61 把常规武器的 `burstTiming` 有 4 种子形状**：`[chargeUpDuration, cooldown, numToBurst]` ×56；`+chargeUpLockOnTime` ×7（带锁定前摇）；`+fireRate` ×1；`+chargeUpLockOnTime+fireRate` ×1。另有 **7 把带 `reloadTuning`**（弹夹）。**「只有 `numToBurst`、没有 cooldown」正好 18 把**，与 I56/I57 缺 cooldown 的武器集合完全吻合 —— 印证"缺 cooldown ⇔ 走能力序列" | 全量扫描 `burstTiming` 字段组合 | ✅ 已确认 |
| I74 | **22 把能力序列武器的 DPS 公式已基本反推完成**（用户提供 12 个游戏内面板观测点，"史诗未解锁"=起始 5-0、"稀有未解锁"=3-0）：<br>**A 族 `burstCooldown`：`damage × waveSize ÷ burstCooldown_s`**（`muzzleStrategy=All` 时再 × `muzzleCount`）<br>　弹弓 54×1/0.18=300 ✅ · 狼獾 45×1/0.19=236.84（报 236.86）✅ · **忏悔者 40×3/0.4=300**（报 300.05）→ **是 3 人小队** ✅ · **生化战士 20×3/0.5=120**（报 120.0）→ 3 人小队 ✅ · **火焰坦克 damageMain 380/0.5=760**（报 760.0）✅<br>**B 族 `stage`+`tickPeriodMs`：`末段 damageMain ÷ tickPeriodMs_s`**<br>　万钧巨炮 stage3 150/0.25=600 ✅ · **蛇怪 stage2 175/0.25=700**（报 771.8/1.1025=700.0）✅ · 寡妇制造者 140/0.5=280 ✅<br>**E 族 齐射 `durationBetweenVolley`：`每轮总伤害 ÷ durationBetweenVolley_s`**<br>　科迪亚克 1500/3.0=500（报 551.3/1.1025=500.05）✅ · **神像机甲 ?/2.5=480**（报 611.2/1.2734=480.0）→ 每轮 1200 ✅<br>**C 族 倾泻**：沙暴 12×150/4.0=450 ✅（见 I60） | 用户提供的 12 个面板观测点 + `data/unit/*.lua.json` 的 `modifier_sequence.tuning` | ✅ 已确认 |
| I75 | **三条合成规则（用户观测 + 验算确认）**：<br>· **双武器取最大，不求和** —— 圣灵 laser 160/0.25=640 与 fire 140/0.5=280，报 815.0/1.2734=**640.0** ✅<br>· **毒雾不计入 DPS** —— 生化战士 120 = 纯枪伤 20×3/0.5，`spawnGasTimeMs=750` 不影响 ✅<br>· **`damageMain` 与 `damageSide` 不相加，用 `damageMain`** —— 火焰坦克 760 = 380/0.5，副炮 380 不计 ✅ | 同上；`unit_nod_avatar`、`unit_nod_chemicalwarrior`、`unit_nod_flametank` 的 `modifier_sequence.tuning` | ✅ 已确认 |
| I76 | ✅ **爆炸类武器的伤害不在 `damageTuning`，而在 `projectile.modifier.tuning.damage`**（用户提出"奥卡轰炸机和圣甲虫都是爆炸，会不会和神像类似"，完全成立）。四把爆炸类武器的 `damageTuning` 全是空的：<br>· **神像机甲** `rockets` → modifier damage **400**<br>· **虎鲸轰炸机** `bomb` → modifier damage **800**（对建筑 800 / 步兵 270 / 矿车 400），另有 **`damageFalloff`**（0格100% → 6格65% → 12格45% → 18格25%，`isRamped`）与 **`damageRadius: 18`**；投弹节奏在 `modifier_spawn.burstTuning{initialChargeUpMs:1750, shotCooldownMs:500}`<br>· **圣甲虫** `rifle` → modifier damage **2000**（对载具覆盖），`MODIFIER_FIRE`、`durationMs:-1`<br>· **催化剂** `catalystWeapon` → `damageTuning` 有 270，爆炸 modifier 另有 50 + `EXPLOSION_MODIFIER`<br><br>**三把原本无解的 F 族全部算通**（误差 < 0.05%）：虎鲸 `800 ÷ 0.5s = 1600` ✅ · 圣甲虫 `2000 × 2 ÷ 5.0s = 800` ✅（**×2 是 `waveSize=2`**，本质就是 A 族公式）· 神像机甲 `400 × 3 ÷ 2.5s = 480` ✅（**×3 是一轮 3 发**，与用户"一格 + 周围 6 格"吻合）。<br>**结论：不存在独立的「F 族」**，只需多一层"伤害从哪取"的解析，五族足够覆盖 22 把 | 用户提出假说 + `unit_{gdi_juggernaut,gdi_orcabomber,nod_scarab,nod_catalystgunship}.lua.json` 的 `projectile.modifier` | ✅ 已确认（F 族消解） |
| I77 | **B 族（分段光束）的伤害是「随时间递增」的，算出的 DPS 是峰值不是平均**（用户提出"光束炮是不是随着时间攻击力会上升"）。万钧巨炮：`stage1 { attackCount=12, damageMain=45 }` → `stage2 { attackCount=24, damageMain=90, damageSide=40, sideTargetCount=2 }` → `stage3 { damageMain=150, damageSide=50, sideTargetCount=3 }`，`tickPeriodMs` 三段都是 250。<br>即 **单发主伤 45→90→150、副伤 0→40→50、溅射目标 1→2→3**，阶段时长 3.0s → 6.0s → 无限。蛇怪同理（stage1 `50`×8 发 → stage2 `175`）。<br>**面板显示的 600 / 700 是最后一段的稳态 DPS，不是全程平均。** 展示时必须画出"越来越强" | 用户提出 + `unit_nod_beamcannon.lua`、`unit_nod_basilisk.lua`；验证见 I74 | ✅ 已确认 |
| I78 | **`AttackType` 必须分两层**（用户提出）：**`WeaponAttack`（武器级）** 负责五族的公式与 `phases()`；**`UnitAttack`（单位级）** 负责聚合 —— **双武器取最大**（I75）、D 族的两武器交互、小队信息（`waveSize` / `attackSeparationDurationMS`）。对外 `UnitAttack.of(unit, level)`，内部 `WeaponAttack.of(weapon, waveSize)`。混成一层会别扭，因为 `damageTuning` 是武器级而"取最大"是单位级 | 用户提出；依据 I75 | ✅ 已确认 |
| I79 | **时序图是二维的，行 = 武器 × 队员的叉积**（用户提出"相图是不是应该是二维，因为有小队成员"）。行数 = `武器数 × 队员数`（步枪兵 1×5=5 行；利爪 2×1=2 行）。<br>**现状问题**：多武器单位是每张武器卡各画一张图，看不出"主炮与侧炮怎么交错"—— 科迪亚克"主炮侧炮先后开火"正需要同图对照。横轴还必须能表达**段**（B 族三阶段、C 族倾泻+停顿），不只是均匀刻度 | 用户提出；对照 `web/src/components/WeaponTimeline.vue` 现状 | ✅ 已确认（待实现） |
| I68 | ❌ ~~可攻击目标由「武器 descriptors」与「单位 goodAgainstTags」叠加判定~~ **已推翻**：不需要 `goodAgainstTags`，单靠 `descriptors` 四类规则就能全部解释（见 I69）。利爪那个"反例"也不存在 —— 机枪 `[8,16]` 本来就不该判成能防空 | `core/src/types.ts`；I69 的验算表 | ❌ 已推翻 |
| I65 | ⚠️ **推测：`modifier_sequence.<xxx>Burst.cooldown` 会覆盖武器的 `burstTiming.cooldown`**。催化炮艇的 `catalystWeapon.burstTiming.cooldown = 3`，但面板 DPS 反推出的分母是 **1.6**（= `catalystBurst.cooldown = 1600ms`）。若成立，则凡是带 `modifier_sequence` 的武器，其真实节奏应以该块为准 | `unit_nod_catalystgunship.lua.json` 的 `modifier_sequence.catalystBurst`；I62 的验算 | ⚠️ 推断（待第二个观测点交叉验证） |
| I52 | ⚠️ **待办：`docs/data-semantics.md` 第 8/9 节仍写着 `descriptors` 位掩码数字"是编造的、不能当真实数据用"，与现状矛盾** —— I33 之后位值已在 `extract/luaRuntime.ts` 的 `DESCRIPTOR_BITS` 里显式钉死，且 `canAttackTarget()` 正依赖 `Ground=8` / `TransportTypeMask_Flying=4096` / `NotHiddenTypeMask=128` 做判定。按 AGENTS.md 规则 5，该文档必须更新（并说明"钉死之后才可用"） | `docs/data-semantics.md:331-332`、`:368-386`；`core/src/extract/luaRuntime.ts` 的 `DESCRIPTOR_BITS` | ❓ 待验证 |
| I42 | **总览里「随等级变的」与「不变的」并排，不拆两张卡**：总血/DPS（随等级，22px 大字）与基本信息（造价/移动速度/视野/能否被碾压/反隐/被击杀给矿/部署解除，14px）放在同一行，中间一条竖分隔线，超出宽度自动换行。理由是两者都属于「这个单位是什么样」，拆开要来回看。原先独立成卡的「基本信息」卡已删除 | `web/src/components/UnitPanel.vue` 的 `.facts` / `.fact.big` / `.divider`；`tmp/fpc.png` | ✅ 已确认 |
| I36 | **运矿车「是载具」也「是单独的伤害分类」，两者同时成立**。它的 `tags` 是 `["Vehicle", "override_harvester", "override_vehicle"]`：<br>· 基础兵种 = **Vehicle**（`baseUnitType()` 取第一个非 `override_` 标签）<br>· 伤害分类 = **Harvester**，在 `DamageOverrideTag` 里和 Vehicle 平级<br>· 它**同时**带 `override_vehicle`，所以只写 `Vehicle` override 的武器对它也生效 | `data/unit/unit_gdi_harvester.lua.json` 的 `tags`；`core/src/types.ts:35` 的 `DamageOverrideTag` | ✅ 已确认 |
| I37 | **运矿车确实被单独针对**：9 把武器的 overrides 里有 `Harvester`，其中只有 2 把同时写了 `Vehicle` —— 也就是 **7 把武器专门单挑运矿车**。对照 30 把武器有 `Vehicle` override | 全量扫描 `data/unit/*.lua.json` 的 `damageTuning.overrides` | ✅ 已确认 |
| I38 | ~~算「克制」时运矿车这一格要同时看 `Harvester` 与 `Vehicle`，取更具体的那个~~ | ❌ **已被 I40 取代**（`override` 是优先匹配的回退链，不是"取更具体"的特例），实现见 `core/src/types.ts` 的 `DAMAGE_CASCADE` | ❌ 已推翻 |

---

## 待办（尚未成为结论）

- [ ] Vue 详情页重新用卡片重做（现在还是旧版表格）
- [ ] 数值（总血 / 每员 / DPS / 射程 / 速度 / 视野）现在**没有组件承载**——卡片墙不再显示它们。需要决定：新建 `UnitStats`，还是给 `UnitCard` 再加一组 `fields`
- [ ] 决定 `views/UnitList.vue`（表格预览）是否改名 `UnitRow`、`#/table` 路由是否保留
- [ ] 网页上把「未上线 / 不在客户端」的条目标出来（`_pb_release.py` 已能判定），否则用户会奇怪为什么图鉴里有游戏里没有的单位
- [ ] 决定 `unit_example` / `unit_dlc_test` / `cmdr_dlc_test` 是否从产物中剔除
- [ ] 决定 `data/art/`（旧目录）与 `data/wiki-art-map.json` 是否删除 —— 已被 `data/img/` 取代
- [ ] 修 E28：运矿车备用图（现只影响 `docs/art-coverage.md` 的记录，不再落盘）
- [ ] `reference/` 标注为 legacy；`docs/extraction.md` 补 Node 实现章节
- [ ] 把根目录 `_*.py` / `_*.mjs` 收进 `tools/` 并入库（`_measurements.py` 是人工实测基准，必须保留）
- [ ] `web/src/levelDisplay.ts` 删除（两次被拒）
| I80 | **`core/src/attack.ts` 落地，并带上数据驱动的验证测试 `core/test/attack-verify.ts`**（跑法 `node --experimental-strip-types core/test/attack-verify.ts`）。用 `attack-mechanics.md` 第 3 节的 15 个观测点断言 `UnitAttack.of(unit).dps() ≈ 面板值 ÷ F(major,minor)`，**当前 12/15 通过**。类：`WeaponAttack`（基类，含三处伤害来源解析）+ `ContinuousAttack`(A) / `StagedAttack`(B) / `PourAttack`(C) / `DetonateAttack`(D) / `VolleyAttack`(E) / **`TickAttack`（新增，单段光束 {damage, tickPeriodMs}）** / `BasicAttack`(常规) / `UnknownAttack`；`UnitAttack.of()` 做单位级聚合（**取最大**）。⚠️ **`muzzleFactor()` 固定为 1** —— 原 `baseDps` 里"`muzzleStrategy==='All'` 就乘 `muzzleCount`"是错的：火焰坦克 All+muzzleCount=2，实测 380/0.5=760（×1），乘 2 会得 1520 | `core/src/attack.ts`、`core/test/attack-verify.ts` | ✅ 已确认（12/15） |
| I81 | ❓ **验证测试剩 3 个未通过，原因已定位未修**：· **寡妇制造者** 算得 320（另一把武器）期望 280（喷火器 140/0.5）—— "取最大"取到不该计的武器；· **催化剂** 算得 90 期望 168.75 —— 需**单位级规则**：爆炸武器伤害 ÷ **另一把武器**的 `catalystBurst.cooldown`（该字段在 `gasWeapon` 的 tuning 里，不在 `catalystWeapon` 里）；· **神像机甲** 算得 160 期望 480（400×**3**/2.5）—— 缺"每轮 3 发"，但 `numToBurst=1`、`muzzleCount=1`、`modifier_sequence` 里也无发数字段，**来源未知** | `core/test/attack-verify.ts` 输出 | ❓ 待验证 |
| I82 | **「双武器取最大」这条规则不完整**（验证测试暴露）。寡妇制造者（waveSize=1）两把武器：`flamethrower` TickAttack `140/0.5 = 280`（**面板显示的就是这个**）与 `rockets` BasicAttack `80×6/1.5 = 320`（"取最大"会错取它）。<br>但圣灵相反：`laser` **第一把** 640 > `fire` 280，面板 640 → 也符合"取第一把"。<br>而虎鲸会破"取第一把"：第一把 `targetSelector` 伤害为 0，面板 1600 来自第二把 `bomb`。<br>**结论：需要一把「有效武器」的判据**（`targetSelector` 明显不是真武器 / 可能是辅助武器标记），**取最大与取第一把都不对** | 验证测试 + `unit_nod_widowmaker.lua.json`、`unit_nod_avatar.lua.json`、`unit_gdi_orcabomber.lua.json` | ❓ 待验证（需用户确认游戏面板取哪把） |
| I83 | ❓ **神像机甲的"每轮 3 发"在数据里不存在**。期望 `400 × 3 / 2.5 = 480`，但整个 JSON 里**没有 3、也没有 1200**：`waveSize=1`、`projectile.modifier.damage=400`、`modifier_sequence={delayAfterShot:250, durationBetweenVolley:2500, initialChargeUpMs:500}`、`modifier_intro.durationMs=5000`（部署）、`modifier_outro=2000`（撤收）。<br>推测 3 是**发射位置数**（3 个弹道）而非数据字段；若如此则需**手工标注**，或从 `damageRadius` / 溅射参数反推 | `unit_gdi_juggernaut.lua.json` 全量键；用户观测 | ❓ 待验证 |
| I84 | ✅ **「每把武器各显示自己的 DPS」解决了 I81/I82 的困境**（用户提出）。不必再求"游戏面板取哪把武器" —— 单武器单位面板值 = 它的 DPS；多武器单位面板值 ∈ 各武器 DPS 集合。验证测试据此改为**「面板值命中任意一把武器的 DPS 即通过」**，结果 **14/15**：寡妇制造者 280（喷火器←，火箭 320）✅、圣灵 640（laser←，fire 280）✅、虎鲸 1600（bomb←，targetSelector 0）✅ 全部命中。 | `core/test/attack-verify.ts` | ✅ 已确认 |
| I85 | ✅ **D 族（催化剂）的单位级规则已实现并验证**：`catalystBurst` 写在**铺场那把**（`gasWeapon`）的 tuning 上，而伤害在**另一把**（`catalystWeapon`，270）上。`UnitAttack.of()` 现在会把全部武器里的 `catalystBurst.cooldown` 取出，交给伤害最高的那把非铺场武器重新判为 `DetonateAttack` 并 `withCycle()`。结果 `270/1.6 = 168.75`（报 168.71）✅ | `core/src/attack.ts` 的 `DetonateAttack.withCycle()` 与 `UnitAttack.of()` | ✅ 已确认 |
| I86 | ❓ **验证测试仅剩神像机甲 1 例未过**：算得 160（400/2.5），期望 480（400×**3**/2.5）。"3"在 JSON 里不存在（I83）。**待用户确认是否为 3 个弹道/发射位**；若是则需手工标注。当前 14/15 | `core/test/attack-verify.ts` | ❓ 待验证 |
| I87 | ✅ **神像机甲缺失的"3"来自 SetupModifierVisuals 表的 MUZZLE_INFO 条目数**（用户找到源码位置）。<br>· **我们的产物里没有它** —— 提取器不读 `SetupModifierVisuals`（实测 juggernaut/flametank/kodiak 的 JSON 里都搜不到 MUZZLE_INFO / isual）<br>· **全库只有 4 个单位有 MUZZLE_INFO**：`gdi_juggernaut` 3 条、`gdi_juggernaut_ST` 3 条、`gdi_sandstorm` 2 条、`gdi_sandstorm_ST` 2 条<br>· 神像机甲 `400 × 3 / 2.5 = 480` ✅ 完全吻合；且该表的 `CLEAR_AFFECTED_AREA_VISUAL_TIME_MS = 2500` **正好等于 `durationBetweenVolley = 2500`**，证明这张表确实绑在武器序列上、不是纯美术<br>· **沙暴是反例且正好定出规则**：它也有 2 条，但 DPS 不需要 ×2 —— 因为 `perTargetCount[1].missileCount = 12` 已显式写明发数<br><br>**规则**：`每轮发数 = 显式发数（missileCount / attackCount / numToBurst） ?? MUZZLE_INFO 条目数 ?? 1`，**显式优先、MUZZLE_INFO 兜底** | 用户提供的源码；`tmp/.../unit_gdi_juggernaut.lua` 的 `unit_gdi_juggernaut_visual`；全量扫描 `MUZZLE_INFO` | ✅ 已确认（规则已定，**待实现**） |
| I88 | ✅ **muzzleCount / MUZZLE_INFO 的语义 = 发射器数量，它从不乘 DPS**（用户澄清"沙暴是两个发射器交替发射"）。这补上了 I80 里"`muzzleFactor()` 固定为 1"的**原因**：发射器只决定"多发怎么分配"，不是伤害乘数。<br>· **沙暴** 2 个发射器、一轮 **12** 发（`missileCount` 显式）→ 12 发交替从 2 个发射器打出，各 6 发；DPS 用 12，**不是** 12×2<br>· **神像机甲** 3 个发射器、**无显式发数** → 一轮 3 发，3 个发射器各 1 发<br>· **火焰坦克** `muzzleCount=2` + `All`、每 500ms 一发 → 2 个发射器交替，各每 1000ms 一发；DPS 用 1，**不是** ×2<br><br>**与 I87 的规则不矛盾**：`每轮发数 = 显式发数 ?? 发射器数 ?? 1`，沙暴走前者、神像走后者 | 用户澄清 + `unit_gdi_juggernaut.lua` 的 `MUZZLE_INFO`；验证见 I87/I80 | ✅ 已确认 |
| I89 | ✅ **MUZZLE_INFO = 枪口分配模式；`muzzleIndex` 指明每一发从哪个枪口出**（用户追问 muzzleIndex 的值而定论）。全量对比：<br>· **神像机甲** 3 条 `muzzleIndex = [0,0,0]` → **同一枪口连打 3 发**（1 个枪口）<br>· **沙暴** 2 条 `muzzleIndex = [0,1]` → **2 个枪口交替**，该模式**循环** 6 次 = 12 发（`missileCount=12`）<br><br>所以：`条目数 = 模式长度`、`不同 muzzleIndex 数 = 枪口数`；**发数 = 显式发数（missileCount/attackCount/numToBurst） ?? 模式长度 ?? 1**。<br>这同时解释了 I88 的"发射器从不乘 DPS"与 I87 的"沙暴不能用 2、神像必须用 3"—— 三者自洽 | 用户提供源码 + 全量扫 `MUZZLE_INFO` 的 `muzzleIndex` | ✅ 已确认 |
| I90 | 🔴 **重大发现：22 把特殊武器的真正实现不在单位文件里，而在 `gameplay/abilities/ability_*_weapon_sequence.lua` 的 `Timeline()` 函数中 —— 我们从未提取过这个目录。**（用户指出 `behaviour` 才是真正的实现）<br>`modifier_sequence.behaviour` 在 JSON 里是 `{}`，因为它是个 **Lua 函数**，提取器序列化不了；`tuning` 只是参数。<br>`gameplay/abilities/ability_juggernaut_weapon_sequence.lua:69-79` 的 `Timeline()` 里**三个 `Fire()` 调用是硬编码的**：<br>`self:Fire(0, 1)` → `waitForAge += delayAfterShot` → `self:Fire(2, 2)` → … → `self:Fire(4, 3)`<br>这正是神像机甲 `3 × 400 / 2.5 = 480` 里那个神秘"3"的来源，**任何数据字段里都没有**。其余参数也对上：`SetCooldown(tuning.durationBetweenVolley)`（周期 2500）、`WaitForAge(tuning.initialChargeUpMs + cooldownEndTime)`（前摇）、每发间隔 `tuning.delayAfterShot`。<br>`Fire(cornerIndex, muzzleIndex)` 第一参数是 **cornerIndex = 0/2/4**，即 3 个发射位，与用户"攻击一格和周围 6 格"的印象吻合。<br>⚠️ **方法论修正**：此前"从 tuning 字段反推公式"对这类武器是**走错了路** —— 发数/顺序/位置写死在函数体，推不出来。正确做法是**读这 22 个 `Timeline()` 源码** | 用户指出 + `gameplay/abilities/ability_juggernaut_weapon_sequence.lua:24-88` | ✅ 已确认 |
| I91 | ✅ **`MUZZLE_INFO` 已提取进产物**（`unit_<id>_visual` → `EntityRecord.visual`），**验证测试 15/15 通过**。规则：发数 = 显式发数（`missileCount`/`attackCount`/`numToBurst`）?? 硬编码 Fire 调用数 ?? 1。<br>被提取到的 6 个单位：神像 `[0,0,0]`、神像_ST `[0,0,0]`、科迪亚克 `[0,1,2]`、沙暴 `[0,1]`、沙暴_ST `[0,1]`、虎鲸轰炸机 `[0,1]`（挂在 `modifier_orcabomber_bomb` 下）。<br>⚠️ 提取时踩到两个坑：① wasmoon 对纯整数键的表**有时转数组有时转对象**（神像是对象、沙暴是数组），两种都要收；② **不能用「全局是否为 null」判断存在性** —— 运行时给未定义全局返回 autotable，永远不是 null，改成"哪一份能解析出 MUZZLE_INFO 就用哪一份" | `core/src/extract/extract.ts` 的 `visualOf()`；`core/src/types.ts` 的 `EntityRecord.visual`；`core/test/attack-verify.ts` | ✅ 已确认（15/15） |
| I92 | ❌ **更正 I89：「`#MUZZLE_INFO` = 一轮发数」是错的**（用户指出"沙暴不应该 ×12 而不是 ×2 吗"）。**`#MUZZLE_INFO` 是「枪口数」，不是「发数」**：<br>· 沙暴 `#MUZZLE_INFO=2` 但一轮打 **12 发**（`missileCount`），Timeline 是**在 2 个枪口上轮转 12 发**（`MUZZLE_INFO[totalMuzzlesFired % #MUZZLE_INFO + 1]`）<br>· 科迪亚克 `#MUZZLE_INFO=3`，`ipairs(MUZZLE_INFO)` 每枪口一发 → 恰好 3 发，但它的 `damageTuning=1500` 是**整轮总和**，所以 DPS **不乘**<br>· 神像机甲 `#MUZZLE_INFO=3`，但 3 发是**硬编码的三个 `Fire()` 调用**，与 MUZZLE_INFO 只是巧合相等<br>科迪亚克 L19 的断言 `delayAfterShot × #MUZZLE_INFO` 讲的是**时间**能否塞进一轮，不能当作发数的通用依据。<br>⚠️ 当前 `VolleyAttack` 只在「伤害写在 `projectile.modifier` 上」时乘 `patternLength` —— 这是**由实测拟合的窄规则**（正例仅神像机甲），已在代码注释里标明正反例，**不是推导出的定律** | 用户指出；`unit_gdi_sandstorm.lua` 的 Timeline；`unit_gdi_kodiak.lua:19`；`core/src/attack.ts` 的 `patternLength` 注释 | ❌ 已推翻（I89 该句作废） |
| I93 | **游戏数据自身的 bug：`unit_gdi_sandstorm_ST.lua:103` 写的是 `unit_gdi_sandstorm_visual`（少了 `_ST`）**，把基础单位的 visual 全局覆盖了，且 `unit_gdi_sandstorm_ST_visual` 从不存在的。提取时对变体加了「回退到基础名」的处理 | `tmp/.../unit_gdi_sandstorm.lua:101` vs `unit_gdi_sandstorm_ST.lua:103`；`core/src/extract/extract.ts` 的 `visualOf()` | ✅ 已确认 |
| I94 | ✅ **按 `behaviour` 名精确派发，取代字段嗅探**（用户提出"让 behaviour 类负责自己的 DPS 计算"）。<br>提取器新增：把源码里的 `behaviour = <函数名>` 补成 `weapon.modifier_sequence.behaviourName`（原来 JSON 里是 `{}`，函数无法序列化）。共 **21 把武器**带它、**15 个不同实现**。<br>`core/src/attack.ts` 新增 15 个类（`SimpleWeaponSequence` / `ChemicalWeaponSequence` / `RockWyrm…` / `FlameTank…` / `AvatarLaser…` / `AvatarFire…` / `WidowMaker…` / `BeamCannon…` / `Basilisk…` / `Kodiak…` / `Juggernaut…` / `Sandstorm…` / `Catalyst…` / `Scarab…` / `Disruptor…`）+ `BEHAVIOURS` 注册表，各自继承合适的形状基类，**只写已验证的公式**。<br>**收益**：工厂里的 `if ("stage1" in t) …` 那一串嗅探全部删除 —— 那正是本项目反复出错的地方（漏 `TickAttack`、`muzzleFactor` 错、`damage()` 少两支）。**改动后 15/15 保持通过** | `core/src/extract/extract.ts` 的 `attachBehaviour()`；`core/src/attack.ts` 的 15 个类与 `BEHAVIOURS`；`core/test/attack-verify.ts` | ✅ 已确认（15/15） |
| I95 | **常规武器没有 behaviour，也没有 `modifier_sequence`** —— 83 把里 **62 把**如此（如掠食者坦克的武器只有 `burstTiming`/`damageTuning`/`descriptors`/`projectile`/`targetSelector`/… 12 个字段，无任何行为键）。说明它们由**引擎内置的默认开火序列**驱动（在宿主 C++ 里），`burstTiming` 只是它读的参数。<br>所以分层是：**62 把 → 字段驱动（`BasicAttack`）；21 把 → 按 behaviourName 派发到 15 个类**。<br>（另：35 把武器含 "behaviour" 字样，那是 `projectile.modifier.behaviour` 之类的**弹体/修改器**行为，不是开火序列；22 把含 "sequence" = 21 把 + orcabomber 的空壳 `ability_empty_weapon_sequence`。） | 全量扫描 `data/{unit,commander}/*.lua.json`；`unit_gdi_predatortank.lua.json` 的武器字段 | ✅ 已确认 |
| I96 | **踩坑：工厂里 `modifier_spawn.burstTuning.shotCooldownMs` 必须查在 `burstTiming.cooldown` 之前**。虎鲸轰炸机两者都有（`shotCooldownMs=500` 与 `cooldown=1`），顺序反了会算成 800 而正确值是 1600。重构时踩到，验证测试当场抓到 | `core/src/attack.ts` 的 `weaponAttackOf()`；`core/test/attack-verify.ts` 的虎鲸那一行 | ✅ 已确认 |
| I97 | **没有「默认开火行为脚本」**（用户提问）。`gameplay/` 下共 **36 个 `Timeline` 实现，全是具名的**：15 个开火序列 + `ability_catalyst_explosion` + 约 20 个 modifier（`modifier_simple_intro`/`_outro`/`orcabomber_bomb`/`repair_drone_heal`/`wraith_squad`/`rockwyrm_intro` …）。**没有 `default` 也没有通用基类** —— `ability.lua`（基类）只有 `OnStart`/`OnUpdate`/`OnDestroy`/`TranslateToken`，**不含 `Timeline`**。<br>所以 **62 把常规武器的开火逻辑在宿主 C++ 里**，`burstTiming` 只是它读的参数；这也是为什么在 Lua 侧找不到它、只能靠游戏内面板反推公式（见 I74） | 全树扫描 `:Timeline(`；`gameplay/abilities/ability.lua`；`ability_empty_weapon_sequence.lua`（无 `Timeline` 的空壳） | ✅ 已确认 |
| I98 | **15 个开火实现里有两种架构**：<br>· **`Timeline(thread)` 协程** —— **14 个**（弹弓/火焰坦克/神像/沙暴/万钧巨炮/蛇怪/圣灵×2/黑寡妇/深岩巨虫/破坏者/圣甲虫/催化/生化）<br>· **`OnUpdate(deltaSeconds)` 状态机** —— **只有科迪亚克**（`ability_kodiak_weapon_sequence.lua` 无 `Timeline`，用 `OnUpdate` + `LoadCooldown`/`SaveCooldown` + `IsChargeUpDone`/`IsMuzzleCooldownDone` + `TryFireMuzzle` 自己管冷却）<br>· 空壳 —— `ability_empty_weapon_sequence`（orcabomber 的占位桩）<br>这解释了科迪亚克为何与众不同：**状态机按「轮」算，所以 `damageTuning=1500` 是整轮总和**；而神像的协程逐发 `Fire()`，`projectile.modifier.damage=400` 是每发值 | `ability_kodiak_weapon_sequence.lua` 的函数清单（无 `Timeline`）；全树 `:Timeline(` 扫描 | ✅ 已确认 |
| I99 | **15 个开火实现里只有科迪亚克用 `OnUpdate` 当开火循环**（用户追问"OnUpdate 还有别人吗"）。全 33 个 ability 文件逐个查 `:Timeline(` / `:OnUpdate(`：<br>· **14 个开火序列**：`Timeline` 有、`OnUpdate` 也有 —— 但后者的 `OnUpdate` **只是目标变更看门狗**（`HasTargetSquadChanged` → `MarkForDelete`），**不发一枪**。以 `ability_simple_weapon_sequence:OnUpdate` 与 `ability_juggernaut:OnUpdate` 为证<br>· **科迪亚克**：无 `Timeline`，`OnUpdate` **就是开火循环**<br>· `ability_empty_weapon_sequence`：无 `Timeline`，`OnUpdate` 只有目标检查（空壳）<br>· 开火序列之外还有 3 个以 `OnUpdate` 为主循环：`ability_tiberium_explosion`(141)、`ability_tiberium_strike`(263)、`ability.lua`(56，基类，只维护特效计时)。这些是**指挥官技能/特效**，不在 21 把武器里<br>· 两样都没有的：`ability_spawn_*`(3 个注册壳)、`ability_drill_pod`、`base_deploy`、`ability_titan_energy_shot`(116 行，泰坦技能，待查) | 全目录扫描 `gameplay/abilities/*.lua` 的 `:Timeline(` / `:OnUpdate(` | ✅ 已确认 |
| I100 | **`WeaponAttack` 的职责梳理与清理**（用户追问"有哪些职责"）。原五条职责：① 持有输入 ② 声明契约（`label`/`dps()`/`phases()`）③ 解析伤害来源 ④ 读参数表 ⑤ `muzzleFactor()`。清理：<br>· **删除 `muzzleFactor()`** —— 恒返回 1、无子类覆写、只在两处当 `× 1` 用，是"枪口数乘 DPS"那套错误理论的残留（`types.ts` 里 `muzzleCount` 的注释也顺手改正）<br>· **`WeaponTuning` 补 `modifier_sequence` / `modifier_spawn` 类型**（原压根没进类型定义）+ 新增 `SequenceTuning` / `SequenceStageTuning`，`tuning()` 从 `Record<string, unknown>` 变强类型，**14 处冗余 `as {...}` 转换清零**<br>· 头部注释同步（61→62 把常规武器、补分层说明与四条职责）<br>⚠️ **已知遗留**：`patternLength` 是**单位级**信息（来自 `unit.visual`）却挂在武器级类上，且只被 `JuggernautWeaponSequence` 用 —— 属职责混入，暂留（已在字段注释里写明） | `core/src/attack.ts`、`core/src/types.ts`；验证测试 15/15 | ✅ 已确认 |
