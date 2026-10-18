use ielts_db::{
    import_asset_payload_file, learning_events_by_ids, learning_observations_rebuild,
    learning_observations_verify, list_learning_events, migrate, observation_snapshot,
    observations_by_ids, open_connection, submit_reading_attempt, DbError, DbOpenOptions,
    ReadingSubmitCommand,
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
    insert_reading_question(
        &conn,
        "reading-private",
        "2026-08-12T01:01:00Z",
        "restricted",
    );

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
    let batch =
        observations_by_ids(&conn, &[first_id.clone(), "missing-observation".into()]).unwrap();
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
    assert_eq!(
        evidence.missing_ids,
        vec!["reading-private", "missing-event"]
    );

    conn.execute("DELETE FROM learner_observations", [])
        .unwrap();
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
    assert_eq!(
        rebuilt.observation_output_hash,
        first.observation_output_hash
    );
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
    let error = learning_events_by_ids(&conn, &ids).unwrap_err();
    assert!(matches!(error, DbError::Validation(message) if message.contains("at most 200")));
}

#[test]
fn submitted_reading_evidence_is_missing_after_hash_tampering_and_recovers_on_replay() {
    let (dir, conn) = open_db();
    let asset_path = dir.path().join("asset.json");
    std::fs::write(
        &asset_path,
        json!({
            "examId": "evidence-asset",
            "meta": {"title": "Evidence Passage", "category": "P1"},
            "questionCount": 1,
            "questionOrder": ["q1"],
            "answerKey": {"q1": "TRUE"},
            "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]}]
        })
        .to_string(),
    )
    .unwrap();
    let asset = import_asset_payload_file(&conn, &asset_path).unwrap();
    let command = ReadingSubmitCommand {
        attempt_id: "evidence-attempt".into(),
        asset_id: asset.id.clone(),
        asset_revision: Some(asset.schema_version),
        asset_fingerprint: Some(asset.fingerprint),
        answers: json!({"q1": "FALSE"}),
        marked_questions: vec![],
        question_timeline: vec![],
        duration_ms: Some(1_000),
        title_snapshot: None,
        idempotency_key: "evidence-submit".into(),
    };
    submit_reading_attempt(&conn, &command).unwrap();
    let event = list_learning_events(&conn, None, Some(&command.attempt_id), 20)
        .unwrap()
        .into_iter()
        .find(|event| event.question_id.as_deref() == Some("q1"))
        .unwrap();
    let ids = vec![event.id.clone()];
    let baseline = learning_observations_rebuild(&conn).unwrap();
    let evidence = learning_events_by_ids(&conn, &ids).unwrap();
    assert_eq!(evidence.events.len(), 1);
    assert_eq!(evidence.events[0].payload["isCorrect"], false);
    assert_eq!(evidence.events[0].trust, "canonical_learning_truth");
    let original: String = conn
        .query_row(
            "SELECT payload_json FROM learning_events WHERE id = ?1",
            params![event.id],
            |row| row.get(0),
        )
        .unwrap();
    let mut tampered: serde_json::Value = serde_json::from_str(&original).unwrap();
    tampered["isCorrect"] = json!(true);
    conn.execute(
        "UPDATE learning_events SET payload_json = ?2 WHERE id = ?1",
        params![event.id, tampered.to_string()],
    )
    .unwrap();
    // The stored-hash fast path must notice the edit and rebuild rather than
    // serve the observation built on the original payload as fresh.
    let query = ObservationSnapshotQuery {
        namespaces: vec!["reading".into()],
        scope: None,
        since: None,
        after_id: None,
        limit: 50,
    };
    let snapshot = observation_snapshot(&conn, &query).unwrap();
    assert_ne!(snapshot.ledger_input_hash, baseline.input_hash);
    assert_ne!(snapshot.observation_output_hash, baseline.output_hash);
    let isolated = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(isolated.quarantined_event_ids, ids);
    assert!(learning_observations_verify(&conn).unwrap().consistent);
    let state: String = conn
        .query_row(
            "SELECT consolidation_state FROM learning_events WHERE id = ?1",
            params![event.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        state, "pending",
        "projector quarantine does not mutate ledger state"
    );
    let rejected = learning_events_by_ids(&conn, &[event.id.clone(), event.id.clone()]).unwrap();
    assert!(rejected.events.is_empty());
    assert_eq!(rejected.missing_ids, ids);

    conn.execute(
        "UPDATE learning_events SET payload_json = ?2 WHERE id = ?1",
        params![event.id, original],
    )
    .unwrap();
    assert!(
        submit_reading_attempt(&conn, &command)
            .unwrap()
            .idempotent_replay
    );
    let restored = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(restored.quarantined, 0);
    assert_eq!(restored.input_hash, baseline.input_hash);
    assert_eq!(restored.output_hash, baseline.output_hash);
    assert_eq!(
        learning_observations_rebuild(&conn).unwrap().output_hash,
        restored.output_hash
    );
    assert_eq!(learning_events_by_ids(&conn, &ids).unwrap(), evidence);
}

#[test]
fn gateway_and_projector_reject_hash_valid_writing_band_and_accept_corrected_replay() {
    let (_dir, conn) = open_db();
    let mut payload = json!({
        "evaluationId": "writing-band", "attemptId": "writing-attempt",
        "status": "completed", "stage": "finalizing",
        "score": {"overall": 9.5, "taskResponse": 9.0, "coherence": 9.0,
                  "lexical": 9.0, "grammar": 9.0}
    });
    let encoded = payload.to_string();
    conn.execute(
        "INSERT INTO learning_events
         (id,user_id,event_type,source_kind,source_id,idempotency_key,activity,occurred_at,
          payload_json,content_hash,schema_version,consolidation_state,sensitivity,created_at,updated_at)
         VALUES ('writing-band','local','writing_evaluation_completed','test','writing-band',
                 'writing-band','writing','2026-08-12T00:00:00Z',?1,?2,1,'pending','normal',
                 '2026-08-12T00:00:00Z','2026-08-12T00:00:00Z')",
        params![encoded, sha256_hex(&encoded)]
    ).unwrap();
    let ids = vec!["writing-band".into()];
    assert_eq!(
        learning_observations_rebuild(&conn)
            .unwrap()
            .quarantined_event_ids,
        ids
    );
    let rejected = learning_events_by_ids(&conn, &ids).unwrap();
    assert!(rejected.events.is_empty());
    assert_eq!(rejected.missing_ids, ids);
    payload["score"]["overall"] = json!(9.0);
    let encoded = payload.to_string();
    conn.execute(
        "UPDATE learning_events SET payload_json = ?1, content_hash = ?2 WHERE id = 'writing-band'",
        params![encoded, sha256_hex(&encoded)],
    )
    .unwrap();
    let restored = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(restored.quarantined, 0);
    assert_eq!(restored.output_count, 6);
    assert_eq!(
        learning_observations_rebuild(&conn).unwrap().output_hash,
        restored.output_hash
    );
    let accepted = learning_events_by_ids(&conn, &ids).unwrap();
    assert!(accepted.missing_ids.is_empty());
    assert_eq!(accepted.events[0].payload, payload);
    assert_eq!(accepted.events[0].trust, "canonical_learning_truth");
}

#[test]
fn gateway_returns_explicit_missing_for_invalid_schema_json_semantics_and_quarantine() {
    let (_dir, conn) = open_db();
    for id in [
        "normal",
        "restricted",
        "quarantined",
        "schema",
        "json",
        "shape",
        "reference",
    ] {
        insert_reading_question(
            &conn,
            id,
            "2026-08-12T01:00:00Z",
            if id == "restricted" {
                "restricted"
            } else {
                "normal"
            },
        );
    }
    conn.execute(
        "UPDATE learning_events SET consolidation_state = 'quarantined' WHERE id = 'quarantined'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE learning_events SET schema_version = 2 WHERE id = 'schema'",
        [],
    )
    .unwrap();
    for (id, encoded) in [("json", "{broken"), ("shape", "{}"), ("reference", "{\"attemptId\":\"a\",\"assetId\":\"other\",\"questionId\":\"q\",\"attemptOrdinal\":1,\"changeCount\":0,\"visitCount\":0,\"elapsedMs\":0}")] {
        conn.execute("UPDATE learning_events SET payload_json = ?2, content_hash = ?3 WHERE id = ?1",
            params![id, encoded, sha256_hex(encoded)]).unwrap();
    }
    let report = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(report.quarantined, 5);
    assert_eq!(report.skipped_sensitive, 1);
    assert_eq!(report.output_count, 4);
    let ids = [
        "normal",
        "restricted",
        "quarantined",
        "schema",
        "json",
        "shape",
        "reference",
        "missing",
    ]
    .map(String::from);
    let batch = learning_events_by_ids(&conn, &ids).unwrap();
    assert_eq!(batch.events.len(), 1);
    assert_eq!(batch.events[0].id, "normal");
    assert_eq!(batch.missing_ids, ids[1..]);
    conn.execute(
        "UPDATE learning_events SET consolidation_state = 'pending' WHERE id = 'quarantined'",
        [],
    )
    .unwrap();
    let recovered = learning_events_by_ids(&conn, &["quarantined".into()]).unwrap();
    assert_eq!(recovered.events.len(), 1);
    assert!(recovered.missing_ids.is_empty());
    assert!(learning_observations_verify(&conn).unwrap().consistent);
}

#[test]
fn gateway_checks_unprojected_events_and_preserves_processed_and_ignored_evidence() {
    let (_dir, conn) = open_db();
    for id in ["pending", "processed", "ignored", "corrupt", "future"] {
        insert_reading_question(&conn, id, "2026-08-12T01:00:00Z", "normal");
    }
    conn.execute(
        "UPDATE learning_events SET event_type = 'answer_changed'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE learning_events SET consolidation_state = id WHERE id IN ('processed','ignored')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE learning_events SET content_hash = 'wrong' WHERE id = 'corrupt'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE learning_events SET schema_version = 2 WHERE id = 'future'",
        [],
    )
    .unwrap();
    let report = learning_observations_rebuild(&conn).unwrap();
    assert_eq!(report.output_count, 0);
    assert_eq!(report.quarantined_event_ids, vec!["corrupt", "future"]);
    let ids = ["pending", "processed", "ignored", "corrupt", "future"].map(String::from);
    let batch = learning_events_by_ids(&conn, &ids).unwrap();
    assert_eq!(
        batch
            .events
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        vec!["ignored", "pending", "processed"]
    );
    assert_eq!(batch.missing_ids, vec!["corrupt", "future"]);
    assert!(batch
        .events
        .iter()
        .all(|event| event.trust == "canonical_learning_truth"));
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
        params![id, occurred_at, payload, sha256_hex(&payload), sensitivity,],
    )
    .unwrap();
}

fn sha256_hex(value: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_bytes());
    hex::encode(digest.finalize())
}
