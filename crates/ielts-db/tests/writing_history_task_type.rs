//! Writing task type is an attempt fact, not a frontend display default.

use ielts_db::{
    list_history, migrate, open_connection, save_writing_draft, start_evaluation,
    submit_writing_attempt, DbOpenOptions, DeterministicProvider, StartEvaluationCommand,
};
use ielts_domain::domain::{Activity, AttemptMode, WritingTaskType};
use ielts_domain::dto::{ListHistoryQuery, SaveDraftCommand, SubmitAttemptCommand};
use tempfile::tempdir;

fn open_current() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("history.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn list_query(task_type: Option<WritingTaskType>) -> ListHistoryQuery {
    ListHistoryQuery {
        activity: Some(Activity::Writing),
        limit: 50,
        offset: 0,
        cursor: None,
        search: None,
        start_date: None,
        end_date: None,
        min_score: None,
        max_score: None,
        score_scale: None,
        task_type,
    }
}

fn draft_command(id: &str, task_type: WritingTaskType, key: &str) -> SaveDraftCommand {
    SaveDraftCommand {
        attempt_id: id.into(),
        activity: Activity::Writing,
        mode: AttemptMode::Freeform,
        asset_id: None,
        content_text: Some("A complete essay body with enough words to submit.".into()),
        prompt_snapshot: Some("Discuss both views and give your opinion.".into()),
        task_type: Some(task_type),
        idempotency_key: key.into(),
    }
}

#[test]
fn writing_task_type_is_persisted_projected_and_filterable() {
    let (_dir, conn) = open_current();

    save_writing_draft(
        &conn,
        &draft_command("attempt-task", WritingTaskType::Task1, "draft-task-1"),
    )
    .unwrap();
    // The same open draft can change task before submission; the canonical
    // attempt column must update with it rather than retaining a stale type.
    save_writing_draft(
        &conn,
        &draft_command("attempt-task", WritingTaskType::Task2, "draft-task-2"),
    )
    .unwrap();
    submit_writing_attempt(
        &conn,
        &SubmitAttemptCommand {
            attempt_id: "attempt-task".into(),
            idempotency_key: "submit-task".into(),
        },
    )
    .unwrap();

    let stored: String = conn
        .query_row(
            "SELECT task_type FROM attempts WHERE id = 'attempt-task'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "task2");

    let submitted = list_history(&conn, &list_query(Some(WritingTaskType::Task2))).unwrap();
    assert!(submitted.items.is_empty());

    start_evaluation(
        &conn,
        &StartEvaluationCommand {
            attempt_id: "attempt-task".into(),
            idempotency_key: "evaluate-task".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        &DeterministicProvider,
    )
    .unwrap();

    let task1 = list_history(&conn, &list_query(Some(WritingTaskType::Task1))).unwrap();
    assert!(task1.items.is_empty());

    let task2 = list_history(&conn, &list_query(Some(WritingTaskType::Task2))).unwrap();
    assert_eq!(task2.total, 1);
    assert_eq!(task2.items[0].task_type, Some(WritingTaskType::Task2));
}

#[test]
fn v7_backfill_requires_consensus_and_leaves_ambiguous_history_unlabelled() {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v6.db"))).unwrap();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .unwrap();
    for (version, name, sql) in [
        (1, "v2_core", include_str!("../migrations/0001_v2_core.sql")),
        (
            2,
            "writing_eval_sessions",
            include_str!("../migrations/0002_writing_eval_sessions.sql"),
        ),
        (
            3,
            "eval_lineage_multi",
            include_str!("../migrations/0003_eval_lineage_multi.sql"),
        ),
        (
            4,
            "modes_timer",
            include_str!("../migrations/0004_modes_timer.sql"),
        ),
        (
            5,
            "annotations_vocab_coach",
            include_str!("../migrations/0005_annotations_vocab_coach.sql"),
        ),
        (
            6,
            "writing_topics",
            include_str!("../migrations/0006_writing_topics.sql"),
        ),
    ] {
        conn.execute_batch(sql).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![version, name, "2026-01-01T00:00:00Z"],
        )
        .unwrap();
    }

    conn.execute_batch(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, schema_version, fingerprint, created_at, updated_at
          ) VALUES
            ('topic-task1', 'writing', 'imported', NULL, 'Task 1 topic', 2, 'topic-task1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
            ('topic-conflict', 'writing', 'imported', NULL, 'Conflicting topic', 2, 'topic-conflict', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

         INSERT INTO writing_topics (asset_id, task_type, title_json, is_official, created_at, updated_at)
         VALUES
            ('topic-task1', 'task1', '{}', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
            ('topic-conflict', 'task1', '{}', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

         INSERT INTO attempts (
            id, activity, asset_id, mode, status, started_at, submitted_at, completed_at,
            duration_ms, score_value, score_scale, schema_version, created_at, updated_at, prompt_snapshot
          ) VALUES
            ('from-topic', 'writing', 'topic-task1', 'bank', 'completed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, 6.0, 'band9', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL),
            ('from-draft', 'writing', NULL, 'freeform', 'completed', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 0, 6.0, 'band9', 1, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', NULL),
            ('from-evaluation', 'writing', NULL, 'freeform', 'completed', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', 0, 6.0, 'band9', 1, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', NULL),
            ('from-metadata', 'writing', NULL, 'freeform', 'completed', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z', 0, 6.0, 'band9', 1, '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z', '{\"task_type\":\"task2\"}'),
            ('conflict', 'writing', 'topic-conflict', 'bank', 'completed', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', 0, 6.0, 'band9', 1, '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z', NULL),
            ('unknown', 'writing', NULL, 'freeform', 'completed', '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z', 0, 6.0, 'band9', 1, '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z', NULL);

         INSERT INTO writing_drafts (attempt_id, content_text, task_type, word_count, updated_at)
         VALUES
            ('from-draft', 'body', 'task2', 1, '2026-01-02T00:00:00Z'),
            ('conflict', 'body', 'task2', 1, '2026-01-05T00:00:00Z');

         INSERT INTO writing_evaluations (
            id, attempt_id, status, stage, rubric_version, prompt_version, result_json, updated_at
         ) VALUES (
            'evaluation-task1', 'from-evaluation', 'completed', 'finalizing', 'v1', 'v1',
            '{\"taskType\":\"task1\"}', '2026-01-03T00:00:00Z'
         );",
    )
    .unwrap();

    migrate(&mut conn).unwrap();

    let rows: Vec<(String, Option<String>)> = {
        let mut statement = conn
            .prepare("SELECT id, task_type FROM attempts ORDER BY id")
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    assert_eq!(
        rows,
        vec![
            ("conflict".into(), None),
            ("from-draft".into(), Some("task2".into())),
            ("from-evaluation".into(), Some("task1".into())),
            ("from-metadata".into(), Some("task2".into())),
            ("from-topic".into(), Some("task1".into())),
            ("unknown".into(), None),
        ]
    );

    let task1 = list_history(&conn, &list_query(Some(WritingTaskType::Task1))).unwrap();
    assert_eq!(task1.total, 2);
    assert!(task1
        .items
        .iter()
        .all(|item| item.task_type == Some(WritingTaskType::Task1)));

    let all = list_history(&conn, &list_query(None)).unwrap();
    assert_eq!(all.total, 6);
    assert!(all
        .items
        .iter()
        .any(|item| item.id == "unknown" && item.task_type.is_none()));
}
