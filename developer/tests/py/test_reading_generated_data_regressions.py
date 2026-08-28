#!/usr/bin/env python3
from __future__ import annotations

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
