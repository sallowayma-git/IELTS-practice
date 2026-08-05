#!/usr/bin/env python3
"""file:// practice open + INIT + submit settlement (no local server).

Canonical E2E case for Chromium file-protocol host/child postMessage and
practice settlement. Invoked by e2e_runner.py and CI.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[3]
INDEX = (REPO / "index.html").as_uri() + "?view=practice"
REPORT = REPO / "developer" / "tests" / "e2e" / "reports" / "practice-submit-file-flow.json"
CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {msg}", flush=True)


async def main() -> int:
    report = {"ok": False, "steps": [], "console": [], "errors": []}

    def step(name: str, **extra) -> None:
        report["steps"].append({"step": name, **extra})
        log(f"{name} {json.dumps(extra, ensure_ascii=False)[:360]}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=CHROME_UA)
        page = await context.new_page()
        page.on(
            "console",
            lambda msg: report["console"].append({"page": "host", "type": msg.type, "text": msg.text})
            or (
                log(f"H [{msg.type}] {msg.text[:220]}")
                if any(
                    k in msg.text
                    for k in (
                        "Practice", "Session", "DataCollection", "保存", "提交", "INIT",
                        "rejected", "origin", "ExamMessage", "合成", "活动", "升级", "ACK",
                    )
                )
                or msg.type == "error"
                else None
            ),
        )
        page.on("pageerror", lambda err: report["errors"].append({"page": "host", "error": str(err)}))

        def on_page(np) -> None:
            np.on(
                "console",
                lambda msg: report["console"].append({"page": "child", "type": msg.type, "text": msg.text})
                or log(f"C [{msg.type}] {msg.text[:200]}"),
            )
            np.on("pageerror", lambda err: report["errors"].append({"page": "child", "error": str(err)}))

        context.on("page", on_page)

        log(f"goto {INDEX}")
        await page.goto(INDEX, wait_until="domcontentloaded", timeout=90000)
        await page.wait_for_function(
            "() => window.app && window.app.isInitialized === true",
            timeout=120000,
        )
        await page.evaluate(
            """async () => {
                if (window.LicenseModal && typeof window.LicenseModal.accept === 'function') {
                    await window.LicenseModal.accept();
                }
                document.querySelectorAll('.modal.show, #license-modal, #library-loader-overlay')
                    .forEach((el) => {
                        el.classList.remove('show');
                        if (el.style) el.style.display = 'none';
                    });
            }"""
        )
        await page.wait_for_function(
            """() => {
                const r = window.app && window.app.components && window.app.components.practiceRecorder;
                return r && r.constructor && r.constructor.name === 'PracticeRecorder' && !r.isFallback;
            }""",
            timeout=60000,
        )
        host_meta = await page.evaluate(
            """() => ({
                protocol: location.protocol,
                origin: location.origin,
                href: location.href,
                userAgent: navigator.userAgent,
                testEnvironment: !!(window.EnvironmentDetector
                    && window.EnvironmentDetector.isInTestEnvironment())
            })"""
        )
        if host_meta["testEnvironment"]:
            raise AssertionError("file submit E2E must not run in test_env")
        step("host_ready", **host_meta)

        exam_id = await page.evaluate(
            """async () => {
                const index = await window.resolveActiveLibraryIndex();
                const list = Array.isArray(index) ? index : (index && index.exams) || [];
                const exam = list.find((item) => item && item.hasHtml !== false
                    && String(item.type || '').toLowerCase().includes('read')) || list[0];
                return exam && exam.id;
            }"""
        )
        step("picked_exam", examId=exam_id)

        async with context.expect_page(timeout=30000) as popup_info:
            open_result = await page.evaluate(
                """async (examId) => {
                    try {
                        await window.app.openExam(examId, { practiceMode: 'single' });
                        return { ok: true };
                    } catch (error) {
                        return { ok: false, error: String(error && error.message || error) };
                    }
                }""",
                exam_id,
            )
        step("openExam", result=open_result)
        child = await popup_info.value
        await child.wait_for_load_state("domcontentloaded", timeout=90000)
        child_meta = await child.evaluate(
            """() => ({
                protocol: location.protocol,
                origin: location.origin,
                href: location.href,
                hasOpener: !!window.opener,
                referrer: document.referrer
            })"""
        )
        step("child_loaded", **child_meta)

        host_snap = None
        for _ in range(50):
            host_snap = await page.evaluate(
                """(examId) => {
                    const info = window.app.examWindows && window.app.examWindows.get(examId);
                    const r = window.app.components.practiceRecorder;
                    const session = r && r.activeSessions && r.activeSessions.get(examId);
                    return {
                        lastMessageType: info && info.lastMessageType,
                        expectedOrigin: info && info.expectedOrigin,
                        allowOpaqueOrigin: info && info.allowOpaqueOrigin,
                        observedOrigin: info && info.observedOrigin,
                        expectedSessionId: info && info.expectedSessionId,
                        recorderSessionId: session && session.sessionId,
                        hasToken: !!(info && info.windowSessionToken),
                        rejections: window.app._examMessageRejectionCounts
                            ? Array.from(window.app._examMessageRejectionCounts.entries())
                            : null
                    };
                }""",
                exam_id,
            )
            if host_snap and host_snap.get("lastMessageType") == "SESSION_READY":
                break
            await asyncio.sleep(0.25)
        step("handshake", **(host_snap or {}))

        child_bind = await child.evaluate(
            """() => {
                // Prefer test hooks if present; otherwise infer from ability to post.
                const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
                if (hooks && typeof hooks.getTestState === 'function') {
                    const st = hooks.getTestState();
                    return {
                        parentOrigin: st.parentOrigin,
                        parentOriginIsOpaque: st.parentOriginIsOpaque,
                        windowSessionToken: st.windowSessionToken,
                        sessionId: st.sessionId,
                        sessionReadySent: st.sessionReadySent,
                        submissionStatus: st.submissionStatus
                    };
                }
                return {
                    title: document.title,
                    submit: !!document.querySelector('#submit-btn')
                };
            }"""
        )
        step("child_bind", **child_bind)

        await child.evaluate(
            """() => {
                Array.from(document.querySelectorAll(
                    'input[type="text"], input:not([type]), textarea, select, input[type="radio"]'
                )).slice(0, 10).forEach((el, index) => {
                    try {
                        if (el.tagName === 'SELECT' && el.options.length > 1) {
                            el.selectedIndex = 1;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        } else if (el.type === 'radio') {
                            el.checked = true;
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        } else {
                            el.value = 'a' + index;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    } catch (_) {}
                });
            }"""
        )
        click = await child.evaluate(
            """() => {
                const button = document.querySelector('#submit-btn');
                if (!button) return { clicked: false, reason: 'missing' };
                if (button.disabled) return { clicked: false, reason: 'disabled' };
                button.click();
                return { clicked: true };
            }"""
        )
        step("submit_click", **click)

        final = None
        child_ui = None
        for attempt in range(40):
            await asyncio.sleep(0.4)
            final = await page.evaluate(
                """async (examId) => {
                    const info = window.app.examWindows.get(examId);
                    let records = [];
                    try {
                        records = await window.AppData.practice.list({ projection: 'light' });
                    } catch (error) {
                        return { error: String(error && error.message || error) };
                    }
                    return {
                        status: info && info.status,
                        lastMessageType: info && info.lastMessageType,
                        submittedRecordId: info && info.submittedRecordId || null,
                        hasReceipts: !!(info && info.practiceSubmitReceipts
                            && Object.keys(info.practiceSubmitReceipts).length),
                        observedOrigin: info && info.observedOrigin,
                        expectedOrigin: info && info.expectedOrigin,
                        recordCount: records.length,
                        rejections: window.app._examMessageRejectionCounts
                            ? Array.from(window.app._examMessageRejectionCounts.entries())
                            : null
                    };
                }""",
                exam_id,
            )
            child_ui = await child.evaluate(
                """() => {
                    const results = document.getElementById('results');
                    return {
                        bodyClass: document.body.className,
                        readonly: document.body.classList.contains('review-readonly-mode'),
                        resultsDisplay: results ? results.style.display : null,
                        resultsText: results ? (results.innerText || '').trim().slice(0, 120) : null,
                        submitDisabled: document.querySelector('#submit-btn')
                            ? document.querySelector('#submit-btn').disabled
                            : null
                    };
                }"""
            )
            if (
                final
                and final.get("recordCount", 0) > 0
                and final.get("hasReceipts")
                and child_ui
                and child_ui.get("readonly")
            ):
                step("post_submit", host=final, child=child_ui, attempt=attempt)
                report["ok"] = True
                break
            if attempt == 39:
                step("post_submit_timeout", host=final, child=child_ui)

        report["host"] = final
        report["child"] = child_ui
        report["interestingConsole"] = [
            c for c in report["console"]
            if any(
                k.lower() in c["text"].lower()
                for k in (
                    "reject", "origin", "session", "保存", "DataCollection", "合成",
                    "INIT", "ACK", "Practice", "失败",
                )
            )
        ][-80:]
        step("done", ok=report["ok"])
        REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        log(f"report -> {REPORT}")
        await browser.close()
        return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
