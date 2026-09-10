"""Rivals —— 《命令与征服：宿敌》单位数据提取工具。"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["main", "__version__"]


def main() -> None:
    """pyproject 的 console_scripts 入口。"""
    from .cli import main as cli_main

    raise SystemExit(cli_main())
