use std::collections::HashMap;

use chrono::{DateTime, Utc};
use ielts_domain::{
    question_transition_state, AttemptComparison, AttemptEvidenceScore, AttemptEvidenceSummary,
    AttemptEvidenceView, AttemptTimelinePoint, CompareAttemptsQuery, LearningEventSearchResult,
    QuestionEvidence, QuestionHistory, QuestionHistoryObservation, QuestionHistoryQuery,
    QuestionTransition, SearchLearningEventsQuery, TimelineSummary, LEARNING_EVIDENCE_VERSION,
};
use rusqlite::{params, Connection};

use crate::learning_events::list_learning_events_filtered;
use crate::sqlite::{DbError, DbResult};

const MAX_COMPARE_ATTEMPTS: u32 = 10;
const MAX_QUESTION_OBSERVATIONS: u32 = 50;

pub fn get_attempt_evidence(conn: &Connection, attempt_id: &str) -> DbResult<AttemptEvidenceView> {
    let attempt = conn.query_row(
        "SELECT id,asset_id,mode,started_at,COALESCE(completed_at,submitted_at),duration_ms,score_value,correct_count,question_count
         FROM attempts WHERE id = ?1 AND activity = 'reading' AND status = 'completed'",
        params![attempt_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?, row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?, row.get::<_, i64>(5)?,
                row.get::<_, Option<f64>>(6)?, row.get::<_, Option<f64>>(7)?,
                row.get::<_, Option<i64>>(8)?,
            ))
        },
    )?;
    let asset_id = attempt
        .1
        .ok_or_else(|| DbError::Validation("reading attempt has no asset".into()))?;
    let completed_at = attempt
        .4
        .ok_or_else(|| DbError::Validation("reading attempt has no completion time".into()))?;
    let questions = load_question_evidence(conn, attempt_id)?;
    let timeline_summary = summarize_questions(&questions);
    Ok(AttemptEvidenceView {
        attempt: AttemptEvidenceSummary {
            attempt_id: attempt.0,
            asset_id,
            mode: attempt.2,
            started_at: attempt.3,
            completed_at,
            duration_ms: attempt.5.max(0) as u64,
        },
        questions,
        score: AttemptEvidenceScore {
            score_value: attempt.6,
            correct_count: attempt.7,
            question_count: attempt.8.map(|value| value.max(0) as u32),
        },
        timeline_summary,
        evidence_version: LEARNING_EVIDENCE_VERSION,
    })
}

pub fn compare_attempts_for_asset(
    conn: &Connection,
    query: &CompareAttemptsQuery,
) -> DbResult<AttemptComparison> {
    require_text(&query.asset_id, "asset_id")?;
    let limit = query.limit.clamp(1, MAX_COMPARE_ATTEMPTS);
    let mut statement = conn.prepare(
        "WITH ranked AS (
           SELECT id,COALESCE(completed_at,submitted_at) completed_at,duration_ms,score_value,correct_count,question_count,
                  ROW_NUMBER() OVER (ORDER BY COALESCE(completed_at,submitted_at),id) ordinal
           FROM attempts
           WHERE activity = 'reading' AND status = 'completed' AND asset_id = ?1
         )
         SELECT id,completed_at,duration_ms,score_value,correct_count,question_count,ordinal
         FROM ranked ORDER BY ordinal DESC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![query.asset_id, i64::from(limit)], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, Option<f64>>(3)?,
            row.get::<_, Option<f64>>(4)?,
            row.get::<_, Option<i64>>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })?;
    let mut raw = rows.collect::<Result<Vec<_>, _>>()?;
    raw.reverse();

    let mut attempts = Vec::with_capacity(raw.len());
    let mut transitions = Vec::new();
    let mut previous_time: Option<DateTime<Utc>> = None;
    let mut previous_questions: HashMap<String, (String, Option<bool>)> = HashMap::new();
    let mut warning = false;
    for (
        attempt_id,
        completed_at,
        duration_ms,
        score_value,
        correct_count,
        question_count,
        ordinal,
    ) in raw
    {
        let questions = load_question_evidence(conn, &attempt_id)?;
        let summary = summarize_questions(&questions);
        let current_time = DateTime::parse_from_rfc3339(&completed_at)
            .ok()
            .map(|value| value.with_timezone(&Utc));
        let gap_hours = match (previous_time.as_ref(), current_time.as_ref()) {
            (Some(previous), Some(current)) => {
                Some((*current - *previous).num_seconds() as f64 / 3600.0)
            }
            _ => None,
        };
        if query.minimum_gap_hours > 0
            && gap_hours.is_some_and(|gap| gap < f64::from(query.minimum_gap_hours))
        {
            warning = true;
        }
        for question in &questions {
            let previous = previous_questions.get(&question.question_id);
            transitions.push(QuestionTransition {
                question_id: question.question_id.clone(),
                attempt_id: attempt_id.clone(),
                previous_attempt_id: previous.map(|value| value.0.clone()),
                state: question_transition_state(
                    previous.and_then(|value| value.1),
                    question.is_correct,
                )
                .into(),
                first_try_correct: question.first_try_correct,
                change_count: question.change_count,
                elapsed_ms: question.elapsed_ms,
            });
            if question.is_correct.is_some() {
                previous_questions.insert(
                    question.question_id.clone(),
                    (attempt_id.clone(), question.is_correct),
                );
            }
        }
        attempts.push(AttemptTimelinePoint {
            attempt_id,
            ordinal: ordinal.max(0) as u32,
            completed_at,
            gap_hours,
            score_value,
            correct_count,
            question_count: question_count.map(|value| value.max(0) as u32),
            duration_ms: duration_ms.max(0) as u64,
            change_count: summary.change_count,
            visit_count: summary.visit_count,
        });
        previous_time = current_time;
    }

    Ok(AttemptComparison {
        asset_id: query.asset_id.clone(),
        attempts,
        question_transitions: transitions,
        repeat_familiarity_warning: warning,
        minimum_gap_hours: query.minimum_gap_hours,
        evidence_version: LEARNING_EVIDENCE_VERSION,
    })
}

pub fn get_question_history(
    conn: &Connection,
    query: &QuestionHistoryQuery,
) -> DbResult<QuestionHistory> {
    require_text(&query.asset_id, "asset_id")?;
    require_text(&query.question_id, "question_id")?;
    let limit = query.limit.clamp(1, MAX_QUESTION_OBSERVATIONS);
    let mut statement = conn.prepare(
        "SELECT a.id,COALESCE(a.completed_at,a.submitted_at),aa.is_correct,aa.change_count,aa.visit_count,aa.elapsed_ms,aa.marked
         FROM attempts a JOIN attempt_answers aa ON aa.attempt_id = a.id
         WHERE a.activity = 'reading' AND a.status = 'completed' AND a.asset_id = ?1 AND aa.question_id = ?2
         ORDER BY COALESCE(a.completed_at,a.submitted_at),a.id LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![query.asset_id, query.question_id, i64::from(limit)],
        |row| {
            Ok(QuestionHistoryObservation {
                attempt_id: row.get(0)?,
                completed_at: row.get(1)?,
                is_correct: row.get::<_, Option<i64>>(2)?.map(|value| value != 0),
                change_count: row.get::<_, i64>(3)?.max(0) as u32,
                visit_count: row.get::<_, i64>(4)?.max(0) as u32,
                elapsed_ms: row.get::<_, i64>(5)?.max(0) as u64,
                marked: row.get::<_, i64>(6)? != 0,
            })
        },
    )?;
    Ok(QuestionHistory {
        asset_id: query.asset_id.clone(),
        question_id: query.question_id.clone(),
        observations: rows.collect::<Result<Vec<_>, _>>()?,
        evidence_version: LEARNING_EVIDENCE_VERSION,
    })
}

pub fn search_learning_events(
    conn: &Connection,
    query: &SearchLearningEventsQuery,
) -> DbResult<LearningEventSearchResult> {
    let requested = query.limit.clamp(1, 100);
    let mut probe = query.clone();
    probe.limit = requested.saturating_add(1);
    let mut events = list_learning_events_filtered(conn, &probe)?;
    let truncated = events.len() > requested as usize;
    events.truncate(requested as usize);
    Ok(LearningEventSearchResult {
        events,
        truncated,
        evidence_version: LEARNING_EVIDENCE_VERSION,
    })
}

fn load_question_evidence(conn: &Connection, attempt_id: &str) -> DbResult<Vec<QuestionEvidence>> {
    let mut statement = conn.prepare(
        "SELECT question_id,is_correct,question_kind,change_count,visit_count,elapsed_ms,marked
         FROM attempt_answers WHERE attempt_id = ?1 ORDER BY question_id",
    )?;
    let rows = statement.query_map(params![attempt_id], |row| {
        let is_correct = row.get::<_, Option<i64>>(1)?.map(|value| value != 0);
        let change_count = row.get::<_, i64>(3)?.max(0) as u32;
        Ok(QuestionEvidence {
            question_id: row.get(0)?,
            is_correct,
            question_kind: row.get(2)?,
            change_count,
            visit_count: row.get::<_, i64>(4)?.max(0) as u32,
            elapsed_ms: row.get::<_, i64>(5)?.max(0) as u64,
            marked: row.get::<_, i64>(6)? != 0,
            first_try_correct: is_correct.map(|correct| correct && change_count == 0),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn summarize_questions(questions: &[QuestionEvidence]) -> TimelineSummary {
    TimelineSummary {
        answered_count: questions.len() as u32,
        marked_count: questions.iter().filter(|question| question.marked).count() as u32,
        change_count: questions.iter().map(|question| question.change_count).sum(),
        visit_count: questions.iter().map(|question| question.visit_count).sum(),
        question_elapsed_ms: questions.iter().map(|question| question.elapsed_ms).sum(),
    }
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} required")))
    } else {
        Ok(())
    }
}
