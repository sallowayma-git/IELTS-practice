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
VIEW_IDS = {
    "overview": "overview-view",
    "browse": "browse-view",
    "practice": "practice-view",
    "more": "more-view",
    "settings": "reading-preferences-view",
}


def open_route(page):
    page.goto(f"{BASE_URL}/#/?view=overview", wait_until="networkidle")
    page.wait_for_selector("[data-practice-reading-home][data-library-ready]")


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const tabs = document.querySelector('.practice-library .library-view-tabs');
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          return {
            viewport: [innerWidth, innerHeight],
            pageScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            tabsRect: rect(tabs),
            tabsDisplay: style(tabs)?.display || '',
            tabsColumns: style(tabs)?.gridTemplateColumns || '',
            tabsClientWidth: tabs?.clientWidth || 0,
            tabsScrollWidth: tabs?.scrollWidth || 0,
            activeView: document.querySelector('.practice-library .view.active')?.id || '',
            buttons: [...document.querySelectorAll('.practice-library .library-view-tabs__button')].map((node) => ({
              view: node.dataset.view || '',
              active: node.classList.contains('active'),
              current: node.getAttribute('aria-current') || '',
              rect: rect(node),
              whiteSpace: style(node)?.whiteSpace || '',
            })),
          };
        }
        """
    )


def assert_geometry(name, geometry):
    width = geometry["viewport"][0]
    if geometry["pageScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{name}: Library tabs create page-level horizontal overflow")
    tabs = geometry["tabsRect"]
    if not tabs or tabs["left"] < -1 or tabs["right"] > width + 1:
        raise AssertionError(f"{name}: Library tab container escapes viewport width")
    buttons = geometry["buttons"]
    if len(buttons) != 5 or {button["view"] for button in buttons} != set(VIEW_IDS):
        raise AssertionError(f"{name}: expected all five stable Library view entries")
    if sum(button["active"] for button in buttons) != 1 or sum(button["current"] == "page" for button in buttons) != 1:
        raise AssertionError(f"{name}: Library tab active semantics are ambiguous")
    for button in buttons:
        control = button["rect"]
        if not control or control["left"] < tabs["left"] - 1 or control["right"] > tabs["right"] + 1:
            raise AssertionError(f"{name}: Library view entry is hidden outside the tab container")
    if width <= 640:
        if geometry["tabsDisplay"] != "grid" or len(geometry["tabsColumns"].split()) != 3:
            raise AssertionError(f"{name}: mobile Library tabs are not a 3-column grid")
        if geometry["tabsScrollWidth"] > geometry["tabsClientWidth"] + 1:
            raise AssertionError(f"{name}: mobile Library tabs still require hidden horizontal scrolling")
        if any(button["rect"]["height"] < 44 for button in buttons):
            raise AssertionError(f"{name}: mobile Library view entry is below the 44px touch target")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page, ASSETS)
                open_route(page)

                initial = read_geometry(page)
                assert_geometry(f"{name}: overview", initial)
                for view, target_id in VIEW_IDS.items():
                    page.locator(f".library-view-tabs__button[data-view='{view}']").click()
                    page.wait_for_function(
                        "target => document.querySelector('.practice-library .view.active')?.id === target",
                        arg=target_id,
                    )
                    state = read_geometry(page)
                    assert_geometry(f"{name}: {view}", state)
                    active = next(button for button in state["buttons"] if button["active"])
                    if active["view"] != view or active["current"] != "page":
                        raise AssertionError(f"{name}: {view} lost its active/aria-current contract")

                page.screenshot(path=str(REPORT_DIR / f"reading-library-tabs-{name}-current.png"))
                report.append({"name": name, "initial": initial, "final": read_geometry(page)})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
