import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("SETTINGS_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (("desktop", 1440, 900), ("tablet", 1024, 768), ("mobile", 390, 844), ("small", 360, 800))


def install_tauri_mock(page):
    script = r"""
    (() => {
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      window.__TAURI__.core = {
        invoke: async (command) => {
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
    """
    page.add_init_script(script)


def read_geometry(page):
    return page.evaluate(
        """
        () => {
          const overlay = document.querySelector('.settings-page > .dialog-overlay');
          const dialog = overlay?.querySelector(':scope > .dialog');
          const detail = document.querySelector('.settings-detail-modal');
          const shell = document.querySelector('.atlas-source-ui');
          const overlayRect = overlay?.getBoundingClientRect();
          const dialogRect = dialog?.getBoundingClientRect();
          return {
            viewport: [innerWidth, innerHeight],
            overlayPosition: overlay ? getComputedStyle(overlay).position : '',
            overlayZIndex: overlay ? getComputedStyle(overlay).zIndex : '',
            overlayDisplay: overlay ? getComputedStyle(overlay).display : '',
            dialogMaxHeight: dialog ? getComputedStyle(dialog).maxHeight : '',
            dialogOverflow: dialog ? getComputedStyle(dialog).overflowY : '',
            dialogWithinViewport: Boolean(dialogRect && dialogRect.top >= 0 && dialogRect.bottom <= innerHeight + 1),
            overlayCoversViewport: Boolean(overlayRect && overlayRect.width >= innerWidth && overlayRect.height >= innerHeight),
            detailZIndex: detail ? getComputedStyle(detail).zIndex : '',
            shellOverflow: shell ? getComputedStyle(shell).overflow : ''
          };
        }
        """
    )


def read_detail_surface_geometry(page):
    return page.evaluate(
        """
        () => {
          const panel = document.querySelector('.settings-detail-panel');
          const sections = [...document.querySelectorAll('.settings-detail-panel > .settings-panel')];
          const nested = [...document.querySelectorAll('.settings-detail-panel > .settings-panel :is(.settings-list__row, .mode-card, .custom-temperature-panel, .about-info, .about-features)')];
          return {
            panelShadow: panel ? getComputedStyle(panel).boxShadow : '',
            sectionCount: sections.length,
            sectionShadows: sections.map((section) => getComputedStyle(section).boxShadow),
            nestedShadows: nested.map((section) => getComputedStyle(section).boxShadow),
            detailOverflow: panel ? getComputedStyle(panel).overflowY : ''
          };
        }
        """
    )


def assert_detail_surfaces(name, geometry):
    if geometry["sectionCount"] == 0:
        raise AssertionError(f"{name}: detail tab has no content section")
    if geometry["panelShadow"] in ("", "none"):
        raise AssertionError(f"{name}: detail panel lost its elevated surface")
    if any(shadow != "none" for shadow in geometry["sectionShadows"]):
        raise AssertionError(f"{name}: nested settings section still has raised shadow")
    if any(shadow != "none" for shadow in geometry["nestedShadows"]):
        raise AssertionError(f"{name}: nested settings content still has raised shadow")


def assert_geometry(name, geometry):
    if geometry["overlayPosition"] != "fixed":
        raise AssertionError(f"{name}: settings overlay is not fixed")
    if geometry["overlayZIndex"] != "60":
        raise AssertionError(f"{name}: expected secondary overlay z-index 60, got {geometry['overlayZIndex']}")
    if geometry["overlayDisplay"] != "grid":
        raise AssertionError(f"{name}: settings overlay is not a grid viewport")
    if geometry["dialogMaxHeight"] in ("", "none", "auto"):
        raise AssertionError(f"{name}: dialog has no bounded max-height")
    if geometry["dialogOverflow"] not in ("auto", "scroll"):
        raise AssertionError(f"{name}: dialog is not internally scrollable")
    if not geometry["overlayCoversViewport"]:
        raise AssertionError(f"{name}: overlay does not cover the viewport")
    if not geometry["dialogWithinViewport"]:
        raise AssertionError(f"{name}: dialog escapes the viewport")
    if geometry["shellOverflow"] != "hidden":
        raise AssertionError(f"{name}: app shell remains scrollable while dialog is open")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                install_tauri_mock(page)
                page.goto(f"{BASE_URL}/#/settings", wait_until="networkidle")
                page.wait_for_selector(".settings-page #show-onboarding-btn")

                page.locator("#show-onboarding-btn").click()
                page.wait_for_selector(".settings-page > .dialog-overlay")
                onboarding = read_geometry(page)
                assert_geometry(f"{name}: onboarding", onboarding)
                page.locator(".settings-page > .dialog-overlay").click(position={"x": 4, "y": 4})
                page.wait_for_selector(".settings-page > .dialog-overlay", state="detached")

                page.locator("#check-updates-btn").click()
                page.wait_for_selector(".settings-page > .dialog-overlay")
                update = read_geometry(page)
                assert_geometry(f"{name}: update", update)
                page.locator(".settings-page > .dialog-overlay .btn-warm-sand").click()

                page.get_by_role("button", name="历史保留上限").click()
                page.wait_for_selector(".settings-detail-modal")
                detail_surfaces = {}
                for tab_name in ("模型参数", "数据管理", "关于", "提示词", "API 配置"):
                    page.locator(".settings-tabs .settings-tab").filter(has_text=tab_name).click()
                    page.wait_for_timeout(30)
                    detail_surfaces[tab_name] = read_detail_surface_geometry(page)
                    assert_detail_surfaces(f"{name}: {tab_name}", detail_surfaces[tab_name])

                page.locator(".settings-tabs .settings-tab").filter(has_text="数据管理").click()
                page.locator(".danger-zone .btn-danger").click()
                page.wait_for_selector(".settings-page > .dialog-overlay")
                confirm = read_geometry(page)
                assert_geometry(f"{name}: confirmation", confirm)
                if confirm["detailZIndex"] != "40":
                    raise AssertionError(f"{name}: detail modal z-index changed unexpectedly")
                page.screenshot(path=str(REPORT_DIR / f"settings-{name}-current.png"), full_page=True)
                report.append({"name": name, "onboarding": onboarding, "update": update, "detailSurfaces": detail_surfaces, "confirmation": confirm})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
