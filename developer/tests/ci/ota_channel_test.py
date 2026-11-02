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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ota_channel  # noqa: E402

ROOT = ota_channel.ROOT
READING = ROOT / "assets/resource-pack/reading"
WRITING = ROOT / "assets/generated/writing-topics"


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
        first = ota_channel.compose_manifest(None, app_version="v0.2.0", policy=policy, now="t")
        self.assertEqual(first["app"]["minOtaVersion"], "0.1.0")
        second = ota_channel.compose_manifest(first, packs=[self.pack], now="t2")
        self.assertEqual(second["app"], first["app"])
        self.assertEqual(second["content"], [self.pack])
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(second, packs=[self.pack])
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(second, app_version="0.1.9")
        third = ota_channel.compose_manifest(second, app_version="0.3.0", policy={}, now="t3")
        self.assertEqual(third["content"], [self.pack])
        self.assertNotIn("minOtaVersion", third["app"])

    def test_policy_floors_cannot_exceed_release(self) -> None:
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(None, app_version="0.2.0", policy={"minOtaVersion": "0.3.0"})
        with self.assertRaises(ValueError):
            ota_channel.compose_manifest(None, app_version="0.2.0", policy={"downloadPages": [{"label": "x", "url": "http://x"}]})

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
        manifest = ota_channel.compose_manifest(None, app_version="9.9.9", policy=ota_channel.load_policy(), now="t")
        self.assertEqual(manifest["schemaVersion"], 1)


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
