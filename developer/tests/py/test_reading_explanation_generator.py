#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "assets" / "scripts" / "generate_reading_explanations_with_agent.py"


def wrap_register(bundle_name: str, payload: dict) -> str:
    return (
        "(function registerData(global) {\n"
        "  'use strict';\n"
        f"  global.__REGISTRY__.register(\"{bundle_name}\", {json.dumps(payload, ensure_ascii=False, indent=2)});\n"
        "})(typeof window !== 'undefined' ? window : globalThis);\n"
    )


class ReadingExplanationGeneratorTest(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "assets" / "generated" / "reading-exams").mkdir(parents=True)
        (self.root / "assets" / "generated" / "reading-explanations").mkdir(parents=True)
        self.work_dir = self.root / "work"

        exam_payload = {
            "schemaVersion": "ReadingExamSourceV1",
            "examId": "sample-exam",
            "meta": {
                "title": "Sample Exam",
                "category": "P1",
                "pdfFilename": "sample.pdf",
            },
            "passage": {
                "blocks": [
                    {
                        "blockId": "passage-main",
                        "kind": "html",
                        "html": (
                            "<p>You should spend about 20 minutes on Questions 1-2.</p>"
                            "<p>Paragraph one text.</p>"
                            "<p>Paragraph two text.</p>"
                        ),
                    }
                ]
            },
            "questionGroups": [
                {
                    "groupId": "group-1",
                    "kind": "true_false_not_given",
                    "questionIds": ["q1", "q2"],
                    "bodyHtml": (
                        '<div class="question-item" id="q1-anchor"><p>1. Statement one.</p></div>'
                        '<div class="question-item" id="q2-anchor"><p>2. Statement two.</p></div>'
                    ),
                }
            ],
            "answerKey": {
                "q1": "TRUE",
                "q2": "FALSE",
            },
        }
        exam_path = self.root / "assets" / "generated" / "reading-exams" / "sample-exam.js"
        exam_path.write_text(wrap_register("sample-exam", exam_payload), encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_script(self, *args: str, expect_ok: bool = True) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["READING_EXPLANATION_REPO_ROOT"] = str(self.root)
        completed = subprocess.run(
            ["python3", str(SCRIPT_PATH), *args],
            capture_output=True,
            text=True,
            env=env,
        )
        if expect_ok and completed.returncode != 0:
            self.fail(completed.stdout + "\n" + completed.stderr)
        return completed

    def test_prepare_and_render_round_trip(self) -> None:
        self.run_script("prepare", "sample-exam", "--work-dir", str(self.work_dir), "--write-template")

        request_path = self.work_dir / "requests" / "sample-exam.json"
        response_path = self.work_dir / "responses" / "sample-exam.json"
        self.assertTrue(request_path.exists())
        self.assertTrue(response_path.exists())

        response = json.loads(response_path.read_text(encoding="utf-8"))
        response["passageNotes"] = [
            {"label": "Paragraph 1", "text": "第一段讲第一条信息。"},
            {"label": "Paragraph 2", "text": "第二段讲第二条信息。"},
        ]
        response["questionExplanations"][0]["items"][0]["text"] = (
            "题目：Statement one.\n题目翻译：陈述一。\n答案：TRUE\n解析：原文信息与题干一致。"
        )
        response["questionExplanations"][0]["items"][1]["text"] = (
            "题目：Statement two.\n题目翻译：陈述二。\n答案：FALSE\n解析：原文信息与题干相反。"
        )
        response["questionExplanations"][0]["text"] = "\n".join(
            item["text"] for item in response["questionExplanations"][0]["items"]
        )
        response_path.write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")

        output_path = self.root / "assets" / "generated" / "reading-explanations" / "sample-exam.js"
        self.run_script(
            "render",
            "sample-exam",
            "--response",
            str(response_path),
            "--output",
            str(output_path),
        )

        self.assertTrue(output_path.exists())
        content = output_path.read_text(encoding="utf-8")
        self.assertIn("答案：TRUE", content)
        self.assertIn("题目翻译：陈述一。", content)

    def test_render_rejects_answer_mismatch(self) -> None:
        self.run_script("prepare", "sample-exam", "--work-dir", str(self.work_dir), "--write-template")
        response_path = self.work_dir / "responses" / "sample-exam.json"
        response = json.loads(response_path.read_text(encoding="utf-8"))
        response["passageNotes"] = [{"label": "Paragraph 1", "text": "段落翻译。"}]
        response["questionExplanations"][0]["items"][0]["text"] = (
            "题目：Statement one.\n题目翻译：陈述一。\n答案：FALSE\n解析：故意写错。"
        )
        response["questionExplanations"][0]["items"][1]["text"] = (
            "题目：Statement two.\n题目翻译：陈述二。\n答案：FALSE\n解析：这个是对的。"
        )
        response["questionExplanations"][0]["text"] = "\n".join(
            item["text"] for item in response["questionExplanations"][0]["items"]
        )
        response_path.write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding="utf-8")

        completed = self.run_script(
            "render",
            "sample-exam",
            "--response",
            str(response_path),
            expect_ok=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("答案与 answerKey 不一致", completed.stdout)


if __name__ == "__main__":
    unittest.main()
