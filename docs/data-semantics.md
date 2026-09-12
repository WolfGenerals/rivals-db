# 数据语义

本文记录对 `data/` 里游戏数据的**理解**：字段在游戏里实际意味着什么、
哪些能直接信、哪些是陷阱、以及为什么。

数据结构与文件布局见 [`output-format.md`](./output-format.md)；
等级换算公式见 [`level-scaling.md`](./level-scaling.md)。

---

## 1. 数据从哪来

原始数据是**游戏自己的 Lua 源码**（不是反编译产物，不是内存 dump）：

```
<设备>/Android/data/com.ea.gp.candcwarzones/published/nfd/scripts/gameplay/units/*.lua
```

共 84 个 `unit_*.lua`。这些文件**带注释、带制表符缩进**，是开发时的原始调参文件
（例如 `unit_gdi_droneswarm.lua` 里留着 `-- This is unsed` 这种拼写错误的注释）。

`data/` 是执行这些 Lua 得到的 JSON 快照。

### 求值环境是桩出来的

Lua 文件不是纯数据，会调用宿主 C++ 提供的函数。抽取器用 lupa 加载 Lua 5.5，
并提供一批桩函数（`Fixed32.fromValue`、`MakeOverride`、`RequiredHash`、
`nTuningUtil.GetWeaponTuning` 等）。这意味着：

- **数值**（`health`、`damage`、`cooldown`）是真实求值结果，可信。
- **枚举**（`CombatantDescriptor.*`）在 Lua 里只有名字，定义在 C++ 侧，
  桩函数用「访问即返回 2 的幂」保证位运算不报错 → 产出的是**假数字**。

---

## 2. 单位的类型标签 `tags`

82 个可玩单位的 `combatantTuning.tags` 恰好只有 5 种组合：

| tags | 数量 |
| --- | --- |
| `Vehicle` + `override_vehicle` | 34 |
| `Infantry` + `override_infantry` | 21 |
| `Aircraft` + `override_aircraft` | 19 |
| `Vehicle` + `override_harvester` + `override_vehicle` | 4 |
| `Structure` + `override_structure` | 4 |

读法：

- **第一个是基础类型**，决定被谁克制、能否被碾压等。
- **`override_*` 是「伤害覆写键」**，供武器的 `damageTuning.overrides` 匹配。
- **采集车是特例**：基础类型是 `Vehicle`，但额外带 `override_harvester`，
  所以武器可以专门给它配一套伤害（9 个武器这么做了）。
- 这 5 种组合覆盖了**被 `overrides` 引用的全部目标类型**
  （`Infantry` / `Vehicle` / `Aircraft` / `Structure` / `Harvester`）——
  即 `overrides` 的目标集合就是 `tags` 里 `override_*` 去掉前缀。

---

## 3. ⚠ 血量：`health` 是**每员**血量，不是小队总血

```
小队总血 = combatantTuning.health × squadTuning.waveSize
```

`waveSize` 是班组成员数（步兵 3~5，载具 1）。**这是最容易搞错的字段**：
`unit_gdi_riflemen` 的 `health = 130`，但游戏里显示 **650**。

来源：`CombatTuningInfo.lua:332` —

```lua
local squadBaseHealth = Fixed32(itemCombatTuning.combatantTuning.health
                                * itemCombatTuning.squadTuning.waveSize)
```

### 该乘法的取整语义

数值上等价于**先取整到每员、再乘人数**：`floor(health × waveSize × F)`
与 `waveSize × V` 一致（`V` 为每员整数值）。用后者反解 `health` 时，
`unit_gdi_robodogs` 的 5 个观测点与 `unit_gdi_riflemen` 的 2 个观测点
各自**独立收敛到 JSON 里的整数值**（300 与 130），区间上界余量分别只有
0.012% 与 0.085%。这反过来验证了 `health` 字段确实是每员值。

---

## 4. ⚠⚠ `goodAgainstTags` 不是克制表

**这是整个数据集里最大的坑。**

`combatantTuning.goodAgainstTags` 是**AI 的索敌偏好**，与 `targetSelector`
配对使用，**不产生任何伤害加成**。

真正决定伤害的是 `weaponTunings[].damageTuning.overrides`，
而它**大多数时候比 `default` 更低**——即「打这种目标伤害变低」。

比对全部 80 个武器：`goodAgainstTags` 与 `overrides` 的目标
**100% 不一致**（0 个吻合）。

### 实例

```
unit_nod_venom       goodAgainst=[Infantry]
                     default 60 → vs Vehicle 28 (-53%), vs Structure 28 (-53%)

unit_gdi_grenadier   goodAgainst=[Vehicle]
                     default 340 → vs Infantry 27 (-92%)

unit_nod_laserdrone  goodAgainst=[Vehicle]
                     default 92 → vs Infantry 10, Harvester 45, Structure 60
```

只有 **13/80** 个武器的 override **高于** default，这些才是真正的克制关系：

| 单位 | 目标 | default → override | 倍率 |
| --- | --- | --- | --- |
| Battering Ram | Structure | 600 → 3000 | 5.0× |
| MLRS | Structure | 666 → 1000 | 1.5× |
| Stealth Tank | Aircraft | 382 → 510 | 1.34× |
| Widowmaker | Structure | 80 → 133 | 1.66× |
| Shock Troopers | Structure | 150 → 200 | 1.33× |
| Turret CR | Vehicle | 20 → 40 | 2.0× |
| Wolverine | Aircraft | 45 → 50 | 1.11× |
| Banshee | Aircraft | 211 → 270 | 1.28× |
| Confessor | Aircraft | 40 → 45 | 1.13× |
| Flame Troopers | Structure | 75 → 100 | 1.33× |
| Scavenger | Aircraft | 230 → 240 | 1.04× |
| Viper | Structure | 378 → 450 | 1.19× |
| Rhino | Aircraft | 80 → 82 | 1.03× |

**推论：网页若只显示「克制：步兵」，会给出与游戏相反的结论。**
必须显示**真实伤害矩阵**（逐个目标类型代入 override）。

### `overrides` 的取值规则

对应 `nTuningUtil.GetDamageOverrideWS`（`core/src/index.ts` 的 `pickDamage`）：

- 无匹配 → 用 `default`
- **目标同时匹配多条 → 取最大值**（不是最先匹配的）

---

## 5. 武器

### 结构

一个单位有 `weaponTunings[]`（0~2 个；69 个单位 1 个，7 个 2 个，8 个 0 个）。
单个武器的主要字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 内部名（`cannon` / `rifle` / `rockets`），非显示文本 |
| `displayName` | **本地化 key**，不是显示文本（仅 8 个武器有） |
| `damageTuning.default` | 基础伤害（67/83 个武器有） |
| `damageTuning.overrides` | 对特定类型的伤害覆写（61/83） |
| `maxRangeInTiles` | 射程（格） |
| `burstTiming.numToBurst` | 每轮发数（83/83，全部有） |
| `burstTiming.cooldown` | 攻击冷却（秒，65/83） |
| `burstTiming.chargeUpDuration` | 前摇（65/83） |
| `reloadTuning.clipSize` / `reloadTimeMs` | 弹夹式武器的弹量与装填时间（仅 7/83） |
| `muzzleCount` | **见下方警告** |
| `muzzleStrategy` | 仅 15/83 存在，取值 `All` |
| `projectile` | 弹道参数（速度、追踪、命中时间） |
| `turret` | 炮塔转向（73/83） |
| `targetingTuning.targetMode` | `kCenter`(19) / `kRandom`(7) / `kDirect`(1) |
| `weaponType` | `projectile` 等 |

### ⚠ `muzzleCount` 大多无效

`muzzleCount > 1` 的武器有 22 个，但其中**只有 2 个**同时带
`muzzleStrategy == "All"`。代码里只有这个组合才会把 `muzzleCount` 计入 DPS：

```lua
-- CombatTuningInfo.lua:712-713
if weaponTuning.muzzleStrategy == MuzzleStrategy.All then
    damageToDpsMultiplier = damageToDpsMultiplier * Fixed32(weaponTuning.muzzleCount)
end
```

`unit_gdi_pitbull` 是典型受害者：`muzzleCount = 2` 但 `muzzleStrategy` 缺失，
所以基础 DPS 是 `250 × 1 / 1.8 = 138.89`，**不是** `277.78`。

### ⚠ `targetSelector` 不是有效判别字段

全部 83 个武器的 `targetSelector` **都是同一个值** `unit_antiInfantry`。
不要用它做筛选或分类维度。

---

## 6. DPS 的算法

```
baseDPS = damage × damageToDpsMultiplier

有 reloadTuning（弹夹式）:
    damageToDpsMultiplier = clipSize × waveSize / reloadTimeMs × 1000

否则（爆发式）:
    damageToDpsMultiplier = numToBurst × waveSize / cooldown
                            若 muzzleStrategy == "All" 再 × muzzleCount
```

来源：`CombatTuningInfo.lua:704-717`。

注意 **`waveSize` 在除法之前就并入分子**，所以不存在「单员 DPS 先取整」
的中间步骤。`(damage × F) × numToBurst × waveSize / cooldown`
与 `damage × (numToBurst × waveSize) / cooldown × F` 数学等价。

### ⚠ 21/82 个单位算不出 DPS

逐单位实测归类（合计 61+9+2+1+3+6 = 82）：

| 情况 | 数量 | 说明 |
| --- | --- | --- |
| 正常可算 | 61 | `damageTuning.default` 有非零值 |
| `modifier_sequence` | 9 | 指向 `ability_*_weapon_sequence`，伤害在 ability Lua 里经 `TranslateToken("damage")` 求值 |
| `projectile.modifier` | 2 | 弹体 modifier 的 tuning 里 |
| `modifier_shot` | 1 | Titan 的能量弹 |
| **`damageTuning.default == 0`** | 3 | **有武器但故意不造成伤害** |
| 无 `weaponTunings` | 6 | 采集车 3、钻地车 2、以及它们的变体 |

涉及 Avatar、Basilisk、Flame Tank、Rockwyrm、Scarab、Juggernaut、Disruptor、
Firebomber、Artillery 等。抽取器需要多解析一层。

**`default == 0` 是一个语义信号，不是缺失值**：

| 单位 | 武器名 | 实际功能 |
| --- | --- | --- |
| `unit_gdi_msv` | `rockets` | 维修平台 |
| `unit_gdi_repairdrone` | `guns` | 修理无人机 |
| `unit_gdi_repairdrone_CR` | `guns` | 同上（指挥官版） |

这些是**辅助单位**。做 DPS 排序时要显式排除，否则会被误判为「数据缺失」
或「DPS 为 0 的废物单位」。

---

## 7. 等级缩放

完整公式、验证过程与实测数据见 [`level-scaling.md`](./level-scaling.md)。要点：

```
F(major, minor) = 1.05 ** min(major-1, 3)
                * 1.10 ** max(0, major-4)
                * c(major) ** minor

c(major) = 1.008293 (major <= 4)    c(major) = 1.01 (major >= 5)

HP  = floor(baseHP  × F)
DPS = round(baseDPS × F, 1)
```

`data/` 里存的是 **1-0 级的基础值**，玩家界面显示的是其当前等级的值。

### 起始等级与等级上限：当前数据里没有

`ScorpionUiUtil.lua:1795-1804` 显示两者都挂在 `costGroupKey` 上：

```lua
maxRank    = GetMaxRank(costGroupKey)      -- 等级上限
majorLevel = GetMinRank(costGroupKey)      -- 起始等级（未解锁时）
minorLevel = 1
```

`costGroupKey` 来自 protobuf，**不在 Lua 源码里，因此不在 `data/` 里**。
目前只有经验规律：普通 1-0 / 稀有 3-0 / 史诗 5-0。

⚠ **待核对**：代码里写 `minorLevel = 1`，但公式在 `(major, 0)` 上精确命中
观测值。需要确认游戏内部是把第一个小级记为 0，还是 `GetMinRank`
的返回值需要减 1。

### 稀有度枚举

`game-config.pb` 里存在 `Common` / `Rare` / `Epic` / `Legendary` 字符串，
`ScorpionUiUtil.lua` 里也有 `RARITY_STATE_COMMON/RARE/EPIC`。

**已从 pb 解出每个单位的稀有度**。位置：`$.55`（条目容器）中每个单位条目的
`$.2.3.1`（字符串，形如 `unitCommon`）与 `$.2.3.2`（整数）：

| 稀有度 | `.2.3.2` | 单位数 |
| --- | --- | --- |
| Common | 1 | 21 |
| Rare | 2 | 19 |
| Epic | 3 | 28 |
| 无 | 缺失 | 6（`harvester`×2、`repairdrone`、`turret`、`drillpod`、`obelisk`） |

同条目里 `$.2.19` = Lua 全局名（`unit_gdi_riflemen`），可直接与 `data/`
的 unit_id 对应；`.2.3.4` 是组内编号。

**起始 major 等级 = `2 × 稀有度 − 1`**，与实测完全吻合：

| 稀有度 | r | `2r−1` | 实测实例 |
| --- | --- | --- | --- |
| Common | 1 | **1** | riflemen→1-0、grenadier→1-0 |
| Rare | 2 | **3** | robodogs→3-0、指挥官→3-0 |
| Epic | 3 | **5** | apc→5-0、mlrs→5-0 |

⚠ 该式是**从实测反推的经验式**，尚未在 pb 里找到 `GetMinRank` 表项直接印证。

### `$.47`：costGroup 表（仅部分解出）

3 条，`.1` 分别是 `unitCommon` / `unitRare` / `unitEpic`。
`unitRare` 的 `.2.1 = 3` —— 与 `2r−1`（Rare 时 = 3）**数值相同但语义待辨**，
无法区分是「= 2r−1」还是「= r+1」。嵌套形状：

```
$.47[i].2.1 = 3                    ← 疑为起始 major（待定）
$.47[i].2.4[].1 = 9 / 7 / 14       ← 疑为等级锚点
         .2.1[].1 = statID (1,2,3,4)
                 .2.1.2.1.2.1.2 = 数值 (90, 4000, 1000, 36000, 1200 …)
```

⚠ **字段语义未确证，不要据此刻画等级成长曲线。**

### 基地与矿车血量（已定位）

- 基地：`Faction_Info_GDI` / `Faction_Info_NOD` 的
  `factionInformationComponent`（`$.55.2.16`）内 `.7 = 30000`
- 矿车：`unit_gdi_harvester`，pb 中 `$.119.5` 处
  （`.5.4.2 = 3400`、`.5.7.2 = 30000`，分三个等级段）

⚠ **待核对**：代码里写 `minorLevel = 1`，但等级公式在 `minor = 0` 上
精确命中观测值。需确认游戏内部是把第一个小级记为 0，还是
`GetMinRank` 的返回值需要减 1。

---

## 8. ⚠ 不要使用的字段

| 字段 | 输出形态 | 原因 |
| --- | --- | --- |
| `combatantTuning.descriptors` | `[8.0, 16.0, 32.0, 64.0]` | `CombatantDescriptor` 枚举定义在 C++ 侧，Lua 里只有名字；桩函数用「访问即返回 2 的幂」保证 `\|` 位运算不报错，**数字是编造的** |
| `weaponTunings[].descriptors` | `[8.0, 4.0]` | 同上 |

每个 JSON 文件的 `_note` 字段与 `index.json` 都有对应提醒。

`tags` / `goodAgainstTags` **不受影响**——它们是名字字符串，语义正确。

---

## 9. 枚举参考

以下来自对 `libapp.so` 的反解（Ghidra 12.1.3 headless）。存放在
`tmp/ghidra/out/enums.json`（未入库）。

### `UnitTag`（`tags` 的取值）

| 名称 | 值 |
| --- | --- |
| `Structure` | 1 |
| `Vehicle` | 2 |
| `Aircraft` | 3 |
| `Infantry` | 4 |
| `Harvester` | 5 |
| `override_infantry` | 100 |
| `override_structure` | 101 |
| `override_vehicle` | 102 |
| `override_aircraft` | 103 |
| `override_harvester` | 104 |

注意 `Harvester` 是**基础类型 5**，但采集车的 `tags` 里是
`Vehicle` + `override_harvester`，即基础类型仍为载具。

### `DamageOverride`（`overrides` 的目标名）

与 `UnitTag` 的 `override_*` 对应，同样是 `Infantry`=100 …
`Harvester`=104。

### `CombatantDescriptor`（位掩码，仅用于理解）

`Ground`=1, `Air`=2, `Underground`=4, `GroundUnits`=8, `AirUnits`=16,
`Mountains`=32, `Lakes`=64, `NoCollision`=128, `Vehicle`=256, `Infantry`=512,
`Building`=1024, `Offensive`=4096, `ApplyAvoidance`=8192,
`SpawnNotSelected`=16384, `UnitTypeMask`=0x300, `AttackableTypeMask`=0x700,
`AllMask`=0xffffffff, `GroundVehicleDescriptors`=0x3169。

### 其他

| 枚举 | 取值 |
| --- | --- |
| `TargetMode` | `kDirect`=0, `kClosest`=1, `kRandom`=2, `kCenter`=3 |
| `MuzzleStrategy` | `RoundRobin`=0, `All`=1 |
| `QueryArmyFilter` | `None`=0, `Exact`=1, `Friendly`=2, `Enemy`=4 |

**注意**：这些枚举值不能用来把 `descriptors` 里的占位数字还原成有意义的值，
因为占位数字本身就是假的（见第 8 节）。它们只用于理解 Lua 源码里
枚举名的语义。

---

## 10. 字段覆盖速查

82 个真实可玩单位（不含 `data/misc/` 的两个开发占位文件）：

| 指标 | 覆盖 | 备注 |
| --- | --- | --- |
| `health` | 82/82 | 需 × `waveSize` |
| `waveSize` | 82/82 | |
| `visionRangeInTiles` | 82/82 | |
| `tags` | 82/82 | |
| `goodAgainstTags` | 82/82 | ⚠ 非克制表 |
| `speed` | 76/82 | |
| `tiberiumCost` | 76/82 | 缺的 6 个：采集车 3、修理无人机 2、炮塔/方尖碑等 |
| `maxRangeInTiles` | 76/82 | |
| `weaponTunings` | 76/82 | 8 个无武器 |
| `damageTuning.default` | 61/82 | 另有 3 个为 `0`（辅助单位） |
| `burstTiming.cooldown` | 61/82 | |
| 可算 baseDPS | 51/82 | 受 `modifier_sequence` 阻塞 |
| `goodAgainstTags` 含 `Aircraft` | 27/82 | 对空单位 |
| `canBeCrushed` | 21/82 | |
| `stealthDetectionRangeInTiles` | 20/82 | |
| `purchaseCooldownMS` | 16/82 | |
| `reloadTuning` | 7/82 | 弹夹式 |
| `maxSimultaneousTargets` | 3/82 | |
| `killAwardTiberium` | 4/82 | |

造价分布（1-0 级，单位：泰伯利亚矿）：
10(4) 20(5) 30(9) 40(7) 50(4) 60(10) 70(9) 80(3) 90(4) 100(6) 110(1) 120(7) 130(5) 230(2)

---


## 12. 游戏内看不到的数据（网页的增量价值所在）

游戏的面板**只显示 5 个数字 + 一句技能描述**。`CombatTuningInfo.lua` 里
`statPane` 字段一共只用到 6 个取值：

| 面板显示项 | 定义位置 |
| --- | --- |
| `UnitStatPane.Health` | `:339` |
| `UnitStatPane.DPS` | `:360` |
| `UnitStatPane.Speed` | `:374` |
| `UnitStatPane.Building` | `:390` |
| `UnitStatPane.Cost` | `:402` |
| `UnitStatPane.UniqueEffect` | 23 处（技能/机制的**文字**说明） |

其余全部不显示。下面按「玩家想知道但看不到」的强度排序。

### ① 小队成员血量（每员 HP）

玩家看到的 `Health` 是**小队总血**。想知道「一个兵有多少血」必须自己除。

```
每员 HP = floor(health × F)          # F 为该等级倍率
总血    = 每员 HP × waveSize
```

价值：判断「一发溅射能不能秒掉一个兵」「多少个兵能扛住某次齐射」都要这个数。
`robodogs` 总血 2237 但每员只有 559，差了 4 倍。

### ② 单发伤害（每次攻击的实际伤害）

玩家**完全看不到**。面板只给 DPS，而 DPS 是聚合值。

```
单发伤害(等级) = damage × F
```

更关键的是**对每个目标类型的单发伤害**（见第 4 节）：`overrides` 会让它
变成 default 的 7.9%~500%。这直接决定「几发打死一个目标」。

配合目标血量还能算出**击杀所需发数**：

```
发数 = ceil(目标每员HP / 单发伤害)
```

### ③ 攻击间隔 / 攻击节奏

面板只给 DPS，**不给攻速**。而同样的 DPS 下，攻击节奏决定了
「能否在敌人进身前打完一轮」「溅射/EMP 的触发频率」。

这里有**三种互不相同的"时间"**，很容易混为一谈：

| 语义 | 字段 | 覆盖 | 例子 |
| --- | --- | --- | --- |
| **每次攻击的前摇** | `burstTiming.chargeUpDuration`（秒） | 65/83（36 个非零） | 方尖碑 `3`、捕食者 `1`、土狼 `0.75` |
| **架设 / 收起** | `weapon.modifier_intro/outro.tuning.durationMs`（毫秒） | 9/83 | 巨无霸 `5000`/`2000`、MLRS `2000`/`500` |
| **开火动画** | `weapon.fireAnimTime`（秒） | 5/83 | 榴弹兵 `0.33` |
| **蓄力锁定** | `burstTiming.chargeUpLockOnTime`（秒） | 8/83 | |
| **受限射界引入** | `weapon.introDuration`（秒） | 4/83 | 炮塔/方尖碑 `1.33` |

- `chargeUpDuration` 是**每发都有**的蓄力时间，属于攻击节奏。
- `modifier_intro/outro` 是**一次性形态切换**（架起来才能开火），
  巨无霸的 5 秒是「展开」而不是「每发 5 秒」。两者不可相加。

### 从代码确证的部分

**① 面板 DPS 的官方定义就是 `damage / cooldown`，不含前摇**

`gameplay/tuning/TokenUtil.lua:5`：

```lua
return { "dps", mainWeapon.damageTuning.default / mainWeapon.burstTiming.cooldown }
```

这与 28 个实测点的验证一致（用该式算出的 DPS 全部命中）。

**② `cooldown` 不包含前摇**

若 `cooldown` 已含 `chargeUpDuration`，则必然 `cooldown >= chargeUpDuration`。
实测 36 个 `chargeUp > 0` 的武器里**有 1 个违反**：

```
unit_nod_wraith:  chargeUpDuration = 0.1  >  cooldown = 0.035
```

所以两者独立，**不能相加后当成一个数**，也不能假设包含关系。

**③ 只有 `modifier_sequence` 单位走 Lua 时序**

`gameplay/abilities/ability_simple_weapon_sequence.lua` 的 `Timeline` 是循环：

```lua
while true do
    weapon:OnBeginFireLuaWeapon()                                -- 开始蓄力
    nWeaponSequenceUtil.SetCooldown(self.tuning.burstCooldown, blackboard)
    thread:WaitForAge(waitForAge + self.tuning.chargeUpDuration) -- 等前摇
    weapon:PlayAttackAnim()
    weapon:FromMuzzle(...)                                       -- 开火
    weapon:OnFireLuaWeapon()
    waitForAge = waitForAge + self.tuning.burstCooldown          -- 再等冷却
    thread:WaitForAge(waitForAge)
end
```

但**它只服务 22 个有 `modifier_sequence` 的单位**（Avatar、Basilisk、巨无霸、
MLRS 之外的 sequence 单位等），且那些单位的前摇/冷却写在
`modifier_sequence.tuning` 里、单位是**毫秒**
（`burstCooldown` / `initialChargeUpMs` / `burstChargeUpDuration`）。

**捕食者、犀牛、甲虫、方尖碑、APC、MLRS 都没有 `modifier_sequence`**，
走引擎 C++ 时序 —— 那段逻辑不在 Lua 里。

**④ C++ 侧确认 `cooldown` 与 `chargeUpDuration` 是独立字段**

对 `libapp.so` 反解（Ghidra）找到读 `burstTiming` 的函数
`FUN_01a256d4`，它按名字取值后写进一个结构体的不同偏移：

```c
FUN_02840e1c(param_2, param_3, "cooldown");           // struct[0]
FUN_02840e1c(param_2, param_3, "chargeUpDuration");   // struct[1]
FUN_02840e1c(param_2, param_3, "chargeUpLockOnTime"); // struct[2]
FUN_02840e1c(param_2, param_3, "numToBurst");         // struct[3]
FUN_02840e1c(param_2, param_3, "fireRate");           // struct[4]
```

另一处 `FUN_01a31794` 只是把 `FireFromMuzzle` / `BeginReload` /
`PlayAttackAnim` 等方法注册给 Lua 的**绑定表**，不含时序计算。

**仍未解出**：C++ 里默认武器的开火循环（哪一段驱动下一次开火）。
字段读取已定位，但消费方在引擎更新循环里，需要更针对性的追踪。

### 待办：按视频逐帧统计动作时长

数据里**没有明确的每发"后摇"字段**。目前的理解是：**后摇很可能就包含在
`cooldown` 里**（即 `cooldown` 是从开火到下一次可开火的完整间隔），
但这没有从数据确证，也没有实测。

**因此变量名一律保持原样**（`cooldown` / `chargeUpDuration` /
`modifier_intro` / `modifier_outro`），不预设语义、不引入解释性命名。

计划中的验证方式：**录屏后逐帧统计每个动作**（前摇起止、开火瞬间、
后摇起止、可再次开火），据此确定：

1. `cooldown` 是否已含后摇
2. `chargeUpDuration` 与前摇动画的对应关系
3. 架设单位（巨无霸/MLRS/火炮）的完整开火周期

在此之前，类型层只提供**原样取值**与**原样求和**：

```ts
chargePlusCooldown(w)   // chargeUpDuration + cooldown，不做语义假设
modifierIntroMs(w)      // modifier_intro.tuning.durationMs
modifierOutroMs(w)      // modifier_outro.tuning.durationMs
```

#### 选参考单位：优先 `cooldown / chargeUp` 比值小的

比值越小，两种口径的差距越大、越好辨认。`cooldown / chargeUp` 常见的
是 3~50，但那几个接近 1 的样本才可分辩：

| 单位 | chargeUp | cooldown | 比值 | 若周期 = cooldown | 若周期 = cu+cd |
| --- | --- | --- | --- | --- | --- |
| **mlrs** | 0.25 | 0.25 | **1.00** | 2664 | 1332 |
| **obelisk** | 3 | 4 | 1.33 | 750 | 429 |
| orcabomber | 0.7 | 1 | 1.43 | — | — |
| widowmaker | 0.93 | 1.5 | 1.61 | 320 | 198 |
| **apc** | 0.5 | 0.85 | 1.70 | 106 | 67 |
| orca | 0.1 | 0.2 | 2.00 | 2550 | 1700 |
| buggy | 0.25 | 0.66 | 2.64 | 115 | 84 |
| rhino | 0.25 | 0.75 | 3.00 | 107 | 80 |
| predatortank | 1 | 3.44 | 3.44 | 241 | 187 |

⚠ MLRS/Orca 有 `reloadTuning`（弹夹式），测出来还要考虑装填周期，
所以**推荐用 `unit_nod_obelisk`（比值 1.33，前摇 3 秒好观察，
且无弹夹）或 `unit_gdi_rhino`/`unit_nod_buggy`**（周期刚好整数秒）。

`unit_gdi_predatortank`（前摇 1s，比值 3.44）可用但不是最优；
优点是没有架设、`canShootWhileMoving = true`（不用考虑停车动画）。

data 里可还原的节奏参数：

| 字段 | 含义 | 覆盖 |
| --- | --- | --- |
| `burstTiming.cooldown` | 攻击冷却（秒） | 65/83 |
| `burstTiming.numToBurst` | 每次攻击打几发（爆发式） | 83/83 |
| `burstTiming.chargeUpDuration` | 前摇（秒） | 65/83 |
| `burstTiming.chargeUpLockOnTime` | 锁定时间 | 8/83 |
| `reloadTuning.clipSize` | 弹夹容量 | 7/83 |
| `reloadTuning.reloadTimeMs` | 装填时间（毫秒） | 7/83 |
| `reloadTuning.idleTimeBeforeReloadMs` | 空闲多久才装填 | 4/83 |
| `modifier_intro` / `modifier_outro` | 架设 / 收起（毫秒） | 9/83 |

**弹夹式武器（7 个）的节奏面板完全不体现** —— MLRS、Orca、Firebomber 等
打 3 发然后装填 5 秒，暴发力集中在弹夹前段，这是纯看 DPS 完全看不出的差异。

```
弹夹式：一轮伤害 = 单发 × clipSize × waveSize，持续 reloadTimeMs
爆发式：一轮伤害 = 单发 × numToBurst × waveSize
```

### ④ 攻击方法（怎么打出去的）

`weaponType` 决定伤害是即时结算还是有弹道（可被躲开/拦截）：

| `weaponType` | 含义 |
| --- | --- |
| `projectile` | 有实体弹道，飞行中可被击落/闪避 |
| `instant` | 即时命中 |

弹道参数（`projectile` 子结构）：

| 字段 | 含义 | 覆盖 |
| --- | --- | --- |
| `homing` | 是否追踪（`false` = 可被走位躲开） | 76/83 |
| `initialSpeed` / `maxSpeed` | 弹速 | 72/83 |
| `acceleration` | 加速度 | 33/83 |
| `minRangeTimeToHit` / `maxRangeTimeToHit` | 命中时间窗 | 70/83 |
| `calculateSpeedFromTimeToHit` | 用命中时间反推速度 | 4/83 |

**`homing = false` 是关键信息**：Grenadier 的 `homing = false`，
意味着它的 EMP 弹可以被走位躲掉 —— 这是纯数值面板永远不会告诉你的。

### ⑤ 目标选择与齐射方式

| 字段 | 含义 | 覆盖 |
| --- | --- | --- |
| `targetingTuning.targetMode` | `kCenter`(19) / `kRandom`(7) / `kDirect`(1) | 27/83 |
| `targetingTuning.centerSpread` | 中心散布 | 19/83 |
| `targetingTuning.randomBurstMin/Max` | 随机目标数区间 | 7/83 |
| `muzzleCount` | 枪口数 | 82/83 |
| `muzzleStrategy` | 见第 5 节 | 15/83 |
| `maxSimultaneousTargets` | 同时打击目标数 | 3/82 |

### ⑥ 完整伤害矩阵

面板只显示一个 DPS 数字，**不显示它对谁强对谁弱**。
而 `overrides` 让同一武器对不同目标的伤害差 12 倍（见第 4 节）。

网页应给出「该单位 × 5 种目标类型」的完整表格：

```
                 default  Infantry  Vehicle  Aircraft  Structure  Harvester
单发伤害            340        27       340       340        340        340
DPS(该等级)        386.4      30.7     386.4     386.4      386.4      386.4
```

### ⑦ 生存相关的隐藏参数

| 字段 | 含义 | 覆盖 |
| --- | --- | --- |
| `canBeCrushed` | 能否被碾压 | 21/82 |
| `stealthDetectionRangeInTiles` | 反隐范围 | 20/82 |
| `stealthTuning` | 自身隐蔽 | 2/82 |
| `crusherRadius` | 碾压判定半径 | 3/82 |
| `deathTimer` / `deathCooldownMs` | 死亡后留存/复活 | 6/82 · 4/82 |
| `killAwardTiberium` | 被击杀时对方获得的矿 | 4/82 |
| `repurchaseDiscountFlat` | 重购折扣 | 4/82 |

### ⑧ 战场感知范围

> **量纲**：带 `InTiles` 的字段单位是**格**；其余裸数字字段单位是**世界单位**（**1 格 = 8 世界单位**）。
> 完整推导、逐字段换算表、外部交叉验证见 **`docs/unit-dimensions.md`**（台账 I205~I211）。

| 字段 | 含义 | 单位 | 覆盖 |
| --- | --- | --- | --- |
| `visionRangeInTiles` | 视野 | 格 | 82/82 |
| `aggroRadiusInTiles` | 主动开火/索敌半径 | 格 | 78/82 |
| `avoidanceRadius` | 单位间避让半径（步兵 1.7 → 0.21 格、建筑 6 → 0.75 格） | 世界单位 | 82/82 |
| `hexReservationRadius` | 行进占位半径（3~5 → 0.375~0.625 格，≈ 一个六边形） | 世界单位 | 60/82 |
| `attackSeparationDurationMS` | 攻击间隔保护 | 毫秒 | 25/82 |
| `minAttackRangeInTiles` | 最小射程（打不到贴脸目标） | 格 | 3/82 |

`minAttackRangeInTiles` 只有 3 个单位有，但它是「贴脸就废」的关键机制
（Artillery 类）。

⚠️ **面板上的 "Range / Attack Range" 与武器的 `maxRangeInTiles` 不是同一个东西**：
面板 / wiki / 单位描述里的 Range 一律等于 `squadTuning.maxAttackRangeInTiles`；
武器的 `maxRangeInTiles`（90% 是 2.5）作用未定（I206 / I211）。

---

### 汇总：网页相对游戏面板的增量

| 游戏面板给 | 网页可以补 |
| --- | --- |
| Health（总血） | **每员血量**、每级成长曲线、升级增量 |
| DPS（单一数字） | **单发伤害**、**对 5 类目标的伤害矩阵**、**攻击节奏**（弹夹/爆发） |
| Speed | 移速与视野/开火半径的对比 |
| Range | **最小射程**、弹道速度与命中时间 |
| Cost | 性价比（HP/矿、DPS/矿） |
| UniqueEffect（文字） | 该机制涉及的**具体数值**（如 EMP 时长、减益百分比） |




---

## 11. 变体

同一单位的不同版本是**独立文件**，靠后缀区分：

| 后缀 | 含义 |
| --- | --- |
| `_ST` | 特殊版本 |
| `_CR` | 指挥官相关版本 |
| `_mayhem` | Mayhem 模式版本 |

每个文件里的 `variant` 字段给出**去掉后缀的基础名**（便于归组），
`suffixes` 给出后缀列表（`["ST"]`），无后缀时该键不存在。共 12 个文件带后缀。

⚠ `_mayhem` 版本的数值可能与本体差异很大，例如
`unit_gdi_rockettroopers_mayhem` 的 `damage` 是 `750`（本体 `250`）、
`cooldown` 是 `3.2`（本体 `5`）。做数值对比时要区分对待。

