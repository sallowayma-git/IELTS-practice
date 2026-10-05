use ielts_db::{
    learning_observations_rebuild, load_memory_validation_snapshot, migrate, open_connection,
    persist_memory_candidate_batch, promote_memory_candidate, DbOpenOptions,
};
use ielts_domain::{
    Activity, MemoryCandidatePersistenceInput, MemoryMutationProposal, MemoryMutationProposalBatch,
    MemoryNamespace, MemoryPromotionCommand, MemoryProposalDisposition, MemoryScope,
    MemorySourceClass, MEMORY_PROPOSAL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};

// Exercise the production validator without introducing a DB -> application dependency.
#[path = "../../ielts-application/src/memory/validator.rs"]
#[allow(dead_code)]
mod candidate_validator;

fn persist_pending(
    conn: &Connection,
    request_id: &str,
    proposal: MemoryMutationProposal,
) -> String {
    let snapshot =
        load_memory_validation_snapshot(conn, "local", proposal.evidence_observation_ids())
            .unwrap();
    let batch = MemoryMutationProposalBatch {
        schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION,
        proposals: vec![proposal],
    };
    let source_class = MemorySourceClass::Inferred;
    let validation = candidate_validator::MemoryProposalValidator::default().validate(
        &batch,
        candidate_validator::MemoryProposalOrigin::CognitiveRuntime { source_class },
        &snapshot,
    );
    assert!(validation.batch_issues.is_empty());
    assert!(validation.decisions[0].issues.is_empty());
    assert_eq!(
        validation.decisions[0].disposition,
        MemoryProposalDisposition::Pending
    );
    let receipt = persist_memory_candidate_batch(
        conn,
        &MemoryCandidatePersistenceInput {
            request_id: request_id.to_owned(),
            user_id: "local".to_owned(),
            run_id: None,
            source_class,
            batch,
            validation,
            snapshot,
        },
    )
    .unwrap();
    assert_eq!(receipt.candidates[0].disposition, "pending");
    receipt.candidates[0].id.clone()
}

fn approve(conn: &Connection, candidate_id: String) {
    promote_memory_candidate(
        conn,
        &MemoryPromotionCommand {
            candidate_id,
            expected_candidate_version: 1,
            actor_type: "user".to_owned(),
            actor_id: Some("local".to_owned()),
            reason: "Approve changed conclusion".to_owned(),
        },
    )
    .unwrap();
}

#[test]
fn same_key_supersede_approval_replaces_old_conclusion_and_keeps_one_active_identity() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("memory.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let payload = json!({
        "attemptId": "attempt-supersede",
        "assetId": "asset-1",
        "questionId": "question-1",
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
         (id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,
          occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,
          created_at,updated_at)
         VALUES ('event-supersede','local','reading_question_outcome','test','event-supersede',
                 'event-supersede','reading','asset-1','2026-08-13T00:00:00Z',?1,?2,1,
                 'pending','normal','2026-08-13T00:00:00Z','2026-08-13T00:00:00Z')",
        params![payload, hex::encode(Sha256::digest(payload.as_bytes()))],
    )
    .unwrap();
    learning_observations_rebuild(&conn).unwrap();
    let observation_id: String = conn
        .query_row(
            "SELECT id FROM learner_observations WHERE user_id='local' AND namespace='reading'
         ORDER BY id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let key = "strategy.reading.local_evidence";
    let scope = MemoryScope::Activity {
        key: Activity::Reading,
    };
    let original = "Check the nearest sentence before committing.";
    let replacement = "Verify the full paragraph before committing.";
    let add_id = persist_pending(
        &conn,
        "request-original",
        MemoryMutationProposal::Add {
            namespace: MemoryNamespace::Strategy,
            canonical_key: key.to_owned(),
            scope,
            statement: original.to_owned(),
            evidence_observation_ids: vec![observation_id.clone()],
        },
    );
    approve(&conn, add_id);
    let old_id: String = conn
        .query_row(
            "SELECT id FROM memory_items WHERE status='active'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let supersede_id = persist_pending(
        &conn,
        "request-replacement",
        MemoryMutationProposal::Supersede {
            target_memory_id: old_id.clone(),
            namespace: MemoryNamespace::Strategy,
            canonical_key: key.to_owned(),
            scope,
            proposed_statement: replacement.to_owned(),
            evidence_observation_ids: vec![observation_id.clone()],
        },
    );
    let before: (String, String, u64) = conn
        .query_row(
            "SELECT status,content,version FROM memory_items WHERE id=?1",
            [&old_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(before, ("active".to_owned(), original.to_owned(), 1));
    approve(&conn, supersede_id);
    let old: (String, String, u64) = conn
        .query_row(
            "SELECT status,content,version FROM memory_items WHERE id=?1",
            [&old_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(old, ("superseded".to_owned(), original.to_owned(), 2));
    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_items
         WHERE user_id='local' AND namespace='strategy' AND scope=?1 AND canonical_key=?2
           AND status='active'",
            params![scope.storage_key(), key],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(active_count, 1);
    let active: (String, String, String) = conn
        .query_row(
            "SELECT id,content,supersedes_id FROM memory_items WHERE status='active'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_ne!(active.0, old_id);
    assert_eq!(active.1, replacement);
    assert_eq!(active.2, old_id);
    let evidence_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_evidence WHERE memory_id=?1 AND observation_id=?2",
            params![active.0, observation_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(evidence_count, 1);
}
