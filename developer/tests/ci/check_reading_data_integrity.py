#!/usr/bin/env python3
"""Reading exam data integrity checks.

Checks:
1) Duplicate entries by (type=reading, category, normalized title)
2) PDF source path consistency for entries that define pdfFilename
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
READING_DIR = ROOT / "assets" / "generated" / "reading-exams"
REPORT_PATH = ROOT / "developer" / "tests" / "e2e" / "reports" / "reading-data-integrity-report.json"
ALLOWLIST_PATH = ROOT / "developer" / "tests" / "ci" / "reading-duplicate-allowlist.json"


def norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\u4e00-\u9fa5]+", " ", value.lower())).strip()


def extract_field(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.MULTILINE)
    return match.group(1).strip() if match else ""


def main() -> int:
    allowlist_keys = set()
    if ALLOWLIST_PATH.exists():
        try:
            allowlist_payload = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
            allowlist_keys = {
                str(key).strip().lower()
                for key in (allowlist_payload.get("allowedDuplicateKeys") or [])
                if str(key).strip()
            }
        except Exception:
            allowlist_keys = set()

    files = sorted(READING_DIR.glob("p*-*.js"))
    duplicates = {}
    missing_pdf_ref = []
    malformed_pdf_ref = []

    seen = {}
    for path in files:
        content = path.read_text(encoding="utf-8")
        exam_id = extract_field(r'"examId":\s*"([^"]+)"', content)
        title = extract_field(r'"title":\s*"([^"]+)"', content)
        category = extract_field(r'"category":\s*"([^"]+)"', content)
        pdf_filename = extract_field(r'"pdfFilename":\s*"([^"]*)"', content)
        shui_pdf = extract_field(r'"shuiPdf":\s*"([^"]*)"', content)

        key = f"{norm_text(category)}::{norm_text(title)}"
        if key in seen:
            duplicates.setdefault(key, []).append(exam_id or path.stem)
        else:
            seen[key] = exam_id or path.stem

        if pdf_filename:
            if not shui_pdf:
                missing_pdf_ref.append(exam_id or path.stem)
            elif not shui_pdf.endswith(".pdf"):
                malformed_pdf_ref.append({"examId": exam_id or path.stem, "shuiPdf": shui_pdf})

    duplicate_entries = []
    duplicate_allowlisted = []
    duplicate_blocking = []
    for key, ids in duplicates.items():
        normalized_key = str(key).strip().lower()
        entry = {
            "key": key,
            "examIds": [seen[key], *ids]
        }
        duplicate_entries.append(entry)
        if normalized_key in allowlist_keys:
            duplicate_allowlisted.append(entry)
        else:
            duplicate_blocking.append(entry)

    report = {
        "scannedFiles": len(files),
        "duplicateEntries": duplicate_entries,
        "allowlistedDuplicates": duplicate_allowlisted,
        "blockingDuplicates": duplicate_blocking,
        "missingPdfRef": missing_pdf_ref,
        "malformedPdfRef": malformed_pdf_ref,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    fatal_issue = bool(missing_pdf_ref or malformed_pdf_ref or duplicate_blocking)
    if fatal_issue:
        print("[reading-data-integrity] fatal issues found")
    elif duplicate_entries:
        print("[reading-data-integrity] pass_with_duplicate_warnings")
    else:
        print("[reading-data-integrity] pass")
    print(json.dumps(report, ensure_ascii=False))
    return 1 if fatal_issue else 0


if __name__ == "__main__":
    raise SystemExit(main())
