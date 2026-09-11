# 攻击机制详解

本文记录《命令与征服：宿敌》武器开火机制的**全部已知细节**，包括字段位置、公式、验证点与展示建议。

> **数据来源**：`data/{unit,commander}/*.lua.json`（由 `tmp/.../scripts/gameplay/units/*.lua` 真跑 Lua 提取）。
> **验证方式**：用户提供游戏内面板 DPS 观测点，用 `F(major,minor)` 反推基准值比对。
> **相关台账**：`docs/findings.md` 的 I56 ~ I76。

---

## 1. 总览：不是「N 种可复用方法」

全量扫描 `weaponTunings[].modifier_sequence.behaviour.name` 的结论：

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| **常规武器** | **61** | 靠 `burstTiming` 驱动，4 种子形状 |
| **能力序列武器** | **22** | 各自一个 `ability_<单位>_weapon_sequence`，**名字全是单位专属、无通用名** |

**所以没有捷径** —— 那 22 把是逐个手写的能力，参数结构各不相同。好在数量有限且可穷举。

### 1.1 常规武器的 `burstTiming` 子形状

| 字段组合 | 数量 |
| --- | --- |
| `chargeUpDuration, cooldown, numToBurst` | 56 |
| `+ chargeUpLockOnTime` | 7 |
| `+ fireRate` | 1 |
| `+ chargeUpLockOnTime + fireRate` | 1 |
| **只有 `numToBurst`（无 cooldown）** | **18** |

另有 **7 把带 `reloadTuning`**（弹夹）。

> **关键等价关系**：「只有 `numToBurst`、没有 `cooldown`」的正好 18 把，
> 与"走能力序列"的武器集合吻合 —— **缺 `cooldown` ⇔ 周期在 `modifier_sequence` 里**。

---

## 2. 伤害从哪取（两处）

这是最容易踩的坑：**爆炸类武器的伤害不在 `damageTuning`**。

```ts
// 普通武器
weapon.damageTuning.default

// 爆炸类武器（damageTuning 是空的）
weapon.projectile.modifier.tuning.damage.default
```

| 单位 | 武器 | `damageTuning` | `projectile.modifier.damage` | 备注 |
| --- | --- | --- | --- | --- |
| 神像机甲 | `rockets` | 空 | **400** | |
| 虎鲸轰炸机 | `bomb` | 空 | **800** | 另有 `damageFalloff` / `damageRadius: 18` |
| 圣甲虫 | `rifle` | 空 | **2000** | `MODIFIER_FIRE`、`durationMs: -1` |
| 催化剂直升机 | `catalystWeapon` | 270 | 50 | 爆炸需毒雾触发 |

---

## 3. 五个公式族

以下公式全部经**游戏内面板 DPS** 反推验证（误差 < 0.3%）。
等级换算：`基准 DPS = 面板值 ÷ F(major, minor)`。

### A 族 · 持续射击（`burstCooldown`）

```
DPS = damage × waveSize ÷ burstCooldown_s        （muzzleStrategy = All 时再 × muzzleCount）
```

| 单位 | 观测等级 | 面板 | 反推基准 | 公式代入 | |
| --- | --- | --- | --- | --- | --- |
| 弹弓 | 8-0 | 508.5 | 300.0 | 54 × 1 / 0.18 = 300 | ✅ |
| 狼獾机甲 | 4-0 | 274.2 | 236.86 | 45 × 1 / 0.19 = 236.84 | ✅ |
| 忏悔者 | 3-0 | 330.8 | 300.05 | 40 × **3** / 0.4 = 300 | ✅ |
| 生化战士 | 5-0 | 152.8 | 120.0 | 20 × **3** / 0.5 = 120 | ✅ |
| 火焰坦克 | 5-0 | 967.8 | 760.0 | `damageMain` 380 / 0.5 = 760 | ✅ |
| 圣甲虫（爆炸） | 5-0 | 1018.7 | 800.0 | 爆炸 2000 × **2** / 5.0 = 800 | ✅ |

**成员单位**：弹弓/狼獾/火焰坦克/圣甲虫。忏悔者、生化战士是 **3 人小队**（`waveSize` 参与计算）。

**成员明细**：

| 单位 | `burstCooldown` | 枪口 | 前摇 | 特殊 |
| --- | --- | --- | --- | --- |
| 弹弓 | 180 | 4 · `RoundRobin` | 0 | |
| 狼獾机甲 | 190 | · `RoundRobin` | 0 | |
| 忏悔者 | 400 | 1 | 0 | |
| 生化战士 | 500 | 1 · `All` | 0 | `spawnGasTimeMs: 750`（毒雾，**不计入 DPS**） |
| 生化越野车 | 500 | · `All` | 0 | `spawnGasTimeMs: 2100` |
| 火焰坦克 | 500 | | 0 | `damageMain` 380 + `damageSide` 380（**只用 main**） |
| 烈焰之手 | 2000 | · `All` | 500 | |
| 深岩巨虫 | 3750 | · `All` | 233 | 单发 2000 |

### B 族 · 分段光束（`stage` + `tickPeriodMs`）

```
DPS = 末段 damageMain ÷ tickPeriodMs_s
```

| 单位 | 观测等级 | 面板 | 反推基准 | 公式代入 | |
| --- | --- | --- | --- | --- | --- |
| 万钧巨炮 | 9-0 | 1118.6 | 600.0 | stage3 150 / 0.25 = 600 | ✅ |
| 蛇怪 | 3-0 | 771.8 | 700.0 | stage2 **175** / 0.25 = 700 | ✅ |
| 寡妇制造者 | 1-0 | 280 | 280 | 140 / 0.5 = 280 | ✅ |

**万钧巨炮的分段结构**（细节最丰富）：

```lua
initialChargeUpMs = 500, storeChargeTimeMs = 700
stage1 = { attackCount = 12, damageMain = 45,  tickPeriodMs = 250 }
stage2 = { attackCount = 24, damageMain = 90,  damageSide = 40, sideTargetCount = 2, tickPeriodMs = 250 }
stage3 = {                   damageMain = 150, damageSide = 50, sideTargetCount = 3, tickPeriodMs = 250 }
```

**蛇怪**（"会飞的光束炮"）：`initialChargeUpMs = 300`，
`stage1 = { attackCount = 8, damageMain = 50 }` → `stage2 = { damageMain = 175 }`，`tickPeriodMs = 250`。

> **观察**：前摇 `initialChargeUpMs` **不计入** DPS。

### C 族 · 倾泻 + 停顿（`perTargetCount`）

```
DPS = missileCount × damage ÷ burstCooldown_s
```

| 单位 | 观测等级 | 面板 | 反推基准 | 公式代入 | |
| --- | --- | --- | --- | --- | --- |
| 沙暴导弹车 | 5-0 | 573 | 450.0 | 12 × 150 / 4.0 = 450 | ✅ |

**沙暴的按目标数分档**（核心特性）：

```lua
burstCooldown = 4000          -- 整轮周期（倾泻 + 停顿都含在内）
maxTargetSquadsCount = 3
perTargetCount = {
  [1] = { timePerMissile = 200, missileCount = 12 },
  [2] = { timePerMissile = 100, missileCount = 24 },
  [3] = { timePerMissile = 66,  missileCount = 36 },
}
```

**目标越多打得越猛** —— 这是它最该被展示的特性。

### D 族 · 铺场 + 引爆（催化炮艇）

**两把武器不是轮流开火，而是「瓦斯铺场 + 火箭引爆」**：

| 武器 | 伤害 | 节奏 | 作用 |
| --- | --- | --- | --- |
| `gasWeapon` | 25 | `gasBurst.cooldown = 6000`（前摇 4500） | 命中留下瓦斯云（`modifier_chem_warrior_gas_cloud`） |
| `catalystWeapon` | 270 | `burstTiming.cooldown = 3`（前摇 0.08） | 弹体带爆炸（+50 / 半径 6），**须由瓦斯云触发** |

```
DPS = 主动武器伤害 ÷ catalystBurst.cooldown_s
```

| 观测等级 | 面板 | 反推基准 | 公式代入 | |
| --- | --- | --- | --- | --- |
| 3-0 | 186 | 168.75 | 270 / 1.6 = 168.75 | ✅ |

> ⚠️ **只是数值吻合，机制未定**：为何分母是 `catalystBurst.cooldown = 1600` 而不是
> `catalystWeapon.burstTiming.cooldown = 3`？推测 `modifier_sequence` 会**覆盖** `burstTiming`，
> 但缺第二个观测点交叉验证。

### E 族 · 齐射（`durationBetweenVolley`）

```
DPS = 每轮总伤害 ÷ durationBetweenVolley_s
```

| 单位 | 观测等级 | 面板 | 反推基准 | 公式代入 | |
| --- | --- | --- | --- | --- | --- |
| 科迪亚克 | 3-0 | 551.3 | 500.05 | 1500 / 3.0 = 500 | ✅ |
| 神像机甲 | 5-0 | 611.2 | 480.0 | 爆炸 400 × **3** / 2.5 = 480 | ✅ |
| 虎鲸轰炸机 | 5-0 | 2037.4 | 1600.0 | 爆炸 800 / 0.5 = 1600 | ✅ |

**科迪亚克**：`delayAfterShot = 1000`（主炮→侧炮间隔）、`durationBetweenVolley = 3000`、
`initialChargeUpMs = 500`。用户描述："**动画上有主炮和侧炮先后开火**"。

**神像机甲**：`delayAfterShot = 250`、`durationBetweenVolley = 2500`、`initialChargeUpMs = 500`。
一轮 3 发，用户描述："**攻击一格和周围 6 格**"（溅射）。

**虎鲸轰炸机**：投弹节奏在 `modifier_spawn.burstTuning`：

```lua
initialChargeUpMs = 1750, shotCooldownMs = 500
```

用户描述："**向下扔一串炸弹然后装填**"。另有 **`damageFalloff`**：

```
0 格 100%  →  6 格 65%  →  12 格 45%  →  18 格 25%      半径 18
```

---

## 4. 三条合成规则

| 规则 | 结论 | 验证 |
| --- | --- | --- |
| **双武器怎么合** | **取最大，不求和** | 圣灵 laser 160/0.25=640、fire 140/0.5=280；5-0 面板 815.0 → 基准 **640.0** ✅ |
| **毒雾算 DPS 吗** | **不算** | 生化战士 120 = 纯枪伤 20×3/0.5，`spawnGasTimeMs` 不影响 ✅ |
| **`damageMain` + `damageSide`** | **不相加，用 `damageMain`** | 火焰坦克 760 = 380/0.5，副炮不计 ✅ |

---

## 5. 可攻击目标（`descriptors` 位掩码）

| `descriptors` | 含义 | 数量 |
| --- | --- | --- |
| 含 `Ground`(8) | 打地面单位 + 建筑，**打不到空中** | 49 |
| 含 `NotHiddenTypeMask`(128) 或 `AllMask`(1024) | **地空通吃** ← 防空单位都靠这个 | 22 |
| 含 `TransportTypeMask_Flying`(4096) | 只打空中 + 建筑 | 5 |
| **空表 `{}`** | **索敌方式未知**（不猜） | 6 |
| 建筑 `Structure` | **一律可打**（独立轴） | — |

> ⚠️ **`TransportTypeMask_Flying` 不是"能打空中"的判据** —— 只有 5 把有它，
> 但 22 个单位能防空。防空单位用的是 `NotHiddenTypeMask`。见台账 I67。

> ⚠️ **空表那 6 把是杂项、无统一含义**：`orcabomber.bomb`（爆炸）、
> `catalystgunship.catalystWeapon`（爆炸）、`msv.rockets` / `ticktank.hidden`（部署形态）、
> `repairdrone.guns`（不是武器）。代码里用 `targetingUnknown()` 如实标"未知"。

**伤害查找的回退链**（`override` 是**优先匹配**，不是排他过滤器）：

```
步兵 → Infantry        载具 → Vehicle       建筑 → Structure
空中 → Aircraft        运矿车 → Harvester → Vehicle → default
```

---

## 6. 小队开火错开

`waveSize` 是成员数，`attackSeparationDurationMS` 是成员间错开。每个成员各自按
`t = i × 错开 + k × 周期` 开火，**数据里没有任何分组逻辑** —— "齐射"是相位漂移自然撞出来的。

⚠️ **`错开 × 人数` 不一定等于周期**：19 个多成员单位里 13 个正好，6 个不等：

| 单位 | 错开×人数 | 周期 | 效果 |
| --- | --- | --- | --- |
| 步枪兵 | 1.72s | 1.72s | 均匀铺满 |
| 攻击摩托 | 0.75s | 4.25s | **爆发**（有意为之） |
| 狂信徒 | 2.25s | 0.85s | **跨轮重叠**（相位漂移出"齐射"感） |
| 游侠 | 0.3s | 2.7s | 齐射 |

---

## 7. 展示建议（按族）

| 族 | 该展示的细节 |
| --- | --- |
| **A 持续** | 射击间隔 · 枪口数（轮转/齐射）· 每名队员一条轴 · 毒雾/副炮标注为"不计入" |
| **B 分段** | **前摇 → 阶段1 → 阶段2 → 阶段3**，每段标伤害、发数、**溅射目标数** |
| **C 倾泻** | **按目标数分三档**的倾泻条 + 停顿 |
| **D 引爆** | 两条交错轴（瓦斯铺场 / 火箭引爆）+ 触发关系 |
| **E 齐射** | 一轮内的多发刻度（主炮/侧炮分开）+ 轮次间隔 |

**虎鲸轰炸机**额外展示 `damageFalloff` 曲线（命中点 100% → 边缘 25%）。

---

## 8. 未解 / 待办

| 项 | 状态 |
| --- | --- |
| D 族（催化）分母为何是 `catalystBurst.cooldown` | ⚠️ 数值吻合，机制待第二观测点 |
| `nod_viper` / 寡妇制造者(黑寡妇) 能否防空 | ❓ 用户无印象，待确认 |
| 用户提到的「NO TYPE 全能打」指哪个字段 | ❓ 未定位 |
| `descriptors` 位值 `Vehicle`(32)/`Air`(64)/`Infantry`(256)/`Building`(512) 的语义 | ❓ 出现在 8 把武器上，语义不明 |
| `docs/data-semantics.md` 仍称 `descriptors` 位值"不可用" | ⚠️ 与现状矛盾，需更新（台账 I52） |

---

## 9. 15 个开火行为实现（`gameplay/abilities/`）

> **重大发现（台账 I90）**：22 把特殊武器的**真正实现不在单位文件里**，而在
> `gameplay/abilities/ability_*_weapon_sequence.lua` 的 `Timeline()` 函数中。
> `modifier_sequence.behaviour` 在 JSON 里是 `{}`，因为它是个 **Lua 函数**，提取器序列化不了；
> `tuning` 只是参数，**发数、顺序、发射位写死在函数体里**。

`name`（参数键）是单位专属的，`behaviour`（实现）**是共享的** —— 所以 22 把武器只有 15 份实现：

| # | 实现（`behaviour`） | 行数 | 使用单位 | 做什么 |
| --- | --- | --- | --- | --- |
| 1 | `ability_simple_weapon_sequence` | 105 | **弹弓 / 狼獾 / 忏悔者 / 烈焰之手**（4） | `while true` 循环，`SetCooldown(burstCooldown)`，**前摇在周期开头**；按 `muzzleStrategy` 分支：`All` → `for` 遍历枪口**各打一发**，否则 `currentMuzzle = (currentMuzzle+1) % muzzleCount` **轮转**。目标消失即退出 |
| 2 | `ability_juggernaut_weapon_sequence_behaviour` | 121 | 神像机甲 ×2 | 一轮固定 **3 发**，硬编码 `Fire(0,1)` / `Fire(2,2)` / `Fire(4,3)`（角落 0/2/4），每发间隔 `delayAfterShot`，周期 `SetCooldown(durationBetweenVolley)`。`Fire()` 内用 `MUZZLE_INFO[muzzleIndex].muzzleIndex` 查物理枪口 |
| 3 | `ability_sandstorm_weapon_sequence_behaviour` | 328 | 沙暴 ×2 | 按目标小队数分档（`perTargetCount`）倾泻 `missileCount` 发，**枪口轮转** `MUZZLE_INFO[totalMuzzlesFired % #MUZZLE_INFO + 1]`，每发 `timePerMissile`，一轮后 `burstCooldown` |
| 4 | `ability_kodiak_weapon_sequence_behaviour` | 211 | 科迪亚克 | 一轮按 `MUZZLE_INFO` **每个条目开一枪**（`TryFireMuzzle`），主炮/侧炮按 `delayAfterShot` 错开 |
| 5 | `ability_beamcannon_weapon_sequence_behaviour` | 423 | 万钧巨炮 | **三段递增**：`for i=attackInfo.count, stage1.attackCount` → `stage1+stage2.attackCount` → 之后无限。每段 `SetCooldown(stageN.tickPeriodMs)`，伤害/副伤/溅射目标数逐段升 |
| 6 | `ability_basilisk_weapon_sequence_behaviour` | 287 | 蛇怪 | 同上的两段版（`stage1` → `stage2` 无限） |
| 7 | `ability_avatar_laser_weapon_sequence_behaviour` | 82 | 圣灵（laser） | `while true` + `SetCooldown(tickPeriodMs)`，持续激光 |
| 8 | `ability_avatar_fire_weapon_sequence_behaviour` | 101 | 圣灵（fire） | 同上，`tickPeriodMs` 不同 |
| 9 | `ability_catalyst_chemical_weapon_sequence` | 152 | 催化炮艇 | **双武器交替**：比较 `gasFireTime` 与 `catalystFireTime`，先到者先开；瓦斯按 `gasBurst.cooldown`、催化剂按 `catalystBurst.cooldown` |
| 10 | `ability_chemical_weapon_sequence` | 103 | 生化战士 / 生化越野车 | `while true` + `SetCooldown(burstCooldown)`；额外生成毒雾（`spawnGasTimeMs`） |
| 11 | `ability_flametank_weapon_sequence_behaviour` | 169 | 火焰坦克 | `while true`；`DamageSquadListOverride` 对**主目标格**施加 `damageMain`、对**相邻格**施加 `damageSide` —— **副伤只打邻格，所以 DPS 只用 main** |
| 12 | `ability_rockwyrm_weapon_sequence_behaviour` | 125 | 深岩巨虫 | `while true` + `burstCooldown`；`chargeUpDuration` 前摇；`AoeDamageSquadListOverride` 范围伤害 |
| 13 | `ability_widowmaker_fire_weapon_sequence_behaviour` | 93 | 黑寡妇 | `while true` + `SetCooldown(tickPeriodMs)`；`DamageSquadOverride` 单体伤害 |
| 14 | `ability_disruptor_weapon_sequence_behaviour` | 138 | 破坏者 | 两种模式：`FireEndlessBeam`（无限光束）/ `FireLimitedBeam`（有限光束） |
| 15 | `ability_scarab_weapon_sequence_behaviour` | 52 | 圣甲虫 | 前摇后**只开一枪**，然后 `TakeHiddenDestroyDamage()` **自爆** |
| — | `ability_empty_weapon_sequence` | 16 | （无） | 空壳，只被 orcabomber 的 `targetSelector` 占位桩引用 |

### 9.1 `MUZZLE_INFO` 的语义（游戏自己的断言确认）

`ability_kodiak_weapon_sequence.lua:19`：

```lua
IM_ASSERT(self.tuning.durationBetweenVolley >=
          self.tuning.volleyChargeUpTime + self.tuning.delayAfterShot * #self.visual.MUZZLE_INFO,
  "Kodiak assumes that it can charge up, fire the shots in the volley time" .. self.id)
```

**`#MUZZLE_INFO` = 一轮的发数** —— 这是引擎代码自己算的，不是推测。

| 单位 | `MUZZLE_INFO` | `muzzleIndex` | 含义 |
| --- | --- | --- | --- |
| 神像机甲 | 3 条 | `[0,0,0]` | 3 发，**同一枪口连发** |
| 科迪亚克 | 3 条 | `[0,1,2]` | 3 发，3 个不同枪口 |
| 沙暴 | 2 条 | `[0,1]` | 2 个枪口**轮转**；发数由 `missileCount` 给 |

所以：**发数 = 显式发数（`missileCount` / `attackCount` / `numToBurst`） ?? `#MUZZLE_INFO` ?? 1**，
且 `MUZZLE_INFO[i].muzzleIndex` 是「逻辑枪口号 → 物理枪口号」的映射，**枪口数从不乘 DPS**。

### 9.2 另一处未提取的实现：`unit_*.GetStatInfo()`

**20 个单位定义了 `GetStatInfo`**，它是**游戏内面板数值的计算函数**，我们同样从未跑过：

```lua
function unit_gdi_juggernaut.GetStatInfo(itemCombatTuning, rankInfo, itemDefinition, gameConfig)
  local statInfo = CombatTuningInfo.GetDefaultStatInfo(...)
  local multiHexDamageInfo = CombatTuningInfo.CreateMultiHexDamage(StyleID.Circle, 2)
  table.insert(statInfo, multiHexDamageInfo)
  return statInfo
end
```

- 定义 `GetStatInfo` 的 20 个：juggernaut ×2、kodiak、mgsquad、orcabomber、sandstorm ×2、titan、
  zonetrooper ×2、beamcannon、catalystgunship、chemicalwarrior、chemquad、firebomber、flametank、
  mutantmarauder、rockwyrm、scarab、ticktank
- 其中 **9 个用 `CreateMultiHexDamage`**（多格溅射）：juggernaut ×2、kodiak、sandstorm ×2、titan、
  beamcannon、firebomber、flametank

⚠️ **`unit_gdi_juggernaut.GetStatInfo` 里没有 "×3"** —— 所以面板 DPS 的 480 不是这里算的，
`×3` 来自 `MUZZLE_INFO` 的条目数（见 9.1）。**此文件仍未解，留待后续。**
