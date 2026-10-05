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

// Compile the production validator without reversing the application -> DB
// dependency or changing either crate's manifest.
#[path = "../../ielts-application/src/memory/validator.rs"]
#[allow(dead_code)]
mod candidate_validator;

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

    insert_reading_event(&conn, "event-memory-flow-3", "2026-08-13T01:02:00Z");
    learning_observations_rebuild(&conn).unwrap();
    let third_observation_id = observation_id_for_event(&conn, "event-memory-flow-3");
    let improve = pending_input(
        &conn,
        "request-improve",
        MemoryMutationProposal::Improve {
            target_memory_id: memory_id.clone(),
            evidence_observation_ids: vec![third_observation_id],
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

    insert_reading_event(&conn, "event-memory-flow-4", "2026-08-13T01:03:00Z");
    learning_observations_rebuild(&conn).unwrap();
    let fourth_observation_id = observation_id_for_event(&conn, "event-memory-flow-4");
    let regress = pending_input(
        &conn,
        "request-regress",
        MemoryMutationProposal::Regress {
            target_memory_id: memory_id.clone(),
            evidence_observation_ids: vec![fourth_observation_id],
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
fn forgotten_approved_candidate_key_and_label_are_absent_from_backup() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "event-forget-candidate", "2026-08-13T03:00:00Z");
    let observation_id = first_observation_id(&conn);
    let forgotten_key = "strategy.reading.private_quiet_feedback";
    let forgotten_label = "private quiet feedback";
    let forgotten_statement = "Privately prefer quiet feedback before reading.";
    let retained_key = "strategy.reading.retained_evidence_check";
    let retained_statement = "Keep checking passage evidence before answering.";
    let mut approved = Vec::new();
    for (request_id, key, statement) in [
        ("request-forget-candidate", forgotten_key, forgotten_statement),
        ("request-retain-candidate", retained_key, retained_statement),
    ] {
        let input = pending_input(
            &conn,
            request_id,
            MemoryMutationProposal::Add {
                namespace: MemoryNamespace::Strategy,
                canonical_key: key.into(),
                scope: MemoryScope::Activity { key: Activity::Reading },
                statement: statement.into(),
                evidence_observation_ids: vec![observation_id.clone()],
            },
            MemorySourceClass::Inferred,
        );
        let batch = persist_memory_candidate_batch(&conn, &input).unwrap();
        let candidate_id = batch.candidates[0].id.clone();
        promote(&conn, &candidate_id, 1);
        let memory_id: String = conn.query_row(
            "SELECT resolved_memory_id FROM memory_candidates WHERE id=?1 AND disposition='promoted'",
            [&candidate_id],
            |row| row.get(0),
        ).unwrap();
        approved.push((candidate_id, memory_id));
    }
    let before = serde_json::to_string(&create_backup_package(&conn, "before-forget").unwrap())
        .unwrap();
    for text in [forgotten_key, forgotten_label, forgotten_statement, retained_key, retained_statement] {
        assert!(before.contains(text), "backup fixture must contain {text}");
    }
    let (candidate_id, memory_id) = &approved[0];
    forget_memory(&conn, &MemoryForgetCommand {
        memory_id: memory_id.clone(),
        expected_version: 1,
        actor_type: "user".into(),
        actor_id: None,
        reason: "forget private feedback preference".into(),
    }).unwrap();
    let candidate_fields: (Option<String>, Option<String>) = conn.query_row(
        "SELECT canonical_key,normalized_label FROM memory_candidates WHERE id=?1",
        [candidate_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(candidate_fields, (None, None));
    let after = serde_json::to_string(&create_backup_package(&conn, "after-forget").unwrap())
        .unwrap();
    for text in [forgotten_key, forgotten_label, forgotten_statement] {
        assert!(!after.contains(text), "forgotten candidate leaked {text}");
    }
    for text in [retained_key, "retained evidence check", retained_statement] {
        assert!(after.contains(text), "unrelated memory lost {text}");
    }
    assert_eq!(memory_field(&conn, &approved[1].1, "status"), "active");
}

#[test]
fn forgetting_superseded_target_keeps_replacement_candidate_identity() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "supersede-forget-event", "2026-08-13T03:00:00Z");
    let observation = first_observation_id(&conn);
    let add = validated_candidate(&conn, "supersede-forget-add", MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Strategy, canonical_key: "strategy.reading.old_check".into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        statement: "Check the sentence.".into(), evidence_observation_ids: vec![observation.clone()],
    });
    promote(&conn, &add, 1);
    let old: String = conn.query_row("SELECT resolved_memory_id FROM memory_candidates WHERE id=?1", [&add], |r| r.get(0)).unwrap();
    let replacement = validated_candidate(&conn, "supersede-forget-new", MemoryMutationProposal::Supersede {
        target_memory_id: old.clone(), namespace: MemoryNamespace::Strategy,
        canonical_key: "strategy.reading.new_check".into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        proposed_statement: "Check the whole paragraph.".into(), evidence_observation_ids: vec![observation],
    });
    promote(&conn, &replacement, 1);
    let fields = || conn.query_row(
        "SELECT canonical_key,normalized_label FROM memory_candidates WHERE id=?1", [&replacement],
        |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?))).unwrap();
    let before = fields();
    assert!(before.0.is_some() && before.1.is_some());
    forget_memory(&conn, &MemoryForgetCommand { memory_id: old, expected_version: 2,
        actor_type: "user".into(), actor_id: None, reason: "forget old check".into() }).unwrap();
    assert_eq!(fields(), before);
    let new: String = conn.query_row("SELECT resolved_memory_id FROM memory_candidates WHERE id=?1", [&replacement], |r| r.get(0)).unwrap();
    assert_eq!(memory_field(&conn, &new, "status"), "active");
    assert_eq!(memory_field(&conn, &new, "canonical_key"), "strategy.reading.new_check");
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

#[test]
fn user_archive_preserves_content_evidence_and_rejects_stale_version() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "event-archive", "2026-08-13T00:00:00Z");
    let observation_id = first_observation_id(&conn);
    let input = pending_input(&conn, "request-user-archive", MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Strategy,
        canonical_key: "strategy.reading.archive".into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        statement: "Preserve this evidence on archive.".into(),
        evidence_observation_ids: vec![observation_id],
    }, MemorySourceClass::Inferred);
    let receipt = persist_memory_candidate_batch(&conn, &input).unwrap();
    promote(&conn, &receipt.candidates[0].id, 1);
    let id: String = conn.query_row("SELECT id FROM memory_items", [], |r| r.get(0)).unwrap();
    let evidence_count = count(&conn, "memory_evidence");
    let facts_count = count(&conn, "learning_events");
    let command = ielts_domain::MemoryArchiveCommand {
        memory_id: id.clone(), expected_version: 1, actor_type: "user".into(),
        actor_id: Some("local".into()), reason: "archive without forgetting".into(),
    };
    ielts_db::archive_memory(&conn, &command).unwrap();
    assert_eq!(memory_field(&conn, &id, "status"), "archived");
    assert_eq!(memory_field(&conn, &id, "content"), "Preserve this evidence on archive.");
    assert_eq!(count(&conn, "memory_evidence"), evidence_count);
    assert_eq!(count(&conn, "learning_events"), facts_count);
    let catalog = load_memory_catalog(&conn, &MemoryCatalogQuery {
        user_id: "local".into(), include_archived: true, limit: 100,
    }).unwrap();
    assert!(catalog.entries.iter().any(|e| e.id == id && !e.evidence_observation_ids.is_empty()));
    let context = memory_context_preview(&conn, &MemoryContextQuery {
        user_id: "local".into(), activity: Activity::Reading, current_instruction: None, limit: 50,
    }).unwrap();
    assert!(!context.entries.iter().any(|e| e.id.as_deref() == Some(id.as_str())));
    let audits = count(&conn, "memory_mutations");
    assert!(ielts_db::archive_memory(&conn, &command).is_err());
    assert_eq!(count(&conn, "memory_mutations"), audits);
    assert!(serde_json::to_string(&create_backup_package(&conn, "archive-test").unwrap())
        .unwrap().contains("Preserve this evidence on archive."));
}

fn validated_candidate(conn: &Connection, request: &str, proposal: MemoryMutationProposal) -> String {
    let mut input = pending_input(conn, request, proposal, MemorySourceClass::Inferred);
    input.validation = candidate_validator::MemoryProposalValidator::default().validate(
        &input.batch,
        candidate_validator::MemoryProposalOrigin::CognitiveRuntime {
            source_class: MemorySourceClass::Inferred,
        },
        &input.snapshot,
    );
    assert!(input.validation.batch_issues.is_empty());
    assert_eq!(input.validation.decisions[0].disposition, MemoryProposalDisposition::Pending,
        "{:?}", input.validation);
    persist_memory_candidate_batch(conn, &input).unwrap().candidates[0].id.clone()
}

fn lifecycle_proposal(action: &str, memory: &str, ids: Vec<String>) -> MemoryMutationProposal {
    match action {
        "REINFORCE" => MemoryMutationProposal::Reinforce {
            target_memory_id: memory.into(), evidence_observation_ids: ids,
        },
        "IMPROVE" => MemoryMutationProposal::Improve {
            target_memory_id: memory.into(), evidence_observation_ids: ids,
        },
        "REGRESS" => MemoryMutationProposal::Regress {
            target_memory_id: memory.into(), evidence_observation_ids: ids,
        },
        _ => panic!("unexpected lifecycle action"),
    }
}

fn lifecycle_tables(conn: &Connection) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
    ["memory_items", "memory_evidence", "memory_candidates",
        "memory_candidate_batches", "memory_mutations"].into_iter().map(|table| {
        let mut statement = conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).unwrap();
        let columns = statement.column_count();
        statement.query_map([], |row| {
            (0..columns).map(|index| row.get(index)).collect::<Result<Vec<_>, _>>()
        }).unwrap().collect::<Result<Vec<_>, _>>().unwrap()
    }).collect()
}

fn reject_lifecycle_promotion(conn: &Connection, candidate: &str, expected_error: &str) {
    let before = lifecycle_tables(conn);
    let error = promote_memory_candidate(conn, &MemoryPromotionCommand {
        candidate_id: candidate.into(), expected_candidate_version: 1,
        actor_type: "user".into(), actor_id: Some("local".into()), reason: "reject stale facts".into(),
    }).unwrap_err();
    assert!(error.to_string().contains(expected_error), "{error}");
    assert_eq!(lifecycle_tables(conn), before,
        "failed promotion must preserve every memory, candidate, evidence and audit field");
}

fn submit_lifecycle_observation(conn: &Connection, attempt: &str, answer: &str) -> String {
    let result = ielts_db::submit_reading_attempt(conn, &serde_json::from_value(json!({
        "attemptId": attempt, "assetId": "lifecycle-asset", "answers": {"q1": answer},
        "idempotencyKey": attempt,
    })).unwrap()).unwrap();
    assert_eq!(result.attempt.answers[0].is_correct, Some(answer == "TRUE"));
    learning_observations_rebuild(conn).unwrap();
    conn.query_row(
        "SELECT o.id FROM learner_observations o
         JOIN learner_observation_evidence oe ON oe.observation_id=o.id
         JOIN learning_events e ON e.id=oe.event_id
         WHERE json_extract(e.payload_json,'$.attemptId')=?1
           AND o.observation_type='reading.question.outcome'",
        [attempt], |row| row.get(0),
    ).unwrap()
}

#[test]
fn real_submissions_require_new_observations_for_each_lifecycle_transition() {
    let (dir, conn) = open_db();
    let asset_path = dir.path().join("lifecycle.json");
    std::fs::write(&asset_path, serde_json::to_vec(&json!({
        "examId": "lifecycle-asset", "meta": {"title": "Lifecycle evidence", "category": "P1"},
        "questionCount": 1, "questionOrder": ["q1"], "answerKey": {"q1": "TRUE"},
        "passage": {"blocks": [{"html": "<p>The statement is true.</p>"}]},
        "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]}],
    })).unwrap()).unwrap();
    ielts_db::import_asset_payload_file(&conn, &asset_path).unwrap();
    let baseline = submit_lifecycle_observation(&conn, "lifecycle-baseline", "FALSE");
    let add = validated_candidate(&conn, "real-add", MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Behavior,
        canonical_key: "behavior.reading.premature_commitment".into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        statement: "Commits before checking passage evidence.".into(),
        evidence_observation_ids: vec![baseline.clone()],
    });
    promote(&conn, &add, 1);
    let memory: String = conn.query_row("SELECT id FROM memory_items", [], |row| row.get(0)).unwrap();
    for action in ["REINFORCE", "IMPROVE", "REGRESS"] {
        let candidate = validated_candidate(&conn, &format!("baseline-reuse-{action}"),
            lifecycle_proposal(action, &memory, vec![baseline.clone()]));
        reject_lifecycle_promotion(&conn, &candidate, "requires new evidence observed after");
    }
    // Another observation from the same submission has a different ID but
    // the same observedAt. It is not a subsequent lifecycle fact.
    let sibling: String = conn.query_row(
        "SELECT o.id FROM learner_observations o
         JOIN learner_observation_evidence oe ON oe.observation_id=o.id
         JOIN learning_events e ON e.id=oe.event_id
         WHERE json_extract(e.payload_json,'$.attemptId')='lifecycle-baseline'
           AND o.id!=?1 ORDER BY o.id LIMIT 1",
        [&baseline], |row| row.get(0),
    ).unwrap();
    for action in ["REINFORCE", "IMPROVE", "REGRESS"] {
        let candidate = validated_candidate(&conn, &format!("same-submit-{action}"),
            lifecycle_proposal(action, &memory, vec![sibling.clone()]));
        reject_lifecycle_promotion(&conn, &candidate, "requires new evidence observed after");
    }

    let improved = submit_lifecycle_observation(&conn, "lifecycle-improved", "TRUE");
    let candidate = validated_candidate(&conn, "real-improve",
        lifecycle_proposal("IMPROVE", &memory, vec![baseline.clone(), improved.clone()]));
    // Even valid new observations must actually insert durable evidence.
    conn.execute_batch(&format!(
        "CREATE TRIGGER ignore_lifecycle_evidence BEFORE INSERT ON memory_evidence
         WHEN NEW.observation_id='{improved}' BEGIN SELECT RAISE(IGNORE); END;"
    )).unwrap();
    reject_lifecycle_promotion(&conn, &candidate, "requires at least one new independent evidence");
    conn.execute_batch("DROP TRIGGER ignore_lifecycle_evidence;").unwrap();
    promote(&conn, &candidate, 1);
    assert_eq!(memory_field(&conn, &memory, "improvement_state"), "improved");
    assert_eq!(count(&conn, "memory_evidence"), 3);
    learning_observations_rebuild(&conn).unwrap();
    for action in ["REINFORCE", "IMPROVE", "REGRESS"] {
        let candidate = validated_candidate(&conn, &format!("improved-reuse-{action}"),
            lifecycle_proposal(action, &memory, vec![improved.clone()]));
        reject_lifecycle_promotion(&conn, &candidate, "requires new evidence observed after");
    }
    let regressed = submit_lifecycle_observation(&conn, "lifecycle-regressed", "FALSE");
    let candidate = validated_candidate(&conn, "real-regress",
        lifecycle_proposal("REGRESS", &memory, vec![regressed.clone()]));
    promote(&conn, &candidate, 1);
    assert_eq!(memory_field(&conn, &memory, "improvement_state"), "regressed");
    let candidate = validated_candidate(&conn, "regressed-reuse-improve",
        lifecycle_proposal("IMPROVE", &memory, vec![regressed]));
    reject_lifecycle_promotion(&conn, &candidate, "requires new evidence observed after");
    let reinforced = submit_lifecycle_observation(&conn, "lifecycle-reinforced", "FALSE");
    let candidate = validated_candidate(&conn, "real-reinforce",
        lifecycle_proposal("REINFORCE", &memory, vec![reinforced]));
    promote(&conn, &candidate, 1);
    assert_eq!(memory_field(&conn, &memory, "improvement_state"), "regressed");
    let version: u64 = conn.query_row("SELECT version FROM memory_items WHERE id=?1",
        [&memory], |row| row.get(0)).unwrap();
    assert_eq!(version, 4);
}

#[test]
fn lifecycle_evidence_uses_instant_order_not_ids_or_timestamp_spelling() {
    let (_dir, conn) = open_db();
    insert_reading_event(&conn, "time-baseline", "2026-08-13T01:00:00Z");
    let baseline = first_observation_id(&conn);
    let add = validated_candidate(&conn, "time-add", MemoryMutationProposal::Add {
        namespace: MemoryNamespace::Strategy, canonical_key: "strategy.reading.temporal".into(),
        scope: MemoryScope::Activity { key: Activity::Reading },
        statement: "Check passage evidence.".into(), evidence_observation_ids: vec![baseline],
    });
    promote(&conn, &add, 1);
    let memory: String = conn.query_row("SELECT id FROM memory_items", [], |row| row.get(0)).unwrap();
    for (event, time) in [("time-earlier", "2026-08-13T00:59:59Z"),
        ("time-equal", "2026-08-13T02:00:00+01:00")] {
        insert_reading_event(&conn, event, time);
        learning_observations_rebuild(&conn).unwrap();
        let observation = observation_id_for_event(&conn, event);
        for action in ["REINFORCE", "IMPROVE", "REGRESS"] {
            let candidate = validated_candidate(&conn, &format!("{event}-{action}"),
                lifecycle_proposal(action, &memory, vec![observation.clone()]));
            reject_lifecycle_promotion(&conn, &candidate, "requires new evidence observed after");
        }
    }
    insert_reading_event(&conn, "time-newer", "2026-08-13T01:00:00.000001Z");
    learning_observations_rebuild(&conn).unwrap();
    let observation = observation_id_for_event(&conn, "time-newer");
    let candidate = validated_candidate(&conn, "time-improve",
        lifecycle_proposal("IMPROVE", &memory, vec![observation]));
    promote(&conn, &candidate, 1);
    assert_eq!(memory_field(&conn, &memory, "improvement_state"), "improved");
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
