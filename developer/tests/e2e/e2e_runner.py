#!/usr/bin/env python3
"""Unified E2E runner: reading / listening / suite / file:// submit / export-import flows."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
REPORT_PATH = REPORT_DIR / "e2e-unified-report.json"
CASE_TIMEOUT_SECONDS = 180
PROCESS_CLEANUP_TIMEOUT_SECONDS = 5
REPORT_REPLACE_ATTEMPTS = 10
REPORT_REPLACE_RETRY_SECONDS = 0.1

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Keep this list the single source of truth for "full e2e" in CI and local runs.
# Prefer file://-capable scripts; do not require a temporary HTTP host.
E2E_CASES = [
    "browse_preference_toggle_flow.py",
    "reading_single_flow.py",
    "reading_reader_isolation.py",
    "reading_reader_occurrences.py",
    "reading_bookshelf_entrypoints.py",
    "reading_txt_release.py",
    "interrupted_history_flow.py",
    "listening_practice_flow.py",
    "suite_practice_flow.py",
    "practice_submit_file_flow.py",
    "file_init_referrer_trap.py",
    "ui_export_import_click.py",
    "unified_submit_readonly_regression.py",
]


def _terminate_process_tree(process: subprocess.Popen) -> list[str]:
    """Stop the case and its Playwright/Node/browser descendants with bounded waits."""
    errors = []
    try:
        if os.name == "nt":
            # Kill descendants while their parent is still present for taskkill's
            # tree lookup. Never capture pipes that a descendant could keep open.
            killed = subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=PROCESS_CLEANUP_TIMEOUT_SECONDS,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            if killed.returncode:
                errors.append(f"taskkill exited with code {killed.returncode}")
        else:
            # The case starts a new session, so its process group includes its
            # descendants even if the original Python process exits first.
            os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"process tree cleanup failed: {exc}")

    try:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=PROCESS_CLEANUP_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired) as exc:
        errors.append(f"case process cleanup failed: {exc}")
    return errors


def _output_tail(path: Path, limit: int) -> str:
    # Reports stay compact; the separate artifacts retain the entire output.
    with path.open("rb") as output:
        output.seek(0, os.SEEK_END)
        output.seek(max(0, output.tell() - limit * 4))
        return output.read().decode("utf-8", errors="replace").strip()[-limit:]


def _run_case(script_name: str) -> dict:
    started_at = datetime.now(timezone.utc)
    started_clock = time.monotonic()
    script_path = REPO_ROOT / "developer" / "tests" / "e2e" / script_name
    output_dir = REPORT_DIR / "cases"
    output_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = output_dir / f"{Path(script_name).stem}.stdout.log"
    stderr_path = output_dir / f"{Path(script_name).stem}.stderr.log"
    result = {
        "name": script_name,
        "status": "fail",
        "exitCode": 1,
        "startedAt": started_at.isoformat(),
        "stdoutPath": stdout_path.relative_to(REPO_ROOT).as_posix(),
        "stderrPath": stderr_path.relative_to(REPO_ROOT).as_posix(),
    }
    case_env = os.environ.copy()
    case_env.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1", PYTHONUNBUFFERED="1")
    # Files avoid communicate() waiting forever for pipe EOF when a timed-out
    # Python process leaves a Node driver or browser holding its output open.
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        if not script_path.is_file():
            result["detail"] = "script missing"
        else:
            try:
                process = subprocess.Popen(
                    [sys.executable, "-u", str(script_path)],
                    cwd=str(REPO_ROOT),
                    stdout=stdout,
                    stderr=stderr,
                    env=case_env,
                    start_new_session=os.name != "nt",
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                )
                try:
                    result["exitCode"] = process.wait(timeout=CASE_TIMEOUT_SECONDS)
                    result["status"] = "pass" if result["exitCode"] == 0 else "fail"
                except subprocess.TimeoutExpired:
                    result["exitCode"] = 124
                    result["detail"] = f"timeout after {CASE_TIMEOUT_SECONDS} seconds"
                    cleanup_errors = _terminate_process_tree(process)
                    if cleanup_errors:
                        result["cleanupErrors"] = cleanup_errors
                except BaseException:
                    _terminate_process_tree(process)
                    raise
            except OSError as exc:
                result["detail"] = f"could not run script: {exc}"
        if result.get("detail"):
            stderr.write((result["detail"] + "\n").encode("utf-8"))
    result.update(
        finishedAt=datetime.now(timezone.utc).isoformat(),
        durationSeconds=round(time.monotonic() - started_clock, 3),
        stdout=_output_tail(stdout_path, 4000),
        stderr=_output_tail(stderr_path, 2000),
    )
    return result


def _write_report(started_at: datetime, started_clock: float, cases: list[dict], status: str) -> dict:
    report = {
        "startedAt": started_at.isoformat(),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "durationSeconds": round(time.monotonic() - started_clock, 3),
        "status": status,
        "plannedCases": len(E2E_CASES),
        "completedCases": sum(item["status"] != "running" for item in cases),
        "cases": cases,
    }
    # An interrupted write must not destroy the last completed case's report.
    temporary_path = REPORT_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for attempt in range(REPORT_REPLACE_ATTEMPTS):
        try:
            temporary_path.replace(REPORT_PATH)
            break
        except PermissionError:
            # Windows readers or antivirus scanners can briefly block rename.
            # Preserve the last report and propagate a persistent write failure.
            if attempt == REPORT_REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(REPORT_REPLACE_RETRY_SECONDS)
    return report


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc)
    started_clock = time.monotonic()
    cases = []
    _write_report(started_at, started_clock, cases, "running")
    for index, name in enumerate(E2E_CASES, start=1):
        case_started_at = datetime.now(timezone.utc).isoformat()
        cases.append({"name": name, "status": "running", "startedAt": case_started_at})
        _write_report(started_at, started_clock, cases, "running")
        print(f"[{index}/{len(E2E_CASES)}] START {name} at {case_started_at}", flush=True)
        result = _run_case(name)
        cases[-1] = result
        _write_report(started_at, started_clock, cases, "running")
        print(
            f"[{index}/{len(E2E_CASES)}] END {name}: {result['status'].upper()} "
            f"in {result['durationSeconds']:.3f}s (exit {result['exitCode']})",
            flush=True,
        )
        if result["status"] != "pass":
            print(result.get("detail") or result["stderr"] or result["stdout"], flush=True)
        print(f"  stdout: {result['stdoutPath']}\n  stderr: {result['stderrPath']}", flush=True)
    all_passed = all(item["status"] == "pass" for item in cases)
    report = _write_report(started_at, started_clock, cases, "pass" if all_passed else "fail")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
