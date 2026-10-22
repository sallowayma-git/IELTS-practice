import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright
from visual_test_support import assert_document_unlocked, assert_flat_surfaces


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
          if (command === 'ai_list_configs') return { ok: true, data: [{
            id: 'cfg-visual-1', configName: 'Visual fixture', provider: 'openai',
            baseUrl: 'https://api.openai.com/v1', defaultModel: 'fixture-model',
            isEnabled: true, isDefault: true, hasSecret: true,
          }] };
          if (command === 'writing_prompt_list') return { ok: true, data: [{
            id: 'prompt-visual-1', taskType: 'task2', version: 'visual-fixture', body: 'Visual fixture prompt.',
            isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          }] };
          if (command === 'writing_topic_statistics') return { ok: true, data: { total: 0, byTaskType: [] } };
          if (command === 'get_app_info') return { name: 'ielts-practice', version: '0.1.0', tauriVersion: '2', productName: 'IELTS Practice', host: 'tauri' };
          if (command === 'get_app_data_paths') return { appData: 'C:/atlas/data', logs: 'C:/atlas/logs', backups: 'C:/atlas/backups', imports: 'C:/atlas/imports', exports: 'C:/atlas/exports', diagnostics: 'C:/atlas/diagnostics', dbDir: 'C:/atlas/data/db' };
          if (command === 'list_backups') return { ok: true, data: [] };
          if (command === 'check_for_updates') return { configured: false, updateAvailable: false, installed: false, requiresRestart: false, currentVersion: '0.1.0', latestVersion: null, body: null, stage: 'unconfigured', message: '此构建未配置签名更新通道。' };
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
            overlayAboveNav: Boolean(overlay?.contains(document.elementFromPoint(innerWidth / 2, 8))),
            documentLocked: [document.documentElement, document.body].every(node => getComputedStyle(node).overflowY === 'hidden'),
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
          const nested = [...document.querySelectorAll('.settings-detail-panel > .settings-panel :is(.settings-list__row, .mode-card, .custom-temperature-panel)')];
          return {
            panelOutline: panel ? parseFloat(getComputedStyle(panel).borderTopWidth) : 0,
            sectionCount: sections.length,
            sectionShadows: sections.map((section) => getComputedStyle(section).boxShadow),
            nestedShadows: nested.map((section) => getComputedStyle(section).boxShadow),
            detailOverflow: panel ? getComputedStyle(panel).overflowY : '',
            tabs: [...document.querySelectorAll('.settings-detail-panel .settings-tabs .settings-tab')].map(node => node.textContent.trim()),
            modes: [...document.querySelectorAll('.settings-detail-panel .mode-card')].map(node => ({
              active: node.classList.contains('active'),
              background: getComputedStyle(node).backgroundColor,
            }))
          };
        }
        """
    )


def read_about_geometry(page):
    return page.evaluate(
        """
        () => {
          const about = document.querySelector('#settings-info');
          const modal = document.querySelector('.settings-detail-modal');
          return {
            present: Boolean(about && about.offsetParent !== null),
            infoRows: about ? about.querySelectorAll('.about-info .info-row').length : 0,
            featureRows: about ? about.querySelectorAll('.about-features li').length : 0,
            productName: about?.querySelector('.about-identity__name')?.textContent.trim() || '',
            version: about?.querySelector('.version')?.textContent.trim() || '',
            insideModal: Boolean(about && modal && modal.contains(about)),
            aboutTrigger: document.querySelectorAll('[data-settings-open="about"]').length,
          };
        }
        """
    )


def assert_about_inline(name, geometry):
    if not geometry['present']:
        raise AssertionError(f'{name}: about section is not rendered on the page')
    if geometry['insideModal']:
        raise AssertionError(f'{name}: about content still lives inside the settings dialog')
    if geometry['aboutTrigger']:
        raise AssertionError(f'{name}: about still exposes a dialog trigger')
    if geometry['infoRows'] < 5 or geometry['featureRows'] < 4:
        raise AssertionError(f'{name}: inline about lost its facts or capabilities: {geometry}')
    if geometry['productName'] != 'IELTS Atlas' or not geometry['version']:
        raise AssertionError(f'{name}: inline about lost its identity block: {geometry}')


def assert_detail_surfaces(name, geometry):
    if geometry["sectionCount"] == 0:
        raise AssertionError(f"{name}: detail tab has no content section")
    if geometry["panelOutline"] < 1:
        raise AssertionError(f"{name}: detail panel lost its outlined layer")
    modes = geometry['modes']
    if modes and (sum(mode['active'] for mode in modes) != 1 or len({mode['background'] for mode in modes}) < 2):
        raise AssertionError(f"{name}: selected temperature mode is not visually distinct: {modes}")


def assert_geometry(name, geometry):
    if geometry["overlayPosition"] != "fixed":
        raise AssertionError(f"{name}: settings overlay is not fixed")
    if int(geometry["overlayZIndex"]) <= int(geometry["detailZIndex"] or '0') or not geometry['overlayAboveNav']:
        raise AssertionError(f"{name}: secondary overlay is obscured by the settings detail or navigation")
    if geometry["overlayDisplay"] not in ("grid", "flex"):
        raise AssertionError(f"{name}: settings overlay has no centered layout")
    if geometry["dialogMaxHeight"] in ("", "none", "auto"):
        raise AssertionError(f"{name}: dialog has no bounded max-height")
    if geometry["dialogOverflow"] not in ("auto", "scroll"):
        raise AssertionError(f"{name}: dialog is not internally scrollable")
    if not geometry["overlayCoversViewport"]:
        raise AssertionError(f"{name}: overlay does not cover the viewport")
    if not geometry["dialogWithinViewport"]:
        raise AssertionError(f"{name}: dialog escapes the viewport")
    if geometry["shellOverflow"] != "hidden" or not geometry['documentLocked']:
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
                about = read_about_geometry(page)
                assert_about_inline(name, about)

                page.locator("#show-onboarding-btn").click()
                page.wait_for_selector(".settings-page > .dialog-overlay")
                onboarding = read_geometry(page)
                assert_geometry(f"{name}: onboarding", onboarding)
                page.locator(".settings-page > .dialog-overlay").click(position={"x": 4, "y": 4})
                page.wait_for_selector(".settings-page > .dialog-overlay", state="detached")
                assert_document_unlocked(page, name)

                page.locator("#check-updates-btn").click()
                page.wait_for_selector(".settings-page > .dialog-overlay")
                update = read_geometry(page)
                assert_geometry(f"{name}: update", update)
                page.locator(".settings-page > .dialog-overlay .btn-warm-sand").click()

                page.locator('[data-settings-open="api"]').click()
                page.wait_for_selector(".settings-detail-modal")
                detail_surfaces = {}
                for tab_name in ("模型参数", "提示词管理", "API 配置"):
                    page.locator(".settings-detail-modal .settings-tab").filter(has_text=tab_name).click()
                    page.wait_for_timeout(30)
                    if tab_name == '模型参数':
                        page.locator('.settings-detail-modal .mode-card').filter(has_text='自定义模式').click()
                        page.wait_for_selector('.custom-temperature-panel')
                    if tab_name in ('提示词管理', 'API 配置'):
                        page.wait_for_selector('.settings-detail-panel .settings-list__row')
                    detail_surfaces[tab_name] = read_detail_surface_geometry(page)
                    assert_detail_surfaces(f"{name}: {tab_name}", detail_surfaces[tab_name])
                    expected_tabs = ["API 配置", "提示词管理", "模型参数"]
                    if detail_surfaces[tab_name]['tabs'] != expected_tabs:
                        raise AssertionError(f"{name}: settings dialog tabs changed: {detail_surfaces[tab_name]['tabs']}")
                    assert_flat_surfaces(
                        page, '.settings-detail-panel > .settings-panel, .settings-detail-panel :is(.settings-list__row, .mode-card, .custom-temperature-panel)',
                        f'{name}: {tab_name}',
                    )

                page.get_by_role("button", name="关闭写作设置").click()
                page.wait_for_selector(".settings-detail-modal", state="detached")
                page.get_by_role("button", name="调整", exact=True).click()
                page.wait_for_selector(".data-dialog")
                data_surfaces = read_detail_surface_geometry(page)
                assert_detail_surfaces(f"{name}: data", data_surfaces)
                assert_flat_surfaces(
                    page, '.data-dialog > .settings-panel, .data-dialog :is(.settings-list__row, .mode-card, .custom-temperature-panel)',
                    f'{name}: data',
                )

                page.locator(".data-dialog .danger-zone .btn-danger").first.click()
                page.wait_for_selector(".settings-page > .dialog-overlay")
                confirm = read_geometry(page)
                assert_geometry(f"{name}: confirmation", confirm)
                page.screenshot(path=str(REPORT_DIR / f"settings-{name}-current.png"), full_page=True)
                report.append({"name": name, "about": about, "onboarding": onboarding, "update": update, "detailSurfaces": detail_surfaces, "dataSurfaces": data_surfaces, "confirmation": confirm})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
