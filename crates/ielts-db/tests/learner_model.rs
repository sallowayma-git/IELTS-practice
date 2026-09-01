use std::collections::BTreeSet;

use ielts_db::{
    current_version, learner_model_rebuild, learner_model_verify, learning_observations_rebuild,
    migrate, open_connection, verify_idempotent, DbOpenOptions,
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
        vec![12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
    );
    assert!(
        current_version(&conn).unwrap() >= 23,
        "migration 0023 was not applied"
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
