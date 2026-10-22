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
          const bar = document.querySelector('.history-page .history-selection');
          const count = bar?.querySelector('.history-selection__count');
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
            // The bar lives inside the floating sticky toolbar block, which
            // owns the sticky position (HistoryPage `.history-toolbar-bar`).
            barPosition: style(bar?.closest('.history-toolbar-bar, .is-sticky'))?.position || '',
            countText: count?.textContent.trim() || '',
            checked: [...document.querySelectorAll('.history-row[aria-checked="true"]')].length,
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
    if data["barDisplay"] != "flex" or data["barWrap"] != "wrap" or data["barPosition"] != "sticky":
        raise AssertionError(f"{name}: selection bar lost the sticky flex-wrap contract")
    if data["countText"] != "已选 1 条" or data["checked"] != 1:
        raise AssertionError(f"{name}: selection count is wrong: {data['countText']} / {data['checked']}")
    if not data["barRect"] or not data["countRect"]:
        raise AssertionError(f"{name}: batch bar did not render")
    labels = [item["text"] for item in data["buttons"]]
    if labels != ["删除", "全选本页", "取消", "清空全部记录"]:
        raise AssertionError(f"{name}: selection actions changed: {labels}")
    # Desktop/tablet floor is WCAG 2.5.8 (24px); phone widths use the 44px touch target (button.css).
    min_target = 44 if width <= 640 else 24
    if any(not item["rect"] or item["rect"]["height"] < min_target for item in data["buttons"]):
        raise AssertionError(f"{name}: selection actions are not stable touch targets")
    if any(item["rect"]["right"] > width + 1 for item in data["buttons"]):
        raise AssertionError(f"{name}: selection action escapes the viewport")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for name, width, height in CASES:
            page = browser.new_page(viewport={"width": width, "height": height})
            install_tauri_mock(page)
            page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
            page.wait_for_selector(".history-page .history-row")
            page.locator("[data-history-toggle='selection']").click()
            page.locator(".history-row").first.click()
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
