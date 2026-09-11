/**
 * 在 wasmoon（Lua 5.4 / WASM）里执行游戏的 Lua 调参脚本。
 *
 * 游戏脚本不是纯数据，会调用宿主 C++ 提供的函数，也会用 Lua 5.3+ 的
 * 原生位运算（`A | B`）。所以必须真求值，不能正则解析。
 * 见 docs/extraction.md。
 *
 * 本模块只负责「把 Lua 跑起来」；跨文件引用、产物整理在 extract.ts。
 */

import wasmoon from "wasmoon";

// wasmoon 是 CommonJS，named import 在 ESM 下不可靠
const { LuaFactory } = wasmoon;

/** 建表函数：透传第一个表参数。这些是引擎的 DSL 构造函数。 */
const TABLE_FUNCTIONS = [
  "CombineFlags",
  "Fixed16",
  "GetFixed16OrNil",
  "ItemTuning",
  "MakeOverride",
  "RequiredHash",
  "SetupCombatAbility",
  "SetupCombatStoreTuning",
  "SetupCombatantTuning",
  "SetupDamageFalloff",
  "SetupDamageTuning",
  "SetupFlyingTuning",
  "SetupModifierTuning",
  "SetupModifierVisuals",
  "SetupSquadTuning",
  "SetupWeaponTuning",
  "SetupSpawnUnitTuning",
  "FixedVector3",
  "inherits",
];

/** 断言/日志宏会被**调用**（不是索引），必须能调用，否则中断整个文件。 */
const NOOP_FUNCTIONS = ["IM_ASSERT", "IM_WARN", "IM_ERROR", "IM_LOG"];

/**
 * 枚举命名空间：字段名（`UnitTag.Infantry` -> `"Infantry"`）是真实语义，
 * 数字值缺失但名字可用，所以用「访问即返回键名」的自动属性表。
 */
const ENUM_NAMESPACES = [
  "DamageOverride",
  "DamageType",
  "DamageFlags",
  "MuzzleStrategy",
  "QueryArmyFilter",
  "Stat",
  "StatID",
  "StyleID",
  "TargetMode",
  "UnitStatPane",
  "UnitTag",
  "ActivationType",
  "CrateType",
  "ProgressionType",
  "UnitStatPaneId",
];

/** 需要预置为空表的引擎命名空间（脚本会 `X = X or {}` 后直接挂字段）。 */
export const NAMESPACES = [
  "nTuningUtil",
  "nAbilitySystem",
  "nFixed32Math",
  "nRankedStatsUtil",
  "nSquadSystem",
  "nCombatTuningSystem",
  "CombatTuningInfo",
  "Util",
  "ScorpionUiUtil",
];

/**
 * 引擎自己的工具模块，是正常 Lua，不依赖引擎内部符号，可原样加载。
 * 用它们比手写等价桩可靠得多。
 *
 * ⚠ **只加载这两个，不要多加。** 这两个模块含调参数据的归一化逻辑
 * （`SetupWeaponTuning` 等）。多加会引入问题：
 *
 * - `gameplay/tuning/CombatUnitTuning.lua`：它第 20 行调用
 *   `nCombatTuningSystem.RegisterItemTuning`（宿主 C++ 回调），
 *   且**它自己定义 `ItemTuning` 与 `SetupCombatAbility`**。加载它会
 *   覆盖 bootstrap 的桩，中途抛错后留下半初始化的全局。
 * - `util/Util.lua`：末尾大量面向 UI 的函数，顶层就会求值
 *   `Util.math.sign` 这类调用，在自动属性表上变成「调用字符串」而报错。
 */
export const REAL_MODULES = [
  "gameplay/tuning/TuningUtil.lua",
  "gameplay/tuning/CombatTuningInfo.lua",
] as const;

/**
 * 引擎注入的全局，用桩补上，否则脚本无法执行。
 *
 * 关键约束：`global` 与「未定义全局」都必须对任意键返回一个**表**
 * （不是字符串、不是 nil）——脚本会写 `global.Util = Util or {}`、
 * `global.OBJECT_LIVE_TUNING = true`，也会写
 * `global[weaponSequenceName]:TranslateToken("damage")`。
 */
const BOOTSTRAP = `
unresolved = {}

local function autoattr()
  return setmetatable({}, {__index = function(_, k) return k end})
end

-- 「未定义全局」专用的自动表：任意键返回**表**而不是字符串。
-- 因为脚本会做链式赋值
--   ability_spawn_gdi_repairdrone.settings.activation = ActivationType.X
-- 而 SetupModifierTuning 的结果没有被注册成那个全局名。
-- 若 __index 返回字符串，第二次索引就报 "attempt to index a string value"。
local function autotable()
  local t = {}
  return setmetatable(t, {__index = function(_, k)
    local v = autotable()
    rawset(t, k, v)
    return v
  end})
end

local function stubfn(a, ...) return a end
-- 断言宏会被**调用**（不是索引），必须能调用
local function noop(...) return nil end

local TABLE_FNS = {${TABLE_FUNCTIONS.map((n) => `"${n}"`).join(", ")}}
local NOOP_FNS = {${NOOP_FUNCTIONS.map((n) => `"${n}"`).join(", ")}}
local ENUM_NS = {${ENUM_NAMESPACES.map((n) => `"${n}"`).join(", ")}}
local NAMESPACES = {${NAMESPACES.map((n) => `"${n}"`).join(", ")}}

for _, n in ipairs(TABLE_FNS) do _G[n] = stubfn end
for _, n in ipairs(NOOP_FNS) do _G[n] = noop end
-- 枚举命名空间用 autoattr：字段名（UnitTag.Infantry -> "Infantry"）是真实语义
for _, n in ipairs(ENUM_NS) do _G[n] = autoattr() end
for _, n in ipairs(NAMESPACES) do _G[n] = {} end

-- 定点数：Fixed32(x) 与 fromValue / fromQ32 / toInt / toFloat 都要能用
Fixed32 = setmetatable({}, {
  __call = function(_, v) return v end,
  __index = function(_, k)
    if k == "fromValue" or k == "fromName" or k == "fromQ32" then
      return function(v) return v end
    end
    if k == "toInt" or k == "toFloat" then return function(v) return v end end
    return k
  end,
})

-- 位掩码枚举必须给数字，Lua 的按位或才合法。
--
-- ⚠️ **位值必须钉死，不能按访问顺序自增。** 原来写的是 i = i + 1; t[k] = 2 ^ i，
-- 于是 Ground 拿到 8 只是因为它恰好是第 3 个被访问到的名字 —— 往单位目录里
-- 加一个引用了新名字的文件，整个映射就会平移，已有数据里所有 descriptors
-- 数字的含义全部改变，而且**不会报错**。
--
-- 下面这张表是显式钉死的。**只有 Ground=8 与 TransportTypeMask_Flying=4096
-- 沿用了历史值**（为保证已有产物可对照），其余名字的历史值本来也是按访问顺序
-- 分到的，没有语义，这里重新分配、但从此固定。
-- 关键的两个（武器的攻击目标掩码）：
--   Ground                    = 8     → 这把武器能打地面
--   TransportTypeMask_Flying  = 4096  → 这把武器能打空中
-- 没列到的名字按首次访问顺序追加在后面，至少不会影响上面这些。
local DESCRIPTOR_BITS = {
  Ground = 8,
  ApplyAvoidance = 2,
  Offensive = 4,
  AttackableTypeMask = 16,
  Vehicle = 32,
  Air = 64,
  NotHiddenTypeMask = 128,
  Infantry = 256,
  Building = 512,
  AllMask = 1024,
  TransportTypeMask_Flying = 4096,
  SpawnNotSelected = 8192,
  HoverUnitDescriptors = 16384,
  UnitTypeMask = 32768,
  Underground = 65536,
  Lakes = 131072,
  GroundUnits = 262144,
  Mountains = 524288,
  MovementTransportMask_All = 1048576,
  GroundVehicleDescriptors = 2097152,
}
CombatantDescriptor = setmetatable({}, {__index = function(t, k)
  local v = DESCRIPTOR_BITS[k]
  if v == nil then
    -- 未登记的名字：取一个不会撞车的值，并打印出来提醒去补表
    v = 2 ^ 30
    print("[luaRuntime] 未登记的 CombatantDescriptor: " .. tostring(k))
  end
  t[k] = v
  return v
end})

-- global 必须是自动表：脚本会写 global.Util = Util or {}、
-- global.OBJECT_LIVE_TUNING = true、global[sequenceName]:TranslateToken(...)
global = autotable()

-- 跨模块引用（modifier_orcabomber_bomb 等）未加载时不许报错：
-- 任何未定义全局都返回一个自动表。
setmetatable(_G, {__index = function(_, k)
  if k == nil then return nil end
  local v = autotable()
  rawset(_G, k, v)
  return v
end})
`;

/** Lua 脚本带 UTF-8 BOM，必须先剥离，否则解析器在第一个字节就报语法错误。 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface LuaRuntime {
  /** 执行一段 Lua 源码 */
  exec(source: string): Promise<void>;
  /** 读取一个全局变量的值（已由 wasmoon 转成普通 JS 值） */
  get(name: string): unknown;
  close(): void;
}

/**
 * 建一个已加载 bootstrap 的 Lua 运行时。
 *
 * `loadModule` 按相对 scripts 根的路径取真实模块源码，取不到返回 null。
 * 加载失败的模块记进 `skipped`，不中断整体流程。
 */
export async function createLuaRuntime(
  loadModule: (rel: string) => Promise<string | null>,
  skipped: string[] = [],
): Promise<LuaRuntime> {
  const engine = await new LuaFactory().createEngine();
  await engine.doString(BOOTSTRAP);

  for (const rel of REAL_MODULES) {
    const src = await loadModule(rel);
    if (src === null) continue;
    try {
      await engine.doString(stripBom(src));
    } catch (err) {
      skipped.push(`${rel}: ${firstLine(err)}`);
    }
  }

  return {
    async exec(source: string) {
      await engine.doString(stripBom(source));
    },
    get(name: string) {
      return engine.global.get(name);
    },
    close() {
      engine.global.close();
    },
  };
}

export function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0] ?? msg;
}
