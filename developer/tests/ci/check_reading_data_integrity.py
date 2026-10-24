#!/usr/bin/env python3
"""Reading exam data integrity checks.

Checks:
1) Duplicate entries by (type=reading, category, normalized title)
2) PDF source path consistency for entries that define pdfFilename
3) Every generated exam file must appear in the shipped resource-pack manifest
4) meta.frequencyMonth, when present, must match YYYY-MM (month 01-12)
"""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
READING_DIR = ROOT / "assets" / "generated" / "reading-exams"
PACK_MANIFEST_PATH = ROOT / "assets" / "resource-pack" / "reading" / "manifest.json"
REPORT_PATH = ROOT / "developer" / "tests" / "e2e" / "reports" / "reading-data-integrity-report.json"
ALLOWLIST_PATH = ROOT / "developer" / "tests" / "ci" / "reading-duplicate-allowlist.json"
FREQUENCY_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def load_pack_exam_ids():
    """Return (examIds in the shipped pack manifest or None on error, error message or None)."""
    if not PACK_MANIFEST_PATH.exists():
        return None, f"pack manifest missing: {PACK_MANIFEST_PATH.relative_to(ROOT)}"
    try:
        payload = json.loads(PACK_MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - any decode/parse failure is fatal
        return None, f"pack manifest unreadable: {exc}"
    entries = payload.get("entries") if isinstance(payload, dict) else None
    exam_ids = set()
    for entry in entries or []:
        exam_id = str(entry.get("examId") or "").strip()
        if exam_id:
            exam_ids.add(exam_id)
    return exam_ids, None


def norm_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\u4e00-\u9fa5]+", " ", value.lower())).strip()


def extract_registered_payload(path: Path):
    text = path.read_text(encoding="utf-8")
    match = re.search(r'register\("[^"]+",\s*(\{[\s\S]*\})\s*\)\s*;?\s*\}', text)
    if not match:
        return None
    return json.loads(match.group(1))


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
    parse_failures = []
    paragraph_match_text_inputs = []
    missing_pack_entries = []
    invalid_frequency_month = []

    pack_exam_ids, pack_manifest_error = load_pack_exam_ids()

    seen = {}
    for path in files:
        content = path.read_text(encoding="utf-8")
        exam_id = extract_field(r'"examId":\s*"([^"]+)"', content)
        title = extract_field(r'"title":\s*"([^"]+)"', content)
        category = extract_field(r'"category":\s*"([^"]+)"', content)
        pdf_filename = extract_field(r'"pdfFilename":\s*"([^"]*)"', content)

        if exam_id and pack_exam_ids is not None and exam_id not in pack_exam_ids:
            missing_pack_entries.append(exam_id)

        key = f"{norm_text(category)}::{norm_text(title)}"
        if key in seen:
            duplicates.setdefault(key, []).append(exam_id or path.stem)
        else:
            seen[key] = exam_id or path.stem

        try:
            payload = extract_registered_payload(path)
        except json.JSONDecodeError:
            parse_failures.append(exam_id or path.stem)
            continue
        if payload is None:
            parse_failures.append(exam_id or path.stem)
            continue

        source_refs = payload.get("sourceRefs") if isinstance(payload.get("sourceRefs"), dict) else {}
        pdf_ref = str(source_refs.get("pdf") or "").strip()
        if pdf_filename:
            if not pdf_ref:
                missing_pdf_ref.append(exam_id or path.stem)
            elif not pdf_ref.endswith(".pdf"):
                malformed_pdf_ref.append({"examId": exam_id or path.stem, "pdf": pdf_ref})

        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        frequency_month = str(meta.get("frequencyMonth") or "").strip()
        if frequency_month and not FREQUENCY_MONTH_PATTERN.match(frequency_month):
            invalid_frequency_month.append(
                {"examId": exam_id or path.stem, "frequencyMonth": frequency_month}
            )

        for group in payload.get("questionGroups") or []:
            body_html = str(group.get("bodyHtml") or "")
            if (
                re.search(r"Which\s+(?:paragraph|section)\s+contains the following information\?", body_html, flags=re.IGNORECASE)
                and re.search(r"Write the correct letter", body_html, flags=re.IGNORECASE)
                and re.search(r'type=["\']text["\']', body_html, flags=re.IGNORECASE)
            ):
                paragraph_match_text_inputs.append(
                    {
                        "examId": exam_id or path.stem,
                        "groupId": group.get("groupId"),
                        "kind": group.get("kind"),
                        "questionIds": group.get("questionIds") or [],
                    }
                )

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
        "parseFailures": parse_failures,
        "paragraphMatchTextInputs": paragraph_match_text_inputs,
        "packManifestError": pack_manifest_error,
        "missingPackEntries": missing_pack_entries,
        "invalidFrequencyMonth": invalid_frequency_month,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    fatal_issue = bool(
        missing_pdf_ref
        or malformed_pdf_ref
        or duplicate_blocking
        or parse_failures
        or paragraph_match_text_inputs
        or pack_manifest_error
        or missing_pack_entries
        or invalid_frequency_month
    )
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
