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
    text = re.sub(r"</(?:p|li|tr|div|h[1-6]|section)>", "\n", text, flags=re.I)
    text = re.sub(r"<(?:p|li|tr|div|h[1-6]|section)\b[^>]*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\r", "", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def extract_passage_paragraphs(html_text: str) -> List[Dict[str, str]]:
    paragraphs = re.findall(r"<p\b[^>]*>([\s\S]*?)</p>", html_text, flags=re.I)
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
    if results:
        return results

    # Some migrated records use a single bodyHtml/text block without <p>
    # wrappers.  Preserve useful source context instead of returning an empty
    # passage packet to the explanation agent.
    plain = strip_html(html_text)
    if plain:
        return [{"label": "Passage", "text": plain}]
    return []


QUESTION_MARKER_RE = re.compile(r"\[QUESTION:(q\d+)\]", re.I)
QUESTION_ATTRIBUTE_RE = re.compile(
    r"\b(name|data-question|data-target|data-question-id|id)\s*=\s*['\"]([^'\"]+)['\"]",
    re.I,
)


def expand_question_reference(raw_value: str) -> List[str]:
    value = str(raw_value or "").strip().lower()
    numbers = re.findall(r"q?(\d+)", value)
    if not numbers or "q" not in value:
        return []
    if "_" in value or "-" in value or "–" in value:
        return [f"q{number}" for number in numbers]
    match = re.search(r"q(\d+)", value)
    return [f"q{match.group(1)}"] if match else []


def build_question_marker_text(
    body_html: str,
    allowed_question_ids: set[str] | None = None,
) -> str:
    def inject_markers(match: re.Match[str]) -> str:
        tag = match.group(0)
        tag_lower = tag.lower()
        references: List[str] = []
        for attribute_name, raw_reference in QUESTION_ATTRIBUTE_RE.findall(tag):
            expanded = expand_question_reference(raw_reference)

            # A migrated cohort uses ids such as q1-31-section and
            # q1-2-3-4-anchor on an outer question-group container.  Those ids
            # describe a range; injecting every value as a single-question
            # marker makes the group heading win over the real prompt below.
            # Actual controls expose name/data-question, while a true anchor
            # id identifies only one question.
            if attribute_name.lower() == "id" and (
                len(expanded) != 1
                or re.search(r"(?:section|group|container)", raw_reference, flags=re.I)
            ):
                continue

            for question_id in expanded:
                if allowed_question_ids is not None and question_id not in allowed_question_ids:
                    continue
                if question_id not in references:
                    references.append(question_id)
        marker = " ".join(f"[QUESTION:{question_id}]" for question_id in references)
        if tag_lower.startswith("<input") and marker:
            marker += " ______"
        if re.match(r"</(?:p|li|tr|div|h[1-6]|section)\b", tag_lower):
            return f"{marker}\n"
        if re.match(r"<(?:p|li|tr|div|h[1-6]|section)\b", tag_lower):
            return f"\n{marker}"
        return marker

    marked = re.sub(r"<[^>]+>", inject_markers, body_html or "")
    marked = html.unescape(marked).replace("\r", "")
    marked = re.sub(r"[ \t]+", " ", marked)
    marked = re.sub(r"\n{2,}", "\n", marked)
    return marked.strip()


def normalize_question_prompt(raw_text: str, question_number: int) -> str:
    text = QUESTION_MARKER_RE.sub("", raw_text or "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(rf"^{question_number}\s*[.、:：-]?\s*", "", text)
    return text.strip()


def is_question_prompt_noise(prompt: str) -> bool:
    text = re.sub(r"\s+", " ", prompt or "").strip()
    if not text or text == "______":
        return True
    if re.match(
        r"^(?:In boxes?|Write|Choose|Complete|Do the following|Look at|Reading Passage\s+\d+\s+has)\b",
        text,
        flags=re.I,
    ):
        return True
    return bool(
        re.fullmatch(
            r"Questions?(?:\s+\d+)?(?:\s*[-–—]\s*\d+)?",
            text,
            flags=re.I,
        )
    )


def find_question_prompt(marker_text: str, question_id: str, question_number: int) -> str:
    lines = [line.strip() for line in marker_text.splitlines() if line.strip()]
    marker = f"[QUESTION:{question_id}]"
    candidate_indexes = [index for index, line in enumerate(lines) if marker.lower() in line.lower()]

    # Controls are often in the line after a <p> containing the prompt (radio
    # and drop-zone questions), while table/gap-fill controls share the prompt
    # line.  Prefer a nearby line that visibly carries the display number.
    nearby: List[str] = []
    for index in candidate_indexes:
        for candidate_index in (index, index - 1, index + 1, index - 2):
            if 0 <= candidate_index < len(lines) and lines[candidate_index] not in nearby:
                nearby.append(lines[candidate_index])

    number_pattern = re.compile(rf"(?:^|\s){question_number}(?:\s|[.、:：-]|$)")
    leading_number_pattern = re.compile(rf"^{question_number}(?:\s|[.、:：-]|$)")

    # A numbered instruction may mention the first item in a range (for
    # example, "In boxes 1-7 ...") immediately before the real statement.
    # Prefer a line whose visible content starts with the display number.
    for candidate in nearby:
        visible = QUESTION_MARKER_RE.sub("", candidate).strip()
        if leading_number_pattern.search(visible):
            prompt = normalize_question_prompt(candidate, question_number)
            if not is_question_prompt_noise(prompt):
                return prompt

    for candidate in nearby:
        if number_pattern.search(QUESTION_MARKER_RE.sub("", candidate)):
            prompt = normalize_question_prompt(candidate, question_number)
            if not is_question_prompt_noise(prompt):
                return prompt

    # A few drag-and-drop layouts keep controls in the passage and only put a
    # numbered instruction/list in the group.  Use that numbered line when it
    # is available; otherwise retain an explicit, non-empty fallback so every
    # answerKey entry remains represented in the regeneration template.
    for pattern in (leading_number_pattern, number_pattern):
        for line in lines:
            visible = QUESTION_MARKER_RE.sub("", line).strip()
            if pattern.search(visible):
                prompt = normalize_question_prompt(line, question_number)
                if not is_question_prompt_noise(prompt):
                    return prompt

    for candidate in nearby:
        prompt = normalize_question_prompt(candidate, question_number)
        if (
            not is_question_prompt_noise(prompt)
            and not re.fullmatch(r"(?:[A-I]|TRUE|FALSE|NOT GIVEN|YES|NO|NG|______|\s)+", prompt, re.I)
        ):
            return prompt
    return f"Question {question_number}"


def extract_questions_from_group(
    group: Dict[str, Any],
    question_display_map: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    # Most records keep instructions in leadHtml and questions in bodyHtml,
    # while a small migrated cohort stores the complete question UI in
    # leadHtml and leaves bodyHtml empty.  Parse both fields in display order.
    body_html = "\n".join(
        str(fragment)
        for fragment in (group.get("leadHtml"), group.get("bodyHtml"))
        if fragment
    )
    display_map = question_display_map or {}
    question_ids: List[str] = []
    for raw_question_id in group.get("questionIds") or []:
        match = re.fullmatch(r"q(\d+)", str(raw_question_id or "").strip().lower())
        if not match:
            continue
        question_id = f"q{match.group(1)}"
        if question_id not in question_ids:
            question_ids.append(question_id)

    marker_text = build_question_marker_text(body_html, set(question_ids))
    items: List[Dict[str, Any]] = []
    for question_id in question_ids:
        display_value = str(display_map.get(question_id) or "")
        display_match = re.search(r"\d+", display_value)
        question_number = int(display_match.group(0)) if display_match else int(question_id[1:])
        items.append({
            "questionId": question_id,
            "questionNumber": question_number,
            "prompt": find_question_prompt(marker_text, question_id, question_number),
        })
    return sorted(items, key=lambda item: item["questionNumber"])


def build_context(exam_id: str) -> Dict[str, Any]:
    path = EXAM_DIR / f"{exam_id}.js"
    payload = extract_registered_payload(path)
    passage_blocks = payload.get("passage", {}).get("blocks") or []
    passage_html = "\n".join(
        str(block.get("html") or block.get("bodyHtml") or block.get("text") or "")
        for block in passage_blocks
        if isinstance(block, dict)
    )

    groups = []
    seen_question_ids = set()
    question_display_map = payload.get("questionDisplayMap") or {}
    for group in payload.get("questionGroups") or []:
        questions = [
            question
            for question in extract_questions_from_group(group, question_display_map)
            if question["questionId"] not in seen_question_ids
        ]
        seen_question_ids.update(question["questionId"] for question in questions)
        groups.append({
            "groupId": group.get("groupId"),
            "kind": group.get("kind"),
            "questions": questions,
        })

    missing_question_ids = [
        question_id
        for question_id in (payload.get("answerKey") or {})
        if question_id not in seen_question_ids
    ]
    if missing_question_ids:
        groups.append({
            "groupId": "unmapped-questions",
            "kind": "unknown",
            "questions": [
                {
                    "questionId": question_id,
                    "questionNumber": int(
                        re.search(r"\d+", str(question_display_map.get(question_id) or question_id)).group(0)
                    ),
                    "prompt": f"Question {question_display_map.get(question_id) or question_id[1:]}",
                }
                for question_id in missing_question_ids
            ],
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
