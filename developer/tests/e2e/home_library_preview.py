#!/usr/bin/env python3
"""Screenshot the Library home (route /) from the dev build, plus button metrics.

    python developer/tests/e2e/home_library_preview.py

Starts the Vite dev server (same helpers as design_system_preview.py), mocks the
reading-library Tauri commands in the page with an init script (DEV only, test
side, never shipped), and captures:

    reports/home-overview-dev.png   overview, 1440x900
    reports/home-browse-dev.png     browse view, 1440x900
    reports/home-overview-1024.png  overview, 1024x768

It also prints the computed heights of every button on the overview so a row of
mixed-size buttons shows up as a number, not a guess.
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import (
    REPORTS,
    free_tcp_port,
    start_dev_server,
    stop_process,
    wait_for_server,
)
from reading_suite_selector_visual_check import ASSETS, install_tauri_mock

# Repeat the three fixture passages so the browse list is long enough to scroll.
ROWS = [
    {**ASSETS[i % len(ASSETS)], "id": f"{ASSETS[i % len(ASSETS)]['id']}-{i:02d}",
     "title": f"{ASSETS[i % len(ASSETS)]['title']} · {i + 1:02d}"}
    for i in range(40)
]

CAPTURES = (
    ("home-overview-dev.png", 1440, 900, "overview"),
    ("home-browse-dev.png", 1440, 900, "browse"),
    ("home-overview-1024.png", 1024, 768, "overview"),
)

BUTTON_METRICS = """
() => [...document.querySelectorAll('[data-practice-reading-home] .view.active button, [data-practice-reading-home] .page-header-actions button')]
  .map((node) => ({
    text: node.textContent.trim().slice(0, 12),
    classes: node.className,
    height: Math.round(node.getBoundingClientRect().height),
  }))
"""


def capture(base_url: str) -> tuple[list[str], dict]:
    errors: list[str] = []
    metrics: dict = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for filename, width, height, view in CAPTURES:
                page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
                page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
                install_tauri_mock(page, ROWS)
                page.goto(f"{base_url}/#/?view={view}", wait_until="networkidle", timeout=60_000)
                page.wait_for_selector("[data-practice-reading-home][data-library-ready]", timeout=30_000)
                page.evaluate("document.fonts.ready.then(() => true)")
                page.wait_for_timeout(300)
                if view == "overview":
                    metrics[f"{width}x{height}"] = page.evaluate(BUTTON_METRICS)
                page.screenshot(path=str(REPORTS / filename), full_page=True)
                page.close()
        finally:
            browser.close()
    return errors, metrics


def main() -> int:
    port = free_tcp_port()
    base_url = f"http://127.0.0.1:{port}"
    process = None
    try:
        process = start_dev_server(port)
        wait_for_server(process, base_url)
        errors, metrics = capture(base_url)
    except (RuntimeError, OSError) as error:
        print(f"home library preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    for line in errors:
        print(line, file=sys.stderr)
    for filename, *_ in CAPTURES:
        print(f"wrote {REPORTS / filename}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
