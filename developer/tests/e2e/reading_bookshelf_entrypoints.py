#!/usr/bin/env python3
"""Run the bookshelf regression with Node Playwright's matching headless browser."""
from pathlib import Path
import subprocess


def main():
    script = Path(__file__).with_suffix(".node.js")
    return subprocess.run(["node", str(script)], check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
