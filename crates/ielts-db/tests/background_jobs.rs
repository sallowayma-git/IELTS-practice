//! M7-01 background job worker tests: atomic claim, lease recovery, dedupe,
//! startup recovery.

use ielts_db::{
    claim_job, enqueue_job, heartbeat, lease_recover, load_job, startup_recovery,
    startup_recovery_with_catch_up, list_recent_jobs,
};
use rusqlite::Connection;
use tempfile::tempdir;

use ielts_db::{migrate, open_connection, DbOpenOptions};

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

const NOW: &str = "2026-08-16T00:00:00Z";
const WORKER_A: &str = "worker-a";
const WORKER_B: &str = "worker-b";

#[test]
fn claim_is_atomic_two_workers_one_job() {
    let (_dir, conn) = open_db();
    enqueue_job(
        &conn,
        "daily_journal",
        "local",
        NOW,
        1,
        Some("daily_journal:local:2026-08-16"),
        None,
    )
    .unwrap();

    // Worker A claims first.
    let claimed_a = claim_job(&conn, NOW, WORKER_A).unwrap();
    assert!(claimed_a.is_some());
    let job_a = claimed_a.unwrap();
    assert_eq!(job_a.locked_by.as_deref(), Some(WORKER_A));
    assert_eq!(job_a.status, "running");
    assert_eq!(job_a.attempts, 1);

    // Worker B tries to claim: the only queued job is now running, so nothing.
    let claimed_b = claim_job(&conn, NOW, WORKER_B).unwrap();
    assert!(claimed_b.is_none());
}

#[test]
fn claim_respects_priority_and_scheduled_at_order() {
    let (_dir, conn) = open_db();
    // Lower priority — should be claimed second.
    enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    // Higher priority — should be claimed first.
    enqueue_job(&conn, "daily_journal", "local", NOW, 5, None, None).unwrap();

    let first = claim_job(&conn, NOW, WORKER_A).unwrap().unwrap();
    assert_eq!(first.priority, 5);

    let second = claim_job(&conn, NOW, WORKER_A).unwrap().unwrap();
    assert_eq!(second.priority, 1);
}

#[test]
fn heartbeat_updates_running_job() {
    let (_dir, conn) = open_db();
    enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    let job = claim_job(&conn, NOW, WORKER_A).unwrap().unwrap();

    let beat = heartbeat(&conn, &job.id, WORKER_A, "2026-08-16T00:01:00Z").unwrap();
    assert!(beat);

    // A different worker cannot heartbeat.
    let beat_other = heartbeat(&conn, &job.id, WORKER_B, "2026-08-16T00:02:00Z").unwrap();
    assert!(!beat_other);
}

#[test]
fn lease_recover_reclaims_expired_running_jobs() {
    let (_dir, conn) = open_db();
    enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    let job = claim_job(&conn, NOW, WORKER_A).unwrap().unwrap();
    // Heartbeat was set to NOW (00:00:00). With a 300s lease, a heartbeat at
    // 00:05:01 is expired.
    let recovered = lease_recover(&conn, "2026-08-16T00:05:01Z", 300).unwrap();
    assert_eq!(recovered, 1);
    let after = load_job(&conn, &job.id).unwrap().unwrap();
    assert_eq!(after.status, "interrupted");
    assert!(after.locked_by.is_none());
}

#[test]
fn dedupe_key_prevents_duplicate_queued_jobs() {
    let (_dir, conn) = open_db();
    let first = enqueue_job(
        &conn,
        "daily_journal",
        "local",
        NOW,
        1,
        Some("daily_journal:local:2026-08-16"),
        None,
    )
    .unwrap();
    let second = enqueue_job(
        &conn,
        "daily_journal",
        "local",
        NOW,
        1,
        Some("daily_journal:local:2026-08-16"),
        None,
    )
    .unwrap();
    // Same dedupe_key while queued → idempotent, returns the same id.
    assert_eq!(first, second);

    // Once claimed, a new enqueue with the same dedupe_key creates a new job
    // (the queued one is now running).
    claim_job(&conn, NOW, WORKER_A).unwrap();
    let third = enqueue_job(
        &conn,
        "daily_journal",
        "local",
        NOW,
        1,
        Some("daily_journal:local:2026-08-16"),
        None,
    )
    .unwrap();
    assert_ne!(first, third);
}

#[test]
fn startup_recovery_requeues_interrupted_within_attempts() {
    let (_dir, conn) = open_db();
    enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    let job = claim_job(&conn, NOW, WORKER_A).unwrap().unwrap();
    // Simulate a crash: lease expires.
    lease_recover(&conn, "2026-08-16T00:05:01Z", 300).unwrap();
    let interrupted = load_job(&conn, &job.id).unwrap().unwrap();
    assert_eq!(interrupted.status, "interrupted");
    assert_eq!(interrupted.attempts, 1);

    // Startup recovery requeues interrupted jobs with attempts < max_attempts.
    let requeued = startup_recovery(&conn, "2026-08-16T00:06:00Z", 300).unwrap();
    assert_eq!(requeued, 1);
    let after = load_job(&conn, &job.id).unwrap().unwrap();
    assert_eq!(after.status, "queued");
}

#[test]
fn startup_recovery_does_not_requeue_exhausted_jobs() {
    let (_dir, conn) = open_db();
    let job_id = enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    // Burn all attempts: claim → lease_recover → startup_recovery requeue, until
    // max_attempts (3) is reached. Each cycle increments attempts by 1.
    for _ in 0..3 {
        claim_job(&conn, NOW, WORKER_A).unwrap();
        lease_recover(&conn, "2026-08-16T00:05:01Z", 300).unwrap();
        startup_recovery(&conn, "2026-08-16T00:06:00Z", 300).unwrap();
    }
    let interrupted = load_job(&conn, &job_id).unwrap().unwrap();
    assert_eq!(interrupted.status, "failed");
    assert_eq!(interrupted.attempts, 3);

    // Startup recovery must not requeue: attempts == max_attempts.
    let requeued = startup_recovery(&conn, "2026-08-16T00:07:00Z", 300).unwrap();
    assert_eq!(requeued, 0);
    let after = load_job(&conn, &job_id).unwrap().unwrap();
    assert_eq!(after.status, "failed");
}

fn seed_recovery_activity(conn: &Connection) {
    conn.execute(
        "INSERT INTO attempts
           (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
         VALUES ('attempt-recovery', 'reading', 'single', 'completed', ?1, 0, 2, ?1, ?1)",
        [NOW],
    ).unwrap();
}

#[test]
fn startup_recovery_preserves_queued_replacement_without_blocking_catch_up() {
    let (_dir, conn) = open_db();
    seed_recovery_activity(&conn);
    let key = "daily_journal:local:2026-08-16";
    let old = enqueue_job(&conn, "daily_journal", "local", NOW, 1, Some(key), None).unwrap();
    claim_job(&conn, NOW, WORKER_A).unwrap();
    let replacement = enqueue_job(&conn, "daily_journal", "local", NOW, 1, Some(key), None).unwrap();
    let report = startup_recovery_with_catch_up(&conn, "2026-08-17T00:06:00Z", 300).unwrap();
    assert_eq!(report.requeued_jobs, 0);
    assert_eq!(report.journal_jobs_enqueued, 0);
    let retired = load_job(&conn, &old).unwrap().unwrap();
    assert_eq!(retired.status, "failed");
    assert_eq!(retired.attempts, 1);
    assert!(retired.last_error.unwrap().contains("duplicate window"));
    assert_eq!(load_job(&conn, &replacement).unwrap().unwrap().status, "queued");
    let again = startup_recovery_with_catch_up(&conn, "2026-08-17T00:07:00Z", 300).unwrap();
    assert_eq!(again.requeued_jobs, 0);
    assert_eq!(again.journal_jobs_enqueued, 0);
}

#[test]
fn startup_recovery_collapses_multiple_interrupted_rows_but_not_other_users() {
    let (_dir, conn) = open_db();
    let mut local_ids = Vec::new();
    for _ in 0..3 {
        let id = enqueue_job(&conn, "daily_journal", "local", NOW, 1, Some("same-window"), None).unwrap();
        claim_job(&conn, NOW, WORKER_A).unwrap();
        local_ids.push(id);
    }
    let other = enqueue_job(&conn, "daily_journal", "other", NOW, 1, Some("same-window"), None).unwrap();
    claim_job(&conn, NOW, WORKER_B).unwrap();
    let report = startup_recovery_with_catch_up(&conn, "2026-08-16T00:06:00Z", 300).unwrap();
    assert_eq!(report.requeued_jobs, 2);
    let states: Vec<_> = local_ids.iter().map(|id| load_job(&conn, id).unwrap().unwrap()).collect();
    assert_eq!(states.iter().filter(|job| job.status == "queued").count(), 1);
    assert_eq!(states.iter().filter(|job| job.status == "failed").count(), 2);
    assert_eq!(load_job(&conn, &other).unwrap().unwrap().status, "queued");
}

#[test]
fn startup_catch_up_does_not_reset_terminal_failure_budget() {
    for crash in [false, true] {
        let (_dir, conn) = open_db();
        seed_recovery_activity(&conn);
        let id = enqueue_job(&conn, "daily_journal", "local", NOW, 1,
            Some("daily_journal:local:2026-08-16"), None).unwrap();
        claim_job(&conn, NOW, WORKER_A).unwrap();
        conn.execute("UPDATE background_jobs SET attempts = max_attempts WHERE id = ?1", [&id]).unwrap();
        if !crash {
            ielts_db::fail_job(&conn, &id, WORKER_A, NOW, "exhausted", 0).unwrap();
        }
        for _ in 0..2 {
            let report = startup_recovery_with_catch_up(&conn, "2026-08-16T00:06:00Z", 300).unwrap();
            assert_eq!(report.journal_jobs_enqueued, 0);
            assert_eq!(report.requeued_jobs, 0);
            let job = load_job(&conn, &id).unwrap().unwrap();
            assert_eq!(job.status, "failed");
            assert_eq!(job.attempts, job.max_attempts);
        }
        // Only explicit enqueue may create a fresh user-authorized retry.
        let manual = enqueue_job(&conn, "daily_journal", "local", NOW, 1,
            Some("daily_journal:local:2026-08-16"), None).unwrap();
        assert_ne!(manual, id);
    }
}

#[test]
fn startup_recovery_rolls_back_when_catch_up_enqueue_fails() {
    let (_dir, conn) = open_db();
    seed_recovery_activity(&conn);
    let id = enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    claim_job(&conn, NOW, WORKER_A).unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_journal_enqueue BEFORE INSERT ON background_jobs
         WHEN NEW.job_kind = 'daily_journal'
         BEGIN SELECT RAISE(ABORT, 'simulated enqueue failure'); END;",
    ).unwrap();
    assert!(startup_recovery_with_catch_up(&conn, "2026-08-17T00:06:00Z", 300).is_err());
    let job = load_job(&conn, &id).unwrap().unwrap();
    assert_eq!(job.status, "running");
    assert_eq!(job.locked_by.as_deref(), Some(WORKER_A));
    assert_eq!(list_recent_jobs(&conn, 20).unwrap().len(), 1);
    conn.execute_batch("DROP TRIGGER reject_journal_enqueue").unwrap();
    let report = startup_recovery_with_catch_up(&conn, "2026-08-17T00:06:00Z", 300).unwrap();
    assert_eq!(report.requeued_jobs, 1);
    assert_eq!(report.journal_jobs_enqueued, 1);
}

#[test]
fn finish_job_marks_completed() {
    use ielts_db::finish_job;
    let (_dir, conn) = open_db();
    let job_id = enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    claim_job(&conn, NOW, WORKER_A).unwrap();
    let finished = finish_job(&conn, &job_id, WORKER_A, "2026-08-16T00:01:00Z").unwrap();
    assert!(finished);
    let after = load_job(&conn, &job_id).unwrap().unwrap();
    assert_eq!(after.status, "completed");
}

#[test]
fn fail_job_reschedules_within_max_attempts() {
    use ielts_db::fail_job;
    let (_dir, conn) = open_db();
    let job_id = enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    claim_job(&conn, NOW, WORKER_A).unwrap();
    let failed = fail_job(&conn, &job_id, WORKER_A, "2026-08-16T00:01:00Z", "llm timeout", 60).unwrap();
    assert!(failed);
    let after = load_job(&conn, &job_id).unwrap().unwrap();
    assert_eq!(after.status, "queued");
    assert!(after.last_error.as_deref().is_some());
    // Rescheduled at now + 60s.
    assert_ne!(after.scheduled_at, NOW);
}

#[test]
fn fail_job_marks_failed_when_attempts_exhausted() {
    use ielts_db::fail_job;
    let (_dir, conn) = open_db();
    let job_id = enqueue_job(&conn, "daily_journal", "local", NOW, 1, None, None).unwrap();
    // Three cycles: claim → fail. fail_job reschedules with a 60s delay when
    // attempts < max_attempts. Advance now past the rescheduled time so the
    // next claim picks it up. On the third failure attempts == max_attempts,
    // so fail_job marks it terminal.
    let times = [
        ("2026-08-16T00:01:00Z", "2026-08-16T00:02:00Z"),
        ("2026-08-16T00:03:00Z", "2026-08-16T00:04:00Z"),
        ("2026-08-16T00:05:00Z", "2026-08-16T00:06:00Z"),
    ];
    for (claim_now, fail_now) in times {
        claim_job(&conn, claim_now, WORKER_A).unwrap();
        fail_job(&conn, &job_id, WORKER_A, fail_now, "llm timeout", 60).unwrap();
    }
    let after = load_job(&conn, &job_id).unwrap().unwrap();
    assert_eq!(after.status, "failed");
}

#[test]
fn startup_catch_up_discovers_canonical_activity_dates_and_dedupes() {
    let (_dir, conn) = open_db();
    conn.execute(
        "INSERT INTO attempts
           (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
         VALUES ('attempt-catchup', 'reading', 'single', 'completed',
                 '2026-08-15T10:00:00Z', 0, 2, '2026-08-15T10:00:00Z', '2026-08-15T10:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO learning_events
           (id, user_id, event_type, source_kind, source_id, idempotency_key, activity,
            asset_id, attempt_id, question_id, skill_key, occurred_at, payload_json,
            content_hash, schema_version, consolidation_state, sensitivity, created_at, updated_at)
         VALUES ('lev-catchup', 'u2', 'reading.question.outcome', 'reading_question',
                 'source-catchup', 'idem-catchup', 'reading', NULL, NULL, NULL, NULL,
                 '2026-08-16T11:00:00Z', '{}', 'hash-catchup', 1, 'pending', 'normal',
                 '2026-08-16T11:00:00Z', '2026-08-16T11:00:00Z')",
        [],
    )
    .unwrap();
    // Future activity is not a recoverable daily window yet.
    conn.execute(
        "INSERT INTO attempts
           (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
         VALUES ('attempt-future', 'writing', 'single', 'draft',
                 '2026-08-18T10:00:00Z', 0, 2, '2026-08-18T10:00:00Z', '2026-08-18T10:00:00Z')",
        [],
    )
    .unwrap();

    let report = startup_recovery_with_catch_up(&conn, "2026-08-17T00:00:00Z", 300).unwrap();
    assert_eq!(report.requeued_jobs, 0);
    assert_eq!(report.journal_jobs_enqueued, 2);

    // One daily job kind: catch-up never enqueues a `daily_dream`.
    let jobs = list_jobs(&conn);
    assert_eq!(
        jobs,
        vec![
            "daily_journal:local:2026-08-15".to_string(),
            "daily_journal:u2:2026-08-16".to_string(),
        ]
    );

    // A second startup sees the queued rows through the same dedupe keys and
    // does not create another copy.
    let second = startup_recovery_with_catch_up(&conn, "2026-08-17T00:00:00Z", 300).unwrap();
    assert_eq!(second.journal_jobs_enqueued, 0);
    assert_eq!(list_recent_jobs(&conn, 20).unwrap().len(), 2);
}

#[test]
fn startup_catch_up_skips_dates_with_an_up_to_date_journal() {
    let (_dir, conn) = open_db();
    conn.execute(
        "INSERT INTO attempts
           (id, activity, mode, status, started_at, duration_ms, schema_version, created_at, updated_at)
         VALUES ('attempt-covered', 'reading', 'single', 'completed',
                 '2026-08-15T10:00:00Z', 0, 2, '2026-08-15T10:00:00Z', '2026-08-15T10:00:00Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO daily_journals
           (id, user_id, journal_date, version, status, facts_json, source_hash,
            rendered_markdown, superseded_by, created_at, updated_at)
         VALUES ('djnl-covered', 'local', '2026-08-15', 1, 'published', '{}', 'hash',
                 NULL, NULL, '2026-08-15T23:00:00Z', '2026-08-15T23:00:00Z')",
        [],
    )
    .unwrap();
    let facts = ielts_db::build_daily_facts(&conn, "local", "2026-08-15").unwrap();
    conn.execute("UPDATE daily_journals SET source_hash=?1 WHERE id='djnl-covered'", [&facts.source_hash]).unwrap();
    let report = startup_recovery_with_catch_up(&conn, "2026-08-17T00:00:00Z", 300).unwrap();
    assert_eq!(report.journal_jobs_enqueued, 0);
    assert!(list_recent_jobs(&conn, 20).unwrap().is_empty());
}

/// A `daily_dream` row can only come from an older database: nothing enqueues one
/// any more (the migration 0018 CHECK still allows the kind).
fn legacy_daily_dream_job(conn: &Connection, day: &str) -> String {
    let id = format!("job-legacy-{day}");
    conn.execute(
        "INSERT INTO background_jobs (id, job_kind, user_id, status, priority, scheduled_at, attempts,
           max_attempts, dedupe_key, created_at, updated_at)
         VALUES (?1, 'daily_dream', 'local', 'queued', 4, ?2, 0, 3, ?3, ?2, ?2)",
        rusqlite::params![id, NOW, format!("daily_dream:local:{day}")],
    ).unwrap();
    id
}

fn journal_binding(conn: &Connection, id: &str, day: &str) -> serde_json::Value {
    let facts = ielts_db::build_daily_facts(conn, "local", day).unwrap();
    let journal = ielts_db::insert_journal(conn, "local", &facts, None).unwrap();
    let binding = serde_json::json!({"jobId": id, "workerId": WORKER_A, "day": day, "userId": "local",
        "journalId": journal.id, "sourceHash": journal.source_hash});
    ielts_db::bind_job_business(conn, id, WORKER_A, &binding).unwrap();
    binding
}

#[test]
fn only_the_daily_journal_kind_can_be_enqueued() {
    let (_dir, conn) = open_db();
    assert!(enqueue_job(&conn, "daily_dream", "local", NOW, 4, Some("daily_dream:local:2026-08-15"), None).is_err());
    assert!(enqueue_job(&conn, "weekly_dream", "local", NOW, 4, None, None).is_err());
    assert!(enqueue_job(&conn, "daily_journal", "local", NOW, 4, None, None).is_ok());
}

#[test]
fn automatic_claim_only_closed_local_windows_and_preserves_retry_identity() {
    let (_dir, conn) = open_db();
    let now = "2026-08-17T00:00:00Z";
    let old = enqueue_job(&conn,"daily_journal","local",now,4,Some("daily_journal:local:2026-08-16"),None).unwrap();
    enqueue_job(&conn,"daily_journal","local",now,10,Some("daily_journal:local:2026-08-17"),None).unwrap();
    enqueue_job(&conn,"daily_journal","u2",now,20,Some("daily_journal:u2:2026-08-16"),None).unwrap();
    let claimed = ielts_db::claim_closed_daily_job(&conn,now,WORKER_A).unwrap().unwrap();
    assert_eq!(claimed.id,old);
    assert!(ielts_db::claim_closed_daily_job(&conn,now,WORKER_B).unwrap().is_none());
    assert!(heartbeat(&conn,&old,WORKER_A,"2026-08-17T00:00:30Z").unwrap());
    ielts_db::fail_job(&conn,&old,WORKER_A,"2026-08-17T00:00:31Z","journal build failed",60).unwrap();
    assert!(ielts_db::claim_closed_daily_job(&conn,"2026-08-17T00:01:00Z",WORKER_A).unwrap().is_none());
    let retry = ielts_db::claim_closed_daily_job(&conn,"2026-08-17T00:01:32Z",WORKER_A).unwrap().unwrap();
    assert_eq!(retry.id,old);
    assert_eq!(retry.attempts,2);
}

#[test]
fn a_legacy_daily_dream_job_is_claimed_and_completed_like_a_journal_job() {
    let (_dir, conn) = open_db();
    let id = legacy_daily_dream_job(&conn, "2026-08-15");
    let claimed = ielts_db::claim_closed_daily_job(&conn, "2026-08-17T00:00:00Z", WORKER_A).unwrap().unwrap();
    assert_eq!(claimed.id, id);
    assert_eq!(claimed.job_kind, "daily_dream");
    journal_binding(&conn, &id, "2026-08-15");
    // No dream run is needed or created: the journal version is the whole result.
    assert!(ielts_db::finish_bound_daily_job(&conn, &id, WORKER_A, "2026-08-17T00:00:05Z").unwrap());
    assert_eq!(load_job(&conn, &id).unwrap().unwrap().status, "completed");
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM dream_runs", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM agent_runs", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn open_day_is_not_scheduled_and_closed_day_checkpoint_is_authoritative() {
    let (_dir,conn) = open_db();
    seed_recovery_activity(&conn);
    let today = startup_recovery_with_catch_up(&conn,"2026-08-16T20:00:00Z",300).unwrap();
    assert_eq!(today.journal_jobs_enqueued,0);
    startup_recovery_with_catch_up(&conn,"2026-08-17T00:00:00Z",300).unwrap();
    let job = ielts_db::claim_closed_daily_job(&conn,"2026-08-17T00:00:00Z",WORKER_A).unwrap().unwrap();
    assert_eq!(job.job_kind,"daily_journal");
    assert_eq!(job.checkpoint_json.unwrap(),serde_json::json!({"day":"2026-08-16","userId":"local"}));
}

#[test]
fn exhausted_attempt_recovers_completed_business_receipt_without_reexecution() {
    for legacy in [false, true] {
        let (_dir,conn) = open_db();
        let day = "2026-08-15";
        let id = if legacy {
            legacy_daily_dream_job(&conn, day)
        } else {
            enqueue_job(&conn,"daily_journal","local",NOW,4,Some(&format!("daily_journal:local:{day}")),None).unwrap()
        };
        ielts_db::claim_closed_daily_job(&conn,"2026-08-17T00:00:00Z",WORKER_A).unwrap().unwrap();
        journal_binding(&conn, &id, day);
        conn.execute("UPDATE background_jobs SET attempts=max_attempts WHERE id=?1",[&id]).unwrap();
        startup_recovery_with_catch_up(&conn,"2026-08-17T00:06:00Z",300).unwrap();
        let receipt = load_job(&conn,&id).unwrap().unwrap();
        assert_eq!(receipt.status,"completed");
        assert_eq!(receipt.attempts,receipt.max_attempts);
        assert!(ielts_db::claim_closed_daily_job(&conn,"2026-08-17T00:06:00Z",WORKER_A).unwrap().is_none());
    }
}

#[test]
fn failure_with_queued_manual_replacement_does_not_hit_unique_constraint() {
    let (_dir,conn) = open_db();
    let key = "daily_journal:local:2026-08-15";
    let old = enqueue_job(&conn,"daily_journal","local",NOW,1,Some(key),None).unwrap();
    claim_job(&conn,NOW,WORKER_A).unwrap().unwrap();
    let replacement = enqueue_job(&conn,"daily_journal","local",NOW,1,Some(key),None).unwrap();
    assert!(ielts_db::fail_job(&conn,&old,WORKER_A,NOW,"superseded by manual retry",60).unwrap());
    assert_eq!(load_job(&conn,&old).unwrap().unwrap().status,"failed");
    assert_eq!(load_job(&conn,&replacement).unwrap().unwrap().status,"queued");
}

#[test]
fn a_job_completes_only_against_the_exact_bound_journal_version() {
    for corruption in [
        "UPDATE daily_journals SET user_id='other'",
        "UPDATE daily_journals SET source_hash='another-hash'",
        "UPDATE background_jobs SET checkpoint_json=json_set(checkpoint_json,'$.sourceHash','wrong-hash')",
        "UPDATE background_jobs SET checkpoint_json=json_set(checkpoint_json,'$.day','2026-08-14')",
        "UPDATE background_jobs SET checkpoint_json=json_set(checkpoint_json,'$.journalId','missing-journal')",
    ] {
        let (_dir, conn) = open_db();
        let id = enqueue_job(&conn, "daily_journal", "local", NOW, 4, Some("daily_journal:local:2026-08-15"), None).unwrap();
        ielts_db::claim_job_by_id(&conn, &id, NOW, WORKER_A).unwrap();
        journal_binding(&conn, &id, "2026-08-15");
        conn.execute_batch(corruption).unwrap();
        assert!(!ielts_db::finish_bound_daily_job(&conn, &id, WORKER_A, NOW).unwrap(), "{corruption}");
        assert_eq!(load_job(&conn, &id).unwrap().unwrap().status, "running");
        // Recovery does not invent a receipt for a stale binding either: it retries.
        for now in ["2026-08-16T00:06:00Z", "2026-08-16T00:07:00Z"] {
            ielts_db::background_jobs::recover_daily_leases(&conn, now, 300).unwrap();
            assert_eq!(load_job(&conn, &id).unwrap().unwrap().status, "queued", "{corruption}");
        }
    }
}

#[test]
fn a_foreign_worker_cannot_complete_the_job() {
    let (_dir, conn) = open_db();
    let id = enqueue_job(&conn, "daily_journal", "local", NOW, 4, Some("daily_journal:local:2026-08-15"), None).unwrap();
    ielts_db::claim_job_by_id(&conn, &id, NOW, WORKER_A).unwrap();
    journal_binding(&conn, &id, "2026-08-15");
    assert!(!ielts_db::finish_bound_daily_job(&conn, &id, WORKER_B, NOW).unwrap());
    assert_eq!(load_job(&conn, &id).unwrap().unwrap().status, "running");
    assert!(ielts_db::bind_job_business(&conn, &id, WORKER_B, &serde_json::json!({})).is_err());
    assert!(ielts_db::finish_bound_daily_job(&conn, &id, WORKER_A, NOW).unwrap());
}

#[test]
fn job_completion_failure_rolls_back_direct_and_lease_recovery() {
    for recovery in [false, true] {
        let (_dir, conn) = open_db();
        let id = enqueue_job(&conn, "daily_journal", "local", NOW, 4, Some("daily_journal:local:2026-08-15"), None).unwrap();
        ielts_db::claim_job_by_id(&conn, &id, NOW, WORKER_A).unwrap();
        journal_binding(&conn, &id, "2026-08-15");
        let jobs_before = sqlite_rows(&conn, "SELECT * FROM background_jobs ORDER BY id");
        conn.execute_batch(
            "CREATE TRIGGER reject_job_completion BEFORE UPDATE OF status ON background_jobs
             WHEN NEW.status='completed'
             BEGIN SELECT RAISE(ABORT,'completion rejected'); END;",
        ).unwrap();
        let error = if recovery {
            ielts_db::background_jobs::recover_daily_leases(&conn, "2026-08-16T00:06:00Z", 300).unwrap_err()
        } else {
            ielts_db::finish_bound_daily_job(&conn, &id, WORKER_A, NOW).unwrap_err()
        };
        assert!(error.to_string().contains("completion rejected"), "{error}");
        assert!(conn.is_autocommit());
        // Includes the lease expiry UPDATE made before reconciliation in the outer transaction.
        assert_eq!(sqlite_rows(&conn, "SELECT * FROM background_jobs ORDER BY id"), jobs_before);
        conn.execute_batch("DROP TRIGGER reject_job_completion").unwrap();
        if recovery {
            ielts_db::background_jobs::recover_daily_leases(&conn, "2026-08-16T00:06:00Z", 300).unwrap();
        } else {
            assert!(ielts_db::finish_bound_daily_job(&conn, &id, WORKER_A, NOW).unwrap());
        }
        assert_eq!(load_job(&conn, &id).unwrap().unwrap().status, "completed");
    }
}

fn sqlite_rows(conn: &Connection, sql: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut statement = conn.prepare(sql).unwrap();
    let columns = statement.column_count();
    statement.query_map([], |row| {
        (0..columns).map(|column| row.get(column)).collect()
    }).unwrap().collect::<Result<Vec<_>, _>>().unwrap()
}

#[test]
fn automatic_pause_before_claim_and_after_claim_refunds_attempt_and_resumes() {
    let (_dir, conn) = open_db();
    let worker = "daily-worker-test";
    let id = enqueue_job(&conn, "daily_journal", "local", NOW, 4,
        Some("daily_journal:local:2026-08-15"), None).unwrap();
    ielts_db::upsert_setting(&conn, "features", "memory_auto_candidates_v1", &serde_json::json!("disabled")).unwrap();
    assert!(ielts_db::claim_closed_daily_job(&conn, NOW, worker).unwrap().is_none());
    assert_eq!(load_job(&conn, &id).unwrap().unwrap().attempts, 0);
    ielts_db::upsert_setting(&conn, "features", "memory_auto_candidates_v1", &serde_json::json!("proposal_only")).unwrap();
    let claim = ielts_db::claim_closed_daily_job(&conn, NOW, worker).unwrap().unwrap();
    assert_eq!(claim.id, id);
    ielts_db::upsert_setting(&conn, "features", "memory_auto_candidates_v1", &serde_json::json!("disabled")).unwrap();
    assert!(ielts_db::fail_job(&conn, &id, worker, NOW, "paused during execution", 60).unwrap());
    let paused = load_job(&conn, &id).unwrap().unwrap();
    assert_eq!(paused.status, "queued");
    assert_eq!(paused.attempts, 0);
    assert!(paused.last_error.is_none());
    assert!(paused.locked_by.is_none());
    assert!(!ielts_db::background_jobs::pause_owned_daily_job(&conn, &id, worker, NOW).unwrap());
    ielts_db::delete_setting(&conn, "features", "memory_auto_candidates_v1").unwrap();
    let resumed = ielts_db::claim_closed_daily_job(&conn, NOW, worker).unwrap().unwrap();
    assert_eq!(resumed.id, id);
    assert_eq!(resumed.attempts, 1);
}

#[test]
fn periodic_lease_recovery_does_not_scan_activity_history() {
    let (_dir, conn) = open_db();
    seed_recovery_activity(&conn);
    let id = enqueue_job(&conn, "daily_journal", "local", NOW, 4, None, None).unwrap();
    claim_job(&conn, NOW, WORKER_A).unwrap();
    assert_eq!(ielts_db::background_jobs::recover_daily_leases(&conn, "2026-08-17T00:06:00Z", 300).unwrap(), 1);
    assert_eq!(load_job(&conn, &id).unwrap().unwrap().status, "queued");
    assert_eq!(list_recent_jobs(&conn, 20).unwrap().len(), 1);
}

fn list_jobs(conn: &Connection) -> Vec<String> {
    let mut jobs: Vec<String> = list_recent_jobs(conn, 20)
        .unwrap()
        .into_iter()
        .filter(|job| job.status == "queued")
        .filter_map(|job| job.dedupe_key)
        .collect();
    jobs.sort();
    jobs
}
