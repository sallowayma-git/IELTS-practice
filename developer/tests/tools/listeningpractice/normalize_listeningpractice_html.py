#!/usr/bin/env python3
import argparse
import html
import json
import re
from pathlib import Path

TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
ANSWER_TAG_RE = re.compile(r"\(Q\s*(\d+)\s*:\s*([A-Za-z]+)\)")

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
    text = IELTS_PREFIX_RE.sub("", text)
    text = LEADING_NUMBER_RE.sub("", text)
    text = PART_PREFIX_RE.sub("", text)
    text = P_PREFIX_RE.sub("", text)
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


def build_topic(title_raw: str, h1_raw: str, filename: str) -> str:
    candidates = [
        clean_title_candidate(title_raw),
        clean_title_candidate(h1_raw),
        clean_title_candidate(filename),
    ]
    for candidate in candidates:
        if candidate:
            return candidate
    return ""


def update_title(html_text: str, new_title: str) -> tuple[str, bool]:
    if not new_title:
        return html_text, False
    if TITLE_RE.search(html_text):
        replaced = TITLE_RE.sub(lambda m: f"<title>{new_title}</title>", html_text, count=1)
        return replaced, replaced != html_text
    # insert title in head
    head_match = re.search(r"<head[^>]*>", html_text, re.IGNORECASE)
    if head_match:
        insert_at = head_match.end()
        return html_text[:insert_at] + f"\n    <title>{new_title}</title>" + html_text[insert_at:], True
    return html_text, False


def update_h1(html_text: str, new_h1: str) -> tuple[str, bool]:
    if not new_h1:
        return html_text, False
    if H1_RE.search(html_text):
        replaced = H1_RE.sub(lambda m: f"<h1>{new_h1}</h1>", html_text, count=1)
        return replaced, replaced != html_text
    body_match = re.search(r"<body[^>]*>", html_text, re.IGNORECASE)
    if body_match:
        insert_at = body_match.end()
        h1_line = f'<h1 style="display:none" data-auto-title="true">{new_h1}</h1>'
        updated = html_text[:insert_at] + f"\n    {h1_line}" + html_text[insert_at:]
        return updated, True
    return html_text, False


def promote_correct_answers(html_text: str, var_names: list[str]) -> tuple[str, bool]:
    updated = html_text
    changed = False

    for name in var_names:
        pattern = re.compile(rf"\b(const|let|var)\s+{re.escape(name)}\s*=")
        match = pattern.search(updated)
        if not match:
            continue
        # Replace the assignment to also assign to window.correctAnswers
        replacement = f"{match.group(1)} {name} = window.correctAnswers ="
        updated = pattern.sub(replacement, updated, count=1)
        changed = True
        break

    return updated, changed


def inject_correct_answers_from_tags(html_text: str, existing_global: bool) -> tuple[str, bool, dict]:
    if existing_global:
        return html_text, False, {}
    matches = ANSWER_TAG_RE.findall(html_text)
    if not matches:
        return html_text, False, {}
    answers = {}
    for qnum, value in matches:
        norm = value.strip().upper()
        if norm in {"TRUE", "FALSE"} or (len(norm) == 1 and norm.isalpha()):
            answers[f"q{qnum}"] = norm
    if not answers:
        return html_text, False, {}

    script_lines = ["<script>", "window.correctAnswers = {"]
    for key in sorted(answers.keys(), key=lambda x: int(x[1:])):
        script_lines.append(f"  {key}: '{answers[key]}',")
    script_lines.append("};")
    script_lines.append("</script>")
    script = "\n".join(script_lines)

    # Insert before </body>
    body_close = re.search(r"</body>", html_text, re.IGNORECASE)
    if body_close:
        insert_at = body_close.start()
        updated = html_text[:insert_at] + script + "\n" + html_text[insert_at:]
        return updated, True, answers

    return html_text, False, answers


def normalize_file(path: Path, options: dict) -> dict:
    raw = read_text(path)
    original = raw

    title_match = TITLE_RE.search(raw)
    title_raw = strip_html(title_match.group(1)) if title_match else ""
    h1_match = H1_RE.search(raw)
    h1_raw = strip_html(h1_match.group(1)) if h1_match else ""

    topic = build_topic(title_raw, h1_raw, path.stem)
    part = detect_part(" ".join([str(path), title_raw, h1_raw]))
    exam_number = detect_exam_number(path.name) or detect_exam_number(path.parent.name) or detect_exam_number(h1_raw)

    title_mode = options["title_mode"]
    if title_mode == "topic":
        new_title = topic
    elif title_mode == "prefixed":
        if part:
            new_title = f"IELTS Listening Practice - Part {part} {topic}".strip()
        else:
            new_title = f"IELTS Listening Practice - {topic}".strip()
    else:
        new_title = title_raw

    h1_mode = options["h1_mode"]
    if h1_mode == "keep":
        new_h1 = h1_raw
    elif h1_mode == "topic":
        new_h1 = topic
    elif h1_mode == "part-topic":
        if part:
            new_h1 = f"Part {part} - {topic}".strip()
        else:
            new_h1 = topic
    else:
        new_h1 = h1_raw

    updated, title_changed = update_title(raw, new_title)
    updated, h1_changed = update_h1(updated, new_h1)

    promote_changed = False
    if options["promote_correct_answers"]:
        updated, promote_changed = promote_correct_answers(updated, options["promote_var_names"])

    updated = re.sub(
        r"window\s*\.\s*correctAnswers\s*=\s*window\s*\.\s*correctAnswers\s*\|\|\s*{",
        "window.correctAnswers = {",
        updated,
    )

    existing_global = bool(re.search(r"(?:window|globalThis|self)\s*\.\s*correctAnswers\s*=", updated))
    if promote_changed:
        existing_global = True

    injected_changed = False
    injected_answers = {}
    if options["inject_from_tags"]:
        updated, injected_changed, injected_answers = inject_correct_answers_from_tags(updated, existing_global)

    changed = updated != original

    return {
        "path": str(path),
        "title_raw": title_raw,
        "h1_raw": h1_raw,
        "topic": topic,
        "part": part,
        "exam_number": exam_number,
        "title_changed": title_changed,
        "h1_changed": h1_changed,
        "promote_changed": promote_changed,
        "injected_changed": injected_changed,
        "injected_answers": injected_answers,
        "changed": changed,
        "updated": updated,
        "original": original,
    }


def main():
    parser = argparse.ArgumentParser(description="Normalize ListeningPractice HTML titles and correct answers.")
    parser.add_argument("--root", default="ListeningPractice", help="Root folder of ListeningPractice")
    parser.add_argument("--write", action="store_true", help="Apply changes to files")
    parser.add_argument("--backup-dir", default="", help="Backup directory (optional, only when --write)")
    parser.add_argument("--report", default="developer/tests/reports/listeningpractice-normalize.json")
    parser.add_argument("--title-mode", choices=["topic", "prefixed", "keep"], default="topic")
    parser.add_argument("--h1-mode", choices=["keep", "topic", "part-topic"], default="keep")
    parser.add_argument("--promote-correct-answers", action="store_true", default=True)
    parser.add_argument("--no-promote-correct-answers", action="store_false", dest="promote_correct_answers")
    parser.add_argument("--promote-var-names", default="correctAnswers")
    parser.add_argument("--inject-from-tags", action="store_true", default=True)
    parser.add_argument("--no-inject-from-tags", action="store_false", dest="inject_from_tags")
    args = parser.parse_args()

    options = {
        "title_mode": args.title_mode,
        "h1_mode": args.h1_mode,
        "promote_correct_answers": args.promote_correct_answers,
        "promote_var_names": [x.strip() for x in args.promote_var_names.split(",") if x.strip()],
        "inject_from_tags": args.inject_from_tags,
    }

    root = Path(args.root)
    html_files = sorted(root.rglob("*.html"))

    results = []
    for path in html_files:
        result = normalize_file(path, options)
        results.append({k: v for k, v in result.items() if k not in {"updated", "original"}})
        if args.write and result["changed"]:
            if args.backup_dir:
                backup_path = Path(args.backup_dir) / path
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                backup_path.write_text(result["original"], encoding="utf-8")
            path.write_text(result["updated"], encoding="utf-8")

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps({"options": options, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")

    changed_count = sum(1 for r in results if r["changed"])
    print(f"Normalized {len(results)} files. Changed: {changed_count}. Report: {report_path}")


if __name__ == "__main__":
    main()
