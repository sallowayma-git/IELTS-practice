#!/usr/bin/env python3
"""Static test aggregation for the IELTS practice app.

This module verifies the presence and basic structure of the
static end-to-end harness and HTML regression tests.  It is designed to be
invoked locally or inside CI before changes are merged.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional, Tuple

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


def _format_result(name: str, passed: bool, detail: str) -> dict:
    return {
        "name": name,
        "status": "pass" if passed else "fail",
        "detail": detail,
    }


def _ensure_exists(path: Path) -> Tuple[bool, str]:
    exists = path.exists()
    return exists, ("已找到" if exists else "文件缺失")


def run_checks() -> Tuple[List[dict], bool]:
    results: List[dict] = []
    all_passed = True

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

    main_js_path = REPO_ROOT / "js" / "main.js"
    main_js_exists, main_js_detail = _ensure_exists(main_js_path)
    results.append(_format_result("main.js 存在性", main_js_exists, main_js_detail))
    all_passed &= main_js_exists

    main_js_source: Optional[str] = None
    if main_js_exists:
        try:
            main_js_source = main_js_path.read_text(encoding="utf-8")
        except Exception as exc:  # pragma: no cover - defensive guard
            read_detail = f"读取失败：{exc}"
            results.append(_format_result("main.js 读取", False, read_detail))
            all_passed = False

    if main_js_source is not None:
        switch_passed, switch_detail = _check_js_body_forbidden(main_js_source, "switchLibraryConfig", "confirm(")
        results.append(_format_result("switchLibraryConfig 禁止 confirm", switch_passed, switch_detail))
        all_passed &= switch_passed

        for helper_name in ("buildOverridePathMap", "mergeRootWithFallback"):
            helper_passed, helper_detail = _check_js_function_definition(main_js_source, helper_name)
            results.append(_format_result(f"{helper_name} 定义存在性", helper_passed, helper_detail))
            all_passed &= helper_passed

        resolve_passed, resolve_detail = _check_resolve_exam_base_path(main_js_source)
        results.append(_format_result("resolveExamBasePath 路径组合逻辑", resolve_passed, resolve_detail))
        all_passed &= resolve_passed

    metadata_targets = [
        REPO_ROOT / "assets" / "scripts" / "complete-exam-data.js",
        REPO_ROOT / "assets" / "scripts" / "listening-exam-data.js",
    ]
    for metadata_path in metadata_targets:
        meta_passed, meta_detail = _check_metadata_field(metadata_path)
        results.append(_format_result(f"{metadata_path.name} 根目录元数据", meta_passed, meta_detail))
        all_passed &= meta_passed

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
