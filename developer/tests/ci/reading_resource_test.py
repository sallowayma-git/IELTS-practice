"""Regression tests for the Windows fresh-checkout startup failure."""
import hashlib
import json
import re
import sqlite3
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
    def test_upgrade_keeps_retired_assets_drafts_and_history_loadable(self):
        pack = ROOT / 'assets/resource-pack/reading'
        manifest = json.loads((pack / 'manifest.json').read_text(encoding='utf-8'))
        retired = ROOT / 'assets/generated/reading-exams/retired'
        old_payloads = {path.stem: json.loads(path.read_bytes()) for path in retired.glob('*.json')}
        self.assertEqual(set(old_payloads), {'p2-high-192', 'p2-low-051', 'p2-medium-058'})
        source = (ROOT / 'crates/ielts-db/src/reading/assets.rs').read_text(encoding='utf-8')
        upsert = re.search(r'"(INSERT INTO practice_assets[\s\S]+?updated_at = excluded.updated_at)"', source).group(1)
        with sqlite3.connect(':memory:') as db, tempfile.TemporaryDirectory() as temporary:
            db.execute('PRAGMA foreign_keys=ON')
            db.executescript((ROOT / 'crates/ielts-db/migrations/0001_v2_core.sql').read_text(encoding='utf-8'))

            def seed(asset_id, title, content_ref, fingerprint):
                db.execute(upsert, (asset_id, 'reading', 'builtin', f"{manifest['packId']}:{asset_id}",
                                   title, 'P2', None, None, str(content_ref), 1, fingerprint, 0, None, '2026-01-01'))

            for asset_id, payload in old_payloads.items():
                old_path = Path(temporary) / f'{asset_id}.json'
                old_path.write_text(json.dumps(payload), encoding='utf-8')
                seed(asset_id, payload['meta']['title'], old_path, 'old-fingerprint')
                for status in ('draft', 'completed'):
                    attempt_id = f'{asset_id}-{status}'
                    db.execute('INSERT INTO attempts (id,activity,asset_id,mode,status,started_at,schema_version,created_at,updated_at) '
                               "VALUES (?, 'reading', ?, 'single', ?, '2026-01-01', 1, '2026-01-01', '2026-01-01')",
                               (attempt_id, asset_id, status))
                    for question_id, answer in payload['answerKey'].items():
                        db.execute('INSERT INTO attempt_answers (attempt_id,question_id,answer_json) VALUES (?,?,?)',
                                   (attempt_id, question_id, json.dumps(answer)))
                old_path.unlink()  # The previous application bundle is removed during upgrade.

            for entry in manifest['entries']:
                seed(entry['examId'], entry['title'], pack / entry['file'], entry['sha256'])
            rows = db.execute('SELECT id,content_ref,fingerprint FROM practice_assets').fetchall()
            self.assertEqual(len(rows), manifest['assetCount'])
            for asset_id, content_ref, fingerprint in rows:
                raw = Path(content_ref).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), fingerprint, asset_id)
                self.assertEqual(json.loads(raw)['examId'], asset_id)
            for attempt_id, asset_id, content_ref in db.execute(
                    'SELECT a.id,a.asset_id,p.content_ref FROM attempts a JOIN practice_assets p ON p.id=a.asset_id'):
                restored = json.loads(Path(content_ref).read_bytes())
                self.assertEqual(restored, old_payloads[asset_id])
                answers = {question_id: json.loads(answer) for question_id, answer in db.execute(
                    'SELECT question_id,answer_json FROM attempt_answers WHERE attempt_id=?', (attempt_id,))}
                self.assertEqual(answers, restored['answerKey'])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM attempts').fetchone()[0], 6)

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
