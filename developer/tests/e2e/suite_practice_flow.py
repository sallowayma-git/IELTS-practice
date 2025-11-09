#!/usr/bin/env python3
"""Playwright flow that exercises suite practice mode and captures screenshots."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
import re
from typing import List

from playwright.async_api import (  # type: ignore[import-untyped]
    Browser,
    ConsoleMessage,
    Error as PlaywrightError,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = f"{INDEX_PATH.as_uri()}?test_env=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"


@dataclass
class ConsoleEntry:
    page_title: str
    type: str
    text: str


async def _ensure_app_ready(page: Page) -> None:
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && window.storage && typeof window.storage.get === 'function'",
        timeout=60000,
    )


async def _click_nav(page: Page, view: str) -> None:
    await page.locator(f"nav button[data-view='{view}']").click()
    await page.wait_for_selector(f"#{view}-view.active", timeout=15000)


async def _dismiss_overlays(page: Page) -> None:
    # Close optional overlays to avoid blocking clicks.
    overlay = page.locator("#library-loader-overlay")
    if await overlay.count():
        try:
            await overlay.wait_for(state="visible", timeout=2000)
            close_btn = overlay.locator("[data-library-action='close']")
            if await close_btn.count():
                await close_btn.first.click()
                await overlay.wait_for(state="detached", timeout=5000)
        except Exception:
            pass

    backup_modal = page.locator(".backup-modal-close")
    if await backup_modal.count():
        try:
            await backup_modal.first.click()
        except Exception:
            pass


async def _complete_passage(suite_page: Page, total_count: int, index: int) -> bool:
    if suite_page.is_closed():
        return False

    await suite_page.wait_for_load_state("load")
    await suite_page.wait_for_selector("#complete-exam-btn", timeout=20000)
    await suite_page.wait_for_function(
        "() => document.getElementById('complete-exam-btn') && !document.getElementById('complete-exam-btn').disabled",
        timeout=20000,
    )
    current_exam_id = await suite_page.evaluate("() => document.body.dataset.examId || ''")
    await suite_page.click("#complete-exam-btn")
    await suite_page.wait_for_function(
        "() => document.getElementById('complete-exam-btn') && document.getElementById('complete-exam-btn').disabled",
        timeout=20000,
    )
    if index + 1 < total_count:
        try:
            await suite_page.wait_for_function(
                "(initialId) => (document.body.dataset.examId || '') !== initialId",
                arg=current_exam_id,
                timeout=30000,
            )
        except PlaywrightTimeoutError:
            if suite_page.is_closed():
                return False
            raise

        await suite_page.wait_for_function(
            "() => document.getElementById('complete-exam-btn') && document.getElementById('complete-exam-btn').disabled",
            timeout=15000,
        )
        await suite_page.wait_for_function(
            "() => document.getElementById('complete-exam-btn') && !document.getElementById('complete-exam-btn').disabled",
            timeout=20000,
        )

    return True


def _collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    def _handler(msg: ConsoleMessage) -> None:
        store.append(ConsoleEntry(page_title=page.url, type=msg.type, text=msg.text))

    page.on("console", _handler)


async def run() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    console_log: List[ConsoleEntry] = []

    try:
        async with async_playwright() as p:
            browser: Browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()

            context.on("page", lambda pg: _collect_console(pg, console_log))

            page = await context.new_page()
            await page.goto(INDEX_URL)
            await _ensure_app_ready(page)
            await _dismiss_overlays(page)

            await _click_nav(page, "overview")
            start_button = page.locator("button[data-action='start-suite-mode']")
            await start_button.scroll_into_view_if_needed()

            async with page.expect_popup() as popup_wait:
                await start_button.click()
            suite_page = await popup_wait.value
            _collect_console(suite_page, console_log)

            for idx in range(3):
                try:
                    should_continue = await _complete_passage(suite_page, 3, idx)
                except (PlaywrightTimeoutError, PlaywrightError):
                    if suite_page.is_closed():
                        break
                    raise
                if not should_continue:
                    break

            if not suite_page.is_closed():
                try:
                    await suite_page.wait_for_timeout(1000)
                    await suite_page.close()
                except Exception:
                    pass

            await _click_nav(page, "practice")
            await page.wait_for_timeout(2000)
            await page.wait_for_function(
                "() => window.app && window.app.state && window.app.state.practice &&\n"
                "  Array.isArray(window.app.state.practice.records) && window.app.state.practice.records.length > 0",
                timeout=30000,
            )

            await page.evaluate(
                "if (typeof window.updatePracticeView === 'function') { window.updatePracticeView(); }"
            )

            await page.wait_for_timeout(500)

            await page.wait_for_selector("#history-list .history-record-item", timeout=20000)

            suite_record = page.locator(
                "#history-list .history-record-item[data-record-id^='suite_']"
            )
            target_record = suite_record.first
            await target_record.wait_for(state="visible", timeout=5000)

            record_id = await target_record.get_attribute("data-record-id")
            if not record_id:
                raise AssertionError("Suite practice record not found in history list")

            title_text = await page.evaluate(
                "(id) => {\n"
                "  const base = '#history-list .history-record-item[data-record-id=\\'' + id + '\\']';\n"
                "  const titleEl = document.querySelector(base + ' .record-title')\n"
                "    || document.querySelector(base + ' .practice-record-title');\n"
                "  return titleEl ? titleEl.textContent.trim() : null;\n"
                "}",
                record_id,
            )
            if not title_text:
                raise AssertionError("Suite practice record title element missing")
            if not re.match(r"^\d{2}月\d{2}日套题练习\d+$", title_text):
                raise AssertionError(f"Unexpected suite record title: {title_text}")

            list_path = REPORT_DIR / "suite-practice-record-list.png"
            await page.locator("#practice-view").screenshot(path=str(list_path))

            await page.evaluate(
                "(id) => {\n"
                "  if (window.app?.components?.practiceHistory?.showRecordDetails) {\n"
                "    window.app.components.practiceHistory.showRecordDetails(id);\n"
                "    return;\n"
                "  }\n"
                "  if (window.practiceHistoryEnhancer?.showRecordDetails) {\n"
                "    window.practiceHistoryEnhancer.showRecordDetails(id);\n"
                "    return;\n"
                "  }\n"
                "  const selector = '#history-list .history-record-item[data-record-id=\"' + id + '\"] button[data-history-action=\"details\"]';\n"
                "  const button = document.querySelector(selector);\n"
                "  if (button) { button.click(); }\n"
                "}",
                record_id,
            )
            await page.wait_for_selector("#practice-record-modal.modal-overlay.show", timeout=15000)

            detail_path = REPORT_DIR / "suite-practice-record-detail.png"
            await page.locator("#practice-record-modal .modal-container").screenshot(path=str(detail_path))

            await browser.close()
    finally:
        if console_log:
            print("Captured console messages:")
            for entry in console_log:
                print(f"[{entry.type.upper()}] {entry.page_title}: {entry.text}")
        else:
            print("No console messages captured.")


if __name__ == "__main__":
    asyncio.run(run())
