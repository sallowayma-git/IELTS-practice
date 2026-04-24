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


def build_server_bundle() -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ["npm", "run", "build:server"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        output_text = exc.stdout or exc.stderr or str(exc)
        return False, f"执行失败: {output_text.strip()}"
    return True, completed.stdout.strip() or completed.stderr.strip() or "已执行"


build_ok, build_detail = build_server_bundle()
add_check("server 预编译构建", build_ok, build_detail)

# File existence
required_files = [
    ROOT / "electron" / "local-api-server.js",
    ROOT / "electron" / "service-bundle.js",
    ROOT / "electron" / "services" / "evaluate.service.js",
    ROOT / "electron" / "services" / "reading-coach.service.js",
    ROOT / "electron" / "services" / "evaluation-contract.js",
    ROOT / "electron" / "services" / "provider-orchestrator.service.js",
    ROOT / "server" / "src" / "lib" / "writing" / "evaluate-service.ts",
    ROOT / "server" / "src" / "lib" / "reading" / "coach-service.ts",
    ROOT / "server" / "src" / "lib" / "writing" / "contracts.ts",
    ROOT / "server" / "src" / "lib" / "shared" / "provider-orchestrator.ts",
    ROOT / "server" / "dist" / "app.js",
    ROOT / "server" / "dist" / "lib" / "writing" / "evaluate-service.js",
    ROOT / "server" / "dist" / "lib" / "reading" / "coach-service.js",
    ROOT / "server" / "dist" / "lib" / "writing" / "contracts.js",
    ROOT / "server" / "dist" / "lib" / "shared" / "provider-orchestrator.js",
    ROOT / "electron" / "db" / "migrations" / "20260209_phase06_schema.sql",
    ROOT / "electron" / "resources" / "prompt-template.v2.json",
]
for f in required_files:
    add_check(f"存在性: {f.relative_to(ROOT)}", f.exists(), "已找到" if f.exists() else "缺失")

# Contract snippets
add_check(
    "EvaluateService 完成事件携带 essay_id",
    contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "essay_id"),
    "已检测" if contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "essay_id") else "未检测",
)
add_check(
    "EvaluateService 含双阶段执行方法",
    contains_all(
        ROOT / "server/src/lib/writing/evaluate-service.ts",
        ["_executeScoringStage", "_executeReviewStage"],
    ),
    "已检测" if contains_all(
        ROOT / "server/src/lib/writing/evaluate-service.ts",
        ["_executeScoringStage", "_executeReviewStage"],
    ) else "未检测",
)
add_check(
    "EvaluateService 使用独立 contract 模块包装器",
    (
        contains(ROOT / "electron/services/evaluate.service.js", "server', 'dist', 'lib', 'writing', 'evaluate-service.js")
        and contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "require('./contracts.js')")
    ),
    "已检测" if (
        contains(ROOT / "electron/services/evaluate.service.js", "server', 'dist', 'lib', 'writing', 'evaluate-service.js")
        and contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "require('./contracts.js')")
    ) else "未检测",
)
add_check(
    "EvaluateService SSE 含 stage 事件",
    contains_any(
        ROOT / "server/src/lib/writing/evaluate-service.ts",
        ["type: 'stage'", 'type: "stage"'],
    ),
    "已检测" if contains_any(
        ROOT / "server/src/lib/writing/evaluate-service.ts",
        ["type: 'stage'", 'type: "stage"'],
    ) else "未检测",
)
add_check(
    "EvaluateService SSE 含 analysis/review 事件",
    (
        contains_any(ROOT / "server/src/lib/writing/evaluate-service.ts", ["type: 'analysis'", 'type: "analysis"'])
        and contains_any(ROOT / "server/src/lib/writing/evaluate-service.ts", ["type: 'review'", 'type: "review"'])
    ),
    "已检测" if (
        contains_any(ROOT / "server/src/lib/writing/evaluate-service.ts", ["type: 'analysis'", 'type: "analysis"'])
        and contains_any(ROOT / "server/src/lib/writing/evaluate-service.ts", ["type: 'review'", 'type: "review"'])
    ) else "未检测",
)
add_check(
    "EvaluateService review 失败不会误报 completed",
    contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "reviewStageDegraded"),
    "已检测" if contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "reviewStageDegraded") else "未检测",
)
add_check(
    "EvaluateService complete 事件携带 review_degraded",
    contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "review_degraded"),
    "已检测" if contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "review_degraded") else "未检测",
)
add_check(
    "server contract 固化 review_degraded/review_status",
    contains_all(
        ROOT / "server/src/lib/writing/contracts.ts",
        ["review_degraded", "review_status"],
    ),
    "已检测" if contains_all(
        ROOT / "server/src/lib/writing/contracts.ts",
        ["review_degraded", "review_status"],
    ) else "未检测",
)
add_check(
    "EvaluateService 不再从 review 阶段回填总分",
    not_contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "?? this._coerceScore(reviewEvaluation."),
    "已检测" if not_contains(ROOT / "server/src/lib/writing/evaluate-service.ts", "?? this._coerceScore(reviewEvaluation.") else "未检测",
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
    "旧业务 IPC handlers 已删除",
    not (ROOT / "electron/ipc-handlers.js").exists(),
    "已删除" if not (ROOT / "electron/ipc-handlers.js").exists() else "仍存在",
)
add_check(
    "preload 仅暴露最小壳层 API",
    (
        contains_all(
            ROOT / "electron/preload.js",
            ["getLocalApiInfo", "openWriting", "openLegacy"]
        )
        and "writingAPI" not in (ROOT / "electron/preload.js").read_text(encoding="utf-8")
    ),
    "已检测" if (
        contains_all(
            ROOT / "electron/preload.js",
            ["getLocalApiInfo", "openWriting", "openLegacy"]
        )
        and "writingAPI" not in (ROOT / "electron/preload.js").read_text(encoding="utf-8")
    ) else "未检测",
)
add_check(
    "main 进程通过 service-bundle + local-api-server 启动服务",
    contains_all(
        ROOT / "electron/main.js",
        ["new ServiceBundle(mainWindow)", "new LocalApiServer(services)", "app:getLocalApiInfo"],
    ),
    "已检测" if contains_all(
        ROOT / "electron/main.js",
        ["new ServiceBundle(mainWindow)", "new LocalApiServer(services)", "app:getLocalApiInfo"],
    ) else "未检测",
)
add_check(
    "electron 包装器指向 server core",
    (
        contains(ROOT / "electron/services/evaluate.service.js", "server', 'dist', 'lib', 'writing', 'evaluate-service.js")
        and contains(ROOT / "electron/services/reading-coach.service.js", "server', 'dist', 'lib', 'reading', 'coach-service.js")
        and contains(ROOT / "electron/services/evaluation-contract.js", "server', 'dist', 'lib', 'writing', 'contracts.js")
        and contains(ROOT / "electron/services/provider-orchestrator.service.js", "server', 'dist', 'lib', 'shared', 'provider-orchestrator.js")
    ),
    "已检测" if (
        contains(ROOT / "electron/services/evaluate.service.js", "server', 'dist', 'lib', 'writing', 'evaluate-service.js")
        and contains(ROOT / "electron/services/reading-coach.service.js", "server', 'dist', 'lib', 'reading', 'coach-service.js")
        and contains(ROOT / "electron/services/evaluation-contract.js", "server', 'dist', 'lib', 'writing', 'contracts.js")
        and contains(ROOT / "electron/services/provider-orchestrator.service.js", "server', 'dist', 'lib', 'shared', 'provider-orchestrator.js")
    ) else "未检测",
)
add_check(
    "package 构建脚本包含 build:server",
    contains(ROOT / "package.json", "\"build:server\""),
    "已检测" if contains(ROOT / "package.json", "\"build:server\"") else "未检测",
)
add_check(
    "start 启动前先构建 server",
    contains_all(
        ROOT / "package.json",
        ["\"start\": \"npm run build:server && npm run build:writing && electron .\"", "\"start:electron\": \"npm run build:server && electron .\""],
    ),
    "已检测" if contains_all(
        ROOT / "package.json",
        ["\"start\": \"npm run build:server && npm run build:writing && electron .\"", "\"start:electron\": \"npm run build:server && electron .\""],
    ) else "未检测",
)
add_check(
    "打包仅收录 server/dist",
    (
        contains(ROOT / "package.json", "\"server/dist/**/*\"")
        and "server/**/*" not in (ROOT / "package.json").read_text(encoding="utf-8")
    ),
    "已检测" if (
        contains(ROOT / "package.json", "\"server/dist/**/*\"")
        and "server/**/*" not in (ROOT / "package.json").read_text(encoding="utf-8")
    ) else "未检测",
)
add_check(
    "main 进程固化 userData 到 ielts-practice 目录",
    contains_all(
        ROOT / "electron/main.js",
        ["STABLE_USER_DATA_DIR = 'ielts-practice'", "app.setPath('userData', preferredUserDataPath)"],
    ),
    "已检测" if contains_all(
        ROOT / "electron/main.js",
        ["STABLE_USER_DATA_DIR = 'ielts-practice'", "app.setPath('userData', preferredUserDataPath)"],
    ) else "未检测",
)
add_check(
    "TopicService 读题目前确保默认题库可用",
    contains_all(
        ROOT / "electron/services/topic.service.js",
        ["ensureDefaultsAvailable()", "await this.ensureDefaultsAvailable();"],
    ),
    "已检测" if contains_all(
        ROOT / "electron/services/topic.service.js",
        ["ensureDefaultsAvailable()", "await this.ensureDefaultsAvailable();"],
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
