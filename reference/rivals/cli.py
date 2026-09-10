"""rivals extract 命令行入口。

用法：
    rivals extract <输入目录> <输出目录>
"""

from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .extract import RivalsError, UnitRecord, find_scripts_root, load_units
from .json_out import dump_index, dump_unit, index_payload


def _write_one(record: UnitRecord, out_dir: Path) -> Path:
    # 非 GDI/NOD 的（unit_example、unit_dlc_test 等）归入 misc
    sub = out_dir / (record.faction.lower() if record.faction in ("GDI", "NOD") else "misc")
    sub.mkdir(parents=True, exist_ok=True)
    path = sub / f"{record.unit_id}.json"
    path.write_text(dump_unit(record), encoding="utf-8", newline="\n")
    return path


def run_extract(args: argparse.Namespace) -> int:
    in_dir = Path(args.input)
    if not in_dir.exists():
        print(f"错误：输入路径不存在：{in_dir}", file=sys.stderr)
        return 2

    try:
        scripts_root = find_scripts_root(in_dir)
    except RivalsError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"输入根目录 : {scripts_root}")
    print(f"输出目录   : {out_dir.resolve()}")

    try:
        records, failures = load_units(scripts_root, on_error="raise" if args.strict else "warn")
    except RivalsError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1

    if not records:
        print("错误：没有提取到任何单位", file=sys.stderr)
        return 1

    if args.jobs > 1:
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            paths = list(pool.map(lambda r: _write_one(r, out_dir), records))
    else:
        paths = [_write_one(r, out_dir) for r in records]

    (out_dir / "index.json").write_text(
        dump_index(records, scripts_root), encoding="utf-8", newline="\n"
    )

    warned = [r for r in records if r.warnings]
    print(f"\n单位       : {len(records)} 个")
    print(f"GDI / NOD  : {sum(r.faction == 'GDI' for r in records)} / "
          f"{sum(r.faction == 'NOD' for r in records)}")
    print(f"写出文件   : {len(paths)} 个 .json + index.json")
    print(f"带告警     : {len(warned)} 个")
    if failures:
        print(f"求值失败   : {len(failures)} 个")
        for stem, err in failures[:10]:
            print(f"  ! {stem}: {err[:120]}")

    print("\n-- 概览（按造价）--")
    print(f"{'单位':32s} {'阵营':4s} {'HP':>6} {'造价':>5} {'伤害':>6}")
    for row in index_payload(records, scripts_root)["units"][: args.limit]:
        name = row.get("unit_id", "?")
        print(
            f"{name:32s} {row.get('faction', '?'):4s} "
            f"{str(row.get('health', '-')):>6} {str(row.get('cost', '-')):>5} "
            f"{str(row.get('damage', '-')):>6}"
        )

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rivals",
        description="从《命令与征服：宿敌》数据目录提取单位数值并输出 JSON",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ex = sub.add_parser("extract", help="提取单位数据并写出 JSON")
    ex.add_argument("input", help="解包目录、包名目录、published/nfd/scripts 或 gameplay")
    ex.add_argument(
        "output",
        nargs="?",
        default="data",
        help="输出目录（默认 data/，该目录会入库）",
    )
    ex.add_argument("--jobs", type=int, default=1, help="写文件的并发数（默认 1）")
    ex.add_argument("--limit", type=int, default=12, help="终端概览显示的条数")
    ex.add_argument("--strict", action="store_true", help="任一单位求值失败即中止")
    ex.set_defaults(func=run_extract)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\n已中断", file=sys.stderr)
        return 130
