#!/usr/bin/env python3
"""Freeze the Python cognitive runtime into Tauri's target-named sidecar."""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import prepare_tauri_release
import verify_code_signature


ROOT = Path(__file__).resolve().parents[3]
SOURCE_ROOT = ROOT / "agent-runtime-python"
ENTRYPOINT = SOURCE_ROOT / "sidecar_entry.py"
BUILD_ROOT = ROOT / "target" / "agent-runtime-sidecar"
BINARIES = ROOT / "src-tauri" / "binaries"


@dataclass(frozen=True)
class SidecarSigning:
    platform: str
    identity: str
    tool: str
    timestamp_url: str = ""
    team_id: str = ""


def signing_configuration(enabled: bool) -> SidecarSigning | None:
    if not enabled:
        return None
    environment = dict(os.environ)
    if sys.platform == "win32":
        prepare_tauri_release.require_environment(
            environment, ("WINDOWS_CERTIFICATE_THUMBPRINT", "WINDOWS_TIMESTAMP_URL")
        )
        identity = environment["WINDOWS_CERTIFICATE_THUMBPRINT"].replace(" ", "").upper()
        if not re.fullmatch(r"[0-9A-F]{40}", identity):
            raise ValueError("WINDOWS_CERTIFICATE_THUMBPRINT must be a SHA-1 thumbprint")
        timestamp_url = prepare_tauri_release.validate_endpoint_like_url(
            environment["WINDOWS_TIMESTAMP_URL"], "WINDOWS_TIMESTAMP_URL"
        )
        tool = verify_code_signature.resolve_signtool()
        if not tool:
            raise ValueError("signtool.exe is unavailable")
        return SidecarSigning(sys.platform, identity, tool, timestamp_url)
    if sys.platform == "darwin":
        prepare_tauri_release.require_environment(
            environment, ("APPLE_SIGNING_IDENTITY", "APPLE_TEAM_ID")
        )
        tool = shutil.which("codesign")
        if not tool:
            raise ValueError("codesign is unavailable")
        return SidecarSigning(
            sys.platform,
            environment["APPLE_SIGNING_IDENTITY"].strip(),
            tool,
            team_id=environment["APPLE_TEAM_ID"].strip(),
        )
    raise ValueError("--sign is supported only for Windows and macOS sidecars")


def sign_and_verify_staged(binary: Path, signing: SidecarSigning) -> None:
    if signing.platform == "win32":
        subprocess.run(
            [
                signing.tool, "sign", "/fd", "sha256", "/sha1", signing.identity,
                "/t", signing.timestamp_url, str(binary),
            ],
            check=True,
        )
        subprocess.run([signing.tool, "verify", "/pa", "/all", str(binary)], check=True)
        return

    # PyInstaller signs every embedded library before assembling its onefile
    # archive. Signing only the finished executable would leave ad-hoc libraries
    # that macOS hardened-runtime library validation cannot load.
    subprocess.run([signing.tool, "--verify", "--strict", str(binary)], check=True)
    metadata = subprocess.run(
        [signing.tool, "--display", "--verbose=4", str(binary)],
        capture_output=True,
        text=True,
        check=True,
    )
    details = (metadata.stdout + "\n" + metadata.stderr).splitlines()
    # codesign accepts certificate hashes and partial names as identity selectors;
    # its Authority output is always the certificate's full name. Verify the
    # signed team instead of requiring the selector to equal that display name.
    if f"TeamIdentifier={signing.team_id}" not in details:
        raise RuntimeError("signed sidecar does not match APPLE_TEAM_ID")


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
    parser.add_argument("--sign", action="store_true", help="Sign release bytes before hashing and smoking")
    args = parser.parse_args()
    if args.target != host_target():
        raise SystemExit("Python sidecars must be frozen on the matching native target")
    try:
        signing = signing_configuration(args.sign)
    except ValueError as error:
        parser.error(str(error))

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
    ]
    if signing and signing.platform == "darwin":
        command.extend(["--codesign-identity", signing.identity])
    command.append(str(ENTRYPOINT))
    subprocess.run(command, cwd=ROOT, check=True)

    suffix = ".exe" if sys.platform == "win32" else ""
    source = dist / f"ielts-agent-runtime{suffix}"
    target = BINARIES / f"ielts-agent-runtime-{args.target}{suffix}"
    staged = BINARIES / f".ielts-agent-runtime-{args.target}.staged{suffix}"
    shutil.copy2(source, staged)
    if signing:
        sign_and_verify_staged(staged, signing)
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
