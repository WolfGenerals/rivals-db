# 产物数据格式（我们自己的 schema）

> **为什么要有这一层**：官方那套结构是「每个单位一个样」的内部实现 —— 伤害可能写在
> **四个**不同位置、开火节奏有 **15 种**实现、`TranslateToken` 还会**写死单位全局名**。
> 消费方（网页 / CLI / 以后的 bot）不该各自去解这些。
>
> 我们已经把这些逻辑全部搞清楚了（15 条公式全部被游戏内面板观测点验证，且被引擎自己的
> `CombatTuningInfo.lua` 印证）。**所以：在提取时算一次，把结论写进产物，下游只读结论。**

---

## 1. 两个块：`derived`（读这个）+ `config`（审计用）

```jsonc
{
  "_schema": 2,
  "_note": "…",

  "id": "unit_gdi_riflemen",
  "faction": "GDI",
  "variant": "riflemen",
  "suffixes": ["…"],              // 可选
  "source": "gameplay/units/unit_gdi_riflemen.lua",

  // 本地化（不变）
  "name_zh": "步枪兵",
  "name_en": "Riflemen",
  "desc_zh": "…",
  "desc_en": "…",

  // 稀有度（来自 game-config.pb）
  "pb": { "rarity": "Common", "start_major": 1 },

  // ★★★ 新：已决策的展示数据。消费方**只读这里**。
  "derived": { … },

  // 原始树，**保留供审计与再推导**，消费方不应解析
  "config": { … }
}
```

**规则**：网页/CLI 只读 `derived`；`config` 只在核对数据、改进提取器时看。

---

## 2. `derived` 完整结构

```jsonc
"derived": {
  "_note": "已按引擎算法算好的最终值。消费方只读这里，不要解析 config。",

  // ── 等级 ──────────────────────────────────────────────
  "level": {
    "start_major": 1,        // 由稀有度推：Common 1 / Rare 3 / Epic 5；无稀有度为 null
    "max_major": 15,
    "minor_max": 3
  },

  // ── 血量 ──────────────────────────────────────────────
  // ⚠️ 游戏里 health 是**每员**血量，总血 = health × waveSize
  "health": {
    "per_member": 130,
    "wave_size": 5,
    "total": 650           // 1-0 级；随等级缩放由消费方按 level 公式算
  },

  // ── 单位 DPS（1-0 级）────────────────────────────────
  // = **主武器**的 dps，与游戏内面板一致（不是各武器取最大，见 findings I103）
  "dps": 300,

  // ── 固有属性（不随等级变；**缺的字段直接不出现**）─────────
  "stats": {
    "cost": 10,
    "speed": 6.928,
    "vision_tiles": 3,
    "can_be_crushed": true,
    "stealth_detect_tiles": 1,
    "kill_award_tiberium": 0,
    "deploy_ms": 2000,      // modifier_intro；没有就不出现
    "undeploy_ms": 500      // modifier_outro
  },

  // ── 小队（**仅 wave_size > 1 时出现**；单成员不算小队）──
  "squad": {
    "wave_size": 5,
    "separation_ms": 344,
    // 错开×人数 > 周期 → 会跨轮重叠（狂信徒那种）
    "overlaps_cycle": false
  },

  // ── 索敌偏好（官方文案里"强于 XXX"的那个）──────────────
  // ⚠️ 这是 **AI 索敌意图**，不是伤害克制！真实克制看 weapons[].damage_overrides
  "preferred_targets": ["Infantry"],

  // ── 武器（数量不定）──────────────────────────────────
  "weapons": [ … ],

  // ── 提取期的遗留告警（原样搬过来）──────────────────────
  "warnings": ["…"]
}
```

### 2.1 `derived.weapons[]`

**伤害只有一个字段** —— 四个可能位置已经在提取时归一（这是本 schema 最大的价值）。

```jsonc
{
  "name": "rifle",                     // 武器内部名
  "display_name_key": "UI_…",          // 本地化 key（不是文本）
  "weapon_type": "projectile",
  "primary": true,                     // ★ 面板 DPS 取它（第一把"真武器"）

  "attack": "持续射击",                 // 人类可读的攻击方式
  "behaviour": "ability_simple_weapon_sequence",  // 对应 gameplay/abilities/<名>.lua

  "dps": 300,                          // 1-0 级
  "damage": 38,                        // ★ 单次命中伤害（已归一）
  "damage_overrides": [["Vehicle", 15]],  // ★ 伤害补正（已归一 override/overrides）

  "can_attack": ["Infantry", "Vehicle", "Structure", "Harvester"],
  "targeting_unknown": false,          // descriptors 空表 → true（此时 can_attack 为空）

  "range_tiles": 2.5,
  "interval_ms": 344,                  // 攻击周期（毫秒）
  "hits_per_attack": 1,                // 一次攻击打几下（原 #MUZZLE_INFO）
  "muzzle_count": 1,                   // 只用于展示"几口轮转"，**不参与 DPS**
  "homing": true,
  "clip": null,                        // { "size": 3, "reload_ms": 5000 } 或 null

  "phases": [                          // 开火过程的段（时序图/明细表都吃这个）
    { "kind": "fire", "label": "持续射击", "ms": null, "damage": 38, "interval_ms": 344 }
  ],

  "notes": []                          // 特殊情况说明，见 §4
}
```

**`phases[].kind` 取值**：`charge`（前摇）· `fire`（开火）· `pause`（停顿）· `reload`（装填）。

**`phases[]` 可选字段**：`shots`（段内发数）· `interval_ms`（段内间隔）· `splash`（溅射目标数）·
`ramp`（相对上一段的倍率，如 `2.0` 表示 `↑2.0×`）。

### 2.2 `attack` 的取值（人类可读）

| `attack` | 含义 | 代表单位 |
| --- | --- | --- |
| `常规` | 引擎内置序列，`burstTiming` 驱动 | 掠食者、步枪兵（62 把） |
| `持续射击` | 固定间隔持续输出 | 弹弓（180ms）、狼獾（190ms） |
| `倾泻` | 一轮打一堆再停 | 沙暴（12 发 / 4s） |
| `分段光束` | 伤害随阶段递增 | 万钧巨炮（45→90→150）、蛇怪（50→175） |
| `持续光束` | 单段固定间隔光束 | 圣灵、寡女制造者、破坏者 |
| `齐射` | 一轮多发，有轮间隔 | 科迪亚克（3 发/3s）、神像机甲（3 发/2.5s） |
| `铺场 + 引爆` | 一把铺场、另一把引爆 | 催化剂直升机 |
| `投弹` | 扔一串炸弹再装填 | 虎鲸轰炸机 |
| `自爆` | 前摇后一枪自毁 | 圣甲虫 |
| `未知` | 认不出（当前 **0** 把） | — |

---

## 3. 每个字段的**来源**（可审计）

| `derived` 字段 | 原始位置 |
| --- | --- |
| `health.per_member` | `config.combatantTuning.health` |
| `health.wave_size` | `config.squadTuning.waveSize` |
| `dps` / `weapons[].dps` | `UnitAttack.of(unit).dps()`（15 条公式，见 `docs/attack-mechanics.md`） |
| `stats.cost` | `config.combatStoreTuning.tiberiumCost` |
| `stats.speed` | `config.combatantTuning.speed` |
| `stats.vision_tiles` | `config.squadTuning.visionRangeInTiles` |
| `stats.deploy_ms` / `undeploy_ms` | `weaponTunings[].modifier_intro/outro.tuning.durationMs` |
| `squad.separation_ms` | `config.squadTuning.attackSeparationDurationMS` |
| `preferred_targets` | `config.combatantTuning.goodAgainstTags` ⚠️ **AI 意图，非克制** |
| `weapons[].damage` | **四个位置归一**：`modifier_sequence.tuning.stage*.damageMain` → `damageMain` → `damage` → `modifier_shot.tuning.damage` → `projectile.modifier.tuning.damage`/`damage1` → `damageTuning.default` |
| `weapons[].damage_overrides` | `damageTuning.overrides` 或序列里的 `override`（`MakeOverride` 造的 `[标签, 值]`） |
| `weapons[].can_attack` | `descriptors` 位掩码的四条规则（见 `docs/attack-mechanics.md` §5） |
| `weapons[].hits_per_attack` | `unit.visual[<序列名>].MUZZLE_INFO` 的条目数 |
| `weapons[].phases` | `WeaponAttack.phases()` |

---

## 4. `notes[]`：把"游戏自己的怪癖"显式化

不藏起来，直接写进产物，消费方可以原样显示或忽略：

| note | 含义 | 已知实例 |
| --- | --- | --- |
| `面板复用基础版能力` | 该变体复用基础版 behaviour，而 `TranslateToken` **写死了基础版单位名**，所以游戏面板给的是基础版的数值 | `gdi_juggernaut_ST`、`gdi_sandstorm_ST` |
| `索敌方式未知` | `descriptors` 是空表（全库 6 把），**不猜**能打什么 | `orcabomber.bomb`、`catalystgunship.catalystWeapon`、`msv.rockets`、`ticktank.hidden`、`repairdrone.guns` ×2 |
| `非武器` | 占位桩 / 维修臂之类，不是真的攻击手段 | `orcabomber.targetSelector`、`repairdrone.guns` |
| `伤害位置非常规` | 伤害来自 `modifier_shot` / `damage1` 等少见位置（已归一，仅告知） | 泰坦机甲、地狱火 |
| `两段命中待确认` | `damage1`+`damage2` 是同一目标两段还是主/副目标，未定论 | 地狱火 |

---

## 5. `index.json`（列表页用）

保持扁平，但 **`dps` 改用 `derived.dps`**（现在是 `baseDps`，对 22 把特殊武器返回 0）：

```jsonc
{
  "_schema": 2,
  "units": [
    {
      "id": "unit_gdi_riflemen",
      "faction": "GDI",
      "variant": "riflemen",
      "name_zh": "步枪兵",
      "name_en": "Riflemen",
      "rarity": "Common",
      "cost": 10,
      "health": 130,           // 每员
      "wave_size": 5,
      "dps": 300,              // ★ 来自 derived
      "attack": "持续射击",     // ★ 新增
      "range": 2.5,
      "good_against": ["Infantry"],
      "weapon_count": 1
    }
  ]
}
```

---

## 6. 消费方要删掉的东西

规范化之后，这些**读时适配**全部下线：

| 位置 | 现状 | 之后 |
| --- | --- | --- |
| `web/src/damageTiers.ts` 的 `weaponBaseline()` / `targetDamage()` | 读时解析伤害 | 删，读 `derived.weapons[].damage` |
| `web/src/components/UnitPanel.vue` 的 `UnitAttack.of(unit)` | 每次渲染重算 | 删，读 `derived.dps` |
| `web/src/damageTiers.ts` 的 `effectiveDamage()` 调用 | 读时归一 | 删 |
| `core/src/types.ts` 的 `baseDps()` / `unitBaseDps()` | 只覆盖 62 把常规武器 | 下线（CLI 的 `damage` 命令改读 `derived`） |
| `web/src/views/UnitList.vue` 的 `approxBaseDps()` | 近似 | 删 |

**`core/src/attack.ts` 不删** —— 它从"读时引擎"变成"**提取期引擎**"：`cli extract` 调它一次，
把结果写进 `derived`。15 个行为类、8 个形状类、`effectiveDamage`、`canAttackTarget` 全部留在
那里，**只有一处调用点**。

---

## 7. 代价与取舍

**代价**：学到新东西要重跑 extract（`pnpm --filter @rivals/cli start extract` + `_build_locale.py` + `sync-data`）。
我们已经重跑过 6 次，不是新成本。

**换来**：
1. **下游不可能读错位置** —— 这正是我们反复栽的地方（`modifier_shot`、`damage1`、`effectiveDamage` 漏改、`weaponBaseline` 漏改）。产物里只有**一个** `damage` 字段
2. **一处知识一处实现** —— 15 条公式只在 `attack.ts`
3. **差异显式化** —— `notes[]` 让"游戏自己的怪癖"可见，而不是让下游莫名其妙

**不做的事**：不去复刻引擎的 `TranslateToken`（它写死单位名、还要 `nTuningUtil`），
那只会为了复刻一个 bug 而引入更多依赖。我们用**已验证的 15 条公式**，并在 `notes` 里标明差异。
