#!/usr/bin/env python3
"""Contract tests for the OTA channel tooling."""
from __future__ import annotations

import io
import json
import gzip
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ota_channel  # noqa: E402

ROOT = ota_channel.ROOT
READING = ROOT / "assets/resource-pack/reading"
WRITING = ROOT / "assets/generated/writing-topics"


def updater(version: str) -> dict:
    return {"version": version.lstrip("v"), "platforms": {
        "windows-x86_64": {"signature": "installer-signature"},
        "linux-x86_64": {"signature": "linux-signature"},
    }}


class PackTest(unittest.TestCase):
    def test_reading_pack_is_deterministic_and_marked(self) -> None:
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            a = ota_channel.build_pack("reading", READING, 2026110201, Path(first), baseline=READING)
            b = ota_channel.build_pack("reading", READING, 2026110201, Path(second))
            self.assertEqual(a["sha256"], b["sha256"])
            data = (Path(first) / a["file"]).read_bytes()
            self.assertEqual(len(data), a["size"])
            with tarfile.open(fileobj=io.BytesIO(gzip.decompress(data))) as tar:
                names = tar.getnames()
                marker = json.load(tar.extractfile("ota-pack.json"))
            self.assertEqual(marker, {"id": "reading", "version": 2026110201})
            self.assertEqual(names.count("ota-pack.json"), 1)
            self.assertIn("manifest.json", names)
            self.assertTrue(all(not name.startswith(("/", "..")) for name in names))

    def test_reading_pack_must_keep_existing_exams(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            shrunk = Path(tmp) / "reading"
            shrunk.mkdir()
            manifest = json.loads((READING / "manifest.json").read_text(encoding="utf-8"))
            dropped = manifest["entries"].pop()
            manifest["assetCount"] -= 1
            (shrunk / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            for entry in manifest["entries"]:
                target = shrunk / entry["file"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((READING / entry["file"]).read_bytes())
            with self.assertRaisesRegex(ValueError, dropped["examId"]):
                ota_channel.build_pack("reading", shrunk, 2, Path(tmp) / "out", baseline=READING)

    def test_writing_pack_and_unknown_slots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            entry = ota_channel.build_pack("writing-topics", WRITING, 7, Path(tmp), min_app_version="0.1.0")
            self.assertEqual(entry["minAppVersion"], "0.1.0")
            with self.assertRaises(ValueError):
                ota_channel.build_pack("listening", WRITING, 7, Path(tmp))

    def test_bundled_markers_match_slots(self) -> None:
        for slot, directory in (("reading", READING), ("writing-topics", WRITING)):
            marker = json.loads((directory / "ota-pack.json").read_text(encoding="utf-8"))
            self.assertEqual(marker["id"], slot)
            self.assertGreater(marker["version"], 0)


    def test_stamp_bundled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            slot = Path(tmp) / "reading"
            slot.mkdir()
            ota_channel.stamp_bundled(202611021530, {"reading": slot})
            marker = json.loads((slot / "ota-pack.json").read_text(encoding="utf-8"))
            self.assertEqual(marker, {"id": "reading", "version": 202611021530})
            with self.assertRaises(ValueError):
                ota_channel.stamp_bundled(2026110215, {"reading": slot})


class ManifestTest(unittest.TestCase):
    pack = {"id": "reading", "version": 5, "file": "content-reading-5.tar.gz", "sha256": "a" * 64, "size": 1}

    def test_first_manifest_needs_app_release(self) -> None:
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(None, packs=[self.pack])

    def test_merge_keeps_app_and_moves_forward_only(self) -> None:
        policy = {"minOtaVersion": "0.1.0", "downloadPages": [{"label": "GitHub", "url": "https://github.com/x"}]}
        first = ota_channel.compose_manifest(None, app_version="v0.2.0", updater_manifest=updater("v0.2.0"), policy=policy, now="t")
        self.assertEqual(first["app"]["minOtaVersion"], "0.1.0")
        second = ota_channel.compose_manifest(first, packs=[self.pack], now="t2")
        self.assertEqual(second["app"], first["app"])
        self.assertEqual(second["content"], [self.pack])
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(second, packs=[self.pack])
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(second, app_version="0.1.9", updater_manifest=updater("0.1.9"))
        third = ota_channel.compose_manifest(second, app_version="0.3.0", updater_manifest=updater("0.3.0"), policy={}, now="t3")
        self.assertEqual(third["content"], [self.pack])
        self.assertNotIn("minOtaVersion", third["app"])

    def test_policy_floors_cannot_exceed_release(self) -> None:
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(None, app_version="0.2.0", updater_manifest=updater("0.2.0"), policy={"minOtaVersion": "0.3.0"})
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(None, app_version="0.2.0", updater_manifest=updater("0.2.0"), policy={"downloadPages": [{"label": "x", "url": "http://x"}]})

    def test_installer_signatures_are_bound_to_the_release_and_preserved(self) -> None:
        latest = updater("0.2.0")
        latest["platforms"]["duplicate"] = {"signature": " installer-signature "}
        first = ota_channel.compose_manifest(None, app_version="0.2.0", updater_manifest=latest)
        self.assertEqual(first["app"]["installerSignatures"], ["installer-signature", "linux-signature"])
        second = ota_channel.compose_manifest(first, packs=[self.pack])
        self.assertEqual(second["app"], first["app"])

    def test_app_release_rejects_missing_mismatched_or_unsigned_installers(self) -> None:
        cases = [None, updater("0.3.0"), {"version": "0.2.0", "platforms": {}},
                 {"version": "0.2.0", "platforms": {"windows-x86_64": {"signature": " "}}},
                 {"version": "0.2.0", "platforms": {"windows-x86_64": {}}},
                 {"version": "0.2.0", "platforms": {"windows-x86_64": None}}]
        for latest in cases:
            with self.subTest(latest=latest), self.assertRaises(ValueError):
                ota_channel.compose_manifest(None, app_version="0.2.0", updater_manifest=latest)

    def test_previous_pack_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ota.json"
            self.assertEqual(ota_channel.previous_pack_file(path, "reading"), "")
            path.write_text(json.dumps({"content": [self.pack]}), encoding="utf-8")
            self.assertEqual(ota_channel.previous_pack_file(path, "reading"), "content-reading-5.tar.gz")
            self.assertEqual(ota_channel.previous_pack_file(path, "writing-topics"), "")

    def test_semver_order(self) -> None:
        self.assertLess(ota_channel.semver_key("0.1.0-beta"), ota_channel.semver_key("0.1.0"))
        self.assertLess(ota_channel.semver_key("0.9.9"), ota_channel.semver_key("0.10.0"))

    def test_repo_policy_is_valid(self) -> None:
        manifest = ota_channel.compose_manifest(None, app_version="9.9.9", updater_manifest=updater("9.9.9"), policy=ota_channel.load_policy(), now="t")
        self.assertEqual(manifest["schemaVersion"], 1)


class PreviousManifestTest(unittest.TestCase):
    def test_empty_channel_can_bootstrap(self):
        with tempfile.TemporaryDirectory() as tmp, patch("ota_channel.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, '{"assets":[]}')
            output = Path(tmp) / "previous.json"
            ota_channel.download_previous_manifest("ota-stable", output)
            self.assertEqual(json.loads(output.read_text()), {})
            self.assertEqual(run.call_count, 1)

    def test_release_lookup_error_does_not_reset_previous(self):
        with tempfile.TemporaryDirectory() as tmp, patch("ota_channel.subprocess.run") as run:
            output = Path(tmp) / "previous.json"
            output.write_text('{"existing":true}')
            run.side_effect = subprocess.CalledProcessError(1, ["gh", "release", "view"])
            with self.assertRaises(subprocess.CalledProcessError):
                ota_channel.download_previous_manifest("ota-stable", output)
            self.assertEqual(json.loads(output.read_text()), {"existing": True})

    def test_manifest_download_error_does_not_reset_previous(self):
        with tempfile.TemporaryDirectory() as tmp, patch("ota_channel.subprocess.run") as run:
            output = Path(tmp) / "previous.json"
            output.write_text('{"existing":true}')
            run.side_effect = [
                subprocess.CompletedProcess([], 0, '{"assets":[{"name":"ota.json"}]}'),
                subprocess.CalledProcessError(1, ["gh", "release", "download"]),
            ]
            with self.assertRaises(subprocess.CalledProcessError):
                ota_channel.download_previous_manifest("ota-stable", output)
            self.assertEqual(json.loads(output.read_text()), {"existing": True})

    def test_nonempty_channel_cannot_bootstrap_without_manifest(self):
        with tempfile.TemporaryDirectory() as tmp, patch("ota_channel.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess([], 0, '{"assets":[{"name":"latest.json"}]}')
            output = Path(tmp) / "previous.json"
            with self.assertRaisesRegex(ValueError, "nonempty"):
                ota_channel.download_previous_manifest("ota-stable", output)
            self.assertFalse(output.exists())

    def test_downloaded_manifest_is_preserved_for_merging(self):
        manifest = ota_channel.compose_manifest(None, app_version="0.2.0", updater_manifest=updater("0.2.0"), packs=[ManifestTest.pack])
        with tempfile.TemporaryDirectory() as tmp, patch("ota_channel.subprocess.run") as run:
            def command(args, **kwargs):
                if "view" in args:
                    return subprocess.CompletedProcess(args, 0, '{"assets":[{"name":"ota.json"}]}')
                directory = Path(args[args.index("--dir") + 1])
                (directory / "ota.json").write_text(json.dumps(manifest), encoding="utf-8")
                return subprocess.CompletedProcess(args, 0)
            run.side_effect = command
            output = Path(tmp) / "previous.json"
            ota_channel.download_previous_manifest("ota-stable", output)
            previous = json.loads(output.read_text())
            result = ota_channel.compose_manifest(previous, app_version="0.3.0", updater_manifest=updater("0.3.0"))
            self.assertEqual(result["content"], [ManifestTest.pack])

    def test_invalid_download_cannot_replace_previous(self):
        with tempfile.TemporaryDirectory() as tmp, patch("ota_channel.subprocess.run") as run:
            def command(args, **kwargs):
                if "view" in args:
                    return subprocess.CompletedProcess(args, 0, '{"assets":[{"name":"ota.json"}]}')
                directory = Path(args[args.index("--dir") + 1])
                (directory / "ota.json").write_text("{}")
                return subprocess.CompletedProcess(args, 0)
            run.side_effect = command
            output = Path(tmp) / "previous.json"
            output.write_text('{"existing":true}')
            with self.assertRaisesRegex(ValueError, "invalid"):
                ota_channel.download_previous_manifest("ota-stable", output)
            self.assertEqual(json.loads(output.read_text()), {"existing": True})


class SourcesTest(unittest.TestCase):
    def test_mirror_is_inserted_after_github_once(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sources.json"
            path.write_bytes((ROOT / "src-tauri/ota/sources.json").read_bytes())
            ota_channel.add_mirror_source(path, "https://cos.example.cn/ota/{file}")
            config = ota_channel.add_mirror_source(path, "https://cos.example.cn/ota2/{file}")
            ids = [source["id"] for source in config["sources"]]
            self.assertEqual(ids[:2], ["github", "mirror"])
            self.assertEqual(ids.count("mirror"), 1)
            for bad in ("http://x/{file}", "https://x/{url}", "https://x/none"):
                with self.assertRaises(ValueError):
                    ota_channel.add_mirror_source(path, bad)


if __name__ == "__main__":
    unittest.main()
