#!/usr/bin/env python3
"""Unified reading reliable-submit regression (file:// compatible)."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

REPO_ROOT = Path(__file__).resolve().parents[3]
UNIFIED_HTML = REPO_ROOT / "assets" / "generated" / "reading-exams" / "reading-practice-unified.html"
HOST_FIXTURE = REPO_ROOT / "developer" / "tests" / "e2e" / "fixtures" / "index.html"
TARGET_EXAM = "p1-low-67"

HOST_HTML = """<!doctype html>
<html>
<body>
  <iframe id="practice-frame" name="practice" style="width: 1200px; height: 900px;"></iframe>
  <script>
    (() => {
      const frame = document.getElementById('practice-frame');
      const clone = (value) => JSON.parse(JSON.stringify(value));
      window.__hostMessages = [];
      window.__hostTrace = [];
      window.__hostConfig = null;
      window.__hostSend = (request) => {
        const config = window.__hostConfig;
        const hasTokenOverride = Object.prototype.hasOwnProperty.call(request, 'token');
        const token = hasTokenOverride ? request.token : config.token;
        window.__hostTrace.push({ direction: 'out', type: request.type, token: Boolean(token) });
        frame.contentWindow.postMessage({
          type: request.type,
          source: request.source || 'exam_host',
          data: Object.assign({}, request.data || {}, {
            windowSessionToken: token,
            messageIssuedAtMs: Date.now()
          })
        }, '*');
      };
      const sendInit = () => {
        const config = window.__hostConfig;
        if (!config) return;
        window.__hostSend({
          type: 'INIT_SESSION',
          data: {
            examId: config.examId,
            sessionId: config.sessionId,
            suiteSessionId: null,
            practiceMode: 'single',
            parentOrigin: 'null'
          }
        });
      };
      window.addEventListener('message', (event) => {
        window.__hostTrace.push({
          direction: 'in',
          type: event.data && event.data.type,
          origin: event.origin,
          sourceMatch: event.source === frame.contentWindow
        });
        if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return;
        window.__hostMessages.push(clone(event.data));
        if (String(event.data.type || '').toUpperCase() !== 'REQUEST_INIT') return;
        sendInit();
      });
      frame.addEventListener('load', sendInit);
      window.__hostConfigure = (config) => {
        window.__hostConfig = clone(config);
        frame.src = config.url;
      };
    })();
  </script>
</body>
</html>"""

try:
    from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError, async_playwright  # type: ignore[import-untyped]
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([str(venv_python), str(Path(__file__).resolve())], cwd=str(REPO_ROOT))
        raise SystemExit(completed.returncode)
    raise SystemExit(json.dumps({"status": "fail", "detail": "playwright_python_missing"}, ensure_ascii=False))


def require(condition: bool, detail: str) -> None:
    if not condition:
        raise RuntimeError(detail)


async def open_practice(page: Page, session_id: str, token: str):
    url = f"{UNIFIED_HTML.as_uri()}?examId={TARGET_EXAM}&dataKey={TARGET_EXAM}&test_env=1"
    await page.goto(HOST_FIXTURE.as_uri(), wait_until="load")
    await page.set_content(HOST_HTML, wait_until="load")
    await page.evaluate(
        "config => window.__hostConfigure(config)",
        {"url": url, "examId": TARGET_EXAM, "sessionId": session_id, "token": token},
    )
    await page.wait_for_selector("#practice-frame")
    frame = page.frame(name="practice")
    require(frame is not None, "practice_frame_missing")
    await frame.wait_for_selector("#question-groups .unified-group", timeout=30000)
    await frame.wait_for_selector("#submit-btn", timeout=30000)
    try:
        await frame.wait_for_function(
            """() => {
                const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
                return !!(hooks && hooks.getTestState().sessionReadySent);
            }""",
            timeout=30000,
        )
    except PlaywrightTimeoutError as error:
        diagnostic = {
            "host": await page.evaluate("() => ({ trace: window.__hostTrace })"),
            "child": await frame.evaluate(
                """() => ({
                    href: location.href,
                    origin: location.origin,
                    referrer: document.referrer,
                    state: window.__IELTS_UNIFIED_READING_PAGE_TEST__?.getTestState?.() || null
                })"""
            ),
        }
        raise RuntimeError(f"handshake_ready_timeout:{json.dumps(diagnostic, ensure_ascii=False)}") from error
    return frame


async def get_state(frame) -> Dict[str, Any]:
    return await frame.evaluate(
        """() => {
            const state = window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
            const input = document.querySelector('input[type="text"], textarea');
            const submit = document.getElementById('submit-btn');
            const results = document.getElementById('results');
            const exit = document.getElementById('exit-btn');
            const reset = document.getElementById('reset-btn');
            const banner = document.getElementById('review-banner');
            const highlights = Array.from(document.querySelectorAll('#left .hl'));
            return {
                submissionStatus: state.submissionStatus,
                submissionId: state.submissionId,
                submitted: state.submitted,
                readOnly: state.readOnly,
                readOnlyClass: document.body.classList.contains('review-readonly-mode'),
                inputDisabled: !input || input.disabled === true,
                inputValue: input ? String(input.value || '') : '',
                submitDisabled: !!(submit && submit.disabled),
                resultsVisible: !!(results && getComputedStyle(results).display !== 'none'),
                exitVisible: !!(exit && getComputedStyle(exit).display !== 'none'),
                resetVisible: !!(reset && getComputedStyle(reset).display !== 'none'),
                bannerVisible: !!(banner && !banner.hidden && getComputedStyle(banner).display !== 'none'),
                bannerScore: banner ? String(document.getElementById('review-score')?.textContent || '') : '',
                bannerPartCards: banner ? document.querySelectorAll('#review-part-scores .review-part-score').length : 0,
                highlightCount: highlights.length,
                highlightTexts: highlights.map((node) => String(node.textContent || '').trim()).filter(Boolean)
            };
        }"""
    )


async def seed_answer_and_highlights(frame) -> Dict[str, Any]:
    seeded = await frame.evaluate(
        """() => {
            const input = document.querySelector('input[type="text"], textarea');
            if (!input) return { count: 0, texts: [], input: false };
            input.value = 'submit_probe';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            const left = document.getElementById('left');
            const walker = document.createTreeWalker(left, NodeFilter.SHOW_TEXT);
            const candidates = [];
            let node = null;
            while ((node = walker.nextNode())) {
                const text = String(node.textContent || '');
                if (text.trim().length >= 16) candidates.push(node);
            }
            for (const candidate of candidates) {
                if (document.querySelectorAll('#left .hl').length >= 2) break;
                const raw = String(candidate.textContent || '');
                const start = Math.max(0, raw.search(/\\S/));
                const end = Math.min(raw.length, start + 6);
                if (end <= start) continue;
                const range = document.createRange();
                range.setStart(candidate, start);
                range.setEnd(candidate, end);
                const span = document.createElement('span');
                span.className = 'hl';
                try { range.surroundContents(span); } catch (_) {}
            }
            const items = Array.from(document.querySelectorAll('#left .hl'));
            return {
                count: items.length,
                texts: items.map((item) => String(item.textContent || '').trim()).filter(Boolean),
                input: true
            };
        }"""
    )
    require(bool(seeded.get("input")), "text_input_missing")
    require(int(seeded.get("count") or 0) >= 2, f"highlight_seed_failed:{seeded}")
    return seeded


async def submissions(page: Page):
    return await page.evaluate(
        "() => window.__hostMessages.filter(message => message && message.type === 'PRACTICE_COMPLETE')"
    )


async def wait_for_submission_count(page: Page, count: int) -> None:
    await page.wait_for_function(
        "count => window.__hostMessages.filter(message => message && message.type === 'PRACTICE_COMPLETE').length >= count",
        arg=count,
        timeout=10000,
    )


async def send_host(page: Page, message_type: str, data: Dict[str, Any], **overrides: Any) -> None:
    request: Dict[str, Any] = {"type": message_type, "data": data}
    request.update(overrides)
    await page.evaluate("request => window.__hostSend(request)", request)


def correlation(message: Dict[str, Any]) -> Dict[str, Any]:
    data = message.get("data") or {}
    return {
        "submissionId": data.get("submissionId"),
        "sessionId": data.get("sessionId"),
        "examId": data.get("examId"),
        "suiteSessionId": data.get("suiteSessionId"),
    }


async def assert_pending(frame, detail: str) -> Dict[str, Any]:
    await frame.wait_for_timeout(80)
    state = await get_state(frame)
    require(state.get("submissionStatus") == "submitting", f"{detail}:not_submitting:{state}")
    require(not state.get("submitted"), f"{detail}:submitted_before_ack:{state}")
    require(not state.get("readOnly"), f"{detail}:readonly_before_ack:{state}")
    require(not state.get("readOnlyClass"), f"{detail}:readonly_class_before_ack:{state}")
    require(not state.get("resetVisible"), f"{detail}:reset_visible_before_ack:{state}")
    require(not state.get("bannerVisible"), f"{detail}:banner_visible_before_ack:{state}")
    require(not state.get("inputDisabled"), f"{detail}:input_disabled_before_ack:{state}")
    require(bool(state.get("submitDisabled")), f"{detail}:submit_not_guarded:{state}")
    require(not state.get("resultsVisible"), f"{detail}:results_visible_before_ack:{state}")
    return state


async def run_ack_and_nack_scenario(context) -> Dict[str, Any]:
    page = await context.new_page()
    frame = await open_practice(page, "session-submit-contract", "token-submit-contract")
    seeded = await seed_answer_and_highlights(frame)

    await frame.click("#submit-btn")
    await wait_for_submission_count(page, 1)
    first = (await submissions(page))[0]
    corr = correlation(first)
    require(all(corr.get(key) for key in ("submissionId", "sessionId", "examId")), f"missing_correlation:{corr}")
    require(corr.get("suiteSessionId") is None, f"unexpected_suite_session:{corr}")
    pending = await assert_pending(frame, "initial_delivery")

    await frame.evaluate(
        """() => {
            const input = document.querySelector('input[type="text"], textarea');
            input.value = 'edited_while_submitting';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    pending_after_edit = await assert_pending(frame, "editable_while_submitting")
    require(pending_after_edit.get("inputValue") == "edited_while_submitting", "input_not_editable_while_submitting")

    await send_host(page, "PRACTICE_SUBMIT_ACK", corr, token="forged-token")
    await assert_pending(frame, "forged_token_ack")
    for field, value in (
        ("submissionId", "submission-mismatch"),
        ("sessionId", "session-mismatch"),
        ("examId", "exam-mismatch"),
        ("suiteSessionId", "suite-mismatch"),
    ):
        mismatch = dict(corr)
        mismatch[field] = value
        await send_host(page, "PRACTICE_SUBMIT_ACK", mismatch)
        await assert_pending(frame, f"mismatched_{field}_ack")

    await send_host(page, "PRACTICE_SUBMIT_FAILED", corr)
    await frame.wait_for_function(
        "() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'draft'"
    )
    after_nack = await get_state(frame)
    require(not after_nack.get("readOnly"), f"nack_locked_page:{after_nack}")
    require(not after_nack.get("inputDisabled"), f"nack_disabled_input:{after_nack}")
    require(not after_nack.get("submitDisabled"), f"nack_not_retryable:{after_nack}")
    require(not after_nack.get("resultsVisible"), f"nack_showed_results:{after_nack}")

    await send_host(page, "PRACTICE_SUBMIT_ACK", corr)
    await frame.wait_for_timeout(120)
    late_after_nack = await get_state(frame)
    require(late_after_nack.get("submissionStatus") == "draft", f"late_ack_after_nack_accepted:{late_after_nack}")
    require(not late_after_nack.get("readOnly"), f"late_ack_after_nack_locked:{late_after_nack}")

    await frame.click("#submit-btn")
    await wait_for_submission_count(page, 2)
    retry = (await submissions(page))[1]
    require(
        retry.get("data", {}).get("submissionId") == corr.get("submissionId"),
        f"retry_changed_idempotency_key:{retry.get('data')}",
    )
    await assert_pending(frame, "retry_delivery")
    await send_host(page, "PRACTICE_SUBMIT_ACK", correlation(retry))
    await frame.wait_for_function(
        "() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'submitted'"
    )
    await frame.wait_for_function(
        "() => { const node = document.getElementById('results'); return !!node && getComputedStyle(node).display !== 'none'; }"
    )
    after_ack = await get_state(frame)
    require(after_ack.get("submitted"), f"valid_ack_not_submitted:{after_ack}")
    require(after_ack.get("readOnly") and after_ack.get("readOnlyClass"), f"valid_ack_not_readonly:{after_ack}")
    require(after_ack.get("resetVisible"), f"valid_ack_reset_hidden:{after_ack}")
    require(after_ack.get("bannerVisible"), f"valid_ack_banner_hidden:{after_ack}")
    require("/" in after_ack.get("bannerScore", ""), f"valid_ack_banner_score_missing:{after_ack}")
    require(after_ack.get("bannerPartCards", 0) >= 1, f"valid_ack_banner_part_cards_missing:{after_ack}")
    require(after_ack.get("inputDisabled"), f"valid_ack_input_enabled:{after_ack}")
    require(after_ack.get("submitDisabled"), f"valid_ack_submit_enabled:{after_ack}")
    require(after_ack.get("resultsVisible"), f"valid_ack_results_hidden:{after_ack}")
    require(after_ack.get("exitVisible"), f"valid_ack_exit_hidden:{after_ack}")
    require(int(after_ack.get("highlightCount") or 0) >= int(seeded.get("count") or 0), "highlight_count_decreased")
    require(
        all(text in (after_ack.get("highlightTexts") or []) for text in (seeded.get("texts") or [])),
        "highlight_text_not_preserved",
    )
    await page.close()
    return {"pending": pending, "afterNack": after_nack, "afterAck": after_ack}


async def run_timeout_scenario(context) -> Dict[str, Any]:
    page = await context.new_page()
    frame = await open_practice(page, "session-submit-timeout", "token-submit-timeout")
    await seed_answer_and_highlights(frame)
    await frame.click("#submit-btn")
    await wait_for_submission_count(page, 1)
    first = (await submissions(page))[0]
    corr = correlation(first)
    await assert_pending(frame, "timeout_initial_delivery")

    await frame.wait_for_function(
        "() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'draft'",
        timeout=15000,
    )
    after_timeout = await get_state(frame)
    require(not after_timeout.get("readOnly"), f"timeout_locked_page:{after_timeout}")
    require(not after_timeout.get("inputDisabled"), f"timeout_disabled_input:{after_timeout}")
    require(not after_timeout.get("submitDisabled"), f"timeout_not_retryable:{after_timeout}")
    require(not after_timeout.get("resultsVisible"), f"timeout_showed_results:{after_timeout}")

    await send_host(page, "PRACTICE_SUBMIT_ACK", corr)
    await frame.wait_for_timeout(120)
    late_after_timeout = await get_state(frame)
    require(late_after_timeout.get("submissionStatus") == "draft", f"late_ack_after_timeout_accepted:{late_after_timeout}")
    require(not late_after_timeout.get("readOnly"), f"late_ack_after_timeout_locked:{late_after_timeout}")

    await frame.click("#submit-btn")
    await wait_for_submission_count(page, 2)
    retry = (await submissions(page))[1]
    require(
        retry.get("data", {}).get("submissionId") == corr.get("submissionId"),
        f"timeout_retry_changed_idempotency_key:{retry.get('data')}",
    )
    await assert_pending(frame, "timeout_retry_delivery")
    await send_host(page, "PRACTICE_SUBMIT_ACK", correlation(retry))
    await frame.wait_for_function(
        "() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'submitted'"
    )
    after_retry_ack = await get_state(frame)
    require(after_retry_ack.get("readOnly"), f"timeout_retry_ack_not_readonly:{after_retry_ack}")
    await page.close()
    return {"afterTimeout": after_timeout, "lateAfterTimeout": late_after_timeout, "afterRetryAck": after_retry_ack}


async def run() -> Dict[str, Any]:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
        context = await browser.new_context(viewport={"width": 1440, "height": 1000})
        await context.add_init_script(script="window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;")
        try:
            ack_and_nack = await run_ack_and_nack_scenario(context)
            timeout = await run_timeout_scenario(context)
        finally:
            await context.close()
            await browser.close()
    return {
        "status": "pass",
        "detail": "unified reliable submit acknowledgement regression passed",
        "data": {"ackAndNack": ack_and_nack, "timeout": timeout},
    }


async def main() -> int:
    try:
        payload = await run()
    except Exception as error:
        print(json.dumps({
            "status": "fail",
            "detail": "unified reliable submit acknowledgement regression failed",
            "error": str(error),
        }, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
