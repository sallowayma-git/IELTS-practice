"""Regression tests for the Windows fresh-checkout startup failure."""
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from verify_reading_resources import ROOT, verify_reading_resources


def write_reading_pack(directory: Path) -> Path:
    payload = directory / "payloads/example.json"
    payload.parent.mkdir(parents=True, exist_ok=True)
    raw = b'{\n  "examId": "example"\n}\n'
    payload.write_bytes(raw)
    manifest = {"schemaVersion": 1, "assetCount": 1, "entries": [{
        "file": "payloads/example.json", "examId": "example",
        "sha256": hashlib.sha256(raw).hexdigest(),
    }]}
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return payload


class ReadingResourceTests(unittest.TestCase):
    def test_crlf_conversion_is_rejected_even_when_json_is_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            payload = write_reading_pack(directory)
            original = payload.read_bytes()
            payload.write_bytes(original.replace(b"\n", b"\r\n"))
            self.assertEqual(json.loads(payload.read_bytes()), json.loads(original))
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify_reading_resources(directory)

    def test_missing_payload_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_reading_pack(directory).unlink()
            with self.assertRaises(FileNotFoundError):
                verify_reading_resources(directory)

    def test_fresh_autocrlf_checkout_preserves_hashed_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, checkout = root / "source", root / "checkout"
            source.mkdir()
            relative = Path("assets/resource-pack/reading")
            write_reading_pack(source / relative)
            (source / ".gitattributes").write_bytes((ROOT / ".gitattributes").read_bytes())
            commands = [
                ["init", "--quiet"], ["config", "core.autocrlf", "true"],
                ["add", "."], ["checkout-index", "--all", f"--prefix={checkout.as_posix()}/"],
            ]
            for command in commands:
                subprocess.run(["git", *command], cwd=source, check=True, capture_output=True)
            self.assertEqual(verify_reading_resources(checkout / relative)["verifiedPayloads"], 1)

    def test_actual_shipping_payloads_match_native_startup_hashes(self):
        result = verify_reading_resources(ROOT / "assets/resource-pack/reading")
        self.assertGreater(result["verifiedPayloads"], 0)


if __name__ == "__main__":
    unittest.main()
