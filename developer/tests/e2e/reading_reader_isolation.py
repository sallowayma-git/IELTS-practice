#!/usr/bin/env python3
"""Run the real-browser reader regression using the browser installed by E2E CI."""
import os
from pathlib import Path
import subprocess

from playwright.sync_api import sync_playwright


def main():
    env = os.environ.copy()
    if not env.get("PLAYWRIGHT_EXECUTABLE_PATH"):
        with sync_playwright() as playwright:
            env["PLAYWRIGHT_EXECUTABLE_PATH"] = playwright.chromium.executable_path
    script = Path(__file__).with_suffix(".node.js")
    return subprocess.run(["node", str(script)], env=env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
