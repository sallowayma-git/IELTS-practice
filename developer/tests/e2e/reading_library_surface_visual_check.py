import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright
from visual_test_support import assert_flat_surfaces, capture_state


BASE_URL = os.environ.get("READING_LIBRARY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

# Real AssetIndexEntry rows: category is stored raw (uppercase P1/P2/P3),
# difficulty is null for every shipped reading asset, and question counts are
# not part of the index (they come from the asset payload).
ASSETS = [
    {
        "id": "pdf-visual-1",
        "title": "A study of coastal wetlands",
        "category": "P1",
        "difficulty": None,
        "frequency": "medium",
        "fingerprint": "fp-pdf-visual-1",
        "schemaVersion": 2,
        "contentRef": None,
        "payloadRef": None,
        "activity": "reading",
        "pdfOnly": True,
    }
]


# Real shape of `reading_list_assets`: CommandResponse<Vec<AssetIndexEntry>>.
REAL_LIST_RESPONSE = "{ ok: true, data: assets }"


def install_tauri_mock(page, list_response=REAL_LIST_RESPONSE):
    assets_json = json.dumps(ASSETS, ensure_ascii=False)
    script = r"""
    (() => {
      const assets = __ASSETS__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'reading_list_assets') return __LIST_RESPONSE__;
          if (command === 'reading_get_pdf_data_url') {
            return { ok: true, data: 'data:application/pdf;base64,JVBERi0xLjQK' };
          }
          if (command === 'list_history') {
            return { ok: true, data: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null } };
          }
          if (command === 'history_writing_statistics') {
            return { ok: true, data: { count: 0 } };
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
          if (command === 'get_app_info') return { name: 'ielts-practice', version: '0.1.0', tauriVersion: '2', productName: 'IELTS Practice', host: 'tauri' };
          if (command === 'get_app_data_paths') {
            return { appData: 'C:/atlas/data', logs: 'C:/atlas/logs', backups: 'C:/atlas/backups', imports: 'C:/atlas/imports', exports: 'C:/atlas/exports', diagnostics: 'C:/atlas/diagnostics', dbDir: 'C:/atlas/data/db' };
          }
          if (command === 'list_backups') return { ok: true, data: [] };
          if (command === 'check_for_updates') {
            return { configured: false, updateAvailable: false, installed: false, requiresRestart: false, currentVersion: '0.1.0', latestVersion: null, body: null, stage: 'unconfigured', message: '此构建未配置签名更新通道。' };
          }
          return { ok: true, data: null };
        }
      };
    })();
    """.replace("__ASSETS__", assets_json).replace("__LIST_RESPONSE__", list_response)
    page.add_init_script(script)


# Overview truth: real counts for the real bare-array response; any other shape
# (envelope, malformed, backend failure) shows '—' plus one human error line,
# never exception text.
OVERVIEW_VARIANTS = (
    # (name, mock response, expected P1/P2/P3 meta text, error expected)
    ("array", REAL_LIST_RESPONSE, ("1 篇题目", "0 篇题目", "0 篇题目"), False),
    ("envelope", "{ ok: true, data: { items: assets, total: 1, limit: 20, offset: 0 } }", ("—", "—", "—"), True),
    ("empty", "{ ok: true, data: [] }", ("0 篇题目", "0 篇题目", "0 篇题目"), False),
    ("null", "{ ok: true, data: null }", ("0 篇题目", "0 篇题目", "0 篇题目"), False),
    ("malformed", "{ ok: true, data: { total: 1 } }", ("—", "—", "—"), True),
    ("backend-failure", "{ ok: false, error: { code: 'db.locked', message: 'database is locked' } }", ("—", "—", "—"), True),
)
RAW_ERROR_PATTERN = re.compile(r"slice|is not a function|TypeError|unexpected response|database is locked|reading_list_assets", re.I)


def read_overview(page):
    return page.evaluate(
        """
        () => ({
          meta: ['P1', 'P2', 'P3'].map((category) => (
            document.querySelector(`[data-reading-category-card="${category}"] .category-meta`)?.textContent.trim() || ''
          )),
          error: document.querySelector('#overview-view [data-reading-library-error]')?.textContent.trim() || '',
        })
        """
    )


def check_overview_truth(browser):
    results = []
    for name, response, expected_meta, expect_error in OVERVIEW_VARIANTS:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        install_tauri_mock(page, response)
        open_route(page, "/")
        page.wait_for_selector("[data-reading-category-card='P1']")
        # The index read is async: wait for its settled outcome, never a fixed timeout.
        if expect_error:
            page.wait_for_selector("#overview-view [data-reading-library-error]")
        else:
            page.wait_for_function(
                "() => document.querySelector('[data-reading-category-card=\"P1\"] .category-meta')?.textContent.trim() !== '—'"
            )
        overview = read_overview(page)
        if page_errors:
            raise AssertionError(f"overview {name}: uncaught page error {page_errors}")
        if tuple(overview["meta"]) != expected_meta:
            raise AssertionError(f"overview {name}: category counts {overview['meta']} != {list(expected_meta)}")
        if expect_error:
            if not overview["error"].startswith("阅读题库读取失败"):
                raise AssertionError(f"overview {name}: missing human load error, got {overview['error']!r}")
            if RAW_ERROR_PATTERN.search(overview["error"]):
                raise AssertionError(f"overview {name}: raw exception text leaked: {overview['error']!r}")
        elif overview["error"]:
            raise AssertionError(f"overview {name}: unexpected error line {overview['error']!r}")
        if name in ("array", "malformed"):
            capture_state(page, f"reading-library-overview-{name}-desktop")
        results.append({"name": name, **overview})
        page.close()
    return results


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
                innerOutline: parseFloat(style(inner)?.borderTopWidth || '0'),
              } : null;
            })(),
            pdf: (() => {
              const node = document.querySelector('.pdf-viewer-overlay');
              const dialog = node?.querySelector('.pdf-viewer-dialog');
              return node ? {
                position: style(node)?.position || '',
                dialogRect: rect(dialog),
                dialogOutline: parseFloat(style(dialog)?.borderTopWidth || '0'),
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
    # Paper theme: the active view sits directly on the canvas, never raised.
    if geometry["activeShadow"] not in ("", "none"):
        raise AssertionError(f"{name}: active Reading Library workspace is raised off the paper")


def assert_tool_surface(name, geometry):
    assert_page_geometry(name, geometry)
    cards = geometry["toolCards"]
    if len(cards) != 3:
        raise AssertionError(f"{name}: expected three More Tools cards")


def assert_settings_surface(name, geometry):
    assert_page_geometry(name, geometry)
    panels = geometry["settingPanels"]
    if len(panels) != 4:
        raise AssertionError(f"{name}: expected four Reading Settings panels")


def assert_overlay(name, geometry, key):
    overlay = geometry[key]
    if not overlay:
        raise AssertionError(f"{name}: {key} overlay did not open")
    if overlay["position"] != "fixed":
        raise AssertionError(f"{name}: {key} overlay is not viewport-bound")
    rect = overlay["innerRect"] if key == "clock" else overlay["dialogRect"]
    if not rect or rect["left"] < -1 or rect["right"] > geometry["viewport"][0] + 1:
        raise AssertionError(f"{name}: {key} surface escapes viewport width")
    # A floating layer is set off by a ruled outline over the scrim, not a shadow.
    outline = overlay["innerOutline"] if key == "clock" else overlay["dialogOutline"]
    if outline < 1:
        raise AssertionError(f"{name}: {key} surface lost its outlined layer")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            overview_truth = check_overview_truth(browser)
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)

                open_route(page, "/?view=more")
                more_geometry = read_geometry(page)
                assert_tool_surface(f"{name}: more", more_geometry)
                assert_flat_surfaces(page, '#more-view .tool-card', f'{name}: tools')
                capture_state(page, f'reading-tools-{name}')
                page.locator("#more-view [data-action='open-clock']").click()
                clock_geometry = read_geometry(page)
                assert_overlay(f"{name}: clock", clock_geometry, "clock")
                capture_state(page, f'reading-clock-{name}')
                page.locator("#fullscreen-clock-overlay .clock-close-btn").click()
                page.wait_for_function("() => document.querySelector('#fullscreen-clock-overlay')?.classList.contains('is-hidden')")

                open_route(page, "/?view=settings")
                settings_geometry = read_geometry(page)
                assert_settings_surface(f"{name}: settings", settings_geometry)
                assert_flat_surfaces(page, '.hero-settings-group > .hero-panel', f'{name}: settings')
                capture_state(page, f'reading-settings-{name}')
                page.locator("#library-config-btn").click()
                page.wait_for_selector("[data-reading-library-config-list]")
                config_geometry = read_geometry(page)
                assert_settings_surface(f"{name}: config", config_geometry)
                config = config_geometry["config"]
                if not config:
                    raise AssertionError(f"{name}: library config is missing")
                assert_flat_surfaces(page, '[data-reading-library-config-list] > .backup-list-card', f'{name}: config')
                capture_state(page, f'reading-config-{name}')
                page.locator(".reading-library-config-list .backup-list-dismiss").click()
                page.wait_for_selector("[data-reading-library-config-list]", state="detached")

                open_route(page, "/?view=browse")
                page.wait_for_selector("[data-reading-asset-id='pdf-visual-1']")
                page.locator("[data-reading-asset-id='pdf-visual-1'] [data-action='pdf']").click()
                page.wait_for_selector(".pdf-viewer-overlay")
                pdf_geometry = read_geometry(page)
                assert_overlay(f"{name}: pdf", pdf_geometry, "pdf")
                capture_state(page, f'reading-pdf-{name}')
                page.locator(".pdf-viewer-overlay .pdf-viewer-header .btn-text").click()
                page.wait_for_selector(".pdf-viewer-overlay", state="detached")

                page.screenshot(path=str(REPORT_DIR / f"reading-library-surfaces-{name}-current.png"))
                report.append({"name": name, "more": more_geometry, "settings": settings_geometry, "config": config_geometry, "clock": clock_geometry, "pdf": pdf_geometry})
                page.close()
        finally:
            browser.close()
    print(json.dumps({"overviewTruth": overview_truth, "surfaces": report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
