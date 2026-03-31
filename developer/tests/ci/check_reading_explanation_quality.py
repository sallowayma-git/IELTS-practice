#!/usr/bin/env python3
"""Hard quality gates for generated reading explanations.

Checks:
1) explanation answer must match the paired reading-exam answerKey
2) placeholder text must not appear in generated explanation payloads
3) explanation conclusion must not contradict the declared answer
4) explanation sourceDoc should prefer PDF over markdown mirrors
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple


ROOT = Path(os.environ.get("READING_EXPLANATION_REPO_ROOT") or Path(__file__).resolve().parents[3])
EXPLANATION_DIR = ROOT / "assets" / "generated" / "reading-explanations"
EXAM_DIR = ROOT / "assets" / "generated" / "reading-exams"
REPORT_PATH = ROOT / "developer" / "tests" / "e2e" / "reports" / "reading-explanation-quality-report.json"

PLACEHOLDER_PATTERNS: Tuple[str, ...] = (
    "根据具体题目分析",
    "同上",
    "[题目内容]",
    "题目翻译：[翻译]",
    "解析：[解析内容]",
)

JUDGEMENT_EQUIVALENTS = {
    "TRUE": {"TRUE", "YES"},
    "FALSE": {"FALSE", "NO"},
    "NOT GIVEN": {"NOT GIVEN", "NG"},
    "YES": {"YES", "TRUE"},
    "NO": {"NO", "FALSE"},
}


def extract_registered_payload(path: Path) -> Dict[str, Any] | None:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'register\("[^"]+",\s*(\{[\s\S]*\})\s*\)\s*;?\s*\}', text)
    if not match:
        return None
    return json.loads(match.group(1))


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_answer(value: Any) -> str:
    if isinstance(value, list):
        return " | ".join(normalize_answer(item) for item in value)
    text = normalize_whitespace(str(value or ""))
    text = text.strip("[]")
    text = text.replace("'", "").replace('"', "")
    text = re.sub(r"（.*?）", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    text = text.strip(" .;:，。")
    return text.upper()


def canonicalize_judgement(value: str) -> str:
    upper = normalize_answer(value)
    for canonical, variants in JUDGEMENT_EQUIVALENTS.items():
        if upper in variants:
            return canonical
    return upper


def extract_declared_answer(text: str) -> str:
    match = re.search(r"答案[：:]\s*([^\n]+)", text)
    return match.group(1).strip() if match else ""


def extract_conclusion_answer(text: str) -> str:
    matches = re.findall(r"因此答案为\s*([A-Za-z0-9 ,.\-]+)", text)
    if not matches:
        matches = re.findall(r"因此判定为\s*([A-Za-z ]+)", text)
    if not matches:
        return ""
    candidate = matches[-1].strip()
    candidate = candidate.split("。")[0].strip()
    return candidate


def equivalent_answers(expected: Any, actual: str) -> bool:
    expected_norm = normalize_answer(expected)
    actual_norm = normalize_answer(actual)
    if not expected_norm or not actual_norm:
        return False

    if isinstance(expected, list):
        options = {normalize_answer(item) for item in expected}
        return actual_norm in options

    canonical_expected = canonicalize_judgement(expected_norm)
    canonical_actual = canonicalize_judgement(actual_norm)
    if canonical_expected == canonical_actual:
        return True

    expected_parts = {part.strip() for part in re.split(r"[,/|]|(?:\s+AND\s+)", expected_norm) if part.strip()}
    actual_parts = {part.strip() for part in re.split(r"[,/|]|(?:\s+AND\s+)", actual_norm) if part.strip()}
    return bool(expected_parts) and expected_parts == actual_parts


def question_number_from_id(question_id: str) -> int | None:
    match = re.fullmatch(r"q(\d+)", question_id or "")
    return int(match.group(1)) if match else None


def collect_changed_explanation_files() -> List[Path]:
    try:
        completed = subprocess.run(
            ["git", "status", "--short", "--", str(EXPLANATION_DIR.relative_to(ROOT))],
            cwd=str(ROOT),
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except Exception:
        return []

    files: List[Path] = []
    for line in (completed.stdout or "").splitlines():
        path_text = line[3:].strip()
        if not path_text.endswith(".js") or path_text.endswith("manifest.js"):
            continue
        path = ROOT / path_text
        if path.exists():
            files.append(path)
    return sorted(set(files))


def collect_explanation_files(scope: str) -> List[Path]:
    if scope == "changed":
        changed = collect_changed_explanation_files()
        if changed:
            return changed
    return sorted(
        path for path in EXPLANATION_DIR.glob("p*-*.js")
        if path.name != "manifest.js"
    )


def main(argv: List[str]) -> int:
    scope = "all"
    if "--scope" in argv:
        try:
            scope = argv[argv.index("--scope") + 1].strip().lower()
        except Exception:
            scope = "all"
    if scope not in {"all", "changed"}:
        scope = "all"

    explanation_files = collect_explanation_files(scope)

    report: Dict[str, Any] = {
        "scannedFiles": len(explanation_files),
        "blockingFiles": [],
        "summary": {
            "answerKeyMismatches": 0,
            "placeholderHits": 0,
            "conclusionMismatches": 0,
            "nonPdfSourceDocs": 0,
            "missingExamFiles": 0,
            "parseFailures": 0,
        },
    }

    blocking_files: List[Dict[str, Any]] = []

    for explanation_path in explanation_files:
        file_issues: List[str] = []
        explanation_payload = extract_registered_payload(explanation_path)
        if explanation_payload is None:
            report["summary"]["parseFailures"] += 1
            blocking_files.append({
                "examId": explanation_path.stem,
                "file": str(explanation_path.relative_to(ROOT)),
                "issues": ["无法解析 explanation register payload"],
            })
            continue

        exam_id = str(explanation_payload.get("examId") or explanation_path.stem)
        exam_path = EXAM_DIR / f"{exam_id}.js"
        exam_payload = extract_registered_payload(exam_path) if exam_path.exists() else None
        if exam_payload is None:
            report["summary"]["missingExamFiles"] += 1
            blocking_files.append({
                "examId": exam_id,
                "file": str(explanation_path.relative_to(ROOT)),
                "issues": [f"缺少对应 reading-exam 文件: {exam_path.name}"],
            })
            continue

        source_doc = str((explanation_payload.get("meta") or {}).get("sourceDoc") or "")
        if source_doc and scope == "all" and source_doc.lower().endswith(".md"):
            report["summary"]["nonPdfSourceDocs"] += 1
            file_issues.append(f"sourceDoc 不是 PDF: {source_doc}")

        answer_key = exam_payload.get("answerKey") if isinstance(exam_payload.get("answerKey"), dict) else {}
        for section in explanation_payload.get("questionExplanations") or []:
            section_text = section.get("text", "") or ""
            for placeholder in PLACEHOLDER_PATTERNS:
                if placeholder in section_text:
                    report["summary"]["placeholderHits"] += 1
                    file_issues.append(f"section.text 含占位词: {placeholder}")

            for item in section.get("items") or []:
                question_id = str(item.get("questionId") or "")
                question_number = item.get("questionNumber")
                item_text = item.get("text", "") or ""

                for placeholder in PLACEHOLDER_PATTERNS:
                    if placeholder in item_text:
                        report["summary"]["placeholderHits"] += 1
                        file_issues.append(f"Q{question_number}: 含占位词: {placeholder}")

                declared_answer = extract_declared_answer(item_text)
                if question_id and question_id in answer_key:
                    expected_answer = answer_key[question_id]
                else:
                    derived_number = question_number_from_id(question_id)
                    if derived_number is None and isinstance(question_number, int):
                        derived_number = question_number
                    expected_answer = answer_key.get(f"q{derived_number}") if derived_number else None

                if expected_answer is not None and not equivalent_answers(expected_answer, declared_answer):
                    report["summary"]["answerKeyMismatches"] += 1
                    file_issues.append(
                        f"Q{question_number}: 答案与 answerKey 不一致 (declared={declared_answer!r}, expected={expected_answer!r})"
                    )

                conclusion_answer = extract_conclusion_answer(item_text)
                if conclusion_answer and declared_answer and not equivalent_answers(declared_answer, conclusion_answer):
                    report["summary"]["conclusionMismatches"] += 1
                    file_issues.append(
                        f"Q{question_number}: 解析结论与答案字段矛盾 (declared={declared_answer!r}, conclusion={conclusion_answer!r})"
                    )

        if file_issues:
            blocking_files.append({
                "examId": exam_id,
                "file": str(explanation_path.relative_to(ROOT)),
                "issues": file_issues[:50],
                "issueCount": len(file_issues),
            })

    report["scope"] = scope
    report["blockingFiles"] = blocking_files
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    passed = not blocking_files
    print("[reading-explanation-quality] pass" if passed else "[reading-explanation-quality] fatal issues found")
    print(json.dumps(report, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
