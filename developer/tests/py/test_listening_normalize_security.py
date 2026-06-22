import importlib.util
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_PATH = REPO_ROOT / "developer" / "tests" / "tools" / "listeningpractice" / "normalize_listeningpractice_html.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("normalize_listeningpractice_html", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ListeningNormalizeSecurityTest(unittest.TestCase):
    def test_update_title_escapes_html_text(self):
        tool = load_tool()
        updated, changed = tool.update_title(
            "<!doctype html><html><head><title>old</title></head><body></body></html>",
            "Safe <script>alert(1)</script> & Topic",
        )

        self.assertTrue(changed)
        self.assertNotIn("<script>", updated)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", updated)
        self.assertIn("Safe &lt;script&gt;alert(1)&lt;/script&gt; &amp; Topic", updated)

    def test_update_h1_escapes_inserted_html_text(self):
        tool = load_tool()
        updated, changed = tool.update_h1(
            "<!doctype html><html><head></head><body><p>content</p></body></html>",
            "Part 1 - <img src=x onerror=alert(1)>",
        )

        self.assertTrue(changed)
        self.assertNotIn("<img src=x onerror=alert(1)>", updated)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", updated)

    def test_backup_path_uses_path_relative_to_absolute_root(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root = (tmp_path / "ListeningPractice").resolve()
            source = root / "P1" / "sample.html"
            backup_dir = tmp_path / "backup"
            source.parent.mkdir(parents=True)
            source.write_text("<html></html>", encoding="utf-8")

            backup_path = tool.resolve_backup_path(backup_dir, root, source)

            self.assertEqual(backup_path, backup_dir / "P1" / "sample.html")
            self.assertTrue(str(backup_path).startswith(str(backup_dir)))

    def test_relative_to_root_rejects_paths_outside_root(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            root = (tmp_path / "ListeningPractice").resolve()
            outside = (tmp_path / "outside.html").resolve()
            root.mkdir()
            outside.write_text("<html></html>", encoding="utf-8")

            with self.assertRaises(ValueError):
                tool.relative_to_root(root, outside)


if __name__ == "__main__":
    unittest.main()
