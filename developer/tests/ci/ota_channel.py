#!/usr/bin/env python3
"""Build OTA content packs and the channel manifest (`ota.json`).

The client trusts only the updater key: `ota.json` is signed with
`tauri signer sign`, and each pack's sha256 lives inside it. Everything here
is deterministic so the same input always yields the same bytes.

  pack      build content-<id>-<version>.tar.gz from a pack directory
  manifest  merge app release info and/or packs into the channel manifest
  stamp-bundled / add-mirror   release-build helpers

Pack versions are UTC timestamps (YYYYMMDDHHMM), shared with the
`ota-pack.json` markers of the packs bundled in the app.

Examples:
  python developer/tests/ci/ota_channel.py pack --id reading \\
      --source assets/resource-pack/reading --version 202611021530 --out dist/ota
  python developer/tests/ci/ota_channel.py manifest --previous dist/ota/previous.json \\
      --pack dist/ota/content-reading-202611021530.json --out dist/ota/ota.json
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))

SCHEMA_VERSION = 1
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
MARKER_FILE = "ota-pack.json"
KNOWN_SLOTS = {"reading", "writing-topics"}
POLICY_PATH = ROOT / "src-tauri/ota/release-policy.json"


def semver_key(value: str) -> tuple:
    core, _, pre = value.split("+", 1)[0].partition("-")
    major, minor, patch = (int(part) for part in core.split("."))
    # A release orders after any of its prereleases.
    return (major, minor, patch, pre == "", pre)


def require_semver(value: str, name: str) -> str:
    value = value.strip().removeprefix("v")
    if not SEMVER.match(value):
        raise ValueError(f"{name} must be semver, got {value!r}")
    return value


def require_https(url: str, name: str) -> str:
    if not url.startswith("https://") or "@" in url.split("/")[2] or any(c.isspace() for c in url):
        raise ValueError(f"{name} must be an https URL without credentials")
    return url


# ------------------------------------------------------------------ packs

def exam_ids(directory: Path) -> set[str]:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    return {entry["examId"] for entry in manifest["entries"]}


def validate_slot(pack_id: str, source: Path, baseline: Path | None) -> None:
    if pack_id == "reading":
        from verify_reading_resources import verify_reading_resources

        verify_reading_resources(source)
        if baseline is not None:
            missing = exam_ids(baseline) - exam_ids(source)
            if missing:
                raise ValueError(f"reading pack drops existing exams: {sorted(missing)[:5]}")
    elif pack_id == "writing-topics":
        catalogs = list(source.glob("*.catalog.json"))
        if [path.name for path in catalogs] != ["bc-task2-2024-12_2025-01.catalog.json"]:
            raise ValueError("writing-topics pack must contain exactly bc-task2-2024-12_2025-01.catalog.json")
        if not json.loads(catalogs[0].read_text(encoding="utf-8")).get("topics"):
            raise ValueError("writing catalog has no topics")
    else:
        raise ValueError(f"unknown content slot {pack_id!r}; the app loads {sorted(KNOWN_SLOTS)}")


def deterministic_tar_gz(source: Path, marker: dict) -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tar:
        def add(name: str, data: bytes) -> None:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))

        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"symlinks are not allowed in packs: {path}")
            relative = path.relative_to(source).as_posix()
            if path.is_file() and relative != MARKER_FILE:
                add(relative, path.read_bytes())
        add(MARKER_FILE, (json.dumps(marker, sort_keys=True) + "\n").encode("utf-8"))
    out = io.BytesIO()
    with gzip.GzipFile(fileobj=out, mode="wb", mtime=0, compresslevel=9) as gz:
        gz.write(raw.getvalue())
    return out.getvalue()


def build_pack(
    pack_id: str,
    source: Path,
    version: int,
    out: Path,
    *,
    min_app_version: str | None = None,
    title: str | None = None,
    notes: str | None = None,
    baseline: Path | None = None,
) -> dict:
    if not SAFE_NAME.match(pack_id):
        raise ValueError(f"invalid pack id {pack_id!r}")
    if version <= 0:
        raise ValueError("pack version must be positive")
    validate_slot(pack_id, source, baseline)
    marker = {"id": pack_id, "version": version}
    if min_app_version:
        marker["minAppVersion"] = require_semver(min_app_version, "minAppVersion")
    data = deterministic_tar_gz(source, marker)
    out.mkdir(parents=True, exist_ok=True)
    file_name = f"content-{pack_id}-{version}.tar.gz"
    (out / file_name).write_bytes(data)
    entry = {
        "id": pack_id,
        "version": version,
        "file": file_name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    }
    for key, value in (("minAppVersion", marker.get("minAppVersion")), ("title", title), ("notes", notes)):
        if value:
            entry[key] = value
    (out / f"content-{pack_id}-{version}.json").write_text(json.dumps(entry, indent=2) + "\n", encoding="utf-8")
    return entry


# ------------------------------------------------------------------ manifest

def load_policy(path: Path = POLICY_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def compose_manifest(
    previous: dict | None,
    *,
    app_version: str | None = None,
    notes: str | None = None,
    policy: dict | None = None,
    packs: list[dict] = (),
    channel: str = "stable",
    now: str | None = None,
) -> dict:
    """Merge into the previous manifest: packs replace same-id packs, an app
    release replaces the app section. Nothing ever moves backwards."""
    previous = previous or {}
    app = dict(previous.get("app") or {})
    if app_version:
        version = require_semver(app_version, "app version")
        if app.get("version") and semver_key(version) < semver_key(app["version"]):
            raise ValueError(f"app version {version} is older than published {app['version']}")
        policy = policy or {}
        app = {"version": version}
        for key in ("minOtaVersion", "minSupportedVersion"):
            if policy.get(key):
                floor = require_semver(policy[key], key)
                if semver_key(floor) > semver_key(version):
                    raise ValueError(f"{key} {floor} is newer than the release {version}")
                app[key] = floor
        if notes:
            app["notes"] = notes.strip()[:4000]
        pages = [
            {"label": page["label"], "url": require_https(page["url"], "downloadPages.url")}
            for page in policy.get("downloadPages") or []
        ]
        if pages:
            app["downloadPages"] = pages
    if not app.get("version"):
        raise ValueError("the first manifest needs --app-version")

    content = {pack["id"]: pack for pack in previous.get("content") or []}
    for pack in packs:
        old = content.get(pack["id"])
        if old and int(pack["version"]) <= int(old["version"]):
            raise ValueError(f"pack {pack['id']} version {pack['version']} is not newer than {old['version']}")
        content[pack["id"]] = pack
    return {
        "schemaVersion": SCHEMA_VERSION,
        "channel": channel,
        "publishedAt": now or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "app": app,
        "content": [content[key] for key in sorted(content)],
    }


# ------------------------------------------------------------------ sources

def add_mirror_source(sources_path: Path, template: str, label: str = "国内镜像") -> dict:
    """Release builds bake an S3/COS/OSS mirror into the bundled source list."""
    require_https(template, "mirror template")
    if template.count("{file}") != 1 or "{url}" in template:
        raise ValueError("mirror template must contain exactly one {file}")
    config = json.loads(sources_path.read_text(encoding="utf-8"))
    sources = [source for source in config["sources"] if source["id"] != "mirror"]
    sources.insert(1, {"id": "mirror", "label": label, "template": template})
    config["sources"] = sources
    sources_path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return config


BUNDLED_SLOTS = {
    "reading": ROOT / "assets/resource-pack/reading",
    "writing-topics": ROOT / "assets/generated/writing-topics",
}


def stamp_bundled(version: int, slots: dict[str, Path] = BUNDLED_SLOTS) -> None:
    """Release builds stamp the bundled packs with the release commit time,
    so content shipped inside a new app always beats older downloads."""
    if version < 200001010000 or version > 999912312359:
        raise ValueError("bundled pack version must be YYYYMMDDHHMM")
    for pack_id, directory in slots.items():
        marker = {"id": pack_id, "version": version}
        (directory / MARKER_FILE).write_text(json.dumps(marker) + "\n", encoding="utf-8")


def previous_pack_file(manifest_path: Path, pack_id: str) -> str:
    """File name of the published pack for `pack_id`, or '' if none."""
    if not manifest_path.is_file():
        return ""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for pack in manifest.get("content") or []:
        if pack.get("id") == pack_id and SAFE_NAME.match(str(pack.get("file", ""))):
            return pack["file"]
    return ""


# ------------------------------------------------------------------ cli

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    pack = sub.add_parser("pack")
    pack.add_argument("--id", required=True)
    pack.add_argument("--source", type=Path, required=True)
    pack.add_argument("--version", type=int, required=True)
    pack.add_argument("--out", type=Path, required=True)
    pack.add_argument("--min-app-version")
    pack.add_argument("--title")
    pack.add_argument("--notes")
    pack.add_argument("--baseline", type=Path, help="previous pack dir; reading packs must keep its exams")

    manifest = sub.add_parser("manifest")
    manifest.add_argument("--previous", type=Path)
    manifest.add_argument("--app-version")
    manifest.add_argument("--notes-file", type=Path)
    manifest.add_argument("--policy", type=Path, default=POLICY_PATH)
    manifest.add_argument("--pack", type=Path, action="append", default=[])
    manifest.add_argument("--out", type=Path, required=True)

    mirror = sub.add_parser("add-mirror")
    mirror.add_argument("--template", required=True)
    mirror.add_argument("--sources", type=Path, default=ROOT / "src-tauri/ota/sources.json")

    stamp = sub.add_parser("stamp-bundled")
    stamp.add_argument("--version", type=int, required=True, help="YYYYMMDDHHMM")

    previous = sub.add_parser("previous-file")
    previous.add_argument("--manifest", type=Path, required=True)
    previous.add_argument("--id", required=True)

    args = parser.parse_args()
    try:
        if args.command == "pack":
            entry = build_pack(
                args.id, args.source, args.version, args.out,
                min_app_version=args.min_app_version, title=args.title,
                notes=args.notes, baseline=args.baseline,
            )
            print(json.dumps(entry, indent=2))
        elif args.command == "manifest":
            previous = None
            if args.previous and args.previous.is_file():
                previous = json.loads(args.previous.read_text(encoding="utf-8"))
            result = compose_manifest(
                previous,
                app_version=args.app_version,
                notes=args.notes_file.read_text(encoding="utf-8") if args.notes_file else None,
                policy=load_policy(args.policy),
                packs=[json.loads(path.read_text(encoding="utf-8")) for path in args.pack],
            )
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(args.out)
        elif args.command == "previous-file":
            print(previous_pack_file(args.manifest, args.id))
        elif args.command == "stamp-bundled":
            stamp_bundled(args.version)
        else:
            add_mirror_source(args.sources, args.template)
            print(args.sources)
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
