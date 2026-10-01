import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_PATH = REPO_ROOT / "developer" / "tests" / "tools" / "listeningpractice" / "generate_listening_assets.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("generate_listening_assets", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ListeningGenerateAssetsQualityTest(unittest.TestCase):
    def test_index_generation_preserves_controlled_wrapper_and_excludes_fixture_content(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            imports = root / "ListeningPractice/P1/fixture"
            imports.mkdir(parents=True)
            (imports / "exam.html").write_text('<html><head><title>Synthetic fixture</title></head><body><input name="q1" value="PRIVATE_ANSWER"></body></html>', encoding="utf-8")
            output = root / "generated"
            output.mkdir()
            wrapper = output / "listening-practice-unified.html"
            original = b'<!-- controlled diagnostic bootstrap -->\r\n<html>maintained wrapper</html>'
            wrapper.write_bytes(original)
            argv = ["generate_listening_assets.py", "--root", str(root / "ListeningPractice"),
                    "--index-output", str(output / "index.js"), "--manifest-output", str(output / "manifest.js"),
                    "--report", str(output / "report.json")]
            with mock.patch.object(sys, "argv", argv):
                self.assertEqual(tool.main(), 0)
            self.assertEqual(wrapper.read_bytes(), original)
            self.assertNotIn("PRIVATE_ANSWER", (output / "manifest.js").read_text(encoding="utf-8"))
            self.assertEqual(json.loads((output / "report.json").read_text(encoding="utf-8"))["wrapperOwner"], "scripts/build-bundles.mjs")

    def test_clean_title_removes_corrupt_middle_dot_separator(self):
        tool = load_tool()

        self.assertEqual(
            tool.clean_title("IELTS Listening \u8def Dolphin Presentation"),
            "Dolphin Presentation",
        )

    def test_clean_title_rejects_mojibake_candidates(self):
        tool = load_tool()

        self.assertEqual(
            tool.clean_title("IELTS Listening \u8def \u9354\u529b\u93b7\u62f7"),
            "",
        )

    def test_clean_title_preserves_normal_chinese_title(self):
        tool = load_tool()

        self.assertEqual(
            tool.clean_title("雅思听力机考模拟 · 触觉研究专题"),
            "雅思听力机考模拟 · 触觉研究专题",
        )

    def test_question_content_detection_rejects_placeholder_shell(self):
        tool = load_tool()

        self.assertFalse(tool.has_question_content("<html><body><h1>Test New Question</h1><p>placeholder</p></body></html>"))

    def test_question_content_detection_accepts_interactive_questions(self):
        tool = load_tool()

        self.assertTrue(tool.has_question_content("<html><body><p>Questions 1-5</p><input name='q1'></body></html>"))

    def test_question_content_detection_accepts_entity_nbsp(self):
        tool = load_tool()

        # Real listening pages sometimes separate "Questions" and the number with
        # an HTML entity (&#160; / &nbsp;). The naive regex missed these.
        self.assertTrue(tool.has_question_content("<html><body><p>Questions&#160;1-5</p></body></html>"))

    def test_question_content_detection_accepts_tagged_number(self):
        tool = load_tool()

        # Number wrapped in inline tags (e.g. <b>1</b>) between "Questions" and the digit.
        self.assertTrue(tool.has_question_content("<html><body><p>Questions <b>1</b>-<b>5</b></p></body></html>"))

    def test_question_content_detection_accepts_ordered_list(self):
        tool = load_tool()

        # Numbered questions rendered as a list without an explicit "Questions N" heading.
        self.assertTrue(tool.has_question_content("<html><body><ol><li>First</li><li>Second</li></ol></body></html>"))

    def test_question_content_detection_accepts_image_question(self):
        tool = load_tool()

        # Image-only questions carry no text signal; detect via question-related <img>.
        self.assertTrue(tool.has_question_content("<html><body><img class='question-image' src='q1.png' alt='question 1'></body></html>"))


if __name__ == "__main__":
    unittest.main()
