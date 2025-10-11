#!/usr/bin/env python3
"""Static test aggregation for the IELTS practice app.

This module verifies the presence and basic structure of the
static end-to-end harness and HTML regression tests.  It is designed to be
invoked locally or inside CI before changes are merged.
"""
from __future__ import annotations

import json
import re
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
