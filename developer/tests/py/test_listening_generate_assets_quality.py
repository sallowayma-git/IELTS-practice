import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_PATH = REPO_ROOT / "developer" / "tests" / "tools" / "listeningpractice" / "generate_listening_assets.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("generate_listening_assets", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ListeningGenerateAssetsQualityTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
