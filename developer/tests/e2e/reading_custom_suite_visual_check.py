import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

from reading_suite_selector_visual_check import CASES, install_tauri_mock


BASE_URL = os.environ.get("READING_CUSTOM_SUITE_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
LONG_TITLE = "A deliberately long coastal wetlands research title used to prove that selected suite chips stay inside narrow mobile workspaces"
ASSETS = [
    {
        "id": "custom-p1",
        "title": LONG_TITLE,
        "activity": "reading",
        "category": "P1",
        "difficulty": "medium",
        "questionCount": 13,
        "payloadRef": "bundled:custom-p1",
    },
    {
        "id": "custom-p2",
        "title": "The history of public libraries",
        "activity": "reading",
        "category": "P2",
        "difficulty": "hard",
        "questionCount": 13,
        "payloadRef": "bundled:custom-p2",
    },
    {
        "id": "custom-p3",
        "title": "Language and the changing workplace",
        "activity": "reading",
        "category": "P3",
        "difficulty": "easy",
        "questionCount": 13,
        "payloadRef": "bundled:custom-p3",
    },
]


def open_custom_flow(page):
    page.goto(f"{BASE_URL}/#/?view=overview", wait_until="networkidle")
    page.wait_for_selector("[data-practice-reading-home][data-library-ready]")
    page.locator("[data-action='start-suite-mode']").click()
    page.wait_for_selector("#suite-mode-selector-modal.show")
    page.locator("#suite-frequency-scope").select_option("custom")
    page.locator("[data-suite-flow-mode='classic']").click()
    page.wait_for_selector("#custom-suite-selection-bar")


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const bar = document.querySelector('#custom-suite-selection-bar');
          const rect = (node) => node ? node.getBoundingClientRect() : null;
          const style = (node) => node ? getComputedStyle(node) : null;
          const confirm = bar?.querySelector('[data-custom-suite-confirm]');
          const cancel = bar?.querySelector('[data-custom-suite-cancel]');
          return {
            viewport: [innerWidth, innerHeight],
            pageScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            barRect: rect(bar),
            barBackground: style(bar)?.backgroundColor || '',
            barShadow: style(bar)?.boxShadow || '',
            currentText: bar?.querySelector('.custom-suite-selection-main span')?.textContent || '',
            chips: [...(bar?.querySelectorAll('.custom-suite-picked-chip') || [])].map((node) => ({
              filled: node.classList.contains('filled'),
              text: node.textContent?.trim() || '',
              rect: rect(node),
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              whiteSpace: style(node)?.whiteSpace || '',
            })),
            confirmDisabled: Boolean(confirm?.disabled),
            confirmRect: rect(confirm),
            cancelRect: rect(cancel),
          };
        }
        """
    )


def assert_geometry(name, geometry, filled_count, ready=False):
    width = geometry["viewport"][0]
    if geometry["pageScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
        raise AssertionError(f"{name}: custom suite bar creates page-level horizontal overflow")
    bar = geometry["barRect"]
    if not bar or bar["left"] < -1 or bar["right"] > width + 1:
        raise AssertionError(f"{name}: custom suite bar escapes viewport width")
    if geometry["barShadow"] not in ("none", "rgba(0, 0, 0, 0)"):
        raise AssertionError(f"{name}: custom suite bar remains a nested raised card")
    chips = geometry["chips"]
    if len(chips) != 3 or sum(chip["filled"] for chip in chips) != filled_count:
        raise AssertionError(f"{name}: P1/P2/P3 progress state is incorrect")
    for chip in chips:
        chip_rect = chip["rect"]
        if not chip_rect or chip_rect["left"] < bar["left"] - 1 or chip_rect["right"] > bar["right"] + 1:
            raise AssertionError(f"{name}: selected-title chip escapes the workflow surface")
    if width <= 640:
        if any(chip["whiteSpace"] != "normal" for chip in chips):
            raise AssertionError(f"{name}: mobile chips do not wrap long titles")
        if any(chip["rect"]["width"] < min(220, bar["width"] - 40) for chip in chips):
            raise AssertionError(f"{name}: mobile chip column collapsed")
    if ready == geometry["confirmDisabled"]:
        raise AssertionError(f"{name}: confirm disabled state does not match suite readiness")
    for key in ("confirmRect", "cancelRect"):
        control = geometry[key]
        if not control or control["height"] < 42 or control["right"] > bar["right"] + 1:
            raise AssertionError(f"{name}: custom suite action is clipped or too small")
        if width <= 640 and control["width"] < 100:
            raise AssertionError(f"{name}: mobile custom suite action column collapsed")


def choose(page, asset_id, filled_count):
    button = page.locator(f"[data-reading-asset-id='{asset_id}'] [data-action='start']")
    button.wait_for(state="visible")
    button.click()
    page.wait_for_function(
        "count => document.querySelectorAll('#custom-suite-selection-bar .custom-suite-picked-chip.filled').length === count",
        arg=filled_count,
    )


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page, ASSETS)
                open_custom_flow(page)

                selecting = read_geometry(page)
                assert_geometry(f"{name}: selecting", selecting, 0)
                if "P1" not in selecting["currentText"]:
                    raise AssertionError(f"{name}: custom flow did not begin at P1")

                choose(page, "custom-p1", 1)
                long_title = read_geometry(page)
                assert_geometry(f"{name}: long-title", long_title, 1)
                if LONG_TITLE not in long_title["chips"][0]["text"]:
                    raise AssertionError(f"{name}: selected long title was not retained")
                page.screenshot(path=str(REPORT_DIR / f"reading-custom-suite-selecting-{name}-current.png"))

                choose(page, "custom-p2", 2)
                choose(page, "custom-p3", 3)
                ready = read_geometry(page)
                assert_geometry(f"{name}: ready", ready, 3, ready=True)
                if ready["barBackground"] == selecting["barBackground"]:
                    raise AssertionError(f"{name}: ready workflow surface lacks state contrast")
                page.screenshot(path=str(REPORT_DIR / f"reading-custom-suite-ready-{name}-current.png"))

                page.locator("[data-custom-suite-cancel]").click()
                page.wait_for_selector("#custom-suite-selection-bar", state="detached")
                report.append({"name": name, "selecting": selecting, "longTitle": long_title, "ready": ready})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
