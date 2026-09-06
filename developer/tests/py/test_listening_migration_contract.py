import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOLS_ROOT = REPO_ROOT / "developer" / "tests" / "tools" / "listeningpractice"


def load_tool(name: str):
    path = TOOLS_ROOT / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ListeningMigrationContractTest(unittest.TestCase):
    def test_static_bridge_replacement_is_relative_and_idempotent(self):
        contract = load_tool("listening_bridge_contract")
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            html_path = workspace / "ListeningPractice" / "P1" / "frequency" / "topic" / "exam.html"
            bridge_target = workspace / "js" / "bundles" / contract.BRIDGE_FILENAME
            html_path.parent.mkdir(parents=True)
            bridge_target.parent.mkdir(parents=True)
            bridge_target.write_text("// fixture", encoding="utf-8")
            original = """<html><body>
<script src=\"../../../js/practice-page-enhancer.js\"></script>
<script src=\"broken/listening-record-bridge.bundle.js\"></script>
</body></html>"""

            updated, changed, src = contract.ensure_static_bridge(original, html_path, bridge_target)
            repeated, repeated_changed, repeated_src = contract.ensure_static_bridge(updated, html_path, bridge_target)

            self.assertTrue(changed)
            self.assertFalse(repeated_changed)
            self.assertEqual(repeated, updated)
            self.assertEqual(repeated_src, src)
            self.assertEqual(src, "../../../../js/bundles/listening-record-bridge.bundle.js")
            self.assertEqual(updated.count("listening-record-bridge.bundle.js"), 1)
            self.assertIn('data-listening-record-bridge="true"', updated)
            self.assertNotIn("practice-page-enhancer.js", updated)
            self.assertLess(updated.index("listening-record-bridge.bundle.js"), updated.lower().index("</body>"))

    def test_normalize_absolute_root_writes_backup_below_backup_dir(self):
        normalize = load_tool("normalize_listeningpractice_html")
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            root = workspace / "ListeningPractice"
            source = root / "P2" / "topic" / "exam.html"
            backup_root = workspace / "backups"
            bridge_target = workspace / "js" / "bundles" / "listening-record-bridge.bundle.js"
            report = workspace / "normalize.json"
            source.parent.mkdir(parents=True)
            bridge_target.parent.mkdir(parents=True)
            original = "<html><head><title>Topic</title></head><body><input name='q1'></body></html>"
            source.write_text(original, encoding="utf-8")
            bridge_target.write_text("// fixture", encoding="utf-8")

            argv = [
                "normalize_listeningpractice_html.py",
                "--root", str(root.resolve()),
                "--write",
                "--backup-dir", str(backup_root.resolve()),
                "--bridge-target", str(bridge_target.resolve()),
                "--report", str(report),
                "--title-mode", "keep",
                "--h1-mode", "keep",
                "--no-promote-correct-answers",
                "--no-inject-from-tags",
            ]
            with mock.patch.object(sys, "argv", argv):
                normalize.main()

            backup = backup_root / "P2" / "topic" / "exam.html"
            self.assertTrue(backup.exists())
            self.assertEqual(backup.read_text(encoding="utf-8"), original)
            self.assertIn("listening-record-bridge.bundle.js", source.read_text(encoding="utf-8"))
            self.assertNotEqual(backup.resolve(), source.resolve())

    def test_migrate_dry_run_does_not_create_target_root(self):
        migrate = load_tool("migrate_native_sources")
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            source_root = workspace / "native"
            topic = source_root / migrate.SOURCE_GROUPS[0] / "P1" / "frequency" / "topic"
            target_root = workspace / "ListeningPractice"
            report = workspace / "dry-run.json"
            topic.mkdir(parents=True)
            (topic / "exam.html").write_text("<html><body></body></html>", encoding="utf-8")

            argv = [
                "migrate_native_sources.py",
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--report", str(report),
                "--dry-run",
            ]
            with mock.patch.object(sys, "argv", argv):
                self.assertEqual(migrate.main(), 0)

            self.assertFalse(target_root.exists())
            self.assertTrue(report.exists())

    def test_migrate_injects_static_bridge_into_copied_topics(self):
        migrate = load_tool("migrate_native_sources")
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            source_root = workspace / "native"
            topic = source_root / migrate.SOURCE_GROUPS[0] / "P3" / "frequency" / "topic"
            target_root = workspace / "ListeningPractice"
            bridge_target = workspace / "js" / "bundles" / "listening-record-bridge.bundle.js"
            report = workspace / "migration.json"
            topic.mkdir(parents=True)
            bridge_target.parent.mkdir(parents=True)
            bridge_target.write_text("// fixture", encoding="utf-8")
            (topic / "exam.html").write_text(
                '<html><body><script src="../../../js/practice-page-enhancer.js"></script></body></html>',
                encoding="utf-8",
            )

            argv = [
                "migrate_native_sources.py",
                "--source-root", str(source_root),
                "--target-root", str(target_root),
                "--bridge-target", str(bridge_target),
                "--report", str(report),
            ]
            with mock.patch.object(sys, "argv", argv):
                self.assertEqual(migrate.main(), 0)

            copied = target_root / "P3" / "frequency" / "topic" / "exam.html"
            html = copied.read_text(encoding="utf-8")
            self.assertIn(
                '<script src="../../../../js/bundles/listening-record-bridge.bundle.js" '
                'data-listening-record-bridge="true"></script>',
                html,
            )
            self.assertEqual(html.count("listening-record-bridge.bundle.js"), 1)
            self.assertNotIn("practice-page-enhancer.js", html)


if __name__ == "__main__":
    unittest.main()
