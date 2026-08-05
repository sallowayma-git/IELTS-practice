#!/usr/bin/env python3
"""Force expectedParentOrigin='file://' on a real file:// reading child and prove INIT still binds.

Regression for the Chromium file-origin trap where URL.origin is "file://" but
postMessage event.origin is opaque "null". Invoked by e2e_runner.py and CI.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[3]
INDEX = (REPO / "index.html").as_uri() + "?view=practice"
REPORT = REPO / "developer" / "tests" / "e2e" / "reports" / "file-init-referrer-trap.json"


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] {msg}", flush=True)


async def main() -> int:
    report: dict = {"ok": False, "steps": [], "errors": [], "console": []}

    def step(name: str, **extra) -> None:
        report["steps"].append({"step": name, **extra})
        log(f"{name} {json.dumps(extra, ensure_ascii=False)[:400]}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        await context.add_init_script(
            "window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;"
        )

        page = await context.new_page()
        page.on(
            "pageerror",
            lambda err: report["errors"].append({"page": "host", "error": str(err)}),
        )
        page.on(
            "console",
            lambda msg: report["console"].append(
                {"page": "host", "type": msg.type, "text": msg.text}
            ),
        )

        def on_page(np) -> None:
            np.on(
                "pageerror",
                lambda err: report["errors"].append(
                    {"page": "child", "error": str(err)}
                ),
            )
            np.on(
                "console",
                lambda msg: report["console"].append(
                    {"page": "child", "type": msg.type, "text": msg.text}
                )
                or (
                    log(f"C [{msg.type}] {msg.text[:220]}")
                    if any(
                        k in msg.text
                        for k in (
                            "INIT",
                            "SESSION",
                            "reject",
                            "origin",
                            "ExamMessage",
                            "DataCollection",
                        )
                    )
                    or msg.type == "error"
                    else None
                ),
            )

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
        step(
            "host_ready",
            protocol=await page.evaluate("() => location.protocol"),
            origin=await page.evaluate("() => location.origin"),
        )

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
        if not exam_id:
            report["reason"] = "no exam"
            REPORT.write_text(
                json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            await browser.close()
            return 2

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
        await child.wait_for_function(
            """() => !!(window.__IELTS_UNIFIED_READING_PAGE_TEST__
                && typeof window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState === 'function'
                && typeof window.__IELTS_UNIFIED_READING_PAGE_TEST__.setTestState === 'function')""",
            timeout=60000,
        )

        natural = None
        for _ in range(40):
            natural = await child.evaluate(
                """() => {
                    const st = window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
                    return {
                        parentOrigin: st.parentOrigin,
                        parentOriginIsOpaque: st.parentOriginIsOpaque,
                        sessionReadySent: st.sessionReadySent,
                        windowSessionToken: st.windowSessionToken || '',
                        sessionId: st.sessionId || '',
                        expectedParentOrigin: st.expectedParentOrigin || ''
                    };
                }"""
            )
            if natural and natural.get("sessionReadySent") and natural.get("windowSessionToken"):
                break
            await asyncio.sleep(0.25)
        step("natural_bind", **(natural or {}))

        # Poison: old Chromium-file bug pins expectedParentOrigin to "file://",
        # then rejects INIT because event.origin is opaque "null".
        poisoned = await child.evaluate(
            """() => {
                const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
                hooks.setTestState({
                    expectedParentOrigin: 'file://',
                    parentOrigin: '',
                    parentOriginIsOpaque: false,
                    windowSessionToken: '',
                    sessionReadySent: false,
                    sessionId: '',
                    lastInitSignature: ''
                });
                try {
                    if (window.opener) {
                        window.opener.postMessage({
                            type: 'REQUEST_INIT',
                            source: 'practice_page',
                            data: {
                                examId: (hooks.getTestState().examId) || null,
                                reason: 'referrer-trap-rebind'
                            }
                        }, '*');
                    }
                } catch (error) {
                    return { requestError: String(error && error.message || error) };
                }
                return hooks.getTestState();
            }"""
        )
        step(
            "poisoned",
            expectedParentOrigin=(poisoned or {}).get("expectedParentOrigin"),
            parentOrigin=(poisoned or {}).get("parentOrigin"),
            sessionReadySent=(poisoned or {}).get("sessionReadySent"),
            requestError=(poisoned or {}).get("requestError"),
        )

        rebound = None
        for _ in range(40):
            rebound = await child.evaluate(
                """() => {
                    const st = window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
                    return {
                        expectedParentOrigin: st.expectedParentOrigin || '',
                        parentOrigin: st.parentOrigin,
                        parentOriginIsOpaque: st.parentOriginIsOpaque,
                        sessionReadySent: st.sessionReadySent,
                        windowSessionToken: st.windowSessionToken || '',
                        sessionId: st.sessionId || ''
                    };
                }"""
            )
            if (
                rebound
                and rebound.get("sessionReadySent")
                and rebound.get("windowSessionToken")
                and rebound.get("parentOriginIsOpaque") is True
                and rebound.get("parentOrigin") == "null"
            ):
                break
            await asyncio.sleep(0.25)
        step("rebound", **(rebound or {}))

        host_snap = await page.evaluate(
            """(examId) => {
                const info = window.app.examWindows && window.app.examWindows.get(examId);
                return {
                    lastMessageType: info && info.lastMessageType,
                    expectedOrigin: info && info.expectedOrigin,
                    allowOpaqueOrigin: info && info.allowOpaqueOrigin,
                    observedOrigin: info && info.observedOrigin,
                    hasToken: !!(info && info.windowSessionToken),
                    rejections: window.app._examMessageRejectionCounts
                        ? Array.from(window.app._examMessageRejectionCounts.entries())
                        : null
                };
            }""",
            exam_id,
        )
        step("host_after_rebind", **(host_snap or {}))

        matrix = await child.evaluate(
            """() => {
                function wouldAccept(expectedParentOrigin, incomingOrigin, declaredOrigin, protocol) {
                    const expected = expectedParentOrigin
                        && expectedParentOrigin !== 'file://'
                        && !String(expectedParentOrigin).startsWith('file:')
                        ? expectedParentOrigin
                        : '';
                    if (expected) {
                        return incomingOrigin === expected && declaredOrigin === expected;
                    }
                    if (protocol === 'file:') {
                        return (incomingOrigin === 'null' || incomingOrigin === 'file://')
                            && (declaredOrigin === 'null' || declaredOrigin === '' || declaredOrigin === 'file://');
                    }
                    return Boolean(incomingOrigin)
                        && incomingOrigin !== 'null'
                        && incomingOrigin !== 'file://'
                        && declaredOrigin === incomingOrigin;
                }
                const protocol = location.protocol;
                return {
                    protocol,
                    fixedAcceptsNullDeclared: wouldAccept('file://', 'null', 'null', protocol),
                    fixedAcceptsEmptyDeclared: wouldAccept('file://', 'null', '', protocol),
                    fixedAcceptsFileDeclared: wouldAccept('file://', 'null', 'file://', protocol),
                    fixedAcceptsFileEvent: wouldAccept('file://', 'file://', 'file://', protocol),
                    fixedRejectsWebSpoofOnFile: wouldAccept(
                        'file://',
                        'https://evil.example',
                        'https://evil.example',
                        protocol
                    ),
                    cleanFileAccepts: wouldAccept('', 'null', 'null', protocol),
                    httpStillWorks: wouldAccept(
                        'http://127.0.0.1:8765',
                        'http://127.0.0.1:8765',
                        'http://127.0.0.1:8765',
                        'http:'
                    )
                };
            }"""
        )
        step("accept_matrix", **matrix)

        natural_ok = bool(
            natural
            and natural.get("sessionReadySent")
            and natural.get("windowSessionToken")
            and natural.get("parentOriginIsOpaque") is True
        )
        rebound_ok = bool(
            rebound
            and rebound.get("sessionReadySent")
            and rebound.get("windowSessionToken")
            and rebound.get("parentOriginIsOpaque") is True
            and rebound.get("parentOrigin") == "null"
        )
        matrix_ok = bool(
            matrix.get("fixedAcceptsNullDeclared")
            and matrix.get("fixedAcceptsEmptyDeclared")
            and matrix.get("fixedAcceptsFileDeclared")
            and matrix.get("fixedAcceptsFileEvent")
            and not matrix.get("fixedRejectsWebSpoofOnFile")
            and matrix.get("cleanFileAccepts")
            and matrix.get("httpStillWorks")
        )
        report["ok"] = natural_ok and rebound_ok and matrix_ok
        report["checks"] = {
            "natural_ok": natural_ok,
            "rebound_ok": rebound_ok,
            "matrix_ok": matrix_ok,
        }
        step("done", ok=report["ok"], checks=report["checks"])
        REPORT.write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        log(f"report -> {REPORT}")
        await browser.close()
        return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
