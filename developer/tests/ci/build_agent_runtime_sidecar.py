#!/usr/bin/env python3
"""Freeze the Python cognitive runtime into Tauri's target-named sidecar."""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SOURCE_ROOT = ROOT / "agent-runtime-python"
ENTRYPOINT = SOURCE_ROOT / "sidecar_entry.py"
BUILD_ROOT = ROOT / "target" / "agent-runtime-sidecar"
BINARIES = ROOT / "src-tauri" / "binaries"


def host_target() -> str:
    machine = platform.machine().casefold()
    if sys.platform == "win32" and machine in {"amd64", "x86_64"}:
        return "x86_64-pc-windows-msvc"
    if sys.platform == "darwin" and machine in {"arm64", "aarch64"}:
        return "aarch64-apple-darwin"
    if sys.platform.startswith("linux") and machine in {"amd64", "x86_64"}:
        return "x86_64-unknown-linux-gnu"
    raise SystemExit(f"unsupported sidecar build host: {sys.platform}/{machine}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=host_target())
    args = parser.parse_args()
    if args.target != host_target():
        raise SystemExit("Python sidecars must be frozen on the matching native target")

    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    BINARIES.mkdir(parents=True, exist_ok=True)
    dist = BUILD_ROOT / "dist"
    work = BUILD_ROOT / "work"
    spec = BUILD_ROOT / "spec"
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--exclude-module",
        "numpy",
        "--exclude-module",
        "PIL",
        "--exclude-module",
        "rich",
        "--exclude-module",
        "pygments",
        "--exclude-module",
        "setuptools",
        "--exclude-module",
        "tkinter",
        "--exclude-module",
        "matplotlib",
        "--exclude-module",
        "pandas",
        "--exclude-module",
        "scipy",
        "--name",
        "ielts-agent-runtime",
        "--paths",
        str(SOURCE_ROOT / "src"),
        "--distpath",
        str(dist),
        "--workpath",
        str(work),
        "--specpath",
        str(spec),
        str(ENTRYPOINT),
    ]
    subprocess.run(command, cwd=ROOT, check=True)

    suffix = ".exe" if sys.platform == "win32" else ""
    source = dist / f"ielts-agent-runtime{suffix}"
    target = BINARIES / f"ielts-agent-runtime-{args.target}{suffix}"
    staged = BINARIES / f".ielts-agent-runtime-{args.target}.staged{suffix}"
    shutil.copy2(source, staged)
    digest = hashlib.sha256(staged.read_bytes()).hexdigest()
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "developer/tests/ci/smoke_agent_runtime_sidecar.py"),
            "--target",
            args.target,
            "--binary",
            str(staged),
            "--build-id",
            digest,
        ],
        cwd=ROOT,
        check=True,
    )
    try:
        os.replace(staged, target)
    except PermissionError:
        # Antivirus/indexers can briefly hold the old Windows EXE. copy2 still
        # truncates and replaces its bytes; the hash is written only after the
        # already-smoked staged artifact reaches the final path.
        shutil.copy2(staged, target)
        staged.unlink()
    hash_path = BINARIES / f"ielts-agent-runtime-{args.target}.sha256"
    hash_path.write_text(f"{digest}\n", encoding="ascii")
    if sys.platform != "win32":
        target.chmod(target.stat().st_mode | 0o111)
    print(f"built {target.relative_to(ROOT)} sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
