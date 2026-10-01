#!/usr/bin/env python3
"""Record unsigned native acceptance evidence without publishing a release."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

from verify_packaged_sidecar import exactly_one
from verify_reading_resources import verify_reading_resources


ROOT = Path(__file__).resolve().parents[3]
REPORT = ROOT / "developer/tests/e2e/reports/native-acceptance"


def source_metadata(target: str) -> dict[str, object]:
    def git_revision(ref: str) -> str:
        return subprocess.check_output(["git", "rev-parse", ref], cwd=ROOT, text=True).strip()

    return {
        "sourceCommit": git_revision("HEAD"),
        "sourceTree": git_revision("HEAD^{tree}"),
        "target": target,
        "host": platform.platform(),
        "architecture": platform.machine(),
        "python": platform.python_version(),
        "productionSigning": False,
        "updaterAcceptance": False,
        "installedApplicationAcceptance": False,
        "boundary": "Native unsigned build evidence only; production release acceptance remains separate.",
    }


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_deb() -> dict[str, object]:
    package = exactly_one(list((ROOT / "target").glob("*/release/bundle/deb/*.deb")), "Debian package")
    with tempfile.TemporaryDirectory(prefix="ielts-deb-acceptance-") as temporary:
        subprocess.run(["dpkg-deb", "--extract", str(package), temporary], check=True, timeout=180)
        host = exactly_one(list(Path(temporary).rglob("ielts-practice-tauri")), "packaged host")
        sidecar = host.with_name("ielts-agent-runtime")
        digest = sha256(sidecar)
        subprocess.run([str(host), "--verify-sidecar"], check=True, timeout=30)
        manifest = exactly_one(list(Path(temporary).rglob("reading/manifest.json")), "reading manifest")
        reading_resources = verify_reading_resources(manifest.parent)
        subprocess.run([
            sys.executable, str(ROOT / "developer/tests/ci/smoke_agent_runtime_sidecar.py"),
            "--target", "x86_64-unknown-linux-gnu", "--binary", str(sidecar),
            "--build-id", digest, "--report", str(REPORT / "deb-sidecar-smoke.json"),
        ], check=True, timeout=120)
        return {
            "status": "passed", "kind": "deb", "sidecarSha256": digest,
            "hostSha256": sha256(host), "artifactSha256": sha256(package),
            "identityStatus": "passed", "smokeStatus": "passed",
            "readingResources": reading_resources,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    source = commands.add_parser("source")
    source.add_argument("--target", required=True)
    commands.add_parser("deb")
    args = parser.parse_args()
    REPORT.mkdir(parents=True, exist_ok=True)
    if args.command == "source":
        result, filename = source_metadata(args.target), "source.json"
    else:
        result, filename = {"status": "failed"}, "packaged-sidecar.json"
        try:
            result = verify_deb()
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
            result["error"] = str(error)
    (REPORT / filename).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 1 if result.get("status") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
