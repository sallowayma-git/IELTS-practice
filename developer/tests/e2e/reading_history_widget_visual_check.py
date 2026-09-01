import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("READING_HISTORY_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (
    ("desktop", 1440, 900),
    ("tablet", 1024, 768),
    ("mobile", 390, 844),
    ("small", 360, 800),
)

ASSETS = [
    {"id": "history-p1", "title": "Coastal wetland restoration", "category": "p1", "frequency": "high"},
    {"id": "history-p2", "title": "The development of public libraries", "category": "p2", "frequency": "medium"},
    {"id": "history-p3", "title": "Language change in international workplaces", "category": "p3", "frequency": "high"},
]

HISTORY = [
    {
        "id": f"history-{index}",
        "activity": "reading",
        "title": title,
        "status": "completed",
        "mode": "single",
        "submittedAt": f"2026-08-{7 - index:02d}T09:30:00.000Z",
        "durationMs": (index + 7) * 60_000,
        "scoreValue": score,
        "scoreScale": "ratio",
        "scoreLabel": "Accuracy",
        "scoreDisplay": f"{round(score * 100)}%",
        "assetId": ASSETS[index % len(ASSETS)]["id"],
        "sessionId": f"session-{index}",
    }
    for index, (title, score) in enumerate(
        (
            ("Coastal wetland restoration and long-term environmental monitoring", 0.92),
            ("The development of public libraries", 0.76),
            ("Language change in international workplaces", 0.68),
            ("Urban transport networks", 0.84),
            ("Memory and learning", 0.73),
            ("The future of coral reefs", 0.61),
        )
    )
]


def install_tauri_mock(page):
    assets_json = json.dumps(ASSETS, ensure_ascii=False)
    history_json = json.dumps(HISTORY, ensure_ascii=False)
    script = r"""
    (() => {
      const assets = __ASSETS__;
      const history = __HISTORY__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__U18_CALLS__ = [];
      const invokeMock = async (command, args = {}) => {
          window.__U18_CALLS__.push({ command, args });
          if (command === 'reading_list_assets') return { ok: true, data: assets };
          if (command === 'list_history') {
            const offset = Number(args?.query?.offset || 0);
            const limit = Number(args?.query?.limit || 20);
            const items = history.slice(offset, offset + limit);
            return { ok: true, data: { items, total: history.length, limit, offset, nextCursor: null } };
          }
          if (command === 'list_settings') return { ok: true, data: [] };
          if (command === 'history_get_retention_policy') {
            return { ok: true, data: { maxTerminalAttempts: 100 } };
          }
          if (command === 'history_writing_statistics' || command === 'history_reading_statistics') {
            return { ok: true, data: { count: history.length, latest: history[0], average: 0.76 } };
          }
          return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke: invokeMock };
      window.__TAURI_INTERNALS__.invoke = invokeMock;
    })();
    """.replace("__ASSETS__", assets_json).replace("__HISTORY__", history_json)
    page.add_init_script(script)


def open_route(page):
    page.goto(f"{BASE_URL}/#/?view=practice", wait_until="networkidle")
    page.wait_for_selector("#practice-view.active")
    try:
        page.wait_for_function("() => !document.querySelector('#history-list .loading')", timeout=5000)
    except Exception as error:
        diagnostic = page.evaluate(
            """() => ({
              calls: window.__U18_CALLS__ || [],
              historyError: document.querySelector('#practice-view .inline-message-error')?.textContent || '',
              loading: document.querySelector('#history-list .loading')?.textContent || '',
            })"""
        )
        raise AssertionError(f"Reading History fixture stayed loading: {json.dumps(diagnostic, ensure_ascii=False)}") from error
    if page.locator("#history-list .history-item").count() == 0:
        diagnostic = page.evaluate(
            """() => ({
              calls: window.__U18_CALLS__ || [],
              historyError: document.querySelector('#practice-view .inline-message-error')?.textContent || '',
              emptyText: document.querySelector('#history-list .history-empty-placeholder')?.textContent || '',
            })"""
        )
        raise AssertionError(f"Reading History fixture did not load: {json.dumps(diagnostic, ensure_ascii=False)}")


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const card = document.querySelector('#practice-custom-card');
          const rotor = card?.querySelector('.practice-custom-card__rotor');
          const front = card?.querySelector('.practice-custom-card__front');
          const back = card?.querySelector('.practice-custom-card__back');
          const trendFront = document.querySelector('#practice-trend-card .practice-trend-card__front');
          const trendCanvas = document.querySelector('#practice-trend-canvas');
          const radarCanvas = document.querySelector('#practice-radar-canvas');
          const customHeader = card?.querySelector('.practice-custom-card__front > .practice-trend-card__header');
          const actionGroups = [...document.querySelectorAll('.practice-history-header > .hero-panel__actions')];
          return {
            viewport: [innerWidth, innerHeight],
            pageScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            cardFlipped: card?.classList.contains('is-flipped') || false,
            cardRect: rect(card),
            rotorRect: rect(rotor),
            frontRect: rect(front),
            backRect: rect(back),
            backClientHeight: back?.clientHeight || 0,
            backScrollHeight: back?.scrollHeight || 0,
            backOverflow: style(back)?.overflow || '',
            trendFrontClientHeight: trendFront?.clientHeight || 0,
            trendFrontScrollHeight: trendFront?.scrollHeight || 0,
            trendCanvasPosition: style(trendCanvas)?.position || '',
            radarCanvasPosition: style(radarCanvas)?.position || '',
            customHeaderRect: rect(customHeader),
            widgetOptionsDisplay: style(back?.querySelector('.practice-custom-options'))?.display || '',
            widgetOptions: [...document.querySelectorAll('[data-practice-widget]')].map((node) => ({
              widget: node.dataset.practiceWidget || '',
              active: node.classList.contains('active'),
              pressed: node.getAttribute('aria-pressed') || '',
              whiteSpace: style(node)?.whiteSpace || '',
              rect: rect(node),
            })),
            visibleWidgets: [...document.querySelectorAll('[data-widget-type]')]
              .filter((node) => style(node)?.display !== 'none')
              .map((node) => node.dataset.widgetType),
            trendOptions: [...document.querySelectorAll('[data-practice-trend-range]')].map((node) => ({
              range: node.dataset.practiceTrendRange || '',
              pressed: node.getAttribute('aria-pressed') || '',
              rect: rect(node),
            })),
            historyHeaderRect: rect(document.querySelector('.practice-history-header')),
            filterRect: rect(actionGroups[0]),
            actionRect: rect(actionGroups[1]),
            actionDisplay: style(actionGroups[1])?.display || '',
            actionColumns: style(actionGroups[1])?.gridTemplateColumns || '',
            actions: [...(actionGroups[1]?.querySelectorAll('button') || [])].map((node) => ({
              action: node.dataset.action || '',
              text: node.textContent.trim(),
              rect: rect(node),
              whiteSpace: style(node)?.whiteSpace || '',
            })),
            recordCount: document.querySelectorAll('#history-list .history-item').length,
            selectedRecordCount: document.querySelectorAll('#history-list .history-item-selected').length,
            historyListRect: rect(document.querySelector('#history-list')),
            historyItemRect: rect(document.querySelector('#history-list .history-item')),
            recordResultRect: rect(document.querySelector('#history-list .record-result')),
            recordActionsRect: rect(document.querySelector('#history-list .record-actions-container')),
            recordResultStyle: (() => { const node = document.querySelector('#history-list .record-result'); const value = style(node); return value ? { display: value.display, width: value.width, minWidth: value.minWidth, gridColumn: value.gridColumn, flexBasis: value.flexBasis } : null; })(),
            recordActionsStyle: (() => { const node = document.querySelector('#history-list .record-actions-container'); const value = style(node); return value ? { display: value.display, width: value.width, minWidth: value.minWidth, marginLeft: value.marginLeft } : null; })(),
            overflowOffenders: [...document.querySelectorAll('.practice-library *')]
              .map((node) => ({ node, rect: rect(node) }))
              .filter(({ node, rect: itemRect }) => itemRect && itemRect.right > innerWidth + 1 && style(node)?.display !== 'none')
              .slice(0, 12)
              .map(({ node, rect: itemRect }) => ({
                selector: `${node.tagName.toLowerCase()}.${String(node.className || '').replace(/\\s+/g, '.').slice(0, 80)}`,
                right: itemRect.right,
                width: itemRect.width,
              })),
          };
        }
        """
    )


def assert_bounded(name, geometry):
    width = geometry["viewport"][0]
    if geometry["pageScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(
            f"{name}: Reading History causes page-level horizontal overflow "
            f"(viewport={width}, document={geometry['pageScrollWidth']}, body={geometry['bodyScrollWidth']})"
            f" offenders={geometry.get('overflowOffenders', [])}"
            f" history={geometry.get('historyListRect')}/{geometry.get('historyItemRect')}/{geometry.get('recordResultRect')}/{geometry.get('recordActionsRect')}"
            f" styles={geometry.get('recordResultStyle')}/{geometry.get('recordActionsStyle')}"
        )
    card = geometry["cardRect"]
    if not card or card["left"] < -1 or card["right"] > width + 1:
        raise AssertionError(f"{name}: custom widget card escapes the viewport")
    if geometry["recordCount"] != len(HISTORY):
        raise AssertionError(f"{name}: expected all mocked Reading history records")
    if len(geometry["trendOptions"]) != 4:
        raise AssertionError(f"{name}: trend range controls changed")
    if len(geometry["widgetOptions"]) != 3:
        raise AssertionError(f"{name}: custom widget choices changed")


def assert_front(name, geometry, widget):
    assert_bounded(name, geometry)
    if geometry["cardFlipped"]:
        raise AssertionError(f"{name}: custom widget card remained flipped")
    if geometry["visibleWidgets"] != [widget]:
        raise AssertionError(f"{name}: expected only the {widget} widget on the front face")


def assert_back(name, geometry):
    assert_bounded(name, geometry)
    if not geometry["cardFlipped"]:
        raise AssertionError(f"{name}: custom widget selector did not flip")
    if geometry["backScrollHeight"] > geometry["backClientHeight"] + 1 and geometry["backOverflow"] == "visible":
        raise AssertionError(f"{name}: widget choices overflow the fixed back face")
    if geometry["trendFrontScrollHeight"] > geometry["trendFrontClientHeight"] + 1:
        raise AssertionError(f"{name}: trend content still overflows its face")
    if geometry["trendCanvasPosition"] != "absolute" or geometry["radarCanvasPosition"] != "absolute":
        raise AssertionError(f"{name}: chart canvas remains in normal content flow")
    for key in ("cardRect", "rotorRect", "frontRect", "backRect"):
        if not geometry[key] or abs(geometry[key]["height"] - geometry["cardRect"]["height"]) > 1:
            raise AssertionError(f"{name}: {key} lost the card height contract")
    if sum(option["active"] for option in geometry["widgetOptions"]) != 1:
        raise AssertionError(f"{name}: widget active state is ambiguous")


def assert_mobile_controls(name, geometry):
    if geometry["viewport"][0] > 640:
        return
    action = geometry["actionRect"]
    header = geometry["historyHeaderRect"]
    if not action or not header or action["left"] < header["left"] - 1 or action["right"] > header["right"] + 1:
        raise AssertionError(f"{name}: mobile History actions escape their header")
    if len(geometry["actions"]) != 3:
        raise AssertionError(f"{name}: expected export, bulk delete, and clear actions")
    if any(button["rect"]["height"] < 44 or button["rect"]["width"] < 64 for button in geometry["actions"]):
        raise AssertionError(f"{name}: mobile History action is below the stable touch geometry: {geometry['actions']}")
    if geometry["viewport"][0] <= 360:
        header = geometry["customHeaderRect"]
        card = geometry["cardRect"]
        if not header or not card or header["right"] > card["right"] + 1:
            raise AssertionError(f"{name}: 320/360px custom widget header escapes card bounds")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                page.on("pageerror", lambda error: print(f"[U18 pageerror] {error}"))
                page.on("console", lambda message: print(f"[U18 console:{message.type}] {message.text}") if message.type == "error" else None)
                install_tauri_mock(page)
                open_route(page)

                heatmap = read_geometry(page)
                assert_front(f"{name}: heatmap", heatmap, "heatmap")

                page.locator(".practice-custom-card__flip-btn").first.click()
                page.wait_for_function("() => document.querySelector('#practice-custom-card')?.classList.contains('is-flipped')")
                back = read_geometry(page)
                assert_back(f"{name}: selector", back)

                widget_states = {}
                for widget in ("priority", "radar", "heatmap"):
                    if not page.locator("#practice-custom-card").evaluate("node => node.classList.contains('is-flipped')"):
                        page.locator(".practice-custom-card__flip-btn").first.click()
                    page.locator(f"[data-practice-widget='{widget}']").click()
                    page.wait_for_function(
                        "widget => document.querySelector(`[data-widget-type='${widget}']`)?.style.display !== 'none'",
                        arg=widget,
                    )
                    state = read_geometry(page)
                    assert_front(f"{name}: {widget}", state, widget)
                    widget_states[widget] = state

                page.locator("[data-practice-trend-range='recent20']").click()
                trend = read_geometry(page)
                selected_trend = [item["range"] for item in trend["trendOptions"] if item["pressed"] == "true"]
                if selected_trend != ["recent20"]:
                    raise AssertionError(f"{name}: trend range selection contract changed")

                page.locator("#bulk-delete-btn").click()
                page.locator("#history-list .history-item").first.click()
                bulk = read_geometry(page)
                if bulk["selectedRecordCount"] != 1:
                    raise AssertionError(f"{name}: bulk selection state was not preserved")
                assert_mobile_controls(f"{name}: actions", bulk)

                page.screenshot(path=str(REPORT_DIR / f"reading-history-widget-{name}-current.png"), full_page=True)
                report.append({
                    "name": name,
                    "heatmap": heatmap,
                    "back": back,
                    "widgets": widget_states,
                    "trend": trend,
                    "bulk": bulk,
                })
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
