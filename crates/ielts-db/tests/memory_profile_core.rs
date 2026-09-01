use ielts_db::{
    create_backup_package, forget_memory, learning_observations_rebuild, load_memory_catalog,
    load_memory_validation_snapshot,
    memory_context_preview, migrate, open_connection, persist_memory_candidate_batch,
    promote_memory_candidate, upsert_explicit_preference, DbOpenOptions,
};
use ielts_domain::{
    Activity, ExplicitPreferenceUpsert, MemoryCandidatePersistenceInput, MemoryContextQuery,
    MemoryCatalogQuery, MemoryContextSource, MemoryForgetCommand, MemoryMutationProposal,
    MemoryMutationProposalBatch, MemoryNamespace, MemoryPromotionCommand,
    MemoryProposalDecision, MemoryProposalDisposition, MemoryProposalValidationReport,
    MemoryScope, MemorySourceClass, MEMORY_PROPOSAL_SCHEMA_VERSION,
};
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("memory.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn insert_reading_event(conn: &Connection, id: &str, occurred_at: &str) {
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
         (id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,
          occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,
          created_at,updated_at)
         VALUES (?1,'local','reading_question_outcome','test',?1,?1,'reading','asset-1',
                 ?2,?3,?4,1,'pending','normal',?2,?2)",
        params![id, occurred_at, payload, sha256(&payload)],
    )
    .unwrap();
}

fn first_observation_id(conn: &Connection) -> String {
    learning_observations_rebuild(conn).unwrap();
    conn.query_row(
        "SELECT id FROM learner_observations
         WHERE user_id='local' AND namespace='reading' ORDER BY id LIMIT 1",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn observation_id_for_event(conn: &Connection, event_id: &str) -> String {
    conn.query_row(
        "SELECT observation_id FROM learner_observation_evidence
         WHERE event_id=?1 ORDER BY observation_id LIMIT 1",
        [event_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn pending_input(
    conn: &Connection,
    request_id: &str,
    proposal: MemoryMutationProposal,
    source_class: MemorySourceClass,
) -> MemoryCandidatePersistenceInput {
    let ids = proposal.evidence_observation_ids().to_vec();
    let snapshot = load_memory_validation_snapshot(conn, "local", &ids).unwrap();
    MemoryCandidatePersistenceInput {
        request_id: request_id.into(),
        user_id: "local".into(),
        run_id: None,
        source_class,
        batch: MemoryMutationProposalBatch {
            schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION,
            proposals: vec![proposal],
        },
        validation: MemoryProposalValidationReport {
            schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION,
            batch_issues: Vec::new(),
            decisions: vec![MemoryProposalDecision {
                proposal_index: 0,
                disposition: MemoryProposalDisposition::Pending,
                source_class: Some(source_class),
                issues: Vec::new(),
            }],
        },
        snapshot,
    }
}

fn promote(conn: &Connection, candidate_id: &str, expected_version: u64) {
    promote_memory_candidate(
        conn,
        &MemoryPromotionCommand {
            candidate_id: candidate_id.into(),
            expected_candidate_version: expected_version,
            actor_type: "user".into(),
            actor_id: Some("local".into()),
            reason: "integration test approval".into(),
        },
    )
    .unwrap();
}

#[test]
fn candidate_is_idempotent_evidence_backed_and_never_auto_promotes() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "event-memory-1", "2026-08-13T00:00:00Z");
    let observation_id = first_observation_id(&conn);
    let proposal = MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Strategy,
        canonical_key: "strategy.reading.local_evidence".into(),
        scope: MemoryScope::Activity {
            key: Activity::Reading,
        },
        statement: "Check local evidence before committing.".into(),
        evidence_observation_ids: vec![observation_id],
    };
    let input = pending_input(
        &conn,
        "request-memory-1",
        proposal,
        MemorySourceClass::Predicted,
    );
    let first = persist_memory_candidate_batch(&conn, &input).unwrap();
    assert!(!first.replayed);
    assert_eq!(first.candidates[0].disposition, "pending");
    assert_eq!(count(&conn, "memory_items"), 0, "candidate must not auto-promote");
    assert_eq!(count(&conn, "memory_mutations"), 1);

    let replay = persist_memory_candidate_batch(&conn, &input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.batch_id, first.batch_id);
    assert_eq!(count(&conn, "memory_candidate_batches"), 1);
    assert_eq!(count(&conn, "memory_candidates"), 1);

    promote(&conn, &first.candidates[0].id, 1);
    assert_eq!(count(&conn, "memory_items"), 1);
    assert_eq!(count(&conn, "memory_evidence"), 1);
    assert_eq!(count(&conn, "memory_mutations"), 2);
    let second = promote_memory_candidate(
        &conn,
        &MemoryPromotionCommand {
            candidate_id: first.candidates[0].id.clone(),
            expected_candidate_version: 1,
            actor_type: "user".into(),
            actor_id: None,
            reason: "concurrent loser".into(),
        },
    );
    assert!(second.is_err());
    assert_eq!(count(&conn, "memory_items"), 1);
    assert_eq!(count(&conn, "memory_mutations"), 2);
}

#[test]
fn catalog_lists_active_items_with_evidence_and_hides_private() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "event-catalog-1", "2026-08-13T00:00:00Z");
    let observation_id = first_observation_id(&conn);
    let proposal = MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Strategy,
        canonical_key: "strategy.reading.catalog".into(),
        scope: MemoryScope::Activity {
            key: Activity::Reading,
        },
        statement: "Catalog entry: check evidence first.".into(),
        evidence_observation_ids: vec![observation_id.clone()],
    };
    let input = pending_input(&conn, "request-catalog-1", proposal, MemorySourceClass::Inferred);
    let batch = persist_memory_candidate_batch(&conn, &input).unwrap();
    promote(&conn, &batch.candidates[0].id, 1);
    // Mark the item private: it must never reach the catalog read path.
    let memory_id: String = conn
        .query_row("SELECT id FROM memory_items LIMIT 1", [], |row| row.get(0))
        .unwrap();
    conn.execute(
        "UPDATE memory_items SET sensitivity='private' WHERE id=?1",
        [&memory_id],
    )
    .unwrap();

    let catalog = load_memory_catalog(
        &conn,
        &MemoryCatalogQuery {
            user_id: "local".into(),
            include_archived: false,
            limit: 100,
        },
    )
    .unwrap();
    assert!(
        catalog.entries.is_empty(),
        "private rows must not leave the store"
    );

    conn.execute(
        "UPDATE memory_items SET sensitivity='normal' WHERE id=?1",
        [&memory_id],
    )
    .unwrap();
    let catalog = load_memory_catalog(
        &conn,
        &MemoryCatalogQuery {
            user_id: "local".into(),
            include_archived: false,
            limit: 100,
        },
    )
    .unwrap();
    assert_eq!(catalog.entries.len(), 1);
    let entry = &catalog.entries[0];
    assert_eq!(entry.id, memory_id);
    assert_eq!(entry.namespace, "strategy");
    assert_eq!(entry.status, "active");
    assert_eq!(entry.source_class, "inferred");
    assert_eq!(entry.support_count, 1, "evidence join feeds the support count");
    assert_eq!(entry.evidence_observation_ids, vec![observation_id]);
}

#[test]
fn improve_regress_archive_and_rebuild_preserve_lineage_and_context_rules() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "event-memory-flow", "2026-08-13T01:00:00Z");
    let observation_id = first_observation_id(&conn);
    let add = pending_input(
        &conn,
        "request-add",
        MemoryMutationProposal::Add {
            namespace: MemoryNamespace::Behavior,
            canonical_key: "behavior.reading.premature_commitment".into(),
            scope: MemoryScope::Activity {
                key: Activity::Reading,
            },
            statement: "Commits before checking local evidence.".into(),
            evidence_observation_ids: vec![observation_id.clone()],
        },
        MemorySourceClass::Inferred,
    );
    let add_receipt = persist_memory_candidate_batch(&conn, &add).unwrap();
    let promoted = promote_memory_candidate(
        &conn,
        &MemoryPromotionCommand {
            candidate_id: add_receipt.candidates[0].id.clone(),
            expected_candidate_version: 1,
            actor_type: "user".into(),
            actor_id: None,
            reason: "approve observed pattern".into(),
        },
    )
    .unwrap();
    let memory_id = promoted.memory_id.unwrap();

    insert_reading_event(&conn, "event-memory-flow-2", "2026-08-13T01:01:00Z");
    learning_observations_rebuild(&conn).unwrap();
    let second_observation_id = observation_id_for_event(&conn, "event-memory-flow-2");
    let reinforce = pending_input(
        &conn,
        "request-reinforce",
        MemoryMutationProposal::Reinforce {
            target_memory_id: memory_id.clone(),
            evidence_observation_ids: vec![second_observation_id.clone()],
        },
        MemorySourceClass::Inferred,
    );
    let reinforce_receipt = persist_memory_candidate_batch(&conn, &reinforce).unwrap();
    promote(&conn, &reinforce_receipt.candidates[0].id, 1);
    assert_eq!(count(&conn, "memory_evidence"), 2);

    let refine = pending_input(
        &conn,
        "request-refine",
        MemoryMutationProposal::Refine {
            target_memory_id: memory_id.clone(),
            proposed_statement: "Checks passage evidence before committing.".into(),
            evidence_observation_ids: vec![second_observation_id.clone()],
        },
        MemorySourceClass::Inferred,
    );
    let refine_receipt = persist_memory_candidate_batch(&conn, &refine).unwrap();
    promote(&conn, &refine_receipt.candidates[0].id, 1);
    assert_eq!(
        memory_field(&conn, &memory_id, "content"),
        "Checks passage evidence before committing."
    );

    let improve = pending_input(
        &conn,
        "request-improve",
        MemoryMutationProposal::Improve {
            target_memory_id: memory_id.clone(),
            evidence_observation_ids: vec![second_observation_id.clone()],
        },
        MemorySourceClass::Observed,
    );
    // The persistence boundary rejects a cognitive runtime claiming observed.
    assert!(persist_memory_candidate_batch(&conn, &improve).is_err());
    let mut improve = improve;
    improve.source_class = MemorySourceClass::Inferred;
    improve.validation.decisions[0].source_class = Some(MemorySourceClass::Inferred);
    let improve_receipt = persist_memory_candidate_batch(&conn, &improve).unwrap();
    promote(&conn, &improve_receipt.candidates[0].id, 1);
    assert_eq!(memory_field(&conn, &memory_id, "improvement_state"), "improved");

    let regress = pending_input(
        &conn,
        "request-regress",
        MemoryMutationProposal::Regress {
            target_memory_id: memory_id.clone(),
            evidence_observation_ids: vec![second_observation_id.clone()],
        },
        MemorySourceClass::Inferred,
    );
    let regress_receipt = persist_memory_candidate_batch(&conn, &regress).unwrap();
    promote(&conn, &regress_receipt.candidates[0].id, 1);
    assert_eq!(memory_field(&conn, &memory_id, "improvement_state"), "regressed");

    learning_observations_rebuild(&conn).unwrap();
    assert_eq!(memory_field(&conn, &memory_id, "status"), "active");
    assert!(count(&conn, "memory_evidence") >= 1);

    let archive = pending_input(
        &conn,
        "request-archive",
        MemoryMutationProposal::Archive {
            target_memory_id: memory_id.clone(),
            evidence_observation_ids: vec![observation_id],
        },
        MemorySourceClass::Inferred,
    );
    let archive_receipt = persist_memory_candidate_batch(&conn, &archive).unwrap();
    promote(&conn, &archive_receipt.candidates[0].id, 1);
    let preview = memory_context_preview(
        &conn,
        &MemoryContextQuery {
            user_id: "local".into(),
            activity: Activity::Reading,
            current_instruction: None,
            limit: 50,
        },
    )
    .unwrap();
    assert!(!preview.entries.iter().any(|entry| entry.id.as_deref() == Some(&memory_id)));
}

#[test]
fn explicit_priority_and_forget_are_deterministic() {
    let (_dir, conn) = open_db();
    upsert_explicit_preference(
        &conn,
        &ExplicitPreferenceUpsert {
            user_id: "local".into(),
            preference_key: "teaching.explanation_style".into(),
            scope: "global".into(),
            value: json!("example_first"),
            source: "user".into(),
        },
    )
    .unwrap();
    insert_reading_event(&conn, "event-context", "2026-08-13T02:00:00Z");
    let observation_id = first_observation_id(&conn);
    let add = pending_input(
        &conn,
        "request-context-add",
        MemoryMutationProposal::Add {
            namespace: MemoryNamespace::Strategy,
            canonical_key: "strategy.reading.context_active".into(),
            scope: MemoryScope::Activity {
                key: Activity::Reading,
            },
            statement: "Use passage evidence.".into(),
            evidence_observation_ids: vec![observation_id.clone()],
        },
        MemorySourceClass::Inferred,
    );
    let receipt = persist_memory_candidate_batch(&conn, &add).unwrap();
    let promoted = promote_memory_candidate(
        &conn,
        &MemoryPromotionCommand {
            candidate_id: receipt.candidates[0].id.clone(),
            expected_candidate_version: 1,
            actor_type: "user".into(),
            actor_id: None,
            reason: "approve".into(),
        },
    )
    .unwrap();
    let memory_id = promoted.memory_id.unwrap();

    let hypothesis = pending_input(
        &conn,
        "request-context-predicted",
        MemoryMutationProposal::Add {
            namespace: MemoryNamespace::Metacognition,
            canonical_key: "metacognition.reading.overconfidence".into(),
            scope: MemoryScope::Activity {
                key: Activity::Reading,
            },
            statement: "May be overconfident.".into(),
            evidence_observation_ids: vec![observation_id],
        },
        MemorySourceClass::Predicted,
    );
    persist_memory_candidate_batch(&conn, &hypothesis).unwrap();
    let preview = memory_context_preview(
        &conn,
        &MemoryContextQuery {
            user_id: "local".into(),
            activity: Activity::Reading,
            current_instruction: Some("Give the conclusion first.".into()),
            limit: 50,
        },
    )
    .unwrap();
    assert_eq!(preview.entries[0].source, MemoryContextSource::CurrentInstruction);
    assert_eq!(preview.entries[1].source, MemoryContextSource::ExplicitPreference);
    assert!(preview
        .entries
        .iter()
        .any(|entry| entry.source == MemoryContextSource::ActiveMemory));
    assert!(preview.entries.iter().any(|entry| {
        entry.source == MemoryContextSource::PredictedHypothesis && entry.pending_verification
    }));

    let version = conn
        .query_row(
            "SELECT version FROM memory_items WHERE id=?1",
            [&memory_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap() as u64;
    forget_memory(
        &conn,
        &MemoryForgetCommand {
            memory_id: memory_id.clone(),
            expected_version: version,
            actor_type: "user".into(),
            actor_id: None,
            reason: "user requested forget".into(),
        },
    )
    .unwrap();
    let after = memory_context_preview(
        &conn,
        &MemoryContextQuery {
            user_id: "local".into(),
            activity: Activity::Reading,
            current_instruction: None,
            limit: 50,
        },
    )
    .unwrap();
    assert!(!after.entries.iter().any(|entry| entry.id.as_deref() == Some(&memory_id)));
    assert_eq!(memory_field(&conn, &memory_id, "content"), "[deleted]");
    assert_eq!(memory_field(&conn, &memory_id, "canonical_key"), "redacted");
    assert_eq!(memory_field(&conn, &memory_id, "normalized_label"), "redacted");
    let subject_key: Option<String> = conn
        .query_row(
            "SELECT subject_key FROM memory_items WHERE id=?1",
            [&memory_id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(subject_key.is_none());
    let serialized_backup = serde_json::to_string(&create_backup_package(&conn, "privacy-test").unwrap())
        .unwrap();
    assert!(!serialized_backup.contains("Use passage evidence."));
    // The promotion reason ("approve" / "approve observed pattern") must be
    // redacted from `memory_mutations.reason` on forget. The check uses the
    // JSON-encoded value `"approve"` (with quotes) so it matches the stored
    // reason value but not the M11 `approved_by` column name, which is a
    // legitimate schema field rather than leaked user text.
    assert!(!serialized_backup.contains("\"approve\""));
    assert!(!serialized_backup.contains("approve observed pattern"));
    assert!(!serialized_backup.contains("user requested forget"));
    let leaked_candidate_text: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_candidates
             WHERE (target_memory_id=?1 OR resolved_memory_id=?1)
               AND (proposed_statement IS NOT NULL OR proposal_json IS NOT NULL)",
            [&memory_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(leaked_candidate_text, 0);
    let mutation_snapshots: Vec<(Option<String>, Option<String>)> = {
        let mut statement = conn
            .prepare(
                "SELECT before_json,after_json FROM memory_mutations
                 WHERE memory_id=?1 ORDER BY created_at,id",
            )
            .unwrap();
        statement
            .query_map([&memory_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert!(!mutation_snapshots.is_empty());
    for (before, after) in mutation_snapshots {
        for snapshot in [before, after].into_iter().flatten() {
            assert!(!snapshot.contains("Use passage evidence."));
            assert!(!snapshot.contains("\"content\""));
        }
    }
}

#[test]
fn active_memory_capacity_fails_without_partial_promotion() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "event-capacity", "2026-08-13T03:00:00Z");
    let observation_id = first_observation_id(&conn);
    for index in 0..128 {
        conn.execute(
            "INSERT INTO memory_items (
               id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
               source_class,confidence,importance,source_trust,sensitivity,improvement_state,
               version,created_by,content_hash,created_at,updated_at
             ) VALUES (?1,'local','strategy','activity:reading','procedural',?2,?3,?3,'active',
                       'observed',0.8,0.5,1.0,'normal','baseline',1,'test',?4,?5,?5)",
            params![
                format!("mem-capacity-{index}"),
                format!("strategy.reading.capacity_{index}"),
                format!("capacity {index}"),
                sha256(&format!("capacity {index}")),
                "2026-08-13T03:00:00Z",
            ],
        )
        .unwrap();
    }
    let input = pending_input(
        &conn,
        "request-capacity",
        MemoryMutationProposal::Add {
            namespace: MemoryNamespace::Strategy,
            canonical_key: "strategy.reading.over_capacity".into(),
            scope: MemoryScope::Activity {
                key: Activity::Reading,
            },
            statement: "This must remain pending.".into(),
            evidence_observation_ids: vec![observation_id],
        },
        MemorySourceClass::Inferred,
    );
    let receipt = persist_memory_candidate_batch(&conn, &input).unwrap();
    let result = promote_memory_candidate(
        &conn,
        &MemoryPromotionCommand {
            candidate_id: receipt.candidates[0].id.clone(),
            expected_candidate_version: 1,
            actor_type: "user".into(),
            actor_id: None,
            reason: "capacity test".into(),
        },
    );
    assert!(result.is_err());
    assert_eq!(count(&conn, "memory_items"), 128);
    assert_eq!(
        conn.query_row(
            "SELECT disposition FROM memory_candidates WHERE id=?1",
            [&receipt.candidates[0].id],
            |row| row.get::<_, String>(0),
        )
        .unwrap(),
        "pending"
    );
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
        .unwrap()
}

fn memory_field(conn: &Connection, memory_id: &str, field: &str) -> String {
    conn.query_row(
        &format!("SELECT {field} FROM memory_items WHERE id=?1"),
        [memory_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn sha256(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
