#!/usr/bin/env python3
"""Validate checklist summary and regression-claim consistency."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHECKLIST_PATH = ROOT / "checklist.md"
STATIC_REPORT = ROOT / "developer" / "tests" / "e2e" / "reports" / "static-ci-report.json"
SUITE_REPORT = ROOT / "developer" / "tests" / "e2e" / "reports" / "suite-practice-flow-report.json"
PDF_AUDIT_REPORT = ROOT / "developer" / "tests" / "e2e" / "reports" / "pdf-checklist-audit-report.json"
READING_INTEGRITY_REPORT = ROOT / "developer" / "tests" / "e2e" / "reports" / "reading-data-integrity-report.json"

STATUS_BUCKETS = ("待修复", "已修复待验证", "已验证通过")
RUN_STATIC_COMMAND = "python3 developer/tests/ci/run_static_suite.py"
IGNORE_STATIC_CLAIM_ENV = "CHECKLIST_IGNORE_RUN_STATIC_CLAIM"


def parse_issue_rows(checklist_text: str):
    status_count = {key: 0 for key in STATUS_BUCKETS}
    for line in checklist_text.splitlines():
        if not re.match(r"^\|\s*I\d{3}\s*\|", line):
            continue
        cells = [cell.strip() for cell in line.strip().split("|")]
        if len(cells) < 6:
            continue
        status = cells[4]
        if status in status_count:
            status_count[status] += 1
    return status_count


def parse_summary_counts(checklist_text: str):
    summary_count = {}
    for bucket in STATUS_BUCKETS:
        pattern = rf"-\s*`{re.escape(bucket)}`\s*:\s*(\d+)"
        match = re.search(pattern, checklist_text)
        if match:
            summary_count[bucket] = int(match.group(1))
    return summary_count


def parse_regression_claims(checklist_text: str):
    claims = {}
    for line in checklist_text.splitlines():
        if "python3" not in line:
            continue
        normalized = line.strip()
        command_match = re.search(r"`(python3\s+[^`]+)`", normalized)
        if not command_match:
            continue
        command = command_match.group(1)
        if "：通过" in normalized or ": 通过" in normalized:
            claims[command] = "pass"
        elif "：失败" in normalized or ": 失败" in normalized:
            claims[command] = "fail"
    return claims


def infer_status_from_report(path: Path, report_kind: str):
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if report_kind in {"static", "suite"}:
        return "pass" if payload.get("status") == "pass" else "fail"
    if report_kind == "pdf_audit":
        has_error = any(
            [
                bool(payload.get("onlyInMapping")),
                bool(payload.get("onlyInChecklist")),
                bool(payload.get("invalidStatusRows")),
                bool(payload.get("missingEvidenceForVerified")),
                bool(payload.get("monaBannedPatternHits")),
                payload.get("monaCoverageOk") is False,
                bool(payload.get("monaAnswerMismatches")),
            ]
        )
        return "fail" if has_error else "pass"
    if report_kind == "reading_integrity":
        blocking = bool(payload.get("blockingDuplicates"))
        missing = bool(payload.get("missingPdfRef"))
        malformed = bool(payload.get("malformedPdfRef"))
        return "fail" if (blocking or missing or malformed) else "pass"
    return None


def report_fresh_enough(path: Path, baseline_mtime: float):
    if not path.exists():
        return None
    return path.stat().st_mtime >= baseline_mtime


def format_iso_timestamp(ts: float | None):
    if ts is None:
        return None
    return datetime.fromtimestamp(ts).isoformat()


def main() -> int:
    if not CHECKLIST_PATH.exists():
        skipped = {
            "status": "skipped",
            "reason": f"missing_checklist:{CHECKLIST_PATH}",
            "summaryStatusCount": {},
            "issueStatusCount": {key: 0 for key in STATUS_BUCKETS},
            "summaryMismatches": [],
            "claims": {},
            "claimMismatches": [],
            "freshnessMismatches": [],
            "reportFreshness": {},
        }
        print(json.dumps(skipped, ensure_ascii=False))
        return 0

    checklist_text = CHECKLIST_PATH.read_text(encoding="utf-8")
    checklist_mtime = CHECKLIST_PATH.stat().st_mtime
    issue_status_count = parse_issue_rows(checklist_text)
    summary_status_count = parse_summary_counts(checklist_text)
    claims = parse_regression_claims(checklist_text)

    summary_mismatch = []
    for bucket in STATUS_BUCKETS:
        if bucket not in summary_status_count:
            summary_mismatch.append(
                {"bucket": bucket, "issueCount": issue_status_count[bucket], "summaryCount": None}
            )
            continue
        if issue_status_count[bucket] != summary_status_count[bucket]:
            summary_mismatch.append(
                {
                    "bucket": bucket,
                    "issueCount": issue_status_count[bucket],
                    "summaryCount": summary_status_count[bucket],
                }
            )

    report_meta = {
        "python3 developer/tests/ci/run_static_suite.py": {"path": STATIC_REPORT, "kind": "static"},
        "python3 developer/tests/e2e/suite_practice_flow.py": {"path": SUITE_REPORT, "kind": "suite"},
        "python3 developer/tests/ci/audit_pdf_checklist_and_mona.py": {"path": PDF_AUDIT_REPORT, "kind": "pdf_audit"},
        "python3 developer/tests/ci/check_reading_data_integrity.py": {
            "path": READING_INTEGRITY_REPORT,
            "kind": "reading_integrity",
        },
    }
    report_status_map = {
        command: infer_status_from_report(meta["path"], meta["kind"])
        for command, meta in report_meta.items()
    }
    report_freshness_map = {
        command: report_fresh_enough(meta["path"], checklist_mtime)
        for command, meta in report_meta.items()
    }

    claim_mismatch = []
    freshness_mismatch = []
    ignore_static_claim = os.environ.get(IGNORE_STATIC_CLAIM_ENV, "").strip().lower() in {"1", "true", "yes"}
    for command, claimed in claims.items():
        if ignore_static_claim and command == RUN_STATIC_COMMAND:
            continue
        observed = report_status_map.get(command)
        if observed is None:
            continue
        if observed != claimed:
            claim_mismatch.append({"command": command, "claimed": claimed, "observed": observed})
        fresh = report_freshness_map.get(command)
        if fresh is False:
            report_path = report_meta[command]["path"]
            freshness_mismatch.append(
                {
                    "command": command,
                    "report": str(report_path),
                    "reportMtime": format_iso_timestamp(report_path.stat().st_mtime if report_path.exists() else None),
                    "checklistMtime": format_iso_timestamp(checklist_mtime),
                }
            )

    result = {
        "summaryStatusCount": summary_status_count,
        "issueStatusCount": issue_status_count,
        "summaryMismatches": summary_mismatch,
        "claims": claims,
        "claimMismatches": claim_mismatch,
        "freshnessMismatches": freshness_mismatch,
        "reportFreshness": report_freshness_map,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 1 if (summary_mismatch or claim_mismatch or freshness_mismatch) else 0


if __name__ == "__main__":
    raise SystemExit(main())
