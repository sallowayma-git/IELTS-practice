use std::collections::BTreeSet;

use ielts_db::{
    current_version, import_asset_payload_file, learner_model_rebuild, learner_model_verify,
    learning_observations_rebuild, migrate, open_connection, submit_reading_attempt,
    verify_idempotent, DbOpenOptions, ReadingSubmitCommand,
};
use ielts_domain::{LearnerStateQuery, SkillReviewNeedsQuery};
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

#[test]
fn v11_database_upgrade_applies_m4_after_m3_without_skipping_versions() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE schema_migrations (
           version INTEGER PRIMARY KEY NOT NULL,
           name TEXT NOT NULL,
           applied_at TEXT NOT NULL
         );",
    )
    .unwrap();
    for (version, name, sql) in legacy_migrations_through_v11() {
        conn.execute_batch(sql).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations(version, name, applied_at)
             VALUES (?1, ?2, '2026-08-12T00:00:00Z')",
            params![version, name],
        )
        .unwrap();
    }

    let applied = migrate(&mut conn).unwrap();
    assert_eq!(
        applied,
        vec![12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]
    );
    assert!(
        current_version(&conn).unwrap() == 31,
        "latest migration 0031 was not applied"
    );
    verify_idempotent(&mut conn).unwrap();
    for table in [
        "skill_catalog",
        "question_skill_map",
        "learner_skill_observations",
        "learner_skill_state",
        "skill_review_schedule",
    ] {
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "missing upgraded table {table}");
    }
}

fn legacy_migrations_through_v11() -> [(i64, &'static str, &'static str); 11] {
    [
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
        (
            7,
            "attempt_writing_task_type",
            include_str!("../migrations/0007_attempt_writing_task_type.sql"),
        ),
        (
            8,
            "history_retention_policy",
            include_str!("../migrations/0008_history_retention_policy.sql"),
        ),
        (
            9,
            "writing_prompt_policy",
            include_str!("../migrations/0009_writing_prompt_policy.sql"),
        ),
        (
            10,
            "reading_timer_states",
            include_str!("../migrations/0010_reading_timer_states.sql"),
        ),
        (
            11,
            "agent_runs_tool_calls",
            include_str!("../migrations/0011_agent_runs_tool_calls.sql"),
        ),
    ]
}

#[test]
fn rebuild_is_replayable_and_explains_transfer_need() {
    let (_dir, conn) = open_db();
    insert_question(
        &conn,
        "event-a-1",
        "asset-a",
        "q-a-1",
        "mcq",
        "2026-08-12T00:00:00Z",
        false,
        None,
    );
    insert_question(
        &conn,
        "event-a-2",
        "asset-a",
        "q-a-2",
        "multi_choice",
        "2026-08-12T01:00:00Z",
        true,
        None,
    );
    insert_question(
        &conn,
        "event-b-1",
        "asset-b",
        "q-b-1",
        "multi_choice",
        "2026-08-13T00:00:00Z",
        false,
        Some(("coach-1", "coach_micro_drill")),
    );
    insert_question(
        &conn,
        "event-b-2",
        "asset-b",
        "q-b-2",
        "multi_choice",
        "2026-08-13T01:00:00Z",
        true,
        None,
    );
    insert_question(
        &conn,
        "event-tfng",
        "asset-c",
        "q-tfng",
        "tfng",
        "2026-08-13T02:00:00Z",
        false,
        None,
    );

    learning_observations_rebuild(&conn).unwrap();
    let first = learner_model_rebuild(&conn).unwrap();
    assert_eq!(first.input_count, 5);
    assert_eq!(first.observation_count, 5);
    assert_eq!(first.state_count, 2);
    assert_eq!(first.schedule_count, 2);

    let multi_choice_weights = observation_weights(&conn, "reading.multi_choice");
    assert_eq!(multi_choice_weights.len(), 4);
    assert!(multi_choice_weights[0].0 > multi_choice_weights[1].0);
    assert!(multi_choice_weights[2].0 > multi_choice_weights[3].0);
    assert!(observation_has_intervention(&conn, "event-b-1", "coach-1"));

    let states = ielts_db::learner_state_snapshot(&conn, &LearnerStateQuery::default()).unwrap();
    assert_eq!(states.state_hash, first.state_hash);
    let multi_choice = states
        .states
        .iter()
        .find(|state| state.skill_key == "reading.multi_choice")
        .unwrap();
    assert_eq!(multi_choice.evidence_count, 4);
    assert_eq!(multi_choice.distinct_asset_count, 2);
    assert_eq!(
        multi_choice.uncertainty_band,
        ielts_domain::UncertaintyBand::Medium
    );

    let needs =
        ielts_db::skill_review_needs_snapshot(&conn, &SkillReviewNeedsQuery::default()).unwrap();
    let multi_need = needs
        .needs
        .iter()
        .find(|need| need.skill_key == "reading.multi_choice")
        .unwrap();
    assert!(multi_need
        .avoid_asset_ids
        .iter()
        .any(|asset| asset == "asset-b"));
    let tfng_need = needs
        .needs
        .iter()
        .find(|need| need.skill_key == "reading.tfng")
        .unwrap();
    assert!(tfng_need
        .reason_codes
        .iter()
        .any(|reason| reason == "needs_new_asset_transfer"));
    assert_eq!(
        tfng_need.preferred_probe,
        ielts_domain::SkillReviewProbe::NovelItem
    );

    let observation_ids_before = observation_ids(&conn);
    let second = learner_model_rebuild(&conn).unwrap();
    assert_eq!(first.input_hash, second.input_hash);
    assert_eq!(first.state_hash, second.state_hash);
    assert_eq!(observation_ids_before, observation_ids(&conn));
    assert!(learner_model_verify(&conn).unwrap().consistent);
}

#[test]
fn mapping_version_and_skill_deactivation_are_replayed_without_orphans() {
    let (_dir, conn) = open_db();
    insert_question(
        &conn,
        "event-versioned",
        "asset-versioned",
        "q-versioned",
        "multi_choice",
        "2026-08-12T00:00:00Z",
        false,
        None,
    );
    learning_observations_rebuild(&conn).unwrap();
    let first = learner_model_rebuild(&conn).unwrap();
    let first_observation_id: String = conn
        .query_row(
            "SELECT id FROM learner_skill_observations WHERE event_id = 'event-versioned'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    conn.execute(
        "UPDATE question_skill_map
         SET mapping_version = 2
         WHERE asset_id = 'asset-versioned' AND question_id = 'q-versioned'",
        [],
    )
    .unwrap();
    let second = learner_model_rebuild(&conn).unwrap();
    let second_observation_id: String = conn
        .query_row(
            "SELECT id FROM learner_skill_observations WHERE event_id = 'event-versioned'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(first_observation_id, second_observation_id);
    assert_ne!(first.state_hash, second.state_hash);

    conn.execute(
        "UPDATE skill_catalog SET active = 0 WHERE skill_key = 'reading.multi_choice'",
        [],
    )
    .unwrap();
    let deactivated = learner_model_rebuild(&conn).unwrap();
    assert_eq!(deactivated.observation_count, 0);
    assert_eq!(deactivated.state_count, 0);
    assert_eq!(deactivated.schedule_count, 0);
    let orphan_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learner_skill_observations o
             LEFT JOIN skill_catalog s ON s.skill_key = o.skill_key
             WHERE s.skill_key IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(orphan_count, 0);

    conn.execute(
        "UPDATE skill_catalog SET active = 1 WHERE skill_key = 'reading.multi_choice'",
        [],
    )
    .unwrap();
    let recovered = learner_model_rebuild(&conn).unwrap();
    assert_eq!(recovered.observation_count, 1);
    assert_eq!(recovered.state_count, 1);
    assert_eq!(recovered.schedule_count, 1);
}

#[test]
fn corrected_and_still_wrong_transitions_remain_explainable_in_skill_state() {
    let (_dir, conn) = open_db();
    insert_question(
        &conn,
        "corrected-a",
        "asset-transitions",
        "q-corrected",
        "tfng",
        "2026-08-12T00:00:00Z",
        false,
        None,
    );
    insert_question(
        &conn,
        "corrected-b",
        "asset-transitions",
        "q-corrected",
        "tfng",
        "2026-08-12T01:00:00Z",
        true,
        None,
    );
    insert_question(
        &conn,
        "still-wrong-a",
        "asset-transitions",
        "q-still-wrong",
        "tfng",
        "2026-08-12T02:00:00Z",
        false,
        None,
    );
    insert_question(
        &conn,
        "still-wrong-b",
        "asset-transitions",
        "q-still-wrong",
        "tfng",
        "2026-08-12T03:00:00Z",
        false,
        None,
    );

    learning_observations_rebuild(&conn).unwrap();
    let repeat_types = repeat_transitions(&conn);
    assert_eq!(
        repeat_types,
        BTreeSet::from(["corrected".to_string(), "still_wrong".to_string()])
    );

    learner_model_rebuild(&conn).unwrap();
    let state = ielts_db::learner_state_snapshot(
        &conn,
        &LearnerStateQuery {
            skill_keys: vec!["reading.tfng".into()],
            ..LearnerStateQuery::default()
        },
    )
    .unwrap()
    .states
    .pop()
    .unwrap();
    let transitions = state.explanation["repeatTransitions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(transitions, BTreeSet::from(["corrected", "still_wrong"]));
}

#[test]
fn mapping_priority_uses_curated_question_mapping_before_deterministic_kind() {
    let (_dir, conn) = open_db();
    insert_question(
        &conn,
        "event-curated",
        "asset-curated",
        "q-curated",
        "multi_choice",
        "2026-08-12T00:00:00Z",
        true,
        None,
    );
    conn.execute(
        "INSERT INTO question_skill_map
         (asset_id, question_id, skill_key, weight, mapping_source, mapping_version, active)
         VALUES ('asset-curated', 'q-curated', 'reading.matching_headings', 0.8, 'content_pack', 7, 1)",
        [],
    )
    .unwrap();

    learning_observations_rebuild(&conn).unwrap();
    learner_model_rebuild(&conn).unwrap();

    let mapping: (String, f64) = conn
        .query_row(
            "SELECT skill_key, mapping_weight
             FROM learner_skill_observations
             WHERE event_id = 'event-curated'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(mapping.0, "reading.matching_headings");
    assert!((mapping.1 - 0.8).abs() < f64::EPSILON);
}

fn insert_question(
    conn: &Connection,
    event_id: &str,
    asset_id: &str,
    question_id: &str,
    question_kind: &str,
    occurred_at: &str,
    is_correct: bool,
    intervention: Option<(&str, &str)>,
) {
    let payload = json!({
        "attemptId": format!("attempt-{event_id}"),
        "assetId": asset_id,
        "questionId": question_id,
        "attemptOrdinal": 1,
        "isCorrect": is_correct,
        "questionKind": question_kind,
        "changeCount": 0,
        "visitCount": 1,
        "elapsedMs": 900,
        "firstTryCorrect": is_correct,
        "interventionId": intervention.map(|value| value.0),
        "interventionType": intervention.map(|value| value.1),
    })
    .to_string();
    conn.execute(
        "INSERT INTO learning_events
         (id, user_id, event_type, source_kind, source_id, idempotency_key, activity, asset_id,
          attempt_id, question_id, skill_key, occurred_at, payload_json, content_hash,
          schema_version, consolidation_state, sensitivity, created_at, updated_at)
         VALUES (?1, 'local', 'reading_question_outcome', 'test', ?1, ?1, 'reading', ?2,
                 NULL, ?3, NULL, ?4, ?5, ?6, 1, 'pending', 'normal', ?4, ?4)",
        params![
            event_id,
            asset_id,
            question_id,
            occurred_at,
            payload,
            sha256_hex(&payload),
        ],
    )
    .unwrap();
}

fn observation_weights(conn: &Connection, skill_key: &str) -> Vec<(f64, f64)> {
    let mut statement = conn
        .prepare(
            "SELECT novelty_weight, familiarity_weight
             FROM learner_skill_observations
             WHERE skill_key = ?1
             ORDER BY observed_at, id",
        )
        .unwrap();
    statement
        .query_map(params![skill_key], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

fn observation_has_intervention(conn: &Connection, event_id: &str, intervention_id: &str) -> bool {
    conn.query_row(
        "SELECT intervention_id FROM learner_skill_observations WHERE event_id = ?1",
        params![event_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .unwrap()
    .as_deref()
        == Some(intervention_id)
}

fn repeat_transitions(conn: &Connection) -> BTreeSet<String> {
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT value_text
             FROM learner_observations
             WHERE observation_type LIKE 'reading.repeat.%'",
        )
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<BTreeSet<String>, _>>()
        .unwrap()
}

fn observation_ids(conn: &Connection) -> BTreeSet<String> {
    let mut statement = conn
        .prepare("SELECT id FROM learner_skill_observations ORDER BY id")
        .unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<BTreeSet<String>, _>>()
        .unwrap()
}

fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn submit_fixture(dir: &std::path::Path, conn: &Connection, ordinal: u32) {
    let path = dir.join("freshness-asset.json");
    std::fs::write(
        &path,
        serde_json::to_vec(&json!({
            "examId": "freshness-asset", "meta": {"title": "Freshness", "category": "P1"},
            "questionCount": 2, "questionOrder": ["q1", "q2"],
            "answerKey": {"q1": "TRUE", "q2": "B"},
            "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]},
                               {"kind": "mcq", "questionIds": ["q2"]}]
        }))
        .unwrap(),
    )
    .unwrap();
    let asset = import_asset_payload_file(conn, &path).unwrap();
    submit_reading_attempt(
        conn,
        &ReadingSubmitCommand {
            attempt_id: format!("freshness-attempt-{ordinal}"),
            asset_id: "freshness-asset".into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint),
            answers: if ordinal == 1 {
                json!({"q1":"FALSE", "q2":"B"})
            } else {
                json!({"q1":"TRUE", "q2":"A"})
            },
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(900),
            title_snapshot: Some("Freshness".into()),
            idempotency_key: format!("freshness-submit-{ordinal}"),
        },
    )
    .unwrap();
}

fn state(conn: &Connection) -> ielts_domain::LearnerStateSnapshot {
    ielts_db::learner_state_snapshot(conn, &LearnerStateQuery::default()).unwrap()
}

#[test]
fn real_submit_refreshes_each_read_entry_without_manual_rebuild_or_hot_writes() {
    for entry in ["state", "needs", "combined"] {
        let (dir, conn) = open_db();
        submit_fixture(dir.path(), &conn, 1);
        match entry {
            "state" => assert_eq!(state(&conn).states.len(), 2),
            "needs" => assert_eq!(
                ielts_db::skill_review_needs_snapshot(&conn, &SkillReviewNeedsQuery::default())
                    .unwrap()
                    .needs
                    .len(),
                2
            ),
            _ => assert_eq!(
                ielts_db::learner_skill_snapshot(&conn, &LearnerStateQuery::default())
                    .unwrap()
                    .needs
                    .len(),
                2
            ),
        }
        let first = state(&conn);
        assert!(first.states.iter().all(|row| row.evidence_count == 1));
        submit_fixture(dir.path(), &conn, 2);
        let second = state(&conn);
        assert_ne!(first.state_hash, second.state_hash);
        assert!(second.states.iter().all(|row| row.evidence_count == 2));
        assert!(
            ielts_db::learning_observations_verify(&conn)
                .unwrap()
                .consistent
        );
        assert!(learner_model_verify(&conn).unwrap().consistent);
        let changes = conn.total_changes();
        for _ in 0..3 {
            assert_eq!(state(&conn).state_hash, second.state_hash);
            ielts_db::skill_review_needs_snapshot(&conn, &SkillReviewNeedsQuery::default())
                .unwrap();
            ielts_db::learner_skill_snapshot(&conn, &LearnerStateQuery::default()).unwrap();
        }
        assert_eq!(
            conn.total_changes(),
            changes,
            "{entry}: hot reads must not rebuild"
        );
    }
}

#[test]
fn reads_repair_m2_m4_content_mapping_changes_and_deactivation() {
    let (dir, conn) = open_db();
    submit_fixture(dir.path(), &conn, 1);
    let original = state(&conn);
    for corruption in [
        "DELETE FROM learner_observations WHERE observation_type='reading.question.outcome'",
        "UPDATE learner_skill_observations SET outcome=0.25",
        "UPDATE learner_skill_observations SET context_json='{}'",
        "UPDATE learner_skill_state SET mastery_mean=0.99",
        "UPDATE skill_review_schedule SET priority=0.99",
    ] {
        conn.execute_batch(corruption).unwrap();
        assert_eq!(state(&conn).state_hash, original.state_hash, "{corruption}");
        assert!(learner_model_verify(&conn).unwrap().consistent);
    }
    let ids = observation_ids(&conn);
    conn.execute_batch(
        "UPDATE question_skill_map SET mapping_version=mapping_version+1, weight=0.5",
    )
    .unwrap();
    assert_ne!(state(&conn).state_hash, original.state_hash);
    assert_ne!(observation_ids(&conn), ids);
    conn.execute_batch("UPDATE question_skill_map SET active=0 WHERE skill_key='reading.tfng'")
        .unwrap();
    assert_eq!(state(&conn).states.len(), 1);
    conn.execute_batch("UPDATE question_skill_map SET active=1 WHERE skill_key='reading.tfng'; UPDATE skill_catalog SET active=0 WHERE skill_key='reading.multi_choice'").unwrap();
    let one = state(&conn);
    assert_eq!(one.states.len(), 1);
    assert_eq!(one.states[0].skill_key, "reading.tfng");
    conn.execute_batch("UPDATE skill_catalog SET active=1 WHERE skill_key='reading.multi_choice'")
        .unwrap();
    assert_eq!(state(&conn).states.len(), 2);
}

#[test]
fn projection_late_failures_reject_stale_success_and_roll_back() {
    for table in ["learning_projection_runs", "skill_review_schedule"] {
        let (dir, conn) = open_db();
        submit_fixture(dir.path(), &conn, 1);
        let original = state(&conn);
        let original_ids = observation_ids(&conn);
        submit_fixture(dir.path(), &conn, 2);
        let condition = if table == "learning_projection_runs" {
            "WHEN NEW.status='completed'"
        } else {
            ""
        };
        conn.execute_batch(&format!("CREATE TRIGGER reject_late BEFORE INSERT ON {table} {condition} BEGIN SELECT RAISE(ABORT,'late failure'); END;")).unwrap();
        assert!(ielts_db::learner_state_snapshot(&conn, &LearnerStateQuery::default()).is_err());
        assert!(
            ielts_db::skill_review_needs_snapshot(&conn, &SkillReviewNeedsQuery::default())
                .is_err()
        );
        assert!(ielts_db::learner_skill_snapshot(&conn, &LearnerStateQuery::default()).is_err());
        assert_eq!(observation_ids(&conn), original_ids);
        let evidence: u64 = conn
            .query_row(
                "SELECT MAX(evidence_count) FROM learner_skill_state",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(evidence, 1);
        conn.execute_batch("DROP TRIGGER reject_late").unwrap();
        let latest = state(&conn);
        assert_ne!(latest.state_hash, original.state_hash);
        assert!(latest.states.iter().all(|row| row.evidence_count == 2));
    }
}

#[test]
fn review_priority_cursor_visits_each_skill_and_combined_filter_matches_state() {
    let (_dir, conn) = open_db();
    // Independent assets avoid same-asset discount obscuring the deliberately
    // reversed priority/lexical order. Real submit freshness is tested above.
    // Each skill clears the minimum-evidence rule (3 observations, 2 assets)
    // so priority is driven by mastery rather than being zeroed.
    for (index, asset) in ["a", "b", "b"].into_iter().enumerate() {
        insert_question(
            &conn,
            &format!("page-tfng-{index}"),
            &format!("asset-tfng-{asset}"),
            &format!("q1-{index}"),
            "tfng",
            "2026-08-12T00:00:00Z",
            false,
            None,
        );
        insert_question(
            &conn,
            &format!("page-mcq-{index}"),
            &format!("asset-mcq-{asset}"),
            &format!("q2-{index}"),
            "mcq",
            "2026-08-12T00:00:00Z",
            true,
            None,
        );
    }
    let full =
        ielts_db::skill_review_needs_snapshot(&conn, &SkillReviewNeedsQuery::default()).unwrap();
    assert_eq!(full.needs[0].skill_key, "reading.tfng"); // priority and lexical order disagree
    assert!(full.needs[0].priority > full.needs[1].priority);
    let first = ielts_db::skill_review_needs_snapshot(
        &conn,
        &SkillReviewNeedsQuery {
            limit: 1,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(first.truncated);
    let second = ielts_db::skill_review_needs_snapshot(
        &conn,
        &SkillReviewNeedsQuery {
            limit: 1,
            after_skill_key: first.continuation,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(second.needs[0].skill_key, "reading.multi_choice");
    assert!(!second.truncated);
    let combined = ielts_db::learner_skill_snapshot(
        &conn,
        &LearnerStateQuery {
            skill_keys: vec!["reading.multi_choice".into()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(combined.state.states.len(), 1);
    assert_eq!(combined.needs.len(), 1);
    assert_eq!(
        combined.needs[0].skill_key,
        combined.state.states[0].skill_key
    );
    let bound = &full.needs[0].due_at;
    let due = ielts_db::skill_review_needs_snapshot(
        &conn,
        &SkillReviewNeedsQuery {
            due_before: Some(bound.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(due.needs.iter().any(|need| &need.due_at == bound));
}

#[test]
fn desktop_reads_exclude_other_users_and_their_reference_clock() {
    let (_dir, conn) = open_db();
    insert_question(
        &conn,
        "local-evidence",
        "local-asset",
        "q1",
        "tfng",
        "2026-08-12T00:00:00Z",
        false,
        None,
    );
    let before = state(&conn);
    let as_of = chrono::DateTime::parse_from_rfc3339("2026-10-02T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let needs_before = ielts_db::skill_review_needs_snapshot_as_of(
        &conn,
        &SkillReviewNeedsQuery::default(),
        as_of,
    )
    .unwrap();
    insert_question(
        &conn,
        "foreign-evidence",
        "foreign-asset",
        "q1",
        "tfng",
        "2026-09-12T00:00:00Z",
        true,
        None,
    );
    // Synthetic foreign ledger input: production submit still fixes user=local.
    conn.execute(
        "UPDATE learning_events SET user_id='other' WHERE id='foreign-evidence'",
        [],
    )
    .unwrap();
    let after = state(&conn);
    assert_eq!(after, before);
    assert_eq!(
        ielts_db::skill_review_needs_snapshot_as_of(
            &conn,
            &SkillReviewNeedsQuery::default(),
            as_of
        )
        .unwrap(),
        needs_before
    );
    let combined =
        ielts_db::learner_skill_snapshot_as_of(&conn, &LearnerStateQuery::default(), as_of)
            .unwrap();
    assert_eq!(combined.state, before);
    assert_eq!(combined.needs, needs_before.needs);
    assert!(combined.needs[0]
        .avoid_asset_ids
        .iter()
        .all(|asset| asset == "local-asset"));
    let users: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT user_id) FROM learner_skill_state",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(users, 2, "admin projection still retains all users");
}

fn submit_payload(
    dir: &std::path::Path,
    conn: &Connection,
    payload: serde_json::Value,
    attempt: &str,
    answers: serde_json::Value,
) -> String {
    let path = dir.join("m4-production-fixture.json");
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    let asset = import_asset_payload_file(conn, &path).unwrap();
    submit_reading_attempt(
        conn,
        &ReadingSubmitCommand {
            attempt_id: attempt.into(),
            asset_id: payload["examId"].as_str().unwrap().into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint.clone()),
            answers,
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(900),
            title_snapshot: Some("M4 production fixture".into()),
            idempotency_key: format!("submit-{attempt}"),
        },
    )
    .unwrap();
    asset.fingerprint
}

fn submit_trend_attempt(
    dir: &std::path::Path,
    conn: &Connection,
    asset: &str,
    attempt: &str,
    day: u32,
    correct: &[bool; 8],
    reverse_ids: bool,
) {
    let ids = (1..=8).map(|id| format!("q{id}")).collect::<Vec<_>>();
    let answer_key = ids.iter().map(|id| (id.clone(), json!("TRUE")))
        .collect::<serde_json::Map<_, _>>();
    let answers = ids.iter().enumerate().map(|(index, id)| {
        let index = if reverse_ids { 7 - index } else { index };
        (id.clone(), json!(if correct[index] { "TRUE" } else { "FALSE" }))
    }).collect::<serde_json::Map<_, _>>();
    submit_payload(dir, conn, json!({
        "examId": asset, "meta": {"title": "Trend", "category": "P1"},
        "questionCount": 8, "questionOrder": ids, "answerKey": answer_key,
        "questionGroups": [{"kind": "tfng", "questionIds": ids}]
    }), attempt, json!(answers));
    // The submit API owns the clock. Pin the real submitted ledger for replay.
    conn.execute(
        "UPDATE learning_events SET occurred_at=?1 WHERE attempt_id=?2",
        params![format!("2026-08-{day:02}T00:00:00Z"), attempt],
    ).unwrap();
}

#[test]
fn real_mixed_eight_question_attempt_has_no_trend_even_with_swapped_ids() {
    let mut summaries = Vec::new();
    for reverse in [false, true] {
        let (dir, conn) = open_db();
        submit_trend_attempt(dir.path(), &conn, "mixed", "mixed-attempt", 12,
            &[false, false, false, false, true, true, true, true], reverse);
        let snapshot = state(&conn);
        let row = &snapshot.states[0];
        assert_eq!(row.trend, ielts_domain::TrendDirection::InsufficientEvidence);
        assert_eq!(row.explanation["trendOutcomes"], json!([0.5]));
        assert_eq!(row.evidence_count, 8);
        assert_eq!(row.mastery_mean, 0.5);
        summaries.push((row.trend.clone(), row.mastery_mean, row.uncertainty));
        assert_eq!(learner_model_rebuild(&conn).unwrap().state_hash, snapshot.state_hash);
        assert!(learner_model_verify(&conn).unwrap().consistent);
    }
    assert_eq!(summaries[0], summaries[1]);
}

#[test]
fn real_same_material_wrong_to_right_updates_posterior_without_transfer_trend() {
    let (dir, conn) = open_db();
    submit_trend_attempt(dir.path(), &conn, "repeat", "wrong", 12, &[false; 8], false);
    let first = state(&conn);
    for (attempt, day) in [("right", 13), ("right-again", 14)] {
        submit_trend_attempt(dir.path(), &conn, "repeat", attempt, day, &[true; 8], false);
    }
    let snapshot = state(&conn);
    let row = &snapshot.states[0];
    assert_eq!(row.trend, ielts_domain::TrendDirection::InsufficientEvidence);
    assert_eq!(row.explanation["trendOutcomes"], json!([0.0]));
    assert_eq!(row.evidence_count, 24);
    assert_eq!(row.distinct_asset_count, 1);
    assert!(row.mastery_mean > first.states[0].mastery_mean);
    assert_eq!(learner_model_rebuild(&conn).unwrap().state_hash, snapshot.state_hash);
    assert!(learner_model_verify(&conn).unwrap().consistent);
}

#[test]
fn real_independent_future_material_establishes_direction_and_repairs_old_trend() {
    for improving in [true, false] {
        let (dir, conn) = open_db();
        for ordinal in 0..4 {
            let correct = if ordinal < 2 { !improving } else { improving };
            submit_trend_attempt(dir.path(), &conn, &format!("material-{ordinal}"),
                &format!("attempt-{ordinal}"), 12 + ordinal, &[correct; 8], false);
        }
        let snapshot = state(&conn);
        assert_eq!(snapshot.states[0].trend, if improving {
            ielts_domain::TrendDirection::Improving
        } else {
            ielts_domain::TrendDirection::Declining
        });
        assert_eq!(snapshot.states[0].evidence_count, 32);
        assert_eq!(snapshot.states[0].distinct_asset_count, 4);
        conn.execute_batch("UPDATE learner_skill_state SET explanation_json=json_remove(json_set(explanation_json, '$.trend', 'stable'), '$.trendOutcomes')").unwrap();
        assert!(!learner_model_verify(&conn).unwrap().consistent);
        assert_eq!(state(&conn), snapshot);
        assert_eq!(learner_model_rebuild(&conn).unwrap().state_hash, snapshot.state_hash);
        assert!(learner_model_verify(&conn).unwrap().consistent);
    }
}

#[test]
fn real_equal_time_material_does_not_gain_direction_from_attempt_ids() {
    let (dir, conn) = open_db();
    for ordinal in 0..4 {
        submit_trend_attempt(dir.path(), &conn, &format!("tied-{ordinal}"),
            &format!("tied-attempt-{ordinal}"), 12, &[ordinal >= 2; 8], false);
    }
    let snapshot = state(&conn);
    assert_eq!(snapshot.states[0].trend, ielts_domain::TrendDirection::InsufficientEvidence);
    assert_eq!(snapshot.states[0].explanation["trendOutcomes"], json!([0.5]));
    assert_eq!(learner_model_rebuild(&conn).unwrap().state_hash, snapshot.state_hash);
    assert!(learner_model_verify(&conn).unwrap().consistent);
}

#[test]
fn real_first_attempt_weights_all_questions_equally_and_id_swap_preserves_skills() {
    let mut first_posteriors = Vec::new();
    for (tfng_id, mcq_id) in [("q1", "q2"), ("q2", "q1")] {
        let (dir, conn) = open_db();
        let payload = json!({
            "examId": "m4-first", "meta": {"title": "First", "category": "P1"},
            "questionCount": 2, "questionOrder": ["q1", "q2"],
            "answerKey": {(tfng_id): "TRUE", (mcq_id): "B"},
            "questionGroups": [{"kind": "tfng", "questionIds": [tfng_id]},
                               {"kind": "mcq", "questionIds": [mcq_id]}]
        });
        let answers = json!({(tfng_id): "FALSE", (mcq_id): "B"});
        submit_payload(dir.path(), &conn, payload.clone(), "first", answers.clone());
        let first = state(&conn);
        first_posteriors.push(
            first
                .states
                .iter()
                .map(|row| (row.skill_key.clone(), row.mastery_mean, row.uncertainty))
                .collect::<Vec<_>>(),
        );
        for row in &first.states {
            assert_eq!(observation_weights(&conn, &row.skill_key), vec![(1.0, 1.0)]);
            assert_eq!(row.explanation["novelEvidenceCount"], 1);
            assert_eq!(row.explanation["repeatedEvidenceCount"], 0);
        }
        submit_payload(dir.path(), &conn, payload, "second", answers);
        let second = state(&conn);
        for row in &second.states {
            assert_eq!(
                observation_weights(&conn, &row.skill_key),
                vec![(1.0, 1.0), (0.1, 0.25)]
            );
            assert_eq!(row.explanation["novelEvidenceCount"], 1);
            assert_eq!(row.explanation["repeatedEvidenceCount"], 1);
        }
        assert!(learner_model_verify(&conn).unwrap().consistent);
        assert_eq!(
            learner_model_rebuild(&conn).unwrap().state_hash,
            second.state_hash
        );
    }
    assert_eq!(first_posteriors[0], first_posteriors[1]);
}

#[test]
fn tied_first_attempts_of_same_asset_are_averaged_independent_of_ids() {
    let mut results = Vec::new();
    for swap in [false, true] {
        let (dir, conn) = open_db();
        for ordinal in 0..4 {
            let asset = format!("tie-material-{ordinal}");
            if ordinal < 2 {
                for (suffix, correct) in [("a", swap), ("z", !swap)] {
                    submit_trend_attempt(dir.path(), &conn, &asset,
                        &format!("tie-{ordinal}-{suffix}"), 12 + ordinal, &[correct; 8], false);
                }
            } else {
                submit_trend_attempt(dir.path(), &conn, &asset,
                    &format!("tie-{ordinal}"), 12 + ordinal, &[true; 8], false);
            }
        }
        let snapshot = state(&conn);
        let row = &snapshot.states[0];
        assert_eq!(row.explanation["trendOutcomes"], json!([0.5, 0.5, 1.0, 1.0]));
        results.push((row.trend.clone(), row.explanation["trendOutcomes"].clone()));
        assert_eq!(learner_model_rebuild(&conn).unwrap().state_hash, snapshot.state_hash);
        assert!(learner_model_verify(&conn).unwrap().consistent);
    }
    assert_eq!(results[0], results[1]);
}

#[test]
fn real_reimport_preserves_each_submitted_kind_and_active_curated_priority() {
    let (dir, conn) = open_db();
    let payload = |kind: &str, answer: &str| {
        json!({
            "examId": "m4-reimport", "meta": {"title": "Reimport", "category": "P1"},
            "questionCount": 1, "questionOrder": ["q1"], "answerKey": {"q1": answer},
            "questionGroups": [{"kind": kind, "questionIds": ["q1"]}]
        })
    };
    let old_fingerprint = submit_payload(
        dir.path(),
        &conn,
        payload("tfng", "TRUE"),
        "old",
        json!({"q1": "FALSE"}),
    );
    let old = state(&conn);
    assert_eq!(old.states[0].skill_key, "reading.tfng");
    let new_fingerprint = submit_payload(
        dir.path(),
        &conn,
        payload("mcq", "B"),
        "new",
        json!({"q1": "B"}),
    );
    assert_ne!(old_fingerprint, new_fingerprint);
    let new = state(&conn);
    assert_eq!(new.states.len(), 2);
    let mut statement = conn
        .prepare(
            "SELECT o.attempt_id, o.skill_key, json_extract(e.payload_json, '$.questionKind'),
                a.submitted_asset_fingerprint
         FROM learner_skill_observations o JOIN learning_events e ON e.id=o.event_id
         JOIN attempts a ON a.id=o.attempt_id ORDER BY o.attempt_id",
        )
        .unwrap();
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            (
                "new".into(),
                "reading.multi_choice".into(),
                "mcq".into(),
                new_fingerprint
            ),
            (
                "old".into(),
                "reading.tfng".into(),
                "tfng".into(),
                old_fingerprint
            ),
        ]
    );
    assert!(learner_model_verify(&conn).unwrap().consistent);
    assert_eq!(
        learner_model_rebuild(&conn).unwrap().state_hash,
        new.state_hash
    );
    assert!(learner_model_verify(&conn).unwrap().consistent);
    // Manual and content-pack rows are curated decisions, even with cached builtins.
    for (source, skill, version) in [
        ("manual", "reading.matching_headings", 7),
        ("content_pack", "reading.short_answer", 8),
    ] {
        conn.execute(
            "INSERT INTO question_skill_map
            (asset_id, question_id, skill_key, weight, mapping_source, mapping_version, active)
            VALUES ('m4-reimport', 'q1', ?1, 0.8, ?2, ?3, 1)",
            params![skill, source, version],
        )
        .unwrap();
        let curated = state(&conn);
        assert_eq!(curated.states.len(), 1);
        assert_eq!(curated.states[0].skill_key, skill);
        assert_eq!(curated.states[0].evidence_count, 2);
        let mut stmt = conn
            .prepare("SELECT mapping_weight, context_json FROM learner_skill_observations")
            .unwrap();
        for row in stmt
            .query_map([], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
        {
            let (weight, context) = row.unwrap();
            let context: serde_json::Value = serde_json::from_str(&context).unwrap();
            assert_eq!(weight, 0.8);
            assert_eq!(context["mappingSource"], source);
            assert_eq!(context["mappingVersion"], version);
        }
        assert!(learner_model_verify(&conn).unwrap().consistent);
    }
}

#[test]
fn real_idle_review_uses_read_clock_without_mutating_evidence_or_replay_hash() {
    let (dir, conn) = open_db();
    submit_fixture(dir.path(), &conn, 1);
    let initial = state(&conn);
    let reference = chrono::DateTime::parse_from_rfc3339(&initial.generated_at)
        .unwrap()
        .with_timezone(&chrono::Utc);
    let query = SkillReviewNeedsQuery::default();
    let before = ielts_db::skill_review_needs_snapshot_as_of(&conn, &query, reference).unwrap();
    assert!(before
        .needs
        .iter()
        .all(|need| !need.reason_codes.iter().any(|r| r == "review_due")));
    let baseline = learner_model_verify(&conn).unwrap();
    let changes = conn.total_changes();
    let later = reference + chrono::Duration::days(60);
    let after = ielts_db::skill_review_needs_snapshot_as_of(&conn, &query, later).unwrap();
    assert_eq!(after.generated_at, later.to_rfc3339());
    for need in &after.needs {
        let earlier = before
            .needs
            .iter()
            .find(|row| row.skill_key == need.skill_key)
            .unwrap();
        // One observation per skill on one article: below the minimum-evidence
        // rule, so staleness reports review_due but never escalates priority.
        assert_eq!(need.evidence_count, 1);
        assert_eq!(need.priority, 0.0);
        assert_eq!(earlier.priority, 0.0);
        assert_eq!(need.priority_band, "watch");
        assert!(need.reason_codes.iter().any(|r| r == "insufficient_evidence"));
        assert!(need.reason_codes.iter().any(|r| r == "review_due"));
        assert_eq!(need.due_at, earlier.due_at);
        assert_eq!(
            need.supporting_observation_ids,
            earlier.supporting_observation_ids
        );
    }
    assert_eq!(
        ielts_db::skill_review_needs_snapshot_as_of(&conn, &query, later).unwrap(),
        after
    );
    let combined =
        ielts_db::learner_skill_snapshot_as_of(&conn, &LearnerStateQuery::default(), later)
            .unwrap();
    assert_eq!(combined.state, initial);
    assert_eq!(combined.needs, after.needs);
    let clock_before = chrono::Utc::now();
    let default = ielts_db::skill_review_needs_snapshot(&conn, &query).unwrap();
    let clock_after = chrono::Utc::now();
    let generated = chrono::DateTime::parse_from_rfc3339(&default.generated_at).unwrap();
    assert!(generated >= clock_before && generated <= clock_after);
    assert_eq!(
        conn.total_changes(),
        changes,
        "time projection must not write any rows"
    );
    assert_eq!(learner_model_verify(&conn).unwrap(), baseline);
    assert_eq!(
        learner_model_rebuild(&conn).unwrap().state_hash,
        initial.state_hash
    );
    assert!(learner_model_verify(&conn).unwrap().consistent);
}

fn needs_as_of(conn: &Connection, as_of: &str) -> Vec<ielts_domain::SkillReviewNeed> {
    let as_of = chrono::DateTime::parse_from_rfc3339(as_of)
        .unwrap()
        .with_timezone(&chrono::Utc);
    ielts_db::skill_review_needs_snapshot_as_of(&conn, &SkillReviewNeedsQuery::default(), as_of)
        .unwrap()
        .needs
}

#[test]
fn single_wrong_answer_is_insufficient_evidence_even_after_twenty_stale_days() {
    let (_dir, conn) = open_db();
    insert_question(&conn, "one-wrong", "asset-new", "q1", "tfng",
        "2026-08-12T00:00:00Z", false, None);
    for as_of in ["2026-08-12T00:00:00Z", "2026-09-01T00:00:00Z"] {
        let needs = needs_as_of(&conn, as_of);
        assert_eq!(needs.len(), 1);
        let need = &needs[0];
        assert_eq!(need.skill_key, "reading.tfng");
        assert_eq!(need.evidence_count, 1);
        assert_eq!(need.priority, 0.0, "as_of={as_of}");
        assert_eq!(need.priority_band, "watch", "as_of={as_of}");
        assert_eq!(need.reason_codes[0], "insufficient_evidence");
    }
    assert!(learner_model_verify(&conn).unwrap().consistent);
}

#[test]
fn sufficient_evidence_keeps_weakness_priority_and_staleness_escalation() {
    let (_dir, conn) = open_db();
    for (index, asset) in ["asset-a", "asset-b", "asset-b"].into_iter().enumerate() {
        insert_question(&conn, &format!("wrong-{index}"), asset, &format!("q{index}"), "tfng",
            &format!("2026-08-12T0{index}:00:00Z"), false, None);
    }
    let fresh = needs_as_of(&conn, "2026-08-12T02:00:00Z");
    let stale = needs_as_of(&conn, "2026-09-25T02:00:00Z");
    assert_eq!(fresh[0].evidence_count, 3);
    assert_eq!(fresh[0].distinct_asset_count, 2);
    assert!(fresh[0].priority > 0.0);
    assert!(!fresh[0].reason_codes.iter().any(|r| r == "insufficient_evidence"));
    assert!(stale[0].priority > fresh[0].priority);
    assert_eq!(stale[0].priority_band, "urgent");
    assert!(stale[0].reason_codes.iter().any(|r| r == "review_due"));
}

#[test]
fn rust_snapshot_is_consumed_by_python_and_python_query_is_accepted_by_rust() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let (dir, conn) = open_db();
    submit_fixture(dir.path(), &conn, 1);
    let snapshot = ielts_db::learner_skill_snapshot(&conn, &LearnerStateQuery::default()).unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let python = std::env::var("PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let mut child = Command::new(python)
        .arg(root.join("developer/tests/ci/learner_wire_probe.py"))
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Python is required for the real learner wire contract");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(&snapshot).unwrap())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "Python failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let params: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let query: LearnerStateQuery = serde_json::from_value(
        params
            .get("query")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .unwrap();
    assert_eq!(
        query.skill_keys,
        snapshot
            .state
            .states
            .iter()
            .map(|row| row.skill_key.clone())
            .collect::<Vec<_>>()
    );
    assert!(serde_json::from_value::<LearnerStateQuery>(
        json!({"activity":"reading", "skills":[]})
    )
    .is_err());
    assert!(serde_json::from_value::<LearnerStateQuery>(serde_json::Value::Null).is_err());
}

fn skill_rows(conn: &Connection, sql: &str) -> Vec<(String, String, Option<String>)> {
    let mut statement = conn.prepare(sql).unwrap();
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn matching_groups_feed_their_own_sub_type_skill_and_unknown_matching_is_not_headings() {
    let (dir, conn) = open_db();
    let group = |id: &str, html: &str| json!({"kind": "matching", "questionIds": [id], "bodyHtml": html});
    let path = dir.path().join("matching-asset.json");
    std::fs::write(
        &path,
        serde_json::to_vec(&json!({
            "examId": "matching-asset", "meta": {"title": "Matching", "category": "P2"},
            "questionCount": 5, "questionOrder": ["q1", "q2", "q3", "q4", "q5"],
            "answerKey": {"q1": "iv", "q2": "C", "q3": "B", "q4": "D", "q5": "A"},
            "questionGroups": [
                group("q1", "<p>Choose the correct heading for each paragraph from the list of headings below.</p>"),
                group("q2", "<p>Reading Passage 2 has six paragraphs, <strong>A-F</strong>. Which paragraph contains the following information?</p>"),
                group("q3", "<p>Look at the following statements and the list of people below.</p><p>Match each statement with the correct person, A-E.</p>"),
                group("q4", "<p>Complete each sentence with the correct ending, A-G, below.</p>"),
                group("q5", "<p>Questions 27-30</p>")
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    let asset = import_asset_payload_file(&conn, &path).unwrap();
    submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "matching-attempt".into(),
            asset_id: "matching-asset".into(),
            asset_revision: Some(asset.schema_version),
            asset_fingerprint: Some(asset.fingerprint),
            answers: json!({"q1": "ii", "q2": "A", "q3": "A", "q4": "A", "q5": "B"}),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(900),
            title_snapshot: Some("Matching".into()),
            idempotency_key: "matching-submit".into(),
        },
    )
    .unwrap();
    // A read refreshes the projection.
    assert_eq!(state(&conn).states.len(), 5);

    let rows = skill_rows(
        &conn,
        "SELECT question_id, skill_key, error_type FROM learner_skill_observations ORDER BY question_id",
    );
    let keys: Vec<(&str, &str)> = rows.iter().map(|row| (row.0.as_str(), row.1.as_str())).collect();
    assert_eq!(
        keys,
        vec![
            ("q1", "reading.matching_headings"),
            ("q2", "reading.matching_information"),
            ("q3", "reading.matching_features"),
            ("q4", "reading.matching_sentence_endings"),
            ("q5", "reading.matching"),
        ]
    );
    assert_eq!(rows[2].2.as_deref(), Some("reading.matching_features.evidence_selection"));
}

#[test]
fn tfng_aliases_resolve_to_one_skill_and_one_error_naming() {
    let (_dir, conn) = open_db();
    let kinds = ["tfng", "true_false_not_given", "True-False-Not-Given", "reading.tfng", "matching"];
    for (index, kind) in kinds.iter().enumerate() {
        insert_question(
            &conn,
            &format!("event-alias-{index}"),
            &format!("asset-alias-{index}"),
            "q1",
            kind,
            &format!("2026-08-1{index}T00:00:00Z"),
            false,
            None,
        );
    }
    learning_observations_rebuild(&conn).unwrap();
    learner_model_rebuild(&conn).unwrap();
    let rows = skill_rows(
        &conn,
        "SELECT DISTINCT skill_key, error_type, NULL FROM learner_skill_observations ORDER BY skill_key",
    );
    let pairs: Vec<(&str, &str)> = rows.iter().map(|row| (row.0.as_str(), row.1.as_str())).collect();
    // A generic matching event that carries no sub-type is not a headings miss.
    assert_eq!(
        pairs,
        vec![
            ("reading.matching", "reading.matching.evidence_selection"),
            ("reading.tfng", "reading.tfng.boundary"),
        ]
    );
    assert_eq!(ielts_db::canonical_reading_skill_key("yes_no_not_given"), "reading.yng");
    assert_eq!(ielts_db::canonical_reading_skill_key("multiple_choice"), "reading.multi_choice");
}
