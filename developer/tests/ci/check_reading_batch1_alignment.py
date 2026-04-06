#!/usr/bin/env python3
"""Minimal regression checks for batch-1 reading data fixes."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WHALE_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p1-high-227.js"
PATAGONIA_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-low-42.js"
MONA_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-low-36.js"
MONA_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p3-low-36.js"


def load_registered_json(path: Path, register_key: str) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = rf'register\("{re.escape(register_key)}",\s*(\{{.*\}})\s*\);'
    match = re.search(pattern, text, flags=re.S)
    if not match:
        raise ValueError(f"unable_to_parse_register_payload:{path.name}")
    return json.loads(match.group(1))


def extract_answer(item_text: str) -> str:
    match = re.search(r"答案[:：]\s*([A-Z]+(?:\s+[A-Z]+)?)", item_text or "", flags=re.I)
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1).strip()).upper()


def main() -> int:
    failures: list[str] = []

    whale = load_registered_json(WHALE_EXAM, "p1-high-227")
    whale_html = whale.get("passage", {}).get("blocks", [{}])[0].get("html", "")
    whale_group = whale.get("questionGroups", [{}, {}])[1].get("bodyHtml", "")
    whale_key = whale.get("answerKey", {})

    if whale_key.get("q8") != "lecturer":
        failures.append("p1-high-227 q8 answerKey must be lecturer")
    if 'data-answer="lecturer"' not in whale_group:
        failures.append("p1-high-227 q8 bodyHtml must use lecturer")
    if "walking library" not in whale_html or "natural history lecturer" not in whale_html:
        failures.append("p1-high-227 passage missing lecturer-identifying evidence")

    patagonia = load_registered_json(PATAGONIA_EXAM, "p3-low-42")
    patagonia_html = patagonia.get("passage", {}).get("blocks", [{}])[0].get("html", "")
    required_phrases = [
        "We can speculate then",
        "We shall turn now",
        "The Arroyo Eeo site",
        "In conclusion, based on the evidence from a number of reliable sites",
    ]
    for phrase in required_phrases:
        if phrase not in patagonia_html:
            failures.append(f"p3-low-42 missing phrase: {phrase}")

    mona_exam = load_registered_json(MONA_EXAM, "p3-low-36")
    mona_explanation = load_registered_json(MONA_EXPLANATION, "p3-low-36")
    mona_text = MONA_EXPLANATION.read_text(encoding="utf-8")
    if "FJN" in mona_text:
        failures.append("p3-low-36 explanation should not contain FJN alias")

    answer_key = mona_exam.get("answerKey", {})
    for section in mona_explanation.get("questionExplanations", []):
        for item in section.get("items", []):
            qid = item.get("questionId")
            if not qid:
                continue
            extracted = extract_answer(item.get("text", ""))
            if not extracted:
                continue
            expected = str(answer_key.get(qid, "")).strip().upper()
            if expected and extracted != expected:
                failures.append(
                    f"p3-low-36 answer mismatch at {qid}: expected {expected}, got {extracted}"
                )

    if failures:
        print("FAILED")
        for item in failures:
            print(f"- {item}")
        return 1

    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
