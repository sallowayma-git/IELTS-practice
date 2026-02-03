#!/usr/bin/env python3
import argparse
import html
import json
import os
import re
from pathlib import Path

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
TRANSCRIPT_ID_RE = re.compile(r"id\s*=\s*['\"]transcript-content['\"]", re.IGNORECASE)
ANSWER_HIGHLIGHT_RE = re.compile(r"answer-highlight", re.IGNORECASE)
ANSWER_TAG_RE = re.compile(r"\(Q\s*(\d+)\s*:\s*([A-Za-z]+)\)")

CORRECT_ANS_GLOBAL_RE = re.compile(r"(?:window|globalThis|self)\s*\.\s*correctAnswers\s*=")
CORRECT_ANS_VAR_RE = re.compile(r"\b(?:const|let|var)\s+correctAnswers\s*=")

IELTS_PREFIX_RE = re.compile(r"IELTS\s+Listening\s+Practice\s*[-–—]?\s*", re.IGNORECASE)
PART_PREFIX_RE = re.compile(r"^PART\s*\d+\b", re.IGNORECASE)
P_PREFIX_RE = re.compile(r"^P\s*\d+\b", re.IGNORECASE)
LEADING_NUMBER_RE = re.compile(r"^\d+[\.\-、\s]+")

PART_DETECT_RE = re.compile(r"\bP(?:ART)?\s*([1-4])\b", re.IGNORECASE)
LEADING_EXAM_NUMBER_RE = re.compile(r"^(\d{1,4})[\s.\-、_]")


def read_text(path: Path) -> str:
    data = path.read_bytes()
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


def strip_html(text: str) -> str:
    if text is None:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_title_candidate(raw: str) -> str:
    if not raw:
        return ""
    text = re.sub(r"\s+", " ", str(raw)).strip()
    if not text:
        return ""
    text = LEADING_NUMBER_RE.sub("", text)
    text = PART_PREFIX_RE.sub("", text)
    text = P_PREFIX_RE.sub("", text)
    text = IELTS_PREFIX_RE.sub("", text)
    text = re.sub(r"^-+", "", text)
    text = re.sub(r"^\s*[-:]\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def detect_part(text: str) -> str | None:
    if not text:
        return None
    m = PART_DETECT_RE.search(text)
    return m.group(1) if m else None


def detect_exam_number(text: str) -> str | None:
    if not text:
        return None
    m = LEADING_EXAM_NUMBER_RE.search(text)
    return m.group(1) if m else None


def scan_file(path: Path) -> dict:
    raw = read_text(path)

    title_match = TITLE_RE.search(raw)
    title_raw = strip_html(title_match.group(1)) if title_match else ""

    h1_match = H1_RE.search(raw)
    h1_raw = strip_html(h1_match.group(1)) if h1_match else ""

    transcript = bool(TRANSCRIPT_ID_RE.search(raw))
    answer_highlight_count = len(ANSWER_HIGHLIGHT_RE.findall(raw))
    answer_tag_matches = ANSWER_TAG_RE.findall(raw)
    answer_tag_unique = sorted({m[0] for m in answer_tag_matches}, key=lambda x: int(x)) if answer_tag_matches else []

    correct_answers_global = bool(CORRECT_ANS_GLOBAL_RE.search(raw))
    correct_answers_var = bool(CORRECT_ANS_VAR_RE.search(raw))

    title_clean = clean_title_candidate(title_raw)
    h1_clean = clean_title_candidate(h1_raw)

    title_has_prefix = bool(IELTS_PREFIX_RE.search(title_raw))
    h1_has_part = bool(PART_PREFIX_RE.match(h1_raw) or P_PREFIX_RE.match(h1_raw))
    h1_has_leading_number = bool(LEADING_NUMBER_RE.match(h1_raw))

    path_str = str(path)
    part = detect_part(" ".join([path_str, title_raw, h1_raw]))
    exam_number = detect_exam_number(path.name) or detect_exam_number(path.parent.name) or detect_exam_number(h1_raw)

    issues = []
    if not title_raw:
        issues.append("missing_title")
    if not h1_raw:
        issues.append("missing_h1")
    if title_has_prefix:
        issues.append("title_has_ielts_prefix")
    if h1_has_part:
        issues.append("h1_has_part_prefix")
    if h1_has_leading_number:
        issues.append("h1_has_leading_number")
    if title_clean and h1_clean and title_clean != h1_clean:
        issues.append("title_h1_mismatch")
    if transcript and answer_highlight_count and not correct_answers_global:
        issues.append("transcript_only_answers")
    if correct_answers_var and not correct_answers_global:
        issues.append("correctAnswers_not_global")
    if answer_tag_matches and not correct_answers_global:
        issues.append("answer_tag_not_global")

    return {
        "path": path_str,
        "title_raw": title_raw,
        "h1_raw": h1_raw,
        "title_clean": title_clean,
        "h1_clean": h1_clean,
        "part": part,
        "exam_number": exam_number,
        "transcript": transcript,
        "answer_highlight_count": answer_highlight_count,
        "answer_tag_count": len(answer_tag_matches),
        "answer_tag_questions": answer_tag_unique,
        "correct_answers_global": correct_answers_global,
        "correct_answers_var": correct_answers_var,
        "issues": issues,
    }


def build_summary(records: list[dict]) -> dict:
    issue_counts: dict[str, int] = {}
    for rec in records:
        for issue in rec["issues"]:
            issue_counts[issue] = issue_counts.get(issue, 0) + 1
    issue_samples: dict[str, list[str]] = {}
    for rec in records:
        for issue in rec["issues"]:
            if issue not in issue_samples:
                issue_samples[issue] = []
            if len(issue_samples[issue]) < 3:
                issue_samples[issue].append(rec["path"])
    return {
        "total": len(records),
        "issue_counts": dict(sorted(issue_counts.items(), key=lambda x: (-x[1], x[0]))),
        "issue_samples": issue_samples,
    }


def main():
    parser = argparse.ArgumentParser(description="Scan ListeningPractice HTML files for title/answer inconsistencies.")
    parser.add_argument("--root", default="ListeningPractice", help="Root folder of ListeningPractice")
    parser.add_argument("--output-json", default="developer/tests/reports/listeningpractice-scan.json")
    parser.add_argument("--output-md", default="developer/tests/reports/listeningpractice-scan.md")
    args = parser.parse_args()

    root = Path(args.root)
    html_files = sorted(root.rglob("*.html"))
    records = [scan_file(path) for path in html_files]
    summary = build_summary(records)

    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps({"summary": summary, "records": records}, ensure_ascii=False, indent=2), encoding="utf-8")

    output_md = Path(args.output_md)
    lines = []
    lines.append("# ListeningPractice Scan Summary")
    lines.append("")
    lines.append(f"Total HTML files: {summary['total']}")
    lines.append("")
    lines.append("## Issue Counts")
    for issue, count in summary["issue_counts"].items():
        lines.append(f"- {issue}: {count}")
    lines.append("")
    lines.append("## Samples")
    for issue, samples in summary["issue_samples"].items():
        lines.append(f"- {issue}:")
        for sample in samples:
            lines.append(f"  - {sample}")
    output_md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Scanned {len(records)} files. Reports: {output_json}, {output_md}")


if __name__ == "__main__":
    main()
