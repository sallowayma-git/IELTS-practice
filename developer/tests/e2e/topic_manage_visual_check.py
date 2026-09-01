import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("TOPIC_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (("desktop", 1440, 900), ("tablet", 980, 720), ("mobile", 390, 844), ("small", 360, 640))


TOPICS = [
    {
        "id": f"topic-{index}",
        "taskType": "task1" if index % 2 else "task2",
        "category": "line_graph" if index % 2 else "education",
        "difficulty": (index % 5) + 1,
        "titleJson": '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Describe the changes shown in the chart and summarise the main trends."}]}]}',
        "imagePath": None,
        "isOfficial": index == 1,
        "usageCount": index * 2,
    }
    for index in range(1, 7)
]


def install_tauri_mock(page):
    topics_json = json.dumps(TOPICS, ensure_ascii=False)
    script = """
    (() => {
      const topics = __TOPICS__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
          if (command === 'writing_topic_list') {
            return { ok: true, data: { items: topics, total: topics.length, page: 1, limit: 12 } };
          }
          if (command === 'writing_topic_statistics') {
            return { ok: true, data: { total: topics.length, byTaskType: [] } };
          }
          if (command === 'settings_get_many') {
            return { ok: true, data: {} };
          }
          return { ok: true, data: null };
        }
      };
    })();
    """.replace("__TOPICS__", topics_json)
    page.add_init_script(script)


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                page.goto(f"{BASE_URL}/#/topics", wait_until="networkidle")
                page.wait_for_selector(".topic-manage-page .topic-card")

                geometry = page.evaluate(
                    """
                    () => {
                      const root = document.querySelector('.topic-manage-page');
                      const grid = root?.querySelector('.topic-grid');
                      const overlay = root?.querySelector('.dialog-overlay');
                      const uploader = root?.querySelector('.image-uploader');
                      return {
                        viewport: [innerWidth, innerHeight],
                        documentScrollWidth: document.documentElement.scrollWidth,
                        bodyScrollWidth: document.body.scrollWidth,
                        rootWidth: root?.getBoundingClientRect().width,
                        gridWidth: grid?.getBoundingClientRect().width,
                        columns: grid ? getComputedStyle(grid).gridTemplateColumns : '',
                        cardCount: root?.querySelectorAll('.topic-card').length,
                        overlayDisplay: overlay ? getComputedStyle(overlay).display : 'none',
                        uploaderRole: uploader?.getAttribute('role'),
                        uploaderTabIndex: uploader?.getAttribute('tabindex')
                      };
                    }
                    """
                )
                if geometry["documentScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
                    raise AssertionError(
                        f"{name}: page horizontal overflow "
                        f"{geometry['documentScrollWidth']}/{geometry['bodyScrollWidth']} > {width}"
                    )
                if geometry["cardCount"] != len(TOPICS):
                    raise AssertionError(f"{name}: expected {len(TOPICS)} topic cards")

                page.locator(".header-actions .btn-brand").click()
                page.wait_for_selector(".dialog-overlay > .editor-dialog")
                modal = page.locator(".dialog-overlay > .editor-dialog")
                modal_geometry = page.evaluate(
                    """
                    () => {
                      const overlay = document.querySelector('.topic-manage-page .dialog-overlay');
                      const dialog = overlay?.querySelector('.dialog');
                      const uploader = overlay?.querySelector('.image-uploader');
                      uploader?.focus();
                      return {
                        overlayPosition: overlay ? getComputedStyle(overlay).position : '',
                        dialogMaxHeight: dialog ? getComputedStyle(dialog).maxHeight : '',
                        appOverflow: document.querySelector('.atlas-source-ui') ? getComputedStyle(document.querySelector('.atlas-source-ui')).overflow : '',
                        uploaderOutline: uploader ? getComputedStyle(uploader).outlineStyle : '',
                        uploaderTabIndex: uploader?.getAttribute('tabindex')
                      };
                    }
                    """
                )
                geometry["modal"] = modal_geometry
                if modal_geometry["overlayPosition"] != "fixed":
                    raise AssertionError(f"{name}: editor overlay is not fixed")
                if modal_geometry["uploaderTabIndex"] != "0":
                    raise AssertionError(f"{name}: uploader is not keyboard reachable")
                with page.expect_file_chooser(timeout=2000):
                    page.locator(".image-uploader").press("Enter")
                page.locator(".dialog-actions .btn-warm-sand").first.click()
                page.wait_for_selector(".topic-manage-page .dialog-overlay", state="detached")

                page.screenshot(path=str(REPORT_DIR / f"topic-{name}-current.png"), full_page=True)
                report.append({"name": name, "geometry": geometry})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
