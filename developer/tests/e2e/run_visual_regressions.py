#!/usr/bin/env python3
"""Run the frozen Vue visual/state regressions against one preview server."""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DIST = ROOT / "dist/writing"
REPORTS = ROOT / "developer/tests/e2e/reports"
REPORT = REPORTS / "visual-regression-report.json"
EVIDENCE = REPORTS / "visual-ci-evidence"
BASE_URL_ENV_NAMES = (
    "AGENT_VISUAL_BASE_URL",
    "NAV_VISUAL_BASE_URL",
    "SETTINGS_VISUAL_BASE_URL",
    "TOPIC_VISUAL_BASE_URL",
    "HISTORY_VISUAL_BASE_URL",
    "WRITING_RESULT_VISUAL_BASE_URL",
    "READING_LIBRARY_VISUAL_BASE_URL",
    "READING_LIBRARY_TABS_VISUAL_BASE_URL",
    "READING_SUITE_SELECTOR_VISUAL_BASE_URL",
    "READING_CUSTOM_SUITE_VISUAL_BASE_URL",
    "READING_SUITE_VISUAL_BASE_URL",
    "READING_HISTORY_VISUAL_BASE_URL",
)

SCRIPT_GROUPS = (
    (
        "shell-route",
        (
            "agent_workspace_visual_check.py",
            "nav_responsive_visual_check.py",
            "settings_modal_visual_check.py",
            "topic_manage_visual_check.py",
        ),
    ),
    (
        "global-history",
        (
            "history_detail_visual_check.py",
            "history_batch_visual_check.py",
            "history_filter_analytics_visual_check.py",
            "history_record_pagination_visual_check.py",
            "history_page_states_visual_check.py",
        ),
    ),
    (
        "writing-result",
        (
            "writing_result_visual_check.py",
        ),
    ),
    (
        "reading-library",
        (
            "reading_library_surface_visual_check.py",
            "reading_library_tabs_visual_check.py",
            "reading_suite_selector_visual_check.py",
            "reading_custom_suite_visual_check.py",
        ),
    ),
    (
        "reading-session-history",
        (
            "reading_suite_visual_check.py",
            "reading_history_widget_visual_check.py",
            "reading_history_record_visual_check.py",
        ),
    ),
)


def free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_for_server(
    process: subprocess.Popen[bytes], base_url: str, timeout_seconds: int = 30
) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = "server did not answer"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"preview server exited with code {process.returncode}")
        try:
            with urllib.request.urlopen(base_url, timeout=1) as response:
                if response.status == 200:
                    time.sleep(0.1)
                    if process.poll() is not None:
                        raise RuntimeError(
                            f"preview server exited with code {process.returncode}"
                        )
                    return
                last_error = f"HTTP {response.status}"
        except (OSError, urllib.error.URLError) as error:
            last_error = str(error)
        time.sleep(0.25)
    raise RuntimeError(f"preview server was not ready after {timeout_seconds}s: {last_error}")


def stop_process(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def output_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def current_artifacts(started_ns: int) -> list[Path]:
    return sorted(
        path
        for path in REPORTS.glob("*-current.png")
        if path.is_file() and path.stat().st_mtime_ns >= started_ns
    )


def main() -> int:
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/writing is missing; run the Vue production build first")

    REPORTS.mkdir(parents=True, exist_ok=True)
    if EVIDENCE.exists():
        shutil.rmtree(EVIDENCE)
    EVIDENCE.mkdir(parents=True)
    started_ns = time.time_ns()
    port = free_tcp_port()
    base_url = f"http://127.0.0.1:{port}"
    server_log_path = EVIDENCE / "preview-server.log"
    process: subprocess.Popen[bytes] | None = None
    results: list[dict[str, object]] = []
    startup_error: str | None = None

    with server_log_path.open("wb") as server_log:
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "http.server",
                    str(port),
                    "--bind",
                    "127.0.0.1",
                    "--directory",
                    str(DIST),
                ],
                cwd=ROOT,
                stdout=server_log,
                stderr=subprocess.STDOUT,
            )
            wait_for_server(process, base_url)
            environment = os.environ.copy()
            environment["PYTHONUTF8"] = "1"
            for name in BASE_URL_ENV_NAMES:
                environment[name] = base_url
            for group, scripts in SCRIPT_GROUPS:
                for script_name in scripts:
                    script = Path(__file__).with_name(script_name)
                    script_started = time.monotonic()
                    try:
                        completed = subprocess.run(
                            [sys.executable, str(script)],
                            cwd=ROOT,
                            env=environment,
                            capture_output=True,
                            text=True,
                            encoding="utf-8",
                            errors="replace",
                            timeout=300,
                            check=False,
                        )
                        stdout = completed.stdout
                        stderr = completed.stderr
                        return_code = completed.returncode
                    except subprocess.TimeoutExpired as error:
                        stdout = output_text(error.stdout)
                        stderr = output_text(error.stderr) + "\nTimed out after 300 seconds."
                        return_code = 124
                    log_path = EVIDENCE / f"{script.stem}.log"
                    log_path.write_text(
                        f"stdout:\n{stdout}\n\nstderr:\n{stderr}\n",
                        encoding="utf-8",
                    )
                    result = {
                        "group": group,
                        "script": script_name,
                        "status": "passed" if return_code == 0 else "failed",
                        "exitCode": return_code,
                        "durationSeconds": round(time.monotonic() - script_started, 2),
                        "log": str(log_path.relative_to(ROOT)),
                    }
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False))
        except Exception as error:  # Startup failures still produce a report.
            startup_error = str(error)
        finally:
            stop_process(process)

    screenshots = current_artifacts(started_ns)
    for screenshot in screenshots:
        shutil.copy2(screenshot, EVIDENCE / screenshot.name)

    expected_count = sum(len(scripts) for _, scripts in SCRIPT_GROUPS)
    passed = (
        startup_error is None
        and len(results) == expected_count
        and all(result["status"] == "passed" for result in results)
    )
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if passed else "failed",
        "exitCode": 0 if passed else 1,
        "target": "vue-u1-u25-visual-state-regressions",
        "baseUrl": base_url,
        "expectedScripts": expected_count,
        "executedScripts": len(results),
        "startupError": startup_error,
        "scripts": results,
        "screenshots": [str((EVIDENCE / path.name).relative_to(ROOT)) for path in screenshots],
    }
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    REPORT.write_text(serialized, encoding="utf-8")
    (EVIDENCE / REPORT.name).write_text(serialized, encoding="utf-8")
    print(serialized)
    return report["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
