import importlib.util
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOL_PATH = REPO_ROOT / "developer" / "tests" / "tools" / "listeningpractice" / "migrate_native_sources.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("migrate_native_sources", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ListeningMigrateSecurityTest(unittest.TestCase):
    def _symlink_or_skip(self, source: Path, target: Path, directory: bool = False) -> None:
        try:
            target.symlink_to(source, target_is_directory=directory)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"symlink creation is not available: {exc}")

    def test_iter_topic_dirs_skips_symlinked_topic_directories(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source_root = tmp_path / "native"
            outside_topic = tmp_path / "outside-topic"
            outside_topic.mkdir()
            (outside_topic / "sample.html").write_text("<html></html>", encoding="utf-8")

            frequency_root = source_root / tool.SOURCE_GROUPS[0] / "P1" / "high"
            frequency_root.mkdir(parents=True)
            self._symlink_or_skip(outside_topic, frequency_root / "linked-topic", directory=True)

            self.assertEqual(list(tool.iter_topic_dirs(source_root)), [])

    def test_iter_topic_dirs_skips_symlinked_source_groups(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source_root = tmp_path / "native"
            outside_group = tmp_path / "outside-group"
            outside_topic = outside_group / "P1" / "high" / "topic"
            outside_topic.mkdir(parents=True)
            (outside_topic / "sample.html").write_text("<html></html>", encoding="utf-8")
            source_root.mkdir()
            self._symlink_or_skip(outside_group, source_root / tool.SOURCE_GROUPS[0], directory=True)

            self.assertEqual(list(tool.iter_topic_dirs(source_root)), [])

    def test_copy_topic_ignores_symlinked_files(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            source = tmp_path / "source-topic"
            target_root = tmp_path / "ListeningPractice"
            target = target_root / "P1" / "high" / "topic"
            outside = tmp_path / "outside-secret.html"
            source.mkdir()
            target_root.mkdir()
            (source / "sample.html").write_text("<html></html>", encoding="utf-8")
            outside.write_text("secret", encoding="utf-8")
            self._symlink_or_skip(outside, source / "linked-secret.html")

            result = tool.copy_topic(source, target, target_root.resolve(), replace=True)

            self.assertEqual(result, "copied")
            self.assertTrue((target / "sample.html").exists())
            self.assertFalse((target / "linked-secret.html").exists())


if __name__ == "__main__":
    unittest.main()
