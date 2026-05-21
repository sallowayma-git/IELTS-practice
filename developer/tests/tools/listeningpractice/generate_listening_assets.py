#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from pathlib import Path


TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)
PART_RE = re.compile(r"\bP(?:ART)?\s*([1-4])\b", re.IGNORECASE)
LEADING_NUMBER_RE = re.compile(r"^\s*(\d{1,4})[\s.\-、_]+")
FREQUENCY_ALIASES = {
    "超高频": "超高频",
    "高频": "高频",
    "次高频": "次高频",
    "中频": "中频",
    "低频": "低频",
    "非高频": "非高频",
}


def read_text(path: Path) -> str:
    data = path.read_bytes()
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


def strip_html(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def clean_title(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if not text:
        return ""
    text = re.sub(r"IELTS\s+Listening\s+Practice\s*[-–—:]?\s*", "", text, flags=re.IGNORECASE)
    text = LEADING_NUMBER_RE.sub("", text)
    text = re.sub(r"^\s*P(?:ART)?\s*[1-4]\s*[-–—:]?\s*", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def normalize_rel(path: Path) -> str:
    return path.as_posix().replace("//", "/")


def detect_category(parts: list[str], text: str) -> str:
    for part in parts:
        if re.fullmatch(r"P[1-4]", part, flags=re.IGNORECASE):
            return part.upper()
    match = PART_RE.search(text)
    return f"P{match.group(1)}" if match else "P1"


def detect_frequency(parts: list[str]) -> str:
    for part in parts:
        for raw, normalized in sorted(FREQUENCY_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
            if raw in part:
                return normalized
    return ""


def detect_number(path: Path, title: str) -> int | None:
    candidates = [path.parent.name, path.name, title]
    for value in candidates:
        match = LEADING_NUMBER_RE.search(value or "")
        if match:
            return int(match.group(1))
    return None


def build_exam_id(category: str, index: int, frequency: str, title: str, unique_hint: str) -> str:
    freq_slug = {
        "超高频": "ultra",
        "高频": "high",
        "次高频": "very",
        "中频": "mid",
        "低频": "low",
        "非高频": "low",
    }.get(frequency, "normal")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    if not slug:
        slug = f"exam-{index:03d}"
    slug = slug[:42].strip("-")
    digest = hashlib.sha1(unique_hint.encode("utf-8")).hexdigest()[:8]
    return f"listening-{category.lower()}-{freq_slug}-{index:03d}-{slug}-{digest}"


def find_audio(dir_path: Path) -> str:
    for pattern in ("*.mp3", "*.m4a", "*.wav", "*.ogg"):
        matches = sorted(dir_path.glob(pattern))
        if matches:
            return matches[0].name
    return ""


def scan_html(root: Path, html_path: Path, index: int) -> dict:
    raw = read_text(html_path)
    rel_html = html_path.relative_to(root)
    rel_dir = rel_html.parent
    parts = list(rel_html.parts)
    title_match = TITLE_RE.search(raw)
    h1_match = H1_RE.search(raw)
    title = clean_title(strip_html(title_match.group(1)) if title_match else "")
    if not title:
        title = clean_title(strip_html(h1_match.group(1)) if h1_match else "")
    if not title:
        title = clean_title(html_path.stem)
    category = detect_category(parts, " ".join([normalize_rel(rel_html), title]))
    frequency = detect_frequency(parts)
    number = detect_number(html_path, title)
    source_path = normalize_rel(rel_html)
    exam_id = build_exam_id(category, number or index, frequency, title, source_path)
    audio = find_audio(html_path.parent)
    return {
        "id": exam_id,
        "examId": exam_id,
        "dataKey": exam_id,
        "title": title or html_path.stem,
        "category": category,
        "frequency": frequency,
        "type": "listening",
        "path": normalize_rel(rel_dir) + "/",
        "filename": html_path.name,
        "audioFilename": audio,
        "hasHtml": True,
        "hasAudio": bool(audio),
        "sourcePath": source_path,
        "questionNumber": number,
    }


def render_js_array(entries: list[dict]) -> str:
    payload = json.dumps(entries, ensure_ascii=False, indent=4)
    return "\n".join([
        "(function registerListeningExamIndex(global) {",
        "    'use strict';",
        f"    global.listeningExamIndex = {payload};",
        "    global.listeningExamIndex.pathRoot = 'ListeningPractice/';",
        "})(typeof window !== 'undefined' ? window : globalThis);",
        "",
    ])


def render_manifest(entries: list[dict]) -> str:
    manifest = {
        entry["examId"]: {
            "examId": entry["examId"],
            "dataKey": entry["dataKey"],
            "path": entry["path"],
            "filename": entry["filename"],
            "audioFilename": entry["audioFilename"],
            "title": entry["title"],
            "category": entry["category"],
            "frequency": entry["frequency"],
            "type": "listening",
        }
        for entry in entries
    }
    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    return "\n".join([
        "(function registerListeningExamManifest(global) {",
        "  'use strict';",
        f"  global.__LISTENING_EXAM_MANIFEST__ = {payload};",
        "})(typeof window !== \"undefined\" ? window : globalThis);",
        "",
    ])


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate default listening exam index and manifest.")
    parser.add_argument("--root", default="ListeningPractice", help="ListeningPractice root")
    parser.add_argument("--index-output", default="assets/generated/listening-exams/listening-index.compat.js")
    parser.add_argument("--manifest-output", default="assets/generated/listening-exams/manifest.js")
    parser.add_argument("--report", default="developer/tests/reports/listening-assets-report.json")
    args = parser.parse_args()

    root = Path(args.root)
    html_files = []
    for category in ("P1", "P2", "P3", "P4"):
        category_dir = root / category
        if category_dir.exists():
            html_files.extend(sorted(category_dir.rglob("*.html")))

    entries = [scan_html(root, path, index + 1) for index, path in enumerate(html_files)]
    entries.sort(key=lambda item: (
        item["category"],
        item["frequency"],
        item["questionNumber"] if item["questionNumber"] is not None else 9999,
        item["title"].lower(),
        item["sourcePath"].lower(),
    ))

    index_output = Path(args.index_output)
    index_output.parent.mkdir(parents=True, exist_ok=True)
    index_output.write_text(render_js_array(entries), encoding="utf-8")

    manifest_output = Path(args.manifest_output)
    manifest_output.parent.mkdir(parents=True, exist_ok=True)
    manifest_output.write_text(render_manifest(entries), encoding="utf-8")

    report = {
        "root": str(root),
        "count": len(entries),
        "byCategory": {},
        "missingAudio": [entry["sourcePath"] for entry in entries if not entry["hasAudio"]],
        "duplicateIds": [],
        "outputs": {
            "index": str(index_output),
            "manifest": str(manifest_output),
        },
    }
    for entry in entries:
        report["byCategory"][entry["category"]] = report["byCategory"].get(entry["category"], 0) + 1
    seen: dict[str, int] = {}
    for entry in entries:
        seen[entry["examId"]] = seen.get(entry["examId"], 0) + 1
    report["duplicateIds"] = sorted([exam_id for exam_id, count in seen.items() if count > 1])

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Generated {len(entries)} listening entries: {index_output}, {manifest_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
