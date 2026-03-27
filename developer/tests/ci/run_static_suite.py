#!/usr/bin/env python3
"""Static test aggregation for the IELTS practice app.

This module verifies the presence and basic structure of the
static end-to-end harness and HTML regression tests.  It is designed to be
invoked locally or inside CI before changes are merged.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from difflib import SequenceMatcher
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[3]


class _HTMLDoctypeParser(HTMLParser):
    """Detects a <!DOCTYPE html> declaration in a HTML document."""

    def __init__(self) -> None:
        super().__init__()
        self.has_doctype = False

    def handle_decl(self, decl: str) -> None:  # pragma: no cover - html.parser API
        if decl.lower().strip() == "doctype html":
            self.has_doctype = True


def _check_html_doctype(path: Path) -> Tuple[bool, str]:
    try:
        parser = _HTMLDoctypeParser()
        parser.feed(path.read_text(encoding="utf-8"))
        parser.close()
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"无法解析 HTML：{exc}"
    return parser.has_doctype, "检测到 <!DOCTYPE html>" if parser.has_doctype else "缺少 <!DOCTYPE html>"

class _AppStructureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.nav_views: List[str] = []
        self.settings_button_ids: List[str] = []
        self._nav_depth = 0
        self._settings_depth = 0

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:  # pragma: no cover - HTMLParser API
        attr_dict = {name: value for name, value in attrs}

        if tag == "nav" and attr_dict.get("class") and "main-nav" in attr_dict.get("class", ""):
            self._nav_depth += 1
        elif self._nav_depth > 0 and tag == "nav":
            self._nav_depth += 1

        if self._nav_depth > 0 and tag == "button":
            data_view = attr_dict.get("data-view")
            if data_view:
                self.nav_views.append(data_view)

        if tag == "div" and attr_dict.get("id") == "settings-view":
            self._settings_depth += 1
        elif self._settings_depth > 0 and tag == "div":
            self._settings_depth += 1

        if self._settings_depth > 0 and tag == "button":
            button_id = attr_dict.get("id")
            if button_id:
                self.settings_button_ids.append(button_id)

    def handle_endtag(self, tag: str) -> None:  # pragma: no cover - HTMLParser API
        if tag == "nav" and self._nav_depth > 0:
            self._nav_depth -= 1
        if tag == "div" and self._settings_depth > 0:
            self._settings_depth -= 1


def _parse_app_structure(index_path: Path) -> _AppStructureParser:
    parser = _AppStructureParser()
    parser.feed(index_path.read_text(encoding="utf-8"))
    parser.close()
    return parser


def _load_interaction_targets(path: Path) -> Tuple[Optional[Dict[str, List[str]]], str]:
    if not path.exists():
        return None, "配置文件缺失"
    try:
        content = path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - file IO errors
        return None, f"读取失败：{exc}"

    match = re.search(r"Object\.freeze\(\s*(\{[\s\S]*?\})\s*\)", content)
    if not match:
        return None, "未找到交互目标对象"

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        return None, f"解析失败：{exc}"

    if not isinstance(data, dict):
        return None, "数据结构不是对象"

    for key in ("mainNavigationViews", "settingsButtonIds"):
        if key not in data or not isinstance(data[key], list):
            return None, f"缺少字段：{key}"

    return data, "已解析交互目标"


def _check_contains(path: Path, snippet: str) -> Tuple[bool, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"
    present = snippet in text
    return present, ("已包含片段" if present else f"缺少片段：{snippet}")


def _check_main_entry_on_demand(main_entry: Path) -> Tuple[bool, str]:
    try:
        source = main_entry.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"

    required_snippets = [
        "var STRICT_ON_DEMAND = true;",
        "if (STRICT_ON_DEMAND)",
        "bootstrapCoreDataInBackground()",
    ]
    forbidden_snippets = [
        "AppActions.preloadPracticeSuite",
        "ensureLazyGroup('practice-suite')",
        "ensureLazyGroup('browse-view')",
    ]

    missing = [snippet for snippet in required_snippets if snippet not in source]
    forbidden_hits = [snippet for snippet in forbidden_snippets if snippet in source]

    if missing or forbidden_hits:
        detail = {
            "missing": missing,
            "forbiddenHits": forbidden_hits,
        }
        return False, detail
    return True, "严格按需配置存在，未发现旧启动预加载片段"


def _check_app_js_non_blocking_boot(app_js: Path) -> Tuple[bool, str]:
    try:
        source = app_js.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"

    has_boot_signal = "appCoreReady" in source and "dispatchEvent(new CustomEvent('appCoreReady'))" in source
    blocks_on_browse = "browseReady" in source or "awaitBrowse" in source

    if not has_boot_signal:
        return False, "缺少 appCoreReady 收口事件"
    if blocks_on_browse:
        return False, "仍检测到 browseReady/awaitBrowse 启动阻塞逻辑"
    return True, "未检测到 browseReady 阻塞，且包含 appCoreReady 收口事件"


def _check_lazy_loader_dedupe(loader_path: Path) -> Tuple[bool, str]:
    try:
        source = loader_path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"

    required_snippets = [
        "function findExistingScriptTag(url)",
        "var existing = findExistingScriptTag(url);",
        "scriptStatus[url] = 'loaded';",
    ]
    missing = [snippet for snippet in required_snippets if snippet not in source]
    if missing:
        return False, {"missing": missing}
    return True, "已检测到静态脚本去重逻辑"


def _check_practice_recorder_synthetic_guard(recorder_path: Path) -> Tuple[bool, str]:
    try:
        source = recorder_path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"

    required_snippets = [
        "isSyntheticSessionAllowed(payload",
        "活动会话缺失，生产环境拒绝合成数据保存",
        "recordRejectedCompletionPayload",
    ]
    missing = [snippet for snippet in required_snippets if snippet not in source]
    if missing:
        return False, {"missing": missing}
    return True, "已检测到生产环境 synthetic 会话保护逻辑"


def _collect_mixin_methods(app_dir: Path) -> List[str]:
    pattern = re.compile(r"^\s{8}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)
    reserved = {"if", "for", "while", "switch", "catch", "function", "return"}
    methods = set()

    for mixin_path in sorted(app_dir.glob("*Mixin.js")):
        try:
            content = mixin_path.read_text(encoding="utf-8")
        except Exception:  # pragma: no cover - defensive guard
            continue

        for name in pattern.findall(content):
            if name in reserved:
                continue
            methods.add(name)

    return sorted(methods)


def _extract_js_function_body(source: str, function_name: str) -> Optional[str]:
    pattern = re.compile(
        rf"(?:async\s+)?function\s+{re.escape(function_name)}\s*\([^)]*\)\s*\{{",
        re.MULTILINE,
    )
    match = pattern.search(source)
    if not match:
        return None

    index = match.end()
    depth = 1
    length = len(source)
    body_chars: List[str] = []
    in_single = False
    in_double = False
    in_backtick = False
    escape = False

    while index < length and depth > 0:
        ch = source[index]

        if escape:
            body_chars.append(ch)
            escape = False
        elif ch == "\\":
            body_chars.append(ch)
            if in_single or in_double or in_backtick:
                escape = True
        elif in_single:
            body_chars.append(ch)
            if ch == "'":
                in_single = False
        elif in_double:
            body_chars.append(ch)
            if ch == '"':
                in_double = False
        elif in_backtick:
            body_chars.append(ch)
            if ch == "`":
                in_backtick = False
        else:
            if ch == "'":
                in_single = True
                body_chars.append(ch)
            elif ch == '"':
                in_double = True
                body_chars.append(ch)
            elif ch == "`":
                in_backtick = True
                body_chars.append(ch)
            elif ch == "{":
                depth += 1
                body_chars.append(ch)
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
                body_chars.append(ch)
            else:
                body_chars.append(ch)

        index += 1

    if depth != 0:
        return None

    return "".join(body_chars)


def _check_js_function_definition(source: str, function_name: str) -> Tuple[bool, str]:
    pattern = re.compile(
        rf"(function\s+{re.escape(function_name)}\s*\(|(?:const|let|var)\s+{re.escape(function_name)}\s*=)",
        re.MULTILINE,
    )
    exists = bool(pattern.search(source))
    detail = "已检测到定义" if exists else "缺少函数定义"
    return exists, detail


def _check_js_body_forbidden(source: str, function_name: str, forbidden: str) -> Tuple[bool, str]:
    body = _extract_js_function_body(source, function_name)
    if body is None:
        return False, "未找到函数定义"
    if forbidden in body:
        return False, f"发现禁止片段：{forbidden}"
    return True, "未发现禁止片段"


def _check_window_load_library_shim(source: str) -> Tuple[bool, str]:
    """
    Prevent regressions where window.loadLibrary self-calls and causes a stack overflow.
    Expect the shim to delegate to loadLibraryInternal and avoid calling loadLibrary() directly.
    """
    pattern = re.compile(
        r"window\.loadLibrary\s*=\s*function\s*\([^)]*\)\s*\{(?P<body>[\s\S]*?)\}",
        re.MULTILINE,
    )
    match = pattern.search(source)
    if not match:
        return False, "未找到 window.loadLibrary 定义"

    body = match.group("body")
    if "loadLibraryInternal" not in body:
        return False, "未转发到 loadLibraryInternal，可能存在自递归风险"

    recursive_call = re.search(r"\bloadLibrary(?!Internal)\s*\(", body)
    if recursive_call:
        return False, "检测到对 loadLibrary 的直接调用，可能触发自递归"

    return True, "已转发到 loadLibraryInternal，未检测到自递归"


def _check_resolve_exam_base_path(source: str) -> Tuple[bool, dict]:
    body = _extract_js_function_body(source, "resolveExamBasePath")
    if body is None:
        return False, {"error": "未找到 resolveExamBasePath 定义"}

    required_snippets = {
        "mergeRootWithFallback": "需要通过 mergeRootWithFallback 合并根路径",
        "normalizedRelative && normalizedRelative.startsWith(normalizedRoot)": "需要检测重复根前缀",
        "combined = normalizedRoot + normalizedRelative": "需要组合根目录和相对路径",
    }
    missing = [desc for snippet, desc in required_snippets.items() if snippet not in body]
    passed = not missing
    detail = {
        "checked": list(required_snippets.keys()),
        "missing": missing,
    }
    return passed, detail


def _check_metadata_field(path: Path, keyword: str = "pathRoot") -> Tuple[bool, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"

    if keyword in text:
        return True, f"检测到 {keyword} 元数据"
    return False, f"缺少 {keyword} 元数据"


def _check_json_path_map(path: Path) -> Tuple[bool, str]:
    if not path.exists():
        return False, "路径映射文件缺失"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - defensive guard
        return False, f"读取失败：{exc}"

    reading_root = (((payload or {}).get("reading") or {}).get("root"))
    listening_root = (((payload or {}).get("listening") or {}).get("root"))
    if isinstance(reading_root, str) and reading_root.strip() and isinstance(listening_root, str) and listening_root.strip():
        return True, "检测到 reading/listening 路径映射"
    return False, "路径映射缺少 reading/listening root"


def _extract_registered_payload(path: Path) -> Optional[dict]:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None

    match = re.search(
        r"register\(\s*['\"]([^'\"]+)['\"]\s*,\s*(\{[\s\S]*\})\s*\)\s*;",
        text,
        re.MULTILINE,
    )
    if not match:
        return None

    try:
        payload = json.loads(match.group(2))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _normalize_title_for_similarity(title: str) -> str:
    lowered = (title or "").strip().lower()
    lowered = re.sub(r"\s+", " ", lowered)
    lowered = re.sub(r"[^0-9a-z\u4e00-\u9fff ]+", "", lowered)
    return lowered.strip()


def _extract_exam_question_range(exam_payload: dict) -> Optional[Tuple[int, int]]:
    display_map = exam_payload.get("questionDisplayMap")
    if isinstance(display_map, dict):
        numeric_values = []
        for value in display_map.values():
            try:
                numeric_values.append(int(str(value).strip()))
            except Exception:
                continue
        if numeric_values:
            return min(numeric_values), max(numeric_values)

    question_order = exam_payload.get("questionOrder")
    if isinstance(question_order, list):
        numeric_values = []
        for item in question_order:
            match = re.match(r"^q(\d+)$", str(item).strip(), re.IGNORECASE)
            if match:
                numeric_values.append(int(match.group(1)))
        if numeric_values:
            return min(numeric_values), max(numeric_values)
    return None


def _extract_explanation_question_range(explanation_payload: dict) -> Optional[Tuple[int, int]]:
    question_sections = explanation_payload.get("questionExplanations")
    if not isinstance(question_sections, list):
        return None
    starts: List[int] = []
    ends: List[int] = []
    for section in question_sections:
        if not isinstance(section, dict):
            continue
        question_range = section.get("questionRange")
        if not isinstance(question_range, dict):
            continue
        start = question_range.get("start")
        end = question_range.get("end")
        if isinstance(start, int) and isinstance(end, int):
            starts.append(start)
            ends.append(end)
    if not starts or not ends:
        return None
    return min(starts), max(ends)


def _check_reading_explanation_alignment() -> Tuple[bool, dict]:
    exams_dir = REPO_ROOT / "assets" / "generated" / "reading-exams"
    explanations_dir = REPO_ROOT / "assets" / "generated" / "reading-explanations"
    if not exams_dir.exists() or not explanations_dir.exists():
        return False, {"error": "reading-exams 或 reading-explanations 目录缺失"}

    exam_payloads: Dict[str, dict] = {}
    explanation_payloads: Dict[str, dict] = {}

    for exam_file in sorted(exams_dir.glob("*.js")):
        payload = _extract_registered_payload(exam_file)
        if not payload:
            continue
        exam_id = str(payload.get("examId") or "").strip()
        if exam_id:
            exam_payloads[exam_id] = payload

    for explanation_file in sorted(explanations_dir.glob("*.js")):
        payload = _extract_registered_payload(explanation_file)
        if not payload:
            continue
        exam_id = str(payload.get("examId") or "").strip()
        if exam_id:
            explanation_payloads[exam_id] = payload

    missing_explanations = sorted([exam_id for exam_id in exam_payloads.keys() if exam_id not in explanation_payloads])
    mismatches: List[dict] = []

    for exam_id, explanation in explanation_payloads.items():
        exam = exam_payloads.get(exam_id)
        if not exam:
            mismatches.append({
                "examId": exam_id,
                "reason": "explanation_orphan",
                "detail": "存在解析，但找不到同 examId 的阅读题目",
            })
            continue

        exam_meta = exam.get("meta") if isinstance(exam.get("meta"), dict) else {}
        explanation_meta = explanation.get("meta") if isinstance(explanation.get("meta"), dict) else {}
        exam_title = str(exam_meta.get("title") or "")
        explanation_title = str(explanation_meta.get("title") or "")
        normalized_exam_title = _normalize_title_for_similarity(exam_title)
        normalized_explanation_title = _normalize_title_for_similarity(explanation_title)
        similarity = SequenceMatcher(None, normalized_exam_title, normalized_explanation_title).ratio()
        if normalized_exam_title and normalized_explanation_title and similarity < 0.45:
            mismatches.append({
                "examId": exam_id,
                "reason": "title_similarity_low",
                "detail": {
                    "examTitle": exam_title,
                    "explanationTitle": explanation_title,
                    "similarity": round(similarity, 3),
                },
            })

        exam_range = _extract_exam_question_range(exam)
        explanation_range = _extract_explanation_question_range(explanation)
        if exam_range and explanation_range:
            exam_start, exam_end = exam_range
            exp_start, exp_end = explanation_range
            overlap_start = max(exam_start, exp_start)
            overlap_end = min(exam_end, exp_end)
            has_overlap = overlap_start <= overlap_end
            if not has_overlap:
                mismatches.append({
                    "examId": exam_id,
                    "reason": "question_range_mismatch",
                    "detail": {
                        "examRange": [exam_start, exam_end],
                        "explanationRange": [exp_start, exp_end],
                    },
                })

    passed = not mismatches
    detail = {
        "examCount": len(exam_payloads),
        "explanationCount": len(explanation_payloads),
        "missingExplanations": len(missing_explanations),
        "mismatchCount": len(mismatches),
        "mismatches": mismatches[:20],
    }
    return passed, detail


def _format_result(name: str, passed: bool, detail: str) -> dict:
    return {
        "name": name,
        "status": "pass" if passed else "fail",
        "detail": detail,
    }


def _ensure_exists(path: Path) -> Tuple[bool, str]:
    exists = path.exists()
    return exists, ("已找到" if exists else "文件缺失")


def _run_json_subprocess(
    command: List[str],
    timeout: int,
    *,
    env: Optional[Dict[str, str]] = None,
    parse_mode: str = "stdout",
) -> Tuple[bool, Any]:
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return False, f"执行超时（{timeout}秒）"
    except subprocess.CalledProcessError as exc:
        output_text = exc.stdout or exc.stderr or str(exc)
        return False, f"执行失败: {output_text.strip()}"

    if parse_mode == "last-line":
        output_lines = [line.strip() for line in (completed.stdout or "").splitlines() if line.strip()]
        parse_target = output_lines[-1] if output_lines else ""
    else:
        parse_target = completed.stdout.strip() or completed.stderr.strip()

    try:
        payload = json.loads(parse_target or "{}")
    except json.JSONDecodeError as parse_error:
        return False, f"输出解析失败: {parse_error}"
    return True, payload


def run_checks() -> Tuple[List[dict], bool]:
    results: List[dict] = []
    all_passed = True

    main_entry = REPO_ROOT / "js" / "app" / "main-entry.js"

    # Core entry point presence
    index_file = REPO_ROOT / "index.html"
    passed, detail = _ensure_exists(index_file)
    results.append(_format_result("index.html 存在性", passed, detail))
    all_passed &= passed

    # Static regression harnesses should start with a doctype for consistent rendering
    static_html_files = sorted((REPO_ROOT / "developer" / "tests").glob("*.html"))
    for html_path in static_html_files:
        passed, detail = _check_html_doctype(html_path)
        results.append(_format_result(f"{html_path.name} Doctype", passed, detail))
        all_passed &= passed

    # End-to-end runner integrity checks
    e2e_runner = REPO_ROOT / "developer" / "tests" / "e2e" / "app-e2e-runner.html"
    passed, detail = _ensure_exists(e2e_runner)
    results.append(_format_result("E2E runner 文件存在性", passed, detail))
    all_passed &= passed

    if passed:
        runner_checks = {
            "包含 app-frame iframe": 'id="app-frame"',
            "声明 sandbox 权限": 'sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"',
        }
        for label, snippet in runner_checks.items():
            check_passed, check_detail = _check_contains(e2e_runner, snippet)
            results.append(_format_result(f"E2E runner: {label}", check_passed, check_detail))
            all_passed &= check_passed

        required_scripts = [
            REPO_ROOT / "developer" / "tests" / "js" / "e2e" / name
            for name in ("indexSnapshot.js", "bootstrapAppFrame.js", "appE2ETest.js")
        ]
        for script_path in required_scripts:
            script_passed, script_detail = _ensure_exists(script_path)
            results.append(_format_result(f"E2E 依赖 {script_path.name}", script_passed, script_detail))
            all_passed &= script_passed

        fixture_path = REPO_ROOT / "developer" / "tests" / "e2e" / "fixtures" / "data-integrity-import-sample.json"
        fixture_passed, fixture_detail = _ensure_exists(fixture_path)
        results.append(_format_result("E2E 导入样例数据", fixture_passed, fixture_detail))
        all_passed &= fixture_passed

        app_e2e_script = REPO_ROOT / "developer" / "tests" / "js" / "e2e" / "appE2ETest.js"
        if app_e2e_script.exists():
            snippet_passed, snippet_detail = _check_contains(app_e2e_script, "testDataIntegrityImportFlow")
            results.append(_format_result("E2E 导入测试存在性", snippet_passed, snippet_detail))
            all_passed &= snippet_passed

        interaction_path = REPO_ROOT / "developer" / "tests" / "js" / "e2e" / "interactionTargets.js"
        targets, detail = _load_interaction_targets(interaction_path)
        targets_passed = targets is not None
        results.append(_format_result("E2E 交互目标配置", targets_passed, detail))
        all_passed &= targets_passed

        if targets_passed:
            structure = _parse_app_structure(index_file)
            nav_dom = sorted(set(structure.nav_views))
            nav_config = sorted(set(targets["mainNavigationViews"]))
            nav_missing_in_config = sorted(set(nav_dom) - set(nav_config))
            nav_missing_in_dom = sorted(set(nav_config) - set(nav_dom))
            nav_passed = not nav_missing_in_config and not nav_missing_in_dom
            nav_detail = {
                "dom": nav_dom,
                "config": nav_config,
                "domOnly": nav_missing_in_config,
                "configOnly": nav_missing_in_dom,
            }
            results.append(_format_result("导航视图覆盖", nav_passed, nav_detail))
            all_passed &= nav_passed

            settings_dom = sorted(set(structure.settings_button_ids))
            settings_config = sorted(set(targets["settingsButtonIds"]))
            settings_missing_in_config = sorted(set(settings_dom) - set(settings_config))
            settings_missing_in_dom = sorted(set(settings_config) - set(settings_dom))
            settings_passed = not settings_missing_in_config and not settings_missing_in_dom
            settings_detail = {
                "dom": settings_dom,
                "config": settings_config,
                "domOnly": settings_missing_in_config,
                "configOnly": settings_missing_in_dom,
            }
            results.append(_format_result("设置按钮覆盖", settings_passed, settings_detail))
            all_passed &= settings_passed

    reading_e2e = REPO_ROOT / "developer" / "tests" / "e2e" / "reading_single_flow.py"
    reading_exists, reading_detail = _ensure_exists(reading_e2e)
    results.append(_format_result("Reading 单篇 E2E 脚本存在性", reading_exists, reading_detail))
    all_passed &= reading_exists
    if reading_exists:
        reading_checks = {
            "校验主链路 openExam": "window.app.openExam",
            "禁止 fallback 路径": "fallback_hits",
            "禁止 synthetic 路径": "synthetic_hits",
        }
        for label, snippet in reading_checks.items():
            check_passed, check_detail = _check_contains(reading_e2e, snippet)
            results.append(_format_result(f"Reading 单篇 E2E: {label}", check_passed, check_detail))
            all_passed &= check_passed

    browse_toggle_e2e = REPO_ROOT / "developer" / "tests" / "e2e" / "browse_preference_toggle_flow.py"
    browse_toggle_exists, browse_toggle_detail = _ensure_exists(browse_toggle_e2e)
    results.append(_format_result("Browse 偏好切换 E2E 脚本存在性", browse_toggle_exists, browse_toggle_detail))
    all_passed &= browse_toggle_exists
    if browse_toggle_exists:
        browse_toggle_checks = {
            "校验触发按钮": "browse-title-trigger",
            "校验红点显隐": "browse-title-dot",
            "校验偏好写回": "browse_view_preferences_v2",
        }
        for label, snippet in browse_toggle_checks.items():
            check_passed, check_detail = _check_contains(browse_toggle_e2e, snippet)
            results.append(_format_result(f"Browse 偏好切换 E2E: {label}", check_passed, check_detail))
            all_passed &= check_passed

    reading_e2e_node = REPO_ROOT / "developer" / "tests" / "e2e" / "reading_single_flow.node.js"
    reading_node_exists, reading_node_detail = _ensure_exists(reading_e2e_node)
    results.append(_format_result("Reading 单篇 E2E Node 回退脚本", reading_node_exists, reading_node_detail))
    all_passed &= reading_node_exists
    if reading_node_exists:
        node_checks = {
            "校验主链路 openExam": "window.app.openExam",
            "禁止 fallback 路径": "fallbackHits",
            "禁止 synthetic 路径": "syntheticHits",
        }
        for label, snippet in node_checks.items():
            check_passed, check_detail = _check_contains(reading_e2e_node, snippet)
            results.append(_format_result(f"Reading Node 回退: {label}", check_passed, check_detail))
            all_passed &= check_passed

    unified_e2e_runner = REPO_ROOT / "developer" / "tests" / "e2e" / "e2e_runner.py"
    unified_exists, unified_detail = _ensure_exists(unified_e2e_runner)
    results.append(_format_result("Unified E2E Runner 存在性", unified_exists, unified_detail))
    all_passed &= unified_exists
    if unified_exists:
        unified_checks = {
            "包含 browse_preference_toggle_flow": "browse_preference_toggle_flow.py",
            "包含 reading_single_flow": "reading_single_flow.py",
            "包含 suite_practice_flow": "suite_practice_flow.py",
            "输出统一报告": "e2e-unified-report.json",
        }
        for label, snippet in unified_checks.items():
            check_passed, check_detail = _check_contains(unified_e2e_runner, snippet)
            results.append(_format_result(f"Unified E2E Runner: {label}", check_passed, check_detail))
            all_passed &= check_passed

    data_layer_files = [
        REPO_ROOT / "js" / "data" / "dataSources" / "storageDataSource.js",
    ]
    data_layer_files.extend(
        REPO_ROOT / "js" / "data" / "repositories" / name
        for name in (
            "baseRepository.js",
            "dataRepositoryRegistry.js",
            "practiceRepository.js",
            "settingsRepository.js",
            "backupRepository.js",
            "metaRepository.js",
        )
    )
    data_layer_files.append(REPO_ROOT / "js" / "data" / "index.js")
    for path in data_layer_files:
        file_passed, file_detail = _ensure_exists(path)
        results.append(_format_result(f"数据层资产 {path.name}", file_passed, file_detail))
        all_passed &= file_passed

    registry_path = REPO_ROOT / "js" / "core" / "storageProviderRegistry.js"
    registry_exists, registry_detail = _ensure_exists(registry_path)
    results.append(_format_result("StorageProviderRegistry 存在性", registry_exists, registry_detail))
    all_passed &= registry_exists

    simple_wrapper = REPO_ROOT / "js" / "utils" / "simpleStorageWrapper.js"
    wrapper_passed, wrapper_detail = _check_contains(simple_wrapper, "dataRepositories")
    results.append(_format_result("simpleStorageWrapper 适配数据仓库", wrapper_passed, wrapper_detail))
    all_passed &= wrapper_passed

    on_demand_ok, on_demand_detail = _check_main_entry_on_demand(main_entry)
    results.append(_format_result("main-entry 严格按需启动策略", on_demand_ok, on_demand_detail))
    all_passed &= on_demand_ok

    app_js_path = REPO_ROOT / "js" / "app.js"
    app_boot_ok, app_boot_detail = _check_app_js_non_blocking_boot(app_js_path)
    results.append(_format_result("app.js 不等待 browseReady", app_boot_ok, app_boot_detail))
    all_passed &= app_boot_ok

    lazy_loader_path = REPO_ROOT / "js" / "runtime" / "lazyLoader.js"
    dedupe_ok, dedupe_detail = _check_lazy_loader_dedupe(lazy_loader_path)
    results.append(_format_result("lazyLoader 静态脚本去重", dedupe_ok, dedupe_detail))
    all_passed &= dedupe_ok

    practice_recorder_path = REPO_ROOT / "js" / "core" / "practiceRecorder.js"
    synthetic_guard_ok, synthetic_guard_detail = _check_practice_recorder_synthetic_guard(practice_recorder_path)
    results.append(_format_result("PracticeRecorder 生产 synthetic 保护", synthetic_guard_ok, synthetic_guard_detail))
    all_passed &= synthetic_guard_ok

    main_js_path = REPO_ROOT / "js" / "main.js"
    resource_core_path = REPO_ROOT / "js" / "core" / "resourceCore.js"
    main_js_exists, main_js_detail = _ensure_exists(main_js_path)
    results.append(_format_result("main.js 存在性", main_js_exists, main_js_detail))
    all_passed &= main_js_exists

    resource_core_exists, resource_core_detail = _ensure_exists(resource_core_path)
    results.append(_format_result("resourceCore.js 存在性", resource_core_exists, resource_core_detail))
    all_passed &= resource_core_exists

    main_js_source: Optional[str] = None
    resource_core_source: Optional[str] = None
    if main_js_exists:
        try:
            main_js_source = main_js_path.read_text(encoding="utf-8")
        except Exception as exc:  # pragma: no cover - defensive guard
            read_detail = f"读取失败：{exc}"
            results.append(_format_result("main.js 读取", False, read_detail))
            all_passed = False
    if resource_core_exists:
        try:
            resource_core_source = resource_core_path.read_text(encoding="utf-8")
        except Exception as exc:  # pragma: no cover - defensive guard
            read_detail = f"读取失败：{exc}"
            results.append(_format_result("resourceCore.js 读取", False, read_detail))
            all_passed = False

    if main_js_source is not None:
        switch_passed, switch_detail = _check_js_body_forbidden(main_js_source, "switchLibraryConfig", "confirm(")
        results.append(_format_result("switchLibraryConfig 禁止 confirm", switch_passed, switch_detail))
        all_passed &= switch_passed

        shim_passed, shim_detail = _check_window_load_library_shim(main_js_source)
        results.append(_format_result("loadLibrary 全局 shim 防递归", shim_passed, shim_detail))
        all_passed &= shim_passed

        internal_passed, internal_detail = _check_js_function_definition(main_js_source, "loadLibraryInternal")
        results.append(_format_result("loadLibraryInternal 定义存在性", internal_passed, internal_detail))
        all_passed &= internal_passed

    if resource_core_source is not None:
        for helper_name in ("buildOverridePathMap", "mergeRootWithFallback"):
            helper_passed, helper_detail = _check_js_function_definition(resource_core_source, helper_name)
            results.append(_format_result(f"ResourceCore {helper_name} 定义存在性", helper_passed, helper_detail))
            all_passed &= helper_passed

        resolve_passed, resolve_detail = _check_resolve_exam_base_path(resource_core_source)
        results.append(_format_result("ResourceCore resolveExamBasePath 路径组合逻辑", resolve_passed, resolve_detail))
        all_passed &= resolve_passed

    complete_exam_data = REPO_ROOT / "assets" / "scripts" / "complete-exam-data.js"
    complete_meta_passed, complete_meta_detail = _ensure_exists(complete_exam_data)
    results.append(_format_result("complete-exam-data.js 存在性", complete_meta_passed, complete_meta_detail))
    all_passed &= complete_meta_passed

    path_map_path = REPO_ROOT / "assets" / "data" / "path-map.json"
    path_map_passed, path_map_detail = _check_json_path_map(path_map_path)
    results.append(_format_result("path-map.json 路径映射", path_map_passed, path_map_detail))
    all_passed &= path_map_passed

    lazy_loader_path = REPO_ROOT / "js" / "runtime" / "lazyLoader.js"
    if lazy_loader_path.exists():
        lazy_loader_source = lazy_loader_path.read_text(encoding="utf-8")
        legacy_listening_ref_absent = "assets/scripts/listening-exam-data.js" not in lazy_loader_source
        results.append(_format_result(
            "lazyLoader 已移除 listening-exam-data.js 依赖",
            legacy_listening_ref_absent,
            "未检测到旧 listening 数据脚本引用" if legacy_listening_ref_absent else "仍检测到旧 listening 数据脚本引用",
        ))
        all_passed &= legacy_listening_ref_absent

    explanation_alignment_passed, explanation_alignment_detail = _check_reading_explanation_alignment()
    results.append(_format_result("阅读题目-解析一致性校验", explanation_alignment_passed, explanation_alignment_detail))
    all_passed &= explanation_alignment_passed

    practice_fixture = REPO_ROOT / "templates" / "ci-practice-fixtures" / "analysis-of-fear.html"
    fixture_exists, fixture_detail = _ensure_exists(practice_fixture)
    results.append(_format_result("练习页面测试模板存在性", fixture_exists, fixture_detail))
    all_passed &= fixture_exists

    if fixture_exists:
        fixture_doctype, doctype_detail = _check_html_doctype(practice_fixture)
        results.append(_format_result("练习模板 Doctype", fixture_doctype, doctype_detail))
        all_passed &= fixture_doctype

        fixture_checks = {
            "包含 PRACTICE_COMPLETE 消息": "PRACTICE_COMPLETE",
            "包含 practicePageEnhancer 钩子": "practicePageEnhancer"
        }
        for label, snippet in fixture_checks.items():
            check_passed, check_detail = _check_contains(practice_fixture, snippet)
            results.append(_format_result(f"练习模板: {label}", check_passed, check_detail))
            all_passed &= check_passed

    e2e_suite = REPO_ROOT / "developer" / "tests" / "js" / "e2e" / "appE2ETest.js"
    bulk_test_passed, bulk_test_detail = _check_contains(e2e_suite, "练习历史批量删除")
    results.append(_format_result("E2E 批量删除测试覆盖", bulk_test_passed, bulk_test_detail))
    all_passed &= bulk_test_passed

    contract_path = REPO_ROOT / "developer" / "tests" / "fixtures" / "exam_app_method_contract.json"
    contract_exists, contract_detail = _ensure_exists(contract_path)
    results.append(_format_result("Mixin 方法契约文件", contract_exists, contract_detail))
    all_passed &= contract_exists

    if contract_exists:
        try:
            raw_contract = contract_path.read_text(encoding="utf-8")
            expected_methods = json.loads(raw_contract)
            if not isinstance(expected_methods, list):
                raise ValueError("契约数据不是列表")
            expected_set = set(expected_methods)
        except Exception as exc:  # pragma: no cover - defensive guard
            results.append(_format_result("Mixin 方法契约覆盖", False, f"无法解析契约：{exc}"))
            all_passed = False
        else:
            actual_methods = set(_collect_mixin_methods(REPO_ROOT / "js" / "app"))
            missing = sorted(expected_set - actual_methods)
            extras = sorted(actual_methods - expected_set)
            coverage_passed = len(missing) == 0
            coverage_detail = {
                "expectedCount": len(expected_set),
                "actualCount": len(actual_methods),
                "missing": missing,
                "extras": extras,
            }
            results.append(_format_result("Mixin 方法契约覆盖", coverage_passed, coverage_detail))
            all_passed &= coverage_passed

    sanitizer_test = REPO_ROOT / "developer" / "tests" / "js" / "answerSanitizer.test.js"
    if sanitizer_test.exists():
        try:
            completed_sanitizer = subprocess.run(
                ["node", str(sanitizer_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            sanitizer_passed = False
            sanitizer_detail = f"执行失败: {(exc.stdout or exc.stderr or str(exc)).strip()}"
        else:
            sanitizer_passed = True
            sanitizer_detail = completed_sanitizer.stdout.strip() or "已执行"
        results.append(_format_result("AnswerSanitizer 单元测试", sanitizer_passed, sanitizer_detail))
        all_passed &= sanitizer_passed
    else:
        results.append(_format_result("AnswerSanitizer 单元测试", False, "测试脚本缺失"))
        all_passed = False

    suite_flow_test = REPO_ROOT / "developer" / "tests" / "js" / "suiteModeFlow.test.js"
    if suite_flow_test.exists():
        try:
            completed = subprocess.run(
                ["node", str(suite_flow_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            result_detail = f"执行失败: {output_text.strip()}"
            suite_passed = False
        else:
            raw_output = completed.stdout.strip() or completed.stderr.strip()
            try:
                payload = json.loads(raw_output or "{}")
            except json.JSONDecodeError as parse_error:
                suite_passed = False
                result_detail = f"输出解析失败: {parse_error}"
            else:
                suite_passed = payload.get("status") == "pass"
                result_detail = payload.get("detail", payload)
        results.append(_format_result("套题模式首篇衔接测试", suite_passed, result_detail))
        all_passed &= suite_passed
    else:
        results.append(_format_result("套题模式首篇衔接测试", False, "测试脚本缺失"))
        all_passed = False

    suite_regression_test = REPO_ROOT / "developer" / "tests" / "js" / "suiteModeRegression.test.js"
    if suite_regression_test.exists():
        try:
            completed_suite_regression = subprocess.run(
                ["node", str(suite_regression_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            suite_regression_passed = False
            suite_regression_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_suite_regression = completed_suite_regression.stdout.strip() or completed_suite_regression.stderr.strip()
            try:
                suite_regression_payload = json.loads(raw_suite_regression or "{}")
            except json.JSONDecodeError as parse_error:
                suite_regression_passed = False
                suite_regression_detail = f"输出解析失败: {parse_error}"
            else:
                suite_regression_passed = suite_regression_payload.get("status") == "pass"
                suite_regression_detail = suite_regression_payload.get("detail", suite_regression_payload)
        results.append(_format_result("套题模式状态机回归测试", suite_regression_passed, suite_regression_detail))
        all_passed &= suite_regression_passed
    else:
        results.append(_format_result("套题模式状态机回归测试", False, "测试脚本缺失"))
        all_passed = False

    simulation_nb_drag_test = REPO_ROOT / "developer" / "tests" / "e2e" / "simulation_nb_drag_regression.py"
    if simulation_nb_drag_test.exists():
        try:
            completed_sim_nb_drag = subprocess.run(
                ["python3", str(simulation_nb_drag_test)],
                check=True,
                capture_output=True,
                text=True,
                timeout=240,
            )
        except subprocess.TimeoutExpired:
            sim_nb_drag_passed = False
            sim_nb_drag_detail = "执行超时（240秒）"
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            sim_nb_drag_passed = False
            sim_nb_drag_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_sim_nb_drag = completed_sim_nb_drag.stdout.strip() or completed_sim_nb_drag.stderr.strip()
            try:
                sim_nb_drag_payload = json.loads(raw_sim_nb_drag or "{}")
            except json.JSONDecodeError as parse_error:
                sim_nb_drag_passed = False
                sim_nb_drag_detail = f"输出解析失败: {parse_error}"
            else:
                sim_nb_drag_passed = sim_nb_drag_payload.get("status") == "pass"
                sim_nb_drag_detail = sim_nb_drag_payload.get("detail", sim_nb_drag_payload)
        results.append(_format_result("模拟模式 NB 拖拽回灌回归测试", sim_nb_drag_passed, sim_nb_drag_detail))
        all_passed &= sim_nb_drag_passed
    else:
        results.append(_format_result("模拟模式 NB 拖拽回灌回归测试", False, "测试脚本缺失"))
        all_passed = False

    simulation_roundtrip_restore_test = REPO_ROOT / "developer" / "tests" / "e2e" / "simulation_roundtrip_restore_regression.py"
    if simulation_roundtrip_restore_test.exists():
        try:
            completed_sim_roundtrip_restore = subprocess.run(
                ["python3", str(simulation_roundtrip_restore_test)],
                check=True,
                capture_output=True,
                text=True,
                timeout=360,
            )
        except subprocess.TimeoutExpired:
            sim_roundtrip_restore_passed = False
            sim_roundtrip_restore_detail = "执行超时（360秒）"
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            sim_roundtrip_restore_passed = False
            sim_roundtrip_restore_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_sim_roundtrip_restore = completed_sim_roundtrip_restore.stdout.strip() or completed_sim_roundtrip_restore.stderr.strip()
            try:
                sim_roundtrip_restore_payload = json.loads(raw_sim_roundtrip_restore or "{}")
            except json.JSONDecodeError as parse_error:
                sim_roundtrip_restore_passed = False
                sim_roundtrip_restore_detail = f"输出解析失败: {parse_error}"
            else:
                sim_roundtrip_restore_passed = sim_roundtrip_restore_payload.get("status") == "pass"
                sim_roundtrip_restore_detail = sim_roundtrip_restore_payload.get("detail", sim_roundtrip_restore_payload)
        results.append(_format_result("模拟模式切题回灌回归测试", sim_roundtrip_restore_passed, sim_roundtrip_restore_detail))
        all_passed &= sim_roundtrip_restore_passed
    else:
        results.append(_format_result("模拟模式切题回灌回归测试", False, "测试脚本缺失"))
        all_passed = False

    inline_fallback_test = REPO_ROOT / "developer" / "tests" / "js" / "suiteInlineFallback.test.js"
    if inline_fallback_test.exists():
        try:
            completed_inline = subprocess.run(
                ["node", str(inline_fallback_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            inline_passed = False
            inline_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_inline_output = completed_inline.stdout.strip() or completed_inline.stderr.strip()
            try:
                inline_payload = json.loads(raw_inline_output or "{}")
            except json.JSONDecodeError as parse_error:
                inline_passed = False
                inline_detail = f"输出解析失败: {parse_error}"
            else:
                inline_passed = inline_payload.get("status") == "pass"
                inline_detail = inline_payload.get("detail", inline_payload)
        results.append(_format_result("套题模式内联注入测试", inline_passed, inline_detail))
        all_passed &= inline_passed
    else:
        results.append(_format_result("套题模式内联注入测试", False, "测试脚本缺失"))
        all_passed = False

    # Full library record matching test
    full_library_test = REPO_ROOT / "developer" / "tests" / "js" / "fullLibraryRecordMatching.test.js"
    if full_library_test.exists():
        try:
            completed_full_lib = subprocess.run(
                ["node", str(full_library_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            full_lib_passed = False
            full_lib_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_full_lib_output = completed_full_lib.stdout.strip() or completed_full_lib.stderr.strip()
            try:
                full_lib_payload = json.loads(raw_full_lib_output or "{}")
            except json.JSONDecodeError as parse_error:
                full_lib_passed = False
                full_lib_detail = f"输出解析失败: {parse_error}"
            else:
                full_lib_passed = full_lib_payload.get("status") == "pass"
                full_lib_detail = full_lib_payload.get("detail", full_lib_payload)
        results.append(_format_result("全量题库记录匹配测试", full_lib_passed, full_lib_detail))
        all_passed &= full_lib_passed
    else:
        results.append(_format_result("全量题库记录匹配测试", False, "测试脚本缺失"))
        all_passed = False

    practice_core_test = REPO_ROOT / "developer" / "tests" / "js" / "practiceCore.test.js"
    if practice_core_test.exists():
        try:
            completed_practice_core = subprocess.run(
                ["node", str(practice_core_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            practice_core_passed = False
            practice_core_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_practice_core_output = completed_practice_core.stdout.strip() or completed_practice_core.stderr.strip()
            try:
                practice_core_payload = json.loads(raw_practice_core_output or "{}")
            except json.JSONDecodeError as parse_error:
                practice_core_passed = False
                practice_core_detail = f"输出解析失败: {parse_error}"
            else:
                practice_core_passed = practice_core_payload.get("status") == "pass"
                practice_core_detail = practice_core_payload.get("detail", practice_core_payload)
        results.append(_format_result("PracticeCore 单元测试", practice_core_passed, practice_core_detail))
        all_passed &= practice_core_passed
    else:
        results.append(_format_result("PracticeCore 单元测试", False, "测试脚本缺失"))
        all_passed = False

    resource_core_test = REPO_ROOT / "developer" / "tests" / "js" / "resourceCore.test.js"
    if resource_core_test.exists():
        try:
            completed_resource_core = subprocess.run(
                ["node", str(resource_core_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            resource_core_passed = False
            resource_core_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_resource_core_output = completed_resource_core.stdout.strip() or completed_resource_core.stderr.strip()
            try:
                resource_core_payload = json.loads(raw_resource_core_output or "{}")
            except json.JSONDecodeError as parse_error:
                resource_core_passed = False
                resource_core_detail = f"输出解析失败: {parse_error}"
            else:
                resource_core_passed = resource_core_payload.get("status") == "pass"
                resource_core_detail = resource_core_payload.get("detail", resource_core_payload)
        results.append(_format_result("ResourceCore 单元测试", resource_core_passed, resource_core_detail))
        all_passed &= resource_core_passed
    else:
        results.append(_format_result("ResourceCore 单元测试", False, "测试脚本缺失"))
        all_passed = False

    on_demand_entry_test = REPO_ROOT / "developer" / "tests" / "js" / "onDemandEntrypoints.test.js"
    if on_demand_entry_test.exists():
        try:
            completed_on_demand = subprocess.run(
                ["node", str(on_demand_entry_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            on_demand_passed = False
            on_demand_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_on_demand_output = completed_on_demand.stdout.strip() or completed_on_demand.stderr.strip()
            try:
                on_demand_payload = json.loads(raw_on_demand_output or "{}")
            except json.JSONDecodeError as parse_error:
                on_demand_passed = False
                on_demand_detail = f"输出解析失败: {parse_error}"
            else:
                on_demand_passed = on_demand_payload.get("status") == "pass"
                on_demand_detail = on_demand_payload.get("detail", on_demand_payload)
        results.append(_format_result("按需入口回归测试", on_demand_passed, on_demand_detail))
        all_passed &= on_demand_passed
    else:
        results.append(_format_result("按需入口回归测试", False, "测试脚本缺失"))
        all_passed = False

    practice_core_guard_test = REPO_ROOT / "developer" / "tests" / "js" / "practiceCore.guard.test.js"
    if practice_core_guard_test.exists():
        try:
            completed_practice_core_guard = subprocess.run(
                ["node", str(practice_core_guard_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            practice_core_guard_passed = False
            practice_core_guard_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_guard_output = completed_practice_core_guard.stdout.strip() or completed_practice_core_guard.stderr.strip()
            try:
                practice_core_guard_payload = json.loads(raw_guard_output or "{}")
            except json.JSONDecodeError as parse_error:
                practice_core_guard_passed = False
                practice_core_guard_detail = f"输出解析失败: {parse_error}"
            else:
                practice_core_guard_passed = practice_core_guard_payload.get("status") == "pass"
                practice_core_guard_detail = practice_core_guard_payload.get("detail", practice_core_guard_payload)
        results.append(_format_result("PracticeCore 静态守卫", practice_core_guard_passed, practice_core_guard_detail))
        all_passed &= practice_core_guard_passed
    else:
        results.append(_format_result("PracticeCore 静态守卫", False, "测试脚本缺失"))
        all_passed = False

    practice_record_persistence_test = REPO_ROOT / "developer" / "tests" / "js" / "practiceRecordPersistence.test.js"
    if practice_record_persistence_test.exists():
        try:
            completed_practice_record_persistence = subprocess.run(
                ["node", str(practice_record_persistence_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            practice_record_persistence_passed = False
            practice_record_persistence_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_persistence_output = completed_practice_record_persistence.stdout.strip() or completed_practice_record_persistence.stderr.strip()
            try:
                practice_record_persistence_payload = json.loads(raw_persistence_output or "{}")
            except json.JSONDecodeError as parse_error:
                practice_record_persistence_passed = False
                practice_record_persistence_detail = f"输出解析失败: {parse_error}"
            else:
                practice_record_persistence_passed = practice_record_persistence_payload.get("status") == "pass"
                practice_record_persistence_detail = practice_record_persistence_payload.get("detail", practice_record_persistence_payload)
        results.append(_format_result("练习记录持久化删除链路测试", practice_record_persistence_passed, practice_record_persistence_detail))
        all_passed &= practice_record_persistence_passed
    else:
        results.append(_format_result("练习记录持久化删除链路测试", False, "测试脚本缺失"))
        all_passed = False

    practice_core_app_state_sync_test = REPO_ROOT / "developer" / "tests" / "js" / "practiceCoreAppStateSync.test.js"
    if practice_core_app_state_sync_test.exists():
        try:
            completed_practice_core_app_state_sync = subprocess.run(
                ["node", str(practice_core_app_state_sync_test)],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            practice_core_app_state_sync_passed = False
            practice_core_app_state_sync_detail = f"执行失败: {output_text.strip()}"
        else:
            raw_app_state_output = completed_practice_core_app_state_sync.stdout.strip() or completed_practice_core_app_state_sync.stderr.strip()
            try:
                practice_core_app_state_sync_payload = json.loads(raw_app_state_output or "{}")
            except json.JSONDecodeError as parse_error:
                practice_core_app_state_sync_passed = False
                practice_core_app_state_sync_detail = f"输出解析失败: {parse_error}"
            else:
                practice_core_app_state_sync_passed = practice_core_app_state_sync_payload.get("status") == "pass"
                practice_core_app_state_sync_detail = practice_core_app_state_sync_payload.get("detail", practice_core_app_state_sync_payload)
        results.append(_format_result("PracticeCore app.state 同步测试", practice_core_app_state_sync_passed, practice_core_app_state_sync_detail))
        all_passed &= practice_core_app_state_sync_passed
    else:
        results.append(_format_result("PracticeCore app.state 同步测试", False, "测试脚本缺失"))
        all_passed = False

    # Integration tests
    deprecated_reading_source_dir = REPO_ROOT / "developer" / "reading-exams"
    integration_tests = [
        ("Reading migration snapshot integration test", REPO_ROOT / "developer" / "tests" / "js" / "integration" / "readingMigrationSnapshot.test.js"),
        ("多套题提交流程集成测试", REPO_ROOT / "developer" / "tests" / "js" / "integration" / "multiSuiteSubmission.test.js"),
        ("拼写错误收集流程集成测试", REPO_ROOT / "developer" / "tests" / "js" / "integration" / "spellingErrorCollection.test.js"),
        ("词表切换流程集成测试", REPO_ROOT / "developer" / "tests" / "js" / "integration" / "vocabListSwitching.test.js"),
        ("Vocab session view flow integration test", REPO_ROOT / "developer" / "tests" / "js" / "integration" / "vocabSessionView.test.js"),
    ]

    for test_name, test_path in integration_tests:
        if test_name == "Reading migration snapshot integration test" and not deprecated_reading_source_dir.exists():
            results.append(
                _format_result(
                    test_name,
                    True,
                    "显式跳过：developer/reading-exams 目录已废弃，迁移快照用例不再执行",
                )
            )
            continue

        if test_path.exists():
            try:
                completed_integration = subprocess.run(
                    ["node", str(test_path)],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            except subprocess.TimeoutExpired:
                integration_passed = False
                integration_detail = "执行超时（30秒）"
            except subprocess.CalledProcessError as exc:
                output_text = exc.stdout or exc.stderr or str(exc)
                integration_passed = False
                integration_detail = f"执行失败: {output_text.strip()}"
            else:
                raw_integration_output = completed_integration.stdout.strip() or completed_integration.stderr.strip()
                try:
                    integration_payload = json.loads(raw_integration_output or "{}")
                except json.JSONDecodeError as parse_error:
                    integration_passed = False
                    integration_detail = f"输出解析失败: {parse_error}"
                else:
                    integration_passed = integration_payload.get("status") == "pass"
                    passed_count = integration_payload.get("passed", 0)
                    total_count = integration_payload.get("total", 0)
                    integration_detail = {
                        "passed": passed_count,
                        "total": total_count,
                        "detail": integration_payload.get("detail", "")
                    }
            results.append(_format_result(test_name, integration_passed, integration_detail))
            all_passed &= integration_passed
        else:
            results.append(_format_result(test_name, False, "测试脚本缺失"))
            all_passed = False

    reading_question_audit_script = REPO_ROOT / "developer" / "tests" / "e2e" / "reading_question_audit.py"
    if reading_question_audit_script.exists():
        try:
            completed_reading_audit = subprocess.run(
                ["python3", str(reading_question_audit_script), "--mode", "quick"],
                check=True,
                capture_output=True,
                text=True,
                timeout=480,
            )
        except subprocess.TimeoutExpired:
            reading_audit_passed = False
            reading_audit_detail = "执行超时（480秒）"
        except subprocess.CalledProcessError as exc:
            output_text = exc.stdout or exc.stderr or str(exc)
            reading_audit_passed = False
            reading_audit_detail = f"执行失败: {output_text.strip()}"
        else:
            output_text = completed_reading_audit.stdout.strip() or completed_reading_audit.stderr.strip()
            reading_report_path = REPO_ROOT / "developer" / "tests" / "e2e" / "reports" / "reading-question-audit-quick.json"
            if reading_report_path.exists():
                try:
                    payload = json.loads(reading_report_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as parse_error:
                    reading_audit_passed = False
                    reading_audit_detail = f"报告解析失败: {parse_error}"
                else:
                    summary = payload.get("summary", {}) if isinstance(payload, dict) else {}
                    reading_audit_passed = summary.get("exitCode") == 0
                    reading_audit_detail = {
                        "staticAudited": summary.get("staticAudited", 0),
                        "staticFailed": summary.get("staticFailed", 0),
                        "uiAudited": summary.get("uiAudited", 0),
                        "uiFailed": summary.get("uiFailed", 0),
                        "report": "developer/tests/e2e/reports/reading-question-audit-quick.json",
                    }
            else:
                reading_audit_passed = False
                reading_audit_detail = f"缺少报告文件，输出: {output_text}"

        results.append(_format_result("Reading 逐题自动排查（quick）", reading_audit_passed, reading_audit_detail))
        all_passed &= reading_audit_passed
    else:
        results.append(_format_result("Reading 逐题自动排查（quick）", False, "测试脚本缺失"))
        all_passed = False

    pdf_audit_script = REPO_ROOT / "developer" / "tests" / "ci" / "audit_pdf_checklist_and_mona.py"
    if pdf_audit_script.exists():
        pdf_audit_passed, pdf_audit_detail = _run_json_subprocess(
            ["python3", str(pdf_audit_script)],
            timeout=120,
        )

        results.append(_format_result("PDF 对账与回归审计", pdf_audit_passed, pdf_audit_detail))
        all_passed &= pdf_audit_passed
    else:
        results.append(_format_result("PDF 对账与回归审计", False, "测试脚本缺失"))
        all_passed = False

    reading_integrity_script = REPO_ROOT / "developer" / "tests" / "ci" / "check_reading_data_integrity.py"
    if reading_integrity_script.exists():
        reading_integrity_passed, reading_integrity_detail = _run_json_subprocess(
            ["python3", str(reading_integrity_script)],
            timeout=30,
            parse_mode="last-line",
        )

        results.append(_format_result("Reading 数据完整性校验", reading_integrity_passed, reading_integrity_detail))
        all_passed &= reading_integrity_passed
    else:
        results.append(_format_result("Reading 数据完整性校验", False, "测试脚本缺失"))
        all_passed = False

    checklist_consistency_script = REPO_ROOT / "developer" / "tests" / "ci" / "check_checklist_consistency.py"
    if checklist_consistency_script.exists():
        checklist_env = os.environ.copy()
        checklist_env["CHECKLIST_IGNORE_RUN_STATIC_CLAIM"] = "1"
        checklist_consistency_ok, checklist_payload_or_error = _run_json_subprocess(
            ["python3", str(checklist_consistency_script)],
            timeout=30,
            env=checklist_env,
        )
        if not checklist_consistency_ok:
            checklist_consistency_passed = False
            checklist_consistency_detail = checklist_payload_or_error
        else:
            checklist_payload = checklist_payload_or_error if isinstance(checklist_payload_or_error, dict) else {}
            checklist_consistency_passed = (
                not checklist_payload.get("summaryMismatches")
                and not checklist_payload.get("claimMismatches")
                and not checklist_payload.get("freshnessMismatches")
            )
            checklist_consistency_detail = checklist_payload

        results.append(_format_result("Checklist 对账一致性校验", checklist_consistency_passed, checklist_consistency_detail))
        all_passed &= checklist_consistency_passed
    else:
        results.append(_format_result("Checklist 对账一致性校验", False, "测试脚本缺失"))
        all_passed = False

    return results, all_passed


def main() -> int:
    results, all_passed = run_checks()

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if all_passed else "fail",
        "results": results,
    }

    report_dir = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "static-ci-report.json"
    report_text = json.dumps(report, ensure_ascii=False, indent=2)
    report_path.write_text(report_text + "\n", encoding="utf-8")

    print(report_text)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
