#!/usr/bin/env python3
"""Agent-assisted generator for reading explanation JS bundles.

Workflow
1. `prepare`: extract trustworthy exam context from `reading-exams/*.js` and
   scaffold a response template for a translator agent.
2. Translator agent edits the scaffolded response JSON.
3. `render`: validate the agent response and emit the final explanation JS.

The translator agent hook lives in the generated JSON request/template files.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple


SCRIPT_REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("READING_EXPLANATION_REPO_ROOT") or SCRIPT_REPO_ROOT)
EXPLANATION_DIR = ROOT / "assets" / "generated" / "reading-explanations"
DEFAULT_WORK_DIR = ROOT / "developer" / "tests" / "artifacts" / "reading-explanation-agent"
HELPER_PATH = SCRIPT_REPO_ROOT / "developer" / "tests" / "py" / "extract_reading_exam_context.py"

PLACEHOLDER_PATTERNS: Tuple[str, ...] = (
    "根据具体题目分析",
    "同上",
    "[题目内容]",
    "题目翻译：[翻译]",
    "解析：[解析内容]",
)

JUDGEMENT_EQUIVALENTS = {
    "TRUE": {"TRUE", "YES"},
    "FALSE": {"FALSE", "NO"},
    "NOT GIVEN": {"NOT GIVEN", "NG"},
    "YES": {"YES", "TRUE"},
    "NO": {"NO", "FALSE"},
}

KIND_LABELS = {
    "true_false_not_given": "判断正误",
    "yes_no_not_given": "观点判断",
    "single_choice": "单项选择",
    "multi_choice": "多项选择",
    "summary_completion": "总结填空",
    "sentence_completion": "句子填空",
    "table_completion": "表格填空",
    "flow_chart_completion": "流程图填空",
    "diagram_completion": "图示填空",
    "short_answer": "简答题",
    "matching_information": "信息匹配",
    "matching_headings": "段落标题匹配",
    "matching_features": "特征匹配",
    "matching_sentence_endings": "句尾匹配",
    "note_completion": "笔记填空",
}


def load_extract_helper():
    spec = importlib.util.spec_from_file_location("extract_reading_exam_context", HELPER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 helper: {HELPER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_answer(value: Any) -> str:
    if isinstance(value, list):
        return " | ".join(normalize_answer(item) for item in value)
    text = normalize_whitespace(str(value or ""))
    text = text.strip("[]")
    text = text.replace("'", "").replace('"', "")
    text = re.sub(r"（.*?）", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    text = text.strip(" .;:，。")
    return text.upper()


def canonicalize_judgement(value: str) -> str:
    upper = normalize_answer(value)
    for canonical, variants in JUDGEMENT_EQUIVALENTS.items():
        if upper in variants:
            return canonical
    return upper


def equivalent_answers(expected: Any, actual: str) -> bool:
    expected_norm = normalize_answer(expected)
    actual_norm = normalize_answer(actual)
    if not expected_norm or not actual_norm:
        return False
    if isinstance(expected, list):
        options = {normalize_answer(item) for item in expected}
        return actual_norm in options
    if canonicalize_judgement(expected_norm) == canonicalize_judgement(actual_norm):
        return True
    expected_parts = {part.strip() for part in re.split(r"[,/|]|(?:\s+AND\s+)", expected_norm) if part.strip()}
    actual_parts = {part.strip() for part in re.split(r"[,/|]|(?:\s+AND\s+)", actual_norm) if part.strip()}
    return bool(expected_parts) and expected_parts == actual_parts


def extract_declared_answer(text: str) -> str:
    match = re.search(r"答案[：:]\s*([^\n]+)", text)
    return match.group(1).strip() if match else ""


def infer_section_title(kind: str, questions: List[Dict[str, Any]]) -> str:
    if questions:
        start = questions[0]["questionNumber"]
        end = questions[-1]["questionNumber"]
    else:
        start = end = 0
    label = KIND_LABELS.get(kind, kind or "题目解析")
    if start and end:
        return f"{label}（Questions {start}–{end}）"
    return label


def build_template(context: Dict[str, Any]) -> Dict[str, Any]:
    answer_key = context.get("answerKey") or {}
    template_sections: List[Dict[str, Any]] = []
    for group in context.get("questionGroups") or []:
        questions = group.get("questions") or []
        if not questions:
            continue
        items = []
        for question in questions:
            qid = question["questionId"]
            answer = answer_key.get(qid, "")
            prompt = (question.get("prompt") or "").strip()
            items.append({
                "questionId": qid,
                "questionNumber": question["questionNumber"],
                "text": (
                    f"题目：{prompt}\n"
                    "题目翻译：\n"
                    f"答案：{answer}\n"
                    "解析："
                ),
            })
        template_sections.append({
            "sectionTitle": infer_section_title(group.get("kind", ""), questions),
            "mode": "group",
            "questionRange": {
                "start": questions[0]["questionNumber"],
                "end": questions[-1]["questionNumber"],
            },
            "items": items,
            "text": "\n".join(item["text"] for item in items),
        })

    passage_notes = []
    for paragraph in context.get("passageParagraphs") or []:
        passage_notes.append({
            "label": paragraph.get("label", ""),
            "text": "",
        })

    return {
        "schemaVersion": "ReadingExplanationV1",
        "examId": context["examId"],
        "meta": {
            "examId": context["examId"],
            "title": context.get("title", context["examId"]),
            "category": context.get("category", ""),
            "sourceDoc": context.get("pdfFilename", ""),
            "noteType": "翻译+解析",
            "matchedTitle": context.get("title", context["examId"]),
        },
        "passageNotes": passage_notes,
        "questionExplanations": template_sections,
    }


def build_request_payload(context: Dict[str, Any], template: Dict[str, Any], response_path: Path) -> Dict[str, Any]:
    return {
        "examContext": context,
        "translatorAgentAnchor": {
            "responsePath": str(response_path),
            "requiredItemFormat": "题目：...\\n题目翻译：...\\n答案：...\\n解析：...",
            "validationRules": [
                "答案必须与 examContext.answerKey 一致",
                "禁止占位词：根据具体题目分析/同上/[题目内容]/题目翻译：[翻译]/解析：[解析内容]",
                "保留 questionId/questionNumber/questionRange",
                "passageNotes 必须是高保真中文翻译或释义，不得只写一句总结",
                "section.text 需要与 items 同步更新",
            ],
        },
        "responseTemplate": template,
    }


def write_explanation_module(path: Path, data_key: str, payload: Dict[str, Any]) -> None:
    content = (
        "(function registerReadingExplanationData(global) {\n"
        "  'use strict';\n"
        "  if (!global.__READING_EXPLANATION_DATA__ || typeof global.__READING_EXPLANATION_DATA__.register !== \"function\") {\n"
        "    throw new Error(\"reading_explanation_registry_missing\");\n"
        "  }\n"
        f"  global.__READING_EXPLANATION_DATA__.register({json.dumps(data_key, ensure_ascii=False)}, "
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n"
        "  );\n"
        "})(typeof window !== \"undefined\" ? window : globalThis);\n"
    )
    path.write_text(content, encoding="utf-8")


def validate_response(context: Dict[str, Any], response: Dict[str, Any]) -> List[str]:
    issues: List[str] = []
    if response.get("examId") != context["examId"]:
        issues.append(f"examId 不匹配: {response.get('examId')} != {context['examId']}")

    answer_key = context.get("answerKey") or {}
    seen_ids = set()
    for section in response.get("questionExplanations") or []:
        section_text = section.get("text", "") or ""
        for placeholder in PLACEHOLDER_PATTERNS:
            if placeholder in section_text:
                issues.append(f"section.text 含占位词: {placeholder}")
        for item in section.get("items") or []:
            qid = str(item.get("questionId") or "")
            seen_ids.add(qid)
            text = item.get("text", "") or ""
            for placeholder in PLACEHOLDER_PATTERNS:
                if placeholder in text:
                    issues.append(f"{qid}: 含占位词: {placeholder}")
            declared = extract_declared_answer(text)
            expected = answer_key.get(qid)
            if expected is None:
                issues.append(f"{qid}: answerKey 缺失")
            elif not equivalent_answers(expected, declared):
                issues.append(f"{qid}: 答案与 answerKey 不一致 (declared={declared!r}, expected={expected!r})")
            for marker in ("题目：", "题目翻译：", "答案：", "解析："):
                if marker not in text:
                    issues.append(f"{qid}: 缺少字段 {marker}")

    missing_ids = sorted(set(answer_key) - seen_ids, key=lambda value: int(value[1:]) if value.startswith("q") and value[1:].isdigit() else value)
    if missing_ids:
        issues.append(f"缺少题目: {', '.join(missing_ids)}")

    if not response.get("passageNotes"):
        issues.append("passageNotes 为空")
    return issues


def command_prepare(args: argparse.Namespace) -> int:
    helper = load_extract_helper()
    work_dir = Path(args.work_dir)
    request_dir = work_dir / "requests"
    response_dir = work_dir / "responses"
    request_dir.mkdir(parents=True, exist_ok=True)
    response_dir.mkdir(parents=True, exist_ok=True)

    for exam_id in args.exam_ids:
        context = helper.build_context(exam_id)
        template = build_template(context)
        response_path = response_dir / f"{exam_id}.json"
        request_path = request_dir / f"{exam_id}.json"
        request_payload = build_request_payload(context, template, response_path)

        request_path.write_text(json.dumps(request_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        if args.write_template:
            response_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"prepared {exam_id}: {request_path}")
        if args.write_template:
            print(f"template  {exam_id}: {response_path}")
    return 0


def command_render(args: argparse.Namespace) -> int:
    helper = load_extract_helper()
    context = helper.build_context(args.exam_id)
    response_path = Path(args.response)
    response = json.loads(response_path.read_text(encoding="utf-8"))
    issues = validate_response(context, response)
    if issues:
        print(json.dumps({
            "examId": args.exam_id,
            "ok": False,
            "issues": issues,
        }, ensure_ascii=False, indent=2))
        return 1

    output_path = Path(args.output) if args.output else EXPLANATION_DIR / f"{args.exam_id}.js"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_explanation_module(output_path, args.exam_id, response)
    print(json.dumps({
        "examId": args.exam_id,
        "ok": True,
        "output": str(output_path),
    }, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent-assisted reading explanation generator")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare", help="prepare translator-agent request packets")
    prepare_parser.add_argument("exam_ids", nargs="+", help="exam ids such as p1-low-80")
    prepare_parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR))
    prepare_parser.add_argument("--write-template", action="store_true", help="also write editable response templates")
    prepare_parser.set_defaults(func=command_prepare)

    render_parser = subparsers.add_parser("render", help="render final explanation JS from agent response")
    render_parser.add_argument("exam_id", help="exam id such as p1-low-80")
    render_parser.add_argument("--response", required=True, help="agent response JSON path")
    render_parser.add_argument("--output", help="output JS path, defaults to reading-explanations/<examId>.js")
    render_parser.set_defaults(func=command_render)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
