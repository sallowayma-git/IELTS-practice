#!/usr/bin/env python3
"""Validate highlight CSS avoids forced English word splitting."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
TARGET_FILES = [
    ROOT / "assets" / "generated" / "reading-exams" / "reading-practice-unified.html",
    ROOT / "templates" / "template_base.html",
]


def find_hl_block(text: str) -> str | None:
    match = re.search(r"(?m)^\s*\.hl\s*\{(?P<body>.*?)^\s*\}", text, flags=re.S)
    if not match:
        return None
    return match.group("body")


def has_rule(block: str, prop: str, value: str) -> bool:
    pattern = rf"{re.escape(prop)}\s*:\s*{re.escape(value)}\s*;"
    return re.search(pattern, block, flags=re.I) is not None


def main() -> int:
    failures: list[str] = []
    for path in TARGET_FILES:
        if not path.exists():
            failures.append(f"missing_file:{path}")
            continue

        text = path.read_text(encoding="utf-8")
        block = find_hl_block(text)
        if block is None:
            failures.append(f"missing_hl_block:{path}")
            continue

        required = (
            ("word-break", "normal"),
            ("overflow-wrap", "normal"),
            ("white-space", "normal"),
        )
        for prop, value in required:
            if not has_rule(block, prop, value):
                failures.append(f"missing_rule:{path}:{prop}:{value}")

        if has_rule(block, "word-break", "break-all"):
            failures.append(f"forbidden_rule:{path}:word-break:break-all")

    if failures:
        print("FAIL")
        for item in failures:
            print(item)
        return 1

    print("PASS: highlight css keeps normal word boundaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
