#!/usr/bin/env python3
"""Writing backend contract static verifier.

Checks critical files and key contract snippets for Phase 05-09 backend work.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

checks = []


def add_check(name: str, ok: bool, detail: str):
    checks.append({"name": name, "status": "pass" if ok else "fail", "detail": detail})


def contains(path: Path, token: str) -> bool:
    if not path.exists():
        return False
    return token in path.read_text(encoding="utf-8")

# File existence
required_files = [
    ROOT / "electron" / "local-api-server.js",
    ROOT / "electron" / "services" / "provider-orchestrator.service.js",
    ROOT / "electron" / "db" / "migrations" / "20260209_phase06_schema.sql",
    ROOT / "electron" / "resources" / "prompt-template.v2.json",
]
for f in required_files:
    add_check(f"存在性: {f.relative_to(ROOT)}", f.exists(), "已找到" if f.exists() else "缺失")

# Contract snippets
add_check(
    "EvaluateService 完成事件携带 essay_id",
    contains(ROOT / "electron/services/evaluate.service.js", "essay_id"),
    "已检测" if contains(ROOT / "electron/services/evaluate.service.js", "essay_id") else "未检测",
)
add_check(
    "History 搜索 LIKE 支持",
    contains(ROOT / "electron/db/dao/essays.dao.js", "t.title_json LIKE ? OR e.content LIKE ?"),
    "已检测" if contains(ROOT / "electron/db/dao/essays.dao.js", "t.title_json LIKE ? OR e.content LIKE ?") else "未检测",
)
add_check(
    "Upload 返回 thumbnail_path",
    contains(ROOT / "electron/services/upload.service.js", "thumbnail_path"),
    "已检测" if contains(ROOT / "electron/services/upload.service.js", "thumbnail_path") else "未检测",
)
add_check(
    "IPC 白名单包含 dist/writing/index.html",
    contains(ROOT / "electron/ipc-handlers.js", "dist/writing/index.html"),
    "已检测" if contains(ROOT / "electron/ipc-handlers.js", "dist/writing/index.html") else "未检测",
)

status = "pass" if all(item["status"] == "pass" for item in checks) else "fail"
result = {
    "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "status": status,
    "results": checks,
}

print(json.dumps(result, ensure_ascii=False, indent=2))

report = ROOT / "developer/tests/e2e/reports/writing-backend-contract-report.json"
report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

raise SystemExit(0 if status == "pass" else 1)
