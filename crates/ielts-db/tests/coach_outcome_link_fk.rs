//! Round-3 data-flow audit: `coach_outcome_links_v0`'s FK on
//! `future_observation_id` must not block deleting the observation it points at.
//!
//! 0017 declared that column `NOT NULL`, made it part of the PRIMARY KEY, and
//! then gave its FK `ON DELETE SET NULL`. Those cannot both hold, so deleting a
//! referenced `learner_observations` row failed with
//! "NOT NULL constraint failed" and aborted the caller's whole transaction.
//!
//! That was reachable in ordinary use: `coach_link_outcome` is a registered
//! Tauri command (src-tauri/src/lib.rs:298), and `learner_observations` rows are
//! deleted by the M2 projection rebuild
//! (crates/ielts-db/src/learning_observations.rs:297), which runs from all four
//! history delete paths, from the on-by-default retention prune, and from the
//! `learning_observations_rebuild` command. So one linked coach outcome was
//! enough to make history deletion and projection rebuild fail permanently.
//!
//! Migration 0024 changes the action to CASCADE, which is what the row means:
//! the link records that an assignment led to a future observation, and is
//! meaningless once that observation is gone.

use ielts_db::{
    append_coach_message, ensure_coach_thread, migrate, open_connection,
    AppendCoachMessageCommand, DbOpenOptions, EnsureCoachThreadCommand,
};
use rusqlite::params;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("fk.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

/// Seed the minimum graph: an observation, a real coach thread + message (the
/// assignment's FK requires one), a strategy assignment, and the outcome link
/// joining the assignment to the observation.
fn seed_link(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO learner_observations
           (id, user_id, observation_type, namespace, scope_kind, scope_key,
            payload_json, observed_at, projector_key, projector_version,
            source_fingerprint, created_at)
         VALUES ('obs-1','local','reading.question.outcome','reading','asset','asset-1',
                 '{}','2026-08-16T00:00:00Z','reading.v1',1,'fp-1',
                 '2026-08-16T00:00:00Z')",
        [],
    )
    .unwrap();

    let thread = ensure_coach_thread(
        conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: None,
            asset_id: None,
            kind: "review".into(),
        },
    )
    .unwrap();
    let message = append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.id.clone(),
            role: "assistant".into(),
            content: "here is the strategy".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap();

    conn.execute(
        "INSERT INTO coach_strategy_assignments_v0
           (id, user_id, coach_message_id, strategy_id, skills_addressed_json,
            memory_ids_used_json, followup_type, created_at)
         VALUES ('asg-1','local',?1,'evidence_first_v1','[]','[]','explain',
                 '2026-08-16T00:00:00Z')",
        params![message.id],
    )
    .unwrap();

    conn.execute(
        "INSERT INTO coach_outcome_links_v0
           (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
         VALUES ('asg-1','obs-1','learning','2026-08-16T00:00:00Z')",
        [],
    )
    .unwrap();
}

fn link_count(conn: &rusqlite::Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM coach_outcome_links_v0", [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn deleting_a_linked_observation_succeeds_and_removes_the_link() {
    let (_dir, conn) = open_db();
    seed_link(&conn);
    assert_eq!(link_count(&conn), 1);

    // Before 0024 this returned
    // Err(NOT NULL constraint failed: coach_outcome_links_v0.future_observation_id)
    // and took the surrounding transaction with it.
    conn.execute(
        "DELETE FROM learner_observations WHERE id = ?1",
        params!["obs-1"],
    )
    .expect("deleting a linked observation must not be blocked by the outcome link");

    assert_eq!(
        link_count(&conn),
        0,
        "the link is meaningless without its observation and must cascade away"
    );
}

#[test]
fn the_projection_rebuild_delete_shape_is_not_blocked_by_a_link() {
    // The real production deleter is the M2 rebuild, which deletes by
    // projector_key rather than by id (learning_observations.rs:297). Pin that
    // exact shape so the fix is verified against the statement that actually
    // runs, not just a convenient one.
    let (_dir, conn) = open_db();
    seed_link(&conn);

    conn.execute(
        "DELETE FROM learner_observations WHERE projector_key = ?1",
        params!["reading.v1"],
    )
    .expect("the projection rebuild must be able to clear its own rows");

    assert_eq!(link_count(&conn), 0);
}

#[test]
fn the_sibling_assignment_cascade_still_works() {
    // 0024 rebuilds the table, so the other FK's CASCADE must survive it.
    let (_dir, conn) = open_db();
    seed_link(&conn);

    conn.execute(
        "DELETE FROM coach_strategy_assignments_v0 WHERE id = ?1",
        params!["asg-1"],
    )
    .unwrap();

    assert_eq!(link_count(&conn), 0);
}

#[test]
fn the_rebuilt_table_keeps_its_constraints() {
    let (_dir, conn) = open_db();
    seed_link(&conn);

    // CHECK on outcome_kind survived the rebuild.
    assert!(conn
        .execute(
            "INSERT INTO coach_outcome_links_v0
               (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
             VALUES ('asg-1','obs-1','not_a_kind','2026-08-16T00:00:00Z')",
            [],
        )
        .is_err());

    // The composite PRIMARY KEY survived the rebuild.
    assert!(conn
        .execute(
            "INSERT INTO coach_outcome_links_v0
               (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
             VALUES ('asg-1','obs-1','learning','2026-08-17T00:00:00Z')",
            [],
        )
        .is_err());

    // A dangling parent is still rejected.
    assert!(conn
        .execute(
            "INSERT INTO coach_outcome_links_v0
               (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
             VALUES ('asg-1','obs-missing','learning','2026-08-16T00:00:00Z')",
            [],
        )
        .is_err());
}

/// Seed a learning event whose projection yields a real observation, so the
/// observation id is genuinely derivable from the ledger rather than hand-made.
fn seed_projected_observation(conn: &rusqlite::Connection) -> String {
    let payload = r#"{"attemptId":"att-1","assetId":"asset-1","questionId":"q-1","attemptOrdinal":1,"isCorrect":true,"questionKind":"mcq","changeCount":0,"visitCount":1,"elapsedMs":900,"firstTryCorrect":true}"#;
    let digest = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(payload.as_bytes()))
    };
    conn.execute(
        "INSERT INTO learning_events
           (id, user_id, event_type, source_kind, source_id, idempotency_key, activity,
            asset_id, attempt_id, question_id, skill_key, occurred_at, payload_json,
            content_hash, schema_version, consolidation_state, sensitivity, created_at,
            updated_at)
         VALUES ('ev-1','local','reading_question_outcome','test','ev-1','ev-1','reading',
                 'asset-1', NULL,'q-1', NULL,'2026-08-16T00:00:00Z',?1,?2,1,'pending',
                 'normal','2026-08-16T00:00:00Z','2026-08-16T00:00:00Z')",
        params![payload, digest],
    )
    .unwrap();
    ielts_db::learning_observations_rebuild(conn).unwrap();
    conn.query_row(
        "SELECT id FROM learner_observations LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    )
    .expect("the projection must produce an observation to link against")
}

#[test]
fn a_backup_holding_an_outcome_link_restores_into_a_fresh_database() {
    // `coach_outcome_links_v0` is in the backup set, but its parent
    // `learner_observations` is deliberately NOT -- it is a derived projection
    // rebuilt on the target. SQLite enforces a foreign key on INSERT, not only
    // on delete, so the restore used to abort with a bare
    // "FOREIGN KEY constraint failed" and the ENTIRE backup was unrestorable
    // for any user who had ever recorded a coach learning outcome. That is a
    // total data-recovery loss, not a partial one.
    //
    // This is independent of the ON DELETE action: it reproduced identically
    // before migration 0024. The restore now defers foreign keys and rebuilds
    // the projection inside the same transaction, which is sound because an
    // observation id is a pure function of the restored ledger.
    let dir = tempdir().unwrap();

    let source = {
        let mut conn =
            open_connection(&DbOpenOptions::create(dir.path().join("source.db"))).unwrap();
        migrate(&mut conn).unwrap();
        conn
    };
    let observation_id = seed_projected_observation(&source);
    let thread = ensure_coach_thread(
        &source,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: None,
            asset_id: None,
            kind: "review".into(),
        },
    )
    .unwrap();
    let message = append_coach_message(
        &source,
        &AppendCoachMessageCommand {
            thread_id: thread.id.clone(),
            role: "assistant".into(),
            content: "strategy".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap();
    source
        .execute(
            "INSERT INTO coach_strategy_assignments_v0
               (id, user_id, coach_message_id, strategy_id, skills_addressed_json,
                memory_ids_used_json, followup_type, created_at)
             VALUES ('asg-1','local',?1,'evidence_first_v1','[]','[]','explain',
                     '2026-08-16T00:00:00Z')",
            params![message.id],
        )
        .unwrap();
    source
        .execute(
            "INSERT INTO coach_outcome_links_v0
               (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
             VALUES ('asg-1',?1,'learning','2026-08-16T00:00:00Z')",
            params![observation_id],
        )
        .unwrap();

    let package = ielts_db::create_backup_package(&source, "test").unwrap();

    let target = {
        let mut conn =
            open_connection(&DbOpenOptions::create(dir.path().join("target.db"))).unwrap();
        migrate(&mut conn).unwrap();
        conn
    };
    let report = ielts_db::import_backup(&target, &package, false).unwrap();
    assert!(
        report.ok,
        "a backup containing a coach outcome link must restore: {:?}",
        report.errors
    );

    // The link survived, and its parent came back with the same derived id.
    assert_eq!(link_count(&target), 1);
    let restored: String = target
        .query_row(
            "SELECT future_observation_id FROM coach_outcome_links_v0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(restored, observation_id);
    let parent_exists: i64 = target
        .query_row(
            "SELECT COUNT(*) FROM learner_observations WHERE id = ?1",
            params![observation_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(parent_exists, 1, "the projection was rebuilt during restore");
}
