#!/usr/bin/env python3
"""Single reading flow E2E: verify main communication path and no fallback/synthetic save."""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
import subprocess
import sys
from typing import List

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_PATH = REPO_ROOT / "index.html"
INDEX_URL = f"{INDEX_PATH.as_uri()}?test_env=1"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_FILE = REPORT_DIR / "reading-single-flow-report.json"
TARGET_UNIFIED_EXAM_ID = "p3-medium-169"
TARGET_MANUAL_PDF_EXAM_ID = "p2-high-26"

try:
    from playwright.async_api import (
        Browser,
        ConsoleMessage,
        Error as PlaywrightError,
        Page,
        TimeoutError as PlaywrightTimeoutError,
        async_playwright,
    )
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run(
            [str(venv_python), str(Path(__file__).resolve())],
            cwd=str(REPO_ROOT),
        )
        raise SystemExit(completed.returncode)

    node_runner = REPO_ROOT / "developer" / "tests" / "e2e" / "reading_single_flow.node.js"
    completed = subprocess.run(
        ["node", str(node_runner)],
        cwd=str(REPO_ROOT),
    )
    raise SystemExit(completed.returncode)


@dataclass
class ConsoleEntry:
    page: str
    type: str
    text: str
    timestamp: str


def log_step(message: str, level: str = "INFO") -> None:
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    prefix = {
        "INFO": "[INFO]",
        "SUCCESS": "[PASS]",
        "WARNING": "[WARN]",
        "ERROR": "[FAIL]",
        "DEBUG": "[DEBUG]",
    }.get(level, "[INFO]")
    print(f"[{timestamp}] {prefix} {message}")


def _collect_console(page: Page, store: List[ConsoleEntry]) -> None:
    def _handler(msg: ConsoleMessage) -> None:
        store.append(
            ConsoleEntry(
                page=page.url,
                type=msg.type,
                text=msg.text,
                timestamp=datetime.now().isoformat(),
            )
        )

    page.on("console", _handler)


async def _launch_chromium(p) -> Browser:
    try:
        return await p.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
    except Exception:
        return await p.chromium.launch(headless=True)


async def _ensure_app_ready(page: Page) -> None:
    await page.wait_for_load_state("load")
    await page.wait_for_function(
        "() => window.app && window.app.isInitialized && window.storage && typeof window.storage.get === 'function'",
        timeout=60000,
    )


async def _dismiss_overlays(page: Page) -> None:
    overlay = page.locator("#library-loader-overlay")
    if await overlay.count():
        try:
            await overlay.wait_for(state="visible", timeout=2000)
            close_btn = overlay.locator("[data-library-action='close']")
            if await close_btn.count():
                await close_btn.first.click()
                await overlay.wait_for(state="detached", timeout=5000)
        except Exception:
            pass


async def _click_nav(page: Page, view: str) -> None:
    await page.locator(f"nav button[data-view='{view}']").click()
    await page.wait_for_selector(f"#{view}-view.active", timeout=15000)


async def _wait_exam_index_ready(page: Page) -> None:
    await page.wait_for_function(
        """
        () => {
            const candidates = [];
            if (window.appStateService && typeof window.appStateService.getExamIndex === 'function') {
                candidates.push(window.appStateService.getExamIndex());
            }
            if (typeof window.getExamIndexState === 'function') {
                candidates.push(window.getExamIndexState());
            }
            if (window.app && window.app.state && Array.isArray(window.app.state.examIndex)) {
                candidates.push(window.app.state.examIndex);
            }
            if (Array.isArray(window.examIndex)) {
                candidates.push(window.examIndex);
            }
            return candidates.some((item) => Array.isArray(item) && item.length > 0);
        }
        """,
        timeout=60000,
    )


async def _ensure_reading_list_ready(page: Page) -> int:
    await _wait_exam_index_ready(page)
    await page.evaluate(
        """
        () => {
            if (window.app && typeof window.app.browseCategory === 'function') {
                window.app.browseCategory('all', 'reading');
            } else if (typeof window.browseCategory === 'function') {
                window.browseCategory('all', 'reading');
            }

            if (typeof window.loadExamList === 'function') {
                try { window.loadExamList(); } catch (_) { }
            }
        }
        """
    )
    await page.wait_for_function(
        "() => document.querySelectorAll('#exam-list-container .exam-item[data-exam-id]').length > 0",
        timeout=30000,
    )
    return await page.evaluate(
        "() => document.querySelectorAll('#exam-list-container .exam-item[data-exam-id]').length"
    )


async def _open_exam_popup(page: Page, exam_id: str, console_log: List[ConsoleEntry]) -> Page:
    selector = f"#exam-list-container .exam-item[data-exam-id='{exam_id}'] button[data-action='start']"
    start_btn = page.locator(selector).first
    async with page.expect_popup() as popup_wait:
        await _trigger_exam_open(page, exam_id, start_btn)
    practice_page = await popup_wait.value
    _collect_console(practice_page, console_log)
    await practice_page.wait_for_load_state("load")
    return practice_page


async def _trigger_exam_open(page: Page, exam_id: str, start_btn=None) -> None:
    button = start_btn or page.locator(
        f"#exam-list-container .exam-item[data-exam-id='{exam_id}'] button[data-action='start']"
    ).first
    if await button.count() > 0:
        await button.evaluate("(node) => node.click()")
        return

    await page.evaluate(
        """
        async (targetExamId) => {
            if (!window.app || typeof window.app.openExam !== 'function') {
                throw new Error('openExam_missing');
            }
            await window.app.openExam(targetExamId);
        }
        """,
        exam_id,
    )


async def _open_unified_exam(page: Page, exam_id: str, console_log: List[ConsoleEntry]) -> tuple[Page, str, bool, str]:
    practice_page = await _open_exam_popup(page, exam_id, console_log)
    await page.wait_for_function(
        """
        (targetExamId) => {
            const app = window.app;
            if (!app || !app.examWindows || typeof app.examWindows.get !== 'function') {
                return false;
            }
            const info = app.examWindows.get(targetExamId);
            return !!(info && info.expectedSessionId);
        }
        """,
        arg=exam_id,
        timeout=12000,
    )
    await practice_page.wait_for_function(
        "() => window.location.href.includes('assets/generated/reading-exams/reading-practice-unified.html') && !!document.getElementById('question-groups')",
        timeout=20000,
    )
    session_id = await page.evaluate(
        "(targetExamId) => window.app?.examWindows?.get?.(targetExamId)?.expectedSessionId || ''",
        exam_id,
    )
    collector_ready = await page.evaluate(
        "(targetExamId) => !!window.app?.examWindows?.get?.(targetExamId)?.dataCollectorReady",
        exam_id,
    )
    if not session_id:
        raise AssertionError(f"题目 {exam_id} 未生成 expectedSessionId")
    popup_url = await practice_page.evaluate("() => window.location.href")
    return practice_page, session_id, collector_ready, popup_url


async def _open_manual_pdf_exam(page: Page, exam_id: str) -> tuple[str, bool]:
    await page.evaluate(
        """
        () => {
            window.__readingPdfCapture = { urls: [] };
            window.__readingPdfNativeOpen = window.open;
            window.open = function(url) {
                const normalized = String(url || '');
                window.__readingPdfCapture.urls.push(normalized);
                return {
                    closed: false,
                    focus() {},
                    location: { href: normalized }
                };
            };
        }
        """
    )

    try:
        await page.evaluate(
            """
            async (targetExamId) => {
                if (!window.app || typeof window.app.openExam !== 'function') {
                    throw new Error('openExam_missing');
                }
                await window.app.openExam(targetExamId, { target: 'tab' });
            }
            """,
            exam_id,
        )
        await page.wait_for_timeout(300)
        popup_url = await page.evaluate(
            "() => window.__readingPdfCapture?.urls?.slice(-1)[0] || ''"
        )
        has_session = await page.evaluate(
            "(targetExamId) => !!window.app?.examWindows?.get?.(targetExamId)?.expectedSessionId",
            exam_id,
        )
        return popup_url, has_session
    finally:
        await page.evaluate(
            """
            () => {
                if (window.__readingPdfNativeOpen) {
                    window.open = window.__readingPdfNativeOpen;
                    delete window.__readingPdfNativeOpen;
                }
            }
            """
        )


async def run() -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    console_log: List[ConsoleEntry] = []
    started_at = datetime.now()

    status = "fail"
    failure: str | None = None
    exam_id: str | None = None
    session_id: str | None = None
    manual_pdf_url: str | None = None

    try:
        async with async_playwright() as p:
            browser = await _launch_chromium(p)
            context = await browser.new_context()
            context.on("page", lambda pg: _collect_console(pg, console_log))

            page = await context.new_page()
            _collect_console(page, console_log)

            log_step(f"打开页面: {INDEX_URL}")
            await page.goto(INDEX_URL)
            await _ensure_app_ready(page)
            await _dismiss_overlays(page)
            log_step("应用初始化完成", "SUCCESS")

            await _click_nav(page, "browse")
            await page.wait_for_function(
                "() => window.AppLazyLoader && window.AppLazyLoader.getStatus('browse-runtime').loaded === true",
                timeout=20000,
            )
            log_step("browse-runtime 已按需加载", "SUCCESS")

            reading_count = await _ensure_reading_list_ready(page)
            log_step(f"reading 题目列表已就绪，数量: {reading_count}", "SUCCESS")

            open_exam_type = await page.evaluate("() => typeof (window.app && window.app.openExam)")
            if open_exam_type != "function":
                raise AssertionError(f"window.app.openExam 不可用: {open_exam_type}")
            log_step("window.app.openExam 可用", "SUCCESS")

            checkpoint = len(console_log)
            exam_id = TARGET_UNIFIED_EXAM_ID
            practice_page, session_id, collector_ready, unified_url = await _open_unified_exam(page, exam_id, console_log)
            log_step(f"选中统一页题目: {exam_id}", "DEBUG")
            log_step(f"父页通信会话已就绪: {session_id}", "SUCCESS")
            log_step(f"SESSION_READY 状态: {'ready' if collector_ready else 'pending'}", "DEBUG")
            if "assets/generated/reading-exams/reading-practice-unified.html" not in unified_url:
                raise AssertionError(f"统一阅读页 URL 非预期: {unified_url}")

            completion_payload = {
                "examId": exam_id,
                "sessionId": session_id,
                "duration": 95,
                "startTime": datetime.now().isoformat(),
                "endTime": datetime.now().isoformat(),
                "scoreInfo": {
                    "correct": 1,
                    "total": 2,
                    "accuracy": 0.5,
                    "percentage": 50,
                    "source": "practice_page",
                },
                "answers": {"q1": "A", "q2": "B"},
                "correctAnswers": {"q1": "A", "q2": "C"},
                "answerComparison": {
                    "q1": {"questionId": "q1", "userAnswer": "A", "correctAnswer": "A", "isCorrect": True},
                    "q2": {"questionId": "q2", "userAnswer": "B", "correctAnswer": "C", "isCorrect": False},
                },
                "metadata": {"source": "reading_single_e2e"},
            }
            await practice_page.evaluate(
                """
                (payload) => {
                    const target = window.opener || window.parent;
                    if (!target || typeof target.postMessage !== 'function') {
                        throw new Error('missing_message_target');
                    }
                    target.postMessage({ type: 'PRACTICE_COMPLETE', data: payload, source: 'practice_page' }, '*');
                }
                """,
                completion_payload,
            )
            await page.wait_for_timeout(1800)
            if not practice_page.is_closed():
                await practice_page.close()

            await _click_nav(page, "practice")
            await page.wait_for_function(
                """
                (targetExamId) => {
                    const recordsFromState = window.app?.state?.practice?.records;
                    if (Array.isArray(recordsFromState) && recordsFromState.some(r => String(r?.examId || '') === targetExamId)) {
                        return true;
                    }
                    if (typeof window.getPracticeRecordsState === 'function') {
                        try {
                            const records = window.getPracticeRecordsState();
                            return Array.isArray(records) && records.some(r => String(r?.examId || '') === targetExamId);
                        } catch (_) {
                            return false;
                        }
                    }
                    return false;
                }
                """,
                arg=exam_id,
                timeout=30000,
            )
            log_step("练习记录已落地", "SUCCESS")

            tail_logs = console_log[checkpoint:]
            fallback_hits = [e for e in tail_logs if "[Fallback]" in e.text]
            synthetic_hits = [
                e for e in tail_logs
                if ("未找到匹配的活动会话" in e.text or "合成数据" in e.text)
            ]

            if fallback_hits:
                raise AssertionError(f"检测到 fallback 握手路径: {fallback_hits[0].text}")
            if synthetic_hits:
                raise AssertionError(f"检测到 synthetic 保存路径: {synthetic_hits[0].text}")

            log_step("未检测到 fallback/synthetic 路径", "SUCCESS")

            manual_pdf_url, manual_has_session = await _open_manual_pdf_exam(
                page, TARGET_MANUAL_PDF_EXAM_ID
            )
            log_step(f"手工 PDF 题目已打开: {TARGET_MANUAL_PDF_EXAM_ID}", "SUCCESS")
            if "reading-practice-unified.html" in (manual_pdf_url or "") or ".pdf" not in (manual_pdf_url or "").lower():
                raise AssertionError(f"手工 PDF 题目未打开 PDF: {manual_pdf_url}")
            if manual_has_session:
                raise AssertionError("手工 PDF 题目不应建立 unified/session 会话")

            await browser.close()
            status = "pass"

    except (PlaywrightTimeoutError, PlaywrightError, AssertionError, Exception) as error:
        failure = str(error)
        log_step(f"测试失败: {failure}", "ERROR")

    finally:
        report = {
            "generatedAt": datetime.now().isoformat(),
            "duration": (datetime.now() - started_at).total_seconds(),
            "status": status,
            "examId": exam_id,
            "sessionId": session_id,
            "manualPdfExamId": TARGET_MANUAL_PDF_EXAM_ID,
            "manualPdfUrl": manual_pdf_url,
            "error": failure,
            "consoleSummary": {
                "total": len(console_log),
                "errors": sum(1 for entry in console_log if entry.type.lower() == "error"),
                "warnings": sum(1 for entry in console_log if entry.type.lower() == "warning"),
            },
            "consoleLogs": [asdict(entry) for entry in console_log],
        }
        REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

        if status != "pass":
            raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(run())
