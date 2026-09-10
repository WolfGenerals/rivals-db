"""把提取结果序列化成 JSON。"""

from __future__ import annotations

import json
from pathlib import Path

from .extract import UnitRecord

# JSON 没有注释，所以把注意事项写进文件本身，避免脱离文档后误用
FILE_NOTE = (
    "combatantTuning.descriptors / weaponTunings[].descriptors 是位掩码占位值"
    "（枚举定义在宿主 C++ 中，Lua 源码里没有），不要当作真实数值使用。"
    "tags / goodAgainstTags 是枚举名字符串，语义正确。"
)


def _pick(config: dict, *path: str):
    """按路径取值，容忍中途缺失。"""
    cur = config
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _summary(record: UnitRecord) -> dict:
    """给 index.json 用的扁平概览。"""
    cfg = record.config
    weapons = _pick(cfg, "combatantTuning", "weaponTunings") or []
    first = weapons[0] if isinstance(weapons, list) and weapons else {}
    damage = _pick(first, "damageTuning", "default") if isinstance(first, dict) else None
    overrides = _pick(first, "damageTuning", "overrides") if isinstance(first, dict) else None

    out: dict = {
        "unit_id": record.unit_id,
        "faction": record.faction,
        "variant": record.variant,
    }
    if record.suffixes:
        out["suffixes"] = record.suffixes
    for key, value in (
        ("health", _pick(cfg, "combatantTuning", "health")),
        ("speed", _pick(cfg, "combatantTuning", "speed")),
        ("cost", _pick(cfg, "combatStoreTuning", "tiberiumCost")),
        ("damage", damage),
        ("damage_overrides", overrides),
        ("range", _pick(first, "maxRangeInTiles") if isinstance(first, dict) else None),
        ("cooldown", _pick(first, "burstTiming", "cooldown") if isinstance(first, dict) else None),
        ("weapon_count", len(weapons) if isinstance(weapons, list) else None),
        ("tags", _pick(cfg, "combatantTuning", "tags")),
        ("good_against", _pick(cfg, "combatantTuning", "goodAgainstTags")),
        ("wave_size", _pick(cfg, "squadTuning", "waveSize")),
        ("vision_range", _pick(cfg, "squadTuning", "visionRangeInTiles")),
    ):
        if value is not None:
            out[key] = value
    return out


def payload_for(record: UnitRecord) -> dict:
    """单个单位的输出载荷（未经 json.dumps）。"""
    out: dict = {
        "_note": FILE_NOTE,
        "unit_id": record.unit_id,
        "faction": record.faction,
        "variant": record.variant,
    }
    if record.suffixes:
        out["suffixes"] = record.suffixes
    out["source"] = record.source
    if record.warnings:
        out["warnings"] = record.warnings
    out["config"] = record.config
    return out


def dump_unit(record: UnitRecord) -> str:
    """单个单位的 JSON 文本。

    indent=2 便于人读与 diff；sort_keys 让字段顺序稳定（数值表没有固有序，
    源文件顺序在 Python 字典里不保证跨版本一致）。
    """
    return json.dumps(payload_for(record), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def index_payload(records: list[UnitRecord], scripts_root: Path) -> dict:
    """汇总索引，按造价升序（与游戏内商店顺序一致）。

    不写入本机绝对路径 —— 各单位的 `source` 已是相对脚本根的路径，
    下游无需知道这份数据是在哪台机器上提取的。
    """
    rows = [_summary(r) for r in records]
    rows.sort(key=lambda r: (r.get("cost") is None, r.get("cost") or 0, r["unit_id"]))
    out: dict = {
        "_note": FILE_NOTE,
        "unit_count": len(records),
        "gdi_count": sum(r.faction == "GDI" for r in records),
        "nod_count": sum(r.faction == "NOD" for r in records),
    }
    misc = sum(r.faction not in ("GDI", "NOD") for r in records)
    if misc:
        out["misc_count"] = misc
    out["units"] = rows
    return out


def dump_index(records: list[UnitRecord], scripts_root: Path) -> str:
    return json.dumps(index_payload(records, scripts_root), indent=2, ensure_ascii=False) + "\n"
