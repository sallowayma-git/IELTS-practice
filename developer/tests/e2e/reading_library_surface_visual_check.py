import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("READING_LIBRARY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

ASSETS = [
    {
        "id": "pdf-visual-1",
        "title": "A study of coastal wetlands",
        "category": "p1",
        "difficulty": "medium",
        "pdfOnly": True,
        "questionCount": 13,
    }
]


def install_tauri_mock(page):
    assets_json = json.dumps(ASSETS, ensure_ascii=False)
    script = r"""
    (() => {
      const assets = __ASSETS__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'reading_list_assets') return { ok: true, data: assets };
          if (command === 'reading_get_pdf_data_url') {
            return { ok: true, data: 'data:application/pdf;base64,JVBERi0xLjQK' };
          }
          if (command === 'list_history') {
            return { ok: true, data: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null } };
          }
          if (command === 'history_writing_statistics' || command === 'history_reading_statistics') {
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
          if (command === 'get_app_info') return { host: 'Tauri', tauriVersion: '2', version: '0.1.0' };
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
    """.replace("__ASSETS__", assets_json)
    page.add_init_script(script)


def open_route(page, route):
    page.goto(f"{BASE_URL}/#{route}", wait_until="networkidle")
    page.wait_for_selector("[data-practice-reading-home]")


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const activeView = document.querySelector('.practice-library .view.active');
          const root = document.querySelector('[data-practice-reading-home]');
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          return {
            viewport: [innerWidth, innerHeight],
            activeId: activeView?.id || '',
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            activeShadow: style(activeView)?.boxShadow || '',
            activeRect: rect(activeView),
            toolCards: [...document.querySelectorAll('#more-view .tool-card')].map((node) => ({
              shadow: style(node)?.boxShadow || '',
              background: style(node)?.backgroundColor + style(node)?.backgroundImage,
              rect: rect(node),
            })),
            settingPanels: [...document.querySelectorAll('#reading-preferences-view .hero-settings-group > .hero-panel')].map((node) => ({
              shadow: style(node)?.boxShadow || '',
              rect: rect(node),
            })),
            config: (() => {
              const node = document.querySelector('[data-reading-library-config-list]');
              const card = node?.querySelector('.backup-list-card');
              return node ? {
                visible: style(node)?.display !== 'none',
                cardShadow: style(card)?.boxShadow || '',
                cardRect: rect(card),
              } : null;
            })(),
            clock: (() => {
              const node = document.querySelector('#fullscreen-clock-overlay:not(.is-hidden)');
              const inner = node?.querySelector('.clock-overlay-inner');
              return node ? {
                position: style(node)?.position || '',
                innerRect: rect(inner),
                innerShadow: style(inner)?.boxShadow || '',
              } : null;
            })(),
            pdf: (() => {
              const node = document.querySelector('.pdf-viewer-overlay');
              const dialog = node?.querySelector('.pdf-viewer-dialog');
              return node ? {
                position: style(node)?.position || '',
                dialogRect: rect(dialog),
                dialogShadow: style(dialog)?.boxShadow || '',
              } : null;
            })(),
            root: rect(root),
          };
        }
        """
    )


def assert_page_geometry(name, geometry):
    width = geometry["viewport"][0]
    if geometry["documentScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{name}: Reading Library causes page-level horizontal overflow")
    active = geometry["activeRect"]
    if not active or active["width"] <= 0:
        raise AssertionError(f"{name}: active Reading Library view is not bounded")
    if geometry["activeShadow"] in ("", "none"):
        raise AssertionError(f"{name}: active Reading Library workspace lost its raised surface")


def assert_tool_surface(name, geometry):
    assert_page_geometry(name, geometry)
    cards = geometry["toolCards"]
    if len(cards) != 3:
        raise AssertionError(f"{name}: expected three More Tools cards")
    if any(card["shadow"] not in ("none", "rgba(0, 0, 0, 0)") for card in cards):
        raise AssertionError(f"{name}: More Tools cards still render as nested raised surfaces")
    if len({card["background"] for card in cards}) < 2:
        raise AssertionError(f"{name}: featured tool card lost selected surface contrast")


def assert_settings_surface(name, geometry):
    assert_page_geometry(name, geometry)
    panels = geometry["settingPanels"]
    if len(panels) != 4:
        raise AssertionError(f"{name}: expected four Reading Settings panels")
    if any(panel["shadow"] not in ("none", "rgba(0, 0, 0, 0)") for panel in panels):
        raise AssertionError(f"{name}: Reading Settings child panels remain raised cards")


def assert_overlay(name, geometry, key):
    overlay = geometry[key]
    if not overlay:
        raise AssertionError(f"{name}: {key} overlay did not open")
    if overlay["position"] != "fixed":
        raise AssertionError(f"{name}: {key} overlay is not viewport-bound")
    rect = overlay["innerRect"] if key == "clock" else overlay["dialogRect"]
    if not rect or rect["left"] < -1 or rect["right"] > geometry["viewport"][0] + 1:
        raise AssertionError(f"{name}: {key} surface escapes viewport width")
    shadow = overlay["innerShadow"] if key == "clock" else overlay["dialogShadow"]
    if shadow in ("", "none"):
        raise AssertionError(f"{name}: {key} surface lost its elevated layer")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)

                open_route(page, "/?view=more")
                more_geometry = read_geometry(page)
                assert_tool_surface(f"{name}: more", more_geometry)
                page.locator("#more-view [data-action='open-clock']").click()
                clock_geometry = read_geometry(page)
                assert_overlay(f"{name}: clock", clock_geometry, "clock")
                page.locator("#fullscreen-clock-overlay .clock-close-btn").click()
                page.wait_for_function("() => document.querySelector('#fullscreen-clock-overlay')?.classList.contains('is-hidden')")

                open_route(page, "/?view=settings")
                settings_geometry = read_geometry(page)
                assert_settings_surface(f"{name}: settings", settings_geometry)
                page.locator("#library-config-btn").click()
                page.wait_for_selector("[data-reading-library-config-list]")
                config_geometry = read_geometry(page)
                assert_settings_surface(f"{name}: config", config_geometry)
                config = config_geometry["config"]
                if not config or config["cardShadow"] not in ("none", "rgba(0, 0, 0, 0)"):
                    raise AssertionError(f"{name}: library config remains a nested raised card")
                page.locator(".reading-library-config-list .backup-list-dismiss").click()
                page.wait_for_selector("[data-reading-library-config-list]", state="detached")

                open_route(page, "/?view=browse")
                page.wait_for_selector("[data-reading-asset-id='pdf-visual-1']")
                page.locator("[data-reading-asset-id='pdf-visual-1'] [data-action='pdf']").click()
                page.wait_for_selector(".pdf-viewer-overlay")
                pdf_geometry = read_geometry(page)
                assert_overlay(f"{name}: pdf", pdf_geometry, "pdf")
                page.locator(".pdf-viewer-overlay .pdf-viewer-header .btn-text").click()
                page.wait_for_selector(".pdf-viewer-overlay", state="detached")

                page.screenshot(path=str(REPORT_DIR / f"reading-library-surfaces-{name}-current.png"))
                report.append({"name": name, "more": more_geometry, "settings": settings_geometry, "config": config_geometry, "clock": clock_geometry, "pdf": pdf_geometry})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
