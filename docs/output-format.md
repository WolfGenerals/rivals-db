# 输出格式

`rivals extract` 的产物结构、字段含义，以及**哪些字段不可使用**。

---

## 目录结构

```
data/
├── index.json              汇总索引：全部单位的关键字段，按造价升序
├── gdi/                    43 个：unit_gdi_*.json
├── nod/                    39 个：unit_nod_*.json
└── misc/                    2 个：unit_example / unit_dlc_test
```

文件名为 `unit_id`，即 Lua 里的 `unit_<派系>_<单位名>`。

`unit_example` 与 `unit_dlc_test` 是开发占位文件，不是 GDI/NOD 阵营，归入 `misc/`。

### 关于变体

同一单位的不同版本是**独立文件**，靠后缀区分：

| 后缀 | 含义 |
| --- | --- |
| `_ST` | 特殊版本（Star / Special Tier） |
| `_CR` | 指挥官相关版本 |
| `_mayhem` | Mayhem 模式版本 |

例如 `unit_gdi_juggernaut`、`unit_gdi_juggernaut_ST` 是两个文件。

每个文件里有 `variant` 字段给出去掉后缀的基础名（`juggernaut`），
`suffixes` 给出后缀列表（`["ST"]`），便于按单位归组。

---

## 单位文件

以 `data/gdi/unit_gdi_predatortank.json` 为例（节选）：

```json
{
  "_note": "combatantTuning.descriptors / weaponTunings[].descriptors 是位掩码占位值（枚举定义在宿主 C++ 中，Lua 源码里没有），不要当作真实数值使用。tags / goodAgainstTags 是枚举名字符串，语义正确。",
  "unit_id": "unit_gdi_predatortank",
  "faction": "GDI",
  "variant": "predatortank",
  "source": "gameplay/units/unit_gdi_predatortank.lua",
  "config": {
    "name": "unit_gdi_predatortank",
    "combatantTuning": {
      "health": 2823,
      "speed": 3.958857,
      "tags": ["Vehicle", "override_vehicle"],
      "goodAgainstTags": ["Vehicle"],
      "weaponTunings": [
        {
          "name": "cannon",
          "maxRangeInTiles": 1.25,
          "burstTiming": { "cooldown": 3.44 },
          "damageTuning": {
            "default": 830,
            "overrides": [["Infantry", 96]]
          }
        }
      ]
    },
    "combatStoreTuning": { "tiberiumCost": 70 }
  }
}
```

### 顶层字段

这些是工具生成的元数据，不是游戏数据：

| 字段 | 说明 |
| --- | --- |
| `_note` | 占位值警告，每个文件都有。JSON 无注释，故写进数据 |
| `unit_id` | 单位标识，对应 Lua 全局名 |
| `faction` | `GDI` / `NOD` / `UNKNOWN`（占位文件） |
| `variant` | 去掉变体后缀的基础名 |
| `suffixes` | 变体后缀列表，无后缀时**该键不存在** |
| `source` | 相对脚本根的源文件路径，可回溯核对 |
| `warnings` | 该单位提取时被丢弃的字段路径，无告警时**该键不存在** |
| `config` | 游戏原始调参树，整棵照搬 |

### `config` 常用字段

| 字段 | 含义 |
| --- | --- |
| `combatantTuning.health` | 生命值 |
| `combatantTuning.speed` | 移动速度 |
| `combatantTuning.tags` | 单位类型：`Infantry` / `Vehicle` / `Aircraft` / `Structure` |
| `combatantTuning.goodAgainstTags` | 克制目标类型 |
| `combatantTuning.weaponTunings[]` | 武器列表，每个含伤害、射程、冷却等 |
| `weaponTunings[].maxRangeInTiles` | 射程（格） |
| `weaponTunings[].burstTiming.cooldown` | 攻击冷却（秒） |
| `weaponTunings[].damageTuning.default` | 基础伤害 |
| `weaponTunings[].damageTuning.overrides` | 对特定类型的伤害覆写，形如 `[["Vehicle", 250]]` |
| `weaponTunings[].displayName` | 界面文案的**本地化 key**，不是显示文本 |
| `squadTuning.waveSize` | 小队人数（步兵类） |
| `squadTuning.visionRangeInTiles` | 视野（格） |
| `combatStoreTuning.tiberiumCost` | 泰伯利亚矿造价 |

`config` 下会保留源文件的**全部**字段，上表只列常用的。
抽取逻辑整棵树照搬，不做字段筛选。

### 读取时的注意点

- **键顺序已排序**（`sort_keys`），字段顺序稳定，便于 diff。
- **缺字段时该键直接不存在**，不用 `null` 占位。
  取值一律用 `.get()`，不要假设键一定在：

  ```python
  damage = weapon.get("damageTuning", {}).get("default")   # 可能是 None
  ```

  这很重要：采集车没有武器，`weaponTunings` 就没有 `damageTuning`。

- 多次运行结果**完全一致**（已验证逐字节相同）。

---

## ⚠ 占位值：不要使用的字段

这些字段的**数字是假的**（工具生成的占位），语义无意义：

| 字段 | 输出形态 | 说明 |
| --- | --- | --- |
| `combatantTuning.descriptors` | `[8.0, 16.0, 32.0, 64.0]` | 位掩码枚举，定义在宿主 C++ 中 |
| `weaponTunings[].descriptors` | `[8.0, 4.0]` | 同上 |

原因：这些枚举（`CombatantDescriptor`）由引擎的 C++ 侧注入，Lua 源码里只有名字。
工具为了保证求值不中断，用「访问即返回 2 的幂」的方式桩掉了。
**这组数字是为了让 `A | B` 位运算合法而编造的，不要用于任何计算。**

每个文件的 `_note` 字段和 `index.json` 都有对应提醒。

`tags` 与 `goodAgainstTags` **不受影响**——它们是名字字符串，语义正确。

---

## `index.json`

汇总所有单位的关键字段，按造价升序（即游戏内商店顺序）。

```json
{
  "_note": "...",
  "source_root": "...\\published\\nfd\\scripts",
  "unit_count": 84,
  "gdi_count": 43,
  "nod_count": 39,
  "misc_count": 2,
  "units": [
    {
      "unit_id": "unit_gdi_riflemen",
      "faction": "GDI",
      "variant": "riflemen",
      "health": 130,
      "speed": 6.928,
      "cost": 10,
      "damage": 38,
      "range": 2.5,
      "cooldown": 1.72,
      "weapon_count": 1,
      "tags": ["Infantry", "override_infantry"],
      "good_against": ["Infantry"],
      "wave_size": 5,
      "vision_range": 3
    }
  ]
}
```

字段缺失时**该键省略**，例如采集车没有 `damage` / `range` / `cooldown`。
判断时用 `.get()` 而非下标。

`damage` 取的是**第一件武器**的基础伤害。多武器单位（如猛犸坦克）
`weapon_count` 会大于 1，具体伤害需读单位文件。

---

## 消费示例

```python
import json

with open("data/gdi/unit_gdi_riflemen.json", encoding="utf-8") as f:
    unit = json.load(f)

print(unit["config"]["combatantTuning"]["health"])   # 130
print(unit["config"]["combatantTuning"]["tags"])     # ['Infantry', 'override_infantry']
```

```python
# 按造价筛选便宜单位
with open("data/index.json", encoding="utf-8") as f:
    index = json.load(f)

cheap = [u for u in index["units"] if u.get("cost", 999) <= 30]
for u in cheap:
    print(u["unit_id"], u.get("health"), u.get("cost"))
```

```python
# 找出能打空的单位
with open("data/index.json", encoding="utf-8") as f:
    index = json.load(f)

anti_air = [u["unit_id"] for u in index["units"]
            if "Aircraft" in (u.get("good_against") or [])]
print(len(anti_air), "个单位标注为克制空中单位")
```

JSON 无需任何第三方库，Python 标准库 `json` 即可。
