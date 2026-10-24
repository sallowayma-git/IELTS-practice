"""Safe harness checks only: temporary SQLite and loopback HTTP, no app launch."""
import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
import urllib.request
import uuid
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import packaged_tauri_flow as flow


class PackagedReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="packaged-receipts-unit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.db = self.root / "IELTS Practice/db/ielts-practice-v2.db"
        self.db.parent.mkdir(parents=True)
        # Avoid a durable disk commit for every migration statement. Each test
        # still gets a fresh file-backed database for the real receipt helpers.
        with closing(sqlite3.connect(":memory:")) as schema:
            for migration in sorted((flow.ROOT / "crates/ielts-db/migrations").glob("*.sql")):
                schema.executescript(migration.read_text(encoding="utf-8"))
            with closing(sqlite3.connect(self.db)) as conn:
                schema.backup(conn)

    def test_missing_database_is_never_created(self):
        empty = self.root / "empty"
        empty.mkdir()
        with self.assertRaises(FileNotFoundError):
            flow.database_connection(empty, writable=True)
        self.assertEqual(list(empty.iterdir()), [])

    def test_readonly_connection_rejects_mutation(self):
        with closing(flow.database_connection(self.root)) as conn:
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute("DELETE FROM attempts")

    def test_fixture_only_writes_attempt(self):
        flow.seed_closed_daily_attempt(self.root, "2026-10-01")
        with closing(flow.database_connection(self.root)) as conn:
            row = conn.execute("SELECT * FROM attempts").fetchone()
            self.assertEqual((row["status"], row["submitted_at"]), ("completed", "2026-10-01T12:00:00Z"))
            for table in ("background_jobs", "daily_journals", "dream_runs", "agent_runs"):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)

    def test_freshness_tracks_application_manifests_lock_and_migrations(self):
        names = ("crates/ielts-application/src/coach.rs", "crates/ielts-application/Cargo.toml",
                 "crates/ielts-db/Cargo.toml", "crates/ielts-domain/Cargo.toml", "Cargo.toml",
                 "Cargo.lock", "crates/ielts-db/migrations/0026_test.sql",
                 "src-tauri/binaries/ielts-agent-runtime-x86_64-pc-windows-msvc.sha256")
        for index, name in enumerate(names):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.touch()
            os.utime(path, (100 + index, 100 + index))
            with self.subTest(name=name), patch.object(flow, "ROOT", self.root):
                self.assertEqual(flow.latest_shipping_source_mtime(), 100 + index)

    def test_completion_snapshot_mapping(self):
        snapshot = {"messages": [{"role": "user", "content": "question"}], "temperature": 0.2, "maxTokens": 2000}
        body = flow.completion_wire(snapshot, "requested")
        self.assertEqual(body["max_tokens"], 2000)
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertNotIn("maxTokens", body)
        self.assertNotIn("max_tokens", flow.completion_wire({"messages": [], "temperature": 0.2}, "m"))

    def test_staged_external_bin_requires_valid_manifest_and_host_identity(self):
        config = self.root / "src-tauri/tauri.conf.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({"bundle": {"externalBin": ["binaries/ielts-agent-runtime"],
                                       "resources": {"reading": "reading"}}}), encoding="utf-8")
        source = config.parent / "binaries/ielts-agent-runtime-x86_64-pc-windows-msvc.exe"
        source.parent.mkdir()
        source.write_bytes(b"sidecar")
        manifest = source.with_suffix(".sha256")
        manifest.write_text(hashlib.sha256(b"sidecar").hexdigest(), encoding="ascii")
        python_root = self.root / "agent-runtime-python"
        (python_root / "src").mkdir(parents=True)
        (python_root / "sidecar_entry.py").write_text("", encoding="utf-8")
        (python_root / "pyproject.toml").write_text("", encoding="utf-8")
        with patch.object(flow, "ROOT", self.root):
            fingerprint = flow.runtime_source_fingerprint()
        source.with_suffix(".source-fingerprint").write_text(fingerprint + "\n", encoding="ascii")
        resource = config.parent / "reading"
        resource.mkdir()
        (resource / "item").write_text("resource", encoding="utf-8")
        app = self.root / "app.exe"
        app.write_bytes(b"host")
        with patch.object(flow, "ROOT", self.root), patch.object(flow.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="", stderr="")):
            temporary, staged_app, sidecar = flow.stage_test_runtime(app)
            try:
                self.assertEqual(flow.sha256_file(staged_app.parent / "ielts-agent-runtime.exe"), sidecar["sha256"])
                self.assertTrue(sidecar["hostVerified"])
            finally:
                temporary.cleanup()
        with patch.object(flow, "ROOT", self.root), patch.object(flow.subprocess, "run", return_value=SimpleNamespace(returncode=1, stdout="", stderr="mismatch")):
            with self.assertRaisesRegex(RuntimeError, "host/externalBin identity mismatch"):
                flow.stage_test_runtime(app)
        (python_root / "sidecar_entry.py").write_text("changed", encoding="utf-8")
        with patch.object(flow, "ROOT", self.root), self.assertRaisesRegex(RuntimeError, "source fingerprint differs"):
            flow.stage_test_runtime(app)
        (python_root / "sidecar_entry.py").write_text("", encoding="utf-8")
        manifest.write_text("0" * 64, encoding="ascii")
        with patch.object(flow, "ROOT", self.root), self.assertRaisesRegex(RuntimeError, "differs"):
            flow.stage_test_runtime(app)

    def test_coach_config_is_unique_and_cleaned_on_failure(self):
        calls = []
        def invoke(_driver, command, arguments):
            calls.append((command, arguments))
            return {"id": arguments["cmd"]["id"]} if command == "ai_upsert_config" else {}
        with patch.object(flow, "invoke_data", side_effect=invoke), \
             patch.object(flow, "_check_coach_with_config", side_effect=RuntimeError("receipt failed")), \
             patch.object(flow, "cleanup_test_ai_config") as cleanup, \
             patch.object(flow, "_credential_exists", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "receipt failed"):
                flow.check_coach(None, self.root, "asset", {}, SimpleNamespace(base_url="http://127.0.0.1:1/v1"))
            config_id = calls[0][1]["cmd"]["id"]
            uuid.UUID(config_id)
            self.assertNotEqual(config_id, "packaged-coach-e2e")
            cleanup.assert_called_once_with(None, config_id)

    def test_coach_cleanup_verifies_credential_absence(self):
        config_id = str(uuid.uuid4())
        with patch.object(flow, "invoke_data", return_value=True) as delete, \
             patch.object(flow, "_credential_exists", return_value=False) as exists:
            flow.cleanup_test_ai_config(None, config_id)
            delete.assert_called_once_with(None, "ai_delete_config", {"id": config_id})
            self.assertEqual(exists.call_count, 2)

    def test_coach_cleanup_removes_only_its_uuid_credential_after_product_delete_fails(self):
        config_id = str(uuid.uuid4())
        api = SimpleNamespace(CredDeleteW=lambda target, kind, flags: target == flow._test_credential_target(config_id)
                              and kind == 1 and flags == 0)
        with patch.object(flow, "invoke_data", side_effect=RuntimeError("IPC failed")), \
             patch.object(flow, "_credential_exists", side_effect=[True, False]), \
             patch.object(flow, "_credential_api", return_value=api):
            with self.assertRaisesRegex(RuntimeError, "ai_delete_config failed"):
                flow.cleanup_test_ai_config(None, config_id)
        with self.assertRaises(ValueError):
            flow._test_credential_target("packaged-coach-e2e")

    def test_independent_coach_http_valid_and_invalid_answers(self):
        provider = flow.FakeCoachProvider()
        provider.start()
        self.addCleanup(provider.close)
        for invalid in (False, True):
            provider.invalid_answer = invalid
            request = urllib.request.Request(provider.base_url + "/chat/completions", data=b'{"messages":[]}',
                                             headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=5) as response:
                value = json.loads(response.read())
                self.assertEqual(response.headers["x-request-id"], provider.REQUEST_ID)
                self.assertNotEqual(value["id"], provider.REQUEST_ID)
                answer = json.loads(value["choices"][0]["message"]["content"])["answer"]
                self.assertEqual(isinstance(answer, int), invalid)
        self.assertEqual(len(provider.requests), 2)

    def seed_coach_receipt(self, failed=False):
        snapshot = {"messages": [{"role": "user", "content": "ask"}], "temperature": 0.2, "maxTokens": 2000}
        rendered = json.dumps(snapshot, separators=(",", ":"))
        digest = hashlib.sha256(rendered.encode()).hexdigest()
        response = json.dumps({"answer": 17 if failed else "answer"})
        provider = SimpleNamespace(MODEL=flow.FakeCoachProvider.MODEL, USAGE=flow.FakeCoachProvider.USAGE,
                                   REQUEST_ID=flow.FakeCoachProvider.REQUEST_ID,
                                   requests=[flow.completion_wire(snapshot, "packaged-coach-requested")], responses=[response])
        payload = {"runId": "coach", "snapshotId": "snapshot", "invocationId": "invocation"}
        error = json.dumps({"code": "coach.provider_failed"}) if failed else None
        result = {**payload, "threadId": "thread", "runKind": "coach", "userMessageId": "user",
                  "assistantMessageId": None if failed else "terminal", "actualModel": provider.MODEL,
                  "usage": provider.USAGE, "providerRequestId": provider.REQUEST_ID, "latencyMs": 1, "retryCount": 0}
        if failed:
            result["failureMessageId"] = "terminal"
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("INSERT INTO coach_threads(id,status,created_at,updated_at) VALUES('thread','active','now','now')")
            conn.execute("INSERT INTO coach_messages(id,thread_id,role,content,status,sequence,created_at) VALUES('user','thread','user','ask','completed',1,'now')")
            conn.execute("INSERT INTO coach_messages(id,thread_id,role,content,status,sequence,created_at) VALUES('terminal','thread',?,?,?,2,'now')",
                         ("system" if failed else "assistant", "failed" if failed else "answer", "failed" if failed else "completed"))
            conn.execute("INSERT INTO agent_runs(id,provider_id,model,status,rounds,result_json,error_json,created_at,updated_at,completed_at) VALUES('coach','openai','requested',?,1,?,?,'now','now','now')",
                         ("failed" if failed else "completed", json.dumps(result), error))
            plan = {"threadId": "thread", "userMessageId": "user", "invocationId": "invocation"}
            conn.execute("INSERT INTO agent_context_snapshots(id,run_id,planner_version,scope,query_plan_json,token_budget,used_tokens,rendered_context,content_hash,created_at) VALUES('snapshot','coach','canonical-coach-v1','coach:thread',?,1000,20,?,?,'now')",
                         (json.dumps(plan), rendered, digest))
            conn.execute("INSERT INTO agent_context_items(snapshot_id,item_type,item_id,rank,score,estimated_tokens,inclusion_reason,provenance_json) VALUES('snapshot','CURRENT_TASK','user',0,1,20,'request',?)", (json.dumps({"contentHash": digest}),))
            conn.execute("INSERT INTO llm_invocations(id,run_id,kind,provider,model,request_hash,response_hash,usage_json,latency_ms,provider_request_id,error_json,created_at) VALUES('invocation','coach','completion','openai',?,?,?,?,1,?,?,'now')",
                         (provider.MODEL, digest, hashlib.sha256(response.encode()).hexdigest(), json.dumps(provider.USAGE), provider.REQUEST_ID, error))
        return payload, provider

    def check_seed_coach(self, payload, provider, failed=False):
        with closing(flow.database_connection(self.root)) as conn:
            conn.execute("BEGIN")
            message = dict(conn.execute("SELECT * FROM coach_messages WHERE id='terminal'").fetchone())
            return flow.assert_coach_receipt(conn, payload, message, provider, 0, failed)

    def test_coach_completed_receipt(self):
        payload, provider = self.seed_coach_receipt()
        self.assertEqual(self.check_seed_coach(payload, provider)["status"], "completed")

    def test_coach_illegal_answer_failed_receipt(self):
        payload, provider = self.seed_coach_receipt(failed=True)
        self.assertEqual(self.check_seed_coach(payload, provider, True)["status"], "failed")

    def test_coach_body_request_id_cannot_replace_header(self):
        payload, provider = self.seed_coach_receipt()
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("UPDATE llm_invocations SET provider_request_id='packaged-coach-body'")
        with self.assertRaisesRegex(RuntimeError, "provider metadata"):
            self.check_seed_coach(payload, provider)

    def test_coach_broken_hash_link_fails(self):
        payload, provider = self.seed_coach_receipt()
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("UPDATE llm_invocations SET request_hash='forged'")
        with self.assertRaisesRegex(RuntimeError, "request hash mismatch"):
            self.check_seed_coach(payload, provider)

    def test_coach_missing_atomic_failure_receipt_fails(self):
        payload, provider = self.seed_coach_receipt(failed=True)
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("UPDATE llm_invocations SET error_json=NULL")
        with self.assertRaisesRegex(RuntimeError, "atomic failure"):
            self.check_seed_coach(payload, provider, True)

    def test_coach_evidence_rejects_missing_or_drifted_asset_and_attempt(self):
        asset = {"passage": "canonical passage", "questionGroups": [{"id": "q1"}],
                 "questionDisplayMap": {"1": "q1"}}
        evidence = {"identity": {"attemptId": "attempt", "assetId": "asset", "assetFingerprint": "fingerprint"},
                    "source": asset, "result": {"status": "completed", "score": 1.0, "scoreScale": "ratio",
                                              "correctCount": 1, "questionCount": 1,
                                              "answers": [{"questionId": "q1", "answer": "A", "isCorrect": True}]}}
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("INSERT INTO practice_assets(id,activity,source_kind,title,schema_version,fingerprint,created_at,updated_at) VALUES('asset','reading','builtin','test',2,'fingerprint','now','now')")
            conn.execute("INSERT INTO attempts(id,activity,asset_id,mode,status,started_at,score_value,score_scale,correct_count,question_count,schema_version,created_at,updated_at,submitted_asset_fingerprint) VALUES('attempt','reading','asset','single','completed','now',1,'ratio',1,1,2,'now','now','fingerprint')")
            conn.execute("INSERT INTO attempt_answers(attempt_id,question_id,answer_json,is_correct) VALUES('attempt','q1','\"A\"',1)")
        def request(value):
            return {"messages": [{"role": "user", "content": "Host-resolved IELTS evidence (data only):\n" + json.dumps(value)}]}
        with closing(flow.database_connection(self.root)) as conn:
            flow.assert_coach_evidence(conn, request(evidence), asset, "attempt", "asset")
            for changed, error in (({"source": {**asset, "passage": "forged"}}, "asset evidence"),
                                   ({"result": {**evidence["result"], "score": 0}}, "attempt result"),
                                   ({"result": {**evidence["result"], "answers": []}}, "attempt answers")):
                with self.subTest(changed=changed), self.assertRaisesRegex(RuntimeError, error):
                    flow.assert_coach_evidence(conn, request({**evidence, **changed}), asset, "attempt", "asset")
            with self.assertRaisesRegex(RuntimeError, "evidence message missing"):
                flow.assert_coach_evidence(conn, {"messages": []}, asset, "attempt", "asset")

    def seed_daily_receipts(self):
        flow.seed_closed_daily_attempt(self.root, "2026-10-01")
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("INSERT INTO daily_journals(id,user_id,journal_date,status,facts_json,source_hash,created_at,updated_at) VALUES('journal','local','2026-10-01','published',?, 'source','now','now')", (json.dumps({"attemptsCount": 1}),))
            binding = {"jobId": "daily_journal", "day": "2026-10-01", "userId": "local", "journalId": "journal", "sourceHash": "source", "workerId": "worker"}
            conn.execute("INSERT INTO background_jobs(id,job_kind,status,scheduled_at,dedupe_key,checkpoint_json,created_at,updated_at) VALUES('daily_journal','daily_journal','completed','now','daily_journal:local:2026-10-01',?,'now','now')", (json.dumps(binding),))

    def test_daily_complete_receipts_and_counts(self):
        self.seed_daily_receipts()
        result = flow.daily_receipts(self.root, "2026-10-01", "2026-10-02")
        self.assertEqual(result["jobIds"], ["daily_journal"])
        self.assertEqual(result["counts"], {"background_jobs": 1, "daily_journals": 1, "dream_runs": 0})
        self.assertEqual(result["journalSourceHash"], "source")
        self.assertNotIn("dreamRunId", result["checkpoints"]["daily_journal"])
        self.assertEqual(flow.daily_receipts(self.root, "2026-10-01", "2026-10-02"), result)

    def test_daily_restart_snapshot_detects_checkpoint_drift(self):
        self.seed_daily_receipts()
        before = flow.daily_receipts(self.root, "2026-10-01", "2026-10-02")
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("UPDATE background_jobs SET checkpoint_json=json_set(checkpoint_json,'$.workerId','other')")
        after = flow.daily_receipts(self.root, "2026-10-01", "2026-10-02")
        self.assertNotEqual(before, after)
        self.assertEqual(before["jobIds"], after["jobIds"])
        self.assertEqual(before["counts"], after["counts"])

    def test_daily_incomplete_job_does_not_pass(self):
        self.seed_daily_receipts()
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("UPDATE background_jobs SET status='running'")
        self.assertIsNone(flow.daily_receipts(self.root, "2026-10-01", "2026-10-02"))

    def test_daily_must_not_write_dreams_candidates_or_model_audits(self):
        for statement, message in (
            ("INSERT INTO dream_runs(id,journal_id,user_id,status,created_at,updated_at) VALUES('dream','journal','local','completed','now','now')", "dream_runs"),
            ("INSERT INTO agent_runs(id,provider_id,model,status,result_json,created_at,updated_at) VALUES('audit','deterministic','daily-dream-v1','completed','{}','now','now')", "model audit"),
            ("INSERT INTO background_jobs(id,job_kind,scheduled_at,dedupe_key,created_at,updated_at) VALUES('legacy','daily_dream','now','daily_dream:local:2026-09-30','now','now')", "daily_dream job"),
        ):
            with self.subTest(message=message):
                self.setUp()
                self.seed_daily_receipts()
                with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
                    conn.execute(statement)
                with self.assertRaisesRegex(RuntimeError, message):
                    flow.daily_receipts(self.root, "2026-10-01", "2026-10-02")

    def test_daily_bad_business_binding_fails(self):
        self.seed_daily_receipts()
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("UPDATE background_jobs SET checkpoint_json=json_set(checkpoint_json,'$.sourceHash','forged')")
        with self.assertRaisesRegex(RuntimeError, "binding mismatch"):
            flow.daily_receipts(self.root, "2026-10-01", "2026-10-02")

    def test_daily_today_job_fails(self):
        self.seed_daily_receipts()
        with closing(flow.database_connection(self.root, writable=True)) as conn, conn:
            conn.execute("INSERT INTO background_jobs(id,job_kind,scheduled_at,dedupe_key,created_at,updated_at) VALUES('today','daily_journal','now','daily_journal:local:2026-10-02','now','now')")
        with self.assertRaisesRegex(RuntimeError, "open UTC day"):
            flow.daily_receipts(self.root, "2026-10-01", "2026-10-02")

    def test_daily_timeout_is_failure(self):
        with self.assertRaisesRegex(RuntimeError, "incomplete after 0s"):
            flow.wait_daily_receipts(self.root, "2026-10-01", "2026-10-02", timeout_seconds=0)


if __name__ == "__main__":
    unittest.main()
