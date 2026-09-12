# 距离 / 速度类字段的量纲

> **一句话**：引擎里有**两套空间** —— **格（hex/tile）坐标空间** 与 **世界单位（world unit）空间**；
> **1 格 = 8 世界单位**。字段名带 `InTiles` 的属于前者，**其余一切裸数字属于后者**。
>
> 相关台账：`docs/findings.md` 的 **I205 ~ I211**（含本文件的所有结论与证据指针）。

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

### 2.2 以「世界单位」为单位（裸数字，÷8 = 格）

| 原始字段 | 含义 | 产物字段 | 换算后（格） |
| --- | --- | --- | --- |
| `combatantTuning.speed` | **移动速度**（每**秒**走的**世界单位**） | `stats.speed` | ÷8 → 0.375 ~ 1.155 格/s |
| `combatantTuning.avoidanceRadius` | **避让半径**（单位间软排斥） | `stats.avoidance_radius` | 步兵 1.6~1.7 → **0.20~0.21**；坦克 2.7 → **0.34**；采集车 3 → 0.375；建筑 6 → **0.75** |
| `squadTuning.hexReservationRadius` | **占位半径**（行进时为小队预留的范围） | 未入产物（I122 决定） | 2.5~5 → **0.31~0.63**（≈ 六边形外接半径 0.577，"正好占住自己这一格"） |
| `squadTuning.crusherRadius` | **碾压判定半径**（只有 3 个单位有） | 未入产物 | 猛犸 7 → **0.875**；采集车 5 → **0.625** |
| `squadTuning.accelerationDistance` / `decelerationDistance` | 加减速距离 | 未入产物 | 0~4 → **0~0.5** |
| `combatantTuning.flyingHeight` / `minFlyingHeight` / `flyingHeightDelta` | 飞行高度 | 未入产物 | 4.5~8 → **0.56~1.0** |
| `weaponTuning.projectile.modifier.tuning.damageRadius` / `fireRadius` / `empRadius` / `radius` | 爆炸/触发/EMP 半径 | `weapons[].area.radius_tiles` / `emp_radius_tiles` | 18 → **2.25**；6 → **0.75**；20 → **2.5** |
| `damageFalloff.distances[].distance` | 伤害衰减断点 | `weapons[].area.falloff` | 0/6/12/18 → **0 / 0.75 / 1.5 / 2.25** |
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

## 3. 「1 格 = 8 世界单位」的证据

| # | 证据 | 若按「1 单位 = 1 格」读会怎样 |
| --- | --- | --- |
| ① | 奥卡轰炸机 `damageRadius = 18`，**玩家游戏内实测爆炸约 2 格** | 18 格 = 整张地图 |
| ② | 幽灵 EMP `empRadius = 18`，而文案写 "affects **adjacent** enemy Vehicles and Aircraft" | 18 格与"相邻"直接矛盾；2.25 格 = 自身格 + 周围一圈 ✔ |
| ③ | 同一把武器的衰减断点 `0 / 6 / 12 / 18` | 0/6/12/18 格，超过地图宽度；÷8 = 0/0.75/1.5/2.25 是合理曲线 ✔ |
| ④ | **建筑** `avoidanceRadius = 6` | 6 格的避让半径会把整片基地推开（荒谬）；0.75 格合理 ✔ |
| ⑤ | 猛犸 `crusherRadius = 7`、采集车 5 | 7 格内全被碾压（不可能）；0.875 格 ="同格/邻格"✔ |
| ⑥ | `hexReservationRadius` 2.5~5（0/2.75/3/3.5/4/5） | ÷8 = 0.31~0.63 格 ≈ 六边形外接半径 0.577，语义精确对上"占位"✔ |
| ⑦ | 火炮弹体 `radius = Fixed16(6)`、催化炮艇 `radius = Fixed16(6)`、破坏者 `beamWidth = Fixed16(6)` | 0.75 格的炮弹爆炸/光束宽度合理 ✔ |
| ⑧ | `flyingHeight` 4.5~8 | 8 格高度不可能是直升机；0.56~1.0 格 ✔ |

**唯一"实测"锚点是①**（用户游戏内观察，I132 已记），其余 ②~⑧ 是独立的一致性检验。

---

## 4. 未解：`weaponTuning.maxRangeInTiles` 到底管什么

它**不是**面板上的 Range：

- 面板 / wiki / 单位描述里的 Range **一律等于** `squadTuning.maxAttackRangeInTiles`（§2.1 第 1 行）。
- 90% 的武器 `maxRangeInTiles` 都是 **2.5**（步枪兵、火箭兵、MLRS、弹弓…），而这些单位的面板 Range 是 **1**。
- 只有 4 个取值：**1.1**（奥卡/蝰蛇/锤头鲨）、**1.25**（掠食者/猛犸/沙蝎/圣灵/破坏者…）、**2.5**（大多数）、**3.5**（神像）。

⇒ 它是**武器自己的一个射程量**，与"单位攻击距离"是两个字段。两种读法都有反例：

- 若有效射程 = `min(weapon, squad)`：步枪兵 ✔（受 1 格限制），但**破坏者**会被压到 1.25（面板/文案说 2）。
- 若有效射程 = `max(weapon, squad)`：破坏者 ✔，但步枪兵会变成 2.5 格（与面板 1 矛盾）。

**结论：判据不足，不下结论**（台账 I211 记为 ❓ 待验证）。要定它，得反编译引擎里读该字段的比较点（`FUN_01a2248c` 已知它存在 WeaponTuning 结构里，但消费点在别处）。

---

## 5. 防坑：`mTileSize` **不是**物理格距

`libapp.so` 里确实有个 Lua 可见属性叫 `mTileSize`，但反编译显示它属于 **UI 组件 `HexMapAnchor`**
（`tmp/ghidra/out/at1.txt` 的 FUN_01aa0b2c：与 `mGameMode` / `mSizeX` / `mSizeY` /
`mBorderWidthX` / `mBorderWidthY` / `mLeftConYardUIOffset` / `mBaseLayouts` 一起解析，写到 this+0x54），
**是屏幕像素尺度**。物理格距来自地图自己的 tile metrics（`FUN_01a81384` 里 `hexMap+0x108 → +0xfc/0x100/0x104`），
且**没有任何 Lua/JSON 文件设置它**（全目录二进制扫描无命中）。

⇒ 想做 `世界单位 → 格` 的换算，用 §3 的 8，**不要去追 `mTileSize`**。

---

## 6. 面板侧交叉验证（外部数据）

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

## 7. 引擎侧：字段类型与顺序（反编译）

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
