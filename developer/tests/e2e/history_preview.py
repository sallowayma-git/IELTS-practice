#!/usr/bin/env python3
"""Screenshot the History page (route /history) from the dev build.

    python developer/tests/e2e/history_preview.py

Starts its own Vite dev server on port 4182 (strict), mocks the history Tauri
commands in the page with an init script (DEV only, test side, never shipped),
and captures into reports/:

    history-dev.png           60 records over 10 days, 1440x900, full content
    history-dev-1024.png      same data, 1024x768, full content
    history-dev-scrolled.png  same data, 1440x900, list scrolled (sticky toolbar)
    history-select-dev.png    selection mode with three rows picked
    history-empty-dev.png     no records at all (empty state)

The page is a fixed-height scroll region, so "full content" lifts that height
for the screenshot only; the app itself is not changed.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import APP, REPORTS, VITE_BIN, stop_process, wait_for_server
from history_mock_support import install_history_mock

PORT = 4182
ROUTE = "/#/history"
DAYS = 10
PER_DAY = 6

STATISTICS = {
    "count": 30,
    "latest": {
        "score": {"taskResponse": 7.0, "coherence": 6.5, "lexical": 7.5, "grammar": 6.5},
        "taskType": "task2",
        "submittedAt": "2026-10-12T08:30:00Z",
    },
    "average": {"taskResponse": 6.5, "coherence": 6.5, "lexical": 7.0, "grammar": 7.0},
}


def build_items() -> list[dict]:
    """60 records: 10 days (Oct 3-12), reading and writing interleaved, mixed scores."""
    items: list[dict] = []
    for day_index in range(DAYS):
        day = 3 + day_index
        for slot in range(PER_DAY):
            n = day_index * PER_DAY + slot
            hour = 8 + slot * 2
            stamp = f"2026-10-{day:02d}T{hour:02d}:{(n * 7) % 60:02d}:00.000Z"
            if slot % 2 == 0:
                ratio = round(0.45 + ((n * 37) % 50) / 100, 2)
                items.append({
                    "id": f"reading-{n:03d}",
                    "activity": "reading",
                    "title": f"Passage {1 + n % 3} · Urban transport {n:02d}",
                    "status": "completed",
                    "mode": "single",
                    "submittedAt": stamp,
                    "duration": 900 + n * 11,
                    "scoreValue": ratio,
                    "scoreScale": "ratio",
                    "scoreLabel": "Accuracy",
                    "scoreDisplay": f"{round(ratio * 100)}%",
                    "taskType": "reading",
                    "assetId": f"asset-{n % 3}",
                    "sessionId": f"session-{n:03d}",
                })
            else:
                band = 4.5 + ((n * 3) % 8) * 0.5
                task = "task1" if n % 4 == 1 else "task2"
                items.append({
                    "id": f"writing-{n:03d}",
                    "activity": "writing",
                    "title": f"{'Task 1' if task == 'task1' else 'Task 2'} · Prompt {n:02d}: "
                             f"{'Charts and trends' if task == 'task1' else 'Public policy essay'}",
                    "status": "completed",
                    "mode": "single",
                    "submittedAt": stamp,
                    "duration": 1800 + n * 13,
                    "scoreValue": band,
                    "scoreScale": "band9",
                    "scoreLabel": "Overall Band",
                    "scoreDisplay": f"{band:.1f}",
                    "taskType": task,
                })
    return items


def open_page(browser, base_url: str, items: list[dict], width: int, height: int, errors: list[str]):
    page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    install_history_mock(page, items, STATISTICS if items else {"count": 0})
    page.goto(f"{base_url}{ROUTE}", wait_until="networkidle", timeout=60_000)
    page.wait_for_selector(".history-page", timeout=30_000)
    page.evaluate("document.fonts.ready.then(() => true)")
    return page


def wait_for_list(page, expected: int) -> None:
    if expected:
        page.wait_for_function(
            "n => document.querySelectorAll('.history-page .history-row').length === n",
            arg=expected,
            timeout=30_000,
        )
    else:
        page.wait_for_selector(".history-page .empty-state", timeout=30_000)
    page.wait_for_timeout(300)


def expand_for_capture(page) -> None:
    """Lift the fixed-height scroll region so the screenshot shows all content."""
    page.add_style_tag(content=(
        ".workspace.history-workspace{height:auto !important;}"
        ".history-page{overflow:visible !important;}"
    ))
    page.wait_for_timeout(150)


def capture(base_url: str) -> list[str]:
    errors: list[str] = []
    items = build_items()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = open_page(browser, base_url, items, 1440, 900, errors)
            wait_for_list(page, 20)
            expand_for_capture(page)
            page.screenshot(path=str(REPORTS / "history-dev.png"), full_page=True)
            page.close()

            page = open_page(browser, base_url, items, 1440, 900, errors)
            wait_for_list(page, 20)
            page.evaluate("document.querySelector('.history-page').scrollTop = 620")
            page.wait_for_timeout(200)
            page.screenshot(path=str(REPORTS / "history-dev-scrolled.png"))
            page.close()

            page = open_page(browser, base_url, items, 1440, 900, errors)
            wait_for_list(page, 20)
            page.click("[data-history-toggle='selection']")
            rows = page.locator(".history-page .history-row")
            for index in (0, 2, 5):
                rows.nth(index).click()
            page.wait_for_selector(".history-page .history-selection")
            page.evaluate("document.querySelector('.history-page').scrollTop = 0")
            expand_for_capture(page)
            page.screenshot(path=str(REPORTS / "history-select-dev.png"), full_page=True)
            page.close()

            page = open_page(browser, base_url, items, 1024, 768, errors)
            wait_for_list(page, 20)
            expand_for_capture(page)
            page.screenshot(path=str(REPORTS / "history-dev-1024.png"), full_page=True)
            page.close()

            page = open_page(browser, base_url, [], 1440, 900, errors)
            wait_for_list(page, 0)
            page.screenshot(path=str(REPORTS / "history-empty-dev.png"))
            page.close()
        finally:
            browser.close()
    return errors


def main() -> int:
    node = shutil.which("node")
    if node is None or not VITE_BIN.is_file():
        print("node or apps/writing-vue/node_modules/vite is missing; run npm install first", file=sys.stderr)
        return 1
    REPORTS.mkdir(parents=True, exist_ok=True)
    base_url = f"http://127.0.0.1:{PORT}"
    process = None
    errors: list[str] = []
    try:
        with (REPORTS / "history-vite.log").open("wb") as log:
            process = subprocess.Popen(
                [node, str(VITE_BIN), "--host", "127.0.0.1", "--port", str(PORT), "--strictPort"],
                cwd=APP,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            wait_for_server(process, base_url)
            errors = capture(base_url)
    except (RuntimeError, OSError) as error:
        print(f"history preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    for line in errors:
        print(line, file=sys.stderr)
    for name in ("history-dev.png", "history-dev-1024.png", "history-dev-scrolled.png",
                 "history-select-dev.png", "history-empty-dev.png"):
        print(f"wrote {REPORTS / name}")
    print(json.dumps({"records": len(build_items())}))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
