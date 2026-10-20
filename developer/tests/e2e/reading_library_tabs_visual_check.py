"""Library views belong to the unified shell nav.

The old in-page tab strip is gone: 总览 / 题库 / 更多 are top-nav entries. The
reading-data tools moved into Settings, and the legacy `?view=settings` link
still redirects there. This gate walks every library view by deep link and by
nav click, and proves each lands on its own container inside the viewport.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from reading_suite_selector_visual_check import ASSETS, install_tauri_mock


BASE_URL = os.environ.get("READING_LIBRARY_TABS_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 768, 900),
    ("mobile", 390, 844),
    ("small", 360, 800),
    ("minimum", 320, 720),
)
VIEWS = (
    ("overview", "总览", "/?view=overview", "overview-view"),
    ("browse", "题库", "/?view=browse", "browse-view"),
    ("more", "更多", "/?view=more", "more-view"),
)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const root = document.querySelector('.practice-library');
          const view = document.querySelector('.practice-library .view.active');
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          return {
            viewport: [innerWidth, innerHeight],
            pageScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            rootRect: rect(root),
            rootScrollWidth: root?.scrollWidth || 0,
            rootClientWidth: root?.clientWidth || 0,
            activeView: view?.id || '',
            viewRect: rect(view),
            viewScrollWidth: view?.scrollWidth || 0,
            viewClientWidth: view?.clientWidth || 0,
            currentNav: [...document.querySelectorAll('.nav-item[aria-current="page"]')].map((node) => ({
              label: node.querySelector('.nav-label')?.textContent.trim() || '',
              href: node.getAttribute('href'),
              rect: rect(node),
            })),
            subLabel: document.querySelector('.nav-sub')?.getAttribute('aria-label') || '',
            subCurrent: [...document.querySelectorAll('.nav-sub-item[aria-current="page"]')].map((node) => ({
              label: node.textContent.trim(),
              href: node.getAttribute('href'),
            })),
          };
        }
        """
    )


def assert_geometry(case_name, expected_view, expected_nav, geometry):
    width = geometry["viewport"][0]
    if geometry["pageScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{case_name}: Library view creates page-level horizontal overflow")
    if geometry["activeView"] != expected_view:
        raise AssertionError(f"{case_name}: wrong active view {geometry['activeView']!r}")
    root = geometry["rootRect"]
    if not root or root["left"] < -1 or root["right"] > width + 1:
        raise AssertionError(f"{case_name}: Library surface escapes the viewport")
    view = geometry["viewRect"]
    if not view or view["left"] < -1 or view["right"] > width + 1 or view["width"] <= 0 or view["height"] <= 0:
        raise AssertionError(f"{case_name}: active view escapes the viewport: {view}")
    if geometry["viewScrollWidth"] > geometry["viewClientWidth"] + 1:
        raise AssertionError(f"{case_name}: active view requires hidden horizontal scrolling")
    current = geometry["currentNav"]
    if len(current) != 1 or current[0]["label"] != expected_nav:
        raise AssertionError(f"{case_name}: expected one active nav entry {expected_nav!r}, got {current}")
    if expected_view == "browse":
        if not any(item["label"] == "阅读" for item in geometry["subCurrent"]):
            raise AssertionError(f"{case_name}: 阅读 lost its active secondary entry: {geometry['subCurrent']}")
    if width <= 640 and current[0]["rect"] and current[0]["rect"]["height"] < 44:
        raise AssertionError(f"{case_name}: active nav entry is below the 44px touch target")


def open_view(page, route, target_id):
    page.goto(f"{BASE_URL}/#{route}", wait_until="networkidle")
    page.wait_for_selector("[data-practice-reading-home][data-library-ready]")
    page.wait_for_function(
        "target => document.querySelector('.practice-library .view.active')?.id === target",
        arg=target_id,
    )


def check_click_through(page, case_name):
    page.goto(f"{BASE_URL}/#/?view=overview", wait_until="networkidle")
    page.wait_for_selector("[data-practice-reading-home][data-library-ready]")
    for label, target_id in (("题库", "browse-view"), ("更多", "more-view"), ("总览", "overview-view")):
        page.locator(".nav-item").filter(has_text=label).click()
        page.wait_for_function(
            "target => document.querySelector('.practice-library .view.active')?.id === target",
            arg=target_id,
        )
        current = page.evaluate(
            "() => [...document.querySelectorAll('.nav-item[aria-current=page] .nav-label')].map((node) => node.textContent.trim())"
        )
        if current != [label]:
            raise AssertionError(f"{case_name}: clicking {label} left active nav {current}")


def check_settings_redirect(page, case_name, width):
    page.goto(f"{BASE_URL}/#/?view=settings", wait_until="networkidle")
    page.wait_for_selector(".settings-page")
    page.wait_for_selector("#settings-reading")
    state = page.evaluate(
        """
        () => {
          const section = document.querySelector('#settings-reading');
          const rect = section?.getBoundingClientRect();
          return {
            hash: location.hash,
            current: [...document.querySelectorAll('.nav-item[aria-current=page] .nav-label')].map((node) => node.textContent.trim()),
            sectionRect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null,
            pageScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
          };
        }
        """
    )
    if state["current"] != ["设置"]:
        raise AssertionError(f"{case_name}: settings redirect lost the nav state: {state}")
    if state["pageScrollWidth"] > width + 1 or state["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{case_name}: settings redirect overflows the viewport")
    section = state["sectionRect"]
    if not section or section["left"] < -1 or section["right"] > width + 1:
        raise AssertionError(f"{case_name}: reading settings section escapes the viewport: {section}")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page, ASSETS)
                views = []
                for view, nav_label, route, target_id in VIEWS:
                    open_view(page, route, target_id)
                    geometry = read_geometry(page)
                    assert_geometry(f"{name}: {view}", target_id, nav_label, geometry)
                    views.append({"view": view, "geometry": geometry})
                check_click_through(page, name)
                check_settings_redirect(page, name, width)
                page.screenshot(path=str(REPORT_DIR / f"reading-library-tabs-{name}-current.png"))
                report.append({"name": name, "views": views})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
