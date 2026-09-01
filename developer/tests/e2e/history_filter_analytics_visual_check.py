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

WRITING_ITEM = {
    "id": "history-writing-1",
    "activity": "writing",
    "title": "Universities should focus on practical skills",
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
    "id": "history-reading-1",
    "activity": "reading",
    "title": "Cambridge Reading: Urban transport",
    "status": "completed",
    "mode": "timer",
    "submittedAt": "2026-08-06T08:30:00Z",
    "durationMs": 1_140_000,
    "scoreValue": 0.82,
    "scoreScale": "ratio",
    "scoreLabel": "Accuracy",
    "scoreDisplay": "82%",
    "taskType": "reading",
}

WRITING_LOW_ITEM = {
    **WRITING_ITEM,
    "id": "history-writing-low",
    "title": "A short diagnostic writing attempt",
    "submittedAt": "2026-08-05T08:30:00Z",
    "scoreValue": 3.0,
    "scoreDisplay": "3.0",
}

WRITING_STATS = {
    "count": 1,
    "latest": {
        "score": {"taskResponse": 7.5, "coherence": 7.0, "lexical": 8.0, "grammar": 7.5},
        "taskType": "task2",
        "submittedAt": "2026-08-07T08:30:00Z",
    },
    "average": {"taskResponse": 7.0, "coherence": 6.5, "lexical": 7.5, "grammar": 7.0},
}


def install_tauri_mock(page, mode):
    items = {
        "mixed": [WRITING_ITEM, READING_ITEM],
        "writing": [WRITING_ITEM, WRITING_LOW_ITEM],
        "reading": [READING_ITEM],
    }[mode]
    script = r"""
    (() => {
      const items = __ITEMS__;
      const writingStats = __WRITING_STATS__;
      window.__historyFilterMode = '__MODE__';
      window.__historyFilterCalls = [];
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const invoke = async (command) => {
        window.__historyFilterCalls.push(command);
        if (command === 'list_history') {
          return { ok: true, data: { items, total: items.length, limit: 20, offset: 0, nextCursor: null } };
        }
        if (command === 'history_writing_statistics') {
          return { ok: true, data: window.__historyFilterMode === 'reading'
            ? { count: 0, latest: null, average: null }
            : writingStats };
        }
        return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__ITEMS__", json.dumps(items, ensure_ascii=False))
    script = script.replace("__WRITING_STATS__", json.dumps(WRITING_STATS, ensure_ascii=False))
    script = script.replace("__MODE__", mode)
    page.add_init_script(script)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const controls = [
            document.querySelector('#history-task-type'),
            document.querySelector('#history-start-date'),
            document.querySelector('#history-end-date'),
            document.querySelector('#history-min-score'),
            document.querySelector('#history-max-score'),
            document.querySelector('#history-search'),
            document.querySelector('#history-statistics-range'),
            document.querySelector('.filter-row > .btn')
          ].filter(Boolean);
          const tableScroll = document.querySelector('.comparison-table-scroll');
          const layout = document.querySelector('.analytics-layout');
          const trend = document.querySelector('.analytics-trend-card');
          const comparison = document.querySelector('.analytics-compare-card');
          const trendSeries = [...document.querySelectorAll('.trend-series')].map((series) => ({
            key: series.dataset.trendScale || '',
            title: series.querySelector('h4')?.textContent.trim() || '',
            axisLabels: [...series.querySelectorAll('.y-axis-label')].map((node) => node.textContent.trim()),
            pointTitles: [...series.querySelectorAll('.data-point title')].map((node) => node.textContent.trim()),
            pointYs: [...series.querySelectorAll('.data-point')].map((node) => Number(node.getAttribute('cy') || 0)),
            areaPath: series.querySelector('.chart-area')?.getAttribute('d') || ''
          }));
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            filterWidth: rect(document.querySelector('.filter-panel'))?.width || 0,
            controls: controls.map((node) => ({ id: node.id, height: rect(node)?.height || 0, right: rect(node)?.right || 0 })),
            layoutColumns: style(layout)?.gridTemplateColumns || '',
            layoutClass: layout?.className || '',
            layoutMinWidth: style(layout)?.minWidth || '',
            analyticsSideMinWidth: style(document.querySelector('.analytics-side'))?.minWidth || '',
            trendRect: rect(trend),
            comparisonRect: rect(comparison),
            tableScroll: tableScroll ? {
              clientWidth: tableScroll.clientWidth,
              scrollWidth: tableScroll.scrollWidth,
              overflowX: style(tableScroll).overflowX
            } : null,
            trendTitle: document.querySelector('.analytics-trend-card h3')?.textContent.trim() || '',
            trendSeries,
            hasRadar: Boolean(document.querySelector('.analytics-radar-card')),
            hasComparison: Boolean(comparison)
            ,calls: window.__historyFilterCalls
          };
        }
        """
    )


def assert_geometry(name, mode, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}/{mode}: History page overflows viewport: {json.dumps(data, ensure_ascii=False)}")
    if not data["trendRect"]:
        raise AssertionError(f"{name}/{mode}: trend analytics is not visible")
    if data["trendRect"]["right"] > width + 1:
        raise AssertionError(f"{name}/{mode}: trend card escapes viewport")
    if mode == "reading":
        if data["hasRadar"] or data["hasComparison"]:
            raise AssertionError(f"{name}/{mode}: reading-only history shows writing analytics")
        if "analytics-layout--trend-only" not in data["layoutClass"]:
            raise AssertionError(f"{name}/{mode}: reading-only analytics is not single-column")
    else:
        if not data["hasRadar"] or not data["hasComparison"]:
            raise AssertionError(f"{name}/{mode}: writing analytics is incomplete: {json.dumps(data, ensure_ascii=False)}")
        if not data["tableScroll"] or data["tableScroll"]["overflowX"] not in ("auto", "scroll"):
            raise AssertionError(f"{name}/{mode}: comparison table has no reachable horizontal viewport")
    series = {item["key"]: item for item in data["trendSeries"]}
    expected_keys = {
        "mixed": {"writing", "reading"},
        "writing": {"writing"},
        "reading": {"reading"},
    }[mode]
    if set(series) != expected_keys:
        raise AssertionError(f"{name}/{mode}: trend scales are not separated: {data['trendSeries']}")
    all_point_titles = [title for item in data["trendSeries"] for title in item["pointTitles"]]
    if mode == "mixed":
        if not any("Band 7.5" in title for title in all_point_titles) or not any("82%" in title for title in all_point_titles):
            raise AssertionError(f"{name}/{mode}: mixed tooltips lost their native units: {all_point_titles}")
        if any("75%" in title for title in all_point_titles):
            raise AssertionError(f"{name}/{mode}: writing Band is still forged as a percentage")
    if "writing" in series:
        if series["writing"]["axisLabels"] != ["0.0", "1.5", "3.0", "4.5", "6.0", "7.5", "9.0"]:
            raise AssertionError(f"{name}/{mode}: writing axis is not the full 0-9 Band domain")
        if mode == "writing" and not any("Band 3.0" in title for title in series["writing"]["pointTitles"]):
            raise AssertionError(f"{name}/{mode}: low Band point is missing or clamped")
    if "reading" in series:
        if series["reading"]["axisLabels"] != ["0", "20", "40", "60", "80", "100"]:
            raise AssertionError(f"{name}/{mode}: reading axis is not the 0-100 accuracy domain")
    for item in series.values():
        if len(item["pointTitles"]) == 1 and "L 580 210 L 40 210 Z" not in item["areaPath"]:
            raise AssertionError(f"{name}/{mode}: single-point series still closes as a triangle: {item['areaPath']}")
    if width <= 640:
        short_controls = [item for item in data["controls"] if item["id"] != "history-statistics-range" or mode != "reading"]
        if any(item["height"] < 44 for item in short_controls):
            raise AssertionError(f"{name}/{mode}: narrow controls are below 44px: {data['controls']}")
        if any(item["right"] > width + 1 for item in data["controls"]):
            raise AssertionError(f"{name}/{mode}: narrow control escapes viewport")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for mode in ("mixed", "writing", "reading"):
            viewports = CASES if mode == "mixed" else (("mobile", 390, 844),)
            for name, width, height in viewports:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page, mode)
                page_errors = []
                page.on("pageerror", lambda error: page_errors.append(getattr(error, "stack", str(error))))
                page.on("console", lambda message: print(f"console {mode}/{name}: {message.text}") if message.type == "error" else None)
                page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
                page.wait_for_selector(".history-page .essay-item")
                page.wait_for_selector(".history-page .statistics-section")
                page.wait_for_timeout(80)
                geometry = read_geometry(page)
                assert_geometry(name, mode, geometry)
                if page_errors:
                    raise AssertionError(f"{name}/{mode}: page errors: {page_errors}")
                screenshot_name = f"history-filter-analytics-{mode}-{name}-current.png"
                page.screenshot(path=str(REPORT_DIR / screenshot_name), full_page=True)
                report["cases"].append({"name": name, "mode": mode, "geometry": geometry})
                page.close()
        browser.close()
    (REPORT_DIR / "history-filter-analytics-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
