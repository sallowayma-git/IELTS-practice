#!/usr/bin/env python3
"""Simulation mode roundtrip restore regression.

Covers real flow from index page:
- open suite in simulation mode via modal
- P1 answer + highlight should restore after P1->P2->P1
- P2 grouped checkbox answers (q10_11 / q12_13) should restore after P2->P1->P2
- repeated P3<->P2 navigation should keep buttons responsive
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[3]
INDEX_URL = (REPO_ROOT / "index.html").as_uri()
TARGET_EXAMS = ["p1-low-67", "p2-low-148", "p3-high-32"]
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

try:
    from playwright.async_api import Error as PlaywrightError  # type: ignore[import-untyped]
    from playwright.async_api import async_playwright  # type: ignore[import-untyped]
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([str(venv_python), str(Path(__file__).resolve())], cwd=str(REPO_ROOT))
        raise SystemExit(completed.returncode)
    raise SystemExit(json.dumps({"status": "fail", "detail": "playwright_python_missing"}, ensure_ascii=False))


async def safe_exam_id(page) -> str:
    for _ in range(10):
        try:
            return await page.evaluate(
                """() => {
                    try { return new URL(location.href).searchParams.get('examId') || ''; }
                    catch (_) { return ''; }
                }"""
            )
        except PlaywrightError:
            await page.wait_for_timeout(120)
    return ""


async def wait_exam_change(page, old_exam_id: str, timeout_ms: int = 25000) -> str:
    rounds = timeout_ms // 250
    for _ in range(rounds):
        current = await safe_exam_id(page)
        if current and current != old_exam_id:
            await page.wait_for_load_state("load")
            await page.wait_for_selector("#submit-btn", timeout=20000)
            return current
        await page.wait_for_timeout(250)
    return await safe_exam_id(page)


async def click_and_wait_change(page, selector: str, old_exam_id: str) -> str:
    await page.click(selector)
    return await wait_exam_change(page, old_exam_id)


async def add_highlight(page) -> int:
    return await page.evaluate(
        """() => {
            const left = document.getElementById('left');
            if (!left) return 0;
            const walker = document.createTreeWalker(left, NodeFilter.SHOW_TEXT);
            let node = null;
            while ((node = walker.nextNode())) {
                const raw = String(node.textContent || '');
                if (raw.replace(/\\s+/g, ' ').trim().length < 10) continue;
                const start = raw.search(/\\S/);
                if (start < 0) continue;
                const end = Math.min(raw.length, start + 8);
                const range = document.createRange();
                range.setStart(node, start);
                range.setEnd(node, end);
                const span = document.createElement('span');
                span.className = 'hl';
                try {
                    range.surroundContents(span);
                    return document.querySelectorAll('.hl').length;
                } catch (_) {}
            }
            return document.querySelectorAll('.hl').length;
        }"""
    )


async def mark_first_answer(page, tag: str) -> Tuple[str, str, str]:
    if await page.locator('input[type="text"][name], textarea[name]').count() > 0:
        field = page.locator('input[type="text"][name], textarea[name]').first
        name = await field.get_attribute("name")
        value = f"{tag}_text"
        await field.fill(value)
        return ("text", name or "", value)

    if await page.locator('input[type="radio"][name]').count() > 0:
        field = page.locator('input[type="radio"][name]').first
        name = await field.get_attribute("name")
        value = await field.get_attribute("value")
        await field.check(force=True)
        return ("radio", name or "", value or "")

    if await page.locator('input[type="checkbox"][name]').count() > 0:
        field = page.locator('input[type="checkbox"][name]').first
        name = await field.get_attribute("name")
        value = await field.get_attribute("value")
        await field.check(force=True)
        return ("checkbox", name or "", value or "")

    return ("none", "", "")


async def read_marker(page, marker: Tuple[str, str, str]) -> Any:
    kind, key, _ = marker
    if kind == "text":
        return await page.evaluate(
            """(name) => {
                const node = document.querySelector('input[type="text"][name="' + name + '"]'
                    + ', textarea[name="' + name + '"]');
                return node ? String(node.value || '') : null;
            }""",
            key,
        )
    if kind == "radio":
        return await page.evaluate(
            """(name) => {
                const node = document.querySelector('input[type="radio"][name="' + name + '"]:checked');
                return node ? String(node.value || '') : '';
            }""",
            key,
        )
    if kind == "checkbox":
        return await page.evaluate(
            """(name) => Array.from(document.querySelectorAll('input[type="checkbox"][name="' + name + '"]:checked'))
                .map(node => String(node.value || '')).sort()""",
            key,
        )
    return None


async def read_grouped_checkbox_answers(page) -> Dict[str, List[str]]:
    return await page.evaluate(
        """() => {
            const selected = (name) => Array.from(document.querySelectorAll('input[type="checkbox"][name="' + name + '"]:checked'))
                .map((node) => String(node.value || '').trim())
                .sort();
            return {
                q10_11: selected('q10_11'),
                q12_13: selected('q12_13')
            };
        }"""
    )


async def ensure_fixed_suite_index(page) -> None:
    await page.evaluate(
        """async () => {
            if (window.AppEntry && typeof window.AppEntry.ensureSessionSuiteReady === 'function') {
                await window.AppEntry.ensureSessionSuiteReady();
                return true;
            }
            if (typeof window.ensurePracticeSuite === 'function') {
                await window.ensurePracticeSuite();
                return true;
            }
            return true;
        }"""
    )
    ok = await page.evaluate(
        """async (targetExams) => {
            try {
                window.__IELTS_FORCE_TEST_ENV__ = false;
                if (window.EnvironmentDetector && typeof window.EnvironmentDetector.disableTestEnvironment === 'function') {
                    window.EnvironmentDetector.disableTestEnvironment();
                }
                if (window.localStorage) {
                    window.localStorage.removeItem('__ielts_test_env__');
                }
            } catch (_) {
                // ignore storage errors
            }
            const app = window.app;
            if (!app || typeof app._fetchSuiteExamIndex !== 'function') {
                return false;
            }
            if (!app.__origFetchSuiteExamIndexForRegression) {
                app.__origFetchSuiteExamIndexForRegression = app._fetchSuiteExamIndex.bind(app);
            }
            const original = app.__origFetchSuiteExamIndexForRegression;
            app._fetchSuiteExamIndex = async function patchedFetchSuiteExamIndex() {
                const fullIndex = await original();
                if (!Array.isArray(fullIndex) || !fullIndex.length) {
                    return fullIndex;
                }
                const picked = [];
                for (let index = 0; index < targetExams.length; index += 1) {
                    const examId = String(targetExams[index] || '').trim();
                    if (!examId) continue;
                    const found = fullIndex.find((item) => item && item.id === examId);
                    if (found) picked.push(found);
                }
                return picked.length ? picked : fullIndex;
            };
            return true;
        }""",
        TARGET_EXAMS,
    )
    if not ok:
        raise RuntimeError("cannot_patch_suite_index")


async def dismiss_license_modal_if_present(page) -> None:
    await page.evaluate(
        """() => {
            try {
                if (typeof window.acceptGplLicense === 'function') {
                    window.acceptGplLicense();
                    return;
                }
                if (window.localStorage) {
                    window.localStorage.setItem('hasSeenGplLicense', 'true');
                }
            } catch (_) {
                // ignore storage errors
            }
            const modal = document.getElementById('license-modal');
            if (modal) {
                modal.classList.remove('show');
            }
        }"""
    )
    modal = page.locator("#license-modal.show")
    if await modal.count() > 0:
        await page.wait_for_timeout(150)


async def run() -> Dict[str, Any]:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
        context = await browser.new_context(user_agent=UA)

        page = await context.new_page()
        await page.goto(INDEX_URL)
        await page.wait_for_function("() => window.app && window.app.isInitialized", timeout=60000)
        await dismiss_license_modal_if_present(page)
        await ensure_fixed_suite_index(page)

        start_button = page.locator("button[data-action='start-suite-mode']").first
        async with page.expect_popup() as popup_wait:
            await start_button.click()
            await page.locator("#suite-mode-selector-modal").wait_for(state="visible", timeout=10000)
            await page.locator("#suite-mode-selector-modal button[data-suite-flow-mode='simulation']").click()
            await page.locator("#suite-mode-selector-modal").wait_for(state="hidden", timeout=10000)

        suite_page = await popup_wait.value
        await suite_page.wait_for_load_state("load")
        await suite_page.wait_for_selector("#submit-btn", timeout=30000)
        await suite_page.wait_for_timeout(600)

        first_exam = await safe_exam_id(suite_page)
        if first_exam != TARGET_EXAMS[0]:
            raise RuntimeError(f"unexpected_first_exam:{first_exam}")

        marker_p1 = await mark_first_answer(suite_page, "p1")
        if marker_p1[0] == "none":
            raise RuntimeError("p1_marker_missing")
        hl_initial = await add_highlight(suite_page)

        second_exam = await click_and_wait_change(suite_page, "#submit-btn", first_exam)
        if second_exam != TARGET_EXAMS[1]:
            raise RuntimeError(f"unexpected_second_exam:{second_exam}")

        await suite_page.wait_for_timeout(700)
        marker_p2 = await mark_first_answer(suite_page, "p2")
        if marker_p2[0] == "none":
            raise RuntimeError("p2_marker_missing")

        # grouped checkboxes on p2-low-148
        await suite_page.check('input[type="checkbox"][name="q10_11"][value="A"]', force=True)
        await suite_page.check('input[type="checkbox"][name="q10_11"][value="D"]', force=True)
        await suite_page.check('input[type="checkbox"][name="q12_13"][value="B"]', force=True)
        await suite_page.check('input[type="checkbox"][name="q12_13"][value="E"]', force=True)
        grouped_expected = {
            "q10_11": ["A", "D"],
            "q12_13": ["B", "E"],
        }

        p1_back = await click_and_wait_change(suite_page, "#reset-btn", second_exam)
        if p1_back != TARGET_EXAMS[0]:
            raise RuntimeError(f"unexpected_back_to_p1:{p1_back}")

        await suite_page.wait_for_timeout(800)
        restored_p1 = await read_marker(suite_page, marker_p1)
        hl_restored = await suite_page.evaluate("() => document.querySelectorAll('.hl').length")

        p2_back = await click_and_wait_change(suite_page, "#submit-btn", p1_back)
        if p2_back != TARGET_EXAMS[1]:
            raise RuntimeError(f"unexpected_back_to_p2:{p2_back}")

        await suite_page.wait_for_timeout(800)
        restored_p2 = await read_marker(suite_page, marker_p2)
        grouped_restored = await read_grouped_checkbox_answers(suite_page)

        # move to p3 and stress P3<->P2 roundtrip to catch dead nav buttons
        third_exam = await click_and_wait_change(suite_page, "#submit-btn", p2_back)
        if third_exam != TARGET_EXAMS[2]:
            raise RuntimeError(f"unexpected_third_exam:{third_exam}")

        nav_trace = []
        current = third_exam
        for index in range(3):
            prev_exam = await click_and_wait_change(suite_page, "#reset-btn", current)
            nav_trace.append({"step": f"p3_to_p2_{index}", "from": current, "to": prev_exam})
            if prev_exam != TARGET_EXAMS[1]:
                raise RuntimeError(f"p3_to_p2_failed:{prev_exam}")
            next_exam = await click_and_wait_change(suite_page, "#submit-btn", prev_exam)
            nav_trace.append({"step": f"p2_to_p3_{index}", "from": prev_exam, "to": next_exam})
            if next_exam != TARGET_EXAMS[2]:
                raise RuntimeError(f"p2_to_p3_failed:{next_exam}")
            current = next_exam

        button_state = await suite_page.evaluate(
            """() => ({
                resetText: document.getElementById('reset-btn')?.textContent || '',
                submitText: document.getElementById('submit-btn')?.textContent || '',
                resetDisabled: !!document.getElementById('reset-btn')?.disabled,
                submitDisabled: !!document.getElementById('submit-btn')?.disabled
            })"""
        )

        await browser.close()

        return {
            "status": "pass",
            "detail": "simulation roundtrip restore regression passed",
            "data": {
                "markerP1": marker_p1,
                "markerP2": marker_p2,
                "restoredP1": restored_p1,
                "restoredP2": restored_p2,
                "hlInitial": hl_initial,
                "hlRestored": hl_restored,
                "groupedExpected": grouped_expected,
                "groupedRestored": grouped_restored,
                "buttonState": button_state,
                "navTrace": nav_trace,
            },
        }


async def main() -> int:
    try:
        payload = await run()
    except Exception as error:  # broad by design for regression report
        print(json.dumps({
            "status": "fail",
            "detail": "simulation roundtrip restore regression failed",
            "error": str(error),
        }, ensure_ascii=False))
        return 1

    data = payload.get("data") or {}
    marker_p1 = data.get("markerP1") or ["", "", ""]
    marker_p2 = data.get("markerP2") or ["", "", ""]
    restored_p1 = data.get("restoredP1")
    restored_p2 = data.get("restoredP2")
    grouped_expected = data.get("groupedExpected") or {}
    grouped_restored = data.get("groupedRestored") or {}
    hl_initial = int(data.get("hlInitial") or 0)
    hl_restored = int(data.get("hlRestored") or 0)

    checks = [
        (restored_p1 == marker_p1[2], "p1_answer_not_restored"),
        (restored_p2 == marker_p2[2], "p2_answer_not_restored"),
        (grouped_restored.get("q10_11") == grouped_expected.get("q10_11"), "group_q10_11_not_restored"),
        (grouped_restored.get("q12_13") == grouped_expected.get("q12_13"), "group_q12_13_not_restored"),
        (hl_initial > 0 and hl_restored > 0, "highlight_not_restored"),
    ]

    failed = [label for ok, label in checks if not ok]
    if failed:
        print(json.dumps({
            "status": "fail",
            "detail": "simulation roundtrip restore regression assertions failed",
            "failed": failed,
            "data": data,
        }, ensure_ascii=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
