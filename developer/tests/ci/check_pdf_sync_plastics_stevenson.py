#!/usr/bin/env python3
"""Targeted regression guard for Plastics and Stevenson PDF-sync fixes."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
P1_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p1-medium-20.js"
P3_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-high-173.js"
P1_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p1-medium-20.js"
P3_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p3-high-173.js"


def load_json_from_register_js(path: Path, register_key: str) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = rf'register\("{re.escape(register_key)}",\s*(\{{.*\}})\s*\);'
    match = re.search(pattern, text, flags=re.S)
    if not match:
        raise ValueError(f"unable_to_parse_register_payload:{path.name}")
    return json.loads(match.group(1))


def assert_contains(text: str, snippet: str, label: str) -> None:
    if snippet not in text:
        raise AssertionError(f"{label}:missing_snippet:{snippet}")


def find_question_text(explanation_payload: dict, question_id: str) -> str:
    sections = explanation_payload.get("questionExplanations", [])
    for section in sections:
        for item in section.get("items", []):
            if item.get("questionId") == question_id:
                return str(item.get("text", ""))
    raise AssertionError(f"explanation:missing_question:{question_id}")


def main() -> int:
    p1 = load_json_from_register_js(P1_EXAM, "p1-medium-20")
    p3 = load_json_from_register_js(P3_EXAM, "p3-high-173")
    p1_expl = load_json_from_register_js(P1_EXPLANATION, "p1-medium-20")
    p3_expl = load_json_from_register_js(P3_EXPLANATION, "p3-high-173")

    p1_answers = p1.get("answerKey", {})
    expected_p1 = {
        "q3": "electrical switches",
        "q4": "Britain",
        "q6": "glass",
        "q7": "foam",
    }
    for key, expected in expected_p1.items():
        actual = str(p1_answers.get(key, "")).strip()
        if actual != expected:
            raise AssertionError(f"p1:{key}:expected={expected}:actual={actual}")

    p1_group2_html = (p1.get("questionGroups", [None, None])[1] or {}).get("bodyHtml", "")
    assert_contains(
        p1_group2_html,
        "The chemical structure of rubber is very different from that of plastics.",
        "p1_group2_q8",
    )
    assert_contains(
        p1_group2_html,
        "John Wesley Hyatt was an industrial chemist.",
        "p1_group2_q9",
    )

    p3_answers = p3.get("answerKey", {})
    expected_p3 = {"q1": "D", "q2": "C", "q3": "B", "q4": "A", "q5": "C"}
    for key, expected in expected_p3.items():
        actual = str(p3_answers.get(key, "")).strip()
        if actual != expected:
            raise AssertionError(f"p3:{key}:expected={expected}:actual={actual}")

    p3_group1_html = (p3.get("questionGroups", [None])[0] or {}).get("bodyHtml", "")
    assert_contains(
        p3_group1_html,
        "A understated the role played by Stevenson's family.",
        "p3_group1_q27",
    )
    assert_contains(
        p3_group1_html,
        "D elevated Stevenson above his true status as a writer.",
        "p3_group1_q27",
    )

    p3_group3_html = (p3.get("questionGroups", [None, None, None])[2] or {}).get("bodyHtml", "")
    assert_contains(
        p3_group3_html,
        "Robert Louis Stevenson and Sir Walter Scott",
        "p3_group3_summary",
    )
    assert_contains(p3_group3_html, "<span><strong>B</strong> critical acclaim</span>", "p3_group3_wordlist")
    assert_contains(p3_group3_html, "<span><strong>C</strong> humour</span>", "p3_group3_wordlist")
    assert_contains(
        p3_group3_html, "<span><strong>E</strong> colourful language</span>", "p3_group3_wordlist"
    )

    p1_q3_text = find_question_text(p1_expl, "q3")
    assert_contains(p1_q3_text, "答案：electrical switches", "p1_expl_q3")
    p1_q4_text = find_question_text(p1_expl, "q4")
    assert_contains(p1_q4_text, "答案：Britain", "p1_expl_q4")
    p1_q9_text = find_question_text(p1_expl, "q9")
    assert_contains(p1_q9_text, "John Wesley Hyatt was an industrial chemist.", "p1_expl_q9")

    p3_q1_text = find_question_text(p3_expl, "q1")
    assert_contains(p3_q1_text, "答案：D", "p3_expl_q1")
    p3_q10_text = find_question_text(p3_expl, "q10")
    assert_contains(p3_q10_text, "Scott had greater _____.", "p3_expl_q10")
    p3_q12_text = find_question_text(p3_expl, "q12")
    assert_contains(p3_q12_text, "showed more _____ when it came to tragedy.", "p3_expl_q12")
    p3_q14_text = find_question_text(p3_expl, "q14")
    if "\\___" in p3_q14_text:
        raise AssertionError("p3_expl_q14:unexpected_escape_placeholder")

    print(json.dumps({"ok": True, "checks": ["p1_exam", "p3_exam", "p1_expl", "p3_expl"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        raise
