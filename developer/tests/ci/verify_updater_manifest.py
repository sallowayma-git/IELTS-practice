#!/usr/bin/env python3
"""Validate the updater manifest before a draft GitHub release is published."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse


REQUIRED_PLATFORM_PREFIXES = ("windows-", "linux-", "darwin-")


def validate_manifest(document: object, expected_version: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(document, dict):
        return ["updater manifest must be a JSON object"]

    version = str(document.get("version") or "").lstrip("v")
    if version != expected_version.lstrip("v"):
        errors.append(f"manifest version {version!r} does not match tag {expected_version!r}")

    platforms = document.get("platforms")
    if not isinstance(platforms, dict):
        return errors + ["updater manifest platforms must be an object"]

    keys = [str(key).lower() for key in platforms]
    for prefix in REQUIRED_PLATFORM_PREFIXES:
        if not any(key.startswith(prefix) for key in keys):
            errors.append(f"missing updater platform: {prefix.rstrip('-')}")

    for target, entry in platforms.items():
        if not isinstance(entry, dict):
            errors.append(f"platform {target} must be an object")
            continue
        signature = str(entry.get("signature") or "").strip()
        if len(signature) < 32:
            errors.append(f"platform {target} has no valid signature")
        url = str(entry.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            errors.append(f"platform {target} has an invalid download URL")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()

    path = Path(args.manifest)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"invalid updater manifest: {error}")
        return 1
    errors = validate_manifest(document, args.tag)
    if errors:
        print(json.dumps({"status": "failed", "errors": errors}, indent=2))
        return 1
    print(json.dumps({"status": "passed", "platforms": sorted(document["platforms"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
