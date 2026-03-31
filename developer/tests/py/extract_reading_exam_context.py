#!/usr/bin/env python3
"""Extract a compact regeneration context from reading exam JS bundles.

This is a helper for rebuilding broken reading-explanations files from the
actual exam source instead of unreliable markdown summaries.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(os.environ.get("READING_EXPLANATION_REPO_ROOT") or Path(__file__).resolve().parents[3])
EXAM_DIR = ROOT / "assets" / "generated" / "reading-exams"


def extract_registered_payload(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'register\("[^"]+",\s*(\{[\s\S]*\})\s*\)\s*;?\s*\}', text)
    if not match:
        raise ValueError(f"无法解析 register payload: {path}")
    return json.loads(match.group(1))


def strip_html(raw: str) -> str:
    text = raw or ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"</li>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\r", "", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def extract_passage_paragraphs(html_text: str) -> List[Dict[str, str]]:
    paragraphs = re.findall(r"<p>([\s\S]*?)</p>", html_text, flags=re.I)
    results: List[Dict[str, str]] = []
    body_index = 0
    for paragraph in paragraphs:
        plain = strip_html(paragraph)
        if not plain:
            continue
        if plain.startswith("You should spend about"):
            continue
        body_index += 1
        results.append({
            "label": f"Paragraph {body_index}",
            "text": plain,
        })
    return results


def extract_questions_from_group(group: Dict[str, Any]) -> List[Dict[str, Any]]:
    body_html = group.get("bodyHtml", "") or ""
    question_ids = set(group.get("questionIds") or [])

    # Standard question-item blocks.
    items: List[Dict[str, Any]] = []
    for question_id, prompt in re.findall(
        r'<div class="question-item" id="(q\d+)-anchor">[\s\S]*?<p>\s*\d+\.\s*([\s\S]*?)</p>',
        body_html,
        flags=re.I,
    ):
        items.append({
            "questionId": question_id,
            "prompt": strip_html(prompt),
        })

    # Gap-fill style inputs embedded in prose.
    if not items and question_ids:
        def replacer(match: re.Match[str]) -> str:
            qid = match.group(1)
            return f" [BLANK:{qid}] "

        marked = re.sub(
            r'<input[^>]*name="(q\d+)"[^>]*>',
            replacer,
            body_html,
            flags=re.I,
        )
        plain = strip_html(marked)
        for question_id in sorted(question_ids, key=lambda value: int(value[1:])):
            match = re.search(rf"(\d+)\s+\[BLANK:{question_id}\]", plain)
            if not match:
                continue
            number = int(match.group(1))
            left = plain.rfind("\n", 0, match.start())
            right = plain.find("\n", match.end())
            snippet = plain[left + 1 if left >= 0 else 0 : right if right >= 0 else len(plain)].strip()
            snippet = snippet.replace(f"[BLANK:{question_id}]", "______")
            items.append({
                "questionId": question_id,
                "questionNumber": number,
                "prompt": re.sub(rf"^{number}\s*", "", snippet).strip(),
            })

    # Fallback for very loose summary/matching blocks.
    if not items:
        for number, prompt in re.findall(r'(\d+)\.\s*([^\n]+)', strip_html(body_html)):
            qid = f"q{number}"
            if qid not in question_ids:
                continue
            items.append({
                "questionId": qid,
                "questionNumber": int(number),
                "prompt": prompt.strip(),
            })

    for item in items:
        if "questionNumber" not in item:
            item["questionNumber"] = int(item["questionId"][1:])

    return sorted(items, key=lambda item: item["questionNumber"])


def build_context(exam_id: str) -> Dict[str, Any]:
    path = EXAM_DIR / f"{exam_id}.js"
    payload = extract_registered_payload(path)
    passage_blocks = payload.get("passage", {}).get("blocks") or []
    passage_html = "\n".join(block.get("html", "") for block in passage_blocks)

    groups = []
    for group in payload.get("questionGroups") or []:
        groups.append({
            "groupId": group.get("groupId"),
            "kind": group.get("kind"),
            "questions": extract_questions_from_group(group),
        })

    return {
        "examId": exam_id,
        "title": payload.get("meta", {}).get("title"),
        "category": payload.get("meta", {}).get("category"),
        "pdfFilename": payload.get("meta", {}).get("pdfFilename"),
        "answerKey": payload.get("answerKey") or {},
        "passageParagraphs": extract_passage_paragraphs(passage_html),
        "questionGroups": groups,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("exam_ids", nargs="+", help="exam ids such as p1-high-171")
    args = parser.parse_args()

    data = [build_context(exam_id) for exam_id in args.exam_ids]
    print(json.dumps(data if len(data) > 1 else data[0], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
