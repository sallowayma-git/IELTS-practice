#!/usr/bin/env python3
"""Simulation NB drag/drop persistence regression test.

Covers:
- NB clone drag question status should become answered right after drop.
- Simulation draft replay should restore dragged answer and answered status.
- Simulation draft mirror should exist in sessionStorage.
- Highlight replay should restore at least one highlight when a record is available.
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[3]
UNIFIED_READING_PATH = REPO_ROOT / "assets" / "generated" / "reading-exams" / "reading-practice-unified.html"
GENERATED_READING_DIR = REPO_ROOT / "assets" / "generated" / "reading-exams"

try:
    from playwright.async_api import async_playwright  # type: ignore[import-untyped]
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([str(venv_python), str(Path(__file__).resolve())], cwd=str(REPO_ROOT))
        raise SystemExit(completed.returncode)
    raise SystemExit(json.dumps({"status": "fail", "detail": "playwright_python_missing"}, ensure_ascii=False))


SOURCE_SELECTOR = (
    ".cardpool .card, .cardpool .drag-item, .option-pool .card, "
    ".pool-items .drag-item, #word-options .draggable-word, #word-options .drag-item, "
    ".draggable-word, .drag-item"
)


def collect_nb_exam_ids() -> List[str]:
    exam_ids: List[str] = []
    for script in sorted(GENERATED_READING_DIR.glob("p*-*.js")):
        text = script.read_text(encoding="utf-8", errors="ignore")
        if not re.search(r'data-clone=(?:\\\"|")true(?:\\\"|")', text):
            continue
        if "match-dropzone" not in text:
            continue
        exam_ids.append(script.stem)
    return exam_ids


async def run_case(page, exam_id: str, base_url: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "examId": exam_id,
        "status": "pass",
    }
    url = (
        f"{base_url}?examId={exam_id}&dataKey={exam_id}"
        "&suiteSessionId=nb-drag-regression"
        "&suiteFlowMode=simulation&suiteSequenceIndex=0&suiteSequenceTotal=3&test_env=1"
    )
    await page.goto(url, wait_until="load")
    await page.wait_for_selector("#question-groups .unified-group", timeout=30000)

    target = page.locator(".match-dropzone[data-question]").first
    target_count = await page.locator(".match-dropzone[data-question]").count()
    source_count = await page.locator(SOURCE_SELECTOR).count()

    if target_count == 0 or source_count == 0:
        result["status"] = "fail"
        result["error"] = f"target_or_source_missing:targets={target_count},sources={source_count}"
        return result

    question_id = await target.get_attribute("data-question")
    await page.locator(SOURCE_SELECTOR).first.drag_to(target)
    await page.wait_for_timeout(250)

    after_drop = await page.evaluate(
        """(qid) => {
            const zone = document.querySelector('.match-dropzone[data-question="' + qid + '"]');
            const nav = document.querySelector('.q-item[data-question-id="' + qid + '"]');
            const item = zone ? zone.querySelector('.drag-item, .card, .draggable-word') : null;
            const answer = item ? String(item.dataset.answerValue || item.dataset.value || item.textContent || '').trim() : '';
            return {
                hasItem: Boolean(item),
                answered: Boolean(nav && nav.classList.contains('answered')),
                answer
            };
        }""",
        question_id,
    )

    if not after_drop.get("hasItem") or not after_drop.get("answered"):
        result["status"] = "fail"
        result["error"] = f"drop_state_invalid:{after_drop}"
        result["questionId"] = question_id
        return result

    await page.evaluate(
        """(qid) => {
            const zone = document.querySelector('.match-dropzone[data-question="' + qid + '"]');
            if (!zone) return;
            zone.innerHTML = '';
            zone.dataset.answerValue = '';
            zone.dataset.answerLabel = '';
            const nav = document.querySelector('.q-item[data-question-id="' + qid + '"]');
            if (nav) nav.classList.remove('answered');
        }""",
        question_id,
    )

    highlight_record = await page.evaluate(
        """() => {
            const root = document.getElementById('left');
            const full = String(root && root.textContent ? root.textContent : '');
            const match = full.match(/[A-Za-z][A-Za-z'’\\-\\s]{12,}/);
            if (!match) return null;
            const text = String(match[0] || '').replace(/\\s+/g, ' ').trim().slice(0, 12).trim();
            if (!text) return null;
            const hit = full.indexOf(text);
            if (hit < 0) return null;
            return {
                scope: 'left',
                text,
                occurrence: 0,
                before: full.slice(Math.max(0, hit - 20), hit),
                after: full.slice(hit + text.length, hit + text.length + 20)
            };
        }"""
    )

    text_probe = await page.evaluate(
        """() => {
            const field = document.querySelector('input[type="text"][name], textarea[name]');
            if (!field) return null;
            return {
                name: String(field.getAttribute('name') || '').trim(),
                value: 'simulation_draft_probe'
            };
        }"""
    )

    draft_answers = {
        question_id: after_drop.get("answer") or "A"
    }
    if text_probe and text_probe.get("name"):
        draft_answers[text_probe["name"]] = text_probe.get("value") or "simulation_draft_probe"

    draft = {
        "answers": draft_answers,
        "highlights": [highlight_record] if highlight_record else [],
        "scrollY": 0,
    }

    await page.evaluate(
        """(payload) => {
            window.postMessage({
                type: 'SIMULATION_CONTEXT',
                data: {
                    flowMode: 'simulation',
                    examId: payload.examId,
                    suiteSessionId: 'nb-drag-regression',
                    currentIndex: 0,
                    total: 3,
                    isLast: false,
                    canPrev: false,
                    canNext: true,
                    elapsed: 0,
                    draft: payload.draft
                }
            }, '*');
        }""",
        {"examId": exam_id, "draft": draft},
    )
    await page.wait_for_timeout(400)

    after_replay = await page.evaluate(
        """(qid) => {
            const zone = document.querySelector('.match-dropzone[data-question="' + qid + '"]');
            const nav = document.querySelector('.q-item[data-question-id="' + qid + '"]');
            const item = zone ? zone.querySelector('.drag-item, .card, .draggable-word') : null;
            return {
                restored: Boolean(item),
                answered: Boolean(nav && nav.classList.contains('answered')),
                highlightCount: document.querySelectorAll('.hl').length
            };
        }""",
        question_id,
    )

    if not after_replay.get("restored") or not after_replay.get("answered"):
        result["status"] = "fail"
        result["error"] = f"replay_state_invalid:{after_replay}"
        result["questionId"] = question_id
        return result

    if text_probe and text_probe.get("name"):
        text_value_ok = await page.evaluate(
            """(probe) => {
                const selector = 'input[type="text"][name="' + probe.name + '"], textarea[name="' + probe.name + '"]';
                const field = document.querySelector(selector);
                return Boolean(field && String(field.value || '') === String(probe.value || ''));
            }""",
            text_probe,
        )
        if not text_value_ok:
            result["status"] = "fail"
            result["error"] = "text_answer_not_restored"
            result["questionId"] = question_id
            result["textProbe"] = text_probe
            return result

    if highlight_record and int(after_replay.get("highlightCount") or 0) <= 0:
        result["status"] = "fail"
        result["error"] = "highlight_not_restored"
        result["questionId"] = question_id
        return result

    await page.wait_for_timeout(1300)
    mirror_ok = await page.evaluate(
        """(examId) => {
            const key = 'ielts_sim_draft::nb-drag-regression::' + examId;
            const raw = sessionStorage.getItem(key);
            if (!raw) return false;
            try {
                const parsed = JSON.parse(raw);
                return Boolean(parsed && parsed.draft && parsed.draft.answers);
            } catch (_) {
                return false;
            }
        }""",
        exam_id,
    )

    if not mirror_ok:
        result["status"] = "fail"
        result["error"] = "draft_mirror_missing"
        result["questionId"] = question_id
        return result

    result["questionId"] = question_id
    result["afterDrop"] = after_drop
    result["afterReplay"] = after_replay
    return result


async def main() -> int:
    exam_ids = collect_nb_exam_ids()
    if not exam_ids:
        print(json.dumps({"status": "fail", "detail": "no_nb_exams_found"}, ensure_ascii=False))
        return 1

    base_url = UNIFIED_READING_PATH.as_uri()
    case_results: List[Dict[str, Any]] = []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
        context = await browser.new_context()
        try:
            for exam_id in exam_ids:
                page = await context.new_page()
                try:
                    case_result = await run_case(page, exam_id, base_url)
                finally:
                    if not page.is_closed():
                        await page.close()
                case_results.append(case_result)
        finally:
            await browser.close()

    failures = [item for item in case_results if item.get("status") != "pass"]
    if failures:
        print(json.dumps({
            "status": "fail",
            "detail": "simulation NB drag regression failed",
            "failures": failures,
            "total": len(case_results),
            "passed": len(case_results) - len(failures),
        }, ensure_ascii=False))
        return 1

    print(json.dumps({
        "status": "pass",
        "detail": "simulation NB drag regression passed",
        "total": len(case_results),
        "passed": len(case_results),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
