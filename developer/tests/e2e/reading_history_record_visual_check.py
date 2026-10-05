"""Reading records live in the unified History page: /history?activity=reading.

This replaces the old reading-home 练习记录 tab checks.  The old deep links
(`/?view=practice`, `/?view=records`) must land on the same filtered page.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from history_mock_support import history_calls, install_history_mock, reading_item, writing_item


BASE_URL = os.environ.get("READING_HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

READING = [
    reading_item(0, "Coastal wetland restoration and long-term environmental monitoring across three decades", 0.92),
    reading_item(1, "The development of public libraries", 0.76),
    reading_item(2, "Language change in international workplaces", 0.68),
    reading_item(3, "Urban transport networks", 0.84),
    reading_item(4, "Memory and learning", 0.73, suiteId="suite-4"),
    reading_item(5, "The future of coral reefs", 0.61),
]
WRITING = [writing_item(0, "Universities should focus on practical skills", 7.5)]


def geometry(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const first = document.querySelector('.history-page .history-row');
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            hash: location.hash,
            activities: [...document.querySelectorAll('.history-row')].map((node) => node.dataset.historyActivity),
            selectedTabs: [...document.querySelectorAll('[data-history-tab][aria-selected="true"]')].map((node) => node.dataset.historyTab),
            tabs: [...document.querySelectorAll('[data-history-tab]')].map((node) => node.dataset.historyTab),
            rowRect: rect(first),
            titleRect: rect(first.querySelector('.history-row__title')),
            scoreRect: rect(first.querySelector('.history-row__score strong')),
            scoreText: first.querySelector('.history-row__score strong')?.textContent.trim(),
            scoreLabel: first.querySelector('.history-row__score span')?.textContent.trim(),
            meta: first.querySelector('.history-row__meta')?.textContent.trim(),
            summary: document.querySelector('[data-history-summary]')?.textContent.trim(),
            badge: first.querySelector('.history-row__kind')?.textContent.trim(),
          };
        }
        """
    )


def assert_geometry(name, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}: reading history overflows the viewport: {json.dumps(data, ensure_ascii=False)}")
    if data["activities"] != ["reading"] * len(READING):
        raise AssertionError(f"{name}: ?activity=reading must list only reading records: {data['activities']}")
    if data["selectedTabs"] != ["reading"] or data["tabs"] != ["all", "reading", "writing"]:
        raise AssertionError(f"{name}: activity tabs are wrong: {data['tabs']} / {data['selectedTabs']}")
    if data["titleRect"]["right"] > data["rowRect"]["right"] + 1:
        raise AssertionError(f"{name}: long title escapes its row")
    if not data["scoreRect"] or data["scoreText"] != "92%":
        raise AssertionError(f"{name}: reading accuracy is not rendered as a percentage: {data['scoreText']}")
    if data["badge"] != "阅读":
        raise AssertionError(f"{name}: reading badge missing: {data['badge']}")
    if data["rowRect"]["height"] < 44:
        raise AssertionError(f"{name}: the reading row is not a 44px target")
    if data["scoreLabel"] != "正确率":
        raise AssertionError(f"{name}: reading score label: {data['scoreLabel']}")
    if "用时 7m 0s" not in data["meta"]:
        raise AssertionError(f"{name}: meta line lost the duration: {data['meta']}")
    if data["summary"] != "全部记录：阅读 6 篇，平均正确率 76%。":
        raise AssertionError(f"{name}: reading summary sentence: {data['summary']}")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                install_history_mock(page, READING + WRITING)

                page.goto(f"{BASE_URL}/#/history?activity=reading", wait_until="networkidle")
                page.wait_for_selector(".history-page .history-row")
                page.wait_for_function("() => document.querySelectorAll('[data-history-tab]').length === 3")
                data = geometry(page)
                assert_geometry(name, data)
                queries = [call["query"] for call in history_calls(page, "list_history") if call["query"].get("limit") == 20]
                if not queries or queries[0]["activity"] != "reading" or queries[0]["scoreScale"] != "ratio":
                    raise AssertionError(f"{name}: deep link did not query the reading activity: {queries}")
                page.screenshot(path=str(REPORT_DIR / f"reading-history-record-{name}-current.png"), full_page=True)

                # Old reading-home deep links land on the same filtered page.
                for legacy in ("practice", "records"):
                    page.goto(f"{BASE_URL}/#/?view={legacy}", wait_until="networkidle")
                    page.wait_for_function("() => location.hash === '#/history?activity=reading'")
                    page.wait_for_selector(".history-page .history-row")

                if page_errors:
                    raise AssertionError(f"{name}: page errors on the history page: {page_errors}")

                # A reading row opens its review route (suite sessions keep their suite id).
                page.locator("[data-history-id='reading-4']").click()
                page.wait_for_function(
                    "() => location.hash === '#/reading/asset-4/review/session-4?suiteSessionId=suite-4'"
                )
                report["cases"].append({"name": name, "geometry": data})
                page.close()
        finally:
            browser.close()
    (REPORT_DIR / "reading-history-record-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
