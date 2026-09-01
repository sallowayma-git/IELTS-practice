import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("READING_SUITE_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)
SESSION_ID = "suite-visual-1"

SUITE = {
    "sessionId": SESSION_ID,
    "status": "active",
    "currentIndex": 0,
    "flowMode": "simulation",
    "frequencyScope": "all",
    "aggregate": {
        "submittedPassages": 1,
        "totalPassages": 3,
        "percentage": 72,
        "correct": 18,
        "totalQuestions": 25,
    },
    "sequence": [
        {
            "assetId": "reading-active",
            "index": 0,
            "category": "P1",
            "title": "The future of urban transport",
            "status": "active",
            "sessionId": None,
            "scoreInfo": None,
        },
        {
            "assetId": "reading-submitted",
            "index": 1,
            "category": "P2",
            "title": "How coastal wetlands protect cities",
            "status": "submitted",
            "sessionId": "attempt-submitted",
            "scoreInfo": {"correct": 18, "totalQuestions": 25, "percentage": 72},
        },
        {
            "assetId": "reading-locked",
            "index": 2,
            "category": "P3",
            "title": "The science of long-distance memory",
            "status": "pending",
            "sessionId": None,
            "scoreInfo": None,
        },
    ],
}


def install_tauri_mock(page):
    suite_json = json.dumps(SUITE, ensure_ascii=False)
    script = r"""
    (() => {
      const suite = __SUITE__;
      window.__suiteMode = 'success';
      window.__resolveSuite = null;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'suite_get') {
            if (window.__suiteMode === 'loading') {
              return await new Promise((resolve) => {
                window.__resolveSuite = () => resolve({ ok: true, data: suite });
              });
            }
            if (window.__suiteMode === 'error') {
              return { ok: false, error: { code: 'suite.load_failed', message: '套题状态暂时无法读取', retryable: true } };
            }
            if (window.__suiteMode === 'empty') return { ok: true, data: null };
            return { ok: true, data: suite };
          }
          return { ok: true, data: null };
        }
      };
    })();
    """.replace("__SUITE__", suite_json)
    page.add_init_script(script)


def set_mode(page, mode):
    page.evaluate("mode => { window.__suiteMode = mode; }", mode)


def open_suite(page):
    page.goto(f"{BASE_URL}/#/reading-suite/{SESSION_ID}", wait_until="networkidle")
    page.wait_for_selector("[data-reading-suite-page]")


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const shell = document.querySelector('.atlas-source-ui');
          const nav = document.querySelector('.nav-shell');
          const summary = document.querySelector('[data-reading-suite-summary]');
          const passages = document.querySelector('.suite-passages');
          const rows = [...document.querySelectorAll('[data-reading-suite-passage]')];
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          return {
            viewport: [innerWidth, innerHeight],
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            navVisible: Boolean(nav),
            mainFrameless: document.querySelector('.app-main')?.classList.contains('app-main--frameless'),
            summaryShadow: summary ? getComputedStyle(summary).boxShadow : '',
            passagesShadow: passages ? getComputedStyle(passages).boxShadow : '',
            summaryRect: rect(summary),
            passagesRect: rect(passages),
            rows: rows.map((row) => {
              const style = getComputedStyle(row);
              const index = row.querySelector('.passage-index');
              const action = row.querySelector('.passage-actions button');
              return {
                status: row.className,
                shadow: style.boxShadow,
                background: style.backgroundColor + style.backgroundImage,
                indexBackground: index ? getComputedStyle(index).backgroundColor + getComputedStyle(index).backgroundImage : '',
                actionText: action?.textContent.trim() || '',
                text: row.textContent.trim(),
                rect: rect(row),
              };
            }),
          };
        }
        """
    )


def assert_no_overflow(name, geometry):
    width = geometry["viewport"][0]
    if geometry["documentScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{name}: reading suite causes page-level horizontal overflow")
    if geometry["navVisible"]:
        raise AssertionError(f"{name}: frameless suite route unexpectedly renders the shell nav")
    if not geometry["mainFrameless"]:
        raise AssertionError(f"{name}: suite route is not using frameless app main")


def assert_success(name, width, geometry):
    assert_no_overflow(name, geometry)
    if geometry["summaryShadow"] in ("", "none") or geometry["passagesShadow"] in ("", "none"):
        raise AssertionError(f"{name}: suite workspace lost its raised surfaces")
    if len(geometry["rows"]) != 3:
        raise AssertionError(f"{name}: expected active/submitted/locked passage rows")
    rows = geometry["rows"]
    if len({row["background"] for row in rows}) != 3:
        raise AssertionError(f"{name}: passage row state surfaces are not visually distinct")
    active = next(row for row in rows if "passage-row--active" in row["status"])
    submitted = next(row for row in rows if "passage-row--submitted" in row["status"])
    locked = next(row for row in rows if "passage-row--pending" in row["status"])
    if submitted["shadow"] not in ("none", "rgba(0, 0, 0, 0)") or locked["shadow"] not in ("none", "rgba(0, 0, 0, 0)"):
        raise AssertionError(f"{name}: passive passage rows still behave as nested raised cards")
    if active["actionText"] != "开始":
        raise AssertionError(f"{name}: active row lost its start action")
    if submitted["actionText"] != "复盘":
        raise AssertionError(f"{name}: submitted row lost its review action")
    if locked["actionText"]:
        raise AssertionError(f"{name}: locked row exposes an action button")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                open_suite(page)
                page.wait_for_selector("[data-reading-suite-summary]")

                geometry = read_geometry(page)
                assert_success(f"{name}: success", width, geometry)
                page.locator("[data-reading-suite-start-current]").click()
                page.wait_for_url("**/#/reading/reading-active?suiteSessionId=suite-visual-1")
                page.go_back(wait_until="networkidle")
                page.wait_for_selector("[data-reading-suite-summary]")

                set_mode(page, "loading")
                page.locator(".suite-actions .btn-secondary").nth(1).click()
                page.wait_for_selector(".reading-suite-page > .loading")
                loading = read_geometry(page)
                assert_no_overflow(f"{name}: loading", loading)
                loading_surface = page.locator(".reading-suite-page > .loading")
                if loading_surface.evaluate("node => getComputedStyle(node).boxShadow") not in ("none", "rgba(0, 0, 0, 0)"):
                    raise AssertionError(f"{name}: loading state is still a raised card")
                page.wait_for_function("() => typeof window.__resolveSuite === 'function'")
                page.evaluate("() => window.__resolveSuite()")
                page.wait_for_selector("[data-reading-suite-summary]")

                set_mode(page, "error")
                page.locator(".suite-actions .btn-secondary").nth(1).click()
                page.wait_for_selector(".inline-message-error")
                error = read_geometry(page)
                assert_no_overflow(f"{name}: error", error)
                if page.locator(".inline-message-error .btn-text").count() != 1:
                    raise AssertionError(f"{name}: error state lost retry action")

                set_mode(page, "empty")
                page.locator(".inline-message-error .btn-text").click()
                page.wait_for_selector(".suite-empty-state")
                empty = read_geometry(page)
                assert_no_overflow(f"{name}: empty", empty)
                if page.locator(".suite-empty-state a").count() != 1:
                    raise AssertionError(f"{name}: empty state lost library return link")

                set_mode(page, "success")
                page.locator(".suite-empty-state a").click()
                page.wait_for_url("**/#/")
                open_suite(page)
                page.wait_for_selector("[data-reading-suite-summary]")
                page.screenshot(path=str(REPORT_DIR / f"reading-suite-{name}-current.png"))
                report.append({"name": name, "success": geometry, "loading": loading, "error": error, "empty": empty})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
