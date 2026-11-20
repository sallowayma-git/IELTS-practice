//! Writing coach context is host-resolved from the attempt and its persisted
//! evaluation. The selector decides the scene; it never supplies evidence.

use ielts_db::*;
use ielts_domain::Activity;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

const ESSAY: &str = "Some people argue that remote work improves productivity because it removes commuting. Others believe offices remain essential for collaboration. In my view the balance depends on the task, and employers should let teams choose.";

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn =
        open_connection(&DbOpenOptions::create(dir.path().join("writing-coach.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn insert_asset(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, schema_version, fingerprint,
            created_at, updated_at
         ) VALUES (?1, 'writing', 'freeform', NULL, 'Writing response', 2, ?1,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        params![id],
    )
    .unwrap();
}

fn insert_attempt(conn: &Connection, id: &str, asset_id: Option<&str>) {
    conn.execute(
        "INSERT INTO attempts (
            id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
            completed_at, duration_ms, score_value, score_scale, title_snapshot,
            prompt_snapshot, content_text, task_type, schema_version, created_at, updated_at
         ) VALUES (?1, 'writing', ?2, 'freeform', NULL, 'completed',
            '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', '2026-01-01T00:10:00Z',
            600000, 6.5, 'band9', 'Writing response',
            'Discuss both views and give your opinion.', ?3, 'task2', 1,
            '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z')",
        params![id, asset_id, ESSAY],
    )
    .unwrap();
}

fn insert_reading_attempt(conn: &Connection, id: &str) {
    conn.execute(
        "INSERT INTO attempts (
            id, activity, asset_id, mode, suite_id, status, started_at, submitted_at,
            completed_at, duration_ms, score_value, score_scale, schema_version,
            created_at, updated_at
         ) VALUES (?1, 'reading', NULL, 'single', NULL, 'completed',
            '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z', '2026-01-01T00:05:00Z',
            300000, 1.0, 'ratio', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:05:00Z')",
        params![id],
    )
    .unwrap();
}

fn evaluation_value(status: &str, with_score: bool) -> Value {
    let mut value = json!({
        "schemaVersion": 4,
        "status": status,
        "stage": "finalizing",
        "taskType": "task2",
        "feedback": {
            "overall": "A clear position throughout.",
            "sentences": (0..14)
                .map(|index| json!({"sentence": format!("sentence {index}")}))
                .collect::<Vec<_>>(),
        },
    });
    if with_score {
        value["score"] = json!({
            "overall": 6.5, "taskResponse": 6.0, "coherence": 7.0,
            "lexical": 6.5, "grammar": 6.0,
        });
    }
    value
}

fn insert_evaluation(
    conn: &Connection,
    id: &str,
    attempt_id: &str,
    status: &str,
    with_score: bool,
) {
    conn.execute(
        "INSERT INTO writing_evaluations (
            id, attempt_id, status, stage, rubric_version, prompt_version, result_json,
            started_at, completed_at, updated_at
         ) VALUES (?1, ?2, ?3, 'finalizing', 'v1', 'v1', ?4,
            '2026-01-01T00:11:00Z', '2026-01-01T00:12:00Z', '2026-01-01T00:12:00Z')",
        params![
            id,
            attempt_id,
            status,
            evaluation_value(status, with_score).to_string()
        ],
    )
    .unwrap();
}

fn insert_thread(
    conn: &Connection,
    id: &str,
    attempt_id: &str,
    asset_id: Option<&str>,
) -> CoachThread {
    ensure_coach_thread(
        conn,
        &EnsureCoachThreadCommand {
            thread_id: Some(id.into()),
            attempt_id: Some(attempt_id.into()),
            asset_id: asset_id.map(str::to_string),
            kind: "review".into(),
        },
    )
    .unwrap()
}

fn fixture() -> (tempfile::TempDir, Connection, CoachThread) {
    let (dir, conn) = open_db();
    insert_attempt(&conn, "writing-attempt", None);
    insert_evaluation(&conn, "evaluation-1", "writing-attempt", "completed", true);
    let thread = insert_thread(&conn, "writing-thread", "writing-attempt", None);
    (dir, conn, thread)
}

fn fixture_without_evaluation() -> (tempfile::TempDir, Connection, CoachThread) {
    let (dir, conn) = open_db();
    insert_attempt(&conn, "writing-attempt", None);
    let thread = insert_thread(&conn, "writing-thread", "writing-attempt", None);
    (dir, conn, thread)
}

fn expect_invalid(conn: &Connection, thread_id: &str, selector: Value, needle: &str) {
    let error = resolve_coach_context(conn, thread_id, Some(&selector))
        .unwrap_err()
        .to_string();
    assert!(error.contains(needle), "expected {needle:?} in {error:?}");
}

#[test]
fn completed_writing_attempt_resolves_host_evidence() {
    let (_dir, conn, thread) = fixture();
    let resolved = resolve_coach_context(
        &conn,
        &thread.id,
        Some(&json!({"activity": "writing", "mode": "review"})),
    )
    .unwrap();

    assert_eq!(resolved.activity, Activity::Writing);
    let evidence = &resolved.evidence;
    assert_eq!(evidence["identity"]["attemptId"], "writing-attempt");
    assert_eq!(evidence["identity"]["activity"], "writing");
    assert_eq!(evidence["identity"]["taskType"], "task2");
    assert_eq!(evidence["identity"]["mode"], "freeform");
    assert_eq!(evidence["identity"]["assetId"], Value::Null);
    assert_eq!(evidence["identity"]["sessionOwnerId"], Value::Null);
    assert_eq!(evidence["source"]["title"], "Writing response");
    assert_eq!(
        evidence["source"]["prompt"],
        "Discuss both views and give your opinion."
    );
    assert_eq!(evidence["source"]["essay"], ESSAY);
    assert_eq!(evidence["source"]["taskType"], "task2");
    let score = &evidence["result"]["score"];
    assert_eq!(score["overall"], 6.5);
    assert_eq!(score["taskResponse"], 6.0);
    assert_eq!(score["coherence"], 7.0);
    assert_eq!(score["lexical"], 6.5);
    assert_eq!(score["grammar"], 6.0);
    assert_eq!(
        evidence["result"]["feedback"]["overall"],
        "A clear position throughout."
    );
    assert_eq!(
        evidence["result"]["feedback"]["sentences"]
            .as_array()
            .unwrap()
            .len(),
        12
    );
    assert_eq!(evidence["evidenceLimitations"], json!([]));

    assert_eq!(resolved.message_metadata["activity"], "writing");
    assert_eq!(resolved.message_metadata["sessionId"], "writing-attempt");
    assert_eq!(resolved.message_metadata["mode"], "freeform");
    assert_eq!(resolved.message_metadata["assetId"], Value::Null);

    // Reading-only evidence must never leak into a writing scene.
    assert!(evidence.get("questionGroups").is_none());
    assert!(evidence["result"].get("answers").is_none());
    assert!(!evidence.to_string().contains("questionGroups"));
    assert!(!evidence.to_string().contains("answerKey"));
}

#[test]
fn selection_quotes_are_bounded_user_requests() {
    let (_dir, conn, thread) = fixture();
    let resolved = resolve_coach_context(
        &conn,
        &thread.id,
        Some(&json!({
            "activity": "writing",
            "selectedText": "a quoted sentence",
            "selectedContext": {"text": "shadowed text", "paragraphLabels": ["P1"]},
        })),
    )
    .unwrap();
    assert_eq!(resolved.request["selectionQuote"], "a quoted sentence");
    assert_eq!(resolved.request["selectionIsEvidence"], false);
    assert!(resolved.request.get("selectionParagraphs").is_none());

    let fallback = resolve_coach_context(
        &conn,
        &thread.id,
        Some(&json!({
            "activity": "writing",
            "selectedContext": {"text": "context quote"}
        })),
    )
    .unwrap();
    assert_eq!(fallback.request["selectionQuote"], "context quote");

    let error = resolve_coach_context(
        &conn,
        &thread.id,
        Some(&json!({"activity": "writing", "selectedText": "x".repeat(501)})),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("selection quote exceeds 500 characters"));
}

#[test]
fn non_completed_attempts_are_rejected() {
    for status in ["draft", "submitted"] {
        let (_dir, conn, thread) = fixture();
        conn.execute(
            "UPDATE attempts SET status=?1 WHERE id='writing-attempt'",
            params![status],
        )
        .unwrap();
        expect_invalid(
            &conn,
            &thread.id,
            json!({"activity": "writing"}),
            "writing coach requires a completed writing attempt",
        );
    }
}

#[test]
fn evaluation_must_be_completed_with_band_scores() {
    let (_dir, conn, thread) = fixture_without_evaluation();
    expect_invalid(
        &conn,
        &thread.id,
        json!({"activity": "writing"}),
        "writing coach requires a completed evaluation with band scores",
    );

    let (_dir, conn, thread) = fixture_without_evaluation();
    insert_evaluation(
        &conn,
        "evaluation-no-score",
        "writing-attempt",
        "completed",
        false,
    );
    expect_invalid(
        &conn,
        &thread.id,
        json!({"activity": "writing"}),
        "writing coach requires a completed evaluation with band scores",
    );

    let (_dir, conn, thread) = fixture_without_evaluation();
    insert_evaluation(
        &conn,
        "evaluation-failed",
        "writing-attempt",
        "failed",
        true,
    );
    expect_invalid(
        &conn,
        &thread.id,
        json!({"activity": "writing"}),
        "writing coach requires a completed evaluation with band scores",
    );
}

#[test]
fn blank_essay_is_rejected() {
    let (_dir, conn, thread) = fixture();
    for essay in [None, Some(""), Some("  \n\t ")] {
        conn.execute(
            "UPDATE attempts SET content_text=?1 WHERE id='writing-attempt'",
            params![essay],
        )
        .unwrap();
        expect_invalid(
            &conn,
            &thread.id,
            json!({"activity": "writing"}),
            "writing attempt has no retained essay text",
        );
    }
}

#[test]
fn selector_identity_conflicts_are_rejected() {
    let (_dir, conn, thread) = fixture();
    for selector in [
        json!({"activity": "writing", "sessionId": "other-attempt"}),
        json!({"activity": "writing", "assetId": "some-asset"}),
        json!({"activity": "writing", "mode": "single"}),
    ] {
        expect_invalid(&conn, &thread.id, selector, "conflicts with bound attempt");
    }
}

#[test]
fn asset_bound_attempt_matches_its_asset_and_rejects_others() {
    let (_dir, conn) = open_db();
    insert_asset(&conn, "asset-a");
    insert_asset(&conn, "asset-b");
    insert_attempt(&conn, "asset-attempt", Some("asset-a"));
    insert_evaluation(
        &conn,
        "asset-evaluation",
        "asset-attempt",
        "completed",
        true,
    );
    let thread = insert_thread(&conn, "asset-thread", "asset-attempt", Some("asset-a"));

    let resolved = resolve_coach_context(
        &conn,
        &thread.id,
        Some(&json!({"activity": "writing", "assetId": "asset-a"})),
    )
    .unwrap();
    assert_eq!(resolved.evidence["identity"]["assetId"], "asset-a");
    assert_eq!(resolved.message_metadata["assetId"], "asset-a");

    expect_invalid(
        &conn,
        &thread.id,
        json!({"activity": "writing", "assetId": "asset-b"}),
        "request identity conflicts with bound attempt",
    );

    conn.execute(
        "UPDATE coach_threads SET asset_id='asset-b' WHERE id=?1",
        params![thread.id],
    )
    .unwrap();
    expect_invalid(
        &conn,
        &thread.id,
        json!({"activity": "writing"}),
        "thread asset conflicts with its bound attempt",
    );
}

#[test]
fn writing_thread_never_falls_back_to_the_reading_scene() {
    let (_dir, conn, thread) = fixture();
    for selector in [
        None,
        Some(json!({"activity": "reading"})),
        Some(json!({"activity": ""})),
    ] {
        let error = resolve_coach_context(&conn, &thread.id, selector.as_ref())
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("reading review requires a completed reading attempt"),
            "expected the reading gate, got {error:?}"
        );
    }

    // The reverse direction: an explicit writing selector must not replay a
    // reading thread through the writing path.
    insert_reading_attempt(&conn, "reading-attempt");
    let reading_thread = insert_thread(&conn, "reading-thread", "reading-attempt", None);
    expect_invalid(
        &conn,
        &reading_thread.id,
        json!({"activity": "writing"}),
        "writing coach requires a completed writing attempt",
    );
}

#[test]
fn the_writing_coach_scene_has_its_four_criterion_skills() {
    let (_dir, conn) = open_db();
    let keys: Vec<String> = conn
        .prepare(
            "SELECT skill_key FROM skill_catalog
             WHERE activity='writing' AND active=1 ORDER BY skill_key",
        )
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        keys,
        vec![
            "writing.coherence",
            "writing.grammar",
            "writing.lexical",
            "writing.taskResponse",
        ]
    );
}

#[test]
fn degraded_evaluation_keeps_scores_and_records_the_limitation() {
    let (_dir, conn, thread) = fixture();
    conn.execute(
        "UPDATE writing_evaluations SET status='degraded', result_json=?1 WHERE id='evaluation-1'",
        params![evaluation_value("degraded", true).to_string()],
    )
    .unwrap();
    let resolved =
        resolve_coach_context(&conn, &thread.id, Some(&json!({"activity": "writing"}))).unwrap();
    assert_eq!(
        resolved.evidence["evidenceLimitations"],
        json!([{
            "code": "evaluation_degraded",
            "message": "The evaluation was degraded; use only the persisted scores and essay."
        }])
    );
    assert_eq!(resolved.evidence["result"]["score"]["overall"], 6.5);
}
