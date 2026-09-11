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


def load_tests(loader, tests, pattern):
    import packaged_sidecar_test
    import sidecar_signing_test
    import sidecar_memory_test
    import reading_resource_test

    tests.addTests(loader.loadTestsFromModule(packaged_sidecar_test))
    tests.addTests(loader.loadTestsFromModule(sidecar_signing_test))
    tests.addTests(loader.loadTestsFromModule(sidecar_memory_test))
    tests.addTests(loader.loadTestsFromModule(reading_resource_test))
    return tests


def workflow_block(document: str, key: str, indent: int = 0) -> str:
    lines = document.splitlines()
    heading = f"{' ' * indent}{key}:"
    start = next(
        (index for index, line in enumerate(lines) if line == heading),
        None,
    )
    if start is None:
        raise AssertionError(f"missing workflow key: {key}")

    end = len(lines)
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
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
        trigger = workflow_block(self.branch_ci, "on")
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

    def test_release_supports_manual_gates_and_owns_desktop_packaging(self) -> None:
        trigger = workflow_block(self.release, "on")
        self.assertIn("push:", trigger)
        self.assertIn("tags:", trigger)
        self.assertIn("- 'v*'", trigger)
        self.assertNotIn("branches:", trigger)
        self.assertNotIn("pull_request:", trigger)
        self.assertIn("workflow_dispatch:", trigger)
        self.assertIn("tauri build --ci --no-bundle", self.release)
        self.assertIn("tauri-apps/tauri-action", self.release)

    def test_manual_runs_cannot_sign_attach_or_publish_a_release(self) -> None:
        self.assertEqual(workflow_block(self.release, "permissions"), "permissions:\n  contents: read\n")
        tag_push_only = "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"
        for name in ("tauri-release", "publish-release"):
            with self.subTest(job=name):
                job = workflow_block(self.release, name, indent=2)
                # A dispatch on a tag must also stop before certificate import,
                # signing, or creating draft assets. Guard the complete job.
                self.assertIn(f"\n    {tag_push_only}\n", job)
                self.assertIn("\n    permissions:\n      contents: write\n", job)
                self.assertNotIn("always()", job)
                self.assertNotIn("continue-on-error", job)
        for name in ("shipping-gate", "rust-test"):
            job = workflow_block(self.release, name, indent=2)
            self.assertNotIn("\n    if:", job)
            self.assertNotIn("contents: write", job)
            self.assertNotIn("secrets.", job)

    def test_shipping_runs_all_regressions_before_workspace_acceptance(self) -> None:
        job = workflow_block(self.release, "shipping-gate", indent=2)
        markers = (
            "run: python developer/tests/ci/run_static_suite.py",
            "run: python developer/tests/e2e/visual_test_support_test.py",
            "run: python developer/tests/e2e/run_visual_regressions.py",
            "run: tauri build --ci --no-bundle",
            "./developer/tests/ci/run_native_practice_acceptance.ps1",
        )
        positions = [job.index(marker) for marker in markers]
        self.assertEqual(positions, sorted(positions))
        for marker in markers:
            step = next(step for step in job.split("\n      - ") if marker in step)
            self.assertNotIn("\n        if:", step)
            self.assertNotIn("continue-on-error", step)
        self.assertIn("developer/tests/e2e/reports/native-diagnostics/**", job)
        self.assertIn("needs: shipping-gate", workflow_block(self.release, "rust-test", indent=2))

    def test_release_prepares_sidecar_in_every_consuming_job(self) -> None:
        consumers = (
            ("shipping-gate", "x86_64-pc-windows-msvc", "run: python developer/tests/ci/run_static_suite.py"),
            ("rust-test", "x86_64-pc-windows-msvc", "run: cargo test --workspace --locked"),
            ("tauri-release", "${{ matrix.target }}", "uses: tauri-apps/tauri-action@v0"),
        )
        for job_name, target, consumer in consumers:
            with self.subTest(job=job_name):
                self.assert_sidecar_preparation(job_name, target, consumer)

    def assert_sidecar_preparation(self, job_name: str, target: str, consumer: str) -> None:
        job = workflow_block(self.release, job_name, indent=2)
        install = (
            "run: python -m pip install --disable-pip-version-check "
            "-r agent-runtime-python/requirements-build.lock "
            "-r agent-runtime-python/requirements.lock"
        )
        markers = (
            "uses: actions/setup-python@v5",
            install,
            f"run: python developer/tests/ci/build_agent_runtime_sidecar.py --target {target}",
            consumer,
        )
        positions = []
        for marker in markers:
            self.assertEqual(job.count(marker), 1, marker)
            positions.append(job.index(marker))
        self.assertEqual(positions, sorted(positions))
        python_step = next(step for step in job.split("\n      - ") if markers[0] in step)
        self.assertIn("python-version: '3.12'", python_step)
        for step in job.split("\n      - "):
            if any(marker in step for marker in markers[:3]):
                self.assertNotIn("\n        if:", step)
                self.assertNotIn("continue-on-error:", step)

    def test_release_matrix_matches_native_sidecar_targets(self) -> None:
        job = workflow_block(self.release, "tauri-release", indent=2)
        matrix = workflow_block(job, "include", indent=8)
        entries = [
            dict(line.strip().split(": ", 1) for line in entry.splitlines())
            for entry in matrix.split("          - ")[1:]
        ]
        self.assertEqual(len(entries), 3)
        self.assertEqual(
            {
                entry["platformKey"]: (entry["platform"], entry.get("target"), entry.get("pythonArchitecture"))
                for entry in entries
            },
            {
                "windows": ("windows-2022", "x86_64-pc-windows-msvc", "x64"),
                "macos": ("macos-latest", "aarch64-apple-darwin", "arm64"),
                "linux": ("ubuntu-22.04", "x86_64-unknown-linux-gnu", "x64"),
            },
        )
        self.assertIn("targets: ${{ matrix.target }}", job)
        self.assertIn("architecture: ${{ matrix.pythonArchitecture }}", job)
        macos = next(entry for entry in entries if entry["platformKey"] == "macos")
        self.assertEqual(macos["args"].strip("'\""), "--target aarch64-apple-darwin")
        self.assertEqual(
            {entry["platformKey"]: entry["sidecarArgs"].strip("'\"") for entry in entries},
            {"windows": "--sign", "macos": "--sign", "linux": ""},
        )

    def test_signed_sidecar_identity_is_final_before_compile_and_checked_after_bundle(self) -> None:
        job = workflow_block(self.release, "tauri-release", indent=2)
        build = "run: python developer/tests/ci/build_agent_runtime_sidecar.py --target ${{ matrix.target }} ${{ matrix.sidecarArgs }}"
        bundle = "uses: tauri-apps/tauri-action@v0"
        verify = "run: python developer/tests/ci/verify_packaged_sidecar.py --platform ${{ matrix.platformKey }}"
        for certificate in ("Import macOS Developer ID certificate", "Import Windows Authenticode certificate"):
            self.assertLess(job.index(certificate), job.index(build))
        self.assertLess(job.index(build), job.index(bundle))
        pinned_cli = "npm install --global @tauri-apps/cli@${{ env.TAURI_CLI_VERSION }}"
        self.assertLess(job.index(pinned_cli), job.index(bundle))
        self.assertIn("tauriScript: tauri", job)
        self.assertLess(job.index(bundle), job.index(verify))
        step = next(step for step in job.split("\n      - ") if verify in step)
        self.assertIn("if: matrix.platformKey != 'linux'", step)
        self.assertNotIn("continue-on-error", step)
        self.assertNotIn("continue-on-error", job)
        publish = workflow_block(self.release, "publish-release", indent=2)
        self.assertIn("needs: tauri-release", publish)
        self.assertNotIn("if: always()", publish)


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
        self.assertEqual(macos["externalBin"], [])
        self.assertEqual(
            macos["macOS"]["files"],
            {"MacOS/ielts-agent-runtime": "binaries/ielts-agent-runtime-aarch64-apple-darwin"},
        )


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
