#!/usr/bin/env python3
"""Audit checklist coverage and targeted regression guards for PDF issue closure."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHECKLIST = ROOT / "checklist.md"
MAPPING = ROOT / "developer" / "tests" / "ci" / "pdf_executable_issues.json"
REPORT = ROOT / "developer" / "tests" / "e2e" / "reports" / "pdf-checklist-audit-report.json"
SUITE_REPORT = ROOT / "developer" / "tests" / "e2e" / "reports" / "suite-practice-flow-report.json"

MONA_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p3-low-36.js"
MONA_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-low-36.js"
PATIENT_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p3-low-55.js"
CLASS_SIZE_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-medium-155.js"
MECHANICAL_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p2-medium-217.js"
ELEPHANT_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-high-156.js"
LOOKING_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-low-83.js"
FUNFAIRS_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-low-163.js"
ROMAN_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p1-high-171.js"
ROMAN_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p1-high-171.js"
WOOD_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p1-medium-119.js"
PLASTIC_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p1-medium-20.js"
AUS_LANDSCAPE_EXAM = ROOT / "assets" / "generated" / "reading-exams" / "p3-high-206.js"
MERCATOR_EXPLANATION = ROOT / "assets" / "generated" / "reading-explanations" / "p3-medium-66.js"
MAIN_CSS = ROOT / "css" / "main.css"
EXAM_ACTIONS = ROOT / "js" / "app" / "examActions.js"
PRACTICE_MODAL = ROOT / "js" / "components" / "practiceRecordModal.js"
APP_ACTIONS = ROOT / "js" / "presentation" / "app-actions.js"
SUITE_MIXIN = ROOT / "js" / "app" / "suitePracticeMixin.js"
PRACTICE_ENHANCER = ROOT / "js" / "practice-page-enhancer.js"
PRACTICE_UI = ROOT / "js" / "practice-page-ui.js"
ANSWER_MATCH_CORE = ROOT / "js" / "utils" / "answerMatchCore.js"
ANSWER_UTIL = ROOT / "js" / "utils" / "answerComparisonUtils.js"
UNIFIED_PAGE = ROOT / "js" / "runtime" / "unifiedReadingPage.js"

ALLOWED_STATUS = {"待修复", "已修复待验证", "已验证通过"}
BANNED_PATTERNS = [
    r'label"\s*:\s*"修复说明"',
    r"本篇解析已按",
    r"移除此前错绑",
]


def load_json_from_register_js(path: Path, register_key: str) -> dict:
    text = path.read_text(encoding="utf-8")
    pattern = rf'register\("{re.escape(register_key)}",\s*(\{{.*\}})\s*\);'
    match = re.search(pattern, text, flags=re.S)
    if not match:
        raise ValueError(f"unable_to_parse_register_payload:{path.name}")
    return json.loads(match.group(1))


def parse_checklist_rows(text: str):
    rows = []
    for line in text.splitlines():
        if not re.match(r"^\|\s*I\d{3}\s*\|", line):
            continue
        cells = [cell.strip() for cell in line.strip().split("|")]
        if len(cells) < 6:
            continue
        issue_id = cells[1]
        status = cells[4]
        evidence = cells[5]
        rows.append({"id": issue_id, "status": status, "evidence": evidence, "raw": line})
    return rows


def extract_answer(text: str) -> str:
    match = re.search(r"答案[:：]\s*([A-Z]+(?:\s+[A-Z]+)?)", text, flags=re.I)
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1).strip()).upper()


def extract_answer_by_question(explanation_payload: dict) -> dict[int, str]:
    answer_map: dict[int, str] = {}
    for section in explanation_payload.get("questionExplanations", []):
        for item in section.get("items", []):
            qn = item.get("questionNumber")
            if not isinstance(qn, int):
                continue
            answer = extract_answer(item.get("text", ""))
            if answer:
                answer_map[qn] = answer
    return answer_map


def get_group_by_question_ids(exam_payload: dict, expected_ids: list[str]) -> dict:
    wanted = set(expected_ids)
    for group in exam_payload.get("questionGroups", []):
        ids = set(group.get("questionIds", []))
        if ids == wanted:
            return group
    return {}


def run_answer_comparison_dynamic_checks(repo_root: Path) -> dict:
    script = r"""
const core = require('./js/utils/answerMatchCore.js');
globalThis.AnswerMatchCore = core;
const util = require('./js/utils/answerComparisonUtils.js');
function isCorrectFor(userAnswer, correctAnswer) {
  const rows = util.getNormalizedEntries({
    answerComparison: { q1: { userAnswer, correctAnswer } }
  });
  return rows.length === 1 && rows[0].isCorrect === true;
}
const checks = {
  yes_true_equivalent: isCorrectFor('YES', 'TRUE'),
  no_false_equivalent: isCorrectFor('no', 'false'),
  ng_not_given_equivalent: isCorrectFor('NG', 'NOT GIVEN'),
  multi_select_order_insensitive: isCorrectFor('B, A', 'A B'),
  text_trim_equivalent: isCorrectFor(' shipping   costs ', 'shipping costs')
};
const allPass = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ allPass, checks }));
"""
    try:
        result = subprocess.run(
            ["node", "-e", script],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception as error:  # noqa: BLE001
        return {
            "node_exec_ok": False,
            "all_pass": False,
            "checks": {},
            "error": f"{type(error).__name__}: {error}",
        }

    if result.returncode != 0:
        return {
            "node_exec_ok": False,
            "all_pass": False,
            "checks": {},
            "stderr": result.stderr.strip(),
        }

    try:
        payload = json.loads((result.stdout or "").strip().splitlines()[-1])
    except Exception as error:  # noqa: BLE001
        return {
            "node_exec_ok": False,
            "all_pass": False,
            "checks": {},
            "error": f"json_parse_error: {error}",
            "stdout": (result.stdout or "").strip(),
        }

    checks = payload.get("checks", {}) if isinstance(payload, dict) else {}
    return {
        "node_exec_ok": True,
        "all_pass": bool(payload.get("allPass")) if isinstance(payload, dict) else False,
        "checks": checks if isinstance(checks, dict) else {},
    }


def main() -> int:
    if not CHECKLIST.exists():
        report = {
            "status": "skipped",
            "reason": f"missing_checklist:{CHECKLIST}",
            "onlyInMapping": [],
            "onlyInChecklist": [],
            "invalidStatusRows": [],
            "missingEvidenceForVerified": [],
            "monaBannedPatternHits": [],
            "monaCoverageOk": True,
            "monaAnswerMismatches": [],
        }
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
        return 0

    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    mapping_ids = [item["id"] for item in mapping.get("issues", [])]

    checklist_text = CHECKLIST.read_text(encoding="utf-8")
    checklist_rows = parse_checklist_rows(checklist_text)
    checklist_ids = [row["id"] for row in checklist_rows]

    invalid_status = [row for row in checklist_rows if row["status"] not in ALLOWED_STATUS]
    missing_evidence_for_verified = [
        row for row in checklist_rows
        if row["status"] == "已验证通过" and (not row["evidence"] or row["evidence"] in {"-", "—", "待补"})
    ]

    mapping_set = set(mapping_ids)
    checklist_set = set(checklist_ids)
    only_mapping = sorted(mapping_set - checklist_set)
    only_checklist = sorted(checklist_set - mapping_set)

    # MONA audit
    mona_text = MONA_EXPLANATION.read_text(encoding="utf-8")
    banned_hits = [pat for pat in BANNED_PATTERNS if re.search(pat, mona_text, flags=re.I)]
    mona_explanation = load_json_from_register_js(MONA_EXPLANATION, "p3-low-36")
    mona_exam = load_json_from_register_js(MONA_EXAM, "p3-low-36")

    found_question_numbers = []
    answer_by_question = {}
    for section in mona_explanation.get("questionExplanations", []):
        for item in section.get("items", []):
            qn = item.get("questionNumber")
            if isinstance(qn, int):
                found_question_numbers.append(qn)
                answer_by_question[qn] = extract_answer(item.get("text", ""))

    expected_question_numbers = list(range(27, 41))
    coverage_ok = sorted(set(found_question_numbers)) == expected_question_numbers

    answer_key = mona_exam.get("answerKey", {})
    expected_answers = {}
    for idx, qn in enumerate(expected_question_numbers, start=1):
        expected_answers[qn] = str(answer_key.get(f"q{idx}", "")).strip().upper()
    answer_mismatches = []
    for qn in expected_question_numbers:
        actual = answer_by_question.get(qn, "")
        expected = expected_answers.get(qn, "")
        if actual != expected:
            answer_mismatches.append({"questionNumber": qn, "expected": expected, "actual": actual})

    mona_notes = mona_explanation.get("passageNotes", [])
    mona_note_labels = [item.get("label", "") for item in mona_notes]
    mona_translation_complete = mona_note_labels == [f"段落{i}" for i in range(1, 9)]

    # p2-medium-217 should not include plain info-box list of people
    mechanical_exam = load_json_from_register_js(MECHANICAL_EXAM, "p2-medium-217")
    mechanical_group = get_group_by_question_ids(mechanical_exam, ["q6", "q7", "q8", "q9", "q10"])
    mechanical_body = mechanical_group.get("bodyHtml", "")
    mechanical_has_info_box = "<div class=\\\"info-box\\\">" in mechanical_body

    # p3-high-156 image sizing guard
    elephant_text = ELEPHANT_EXAM.read_text(encoding="utf-8")
    css_text = MAIN_CSS.read_text(encoding="utf-8")
    elephant_has_exam_class = "diagram-container--elephant" in elephant_text and "diagram-image--elephant" in elephant_text
    elephant_has_css_rule = ".diagram-container--elephant" in css_text and "max-width: 560px;" in css_text

    # p3-medium-155 alignment guard
    class_exam = load_json_from_register_js(CLASS_SIZE_EXAM, "p3-medium-155")
    class_group_1 = get_group_by_question_ids(class_exam, ["q1", "q2", "q3", "q4", "q5"]).get("bodyHtml", "")
    class_group_2 = get_group_by_question_ids(
        class_exam, ["q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13", "q14"]
    ).get("bodyHtml", "")
    class_key = class_exam.get("answerKey", {})
    class_size_checks = {
        "q31_stem_ok": "reasons why class composition changed during a project" in class_group_1,
        "q34_stem_ok": "Similar results were obtained for all social groups." in class_group_2,
        "q36_stem_ok": "Several different class types were involved in the project." in class_group_2,
        "answer_q5_ok": str(class_key.get("q5", "")).upper() == "D",
        "answer_q8_ok": str(class_key.get("q8", "")).upper() == "B",
    }

    # p3-low-55 should keep original-detail key sentences
    patient_explanation = load_json_from_register_js(PATIENT_EXPLANATION, "p3-low-55")
    patient_notes_text = "\n".join(note.get("text", "") for note in patient_explanation.get("passageNotes", []))
    patient_checks = {
        "has_packaging_key_sentence": "药房中最突出的设计问题之一是药品包装和其中包含的患者信息说明书（PILs）。" in patient_notes_text,
        "has_innovation_key_sentence": "在积极的一面，最近的一个创新展览展示了几种新设计。" in patient_notes_text,
        "note_count_ok": len(patient_explanation.get("passageNotes", [])) >= 5,
    }

    # Looking for inspiration NB label check
    looking_exam = load_json_from_register_js(LOOKING_EXAM, "p3-low-83")
    looking_group = get_group_by_question_ids(looking_exam, ["q1", "q2", "q3", "q4", "q5", "q6"])
    looking_body = looking_group.get("bodyHtml", "")
    looking_nb_checks = {
        "nb_hint_present": "NB You may use any letter more than once." in looking_body,
        "allow_option_reuse": looking_group.get("allowOptionReuse") is True,
    }

    # Funfairs Q33 word-limit check
    funfairs_exam = load_json_from_register_js(FUNFAIRS_EXAM, "p3-low-163")
    funfairs_group = get_group_by_question_ids(funfairs_exam, ["q7", "q8", "q9", "q10", "q11"])
    funfairs_word_limit_checks = {
        "q33_limit_three_words": "NO MORE THAN THREE WORDS" in funfairs_group.get("bodyHtml", "")
    }

    # Roman Palace exam/explanation consistency (TFNG block)
    roman_exam = load_json_from_register_js(ROMAN_EXAM, "p1-high-171")
    roman_explanation = load_json_from_register_js(ROMAN_EXPLANATION, "p1-high-171")
    roman_answer_by_question = extract_answer_by_question(roman_explanation)
    roman_tfng_mismatches = []
    for idx, question_number in enumerate(range(1, 7), start=1):
        expected = str(roman_exam.get("answerKey", {}).get(f"q{idx}", "")).strip().upper()
        actual = roman_answer_by_question.get(question_number, "")
        if expected and actual and expected != actual:
            roman_tfng_mismatches.append(
                {"questionNumber": question_number, "expected": expected, "actual": actual}
            )

    # Wood/blank recognition guard
    wood_exam = load_json_from_register_js(WOOD_EXAM, "p1-medium-119")
    wood_q9 = wood_exam.get("answerKey", {}).get("q9", [])
    unified_page_text = UNIFIED_PAGE.read_text(encoding="utf-8")
    wood_checks = {
        "q9_alias_variants": isinstance(wood_q9, list) and {"60,000", "60000", "60 000"}.issubset(set(wood_q9)),
        "text_answer_fallback_enabled": "answers[questionId] = getTextualAnswer(questionId);" in unified_page_text,
    }

    # Plastic pdf-sync guard (repo-internal consistency)
    plastic_exam = load_json_from_register_js(PLASTIC_EXAM, "p1-medium-20")
    plastic_checks = {
        "pdf_filename_updated": "116. P1 - The Development of Plastics 塑料的发展史【次】.pdf" in str(
            plastic_exam.get("meta", {}).get("pdfFilename", "")
        ),
        "source_ref_present": "116. P1 - The Development of Plastics 塑料的发展史【次】.pdf" in str(
            plastic_exam.get("sourceRefs", {}).get("shuiPdf", "")
        ),
    }

    # Australian landscape title wording and Mercator spelling
    aus_exam = load_json_from_register_js(AUS_LANDSCAPE_EXAM, "p3-high-206")
    mercator_explanation = load_json_from_register_js(MERCATOR_EXPLANATION, "p3-medium-66")
    mercator_text_blob = "\n".join(
        item.get("text", "")
        for section in mercator_explanation.get("questionExplanations", [])
        for item in section.get("items", [])
    )
    content_wording_checks = {
        "australian_title_present": "Australian Landscapes" in str(aus_exam.get("meta", {}).get("title", "")),
        "mercator_areal_distortion_spelling": "areal distortion" in mercator_text_blob,
    }

    # Dedup guard for duplicate exam entries
    exam_actions_text = EXAM_ACTIONS.read_text(encoding="utf-8")
    dedup_checks = {
        "dedup_function_exists": "function deduplicateExams(exams)" in exam_actions_text,
        "dedup_applied_before_render": (
            "examsToShow = deduplicateExams(examsToShow);" in exam_actions_text
            or "examsToShow = applyBrowsePostFilters(examsToShow);" in exam_actions_text
        ),
    }

    # Suite detail wrong-count dynamic aggregation guard
    practice_modal_text = PRACTICE_MODAL.read_text(encoding="utf-8")
    suite_detail_checks = {
        "dynamic_summary_aggregation": "this.getEntriesSummary(this.collectAllEntries(record))" in practice_modal_text,
        "no_hardcoded_15": re.search(r"incorrectCount\\s*=\\s*15", practice_modal_text) is None,
    }

    # Suite frequency scope (high/high_medium/all) guard
    app_actions_text = APP_ACTIONS.read_text(encoding="utf-8")
    suite_mixin_text = SUITE_MIXIN.read_text(encoding="utf-8")
    suite_frequency_checks = {
        "selector_has_high_medium": "value=\"high_medium\"" in app_actions_text,
        "selector_has_high": "value=\"high\"" in app_actions_text,
        "selector_has_all": "value=\"all\"" in app_actions_text,
        "mixin_filters_high_medium": "frequencyScope === 'high_medium'" in suite_mixin_text,
        "mixin_filters_high": "frequencyScope === 'high'" in suite_mixin_text,
    }

    # Runtime report guard (suite e2e evidence)
    practice_enhancer_text = PRACTICE_ENHANCER.read_text(encoding="utf-8")
    suite_report_payload = {}
    try:
        suite_report_payload = json.loads(SUITE_REPORT.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        suite_report_payload = {}
    suite_report_checks = suite_report_payload.get("checks", {}) if isinstance(suite_report_payload, dict) else {}
    popstate_checks = {
        "suite_replay_report_pass": str(suite_report_payload.get("status", "")).lower() == "pass",
        "popstate_back_guard": bool(
            isinstance(suite_report_checks, dict) and suite_report_checks.get("popstateBackGuard") is True
        ),
    }

    # Replay duplicate-injection guard
    replay_checks = {
        "suite_replay_report_pass": str(suite_report_payload.get("status", "")).lower() == "pass",
        "no_replay_signature_dedup": "replaySignature" not in practice_enhancer_text and "REPLAY_PRACTICE_RECORD_SIGNATURE" not in practice_enhancer_text,
    }

    # Mark persistence in suite replay
    practice_ui_text = PRACTICE_UI.read_text(encoding="utf-8")
    marks_checks = {
        "ui_getter_exposed": "window.getPracticeMarkedQuestions = function getPracticeMarkedQuestions()" in practice_ui_text,
        "ui_setter_exposed": "window.setPracticeMarkedQuestions = function setPracticeMarkedQuestions(values)" in practice_ui_text,
        "suite_entry_contains_marks": "markedQuestions: Array.isArray(result.markedQuestions) ? result.markedQuestions.slice() : []" in suite_mixin_text,
        "replay_payload_contains_marks": "markedQuestions: Array.isArray(replayEntry.markedQuestions) ? replayEntry.markedQuestions : []" in suite_mixin_text,
        "unified_submit_contains_marks": "markedQuestions: (typeof global.getPracticeMarkedQuestions === 'function')" in unified_page_text,
    }

    # Answer comparison robustness (TF/YN/顺序无关)
    answer_util_text = ANSWER_UTIL.read_text(encoding="utf-8")
    answer_match_core_text = ANSWER_MATCH_CORE.read_text(encoding="utf-8")
    answer_comparison_checks = {
        "answer_match_core_exported": "global.AnswerMatchCore = api;" in answer_match_core_text,
        "answer_match_core_has_compare": "function compareAnswers(" in answer_match_core_text,
        "answer_util_calls_core_normalize": bool(
            re.search(r"core\s*&&\s*typeof\s+core\.normalizeToken\s*===\s*'function'", answer_util_text)
        ),
        "answer_util_calls_core_compare": bool(
            re.search(r"core\s*&&\s*typeof\s+core\.compareAnswers\s*===\s*'function'", answer_util_text)
        ),
        "unified_page_calls_core_compare": bool(
            re.search(r"core\s*&&\s*typeof\s+core\.compareAnswers\s*===\s*'function'", unified_page_text)
        ),
    }
    answer_comparison_dynamic = run_answer_comparison_dynamic_checks(ROOT)

    # Drag/heading answer-state sync guard
    drag_status_checks = {
        "dropzone_selector_covered": "const DROP_ZONE_SELECTOR = '.paragraph-dropzone .dropped-items, .match-dropzone, .dropzone, .drop-target-summary';" in practice_ui_text,
        "nav_status_updated_after_answer": "setNavStatus(questionId, hasValue ? 'answered' : null);" in practice_ui_text,
        "unified_nav_updates_on_input_change": "document.addEventListener('change', () => updateNavStatuses());" in unified_page_text
        and "document.addEventListener('input', () => updateNavStatuses());" in unified_page_text,
    }

    status_count = {"待修复": 0, "已修复待验证": 0, "已验证通过": 0}
    for row in checklist_rows:
        if row["status"] in status_count:
            status_count[row["status"]] += 1

    grouped_checks = {
        "classSizeChecks": class_size_checks,
        "patientSafetyChecks": patient_checks,
        "lookingNbChecks": looking_nb_checks,
        "funfairsWordLimitChecks": funfairs_word_limit_checks,
        "woodChecks": wood_checks,
        "plasticChecks": plastic_checks,
        "contentWordingChecks": content_wording_checks,
        "dedupChecks": dedup_checks,
        "suiteDetailChecks": suite_detail_checks,
        "suiteFrequencyChecks": suite_frequency_checks,
        "popstateChecks": popstate_checks,
        "replayChecks": replay_checks,
        "marksChecks": marks_checks,
        "answerComparisonChecks": answer_comparison_checks,
        "dragStatusChecks": drag_status_checks,
    }
    list_checks = {
        "onlyInMapping": only_mapping,
        "onlyInChecklist": only_checklist,
        "invalidStatusRows": invalid_status,
        "missingEvidenceForVerified": missing_evidence_for_verified,
        "monaBannedPatternHits": banned_hits,
        "monaAnswerMismatches": answer_mismatches,
        "romanTfngMismatches": roman_tfng_mismatches,
    }
    scalar_error_checks = {
        "monaCoverageOk": coverage_ok,
        "monaTranslationComplete": mona_translation_complete,
        "elephantHasExamClass": elephant_has_exam_class,
        "elephantHasCssRule": elephant_has_css_rule,
        "answerComparisonDynamic.node_exec_ok": answer_comparison_dynamic.get("node_exec_ok", False),
        "answerComparisonDynamic.all_pass": answer_comparison_dynamic.get("all_pass", False),
    }
    negated_error_checks = {
        "mechanicalHasInfoBox": mechanical_has_info_box,
    }

    failed_error_checks: list[str] = []
    failed_error_checks.extend(
        name for name, value in list_checks.items() if bool(value)
    )
    failed_error_checks.extend(
        name for name, value in scalar_error_checks.items() if not bool(value)
    )
    failed_error_checks.extend(
        name for name, value in negated_error_checks.items() if bool(value)
    )
    failed_error_checks.extend(
        name for name, checks in grouped_checks.items() if not all(checks.values())
    )

    result = {
        "mappingCount": len(mapping_ids),
        "checklistCount": len(checklist_ids),
        "statusCount": status_count,
        "onlyInMapping": only_mapping,
        "onlyInChecklist": only_checklist,
        "invalidStatusRows": invalid_status,
        "missingEvidenceForVerified": missing_evidence_for_verified,
        "monaBannedPatternHits": banned_hits,
        "monaCoverageOk": coverage_ok,
        "monaAnswerMismatches": answer_mismatches,
        "monaSourceDoc": mona_explanation.get("meta", {}).get("sourceDoc", ""),
        "monaTranslationComplete": mona_translation_complete,
        "mechanicalHasInfoBox": mechanical_has_info_box,
        "elephantHasExamClass": elephant_has_exam_class,
        "elephantHasCssRule": elephant_has_css_rule,
        "classSizeChecks": class_size_checks,
        "patientSafetyChecks": patient_checks,
        "lookingNbChecks": looking_nb_checks,
        "funfairsWordLimitChecks": funfairs_word_limit_checks,
        "romanTfngMismatches": roman_tfng_mismatches,
        "woodChecks": wood_checks,
        "plasticChecks": plastic_checks,
        "contentWordingChecks": content_wording_checks,
        "dedupChecks": dedup_checks,
        "suiteDetailChecks": suite_detail_checks,
        "suiteFrequencyChecks": suite_frequency_checks,
        "popstateChecks": popstate_checks,
        "replayChecks": replay_checks,
        "marksChecks": marks_checks,
        "answerComparisonChecks": answer_comparison_checks,
        "answerComparisonDynamic": answer_comparison_dynamic,
        "dragStatusChecks": drag_status_checks,
        "failedErrorChecks": failed_error_checks,
    }

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    has_error = bool(failed_error_checks)

    print(json.dumps(result, ensure_ascii=False))
    return 1 if has_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
