#!/usr/bin/env python3
"""Screenshot the living design-system reference page (dev build only).

    python developer/tests/e2e/design_system_preview.py

Starts the Vite dev server for apps/writing-vue on a free port, opens
#/dev/design-system at 1440x900 in headless Chromium, writes a full-page PNG to
reports/design-system-current.png, then stops the server. The route is only
registered when import.meta.env.DEV is true, so this never runs against the
production bundle. The page needs no Tauri APIs, so a plain browser is enough.

Exit 1 when the server never answers, the page throws, or the reference
headings are missing.
"""
from __future__ import annotations

import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "writing-vue"
VITE_BIN = APP / "node_modules" / "vite" / "bin" / "vite.js"
REPORTS = Path(__file__).resolve().parent / "reports"
SHOT = REPORTS / "design-system-current.png"
ROUTE = "/#/dev/design-system"
VIEWPORT = {"width": 1440, "height": 900}
READY_TIMEOUT_S = 60


def free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def start_dev_server(port: int) -> subprocess.Popen:
    node = shutil.which("node")
    if node is None or not VITE_BIN.is_file():
        raise RuntimeError("node or apps/writing-vue/node_modules/vite is missing; run npm install first")
    REPORTS.mkdir(parents=True, exist_ok=True)
    log = (REPORTS / "design-system-vite.log").open("wb")
    return subprocess.Popen(
        [node, str(VITE_BIN), "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
        cwd=APP,
        stdout=log,
        stderr=subprocess.STDOUT,
    )


def wait_for_server(process: subprocess.Popen, base_url: str) -> None:
    deadline = time.monotonic() + READY_TIMEOUT_S
    last_error = "no answer"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"vite exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(base_url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError) as error:
            last_error = str(error)
        time.sleep(0.5)
    raise RuntimeError(f"vite dev server not ready after {READY_TIMEOUT_S}s: {last_error}")


def stop_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def capture(base_url: str) -> list[str]:
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            # Reduced motion skips the App route transition, which otherwise
            # sits at opacity 0 in headless Chromium and blanks the capture.
            page = browser.new_page(viewport=VIEWPORT, reduced_motion="reduce")
            page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
            page.on(
                "console",
                lambda message: errors.append(f"console.error: {message.text}")
                if message.type == "error" else None,
            )
            page.goto(base_url + ROUTE, wait_until="networkidle", timeout=60_000)
            page.wait_for_selector(".ds-page h1", timeout=30_000)
            page.evaluate("document.fonts.ready.then(() => true)")
            heading = page.locator(".ds-page h1").inner_text()
            if "Design system" not in heading:
                errors.append(f"unexpected h1: {heading!r}")
            page.screenshot(path=str(SHOT), full_page=True)
        finally:
            browser.close()
    return errors


def main() -> int:
    port = free_tcp_port()
    base_url = f"http://127.0.0.1:{port}"
    process: subprocess.Popen | None = None
    try:
        process = start_dev_server(port)
        wait_for_server(process, base_url)
        errors = capture(base_url)
    except (RuntimeError, OSError) as error:
        print(f"design-system preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    if errors:
        for line in errors:
            print(line, file=sys.stderr)
        return 1
    print(f"wrote {SHOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
