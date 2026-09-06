#!/usr/bin/env python3
"""Optional listening bridge E2E.

This smoke test is intentionally separate from the required CI suite. It checks
the listening library and bridge protocol without depending on one specific
source HTML layout.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, List

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_URL = f"{(REPO_ROOT / 'index.html').as_uri()}?test_env=1&optional_listening_e2e=1"
BRIDGE_PATH = REPO_ROOT / "js" / "listeningRecordBridge.js"
SPELLING_COLLECTOR_PATH = REPO_ROOT / "js" / "app" / "spellingErrorCollector.js"
SAFE_OBJECT_LITERAL_PARSER_PATH = REPO_ROOT / "js" / "utils" / "safeObjectLiteralParser.js"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_FILE = REPORT_DIR / "listening-bridge-optional-report.json"

try:
    from playwright.async_api import Browser, ConsoleMessage, Page, async_playwright
except ModuleNotFoundError:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.write_text(
        json.dumps(
            {
                "status": "skipped",
                "reason": "python_playwright_unavailable",
                "detail": "Install Playwright to run this optional browser smoke test.",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[SKIP] playwright is unavailable; report: {REPORT_FILE}")
    raise SystemExit(0)


@dataclass
class ConsoleEntry:
    page: str
    type: str
    text: str


def collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    def handler(msg: ConsoleMessage) -> None:
        store.append(ConsoleEntry(page=page.url, type=msg.type, text=msg.text))

    page.on("console", handler)


async def inject_bridge_fixture_scripts(page: Page) -> None:
    await page.add_script_tag(path=str(SPELLING_COLLECTOR_PATH))
    await page.add_script_tag(path=str(SAFE_OBJECT_LITERAL_PARSER_PATH))
    await page.add_script_tag(path=str(BRIDGE_PATH))


async def launch_browser(playwright, allow_file_access: bool = True) -> Browser:
    if allow_file_access:
        try:
            return await playwright.chromium.launch(
                headless=True,
                args=["--allow-file-access-from-files"],
            )
        except Exception:
            return await playwright.chromium.launch(headless=True)
    return await playwright.chromium.launch(headless=True)


async def ensure_app_ready(page: Page) -> None:
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && Array.isArray(window.listeningExamIndex)",
        timeout=60000,
    )


async def dismiss_overlays(page: Page) -> None:
    accepted = await page.evaluate(
        """async () => {
            if (!window.LicenseModal || typeof window.LicenseModal.accept !== 'function') {
                throw new Error('LicenseModal.accept is unavailable');
            }
            return window.LicenseModal.accept();
        }"""
    )
    if not accepted:
        raise RuntimeError("GPL license consent was not committed")
    await page.wait_for_function(
        "() => !document.getElementById('license-modal')?.classList.contains('show')",
        timeout=5000,
    )


async def validate_listening_index(page: Page) -> dict[str, Any]:
    return await page.evaluate(
        """
        async () => {
            const rows = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
            const ids = rows.map(row => row && (row.examId || row.id)).filter(Boolean);
            const uniqueIds = new Set(ids);
            const invalidPaths = rows
                .filter(row => !row || !/^P[1-4]\\//.test(String(row.path || '')) || String(row.path || '').startsWith('ListeningPractice/'))
                .map(row => row && { id: row.examId || row.id, path: row.path });
            if (typeof window.resolveActiveLibraryIndex !== 'function') {
                throw new Error('resolveActiveLibraryIndex is unavailable');
            }
            const activeIndex = await window.resolveActiveLibraryIndex();
            const activeListeningCount = Array.isArray(activeIndex)
                ? activeIndex.filter(row => row && row.type === 'listening').length
                : 0;
            return {
                count: rows.length,
                uniqueCount: uniqueIds.size,
                duplicateCount: ids.length - uniqueIds.size,
                invalidPaths,
                activeListeningCount,
                firstExamId: rows[0] && (rows[0].examId || rows[0].id)
            };
        }
        """
    )


async def validate_open_exam_path(page: Page, exam_id: str) -> dict[str, Any]:
    return await page.evaluate(
        """
        async (targetExamId) => {
            if (typeof window.ensureBrowseGroup === 'function') {
                await window.ensureBrowseGroup();
            } else if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
                await window.AppLazyLoader.ensureGroup('browse-runtime');
            }
            if (!window.app || typeof window.app.openExam !== 'function') {
                throw new Error('app_open_exam_missing_after_browse_runtime');
            }
            window.__LISTENING_OPEN_CALLS = [];
            window.__LISTENING_INJECTED_SCRIPTS = [];
            const nativeOpen = window.open;
            window.open = function(url, name, features) {
                const targetUrl = String(url || '');
                window.__LISTENING_OPEN_CALLS.push({ url: targetUrl, name: name || '', features: features || '' });
                const fakeHead = {
                    querySelector() { return null; },
                    appendChild(node) {
                        window.__LISTENING_INJECTED_SCRIPTS.push(node && node.src ? String(node.src) : '');
                        if (node && typeof node.onload === 'function') {
                            setTimeout(() => node.onload(), 0);
                        }
                        return node;
                    }
                };
                const fakeDocument = {
                    readyState: 'complete',
                    head: fakeHead,
                    body: null,
                    getElementById() { return null; },
                    createElement() {
                        return { dataset: {}, remove() {} };
                    }
                };
                return {
                    closed: false,
                    name: name || '',
                    location: {
                        href: targetUrl,
                        replace(value) { this.href = String(value || ''); }
                    },
                    document: fakeDocument,
                    focus() {},
                    postMessage() {}
                };
            };
            try {
                await window.app.openExam(targetExamId, {
                    reviewMode: true,
                    reviewSessionId: 'optional-listening-e2e'
                });
                await new Promise(resolve => setTimeout(resolve, 900));
            } finally {
                window.open = nativeOpen;
            }
            const call = window.__LISTENING_OPEN_CALLS[0] || null;
            return {
                call,
                injectedScripts: window.__LISTENING_INJECTED_SCRIPTS.slice()
            };
        }
        """,
        exam_id,
    )


async def validate_bridge_completion(page: Page) -> dict[str, Any]:
    bridge_page = await page.context.new_page()
    collect_console(bridge_page, [])
    await bridge_page.goto("about:blank")
    await bridge_page.set_content(
        """
        <!DOCTYPE html>
        <html>
        <head><title>Listening Bridge Fixture</title></head>
        <body>
          <table class="results-table">
            <tbody>
              <tr><td>1</td><td>acommodation</td><td>accommodation</td><td>Incorrect</td></tr>
              <tr><td>2</td><td>library</td><td>library</td><td>Correct</td></tr>
            </tbody>
          </table>
        </body>
        </html>
        """,
        wait_until="load",
    )
    await bridge_page.evaluate(
        """
        () => {
            window.__BRIDGE_MESSAGES = [];
            Object.defineProperty(window, 'opener', {
                configurable: true,
                value: {
                    postMessage(message) {
                        window.__BRIDGE_MESSAGES.push(message);
                    }
                }
            });
        }
        """
    )
    await inject_bridge_fixture_scripts(bridge_page)
    await bridge_page.evaluate(
        """
        () => {
            window.postMessage({
                type: 'INIT_SESSION',
                data: {
                    examId: 'listening-p1-optional-e2e',
                    sessionId: 'session-listening-optional-e2e'
                }
            }, '*');
        }
        """
    )
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'SESSION_READY' && message.data && message.data.initialized === true)",
        timeout=10000,
    )
    await bridge_page.evaluate("() => window.__listeningBridgeComplete({ allowGenerated: false })")
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'PRACTICE_COMPLETE')",
        timeout=10000,
    )
    result = await bridge_page.evaluate(
        """
        () => {
            const complete = window.__BRIDGE_MESSAGES.find(message => message && message.type === 'PRACTICE_COMPLETE');
            const readyMessages = window.__BRIDGE_MESSAGES.filter(message => message && message.type === 'SESSION_READY');
            return {
                messageCount: window.__BRIDGE_MESSAGES.length,
                readyMessages,
                requestedInit: window.__BRIDGE_MESSAGES.some(message => message && message.type === 'REQUEST_INIT'),
                payload: complete && complete.data
            };
        }
        """
    )
    await bridge_page.close()
    return result


async def validate_bridge_finish_dom_capture(page: Page) -> dict[str, Any]:
    bridge_page = await page.context.new_page()
    await bridge_page.goto("about:blank")
    await bridge_page.set_content(
        """
        <!DOCTYPE html>
        <html>
        <head><title>Listening Finish DOM Fixture</title></head>
        <body>
          <input name="q1" value="acommodation">
          <div id="finish-dom" onclick="window.App.finishTest()"><span>Finish</span></div>
          <script>
            window.CONFIG_DATA = { answerKey: { text: { q1: 'accommodation' } } };
            window.App = {
              config: window.CONFIG_DATA,
              state: { isReviewing: false },
              finishTest() {
                this.state.isReviewing = true;
                const table = document.createElement('table');
                table.className = 'results-table';
                table.innerHTML = '<tbody><tr><td>1</td><td>acommodation</td><td>accommodation</td><td>Incorrect</td></tr></tbody>';
                document.body.appendChild(table);
              }
            };
          </script>
        </body>
        </html>
        """,
        wait_until="load",
    )
    await bridge_page.evaluate(
        """
        () => {
            window.__BRIDGE_MESSAGES = [];
            Object.defineProperty(window, 'opener', {
                configurable: true,
                value: {
                    postMessage(message) {
                        window.__BRIDGE_MESSAGES.push(message);
                    }
                }
            });
        }
        """
    )
    await inject_bridge_fixture_scripts(bridge_page)
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'REQUEST_INIT')",
        timeout=10000,
    )
    await bridge_page.evaluate(
        """
        () => {
            window.postMessage({
                type: 'INIT_SESSION',
                data: {
                    examId: 'custom-listening-finish-dom',
                    sessionId: 'session-listening-finish-dom'
                }
            }, '*');
        }
        """
    )
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'SESSION_READY' && message.data && message.data.initialized === true)",
        timeout=10000,
    )
    await bridge_page.locator("#finish-dom span").click()
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'PRACTICE_COMPLETE')",
        timeout=10000,
    )
    result = await bridge_page.evaluate(
        """
        () => {
            const complete = window.__BRIDGE_MESSAGES.find(message => message && message.type === 'PRACTICE_COMPLETE');
            const readyMessages = window.__BRIDGE_MESSAGES.filter(message => message && message.type === 'SESSION_READY');
            return {
                messageCount: window.__BRIDGE_MESSAGES.length,
                requestedInit: window.__BRIDGE_MESSAGES.some(message => message && message.type === 'REQUEST_INIT'),
                readyMessages,
                payload: complete && complete.data
            };
        }
        """
    )
    await bridge_page.close()
    return result


async def validate_bridge_three_column_results_table(page: Page) -> dict[str, Any]:
    bridge_page = await page.context.new_page()
    await bridge_page.goto("about:blank")
    await bridge_page.set_content(
        """
        <!DOCTYPE html>
        <html>
        <head><title>Listening Three Column Results Fixture</title></head>
        <body>
          <table class="results-table">
            <tbody>
              <tr><td>Q31</td><td>acommodation</td><td>accommodation</td></tr>
            </tbody>
          </table>
        </body>
        </html>
        """,
        wait_until="load",
    )
    await bridge_page.evaluate(
        """
        () => {
            window.__BRIDGE_MESSAGES = [];
            Object.defineProperty(window, 'opener', {
                configurable: true,
                value: {
                    postMessage(message) {
                        window.__BRIDGE_MESSAGES.push(message);
                    }
                }
            });
        }
        """
    )
    await inject_bridge_fixture_scripts(bridge_page)
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'REQUEST_INIT')",
        timeout=10000,
    )
    await bridge_page.evaluate(
        """
        () => {
            window.postMessage({
                type: 'INIT_SESSION',
                data: {
                    examId: 'listening-p1-three-column',
                    sessionId: 'session-listening-three-column'
                }
            }, '*');
        }
        """
    )
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'SESSION_READY' && message.data && message.data.initialized === true)",
        timeout=10000,
    )
    await bridge_page.evaluate("() => window.__listeningBridgeComplete({ allowGenerated: false })")
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'PRACTICE_COMPLETE')",
        timeout=10000,
    )
    result = await bridge_page.evaluate(
        """
        () => {
            const complete = window.__BRIDGE_MESSAGES.find(message => message && message.type === 'PRACTICE_COMPLETE');
            return { payload: complete && complete.data };
        }
        """
    )
    await bridge_page.close()
    return result


async def validate_bridge_data_q_input_capture(page: Page) -> dict[str, Any]:
    bridge_page = await page.context.new_page()
    await bridge_page.goto("about:blank")
    await bridge_page.set_content(
        """
        <!DOCTYPE html>
        <html>
        <head><title>Listening Data Q Input Fixture</title></head>
        <body>
          <input data-q="31" value="acommodation">
          <script>
            const CONFIG_DATA = { answerKey: { text: { q31: 'accommodation' } } };
          </script>
        </body>
        </html>
        """,
        wait_until="load",
    )
    await bridge_page.evaluate(
        """
        () => {
            window.__BRIDGE_MESSAGES = [];
            Object.defineProperty(window, 'opener', {
                configurable: true,
                value: {
                    postMessage(message) {
                        window.__BRIDGE_MESSAGES.push(message);
                    }
                }
            });
        }
        """
    )
    await inject_bridge_fixture_scripts(bridge_page)
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'REQUEST_INIT')",
        timeout=10000,
    )
    await bridge_page.evaluate(
        """
        () => {
            window.postMessage({
                type: 'INIT_SESSION',
                data: {
                    examId: 'listening-p1-data-q',
                    sessionId: 'session-listening-data-q'
                }
            }, '*');
        }
        """
    )
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'SESSION_READY' && message.data && message.data.initialized === true)",
        timeout=10000,
    )
    await bridge_page.evaluate("() => window.__listeningBridgeComplete({ allowGenerated: true })")
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'PRACTICE_COMPLETE')",
        timeout=10000,
    )
    result = await bridge_page.evaluate(
        """
        () => {
            const complete = window.__BRIDGE_MESSAGES.find(message => message && message.type === 'PRACTICE_COMPLETE');
            return { payload: complete && complete.data };
        }
        """
    )
    await bridge_page.close()
    return result


async def validate_bridge_delayed_finish_hook(page: Page) -> dict[str, Any]:
    bridge_page = await page.context.new_page()
    await bridge_page.goto("about:blank")
    await bridge_page.set_content(
        """
        <!DOCTYPE html>
        <html>
        <head><title>Listening Delayed Finish Hook Fixture</title></head>
        <body>
          <input name="q1" value="library">
          <script>
            window.CONFIG_DATA = { answerKey: { text: { q1: 'library' } } };
          </script>
        </body>
        </html>
        """,
        wait_until="load",
    )
    await bridge_page.evaluate(
        """
        () => {
            window.__BRIDGE_MESSAGES = [];
            Object.defineProperty(window, 'opener', {
                configurable: true,
                value: {
                    postMessage(message) {
                        window.__BRIDGE_MESSAGES.push(message);
                    }
                }
            });
        }
        """
    )
    await inject_bridge_fixture_scripts(bridge_page)
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'REQUEST_INIT')",
        timeout=10000,
    )
    await bridge_page.evaluate(
        """
        () => {
            window.postMessage({
                type: 'INIT_SESSION',
                data: {
                    examId: 'custom-listening-delayed-hook',
                    sessionId: 'session-listening-delayed-hook'
                }
            }, '*');
        }
        """
    )
    await bridge_page.wait_for_function(
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'SESSION_READY' && message.data && message.data.initialized === true)",
        timeout=10000,
    )
    await bridge_page.wait_for_timeout(1200)
    await bridge_page.evaluate(
        """
        () => {
            window.finishTest = function finishTest() {
                window.__DELAYED_FINISH_RAN = true;
            };
        }
        """
    )
    await bridge_page.wait_for_function(
        "() => typeof window.finishTest === 'function' && window.finishTest._bridgeOriginal",
        timeout=10000,
    )
    await bridge_page.evaluate("() => window.finishTest()")
    await bridge_page.wait_for_function(
        "() => window.__DELAYED_FINISH_RAN === true && window.__BRIDGE_MESSAGES.some(message => message && message.type === 'PRACTICE_COMPLETE')",
        timeout=10000,
    )
    result = await bridge_page.evaluate(
        """
        () => {
            const complete = window.__BRIDGE_MESSAGES.find(message => message && message.type === 'PRACTICE_COMPLETE');
            return {
                messageCount: window.__BRIDGE_MESSAGES.length,
                finishWrapped: typeof window.finishTest === 'function' && Boolean(window.finishTest._bridgeOriginal),
                payload: complete && complete.data
            };
        }
        """
    )
    await bridge_page.close()
    return result


async def validate_real_parent_listening_persistence(page: Page, console_log: List[ConsoleEntry]) -> dict[str, Any]:
    target = await page.evaluate(
        """
        async () => {
            if (typeof window.ensureBrowseGroup === 'function') {
                await window.ensureBrowseGroup();
            } else if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
                await window.AppLazyLoader.ensureGroup('browse-runtime');
            }
            if (!window.app || typeof window.app.openExam !== 'function') {
                throw new Error('app_open_exam_missing_for_real_parent_probe');
            }
            if (!window.AppData || !window.AppData.practice || !window.AppData.vocab || !window.AppData.backups) {
                throw new Error('app_data_missing_for_real_parent_probe');
            }
            if (!window.spellingErrorCollector || typeof window.spellingErrorCollector.saveErrors !== 'function') {
                throw new Error('parent_spelling_collector_missing_after_browse_runtime');
            }
            const rows = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
            const preferredId = 'listening-p1-very-007-ielts-listening-enhanced-practice-f0f5f9b6';
            const target = rows.find(row => row && row.id === preferredId)
                || rows.find(row => row && row.id && row.hasHtml !== false && /P1\\//i.test(String(row.path || '')))
                || rows.find(row => row && row.id && row.hasHtml !== false);
            if (!target) {
                throw new Error('no_real_listening_target');
            }

            return {
                id: target.id,
                title: target.title,
                path: target.path,
                filename: target.filename,
                preferred: target.id === preferredId
            };
        }
        """
    )

    child_page = None
    isolation_backup_id = None
    try:
        isolation_backup_id = await page.evaluate(
            """
            async (target) => {
                const backup = await window.AppData.backups.create({
                    type: 'e2e-isolation',
                    label: 'real-listening-parent'
                });
                try {
                    const [records, collections] = await Promise.all([
                        window.AppData.practice.list(),
                        window.AppData.vocab.listCollections()
                    ]);
                    const recordIds = records
                        .filter(record => record && record.examId === target.id)
                        .map(record => record.id)
                        .filter(Boolean);
                    if (recordIds.length) {
                        await window.AppData.practice.deleteMany({
                            recordIds,
                            operationId: `e2e-listening-clear:${target.id}`
                        });
                    }
                    await window.AppData.vocab.saveCollections({
                        'spelling-errors-p1': Object.assign({}, collections['spelling-errors-p1'] || {}, { id: 'spelling-errors-p1', words: [] }),
                        'spelling-errors-master': Object.assign({}, collections['spelling-errors-master'] || {}, { id: 'spelling-errors-master', words: [] })
                    }, { operationId: `e2e-listening-vocab-clear:${target.id}` });
                    return backup.id;
                } catch (error) {
                    await window.AppData.backups.restore(backup.id);
                    await window.AppData.backups.delete(backup.id);
                    throw error;
                }
            }
            """,
            target,
        )
        async with page.expect_popup(timeout=20000) as popup_wait:
            await page.evaluate("(examId) => window.app.openExam(examId)", target["id"])
        child_page = await popup_wait.value
        collect_console(child_page, console_log)
        child_page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        await child_page.wait_for_load_state("load", timeout=30000)
        await child_page.wait_for_function(
            "() => !!document.querySelector('script[data-listening-record-bridge]')",
            timeout=10000,
        )
        await child_page.wait_for_function(
            "() => typeof window.__listeningBridgeGetState === 'function'",
            timeout=30000,
        )
        await child_page.wait_for_function(
            "() => { const state = window.__listeningBridgeGetState(); return state && state.initialized === true; }",
            timeout=10000,
        )
        answer = await child_page.evaluate(
            """
            (target) => {
                const fromWindow = (window.CONFIG_DATA && window.CONFIG_DATA.answerKey && window.CONFIG_DATA.answerKey.text) || {};
                const fromScript = {};
                const configScript = document.getElementById('task-configuration');
                const source = configScript ? String(configScript.textContent || '') : '';
                const textBlockMatch = source.match(/answerKey\\s*:\\s*{[\\s\\S]*?text\\s*:\\s*{([\\s\\S]*?)}\\s*(?:,|})/);
                if (textBlockMatch) {
                    const pairPattern = /['"]?(q\\d+)['"]?\\s*:\\s*['"]([^'"]+)['"]/g;
                    let match;
                    while ((match = pairPattern.exec(textBlockMatch[1])) !== null) {
                        fromScript[match[1]] = match[2];
                    }
                }

                const textAnswers = Object.assign({}, fromScript, fromWindow);
                const entry = Object.entries(textAnswers).find(([questionId, value]) => {
                    const correct = String(value || '').trim();
                    return /^[a-z][a-z'-]{5,}$/i.test(correct)
                        && correct === correct.toLowerCase()
                        && !!document.querySelector(`[name="${questionId}"]`);
                })
                    || Object.entries(textAnswers).find(([questionId, value]) => /[A-Za-z]{6,}/.test(String(value || '')) && !!document.querySelector(`[name="${questionId}"]`))
                    || Object.entries(textAnswers)[0];
                if (!entry) {
                    throw new Error('real_listening_text_answer_missing');
                }
                const [questionId, rawCorrect] = entry;
                const input = document.querySelector(`[name="${questionId}"]`);
                if (!input) {
                    throw new Error(`real_listening_input_missing:${questionId}`);
                }
                const correct = String(rawCorrect || '').trim();
                const wrong = correct.length > 3 ? correct.slice(0, -1) : `${correct}x`;
                input.value = wrong;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return { questionId, correct, wrong };
            }
            """,
            target,
        )
        finish_selector = (
            "#finish-btn, #finishBtn, #submitBtn, #btnFinish, "
            "[data-action='finish'], [data-action='submit'], "
            "button:has-text('Finish'), button:has-text('Submit Answers')"
        )
        await child_page.locator(finish_selector).first.click(timeout=10000)
        await child_page.wait_for_function(
            "() => { const state = window.__listeningBridgeGetState && window.__listeningBridgeGetState(); return state && state.completed === true; }",
            timeout=15000,
        )

        result: dict[str, Any] | None = None
        deadline = asyncio.get_running_loop().time() + 30
        while asyncio.get_running_loop().time() < deadline:
            result = await page.evaluate(
                """
                async ({ examId, expectedWord, expectedInput }) => {
                    const normalize = value => String(value || '').trim().toLowerCase();
                    const [records, p1, master] = await Promise.all([
                        window.AppData.practice.list(),
                        window.AppData.vocab.readList('spelling-errors-p1'),
                        window.AppData.vocab.readList('spelling-errors-master')
                    ]);
                    const record = Array.isArray(records)
                        ? records.find(item => item && item.examId === examId)
                        : null;
                    const p1Word = p1 && Array.isArray(p1.words)
                        ? p1.words.find(item => item && normalize(item.word) === normalize(expectedWord))
                        : null;
                    const masterWord = master && Array.isArray(master.words)
                        ? master.words.find(item => item && normalize(item.word) === normalize(expectedWord))
                        : null;
                    const validWord = item => item
                        && item.examId === examId
                        && normalize(item.word) === normalize(expectedWord)
                        && normalize(item.userInput) === normalize(expectedInput)
                        && item.source === 'p1';
                    return {
                        record: record && {
                            examId: record.examId,
                            type: record.type,
                            totalQuestions: record.totalQuestions,
                            score: record.score,
                            sessionId: record.sessionId
                        },
                        persisted: Boolean(record && validWord(p1Word) && validWord(masterWord)),
                        p1Word: p1Word && {
                            word: p1Word.word,
                            userInput: p1Word.userInput,
                            examId: p1Word.examId,
                            source: p1Word.source
                        },
                        masterWord: masterWord && {
                            word: masterWord.word,
                            userInput: masterWord.userInput,
                            examId: masterWord.examId,
                            source: masterWord.source
                        }
                    };
                }
                """,
                {"examId": target["id"], "expectedWord": answer["correct"], "expectedInput": answer["wrong"]},
            )
            if result.get("persisted"):
                break
            await page.wait_for_timeout(500)

        if not result or not result.get("persisted"):
            raise AssertionError(f"真实听力父页落库/词表保存失败: {result}")

        static_bridge = await child_page.evaluate(
            """
            () => {
                const script = document.querySelector('script[data-listening-record-bridge]');
                return script ? script.getAttribute('src') : '';
            }
            """
        )

        return {"target": target, "answer": answer, "staticBridgeScript": static_bridge, **result}
    finally:
        if child_page and not child_page.is_closed():
            await child_page.close()
        if isolation_backup_id:
            await page.evaluate(
                """async (backupId) => {
                    await window.AppData.backups.restore(backupId);
                    await window.AppData.backups.delete(backupId);
                }""",
                isolation_backup_id,
            )


async def validate_file_origin_static_bridge_p2_persistence(page: Page, console_log: List[ConsoleEntry]) -> dict[str, Any]:
    target = await page.evaluate(
        """
        async () => {
            if (typeof window.ensureBrowseGroup === 'function') {
                await window.ensureBrowseGroup();
            } else if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
                await window.AppLazyLoader.ensureGroup('browse-runtime');
            }
            if (!window.app || typeof window.app.openExam !== 'function') {
                throw new Error('app_open_exam_missing_for_file_origin_probe');
            }
            if (!window.AppData || !window.AppData.practice) {
                throw new Error('app_data_missing_for_file_origin_probe');
            }
            const rows = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
            const target = rows.find(row => row && row.id && /8\\. P2 Plan of Community Center \\(VIP\\)/i.test(String(row.path || row.filename || row.title || '')))
                || rows.find(row => row && row.id && /Plan of Community Center/i.test(String(row.title || row.path || row.filename || '')));
            if (!target) {
                throw new Error('p2_community_center_target_missing');
            }

            return {
                id: target.id,
                title: target.title,
                path: target.path,
                filename: target.filename
            };
        }
        """
    )

    child_page = None
    practice_snapshot = None
    try:
        practice_snapshot = await page.evaluate("async () => window.AppData.backups.export({ domains: ['practice'] })")
        await page.evaluate(
            """async (examId) => {
                const records = await window.AppData.practice.list();
                const recordIds = records
                    .filter(record => record && record.examId === examId)
                    .map(record => record.id)
                    .filter(Boolean);
                if (recordIds.length) {
                    await window.AppData.practice.deleteMany({
                        recordIds,
                        operationId: `e2e-file-origin-clear:${examId}`
                    });
                }
            }""",
            target["id"],
        )
        async with page.expect_popup(timeout=20000) as popup_wait:
            await page.evaluate("(examId) => window.app.openExam(examId)", target["id"])
        child_page = await popup_wait.value
        collect_console(child_page, console_log)
        child_page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        await child_page.wait_for_load_state("load", timeout=30000)
        await child_page.wait_for_function(
            "() => !!document.querySelector('script[data-listening-record-bridge]')",
            timeout=10000,
        )
        await child_page.wait_for_function(
            "() => typeof window.__listeningBridgeGetState === 'function'",
            timeout=30000,
        )
        await child_page.wait_for_function(
            "() => { const state = window.__listeningBridgeGetState(); return state && state.initialized === true; }",
            timeout=15000,
        )

        finish_selector = (
            "#finish-btn, #finishBtn, #submitBtn, #btnFinish, "
            "[data-action='finish'], [data-action='submit'], "
            "button:has-text('Finish'), button:has-text('Submit Answers')"
        )
        await child_page.locator(finish_selector).first.click(timeout=10000)
        await child_page.wait_for_function(
            "() => { const state = window.__listeningBridgeGetState && window.__listeningBridgeGetState(); return state && state.completed === true; }",
            timeout=15000,
        )

        result: dict[str, Any] | None = None
        deadline = asyncio.get_running_loop().time() + 30
        while asyncio.get_running_loop().time() < deadline:
            result = await page.evaluate(
                """
                async (examId) => {
                    const records = await window.AppData.practice.list();
                    const record = Array.isArray(records)
                        ? records.find(item => item && item.examId === examId)
                        : null;
                    return {
                        record: record && {
                            examId: record.examId,
                            type: record.type,
                            totalQuestions: record.totalQuestions,
                            score: record.score,
                            sessionId: record.sessionId
                        },
                        persisted: Boolean(record && record.examId === examId && record.type === 'listening' && Number(record.totalQuestions) > 0)
                    };
                }
                """,
                target["id"],
            )
            if result.get("persisted"):
                break
            await page.wait_for_timeout(500)

        if not result or not result.get("persisted"):
            raise AssertionError(f"真实 file:// P2 静态 bridge 落库失败: {result}")

        static_bridge = await child_page.evaluate(
            """
            () => {
                const script = document.querySelector('script[data-listening-record-bridge]');
                return script ? script.getAttribute('src') : '';
            }
            """
        )

        bridge_state = await child_page.evaluate(
            """
            () => {
                const state = window.__listeningBridgeGetState && window.__listeningBridgeGetState();
                return state && {
                    examId: state.examId,
                    sessionId: state.sessionId,
                    initialized: state.initialized,
                    completed: state.completed
                };
            }
            """
        )

        return {"target": target, "staticBridgeScript": static_bridge, "bridgeState": bridge_state, **result}
    finally:
        if child_page and not child_page.is_closed():
            await child_page.close()
        if practice_snapshot is not None:
            await page.evaluate(
                """async (snapshot) => {
                    const preview = await window.AppData.backups.previewImport(snapshot, { practiceMode: 'replace' });
                    await window.AppData.backups.commitImport(preview.id, {
                        operationId: 'e2e-file-origin-restore'
                    });
                }""",
                practice_snapshot,
            )


async def run() -> int:
    console_log: List[ConsoleEntry] = []
    report: dict[str, Any] = {
        "status": "fail",
        "indexUrl": INDEX_URL,
        "checks": {},
        "consoleErrors": [],
    }

    async with async_playwright() as playwright:
        browser = await launch_browser(playwright)
        context = await browser.new_context()
        page = await context.new_page()
        collect_console(page, console_log)

        try:
            await page.goto(INDEX_URL)
            await ensure_app_ready(page)
            await dismiss_overlays(page)

            index_check = await validate_listening_index(page)
            assert index_check["count"] > 0, "听力索引为空"
            assert index_check["duplicateCount"] == 0, "听力 examId 存在重复"
            assert not index_check["invalidPaths"], "听力路径不是标准 P1-P4 相对路径"
            assert index_check["activeListeningCount"] > 0, "主应用题库未合并听力索引"
            report["checks"]["index"] = index_check

            open_check = await validate_open_exam_path(page, index_check["firstExamId"])
            open_url = (open_check.get("call") or {}).get("url", "")
            assert "/ListeningPractice/P" in open_url.replace("\\", "/"), f"听力题源打开路径错误: {open_url}"
            assert open_url.lower().split("?")[0].endswith(".html"), f"听力题源未打开 HTML: {open_url}"
            assert any("listening-record-bridge.bundle.js" in item for item in open_check["injectedScripts"]), "未注入听力 bridge bundle"
            report["checks"]["openExam"] = open_check

            bridge_check = await validate_bridge_completion(page)
            payload = bridge_check.get("payload") or {}
            assert payload.get("examId") == "listening-p1-optional-e2e", "bridge completion examId 错误"
            assert payload.get("type") == "listening", "bridge completion 类型错误"
            assert payload.get("scoreInfo", {}).get("total") == 2, "bridge completion 总题数错误"
            assert payload.get("answerComparison", {}).get("q1", {}).get("acceptedAnswers") == ["accommodation"], "bridge 未保留 acceptedAnswers"
            assert payload.get("spellingErrors"), "bridge 未生成 P1 错词"
            assert bridge_check.get("requestedInit") is True, "bridge bootstrap 未主动 REQUEST_INIT"
            assert any(msg.get("data", {}).get("initialized") is False for msg in bridge_check.get("readyMessages", [])), "bridge 未区分 pre-init ready"
            report["checks"]["bridge"] = bridge_check

            finish_dom_check = await validate_bridge_finish_dom_capture(page)
            finish_payload = finish_dom_check.get("payload") or {}
            assert finish_dom_check.get("requestedInit") is True, "finish DOM 场景未主动 REQUEST_INIT"
            assert finish_payload.get("examId") == "custom-listening-finish-dom", "finish DOM completion examId 错误"
            assert finish_payload.get("sessionId") == "session-listening-finish-dom", "finish DOM completion sessionId 错误"
            assert finish_payload.get("scoreInfo", {}).get("total") == 1, "finish DOM completion 总题数错误"
            assert finish_payload.get("answerComparison", {}).get("q1", {}).get("userAnswer") == "acommodation", "finish DOM 未捕捉用户答案"
            report["checks"]["finishDom"] = finish_dom_check

            three_column_check = await validate_bridge_three_column_results_table(page)
            three_column_payload = three_column_check.get("payload") or {}
            assert three_column_payload.get("answerComparison", {}).get("q31", {}).get("userAnswer") == "acommodation", "3列结果表未抽取用户答案"
            assert three_column_payload.get("answerComparison", {}).get("q31", {}).get("correctAnswer") == "accommodation", "3列结果表未抽取正确答案"
            assert three_column_payload.get("spellingErrors"), "3列结果表未生成错词"
            report["checks"]["threeColumnResults"] = three_column_check

            data_q_check = await validate_bridge_data_q_input_capture(page)
            data_q_payload = data_q_check.get("payload") or {}
            assert data_q_payload.get("answerComparison", {}).get("q31", {}).get("userAnswer") == "acommodation", "data-q 输入未抽取用户答案"
            assert data_q_payload.get("answerComparison", {}).get("q31", {}).get("correctAnswer") == "accommodation", "data-q 输入未抽取正确答案"
            assert data_q_payload.get("spellingErrors"), "data-q 输入未生成错词"
            report["checks"]["dataQInput"] = data_q_check

            delayed_hook_check = await validate_bridge_delayed_finish_hook(page)
            delayed_payload = delayed_hook_check.get("payload") or {}
            assert delayed_hook_check.get("finishWrapped") is True, "延迟出现的 finishTest 未被 bridge hook"
            assert delayed_payload.get("examId") == "custom-listening-delayed-hook", "delayed hook completion examId 错误"
            assert delayed_payload.get("sessionId") == "session-listening-delayed-hook", "delayed hook completion sessionId 错误"
            assert delayed_payload.get("scoreInfo", {}).get("total") == 1, "delayed hook completion 总题数错误"
            report["checks"]["delayedFinishHook"] = delayed_hook_check

            parent_persistence_check = await validate_real_parent_listening_persistence(page, console_log)
            assert parent_persistence_check.get("record", {}).get("examId") == parent_persistence_check.get("target", {}).get("id"), "真实父页未保存当前听力记录"
            assert parent_persistence_check.get("record", {}).get("type") == "listening", "真实父页听力记录类型错误"
            assert parent_persistence_check.get("record", {}).get("totalQuestions", 0) > 0, "真实父页听力记录题数错误"
            assert "listening-record-bridge.bundle.js" in parent_persistence_check.get("staticBridgeScript", ""), "真实父页未加载静态 listening bridge"
            assert parent_persistence_check.get("p1Word", {}).get("word") == parent_persistence_check.get("answer", {}).get("correct"), "真实父页未保存 P1 错词"
            assert parent_persistence_check.get("masterWord", {}).get("word") == parent_persistence_check.get("answer", {}).get("correct"), "真实父页未同步综合错词"
            assert parent_persistence_check.get("p1Word", {}).get("examId") == parent_persistence_check.get("target", {}).get("id"), "P1 错词 examId 未归一到父页题源"
            assert parent_persistence_check.get("masterWord", {}).get("examId") == parent_persistence_check.get("target", {}).get("id"), "综合错词 examId 未归一到父页题源"
            assert parent_persistence_check.get("p1Word", {}).get("userInput") == parent_persistence_check.get("answer", {}).get("wrong"), "P1 错词 userInput 错误"
            assert parent_persistence_check.get("masterWord", {}).get("userInput") == parent_persistence_check.get("answer", {}).get("wrong"), "综合错词 userInput 错误"
            assert parent_persistence_check.get("p1Word", {}).get("source") == "p1", "P1 错词 source 未归一"
            assert parent_persistence_check.get("masterWord", {}).get("source") == "p1", "综合错词 source 未归一"
            report["checks"]["parentPersistence"] = parent_persistence_check

            await context.close()
            await browser.close()
            context = None
            browser = None

            no_flag_browser = await launch_browser(playwright, allow_file_access=False)
            no_flag_context = await no_flag_browser.new_context()
            no_flag_page = await no_flag_context.new_page()
            collect_console(no_flag_page, console_log)
            try:
                await no_flag_page.goto(INDEX_URL)
                await ensure_app_ready(no_flag_page)
                await dismiss_overlays(no_flag_page)
                file_origin_check = await validate_file_origin_static_bridge_p2_persistence(no_flag_page, console_log)
                assert "listening-record-bridge.bundle.js" in file_origin_check.get("staticBridgeScript", ""), "真实 file:// P2 未加载静态 listening bridge"
                assert file_origin_check.get("bridgeState", {}).get("initialized") is True, "真实 file:// P2 bridge 未完成握手"
                assert file_origin_check.get("bridgeState", {}).get("completed") is True, "真实 file:// P2 bridge 未捕捉 Finish"
                assert file_origin_check.get("record", {}).get("examId") == file_origin_check.get("target", {}).get("id"), "真实 file:// P2 未保存当前听力记录"
                assert file_origin_check.get("record", {}).get("type") == "listening", "真实 file:// P2 记录类型错误"
                assert file_origin_check.get("record", {}).get("totalQuestions", 0) > 0, "真实 file:// P2 记录题数错误"
                report["checks"]["fileOriginStaticBridge"] = file_origin_check
            finally:
                await no_flag_context.close()
                await no_flag_browser.close()

            report["status"] = "pass"
            return 0
        except Exception as error:
            report["status"] = "fail"
            report["error"] = str(error)
            return 1
        finally:
            report["consoleErrors"] = [
                asdict(entry)
                for entry in console_log
                if entry.type and entry.type.lower() == "error"
            ]
            REPORT_DIR.mkdir(parents=True, exist_ok=True)
            REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            if context is not None:
                await context.close()
            if browser is not None:
                await browser.close()


if __name__ == "__main__":
    completed = asyncio.run(run())
    print(f"Listening optional E2E report: {REPORT_FILE}")
    raise SystemExit(completed)
