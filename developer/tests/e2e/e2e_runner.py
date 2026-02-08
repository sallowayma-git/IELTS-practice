#!/usr/bin/env python3
"""Unified E2E runner: execute reading + suite flows in one entrypoint."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_PATH = REPORT_DIR / "e2e-unified-report.json"


def _run_case(script_name: str) -> dict:
    script_path = REPO_ROOT / "developer" / "tests" / "e2e" / script_name
    if not script_path.exists():
        return {
            "name": script_name,
            "status": "fail",
            "exitCode": 1,
            "detail": "script missing",
        }

    completed = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    return {
        "name": script_name,
        "status": "pass" if completed.returncode == 0 else "fail",
        "exitCode": completed.returncode,
        "stdout": (completed.stdout or "").strip(),
        "stderr": (completed.stderr or "").strip(),
    }


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now(timezone.utc)
    cases = [
        _run_case("browse_preference_toggle_flow.py"),
        _run_case("reading_single_flow.py"),
        _run_case("suite_practice_flow.py"),
    ]
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
