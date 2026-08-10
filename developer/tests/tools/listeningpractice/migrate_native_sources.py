#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parent
if str(TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(TOOL_DIR))

from listening_bridge_contract import ensure_static_bridge_tree


VALID_PARTS = {"P1", "P2", "P3", "P4"}
SOURCE_GROUPS = ("普通", "VIP")


def ensure_inside(child: Path, parent: Path) -> None:
    child_resolved = child.resolve()
    parent_resolved = parent.resolve()
    try:
        child_resolved.relative_to(parent_resolved)
    except ValueError as exc:
        raise RuntimeError(f"Refusing path outside target root: {child_resolved}") from exc


def iter_topic_dirs(source_root: Path):
    for group in SOURCE_GROUPS:
        group_root = source_root / group
        if not group_root.exists():
            continue
        for part_dir in sorted(group_root.iterdir()):
            if not part_dir.is_dir() or part_dir.name.upper() not in VALID_PARTS:
                continue
            part = part_dir.name.upper()
            for frequency_dir in sorted(part_dir.iterdir()):
                if not frequency_dir.is_dir():
                    continue
                for topic_dir in sorted(frequency_dir.iterdir()):
                    if not topic_dir.is_dir():
                        continue
                    if not any(topic_dir.glob("*.html")):
                        continue
                    yield {
                        "group": group,
                        "part": part,
                        "frequency": frequency_dir.name,
                        "source": topic_dir,
                    }


def resolve_target_dir(target_root: Path, item: dict) -> Path:
    name = item["source"].name
    if item["group"].upper() == "VIP" and "(VIP)" not in name.upper():
        name = f"{name} (VIP)"
    return target_root / item["part"] / item["frequency"] / name


def copy_topic(source: Path, target: Path, target_root: Path, replace: bool) -> str:
    ensure_inside(target, target_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    existed = target.exists()
    if target.exists():
        if not replace:
            return "skipped-existing"
        shutil.rmtree(target)
    shutil.copytree(source, target)
    return "replaced" if existed else "copied"


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate native Xiahua listening sources into ListeningPractice/P1-P4.")
    parser.add_argument(
        "--source-root",
        default=r"C:\Users\lenovo\Desktop\working space\copy\虾滑(5.7)\虾滑",
        help="Native source root containing 普通/VIP folders",
    )
    parser.add_argument("--target-root", default="ListeningPractice")
    parser.add_argument("--report", default="developer/tests/reports/listening-native-migration.json")
    parser.add_argument(
        "--bridge-target",
        default="",
        help="Bridge bundle path (defaults to <target parent>/js/bundles/listening-record-bridge.bundle.js)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-replace", action="store_true", help="Skip target topic folders that already exist")
    args = parser.parse_args()

    source_root = Path(args.source_root)
    target_root = Path(args.target_root)
    if not source_root.exists():
        raise FileNotFoundError(f"source root not found: {source_root}")
    if not args.dry_run and not target_root.exists():
        target_root.mkdir(parents=True, exist_ok=True)

    target_root_resolved = target_root.resolve()
    bridge_target = Path(args.bridge_target) if args.bridge_target else (
        target_root_resolved.parent / "js" / "bundles" / "listening-record-bridge.bundle.js"
    )
    replace = not args.no_replace
    records = []
    counts = {}

    for item in iter_topic_dirs(source_root):
        target = resolve_target_dir(target_root, item)
        rel_source = item["source"].relative_to(source_root).as_posix()
        rel_target = target.relative_to(target_root).as_posix()
        action = "would-replace" if target.exists() and replace else ("would-copy" if not target.exists() else "would-skip-existing")
        bridge_scanned = 0
        bridge_changed = 0
        if not args.dry_run:
            action = copy_topic(item["source"], target, target_root_resolved, replace)
            if action in {"copied", "replaced"}:
                bridge_scanned, bridge_changed = ensure_static_bridge_tree(target, bridge_target)
        counts[action] = counts.get(action, 0) + 1
        records.append({
            "source": rel_source,
            "target": rel_target,
            "part": item["part"],
            "frequency": item["frequency"],
            "group": item["group"],
            "action": action,
            "bridgeScanned": bridge_scanned,
            "bridgeChanged": bridge_changed,
        })

    report = {
        "sourceRoot": str(source_root),
        "targetRoot": str(target_root),
        "dryRun": args.dry_run,
        "replace": replace,
        "bridgeTarget": str(bridge_target),
        "counts": counts,
        "total": len(records),
        "records": records,
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Migrated {len(records)} topic folders. Counts: {counts}. Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
