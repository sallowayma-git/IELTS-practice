#!/usr/bin/env python3
"""Screenshot the essay Result page (/result/:sessionId) from the dev build.

    python developer/tests/e2e/result_preview.py

Starts the Vite dev server for apps/writing-vue on port 4184 (override with
RESULT_PREVIEW_PORT; same helpers as design_system_preview.py), mocks the Tauri history read in the page with an init
script (DEV only, test side, never shipped), and captures:

    reports/result-dev.png        full page, 1440x900 viewport
    reports/result-dev-1024.png   full page, 1024x768 viewport

The mock is a realistic full evaluation: band 6.5, four criteria, several
feedback items, and a ~300-word essay whose sentence errors cover every
highlight kind (grammar, spelling, word_choice, sentence_structure, coherence).
Exit 1 when the server never answers, the page throws, or the heading/score
does not render.
"""
from __future__ import annotations

import json
import os
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import (
    REPORTS,
    start_dev_server,
    stop_process,
    wait_for_server,
)

SESSION_ID = "result-preview"
DEFAULT_PORT = 4184

# (sentence, [(error kind, marked word, reason, correction)])
ESSAY_SENTENCES = [
    ("Universities must equips students for work while preserving deeper inquiry.",
     [("grammar", "equips", "Modal verbs take the base form, so equips should be equip.", "equip")]),
    ("Practical projects make abstract knowledge visible, especially when students must explain "
     "their decisions to people outside their discipline.", []),
    ("Such tasks teach them to communicate, negotiate and revise plans under real constraints.", []),
    ("However, a narrow focus on current workplace tools can age quickly.", []),
    ("Employers change systems, industries reorganise, and graduates face problems that no "
     "syllabus could predict.", []),
    ("Consequently, a graduate who has only memorised procedures may struggle when those procedures become obsolete.", []),
    ("Their capacity to recieve and evaluate new ideas depends on the theory they learnt at university.",
     [("spelling", "recieve", "Spelling: the correct form is receive.", "receive")]),
    ("Conversely, a programme that emphasises employability alone may leave students without the critical "
     "habits that sustain lifelong learning.", []),
    ("Both extremes, therefore, undermine the purpose of higher education in a modern society.", []),
    ("The most useful degree programmes combine these priorities.", []),
    ("Institutions should instead integrate applied modules into rigorous disciplinary study, so that theory "
     "and practice reinforce each other.", []),
    ("Placements and collaborative briefs test whether students apply ideas responsibly, while "
     "seminars give them time to question assumptions.",
     [("sentence_structure", "while seminars give them time to question assumptions",
       "The clause is overloaded; splitting it keeps the contrast clear.",
       "Seminars, meanwhile, give them time to question assumptions.")]),
    ("Very big changes in technology make this balance even more important.",
     [("word_choice", "Very big", "Intensified informal collocation; use a precise adjective.", "Profound")]),
    ("Automation, for instance, has altered the demands of nearly every profession within a single generation.", []),
    ("A degree that ignores this reality risks producing graduates who are articulate yet poorly prepared for work.", []),
    ("In conclusion, practical preparation deserves a visible place in higher education, but it "
     "should complement intellectual foundations.", []),
    ("Furthermore, this balance prepares students for their first role.",
     [("coherence", "Furthermore", "A mechanical link that does not match the concluding contrast.", "Above all")]),
    ("It also keeps them flexible throughout a much longer career.", []),
    ("Universities should measure success by the adaptability of their graduates rather than by immediate "
     "employment figures alone.", []),
]

ESSAY_TEXT = " ".join(sentence for sentence, _ in ESSAY_SENTENCES)


def build_sentences() -> list[dict]:
    """Sentence records with error ranges as offsets into each sentence."""
    records = []
    for sentence, errors in ESSAY_SENTENCES:
        items = []
        corrected = sentence
        for kind, word, reason, correction in errors:
            start = sentence.index(word)
            items.append({
                "type": kind,
                "word": word,
                "reason": reason,
                "correction": correction,
                "range": {"start": start, "end": start + len(word)},
            })
            corrected = corrected.replace(word, correction, 1)
        record = {"sentence": sentence, "errors": items}
        if items:
            record["corrected"] = corrected
        records.append(record)
    return records


def build_detail() -> dict:
    prompt = (
        "Some people believe university education should focus on practical employment skills, "
        "while others think academic study is more important. Discuss both views and give your opinion."
    )
    return {
        "summary": {
            "id": SESSION_ID,
            "activity": "writing",
            "title": "Universities should balance practical employment skills with academic study",
            "status": "completed",
            "mode": "freeform",
            "submittedAt": "2026-10-10T08:29:00Z",
            "durationMs": 2_340_000,
            "scoreValue": 6.5,
            "scoreScale": "band9",
            "scoreLabel": "Overall Band",
            "scoreDisplay": "6.5",
            "sessionId": SESSION_ID,
            "taskType": "task2",
        },
        "attempt": {
            "schemaVersion": 1,
            "id": SESSION_ID,
            "activity": "writing",
            "mode": "freeform",
            "status": "completed",
            "startedAt": "2026-10-10T07:50:00Z",
            "submittedAt": "2026-10-10T08:29:00Z",
            "completedAt": "2026-10-10T08:30:00Z",
            "durationMs": 2_340_000,
            "scoreValue": 6.5,
            "scoreScale": "band9",
            "taskType": "task2",
            "titleSnapshot": "Universities should balance practical employment skills with academic study",
            "promptSnapshot": prompt,
            "contentText": ESSAY_TEXT,
            "answers": [],
            "annotations": [],
        },
        "evaluation": {
            "schemaVersion": 4,
            "id": f"evaluation-{SESSION_ID}",
            "status": "completed",
            "stage": "finalizing",
            "taskType": "task2",
            "score": {
                "overall": 6.5,
                "taskResponse": 6.5,
                "coherence": 6.0,
                "lexical": 7.0,
                "grammar": 6.0,
            },
            "diagnosis": {
                "task": {
                    "prompt_response_quality": "Both views are addressed and the writer's position is explicit.",
                    "position_clarity": "The central claim is established early and sustained to the conclusion.",
                    "argument_development": "Relevant reasoning is present, but the practical example stays abstract.",
                    "conclusion_effectiveness": "The conclusion compares the two priorities rather than repeating them.",
                },
                "rationale": {
                    "task_achievement": "Both perspectives are addressed and a clear position is sustained.",
                    "coherence_cohesion": "Paragraphing is logical, but linking words are mechanical in places.",
                    "lexical_resource": "Vocabulary is generally precise, with a few informal collocations.",
                    "grammatical_range": "Complex structures appear, though a subject-verb error recurs.",
                },
            },
            "feedback": {
                "overall": (
                    "The essay keeps a clear position and develops both views in a controlled way. "
                    "The next gain is concrete support: name one workplace example and vary the "
                    "transitions between the final two body paragraphs."
                ),
                "plan": [
                    "Add one concrete workplace example to the first body paragraph.",
                    "Replace repeated contrast markers with transitions that name the logical relation.",
                    "Proofread for subject-verb agreement and spelling of common academic words.",
                    "Use precise adjectives instead of intensifiers such as very big.",
                ],
                "paragraphs": [
                    {
                        "paragraphIndex": 1,
                        "summary": "The opening establishes the practical-skills case efficiently.",
                        "issues": ["A named project or placement would make the claim less abstract."],
                    },
                    {
                        "paragraphIndex": 2,
                        "summary": "The counterargument is separated and developed logically.",
                        "issues": ["The final sentence bridges back to the thesis without a clear link word."],
                    },
                ],
                "sentences": build_sentences(),
                "rewrites": [],
            },
        },
    }


def install_tauri_mock(page) -> None:
    detail_json = json.dumps(build_detail(), ensure_ascii=False)
    script = r"""
    (() => {
      const detail = __DETAIL__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const invoke = async (command) => {
        if (command === 'get_history_detail') return { ok: true, data: detail };
        if (command === 'list_settings') return { ok: true, data: [] };
        if (command === 'get_app_info') return { name: 'ielts-practice', version: '0.1.0', tauriVersion: '2', productName: 'IELTS Practice', host: 'tauri' };
        return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__DETAIL__", detail_json)
    page.add_init_script(script)


CAPTURES = (
    ("result-dev.png", 1440, 900),
    ("result-dev-1024.png", 1024, 768),
)


def capture(base_url: str) -> list[str]:
    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for filename, width, height in CAPTURES:
                page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
                page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
                install_tauri_mock(page)
                page.goto(f"{base_url}/#/result/{SESSION_ID}", wait_until="networkidle", timeout=60_000)
                page.wait_for_selector(".result-page .score-total", timeout=30_000)
                page.evaluate("document.fonts.ready.then(() => true)")
                page.wait_for_timeout(300)
                h1_count = page.locator("h1").count()
                if h1_count != 1:
                    errors.append(f"expected one h1, found {h1_count}")
                score = page.locator(".result-page .score-total").inner_text().strip()
                if score != "6.5":
                    errors.append(f"unexpected score text: {score!r}")
                page.screenshot(path=str(REPORTS / filename), full_page=True)
                page.close()
        finally:
            browser.close()
    return errors


def main() -> int:
    port = int(os.environ.get("RESULT_PREVIEW_PORT", DEFAULT_PORT))
    base_url = f"http://127.0.0.1:{port}"
    process = None
    try:
        process = start_dev_server(port)
        wait_for_server(process, base_url)
        errors = capture(base_url)
    except (RuntimeError, OSError) as error:
        print(f"result preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    for line in errors:
        print(line, file=sys.stderr)
    for filename, *_ in CAPTURES:
        print(f"wrote {REPORTS / filename}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
