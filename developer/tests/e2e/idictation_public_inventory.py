"""Inventory the public web client's linked chunks; never call business APIs.

Run explicitly during provider research. Downloads only scripts referenced by the
public entry module, serially, and records SHA-256 evidence under ignored reports.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent / "reports" / "idictation-research"
ORIGIN = "https://www.idictation.cn"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume-from-manifest', action='store_true',
                        help='Follow missing links from the existing hashed snapshot without refreshing its entry.')
    args = parser.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    report_path = ROOT / "public-inventory.json"
    previous = json.loads(report_path.read_text('utf-8')) if args.resume_from_manifest else {}
    known = {item['path']: item for item in previous.get('scripts', [])}
    if args.resume_from_manifest:
        if previous.get('origin') != ORIGIN or not known:
            raise ValueError('No matching public script snapshot to resume')
        entries = list(known)
    else:
        response = session.get(ORIGIN + "/main/book", timeout=30)
        response.raise_for_status()
        entries = re.findall(r'src="(/assets/[^"/]+\.js)"', response.text)
    pending = list(entries)
    seen: set[str] = set()
    manifest = []
    downloaded = 0
    while pending:
        path = pending.pop(0)
        if path in seen:
            continue
        seen.add(path)
        if not re.fullmatch(r'/assets/[A-Za-z0-9_][A-Za-z0-9_.-]*\.js', path):
            raise ValueError('Unexpected public script path')
        target = ROOT / Path(path).name
        if path in known:
            content = target.read_bytes()
            if hashlib.sha256(content).hexdigest() != known[path]['sha256']:
                raise ValueError(f'Cached script no longer matches its evidence hash: {target.name}')
        else:
            response = session.get(ORIGIN + path, timeout=30)
            response.raise_for_status()
            content = response.content
            target.write_bytes(content)
            downloaded += 1
        manifest.append({"path": path, "bytes": len(content),
                         "sha256": hashlib.sha256(content).hexdigest()})
        text = content.decode("utf-8")
        linked = re.findall(r'["\'](?:\./|/?assets/)([A-Za-z0-9_][A-Za-z0-9_.-]*\.js)["\']', text)
        pending.extend("/assets/" + name for name in linked if "/assets/" + name not in seen)
    endpoints = []
    for item in manifest:
        text = (ROOT / Path(item["path"]).name).read_text("utf-8")
        for match in re.finditer(r'["\'](/(?:api|resource|user|web-pay)/[^"\'\s]+)["\']', text):
            endpoints.append({"path": match.group(1), "file": Path(item["path"]).name,
                              "offset": match.start(), "evidence": "public-client-reference"})
    report = {"origin": ORIGIN, "scripts": manifest, "endpointReferences": endpoints,
              "inventoryUpdatedAt": datetime.now(timezone.utc).isoformat(),
              "mode": "extend-hashed-snapshot" if args.resume_from_manifest else "fresh-entry",
              "note": "Static references are not proof of account access or complete API coverage."}
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({"scripts": len(manifest), "uniquePaths": len({e['path'] for e in endpoints}),
                      "downloaded": downloaded, "report": str(report_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
