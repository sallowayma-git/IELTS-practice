import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from history_detail_visual_check import BASE_URL, HISTORY_ITEM, install_tauri_mock


REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const bar = document.querySelector('.history-page .batch-actions');
          const count = bar?.querySelector('.selection-count');
          const buttons = [...(bar?.querySelectorAll('button') || [])];
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            barRect: rect(bar),
            barDisplay: style(bar)?.display || '',
            barWrap: style(bar)?.flexWrap || '',
            countRect: rect(count),
            buttons: buttons.map((node) => ({ text: node.textContent.trim(), rect: rect(node) })),
          };
        }
        """
    )


def assert_geometry(name, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}: global History overflows viewport: {json.dumps(data, ensure_ascii=False)}")
    if data["barDisplay"] != "flex" or data["barWrap"] != "wrap":
        raise AssertionError(f"{name}: batch bar lost the flex-wrap contract")
    if not data["barRect"] or not data["countRect"]:
        raise AssertionError(f"{name}: batch bar did not render")
    if len(data["buttons"]) != 2 or any(not item["rect"] or item["rect"]["height"] < 44 for item in data["buttons"]):
        raise AssertionError(f"{name}: batch actions are not stable touch targets")
    if width <= 640:
        if data["countRect"]["width"] < width - 80:
            raise AssertionError(f"{name}: selection count did not receive the mobile row")
        if any(item["rect"]["right"] > width + 1 for item in data["buttons"]):
            raise AssertionError(f"{name}: mobile batch action escapes the viewport")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width, height in CASES:
            page = browser.new_page(viewport={"width": width, "height": height})
            install_tauri_mock(page)
            page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
            page.wait_for_selector(".history-page .essay-item")
            page.locator(".essay-item .essay-checkbox input").first.check()
            geometry = read_geometry(page)
            assert_geometry(name, geometry)
            page.screenshot(path=str(REPORT_DIR / f"history-batch-{name}-current.png"), full_page=True)
            report["cases"].append({"name": name, "geometry": geometry, "record": HISTORY_ITEM["id"]})
            page.close()
        browser.close()
    (REPORT_DIR / "history-batch-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
