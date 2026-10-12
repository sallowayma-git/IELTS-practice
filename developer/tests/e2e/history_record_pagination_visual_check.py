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
          return { ok: true, data: { count: 0 } };
        }
        if (command === 'delete_history_attempts') {
          const ids = new Set(args.cmd?.attemptIds || []);
          window.__historyRecords = window.__historyRecords.filter((item) => !ids.has(item.id));
          return { ok: true, data: ids.size };
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
          const item = document.querySelector('.history-page .history-row');
          const main = item?.querySelector('.history-row__main');
          const title = item?.querySelector('.history-row__title');
          const score = item?.querySelector('.history-row__score');
          const pagination = document.querySelector('.history-page .history-pagination');
          const pageInfo = pagination?.querySelector('.history-pagination__info');
          const pageButtons = [...(pagination?.querySelectorAll('button') || [])];
          const kinds = [...document.querySelectorAll('.history-page .history-row__kind')];
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            itemRect: rect(item),
            mainMinWidth: style(main)?.minWidth || '',
            titleRect: rect(title),
            titleClientWidth: title?.clientWidth || 0,
            titleScrollWidth: title?.scrollWidth || 0,
            titleOverflowWrap: style(title)?.overflowWrap || '',
            scoreRect: rect(score),
            scoreAlign: style(score)?.justifySelf || '',
            scoreNumerals: style(score?.querySelector('.t-num'))?.fontVariantNumeric || '',
            rowButtons: item ? item.querySelectorAll('button').length : -1,
            dayHeads: [...document.querySelectorAll('.list-group-title')].map((node) => node.textContent.trim()),
            badgeKinds: kinds.map((node) => ({
              className: node.className,
              text: node.textContent.trim(),
              background: getComputedStyle(node).backgroundColor,
            })),
            paginationRect: rect(pagination),
            paginationText: pagination?.textContent.replace(/\s+/g, ' ').trim() || '',
            pageInfoText: pageInfo?.textContent.trim() || '',
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
    if data["mainMinWidth"] != "0px":
        raise AssertionError(f"{name}: record content cannot shrink safely")
    if data["titleScrollWidth"] > data["titleClientWidth"] + 1 or data["titleOverflowWrap"] != "anywhere":
        raise AssertionError(f"{name}: long record title is silently clipped: {json.dumps(data, ensure_ascii=False)}")
    if data["itemRect"]["height"] < 44:
        raise AssertionError(f"{name}: the record row is not a 44px target")
    if data["rowButtons"] != 0:
        raise AssertionError(f"{name}: rows carry no per-row buttons outside selection mode")
    if not data["dayHeads"]:
        raise AssertionError(f"{name}: records are not grouped by day")
    score = data["scoreRect"]
    # List-row padding is 16px on the right (design-system spec 2.6, list.css).
    if not score or score["right"] > data["itemRect"]["right"] + 1 or score["right"] < data["itemRect"]["right"] - 16:
        raise AssertionError(f"{name}: score is not right-aligned in the row: {score} / {data['itemRect']}")
    if data["scoreAlign"] != "end" or "tabular-nums" not in data["scoreNumerals"]:
        raise AssertionError(f"{name}: score needs right alignment and tabular numerals: {data['scoreAlign']} {data['scoreNumerals']}")
    kind_classes = {item["className"] for item in data["badgeKinds"]}
    if not any("reading" in value for value in kind_classes) or not any("unlabeled" in value for value in kind_classes):
        raise AssertionError(f"{name}: reading/unlabeled kind markers are missing")
    # Record kind is a design-system tag (spec 2.10): reading and unlabeled must carry distinct tones.
    fills = {}
    for item in data["badgeKinds"]:
        for key in ("reading", "unlabeled"):
            if key in item["className"]:
                fills[key] = item["background"]
    if len(fills) != 2 or fills["reading"] in ("", "rgba(0, 0, 0, 0)") or fills["reading"] == fills["unlabeled"]:
        raise AssertionError(f"{name}: reading/unlabeled kind tags are not visually distinct: {fills}")
    if not data["paginationRect"] or len(data["pageButtons"]) != 2:
        raise AssertionError(f"{name}: pagination did not render")
    if data["paginationText"] != "‹ 上一页·1 / 2·下一页 ›":
        raise AssertionError(f"{name}: pagination is plain text: {data['paginationText']}")
    # Desktop/tablet 24px (WCAG 2.5.8); phone widths 44px touch target (button.css).
    min_target = 44 if width <= 640 else 24
    if any(item["rect"]["height"] < min_target or item["rect"]["right"] > width for item in data["pageButtons"]):
        raise AssertionError(f"{name}: pagination action is below {min_target}px or escapes the viewport")


def verify_last_page_delete(page):
    page.locator(".history-page .history-pagination button", has_text="下一页").click()
    page.wait_for_function(
        "() => document.querySelector('.history-page .history-pagination__info')?.textContent.trim() === '2 / 2'"
    )
    page.wait_for_function("() => document.querySelectorAll('.history-page .history-row').length === 1")
    if "page=2" not in page.evaluate("() => location.hash"):
        raise AssertionError("the page number is not mirrored in the URL")
    last_id = page.locator(".history-page .history-row").get_attribute("data-history-id")
    page.locator("[data-history-toggle='selection']").click()
    page.locator(".history-page .history-row").click()
    page.locator("[data-history-delete]").click()
    page.wait_for_selector(".history-page .dialog .btn-danger")
    page.locator(".history-page .dialog .btn-danger").click()
    page.wait_for_function("() => window.__historyRecords.length === 20")
    page.wait_for_function("() => document.querySelectorAll('.history-page .history-row').length === 20")
    page.wait_for_function("() => !document.querySelector('.history-page .empty-state')")
    # Activity probes (limit 1) feed the tab strip; only page loads (limit 20) count here.
    offsets = page.evaluate(
        "() => window.__historyRecordCalls.filter((call) => call.command === 'list_history' && Number(call.args?.query?.limit) === 20).map((call) => Number(call.args?.query?.offset || 0))"
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
                page.wait_for_selector(".history-page .history-row")
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
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
