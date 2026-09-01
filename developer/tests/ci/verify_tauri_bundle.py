#!/usr/bin/env python3
"""Verify platform bundles and, for releases, signed updater artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform as host_platform
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REPORT = ROOT / "developer/tests/e2e/reports/tauri-bundle-manifest.json"


def normalize_platform(value: str) -> str:
    normalized = value.strip().lower()
    aliases = {
        "win32": "windows",
        "windows-latest": "windows",
        "darwin": "macos",
        "mac": "macos",
        "macos-latest": "macos",
        "linux": "linux",
        "ubuntu-22.04": "linux",
        "ubuntu-latest": "linux",
    }
    platform_name = aliases.get(normalized, normalized)
    if platform_name not in {"windows", "macos", "linux"}:
        raise ValueError(f"unsupported platform: {value}")
    return platform_name


def collect_files(target_root: Path) -> list[Path]:
    bundle_dirs = sorted(path for path in target_root.glob("**/release/bundle") if path.is_dir())
    return sorted(
        path
        for bundle_dir in bundle_dirs
        for path in bundle_dir.rglob("*")
        if path.is_file()
    )


def is_installable(path: Path, platform_name: str) -> bool:
    lower_name = path.name.lower()
    if platform_name == "windows":
        return lower_name.endswith((".exe", ".msi"))
    if platform_name == "linux":
        return lower_name.endswith((".appimage", ".deb", ".rpm"))
    return lower_name.endswith(".dmg")


def is_updater_archive(path: Path, platform_name: str) -> bool:
    lower_name = path.name.lower()
    if lower_name.endswith(".sig"):
        return False
    suffixes = {
        "windows": (".nsis.zip", ".msi.zip"),
        "macos": (".app.tar.gz",),
        "linux": (".appimage.tar.gz",),
    }
    return lower_name.endswith(suffixes[platform_name])


def verify_artifacts(
    files: list[Path],
    platform_name: str,
    require_updater: bool,
    require_signatures: bool,
) -> dict[str, object]:
    errors: list[str] = []
    if not files:
        errors.append("no Tauri bundle artifacts found")

    installables = [path for path in files if is_installable(path, platform_name)]
    if not installables:
        errors.append(f"no installable {platform_name} bundle found")

    updater_archives = [path for path in files if is_updater_archive(path, platform_name)]
    if require_updater and not updater_archives:
        errors.append(f"no {platform_name} updater archive found")

    publishable_artifacts = [*installables, *updater_archives]
    empty_artifacts = [str(path) for path in publishable_artifacts if path.stat().st_size == 0]
    if empty_artifacts:
        errors.append(f"zero-byte publishable artifacts: {empty_artifacts}")

    signatures: list[Path] = []
    missing_signatures: list[str] = []
    file_set = {path.resolve() for path in files}
    for archive in updater_archives:
        signature = Path(f"{archive}.sig")
        if signature.resolve() in file_set and signature.stat().st_size > 0:
            signatures.append(signature)
        elif require_signatures:
            missing_signatures.append(str(signature))
    if missing_signatures:
        errors.append(f"missing updater signatures: {missing_signatures}")

    return {
        "status": "failed" if errors else "passed",
        "errors": errors,
        "installables": [str(path) for path in installables],
        "updaterArchives": [str(path) for path in updater_archives],
        "signatures": [str(path) for path in signatures],
    }


def relative_or_absolute(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-root", default=str(ROOT / "target"))
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--platform", default=host_platform.system())
    parser.add_argument("--require-updater", action="store_true")
    parser.add_argument("--require-signatures", action="store_true")
    args = parser.parse_args()

    try:
        platform_name = normalize_platform(args.platform)
    except ValueError as error:
        parser.error(str(error))

    target_root = Path(args.target_root).resolve()
    report_path = Path(args.report).resolve()
    files = collect_files(target_root)
    verification = verify_artifacts(
        files,
        platform_name,
        args.require_updater or args.require_signatures,
        args.require_signatures,
    )

    artifacts = []
    for path in files:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        artifacts.append(
            {
                "path": relative_or_absolute(path),
                "size": path.stat().st_size,
                "sha256": digest.hexdigest(),
            }
        )

    report = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": verification["status"],
        "platform": platform_name,
        "targetRoot": str(target_root),
        "artifactCount": len(artifacts),
        "requiresUpdater": args.require_updater or args.require_signatures,
        "requiresSignatures": args.require_signatures,
        "verification": verification,
        "artifacts": artifacts,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if verification["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
