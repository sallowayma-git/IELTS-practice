//! Capacity governance and the preference/goal namespaces. Preference and goal
//! memories are shielded from every other namespace's eviction; the model's own
//! must therefore be bounded, or they could fill a scope that nothing may
//! displace and stop the weekly consolidation from ever adding again.
use ielts_db::{
    learning_observations_rebuild, load_memory_validation_snapshot, migrate, open_connection,
    persist_memory_candidate_batch, promote_memory_candidate, DbOpenOptions,
};
use ielts_domain::{
    Activity, MemoryCandidatePersistenceInput, MemoryMutationProposal, MemoryMutationProposalBatch,
    MemoryNamespace, MemoryProposalDecision, MemoryProposalDisposition, MemoryProposalValidationReport,
    MemoryPromotionCommand, MemoryScope, MemorySourceClass, MAX_ACTIVE_MEMORY_PER_SCOPE,
    MAX_DERIVED_PREFERENCE_MEMORIES_PER_SCOPE, MEMORY_PROPOSAL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("capacity.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn sha256(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn observation(conn: &Connection) -> String {
    let payload = json!({
        "attemptId": "attempt-1", "assetId": "asset-1", "questionId": "question-1", "attemptOrdinal": 1,
        "isCorrect": false, "questionKind": "mcq", "changeCount": 1, "visitCount": 2, "elapsedMs": 900,
        "firstTryCorrect": false
    })
    .to_string();
    conn.execute(
        "INSERT INTO learning_events
         (id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,
          occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,
          created_at,updated_at)
         VALUES ('event-1','local','reading_question_outcome','test','event-1','event-1','reading','asset-1',
                 '2026-08-13T03:00:00Z',?1,?2,1,'pending','normal','2026-08-13T03:00:00Z','2026-08-13T03:00:00Z')",
        params![payload, sha256(&payload)],
    )
    .unwrap();
    learning_observations_rebuild(conn).unwrap();
    conn.query_row("SELECT id FROM learner_observations WHERE namespace='reading' ORDER BY id LIMIT 1", [], |row| row.get(0))
        .unwrap()
}

/// A scope at capacity: every memory is an observed strategy of equal value.
fn full_scope(conn: &Connection) {
    for index in 0..MAX_ACTIVE_MEMORY_PER_SCOPE {
        let id = format!("mem-capacity-{index}");
        let key = format!("strategy.reading.capacity_{index}");
        conn.execute(
            "INSERT INTO memory_items (
               id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
               source_class,confidence,importance,source_trust,sensitivity,improvement_state,
               last_observed_at,version,created_by,content_hash,created_at,updated_at
             ) VALUES (?1,'local','strategy','activity:reading','procedural',?2,?2,?2,'active',
                       'observed',0.8,0.5,1.0,'normal','baseline',
                       '2026-08-13T03:00:00Z',1,'test',?3,'2026-08-13T03:00:00Z','2026-08-13T03:00:00Z')",
            params![id, key, sha256(&key)],
        )
        .unwrap();
    }
}

fn make_preferences(conn: &Connection, count: usize, source_class: &str) {
    for index in 0..count {
        conn.execute(
            "UPDATE memory_items SET namespace='preference', source_class=?2 WHERE id=?1",
            params![format!("mem-capacity-{index}"), source_class],
        )
        .unwrap();
    }
}

fn status(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT status FROM memory_items WHERE id=?1", [id], |row| row.get(0)).unwrap()
}

fn active_in_scope(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM memory_items WHERE scope='activity:reading' AND status='active'", [], |row| row.get(0))
        .unwrap()
}

/// The weekly dream's ADD of a preference memory, promoted; returns the new memory id.
fn add_preference(conn: &Connection, evidence: &str, key: &str) -> String {
    let proposal = MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Preference,
        canonical_key: key.into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        statement: format!("{key} statement."),
        evidence_observation_ids: vec![evidence.into()],
        horizon: None,
    };
    let snapshot = load_memory_validation_snapshot(conn, "local", &[evidence.to_owned()]).unwrap();
    let receipt = persist_memory_candidate_batch(
        conn,
        &MemoryCandidatePersistenceInput {
            request_id: format!("request-{key}"),
            user_id: "local".into(),
            run_id: None,
            source_class: MemorySourceClass::Consolidated,
            batch: MemoryMutationProposalBatch { schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION, proposals: vec![proposal] },
            validation: MemoryProposalValidationReport {
                schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION,
                batch_issues: Vec::new(),
                decisions: vec![MemoryProposalDecision {
                    proposal_index: 0,
                    disposition: MemoryProposalDisposition::Pending,
                    source_class: Some(MemorySourceClass::Consolidated),
                    issues: Vec::new(),
                }],
            },
            snapshot,
        },
    )
    .unwrap();
    let candidate = &receipt.candidates[0];
    promote_memory_candidate(
        conn,
        &MemoryPromotionCommand {
            candidate_id: candidate.id.clone(),
            expected_candidate_version: 1,
            actor_type: "dream".into(),
            actor_id: Some("weekly_dream".into()),
            reason: "weekly dream".into(),
        },
    )
    .unwrap();
    conn.query_row("SELECT resolved_memory_id FROM memory_candidates WHERE id=?1", [&candidate.id], |row| row.get(0)).unwrap()
}

#[test]
fn model_derived_preferences_are_capped_and_a_new_one_displaces_the_weakest_preference_only() {
    let (_dir, conn) = open_db();
    let evidence = observation(&conn);
    full_scope(&conn);
    make_preferences(&conn, MAX_DERIVED_PREFERENCE_MEMORIES_PER_SCOPE, "consolidated");
    conn.execute("UPDATE memory_items SET importance=0.1 WHERE id='mem-capacity-5'", []).unwrap();
    // A strategy that would lose to any preference on value alone: it must still not be charged.
    conn.execute("UPDATE memory_items SET importance=0.0 WHERE id='mem-capacity-90'", []).unwrap();

    let added = add_preference(&conn, &evidence, "preference.reading.new_wish");

    assert_eq!(status(&conn, "mem-capacity-5"), "archived", "the weakest derived preference pays");
    assert_eq!(status(&conn, "mem-capacity-90"), "active", "other namespaces are not charged for it");
    assert_eq!(status(&conn, &added), "active");
    assert_eq!(active_in_scope(&conn), MAX_ACTIVE_MEMORY_PER_SCOPE as i64);
    let reason: String = conn
        .query_row("SELECT reason FROM memory_mutations WHERE memory_id='mem-capacity-5' AND operation='archive'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(reason, "capacity");
}

#[test]
fn below_the_cap_a_new_preference_displaces_nothing() {
    let (_dir, conn) = open_db();
    let evidence = observation(&conn);
    full_scope(&conn);
    conn.execute("DELETE FROM memory_items WHERE id='mem-capacity-127'", []).unwrap();
    make_preferences(&conn, MAX_DERIVED_PREFERENCE_MEMORIES_PER_SCOPE - 1, "consolidated");

    add_preference(&conn, &evidence, "preference.reading.new_wish");

    let archived: i64 = conn.query_row("SELECT COUNT(*) FROM memory_items WHERE status='archived'", [], |row| row.get(0)).unwrap();
    assert_eq!(archived, 0);
    assert_eq!(active_in_scope(&conn), MAX_ACTIVE_MEMORY_PER_SCOPE as i64);
}

#[test]
fn the_learners_own_preferences_do_not_count_toward_the_cap_and_are_never_displaced() {
    let (_dir, conn) = open_db();
    let evidence = observation(&conn);
    full_scope(&conn);
    make_preferences(&conn, 40, "user_explicit");
    conn.execute("UPDATE memory_items SET importance=0.1 WHERE id='mem-capacity-90'", []).unwrap();

    add_preference(&conn, &evidence, "preference.reading.new_wish");

    for index in 0..40 {
        assert_eq!(status(&conn, &format!("mem-capacity-{index}")), "active");
    }
    assert_eq!(status(&conn, "mem-capacity-90"), "archived", "the ordinary full-scope rule applies");
    assert_eq!(active_in_scope(&conn), MAX_ACTIVE_MEMORY_PER_SCOPE as i64);
}

#[test]
fn a_scope_the_model_filled_with_preferences_can_still_take_a_new_preference() {
    let (_dir, conn) = open_db();
    let evidence = observation(&conn);
    full_scope(&conn);
    make_preferences(&conn, MAX_ACTIVE_MEMORY_PER_SCOPE, "consolidated");
    conn.execute("UPDATE memory_items SET importance=0.1 WHERE id='mem-capacity-9'", []).unwrap();

    let added = add_preference(&conn, &evidence, "preference.reading.new_wish");

    assert_eq!(status(&conn, "mem-capacity-9"), "archived");
    assert_eq!(status(&conn, &added), "active");
    assert_eq!(active_in_scope(&conn), MAX_ACTIVE_MEMORY_PER_SCOPE as i64);
}
