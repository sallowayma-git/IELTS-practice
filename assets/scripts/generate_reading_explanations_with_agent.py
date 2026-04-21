#!/usr/bin/env python3
<<<<<<< HEAD
"""Agent-assisted generator for reading explanation JS bundles.

Workflow
1. `prepare`: extract trustworthy exam context from `reading-exams/*.js` and
   scaffold a response template for a translator agent.
2. Translator agent edits the scaffolded response JSON.
3. `render`: validate the agent response and emit the final explanation JS.

The translator agent hook lives in the generated JSON request/template files.
"""
=======
"""Agent-assisted generator for reading explanation JS bundles."""
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
<<<<<<< HEAD
=======
import signal
import subprocess
import tempfile
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
from pathlib import Path
from typing import Any, Dict, List, Tuple


SCRIPT_REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("READING_EXPLANATION_REPO_ROOT") or SCRIPT_REPO_ROOT)
EXPLANATION_DIR = ROOT / "assets" / "generated" / "reading-explanations"
DEFAULT_WORK_DIR = ROOT / "developer" / "tests" / "artifacts" / "reading-explanation-agent"
HELPER_PATH = SCRIPT_REPO_ROOT / "developer" / "tests" / "py" / "extract_reading_exam_context.py"
<<<<<<< HEAD
=======
DEFAULT_OPENCODE_MODEL = "opencode/qwen3.6-plus-free"
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d

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


<<<<<<< HEAD
def build_template(context: Dict[str, Any]) -> Dict[str, Any]:
    answer_key = context.get("answerKey") or {}
    template_sections: List[Dict[str, Any]] = []
=======
def prefer_pdf_source_doc(raw_name: Any) -> str:
    name = str(raw_name or "").strip()
    if not name:
        return ""
    if name.lower().endswith(".pdf"):
        return name
    if name.lower().endswith(".md"):
        return re.sub(r"\.md$", ".pdf", name, flags=re.I)
    return name


def build_template(context: Dict[str, Any]) -> Dict[str, Any]:
    answer_key = context.get("answerKey") or {}
    template_sections: List[Dict[str, Any]] = []
    seen_question_ids: set[str] = set()
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
    for group in context.get("questionGroups") or []:
        questions = group.get("questions") or []
        if not questions:
            continue
        items = []
        for question in questions:
            qid = question["questionId"]
<<<<<<< HEAD
            answer = answer_key.get(qid, "")
            prompt = (question.get("prompt") or "").strip()
=======
            seen_question_ids.add(qid)
            answer = answer_key.get(qid, "")
            prompt = re.sub(r"\[BLANK:q\d+\]", "______", (question.get("prompt") or "").strip())
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
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

<<<<<<< HEAD
    passage_notes = []
    for paragraph in context.get("passageParagraphs") or []:
        passage_notes.append({
            "label": paragraph.get("label", ""),
            "text": "",
        })
=======
    missing_answer_ids = sorted(
        [qid for qid in answer_key.keys() if qid not in seen_question_ids],
        key=lambda v: int(v[1:]) if v.startswith("q") and v[1:].isdigit() else v,
    )
    if missing_answer_ids:
        fallback_items: List[Dict[str, Any]] = []
        for qid in missing_answer_ids:
            number = int(qid[1:]) if qid.startswith("q") and qid[1:].isdigit() else 0
            answer = answer_key.get(qid, "")
            fallback_items.append(
                {
                    "questionId": qid,
                    "questionNumber": number,
                    "text": (
                        f"题目：Question {number}\n"
                        "题目翻译：\n"
                        f"答案：{answer}\n"
                        "解析："
                    ),
                }
            )
        template_sections.append(
            {
                "sectionTitle": "缺失题目兜底（待从原文重建）",
                "mode": "group",
                "questionRange": {
                    "start": fallback_items[0]["questionNumber"],
                    "end": fallback_items[-1]["questionNumber"],
                },
                "items": fallback_items,
                "text": "\n".join(item["text"] for item in fallback_items),
            }
        )

    passage_notes = []
    for paragraph in context.get("passageParagraphs") or []:
        passage_notes.append({"label": paragraph.get("label", ""), "text": ""})
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d

    return {
        "schemaVersion": "ReadingExplanationV1",
        "examId": context["examId"],
        "meta": {
            "examId": context["examId"],
            "title": context.get("title", context["examId"]),
            "category": context.get("category", ""),
<<<<<<< HEAD
            "sourceDoc": context.get("pdfFilename", ""),
=======
            "sourceDoc": prefer_pdf_source_doc(context.get("pdfFilename", "")),
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
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


<<<<<<< HEAD
=======
def build_opencode_prompt(request_payload: Dict[str, Any], feedback_issues: List[str] | None = None) -> str:
    anchor = request_payload.get("translatorAgentAnchor") or {}
    rules = anchor.get("validationRules") or []
    rule_text = "\n".join(f"- {rule}" for rule in rules)
    feedback_text = ""
    if feedback_issues:
        bullets = "\n".join(f"- {normalize_whitespace(str(item))}" for item in feedback_issues[:12] if str(item).strip())
        if bullets:
            feedback_text = f"上一次输出失败，必须修复以下问题：\n{bullets}\n"
    return (
        "你是 IELTS 阅读解析翻译代理。附件 JSON 里包含 examContext、translatorAgentAnchor、responseTemplate。\n"
        "禁止调用任何工具或插件，禁止读取本地文件；仅基于附件 JSON 作答。\n"
        "请直接输出最终 JSON，不要输出说明。\n"
        f"{rule_text}\n"
        f"{feedback_text}"
        "输出要求：\n"
        "1. 只输出一个 JSON 对象，不要 markdown，不要解释，不要代码块；首字符必须是 { ，末字符必须是 }。\n"
        "2. JSON 顶层结构必须与 responseTemplate 完全一致。\n"
        "3. passageNotes.text 必须逐段完整翻译/释义，不得留空。\n"
        "4. questionExplanations.items[].text 必须包含题目/题目翻译/答案/解析四段。\n"
        "5. 答案字段必须严格采用 examContext.answerKey 值。\n"
        "6. section.text 必须是本 section 的 items 聚合，不准写同上。\n"
        "7. 不得出现 [BLANK:qX]、同上、根据具体题目分析等占位文本。\n"
        "8. 每个 questionId 都要写完整题干，不能写“第二个空/同上”。\n"
    )


def build_verify_prompt() -> str:
    return (
        "你是 IELTS 阅读解析质检代理。附件 JSON 包含 examContext 与 explanationPayload。\n"
        "只输出 JSON：{\"pass\":true/false,\"issues\":[\"...\"],\"score\":0-100,\"regenerate\":true/false}。\n"
        "检查点：翻译完整度、题目与解析对应、解析是否引用原文事实、是否存在偷懒/空泛/错位内容。\n"
        "注意：不要重复做 answerKey 机械校验，重点看语义质量。\n"
    )


def extract_text_from_opencode_events(raw_output: str) -> str:
    strict_chunks: List[str] = []
    chunks: List[str] = []

    def collect_strings(node: Any) -> None:
        if isinstance(node, str):
            value = node.strip()
            if value:
                chunks.append(value)
            return
        if isinstance(node, list):
            for item in node:
                collect_strings(item)
            return
        if isinstance(node, dict):
            part = node.get("part")
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text)
            for key in ("text", "content", "delta", "output_text", "message"):
                value = node.get(key)
                if value is not None:
                    collect_strings(value)

    for line in raw_output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "text":
            part = event.get("part") or {}
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                strict_chunks.append(text.strip())
        collect_strings(event)

    if strict_chunks:
        return "\n".join(strict_chunks).strip()
    if chunks:
        return "\n".join(chunks).strip()
    return raw_output.strip()


def parse_json_object_from_text(text: str) -> Dict[str, Any]:
    stripped = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", stripped)
    if fence_match:
        stripped = fence_match.group(1).strip()
    decoder = json.JSONDecoder()
    best: Dict[str, Any] | None = None
    for match in re.finditer(r"\{", stripped):
        start = match.start()
        try:
            parsed, _ = decoder.raw_decode(stripped[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            best = parsed
            if ("examId" in parsed and "questionExplanations" in parsed) or ("pass" in parsed and "issues" in parsed):
                return parsed
    if best is not None:
        return best
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end < start:
        raise ValueError("opencode 输出中没有可解析的 JSON 对象")
    return json.loads(stripped[start : end + 1])


def extract_registered_payload(path: Path) -> Dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'register\("[^"]+",\s*(\{[\s\S]*\})\s*\)\s*;?\s*\}', text)
    if not match:
        raise ValueError(f"无法解析 register payload: {path}")
    return json.loads(match.group(1))


def normalize_question_explanations_shape(response: Dict[str, Any]) -> Dict[str, Any]:
    raw = response.get("questionExplanations")
    if isinstance(raw, dict):
        raw_items = raw.get("items")
    else:
        raw_items = raw
    if not isinstance(raw_items, list) or not raw_items:
        return response
    if any(isinstance(section, dict) and isinstance(section.get("items"), list) for section in raw_items):
        return response
    if not all(isinstance(item, dict) and item.get("questionId") for item in raw_items):
        return response

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for item in raw_items:
        group_key = str(item.get("questionRange") or "all")
        grouped.setdefault(group_key, []).append(
            {
                "questionId": item.get("questionId"),
                "questionNumber": item.get("questionNumber"),
                "questionRange": item.get("questionRange"),
                "text": item.get("text", ""),
            }
        )

    normalized_sections: List[Dict[str, Any]] = []
    for group_key, items in grouped.items():
        normalized_sections.append(
            {
                "sectionTitle": f"Questions {group_key}",
                "mode": "group",
                "questionRange": group_key,
                "items": items,
                "text": "\n".join(str(item.get("text") or "") for item in items),
            }
        )
    response["questionExplanations"] = normalized_sections
    return response


>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
def validate_response(context: Dict[str, Any], response: Dict[str, Any]) -> List[str]:
    issues: List[str] = []
    if response.get("examId") != context["examId"]:
        issues.append(f"examId 不匹配: {response.get('examId')} != {context['examId']}")

    answer_key = context.get("answerKey") or {}
<<<<<<< HEAD
    seen_ids = set()
    for section in response.get("questionExplanations") or []:
        section_text = section.get("text", "") or ""
        for placeholder in PLACEHOLDER_PATTERNS:
            if placeholder in section_text:
                issues.append(f"section.text 含占位词: {placeholder}")
=======
    passage_notes = response.get("passageNotes") or []
    if not passage_notes:
        issues.append("passageNotes 为空")
    for note in passage_notes:
        text = str(note.get("text") or "").strip()
        label = str(note.get("label") or "")
        if not text:
            issues.append(f"{label or 'passageNotes'}: 段落翻译为空")
        if re.search(r"\[BLANK:q\d+\]", text):
            issues.append(f"{label or 'passageNotes'}: 含未替换 BLANK")

    seen_ids = set()
    for section in response.get("questionExplanations") or []:
        section_text = section.get("text", "") or ""
        expected_section_text = "\n".join((item.get("text", "") or "") for item in section.get("items") or [])
        for placeholder in PLACEHOLDER_PATTERNS:
            if placeholder in section_text:
                issues.append(f"section.text 含占位词: {placeholder}")
        if re.search(r"\[BLANK:q\d+\]", section_text):
            issues.append("section.text 含未替换 BLANK")
        if normalize_whitespace(section_text) != normalize_whitespace(expected_section_text):
            issues.append("section.text 未与 items 同步")
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
        for item in section.get("items") or []:
            qid = str(item.get("questionId") or "")
            seen_ids.add(qid)
            text = item.get("text", "") or ""
            for placeholder in PLACEHOLDER_PATTERNS:
                if placeholder in text:
                    issues.append(f"{qid}: 含占位词: {placeholder}")
<<<<<<< HEAD
=======
            if re.search(r"\[BLANK:q\d+\]", text):
                issues.append(f"{qid}: 含未替换 BLANK")
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
            declared = extract_declared_answer(text)
            expected = answer_key.get(qid)
            if expected is None:
                issues.append(f"{qid}: answerKey 缺失")
            elif not equivalent_answers(expected, declared):
                issues.append(f"{qid}: 答案与 answerKey 不一致 (declared={declared!r}, expected={expected!r})")
            for marker in ("题目：", "题目翻译：", "答案：", "解析："):
                if marker not in text:
                    issues.append(f"{qid}: 缺少字段 {marker}")

<<<<<<< HEAD
    missing_ids = sorted(set(answer_key) - seen_ids, key=lambda value: int(value[1:]) if value.startswith("q") and value[1:].isdigit() else value)
    if missing_ids:
        issues.append(f"缺少题目: {', '.join(missing_ids)}")

    if not response.get("passageNotes"):
        issues.append("passageNotes 为空")
    return issues


=======
    missing_ids = sorted(set(answer_key) - seen_ids, key=lambda v: int(v[1:]) if v.startswith("q") and v[1:].isdigit() else v)
    if missing_ids:
        issues.append(f"缺少题目: {', '.join(missing_ids)}")
    return issues


def run_opencode_json(command: List[str], *, timeout: int) -> Tuple[int, str, str]:
    process = subprocess.Popen(
        command,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = process.communicate()
        return 124, stdout, stderr
    return process.returncode, stdout, stderr


>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
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
<<<<<<< HEAD

=======
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
        request_path.write_text(json.dumps(request_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        if args.write_template:
            response_path.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"prepared {exam_id}: {request_path}")
<<<<<<< HEAD
        if args.write_template:
            print(f"template  {exam_id}: {response_path}")
=======
    return 0


def command_translate(args: argparse.Namespace) -> int:
    request_path = Path(args.request)
    request_payload = json.loads(request_path.read_text(encoding="utf-8"))
    context = request_payload.get("examContext") or {}
    response_path = Path(args.response) if args.response else Path((request_payload.get("translatorAgentAnchor") or {}).get("responsePath") or "")
    if not str(response_path):
        raise SystemExit("缺少 responsePath")
    prompt = build_opencode_prompt(request_payload, feedback_issues=args.feedback)
    command = [
        args.opencode_bin,
        "run",
        "--pure",
        "--agent",
        args.agent,
        "-m",
        args.model,
        "--variant",
        args.variant,
        "--format",
        "json",
        "-f",
        str(request_path),
        "--",
        prompt,
    ]
    returncode, stdout, stderr = run_opencode_json(command, timeout=args.timeout)
    if returncode != 0:
        print(json.dumps({
            "ok": False,
            "stage": "opencode_timeout" if returncode == 124 else "opencode_run",
            "stdout": stdout,
            "stderr": stderr,
            "issues": [
                "模型未输出可用 JSON；禁止输出过程说明，必须只输出一个完整 JSON 对象。",
            ],
        }, ensure_ascii=False, indent=2))
        return returncode
    try:
        response_payload = parse_json_object_from_text(extract_text_from_opencode_events(stdout))
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "stage": "parse_opencode_output",
            "error": str(exc),
            "stdout": stdout,
            "issues": ["输出不是合法 JSON 对象，必须只输出 JSON。"],
        }, ensure_ascii=False, indent=2))
        return 1
    response_payload = normalize_question_explanations_shape(response_payload)
    issues = validate_response(context, response_payload)
    if issues:
        print(json.dumps({
            "ok": False,
            "stage": "translate_validate",
            "issues": issues,
            "stdout": stdout,
        }, ensure_ascii=False, indent=2))
        return 1
    response_path.parent.mkdir(parents=True, exist_ok=True)
    response_path.write_text(json.dumps(response_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "response": str(response_path)}, ensure_ascii=False, indent=2))
>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
    return 0


def command_render(args: argparse.Namespace) -> int:
    helper = load_extract_helper()
    context = helper.build_context(args.exam_id)
    response_path = Path(args.response)
<<<<<<< HEAD
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


=======
    response = normalize_question_explanations_shape(json.loads(response_path.read_text(encoding="utf-8")))
    issues = validate_response(context, response)
    if issues:
        print(json.dumps({"examId": args.exam_id, "ok": False, "issues": issues}, ensure_ascii=False, indent=2))
        return 1
    output_path = Path(args.output) if args.output else EXPLANATION_DIR / f"{args.exam_id}.js"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_explanation_module(output_path, args.exam_id, response)
    print(json.dumps({"examId": args.exam_id, "ok": True, "output": str(output_path)}, ensure_ascii=False, indent=2))
    return 0


def command_verify(args: argparse.Namespace) -> int:
    helper = load_extract_helper()
    context = helper.build_context(args.exam_id)
    explanation_path = Path(args.input) if args.input else EXPLANATION_DIR / f"{args.exam_id}.js"
    explanation_payload = extract_registered_payload(explanation_path)
    packet = {"examContext": context, "explanationPayload": explanation_payload}
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as handle:
        json.dump(packet, handle, ensure_ascii=False, indent=2)
        packet_path = Path(handle.name)
    command = [
        args.opencode_bin,
        "run",
        "--pure",
        "--agent",
        args.agent,
        "-m",
        args.model,
        "--variant",
        args.variant,
        "--format",
        "json",
        "-f",
        str(packet_path),
        "--",
        build_verify_prompt(),
    ]
    try:
        returncode, stdout, stderr = run_opencode_json(command, timeout=args.timeout)
    finally:
        packet_path.unlink(missing_ok=True)
    if returncode != 0:
        print(json.dumps({"ok": False, "stage": "verify_run", "stdout": stdout, "stderr": stderr}, ensure_ascii=False, indent=2))
        return returncode
    try:
        verdict = parse_json_object_from_text(extract_text_from_opencode_events(stdout))
    except Exception as exc:
        print(json.dumps({"ok": False, "stage": "parse_verify_output", "error": str(exc), "stdout": stdout}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    return 0 if verdict.get("pass") else 1


>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent-assisted reading explanation generator")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare", help="prepare translator-agent request packets")
<<<<<<< HEAD
    prepare_parser.add_argument("exam_ids", nargs="+", help="exam ids such as p1-low-80")
    prepare_parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR))
    prepare_parser.add_argument("--write-template", action="store_true", help="also write editable response templates")
    prepare_parser.set_defaults(func=command_prepare)

    render_parser = subparsers.add_parser("render", help="render final explanation JS from agent response")
    render_parser.add_argument("exam_id", help="exam id such as p1-low-80")
    render_parser.add_argument("--response", required=True, help="agent response JSON path")
    render_parser.add_argument("--output", help="output JS path, defaults to reading-explanations/<examId>.js")
    render_parser.set_defaults(func=command_render)

=======
    prepare_parser.add_argument("exam_ids", nargs="+")
    prepare_parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR))
    prepare_parser.add_argument("--write-template", action="store_true")
    prepare_parser.set_defaults(func=command_prepare)

    translate_parser = subparsers.add_parser("translate", help="use local opencode CLI as translator agent")
    translate_parser.add_argument("--request", required=True)
    translate_parser.add_argument("--response")
    translate_parser.add_argument("--opencode-bin", default="opencode")
    translate_parser.add_argument("--agent", default="compaction")
    translate_parser.add_argument("--model", default=DEFAULT_OPENCODE_MODEL)
    translate_parser.add_argument("--variant", default="low")
    translate_parser.add_argument("--timeout", type=int, default=180)
    translate_parser.add_argument("--feedback", action="append", default=[])
    translate_parser.set_defaults(func=command_translate)

    render_parser = subparsers.add_parser("render", help="render final explanation JS from agent response")
    render_parser.add_argument("exam_id")
    render_parser.add_argument("--response", required=True)
    render_parser.add_argument("--output")
    render_parser.set_defaults(func=command_render)

    verify_parser = subparsers.add_parser("verify", help="semantic verify with opencode")
    verify_parser.add_argument("exam_id")
    verify_parser.add_argument("--input")
    verify_parser.add_argument("--opencode-bin", default="opencode")
    verify_parser.add_argument("--agent", default="compaction")
    verify_parser.add_argument("--model", default=DEFAULT_OPENCODE_MODEL)
    verify_parser.add_argument("--variant", default="low")
    verify_parser.add_argument("--timeout", type=int, default=180)
    verify_parser.set_defaults(func=command_verify)

>>>>>>> 8f4bcacac42490fdc0f11b08a25874339e363b1d
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
