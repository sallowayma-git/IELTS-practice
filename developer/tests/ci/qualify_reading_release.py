#!/usr/bin/env python3
"""Build and qualify an extracted runtime package at a recorded clean revision."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
import zipfile


ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / "developer/tests/e2e/reports/reading-release-package"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, encoding="utf-8").strip()


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(command: list[str], log_name: str, env: dict[str, str] | None = None) -> None:
    print(f"Running: {subprocess.list2cmdline(command)}", flush=True)
    with (REPORTS / log_name).open("wb") as log:
        subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)


def main() -> int:
    REPORTS.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "startedAt": datetime.now(timezone.utc).isoformat(),
              "platform": sys.platform, "python": sys.version.split()[0]}
    report_path = REPORTS / "qualification.json"
    try:
        report["headSha"] = git("rev-parse", "HEAD")
        report["reviewedHeadSha"] = os.environ.get("READING_RELEASE_REVIEWED_HEAD_SHA") or report["headSha"]
        report["baseSha"] = os.environ.get("READING_RELEASE_BASE_SHA") or git("merge-base", "HEAD", "origin/opensource")
        report["workingTreeChanges"] = git("status", "--porcelain")
        if report["workingTreeChanges"]:
            raise RuntimeError("Commit source and test changes before qualifying a release revision.")
        report["node"] = subprocess.check_output(["node", "--version"], text=True).strip()
        tracked_paths = set(git("ls-files", "-z").split("\0"))
        version = f"reading-v1-{report['headSha'][:12]}"
        report["version"] = version
        if os.name == "nt":
            shell = shutil.which("pwsh") or shutil.which("powershell")
            if not shell:
                raise RuntimeError("PowerShell is required for Windows release packaging.")
            build = [shell, "-NoProfile", "-File", "developer/release.ps1", version]
        else:
            build = ["bash", "developer/release.sh", version]
        report["buildCommand"] = build
        # Keep this the redistributable default package; local listening sources
        # are not needed for the intensive-reading qualification fixture.
        environment = dict(os.environ, INCLUDE_LOCAL_LISTENING="0")
        run(build, "build.log", environment)
        run(["node", "scripts/build-bundles.mjs", "--check"], "bundles.log")
        if git("status", "--porcelain"):
            raise RuntimeError("Release build changed tracked files; regenerate and commit bundles first.")
        archive_path = ROOT / f"dist/ielts-practice-{version}.zip"
        report["archive"] = archive_path.relative_to(ROOT).as_posix()
        report["archiveSha256"] = digest(archive_path)
        report["archiveBytes"] = archive_path.stat().st_size
        # Every invocation starts from a fresh extraction with no development
        # files, source fallback, pre-existing browser state, or test fixtures.
        with tempfile.TemporaryDirectory(prefix="extracted-", dir=REPORTS) as temporary:
            extracted = Path(temporary).resolve()
            manifest = []
            with zipfile.ZipFile(archive_path) as archive:
                for entry in archive.infolist():
                    target = (extracted / entry.filename).resolve()
                    if not target.is_relative_to(extracted):
                        raise RuntimeError(f"Archive entry escapes extraction root: {entry.filename}")
                    if entry.is_dir():
                        continue
                    if entry.filename not in tracked_paths:
                        raise RuntimeError(f"Untracked runtime asset cannot qualify a Git revision: {entry.filename}")
                    archive.extract(entry, extracted)
                    source = (ROOT / entry.filename).resolve()
                    if not source.is_relative_to(ROOT) or not source.is_file():
                        raise RuntimeError(f"Archive entry has no source: {entry.filename}")
                    checksum = digest(target)
                    if checksum != digest(source):
                        raise RuntimeError(f"Packaged bytes differ from source: {entry.filename}")
                    manifest.append({"path": entry.filename, "sha256": checksum, "bytes": entry.file_size})
            report["matchedSourceFiles"] = len(manifest)
            (REPORTS / "asset-manifest.json").write_text(
                json.dumps(sorted(manifest, key=lambda row: row["path"]), indent=2) + "\n", encoding="utf-8")
            report["assetManifestSha256"] = digest(REPORTS / "asset-manifest.json")
            environment.update(READING_RELEASE_ROOT=str(extracted),
                               READING_RELEASE_REPORT_DIR=str(REPORTS),
                               READING_RELEASE_LABEL="package")
            command = ["node", "developer/tests/e2e/reading_txt_release.node.js"]
            report["browserCommand"] = command
            run(command, "browser.log", environment)
        if git("rev-parse", "HEAD") != report["headSha"] or git("status", "--porcelain"):
            raise RuntimeError("The tested revision changed during release qualification.")
        report["status"] = "pass"
    except Exception as error:
        report["status"] = "fail"
        report["error"] = str(error)
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
