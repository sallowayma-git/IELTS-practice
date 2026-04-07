#!/usr/bin/env python3
"""Writing backend contract static verifier.

Checks critical files and key contract snippets for Phase 05-09 backend work.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

checks = []


def add_check(name: str, ok: bool, detail: str):
    checks.append({"name": name, "status": "pass" if ok else "fail", "detail": detail})


def contains(path: Path, token: str) -> bool:
    if not path.exists():
        return False
    return token in path.read_text(encoding="utf-8")


def contains_any(path: Path, tokens: list[str]) -> bool:
    if not path.exists():
        return False
    content = path.read_text(encoding="utf-8")
    return any(token in content for token in tokens)


def contains_all(path: Path, tokens: list[str]) -> bool:
    if not path.exists():
        return False
    content = path.read_text(encoding="utf-8")
    return all(token in content for token in tokens)


def not_contains(path: Path, token: str) -> bool:
    if not path.exists():
        return False
    return token not in path.read_text(encoding="utf-8")

# File existence
required_files = [
    ROOT / "electron" / "local-api-server.js",
    ROOT / "electron" / "services" / "evaluation-contract.js",
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
    "EvaluateService 含双阶段执行方法",
    contains_all(
        ROOT / "electron/services/evaluate.service.js",
        ["_executeScoringStage", "_executeReviewStage"],
    ),
    "已检测" if contains_all(
        ROOT / "electron/services/evaluate.service.js",
        ["_executeScoringStage", "_executeReviewStage"],
    ) else "未检测",
)
add_check(
    "EvaluateService 使用独立 contract 模块",
    contains(ROOT / "electron/services/evaluate.service.js", "require('./evaluation-contract')"),
    "已检测" if contains(ROOT / "electron/services/evaluate.service.js", "require('./evaluation-contract')") else "未检测",
)
add_check(
    "EvaluateService SSE 含 stage 事件",
    contains_any(
        ROOT / "electron/services/evaluate.service.js",
        ["type: 'stage'", 'type: "stage"'],
    ),
    "已检测" if contains_any(
        ROOT / "electron/services/evaluate.service.js",
        ["type: 'stage'", 'type: "stage"'],
    ) else "未检测",
)
add_check(
    "EvaluateService SSE 含 analysis/review 事件",
    (
        contains_any(ROOT / "electron/services/evaluate.service.js", ["type: 'analysis'", 'type: "analysis"'])
        and contains_any(ROOT / "electron/services/evaluate.service.js", ["type: 'review'", 'type: "review"'])
    ),
    "已检测" if (
        contains_any(ROOT / "electron/services/evaluate.service.js", ["type: 'analysis'", 'type: "analysis"'])
        and contains_any(ROOT / "electron/services/evaluate.service.js", ["type: 'review'", 'type: "review"'])
    ) else "未检测",
)
add_check(
    "EvaluateService review 失败不会误报 completed",
    contains(ROOT / "electron/services/evaluate.service.js", "reviewStageDegraded"),
    "已检测" if contains(ROOT / "electron/services/evaluate.service.js", "reviewStageDegraded") else "未检测",
)
add_check(
    "EvaluateService complete 事件携带 review_degraded",
    contains(ROOT / "electron/services/evaluate.service.js", "review_degraded"),
    "已检测" if contains(ROOT / "electron/services/evaluate.service.js", "review_degraded") else "未检测",
)
add_check(
    "evaluation contract 固化 review_degraded/review_status",
    contains_all(
        ROOT / "electron/services/evaluation-contract.js",
        ["review_degraded", "review_status"],
    ),
    "已检测" if contains_all(
        ROOT / "electron/services/evaluation-contract.js",
        ["review_degraded", "review_status"],
    ) else "未检测",
)
add_check(
    "EvaluateService 不再从 review 阶段回填总分",
    not_contains(ROOT / "electron/services/evaluate.service.js", "?? this._coerceScore(reviewEvaluation."),
    "已检测" if not_contains(ROOT / "electron/services/evaluate.service.js", "?? this._coerceScore(reviewEvaluation.") else "未检测",
)
add_check(
    "LLMProvider 支持 response_format 结构化输出",
    contains(ROOT / "electron/services/llm-provider.js", "response_format"),
    "已检测" if contains(ROOT / "electron/services/llm-provider.js", "response_format") else "未检测",
)

probe_script = ROOT / "developer/tests/ci/writing_contract_probe.cjs"
if probe_script.exists():
    probe = subprocess.run(
        ["node", str(probe_script)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    probe_detail = probe.stdout.strip() or probe.stderr.strip() or "无输出"
    add_check(
        "运行时探针: 评测结果 contract_version/scorecard/analysis/review 持久化稳定",
        probe.returncode == 0,
        probe_detail,
    )
else:
    add_check("运行时探针: 评测结果 contract_version/scorecard/analysis/review 持久化稳定", False, "探针脚本缺失")
add_check(
    "History 搜索 LIKE 支持",
    contains(ROOT / "electron/db/dao/essays.dao.js", "t.title_json LIKE ? OR e.content LIKE ?"),
    "已检测" if contains(ROOT / "electron/db/dao/essays.dao.js", "t.title_json LIKE ? OR e.content LIKE ?") else "未检测",
)
add_check(
    "History 搜索覆盖 evaluation_json",
    contains(ROOT / "electron/db/dao/essays.dao.js", "e.evaluation_json LIKE ?"),
    "已检测" if contains(ROOT / "electron/db/dao/essays.dao.js", "e.evaluation_json LIKE ?") else "未检测",
)
add_check(
    "EssayService 暴露 display_topic_title",
    contains(ROOT / "electron/services/essay.service.js", "display_topic_title"),
    "已检测" if contains(ROOT / "electron/services/essay.service.js", "display_topic_title") else "未检测",
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
add_check(
    "preload 评测事件精确解绑而非 removeAllListeners",
    (
        contains(ROOT / "electron/preload.js", "removeListener('evaluate:event'")
        and not_contains(ROOT / "electron/preload.js", "removeAllListeners('evaluate:event')")
    ),
    "已检测" if (
        contains(ROOT / "electron/preload.js", "removeListener('evaluate:event'")
        and not_contains(ROOT / "electron/preload.js", "removeAllListeners('evaluate:event')")
    ) else "未检测",
)
add_check(
    "EvaluatingPage 缓存写入具备失败保护",
    contains(ROOT / "apps/writing-vue/src/views/EvaluatingPage.vue", "cachePersistRetryAt"),
    "已检测" if contains(ROOT / "apps/writing-vue/src/views/EvaluatingPage.vue", "cachePersistRetryAt") else "未检测",
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
