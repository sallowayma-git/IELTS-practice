"""One history page, every activity: tabs, filters, the one-sentence summary and
the actions that used to live in the reading-home 练习记录 tab (single/batch
delete via selection mode, scoped clear-all, markdown export) plus CSV export.

Tabs are data-driven: an activity appears only when records of it exist, so a
listening tab shows up on its own once listening records exist.
"""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

from history_mock_support import history_calls, install_history_mock, reading_item, writing_item


BASE_URL = os.environ.get("HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

LISTENING = {
    "id": "listening-0",
    "activity": "listening",
    "title": "Section 1 · Accommodation enquiry",
    "status": "completed",
    "mode": "single",
    "submittedAt": "2026-08-11T09:00:00.000Z",
    "durationMs": 1_800_000,
    "scoreValue": 31,
    "scoreScale": "raw40",
    "scoreLabel": "Raw score",
    "scoreDisplay": "31/40",
}


def items(with_listening=False):
    table = [
        reading_item(0, "Urban transport networks", 0.84),
        reading_item(1, "Memory and learning", 0.73, suiteId="suite-1"),
        reading_item(2, "The future of coral reefs", 0.61),
        writing_item(0, "Universities should focus on practical skills", 7.5, "task2"),
        writing_item(1, "The chart shows household spending", 6.5, "task1"),
    ]
    return table + ([LISTENING] if with_listening else [])


def state(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const score = document.querySelector('#history-min-score');
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            hash: location.hash,
            tabs: [...document.querySelectorAll('[data-history-tab]')].map((node) => node.textContent.trim()),
            selected: [...document.querySelectorAll('[data-history-tab][aria-selected="true"]')].map((node) => node.dataset.historyTab),
            kinds: [...document.querySelectorAll('[data-history-kind]')].map((node) => node.dataset.historyKind),
            kindPressed: [...document.querySelectorAll('[data-history-kind][aria-pressed="true"]')].map((node) => node.dataset.historyKind),
            rows: [...document.querySelectorAll('.history-row')].map((node) => node.dataset.historyId),
            scoreDisabled: score ? score.disabled : null,
            scoreLabel: document.querySelector('label[for="history-min-score"]')?.textContent.trim(),
            toolbarLinks: [...document.querySelectorAll('[data-history-toggle]')].map((node) => node.textContent.trim()),
            tabRects: [...document.querySelectorAll('[data-history-tab]')].map(rect),
            summary: document.querySelector('[data-history-summary]')?.textContent.trim(),
          };
        }
        """
    )


def open_filters(page):
    if page.locator("#history-filter-panel").count() == 0:
        page.locator("[data-history-toggle='filters']").click()
        page.wait_for_selector("#history-filter-panel")


def select_rows(page, *ids):
    if page.locator(".history-selection").count() == 0:
        page.locator("[data-history-toggle='selection']").click()
        page.wait_for_selector(".history-selection")
    for record_id in ids:
        page.locator(f"[data-history-id='{record_id}']").click()


def export_as(page, fmt):
    page.locator("[data-history-toggle='export']").click()
    page.locator(f"[data-history-export='{fmt}']").click()


def wait_rows(page, count):
    page.wait_for_function(
        "n => !document.querySelector('.history-page > .loading') && document.querySelectorAll('.history-row').length === n",
        arg=count,
    )


def click_tab(page, key):
    page.locator(f"[data-history-tab='{key}']").click()


def check_layout(name, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}: history page overflows the viewport")
    # Desktop/tablet 24px (WCAG 2.5.8); phone widths 44px touch target (segmented.css).
    min_target = 44 if width <= 640 else 24
    for rect in data["tabRects"]:
        if rect["height"] < min_target or rect["right"] > width + 1:
            raise AssertionError(f"{name}: activity tab is not a stable target: {rect}")


def confirm_delete_dialog(page, typed=None):
    page.wait_for_selector(".history-page .dialog .btn-danger")
    if typed:
        page.locator(".history-page .dialog .delete-confirm-input").fill(typed)
    page.locator(".history-page .dialog .btn-danger").click()
    page.wait_for_selector(".history-page .dialog", state="detached")


def run_case(browser, name, width, height, report):
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    install_history_mock(page, items())
    page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
    wait_rows(page, 5)
    page.wait_for_function("() => document.querySelectorAll('[data-history-tab]').length === 3")

    # ── 全部: mixed scales cannot share a score filter, no listening tab (no data) ──
    mixed = state(page)
    check_layout(f"{name}/all", mixed)
    if mixed["tabs"] != ["全部", "阅读", "写作"] or mixed["selected"] != ["all"]:
        raise AssertionError(f"{name}: tabs must list only activities with data: {mixed['tabs']}")
    if mixed["toolbarLinks"] != ["筛选", "选择", "导出"]:
        raise AssertionError(f"{name}: toolbar links changed: {mixed['toolbarLinks']}")
    if mixed["summary"] != "全部记录：阅读 3 篇，平均正确率 73%；写作 2 篇，平均 Band 7.0。":
        raise AssertionError(f"{name}: summary sentence: {mixed['summary']}")
    open_filters(page)
    mixed = state(page)
    if mixed["kinds"] or mixed["scoreDisabled"] is not True:
        raise AssertionError(f"{name}: 全部 must hide kinds and disable the score filter: {mixed}")

    # ── 阅读 ──
    click_tab(page, "reading")
    wait_rows(page, 3)
    reading = state(page)
    if reading["hash"] != "#/history?activity=reading" or reading["selected"] != ["reading"]:
        raise AssertionError(f"{name}: activity is not mirrored in the URL: {reading['hash']}")
    if reading["kinds"] or reading["scoreDisabled"] is not False or "阅读正确率" not in reading["scoreLabel"]:
        raise AssertionError(f"{name}: reading score filter contract: {reading}")
    if reading["summary"] != "全部记录：阅读 3 篇，平均正确率 73%。":
        raise AssertionError(f"{name}: a single-activity tab shows only its own clause: {reading['summary']}")
    select_rows(page)
    if page.locator("[data-history-clear-all]").inner_text().strip() != "清空阅读全部记录":
        raise AssertionError(f"{name}: clear action is not scoped to the tab")
    page.locator("[data-history-cancel]").click()
    page.screenshot(path=str(REPORT_DIR / f"history-activity-reading-{name}-current.png"), full_page=True)

    # ── 写作: Task 1 / Task 2 are kinds of writing ──
    click_tab(page, "writing")
    wait_rows(page, 2)
    open_filters(page)
    writing = state(page)
    if writing["kinds"] != ["all", "task1", "task2"] or "Band" not in writing["scoreLabel"]:
        raise AssertionError(f"{name}: writing kinds / score label: {writing}")
    page.locator("[data-history-kind='task1']").click()
    wait_rows(page, 1)
    if "kind=task1" not in state(page)["hash"]:
        raise AssertionError(f"{name}: the kind filter is not mirrored in the URL")
    kind_query = [call["query"] for call in history_calls(page, "list_history") if call["query"].get("limit") == 20][-1]
    if kind_query["taskType"] != "task1" or kind_query["activity"] != "writing":
        raise AssertionError(f"{name}: kind filter did not reach the query: {kind_query}")
    check_layout(f"{name}/writing", state(page))
    page.screenshot(path=str(REPORT_DIR / f"history-activity-writing-{name}-current.png"), full_page=True)

    # Leaving writing drops the kind and the Band filter state.
    click_tab(page, "all")
    wait_rows(page, 5)
    back = state(page)
    if back["kinds"] or back["scoreDisabled"] is not True or "activity" in back["hash"] or "kind" in back["hash"]:
        raise AssertionError(f"{name}: 全部 did not reset activity-specific filters: {back}")

    # ── Markdown export (respects the active tab) ──
    click_tab(page, "reading")
    wait_rows(page, 3)
    with page.expect_download() as download_info:
        export_as(page, "markdown")
    download = download_info.value
    if not re.match(r"ielts-history-reading-\d{4}-\d{2}-\d{2}\.md$", download.suggested_filename):
        raise AssertionError(f"{name}: markdown filename: {download.suggested_filename}")
    body = Path(download.path()).read_text(encoding="utf-8")
    if not body.startswith("# 练习记录（阅读）") or "Urban transport networks" not in body \
            or "- Session: session-0" not in body or "Universities should" in body:
        raise AssertionError(f"{name}: markdown export content: {body}")

    with page.expect_download() as download_info:
        export_as(page, "csv")
    if "reading" not in download_info.value.suggested_filename:
        raise AssertionError(f"{name}: csv filename is not scoped: {download_info.value.suggested_filename}")
    export_query = history_calls(page, "export_history")[-1]["cmd"]["query"]
    if export_query["activity"] != "reading":
        raise AssertionError(f"{name}: csv export ignored the active tab: {export_query}")

    # ── Single delete = select one + 删除 ──
    select_rows(page, "reading-2")
    page.locator("[data-history-delete]").click()
    confirm_delete_dialog(page)
    wait_rows(page, 2)
    if history_calls(page, "delete_history_attempts")[-1]["cmd"]["attemptIds"] != ["reading-2"]:
        raise AssertionError(f"{name}: single delete hit the wrong record")

    # ── Batch delete (selection mode is still on) ──
    select_rows(page, "reading-0", "reading-1")
    page.locator("[data-history-delete]").click()
    confirm_delete_dialog(page)
    page.wait_for_selector(".history-page .empty-state")
    if sorted(history_calls(page, "delete_history_attempts")[-1]["cmd"]["attemptIds"]) != ["reading-0", "reading-1"]:
        raise AssertionError(f"{name}: batch delete ids are wrong")
    if page.locator(".history-selection").count() != 0:
        raise AssertionError(f"{name}: selection mode must end when the list is empty")

    # ── Clear-all is scoped to the tab and needs the typed confirmation ──
    click_tab(page, "writing")
    wait_rows(page, 2)
    select_rows(page)
    page.locator("[data-history-clear-all]").click()
    page.wait_for_selector(".history-page .dialog")
    message = page.locator(".history-page .dialog p").inner_text()
    if "写作" not in message or "不受当前筛选影响" not in message:
        raise AssertionError(f"{name}: clear-all confirm does not state its scope: {message}")
    if not page.locator(".history-page .dialog .btn-danger").is_disabled():
        raise AssertionError(f"{name}: clear-all is enabled before the typed confirmation")
    confirm_delete_dialog(page, typed="确认删除")
    page.wait_for_selector(".history-page .empty-state")
    if history_calls(page, "clear_history")[-1]["cmd"]["activity"] != "writing":
        raise AssertionError(f"{name}: clear-all was not scoped to writing")
    empty = page.locator(".history-page .empty-state")
    if "还没有写作记录" not in empty.inner_text() or empty.locator("a[href='#/writing']").count() != 1:
        raise AssertionError(f"{name}: empty state does not name the cleared activity and link to practice")

    if errors:
        raise AssertionError(f"{name}: page errors: {errors}")
    report.append({"name": name, "mixed": mixed, "reading": reading, "writing": writing})
    page.close()


def run_listening(browser, report):
    page = browser.new_page(viewport={"width": 1024, "height": 768})
    install_history_mock(page, items(with_listening=True))
    page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
    page.wait_for_function("() => document.querySelectorAll('[data-history-tab]').length === 4")
    data = state(page)
    if data["tabs"] != ["全部", "阅读", "写作", "听力"]:
        raise AssertionError(f"listening tab did not appear from the data alone: {data['tabs']}")
    click_tab(page, "listening")
    wait_rows(page, 1)
    row = page.locator("[data-history-id='listening-0']")
    if "31/40" not in row.inner_text() or "听力" not in row.inner_text():
        raise AssertionError("listening row did not render through the generic adapter")
    if "听力 1 套" not in state(page)["summary"]:
        raise AssertionError("listening is not worded in the summary sentence")
    row.click()
    page.wait_for_selector(".history-page .page-notice.notice-error")
    page.close()
    report.append({"name": "listening", "tabs": data["tabs"]})


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                run_case(browser, name, width, height, report)
            run_listening(browser, report)
        finally:
            browser.close()
    (REPORT_DIR / "history-activity-tabs-visual-report.json").write_text(
        json.dumps({"status": "passed", "cases": report}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"status": "passed", "cases": [item["name"] for item in report]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
