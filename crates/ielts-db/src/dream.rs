//! M7-07 Daily Dream persistence.
//!
//! Persists dream runs and pending candidates. A dream only produces pending
//! candidates that must still go through M3 `promote_memory_candidate` before
//! touching active memory (no bypass). Capacity is bounded by the application
//! layer (M7-08).

use ielts_domain::{
    DailyDreamResult, DreamCandidate, DreamCandidateDisposition, DreamProposal, DreamProposalKind,
    DreamRun, DreamRunStatus,
};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

const DEFAULT_USER_ID: &str = "local";

/// Insert a new dream run in `queued` status.
pub fn insert_dream_run(
    conn: &Connection,
    user_id: &str,
    journal_id: &str,
    input_hash: Option<&str>,
) -> DbResult<DreamRun> {
    let user_id = normalize_user_id(user_id);
    require_text(journal_id, "journalId")?;
    let id = format!("drmrun-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO dream_runs (
           id, user_id, journal_id, status, input_hash, output_hash, started_at,
           finished_at, error_json, attempts, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, 0, ?6, ?6)",
        params![
            id,
            user_id,
            journal_id,
            DreamRunStatus::Queued.as_str(),
            input_hash,
            now,
        ],
    )?;
    Ok(DreamRun {
        id,
        user_id,
        journal_id: journal_id.into(),
        status: DreamRunStatus::Queued,
        input_hash: input_hash.map(str::to_owned),
        output_hash: None,
        started_at: None,
        finished_at: None,
        error: None,
        attempts: 0,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Mark a dream run as running (claimed).
pub fn start_dream_run(
    conn: &Connection,
    run_id: &str,
    now: &str,
) -> DbResult<DreamRun> {
    require_text(run_id, "runId")?;
    require_text(now, "now")?;
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'running', started_at = ?1, attempts = attempts + 1, updated_at = ?1
         WHERE id = ?2 AND status IN ('queued','failed')",
        params![now, run_id],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("dream run is not claimable".into()));
    }
    load_dream_run(conn, run_id)?
        .ok_or_else(|| DbError::Validation("dream run vanished after claim".into()))
}

/// Insert a pending dream candidate. Capacity is enforced by the caller
/// (application layer). The candidate is `pending` until M3 promotion.
pub fn insert_dream_candidate(
    conn: &Connection,
    run_id: &str,
    proposal: &DreamProposal,
) -> DbResult<DreamCandidate> {
    require_text(run_id, "runId")?;
    validate_proposal(proposal)?;
    let proposal_json = serde_json::to_string(&proposal.proposal_json)
        .map_err(|error| DbError::Message(error.to_string()))?;
    if proposal_json.len() > ielts_domain::MAX_DREAM_PROPOSAL_BYTES {
        return Err(DbError::Validation(format!(
            "proposal json exceeds {} bytes",
            ielts_domain::MAX_DREAM_PROPOSAL_BYTES
        )));
    }
    let evidence_json = serde_json::to_string(&proposal.evidence_observation_ids)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let id = format!("dcand-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO dream_candidates (
           id, run_id, proposal_json, proposal_kind, target_memory_id,
           evidence_observation_ids_json, disposition, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            run_id,
            proposal_json,
            proposal.kind.as_str(),
            proposal.target_memory_id,
            evidence_json,
            DreamCandidateDisposition::Pending.as_str(),
            now,
        ],
    )?;
    Ok(DreamCandidate {
        id,
        run_id: run_id.into(),
        kind: proposal.kind,
        target_memory_id: proposal.target_memory_id.clone(),
        evidence_observation_ids: proposal.evidence_observation_ids.clone(),
        disposition: DreamCandidateDisposition::Pending,
        created_at: now,
        proposal: proposal.clone(),
    })
}

/// Mark a dream run completed and record the output hash.
pub fn finish_dream_run(
    conn: &Connection,
    run_id: &str,
    output_hash: &str,
    now: &str,
) -> DbResult<DreamRun> {
    require_text(run_id, "runId")?;
    require_text(output_hash, "outputHash")?;
    require_text(now, "now")?;
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'completed', output_hash = ?1, finished_at = ?2, updated_at = ?2
         WHERE id = ?3 AND status = 'running'",
        params![output_hash, now, run_id],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("dream run is not finishable".into()));
    }
    load_dream_run(conn, run_id)?
        .ok_or_else(|| DbError::Validation("dream run vanished after finish".into()))
}

/// Mark a dream run failed (fail-closed). The journal deterministic version is
/// already complete; this only records the dream failure.
pub fn fail_dream_run(
    conn: &Connection,
    run_id: &str,
    error: &serde_json::Value,
    now: &str,
) -> DbResult<DreamRun> {
    require_text(run_id, "runId")?;
    require_text(now, "now")?;
    let error_json = serde_json::to_string(error)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'failed', error_json = ?1, finished_at = ?2, updated_at = ?2
         WHERE id = ?3 AND status IN ('running','queued')",
        params![error_json, now, run_id],
    )?;
    if changed != 1 {
        return Err(DbError::Validation("dream run is not failable".into()));
    }
    load_dream_run(conn, run_id)?
        .ok_or_else(|| DbError::Validation("dream run vanished after failure".into()))
}

/// Startup sweep: mark `running` dream runs as `failed` (interrupted by
/// restart). A process kill between start and finish would otherwise strand
/// the row in `running` forever — start_dream_run cannot reclaim it.
pub fn recover_interrupted_dream_runs(conn: &Connection) -> DbResult<u64> {
    let now = chrono::Utc::now().to_rfc3339();
    let error_json = serde_json::json!({
        "error": "interrupted by restart",
    })
    .to_string();
    let changed = conn.execute(
        "UPDATE dream_runs
         SET status = 'failed', error_json = ?1, finished_at = ?2, updated_at = ?2
         WHERE status = 'running'",
        params![error_json, now],
    )?;
    Ok(changed as u64)
}

/// Load a dream run by id.
pub fn load_dream_run(conn: &Connection, run_id: &str) -> DbResult<Option<DreamRun>> {
    require_text(run_id, "runId")?;
    let row = conn
        .query_row(
            "SELECT id, user_id, journal_id, status, input_hash, output_hash, started_at,
                    finished_at, error_json, attempts, created_at, updated_at
             FROM dream_runs
             WHERE id = ?1",
            params![run_id],
            map_run,
        )
        .optional()?;
    Ok(row)
}

/// Load all candidates for a dream run.
pub fn load_dream_candidates(conn: &Connection, run_id: &str) -> DbResult<Vec<DreamCandidate>> {
    require_text(run_id, "runId")?;
    let mut stmt = conn.prepare(
        "SELECT id, run_id, proposal_json, proposal_kind, target_memory_id,
                evidence_observation_ids_json, disposition, created_at
         FROM dream_candidates
         WHERE run_id = ?1
         ORDER BY id",
    )?;
    let rows = stmt.query_map(params![run_id], map_candidate)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Load the full daily dream result (run + candidates).
pub fn load_daily_dream_result(
    conn: &Connection,
    run_id: &str,
) -> DbResult<Option<DailyDreamResult>> {
    let run = match load_dream_run(conn, run_id)? {
        Some(run) => run,
        None => return Ok(None),
    };
    let candidates = load_dream_candidates(conn, run_id)?;
    Ok(Some(DailyDreamResult { run, candidates }))
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<DreamRun> {
    let status_str: String = row.get(3)?;
    let status = DreamRunStatus::parse(&status_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid dream run status: {status_str}"),
            )),
        )
    })?;
    let error_json: Option<String> = row.get(8)?;
    let error = error_json
        .as_deref()
        .map(serde_json::from_str::<serde_json::Value>)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                8,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    Ok(DreamRun {
        id: row.get(0)?,
        user_id: row.get(1)?,
        journal_id: row.get(2)?,
        status,
        input_hash: row.get(4)?,
        output_hash: row.get(5)?,
        started_at: row.get(6)?,
        finished_at: row.get(7)?,
        error,
        attempts: row.get::<_, i64>(9)? as u32,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<DreamCandidate> {
    let proposal_json: String = row.get(2)?;
    let proposal_value: serde_json::Value =
        serde_json::from_str(&proposal_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let kind_str: String = row.get(3)?;
    let kind = DreamProposalKind::parse(&kind_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid proposal kind: {kind_str}"),
            )),
        )
    })?;
    let evidence_json: String = row.get(5)?;
    let evidence: Vec<String> =
        serde_json::from_str(&evidence_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let disposition_str: String = row.get(6)?;
    let disposition = DreamCandidateDisposition::parse(&disposition_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid disposition: {disposition_str}"),
            )),
        )
    })?;
    let target_memory_id: Option<String> = row.get(4)?;
    let proposal = DreamProposal {
        kind,
        target_memory_id: target_memory_id.clone(),
        evidence_observation_ids: evidence.clone(),
        proposed_statement: proposal_value
            .get("proposedStatement")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        proposal_json: proposal_value,
    };
    Ok(DreamCandidate {
        id: row.get(0)?,
        run_id: row.get(1)?,
        kind,
        target_memory_id,
        evidence_observation_ids: evidence,
        disposition,
        created_at: row.get(7)?,
        proposal,
    })
}

fn validate_proposal(proposal: &DreamProposal) -> DbResult<()> {
    if proposal.evidence_observation_ids.len() > ielts_domain::MAX_INPUT_OBSERVATIONS {
        return Err(DbError::Validation(format!(
            "proposal evidence exceeds {} observations",
            ielts_domain::MAX_INPUT_OBSERVATIONS
        )));
    }
    Ok(())
}

fn normalize_user_id(user_id: &str) -> String {
    if user_id.trim().is_empty() {
        DEFAULT_USER_ID.into()
    } else {
        user_id.trim().to_string()
    }
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}
