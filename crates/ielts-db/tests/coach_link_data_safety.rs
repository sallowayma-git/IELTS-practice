//! P0 data-safety regressions for coach result links.
//!
//! 1. Deleting ONE history attempt runs the M2 projection rebuild, which used to
//!    `DELETE FROM learner_observations WHERE projector_key = ...` and then
//!    re-insert. `coach_outcome_links_v0.future_observation_id` cascades and
//!    `teaching_strategy_outcomes.observation_id` is SET NULL on that delete, so
//!    every coach link in the database was wiped even though the rebuilt
//!    observations come back with the same deterministic ids. Only links to the
//!    deleted attempt's observations may disappear.
//! 2. A backup containing coach strategy assignments with a
//!    `context_snapshot_id` could not be restored on a fresh device: the
//!    referenced `agent_context_snapshots` table was not part of the backup, so
//!    the restore aborted with "foreign key violation after restore".

use ielts_db::{
    append_coach_message, delete_attempt, ensure_coach_thread, migrate, open_connection,
    AppendCoachMessageCommand, DbOpenOptions, EnsureCoachThreadCommand,
};
use rusqlite::{params, Connection};
use tempfile::tempdir;

fn open(path: &std::path::Path) -> Connection {
    let mut conn = open_connection(&DbOpenOptions::create(path)).unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn insert_attempt(conn: &Connection, id: &str) {
    let now = "2026-08-16T00:00:00Z";
    conn.execute(
        "INSERT INTO attempts (
            id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
            completed_at, duration_ms, score_value, score_scale, correct_count,
            question_count, title_snapshot, prompt_snapshot, content_text,
            schema_version, created_at, updated_at, task_type
         ) VALUES (?1, 'writing', NULL, 'freeform', NULL, 'completed', ?2, ?2, ?2,
                   0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, ?2, ?2, 'task2')",
        params![id, now],
    )
    .unwrap();
}

/// A reading-question ledger event owned by `attempt_id`, so the projection
/// derives observations from it and history deletion cascades it away.
fn insert_question_event(conn: &Connection, event_id: &str, attempt_id: &str, asset_id: &str) {
    let payload = format!(
        r#"{{"attemptId":"{attempt_id}","assetId":"{asset_id}","questionId":"q-1","attemptOrdinal":1,"isCorrect":true,"questionKind":"mcq","changeCount":0,"visitCount":1,"elapsedMs":900,"firstTryCorrect":true}}"#
    );
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
         VALUES (?1,'local','reading_question_outcome','test',?1,?1,'reading',
                 ?2,?3,'q-1',NULL,'2026-08-16T00:00:00Z',?4,?5,1,'pending',
                 'normal','2026-08-16T00:00:00Z','2026-08-16T00:00:00Z')",
        params![event_id, asset_id, attempt_id, payload, digest],
    )
    .unwrap();
}

/// The outcome observation projected from `event_id`.
fn observation_for_event(conn: &Connection, event_id: &str) -> String {
    conn.query_row(
        "SELECT o.id FROM learner_observations o
         JOIN learner_observation_evidence e ON e.observation_id = o.id
         WHERE e.event_id = ?1 AND o.observation_type = 'reading.question.outcome'",
        params![event_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn coach_message(conn: &Connection) -> String {
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
    append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.id,
            role: "assistant".into(),
            content: "strategy".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap()
    .id
}

fn insert_coach_assignment(conn: &Connection, id: &str, message_id: &str, snapshot: Option<&str>) {
    conn.execute(
        "INSERT INTO coach_strategy_assignments_v0
           (id, user_id, coach_message_id, strategy_id, skills_addressed_json,
            memory_ids_used_json, context_snapshot_id, followup_type, created_at)
         VALUES (?1,'local',?2,'evidence_first_v1','[]','[]',?3,'explain',
                 '2026-08-16T00:00:00Z')",
        params![id, message_id, snapshot],
    )
    .unwrap();
}

fn insert_teaching_assignment(
    conn: &Connection,
    id: &str,
    message_id: &str,
    snapshot: Option<&str>,
) {
    conn.execute(
        "INSERT INTO teaching_strategy_assignments
           (id, user_id, strategy_id, why_selected_json, memory_ids_json, skill_keys_json,
            context_snapshot_id, response_message_id, created_at)
         VALUES (?1,'local','evidence_first_v1','{}','[]','[]',?2,?3,'2026-08-16T00:00:00Z')",
        params![id, snapshot, message_id],
    )
    .unwrap();
}

fn link(conn: &Connection, assignment: &str, observation: &str) {
    conn.execute(
        "INSERT INTO coach_outcome_links_v0
           (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
         VALUES (?1, ?2, 'learning', '2026-08-16T00:00:00Z')",
        params![assignment, observation],
    )
    .unwrap();
}

fn linked_observations(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT future_observation_id FROM coach_outcome_links_v0 ORDER BY 1")
        .unwrap();
    let rows = stmt.query_map([], |row| row.get(0)).unwrap();
    rows.map(Result::unwrap).collect()
}

fn strategy_outcome_observation(conn: &Connection, id: &str) -> Option<String> {
    conn.query_row(
        "SELECT observation_id FROM teaching_strategy_outcomes WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn deleting_one_attempt_keeps_coach_links_owned_by_other_attempts() {
    let dir = tempdir().unwrap();
    let conn = open(&dir.path().join("delete.db"));
    insert_attempt(&conn, "att-keep");
    insert_attempt(&conn, "att-drop");
    insert_question_event(&conn, "ev-keep", "att-keep", "asset-keep");
    insert_question_event(&conn, "ev-drop", "att-drop", "asset-drop");
    ielts_db::learning_observations_rebuild(&conn).unwrap();
    let keep_obs = observation_for_event(&conn, "ev-keep");
    let drop_obs = observation_for_event(&conn, "ev-drop");

    let message = coach_message(&conn);
    insert_coach_assignment(&conn, "asg-1", &message, None);
    link(&conn, "asg-1", &keep_obs);
    link(&conn, "asg-1", &drop_obs);

    insert_teaching_assignment(&conn, "tsa-1", &message, None);
    for (id, obs) in [("tso-keep", &keep_obs), ("tso-drop", &drop_obs)] {
        conn.execute(
            "INSERT INTO teaching_strategy_outcomes
               (id, outcome_kind, assignment_id, observation_id, novel_asset_id,
                score_delta, created_at)
             VALUES (?1,'next_novel_skill_attempt','tsa-1',?2,NULL,NULL,
                     '2026-08-16T00:00:00Z')",
            params![id, obs],
        )
        .unwrap();
    }

    assert!(delete_attempt(&conn, "att-drop").unwrap());

    // The surviving attempt's observation keeps its deterministic id ...
    assert_eq!(observation_for_event(&conn, "ev-keep"), keep_obs);
    // ... and its coach links survive the projection rebuild.
    assert_eq!(
        linked_observations(&conn),
        vec![keep_obs.clone()],
        "deleting one attempt must only remove coach links to that attempt"
    );
    assert_eq!(
        strategy_outcome_observation(&conn, "tso-keep"),
        Some(keep_obs.clone())
    );
    assert_eq!(strategy_outcome_observation(&conn, "tso-drop"), None);

    // A plain rebuild (the learning_observations_rebuild command) is also
    // non-destructive for links whose observation still exists.
    ielts_db::learning_observations_rebuild(&conn).unwrap();
    assert_eq!(linked_observations(&conn), vec![keep_obs.clone()]);
    assert_eq!(
        strategy_outcome_observation(&conn, "tso-keep"),
        Some(keep_obs)
    );
}

fn insert_context_snapshot(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO agent_context_snapshots
           (id, run_id, planner_version, scope, query_plan_json, token_budget,
            used_tokens, rendered_context, content_hash, created_at)
         VALUES (?1, NULL, 'planner.v1', 'coach', '{}', 1000, 10, 'ctx', 'hash',
                 '2026-08-16T00:00:00Z')",
        params![id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_context_items
           (snapshot_id, item_type, item_id, rank, score, estimated_tokens,
            inclusion_reason, provenance_json)
         VALUES (?1, 'memory', 'mem-1', 0, 1.0, 5, 'relevant', NULL)",
        params![id],
    )
    .unwrap();
}

fn snapshot_ref(conn: &Connection, table: &str, id: &str) -> Option<String> {
    conn.query_row(
        &format!("SELECT context_snapshot_id FROM {table} WHERE id = ?1"),
        params![id],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn backup_with_context_snapshot_references_restores_on_a_fresh_device() {
    let dir = tempdir().unwrap();
    let source = open(&dir.path().join("source.db"));
    insert_context_snapshot(&source, "ctx-1");
    let message = coach_message(&source);
    insert_coach_assignment(&source, "asg-1", &message, Some("ctx-1"));
    insert_teaching_assignment(&source, "tsa-1", &message, Some("ctx-1"));

    let package = ielts_db::create_backup_package(&source, "test").unwrap();

    let target = open(&dir.path().join("target.db"));
    let report = ielts_db::import_backup(&target, &package, false).unwrap();
    assert!(
        report.ok,
        "a backup with recent coach records must restore on a fresh device: {:?}",
        report.errors
    );

    // The coach records and their context provenance both survive.
    assert_eq!(
        snapshot_ref(&target, "coach_strategy_assignments_v0", "asg-1").as_deref(),
        Some("ctx-1")
    );
    assert_eq!(
        snapshot_ref(&target, "teaching_strategy_assignments", "tsa-1").as_deref(),
        Some("ctx-1")
    );
    let items: i64 = target
        .query_row(
            "SELECT COUNT(*) FROM agent_context_items WHERE snapshot_id = 'ctx-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(items, 1);
}

#[test]
fn older_backup_without_context_snapshots_still_restores() {
    // Format 18 packages predate the snapshot tables. Their dangling
    // context_snapshot_id values must be resolved with the column's declared
    // ON DELETE SET NULL action instead of aborting the whole restore.
    let dir = tempdir().unwrap();
    let source = open(&dir.path().join("source.db"));
    insert_context_snapshot(&source, "ctx-1");
    let message = coach_message(&source);
    insert_coach_assignment(&source, "asg-1", &message, Some("ctx-1"));
    insert_teaching_assignment(&source, "tsa-1", &message, Some("ctx-1"));

    let mut package = ielts_db::create_backup_package(&source, "test").unwrap();
    package
        .database
        .retain(|table| !table.name.starts_with("agent_context_"));
    package.manifest.schema_version = 18;
    package.manifest.table_count = package.database.len() as u32;
    package.manifest.row_count = package
        .database
        .iter()
        .map(|table| table.rows.len() as u64)
        .sum::<u64>()
        + package.secret_refs.len() as u64;
    package.manifest.checksum_sha256.clear();
    package.manifest.checksum_sha256 = {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(serde_json::to_vec(&package).unwrap()))
    };

    // A non-empty target: its own later snapshots must not survive a restore
    // that replaces the user's data.
    let target = open(&dir.path().join("target.db"));
    insert_context_snapshot(&target, "ctx-target-only");
    let report = ielts_db::import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "format 18 backup must restore: {:?}", report.errors);
    let snapshots: i64 = target
        .query_row("SELECT COUNT(*) FROM agent_context_snapshots", [], |row| row.get(0))
        .unwrap();
    assert_eq!(snapshots, 0);
    assert_eq!(
        snapshot_ref(&target, "coach_strategy_assignments_v0", "asg-1"),
        None
    );
    assert_eq!(
        snapshot_ref(&target, "teaching_strategy_assignments", "tsa-1"),
        None
    );
}
