"""统计单位数据里出现的全部字段路径、类型与枚举候选值。

用途：
- core/ 的 TypeScript 类型定义依据
- 网页表格该展示哪些列、哪些字段是枚举可做下拉筛选

用法：
    .venv\\Scripts\\python.exe reference/field_inventory.py data
    .venv\\Scripts\\python.exe reference/field_inventory.py data --json > inventory.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

# 这些字段的值是桩产生的占位数字，不是真实数据，统计时单独标注
PLACEHOLDER_FIELDS = {"descriptors"}

# 值域很小、明显是枚举的判定阈值
ENUM_MAX_DISTINCT = 12


def merge_types(existing: str | None, new: str) -> str:
    """合并同一路径上出现的多种类型，例如 int|float。"""
    if existing is None:
        return new
    parts = set(existing.split("|")) | {new}
    return "|".join(sorted(parts))


def type_name(v) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    if v is None:
        return "null"
    return type(v).__name__


class Inventory:
    def __init__(self) -> None:
        self.types: dict[str, str] = {}
        self.count: Counter[str] = Counter()
        self.units: dict[str, set[str]] = defaultdict(set)
        self.values: dict[str, Counter] = defaultdict(Counter)
        # 数组长度按路径记录
        self.array_lens: dict[str, Counter] = defaultdict(Counter)
        # 记录路径的父路径，便于看出层级
        self.has_children: set[str] = set()

    def walk(self, node, path: str, unit_id: str) -> None:
        if isinstance(node, dict):
            if node and path:
                # 只有非空字典才算"有子字段"，否则自身就是叶子
                self.has_children.add(path)
            for k, v in node.items():
                child = f"{path}.{k}" if path else k
                self.walk(v, child, unit_id)
            return

        if isinstance(node, list):
            self.types[path] = merge_types(self.types.get(path), "array")
            self.count[path] += 1
            self.units[path].add(unit_id)
            self.array_lens[path][len(node)] += 1
            for item in node:
                self.walk(item, f"{path}[]", unit_id)
            return

        t = type_name(node)
        self.types[path] = merge_types(self.types.get(path), t)
        self.count[path] += 1
        self.units[path].add(unit_id)
        # 只对可做枚举的标量收集值域
        if t in ("str", "bool") or (t in ("int", "float") and float(node).is_integer()):
            self.values[path][node] += 1

    def scalar_paths(self) -> list[str]:
        """只保留叶子字段（排除同时有子字段的中间节点）。"""
        return sorted(p for p in self.types if p not in self.has_children)


def load_units(data_dir: Path, exclude_placeholders: bool = True) -> list[tuple[str, dict]]:
    """载入单位文件。

    默认排除 unit_example / unit_dlc_test —— 它们是开发占位文件，结构与其他
    单位不同（例如没有 name），会把覆盖率统计带偏。
    """
    units = []
    for sub in ("gdi", "nod", "misc"):
        for f in sorted((data_dir / sub).glob("unit_*.json")):
            if exclude_placeholders and f.stem in ("unit_example", "unit_dlc_test"):
                continue
            obj = json.loads(f.read_text(encoding="utf-8"))
            units.append((obj["unit_id"], obj))
    return units


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir", nargs="?", default="data")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    ap.add_argument(
        "--include-placeholders",
        action="store_true",
        help="也统计 unit_example / unit_dlc_test（会把覆盖率带偏）",
    )
    args = ap.parse_args()

    data_dir = Path(args.data_dir)
    units = load_units(data_dir, exclude_placeholders=not args.include_placeholders)
    if not units:
        print(f"错误：{data_dir} 下没有单位文件", file=sys.stderr)
        return 2

    inv = Inventory()
    for unit_id, obj in units:
        inv.walk(obj["config"], "", unit_id)

    leaves = inv.scalar_paths()
    total = len(units)

    if args.json:
        out = {
            "unit_count": total,
            "fields": [
                {
                    "path": p,
                    "types": inv.types[p],
                    "units": len(inv.units[p]),
                    "occurrences": inv.count[p],
                    "placeholder": p.split(".")[-1] in PLACEHOLDER_FIELDS,
                    "values": (
                        [{"value": v, "count": c} for v, c in inv.values[p].most_common()]
                        if len(inv.values[p]) <= ENUM_MAX_DISTINCT
                        else None
                    ),
                }
                for p in leaves
            ],
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0

    print(f"单位数: {total}")
    print(f"叶子字段数: {len(leaves)}\n")

    # ── 全部字段 ──
    print("=" * 100)
    print(f"{'字段路径':<58} {'类型':<12} {'覆盖':>8} {'出现':>6}")
    print("=" * 100)
    for p in leaves:
        cov = f"{len(inv.units[p])}/{total}"
        mark = " ⚠占位" if p.split(".")[-1] in PLACEHOLDER_FIELDS else ""
        print(f"{p:<58} {inv.types[p]:<12} {cov:>8} {inv.count[p]:>6}{mark}")

    # ── 数组字段长度 ──
    arrays = sorted(p for p in inv.array_lens if p not in inv.has_children or True)
    array_paths = sorted({p for p in inv.types if inv.types[p].endswith("array")})
    if array_paths:
        print("\n" + "=" * 100)
        print("数组字段（长度分布）")
        print("=" * 100)
        for p in array_paths:
            lens = inv.array_lens[p]
            desc = ", ".join(f"{n}个×{c}" for n, c in sorted(lens.items()))
            print(f"{p:<58} 覆盖 {len(inv.units[p])}/{total}   长度: {desc}")

    # ── 枚举候选 ──
    print("\n" + "=" * 100)
    print(f"枚举候选（值域 2..{ENUM_MAX_DISTINCT} 的标量字段；bool 与单值字段不算）")
    print("=" * 100)
    enum_count = 0
    for p in leaves:
        vals = inv.values[p]
        if not vals or len(vals) < 2 or len(vals) > ENUM_MAX_DISTINCT:
            continue
        if inv.types[p] == "bool":
            continue  # bool 不用列值
        enum_count += 1
        vs = ", ".join(f"{v!r}×{c}" for v, c in vals.most_common())
        print(f"\n{p}   [{inv.types[p]}]  覆盖 {len(inv.units[p])}/{total}")
        print(f"  {vs}")

    # ── 单值字段：不是枚举，但是有用的"常量"信息 ──
    print("\n" + "=" * 100)
    print("单值字段（只有一种取值，多为开关或固定写法）")
    print("=" * 100)
    singles = [p for p in leaves if len(inv.values[p]) == 1 and inv.types[p] != "bool"]
    for p in singles:
        v, c = inv.values[p].most_common(1)[0]
        print(f"  {p:<58} = {v!r}  ({len(inv.units[p])}/{total} 单位)")

    # ── 值域过大但值得注意的字符串字段 ──
    print("\n" + "=" * 100)
    print("字符串字段（值域大，多为标识符/本地化 key）")
    print("=" * 100)
    for p in leaves:
        if inv.types[p] != "str":
            continue
        vals = inv.values[p]
        if len(vals) <= ENUM_MAX_DISTINCT:
            continue
        samples = ", ".join(repr(v) for v, _ in vals.most_common(4))
        print(f"\n{p}   共 {len(vals)} 个不同值")
        print(f"  样例: {samples}")

    # ── 覆盖率分组 ──
    universal = sorted(p for p in leaves if len(inv.units[p]) == total)
    partial = sorted(p for p in leaves if len(inv.units[p]) < total)

    print("\n" + "=" * 100)
    print(f"全部 {total} 个单位都有的字段（{len(universal)} 个）—— 可做必填字段")
    print("=" * 100)
    for p in universal:
        print(f"  {p:<58} {inv.types[p]}")

    print("\n" + "=" * 100)
    print(f"仅部分单位有的字段（{len(partial)} 个）—— TS 类型应为可选")
    print("=" * 100)
    for p in partial:
        print(f"  {p:<58} {inv.types[p]:<12} {len(inv.units[p])}/{total}")

    print(f"\n小结: {len(leaves)} 个叶子字段 | {len(universal)} 个必填、{len(partial)} 个可选 | "
          f"{enum_count} 个枚举候选 | {len(array_paths)} 个数组字段")
    return 0


if __name__ == "__main__":
    sys.exit(main())
