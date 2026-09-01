import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("READING_SUITE_SELECTOR_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

ASSETS = [
    {
        "id": "selector-p1",
        "title": "A study of coastal wetlands",
        "category": "p1",
        "difficulty": "medium",
        "questionCount": 13,
    },
    {
        "id": "selector-p2",
        "title": "The history of public libraries",
        "category": "p2",
        "difficulty": "hard",
        "questionCount": 13,
    },
    {
        "id": "selector-p3",
        "title": "Language and the changing workplace",
        "category": "p3",
        "difficulty": "easy",
        "questionCount": 13,
    },
]


def install_tauri_mock(page, assets=ASSETS):
    assets_json = json.dumps(assets, ensure_ascii=False)
    script = r"""
    (() => {
      const assets = __ASSETS__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'reading_list_assets') return { ok: true, data: assets };
          if (command === 'list_history') return { ok: true, data: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null } };
          if (command === 'history_writing_statistics' || command === 'history_reading_statistics') {
            return { ok: true, data: { count: 0, latest: null, average: null } };
          }
          if (command === 'list_settings') return { ok: true, data: [] };
          if (command === 'history_get_retention_policy') return { ok: true, data: { maxTerminalAttempts: 100 } };
          if (command === 'ai_list_configs') return { ok: true, data: [] };
          if (command === 'writing_prompt_list') return { ok: true, data: [] };
          if (command === 'writing_topic_statistics') return { ok: true, data: { total: 0, byTaskType: [] } };
          if (command === 'get_app_info') return { host: 'Tauri', tauriVersion: '2', version: '0.1.0' };
          if (command === 'get_app_data_paths') return { appData: 'C:/atlas/data', backups: 'C:/atlas/backups' };
          if (command === 'list_backups') return { ok: true, data: [] };
          if (command === 'check_for_updates') return { configured: false, updateAvailable: false, message: '未配置更新源。' };
          return { ok: true, data: null };
        }
      };
    })();
    """.replace("__ASSETS__", assets_json)
    page.add_init_script(script)


def open_route(page):
    page.goto(f"{BASE_URL}/#/?view=overview", wait_until="networkidle")
    page.wait_for_selector("[data-practice-reading-home]")
    page.wait_for_selector("[data-action='start-suite-mode']")


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const modal = document.querySelector('#suite-mode-selector-modal');
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const content = modal?.querySelector('.suite-mode-selector-content');
          const body = modal?.querySelector('.suite-mode-selector-body');
          return {
            viewport: [innerWidth, innerHeight],
            modalDisplay: style(modal)?.display || '',
            contentRect: rect(content),
            headerRect: rect(modal?.querySelector('.theme-modal-header')),
            bodyRect: rect(body),
            closeRect: rect(modal?.querySelector('.theme-modal-close')),
            options: [...document.querySelectorAll('#suite-mode-selector-modal .suite-flow-option')].map((node) => {
              const description = node.querySelector('small');
              return {
                active: node.classList.contains('active'),
                display: style(node)?.display || '',
                whiteSpace: style(node)?.whiteSpace || '',
                rect: rect(node),
                descriptionRect: rect(description),
                descriptionText: description?.textContent || '',
              };
            }),
            frequencyRect: rect(modal?.querySelector('.suite-frequency-selector')),
            actionRect: rect(modal?.querySelector('.suite-mode-selector-actions')),
            pageScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            appMainZ: style(document.querySelector('.app-main'))?.zIndex || '',
            navZ: style(document.querySelector('.nav-shell'))?.zIndex || '',
          };
        }
        """
    )


def assert_bounded(name, geometry):
    width, height = geometry["viewport"]
    if geometry["pageScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{name}: selector created page-level horizontal overflow")
    content = geometry["contentRect"]
    if not content or content["left"] < -1 or content["right"] > width + 1 or content["top"] < -1 or content["bottom"] > height + 1:
        raise AssertionError(f"{name}: modal surface escapes viewport bounds")
    body = geometry["bodyRect"]
    if not body:
        raise AssertionError(f"{name}: modal body is not bounded")
    if geometry["appMainZ"] != "130":
        raise AssertionError(f"{name}: app-main stacking context was not raised above navigation")
    if geometry["navZ"] != "120":
        raise AssertionError(f"{name}: navigation stacking contract changed")


def assert_options(name, geometry):
    options = geometry["options"]
    if len(options) != 3:
        raise AssertionError(f"{name}: expected three suite flow options")
    if sum(option["active"] for option in options) != 1:
        raise AssertionError(f"{name}: selected suite flow state is ambiguous")
    if any(option["display"] != "flex" or option["whiteSpace"] != "normal" for option in options):
        raise AssertionError(f"{name}: suite options did not switch to wrapped column layout")
    width = geometry["viewport"][0]
    for option in options:
        description = option["descriptionRect"]
        if not description or description["right"] > width + 1:
            raise AssertionError(f"{name}: option description escapes the viewport")
        if option["descriptionText"] and description["width"] <= 0:
            raise AssertionError(f"{name}: option description is not rendered")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                open_route(page)

                closed = read_geometry(page)
                if closed["modalDisplay"] != "none":
                    raise AssertionError(f"{name}: selector modal is not closed on initial route")

                page.locator("[data-action='start-suite-mode']").click()
                page.wait_for_function("() => document.querySelector('#suite-mode-selector-modal')?.classList.contains('show')")
                geometry = read_geometry(page)
                assert_bounded(name, geometry)
                assert_options(name, geometry)
                page.screenshot(path=str(REPORT_DIR / f"reading-suite-selector-{name}-current.png"))

                frequency = page.locator("#suite-frequency-scope")
                frequency.select_option("high")
                if frequency.input_value() != "high":
                    raise AssertionError(f"{name}: frequency selection did not remain interactive")

                close = page.locator("#suite-mode-selector-modal .theme-modal-close")
                close.focus()
                page.keyboard.press("Tab")
                page.keyboard.press("Shift+Tab")
                focus_state = close.evaluate("node => ({ visible: node.matches(':focus-visible'), outline: getComputedStyle(node).outlineStyle })")
                if not focus_state["visible"] and focus_state["outline"] in ("none", ""):
                    raise AssertionError(f"{name}: close control has no visible focus treatment")

                page.locator("#suite-mode-selector-modal [data-suite-flow-cancel='1']").last.click()
                page.wait_for_function("() => !document.querySelector('#suite-mode-selector-modal')?.classList.contains('show')")

                page.locator("[data-action='start-suite-mode']").click()
                page.wait_for_function("() => document.querySelector('#suite-mode-selector-modal')?.classList.contains('show')")
                page.mouse.click(2, 2)
                page.wait_for_function("() => !document.querySelector('#suite-mode-selector-modal')?.classList.contains('show')")

                report.append({"name": name, "geometry": geometry})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
