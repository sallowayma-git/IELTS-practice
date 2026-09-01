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
LONG_TOKEN = "history-record-" + ("x" * 160)


def history_item(index):
    activity = "reading" if index % 3 == 0 else "writing"
    task_type = "reading" if activity == "reading" else (None if index == 1 else "task2")
    score_value = 0.82 if activity == "reading" else 7.5
    return {
        "id": f"history-record-{index:02d}",
        "activity": activity,
        "title": LONG_TOKEN if index == 0 else f"Practice record {index:02d}",
        "status": "completed",
        "mode": "timer" if activity == "reading" else "single",
        "submittedAt": f"2026-08-{(index % 20) + 1:02d}T08:30:00Z",
        "durationMs": 1_140_000 + (index * 1_000),
        "scoreValue": score_value,
        "scoreScale": "ratio" if activity == "reading" else "band9",
        "scoreLabel": "Accuracy" if activity == "reading" else "Overall Band",
        "scoreDisplay": "82%" if activity == "reading" else "7.5",
        "taskType": task_type,
        "assetId": f"reading-asset-{index}" if activity == "reading" else None,
        "sessionId": f"reading-session-{index}" if activity == "reading" else None,
    }


HISTORY_ITEMS = [history_item(index) for index in range(21)]


def install_tauri_mock(page):
    script = r"""
    (() => {
      window.__historyRecords = __ITEMS__;
      window.__historyRecordCalls = [];
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const invoke = async (command, args = {}) => {
        window.__historyRecordCalls.push({ command, args });
        if (command === 'list_history') {
          const query = args.query || {};
          const offset = Number(query.offset || 0);
          const limit = Number(query.limit || 20);
          const items = window.__historyRecords.slice(offset, offset + limit);
          return {
            ok: true,
            data: {
              items,
              total: window.__historyRecords.length,
              limit,
              offset,
              nextCursor: offset + items.length < window.__historyRecords.length
                ? String(offset + items.length)
                : null
            }
          };
        }
        if (command === 'history_writing_statistics') {
          return { ok: true, data: { count: 0, latest: null, average: null } };
        }
        if (command === 'delete_history_attempt') {
          const id = String(args.attemptId || '');
          window.__historyRecords = window.__historyRecords.filter((item) => item.id !== id);
          return { ok: true, data: 1 };
        }
        return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__ITEMS__", json.dumps(HISTORY_ITEMS, ensure_ascii=False))
    page.add_init_script(script)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const item = document.querySelector('.history-page .essay-item');
          const content = item?.querySelector('.essay-content');
          const title = item?.querySelector('.essay-title');
          const checkbox = item?.querySelector('.essay-checkbox');
          const actions = [...(item?.querySelectorAll('.essay-actions button') || [])];
          const pagination = document.querySelector('.history-page .pagination');
          const pageInfo = pagination?.querySelector('.page-info');
          const pageButtons = [...(pagination?.querySelectorAll('button') || [])];
          const badges = [...document.querySelectorAll('.history-page .task-badge')];
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            itemRect: rect(item),
            contentMinWidth: style(content)?.minWidth || '',
            titleRect: rect(title),
            titleClientWidth: title?.clientWidth || 0,
            titleScrollWidth: title?.scrollWidth || 0,
            titleOverflowWrap: style(title)?.overflowWrap || '',
            checkboxRect: rect(checkbox),
            checkboxLabel: item?.querySelector('.essay-checkbox input')?.getAttribute('aria-label') || '',
            actions: actions.map((node) => ({
              title: node.getAttribute('title') || '',
              ariaLabel: node.getAttribute('aria-label') || '',
              rect: rect(node)
            })),
            badgeKinds: badges.map((node) => ({
              className: node.className,
              text: node.textContent.trim(),
              background: style(node)?.backgroundColor || ''
            })),
            paginationDisplay: style(pagination)?.display || '',
            paginationColumns: style(pagination)?.gridTemplateColumns || '',
            paginationRect: rect(pagination),
            pageInfoRect: rect(pageInfo),
            pageButtons: pageButtons.map((node) => ({ text: node.textContent.trim(), rect: rect(node) }))
          };
        }
        """
    )


def assert_geometry(name, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}: History page overflows viewport: {json.dumps(data, ensure_ascii=False)}")
    if not data["itemRect"] or not data["titleRect"]:
        raise AssertionError(f"{name}: recent History record did not render")
    if data["contentMinWidth"] != "0px":
        raise AssertionError(f"{name}: record content cannot shrink safely")
    if data["titleScrollWidth"] > data["titleClientWidth"] + 1 or data["titleOverflowWrap"] != "anywhere":
        raise AssertionError(f"{name}: long record title is silently clipped: {json.dumps(data, ensure_ascii=False)}")
    checkbox = data["checkboxRect"]
    if not checkbox or checkbox["width"] < 44 or checkbox["height"] < 44 or not data["checkboxLabel"]:
        raise AssertionError(f"{name}: History selection is not a labeled 44px target")
    if len(data["actions"]) != 2:
        raise AssertionError(f"{name}: record actions are missing")
    for action in data["actions"]:
        if not action["rect"] or action["rect"]["width"] < 44 or action["rect"]["height"] < 44:
            raise AssertionError(f"{name}: record action is below 44px: {data['actions']}")
        if not action["ariaLabel"]:
            raise AssertionError(f"{name}: icon action has no accessible name")
    badge_classes = {item["className"] for item in data["badgeKinds"]}
    if not any("reading" in value for value in badge_classes) or not any("unlabeled" in value for value in badge_classes):
        raise AssertionError(f"{name}: reading/unlabeled badge states are missing")
    if any(item["background"] in ("", "rgba(0, 0, 0, 0)") for item in data["badgeKinds"] if "reading" in item["className"] or "unlabeled" in item["className"]):
        raise AssertionError(f"{name}: reading/unlabeled badges have no visual state")
    if not data["paginationRect"] or len(data["pageButtons"]) != 2:
        raise AssertionError(f"{name}: pagination did not render")
    if any(item["rect"]["height"] < 44 for item in data["pageButtons"]):
        raise AssertionError(f"{name}: pagination action is below 44px")
    if width <= 640:
        if data["paginationDisplay"] != "grid" or len(data["paginationColumns"].split()) != 2:
            raise AssertionError(f"{name}: mobile pagination is not a stable two-column grid")
        if not data["pageInfoRect"] or data["pageInfoRect"]["width"] < data["paginationRect"]["width"] - 2:
            raise AssertionError(f"{name}: page status does not own the mobile first row")
        previous_rect = data["pageButtons"][0]["rect"]
        next_rect = data["pageButtons"][1]["rect"]
        if data["pageInfoRect"]["top"] >= previous_rect["top"]:
            raise AssertionError(f"{name}: page status is not the first mobile row")
        if abs(previous_rect["top"] - next_rect["top"]) > 1 or next_rect["left"] <= previous_rect["right"]:
            raise AssertionError(f"{name}: previous/next actions do not share the second mobile row")


def verify_last_page_delete(page):
    page.locator(".history-page .pagination button", has_text="下一页").click()
    page.wait_for_function(
        "() => document.querySelector('.history-page .page-info')?.textContent.includes('第 2 / 2 页')"
    )
    page.wait_for_function("() => document.querySelectorAll('.history-page .essay-item').length === 1")
    last_id = page.locator(".history-page .essay-item").get_attribute("data-history-id")
    page.locator(".history-page .essay-item .essay-actions button[title='删除']").click()
    page.wait_for_selector(".history-page .dialog .btn-danger")
    page.locator(".history-page .dialog .btn-danger").click()
    page.wait_for_function("() => window.__historyRecords.length === 20")
    page.wait_for_function("() => document.querySelectorAll('.history-page .essay-item').length === 20")
    page.wait_for_function("() => !document.querySelector('.history-page .empty-state')")
    offsets = page.evaluate(
        "() => window.__historyRecordCalls.filter((call) => call.command === 'list_history').map((call) => Number(call.args?.query?.offset || 0))"
    )
    if offsets[-3:] != [20, 20, 0]:
        raise AssertionError(f"last-page delete did not recover through the canonical first-page query: {offsets}")
    if last_id and page.locator(f"[data-history-id='{last_id}']").count() != 0:
        raise AssertionError("deleted last-page record is still visible")
    return offsets


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(getattr(error, "stack", str(error))))
                page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
                page.wait_for_selector(".history-page .essay-item")
                geometry = read_geometry(page)
                assert_geometry(name, geometry)
                page.screenshot(
                    path=str(REPORT_DIR / f"history-record-pagination-{name}-current.png"),
                    full_page=True,
                )
                offsets = verify_last_page_delete(page)
                if page_errors:
                    raise AssertionError(f"{name}: page errors: {page_errors}")
                report["cases"].append({"name": name, "geometry": geometry, "offsets": offsets})
                page.close()
        finally:
            browser.close()
    (REPORT_DIR / "history-record-pagination-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
