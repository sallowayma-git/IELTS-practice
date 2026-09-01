use ielts_db::{
    learning_events_by_ids, migrate, observation_snapshot, observations_by_ids, open_connection,
    DbError, DbOpenOptions,
};
use ielts_domain::{ObservationSnapshotQuery, ProjectionFreshness};
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
fn snapshot_rebuilds_stale_rows_and_keeps_a_bounded_versioned_contract() {
    let (_dir, conn) = open_db();
    insert_reading_question(&conn, "reading-normal", "2026-08-12T01:00:00Z", "normal");
    insert_reading_question(&conn, "reading-private", "2026-08-12T01:01:00Z", "restricted");

    let first = observation_snapshot(
        &conn,
        &ObservationSnapshotQuery {
            namespaces: vec!["reading".into()],
            scope: None,
            since: None,
            after_id: None,
            limit: 1,
        },
    )
    .unwrap();
    assert_eq!(first.freshness, ProjectionFreshness::Fresh);
    assert_eq!(first.schema_version, 1);
    assert_eq!(first.projector_version, 2);
    assert!(!first.ledger_input_hash.is_empty());
    assert!(!first.observation_output_hash.is_empty());
    assert!(!first.generated_at.is_empty());
    assert_eq!(first.observations.len(), 1);
    assert!(first.truncated);
    assert!(first.continuation.is_some());
    assert_eq!(first.observations[0].sensitivity, "normal");
    assert_eq!(first.observations[0].trust, "deterministic_projection");

    let next = observation_snapshot(
        &conn,
        &ObservationSnapshotQuery {
            after_id: first.continuation.clone(),
            limit: 200,
            ..ObservationSnapshotQuery::default()
        },
    )
    .unwrap();
    assert!(!next.observations.is_empty());
    assert!(next
        .observations
        .iter()
        .all(|observation| observation.namespace == "reading"));
    assert_eq!(next.generated_at, first.generated_at);
    assert_eq!(next.observation_output_hash, first.observation_output_hash);

    let first_id = first.observations[0].id.clone();
    let batch = observations_by_ids(&conn, &[first_id.clone(), "missing-observation".into()])
        .unwrap();
    assert_eq!(batch.observations.len(), 1);
    assert_eq!(batch.observations[0].id, first_id);
    assert_eq!(batch.missing_ids, vec!["missing-observation"]);
    assert_eq!(batch.generated_at, first.generated_at);

    let evidence = learning_events_by_ids(
        &conn,
        &[
            "reading-normal".into(),
            "reading-private".into(),
            "missing-event".into(),
        ],
    )
    .unwrap();
    assert_eq!(evidence.events.len(), 1);
    assert_eq!(evidence.events[0].id, "reading-normal");
    assert_eq!(evidence.missing_ids, vec!["reading-private", "missing-event"]);

    conn.execute("DELETE FROM learner_observations", []).unwrap();
    let rebuilt = observation_snapshot(
        &conn,
        &ObservationSnapshotQuery {
            namespaces: vec!["reading".into()],
            limit: 200,
            ..ObservationSnapshotQuery::default()
        },
    )
    .unwrap();
    assert_eq!(rebuilt.freshness, ProjectionFreshness::Fresh);
    assert_eq!(rebuilt.observation_output_hash, first.observation_output_hash);
    assert!(!rebuilt.generated_at.is_empty());
    assert_eq!(rebuilt.observations.len(), 4);
}

#[test]
fn cognitive_read_rejects_more_than_two_hundred_ids() {
    let (_dir, conn) = open_db();
    let ids = (0..=200)
        .map(|index| format!("observation-{index}"))
        .collect::<Vec<_>>();
    let error = observations_by_ids(&conn, &ids).unwrap_err();
    assert!(matches!(error, DbError::Validation(message) if message.contains("at most 200")));
}

fn insert_reading_question(conn: &Connection, id: &str, occurred_at: &str, sensitivity: &str) {
    let payload = json!({
        "attemptId": format!("attempt-{id}"),
        "assetId": "asset-1",
        "questionId": format!("question-{id}"),
        "attemptOrdinal": 1,
        "isCorrect": false,
        "questionKind": "mcq",
        "changeCount": 1,
        "visitCount": 2,
        "elapsedMs": 900,
        "firstTryCorrect": false
    })
    .to_string();
    conn.execute(
        "INSERT INTO learning_events
         (id, user_id, event_type, source_kind, source_id, idempotency_key, activity, asset_id,
          attempt_id, question_id, skill_key, occurred_at, payload_json, content_hash,
          schema_version, consolidation_state, sensitivity, created_at, updated_at)
         VALUES (?1, 'local', 'reading_question_outcome', 'test', ?1, ?1, 'reading', 'asset-1',
                 NULL, NULL, NULL, ?2, ?3, ?4, 1, 'pending', ?5, ?2, ?2)",
        params![
            id,
            occurred_at,
            payload,
            sha256_hex(&payload),
            sensitivity,
        ],
    )
    .unwrap();
}

fn sha256_hex(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    hex::encode(digest.finalize())
}
