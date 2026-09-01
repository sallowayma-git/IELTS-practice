#!/usr/bin/env python3
"""Behavior tests for Phase 10 release config and bundle verification."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import prepare_tauri_release
import verify_code_signature
import verify_tauri_bundle
import verify_updater_manifest


def top_level_block(document: str, key: str) -> str:
    lines = document.splitlines()
    start = next(
        (index for index, line in enumerate(lines) if line == f"{key}:"),
        None,
    )
    if start is None:
        raise AssertionError(f"missing top-level workflow key: {key}")

    end = len(lines)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if line and not line[0].isspace():
            end = index
            break
    return "\n".join(lines[start:end])


class WorkflowTriggerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        root = Path(__file__).resolve().parents[3]
        workflows = root / ".github/workflows"
        cls.branch_ci = (workflows / "tauri-ci.yml").read_text(encoding="utf-8")
        cls.release = (workflows / "release.yml").read_text(encoding="utf-8")

    def test_branch_ci_runs_gates_without_packaging_the_desktop_app(self) -> None:
        trigger = top_level_block(self.branch_ci, "on")
        self.assertIn("push:", trigger)
        self.assertIn("branches:", trigger)
        self.assertNotIn("tags:", trigger)

        for forbidden in (
            "cargo tauri build",
            "tauri-apps/tauri-action",
            "packaged-e2e:",
            "tauri-build:",
        ):
            self.assertNotIn(forbidden, self.branch_ci)

    def test_release_is_tag_only_and_owns_desktop_packaging(self) -> None:
        trigger = top_level_block(self.release, "on")
        self.assertIn("push:", trigger)
        self.assertIn("tags:", trigger)
        self.assertIn("- 'v*'", trigger)
        self.assertNotIn("branches:", trigger)
        self.assertNotIn("pull_request:", trigger)
        self.assertNotIn("workflow_dispatch:", trigger)
        self.assertIn("cargo tauri build", self.release)
        self.assertIn("tauri-apps/tauri-action", self.release)


class ReleaseConfigTests(unittest.TestCase):
    def test_overlay_enables_signed_updater_artifacts(self) -> None:
        overlay = prepare_tauri_release.build_overlay(
            prepare_tauri_release.DEFAULT_ENDPOINT,
            "A" * 64,
        )
        self.assertTrue(overlay["bundle"]["createUpdaterArtifacts"])
        updater = overlay["plugins"]["updater"]
        self.assertEqual(updater["endpoints"], [prepare_tauri_release.DEFAULT_ENDPOINT])
        self.assertEqual(updater["pubkey"], "A" * 64)

    def test_release_inputs_fail_closed(self) -> None:
        for endpoint in ("http://example.test/latest.json", "https://example.test/latest.txt"):
            with self.assertRaises(ValueError):
                prepare_tauri_release.build_overlay(endpoint, "A" * 64)
        for pubkey in ("", "short", "PRIVATE KEY " + "A" * 64, "A" * 32 + "\nB"):
            with self.assertRaises(ValueError):
                prepare_tauri_release.build_overlay(
                    prepare_tauri_release.DEFAULT_ENDPOINT,
                    pubkey,
                )

    def test_shipping_versions_must_match_tag(self) -> None:
        root = Path(__file__).resolve().parents[3]
        self.assertEqual(prepare_tauri_release.validate_release_version(root, "v0.1.0"), "0.1.0")
        with self.assertRaises(ValueError):
            prepare_tauri_release.validate_release_version(root, "v9.9.9")

    def test_platform_code_signing_inputs_fail_closed(self) -> None:
        with self.assertRaises(ValueError):
            prepare_tauri_release.platform_bundle_overlay("windows", {})
        with self.assertRaises(ValueError):
            prepare_tauri_release.platform_bundle_overlay("macos", {})
        windows = prepare_tauri_release.platform_bundle_overlay(
            "windows",
            {
                "WINDOWS_CERTIFICATE": "pfx",
                "WINDOWS_CERTIFICATE_PASSWORD": "password",
                "WINDOWS_CERTIFICATE_THUMBPRINT": "A" * 40,
                "WINDOWS_TIMESTAMP_URL": "https://timestamp.example.test",
            },
        )
        self.assertFalse(windows["windows"]["allowDowngrades"])
        self.assertEqual(windows["windows"]["digestAlgorithm"], "sha256")
        macos = prepare_tauri_release.platform_bundle_overlay(
            "macos",
            {
                "APPLE_CERTIFICATE": "p12",
                "APPLE_CERTIFICATE_PASSWORD": "password",
                "APPLE_SIGNING_IDENTITY": "Developer ID Application: Example",
                "APPLE_ID": "release@example.test",
                "APPLE_PASSWORD": "password",
                "APPLE_TEAM_ID": "TEAMID",
            },
        )
        self.assertTrue(macos["macOS"]["hardenedRuntime"])


class BundleVerificationTests(unittest.TestCase):
    def test_linux_staging_placeholder_does_not_fail_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / "IELTS Practice_0.1.0_amd64.AppImage"
            placeholder = root / "rpm" / "IELTS Practice-0.1.0-1.x86_64" / "empty"
            placeholder.parent.mkdir(parents=True)
            installer.write_bytes(b"artifact")
            placeholder.write_bytes(b"")
            result = verify_tauri_bundle.verify_artifacts(
                [installer, placeholder],
                "linux",
                require_updater=False,
                require_signatures=False,
            )
            self.assertEqual(result["status"], "passed")

    def test_zero_byte_installable_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            installer = Path(directory) / "IELTS Practice_0.1.0_amd64.AppImage"
            installer.write_bytes(b"")
            result = verify_tauri_bundle.verify_artifacts(
                [installer],
                "linux",
                require_updater=False,
                require_signatures=False,
            )
            self.assertEqual(result["status"], "failed")
            self.assertIn("zero-byte publishable artifacts", result["errors"][0])

    def test_windows_signed_updater_bundle_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / "IELTS Practice_0.1.0_x64-setup.exe"
            updater = root / "IELTS Practice_0.1.0_x64-setup.nsis.zip"
            signature = Path(f"{updater}.sig")
            for path in (installer, updater, signature):
                path.write_bytes(b"artifact")
            result = verify_tauri_bundle.verify_artifacts(
                [installer, updater, signature],
                "windows",
                require_updater=True,
                require_signatures=True,
            )
            self.assertEqual(result["status"], "passed")

    def test_missing_signature_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installer = root / "IELTS Practice_0.1.0_amd64.AppImage"
            updater = root / "IELTS Practice_0.1.0_amd64.AppImage.tar.gz"
            for path in (installer, updater):
                path.write_bytes(b"artifact")
            result = verify_tauri_bundle.verify_artifacts(
                [installer, updater],
                "linux",
                require_updater=True,
                require_signatures=True,
            )
            self.assertEqual(result["status"], "failed")
            self.assertIn("missing updater signatures", result["errors"][0])


class UpdaterManifestTests(unittest.TestCase):
    def test_complete_cross_platform_manifest_passes(self) -> None:
        document = {
            "version": "0.2.0",
            "platforms": {
                platform: {
                    "signature": "S" * 64,
                    "url": f"https://github.com/example/app/releases/download/v0.2.0/{platform}.zip",
                }
                for platform in ("windows-x86_64-nsis", "linux-x86_64", "darwin-aarch64")
            },
        }
        self.assertEqual(verify_updater_manifest.validate_manifest(document, "v0.2.0"), [])

    def test_missing_platform_and_signature_fail(self) -> None:
        errors = verify_updater_manifest.validate_manifest(
            {
                "version": "0.2.0",
                "platforms": {
                    "windows-x86_64-nsis": {
                        "signature": "",
                        "url": "http://example.test/update.zip",
                    }
                },
            },
            "v0.2.0",
        )
        self.assertTrue(any("missing updater platform: linux" in error for error in errors))
        self.assertTrue(any("no valid signature" in error for error in errors))
        self.assertTrue(any("invalid download URL" in error for error in errors))


class CodeSignatureEvidenceTests(unittest.TestCase):
    def test_platform_candidates_are_exact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "release" / "bundle"
            (bundle / "nsis").mkdir(parents=True)
            (bundle / "nsis" / "setup.exe").write_bytes(b"installer")
            (bundle / "nsis" / "ignored.zip").write_bytes(b"archive")
            windows = verify_code_signature.find_candidates(root, "windows")
            self.assertEqual([path.name for path in windows], ["setup.exe"])

            app = bundle / "macos" / "IELTS Practice.app"
            app.mkdir(parents=True)
            dmg = bundle / "dmg" / "IELTS Practice.dmg"
            dmg.parent.mkdir(parents=True)
            dmg.write_bytes(b"dmg")
            macos = verify_code_signature.find_candidates(root, "macos")
            self.assertEqual({path.name for path in macos}, {"IELTS Practice.app", "IELTS Practice.dmg"})


if __name__ == "__main__":
    unittest.main()
