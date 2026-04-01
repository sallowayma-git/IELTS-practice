#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "assets" / "scripts" / "generate_reading_explanations_with_agent.py"
QUALITY_CHECK = ROOT / "developer" / "tests" / "ci" / "check_reading_explanation_quality.py"
EXPLANATION_DIR = ROOT / "assets" / "generated" / "reading-explanations"
DEFAULT_WORK_DIR = ROOT / "developer" / "tests" / "artifacts" / "reading-explanation-agent-batch"


def run(cmd: List[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(cmd, cwd=str(ROOT), text=True, capture_output=True)
    if check and completed.returncode != 0:
        raise RuntimeError(
            f"command failed: {' '.join(cmd)}\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}"
        )
    return completed


def load_blocking_report(scope: str) -> dict:
    completed = run(["python3", str(QUALITY_CHECK), "--scope", scope], check=False)
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"quality check produced no output\nSTDERR:\n{completed.stderr}")
    return json.loads(lines[-1])


def load_blocking_files(scope: str) -> List[str]:
    report = load_blocking_report(scope)
    return [item["file"] for item in report.get("blockingFiles") or []]


def load_changed_explanation_files() -> List[str]:
    completed = run(["git", "status", "--short", "--", "assets/generated/reading-explanations"], check=False)
    files = []
    for line in completed.stdout.splitlines():
        path = line[3:].strip()
        if path.endswith(".js") and not path.endswith("manifest.js"):
            files.append(path)
    return sorted(set(files))


def pick_next_recoverable_blocker(scope: str, skip_exam_ids: set[str] | None = None) -> str | None:
    skip_exam_ids = skip_exam_ids or set()
    report = load_blocking_report(scope)
    for item in report.get("blockingFiles") or []:
        exam_id = Path(item.get("file", "")).stem
        issues = [str(issue) for issue in (item.get("issues") or [])]
        if any("缺少对应 reading-exam 文件" in issue for issue in issues):
            continue
        if exam_id in skip_exam_ids:
            continue
        if exam_id:
            return exam_id
    return None


def is_file_blocking(path: str, scope: str) -> bool:
    return path in set(load_blocking_files(scope))


def extract_json_issues(text: str) -> List[str]:
    stripped = (text or "").strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end < start:
        return []
    try:
        payload = json.loads(stripped[start : end + 1])
    except json.JSONDecodeError:
        return []
    issues = payload.get("issues")
    if isinstance(issues, list):
        return [str(item) for item in issues if str(item).strip()]
    return []


def load_exam_blocking_issues(exam_id: str, scope: str) -> List[str]:
    report = load_blocking_report(scope)
    for item in report.get("blockingFiles") or []:
        if Path(item.get("file", "")).stem == exam_id:
            return [str(issue) for issue in item.get("issues") or []]
    return []


def cleanup_stray_opencode() -> None:
    completed = run(["ps", "-Ao", "pid=,ppid=,command="], check=False)
    for line in completed.stdout.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) < 3:
            continue
        pid_text, ppid_text, command = parts
        if "opencode run" not in command:
            continue
        try:
            pid = int(pid_text)
            ppid = int(ppid_text)
        except ValueError:
            continue
        if ppid == 1:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


def process_exam(exam_id: str, *, work_dir: Path, model: str, retries: int, translate_timeout: int, scope: str) -> bool:
    request_path = work_dir / "requests" / f"{exam_id}.json"
    response_path = work_dir / "responses" / f"{exam_id}.json"
    output_path = EXPLANATION_DIR / f"{exam_id}.js"
    rel_output = str(output_path.relative_to(ROOT))
    feedback_issues: List[str] = []

    def restore_snapshot(snapshot: str | None) -> None:
        if snapshot is None:
            if output_path.exists():
                output_path.unlink()
            return
        output_path.write_text(snapshot, encoding="utf-8")

    for attempt in range(1, retries + 1):
        snapshot_before_attempt = output_path.read_text(encoding="utf-8") if output_path.exists() else None
        cleanup_stray_opencode()
        run(["python3", str(GENERATOR), "prepare", exam_id, "--work-dir", str(work_dir), "--write-template"])
        translate_cmd = [
            "python3",
            str(GENERATOR),
            "translate",
            "--request",
            str(request_path),
            "--response",
            str(response_path),
            "--model",
            model,
            "--timeout",
            str(translate_timeout),
        ]
        for issue in feedback_issues[:12]:
            translate_cmd.extend(["--feedback", issue])
        translate = run(translate_cmd, check=False)
        if translate.returncode != 0:
            restore_snapshot(snapshot_before_attempt)
            feedback_issues = extract_json_issues(translate.stdout) or [
                f"translate 失败；必须只输出 JSON 并修复上轮问题。attempt={attempt}"
            ]
            print(f"[FAIL translate] {exam_id} attempt={attempt}")
            print(translate.stdout[-1200:])
            continue

        render = run(
            [
                "python3",
                str(GENERATOR),
                "render",
                exam_id,
                "--response",
                str(response_path),
                "--output",
                str(output_path),
            ],
            check=False,
        )
        if render.returncode != 0:
            restore_snapshot(snapshot_before_attempt)
            feedback_issues = extract_json_issues(render.stdout) or [
                f"render 失败；修复 answerKey/section.text 同步/占位文本。attempt={attempt}"
            ]
            print(f"[FAIL render] {exam_id} attempt={attempt}")
            print(render.stdout[-1200:])
            continue

        if output_path.exists() and not is_file_blocking(rel_output, scope):
            print(f"[PASS] {exam_id} attempt={attempt}")
            return True

        restore_snapshot(snapshot_before_attempt)
        feedback_issues = load_exam_blocking_issues(exam_id, scope) or [
            f"硬校验失败，按 issue 修复后重生。attempt={attempt}"
        ]
        print(f"[FAIL quality] {exam_id} attempt={attempt} -> retry with feedback")

    print(f"[GIVEUP] {exam_id}")
    return False


def verify_exam(exam_id: str, *, model: str, verify_timeout: int) -> bool:
    explanation_path = EXPLANATION_DIR / f"{exam_id}.js"
    if not explanation_path.exists():
        print(f"[VERIFY MISS] {exam_id} explanation file missing")
        return False
    verify = run(
        [
            "python3",
            str(GENERATOR),
            "verify",
            exam_id,
            "--input",
            str(explanation_path),
            "--model",
            model,
            "--timeout",
            str(verify_timeout),
        ],
        check=False,
    )
    if verify.returncode == 0:
        print(f"[VERIFY PASS] {exam_id}")
        return True
    print(f"[VERIFY FAIL] {exam_id}")
    print(verify.stdout[-1200:])
    if explanation_path.exists():
        explanation_path.unlink()
        print(f"[VERIFY DELETE] {exam_id} deleted for regeneration")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate blocking reading explanations with opencode")
    parser.add_argument("--model", default="opencode/qwen3.6-plus-free")
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--smart-verify", action="store_true")
    parser.add_argument("--scope", choices=["all", "changed"], default="changed")
    parser.add_argument("--max-cycles", type=int, default=1)
    parser.add_argument("--fail-cooldown-cycles", type=int, default=3)
    parser.add_argument("--translate-timeout", type=int, default=180)
    parser.add_argument("--verify-timeout", type=int, default=180)
    parser.add_argument("exam_ids", nargs="*")
    args = parser.parse_args()

    work_dir = Path(args.work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    passed: List[str] = []
    failed: List[str] = []
    processed_smart_verify: set[str] = set()
    cooling_failed: dict[str, int] = {}
    cycles = 0
    while cycles < max(args.max_cycles, 1):
        cycles += 1
        cooling_failed = {
            exam_id: ttl - 1
            for exam_id, ttl in cooling_failed.items()
            if ttl - 1 > 0
        }
        if args.exam_ids:
            exam_ids = list(args.exam_ids)
        else:
            blocking = load_blocking_files(args.scope)
            if blocking:
                recoverable = pick_next_recoverable_blocker(args.scope, set(cooling_failed))
                if not recoverable and cooling_failed:
                    # 所有 blocker 都在冷却窗口时，重置冷却，避免循环停住。
                    cooling_failed.clear()
                    recoverable = pick_next_recoverable_blocker(args.scope, set())
                exam_ids = [recoverable] if recoverable else []
            elif args.smart_verify:
                changed = load_changed_explanation_files()
                if args.limit > 0:
                    changed = changed[: args.limit]
                candidates = [Path(path).stem for path in changed if Path(path).stem not in processed_smart_verify]
                exam_ids = [candidates[0]] if candidates else []
            else:
                exam_ids = []

        if not exam_ids:
            break
        exam_id = exam_ids[0]

        if args.exam_ids or load_blocking_files(args.scope):
            ok = process_exam(
                exam_id,
                work_dir=work_dir,
                model=args.model,
                retries=max(args.retries, 1),
                translate_timeout=max(args.translate_timeout, 30),
                scope=args.scope,
            )
        else:
            ok = verify_exam(exam_id, model=args.model, verify_timeout=max(args.verify_timeout, 30))
            if not ok:
                ok = process_exam(
                    exam_id,
                    work_dir=work_dir,
                    model=args.model,
                    retries=max(args.retries, 1),
                    translate_timeout=max(args.translate_timeout, 30),
                    scope=args.scope,
                )
        (passed if ok else failed).append(exam_id)
        if not ok and not args.exam_ids:
            cooling_failed[exam_id] = max(args.fail_cooldown_cycles, 1)
        if args.smart_verify and not args.exam_ids:
            processed_smart_verify.add(exam_id)

    print(
        json.dumps(
            {
                "passed": passed,
                "failed": failed,
                "model": args.model,
                "smartVerify": args.smart_verify,
                "scope": args.scope,
                "cycles": cycles,
                "workDir": str(work_dir),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
