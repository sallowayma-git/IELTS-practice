#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
QUALITY_CHECK = ROOT / "developer" / "tests" / "ci" / "check_reading_explanation_quality.py"
DEFAULT_LOG = ROOT / "developer" / "tests" / "artifacts" / "reading-explanation-agent-batch" / "supervisor-status.log"


def run_quality(scope: str) -> dict:
    cp = subprocess.run(
        ["python3", str(QUALITY_CHECK), "--scope", scope],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    lines = [line for line in cp.stdout.splitlines() if line.strip()]
    if not lines:
        return {"error": "quality_no_output", "stderr": cp.stderr.strip()}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return {"error": "quality_json_decode", "tail": lines[-1]}


def count_process(pattern: str) -> int:
    cp = subprocess.run(
        ["bash", "-lc", f"ps -Ao command | rg -c -- '{pattern}' || true"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    text = (cp.stdout or "").strip()
    try:
        return int(text)
    except ValueError:
        return 0


def log_status(path: Path, scope: str) -> None:
    report = run_quality(scope)
    timestamp = dt.datetime.now().isoformat(timespec="seconds")
    payload = {
        "ts": timestamp,
        "scope": scope,
        "blocking": len(report.get("blockingFiles") or []) if isinstance(report, dict) else None,
        "summary": report.get("summary") if isinstance(report, dict) else None,
        "supervisorProc": count_process("run_reading_explanation_opencode_batch.py --scope all --max-cycles 1000"),
        "translatorProc": count_process("generate_reading_explanations_with_agent.py translate --request"),
        "opencodeProc": count_process("opencode run --pure --agent compaction -m opencode/qwen3.6-plus-free"),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Lightweight status monitor for reading explanation supervisor")
    parser.add_argument("--scope", choices=["all", "changed"], default="all")
    parser.add_argument("--interval-seconds", type=int, default=600)
    parser.add_argument("--log-file", default=str(DEFAULT_LOG))
    args = parser.parse_args()

    log_file = Path(args.log_file)
    interval = max(args.interval_seconds, 30)
    while True:
        log_status(log_file, args.scope)
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
