#!/usr/bin/env python3
"""Compatibility entry point for the packaged Tauri practice-flow gate."""
from __future__ import annotations

from packaged_tauri_flow import main as packaged_main
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
def main() -> int:
    return packaged_main()


if __name__ == "__main__":
    raise SystemExit(main())
