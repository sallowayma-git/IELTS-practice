#!/usr/bin/env python3
"""Unified E2E runner: reading / listening / suite / file:// submit / export-import flows."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_PATH = REPORT_DIR / "e2e-unified-report.json"
CASE_TIMEOUT_SECONDS = 180

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Keep this list the single source of truth for "full e2e" in CI and local runs.
# Prefer file://-capable scripts; do not require a temporary HTTP host.
E2E_CASES = [
    "browse_preference_toggle_flow.py",
    "reading_single_flow.py",
    "listening_practice_flow.py",
    "suite_practice_flow.py",
    "practice_submit_file_flow.py",
    "file_init_referrer_trap.py",
    "ui_export_import_click.py",
    "unified_submit_readonly_regression.py",
]


def _run_case(script_name: str) -> dict:
    script_path = REPO_ROOT / "developer" / "tests" / "e2e" / script_name
    if not script_path.exists():
        return {
            "name": script_name,
            "status": "fail",
            "exitCode": 1,
            "detail": "script missing",
        }

    try:
        case_env = os.environ.copy()
        case_env["PYTHONIOENCODING"] = "utf-8"
        case_env["PYTHONUTF8"] = "1"
        completed = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=case_env,
            timeout=CASE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return {
            "name": script_name,
            "status": "fail",
            "exitCode": 124,
            "detail": f"timeout after {CASE_TIMEOUT_SECONDS} seconds",
        }
    return {
        "name": script_name,
        "status": "pass" if completed.returncode == 0 else "fail",
        "exitCode": completed.returncode,
        "stdout": (completed.stdout or "").strip()[-4000:],
        "stderr": (completed.stderr or "").strip()[-2000:],
    }


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now(timezone.utc)
    cases = [_run_case(name) for name in E2E_CASES]
    all_passed = all(item["status"] == "pass" for item in cases)

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "durationSeconds": (datetime.now(timezone.utc) - started_at).total_seconds(),
        "status": "pass" if all_passed else "fail",
        "cases": cases,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
