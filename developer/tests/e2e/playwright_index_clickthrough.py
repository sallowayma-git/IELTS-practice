#!/usr/bin/env python3
"""Headless Playwright smoke test for index.html interactions."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Awaitable, Callable, Optional

from playwright.async_api import Browser, Dialog, Error as PlaywrightError, Page, async_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
INDEX_PATH = REPO_ROOT / "index.html"
E2E_RUNNER_PATH = REPO_ROOT / "developer" / "tests" / "e2e" / "app-e2e-runner.html"


async def _ensure_app_ready(page: Page) -> None:
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && window.storage && typeof window.storage.get === 'function'",
        timeout=60000,
    )


async def _accept_dialog(dialog: Dialog) -> None:
    try:
        await dialog.accept()
    except PlaywrightError:
        # Dialog might auto-dismiss; ignore.
        pass


async def _click_navigation(page: Page, view: str) -> None:
    await page.locator(f"nav.main-nav button[data-view='{view}']").click()
    await page.wait_for_selector(f"#{view}-view.active", timeout=10000)


async def _exercise_overview(page: Page) -> None:
    await _click_navigation(page, "overview")
    category_browse = page.locator("#category-overview button[data-action='browse-category']")
    browse_count = await category_browse.count()
    for idx in range(browse_count):
        await category_browse.nth(idx).scroll_into_view_if_needed()
        await category_browse.nth(idx).click()
        await page.wait_for_selector("#browse-view.active", timeout=10000)
        await asyncio.sleep(0.2)
        await _click_navigation(page, "overview")

    category_random = page.locator("#category-overview button[data-action='start-random-practice']")
    random_count = await category_random.count()
    for idx in range(random_count):
        btn = category_random.nth(idx)
        await btn.scroll_into_view_if_needed()
        try:
            async with page.expect_popup(timeout=1500) as popup_wait:
                await btn.click()
            popup = await popup_wait.value
            await popup.close()
        except PlaywrightError:
            # Some categories may not spawn popups (e.g., missing HTML); continue.
            pass
        await asyncio.sleep(0.2)


async def _exercise_browse(page: Page) -> None:
    await _click_navigation(page, "browse")
    await page.wait_for_selector("#browse-view.active", timeout=10000)
    await page.wait_for_timeout(500)

    filter_buttons = page.locator("#type-filter-buttons button")
    for idx in range(await filter_buttons.count()):
        btn = filter_buttons.nth(idx)
        await btn.scroll_into_view_if_needed()
        await btn.click()
        await asyncio.sleep(0.2)

    # Exercise first few exam action buttons if available
    exam_actions = page.locator("#exam-list-container button")
    max_actions = min(3, await exam_actions.count())
    for idx in range(max_actions):
        btn = exam_actions.nth(idx)
        await btn.scroll_into_view_if_needed()
        try:
            async with page.expect_popup(timeout=1500) as popup_wait:
                await btn.click()
            popup = await popup_wait.value
            await popup.close()
        except PlaywrightError:
            await asyncio.sleep(0.2)


async def _exercise_practice(page: Page) -> None:
    await _click_navigation(page, "practice")
    await page.wait_for_selector("#practice-view.active", timeout=10000)

    record_filters = page.locator("#record-type-filter-buttons button")
    for idx in range(await record_filters.count()):
        btn = record_filters.nth(idx)
        await btn.scroll_into_view_if_needed()
        await btn.click()
        await asyncio.sleep(0.2)

    await page.locator("#bulk-delete-btn").click()
    await asyncio.sleep(0.2)
    await page.locator("#bulk-delete-btn").click()
    await asyncio.sleep(0.2)

    await page.locator("button:has-text('📄 导出Markdown')").click()
    await asyncio.sleep(0.2)

    await page.locator("button:has-text('🗑️ 清除记录')").click()
    await asyncio.sleep(0.5)


async def _handle_library_panel(page: Page) -> None:
    panel_close = page.locator(".library-config-panel__close")
    if await panel_close.count():
        await panel_close.first.click()
        await asyncio.sleep(0.2)


async def _handle_backup_overlays(page: Page) -> None:
    close_buttons = page.locator(".backup-modal-close")
    if await close_buttons.count():
        await close_buttons.first.click()
        await asyncio.sleep(0.2)


async def _exercise_settings(page: Page) -> None:
    await _click_navigation(page, "settings")
    await page.wait_for_selector("#settings-view.active", timeout=10000)

    async def click_button(selector: str, *, expect_navigation: bool = False, handle: Optional[Callable[[Page], Awaitable[None]]] = None) -> None:
        if expect_navigation:
            async with page.expect_navigation(wait_until="load"):
                await page.locator(selector).click()
            await _ensure_app_ready(page)
            await _click_navigation(page, "settings")
            return
        await page.locator(selector).click()
        await asyncio.sleep(0.3)
        if handle:
            await handle(page)

    await click_button("#load-library-btn")
    await click_button("#library-config-btn", handle=_handle_library_panel)
    await click_button("#force-refresh-btn")
    await click_button("#create-backup-btn")
    await click_button("#backup-list-btn", handle=_handle_backup_overlays)
    await click_button("#export-data-btn")

    # import triggers file chooser
    file_task = asyncio.create_task(page.expect_file_chooser())
    await page.locator("#import-data-btn").click()
    try:
        chooser = await file_task
        await chooser.cancel()
    except PlaywrightError:
        pass
    await asyncio.sleep(0.3)

    # Theme modal interactions
    await page.locator("button:has-text('🎨 主题切换')").click()
    await page.wait_for_selector("#theme-switcher-modal.show", timeout=5000)

    await page.locator("#bloom-theme-btn").click()
    await asyncio.sleep(0.2)
    await page.locator("#blue-theme-btn").click()
    await asyncio.sleep(0.2)

    async def navigate_theme(button_selector: str) -> None:
        async with page.expect_navigation(wait_until="load"):
            await page.locator(button_selector).click()
        await page.go_back()
        await _ensure_app_ready(page)
        await _click_navigation(page, "settings")
        await page.locator("button:has-text('🎨 主题切换')").click()
        await page.wait_for_selector("#theme-switcher-modal.show", timeout=5000)

    await navigate_theme(".theme-option:nth-of-type(1) button")
    await navigate_theme(".theme-option:nth-of-type(4) button")
    await navigate_theme(".theme-option:nth-of-type(5) button")

    await page.locator(".theme-modal-close").click()
    await page.wait_for_selector("#theme-switcher-modal.show", state="detached")

    # Finally, clear cache (triggers reload)
    await click_button("#clear-cache-btn", expect_navigation=True)


async def _exercise_developer_links(page: Page) -> None:
    for selector in ["a:has-text('睡着过呈现')", "div#settings-view a:has-text('睡着过开发团队')"]:
        if await page.locator(selector).count():
            await page.locator(selector).click()
            await page.wait_for_selector("#developer-modal.show", timeout=5000)
            await page.locator("#developer-modal .modal-close-btn").click()
            await page.wait_for_selector("#developer-modal.show", state="detached")
            await asyncio.sleep(0.2)


async def exercise_index_interactions(page: Page) -> None:
    await page.goto(INDEX_PATH.resolve().as_uri())
    await _ensure_app_ready(page)

    page.on("dialog", lambda dialog: asyncio.ensure_future(_accept_dialog(dialog)))
    page.on("popup", lambda popup: asyncio.ensure_future(popup.close()))

    await _exercise_developer_links(page)
    await _exercise_overview(page)
    await _exercise_browse(page)
    await _exercise_practice(page)
    await _exercise_settings(page)
    await _exercise_developer_links(page)


async def run_e2e_suite(page: Page) -> None:
    await page.goto(E2E_RUNNER_PATH.resolve().as_uri())
    await page.wait_for_load_state("load")
    await page.wait_for_event("load")
    await page.wait_for_selector("#suite-status", timeout=60000)
    await page.wait_for_function(
        "() => window.__E2E_TEST_RESULTS__ && window.__E2E_TEST_RESULTS__.failed === 0",
        timeout=120000,
    )


async def main() -> None:
    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch()
        context = await browser.new_context()

        page = await context.new_page()
        await exercise_index_interactions(page)

        runner_page = await context.new_page()
        await run_e2e_suite(runner_page)

        await context.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
