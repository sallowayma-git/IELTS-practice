#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
import unittest
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Tuple


REPO_ROOT = Path(__file__).resolve().parents[3]
EXAM_DIR = REPO_ROOT / "assets" / "generated" / "reading-exams"
EXPLANATION_DIR = REPO_ROOT / "assets" / "generated" / "reading-explanations"
REGISTER_RE = re.compile(
    r"\.register\(\s*['\"]([^'\"]+)['\"]\s*,\s*(\{[\s\S]*\})\s*\)\s*;?\s*\}",
    re.MULTILINE,
)
HTML_TAG_RE = re.compile(r"<[^>]+>")
OPTION_LABEL_RE = re.compile(
    r"<label\b[^>]*>\s*<input\b[^>]*\bvalue=['\"]([A-Z])['\"][^>]*>([\s\S]*?)</label>",
    re.IGNORECASE,
)
ANSWER_WITH_OPTION_RE = re.compile(
    r"(?:^|\n)\s*答案[：:]\s*([A-Z])\s*[（(](.+)[）)]\s*(?:\n|$)",
    re.MULTILINE,
)
ISSUE_130_SPLIT_MULTI_CHOICE_EXAMS = {
    "p1-medium-247",
    "p2-high-16",
    "p2-high-232",
    "p2-low-240",
    "p2-low-242",
    "p2-low-50",
    "p2-medium-243",
    "p2-medium-245",
    "p2-medium-248",
    "p2-medium-86",
    "p3-low-186",
}


def load_registered_payload(path: Path) -> Tuple[str, Dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    match = REGISTER_RE.search(source)
    if not match:
        raise AssertionError(f"register payload not found: {path.relative_to(REPO_ROOT)}")
    try:
        payload = json.loads(match.group(2))
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"register payload is not strict JSON: {path.relative_to(REPO_ROOT)}:{exc.lineno}:{exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(payload, dict):
        raise AssertionError(f"register payload is not an object: {path.relative_to(REPO_ROOT)}")
    return match.group(1), payload


def load_manifest(path: Path, marker: str) -> Dict[str, Dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    marker_index = source.find(marker)
    if marker_index < 0:
        raise AssertionError(f"manifest marker not found: {path.relative_to(REPO_ROOT)}")
    start = source.find("{", marker_index + len(marker))
    if start < 0:
        raise AssertionError(f"manifest object not found: {path.relative_to(REPO_ROOT)}")
    try:
        payload, _ = json.JSONDecoder().raw_decode(source[start:])
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"manifest is not strict JSON: {path.relative_to(REPO_ROOT)}:{exc.lineno}:{exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(payload, dict):
        raise AssertionError(f"manifest payload is not an object: {path.relative_to(REPO_ROOT)}")
    return payload


def normalise_visible_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(HTML_TAG_RE.sub(" ", value))).strip()


def extract_checkbox_options(body_html: str) -> Dict[str, str]:
    options: Dict[str, str] = {}
    for match in OPTION_LABEL_RE.finditer(body_html):
        letter = match.group(1).upper()
        label = normalise_visible_text(match.group(2))
        options[letter] = re.sub(
            rf"^{re.escape(letter)}(?:[.)])?\s*",
            "",
            label,
            count=1,
            flags=re.IGNORECASE,
        )
    return options


class ReadingGeneratedDataRegressionTest(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls) -> None:
        cls.exam_files = {path.stem: path for path in EXAM_DIR.glob("p*-*.js")}
        cls.explanation_files = {path.stem: path for path in EXPLANATION_DIR.glob("p*-*.js")}
        cls.exam_payloads = {
            exam_id: load_registered_payload(path)
            for exam_id, path in sorted(cls.exam_files.items())
        }
        cls.explanation_payloads = {
            exam_id: load_registered_payload(path)
            for exam_id, path in sorted(cls.explanation_files.items())
        }

    def test_manifests_match_files_and_registration_ids(self) -> None:
        exam_manifest = load_manifest(EXAM_DIR / "manifest.js", "const manifest =")
        explanation_manifest = load_manifest(
            EXPLANATION_DIR / "manifest.js",
            "global.__READING_EXPLANATION_MANIFEST__ =",
        )
        self.assertEqual(set(exam_manifest), set(self.exam_files))
        self.assertEqual(set(explanation_manifest), set(self.explanation_files))

        for manifest, files, payloads, base_dir in (
            (exam_manifest, self.exam_files, self.exam_payloads, EXAM_DIR),
            (explanation_manifest, self.explanation_files, self.explanation_payloads, EXPLANATION_DIR),
        ):
            for key, entry in manifest.items():
                with self.subTest(manifest=base_dir.name, exam_id=key):
                    self.assertEqual(entry.get("examId"), key)
                    self.assertEqual(entry.get("dataKey"), key)
                    script = str(entry.get("script") or "")
                    self.assertTrue(script)
                    self.assertTrue((base_dir / script).resolve().is_file(), script)
                    self.assertEqual((base_dir / script).resolve(), files[key].resolve())
                    register_id, payload = payloads[key]
                    self.assertEqual(register_id, key)
                    self.assertEqual(payload.get("examId"), key)
                    self.assertEqual(files[key].stem, key)

    def test_each_exam_question_belongs_to_exactly_one_group(self) -> None:
        for exam_id, (_, payload) in self.exam_payloads.items():
            with self.subTest(exam_id=exam_id):
                answer_ids = set((payload.get("answerKey") or {}).keys())
                grouped_ids = [
                    question_id
                    for group in payload.get("questionGroups") or []
                    for question_id in (group.get("questionIds") or [])
                ]
                counts = Counter(grouped_ids)
                self.assertEqual(set(grouped_ids), answer_ids)
                self.assertEqual(
                    {question_id: count for question_id, count in counts.items() if count != 1},
                    {},
                )

    def test_explanation_items_are_unique_and_use_display_numbers(self) -> None:
        for exam_id, (_, explanation) in self.explanation_payloads.items():
            exam_entry = self.exam_payloads.get(exam_id)
            if not exam_entry:
                continue
            exam = exam_entry[1]
            display_map = exam.get("questionDisplayMap") or {}
            items = [
                item
                for section in explanation.get("questionExplanations") or []
                for item in (section.get("items") or [])
                if isinstance(item, dict)
            ]
            question_ids = [str(item.get("questionId") or "") for item in items]
            with self.subTest(exam_id=exam_id):
                self.assertTrue(all(question_ids))
                self.assertLessEqual(set(question_ids), set((exam.get("answerKey") or {}).keys()))
                self.assertEqual(
                    {question_id: count for question_id, count in Counter(question_ids).items() if count != 1},
                    {},
                )
                for item in items:
                    question_id = str(item.get("questionId") or "")
                    display_number = str(display_map.get(question_id) or "")
                    if display_number.isdigit():
                        self.assertEqual(item.get("questionNumber"), int(display_number), question_id)

    def test_issue_130_split_multi_choice_explanations_match_slots_and_options(self) -> None:
        # Older imports sometimes keep a whole multi-answer group in section.text
        # without per-question items.  Scope the stricter split-slot contract to
        # the assets repaired for issue #130 so unrelated legacy debt stays out.
        for exam_id in sorted(ISSUE_130_SPLIT_MULTI_CHOICE_EXAMS):
            exam = self.exam_payloads[exam_id][1]
            explanation = self.explanation_payloads[exam_id][1]
            answer_key = exam.get("answerKey") or {}
            items = [
                item
                for section in explanation.get("questionExplanations") or []
                for item in (section.get("items") or [])
                if isinstance(item, dict)
            ]
            item_counts = Counter(str(item.get("questionId") or "") for item in items)
            split_groups = [
                group
                for group in exam.get("questionGroups") or []
                if group.get("kind") in {"multi_choice", "multiple_choice"}
                and len(group.get("questionIds") or []) > 1
            ]

            with self.subTest(exam_id=exam_id, contract="has split group"):
                self.assertTrue(split_groups)

            for group in split_groups:
                question_ids = [str(question_id) for question_id in group.get("questionIds") or []]
                options = extract_checkbox_options(str(group.get("bodyHtml") or ""))
                with self.subTest(exam_id=exam_id, question_ids=question_ids):
                    self.assertEqual(
                        {question_id: item_counts[question_id] for question_id in question_ids},
                        {question_id: 1 for question_id in question_ids},
                    )
                    self.assertTrue(options)

                    for question_id in question_ids:
                        expected_letter = answer_key.get(question_id)
                        self.assertIsInstance(expected_letter, str, question_id)
                        expected_letter = expected_letter.strip().upper()
                        self.assertRegex(expected_letter, r"^[A-Z]$", question_id)
                        self.assertIn(expected_letter, options, question_id)

                        item = next(
                            item for item in items if str(item.get("questionId") or "") == question_id
                        )
                        answer_match = ANSWER_WITH_OPTION_RE.search(str(item.get("text") or ""))
                        self.assertIsNotNone(answer_match, question_id)
                        assert answer_match is not None
                        self.assertEqual(answer_match.group(1).upper(), expected_letter, question_id)
                        self.assertEqual(
                            normalise_visible_text(answer_match.group(2)),
                            options[expected_letter],
                            question_id,
                        )

    def test_climate_logbook_explanation_supports_the_accepted_pair(self) -> None:
        exam = self.exam_payloads["p2-medium-245"][1]
        explanation = self.explanation_payloads["p2-medium-245"][1]
        group = next(group for group in exam["questionGroups"] if group["questionIds"] == ["q9", "q10"])
        options = extract_checkbox_options(group["bodyHtml"])
        section = next(
            section for section in explanation["questionExplanations"]
            if any(item.get("questionId") == "q10" for item in section.get("items") or [])
        )
        self.assertEqual(section["text"], "\n\n".join(item["text"] for item in section["items"]))
        for question_id, expected_answer in (("q9", "C"), ("q10", "E")):
            with self.subTest(question_id=question_id):
                self.assertEqual(exam["answerKey"][question_id], expected_answer)
                item = next(item for item in section["items"] if item["questionId"] == question_id)
                answer_match = ANSWER_WITH_OPTION_RE.search(item["text"])
                self.assertIsNotNone(answer_match)
                assert answer_match is not None
                self.assertEqual(answer_match.group(1), expected_answer)
                self.assertEqual(normalise_visible_text(answer_match.group(2)), options[expected_answer])
        q23 = next(item["text"] for item in section["items"] if item["questionId"] == "q10")
        self.assertIn("定位：第8段", q23)
        evidence = re.search(r"(?:^|\n)原文：([^\n]+)", q23)
        self.assertIsNotNone(evidence)
        assert evidence is not None
        self.assertIn("naval and merchant vessels", evidence.group(1))
        passage = normalise_visible_text(" ".join(block["html"] for block in exam["passage"]["blocks"]))
        self.assertIn(normalise_visible_text(evidence.group(1)), passage)

    def test_water_filter_explanations_declare_one_answer_per_slot(self) -> None:
        exam = self.exam_payloads["p2-low-64"][1]
        explanation = self.explanation_payloads["p2-low-64"][1]
        section = next(
            section for section in explanation["questionExplanations"]
            if any(item.get("questionId") == "q1" for item in section.get("items") or [])
        )
        self.assertEqual(section["text"], "\n\n".join(item["text"] for item in section["items"]))
        self.assertNotRegex(section["text"], r"顺序不限|任意顺序|either order|any order")
        expected_answers = {"q1": "clay", "q2": "water", "q3": "straw", "q4": "cow manure"}
        for question_id, expected_answer in expected_answers.items():
            with self.subTest(question_id=question_id):
                self.assertEqual(exam["answerKey"][question_id], expected_answer)
                item = next(item for item in section["items"] if item["questionId"] == question_id)
                answer_match = re.search(r"(?:^|\n)答案[：:]\s*([^\n]+)", item["text"])
                self.assertIsNotNone(answer_match)
                assert answer_match is not None
                self.assertEqual(answer_match.group(1).strip(), expected_answer)

    def test_issue_130_p3_low_219_keeps_combined_answer_range(self) -> None:
        exam = self.exam_payloads["p3-low-219"][1]
        explanation = self.explanation_payloads["p3-low-219"][1]
        group = next(
            group
            for group in exam["questionGroups"]
            if group.get("kind") == "multi_choice" and group.get("questionIds") == ["q12"]
        )
        section = next(
            section
            for section in explanation["questionExplanations"]
            if any(item.get("questionId") == "q12" for item in section.get("items") or [])
        )
        item = next(item for item in section["items"] if item.get("questionId") == "q12")

        self.assertEqual(group["questionIds"], ["q12"])
        self.assertEqual(exam["answerKey"]["q12"], ["A", "D", "E"])
        self.assertEqual(exam["questionDisplayMap"]["q12"], "38-40")
        self.assertIn("Questions 38–40", str(section.get("sectionTitle") or ""))
        self.assertEqual(section.get("questionRange"), {"start": 38, "end": 40})
        self.assertEqual(item.get("questionNumber"), 38)
        for text in (item.get("text"), section.get("text")):
            text = str(text or "")
            self.assertIn("38–40", text)
            self.assertNotRegex(text, r"\b(?:NaN|Infinity)\b")

        answer_match = re.search(
            r"(?:^|\n)\s*答案[：:]\s*([A-Z](?:\s*[,，、/|]\s*[A-Z])*)\s*(?:\n|$)",
            str(item.get("text") or ""),
        )
        self.assertIsNotNone(answer_match)
        assert answer_match is not None
        self.assertEqual(re.findall(r"[A-Z]", answer_match.group(1).upper()), ["A", "D", "E"])

    def test_issue_130_embedded_question_numbers_are_visible(self) -> None:
        expected_numbered_stems = {
            "p2-medium-245": {
                "q11": (24, "The earliest extensive weather records"),
                "q12": (25, "The relationship between wind speed and distance sailed"),
                "q13": (26, "Comparisons were made between the logbooks"),
            },
            "p2-medium-248": {
                "q1": (14, "reference to an award-winning formula"),
                "q2": (15, "an acknowledgement of the general shortcomings"),
                "q3": (16, "mention of a working partnership"),
                "q4": (17, "reference to the demanding nature"),
                "q5": (18, "the advantage of combining two different methods"),
                "q6": (19, "a comparison between goods from home and abroad"),
            },
        }
        for exam_id, expected_by_id in expected_numbered_stems.items():
            exam = self.exam_payloads[exam_id][1]
            for question_id, (display_number, stem) in expected_by_id.items():
                group = next(
                    group
                    for group in exam["questionGroups"]
                    if question_id in (group.get("questionIds") or [])
                )
                body_html = str(group.get("bodyHtml") or "")
                if exam_id == "p2-medium-245":
                    starts = [
                        match.start()
                        for match in re.finditer(
                            r"<div\b[^>]*\bclass=['\"][^'\"]*\bquestion-item\b[^'\"]*['\"][^>]*>",
                            body_html,
                            re.IGNORECASE,
                        )
                    ]
                    blocks = [
                        body_html[start : starts[index + 1] if index + 1 < len(starts) else None]
                        for index, start in enumerate(starts)
                    ]
                else:
                    blocks = re.findall(r"<tr\b[^>]*>[\s\S]*?</tr>", body_html, re.IGNORECASE)
                input_pattern = re.compile(
                    rf"<input\b[^>]*\bname=['\"]{re.escape(question_id)}['\"]",
                    re.IGNORECASE,
                )
                matching_blocks = [block for block in blocks if input_pattern.search(block)]
                with self.subTest(exam_id=exam_id, question_id=question_id):
                    self.assertEqual(len(matching_blocks), 1)
                    visible = normalise_visible_text(matching_blocks[0])
                    self.assertRegex(
                        visible,
                        rf"\b{display_number}\.?\s+{re.escape(stem)}",
                    )

    def test_issue_130_p1_medium_247_stem_regressions(self) -> None:
        exam = self.exam_payloads["p1-medium-247"][1]
        explanation = self.explanation_payloads["p1-medium-247"][1]
        multi_choice_group = next(
            group for group in exam["questionGroups"] if group.get("kind") == "multi_choice"
        )
        self.assertIn(
            "Which THREE reasons are mentioned by the writer of the text to explain why the castle takes longer to build?",
            normalise_visible_text(multi_choice_group["bodyHtml"]),
        )

        item_by_id = {
            item["questionId"]: item
            for section in explanation["questionExplanations"]
            for item in section.get("items") or []
            if item.get("questionId")
        }
        expected_stems = {
            "q8": "The ________ drill rows of ________.",
            "q9": "The ________ drill rows of ________.",
            "q10": "________ are used.",
            "q11": "The result is that the rock eventually ________.",
            "q12": "is made into ________.",
            "q13": "or, through a ________ process, can be used to make quicklime.",
        }
        for question_id, expected_stem in expected_stems.items():
            item_text = str(item_by_id[question_id]["text"])
            first_line = item_text.splitlines()[0]
            with self.subTest(question_id=question_id):
                self.assertEqual(first_line.split("：", 1)[-1], expected_stem)
                answer_match = re.search(r"(?:^|\n)答案[：:]\s*([^\n]+)", item_text)
                self.assertIsNotNone(answer_match)
                assert answer_match is not None
                self.assertEqual(
                    answer_match.group(1).strip().casefold(),
                    str(exam["answerKey"][question_id]).strip().casefold(),
                )

    def test_p1_low_72_explanation_matches_exam_prompts_and_answers(self) -> None:
        _, exam = self.exam_payloads["p1-low-72"]
        _, explanation = self.explanation_payloads["p1-low-72"]
        answer_key = exam["answerKey"]
        item_by_id = {
            item["questionId"]: item
            for section in explanation["questionExplanations"]
            for item in section["items"]
        }

        # The first six explanation items were previously paired with an
        # unrelated TRUE/FALSE question set, while q7-q13 contained the
        # displaced gap-fill prompts.  Pin representative source wording and
        # every declared answer to the actual exam contract.
        expected_prompt_fragments = {
            "q1": "The online map provides users with a store's name",
            "q2": "One goal of the mapping project",
            "q3": "Citizen maps are sometimes made",
            "q4": "people living in food deserts",
            "q5": "Some supermarkets are unable",
            "q6": "Small grocery stores in cities",
            "q7": "professional researchers are in charge",
            "q8": "without the owner's knowledge",
            "q9": "experienced technical difficulties",
            "q10": "city government has taken a considerable interest",
            "q11": "should contain additional information",
            "q12": "internet use in Brooklyn",
            "q13": "more people to assist",
        }
        for question_id, expected_fragment in expected_prompt_fragments.items():
            with self.subTest(question_id=question_id):
                item_text = item_by_id[question_id]["text"]
                self.assertIn(expected_fragment, item_text)
                answer_match = re.search(r"(?:^|\n)答案[：:]\s*([^\n]+)", item_text)
                self.assertIsNotNone(answer_match)
                self.assertEqual(
                    answer_match.group(1).strip().casefold(),
                    str(answer_key[question_id]).strip().casefold(),
                )


if __name__ == "__main__":
    unittest.main()
