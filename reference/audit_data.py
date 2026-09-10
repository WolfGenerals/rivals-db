"""审计单位数据：哪些部分是噪音、占位或不可用。

回答一个问题：data/ 里哪些字段没有价值，或者会误用？

分六类统计（用 compact JSON 口径，避免缩进放大读数）：
  A 值恒为空        所有出现都是 {} / []，纯结构噪音
  B 多数有值少数空  可疑的空壳，值得核对
  C 纯呈现          VFX / 音效 / 动画，对数值面板无用
  D 占位值          位掩码桩，数字是编造的，不可用于计算
  E 恒定单值        所有单位取值相同，无区分信息
  F 单单位特例      只出现在 1 个单位，属于特例逻辑

用法：
    .venv\\Scripts\\python.exe reference\\audit_data.py data
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def dump(o) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def is_empty(v) -> bool:
    return (isinstance(v, dict) and not v) or (isinstance(v, list) and not v)


# 呈现类键名。实测当前数据里一个都没有 —— 游戏的 VFX/音效存在于别处，
# 单位调参里不含这些。留着以便将来上游变化时能被发现。
PRESENTATION = {
    "VFX", "vfx", "AUDIO", "audio", "ANIM", "anim", "visual", "VISUAL",
    "MATERIAL", "SOUND", "EMOTE", "ICON", "PORTRAIT", "ANIM_STATE", "animState",
    "MESH", "VOICE", "MUSIC", "VFX_SCALE", "animStates", "ANIM_STATES",
}

# 位掩码占位：宿主 C++ 定义，提取时用桩替换
PLACEHOLDER = {"descriptors", "DESCRIPTOR_FILTERS"}


class Audit:
    def __init__(self) -> None:
        self.present: dict[str, set[str]] = defaultdict(set)
        self.nonempty: dict[str, set[str]] = defaultdict(set)
        self.cbytes_nonempty: Counter[str] = Counter()
        self.cbytes_empty: Counter[str] = Counter()
        self.leaf_type: dict[str, str] = {}
        self.distinct: dict[str, set[str]] = defaultdict(set)

    def walk(self, node, path: str, unit: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                child = f"{path}.{k}" if path else k
                self.present[child].add(unit)
                if is_empty(v):
                    self.cbytes_empty[child] += len(dump(v).encode())
                else:
                    self.nonempty[child].add(unit)
                    self.cbytes_nonempty[child] += len(dump(v).encode())
                if isinstance(v, dict):
                    self.leaf_type.setdefault(child, "object" if v else "empty-object")
                    self.walk(v, child, unit)
                elif isinstance(v, list):
                    self.leaf_type.setdefault(child, "array" if v else "empty-array")
                    for item in v:
                        self.walk(item, f"{child}[]", unit)
                else:
                    self.leaf_type.setdefault(
                        child, "bool" if isinstance(v, bool) else type(v).__name__
                    )
                    self.distinct[child].add(dump(v))
        elif isinstance(node, list):
            for item in node:
                self.walk(item, path, unit)


def load(data_dir: Path) -> list[dict]:
    units = []
    for sub in ("gdi", "nod"):
        for f in sorted((data_dir / sub).glob("unit_*.json")):
            units.append(json.loads(f.read_text(encoding="utf-8")))
    return units


def main() -> int:
    data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    units = load(data_dir)
    if not units:
        print(f"错误：{data_dir} 下没有单位文件", file=sys.stderr)
        return 2
    N = len(units)

    a = Audit()
    for u in units:
        a.walk(u["config"], "", u["unit_id"])
    total = sum(len(dump(u["config"]).encode()) for u in units)

    print(f"单位数 {N} | config compact 总字节 {total} B ({total/1024:.1f} KiB)\n")

    def section(title: str, note: str) -> None:
        print("=" * 92)
        print(f"{title}   （{note}）")
        print("=" * 92)

    def subtotal(n: int) -> None:
        print(f"  小计 {n} B ({n/1024:.2f} KiB, {100*n/total:.1f}%)\n")

    # A
    section("A. 值恒为空（所有出现都是 {}/[]）", "纯结构噪音，可删")
    tot_a = 0
    for p in sorted((p for p in a.present if p not in a.nonempty), key=lambda p: -a.cbytes_empty[p]):
        tot_a += a.cbytes_empty[p]
        print(f"  {p:<60} {a.cbytes_empty[p]:>6} B  出现于 {len(a.present[p])}/{N}")
    subtotal(tot_a)

    # B
    section("B. 多数单位有值、少数是空壳", "空壳那几处值得核对")
    susp = [(p, len(a.nonempty[p]), len(a.present[p])) for p in a.present
            if 0 < len(a.nonempty[p]) < len(a.present[p])]
    susp.sort(key=lambda t: (t[1] / t[2], -t[2]))
    shown = 0
    for p, ne, pres_n in susp:
        if ne / pres_n > 0.5 or shown >= 12:
            continue
        shown += 1
        miss = sorted(a.present[p] - a.nonempty[p])
        tail = f" 等{len(miss)}个" if len(miss) > 3 else ""
        print(f"  {p:<54} 有值 {ne}/{pres_n}  空壳: {', '.join(miss[:3])}{tail}")
    if not shown:
        print("  （无异常）")
    print()

    # C
    section("C. 纯呈现字段（VFX / 音效 / 动画）", "对数值面板无用")
    pres = sorted((p for p in a.present if p.split(".")[-1].rstrip("[]") in PRESENTATION),
                  key=lambda p: -a.cbytes_nonempty[p])
    tot_c = 0
    for p in pres:
        tot_c += a.cbytes_nonempty[p]
        print(f"  {p:<60} {a.cbytes_nonempty[p]:>6} B  非空 {len(a.nonempty[p])}/{N}")
    if not pres:
        print("  （无 —— 单位调参里不含 VFX/音效，这类数据在别处）")
    subtotal(tot_c)

    # D
    section("D. 占位值（位掩码桩）", "数字是编造的，不可用于任何计算")
    tot_d = 0
    for p in sorted((p for p in a.present if p.split(".")[-1] in PLACEHOLDER),
                    key=lambda p: -a.cbytes_nonempty[p]):
        tot_d += a.cbytes_nonempty[p]
        print(f"  {p:<58} {a.cbytes_nonempty[p]:>5} B  非空 {len(a.nonempty[p])}/{N}  "
              f"{len(a.distinct[p])} 种值")
    subtotal(tot_d)

    # E
    section("E. 恒定单值（所有单位取值相同）", "无区分信息，不适合做筛选/展示列")
    tot_e = 0
    for p in sorted((p for p in a.nonempty if len(a.distinct[p]) == 1 and not p.endswith("[]")),
                    key=lambda p: -a.cbytes_nonempty[p]):
        tot_e += a.cbytes_nonempty[p]
        v = next(iter(a.distinct[p]))
        print(f"  {p:<58} {a.cbytes_nonempty[p]:>5} B  = {v[:20]:<22} 非空 {len(a.nonempty[p])}/{N}")
    subtotal(tot_e)

    # F
    section("F. 只出现在 1 个单位的字段", "特例逻辑，非通用数据")
    rare = sorted((p for p in a.nonempty if len(a.nonempty[p]) == 1),
                  key=lambda p: -a.cbytes_nonempty[p])
    tot_f = sum(a.cbytes_nonempty[p] for p in rare)
    print(f"  共 {len(rare)} 个字段，合计 {tot_f} B ({tot_f/1024:.2f} KiB, {100*tot_f/total:.1f}%)")
    for p in rare[:8]:
        print(f"    {p:<58} {a.cbytes_nonempty[p]:>6} B")
    print()

    section("汇总", "各类互有重叠，不可简单相加")
    for label, n in (("A 值恒为空", tot_a), ("C 纯呈现", tot_c), ("D 占位值", tot_d),
                     ("E 恒定单值", tot_e), ("F 单单位特例", tot_f)):
        print(f"  {label:<14} {n:>6} B  ({100*n/total:>4.1f}%)")
    print(f"  ── config 总计 {total:>6} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
