"""Evidence must survive failed visual runs without including stale artifacts."""
from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import run_visual_regressions as runner


class VisualEvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.reports = self.root / "reports"
        self.evidence = self.reports / "visual-ci-evidence"
        self.dist = self.root / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text("ready", encoding="utf-8")
        patches = patch.multiple(
            runner,
            ROOT=self.root,
            REPORTS=self.reports,
            REPORT=self.reports / "visual-regression-report.json",
            EVIDENCE=self.evidence,
            DIST=self.dist,
            SCRIPT_GROUPS=(("exam-freeze", ("exam_freeze_visual_check.py",)),),
        )
        patches.start()
        self.addCleanup(patches.stop)

    def write_artifact(self, relative: str, *, timestamp: int | None = None) -> Path:
        path = self.reports / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(relative.encode("utf-8"))
        if timestamp is not None:
            os.utime(path, ns=(timestamp, timestamp))
        return path

    def test_selects_fresh_nested_and_existing_evidence_only(self):
        started = time.time_ns()
        expected = {
            "library-current.png",
            "library-report.json",
            "exam-freeze/exam-freeze-report.json",
            "exam-freeze/current/meta.json",
            "exam-freeze/current/review-desktop-cold.json",
            "exam-freeze/current/review-desktop-cold.png",
            "exam-freeze/current/diff-review-desktop-cold.png",
        }
        for relative in expected:
            self.write_artifact(relative, timestamp=started)
        for relative in ("stale-current.png", "stale-report.json", "exam-freeze/current/old.png"):
            self.write_artifact(relative, timestamp=started - 1)
        for relative in (
            "visual-regression-report.json",
            "visual-ci-evidence/recursive-current.png",
            "visual-ci-evidence/exam-freeze/current/meta.json",
            "previous-run/exam-freeze/current/old.png",
            "exam-freeze/current/unrelated.txt",
        ):
            self.write_artifact(relative, timestamp=started)
        self.assertEqual(
            {path.relative_to(self.reports).as_posix() for path in runner.current_artifacts(started)},
            expected,
        )

    def run_matrix(self, *, exit_code: int = 0, timeout: bool = False) -> dict:
        def run_script(*args, **kwargs):
            for relative in (
                "library-current.png",
                "library-report.json",
                "exam-freeze/exam-freeze-report.json",
                "exam-freeze/current/meta.json",
                "exam-freeze/current/review-mobile-cold.json",
                "exam-freeze/current/review-mobile-cold.png",
                "exam-freeze/current/diff-review-mobile-cold.png",
            ):
                self.write_artifact(relative)
            if timeout:
                raise subprocess.TimeoutExpired(args[0], 300, output=b"partial capture")
            return subprocess.CompletedProcess(args[0], exit_code, "capture complete", "")

        process = Mock()
        process.poll.return_value = None
        with (
            patch.object(runner, "source_metadata", return_value={"gitCommit": "test-revision"}),
            patch.object(runner, "free_tcp_port", return_value=12345),
            patch.object(runner, "wait_for_server"),
            patch.object(runner.subprocess, "Popen", return_value=process),
            patch.object(runner.subprocess, "run", side_effect=run_script),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            status = runner.main()
        self.assertEqual(status, int(timeout or exit_code != 0))
        report = json.loads((self.evidence / "visual-regression-report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "failed" if status else "passed")
        self.assertEqual(report["scripts"][0]["exitCode"], 124 if timeout else exit_code)
        self.assertEqual(report["executedScripts"], 1)
        for relative in report["artifacts"]:
            copied = self.root / relative
            original = self.reports / copied.relative_to(self.evidence)
            self.assertEqual(copied.read_bytes(), original.read_bytes())
        self.assertEqual(len(report["artifacts"]), 7)
        self.assertEqual(len(report["screenshots"]), 3)
        self.assertEqual(len(report["caseReports"]), 2)
        self.assertTrue((self.evidence / "exam_freeze_visual_check.log").is_file())
        return report

    def test_failed_run_preserves_complete_evidence_and_paths(self):
        self.write_artifact("exam-freeze/current/stale.json", timestamp=1)
        self.write_artifact("visual-ci-evidence/old-current.png", timestamp=1)
        self.run_matrix(exit_code=1)
        self.assertFalse((self.evidence / "exam-freeze/current/stale.json").exists())
        self.assertFalse((self.evidence / "old-current.png").exists())

    def test_successful_run_and_repeat_do_not_collect_destination(self):
        first = self.run_matrix()
        second = self.run_matrix()
        self.assertEqual(first["artifacts"], second["artifacts"])
        self.assertFalse((self.evidence / "visual-ci-evidence").exists())

    def test_timed_out_run_preserves_partial_capture(self):
        self.run_matrix(timeout=True)
        log = (self.evidence / "exam_freeze_visual_check.log").read_text(encoding="utf-8")
        self.assertIn("partial capture", log)
        self.assertIn("Timed out after 300 seconds", log)


if __name__ == "__main__":
    unittest.main()
