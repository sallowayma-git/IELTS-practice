#!/usr/bin/env python3
"""Verify release signing happens before sidecar identity and publication."""

from __future__ import annotations

import contextlib
import hashlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_agent_runtime_sidecar as builder


TARGETS = {
    "win32": "x86_64-pc-windows-msvc",
    "darwin": "aarch64-apple-darwin",
    "linux": "x86_64-unknown-linux-gnu",
}
IDENTITY = "Developer ID Application: IELTS Example (TEAMID)"
ENVIRONMENT = {
    "WINDOWS_CERTIFICATE_THUMBPRINT": "A" * 40,
    "WINDOWS_TIMESTAMP_URL": "https://timestamp.example.test",
    "APPLE_SIGNING_IDENTITY": IDENTITY,
    "APPLE_TEAM_ID": "TEAMID",
}
UNSIGNED = b"frozen runtime"
SIGNED = UNSIGNED + b" signed release bytes"


class SidecarSigningTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.binaries = self.root / "src-tauri" / "binaries"
        self.build_root = self.root / "target" / "agent-runtime-sidecar"
        self.commands: list[list[str]] = []
        self.events: list[str] = []
        self.metadata = f"Authority={IDENTITY}\nTeamIdentifier=TEAMID\n"
        self.failure: str | None = None

    def run_builder(self, platform: str, sign: bool, environment: dict | None = None) -> int:
        self.platform = platform
        self.signed = sign
        self.target = TARGETS[platform]
        self.suffix = ".exe" if platform == "win32" else ""
        argv = ["build_agent_runtime_sidecar.py", "--target", self.target]
        if sign:
            argv.append("--sign")
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(builder.sys, "platform", platform))
            stack.enter_context(mock.patch.object(builder.sys, "argv", argv))
            stack.enter_context(mock.patch.object(builder, "host_target", return_value=self.target))
            stack.enter_context(mock.patch.object(builder, "ROOT", self.root))
            stack.enter_context(mock.patch.object(builder, "BUILD_ROOT", self.build_root))
            stack.enter_context(mock.patch.object(builder, "BINARIES", self.binaries))
            stack.enter_context(mock.patch.dict(builder.os.environ, ENVIRONMENT if environment is None else environment, clear=True))
            stack.enter_context(mock.patch.object(builder.verify_code_signature, "resolve_signtool", return_value="signtool.exe"))
            stack.enter_context(mock.patch.object(builder.shutil, "which", return_value="codesign"))
            stack.enter_context(mock.patch.object(builder.subprocess, "run", side_effect=self.execute))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            return builder.main()

    def execute(self, command: list[str], **kwargs) -> subprocess.CompletedProcess:
        self.commands.append(command)
        if "PyInstaller" in command:
            self.events.append("freeze")
            dist = self.build_root / "dist"
            dist.mkdir(parents=True, exist_ok=True)
            payload = SIGNED if "--codesign-identity" in command else UNSIGNED
            (dist / f"ielts-agent-runtime{self.suffix}").write_bytes(payload)
        elif "sign" in command:
            self.events.append("sign")
            self.fail_if_requested("sign", command)
            Path(command[-1]).write_bytes(SIGNED)
        elif "verify" in command or "--verify" in command:
            self.events.append("verify")
            self.fail_if_requested("verify", command)
            self.assertEqual(Path(command[-1]).read_bytes(), SIGNED)
        elif "--display" in command:
            self.events.append("identity")
            return subprocess.CompletedProcess(command, 0, "", self.metadata)
        else:
            self.assertTrue(command[1].endswith("smoke_agent_runtime_sidecar.py"))
            self.events.append("smoke")
            self.assertFalse(self.manifest_path().exists())
            self.assertFalse(self.final_path().exists())
            binary = Path(command[command.index("--binary") + 1])
            payload = SIGNED if self.signed else UNSIGNED
            self.assertEqual(binary.read_bytes(), payload)
            self.assertEqual(command[command.index("--build-id") + 1], hashlib.sha256(payload).hexdigest())
            self.fail_if_requested("smoke", command)
        return subprocess.CompletedProcess(command, 0, "", "")

    def fail_if_requested(self, stage: str, command: list[str]) -> None:
        if self.failure == stage:
            raise subprocess.CalledProcessError(1, command)

    def manifest_path(self) -> Path:
        return self.binaries / f"ielts-agent-runtime-{self.target}.sha256"

    def final_path(self) -> Path:
        return self.binaries / f"ielts-agent-runtime-{self.target}{self.suffix}"

    def assert_published(self, payload: bytes) -> None:
        self.assertEqual(self.final_path().read_bytes(), payload)
        self.assertEqual(self.manifest_path().read_text().strip(), hashlib.sha256(payload).hexdigest())

    def test_windows_identity_covers_signed_bytes(self) -> None:
        self.assertEqual(self.run_builder("win32", True), 0)
        self.assertEqual(self.events, ["freeze", "sign", "verify", "smoke"])
        self.assert_published(SIGNED)
        signing = next(command for command in self.commands if "sign" in command)
        self.assertEqual(signing[1:-1], [
            "sign", "/fd", "sha256", "/sha1", "A" * 40,
            "/t", ENVIRONMENT["WINDOWS_TIMESTAMP_URL"],
        ])

    def test_macos_signs_nested_libraries_before_hashing(self) -> None:
        self.assertEqual(self.run_builder("darwin", True), 0)
        self.assertEqual(self.events, ["freeze", "verify", "identity", "smoke"])
        freeze = self.commands[0]
        self.assertEqual(freeze[freeze.index("--codesign-identity") + 1], IDENTITY)
        self.assert_published(SIGNED)

    def test_macos_accepts_certificate_hash_identity(self) -> None:
        environment = {**ENVIRONMENT, "APPLE_SIGNING_IDENTITY": "B" * 40}
        self.assertEqual(self.run_builder("darwin", True, environment), 0)
        self.assertEqual(self.commands[0][-3:-1], ["--codesign-identity", "B" * 40])
        self.assert_published(SIGNED)

    def test_macos_accepts_partial_name_identity(self) -> None:
        environment = {**ENVIRONMENT, "APPLE_SIGNING_IDENTITY": "IELTS Example"}
        self.assertEqual(self.run_builder("darwin", True, environment), 0)
        self.assertEqual(self.commands[0][-3:-1], ["--codesign-identity", "IELTS Example"])
        self.assert_published(SIGNED)

    def test_default_build_does_not_sign(self) -> None:
        for platform in TARGETS:
            with self.subTest(platform=platform):
                self.commands.clear()
                self.events.clear()
                self.assertEqual(self.run_builder(platform, False, environment={}), 0)
                self.assertEqual(self.events, ["freeze", "smoke"])
                self.assertNotIn("--codesign-identity", self.commands[0])
                self.assert_published(UNSIGNED)

    def test_failed_signing_does_not_publish_identity(self) -> None:
        self.failure = "sign"
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_builder("win32", True)
        self.assertEqual(self.events, ["freeze", "sign"])
        self.assertFalse(self.manifest_path().exists())
        self.assertFalse(self.final_path().exists())

    def test_failed_signature_verification_does_not_publish_identity(self) -> None:
        self.failure = "verify"
        for platform in ("win32", "darwin"):
            with self.subTest(platform=platform):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.run_builder(platform, True)
                self.assertFalse(self.manifest_path().exists())
                self.assertFalse(self.final_path().exists())

    def test_failed_smoke_does_not_publish_signed_identity(self) -> None:
        self.failure = "smoke"
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_builder("win32", True)
        self.assertFalse(self.manifest_path().exists())
        self.assertFalse(self.final_path().exists())

    def test_macos_rejects_wrong_or_missing_team(self) -> None:
        for metadata in (
            f"Authority={IDENTITY}\nTeamIdentifier=OTHERTEAM\n",
            "Signature=adhoc\nTeamIdentifier=not set\n",
            f"Authority={IDENTITY}\n",
        ):
            with self.subTest(metadata=metadata):
                self.metadata = metadata
                with self.assertRaises(RuntimeError):
                    self.run_builder("darwin", True)
                self.assertFalse(self.manifest_path().exists())
                self.assertFalse(self.final_path().exists())

    def test_invalid_signing_configuration_stops_before_freeze(self) -> None:
        invalid = (
            ("win32", {}),
            ("darwin", {}),
            ("darwin", {**ENVIRONMENT, "APPLE_TEAM_ID": ""}),
            ("linux", ENVIRONMENT),
            ("win32", {**ENVIRONMENT, "WINDOWS_CERTIFICATE_THUMBPRINT": "bad"}),
            ("win32", {**ENVIRONMENT, "WINDOWS_TIMESTAMP_URL": "http://timestamp.example.test"}),
        )
        for platform, environment in invalid:
            with self.subTest(platform=platform, environment=environment):
                with self.assertRaises(SystemExit):
                    self.run_builder(platform, True, environment)
                self.assertEqual(self.commands, [])

    def test_missing_signing_tools_fail_closed(self) -> None:
        with mock.patch.dict(builder.os.environ, ENVIRONMENT, clear=True):
            with mock.patch.object(builder.sys, "platform", "win32"):
                with mock.patch.object(builder.verify_code_signature, "resolve_signtool", return_value=None):
                    with self.assertRaisesRegex(ValueError, "signtool"):
                        builder.signing_configuration(True)
            with mock.patch.object(builder.sys, "platform", "darwin"):
                with mock.patch.object(builder.shutil, "which", return_value=None):
                    with self.assertRaisesRegex(ValueError, "codesign"):
                        builder.signing_configuration(True)


if __name__ == "__main__":
    unittest.main()
