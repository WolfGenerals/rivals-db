"""Rivals 单位数据提取核心。

用 lupa 真求值游戏 Lua 调参文件（不是正则/手写解析器），
再把结果整理成可序列化的普通 Python 数据。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from lupa import LuaRuntime, lua_type

# 引擎注入的宿主全局：需要桩，否则脚本无法执行。
# 语义上：名称访问返回名称本身（枚举），函数桩透传第一个表参数。
# 占位判定见 _to_plain：函数/表按类型丢弃，字符串占位查 unresolved 表。
_LUA_BOOTSTRAP = """
-- 如果将来出现“必须丢弃的字符串/数字占位”，登记到这里。
-- 注意：登记的是“值”本身，因为 lupa 每次访问都会新建包装对象，
-- Python 侧无法用 id() 做身份比对。
unresolved = {}

-- 枚举字段名（UnitTag.Infantry -> "Infantry"）是真实语义，不登记为占位：
-- 数字值虽然缺失，但名字本身可用。
local function autoattr()
  return setmetatable({}, {__index = function(_, k) return k end})
end
for _, n in ipairs({
  "CombatTuningInfo", "DamageOverride", "DamageType", "DamageFlags",
  "MuzzleStrategy", "QueryArmyFilter", "Stat", "StatID", "StyleID",
  "TargetMode", "UnitStatPane", "UnitTag"
}) do _G[n] = autoattr() end

local function stubfn(a, ...) return a end
for _, n in ipairs({
  "CombineFlags", "Fixed16", "GetFixed16OrNil", "ItemTuning", "MakeOverride",
  "RequiredHash", "SetupCombatAbility", "SetupCombatStoreTuning",
  "SetupCombatantTuning", "SetupDamageFalloff", "SetupDamageTuning",
  "SetupFlyingTuning", "SetupModifierTuning", "SetupModifierVisuals",
  "SetupSquadTuning", "SetupWeaponTuning", "inherits"
}) do _G[n] = stubfn end

-- 定点数：Fixed32(x) 与 Fixed32.fromValue(x) 都要能用
Fixed32 = setmetatable({}, {
  __call = function(_, v) return v end,
  __index = function(_, k)
    if k == "fromValue" or k == "fromName" then
      return function(v) return v end
    end
    return k
  end,
})

-- 位掩码枚举必须给数字，Lua 5.5 的 `A | B` 才合法
for _, n in ipairs({"CombatantDescriptor"}) do
  local i = 0
  _G[n] = setmetatable({}, {__index = function(t, k)
    i = i + 1; t[k] = 2 ^ i; return t[k]
  end})
end

-- 脚本会写 `global.nTuningUtil = nTuningUtil or {}`，索引前必须存在
global = setmetatable({}, {__index = function(_, k) return k end})
for _, n in ipairs({"nTuningUtil", "nAbilitySystem"}) do _G[n] = {} end

-- 跨模块引用（modifier_orcabomber_bomb 等）未加载时不许报错：
-- 任何未定义全局都返回一个自动属性表。
setmetatable(_G, {__index = function(_, k)
  if k == nil then return nil end
  local v = autoattr()
  rawset(_G, k, v)
  return v
end})
"""

# 引擎自己的工具模块，是正常 Lua，直接原样加载。
_REAL_MODULES = ("tuning/TuningUtil.lua", "tuning/CombatTuningInfo.lua")

_UNIT_FILE = re.compile(r"^unit_(gdi|nod)_(.+)\.lua$")


class RivalsError(Exception):
    """提取过程中的可预期错误。"""


@dataclass
class UnitRecord:
    """一个单位的提取结果。"""

    unit_id: str
    faction: str                      # "GDI" / "NOD"
    variant: str                      # 基础单位名，去掉 _ST / _CR / _mayhem 等后缀
    suffixes: list[str] = field(default_factory=list)
    source: str = ""                  # 相对 scripts 根的源文件路径
    config: dict = field(default_factory=dict)   # 完整调参树
    warnings: list[str] = field(default_factory=list)


def find_scripts_root(start: Path) -> Path:
    """在给定目录内查找 nfd/scripts。

    接受解包根目录、包名目录（com.ea.gp.candcwarzones）、
    published/nfd/scripts，或直接是 scripts / gameplay。

    只在给定目录内部查找，**不向父目录上溯**——否则指向任意目录都会
    命中仓库里的游戏数据，把错路径当成对的。
    """
    start = start.resolve()
    if not start.is_dir():
        raise RivalsError(f"不是目录：{start}")

    # 直接就是 gameplay/ 或 scripts/ 目录的情况
    if (start / "units").is_dir() and (start / "tuning").is_dir():
        return start.parent.resolve()
    if (start / "gameplay" / "units").is_dir():
        return start.resolve()

    # 由深到浅，命中第一个含 units 的 gameplay
    probes = (
        start / "scripts" / "gameplay",
        start / "nfd" / "scripts" / "gameplay",
        start / "published" / "nfd" / "scripts" / "gameplay",
        start / "com.ea.gp.candcwarzones" / "published" / "nfd" / "scripts" / "gameplay",
    )
    for probe in probes:
        if (probe / "units").is_dir():
            return probe.parent.resolve()

    raise RivalsError(
        f"在 {start} 下找不到 gameplay/units，"
        "请指向解包目录、包名目录、published/nfd/scripts 或 gameplay"
    )


def _to_plain(value, unresolved, dropped: list[str], path: str = "", depth: int = 0):
    """Lua 值 → 普通 Python 值。

    被桩替换的值（枚举名占位、未加载模块的字段）会记进 `dropped` 并丢弃，
    以免把占位数据当真值写进输出。
    """
    if depth > 64:
        dropped.append(f"{path}=<max-depth>")
        return None
    if unresolved is not None:
        # 身份比对不可靠（lupa 每次访问都新建包装对象），改按值登记。
        # 只查字符串/数字，避免对大表做 O(n) 的 __eq__ 扫描。
        if isinstance(value, (str, int, float)) and not isinstance(value, bool):
            if value in unresolved:
                dropped.append(path or "<root>")
                return None
    if lua_type(value) == "table":
        keys = list(value.keys())
        if keys and all(isinstance(k, int) for k in keys):
            out = []
            for i in sorted(keys):
                item = _to_plain(value[i], unresolved, dropped, f"{path}[{i}]", depth + 1)
                if item is not None:
                    out.append(item)
            return out
        out = {}
        for k, v in value.items():
            key = str(k)
            item = _to_plain(v, unresolved, dropped, f"{path}.{key}" if path else key, depth + 1)
            if item is not None:
                out[key] = item
        return out
    if lua_type(value) == "function" or callable(value):
        # 调参表里挂的方法（GetStatInfo / SetStatOverrides 等）不是数据
        dropped.append(f"{path}=<function>")
        return None
    if isinstance(value, float):
        return round(value, 6)
    return value


def _unresolved_values(lua) -> set:
    """取出 bootstrap 登记过的占位值（枚举名、RequiredHash 标记等）。"""
    reg = lua.globals()["unresolved"]
    if reg is None or lua_type(reg) != "table":
        return set()
    return {k for k in reg.keys() if isinstance(k, (str, int, float)) and not isinstance(k, bool)}


def _split_variant(stem: str) -> tuple[str, list[str]]:
    """unit_gdi_juggernaut_ST -> ("juggernaut", ["ST"])

    去掉派系前缀与变体后缀，得到可比较的基础单位名。
    """
    parts = stem.split("_")
    if len(parts) >= 3 and parts[0] == "unit" and parts[1] in ("gdi", "nod"):
        parts = parts[2:]
    known_lower = {"mayhem"}
    suffixes: list[str] = []
    while len(parts) > 1 and (parts[-1].isupper() and len(parts[-1]) <= 6 or parts[-1] in known_lower):
        suffixes.insert(0, parts.pop())
    return "_".join(parts), suffixes


def load_units(
    scripts_root: Path,
    on_error: str = "warn",
) -> tuple[list[UnitRecord], list[tuple[str, str]]]:
    """求值全部单位脚本并返回结构化记录。

    返回 (records, failures)。`on_error="raise"` 时首个错误即抛出。
    """
    units_dir = scripts_root / "gameplay" / "units"
    files = sorted(units_dir.glob("unit_*.lua"))
    if not files:
        raise RivalsError(f"{units_dir} 下没有 unit_*.lua")

    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(_LUA_BOOTSTRAP)
    for rel in _REAL_MODULES:
        path = scripts_root / "gameplay" / rel
        if path.exists():
            lua.execute(path.read_text(encoding="utf-8-sig", errors="replace"))

    # 两遍：第一遍让所有 tuning 注册，第二遍解跨文件引用
    sources = {p.stem: p.read_text(encoding="utf-8-sig", errors="replace") for p in files}
    failures: dict[str, str] = {}
    for _ in range(2):
        failures = {}
        for stem, src in sources.items():
            try:
                lua.execute(src)
            except Exception as exc:  # noqa: BLE001
                failures[stem] = f"{type(exc).__name__}: {str(exc).splitlines()[0]}"
                if on_error == "raise":
                    raise RivalsError(f"{stem}: {failures[stem]}") from exc

    unresolved = _unresolved_values(lua)

    records: list[UnitRecord] = []
    for path in files:
        stem = path.stem
        if stem in failures:
            continue
        match = _UNIT_FILE.match(path.name)
        dropped: list[str] = []
        try:
            raw = _to_plain(lua.globals()[stem], unresolved, dropped)
        except Exception as exc:  # noqa: BLE001
            failures[stem] = f"{type(exc).__name__}: {exc}"
            continue
        if not isinstance(raw, dict):
            # unit_example / unit_dlc_test 之类：不是调参表，仍如实输出并告警
            raw = {"raw_value": raw} if raw is not None else {}
            dropped.append("<顶层不是调参表>")

        faction = match.group(1).upper() if match else "UNKNOWN"
        variant, suffixes = _split_variant(stem)

        config = {k: v for k, v in raw.items() if k not in ("oldTuning", "cPtr")}
        warnings: list[str] = []
        if not (config.get("combatantTuning") or {}).get("health"):
            warnings.append("缺少 combatantTuning.health（可能是占位/测试单位）")
        if dropped:
            # Lua 表遍历顺序不确定，排序以保证多次运行结果完全一致
            shown = ", ".join(sorted(dropped)[:6])
            more = f" 等 {len(dropped)} 处" if len(dropped) > 6 else ""
            warnings.append(f"已丢弃占位/未解析字段：{shown}{more}")

        records.append(
            UnitRecord(
                unit_id=config.get("name") or stem,
                faction=faction,
                variant=variant,
                suffixes=suffixes,
                source=str(path.relative_to(scripts_root)).replace("\\", "/"),
                config=config,
                warnings=warnings,
            )
        )

    records.sort(key=lambda r: (r.faction, r.variant, r.suffixes))
    return records, sorted(failures.items())
