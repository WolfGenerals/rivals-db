# 提取原理

本文说明 `rivals extract` 内部怎么把游戏的 Lua 调参文件变成 JSON，
以及为什么必须这么做。

---

## 数据源：原始 Lua 源码

单位数值的权威来源是设备上的：

```
/Android/data/com.ea.gp.candcwarzones/published/nfd/scripts/gameplay/units/*.lua
```

这些是**随客户端分发的原始开发源码**，不是反编译产物。依据：

- 保留着开发注释，例如 `unit_gdi_riflemen.lua` 第 23 行 `-- This is unsed`
- tab 缩进
- 变量名与调试残留（`oldTuning = unit_gdi_riflemen,`）

所以数值**零损失**，不需要反编译 Lua 字节码。

`unit_gdi_riflemen.lua` 的样子：

```lua
unit_gdi_riflemen = ItemTuning{
	name = "unit_gdi_riflemen",
	combatantTuning = {
		weaponTunings = { {
			name = "rifle",
			damageTuning = {
				default = 38,
				overrides = { { DamageOverride.Vehicle, 15 } }
			},
			maxRangeInTiles = 2.5,
			burstTiming = { cooldown = 1.72, numToBurst = 1 },
		} },
		health  = 130,
		speed   = 6.928,
		tags    = { UnitTag.Infantry, UnitTag.override_infantry },
	},
	squadTuning = { waveSize = 5, visionRangeInTiles = 3 },
	combatStoreTuning = { tiberiumCost = 10 },
}
```

---

## 为什么不能用正则或手写解析器

这些文件**不是纯数据**。里面有四类东西会让朴素解析失败：

```lua
Fixed32.fromValue(0.3)                                       -- 宿主回调（定点数）
MakeOverride(DamageOverride.Vehicle, 13)                     -- 宿主回调
RequiredHash("vfx_mzl_disruptor")                            -- 宿主回调（字符串哈希）
CombatantDescriptor.Vehicle | CombatantDescriptor.Infantry   -- Lua 5.3+ 原生位运算
nTuningUtil.GetProjectileTuning(unit_gdi_grenadier, 1).emp   -- 跨文件引用
```

正确做法是把文件**当作 Lua 代码执行**，用桩补上引擎提供的全局量，
再从全局环境里取回表。这需要真正的 Lua 运行时。

---

## 为什么用 lupa

`lupa` 是 Lua 的 Python 绑定，方案的关键在于**它内置的 Lua 版本**：

| 需求 | lupa 2.8 提供的 |
| --- | --- |
| 执行 Lua 5.3+ 脚本 | **Lua 5.5**，原生支持 `\|` `&` 位运算 |
| 读回嵌套表 | `_LuaTable` 映射，可递归遍历 |

若换成 Lua 5.1 / LuaJIT（如 `lupa` 的旧版本），`A | B` 这类写法会直接报错，
包含位运算的单位文件全部无法提取。

---

## 实现要点

### 1. 文件带 UTF-8 BOM

必须用 `utf-8-sig` 读取，否则 Lua 解析器在第一个字节就报语法错误：

```
LuaSyntaxError: unexpected symbol near '<\239>'
```

### 2. 两遍求值

单位文件之间存在引用：

```lua
-- unit_gdi_grenadier.lua 里
tuning = nTuningUtil.GetProjectileTuning(unit_gdi_grenadier, 1).emp,
```

`nTuningUtil.GetWeaponTuning` 会去取 `unit_gdi_grenadier` 这个全局表。
因此要照引擎的加载顺序：

1. 第一遍：让全部单位的 tuning 注册到全局
2. 第二遍：跑那些需要解引用的代码

实现见 `extract.py` 的 `load_units`。

### 3. 先加载真实模块，别用桩糊

`gameplay/tuning/` 下的 `TuningUtil.lua` 和 `CombatTuningInfo.lua`
**本身就是正常 Lua**，不依赖引擎内部符号，可以原样 `lua.execute()`。
用它们比手写等价桩可靠得多。

### 4. `nTuningUtil` 要先种空表

脚本写的是：

```lua
global.nTuningUtil = nTuningUtil or {}
```

索引 `nTuningUtil` 前该全局必须已存在，否则报 `attempt to index a nil value`。

### 5. 枚举桩与位掩码

- 普通枚举（`UnitTag` / `Stat` / `DamageOverride`）：用带 `__index` 的自动属性表，
  访问什么名字就返回什么名字。
- **位掩码枚举**（`CombatantDescriptor`）：必须返回**数字**，否则 `A | B` 报
  `attempt to perform bitwise operation on a string value`。
  实现是「访问即返回 2 的幂」——代价是这些值是编造的，见下文。
- **未定义全局**：跨模块引用（如 `modifier_orcabomber_bomb`）在未加载时会返回
  自动属性表而不是 `nil`，避免整个文件求值失败。

### 6. 占位值的识别与丢弃

桩会产生两类不能当真实数据的东西：

| 类型 | 处理 |
| --- | --- |
| 函数（表里挂的 `GetStatInfo` 等方法） | 按类型丢弃 |
| 枚举名字符串（`"Vehicle"`） | **保留**，语义正确 |
| 位掩码数字（`[8.0, 16.0, ...]`） | 保留但标注不可用（见 `output-format.md`） |

被丢弃的字段路径会写进该单位的 `warnings`，
所以产物里的缺口是**可见**的，而不是静默丢数据。

> 踩过的坑：最初把枚举名字符串也当占位丢了，结果 `tags = []`、
> `goodAgainstTags = []`——属性数据全空。枚举**名字**是真实语义，必须保留。

### 7. `id()` 身份比对不可用

lupa 每次访问 Lua 值都会新建 Python 包装对象：

```python
lua.globals()["t"] is lua.globals()["t"]   # False
```

所以不能靠 `id()` 判断「这个值是不是我塞的桩」。
最终按**值本身**登记（字符串/数字查表），函数/表按类型判断。

---

## 数据来源与版本

- APK：`1_13_0new.apk.1`（96.6 MB，3005 个 zip 条目），版本 **1.13.0**
- 设备数据目录：`/Android/data/com.ea.gp.candcwarzones/`
- 资源清单（路径 + 哈希 + 大小）：`.idx/asset_list_*.txt`
- `published/data/entgen/enums.def`（386 行）含 `DamageType`、`FactionProto`、
  `CameraLayerEnum` 等枚举定义，**但不含 `UnitTag`**

---

## 尚未解决

| 缺口 | 位置 | 说明 |
| --- | --- | --- |
| 枚举数字值 | `lib/arm64-v8a/libapp.so` | `UnitTag` / `Stat` / `DamageOverride` 的数字值由 C++ 宿主注入。已确认 so 中存在 `override_infantry`、`UnitTag`、`CombatantDescriptor` 等字符串，但未逆向提取 |
| 显示名 / 描述 | `published/strings/<语言>/app.sb` | 未解出 |
| 等级 / 星级成长 | `files/game-config.pb` | 裸 protobuf（无 `.proto` 定义），需按 wire format 手写解析 |
| 模型 / 动画 | `published/models/units/*.sb3d` | 自研 "SBIN" 容器（`53 42 49 4e` + `STRU` / `FIEL` 块），可解析但与数值无关 |
| 加密配置 | `published/config/tnbn.bs` | 二进制，未解 |

当前提取的是**调参基准值**，不含每级数值。
