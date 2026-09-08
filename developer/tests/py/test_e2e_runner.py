#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import signal
import tempfile
import textwrap
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


RUNNER_PATH = Path(__file__).resolve().parents[1] / "e2e" / "e2e_runner.py"
SPEC = importlib.util.spec_from_file_location("e2e_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def process_is_running(pid: int) -> bool:
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == 258  # WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # Linux may keep a killed orphan as a zombie until its new parent reaps it.
    stat_path = Path(f"/proc/{pid}/stat")
    if stat_path.exists():
        try:
            return stat_path.read_text().rsplit(")", 1)[1].split()[0] != "Z"
        except FileNotFoundError:
            return False
    return True


class E2ERunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.case_dir = self.root / "developer" / "tests" / "e2e"
        self.case_dir.mkdir(parents=True)
        self.report_dir = self.case_dir / "reports"
        self.report_path = self.report_dir / "e2e-unified-report.json"
        patcher = mock.patch.multiple(
            runner, REPO_ROOT=self.root, REPORT_DIR=self.report_dir, REPORT_PATH=self.report_path
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def write_case(self, name: str, source: str) -> None:
        (self.case_dir / name).write_text(textwrap.dedent(source), encoding="utf-8")

    def test_full_output_is_retained_while_report_excerpts_are_bounded(self) -> None:
        self.write_case(
            "verbose.py",
            """
            import sys
            print('BEGIN-STDOUT-' + 'x' * 10000 + '-END-STDOUT')
            print('BEGIN-STDERR-' + 'y' * 5000 + '-END-STDERR', file=sys.stderr)
            sys.exit(7)
            """,
        )
        result = runner._run_case("verbose.py")
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["exitCode"], 7)
        self.assertEqual(len(result["stdout"]), 4000)
        self.assertEqual(len(result["stderr"]), 2000)
        self.assertTrue(result["stdout"].endswith("-END-STDOUT"))
        self.assertTrue(result["stderr"].endswith("-END-STDERR"))
        self.assertTrue((self.root / result["stdoutPath"]).read_text().startswith("BEGIN-STDOUT-"))
        self.assertTrue((self.root / result["stderrPath"]).read_text().startswith("BEGIN-STDERR-"))
        self.assertGreater(result["durationSeconds"], 0)
        self.assertLessEqual(result["startedAt"], result["finishedAt"])

    def test_report_is_available_to_each_running_case_and_suite_continues_after_failure(self) -> None:
        # The children inspect the on-disk report, not mocked write calls.
        self.write_case(
            "first.py",
            """
            import json
            from pathlib import Path
            report = json.loads(Path('developer/tests/e2e/reports/e2e-unified-report.json').read_text())
            assert report['status'] == 'running'
            assert report['completedCases'] == 0
            assert report['cases'][-1]['name'] == 'first.py'
            assert report['cases'][-1]['status'] == 'running'
            raise SystemExit(3)
            """,
        )
        self.write_case(
            "second.py",
            """
            import json
            from pathlib import Path
            report = json.loads(Path('developer/tests/e2e/reports/e2e-unified-report.json').read_text())
            assert report['completedCases'] == 1
            assert report['cases'][0]['exitCode'] == 3
            assert report['cases'][-1]['name'] == 'second.py'
            assert report['cases'][-1]['status'] == 'running'
            print('previous failure retained')
            """,
        )
        output = io.StringIO()
        with mock.patch.object(runner, "E2E_CASES", ["first.py", "second.py"]):
            with contextlib.redirect_stdout(output):
                self.assertEqual(runner.main(), 1)
        report = json.loads(self.report_path.read_text(encoding="utf-8"))
        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["plannedCases"], 2)
        self.assertEqual(report["completedCases"], 2)
        self.assertEqual([case["exitCode"] for case in report["cases"]], [3, 0])
        self.assertIn("START first.py", output.getvalue())
        self.assertIn("END second.py: PASS", output.getvalue())

    def test_missing_case_produces_a_failure_with_artifacts(self) -> None:
        result = runner._run_case("missing.py")
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["detail"], "script missing")
        self.assertEqual(result["stderr"], "script missing")
        self.assertTrue((self.root / result["stdoutPath"]).is_file())

    def test_report_retries_temporary_permission_errors_without_losing_previous_report(self) -> None:
        self.report_dir.mkdir()
        previous_report = '{"status": "running", "completedCases": 1}\n'
        self.report_path.write_text(previous_report, encoding="utf-8")
        original_replace = Path.replace
        attempts = []

        def replace_after_readers_release(source: Path, target: Path) -> Path:
            attempts.append(time.monotonic())
            self.assertEqual(self.report_path.read_text(encoding="utf-8"), previous_report)
            if len(attempts) < 3:
                raise PermissionError("report temporarily open by a reader")
            return original_replace(source, target)

        with mock.patch.object(Path, "replace", replace_after_readers_release):
            report = runner._write_report(datetime.now(timezone.utc), time.monotonic(), [], "pass")
        self.assertEqual(json.loads(self.report_path.read_text(encoding="utf-8")), report)
        self.assertEqual(report["status"], "pass")
        self.assertFalse(self.report_path.with_suffix(".json.tmp").exists())
        self.assertEqual(len(attempts), 3)

    def test_persistent_report_permission_error_is_bounded_and_keeps_last_good_report(self) -> None:
        self.report_dir.mkdir()
        previous_report = '{"status": "running", "completedCases": 1}\n'
        self.report_path.write_text(previous_report, encoding="utf-8")
        started = time.monotonic()
        with mock.patch.object(Path, "replace", side_effect=PermissionError("report remains locked")):
            with self.assertRaisesRegex(PermissionError, "report remains locked"):
                runner._write_report(datetime.now(timezone.utc), started, [], "pass")
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(self.report_path.read_text(encoding="utf-8"), previous_report)
        pending_report = json.loads(self.report_path.with_suffix(".json.tmp").read_text(encoding="utf-8"))
        self.assertEqual(pending_report["status"], "pass")

    def test_timeout_kills_inherited_output_process_tree_and_preserves_partial_logs(self) -> None:
        self.write_case(
            "tree.py",
            """
            import os
            import subprocess
            import sys
            import time
            from pathlib import Path
            level = int(sys.argv[1]) if len(sys.argv) > 1 else 0
            Path(f'pid-{level}').write_text(str(os.getpid()))
            print(f'output-before-timeout-{level}', flush=True)
            print(f'error-before-timeout-{level}', file=sys.stderr, flush=True)
            if level < 2:
                subprocess.Popen([sys.executable, '-u', __file__, str(level + 1)])
            while True:
                time.sleep(0.05)
            """,
        )
        result = None
        pids = []
        try:
            started = time.monotonic()
            with mock.patch.object(runner, "CASE_TIMEOUT_SECONDS", 2):
                result = runner._run_case("tree.py")
            elapsed = time.monotonic() - started
            pids = [int(path.read_text()) for path in sorted(self.root.glob("pid-*"))]
            self.assertEqual(len(pids), 3, "parent, child and grandchild must start before the timeout")
            self.assertEqual(result["exitCode"], 124)
            self.assertEqual(result["status"], "fail")
            self.assertNotIn("cleanupErrors", result)
            self.assertLess(elapsed, 2 + runner.PROCESS_CLEANUP_TIMEOUT_SECONDS * 2 + 1)
            self.assertIn("output-before-timeout-2", result["stdout"])
            self.assertIn("error-before-timeout-2", result["stderr"])
            deadline = time.monotonic() + 2
            while any(process_is_running(pid) for pid in pids) and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertEqual([pid for pid in pids if process_is_running(pid)], [])
            self.assertIn(
                "output-before-timeout-0",
                (self.root / result["stdoutPath"]).read_text(encoding="utf-8"),
            )
        finally:
            # Keep a failed regression from leaving fixtures behind.
            if not pids:
                pids = [int(path.read_text()) for path in self.root.glob("pid-*")]
            for pid in reversed(pids):
                if process_is_running(pid):
                    try:
                        os.kill(pid, signal.SIGTERM if os.name == "nt" else signal.SIGKILL)
                    except ProcessLookupError:
                        pass


if __name__ == "__main__":
    unittest.main()
