#!/usr/bin/env python3
"""Headless Playwright smoke test for index.html interactions."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Awaitable, Callable, Optional

from playwright.async_api import Browser, Dialog, Error as PlaywrightError, Page, async_playwright

# 该脚本位于 developer/tests/e2e/，因此需要向上三级才能回到仓库根目录
REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
E2E_RUNNER_PATH = REPO_ROOT / "developer" / "tests" / "e2e" / "app-e2e-runner.html"


CHECK_RESULTS = {"checks": [], "failed": 0, "passed": 0}
_AUTO_CLOSE_POPUPS = True


def _record_result(name: str, passed: bool, detail: str = "") -> None:
    CHECK_RESULTS["checks"].append({"name": name, "passed": passed, "detail": detail})
    CHECK_RESULTS["failed" if not passed else "passed"] += 1


def _assert_and_record(name: str, passed: bool, *, success: str = "", failure: str = "") -> None:
    detail = success if passed else failure or success
    _record_result(name, passed, detail)


def _summarize_results() -> None:
    print("[Index assertions] " + json.dumps(CHECK_RESULTS, ensure_ascii=False))
    if not CHECK_RESULTS["failed"]:
        return
    failing = [f"{item['name']}: {item.get('detail', '')}" for item in CHECK_RESULTS["checks"] if not item.get("passed")]
    raise AssertionError(
        f"Playwright index clickthrough 失败 {CHECK_RESULTS['failed']} 项\n" + "\n".join(failing)
    )


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


async def _close_popup_if_enabled(popup) -> None:
    if not _AUTO_CLOSE_POPUPS:
        return
    try:
        await popup.close()
    except PlaywrightError:
        pass


async def _click_navigation(page: Page, view: str) -> None:
    await page.locator(f"nav.main-nav button[data-view='{view}']").click()
    await page.wait_for_selector(f"#{view}-view.active", timeout=10000)


async def _open_practice_popup(page: Page, button, name: str) -> None:
    global _AUTO_CLOSE_POPUPS
    before_records = await page.evaluate(
        "async () => {"
        "  if (!window.PracticeRecordAPI?.list) return 0;"
        "  const records = await window.PracticeRecordAPI.list();"
        "  return Array.isArray(records) ? records.length : 0;"
        "}"
    )
    popup = None
    try:
        _AUTO_CLOSE_POPUPS = False
        async with page.expect_popup(timeout=1500) as popup_wait:
            await button.click()
        popup = await popup_wait.value
        await popup.wait_for_load_state("domcontentloaded")
        exam_id = await popup.evaluate("() => document.body?.dataset?.examId || null")
        _assert_and_record(
            f"{name}-popup",
            bool(exam_id),
            success=f"捕获弹窗 exam_id={exam_id}",
            failure=f"未找到 data-exam-id, exam_id={exam_id}",
        )

        records_after = await popup.evaluate(
            "async () => {"
            "  if (!window.PracticeRecordAPI?.list) return 0;"
            "  const records = await window.PracticeRecordAPI.list();"
            "  return Array.isArray(records) ? records.length : 0;"
            "}"
        )
        _assert_and_record(
            f"{name}-records",
            records_after > before_records,
            success=f"记录增长 {before_records}->{records_after}",
            failure=f"记录未新增 {before_records}->{records_after}",
        )
    except PlaywrightError as exc:
        _assert_and_record(f"{name}-popup", False, failure=f"未捕获弹窗: {exc}")
    finally:
        _AUTO_CLOSE_POPUPS = True
        if popup:
            await popup.close()


async def _get_backups(page: Page) -> list:
    backups = await page.evaluate(
        "() => (window.storage?.get && window.storage.get('manual_backups')) || []"
    )
    return backups if isinstance(backups, list) else []


async def _get_practice_stats(page: Page) -> dict:
    stats = await page.evaluate(
        "() => ({"
        "total: document.querySelector('#total-practiced')?.textContent?.trim() || '',"
        "avg: document.querySelector('#avg-score')?.textContent?.trim() || '',"
        "time: document.querySelector('#study-time')?.textContent?.trim() || '',"
        "streak: document.querySelector('#streak-days')?.textContent?.trim() || ''"
        "})"
    )
    return stats if isinstance(stats, dict) else {}


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
        await _open_practice_popup(page, btn, f"random-practice-{idx}")
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
        await _open_practice_popup(page, btn, f"exam-start-{idx}")


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


async def _close_library_loader(page: Page) -> None:
    overlay = page.locator("#library-loader-overlay")
    if not await overlay.count():
        _assert_and_record("library-overlay", True, success="未出现题库加载遮罩")
        status = await page.evaluate("() => window.app?.state?.library?.status || ''")
        _assert_and_record(
            "library-status",
            status == "loaded",
            success=f"题库状态: {status}",
            failure=f"题库未加载完成，状态: {status}",
        )
        return

    await overlay.wait_for(state="visible", timeout=5000)
    close_button = overlay.locator("[data-library-action='close']")
    if await close_button.count():
        await close_button.first.click()
        try:
            await page.wait_for_selector("#library-loader-overlay", state="detached", timeout=20000)
            _assert_and_record("library-overlay", True, success="题库加载遮罩已关闭")
        except PlaywrightError:
            _assert_and_record("library-overlay", False, failure="题库加载遮罩未消失")
        await asyncio.sleep(0.2)
    else:
        try:
            await page.wait_for_selector("#library-loader-overlay", state="detached", timeout=20000)
            _assert_and_record("library-overlay", True, success="题库加载遮罩已自动消失")
        except PlaywrightError:
            _assert_and_record("library-overlay", False, failure="题库加载遮罩未能关闭")

    status = await page.evaluate("() => window.app?.state?.library?.status || ''")
    _assert_and_record(
        "library-status",
        status == "loaded",
        success=f"题库状态: {status}",
        failure=f"题库未加载完成，状态: {status}",
    )


async def _handle_backup_overlays(page: Page) -> None:
    close_buttons = page.locator(".backup-modal-close")
    if await close_buttons.count():
        await close_buttons.first.click()
        await asyncio.sleep(0.2)


async def _exercise_settings(page: Page) -> None:
    await _click_navigation(page, "settings")
    await page.wait_for_selector("#settings-view.active", timeout=10000)

    initial_backups = await _get_backups(page)
    baseline_stats = await _get_practice_stats(page)
    backup_start = time.time()

    async def click_button(
        selector: str, *, expect_navigation: bool = False, handle: Optional[Callable[[Page], Awaitable[None]]] = None
    ) -> None:
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

    await click_button("#load-library-btn", handle=_close_library_loader)
    await click_button("#library-config-btn", handle=_handle_library_panel)
    await click_button("#force-refresh-btn")

    await click_button("#create-backup-btn")
    await asyncio.sleep(0.5)
    current_backups = await _get_backups(page)
    ts_values = []
    baseline_ts_values = []
    for item in current_backups:
        if isinstance(item, dict):
            try:
                ts_values.append(float(item.get("timestamp")))
            except (TypeError, ValueError):
                continue
    for item in initial_backups:
        if isinstance(item, dict):
            try:
                baseline_ts_values.append(float(item.get("timestamp")))
            except (TypeError, ValueError):
                continue
    _assert_and_record(
        "backup-count",
        len(current_backups) > len(initial_backups),
        success=f"备份数量 {len(initial_backups)}->{len(current_backups)}",
        failure=f"备份数量未增加 {len(initial_backups)}->{len(current_backups)}",
    )
    new_timestamp = max(ts_values or [0])
    baseline_timestamp = max(baseline_ts_values or [0])
    _assert_and_record(
        "backup-timestamp",
        isinstance(new_timestamp, (int, float)) and new_timestamp >= backup_start and new_timestamp >= baseline_timestamp,
        success=f"最新备份时间戳 {new_timestamp}",
        failure=f"备份时间戳异常 {new_timestamp}",
    )

    await click_button("#backup-list-btn", handle=_handle_backup_overlays)

    try:
        async with page.expect_download(timeout=5000) as download_info:
            await page.locator("#export-data-btn").click()
        download = await download_info.value
        _assert_and_record(
            "export-download",
            bool(download.suggested_filename),
            success=f"导出文件 {download.suggested_filename}",
            failure="未获取导出文件名",
        )
    except PlaywrightError as exc:
        _assert_and_record("export-download", False, failure=f"导出未触发下载: {exc}")

    # import triggers file chooser
    import_captured = False
    try:
        async with page.expect_file_chooser() as file_info:
            await page.locator("#import-data-btn").click()
        chooser = await file_info.value
        import_captured = True
        await chooser.set_files([])
    except PlaywrightError:
        pass
    _assert_and_record(
        "import-file-chooser",
        import_captured,
        success="捕获到文件选择事件",
        failure="未触发导入文件选择",
    )
    imported_stats = await _get_practice_stats(page)
    _assert_and_record(
        "import-stats",
        imported_stats == baseline_stats,
        success=f"导入后统计保持 {imported_stats}",
        failure=f"导入后统计被清空 {baseline_stats}->{imported_stats}",
    )
    await asyncio.sleep(0.3)

    # Theme modal interactions
    theme_modal_trigger = page.locator("button:has-text('🎨 主题切换')")
    await theme_modal_trigger.scroll_into_view_if_needed()
    await theme_modal_trigger.click()
    await page.wait_for_selector("#theme-switcher-modal.show", timeout=5000)

    await page.locator("#bloom-theme-btn").click()
    await asyncio.sleep(0.2)
    await page.locator("#blue-theme-btn").click()
    await asyncio.sleep(0.2)

    async def navigate_theme(button_selector: str) -> None:
        option = page.locator(button_selector)
        await option.scroll_into_view_if_needed()
        previous_url = page.url
        previous_theme = await page.evaluate("() => document.body?.dataset?.theme || ''")
        async with page.expect_navigation(wait_until="domcontentloaded"):
            await option.click()

        updated_theme = await page.evaluate("() => document.body?.dataset?.theme || ''")
        _assert_and_record(
            f"theme-change-{button_selector}",
            updated_theme != previous_theme or page.url != previous_url,
            success=f"主题切换到 {updated_theme}, url={page.url}",
            failure="主题或 URL 未变化",
        )

        await page.go_back(wait_until="domcontentloaded")
        await _ensure_app_ready(page)
        restored_theme = await page.evaluate("() => document.body?.dataset?.theme || ''")
        _assert_and_record(
            f"theme-restore-{button_selector}",
            restored_theme == previous_theme and page.url == previous_url,
            success=f"主题已恢复 {restored_theme}",
            failure=f"主题或 URL 未恢复，当前主题 {restored_theme}，URL {page.url}",
        )
        await _click_navigation(page, "settings")

        await theme_modal_trigger.scroll_into_view_if_needed()
        await theme_modal_trigger.click()
        await page.wait_for_selector("#theme-switcher-modal.show", timeout=5000)

    await navigate_theme(".theme-option:nth-of-type(1) button")
    await navigate_theme(".theme-option:nth-of-type(4) button")
    await navigate_theme(".theme-option:nth-of-type(5) button")
    await navigate_theme(".theme-option:nth-of-type(6) button")

    await page.locator(".theme-modal-close").click()
    await page.wait_for_selector("#theme-switcher-modal.show", state="detached")

    # Finally, clear cache (triggers reload)
    await click_button("#clear-cache-btn", expect_navigation=True)


async def _exercise_developer_links(page: Page) -> None:
    for selector in ["a:has-text('睡着过呈现')", "div#settings-view a:has-text('睡着过开发团队')"]:
        locator = page.locator(selector)
        if not await locator.count():
            continue

        first = locator.first
        if not await first.is_visible():
            continue

        await first.click()
        await page.wait_for_selector("#developer-modal.show", timeout=5000)
        await page.locator("#developer-modal .modal-close-btn").click()
        await page.wait_for_selector("#developer-modal.show", state="detached")
        await asyncio.sleep(0.2)


async def exercise_index_interactions(page: Page) -> None:
    await page.goto(INDEX_PATH.resolve().as_uri())
    await _ensure_app_ready(page)

    page.on("dialog", lambda dialog: asyncio.ensure_future(_accept_dialog(dialog)))
    page.on("popup", lambda popup: asyncio.ensure_future(_close_popup_if_enabled(popup)))

    await _exercise_developer_links(page)
    await _exercise_overview(page)
    await _exercise_browse(page)
    await _exercise_practice(page)
    await _exercise_settings(page)
    await _exercise_developer_links(page)


async def run_e2e_suite(page: Page) -> None:
    page.on("console", lambda msg: print(f"[E2E runner console] {msg.type.upper()}: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"[E2E runner error] {exc}"))
    await page.goto(E2E_RUNNER_PATH.resolve().as_uri())
    await page.wait_for_load_state("load")
    await page.wait_for_selector("#suite-status", timeout=60000)
    await page.wait_for_function("() => window.__E2E_TEST_RESULTS__", timeout=120000)
    results = await page.evaluate("window.__E2E_TEST_RESULTS__")
    if not results:
        raise RuntimeError("E2E harness 未返回任何结果")

    failed = int(results.get("failed") or 0)
    if failed:
        failing = []
        for item in results.get("results", []):
            if item and not item.get("passed"):
                detail = item.get("details")
                if isinstance(detail, dict):
                    detail = str(detail)
                failing.append(f"{item.get('name')}: {detail}")
        sample = "\n".join(failing[:5])
        raise AssertionError(f"E2E harness 失败 {failed} 项\n{sample}")


async def main() -> None:
    async with async_playwright() as p:
        browser: Browser = await p.chromium.launch()
        context = await browser.new_context()
        await context.add_init_script(
            "(() => { try { localStorage.removeItem('preferred_theme_portal'); sessionStorage.removeItem('preferred_theme_skip_session'); } catch (_) {} })();"
        )

        page = await context.new_page()
        await exercise_index_interactions(page)

        runner_page = await context.new_page()
        await run_e2e_suite(runner_page)

        _summarize_results()

        await context.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
