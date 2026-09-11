#!/usr/bin/env python3
"""Verify the host identity and smoke the sidecar from final signed bundles."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from verify_reading_resources import verify_reading_resources


ROOT = Path(__file__).resolve().parents[3]
SMOKE = ROOT / "developer/tests/ci/smoke_agent_runtime_sidecar.py"
TARGETS = {"windows": "x86_64-pc-windows-msvc", "macos": "aarch64-apple-darwin"}


def exactly_one(paths: list[Path], description: str) -> Path:
    if len(paths) != 1:
        raise ValueError(f"expected exactly one {description}, found {len(paths)}: {paths}")
    return paths[0]


def discover_artifacts(target_root: Path, platform: str) -> list[tuple[str, Path]]:
    bundle_roots = [target_root / "release/bundle", *target_root.glob("*/release/bundle")]
    if platform == "macos":
        apps = sorted(path for bundle in bundle_roots for path in bundle.glob("macos/*.app") if path.is_dir())
        return [("app", exactly_one(apps, "macOS application bundle"))]
    if platform != "windows":
        raise ValueError(f"unsupported packaged sidecar platform: {platform}")
    return [
        (kind, exactly_one(sorted(path for bundle in bundle_roots for path in bundle.glob(pattern) if path.is_file()), kind))
        for kind, pattern in (
            ("msi", "msi/*.msi"),
            ("nsis", "nsis/*.exe"),
        )
    ]


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stop_process_tree(process: subprocess.Popen) -> None:
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False,
            )
        else:
            os.killpg(process.pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass
    if process.poll() is None:
        process.kill()
    try:
        process.communicate(timeout=10)
    finally:
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()


def run_checked(command: list[str], timeout: int) -> None:
    group = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if sys.platform == "win32" else {"start_new_session": True}
    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", **group,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_process_tree(process)
        raise
    if process.returncode:
        detail = "\n".join((stdout or "", stderr or ""))[-2000:].strip()
        raise RuntimeError(f"{Path(command[0]).name} exited {process.returncode}: {detail}")


def extract_windows(artifact: Path, kind: str, destination: Path) -> None:
    if kind == "msi":
        run_checked(["msiexec.exe", "/a", str(artifact), "/qn", f"TARGETDIR={destination}"], 180)
        return
    seven_zip = shutil.which("7z") or shutil.which("7z.exe")
    if not seven_zip:
        raise RuntimeError("7-Zip is required to extract the NSIS installer")
    run_checked([seven_zip, "x", "-y", f"-o{destination}", str(artifact)], 180)


def find_pair(directory: Path, platform: str) -> tuple[Path, Path]:
    suffix = ".exe" if platform == "windows" else ""
    hosts = sorted(path for path in directory.rglob(f"ielts-practice-tauri{suffix}") if path.is_file())
    host = exactly_one(hosts, "packaged host executable")
    sidecars = sorted(path for path in directory.rglob(f"ielts-agent-runtime{suffix}") if path.is_file())
    sidecar = exactly_one(sidecars, "packaged sidecar executable")
    if sidecar.parent != host.parent:
        raise ValueError("packaged sidecar is not beside the host executable")
    return host, sidecar


def verify_pair(directory: Path, platform: str, smoke_report: Path) -> dict[str, object]:
    host, sidecar = find_pair(directory, platform)
    digest = sha256(sidecar)
    result: dict[str, object] = {
        "application": str(host), "applicationSha256": sha256(host),
        "sidecar": str(sidecar), "sidecarSha256": digest,
        "smokeReport": str(smoke_report), "identityStatus": "pending", "status": "failed",
    }
    try:
        run_checked([str(host), "--verify-sidecar"], 30)
        result["identityStatus"] = "passed"
        resources = host.parent if platform == "windows" else host.parent.parent / "Resources"
        result["readingResources"] = verify_reading_resources(resources / "reading")
        run_checked([
            sys.executable, str(SMOKE), "--target", TARGETS[platform],
            "--binary", str(sidecar), "--build-id", digest, "--report", str(smoke_report),
        ], 120)
        result["status"] = "passed"
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        result["error"] = str(error)
    return result


def verify_artifact(kind: str, artifact: Path, platform: str, smoke_report: Path) -> dict[str, object]:
    result: dict[str, object] = {"kind": kind, "artifact": str(artifact), "status": "failed"}
    try:
        if platform == "macos":
            result.update(verify_pair(artifact / "Contents/MacOS", platform, smoke_report))
            return result
        result["artifactSha256"] = sha256(artifact)
        with tempfile.TemporaryDirectory(prefix="ielts-packaged-sidecar-") as temporary:
            directory = Path(temporary)
            extract_windows(artifact, kind, directory)
            result.update(verify_pair(directory, platform, smoke_report))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result.update(status="failed", error=str(error))
    return result


def verify(target_root: Path, platform: str, report_path: Path) -> dict[str, object]:
    report: dict[str, object] = {
        "schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(),
        "platform": platform, "targetRoot": str(target_root), "status": "failed",
        "artifacts": [], "errors": [],
    }
    try:
        artifacts = discover_artifacts(target_root, platform)
    except (OSError, ValueError) as error:
        report["errors"] = [str(error)]
        return report
    results = [
        verify_artifact(kind, artifact, platform, report_path.with_name(f"{report_path.stem}-{kind}-smoke.json"))
        for kind, artifact in artifacts
    ]
    report["artifacts"] = results
    report["errors"] = [result.get("error", "packaged sidecar verification failed") for result in results if result["status"] != "passed"]
    report["status"] = "failed" if report["errors"] else "passed"
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=TARGETS)
    parser.add_argument("--target-root", type=Path, default=ROOT / "target")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report_path = args.report.resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = verify(args.target_root.resolve(), args.platform, report_path)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
