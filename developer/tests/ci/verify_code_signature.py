#!/usr/bin/env python3
"""Verify Windows Authenticode or macOS code-signing/notarization evidence."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def find_candidates(target_root: Path, platform_name: str) -> list[Path]:
    bundle_dirs = sorted(path for path in target_root.glob("**/release/bundle") if path.is_dir())
    if platform_name == "windows":
        return sorted(
            path
            for bundle in bundle_dirs
            for path in bundle.rglob("*")
            if path.is_file() and path.name.lower().endswith((".exe", ".msi"))
        )
    apps = [
        path
        for bundle in bundle_dirs
        for path in bundle.rglob("*.app")
        if path.is_dir()
    ]
    dmgs = [
        path
        for bundle in bundle_dirs
        for path in bundle.rglob("*.dmg")
        if path.is_file()
    ]
    return sorted(set(apps + dmgs))


def resolve_signtool() -> str | None:
    direct = shutil.which("signtool.exe") or shutil.which("signtool")
    if direct:
        return direct
    program_files = Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)"))
    candidates = sorted(
        program_files.glob("Windows Kits/10/bin/*/x64/signtool.exe"),
        reverse=True,
    )
    return str(candidates[0]) if candidates else None


def commands_for(platform_name: str, path: Path, signtool: str | None) -> list[list[str]]:
    if platform_name == "windows":
        if not signtool:
            raise RuntimeError("signtool.exe is unavailable")
        return [[signtool, "verify", "/pa", "/all", "/v", str(path)]]
    if path.name.lower().endswith(".app"):
        return [
            ["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(path)],
            ["spctl", "--assess", "--type", "execute", "--verbose=4", str(path)],
        ]
    return [
        [
            "spctl",
            "--assess",
            "--type",
            "open",
            "--context",
            "context:primary-signature",
            "--verbose=4",
            str(path),
        ]
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=("windows", "macos"))
    parser.add_argument("--target-root", default=str(ROOT / "target"))
    parser.add_argument("--report", required=True)
    args = parser.parse_args()

    target_root = Path(args.target_root).resolve()
    candidates = find_candidates(target_root, args.platform)
    signtool = resolve_signtool() if args.platform == "windows" else None
    checks: list[dict[str, object]] = []
    errors: list[str] = []
    if not candidates:
        errors.append(f"no {args.platform} code-signing candidates found")

    for candidate in candidates:
        try:
            commands = commands_for(args.platform, candidate, signtool)
        except RuntimeError as error:
            errors.append(str(error))
            break
        for command in commands:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120,
                check=False,
            )
            output = "\n".join(
                part.strip() for part in (completed.stdout, completed.stderr) if part.strip()
            )
            checks.append(
                {
                    "artifact": str(candidate),
                    "command": command[0],
                    "exitCode": completed.returncode,
                    "output": output[-4000:],
                }
            )
            if completed.returncode != 0:
                errors.append(f"signature verification failed: {candidate}")

    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "failed" if errors else "passed",
        "platform": args.platform,
        "errors": errors,
        "checks": checks,
    }
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
