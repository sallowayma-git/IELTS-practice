#!/usr/bin/env python3
"""Portable release-gate tests; signing credentials are not required."""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import smoke_agent_runtime_sidecar as smoke
import verify_packaged_sidecar as gate


def write_pair(directory: Path, platform: str = "windows", content: bytes = b"final sidecar") -> tuple[Path, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    suffix = ".exe" if platform == "windows" else ""
    sidecar = directory / f"ielts-agent-runtime{suffix}"
    host = directory / f"ielts-practice-tauri{suffix}"
    sidecar.write_bytes(content)
    host.write_bytes(hashlib.sha256(content).hexdigest().encode("ascii"))
    return host, sidecar


def finished_process(code: int = 0, stderr: str = "") -> Mock:
    process = Mock(returncode=code)
    process.communicate.return_value = ("", stderr)
    return process


def fake_process(command: list[str], **kwargs: object) -> Mock:
    """Model the final host's compiled identity independently of the smoke call."""
    code = 0
    if command[-1] == "--verify-sidecar":
        host = Path(command[0])
        suffix = ".exe" if host.suffix == ".exe" else ""
        sidecar = host.with_name(f"ielts-agent-runtime{suffix}")
        code = int(host.read_bytes().decode("ascii") != gate.sha256(sidecar))
    return finished_process(code, "identity mismatch" if code else "")


class PackagedSidecarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.report = self.root / "report.json"

    def installers(self, root: Path | None = None) -> tuple[Path, Path]:
        bundle = (root or self.root) / "release/bundle"
        msi = bundle / "msi/app.msi"
        nsis = bundle / "nsis/app-setup.exe"
        for path in (msi, nsis):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(path.suffix.encode("ascii"))
        return msi, nsis

    def test_requires_both_windows_installers(self) -> None:
        msi, nsis = self.installers()
        self.assertEqual(gate.discover_artifacts(self.root, "windows"), [("msi", msi), ("nsis", nsis)])
        nsis.unlink()
        report = gate.verify(self.root, "windows", self.report)
        self.assertEqual(report["status"], "failed")
        self.assertIn("exactly one nsis", report["errors"][0])
        self.assertEqual(report["artifacts"], [])

    def test_rejects_ambiguous_windows_installers(self) -> None:
        self.installers()
        self.installers(self.root / "x86_64-pc-windows-msvc")
        with self.assertRaisesRegex(ValueError, "exactly one msi"):
            gate.discover_artifacts(self.root, "windows")

    def test_discovery_ignores_deep_tool_and_registry_bundles(self) -> None:
        msi, nsis = self.installers()
        self.installers(self.root / "tools/registry/example")
        mac = self.root / "aarch64-apple-darwin/release/bundle/macos/IELTS Practice.app"
        mac.mkdir(parents=True)
        (self.root / "tools/registry/example/release/bundle/macos/Unrelated.app").mkdir(parents=True)
        self.assertEqual(gate.discover_artifacts(self.root, "windows"), [("msi", msi), ("nsis", nsis)])
        self.assertEqual(gate.discover_artifacts(self.root, "macos"), [("app", mac)])

    def test_requires_exactly_one_mac_application(self) -> None:
        with self.assertRaisesRegex(ValueError, "macOS application bundle"):
            gate.discover_artifacts(self.root, "macos")
        first = self.root / "release/bundle/macos/IELTS Practice.app"
        first.mkdir(parents=True)
        self.assertEqual(gate.discover_artifacts(self.root, "macos"), [("app", first)])
        (first.parent / "Old.app").mkdir()
        with self.assertRaisesRegex(ValueError, "found 2"):
            gate.discover_artifacts(self.root, "macos")

    def test_requires_unique_host_and_sibling_sidecar(self) -> None:
        with self.assertRaisesRegex(ValueError, "host executable"):
            gate.find_pair(self.root, "windows")
        host, sidecar = write_pair(self.root / "image")
        self.assertEqual(gate.find_pair(self.root, "windows"), (host, sidecar))
        sidecar.unlink()
        with self.assertRaisesRegex(ValueError, "sidecar executable"):
            gate.find_pair(self.root, "windows")
        other = self.root / sidecar.name
        other.write_bytes(b"misplaced")
        with self.assertRaisesRegex(ValueError, "not beside"):
            gate.find_pair(self.root, "windows")
        sidecar.write_bytes(b"duplicate")
        with self.assertRaisesRegex(ValueError, "found 2"):
            gate.find_pair(self.root, "windows")
        other.unlink()
        (self.root / host.name).write_bytes(b"duplicate host")
        with self.assertRaisesRegex(ValueError, "host executable"):
            gate.find_pair(self.root, "windows")

    def test_matching_host_runs_smoke_on_exact_packaged_bytes(self) -> None:
        host, sidecar = write_pair(self.root / "image")
        with patch.object(gate.subprocess, "Popen", side_effect=fake_process) as run:
            result = gate.verify_pair(host.parent, "windows", self.report)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["identityStatus"], "passed")
        self.assertEqual(result["sidecarSha256"], gate.sha256(sidecar))
        self.assertEqual(run.call_args_list[0].args[0], [str(host), "--verify-sidecar"])
        smoke = run.call_args_list[1].args[0]
        self.assertEqual(smoke[smoke.index("--binary") + 1], str(sidecar))
        self.assertEqual(smoke[smoke.index("--build-id") + 1], gate.sha256(sidecar))
        self.assertEqual(smoke[smoke.index("--report") + 1], str(self.report))

    def test_post_sign_content_change_fails_before_smoke(self) -> None:
        host, sidecar = write_pair(self.root / "image")
        sidecar.write_bytes(sidecar.read_bytes() + b"signature")
        with patch.object(gate.subprocess, "Popen", side_effect=fake_process) as run:
            result = gate.verify_pair(host.parent, "windows", self.report)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["identityStatus"], "pending")
        self.assertIn("identity mismatch", result["error"])
        self.assertEqual(run.call_count, 1)

    def test_host_from_different_build_fails_before_smoke(self) -> None:
        host, _ = write_pair(self.root / "image")
        host.write_bytes(hashlib.sha256(b"different build").hexdigest().encode("ascii"))
        with patch.object(gate.subprocess, "Popen", side_effect=fake_process) as run:
            result = gate.verify_pair(host.parent, "windows", self.report)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(run.call_count, 1)

    def test_smoke_failure_is_not_a_passing_gate(self) -> None:
        host, _ = write_pair(self.root / "image")
        outcomes = [finished_process(), finished_process(1, "smoke failed")]
        with patch.object(gate.subprocess, "Popen", side_effect=outcomes):
            result = gate.verify_pair(host.parent, "windows", self.report)
        self.assertEqual(result["identityStatus"], "passed")
        self.assertEqual(result["status"], "failed")
        self.assertIn("smoke failed", result["error"])

    def test_host_and_smoke_timeouts_fail_closed(self) -> None:
        host, _ = write_pair(self.root / "image")
        for step in (0, 1):
            with self.subTest(step=step):
                outcomes = [finished_process() for _ in range(step)]
                timed_out = finished_process()
                timed_out.communicate.side_effect = subprocess.TimeoutExpired("verification", 30)
                outcomes.append(timed_out)
                with patch.object(gate.subprocess, "Popen", side_effect=outcomes), patch.object(gate, "stop_process_tree") as stop:
                    result = gate.verify_pair(host.parent, "windows", self.report)
                self.assertEqual(result["status"], "failed")
                self.assertIn("timed out", result["error"])
                self.assertTrue(all(process.communicate.call_args.kwargs["timeout"] > 0 for process in outcomes))
                stop.assert_called_once_with(timed_out)

    def test_windows_checks_each_extracted_installer(self) -> None:
        self.installers()

        def extract(artifact: Path, kind: str, destination: Path) -> None:
            write_pair(destination / "app", content=artifact.read_bytes())

        with patch.object(gate, "extract_windows", side_effect=extract), patch.object(gate.subprocess, "Popen", side_effect=fake_process):
            report = gate.verify(self.root, "windows", self.report)
        self.assertEqual(report["status"], "passed")
        self.assertEqual([item["kind"] for item in report["artifacts"]], ["msi", "nsis"])
        self.assertNotEqual(report["artifacts"][0]["sidecarSha256"], report["artifacts"][1]["sidecarSha256"])

    def test_mac_checks_final_bundle_without_staging_other_files(self) -> None:
        app = self.root / "aarch64-apple-darwin/release/bundle/macos/IELTS Practice.app"
        host, _ = write_pair(app / "Contents/MacOS", "macos")
        with patch.object(gate.subprocess, "Popen", side_effect=fake_process):
            report = gate.verify(self.root, "macos", self.report)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["artifacts"][0]["application"], str(host))

    def test_extract_commands_do_not_install_application(self) -> None:
        msi, nsis = self.installers()
        destination = self.root / "administrative image"
        with patch.object(gate, "run_checked") as run, patch.object(gate.shutil, "which", return_value="7z.exe"):
            gate.extract_windows(msi, "msi", destination)
            gate.extract_windows(nsis, "nsis", destination)
        self.assertEqual(run.call_args_list[0].args[0], ["msiexec.exe", "/a", str(msi), "/qn", f"TARGETDIR={destination}"])
        self.assertEqual(run.call_args_list[1].args[0], ["7z.exe", "x", "-y", f"-o{destination}", str(nsis)])

    def test_extraction_failure_is_reported_and_blocks_gate(self) -> None:
        self.installers()
        with patch.object(gate, "extract_windows", side_effect=RuntimeError("extraction failed")):
            report = gate.verify(self.root, "windows", self.report)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(len(report["errors"]), 2)

    def test_windows_timeout_kills_descendants_before_reaping_parent(self) -> None:
        process = finished_process()
        process.pid = 1234
        process.poll.return_value = 0
        events = []
        process.communicate.side_effect = lambda **kwargs: events.append("reap") or ("", "")
        with patch.object(gate.sys, "platform", "win32"), patch.object(gate.subprocess, "run") as taskkill:
            taskkill.side_effect = lambda *args, **kwargs: events.append("kill tree")
            gate.stop_process_tree(process)
        self.assertEqual(events, ["kill tree", "reap"])
        self.assertEqual(taskkill.call_args.args[0], ["taskkill.exe", "/PID", "1234", "/T", "/F"])
        self.assertEqual(taskkill.call_args.kwargs["timeout"], 10)
        process.communicate.assert_called_once_with(timeout=10)

    def test_posix_timeout_terminates_new_process_group(self) -> None:
        process = finished_process()
        process.pid = 4321
        process.poll.return_value = 0
        process.communicate.side_effect = [subprocess.TimeoutExpired("smoke", 1), ("", "")]
        with patch.object(gate.sys, "platform", "darwin"), patch.object(gate.signal, "SIGKILL", 9, create=True), patch.object(gate.os, "killpg", create=True) as killpg, patch.object(gate.subprocess, "Popen", return_value=process) as spawn:
            with self.assertRaises(subprocess.TimeoutExpired):
                gate.run_checked(["smoke"], 1)
        self.assertTrue(spawn.call_args.kwargs["start_new_session"])
        killpg.assert_called_once_with(4321, 9)
        self.assertEqual(process.communicate.call_args_list[-1].kwargs["timeout"], 10)

    def test_cleanup_wait_remains_bounded(self) -> None:
        process = finished_process()
        process.pid = 4321
        process.poll.return_value = None
        process.communicate.side_effect = subprocess.TimeoutExpired("smoke cleanup", 10)
        with patch.object(gate.sys, "platform", "darwin"), patch.object(gate.signal, "SIGKILL", 9, create=True), patch.object(gate.os, "killpg", create=True):
            with self.assertRaises(subprocess.TimeoutExpired):
                gate.stop_process_tree(process)
        process.kill.assert_called_once()
        process.stdout.close.assert_called_once()
        process.stderr.close.assert_called_once()

    def test_smoke_rejects_wrong_expected_digest_before_launch(self) -> None:
        binary = self.root / "final-sidecar"
        binary.write_bytes(b"signed bytes")
        command = [str(gate.SMOKE), "--binary", str(binary), "--build-id", "0" * 64, "--report", str(self.report)]
        with patch.object(sys, "argv", command), patch.object(smoke, "host_target", return_value=gate.TARGETS["windows"]), patch.object(smoke.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(SystemExit, "bytes do not match the expected build identity"):
                smoke.main()
        spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
