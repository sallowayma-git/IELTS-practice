#!/usr/bin/env python3
"""Screenshot the Settings page (route /settings) from the dev build.

    python developer/tests/e2e/settings_preview.py

Starts the Vite dev server for apps/writing-vue on port 4185, mocks the settings
Tauri commands in the page with an init script (DEV only, test side, never
shipped), and captures:

    reports/settings-dev.png          full page, 1440x900
    reports/settings-dev-1024.png     full page, 1024x768
    reports/settings-modal-dev.png    detail dialog open on the API tab, 1440x900

Exit 1 when the server never answers or the page throws.
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import REPORTS, start_dev_server, stop_process, wait_for_server

PORT = 4185
BASE_URL = f"http://127.0.0.1:{PORT}"

CAPTURES = (
    ("settings-dev.png", 1440, 900, "page"),
    ("settings-dev-1024.png", 1024, 768, "page"),
    ("settings-modal-dev.png", 1440, 900, "modal"),
)

MOCK_SCRIPT = r"""
(() => {
  const backupsPath = 'C:/Users/fixture/AppData/Roaming/IELTS Atlas/backups/atlas-full-backup-2026-10-08-093012.zip';
  const configs = [
    { id: 'cfg-openai', configName: 'OpenAI 主通道', provider: 'openai', baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini', isEnabled: true, isDefault: true, hasSecret: true },
    { id: 'cfg-deepseek', configName: 'DeepSeek 备用', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat', isEnabled: true, isDefault: false, hasSecret: true },
    { id: 'cfg-openrouter', configName: 'OpenRouter 草稿', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'anthropic/claude-3.5-sonnet', isEnabled: false, isDefault: false, hasSecret: false },
  ];
  const prompts = [
    { id: 'prompt-task1-2609', taskType: 'task1', version: 'task1-2026.09', body: 'Task 1 rubric.',
      isActive: true, createdAt: '2026-09-02T08:00:00Z', updatedAt: '2026-09-02T08:00:00Z' },
    { id: 'prompt-task2-2608', taskType: 'task2', version: 'task2-2026.08', body: 'Task 2 rubric.',
      isActive: false, createdAt: '2026-08-14T08:00:00Z', updatedAt: '2026-08-14T08:00:00Z' },
    { id: 'prompt-task2-2610', taskType: 'task2', version: 'task2-2026.10', body: 'Task 2 rubric v2.',
      isActive: true, createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-10-01T08:00:00Z' },
  ];
  const backups = [
    { grantId: 'grant-1', name: 'atlas-full-backup-2026-10-08-093012.zip', displayPath: backupsPath,
      sizeBytes: 4823019, modifiedAt: '2026-10-08T09:30:12Z' },
    { grantId: 'grant-2', name: 'atlas-full-backup-2026-09-30-201544.zip',
      displayPath: 'C:/Users/fixture/AppData/Roaming/IELTS Atlas/backups/atlas-full-backup-2026-09-30-201544.zip',
      sizeBytes: 4610442, modifiedAt: '2026-09-30T20:15:44Z' },
  ];
  const invoke = async (command) => {
    switch (command) {
      case 'list_settings': return { ok: true, data: [] };
      case 'history_get_retention_policy': return { ok: true, data: { maxTerminalAttempts: 200 } };
      case 'ai_list_configs': return { ok: true, data: configs };
      case 'writing_prompt_list': return { ok: true, data: prompts };
      case 'writing_topic_statistics': return { ok: true, data: {
        total: 232, byTaskType: [{ taskType: 'task1', count: 118 }, { taskType: 'task2', count: 114 }] } };
      case 'get_app_info': return { name: 'ielts-practice', version: '0.9.4', tauriVersion: '2', productName: 'IELTS Atlas', host: 'tauri' };
      case 'get_app_data_paths': return { appData: 'C:/Users/fixture/AppData/Roaming/IELTS Atlas', logs: 'C:/atlas/logs',
        backups: 'C:/Users/fixture/AppData/Roaming/IELTS Atlas/backups', imports: 'C:/atlas/imports',
        exports: 'C:/atlas/exports', diagnostics: 'C:/atlas/diagnostics', dbDir: 'C:/Users/fixture/AppData/Roaming/IELTS Atlas/db' };
      case 'list_backups': return { ok: true, data: backups };
      case 'check_for_updates': return { configured: false, updateAvailable: false, installed: false, requiresRestart: false,
        currentVersion: '0.9.4', latestVersion: null, body: null, stage: 'unconfigured', message: '此构建未配置签名更新通道。' };
      default: return { ok: true, data: null };
    }
  };
  window.__TAURI__ = window.__TAURI__ || {};
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI__.core = { invoke };
  window.__TAURI_INTERNALS__.invoke = invoke;
})();
"""

BUTTON_METRICS = """
() => [...document.querySelectorAll('[data-writing-settings] .settings-card button, [data-writing-settings] .settings-card a')]
  .map((node) => ({
    text: node.textContent.trim().slice(0, 12),
    height: Math.round(node.getBoundingClientRect().height),
  }))
"""


def capture(base_url: str) -> tuple[list[str], dict]:
    errors: list[str] = []
    metrics: dict = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for filename, width, height, mode in CAPTURES:
                page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
                page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
                page.add_init_script(MOCK_SCRIPT)
                page.goto(f"{base_url}/#/settings", wait_until="networkidle", timeout=60_000)
                page.wait_for_selector("[data-writing-settings] .settings-card", timeout=30_000)
                page.evaluate("document.fonts.ready.then(() => true)")
                page.wait_for_timeout(300)
                if mode == "modal":
                    page.locator('[data-settings-open="api"]').click()
                    page.wait_for_selector(".settings-detail-modal .settings-list__row")
                    page.wait_for_timeout(300)
                    page.screenshot(path=str(REPORTS / filename))
                else:
                    if width == 1440:
                        metrics["buttons_1440"] = page.evaluate(BUTTON_METRICS)
                    page.screenshot(path=str(REPORTS / filename), full_page=True)
                page.close()
        finally:
            browser.close()
    return errors, metrics


def main() -> int:
    base_url = BASE_URL
    process = None
    try:
        process = start_dev_server(PORT)
        wait_for_server(process, base_url)
        errors, metrics = capture(base_url)
    except (RuntimeError, OSError) as error:
        print(f"settings preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    for line in errors:
        print(line, file=sys.stderr)
    for filename, *_ in CAPTURES:
        print(f"wrote {REPORTS / filename}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
