//! M7-03 Deterministic Daily Journal Facts persistence.
//!
//! Implements §23.14 pseudocode: `build_daily_facts` aggregates canonical truth
//! (events/observations/memory/learner) into a deterministic `JournalFacts`
//! without invoking any LLM. The journal row is a canonical derived projection;
//! `rendered_markdown` is an export view, not the source of truth (M7-05).
//!
//! Private memory content is never copied into facts; only counts and redacted
//! summaries leave the projection.

use std::collections::BTreeMap;

use ielts_domain::{
    DailyJournal, DailyJournalStatus, JournalFacts, JournalMemoryEvent, MemoryChangeSummary,
    SkillDelta, WritingEvalSummary,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

const DEFAULT_USER_ID: &str = "local";
const MAX_SKILL_DELTAS: usize = 64;
/// Cap aligned with the Python JournalFacts contract (todayObservationIds).
const MAX_TODAY_OBSERVATION_IDS: usize = 512;
/// Cap aligned with the Python JournalFacts contract (memoryChanges).
const MAX_MEMORY_EVENTS: usize = 128;

/// Build the deterministic `JournalFacts` for a given day (§23.14).
///
/// This aggregates from canonical tables without copying body text. The
/// `source_hash` is a stable hash of the source range, so a rerun with no new
/// events produces the same hash.
pub fn build_daily_facts(conn: &Connection, user_id: &str, day: &str) -> DbResult<JournalFacts> {
    let user_id = normalize_user_id(user_id);
    require_text(day, "journalDate")?;
    let (day_start, day_end) = day_bounds(day)?;

    let attempts_count = count_attempts(conn, &user_id, &day_start, &day_end)?;
    let writing_eval_summary = writing_eval_summary(conn, &user_id, &day_start, &day_end)?;
    let skill_deltas = skill_deltas(conn, &user_id, &day_start, &day_end)?;
    let memory_changes = memory_mutations(conn, &user_id, &day_start, &day_end)?;
    let coach_feedback_count = coach_feedback_count(conn, &user_id, &day_start, &day_end)?;
    let coach_reask_count = coach_reask_count(conn, &user_id, &day_start, &day_end)?;
    let time_spent_ms = time_spent(conn, &user_id, &day_start, &day_end)?;
    let today_observation_ids = today_observation_ids(conn, &user_id, &day_start, &day_end)?;
    let memory_events = memory_events(conn, &user_id, &day_start, &day_end)?;

    let source_hash = daily_source_hash(
        &attempts_count,
        &writing_eval_summary,
        &skill_deltas,
        &memory_changes,
        &coach_feedback_count,
        &coach_reask_count,
        &time_spent_ms,
        &today_observation_ids,
        &memory_events,
        day,
    );

    Ok(JournalFacts {
        journal_date: day.into(),
        attempts_count,
        writing_eval_summary,
        skill_deltas,
        memory_changes,
        coach_feedback_count,
        coach_reask_count,
        time_spent_ms,
        source_hash,
        today_observation_ids,
        memory_events,
    })
}

/// Insert a new journal row and supersede the previous published journal for the
/// same day (M7-05). Same-day rerun produces a new version.
pub fn insert_journal(
    conn: &Connection,
    user_id: &str,
    facts: &JournalFacts,
    rendered_markdown: Option<&str>,
) -> DbResult<DailyJournal> {
    let user_id = normalize_user_id(user_id);
    let now = chrono::Utc::now().to_rfc3339();
    let facts_json = serde_json::to_string(&json!({
        "attemptsCount": facts.attempts_count,
        "writingEvalSummary": facts.writing_eval_summary,
        "skillDeltas": facts.skill_deltas,
        "memoryChanges": facts.memory_changes,
        "coachFeedbackCount": facts.coach_feedback_count,
        "coachReaskCount": facts.coach_reask_count,
        "timeSpentMs": facts.time_spent_ms,
        "sourceHash": facts.source_hash,
        "journalDate": facts.journal_date,
        "todayObservationIds": facts.today_observation_ids,
        "memoryEvents": facts.memory_events,
    }))
    .map_err(|error| DbError::Message(error.to_string()))?;
    if facts_json.len() > ielts_domain::MAX_JOURNAL_FACTS_BYTES {
        return Err(DbError::Validation(format!(
            "journal facts exceed {} bytes",
            ielts_domain::MAX_JOURNAL_FACTS_BYTES
        )));
    }
    if let Some(markdown) = rendered_markdown {
        if markdown.len() > ielts_domain::MAX_JOURNAL_RENDERED_BYTES {
            return Err(DbError::Validation(format!(
                "rendered markdown exceeds {} bytes",
                ielts_domain::MAX_JOURNAL_RENDERED_BYTES
            )));
        }
    }

    let tx = conn.unchecked_transaction()?;
    // Find the previous version for this day (highest version).
    let previous: Option<(String, u32)> = tx
        .query_row(
            "SELECT id, version FROM daily_journals
             WHERE user_id = ?1 AND journal_date = ?2
             ORDER BY version DESC LIMIT 1",
            params![user_id, facts.journal_date],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u32)),
        )
        .optional()?;
    let new_version = previous.as_ref().map(|(_, v)| v + 1).unwrap_or(1);
    let id = format!("djnl-{}", Uuid::new_v4());

    tx.execute(
        "INSERT INTO daily_journals (
           id, user_id, journal_date, version, status, facts_json, source_hash,
           rendered_markdown, superseded_by, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?9)",
        params![
            id,
            user_id,
            facts.journal_date,
            new_version as i64,
            DailyJournalStatus::Published.as_str(),
            facts_json,
            facts.source_hash,
            rendered_markdown,
            now,
        ],
    )?;

    // Supersede the previous published journal for this day.
    if let Some((prev_id, _)) = &previous {
        tx.execute(
            "UPDATE daily_journals
             SET status = 'superseded', superseded_by = ?1, updated_at = ?2
             WHERE id = ?3 AND status = 'published'",
            params![id, now, prev_id],
        )?;
    }
    tx.commit()?;

    Ok(DailyJournal {
        id,
        user_id,
        journal_date: facts.journal_date.clone(),
        version: new_version,
        status: DailyJournalStatus::Published,
        facts: facts.clone(),
        source_hash: facts.source_hash.clone(),
        rendered_markdown: rendered_markdown.map(str::to_owned),
        superseded_by: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Load the latest (highest version) journal for a given day.
pub fn load_latest_journal(
    conn: &Connection,
    user_id: &str,
    day: &str,
) -> DbResult<Option<DailyJournal>> {
    let user_id = normalize_user_id(user_id);
    require_text(day, "journalDate")?;
    let row = conn
        .query_row(
            "SELECT id, user_id, journal_date, version, status, facts_json, source_hash,
                    rendered_markdown, superseded_by, created_at, updated_at
             FROM daily_journals
             WHERE user_id = ?1 AND journal_date = ?2
             ORDER BY version DESC LIMIT 1",
            params![user_id, day],
            map_journal,
        )
        .optional()?;
    Ok(row)
}

/// Record a source range for a journal (provenance).
pub fn insert_journal_source(
    conn: &Connection,
    journal_id: &str,
    source_kind: &str,
    source_id: &str,
    range_hash: &str,
) -> DbResult<()> {
    require_text(journal_id, "journalId")?;
    require_text(source_kind, "sourceKind")?;
    require_text(source_id, "sourceId")?;
    require_text(range_hash, "rangeHash")?;
    if !matches!(
        source_kind,
        "event" | "observation" | "attempt" | "coach_feedback" | "memory_mutation" | "learner_delta"
    ) {
        return Err(DbError::Validation(format!(
            "invalid source_kind: {source_kind}"
        )));
    }
    conn.execute(
        "INSERT OR IGNORE INTO daily_journal_sources (journal_id, source_kind, source_id, range_hash)
         VALUES (?1, ?2, ?3, ?4)",
        params![journal_id, source_kind, source_id, range_hash],
    )?;
    Ok(())
}

fn map_journal(row: &rusqlite::Row<'_>) -> rusqlite::Result<DailyJournal> {
    let facts_json: String = row.get(5)?;
    let facts: JournalFacts =
        serde_json::from_str(&facts_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
    let status_str: String = row.get(4)?;
    let status = DailyJournalStatus::parse(&status_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid journal status: {status_str}"),
            )),
        )
    })?;
    Ok(DailyJournal {
        id: row.get(0)?,
        user_id: row.get(1)?,
        journal_date: row.get(2)?,
        version: row.get::<_, i64>(3)? as u32,
        status,
        facts,
        source_hash: row.get(6)?,
        rendered_markdown: row.get(7)?,
        superseded_by: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn count_attempts(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<u64> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts
             WHERE COALESCE(submitted_at, started_at) >= ?1
               AND COALESCE(submitted_at, started_at) < ?2",
            params![day_start, day_end],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    // attempts table has no user_id column; it is single-user (local).
    let _ = user_id;
    Ok(count as u64)
}

fn writing_eval_summary(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<WritingEvalSummary> {
    let _ = user_id;
    let completed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM writing_evaluations
             WHERE status = 'completed'
               AND COALESCE(completed_at, updated_at) >= ?1
               AND COALESCE(completed_at, updated_at) < ?2",
            params![day_start, day_end],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let degraded: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM writing_evaluations
             WHERE degradation_json IS NOT NULL AND degradation_json != '[]'
               AND COALESCE(completed_at, updated_at) >= ?1
               AND COALESCE(completed_at, updated_at) < ?2",
            params![day_start, day_end],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let avg_band: Option<f64> = {
        let avg: f64 = conn
            .query_row(
                "SELECT COALESCE(AVG(json_extract(result_json, '$.overallBand')), 0)
                 FROM writing_evaluations
                 WHERE status = 'completed' AND result_json IS NOT NULL
                   AND COALESCE(completed_at, updated_at) >= ?1
                   AND COALESCE(completed_at, updated_at) < ?2",
                params![day_start, day_end],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0.0);
        if completed > 0 {
            Some(avg)
        } else {
            None
        }
    };
    Ok(WritingEvalSummary {
        completed: completed as u64,
        degraded: degraded as u64,
        average_band: avg_band,
    })
}

fn skill_deltas(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<Vec<SkillDelta>> {
    // Aggregate skill observations for the day; the delta is the mean outcome
    // change compared to the prior state. For determinism, we compute the mean
    // outcome for the day per skill (bounded count).
    let mut stmt = conn.prepare(
        "SELECT skill_key, COUNT(*), AVG(outcome)
         FROM learner_skill_observations
         WHERE user_id = ?1 AND observed_at >= ?2 AND observed_at < ?3
         GROUP BY skill_key
         ORDER BY skill_key
         LIMIT ?4",
    )?;
    let rows = stmt.query_map(params![user_id, day_start, day_end, MAX_SKILL_DELTAS as i64], |row| {
        Ok(SkillDelta {
            skill_key: row.get(0)?,
            evidence_count: row.get::<_, i64>(1)? as u64,
            delta: row.get(2)?,
        })
    })?;
    let mut deltas = Vec::new();
    for row in rows {
        deltas.push(row?);
    }
    Ok(deltas)
}

/// Today-scoped observation IDs for Dream evidence (M7-06). Most-recent-first,
/// capped at the Python contract bound. IDs come from the projection table and
/// are stable `obs-*` identifiers.
fn today_observation_ids(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM learner_observations
         WHERE user_id = ?1 AND observed_at >= ?2 AND observed_at < ?3
         ORDER BY observed_at DESC, id ASC
         LIMIT ?4",
    )?;
    let rows = stmt.query_map(
        params![user_id, day_start, day_end, MAX_TODAY_OBSERVATION_IDS as i64],
        |row| row.get::<_, String>(0),
    )?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    Ok(ids)
}

/// Per-memory mutation events for Dream proposals (M7-06). Private/restricted
/// memories are excluded so their canonical keys never leave the projection;
/// only the identity-bearing view (id, namespace, canonical_key, change_kind)
/// is exposed, never memory content. `change_kind` uses the past-tense form the
/// Python dream kind_map consumes.
fn memory_events(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<Vec<JournalMemoryEvent>> {
    let _ = user_id;
    let mut stmt = conn.prepare(
        "SELECT m.memory_id, mi.namespace, mi.canonical_key, m.operation
         FROM memory_mutations m
         JOIN memory_items mi ON mi.id = m.memory_id
         WHERE m.created_at >= ?1 AND m.created_at < ?2
           AND mi.sensitivity = 'normal'
           AND m.memory_id IS NOT NULL
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![day_start, day_end, MAX_MEMORY_EVENTS as i64], |row| {
        let operation: String = row.get(3)?;
        Ok(JournalMemoryEvent {
            memory_id: row.get(0)?,
            namespace: row.get(1)?,
            canonical_key: row.get(2)?,
            change_kind: past_tense_change_kind(&operation),
        })
    })?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row?);
    }
    Ok(events)
}

fn memory_mutations(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<MemoryChangeSummary> {
    let mut summary = MemoryChangeSummary::default();
    let mut stmt = conn.prepare(
        "SELECT operation, COUNT(*)
         FROM memory_mutations
         WHERE created_at >= ?1 AND created_at < ?2
         GROUP BY operation",
    )?;
    let rows = stmt.query_map(params![day_start, day_end], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (operation, count) = row?;
        let count = count as u64;
        match operation.as_str() {
            "propose" | "create" => summary.new_candidates += count,
            "promote" => summary.promoted += count,
            "reinforce" => summary.reinforced += count,
            "refine" => summary.refined += count,
            "improve" => summary.improved += count,
            "regress" => summary.regressed += count,
            "contradict" => summary.contradicted += count,
            "supersede" => summary.superseded += count,
            _ => {}
        }
    }
    let _ = user_id;
    Ok(summary)
}

/// DB operations are present-tense; the Python dream kind_map keys on the
/// past-tense change_kind form. Unmapped operations pass through unchanged.
fn past_tense_change_kind(operation: &str) -> String {
    match operation {
        "promote" => "promoted".into(),
        "reinforce" => "reinforced".into(),
        "refine" => "refined".into(),
        "improve" => "improved".into(),
        "regress" => "regressed".into(),
        "contradict" => "contradicted".into(),
        "supersede" => "superseded".into(),
        "propose" | "create" => "proposed".into(),
        other => other.into(),
    }
}

fn coach_feedback_count(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<u64> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM coach_feedback
             WHERE created_at >= ?1 AND created_at < ?2",
            params![day_start, day_end],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let _ = user_id;
    Ok(count as u64)
}

fn coach_reask_count(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<u64> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM coach_reask_links
             WHERE created_at >= ?1 AND created_at < ?2",
            params![day_start, day_end],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let _ = user_id;
    Ok(count as u64)
}

fn time_spent(
    conn: &Connection,
    user_id: &str,
    day_start: &str,
    day_end: &str,
) -> DbResult<u64> {
    let total: Option<i64> = conn
        .query_row(
            "SELECT COALESCE(SUM(duration_ms), 0) FROM attempts
             WHERE COALESCE(submitted_at, started_at) >= ?1
               AND COALESCE(submitted_at, started_at) < ?2",
            params![day_start, day_end],
            |row| row.get(0),
        )
        .optional()?;
    let _ = user_id;
    Ok(total.unwrap_or(0) as u64)
}

fn daily_source_hash(
    attempts_count: &u64,
    writing_eval_summary: &WritingEvalSummary,
    skill_deltas: &[SkillDelta],
    memory_changes: &MemoryChangeSummary,
    coach_feedback_count: &u64,
    coach_reask_count: &u64,
    time_spent_ms: &u64,
    today_observation_ids: &[String],
    memory_events: &[JournalMemoryEvent],
    day: &str,
) -> String {
    // Stable canonical JSON for hashing (sorted keys).
    let mut hasher = Sha256::new();
    hasher.update(b"daily_journal_v1:");
    hasher.update(day.as_bytes());
    hasher.update(format!(":attempts={attempts_count}").as_bytes());
    hasher.update(
        format!(
            ":eval={}/{}/{:?}",
            writing_eval_summary.completed,
            writing_eval_summary.degraded,
            writing_eval_summary.average_band
        )
        .as_bytes(),
    );
    let mut skill_map: BTreeMap<&str, (u64, f64)> = BTreeMap::new();
    for delta in skill_deltas {
        skill_map.insert(&delta.skill_key, (delta.evidence_count, delta.delta));
    }
    hasher.update(b":skills=");
    for (key, (count, delta)) in &skill_map {
        hasher.update(format!("{key}={count}:{delta};").as_bytes());
    }
    hasher.update(
        format!(
            ":mem={}/{}/{}/{}/{}/{}/{}/{}",
            memory_changes.new_candidates,
            memory_changes.promoted,
            memory_changes.reinforced,
            memory_changes.refined,
            memory_changes.improved,
            memory_changes.regressed,
            memory_changes.contradicted,
            memory_changes.superseded
        )
        .as_bytes(),
    );
    hasher.update(format!(":fb={coach_feedback_count}").as_bytes());
    hasher.update(format!(":reask={coach_reask_count}").as_bytes());
    hasher.update(format!(":time={time_spent_ms}").as_bytes());
    hasher.update(b":obs=");
    for id in today_observation_ids {
        hasher.update(format!("{id};").as_bytes());
    }
    hasher.update(b":mev=");
    for event in memory_events {
        hasher.update(
            format!(
                "{}:{}:{}:{};",
                event.memory_id, event.namespace, event.canonical_key, event.change_kind
            )
            .as_bytes(),
        );
    }
    hex::encode(hasher.finalize())
}

fn day_bounds(day: &str) -> DbResult<(String, String)> {
    let date = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|error| DbError::Validation(format!("journalDate is not a valid date: {error}")))?;
    let start = date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| DbError::Validation("day start midnight overflowed".into()))?;
    let end = date
        .succ_opt()
        .ok_or_else(|| DbError::Validation("journalDate has no successor".into()))?
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| DbError::Validation("day end midnight overflowed".into()))?;
    // Bind to UTC so the RFC3339 output is well-formed.
    let start_utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(start, chrono::Utc);
    let end_utc = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(end, chrono::Utc);
    Ok((start_utc.to_rfc3339(), end_utc.to_rfc3339()))
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
