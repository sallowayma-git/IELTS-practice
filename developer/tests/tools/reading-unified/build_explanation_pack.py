#!/usr/bin/env python3
"""Build the bundled reading-explanations resource pack.

Source: assets/generated/reading-explanations/pX-*.js — `__READING_EXPLANATION_DATA__
.register(examId, {...})` payloads (schema ReadingExplanationV1) maintained by the
opensource data pipeline. The Tauri app cannot execute those JS files, so this script
strips the registration wrapper and emits plain JSON plus a sha256 manifest that the
Rust command `reading_get_asset_explanation` verifies at read time.

Output layout mirrors assets/resource-pack/reading:
    assets/resource-pack/reading-explanations/manifest.json
    assets/resource-pack/reading-explanations/payloads/<examId>.json

Usage:
    python3 developer/tests/tools/reading-unified/build_explanation_pack.py [--check]

--check rebuilds in memory and fails if the committed pack is stale (CI-safe).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SOURCE_DIR = REPO_ROOT / "assets" / "generated" / "reading-explanations"
PACK_DIR = REPO_ROOT / "assets" / "resource-pack" / "reading-explanations"
REGISTER_RE = re.compile(r'register\(\s*"(?P<examId>[^"]+)"\s*,\s*(?P<payload>\{[\s\S]*\})\s*\)\s*;?\s*\}')


def parse_source_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = REGISTER_RE.search(text)
    if not match:
        raise ValueError(f"{path.name}: __READING_EXPLANATION_DATA__.register payload not found")
    exam_id = match.group("examId")
    payload = json.loads(match.group("payload"))
    if str(payload.get("examId", "")) != exam_id:
        raise ValueError(
            f"{path.name}: register key {exam_id!r} != payload examId {payload.get('examId')!r}"
        )
    return payload


def build_pack() -> dict:
    if not SOURCE_DIR.is_dir():
        raise SystemExit(f"missing source directory: {SOURCE_DIR}")
    entries = []
    payloads: dict[str, dict] = {}
    encoded: dict[str, str] = {}
    for path in sorted(SOURCE_DIR.glob("*.js")):
        if path.name == "manifest.js":
            continue
        payload = parse_source_file(path)
        exam_id = str(payload["examId"])
        payloads[exam_id] = payload
        # Hash the exact bytes written to disk so --check compares like with like.
        raw = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        encoded[exam_id] = raw
        meta = payload.get("meta") or {}
        entries.append(
            {
                "examId": exam_id,
                "file": f"payloads/{exam_id}.json",
                "title": str(meta.get("title", "")),
                "category": str(meta.get("category", "")),
                "noteType": str(meta.get("noteType", "")),
                "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
            }
        )
    seen = {entry["examId"] for entry in entries}
    if len(seen) != len(entries):
        raise SystemExit("duplicate examId in explanation sources")
    manifest = {
        "schemaVersion": 1,
        "packId": "ielts-reading-explanations-builtin-v1",
        "assetCount": len(entries),
        "entries": entries,
    }
    return manifest, payloads, encoded


def write_pack(manifest: dict, payloads: dict[str, dict], encoded: dict[str, str]) -> None:
    pack_payloads = PACK_DIR / "payloads"
    pack_payloads.mkdir(parents=True, exist_ok=True)
    # Remove stale payload files (renumbered exams must not linger).
    for stale in pack_payloads.glob("*.json"):
        if stale.stem not in payloads:
            stale.unlink()
    for exam_id, payload in payloads.items():
        (pack_payloads / f"{exam_id}.json").write_text(encoded[exam_id], encoding="utf-8")
    (PACK_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def read_committed_manifest() -> dict | None:
    manifest_path = PACK_DIR / "manifest.json"
    if not manifest_path.is_file():
        return None
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed pack is stale")
    args = parser.parse_args()

    manifest, payloads, encoded = build_pack()
    if args.check:
        committed = read_committed_manifest()
        if committed != manifest:
            print(
                "[reading-explanations-pack] stale: run "
                "developer/tests/tools/reading-unified/build_explanation_pack.py",
                file=sys.stderr,
            )
            return 1
        print(f"[reading-explanations-pack] up to date ({manifest['assetCount']} entries)")
        return 0

    write_pack(manifest, payloads, encoded)
    print(f"[reading-explanations-pack] wrote {manifest['assetCount']} payloads to {PACK_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
