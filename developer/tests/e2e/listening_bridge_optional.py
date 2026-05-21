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


async def launch_browser(playwright) -> Browser:
    try:
        return await playwright.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
    except Exception:
        return await playwright.chromium.launch(headless=True)


async def ensure_app_ready(page: Page) -> None:
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && Array.isArray(window.listeningExamIndex)",
        timeout=60000,
    )


async def dismiss_overlays(page: Page) -> None:
    await page.evaluate(
        """
        () => {
            try { localStorage.setItem('hasSeenGplLicense', 'true'); } catch (_) {}
            if (typeof window.acceptGplLicense === 'function') {
                try { window.acceptGplLicense(); } catch (_) {}
            }
            const modal = document.getElementById('license-modal');
            if (modal) modal.classList.remove('show');
        }
        """
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
            const activeIndex = window.appStateService && typeof window.appStateService.getExamIndex === 'function'
                ? window.appStateService.getExamIndex()
                : (window.app && window.app.state ? window.app.state.examIndex : []);
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
            window.storage = {
                ready: Promise.resolve(),
                setNamespace() {},
                async get() { return null; },
                async set() { return true; },
                async remove() { return true; }
            };
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
    await bridge_page.add_script_tag(path=str(REPO_ROOT / "js" / "app" / "spellingErrorCollector.js"))
    await bridge_page.add_script_tag(path=str(BRIDGE_PATH))
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
        "() => window.__BRIDGE_MESSAGES.some(message => message && message.type === 'SESSION_READY')",
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
            return {
                messageCount: window.__BRIDGE_MESSAGES.length,
                payload: complete && complete.data
            };
        }
        """
    )
    await bridge_page.close()
    return result


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
            report["checks"]["bridge"] = bridge_check

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
            await context.close()
            await browser.close()


if __name__ == "__main__":
    completed = asyncio.run(run())
    print(f"Listening optional E2E report: {REPORT_FILE}")
    raise SystemExit(completed)
