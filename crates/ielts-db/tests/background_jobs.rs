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
    assert_eq!(interrupted.status, "interrupted");
    assert_eq!(interrupted.attempts, 3);

    // Startup recovery must not requeue: attempts == max_attempts.
    let requeued = startup_recovery(&conn, "2026-08-16T00:07:00Z", 300).unwrap();
    assert_eq!(requeued, 0);
    let after = load_job(&conn, &job_id).unwrap().unwrap();
    assert_eq!(after.status, "interrupted");
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
    assert_eq!(report.dream_jobs_enqueued, 2);

    let jobs = list_jobs(&conn);
    assert_eq!(
        jobs,
        vec![
            "daily_dream:local:2026-08-15".to_string(),
            "daily_dream:u2:2026-08-16".to_string(),
            "daily_journal:local:2026-08-15".to_string(),
            "daily_journal:u2:2026-08-16".to_string(),
        ]
    );

    // A second startup sees the queued rows through the same dedupe keys and
    // does not create another copy.
    let second = startup_recovery_with_catch_up(&conn, "2026-08-17T00:00:00Z", 300).unwrap();
    assert_eq!(second.journal_jobs_enqueued, 0);
    assert_eq!(second.dream_jobs_enqueued, 0);
    assert_eq!(list_recent_jobs(&conn, 20).unwrap().len(), 4);
}

#[test]
fn startup_catch_up_skips_dates_with_existing_journal_and_dream() {
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
    conn.execute(
        "INSERT INTO dream_runs
           (id, user_id, journal_id, status, input_hash, output_hash, started_at,
            finished_at, error_json, attempts, created_at, updated_at)
         VALUES ('drmrun-covered', 'local', 'djnl-covered', 'completed', NULL, 'out',
                 '2026-08-15T23:01:00Z', '2026-08-15T23:02:00Z', NULL, 1,
                 '2026-08-15T23:01:00Z', '2026-08-15T23:02:00Z')",
        [],
    )
    .unwrap();

    let report = startup_recovery_with_catch_up(&conn, "2026-08-17T00:00:00Z", 300).unwrap();
    assert_eq!(report.journal_jobs_enqueued, 0);
    assert_eq!(report.dream_jobs_enqueued, 0);
    assert!(list_recent_jobs(&conn, 20).unwrap().is_empty());
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
