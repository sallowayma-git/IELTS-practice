#!/usr/bin/env python3
"""Run TXT/release qualification; forward --root/--label/--reports to Playwright."""
from pathlib import Path
import subprocess
import sys


def main():
    return subprocess.run(
        ["node", str(Path(__file__).with_suffix(".node.js")), *sys.argv[1:]],
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
