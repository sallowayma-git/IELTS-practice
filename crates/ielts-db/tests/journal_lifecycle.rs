//! M7-01/02 background-job lifecycle tests.
//!
//! Covers the M7 test list (task plan §8369-8380): app restart catches missed
//! daily job, duplicate day dedupe, lease recovery. The dream/journal facts
//! exactness + LLM-cannot-change-facts contracts are covered by the application
//! `journal_dream_lifecycle` tests; here we exercise the SQLite job worker
//! durability boundary.

use ielts_db::background_jobs::{
    claim_job, enqueue_job, fail_job, finish_job, heartbeat, lease_recover,
    list_recent_jobs, load_job, startup_recovery,
};
use ielts_db::{migrate, open_connection, DbOpenOptions};
use tempfile::tempdir;

const NOW: &str = "2026-08-16T10:00:00+00:00";
const WORKER: &str = "worker-1";

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("jobs.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn seed_user(_conn: &rusqlite::Connection, _user_id: &str) {
    // background_jobs.user_id is a free-text column (default 'local'); no users
    // row is required. Kept as a no-op so the test helpers read clearly.
}

#[test]
fn duplicate_day_dedupe_does_not_requeue() {
    let (_dir, conn) = open_db();
    seed_user(&conn, "u1");
    let id_a = enqueue_job(
        &conn, "daily_journal", "u1", NOW, 5, Some("daily_journal:u1:2026-08-16"), None,
    )
    .unwrap();
    let id_b = enqueue_job(
        &conn, "daily_journal", "u1", NOW, 5, Some("daily_journal:u1:2026-08-16"), None,
    )
    .unwrap();
    assert_eq!(id_a, id_b, "dedupe_key must collapse duplicate queued jobs");
    let queued = list_recent_jobs(&conn, 10)
        .unwrap()
        .into_iter()
        .filter(|job| job.status == "queued")
        .count();
    assert_eq!(queued, 1);
}

#[test]
fn claim_is_atomic_only_one_worker_wins() {
    let (_dir, conn) = open_db();
    seed_user(&conn, "u1");
    enqueue_job(&conn, "daily_dream", "u1", NOW, 4, None, None).unwrap();
    let first = claim_job(&conn, NOW, WORKER).unwrap();
    let second = claim_job(&conn, NOW, "worker-2").unwrap();
    assert!(first.is_some(), "first claim should win the job");
    assert!(second.is_none(), "second claim must find nothing queued");
}

#[test]
fn lease_recovery_returns_running_to_interrupted() {
    let (_dir, conn) = open_db();
    seed_user(&conn, "u1");
    let id = enqueue_job(&conn, "daily_dream", "u1", NOW, 4, None, None).unwrap();
    claim_job(&conn, NOW, WORKER).unwrap();
    // Heartbeat is stale: simulate elapsed time past the lease window.
    heartbeat(&conn, &id, WORKER, "2026-08-16T09:00:00+00:00").unwrap();
    let recovered = lease_recover(&conn, NOW, 300).unwrap();
    assert_eq!(recovered, 1, "one stale running job should be interrupted");
    let job = load_job(&conn, &id).unwrap().unwrap();
    assert_eq!(job.status, "interrupted");
}

#[test]
fn startup_recovery_requeues_interrupted_with_retries_left() {
    let (_dir, conn) = open_db();
    seed_user(&conn, "u1");
    let id = enqueue_job(&conn, "daily_dream", "u1", NOW, 4, None, None).unwrap();
    claim_job(&conn, NOW, WORKER).unwrap();
    heartbeat(&conn, &id, WORKER, "2026-08-16T09:00:00+00:00").unwrap();
    // App restart: startup_recovery should requeue interrupted jobs with retries remaining.
    let recovered = startup_recovery(&conn, NOW, 300).unwrap();
    assert_eq!(recovered, 1);
    let job = load_job(&conn, &id).unwrap().unwrap();
    assert_eq!(job.status, "queued", "interrupted job with retries left requeues on restart");
}

#[test]
fn startup_recovery_leaves_exhausted_jobs_interrupted() {
    let (_dir, conn) = open_db();
    seed_user(&conn, "u1");
    let id = enqueue_job(&conn, "daily_dream", "u1", NOW, 4, None, None).unwrap();
    // Burn all attempts: claim increments attempts, fail_job reschedules while
    // attempts < max_attempts, then marks the job failed on the final attempt.
    loop {
        let claimed = claim_job(&conn, NOW, WORKER).unwrap();
        if claimed.is_none() {
            break;
        }
        fail_job(&conn, &id, WORKER, NOW, "simulated", 0).unwrap();
        let job = load_job(&conn, &id).unwrap().unwrap();
        if job.status == "failed" {
            break;
        }
    }
    let recovered = startup_recovery(&conn, NOW, 300).unwrap();
    assert_eq!(recovered, 0, "exhausted jobs must not be requeued");
    let job = load_job(&conn, &id).unwrap().unwrap();
    assert_eq!(job.status, "failed");
}

#[test]
fn finish_job_marks_completed() {
    let (_dir, conn) = open_db();
    seed_user(&conn, "u1");
    let id = enqueue_job(&conn, "daily_journal", "u1", NOW, 5, None, None).unwrap();
    claim_job(&conn, NOW, WORKER).unwrap();
    assert!(finish_job(&conn, &id, WORKER, NOW).unwrap());
    let job = load_job(&conn, &id).unwrap().unwrap();
    assert_eq!(job.status, "completed");
}
