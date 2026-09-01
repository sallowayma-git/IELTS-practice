import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from reading_history_widget_visual_check import HISTORY, install_tauri_mock, open_route


BASE_URL = os.environ.get("READING_HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)


def geometry(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const first = document.querySelector('#history-list .history-item');
          const score = first?.querySelector('.record-percentage');
          const deleteButton = first?.querySelector('.delete-record-btn');
          const checkbox = first?.querySelector('.record-selection input');
          const actionButtons = [...document.querySelectorAll('.practice-history-header > .hero-panel__actions:last-child button')];
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            records: document.querySelectorAll('#history-list .history-item').length,
            firstTitle: first?.querySelector('.practice-record-title strong')?.textContent || '',
            firstTitleWidth: rect(first?.querySelector('.practice-record-title'))?.width || 0,
            firstTitleScrollWidth: first?.querySelector('.practice-record-title')?.scrollWidth || 0,
            scoreRect: rect(score),
            deleteRect: rect(deleteButton),
            checkboxRect: rect(checkbox),
            checkboxVisible: style(checkbox)?.display !== 'none',
            actionRects: actionButtons.map(rect),
            firstSelected: first?.classList.contains('history-item-selected') || false,
            route: location.hash,
          };
        }
        """
    )


def assert_geometry(name, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}: history route overflows viewport: {json.dumps(data, ensure_ascii=False)}")
    if data["records"] != len(HISTORY):
        raise AssertionError(f"{name}: expected {len(HISTORY)} history records")
    if data["firstTitleScrollWidth"] > data["firstTitleWidth"] + 1:
        raise AssertionError(f"{name}: title should truncate inside the record card")
    if not data["scoreRect"] or data["scoreRect"]["height"] < 44:
        raise AssertionError(f"{name}: score surface is not stable: {data['scoreRect']}")
    if not data["deleteRect"] or data["deleteRect"]["height"] < 44:
        raise AssertionError(f"{name}: delete target is not stable: {data['deleteRect']}")
    if width <= 640 and any(not item or item["height"] < 44 for item in data["actionRects"]):
        raise AssertionError(f"{name}: history action target is below 44px: {data['actionRects']}")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width, height in CASES:
            page = browser.new_page(viewport={"width": width, "height": height})
            install_tauri_mock(page)
            page.add_init_script("window.confirm = () => true;")
            open_route(page)
            before = geometry(page)
            assert_geometry(name, before)

            page.locator("#bulk-delete-btn").click()
            checkbox = page.locator("#history-list .history-item").first.locator(".record-selection input")
            checkbox.click()
            selected = geometry(page)
            if not selected["firstSelected"] or not selected["checkboxVisible"]:
                raise AssertionError(f"{name}: checkbox selection did not persist")
            checkbox.click()
            if geometry(page)["firstSelected"]:
                raise AssertionError(f"{name}: checkbox click did not toggle selection off")

            page.locator("#bulk-delete-btn").click()
            before_review = page.url
            page.locator("#history-list .practice-record-title").first.click()
            page.wait_for_timeout(100)
            if page.url == before_review:
                raise AssertionError(f"{name}: record title did not preserve review navigation")

            page.goto(f"{BASE_URL}/#/?view=practice", wait_until="networkidle")
            open_route(page)
            before_delete = page.url
            page.locator("#history-list .delete-record-btn").first.click()
            page.wait_for_timeout(100)
            if page.url != before_delete:
                raise AssertionError(f"{name}: delete action unexpectedly changed route")

            page.screenshot(path=str(REPORT_DIR / f"reading-history-record-{name}-current.png"), full_page=True)
            report["cases"].append({"name": name, "geometry": geometry(page)})
            page.close()
        browser.close()
    (REPORT_DIR / "reading-history-record-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
