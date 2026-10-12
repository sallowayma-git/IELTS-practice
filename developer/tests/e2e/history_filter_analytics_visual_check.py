"""History: records first, trends second, controls quiet until needed.

* the toolbar is one quiet line (search + 筛选 / 选择 / 导出); the date and score
  filters live in a disclosure panel, the writing kinds inside it;
* 走势 sits *below* the record list: small multiples on 全部, one chart on a
  single tab, plus the booktabs four-criteria table on 写作 (no radar);
* trends are drawn from ALL filtered records (listHistoryAll), not the page;
* a scope with fewer than two points draws no trend at all.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from history_mock_support import (
    WRITING_STATISTICS,
    history_calls,
    install_history_mock,
    reading_item,
    writing_item,
)


BASE_URL = os.environ.get("HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

# 3 writing first, then 22 reading: more than one page (20) of records, so a
# chart fed by the current page alone could not know about the last two.
WRITING = [
    writing_item(0, "Universities should focus on practical skills", 7.5, "task2"),
    writing_item(1, "The chart shows household spending", 6.5, "task1"),
    writing_item(2, "A short diagnostic writing attempt", 3.0, "task2"),
]
READING = [
    reading_item(index, f"Cambridge Reading {index:02d}", 0.5 + (index % 5) / 10, assetId=f"asset-{index}")
    for index in range(22)
]
for index, item in enumerate(READING):
    item["id"] = f"reading-{index:02d}"
    item["submittedAt"] = f"2026-07-{index + 1:02d}T09:30:00.000Z"

MODES = {
    "mixed": {"url": "/#/history", "items": WRITING + READING, "series": ["reading", "writing"]},
    "writing": {"url": "/#/history?activity=writing", "items": WRITING + READING, "series": ["writing"]},
    "reading": {"url": "/#/history?activity=reading", "items": WRITING + READING, "series": ["reading"]},
    "single": {"url": "/#/history", "items": [WRITING[0]], "series": []},
}


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const top = (selector) => rect(document.querySelector(selector))?.top ?? null;
          const controls = [...document.querySelectorAll(
            '#history-search, .history-toolbar__link, #history-start-date, #history-end-date, #history-min-score, #history-max-score'
          )];
          const series = [...document.querySelectorAll('[data-trend-scale]')].map((node) => ({
            key: node.dataset.trendScale,
            title: node.querySelector('h3')?.textContent.trim() || '',
            caption: node.querySelector('figcaption span')?.textContent.trim() || '',
            left: rect(node).left,
            top: rect(node).top,
            right: rect(node).right,
            axisLabels: [...node.querySelectorAll('.y-axis-label')].map((label) => label.textContent.trim()),
            pointTitles: [...node.querySelectorAll('.data-point title')].map((title) => title.textContent.trim()),
            areaPath: node.querySelector('.chart-area')?.getAttribute('d') || ''
          }));
          const table = document.querySelector('[data-history-criteria] table');
          const toolbar = document.querySelector('.history-toolbar');
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            listTop: top('.history-list'),
            trendsTop: top('.history-trends'),
            filterPanelOpen: Boolean(document.querySelector('#history-filter-panel')),
            toolbarHeight: toolbar ? rect(toolbar).height : 0,
            controls: controls.map((node) => ({ id: node.id || node.textContent.trim(), height: rect(node).height, right: rect(node).right })),
            series,
            hasRadar: Boolean(document.querySelector('svg.radar-chart, .radar-chart-container')),
            criteria: table ? {
              head: [...table.querySelectorAll('thead th')].map((node) => node.textContent.trim()),
              rows: [...table.querySelectorAll('tbody tr')].map((row) => [...row.children].map((cell) => cell.textContent.trim())),
              scoped: table.querySelector('thead th')?.getAttribute('scope') || ''
            } : null,
            summary: document.querySelector('[data-history-summary]')?.textContent.trim() || '',
            tabs: [...document.querySelectorAll('[data-history-tab]')].map((node) => node.textContent.trim()),
            rows: document.querySelectorAll('.history-row').length
          };
        }
        """
    )


def assert_page_shape(name, mode, data):
    width = data["viewport"][0]
    label = f"{name}/{mode}"
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{label}: History page overflows viewport: {json.dumps(data, ensure_ascii=False)}")
    if data["hasRadar"]:
        raise AssertionError(f"{label}: the radar chart is gone from this page")
    if any(item["right"] > width + 1 for item in data["controls"]):
        raise AssertionError(f"{label}: a control escapes the viewport")
    # Phone widths: 44px touch target (input.css, button.css). Desktop/tablet keep the 36px sizes.
    if width <= 640 and any(item["height"] < 44 for item in data["controls"]):
        raise AssertionError(f"{label}: narrow controls are below 44px: {data['controls']}")


def assert_trends(name, mode, data):
    label = f"{name}/{mode}"
    expected = MODES[mode]["series"]
    keys = [item["key"] for item in data["series"]]
    if keys != expected:
        raise AssertionError(f"{label}: trend series {keys}, expected {expected}")
    if not expected:
        if data["trendsTop"] is not None or data["criteria"]:
            raise AssertionError(f"{label}: fewer than two points must draw no trend section")
        return
    if data["trendsTop"] <= data["listTop"]:
        raise AssertionError(f"{label}: trends must sit below the record list")
    width = data["viewport"][0]
    by_key = {item["key"]: item for item in data["series"]}
    if "reading" in by_key:
        reading = by_key["reading"]
        if reading["title"] != "阅读正确率" or reading["caption"] != "最近 15 次":
            raise AssertionError(f"{label}: reading chart should span all 22 filtered records: {reading['title']} {reading['caption']}")
        if reading["axisLabels"] != ["0", "20", "40", "60", "80", "100"]:
            raise AssertionError(f"{label}: reading axis is not the 0-100 accuracy domain")
        if not all(point.endswith("%") for point in reading["pointTitles"]):
            raise AssertionError(f"{label}: reading tooltips lost their % unit: {reading['pointTitles']}")
    if "writing" in by_key:
        writing = by_key["writing"]
        if writing["title"] != "写作 Band" or writing["caption"] != "共 3 次":
            raise AssertionError(f"{label}: writing chart header: {writing['title']} {writing['caption']}")
        if writing["axisLabels"] != ["0.0", "1.5", "3.0", "4.5", "6.0", "7.5", "9.0"]:
            raise AssertionError(f"{label}: writing axis is not the full 0-9 Band domain")
        if not any("Band 3.0" in point for point in writing["pointTitles"]):
            raise AssertionError(f"{label}: the low Band point is missing or clamped")
        if any("%" in point for point in writing["pointTitles"]):
            raise AssertionError(f"{label}: writing Band is forged as a percentage")
    if mode == "mixed":
        left, right = by_key["reading"], by_key["writing"]
        side_by_side = abs(left["top"] - right["top"]) < 2
        if (width > 760) != side_by_side:
            raise AssertionError(f"{label}: small multiples must sit side by side only on wide screens")
    if mode == "writing":
        criteria = data["criteria"]
        if not criteria or criteria["head"] != ["评分项", "最新", "平均", "差值"] or len(criteria["rows"]) != 4:
            raise AssertionError(f"{label}: criteria table: {criteria}")
        if criteria["rows"][0] != ["Task Response", "7.0", "6.5", "+0.5"]:
            raise AssertionError(f"{label}: criteria row: {criteria['rows'][0]}")
    elif data["criteria"]:
        raise AssertionError(f"{label}: the criteria table belongs to the writing tab only")


def assert_scope_from_all_records(page, label):
    limits = [call["query"].get("limit") for call in history_calls(page, "list_history")]
    if 20 not in limits or 200 not in limits:
        raise AssertionError(f"{label}: page list and full-scope list were not both requested: {limits}")
    scope_calls = [call for call in history_calls(page, "list_history") if call["query"].get("limit") == 200]
    if len(scope_calls) != 1:
        raise AssertionError(f"{label}: the full scope must be fetched once per filter change: {len(scope_calls)}")


def open_page(browser, name, width, height, mode):
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda error: errors.append(getattr(error, "stack", str(error))))
    spec = MODES[mode]
    install_history_mock(page, spec["items"], statistics=WRITING_STATISTICS)
    page.goto(f"{BASE_URL}{spec['url']}", wait_until="networkidle")
    page.wait_for_selector(".history-page .history-row")
    page.wait_for_timeout(120)
    return page, errors


def run_mode(browser, name, width, height, mode, report):
    page, errors = open_page(browser, name, width, height, mode)
    geometry = read_geometry(page)
    assert_page_shape(name, mode, geometry)
    assert_trends(name, mode, geometry)
    if mode != "single":
        assert_scope_from_all_records(page, f"{name}/{mode}")
        if not geometry["summary"].startswith("全部记录："):
            raise AssertionError(f"{name}/{mode}: summary sentence is missing: {geometry['summary']}")
    page.screenshot(path=str(REPORT_DIR / f"history-filter-analytics-{mode}-{name}-current.png"), full_page=True)

    if mode == "mixed":
        # Filters open: the disclosure keeps the toolbar a single quiet line.
        page.locator("[data-history-toggle='filters']").click()
        page.wait_for_selector("#history-filter-panel")
        opened = read_geometry(page)
        assert_page_shape(name, "mixed-filters", opened)
        if page.locator("#history-min-score").is_enabled():
            raise AssertionError(f"{name}: the mixed tab must disable the score filter")
        page.locator("#history-start-date").fill("2026-07-05")
        page.wait_for_function("() => location.hash.includes('from=2026-07-05')")
        if page.locator("[data-history-clear-filters]").count() != 1:
            raise AssertionError(f"{name}: 已筛选 · 清除 did not appear for an active filter")
        page.screenshot(path=str(REPORT_DIR / f"history-filter-open-{name}-current.png"), full_page=True)
        page.locator("[data-history-clear-filters]").click()
        page.wait_for_function("() => !location.hash.includes('from=')")
        if page.locator("#history-start-date").input_value() != "":
            raise AssertionError(f"{name}: clearing filters did not empty the date field")
    if errors:
        raise AssertionError(f"{name}/{mode}: page errors: {errors}")
    report.append({"name": name, "mode": mode, "geometry": geometry})
    page.close()


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for mode in MODES:
                viewports = CASES if mode == "mixed" else (("mobile", 390, 844), ("desktop", 1440, 900))
                for name, width, height in viewports:
                    run_mode(browser, name, width, height, mode, report)
        finally:
            browser.close()
    (REPORT_DIR / "history-filter-analytics-visual-report.json").write_text(
        json.dumps({"status": "passed", "cases": report}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"status": "passed", "cases": [f"{item['name']}/{item['mode']}" for item in report]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
