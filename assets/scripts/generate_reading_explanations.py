#!/usr/bin/env python3
"""Generate per-exam reading explanation bundles from markdown source docs."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
READING_MANIFEST_PATH = REPO_ROOT / "assets" / "generated" / "reading-exams" / "manifest.js"
READING_DATA_DIR = REPO_ROOT / "assets" / "generated" / "reading-exams"
OUTPUT_DIR = REPO_ROOT / "assets" / "generated" / "reading-explanations"

DOC_PRIORITY = {
    "P3 解析+1202高频_副本.md": 30,
    "P3 解析1119+重点_副本.md": 20,
    "P2 33-59之_副本.md": 10,
    "P1 1-32之_副本.md": 10,
}

# Manual overrides for title mismatches that are hard to resolve with normalization only.
MANUAL_ALIAS_BY_EXAM_ID: Dict[str, str] = {
}

SPLIT_KINDS = {
    "single_choice",
    "multi_choice",
    "true_false_not_given",
    "yes_no_not_given",
}


@dataclass
class ReadingManifestEntry:
    exam_id: str
    data_key: str
    script: str
    title: str
    category: str
    pdf_title: Optional[str] = None


@dataclass
class ParsedArticle:
    doc_name: str
    title: str
    normalized_title: str
    note_type: str
    passage_notes: List[Dict[str, str]]
    question_sections: List[Dict]


def clean_markdown_text(text: str) -> str:
    text = text.replace("\\.", ".")
    text = re.sub(r"^\s*[-•]\s*", "", text)
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = text.strip()
    return text


def normalize_title(value: str) -> str:
    text = value.lower().strip()
    text = text.replace("（无题目）", "")
    text = text.replace("修正", "")
    text = text.replace("_", "")
    text = re.sub(r"【[^】]*】", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"（[^）]*）", "", text)
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[,:;!?\-—–，。、“”'\"·\[\]{}]+", "", text)
    return text


def parse_js_manifest_object(js_text: str) -> Dict:
    marker = "global.__READING_EXAM_MANIFEST__ ="
    marker_index = js_text.find(marker)
    if marker_index < 0:
        raise RuntimeError("Manifest assignment marker missing")
    start = js_text.find("{", marker_index)
    end = js_text.rfind("};")
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError("Invalid manifest.js object range")
    payload = js_text[start:end + 1]
    return json.loads(payload)


def extract_pdf_title(script_path: Path) -> Optional[str]:
    try:
        text = script_path.read_text(encoding="utf-8")
    except Exception:
        return None
    match = re.search(r'"pdfFilename"\s*:\s*"([^"]+)"', text)
    if not match:
        return None
    raw = match.group(1)
    raw = re.sub(r"\.pdf$", "", raw, flags=re.I)
    raw = re.sub(r"^\d+\.?\s*", "", raw)
    raw = re.sub(r"^P[123]\s*-\s*", "", raw, flags=re.I)
    return raw.strip()


def load_reading_manifest() -> Dict[str, ReadingManifestEntry]:
    text = READING_MANIFEST_PATH.read_text(encoding="utf-8")
    obj = parse_js_manifest_object(text)
    entries: Dict[str, ReadingManifestEntry] = {}
    for key, value in obj.items():
        script_name = value.get("script", "").replace("./", "")
        script_path = READING_DATA_DIR / script_name
        entries[key] = ReadingManifestEntry(
            exam_id=value["examId"],
            data_key=value["dataKey"],
            script=value["script"],
            title=value.get("title", ""),
            category=value.get("category", ""),
            pdf_title=extract_pdf_title(script_path) if script_name else None,
        )
    return entries


def normalize_heading_line(line: str) -> str:
    line = line.strip()
    if line.startswith("[") and "](" in line:
        line = line[1:line.index("](")]
    line = line.replace("\\.", ".")
    line = re.sub(r"^\+{1,3}\s*", "", line)
    return line.strip()


def parse_article_heading(line: str) -> Optional[str]:
    if not line or line.startswith("["):
        return None
    normalized = normalize_heading_line(line)
    match = re.match(r"^(\d+)\.\s*(?:修正\s*)?(P[123])\s*-\s*(.+?)\s*$", normalized)
    if not match:
        return None
    return match.group(3).strip()


def parse_question_range(title: str) -> Optional[Tuple[int, int]]:
    match = re.search(r"Questions?\s*(\d+)\s*[–-]\s*(\d+)", title, re.I)
    if not match:
        return None
    left = int(match.group(1))
    right = int(match.group(2))
    if left > right:
        left, right = right, left
    return left, right


def choose_section_mode(section_title: str) -> str:
    t = section_title.lower()
    if "单选" in section_title or "多选" in section_title or "判断题" in section_title:
        return "per_question"
    if "true/false" in t or "yes/no" in t or "single choice" in t or "multiple choice" in t:
        return "per_question"
    return "group"


def parse_question_number(line: str) -> Optional[int]:
    match = re.search(r"题目\s*(\d+)", line)
    if match:
        return int(match.group(1))
    match = re.search(r"Question\s*(\d+)", line, re.I)
    if match:
        return int(match.group(1))
    return None


def collect_paragraph_notes(lines: List[str]) -> Tuple[str, List[Dict[str, str]]]:
    note_type = "段落讲解"
    for line in lines:
        if "段落翻译" in line:
            note_type = "翻译"
            break
        if "Brief Summary" in line:
            note_type = "总结"
            break

    notes: List[Dict[str, str]] = []
    current_label = ""
    current_lines: List[str] = []

    def flush_current() -> None:
        nonlocal current_label, current_lines
        content = "\n".join(clean_markdown_text(x) for x in current_lines if clean_markdown_text(x)).strip()
        if content:
            label = clean_markdown_text(current_label) if current_label else f"段落 {len(notes) + 1}"
            notes.append({"label": label, "text": content})
        current_label = ""
        current_lines = []

    inline_patterns = [
        r"^[-•]\s*\*\*(Paragraph\s+[A-Z0-9]+.*?)\*\*[:：]\s*(.+)$",
        r"^[-•]\s*\*\*(第[一二三四五六七八九十0-9]+段.*?)\*\*[:：]\s*(.+)$",
    ]

    label_patterns = [
        r"^\*\*(Paragraph\s+[A-Z0-9]+.*?)\*\*$",
        r"^\*\*(第[一二三四五六七八九十0-9]+段.*?)\*\*$",
    ]

    for raw in lines:
        line = raw.strip().replace("\\.", ".")
        cleaned_line = clean_markdown_text(line)
        if not line:
            continue
        if "二、题目解析" in cleaned_line:
            break

        matched_inline = False
        for pattern in inline_patterns:
            inline_match = re.match(pattern, line, re.I)
            if inline_match:
                flush_current()
                label = inline_match.group(1)
                text = inline_match.group(2)
                notes.append({"label": clean_markdown_text(label), "text": clean_markdown_text(text)})
                matched_inline = True
                break
        if matched_inline:
            continue

        matched_label = False
        for pattern in label_patterns:
            label_match = re.match(pattern, line, re.I)
            if label_match:
                flush_current()
                current_label = label_match.group(1)
                matched_label = True
                break
        if matched_label:
            continue

        # Ignore section headers and pure list prefixes.
        if cleaned_line.startswith("一、"):
            continue
        if cleaned_line == "目录":
            continue

        current_lines.append(line)

    flush_current()

    if not notes:
        fallback_lines = []
        for raw in lines:
            line = clean_markdown_text(raw)
            if not line:
                continue
            if line.startswith("一、") or line.startswith("二、"):
                continue
            fallback_lines.append(line)
        if fallback_lines:
            notes = [{"label": "段落 1", "text": "\n".join(fallback_lines)}]

    return note_type, notes


def parse_question_sections(lines: List[str]) -> List[Dict]:
    # Keep only parse section after question analysis heading.
    start = None
    for idx, raw in enumerate(lines):
        if "题目解析" in raw:
            start = idx
            break
    if start is None:
        return []

    working = lines[start + 1 :]
    sections: List[Dict] = []
    current_section: Optional[Dict] = None
    current_question: Optional[Dict] = None

    def finalize_question() -> None:
        nonlocal current_question, current_section
        if not current_question or not current_section:
            current_question = None
            return
        text = "\n".join(clean_markdown_text(x) for x in current_question.get("lines", []) if clean_markdown_text(x)).strip()
        if text:
            current_section.setdefault("items", []).append(
                {
                    "questionNumber": current_question["questionNumber"],
                    "text": text,
                }
            )
        current_question = None

    def finalize_section() -> None:
        nonlocal current_section
        if not current_section:
            return
        finalize_question()
        body_text = "\n".join(clean_markdown_text(x) for x in current_section.get("bodyLines", []) if clean_markdown_text(x)).strip()
        current_section["text"] = body_text
        current_section.pop("bodyLines", None)
        if current_section.get("items") or current_section.get("text"):
            sections.append(current_section)
        current_section = None

    for raw in working:
        line = raw.strip().replace("\\.", ".")
        if not line:
            continue

        # Section title line examples:
        # **1. 单选题（Questions 27–31：Choose A–D）**
        # 1. 判断题（Questions 31–35：YES/NO/NOT GIVEN）
        if re.match(r"^\*{0,2}\d+[\.、]\s*.*(Questions?|题)", line, re.I):
            finalize_section()
            title_text = clean_markdown_text(line)
            q_range = parse_question_range(title_text)
            current_section = {
                "sectionTitle": title_text,
                "mode": choose_section_mode(title_text),
                "items": [],
                "bodyLines": [],
            }
            if q_range:
                current_section["questionRange"] = {"start": q_range[0], "end": q_range[1]}
            continue

        q_number = parse_question_number(line)
        if q_number is not None:
            if not current_section:
                current_section = {
                    "sectionTitle": "题目解析",
                    "mode": "group",
                    "items": [],
                    "bodyLines": [],
                }
            finalize_question()
            current_question = {
                "questionNumber": q_number,
                "lines": [line],
            }
            if "questionRange" not in current_section:
                current_section["questionRange"] = {"start": q_number, "end": q_number}
            else:
                current_section["questionRange"]["start"] = min(current_section["questionRange"]["start"], q_number)
                current_section["questionRange"]["end"] = max(current_section["questionRange"]["end"], q_number)
            continue

        if current_question is not None:
            current_question["lines"].append(line)

        if current_section is not None:
            current_section["bodyLines"].append(line)

    finalize_section()

    # Add deterministic questionId placeholder so runtime can map with display map.
    for section in sections:
        for item in section.get("items", []):
            number = item.get("questionNumber")
            if number is not None:
                item["questionId"] = f"q{number}"

    return sections


def parse_articles_from_doc(path: Path) -> List[ParsedArticle]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    article_spans: List[Tuple[str, int, int]] = []
    current_title: Optional[str] = None
    current_start: Optional[int] = None

    for idx, raw in enumerate(lines):
        maybe_title = parse_article_heading(raw.strip())
        if maybe_title:
            if current_title is not None and current_start is not None:
                article_spans.append((current_title, current_start, idx))
            current_title = maybe_title
            current_start = idx + 1

    if current_title is not None and current_start is not None:
        article_spans.append((current_title, current_start, len(lines)))

    results: List[ParsedArticle] = []
    for title, start, end in article_spans:
        chunk = lines[start:end]
        note_type, passage_notes = collect_paragraph_notes(chunk)
        question_sections = parse_question_sections(chunk)
        if not passage_notes and not question_sections:
            continue
        results.append(
            ParsedArticle(
                doc_name=path.name,
                title=title,
                normalized_title=normalize_title(title),
                note_type=note_type,
                passage_notes=passage_notes,
                question_sections=question_sections,
            )
        )

    return results


def select_best_article(candidates: List[ParsedArticle], exam_id: str) -> ParsedArticle:
    override_title = MANUAL_ALIAS_BY_EXAM_ID.get(exam_id)
    if override_title:
        override_norm = normalize_title(override_title)
        for candidate in candidates:
            if candidate.normalized_title == override_norm:
                return candidate

    def score(item: ParsedArticle) -> Tuple[int, int, int]:
        priority = DOC_PRIORITY.get(item.doc_name, 0)
        passage_count = len(item.passage_notes)
        question_count = sum(len(section.get("items", [])) for section in item.question_sections)
        return (priority, passage_count, question_count)

    return sorted(candidates, key=score, reverse=True)[0]


def build_payload(entry: ReadingManifestEntry, article: ParsedArticle) -> Dict:
    return {
        "schemaVersion": "ReadingExplanationV1",
        "examId": entry.exam_id,
        "meta": {
            "examId": entry.exam_id,
            "title": entry.title,
            "category": entry.category,
            "sourceDoc": article.doc_name,
            "noteType": article.note_type,
            "matchedTitle": article.title,
        },
        "passageNotes": article.passage_notes,
        "questionExplanations": article.question_sections,
    }


def write_explanation_module(path: Path, data_key: str, payload: Dict) -> None:
    content = (
        "(function registerReadingExplanationData(global) {\n"
        "  'use strict';\n"
        "  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== \"function\") {\n"
        "    throw new Error(\"reading_explanation_registry_missing\");\n"
        "  }\n"
        f"  global.__READING_EXPLANATION_DATA__.register({json.dumps(data_key, ensure_ascii=False)}, "
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n"
        "  );\n"
        "})(typeof window !== \"undefined\" ? window : globalThis);\n"
    )
    path.write_text(content, encoding="utf-8")


def write_explanation_manifest(path: Path, manifest: Dict[str, Dict]) -> None:
    content = (
        "(function registerReadingExplanationManifest(global) {\n"
        "  'use strict';\n"
        "  global.__READING_EXPLANATION_MANIFEST__ = "
        f"{json.dumps(manifest, ensure_ascii=False, indent=2)};\n"
        "})(typeof window !== \"undefined\" ? window : globalThis);\n"
    )
    path.write_text(content, encoding="utf-8")


def main() -> int:
    reading_manifest = load_reading_manifest()

    articles: List[ParsedArticle] = []
    for md_path in sorted(DATA_DIR.glob("*.md")):
        articles.extend(parse_articles_from_doc(md_path))

    by_norm_title: Dict[str, List[ParsedArticle]] = {}
    for article in articles:
        by_norm_title.setdefault(article.normalized_title, []).append(article)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for old_file in OUTPUT_DIR.glob("*.js"):
        old_file.unlink()

    output_manifest: Dict[str, Dict] = {}
    matched_count = 0

    for exam_id, entry in sorted(reading_manifest.items()):
        candidates: List[ParsedArticle] = []
        title_variants = [entry.title]
        if entry.pdf_title:
            title_variants.append(entry.pdf_title)

        for title in title_variants:
            normalized = normalize_title(title)
            if normalized and normalized in by_norm_title:
                candidates.extend(by_norm_title[normalized])

        if not candidates:
            continue

        dedup: Dict[Tuple[str, str], ParsedArticle] = {}
        for item in candidates:
            dedup[(item.doc_name, item.title)] = item
        candidates = list(dedup.values())

        selected = select_best_article(candidates, exam_id)
        payload = build_payload(entry, selected)

        script_name = f"{entry.data_key}.js"
        output_path = OUTPUT_DIR / script_name
        write_explanation_module(output_path, entry.data_key, payload)
        output_manifest[entry.data_key] = {
            "examId": entry.exam_id,
            "dataKey": entry.data_key,
            "script": f"../reading-explanations/{script_name}",
            "title": entry.title,
            "sourceDoc": selected.doc_name,
            "matchedTitle": selected.title,
        }
        matched_count += 1

    write_explanation_manifest(OUTPUT_DIR / "manifest.js", output_manifest)

    print(f"Generated reading explanations: {matched_count} / {len(reading_manifest)} exams")
    print(f"Output directory: {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
