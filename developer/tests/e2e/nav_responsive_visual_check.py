import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("NAV_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 768, 1024),
    ("wide-mobile", 488, 1055),
    ("mobile", 390, 844),
    ("small", 360, 800),
    ("narrow", 320, 844),
)
ROUTES = (
    ("reading", "/?view=browse", "阅读"),
    ("agent", "/agent", "Agent"),
    ("history", "/history", "历史"),
    ("settings", "/settings", "设置"),
)


def expected_href_for(label):
    if label == "Agent":
        return "/agent"
    if label == "历史":
        return "/history"
    if label == "设置":
        return "/settings"
    return "/?view=browse"


def install_tauri_mock(page):
    script = r"""
    (() => {
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'list_history') {
            return { ok: true, data: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null } };
          }
          if (command === 'history_writing_statistics') {
            return { ok: true, data: { count: 0, latest: null, average: null } };
          }
          if (command === 'list_settings') return { ok: true, data: [] };
          if (command === 'history_get_retention_policy') {
            return { ok: true, data: { maxTerminalAttempts: 100 } };
          }
          if (command === 'ai_list_configs') return { ok: true, data: [] };
          if (command === 'writing_prompt_list') return { ok: true, data: [] };
          if (command === 'writing_topic_statistics') {
            return { ok: true, data: { total: 0, byTaskType: [] } };
          }
          if (command === 'get_app_info') {
            return { host: 'Tauri', tauriVersion: '2', version: '0.1.0' };
          }
          if (command === 'get_app_data_paths') {
            return { appData: 'C:/atlas/data', backups: 'C:/atlas/backups' };
          }
          if (command === 'list_backups') return { ok: true, data: [] };
          if (command === 'check_for_updates') {
            return { configured: false, updateAvailable: false, message: '未配置更新源。' };
          }
          return { ok: true, data: null };
        }
      };
    })();
    """
    page.add_init_script(script)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const nav = document.querySelector('.nav-shell');
          const links = document.querySelector('.nav-links');
          const items = [...document.querySelectorAll('.nav-item')];
          const linksRect = links?.getBoundingClientRect();
          const itemGeometry = items.map((item) => {
            const rect = item.getBoundingClientRect();
            const label = item.querySelector('.nav-label');
            return {
              label: label?.textContent.trim(),
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
              scrollWidth: item.scrollWidth,
              clientWidth: item.clientWidth,
                    ariaCurrent: item.getAttribute('aria-current'),
                    href: item.getAttribute('href')
            };
          });
          const visibleRows = [...new Set(itemGeometry.map((item) => Math.round(item.top)))];
          const columns = links ? getComputedStyle(links).gridTemplateColumns : '';
          return {
            viewport: [innerWidth, innerHeight],
            navLabel: nav?.getAttribute('aria-label'),
            navDisplay: links ? getComputedStyle(links).display : '',
            navOverflowX: links ? getComputedStyle(links).overflowX : '',
            columns,
            visibleRows,
            itemGeometry,
            linksBounds: linksRect ? {
              left: linksRect.left,
              right: linksRect.right,
              top: linksRect.top,
              bottom: linksRect.bottom
            } : null,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth
          };
        }
        """
    )


def assert_geometry(case_name, route_name, expected_active, geometry):
    width = geometry["viewport"][0]
    if geometry["navLabel"] != "主导航":
        raise AssertionError(f"{case_name}/{route_name}: nav has no accessible label")
    if len(geometry["itemGeometry"]) != 6:
        raise AssertionError(f"{case_name}/{route_name}: expected all six nav entries")
    expected_href = expected_href_for(expected_active)
    current = [item for item in geometry["itemGeometry"] if item["ariaCurrent"] == "page"]
    if len(current) != 1 or not current[0]["href"].endswith(expected_href):
        raise AssertionError(f"{case_name}/{route_name}: incorrect aria-current state {current}")
    bounds = geometry["linksBounds"]
    for item in geometry["itemGeometry"]:
        if item["left"] < bounds["left"] - 1 or item["right"] > bounds["right"] + 1:
            raise AssertionError(f"{case_name}/{route_name}: {item['label']} is hidden outside the nav")
        if item["scrollWidth"] > item["clientWidth"] + 1:
            raise AssertionError(f"{case_name}/{route_name}: {item['label']} text is clipped")
    if geometry["documentScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{case_name}/{route_name}: nav causes horizontal page overflow")

    if width <= 640:
        columns = [column for column in geometry["columns"].split(" ") if column]
        if geometry["navDisplay"] != "grid" or len(columns) != 3:
            raise AssertionError(f"{case_name}/{route_name}: compact nav is not a three-column grid")
        if len(geometry["visibleRows"]) != 2:
            raise AssertionError(f"{case_name}/{route_name}: compact nav does not expose two rows")
        if geometry["navOverflowX"] != "visible":
            raise AssertionError(f"{case_name}/{route_name}: compact nav still hides horizontal content")
        if any(item["height"] < 43.5 for item in geometry["itemGeometry"]):
            raise AssertionError(f"{case_name}/{route_name}: compact nav touch target is below 44px")
    elif geometry["navDisplay"] != "flex":
        raise AssertionError(f"{case_name}/{route_name}: desktop/tablet nav layout changed unexpectedly")


def assert_focus_visible(page, case_name, route_name):
    settings = page.locator(".nav-item").filter(has_text="设置")
    settings.focus()
    focus = page.evaluate(
        """
        () => {
          const active = document.activeElement;
          const links = document.querySelector('.nav-links');
          return {
            label: active?.textContent.trim(),
            outlineStyle: active ? getComputedStyle(active).outlineStyle : '',
            outlineWidth: active ? getComputedStyle(active).outlineWidth : '',
            containerOverflow: links ? getComputedStyle(links).overflow : ''
          };
        }
        """
    )
    if "设置" not in focus["label"] or focus["outlineStyle"] == "none" or focus["outlineWidth"] == "0px":
        raise AssertionError(f"{case_name}/{route_name}: keyboard focus is not visible")
    if page.viewport_size["width"] <= 640 and focus["containerOverflow"] != "visible":
        raise AssertionError(f"{case_name}/{route_name}: focus ring can be clipped by compact nav")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for case_name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                route_results = []
                for route_name, route, expected_active in ROUTES:
                    page.goto(f"{BASE_URL}/#{route}", wait_until="networkidle")
                    page.wait_for_selector(".nav-links .nav-item")
                    expected_href = expected_href_for(expected_active)
                    page.wait_for_function(
                        "href => [...document.querySelectorAll('.nav-item[aria-current=page]')].some((item) => (item.getAttribute('href') || '').endsWith(href))",
                        arg=expected_href,
                    )
                    geometry = read_geometry(page)
                    assert_geometry(case_name, route_name, expected_active, geometry)
                    assert_focus_visible(page, case_name, route_name)
                    route_results.append({"route": route_name, "geometry": geometry})

                page.goto(f"{BASE_URL}/#/?view=browse", wait_until="networkidle")
                page.wait_for_selector(".nav-links .nav-item")
                page.screenshot(path=str(REPORT_DIR / f"nav-{case_name}-current.png"), full_page=False)
                report.append({"name": case_name, "routes": route_results})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
