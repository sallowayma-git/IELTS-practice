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
STATES = ("loading", "error", "empty", "filtered")


def install_tauri_mock(page, initial_mode):
    script = r"""
    (() => {
      window.__historyPageStateMode = '__MODE__';
      window.__historyPageStateCalls = [];
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const invoke = async (command, args = {}) => {
        window.__historyPageStateCalls.push({ command, args });
        if (command === 'list_history') {
          if (window.__historyPageStateMode === 'loading') {
            return await new Promise(() => {});
          }
          if (window.__historyPageStateMode === 'error') {
            return {
              ok: false,
              error: {
                code: 'history.list_failed',
                message: '历史记录暂时无法读取',
                retryable: true
              }
            };
          }
          return {
            ok: true,
            data: { items: [], total: 0, limit: 20, offset: 0, nextCursor: null }
          };
        }
        if (command === 'history_writing_statistics') {
          return { ok: true, data: { count: 0, latest: null, average: null } };
        }
        return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__MODE__", initial_mode)
    page.add_init_script(script)


def prepare_state(page, state):
    if state == "loading":
        page.wait_for_selector(".history-page > .loading")
    elif state == "error":
        page.wait_for_selector(".history-page > .error-state")
    else:
        page.wait_for_selector(".history-page > .empty-state")
        if state == "filtered":
            page.evaluate("() => { window.__historyPageStateMode = 'filtered'; }")
            page.locator("#history-search").fill("no matching practice")
            page.wait_for_function(
                "() => document.querySelector('.history-page > .empty-state')?.textContent.includes('当前筛选条件无结果')"
            )
    page.wait_for_function(
        """
        () => {
          const state = document.querySelector(
            '.history-page > :is(.loading, .error-state, .empty-state)'
          );
          return state && getComputedStyle(state).display === 'grid';
        }
        """
    )


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const state = document.querySelector('.history-page > :is(.loading, .error-state, .empty-state)');
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const buttons = [...(state?.querySelectorAll('button') || [])];
          const headerButtons = [...document.querySelectorAll('.history-page .header-actions button')];
          return {
            viewport: [innerWidth, innerHeight],
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            stateClass: state?.className || '',
            stateRect: rect(state),
            stateDisplay: style(state)?.display || '',
            stateMinHeight: parseFloat(style(state)?.minHeight || '0'),
            statePaddingTop: parseFloat(style(state)?.paddingTop || '0'),
            role: state?.getAttribute('role') || '',
            ariaLive: state?.getAttribute('aria-live') || '',
            ariaBusy: state?.getAttribute('aria-busy') || '',
            message: state?.textContent.trim() || '',
            hasSpinner: Boolean(state?.querySelector('.history-state-spinner')),
            buttons: buttons.map((node) => ({ text: node.textContent.trim(), rect: rect(node) })),
            headerDisabled: headerButtons.map((node) => node.disabled),
            calls: window.__historyPageStateCalls
          };
        }
        """
    )


def assert_geometry(name, state, data):
    width = data["viewport"][0]
    if data["documentWidth"] > width + 1 or data["bodyWidth"] > width + 1:
        raise AssertionError(f"{name}/{state}: History page overflows viewport")
    if "history-list-state" not in data["stateClass"] or not data["stateRect"]:
        raise AssertionError(f"{name}/{state}: page state has no shared visual owner: {json.dumps(data, ensure_ascii=False)}")
    if data["stateDisplay"] != "grid":
        raise AssertionError(f"{name}/{state}: state surface is not a stable grid")
    minimum_height = 160 if width <= 640 else 180
    if (
        data["stateMinHeight"] < minimum_height
        or data["stateRect"]["height"] + 0.5 < minimum_height
    ):
        raise AssertionError(
            f"{name}/{state}: state surface collapses below {minimum_height}px: "
            f"min-height={data['stateMinHeight']}, height={data['stateRect']['height']}"
        )
    if data["stateRect"]["left"] < -1 or data["stateRect"]["right"] > width + 1:
        raise AssertionError(f"{name}/{state}: state surface escapes viewport")
    expected_role = "alert" if state == "error" else "status"
    if data["role"] != expected_role or not data["ariaLive"]:
        raise AssertionError(f"{name}/{state}: state semantics are incomplete")
    if state == "loading":
        if data["ariaBusy"] != "true" or not data["hasSpinner"]:
            raise AssertionError(f"{name}/{state}: loading state has no busy/spinner contract")
    if state in ("error", "filtered"):
        if len(data["buttons"]) != 1 or data["buttons"][0]["rect"]["height"] < 44:
            raise AssertionError(f"{name}/{state}: recovery action is not a 44px target")
    elif data["buttons"]:
        raise AssertionError(f"{name}/{state}: passive state unexpectedly renders an action")
    if len(data["headerDisabled"]) != 2 or not all(data["headerDisabled"]):
        raise AssertionError(f"{name}/{state}: destructive/export header actions are enabled without records")


def verify_recovery(page, state):
    if state == "error":
        page.evaluate("() => { window.__historyPageStateMode = 'empty'; }")
        page.locator(".history-page > .error-state button", has_text="重试").click()
        page.wait_for_selector(".history-page > .history-list-state--empty")
        return "retry"
    if state == "filtered":
        page.locator(".history-page > .empty-state button", has_text="重置筛选").click()
        page.wait_for_function("() => document.querySelector('#history-search')?.value === ''")
        page.wait_for_selector(".history-page > .history-list-state--empty")
        return "reset"
    return None


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {"status": "passed", "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for state in STATES:
                for name, width, height in CASES:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    install_tauri_mock(page, "empty" if state == "filtered" else state)
                    page_errors = []
                    page.on("pageerror", lambda error: page_errors.append(getattr(error, "stack", str(error))))
                    page.goto(f"{BASE_URL}/#/history", wait_until="domcontentloaded")
                    prepare_state(page, state)
                    geometry = read_geometry(page)
                    assert_geometry(name, state, geometry)
                    page.screenshot(
                        path=str(REPORT_DIR / f"history-page-state-{state}-{name}-current.png"),
                        full_page=True,
                    )
                    recovery = verify_recovery(page, state)
                    if page_errors:
                        raise AssertionError(f"{name}/{state}: page errors: {page_errors}")
                    report["cases"].append(
                        {"name": name, "state": state, "geometry": geometry, "recovery": recovery}
                    )
                    page.close()
        finally:
            browser.close()
    (REPORT_DIR / "history-page-states-visual-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
