# 距离 / 速度类字段的量纲

> **一句话**：引擎里有**两套空间** —— **格（hex/tile）坐标空间** 与 **世界单位（world unit）空间**；
> **1 格 = 14 世界单位**（游戏内掐表标定后取整，见 §3）。字段名带 `InTiles` 的属于前者，
> **其余一切裸数字属于后者**。
>
> ⚠️ **本文档 2026-xx 修订过一次**：常数原为 **8**（按"奥卡轰炸半径约 2 格"目测反推），
> 现改为 **14**（按采集车走 1 格 ≈ 3.5s 标定：`3.958857 × 3.51 ≈ 13.9` → **取整 14**，
> 掐表点受移动动画影响，第 3 位有效数字是假精度）。**下表所有 `÷8` 的换算值都已重算**；
> 旧值、以及为什么旧证据链站不住，见 §3 与 `docs/findings.md` 的 I224/I225。
>
> ⚠️ **换算只在展示层做**（用户决定）：产物存原始世界单位，见 §2.2 的说明。
>
> 相关台账：`docs/findings.md` 的 **I205 ~ I211**（量纲分界与逐字段）与 **I224/I225**（常数修订与旧证据复查）。

---

## 1. 为什么会有两种量纲：源码里就是两套 API

| 空间 | Lua API | 传进去的典型值 |
| --- | --- | --- |
| **世界单位** | `nCombatantUtil.GetCombatantsInCircle(pos, radius, settings)`；`nSquadUtil.GetSquadsInCircle(pos, radius, …)`（内部 `Fixed16(radius)`） | 奥卡炸弹 `damageRadius = 18`、`fireRadius = 18`（`modifier_orcabomber_projectile.lua:25`、`modifier_orcabomber_bomb.lua:30`）、火炮 `radius = Fixed16(6)`、幽灵 `empRadius = 18`、圣灵自爆 `radius = 20`、所罗门离子炮 `radius = 18` |
| **格** | `nCombatantUtil.GetCombatantsInHexArea(pos, hexRadius, …)`；`nHexMap.GetTilesInArea(gWorld, pos, rings)` / `GetTilesInRing(…)` / `GetTileRelative(…)`；`nHexTile.GetDistance(tileA, tileB)`（返回整数格距）；`nSquadTuning.GetSquadVisionRangeInTiles(squad)` | 共振场 `detectionHexRadius` / `applicationHexRadius`、离子炮 `NUM_RINGS`、化学武器 `nHexTile.GetDistance(tile, myTile) <= 1` |

`GetCombatantsInCircle` 的 `pos` 是**世界坐标**（同一个值直接喂给 `PlayVFXAtWorldPos`），
所以传进去的 `18` 必然是世界单位长度。而**世界坐标本身是由格坐标换算来的**：

```
nHexMap.GetWorldPosFromHexGridPos(gWorld, hexPos)
  → worldPos.x = fix16_mul(col, hexMap.tileMetrics[0xfc]) (+ 奇数行偏移 [0x104])
    worldPos.y = fix16_mul(row, hexMap.tileMetrics[0x100])
```
（`tmp/ghidra/out/hextile.txt` 的 FUN_01a81384，即 `nHexMap.GetWorldPosFromHexGridPos` 的实现）

⇒ **"格"与"世界单位"之间是一个纯比例系数**，`InTiles` 字段用格、其余用世界单位 —— 这就是所有量纲混乱的来源。

---

## 2. 逐字段对照表

`产物字段` 指 `data/units.json` 的 `derived.stats` / `derived.weapons[]`。

### 2.1 以「格」为单位（字段名带 `InTiles`）

| 原始字段 | 含义 | 产物字段 | 证据（可复查） |
| --- | --- | --- | --- |
| `squadTuning.maxAttackRangeInTiles` | **攻击距离**（面板上的 Attack Range / wiki 的 range） | `stats.attack_range_tiles` | `UI_STAT_EXTENDEDATTACKRANGE = "Attack Range"`、tooltip "Can attack multiple tiles away"；**8 个单位**的描述写 "Can attack up to `<stat\|ExtendedAttackRange>` tiles away"；wiki UnitBox `range` 逐项等于本字段（火炮 3、神像 3、MLRS 2、MG 小队 2、蛇怪 2、万钧巨炮 2、破坏者 2、弹弓 2、黑曜石 2，其余 1） |
| `squadTuning.minAttackRangeInTiles` | **最小攻击距离**（死区：贴脸打不到） | `stats.min_attack_range_tiles` | 火炮 1 / 神像 2；只有 3 个单位有 |
| `squadTuning.visionRangeInTiles` | **视野**（面板无此列，写在描述里） | `stats.vision_tiles` | `UI_GDI_RIFLEMEN_ITEM_DESCRIPTION` "Provides vision up to `<stat\|VisionRange>` tiles away" ↔ 步枪兵 = 3；wiki `sight` 全部一致；`modifier_rockwyrm_intro.lua:37` 调 `nSquadTuning.GetSquadVisionRangeInTiles` |
| `squadTuning.stealthDetectionRangeInTiles` | 反隐范围 | `stats.stealth_detect_tiles` | 名字 + 与上面同族 |
| `combatantTuning.aggroRadiusInTiles` | **索敌半径**（自动索敌/主动开火半径） | `stats.aggro_radius_tiles` | 名字带 InTiles；引擎存在 `GetCombatantsInHexArea(pos, hexRadius)` 这条**按格**查询的 API；面板不显示（wiki 也没有这一列） |

### 2.2 以「世界单位」为单位（裸数字，÷14 = 格）

> ⚠️ **换算只在展示层做**（用户决定："换算应该前端进行"）。产物里这些字段**一律存原始世界单位**
> （奥卡的 `radius` 就是 18、幽灵的 `emp_radius` 就是 18），与 `tmp/` 的 Lua 逐字对应；
> 除成"格"由 `web/src/format.ts` 的 `toTiles()` / `fmtTiles()` 现算，常数 `WORLD_UNITS_PER_TILE`
> 只在 `core/src/types.ts` 定义一次。**所以下表"换算后"那一列是展示时才会出现的值。**
>
> ⚠️ 另注意**产物里带 `_tiles` 后缀的字段**（`attack_range_tiles` / `aggro_radius_tiles` /
> `vision_tiles` / `stealth_detect_tiles` / `min_attack_range_tiles`）**本来就是格，
> 不要再除** —— 这个后缀就是"我已是格"的标记。

| 原始字段 | 含义 | 产物字段 | 展示时换算（格） |
| --- | --- | --- | --- |
| `combatantTuning.speed` | **移动速度**（每**秒**走的**世界单位**） | `stats.speed`（原值） | ÷14 → 0.21 ~ 0.66 格/s（**= 1.52 ~ 4.67 s/格**，见 §4） |
| `combatantTuning.avoidanceRadius` | **避让半径**（单位间软排斥） | `stats.avoidance_radius`（原值） | 步兵 1.6~1.7 → **0.12**；坦克 2.7 → **0.19**；采集车 3 → **0.21**；建筑 6 → **0.43** |
| `squadTuning.hexReservationRadius` | **占位半径**（行进时为小队预留的范围） | 未入产物（I122 决定） | 2.5~5 → **0.18~0.36**（六边形外接半径 = 0.5 格 ⇒ 占位不到半格，合理） |
| `squadTuning.crusherRadius` | **碾压判定半径**（只有 3 个单位有） | 未入产物 | 猛犸 7 → **0.50**；采集车 5 → **0.36** |
| `squadTuning.accelerationDistance` / `decelerationDistance` | 加减速距离 | 未入产物 | 0~4 → **0~0.29** |
| `combatantTuning.flyingHeight` / `minFlyingHeight` / `flyingHeightDelta` | 飞行高度 | 未入产物 | 4.5~8 → **0.32~0.57** |
| `weaponTuning.projectile.modifier.tuning.damageRadius` | 爆炸半径 | `weapons[].area.radius`（**原值 18**） | **18 → 1.29 格**（旧 ÷8 = 2.25） |
| `…damageFalloff.distances[].distance` | 伤害衰减断点 | `weapons[].area.falloff[].distance`（**原值 0/6/12/18**） | **0 / 0.43 / 0.86 / 1.29 格** |
| `…tuning.empRadius`（幽灵，`modifier_spawn`） | EMP 半径 | `stats.emp_radius`（**原值 18**） | **18 → 1.29 格** ≈ 1 环 |
| `weaponTuning.projectile.initialSpeed` / `maxSpeed` / `acceleration` | 弹速/弹体加速度 | 未入产物 | 同族（世界单位、世界单位/s、世界单位/s²） |

### 2.3 角度 / 时间（与格无关）

| 原始字段 | 含义 | 单位 | 证据 |
| --- | --- | --- | --- |
| `combatantTuning.angularSpeed` | **车体转向速度**（面板/ wiki 的 Turn Speed） | **度/秒**（⚠️ 推断） | wiki `turnspeed` 逐项等于本字段（火炮 100、神像 100、猛犸 200、无人机群 1080…）；火炮部署 modifier `Stat.AngularSpeedPercentDecrease = 0.50` ↔ wiki "100 / 50 (when deployed)"；同族字段 `projectile.turnRateDegrees` 名字里就写了 Degrees 且不做 deg→rad 换算 |
| `weaponTuning.turret.yaw.speed` / `pitch.speed` | 炮塔转速 | 度/秒（⚠️ 推断） | 见上表；取值 75~800，与 `angularSpeed` 同族 |
| `combatantTuning.navAngularSpeed` | 导航转向速度 | 度/秒（推测） | **引擎里有这个字段**（`tmp/ghidra/out/unitscales.txt` FUN_01a2248c 的 `"navAngularSpeed"` 分支），但**全部 837 个游戏 Lua 脚本零命中** ⇒ 游戏数据未使用 |
| `minRangeTimeToHit` / `maxRangeTimeToHit` | 弹体命中时间（**时间**，不是距离） | 秒 | `SetupProjectileTuning` 归一化后直接进弹道；名字即语义 |
| `burstTiming.*` / `reloadTuning.*` / `*Ms` | 时间 | 秒 / 毫秒 | 见 `docs/attack-mechanics.md` |

> ⚠️ **`weaponTuning.maxRangeInTiles` / `minRangeInTiles` 单独讨论** —— 见 §4。

---

## 3. 「1 格 = 14 世界单位」—— 实测标定，以及旧的 8 为什么废了

### 3.1 标定过程（一次游戏内掐表）

**原始读数**（用户提供，视频 2 倍速）：

```
采集车 120° 掉头：播放 7.146s → 7.480s = 0.334s
采集车直行 2 格：播放 7.480s → 10.992s = 3.512s
```

**规则只有一条：视频是 2 倍速 ⇒ 真实时间 = 播放时间 × 2。两条读数都必须 ×2。**
（⚠️ 曾一度写成"一条 ×2、一条 ÷2"，那是错的 —— 倍速是整段视频共享的常量。）

| 读数 | 播放 | ×2（真实） | 推出的量 | 数据对照 |
| --- | --- | --- | --- | --- |
| 转向 120° | 0.334s | 0.668s | `120 ÷ 0.668 = 179.6 °/s` | `angularSpeed = 180` ⇒ **吻合 0.2%** ✔ |
| 位移 2 格 | 3.512s | **7.024s** | `7.024 ÷ 2 = 3.512 s/格` | — |

于是：

```
1 格 = speed(3.958857) × 3.512 ≈ 13.9 世界单位   →   **取整 14**
```

**★ 更干净的验算（直接比总时间，不经过"每格秒数"这个中间量）**：

```
2 格所需真实时间 = 2 × 14 ÷ 3.958857 = 7.07 s
实测（3.512s 播放 × 2）             = 7.02 s
误差 0.7% ✔
```

⚠️ **方法教训**：前几轮我一直在比"3.51 s/格"与"1.76 s/格"这类**中间量**，
两次把"2 格的总时间"当成"1 格"用，于是得出 14 → 7 → 3.5 三个互相矛盾的常数。
**定标定时应当直接比"距离 ÷ 速度 = 时间"的原始等式**，中间量越少越不容易错。

### 3.2 转向读数那个 2 倍差（旁支，不影响 k）

转向读数对"是否 2 倍速"这件事给出一个自相矛盾的结果：

```
若视频确实 2 倍速：真实 = 0.668s  ⇒  120 ÷ 0.668 = 179.6 °/s  ✔ 精确吻合 180
                  但那要求读取到的 0.334s 是被压缩过的 —— 与"×2 还原"互相抵消
```

**判定：转向读数是受污染的那一条**（掉头过程含起步、贴格、朝向吸附等非纯旋转时间，
掐表点很难切准）。依据是我上一轮把"是否 2 倍速"建立在它身上、结果推出 3.5 与 7 两个
都被别的证据否掉的常数。

它**不影响 k** —— 转向是纯角度量，只能定 `angularSpeed` 的单位（已定为度/秒，见 I207/I224），
定不了格长。**不再从这条读数推任何格长结论。**

### 3.3 旧常数的 8 条"证据"复查：没有一条能独立定出常数

旧文档列了 8 条一致性检验支撑 `8`。逐条重审后：

| # | 旧证据 | 现状 |
| --- | --- | --- |
| ① | 奥卡 `damageRadius = 18` 目测"约 2 格" ⇒ 18÷8=2.25 | **降级为目测估算**。14 下是 1.29 格，与"约两格"仍有 1.5 倍差；这条本身只有 ±1 格的精度 |
| ② | 幽灵 EMP 18 与文案 "affects **adjacent**" | ❌ **当时是循环论证**：2.25 格 = 2 环，与"相邻"直接冲突，却被当成印证。14 下 **1.29 格 ≈ 1 环**，才是真自洽 |
| ③ | 衰减断点 0/6/12/18 → 0/0.75/1.5/2.25 格"是合理曲线" | **降级为主观**。"合理"没有独立判据，14 下 0/0.43/0.86/1.29 同样合理 |
| ④ | 建筑 `avoidanceRadius = 6` ⇒ 0.75 格"正好是建筑宽度" | **降级**：0.43 格同样不荒谬。无独立证据分辨 |
| ⑤ | 猛犸 `crusherRadius = 7` ⇒ 0.875 格 | **降级**：14 下 0.50 格，同样支撑"同格才碾压" |
| ⑥ | `hexReservationRadius` 2.5~5 ⇒ 0.31~0.63 ≈ 六边形外接半径 0.577 | ❌ **数值重合是巧合**：14 下是 0.18~0.36，与 0.577 不再接近。**注意"外接半径"应取 0.5 格**（六边形边长 = 1 格时外接半径 = 1，本文档当时把 0.577 当成外接半径是错的） |
| ⑦ | 火炮/催化炮艇 `radius = 6` ⇒ 0.75 格 | **降级**：14 下 0.43 格 |
| ⑧ | `flyingHeight` 4.5~8 ⇒ 0.56~1.0 格 | **降级**：14 下 0.32~0.58 格，同样"不可能是 8 格高" |

**结论：8 条里没有一条能独立定出常数** —— 它们全都只是"在 8 之下不荒谬"，
而不是"只有 8 才成立"。**唯一有判别力的是 I224 的那次掐表。** 这条教训写进台账。

### 3.4 新常数下的行为印证（三条独立，这是 k=14 的主要依据）

| # | 事实 | 来源 | k=14 预测 | 判定 |
| --- | --- | --- | --- | --- |
| ① | **幽灵 EMP 打"相邻"格**（官方文案 "affects **adjacent** enemy Vehicles and Aircraft"） | 文案 + 游戏内行为 | `18 ÷ 14 = 1.29 格` ⇒ 相邻格被覆盖 = 1 环 ✔ | 8 下是 2.25 格 = 2 环，与"相邻"冲突 |
| ② | **奥卡轰炸看起来约 2 格**（用户："1.29 格刚好炸到旁边一格，所以看起来就是 2 格半径"） | 用户游戏内观察 + 机制解释 | `1.29 格` ⇒ 自己的格 + 周围一圈 = 视觉 2 格 ✔ | 8 下 2.25 格会**溢出到第 3 环** |
| ③ | **采集车直行 2 格的真实耗时** | 掐表（见 §3.1） | `2 × 14 ÷ 3.958857 = 7.07 s`；实测（3.512s × 2）= **7.02 s** ⇒ 误差 **0.7%** ✔ | 7 下预测 3.54 s，差一倍 |

**★ ①② 的机制（引擎源码已证）**：奥卡的爆炸走**世界坐标圆形查询**，不按格号 ——

```
modifier_orcabomber_projectile.lua:25   nCombatantUtil.GetCombatantsInCircle(impactPos, damageRadius=18, …)
modifier_orcabomber_bomb.lua:30         nCombatantUtil.GetCombatantsInCircle(targetPos,  fireRadius=18, …)
```

`impactPos` 是世界坐标 ⇒ **"18 世界单位"这个圆略超一格（1.29 格）时，会对相邻格形成重叠覆盖**，
于是"本格 + 邻接一环"都被判定进来 —— 这正是**视觉上的 2 格**。幽灵 EMP 的 18 同值同机制，
所以文案写 "adjacent"：**两者是同一个覆盖范围、两种说法**。

**★ 判定取"查询那一刻的占位"**（用户："奥卡抓不到正在离开这个格子的单位"）：
不追踪正在移动离开的单位，只看当前占位。

⚠️ **①② 是行为观察，③ 是唯一可直接比大小的定量读数**（0.7% 吻合）。三者互相独立、都指向 14。
⚠️ 仍有一环未取证：`GetCombatantsInCircle` 的"覆盖"是判**圆心**还是判**实体半径相交**
（I227）—— 不影响 k，但写模拟器前必须定。
⚠️ **本节的机制结论与 k 的取值无关** —— 改的只是"世界单位怎么映到格上"。

### 3.5 还需要什么才能再收紧

**走 3~4 格、在空地上、避开矿区与基地**，量总时长：

| 2 格真实时长 | 斜率 | 结论 |
| --- | --- | --- |
| ≈ 7.1 s | 3.54 s/格 | 格 = 14（当前，见 §3.4 ③ 已 0.7% 吻合） |
| ≈ 3.5 s | 1.77 s/格 | 格 = 7.0 |
| ≈ 4.0 s | 2.0 s/格 | 格 = 8 |

**关键在斜率不在单段**：起步/停下的加减速在数学上对总耗时是**中性**的
（对称坡道下 `t = d/v`，坡道长度整个约掉 —— 这也解释了"游戏里几乎看不见加减速"），
所以只要路程是纯位移，时间就严格线性，斜率直接给出 `格长 ÷ speed`。
再换一个速度档的单位（猛犸 `speed=3` 或幻影 `speed=9.24`）复测，两个斜率一比即可
同时锁死常数与 `speed` 的量纲。

---

## 4. 每格耗时表（只由 `speed` 决定，与格长无关的排序）

`秒/格 = WORLD_UNITS_PER_TILE ÷ speed`。**排序**只由 `speed` 决定，换常数不改排序。

| 单位 | `speed` | s/格（÷14） | 游戏档位（I208） |
| --- | --- | --- | --- |
| 猛犸 / 维修无人机 | 3 | **4.63** | Slowest |
| 采集车 | 3.958857 | **3.51** ← 标定锚点 | Slow |
| 多数单位 / 神像 / 火炮 / MLRS | 5.5424 | **2.51** | Average |
| 步枪兵 / 弹弓 / 游侠 | 6.928 | **2.01** | Fast |
| 奥卡系 | 8 | **1.74** | Fastest |
| 幻影 | 9.237333 | **1.50** | Fastest |

⚠️ 这张表**整体随常数缩放**（若最终定回 8，全部乘 8/14 = 0.571）。

---

## 5. 未解：`weaponTuning.maxRangeInTiles` 到底管什么

它**不是**面板上的 Range：

- 面板 / wiki / 单位描述里的 Range **一律等于** `squadTuning.maxAttackRangeInTiles`（§2.1 第 1 行）。
- 90% 的武器 `maxRangeInTiles` 都是 **2.5**（步枪兵、火箭兵、MLRS、弹弓…），而这些单位的面板 Range 是 **1**。
- 只有 4 个取值：**1.1**（奥卡/蝰蛇/锤头鲨）、**1.25**（掠食者/猛犸/沙蝎/圣灵/破坏者…）、**2.5**（大多数）、**3.5**（神像）。

⇒ 它是**武器自己的一个射程量**，与"单位攻击距离"是两个字段。两种读法都有反例：

- 若有效射程 = `min(weapon, squad)`：步枪兵 ✔（受 1 格限制），但**破坏者**会被压到 1.25（面板/文案说 2）。
- 若有效射程 = `max(weapon, squad)`：破坏者 ✔，但步枪兵会变成 2.5 格（与面板 1 矛盾）。

**结论：判据不足，不下结论**（台账 I211 记为 ❓ 待验证）。要定它，得反编译引擎里读该字段的比较点（`FUN_01a2248c` 已知它存在 WeaponTuning 结构里，但消费点在别处）。

---

## 6. 防坑：`mTileSize` **不是**物理格距

`libapp.so` 里确实有个 Lua 可见属性叫 `mTileSize`，但反编译显示它属于 **UI 组件 `HexMapAnchor`**
（`tmp/ghidra/out/at1.txt` 的 FUN_01aa0b2c：与 `mGameMode` / `mSizeX` / `mSizeY` /
`mBorderWidthX` / `mBorderWidthY` / `mLeftConYardUIOffset` / `mBaseLayouts` 一起解析，写到 this+0x54），
**是屏幕像素尺度**。物理格距来自地图自己的 tile metrics（`FUN_01a81384` 里 `hexMap+0x108 → +0xfc/0x100/0x104`），
且**没有任何 Lua/JSON 文件设置它**（全目录二进制扫描无命中）。

⇒ 想做 `世界单位 → 格` 的换算，用 §3 的 8，**不要去追 `mTileSize`**。

---

## 7. 面板侧交叉验证（外部数据）

- **wiki（cnc-central）UnitBox** 与原始字段逐项对上：
  `landspeed` = `speed`（火炮 5.5424、神像 5.5424、直升机 6.92332552、步枪兵 6.928）
  `turnspeed` = `angularSpeed`，括号里的 `(turret)` = `turret.yaw.speed`（圣灵 200、虫群车 800、破坏者 150、神像 75、猛犸 100、化学越野车 500 —— 6/6 全中）
  `range` = `maxAttackRangeInTiles`、`sight` = `visionRangeInTiles`
  提取脚本：`_wiki_stats.ts`（读 `tmp/cnc-central/page-wikitext.json`）
- **面板不显示速度数字，只显示档位**。档位表从 `files/game-config.pb` 解出（`_pb_speed.mjs`，路径 `$.19.6`）：

  | 档位 | 区间（原始 speed） | 例子 |
  | --- | --- | --- |
  | Slowest | 1.0 – 3.1 | 猛犸/维修无人机 3 |
  | Slow | 3.1 – 5.4 | 采集车 3.958857、侦察车 5.4 |
  | Average | 5.41 – 6.8 | 神像/火炮/步枪系 5.5424 |
  | Fast | 6.9 – 7.9 | 掠食者/步枪兵 6.928、掷弹兵 6.9 |
  | Fastest | 8.0 – 8.9 … | 奥卡 8.0、幻影 9.237333 |

  （band 边界故意留缝 6.8/6.9、7.9/8.0，避免浮点歧义；wiki 把掷弹兵的 `landspeed` 写成 "Fast"，与本表一致。）

---

## 8. 引擎侧：字段类型与顺序（反编译）

`tmp/ghidra/out/unitscales.txt` 的 `FUN_01a2248c` 就是 **CombatantTuning 的 Lua→C++ 反序列化器**，
逐字段 `FUN_02840e1c(lua, param, "字段名")` 读、`FUN_01904678` 转 Fixed16、写结构体偏移：

| 偏移 | 字段 | 类型 |
| --- | --- | --- |
| +0x00 | `health` | int |
| +0x04 | `aggroRadiusInTiles` | Fixed16 |
| +0x08 | `weaponTunings` | 数组 |
| +0x58 | `speed` | Fixed16 |
| +0x5C | `angularSpeed` | Fixed16 |
| +0x60 | `navAngularSpeed` | Fixed16 |
| +0x64 | `avoidanceRadius` | Fixed16 |
| +0x68 | `faceTargetBeforeMoving` | bool |
| +0x6C / +0x70 / +0x74 | `flyingHeight` / `minFlyingHeight` / `flyingHeightDelta` | Fixed16 |
| +0x78 / +0x7C | `healthBarWidthOverride` / `maxSimultaneousTargets` | int |
| +0x80 | `exclusiveFiringPermissions` | bool |

**关键**：`aggroRadiusInTiles`（格）与 `speed` / `avoidanceRadius`（世界单位）**读法完全相同、
都是 Fixed16 直存**，没有任何缩放 —— 量纲差异**不在解析层，而在使用层**（喂给哪个 API）。
