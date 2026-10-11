"""History record -> detail routing.

There is one history page for every activity; opening a record always goes to
the record's own `detailRoute` (writing -> Result, reading -> review).  A
writing record opened from /history shows "← 返回历史" on the Result page, keeps
历史 lit in the nav, and returns to the same tab / filters.  The Result view has
its own visual check (writing_result_visual_check.py).
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)


HISTORY_ITEM = {
    "id": "writing-history-1",
    "activity": "writing",
    "title": "Some people believe universities should focus on practical skills",
    "status": "completed",
    "mode": "single",
    "submittedAt": "2026-08-07T08:30:00Z",
    "durationMs": 2_340_000,
    "scoreValue": 7.5,
    "scoreScale": "band9",
    "scoreLabel": "Overall Band",
    "scoreDisplay": "7.5",
    "taskType": "task2",
}

READING_ITEM = {
    "id": "reading-history-1",
    "activity": "reading",
    "title": "Urban transport networks",
    "status": "completed",
    "mode": "suite",
    "submittedAt": "2026-08-06T08:30:00Z",
    "durationMs": 1_140_000,
    "scoreValue": 0.82,
    "scoreScale": "ratio",
    "scoreLabel": "Accuracy",
    "scoreDisplay": "82%",
    "assetId": "asset-urban",
    "sessionId": "session-urban",
    "suiteId": "suite-9",
}

ORPHAN_READING_ITEM = {
    **READING_ITEM,
    "id": "reading-history-orphan",
    "title": "Reading record without review identifiers",
    "assetId": None,
    "sessionId": None,
    "suiteId": None,
    "submittedAt": "2026-08-05T08:30:00Z",
}


def install_tauri_mock(page, items=None):
    items = [HISTORY_ITEM] if items is None else items
    script = r"""
    (() => {
      const items = __ITEMS__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const invoke = async (command, args = {}) => {
        if (command === 'list_history') {
          const query = args.query || {};
          const visible = query.activity ? items.filter((item) => item.activity === query.activity) : items;
          const limit = Number(query.limit || 20);
          return { ok: true, data: { items: visible.slice(0, limit), total: visible.length, limit, offset: 0, nextCursor: null } };
        }
        if (command === 'history_writing_statistics') {
          return { ok: true, data: { count: 0 } };
        }
        return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__ITEMS__", json.dumps(items, ensure_ascii=False))
    page.add_init_script(script)


def open_history(page, query=""):
    page.goto(f"{BASE_URL}/#/history{query}", wait_until="networkidle")
    page.wait_for_selector(".history-page .history-row")
    settle(page)


def settle(page):
    # Route transitions are out-in; let them finish before the next interaction.
    page.wait_for_function(
        "() => !document.querySelector('.page-enter-active, .page-leave-active')"
        " && document.querySelectorAll('.history-page').length <= 1"
    )


def hash_of(page):
    return page.evaluate("() => location.hash")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    items = [HISTORY_ITEM, READING_ITEM, ORPHAN_READING_ITEM]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page, items)
                open_history(page)

                open_history(page, "?activity=writing&q=practical")
                writing_row = page.locator("[data-history-id='writing-history-1']")
                writing_row.click()
                page.wait_for_function("() => location.hash.startsWith('#/result/writing-history-1')")
                settle(page)
                back = page.locator("[data-history-back]")
                back.wait_for()
                if back.inner_text().strip() != "← 返回历史":
                    raise AssertionError(f"{name}: back link text: {back.inner_text()}")
                active = page.locator(".nav-item.is-active").all_inner_texts()
                if [text.strip() for text in active] != ["历史"]:
                    raise AssertionError(f"{name}: nav must highlight 历史 for a record opened from history: {active}")
                back.click()
                page.wait_for_function("() => location.hash === '#/history?activity=writing&q=practical'")
                settle(page)
                if page.locator("[data-history-tab='writing'][aria-selected='true']").count() != 1:
                    raise AssertionError(f"{name}: returning did not restore the writing tab")
                if page.locator("#history-search").input_value() != "practical":
                    raise AssertionError(f"{name}: returning did not restore the search filter")

                # Reached any other way, Result shows neither the link nor 历史.
                page.goto(f"{BASE_URL}/#/result/writing-history-1", wait_until="networkidle")
                page.wait_for_selector(".result-page")
                if page.locator("[data-history-back]").count() != 0:
                    raise AssertionError(f"{name}: back link shown without a history origin")
                if [text.strip() for text in page.locator(".nav-item.is-active").all_inner_texts()] != ["写作"]:
                    raise AssertionError(f"{name}: Result keeps its own nav section outside history")

                open_history(page)
                page.locator("[data-history-id='reading-history-1']").click()
                page.wait_for_function(
                    "() => location.hash === '#/reading/asset-urban/review/session-urban?suiteSessionId=suite-9'"
                )
                reading_hash = hash_of(page)
                settle(page)

                open_history(page)
                writing_row = page.locator("[data-history-id='writing-history-1']")
                writing_row.focus()
                page.keyboard.press("Enter")
                page.wait_for_function("() => location.hash.startsWith('#/result/writing-history-1')")
                settle(page)

                open_history(page)
                before = hash_of(page)
                page.locator("[data-history-id='reading-history-orphan']").click()
                page.wait_for_selector(".history-page .page-notice.notice-error")
                if hash_of(page) != before:
                    raise AssertionError(f"{name}: a record without a detailRoute must not navigate")

                width_ok = page.evaluate(
                    "() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1"
                )
                if not width_ok:
                    raise AssertionError(f"{name}: notice state overflows the viewport")
                report["cases"].append({"name": name, "readingHash": reading_hash})
                page.close()
        finally:
            browser.close()
    (REPORT_DIR / "history-detail-routing-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
