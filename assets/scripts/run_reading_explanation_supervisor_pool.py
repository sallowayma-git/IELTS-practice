#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


ROOT = Path(__file__).resolve().parents[2]
SINGLE_SUPERVISOR = ROOT / "assets" / "scripts" / "run_reading_explanation_opencode_batch.py"
QUALITY_CHECK = ROOT / "developer" / "tests" / "ci" / "check_reading_explanation_quality.py"
GENERATOR = ROOT / "assets" / "scripts" / "generate_reading_explanations_with_agent.py"
EXPLANATION_DIR = ROOT / "assets" / "generated" / "reading-explanations"


def run(cmd: List[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    cp = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
    if check and cp.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(cmd)}\nSTDOUT:\n{cp.stdout}\nSTDERR:\n{cp.stderr}")
    return cp


def load_report(scope: str) -> dict:
    cp = run(["python3", str(QUALITY_CHECK), "--scope", scope], check=False)
    lines = [line for line in cp.stdout.splitlines() if line.strip()]
    if not lines:
        return {"blockingFiles": [], "summary": {}}
    return json.loads(lines[-1])


def list_blockers(scope: str) -> List[str]:
    report = load_report(scope)
    exams: List[str] = []
    for item in report.get("blockingFiles") or []:
        exam_id = Path(item.get("file", "")).stem
        issues = [str(x) for x in (item.get("issues") or [])]
        if not exam_id:
            continue
        if any("缺少对应 reading-exam 文件" in issue for issue in issues):
            continue
        exams.append(exam_id)
    return exams


def is_blocking(exam_id: str, scope: str) -> bool:
    report = load_report(scope)
    return any(Path(item.get("file", "")).stem == exam_id for item in (report.get("blockingFiles") or []))


def kill_process_tree(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    time.sleep(1)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def cleanup_stray_opencode() -> None:
    run(["pkill", "-f", "generate_reading_explanations_with_agent.py translate"], check=False)
    run(["pkill", "-f", "opencode run --pure --agent compaction -m opencode/qwen3.6-plus-free"], check=False)


def verify_with_opencode(exam_id: str, model: str, timeout: int) -> bool:
    path = EXPLANATION_DIR / f"{exam_id}.js"
    if not path.exists():
        return False
    cp = run(
        [
            "python3",
            str(GENERATOR),
            "verify",
            exam_id,
            "--input",
            str(path),
            "--model",
            model,
            "--timeout",
            str(timeout),
        ],
        check=False,
    )
    if cp.returncode == 0:
        return True
    path.unlink(missing_ok=True)
    return False


@dataclass
class Worker:
    exam_id: str
    process: subprocess.Popen[str]
    start_ts: float
    attempts: int


def spawn_worker(exam_id: str, model: str, retries: int, translate_timeout: int, verify_timeout: int) -> subprocess.Popen[str]:
    cmd = [
        "python3",
        str(SINGLE_SUPERVISOR),
        "--scope",
        "all",
        "--retries",
        str(retries),
        "--translate-timeout",
        str(translate_timeout),
        "--verify-timeout",
        str(verify_timeout),
        "--model",
        model,
        exam_id,
    ]
    return subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Pool supervisor for reading explanations")
    parser.add_argument("--max-workers", type=int, default=3)
    parser.add_argument("--scope", choices=["all", "changed"], default="all")
    parser.add_argument("--model", default="opencode/qwen3.6-plus-free")
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--translate-timeout", type=int, default=180)
    parser.add_argument("--verify-timeout", type=int, default=180)
    parser.add_argument("--per-exam-timeout", type=int, default=240)
    parser.add_argument("--max-attempts-per-exam", type=int, default=8)
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    args = parser.parse_args()

    max_workers = max(1, args.max_workers)
    queue = deque(list_blockers(args.scope))
    attempts: Dict[str, int] = {exam_id: 0 for exam_id in queue}
    active: Dict[int, Worker] = {}
    done: set[str] = set()

    print(json.dumps({"event": "start", "blockers": len(queue), "maxWorkers": max_workers}, ensure_ascii=False))
    while True:
        while queue and len(active) < max_workers:
            exam_id = queue.popleft()
            if exam_id in done:
                continue
            if attempts.get(exam_id, 0) >= args.max_attempts_per_exam:
                print(json.dumps({"event": "giveup", "examId": exam_id, "attempts": attempts.get(exam_id, 0)}, ensure_ascii=False))
                done.add(exam_id)
                continue
            attempts[exam_id] = attempts.get(exam_id, 0) + 1
            proc = spawn_worker(exam_id, args.model, args.retries, args.translate_timeout, args.verify_timeout)
            active[proc.pid] = Worker(exam_id=exam_id, process=proc, start_ts=time.time(), attempts=attempts[exam_id])
            print(json.dumps({"event": "spawn", "examId": exam_id, "pid": proc.pid, "attempt": attempts[exam_id]}, ensure_ascii=False))

        if not active:
            blockers = list_blockers(args.scope)
            remaining = [x for x in blockers if x not in done]
            if not remaining:
                final = load_report(args.scope)
                print(json.dumps({"event": "done", "blocking": len(final.get("blockingFiles") or []), "summary": final.get("summary")}, ensure_ascii=False))
                return 0
            for exam_id in remaining:
                if exam_id not in queue:
                    queue.append(exam_id)
            continue

        time.sleep(max(args.poll_seconds, 0.5))
        for pid, worker in list(active.items()):
            elapsed = time.time() - worker.start_ts
            if elapsed > max(args.per_exam_timeout, args.translate_timeout + 20):
                print(json.dumps({"event": "timeout-kill", "examId": worker.exam_id, "pid": pid, "elapsed": round(elapsed, 1)}, ensure_ascii=False))
                kill_process_tree(pid)
                cleanup_stray_opencode()
                queue.append(worker.exam_id)
                del active[pid]
                continue

            code = worker.process.poll()
            if code is None:
                continue

            output = ""
            if worker.process.stdout:
                output = worker.process.stdout.read()[-1200:]
            pass_hard = (code == 0) and (not is_blocking(worker.exam_id, args.scope))
            pass_smart = pass_hard and verify_with_opencode(worker.exam_id, args.model, args.verify_timeout)
            if pass_smart:
                print(json.dumps({"event": "pass", "examId": worker.exam_id, "attempt": worker.attempts}, ensure_ascii=False))
                done.add(worker.exam_id)
            else:
                if output.strip():
                    print(json.dumps({"event": "retry", "examId": worker.exam_id, "attempt": worker.attempts, "tail": output}, ensure_ascii=False))
                queue.append(worker.exam_id)
            del active[pid]


if __name__ == "__main__":
    raise SystemExit(main())
