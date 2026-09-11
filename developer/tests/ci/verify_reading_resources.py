"""Check the exact reading payload bytes consumed by native startup."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def verify_reading_resources(directory: Path) -> dict[str, object]:
    manifest = json.loads((directory / "manifest.json").read_bytes())
    entries = manifest["entries"]
    if manifest["schemaVersion"] != 1 or manifest["assetCount"] != len(entries) or not entries:
        raise ValueError("invalid reading resource schema or asset count")
    for entry in entries:
        relative = Path(entry["file"])
        if relative.is_absolute() or ".." in entry["file"]:
            raise ValueError(f"invalid reading resource path: {entry['file']}")
        raw = (directory / relative).read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise ValueError(f"reading resource checksum mismatch: {entry['examId']}")
        if json.loads(raw)["examId"] != entry["examId"]:
            raise ValueError(f"reading resource examId mismatch: {entry['file']}")
    return {"status": "passed", "verifiedPayloads": len(entries), "hashScope": "raw-bytes"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", nargs="?", type=Path, default=ROOT / "assets/resource-pack/reading")
    args = parser.parse_args()
    try:
        result = verify_reading_resources(args.directory)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
