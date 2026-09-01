use std::collections::BTreeMap;

use ielts_domain::{
    ActiveMemorySummary, Activity, ExplicitPreference, ExplicitPreferenceUpsert,
    MemoryCandidateActiveSummary, MemoryCandidateInput, MemoryCandidateObservationSummary,
    MemoryCandidatePreferenceSummary,
    MemoryCandidateBatchReceipt, MemoryCandidatePersistenceInput, MemoryCandidateReceipt,
    MemoryCatalog, MemoryCatalogEntry, MemoryCatalogQuery, MemoryConfidenceBand,
    MemoryContextEntry, MemoryContextPreview, MemoryContextQuery, MemoryContextSource,
    MemoryForgetCommand, MemoryMutationProposal, MemoryMutationReceipt, MemoryNamespace,
    MemoryObservationEvidence, MemoryPromotionCommand, MemoryProposalDisposition, MemoryScope,
    MemorySourceClass, MemoryStatus, MemoryValidationSnapshot, MAX_ACTIVE_MEMORY_PER_SCOPE,
    MAX_EXPLICIT_PREFERENCES, MAX_MEMORY_CANDIDATE_OBSERVATIONS, MAX_MEMORY_CONTEXT_ITEMS,
    MAX_MEMORY_PROPOSALS, MAX_MEMORY_STATEMENT_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::cognitive_read::{observation_snapshot, observations_by_ids};
use crate::sqlite::{DbError, DbResult};

pub fn prepare_memory_candidate_input(
    conn: &Connection,
    user_id: &str,
    activity: Activity,
    since: Option<String>,
    max_candidates: usize,
) -> DbResult<MemoryCandidateInput> {
    require_text(user_id, "userId")?;
    if !(1..=MAX_MEMORY_PROPOSALS).contains(&max_candidates) {
        return Err(DbError::Validation(format!(
            "maxCandidates must be between 1 and {MAX_MEMORY_PROPOSALS}"
        )));
    }
    let namespaces = activity_observation_namespaces(activity)
        .iter()
        .map(|value| (*value).to_owned())
        .collect();
    let snapshot = observation_snapshot(
        conn,
        &ielts_domain::ObservationSnapshotQuery {
            namespaces,
            since,
            limit: MAX_MEMORY_CANDIDATE_OBSERVATIONS,
            ..Default::default()
        },
    )?;
    let observations = snapshot
        .observations
        .into_iter()
        .filter(|item| item.user_id == user_id)
        .map(|item| {
            let statement = item
                .value_text
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| item.payload.to_string());
            MemoryCandidateObservationSummary {
                id: item.id,
                namespace: memory_namespace_for_observation(&item.namespace),
                activity,
                normalized_label: format!("{} {}", item.observation_type, item.scope_key),
                statement: truncate_utf8(statement, MAX_MEMORY_STATEMENT_BYTES),
                canonical_key: None,
            }
        })
        .collect();
    let task_scope = MemoryScope::Activity { key: activity };
    let active_memory = load_active_memory(conn, user_id)?
        .into_iter()
        .filter(|item| item.scope == task_scope)
        .take(MAX_ACTIVE_MEMORY_PER_SCOPE)
        .map(|item| MemoryCandidateActiveSummary {
            id: item.id,
            namespace: item.namespace,
            normalized_label: item.canonical_key.clone(),
            canonical_key: item.canonical_key,
            scope: item.scope,
        })
        .collect();
    Ok(MemoryCandidateInput {
        observations,
        active_memory,
        explicit_preferences: load_candidate_preferences(conn, user_id, task_scope.storage_key())?,
        task_scope,
        max_candidates,
    })
}

fn truncate_utf8(mut value: String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value
}

fn activity_observation_namespaces(activity: Activity) -> &'static [&'static str] {
    match activity {
        Activity::Reading => &[
            "reading.attempt.score",
            "reading.question.outcome",
            "reading.question.answer_change_count",
            "reading.question.visit_count",
            "reading.question.elapsed_ms",
            "reading.repeat.corrected",
            "reading.repeat.still_wrong",
            "reading.repeat.newly_wrong",
            "reading.repeat.still_correct",
        ],
        Activity::Writing => &[
            "writing.evaluation.status",
            "writing.evaluation.overall_band",
            "writing.evaluation.criterion_score",
            "writing.evaluation.degraded",
        ],
    }
}

fn memory_namespace_for_observation(namespace: &str) -> MemoryNamespace {
    match namespace {
        "reading.question.answer_change_count"
        | "reading.question.visit_count"
        | "reading.question.elapsed_ms" => MemoryNamespace::Behavior,
        value if value.starts_with("reading.repeat.") => MemoryNamespace::Strategy,
        "writing.evaluation.overall_band" | "writing.evaluation.criterion_score" => {
            MemoryNamespace::Language
        }
        "writing.evaluation.status" | "writing.evaluation.degraded" => {
            MemoryNamespace::Metacognition
        }
        _ => MemoryNamespace::Knowledge,
    }
}

fn load_candidate_preferences(
    conn: &Connection,
    user_id: &str,
    activity_scope: &str,
) -> DbResult<Vec<MemoryCandidatePreferenceSummary>> {
    let mut statement = conn.prepare(
        "SELECT preference_key,scope,value_json FROM explicit_user_preferences
         WHERE user_id=?1 AND status='active' AND scope IN ('global',?2)
         ORDER BY preference_key,scope LIMIT ?3",
    )?;
    let preferences = statement
        .query_map(
            params![user_id, activity_scope, MAX_EXPLICIT_PREFERENCES as i64],
            |row| {
                let raw: String = row.get(2)?;
                Ok(MemoryCandidatePreferenceSummary {
                    preference_key: row.get(0)?,
                    scope: row.get(1)?,
                    value: serde_json::from_str(&raw).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()
        .map_err(DbError::from)?;
    Ok(preferences)
}

pub fn load_memory_validation_snapshot(
    conn: &Connection,
    user_id: &str,
    observation_ids: &[String],
) -> DbResult<MemoryValidationSnapshot> {
    require_text(user_id, "userId")?;
    let batch = observations_by_ids(conn, observation_ids)?;
    let observations = batch
        .observations
        .into_iter()
        .map(|observation| {
            let activity = parse_observation_activity(&observation.namespace)?;
            // Security validation must see both the scalar projection and its
            // bounded structured payload. Choosing only value_text would hide
            // prompt-injection markers carried in otherwise valid metadata.
            let text = format!(
                "{}\n{}",
                observation.value_text.as_deref().unwrap_or_default(),
                observation.payload
            );
            Ok(MemoryObservationEvidence {
                id: observation.id,
                user_id: observation.user_id,
                activity,
                sensitivity: observation.sensitivity,
                trust: observation.trust,
                text,
                source_fingerprint: observation.source_fingerprint,
                projector_key: observation.projector_key,
                projector_version: observation.projector_version,
                event_ids: observation
                    .evidence
                    .into_iter()
                    .map(|item| item.event_id)
                    .collect(),
            })
        })
        .collect::<DbResult<Vec<_>>>()?;
    Ok(MemoryValidationSnapshot {
        user_id: user_id.to_owned(),
        projector_key: batch.projector_key,
        projector_version: batch.projector_version,
        ledger_input_hash: batch.ledger_input_hash,
        observation_output_hash: batch.observation_output_hash,
        observations,
        active_memory: load_active_memory(conn, user_id)?,
    })
}

pub fn persist_memory_candidate_batch(
    conn: &Connection,
    input: &MemoryCandidatePersistenceInput,
) -> DbResult<MemoryCandidateBatchReceipt> {
    validate_candidate_input(input)?;
    let payload_hash = hash_json(&json!({
        "userId": input.user_id,
        "sourceClass": input.source_class,
        "batch": input.batch,
    }))?;
    if let Some(receipt) = replay_candidate_batch(conn, &input.request_id, &payload_hash)? {
        return Ok(receipt);
    }

    let tx = conn.unchecked_transaction()?;
    verify_snapshot_in_transaction(&tx, &input.snapshot)?;
    let batch_id = format!("mcbat-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let batch_status = batch_status(input);
    tx.execute(
        "INSERT INTO memory_candidate_batches (
           id,request_id,user_id,schema_version,source_class,observation_projector_key,
           observation_projector_version,payload_hash,proposal_count,status,run_id,created_at,updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)",
        params![
            batch_id,
            input.request_id,
            input.user_id,
            input.batch.schema_version,
            input.source_class.as_str(),
            input.snapshot.projector_key,
            input.snapshot.projector_version,
            payload_hash,
            input.batch.proposals.len() as i64,
            batch_status,
            input.run_id,
            now,
        ],
    )?;

    let observations = input
        .snapshot
        .observations
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    let active = input
        .snapshot
        .active_memory
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<BTreeMap<_, _>>();
    let mut receipts = Vec::with_capacity(input.validation.decisions.len());
    for decision in &input.validation.decisions {
        let proposal = input.batch.proposals.get(decision.proposal_index).ok_or_else(|| {
            DbError::Validation("validation decision references a missing proposal".into())
        })?;
        let candidate_id = format!("mcand-{}", Uuid::new_v4());
        let target_summary = proposal
            .target_memory_id()
            .and_then(|id| active.get(id).copied());
        let quarantined = decision.disposition == MemoryProposalDisposition::Quarantined;
        let fields = if quarantined {
            CandidateFields::default()
        } else {
            candidate_fields(proposal, target_summary)
        };
        let expected_target_version = proposal
            .target_memory_id()
            .and_then(|id| active.get(id).map(|item| item.version as i64));
        let evidence = if quarantined {
            Vec::new()
        } else {
            proposal
                .evidence_observation_ids()
                .iter()
                .filter_map(|id| observations.get(id.as_str()).copied())
                .map(evidence_snapshot_json)
                .collect::<Vec<_>>()
        };
        let evidence_ids = if quarantined {
            "[]".into()
        } else {
            serde_json::to_string(proposal.evidence_observation_ids())?
        };
        let evidence_json = serde_json::to_string(&evidence)?;
        let issues_json = serde_json::to_string(&decision.issues)?;
        let proposal_json = if quarantined {
            None
        } else {
            Some(serde_json::to_string(proposal)?)
        };
        let candidate_hash = hash_json(&json!({
            "batchId": batch_id,
            "proposalIndex": decision.proposal_index,
            "proposal": proposal_json,
            "evidence": evidence,
        }))?;
        tx.execute(
            "INSERT INTO memory_candidates (
               id,batch_id,proposal_index,action,target_memory_id,expected_target_version,
               namespace,canonical_key,normalized_label,scope,proposed_statement,source_class,
               disposition,evidence_observation_ids_json,evidence_snapshot_json,issues_json,
               proposal_json,payload_hash,version,created_at,updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,1,?19,?19)",
            params![
                candidate_id,
                batch_id,
                decision.proposal_index as i64,
                proposal.action(),
                proposal.target_memory_id(),
                expected_target_version,
                fields.namespace,
                fields.canonical_key,
                fields.normalized_label,
                fields.scope,
                fields.statement,
                input.source_class.as_str(),
                decision.disposition.as_str(),
                evidence_ids,
                evidence_json,
                issues_json,
                proposal_json,
                candidate_hash,
                now,
            ],
        )?;
        audit_candidate_decision(&tx, &candidate_id, decision.disposition, &now)?;
        receipts.push(MemoryCandidateReceipt {
            id: candidate_id,
            proposal_index: decision.proposal_index,
            disposition: decision.disposition.as_str().into(),
            version: 1,
        });
    }
    tx.commit()?;
    Ok(MemoryCandidateBatchReceipt {
        batch_id,
        request_id: input.request_id.clone(),
        replayed: false,
        candidates: receipts,
    })
}

pub fn promote_memory_candidate(
    conn: &Connection,
    command: &MemoryPromotionCommand,
) -> DbResult<MemoryMutationReceipt> {
    validate_actor(&command.actor_type)?;
    require_text(&command.reason, "reason")?;
    let tx = conn.unchecked_transaction()?;
    let candidate = load_pending_candidate(&tx, &command.candidate_id)?;
    if candidate.version != command.expected_candidate_version {
        return Err(DbError::Validation("stale candidate version".into()));
    }
    verify_candidate_evidence(&tx, &candidate.evidence_snapshot)?;
    let proposal: MemoryMutationProposal = serde_json::from_str(&candidate.proposal_json)
        .map_err(|error| DbError::Validation(format!("candidate proposal is invalid: {error}")))?;
    let now = chrono::Utc::now().to_rfc3339();
    let (memory_id, memory_status, memory_version, before, after) = apply_proposal(
        &tx,
        &proposal,
        &candidate,
        command,
        &now,
    )?;
    attach_evidence(&tx, &memory_id, &proposal, &candidate.evidence_snapshot, &now)?;
    let changed = tx.execute(
        "UPDATE memory_candidates
         SET disposition='promoted',resolved_memory_id=?1,version=version+1,updated_at=?2
         WHERE id=?3 AND disposition='pending' AND version=?4",
        params![memory_id, now, command.candidate_id, command.expected_candidate_version],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("stale candidate resolution".into()));
    }
    tx.execute(
        "INSERT INTO memory_mutations (
           id,memory_id,candidate_id,operation,actor_type,actor_id,before_json,after_json,reason,created_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            format!("mmut-{}", Uuid::new_v4()),
            memory_id,
            command.candidate_id,
            mutation_operation(&proposal),
            command.actor_type,
            command.actor_id,
            before,
            after,
            command.reason,
            now,
        ],
    )?;
    tx.commit()?;
    Ok(MemoryMutationReceipt {
        candidate_id: command.candidate_id.clone(),
        memory_id: Some(memory_id),
        action: proposal.action().into(),
        memory_status: Some(memory_status),
        memory_version: Some(memory_version),
    })
}

pub fn upsert_explicit_preference(
    conn: &Connection,
    command: &ExplicitPreferenceUpsert,
) -> DbResult<ExplicitPreference> {
    require_text(&command.user_id, "userId")?;
    require_text(&command.preference_key, "preferenceKey")?;
    require_text(&command.scope, "scope")?;
    if !matches!(command.source.as_str(), "user" | "import" | "product_default") {
        return Err(DbError::Validation("invalid explicit preference source".into()));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let value_json = serde_json::to_string(&command.value)?;
    conn.execute(
        "INSERT INTO explicit_user_preferences (
           user_id,preference_key,scope,value_json,status,source,created_at,updated_at
         ) VALUES (?1,?2,?3,?4,'active',?5,?6,?6)
         ON CONFLICT(user_id,preference_key,scope) DO UPDATE SET
           value_json=excluded.value_json,status='active',source=excluded.source,updated_at=excluded.updated_at",
        params![
            command.user_id,
            command.preference_key,
            command.scope,
            value_json,
            command.source,
            now,
        ],
    )?;
    Ok(ExplicitPreference {
        user_id: command.user_id.clone(),
        preference_key: command.preference_key.clone(),
        scope: command.scope.clone(),
        value: command.value.clone(),
        status: "active".into(),
        source: command.source.clone(),
        updated_at: now,
    })
}

pub fn memory_context_preview(
    conn: &Connection,
    query: &MemoryContextQuery,
) -> DbResult<MemoryContextPreview> {
    require_text(&query.user_id, "userId")?;
    let limit = query.limit.clamp(1, MAX_MEMORY_CONTEXT_ITEMS) as usize;
    let scope = MemoryScope::Activity { key: query.activity }.storage_key();
    let mut entries = Vec::new();
    if let Some(instruction) = query
        .current_instruction
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        entries.push(MemoryContextEntry {
            priority: 1,
            source: MemoryContextSource::CurrentInstruction,
            id: None,
            key: "current_instruction".into(),
            value: Value::String(instruction.clone()),
            pending_verification: false,
        });
    }
    load_explicit_context(conn, &query.user_id, scope, &mut entries)?;
    load_active_context(conn, &query.user_id, scope, &mut entries)?;
    load_candidate_context(conn, &query.user_id, scope, &mut entries)?;
    entries.sort_by(|left, right| left.priority.cmp(&right.priority).then(left.key.cmp(&right.key)));
    let truncated = entries.len() > limit;
    entries.truncate(limit);
    Ok(MemoryContextPreview {
        user_id: query.user_id.clone(),
        activity: query.activity,
        entries,
        truncated,
    })
}

/// Product-host memory catalog (M9/18.3/18.4): governable memory items with
/// governance metadata + bounded evidence ids. This is NOT a Context Pack —
/// the compiler preview (``memory_context_preview``) stays scoped to the
/// compiler; the console reads this instead. Private/restricted rows never
/// leave the store, regardless of write-side defaults.
pub fn load_memory_catalog(conn: &Connection, query: &MemoryCatalogQuery) -> DbResult<MemoryCatalog> {
    require_text(&query.user_id, "userId")?;
    let limit = query.limit.clamp(1, ielts_domain::MAX_MEMORY_CATALOG_ITEMS) as usize;
    let mut status_sql = String::from("('active')");
    if query.include_archived {
        status_sql = String::from("('active','archived')");
    }
    let sql = format!(
        "SELECT m.id, m.content, m.namespace, m.scope, m.canonical_key, m.status,
                m.source_class, m.confidence, m.version,
                COALESCE(m.first_observed_at, m.created_at),
                COALESCE(m.last_observed_at, m.updated_at),
                (SELECT COUNT(*) FROM memory_evidence e
                  WHERE e.memory_id = m.id AND e.evidence_role = 'support'),
                m.contradicted_count,
                (SELECT GROUP_CONCAT(e.observation_id, ',') FROM (
                    SELECT observation_id FROM memory_evidence
                    WHERE memory_id = m.id AND evidence_role = 'support'
                    ORDER BY rowid LIMIT 32
                 ) e)
         FROM memory_items m
         WHERE m.user_id = ?1 AND m.sensitivity = 'normal'
           AND m.status IN {status_sql}
         ORDER BY m.importance DESC, m.confidence DESC, m.updated_at DESC, m.id
         LIMIT ?2"
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![query.user_id, limit as i64], |row| {
        let confidence: f64 = row.get(7)?;
        let evidence_csv: Option<String> = row.get(13)?;
        let evidence_ids: Vec<String> = evidence_csv
            .map(|csv| {
                csv.split(',')
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        Ok(MemoryCatalogEntry {
            id: row.get(0)?,
            statement: row.get(1)?,
            namespace: row.get(2)?,
            scope: row.get(3)?,
            canonical_key: row.get(4)?,
            status: row.get(5)?,
            source_class: row.get(6)?,
            confidence_band: MemoryConfidenceBand::from_score(confidence),
            support_count: row.get::<_, i64>(11)? as u64,
            contradiction_count: row.get::<_, i64>(12)? as u64,
            version: row.get::<_, i64>(8)? as u64,
            first_seen: row.get(9)?,
            last_seen: row.get(10)?,
            evidence_observation_ids: evidence_ids,
            pending_verification: false,
        })
    })?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row?);
    }
    let truncated = entries.len() == limit;
    Ok(MemoryCatalog {
        user_id: query.user_id.clone(),
        entries,
        truncated,
    })
}

pub fn forget_memory(conn: &Connection, command: &MemoryForgetCommand) -> DbResult<()> {
    validate_actor(&command.actor_type)?;
    require_text(&command.reason, "reason")?;
    let tx = conn.unchecked_transaction()?;
    let before = memory_state_json(&tx, &command.memory_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let changed = tx.execute(
        "UPDATE memory_items
         SET status='deleted',content='[deleted]',structured_json=NULL,title=NULL,
             canonical_key='redacted',normalized_label='redacted',subject_key=NULL,
             version=version+1,updated_at=?1
         WHERE id=?2 AND version=?3 AND status != 'deleted'",
        params![now, command.memory_id, command.expected_version],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("stale or missing memory".into()));
    }
    tx.execute(
        "UPDATE memory_candidates
         SET proposed_statement=NULL, proposal_json=NULL,
             evidence_observation_ids_json='[]',evidence_snapshot_json='[]',updated_at=?1
         WHERE target_memory_id=?2 OR resolved_memory_id=?2",
        params![now, command.memory_id],
    )?;
    tx.execute(
        "DELETE FROM memory_evidence WHERE memory_id=?1",
        [&command.memory_id],
    )?;
    let tombstone = hash_only_tombstone_json(&tx, &command.memory_id)?;
    tx.execute(
        "UPDATE memory_mutations
         SET before_json=?1, after_json=?1, reason='redacted by memory forget'
         WHERE memory_id=?2",
        params![tombstone, command.memory_id],
    )?;
    let after = memory_state_json(&tx, &command.memory_id)?;
    tx.execute(
        "INSERT INTO memory_mutations (
           id,memory_id,operation,actor_type,actor_id,before_json,after_json,reason,created_at
         ) VALUES (?1,?2,'delete',?3,?4,?5,?6,?7,?8)",
        params![
            format!("mmut-{}", Uuid::new_v4()),
            command.memory_id,
            command.actor_type,
            command.actor_id,
            before,
            after,
            "user requested memory forget",
            now,
        ],
    )?;
    tx.commit()?;
    Ok(())
}

fn load_active_memory(conn: &Connection, user_id: &str) -> DbResult<Vec<ActiveMemorySummary>> {
    let mut statement = conn.prepare(
        "SELECT id,user_id,namespace,canonical_key,scope,status,version
         FROM memory_items WHERE user_id=?1 AND status='active' ORDER BY id",
    )?;
    let rows = statement.query_map([user_id], |row| {
        let namespace: String = row.get(2)?;
        let scope: String = row.get(4)?;
        let status: String = row.get(5)?;
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            namespace,
            row.get::<_, String>(3)?,
            scope,
            status,
            row.get::<_, i64>(6)?,
        ))
    })?;
    rows.map(|row| {
        let (id, user_id, namespace, canonical_key, scope, status, version) = row?;
        Ok(ActiveMemorySummary {
            id,
            user_id,
            namespace: MemoryNamespace::parse(&namespace)
                .ok_or_else(|| DbError::Validation("invalid stored memory namespace".into()))?,
            canonical_key,
            scope: MemoryScope::parse_storage_key(&scope)
                .ok_or_else(|| DbError::Validation("invalid stored memory scope".into()))?,
            status: MemoryStatus::parse(&status)
                .ok_or_else(|| DbError::Validation("invalid stored memory status".into()))?,
            version: version as u64,
        })
    })
    .collect()
}

fn validate_candidate_input(input: &MemoryCandidatePersistenceInput) -> DbResult<()> {
    require_text(&input.request_id, "requestId")?;
    require_text(&input.user_id, "userId")?;
    if input.user_id != input.snapshot.user_id {
        return Err(DbError::Validation("snapshot user does not match request user".into()));
    }
    if !matches!(
        input.source_class,
        MemorySourceClass::Inferred | MemorySourceClass::Predicted | MemorySourceClass::Consolidated
    ) {
        return Err(DbError::Validation(
            "candidate persistence accepts only cognitive source classes".into(),
        ));
    }
    if input.validation.decisions.len() != input.batch.proposals.len()
        && input.validation.batch_issues.is_empty()
    {
        return Err(DbError::Validation(
            "validation decisions do not cover proposal batch".into(),
        ));
    }
    if input
        .validation
        .decisions
        .iter()
        .any(|decision| decision.source_class != Some(input.source_class))
    {
        return Err(DbError::Validation("validator source class mismatch".into()));
    }
    Ok(())
}

fn verify_snapshot_in_transaction(tx: &Transaction<'_>, snapshot: &MemoryValidationSnapshot) -> DbResult<()> {
    for observation in &snapshot.observations {
        let current = tx
            .query_row(
                "SELECT user_id,projector_key,projector_version,source_fingerprint
                 FROM learner_observations WHERE id=?1",
                [&observation.id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let expected = (
            observation.user_id.as_str(),
            observation.projector_key.as_str(),
            observation.projector_version,
            observation.source_fingerprint.as_str(),
        );
        if current.as_ref().map(|item| (item.0.as_str(), item.1.as_str(), item.2, item.3.as_str()))
            != Some(expected)
        {
            return Err(DbError::Validation(format!(
                "stale observation evidence: {}",
                observation.id
            )));
        }
    }
    for memory in &snapshot.active_memory {
        let current = tx
            .query_row(
                "SELECT user_id,status,version FROM memory_items WHERE id=?1",
                [&memory.id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
            )
            .optional()?;
        if current != Some((memory.user_id.clone(), "active".into(), memory.version as i64)) {
            return Err(DbError::Validation(format!("stale target memory: {}", memory.id)));
        }
    }
    Ok(())
}

fn replay_candidate_batch(
    conn: &Connection,
    request_id: &str,
    payload_hash: &str,
) -> DbResult<Option<MemoryCandidateBatchReceipt>> {
    let existing = conn
        .query_row(
            "SELECT id,payload_hash FROM memory_candidate_batches WHERE request_id=?1",
            [request_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((batch_id, stored_hash)) = existing else {
        return Ok(None);
    };
    if stored_hash != payload_hash {
        return Err(DbError::Validation(
            "requestId was already used with a different payload".into(),
        ));
    }
    let mut statement = conn.prepare(
        "SELECT id,proposal_index,disposition,version
         FROM memory_candidates WHERE batch_id=?1 ORDER BY proposal_index",
    )?;
    let candidates = statement
        .query_map([&batch_id], |row| {
            Ok(MemoryCandidateReceipt {
                id: row.get(0)?,
                proposal_index: row.get::<_, i64>(1)? as usize,
                disposition: row.get(2)?,
                version: row.get::<_, i64>(3)? as u64,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(MemoryCandidateBatchReceipt {
        batch_id,
        request_id: request_id.into(),
        replayed: true,
        candidates,
    }))
}

#[derive(Default)]
struct CandidateFields {
    namespace: Option<String>,
    canonical_key: Option<String>,
    normalized_label: Option<String>,
    scope: Option<String>,
    statement: Option<String>,
}

fn candidate_fields(
    proposal: &MemoryMutationProposal,
    target: Option<&ActiveMemorySummary>,
) -> CandidateFields {
    match proposal {
        MemoryMutationProposal::Add {
            namespace,
            canonical_key,
            scope,
            statement,
            ..
        } => CandidateFields {
            namespace: Some(namespace.as_str().into()),
            canonical_key: Some(canonical_key.clone()),
            normalized_label: Some(normalize_label(canonical_key)),
            scope: Some(scope.storage_key().into()),
            statement: Some(statement.clone()),
        },
        MemoryMutationProposal::Supersede {
            namespace,
            canonical_key,
            scope,
            proposed_statement,
            ..
        } => CandidateFields {
            namespace: Some(namespace.as_str().into()),
            canonical_key: Some(canonical_key.clone()),
            normalized_label: Some(normalize_label(canonical_key)),
            scope: Some(scope.storage_key().into()),
            statement: Some(proposed_statement.clone()),
        },
        MemoryMutationProposal::Refine {
            proposed_statement, ..
        } => candidate_fields_from_target(target, Some(proposed_statement.clone())),
        _ => candidate_fields_from_target(target, None),
    }
}

fn candidate_fields_from_target(
    target: Option<&ActiveMemorySummary>,
    statement: Option<String>,
) -> CandidateFields {
    CandidateFields {
        namespace: target.map(|item| item.namespace.as_str().into()),
        canonical_key: target.map(|item| item.canonical_key.clone()),
        normalized_label: target.map(|item| normalize_label(&item.canonical_key)),
        scope: target.map(|item| item.scope.storage_key().into()),
        statement,
    }
}

fn batch_status(input: &MemoryCandidatePersistenceInput) -> &'static str {
    if !input.validation.batch_issues.is_empty() {
        return "rejected";
    }
    let quarantined = input
        .validation
        .decisions
        .iter()
        .any(|item| item.disposition == MemoryProposalDisposition::Quarantined);
    let accepted = input.validation.decisions.iter().any(|item| {
        matches!(
            item.disposition,
            MemoryProposalDisposition::Pending
                | MemoryProposalDisposition::Duplicate
                | MemoryProposalDisposition::Noop
        )
    });
    match (accepted, quarantined) {
        (false, true) => "quarantined",
        (true, true) => "partially_accepted",
        (true, false) => "accepted",
        (false, false) => "rejected",
    }
}

fn evidence_snapshot_json(observation: &MemoryObservationEvidence) -> Value {
    json!({
        "id": observation.id,
        "userId": observation.user_id,
        "sourceFingerprint": observation.source_fingerprint,
        "projectorKey": observation.projector_key,
        "projectorVersion": observation.projector_version,
        "eventIds": observation.event_ids,
    })
}

fn audit_candidate_decision(
    tx: &Transaction<'_>,
    candidate_id: &str,
    disposition: MemoryProposalDisposition,
    now: &str,
) -> DbResult<()> {
    let operation = match disposition {
        MemoryProposalDisposition::Rejected => "reject",
        MemoryProposalDisposition::Quarantined => "quarantine",
        _ => "propose",
    };
    tx.execute(
        "INSERT INTO memory_mutations (
           id,candidate_id,operation,actor_type,actor_id,after_json,reason,created_at
         ) VALUES (?1,?2,?3,'agent','memory-validator',?4,?5,?6)",
        params![
            format!("mmut-{}", Uuid::new_v4()),
            candidate_id,
            operation,
            json!({"disposition": disposition.as_str()}).to_string(),
            format!("validator disposition: {}", disposition.as_str()),
            now,
        ],
    )?;
    Ok(())
}

struct PendingCandidate {
    user_id: String,
    source_class: MemorySourceClass,
    proposal_json: String,
    evidence_snapshot: Vec<Value>,
    expected_target_version: Option<u64>,
    version: u64,
}

fn load_pending_candidate(tx: &Transaction<'_>, id: &str) -> DbResult<PendingCandidate> {
    tx.query_row(
        "SELECT b.user_id,c.source_class,c.proposal_json,c.evidence_snapshot_json,
                c.expected_target_version,c.version,c.disposition
         FROM memory_candidates c
         JOIN memory_candidate_batches b ON b.id=c.batch_id
         WHERE c.id=?1",
        [id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        },
    )
    .optional()?
    .ok_or_else(|| DbError::Validation("candidate not found".into()))
    .and_then(|(user_id, source, proposal, evidence, target_version, version, disposition)| {
        if disposition != "pending" {
            return Err(DbError::Validation("candidate is not pending".into()));
        }
        Ok(PendingCandidate {
            user_id,
            source_class: MemorySourceClass::parse(&source)
                .ok_or_else(|| DbError::Validation("invalid candidate source class".into()))?,
            proposal_json: proposal
                .ok_or_else(|| DbError::Validation("pending candidate has no proposal".into()))?,
            evidence_snapshot: serde_json::from_str(&evidence).map_err(|error| {
                DbError::Validation(format!("candidate evidence is invalid: {error}"))
            })?,
            expected_target_version: target_version.map(|value| value as u64),
            version: version as u64,
        })
    })
}

fn verify_candidate_evidence(tx: &Transaction<'_>, evidence: &[Value]) -> DbResult<()> {
    for item in evidence {
        let id = json_text(item, "id")?;
        let fingerprint = json_text(item, "sourceFingerprint")?;
        let projector_key = json_text(item, "projectorKey")?;
        let projector_version = item
            .get("projectorVersion")
            .and_then(Value::as_i64)
            .ok_or_else(|| DbError::Validation("evidence projectorVersion is required".into()))?;
        let valid = tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM learner_observations
               WHERE id=?1 AND source_fingerprint=?2 AND projector_key=?3 AND projector_version=?4
             )",
            params![id, fingerprint, projector_key, projector_version],
            |row| row.get::<_, i64>(0),
        )?;
        if valid != 1 {
            return Err(DbError::Validation(format!("stale observation evidence: {id}")));
        }
    }
    Ok(())
}

fn apply_proposal(
    tx: &Transaction<'_>,
    proposal: &MemoryMutationProposal,
    candidate: &PendingCandidate,
    command: &MemoryPromotionCommand,
    now: &str,
) -> DbResult<(String, MemoryStatus, u64, Option<String>, String)> {
    match proposal {
        MemoryMutationProposal::Add {
            namespace,
            canonical_key,
            scope,
            statement,
            ..
        } => insert_active_memory(
            tx,
            candidate,
            command,
            *namespace,
            canonical_key,
            *scope,
            statement,
            None,
            now,
        ),
        MemoryMutationProposal::Supersede {
            target_memory_id,
            namespace,
            canonical_key,
            scope,
            proposed_statement,
            ..
        } => {
            let expected = candidate.expected_target_version.ok_or_else(|| {
                DbError::Validation("supersede candidate has no target version".into())
            })?;
            let before = memory_state_json(tx, target_memory_id)?;
            guarded_memory_update(
                tx,
                target_memory_id,
                expected,
                "UPDATE memory_items SET status='superseded',version=version+1,updated_at=?1
                 WHERE id=?2 AND status='active' AND version=?3",
                now,
            )?;
            let (new_id, status, version, _, after) = insert_active_memory(
                tx,
                candidate,
                command,
                *namespace,
                canonical_key,
                *scope,
                proposed_statement,
                Some(target_memory_id),
                now,
            )?;
            Ok((new_id, status, version, before, after))
        }
        _ => update_target_memory(tx, proposal, candidate, now),
    }
}

fn insert_active_memory(
    tx: &Transaction<'_>,
    candidate: &PendingCandidate,
    command: &MemoryPromotionCommand,
    namespace: MemoryNamespace,
    canonical_key: &str,
    scope: MemoryScope,
    statement: &str,
    supersedes_id: Option<&str>,
    now: &str,
) -> DbResult<(String, MemoryStatus, u64, Option<String>, String)> {
    let active_count = tx.query_row(
        "SELECT COUNT(*) FROM memory_items WHERE user_id=?1 AND scope=?2 AND status='active'",
        params![candidate.user_id, scope.storage_key()],
        |row| row.get::<_, i64>(0),
    )?;
    if active_count >= MAX_ACTIVE_MEMORY_PER_SCOPE as i64 {
        return Err(DbError::Validation("active memory capacity reached".into()));
    }
    let memory_id = format!("mem-{}", Uuid::new_v4());
    let content_hash = hash_text(statement);
    let (confidence, source_trust) = source_weights(candidate.source_class);
    tx.execute(
        "INSERT INTO memory_items (
           id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
           source_class,confidence,importance,source_trust,sensitivity,improvement_state,
           first_observed_at,last_observed_at,version,supersedes_id,created_by,content_hash,
           created_at,updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'active',?9,?10,0.5,?11,'normal','baseline',
                   ?12,?12,1,?13,?14,?15,?12,?12)",
        params![
            memory_id,
            candidate.user_id,
            namespace.as_str(),
            scope.storage_key(),
            memory_type(namespace),
            canonical_key,
            normalize_label(canonical_key),
            statement,
            candidate.source_class.as_str(),
            confidence,
            source_trust,
            now,
            supersedes_id,
            command.actor_id.as_deref().unwrap_or(&command.actor_type),
            content_hash,
        ],
    )?;
    let after = memory_state_json(tx, &memory_id)?.unwrap_or_else(|| "{}".into());
    Ok((memory_id, MemoryStatus::Active, 1, None, after))
}

fn update_target_memory(
    tx: &Transaction<'_>,
    proposal: &MemoryMutationProposal,
    candidate: &PendingCandidate,
    now: &str,
) -> DbResult<(String, MemoryStatus, u64, Option<String>, String)> {
    let target_id = proposal
        .target_memory_id()
        .ok_or_else(|| DbError::Validation("proposal has no target memory".into()))?;
    let expected = candidate
        .expected_target_version
        .ok_or_else(|| DbError::Validation("candidate has no target version".into()))?;
    let before = memory_state_json(tx, target_id)?;
    match proposal {
        MemoryMutationProposal::Reinforce { .. } => guarded_memory_update(
            tx,
            target_id,
            expected,
            "UPDATE memory_items SET confidence=MIN(1,confidence+0.05),last_observed_at=?1,
                    version=version+1,updated_at=?1 WHERE id=?2 AND status='active' AND version=?3",
            now,
        )?,
        MemoryMutationProposal::Refine {
            proposed_statement, ..
        } => {
            let changed = tx.execute(
                "UPDATE memory_items SET content=?1,content_hash=?2,last_observed_at=?3,
                        version=version+1,updated_at=?3
                 WHERE id=?4 AND status='active' AND version=?5",
                params![proposed_statement, hash_text(proposed_statement), now, target_id, expected],
            )?;
            require_single_cas(changed)?;
        }
        MemoryMutationProposal::Improve { .. } => guarded_memory_update(
            tx,
            target_id,
            expected,
            "UPDATE memory_items SET improvement_state='improved',last_observed_at=?1,
                    version=version+1,updated_at=?1 WHERE id=?2 AND status='active' AND version=?3",
            now,
        )?,
        MemoryMutationProposal::Regress { .. } => {
            let changed = tx.execute(
                "UPDATE memory_items SET improvement_state='regressed',last_observed_at=?1,
                        version=version+1,updated_at=?1
                 WHERE id=?2 AND status='active' AND version=?3 AND improvement_state='improved'",
                params![now, target_id, expected],
            )?;
            if changed != 1 {
                return Err(DbError::Validation(
                    "regress requires the current improved memory version".into(),
                ));
            }
        }
        MemoryMutationProposal::Contradict { .. } => guarded_memory_update(
            tx,
            target_id,
            expected,
            "UPDATE memory_items SET contradicted_count=contradicted_count+1,last_observed_at=?1,
                    version=version+1,updated_at=?1 WHERE id=?2 AND status='active' AND version=?3",
            now,
        )?,
        MemoryMutationProposal::Archive { .. } => guarded_memory_update(
            tx,
            target_id,
            expected,
            "UPDATE memory_items SET status='archived',version=version+1,updated_at=?1
             WHERE id=?2 AND status='active' AND version=?3",
            now,
        )?,
        _ => return Err(DbError::Validation("unsupported target mutation".into())),
    }
    let after = memory_state_json(tx, target_id)?.unwrap_or_else(|| "{}".into());
    let (status, version) = tx.query_row(
        "SELECT status,version FROM memory_items WHERE id=?1",
        [target_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;
    Ok((
        target_id.into(),
        MemoryStatus::parse(&status)
            .ok_or_else(|| DbError::Validation("invalid memory status".into()))?,
        version as u64,
        before,
        after,
    ))
}

fn guarded_memory_update(
    tx: &Transaction<'_>,
    target_id: &str,
    expected: u64,
    sql: &str,
    now: &str,
) -> DbResult<()> {
    require_single_cas(tx.execute(sql, params![now, target_id, expected])?)
}

fn require_single_cas(changed: usize) -> DbResult<()> {
    if changed == 1 {
        Ok(())
    } else {
        Err(DbError::Validation("stale target memory version".into()))
    }
}

fn attach_evidence(
    tx: &Transaction<'_>,
    memory_id: &str,
    proposal: &MemoryMutationProposal,
    evidence: &[Value],
    now: &str,
) -> DbResult<()> {
    let role = match proposal {
        MemoryMutationProposal::Improve { .. } => "improvement",
        MemoryMutationProposal::Contradict { .. } => "contradict",
        _ => "support",
    };
    let mut inserted = 0;
    for item in evidence {
        let observation_id = json_text(item, "id")?;
        let source_fingerprint = json_text(item, "sourceFingerprint")?;
        let projector_key = json_text(item, "projectorKey")?;
        let projector_version = item
            .get("projectorVersion")
            .and_then(Value::as_i64)
            .ok_or_else(|| DbError::Validation("evidence projectorVersion is required".into()))?;
        let event_ids = item
            .get("eventIds")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new()));
        let event_ids_json = serde_json::to_string(&event_ids)?;
        let evidence_hash = hash_json(item)?;
        inserted += tx.execute(
            "INSERT OR IGNORE INTO memory_evidence (
               memory_id,observation_id,source_fingerprint,projector_key,projector_version,
               evidence_role,event_ids_json,evidence_hash,created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                memory_id,
                observation_id,
                source_fingerprint,
                projector_key,
                projector_version,
                role,
                event_ids_json,
                evidence_hash,
                now,
            ],
        )?;
    }
    if matches!(proposal, MemoryMutationProposal::Reinforce { .. }) && inserted == 0 {
        return Err(DbError::Validation(
            "reinforce requires at least one new independent evidence item".into(),
        ));
    }
    Ok(())
}

fn load_explicit_context(
    conn: &Connection,
    user_id: &str,
    scope: &str,
    out: &mut Vec<MemoryContextEntry>,
) -> DbResult<()> {
    let mut statement = conn.prepare(
        "SELECT preference_key,value_json,scope FROM explicit_user_preferences
         WHERE user_id=?1 AND status='active' AND scope IN ('global',?2)
         ORDER BY preference_key,scope",
    )?;
    let rows = statement.query_map(params![user_id, scope], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (key, value, pref_scope) = row?;
        out.push(MemoryContextEntry {
            priority: 2,
            source: MemoryContextSource::ExplicitPreference,
            id: Some(format!("preference:{pref_scope}:{key}")),
            key,
            value: serde_json::from_str(&value)?,
            pending_verification: false,
        });
    }
    Ok(())
}

fn load_active_context(
    conn: &Connection,
    user_id: &str,
    scope: &str,
    out: &mut Vec<MemoryContextEntry>,
) -> DbResult<()> {
    let mut statement = conn.prepare(
        "SELECT id,canonical_key,content FROM memory_items
         WHERE user_id=?1 AND scope=?2 AND status='active' AND sensitivity='normal'
         ORDER BY importance DESC,confidence DESC,updated_at DESC,id",
    )?;
    let rows = statement.query_map(params![user_id, scope], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (id, key, content) = row?;
        out.push(MemoryContextEntry {
            priority: 3,
            source: MemoryContextSource::ActiveMemory,
            id: Some(id),
            key,
            value: Value::String(content),
            pending_verification: false,
        });
    }
    Ok(())
}

fn load_candidate_context(
    conn: &Connection,
    user_id: &str,
    scope: &str,
    out: &mut Vec<MemoryContextEntry>,
) -> DbResult<()> {
    let mut statement = conn.prepare(
        "SELECT c.id,COALESCE(c.canonical_key,c.target_memory_id,c.id),c.proposed_statement,c.source_class
         FROM memory_candidates c
         JOIN memory_candidate_batches b ON b.id=c.batch_id
         WHERE b.user_id=?1 AND c.scope=?2 AND c.disposition='pending'
           AND c.proposed_statement IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM memory_items m
               WHERE m.id IN (c.target_memory_id, c.resolved_memory_id)
                 AND m.sensitivity != 'normal'
           )
         ORDER BY c.created_at DESC,c.id",
    )?;
    let rows = statement.query_map(params![user_id, scope], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (id, key, statement, source) = row?;
        let predicted = source == "predicted";
        out.push(MemoryContextEntry {
            priority: if predicted { 5 } else { 4 },
            source: if predicted {
                MemoryContextSource::PredictedHypothesis
            } else {
                MemoryContextSource::InferredCandidate
            },
            id: Some(id),
            key,
            value: Value::String(statement),
            pending_verification: true,
        });
    }
    Ok(())
}

fn memory_state_json(conn: &Connection, memory_id: &str) -> DbResult<Option<String>> {
    conn.query_row(
        "SELECT status,version,content_hash,improvement_state,contradicted_count
         FROM memory_items WHERE id=?1",
        [memory_id],
        |row| {
            Ok(json!({
                "status": row.get::<_, String>(0)?,
                "version": row.get::<_, i64>(1)?,
                "contentHash": row.get::<_, String>(2)?,
                "improvementState": row.get::<_, String>(3)?,
                "contradictedCount": row.get::<_, i64>(4)?,
            })
            .to_string())
        },
    )
    .optional()
    .map_err(Into::into)
}

fn hash_only_tombstone_json(conn: &Connection, memory_id: &str) -> DbResult<String> {
    conn.query_row(
        "SELECT content_hash FROM memory_items WHERE id=?1",
        [memory_id],
        |row| {
            Ok(json!({
                "redacted": true,
                "contentHash": row.get::<_, String>(0)?,
            })
            .to_string())
        },
    )
    .map_err(Into::into)
}

fn parse_observation_activity(namespace: &str) -> DbResult<Activity> {
    match namespace {
        "reading" => Ok(Activity::Reading),
        "writing" => Ok(Activity::Writing),
        _ => Err(DbError::Validation(format!(
            "unsupported observation activity namespace {namespace}"
        ))),
    }
}

fn source_weights(source: MemorySourceClass) -> (f64, f64) {
    match source {
        MemorySourceClass::Predicted => (0.4, 0.4),
        MemorySourceClass::Inferred => (0.7, 0.7),
        MemorySourceClass::Consolidated => (0.8, 0.8),
        MemorySourceClass::Observed => (0.9, 1.0),
        MemorySourceClass::UserExplicit | MemorySourceClass::SystemPolicy => (1.0, 1.0),
    }
}

fn memory_type(namespace: MemoryNamespace) -> &'static str {
    match namespace {
        MemoryNamespace::Strategy | MemoryNamespace::Behavior => "procedural",
        MemoryNamespace::Goal => "goal",
        MemoryNamespace::Preference | MemoryNamespace::Metacognition => "inferred_profile",
        MemoryNamespace::Knowledge | MemoryNamespace::Language => "semantic",
    }
}

fn mutation_operation(proposal: &MemoryMutationProposal) -> &'static str {
    match proposal {
        MemoryMutationProposal::Add { .. } => "promote",
        MemoryMutationProposal::Reinforce { .. } => "reinforce",
        MemoryMutationProposal::Refine { .. } => "refine",
        MemoryMutationProposal::Improve { .. } => "improve",
        MemoryMutationProposal::Regress { .. } => "regress",
        MemoryMutationProposal::Contradict { .. } => "contradict",
        MemoryMutationProposal::Supersede { .. } => "supersede",
        MemoryMutationProposal::Archive { .. } => "archive",
        MemoryMutationProposal::Noop {} => "reject",
    }
}

fn normalize_label(canonical_key: &str) -> String {
    canonical_key
        .rsplit('.')
        .next()
        .unwrap_or(canonical_key)
        .replace('_', " ")
        .to_ascii_lowercase()
}

fn validate_actor(actor: &str) -> DbResult<()> {
    if matches!(actor, "user" | "agent" | "dream" | "system" | "developer") {
        Ok(())
    } else {
        Err(DbError::Validation("invalid memory mutation actor".into()))
    }
}

fn json_text<'a>(value: &'a Value, key: &str) -> DbResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| DbError::Validation(format!("evidence {key} is required")))
}

fn hash_json(value: &Value) -> DbResult<String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| DbError::Validation(format!("cannot hash JSON: {error}")))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn hash_text(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

impl From<serde_json::Error> for DbError {
    fn from(error: serde_json::Error) -> Self {
        Self::Validation(error.to_string())
    }
}
