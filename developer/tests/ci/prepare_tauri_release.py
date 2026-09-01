#!/usr/bin/env python3
"""Generate the Tauri release-only config overlay from validated public inputs."""
from __future__ import annotations

import argparse
import json
import os
import re
import tomllib
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_ENDPOINT = (
    "https://github.com/sallowayma-git/IELTS-practice/"
    "releases/latest/download/latest.json"
)


def validate_endpoint(value: str) -> str:
    endpoint = value.strip()
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("TAURI_UPDATE_ENDPOINT must be an HTTPS URL without credentials")
    if not parsed.path.endswith(".json"):
        raise ValueError("TAURI_UPDATE_ENDPOINT must point to a JSON manifest")
    return endpoint


def validate_pubkey(value: str) -> str:
    pubkey = value.strip()
    if not pubkey:
        raise ValueError("TAURI_UPDATER_PUBKEY is required for release builds")
    if len(pubkey) < 32:
        raise ValueError("TAURI_UPDATER_PUBKEY is too short")
    if "PRIVATE" in pubkey.upper():
        raise ValueError("TAURI_UPDATER_PUBKEY must not contain private key material")
    if any(character.isspace() for character in pubkey):
        raise ValueError("TAURI_UPDATER_PUBKEY must be a single encoded line")
    return pubkey


def build_overlay(endpoint: str, pubkey: str) -> dict[str, object]:
    return {
        "bundle": {"createUpdaterArtifacts": True},
        "plugins": {
            "updater": {
                "endpoints": [validate_endpoint(endpoint)],
                "pubkey": validate_pubkey(pubkey),
                "windows": {"installMode": "passive"},
            }
        },
    }


def require_environment(environment: dict[str, str], names: tuple[str, ...]) -> None:
    missing = [name for name in names if not environment.get(name, "").strip()]
    if missing:
        raise ValueError(f"missing release environment: {', '.join(missing)}")


def platform_bundle_overlay(
    platform_name: str,
    environment: dict[str, str],
) -> dict[str, object]:
    if platform_name == "linux":
        return {}
    if platform_name == "windows":
        require_environment(
            environment,
            (
                "WINDOWS_CERTIFICATE",
                "WINDOWS_CERTIFICATE_PASSWORD",
                "WINDOWS_CERTIFICATE_THUMBPRINT",
                "WINDOWS_TIMESTAMP_URL",
            ),
        )
        thumbprint = environment["WINDOWS_CERTIFICATE_THUMBPRINT"].replace(" ", "").upper()
        if not re.fullmatch(r"[0-9A-F]{40}", thumbprint):
            raise ValueError("WINDOWS_CERTIFICATE_THUMBPRINT must be a SHA-1 thumbprint")
        timestamp_url = validate_endpoint_like_url(
            environment["WINDOWS_TIMESTAMP_URL"],
            "WINDOWS_TIMESTAMP_URL",
        )
        return {
            "windows": {
                "allowDowngrades": False,
                "certificateThumbprint": thumbprint,
                "digestAlgorithm": "sha256",
                "timestampUrl": timestamp_url,
            }
        }
    if platform_name == "macos":
        require_environment(
            environment,
            (
                "APPLE_CERTIFICATE",
                "APPLE_CERTIFICATE_PASSWORD",
                "APPLE_SIGNING_IDENTITY",
                "APPLE_ID",
                "APPLE_PASSWORD",
                "APPLE_TEAM_ID",
            ),
        )
        return {
            "macOS": {
                "signingIdentity": environment["APPLE_SIGNING_IDENTITY"].strip(),
                "hardenedRuntime": True,
            }
        }
    raise ValueError(f"unsupported release platform: {platform_name}")


def validate_endpoint_like_url(value: str, name: str) -> str:
    endpoint = value.strip()
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError(f"{name} must be an HTTPS URL without credentials")
    return endpoint


def shipping_versions(root: Path) -> dict[str, str]:
    tauri_config = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    cargo_config = tomllib.loads((root / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    vue_package = json.loads(
        (root / "apps/writing-vue/package.json").read_text(encoding="utf-8")
    )
    return {
        "tauri": str(tauri_config.get("version") or ""),
        "cargo": str((cargo_config.get("package") or {}).get("version") or ""),
        "vue": str(vue_package.get("version") or ""),
    }


def validate_release_version(root: Path, tag: str) -> str:
    expected = tag.strip().removeprefix("v")
    if not expected:
        raise ValueError("release tag is required")
    versions = shipping_versions(root)
    mismatched = {name: version for name, version in versions.items() if version != expected}
    if mismatched:
        raise ValueError(
            f"shipping versions must match tag {tag}: {json.dumps(mismatched, sort_keys=True)}"
        )
    return expected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("TAURI_UPDATE_ENDPOINT", "").strip() or DEFAULT_ENDPOINT,
    )
    parser.add_argument(
        "--pubkey",
        default=os.environ.get("TAURI_UPDATER_PUBKEY", ""),
    )
    parser.add_argument("--require-signing-key", action="store_true")
    parser.add_argument("--tag")
    parser.add_argument("--platform", choices=("windows", "macos", "linux"))
    args = parser.parse_args()

    try:
        if args.require_signing_key and not os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "").strip():
            raise ValueError("TAURI_SIGNING_PRIVATE_KEY is required for release builds")
        if args.tag:
            validate_release_version(Path(__file__).resolve().parents[3], args.tag)
        overlay = build_overlay(args.endpoint, args.pubkey)
        if args.platform:
            overlay["bundle"].update(platform_bundle_overlay(args.platform, dict(os.environ)))
    except ValueError as error:
        parser.error(str(error))

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(overlay, indent=2) + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
