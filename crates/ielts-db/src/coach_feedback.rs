//! M6 coach closed-loop persistence: canonical feedback, re-ask linkage,
//! strategy assignment provenance, and outcome links.
//!
//! These tables record user-interaction facts and teaching-strategy provenance.
//! They are NOT long-term preferences on their own: M6-07 only promotes repeated
//! patterns to memory candidates after later outcomes confirm a stable
//! preference.
//!
//! Idempotency:
//! - `coach_feedback` is unique on (coach_message_id, feedback_kind); a retry of
//!   the same feedback on the same message does not create a duplicate row.
//! - `coach_reask_links` is keyed on (parent_assistant_message_id,
//!   new_user_message_id).
//! - `coach_strategy_assignments_v0` is unique on coach_message_id (one
//!   strategy per assistant message).
//! - Existing `coach_outcome_links_v0` rows remain readable by other consumers.
//!   New attribution fails closed until trusted provenance is available.

use ielts_domain::{
    CoachFeedbackKind, CoachFeedbackRecord, CoachFollowupType, CoachOutcomeKind,
    CoachOutcomeLinkRecord, CoachReaskLinkRecord, CoachStrategyAssignmentRecord, CoachStrategyId,
    LinkCoachOutcomeCommand, RecordCoachFeedbackCommand, RecordCoachStrategyAssignmentCommand,
    RecordReaskLinkCommand,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use uuid::Uuid;

use crate::learning_events::{append_learning_event_if_enabled, NewLearningEvent};
use crate::sqlite::{DbError, DbResult};

const MAX_PAYLOAD_BYTES: usize = 8 * 1024;
const MAX_SKILLS: usize = 32;
const MAX_MEMORY_IDS: usize = 64;
const DEFAULT_USER_ID: &str = "local";

/// M6-05: record canonical coach feedback (user interaction fact). Idempotent:
/// the same (coach_message_id, feedback_kind) retried does not duplicate.
pub fn record_coach_feedback(
    conn: &Connection,
    command: &RecordCoachFeedbackCommand,
) -> DbResult<CoachFeedbackRecord> {
    let tx = conn.unchecked_transaction()?;
    let record = record_coach_feedback_in_transaction(&tx, command)?;
    tx.commit()?;
    Ok(record)
}

/// Reuse the caller's transaction so feedback, ledger and hydration commit together.
pub(crate) fn record_coach_feedback_in_transaction(
    tx: &Transaction<'_>,
    command: &RecordCoachFeedbackCommand,
) -> DbResult<CoachFeedbackRecord> {
    let conn: &Connection = tx;
    require_text(&command.coach_message_id, "coach_message_id")?;
    require_local_user(&command.user_id)?;
    require_completed_assistant(conn, &command.coach_message_id)?;
    let payload_json = command
        .payload
        .as_ref()
        .map(|value| {
            let text = serde_json::to_string(value)
                .map_err(|error| DbError::Message(error.to_string()))?;
            if text.len() > MAX_PAYLOAD_BYTES {
                return Err(DbError::Validation(format!(
                    "coach feedback payload exceeds {MAX_PAYLOAD_BYTES} bytes"
                )));
            }
            Ok(text)
        })
        .transpose()?;
    let id = format!("cfb-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let user_id = normalize_user_id(&command.user_id);
    let inserted = conn
        .execute(
            "INSERT INTO coach_feedback (id, user_id, coach_message_id, feedback_kind, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(coach_message_id, feedback_kind) DO NOTHING",
            params![
                id,
                user_id,
                command.coach_message_id,
                command.feedback_kind.as_str(),
                payload_json,
                now,
            ],
        )?
        == 1;
    if inserted {
        append_learning_event_if_enabled(
            conn,
            NewLearningEvent {
                event_type: ielts_domain::LearningEventType::CoachFeedbackProvided,
                source_kind: "coach_feedback".into(),
                source_id: Some(format!(
                    "{}:{}",
                    command.coach_message_id,
                    command.feedback_kind.as_str()
                )),
                activity: None,
                asset_id: None,
                attempt_id: None,
                question_id: None,
                skill_key: None,
                occurred_at: now.clone(),
                payload: serde_json::json!({
                    "feedbackId": id,
                    "coachMessageId": command.coach_message_id,
                    "feedbackKind": command.feedback_kind.as_str(),
                }),
                schema_version: ielts_domain::LearningEventType::SCHEMA_VERSION,
                sensitivity: "normal".into(),
            },
        )?;
    }
    load_coach_feedback(conn, &command.coach_message_id, command.feedback_kind)?
        .ok_or_else(|| DbError::Message("coach feedback insert did not hydrate".into()))
        .and_then(|record| {
            if record.user_id != DEFAULT_USER_ID {
                return Err(DbError::Validation(
                    "coach feedback owner must be local".into(),
                ));
            }
            Ok(record)
        })
}

fn load_coach_feedback(
    conn: &Connection,
    coach_message_id: &str,
    feedback_kind: CoachFeedbackKind,
) -> DbResult<Option<CoachFeedbackRecord>> {
    conn.query_row(
        "SELECT id, user_id, coach_message_id, feedback_kind, payload_json, created_at
         FROM coach_feedback
         WHERE coach_message_id = ?1 AND feedback_kind = ?2",
        params![coach_message_id, feedback_kind.as_str()],
        |row| {
            let payload_text: Option<String> = row.get(4)?;
            let payload = payload_text.and_then(|text| serde_json::from_str::<Value>(&text).ok());
            Ok(CoachFeedbackRecord {
                id: row.get(0)?,
                user_id: row.get(1)?,
                coach_message_id: row.get(2)?,
                feedback_kind,
                payload,
                created_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

/// M6-06: record a re-ask linkage. The user explicitly re-asked the same
/// question; the parent assistant message and the new user message are linked.
/// Asking a new question never creates a row here.
pub fn record_reask_link(
    conn: &Connection,
    command: &RecordReaskLinkCommand,
) -> DbResult<CoachReaskLinkRecord> {
    require_text(
        &command.parent_assistant_message_id,
        "parent_assistant_message_id",
    )?;
    require_text(&command.new_user_message_id, "new_user_message_id")?;
    if command.parent_assistant_message_id == command.new_user_message_id {
        return Err(DbError::Validation(
            "parent_assistant_message_id and new_user_message_id must differ".into(),
        ));
    }
    require_local_user(&command.user_id)?;
    let parent = load_link_message(conn, &command.parent_assistant_message_id)?;
    let new = load_link_message(conn, &command.new_user_message_id)?;
    if parent.role != "assistant" || new.role != "user" {
        return Err(DbError::Validation(
            "re-ask requires assistant parent and new user message".into(),
        ));
    }
    if parent.thread_id != new.thread_id {
        return Err(DbError::Validation(
            "re-ask messages must belong to the same thread".into(),
        ));
    }
    if new.sequence <= parent.sequence
        || parse_time(&new.created_at)? <= parse_time(&parent.created_at)?
    {
        return Err(DbError::Validation(
            "re-ask requires increasing sequence and time".into(),
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO coach_reask_links (parent_assistant_message_id, new_user_message_id, feedback_kind, created_at)
         VALUES (?1, ?2, 'reask_same_question', ?3)
         ON CONFLICT(parent_assistant_message_id, new_user_message_id) DO NOTHING",
        params![
            command.parent_assistant_message_id,
            command.new_user_message_id,
            now,
        ],
    )?;
    load_reask_link(
        conn,
        &command.parent_assistant_message_id,
        &command.new_user_message_id,
    )?
    .ok_or_else(|| DbError::Message("coach re-ask link insert did not hydrate".into()))
}

fn load_reask_link(
    conn: &Connection,
    parent_assistant_message_id: &str,
    new_user_message_id: &str,
) -> DbResult<Option<CoachReaskLinkRecord>> {
    conn.query_row(
        "SELECT parent_assistant_message_id, new_user_message_id, feedback_kind, created_at
         FROM coach_reask_links
         WHERE parent_assistant_message_id = ?1 AND new_user_message_id = ?2",
        params![parent_assistant_message_id, new_user_message_id],
        |row| {
            Ok(CoachReaskLinkRecord {
                parent_assistant_message_id: row.get(0)?,
                new_user_message_id: row.get(1)?,
                feedback_kind: CoachFeedbackKind::ReaskSameQuestion,
                created_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

/// Read an identical historical assignment retry without authorizing caller
/// supplied provenance. New assignments require host-owned evidence unavailable
/// through this command; conflicting retries must never rewrite history.
pub fn record_coach_strategy_assignment(
    conn: &Connection,
    command: &RecordCoachStrategyAssignmentCommand,
) -> DbResult<CoachStrategyAssignmentRecord> {
    require_text(&command.coach_message_id, "coach_message_id")?;
    require_local_user(&command.user_id)?;
    require_completed_assistant(conn, &command.coach_message_id)?;
    if command.skills_addressed.len() > MAX_SKILLS {
        return Err(DbError::Validation(format!(
            "skills_addressed exceeds {MAX_SKILLS} entries"
        )));
    }
    if command.memory_ids_used.len() > MAX_MEMORY_IDS {
        return Err(DbError::Validation(format!(
            "memory_ids_used exceeds {MAX_MEMORY_IDS} entries"
        )));
    }
    for skill in &command.skills_addressed {
        require_text(skill, "skills_addressed entry")?;
    }
    for memory_id in &command.memory_ids_used {
        require_text(memory_id, "memory_ids_used entry")?;
    }
    if let Some(context_snapshot_id) = &command.context_snapshot_id {
        require_text(context_snapshot_id, "context_snapshot_id")?;
    }
    let record = load_strategy_assignment(conn, &command.coach_message_id)?.ok_or_else(|| {
        DbError::Validation("new coach strategy assignment unavailable: requires verified host trace, bound snapshot and host-selected strategy metadata".into())
    })?;
    if record.user_id != DEFAULT_USER_ID
        || record.strategy_id != command.strategy_id
        || record.skills_addressed != command.skills_addressed
        || record.memory_ids_used != command.memory_ids_used
        || record.context_snapshot_id != command.context_snapshot_id
        || record.followup_type != command.followup_type
    {
        return Err(DbError::Validation(
            "coach strategy assignment conflict: historical assignment is immutable".into(),
        ));
    }
    Ok(record)
}

fn load_strategy_assignment(
    conn: &Connection,
    coach_message_id: &str,
) -> DbResult<Option<CoachStrategyAssignmentRecord>> {
    conn.query_row(
        "SELECT id, user_id, coach_message_id, strategy_id, skills_addressed_json,
                memory_ids_used_json, context_snapshot_id, followup_type, created_at
         FROM coach_strategy_assignments_v0
         WHERE coach_message_id = ?1",
        params![coach_message_id],
        |row| {
            let strategy_str: String = row.get(3)?;
            let skills_str: String = row.get(4)?;
            let memory_ids_str: String = row.get(5)?;
            let followup_str: String = row.get(7)?;
            let strategy_id = CoachStrategyId::parse(&strategy_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    3,
                    rusqlite::types::Type::Text,
                    Box::new(DbError::Message(format!(
                        "unknown coach strategy id: {strategy_str}"
                    ))),
                )
            })?;
            let followup_type = CoachFollowupType::parse(&followup_str).ok_or_else(|| {
                rusqlite::Error::FromSqlConversionFailure(
                    7,
                    rusqlite::types::Type::Text,
                    Box::new(DbError::Message(format!(
                        "unknown coach followup type: {followup_str}"
                    ))),
                )
            })?;
            let decode_list = |text: &str, column| {
                serde_json::from_str::<Vec<String>>(text).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        column, rusqlite::types::Type::Text, Box::new(error),
                    )
                })
            };
            let skills = decode_list(&skills_str, 4)?;
            let memory_ids = decode_list(&memory_ids_str, 5)?;
            Ok(CoachStrategyAssignmentRecord {
                id: row.get(0)?,
                user_id: row.get(1)?,
                coach_message_id: row.get(2)?,
                strategy_id,
                skills_addressed: skills,
                memory_ids_used: memory_ids,
                context_snapshot_id: row.get(6)?,
                followup_type,
                created_at: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

/// M6-10: validate a requested future-outcome link. v0 cannot authorize new
/// links: it lacks trusted context ownership and satisfaction projections.
/// Existing feedback, strategy assignments and explicit re-asks remain usable.
pub fn link_coach_outcome(
    conn: &Connection,
    command: &LinkCoachOutcomeCommand,
) -> DbResult<CoachOutcomeLinkRecord> {
    require_text(&command.strategy_assignment_id, "strategy_assignment_id")?;
    require_text(&command.future_observation_id, "future_observation_id")?;
    require_outcome_authority(conn, command)
}

fn require_completed_assistant(conn: &Connection, message_id: &str) -> DbResult<()> {
    let message: Option<(String, String)> = conn.query_row(
        "SELECT role, status FROM coach_messages WHERE id = ?1",
        params![message_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()?;
    let (role, status) = message.ok_or_else(|| {
        DbError::Validation(format!("coach message not found: {message_id}"))
    })?;
    if role != "assistant" || status != "completed" {
        return Err(DbError::Validation(
            "coach feedback/strategy requires a completed assistant message".into(),
        ));
    }
    Ok(())
}

struct LinkMessage {
    thread_id: String,
    role: String,
    sequence: i64,
    created_at: String,
}

fn load_link_message(conn: &Connection, id: &str) -> DbResult<LinkMessage> {
    conn.query_row(
        "SELECT thread_id, role, sequence, created_at FROM coach_messages WHERE id = ?1",
        [id],
        |row| {
            Ok(LinkMessage {
                thread_id: row.get(0)?,
                role: row.get(1)?,
                sequence: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| DbError::Validation(format!("coach message not found: {id}")))
}

fn require_local_user(user: &str) -> DbResult<()> {
    if normalize_user_id(user) != DEFAULT_USER_ID {
        return Err(DbError::Validation(
            "coach linkage owner must be local".into(),
        ));
    }
    Ok(())
}

fn parse_time(value: &str) -> DbResult<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| DbError::Validation("coach linkage requires valid RFC3339 time".into()))
}

/// v0 stores caller-supplied provenance, not a host-owned snapshot/thread/attempt
/// binding. Do not infer learning effectiveness from those fields. The current
/// observation projector also does not project CoachFeedbackProvided events.
/// Feedback and explicit re-asks remain supported independently of outcome links.
fn require_outcome_authority(
    conn: &Connection,
    command: &LinkCoachOutcomeCommand,
) -> DbResult<CoachOutcomeLinkRecord> {
    let assignment: Option<(String, String, String)> = conn.query_row(
        "SELECT user_id, coach_message_id, created_at FROM coach_strategy_assignments_v0 WHERE id = ?1",
        [&command.strategy_assignment_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    let (owner, message_id, assigned_at) = assignment
        .ok_or_else(|| DbError::Validation("coach strategy assignment not found".into()))?;
    if owner != DEFAULT_USER_ID {
        return Err(DbError::Validation(
            "coach outcome assignment owner must be local".into(),
        ));
    }
    let message = load_link_message(conn, &message_id)?;
    if message.role != "assistant" {
        return Err(DbError::Validation(
            "coach outcome assignment must reference an assistant message".into(),
        ));
    }
    let observation: Option<(String, String)> = conn
        .query_row(
            "SELECT user_id, observed_at FROM learner_observations WHERE id = ?1",
            [&command.future_observation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (user, observed_at) =
        observation.ok_or_else(|| DbError::Validation("learner observation not found".into()))?;
    if user != DEFAULT_USER_ID {
        return Err(DbError::Validation(
            "coach outcome observation owner must be local".into(),
        ));
    }
    let observed_at = parse_time(&observed_at)?;
    if observed_at <= parse_time(&assigned_at)? || observed_at <= parse_time(&message.created_at)? {
        return Err(DbError::Validation(
            "coach outcome requires a later observation".into(),
        ));
    }
    let limitation = match command.outcome_kind {
        CoachOutcomeKind::Learning => "v0 learning attribution unavailable: missing trusted context scope/snapshot binding to coach thread and attempt; same-skill and independent new-asset evidence cannot be authorized",
        CoachOutcomeKind::Satisfaction => "v0 satisfaction attribution unavailable: no canonical feedback observation projection; use record_coach_feedback for satisfaction facts",
    };
    Err(DbError::Validation(limitation.into()))
}

fn require_text(value: &str, field: &str) -> DbResult<()> {
    if value.trim().is_empty() {
        Err(DbError::Validation(format!("{field} is required")))
    } else {
        Ok(())
    }
}

fn normalize_user_id(user_id: &str) -> String {
    let trimmed = user_id.trim();
    if trimmed.is_empty() {
        DEFAULT_USER_ID.into()
    } else {
        trimmed.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate::migrate;
    use crate::sqlite::{open_connection, DbOpenOptions};
    use rusqlite::params;
    use tempfile::tempdir;

    fn open_db() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
        migrate(&mut conn).unwrap();
        // Seed a minimal coach thread + messages so the FK targets exist.
        conn.execute(
            "INSERT INTO coach_threads (id, status, created_at, updated_at)
             VALUES ('thread-1', 'active', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO coach_messages (id, thread_id, role, content, status, created_at, sequence)
             VALUES
               ('cmsg-parent', 'thread-1', 'assistant', 'body', 'completed', '2026-08-16T00:00:01Z', 1),
               ('cmsg-user', 'thread-1', 'user', 'why?', 'completed', '2026-08-16T00:00:02Z', 2)",
            [],
        )
        .unwrap();
        // Seed a learner observation so outcome links have a valid target.
        // learner_observations is a derived projection table; insert a minimal
        // row that satisfies the FK. The projection run must exist first.
        conn.execute(
            "INSERT INTO learning_projection_runs
               (id, projector_key, projector_version, input_hash, output_hash, status, started_at, finished_at)
             VALUES
               ('lpr-1', 'learning_observation_v1', 1, 'in', 'out', 'completed', '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO learner_observations
               (id, user_id, observation_type, namespace, scope_kind, scope_key, polarity,
                value_num, value_text, payload_json, confidence, evidence_strength, observed_at,
                projector_key, projector_version, source_fingerprint, created_at)
             VALUES
               ('lobs-1', 'local', 'reading.question.outcome', 'knowledge', 'activity', 'reading',
                NULL, 1.0, NULL, '{}', 1.0, 1.0, '2026-08-16T00:00:00Z', 'learning_observation_v1', 1, 'fp', '2026-08-16T00:00:00Z')",
            [],
        )
        .unwrap();
        (dir, conn)
    }

    fn feedback_command(kind: CoachFeedbackKind) -> RecordCoachFeedbackCommand {
        RecordCoachFeedbackCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-parent".into(),
            feedback_kind: kind,
            payload: None,
        }
    }

    #[test]
    fn feedback_helper_participates_in_outer_transaction() {
        let (_dir, conn) = open_db();
        let tx = conn.unchecked_transaction().unwrap();
        let command = feedback_command(CoachFeedbackKind::ThumbsUp);
        let first = record_coach_feedback_in_transaction(&tx, &command).unwrap();
        assert_eq!(
            first,
            record_coach_feedback_in_transaction(&tx, &command).unwrap()
        );
        tx.rollback().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM coach_feedback", [], |row| row.get(0)
        ).unwrap();
        assert_eq!(count, 0);
        let events: i64 = conn.query_row(
            "SELECT COUNT(*) FROM learning_events WHERE source_kind='coach_feedback'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(events, 0);
        record_coach_feedback(&conn, &command).unwrap();
    }

    #[test]
    fn feedback_is_idempotent_on_same_message_and_kind() {
        let (_dir, conn) = open_db();
        let first =
            record_coach_feedback(&conn, &feedback_command(CoachFeedbackKind::ThumbsUp)).unwrap();
        let second =
            record_coach_feedback(&conn, &feedback_command(CoachFeedbackKind::ThumbsUp)).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.feedback_kind, CoachFeedbackKind::ThumbsUp);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_feedback WHERE coach_message_id = 'cmsg-parent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn different_feedback_kinds_are_separate_rows() {
        let (_dir, conn) = open_db();
        record_coach_feedback(&conn, &feedback_command(CoachFeedbackKind::ThumbsUp)).unwrap();
        record_coach_feedback(&conn, &feedback_command(CoachFeedbackKind::TooLong)).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_feedback WHERE coach_message_id = 'cmsg-parent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn feedback_rejects_unknown_coach_message() {
        let (_dir, conn) = open_db();
        let mut command = feedback_command(CoachFeedbackKind::ThumbsDown);
        command.coach_message_id = "cmsg-ghost".into();
        let error = record_coach_feedback(&conn, &command).unwrap_err();
        assert!(matches!(error, DbError::Validation(_)));
    }

    #[test]
    fn feedback_enforces_canonical_enum_on_insert() {
        let (_dir, conn) = open_db();
        let error = conn
            .execute(
                "INSERT INTO coach_feedback (id, user_id, coach_message_id, feedback_kind, payload_json, created_at)
                 VALUES ('cfb-x', 'local', 'cmsg-parent', 'random_kind', NULL, '2026-08-16T00:00:00Z')",
                [],
            )
            .unwrap_err();
        assert!(error.to_string().contains("CHECK constraint failed"));
    }

    #[test]
    fn reask_link_is_idempotent_and_records_kind() {
        let (_dir, conn) = open_db();
        let command = RecordReaskLinkCommand {
            user_id: "local".into(),
            parent_assistant_message_id: "cmsg-parent".into(),
            new_user_message_id: "cmsg-user".into(),
        };
        let first = record_reask_link(&conn, &command).unwrap();
        let second = record_reask_link(&conn, &command).unwrap();
        assert_eq!(first.parent_assistant_message_id, "cmsg-parent");
        assert_eq!(first.new_user_message_id, "cmsg-user");
        assert_eq!(first.feedback_kind, CoachFeedbackKind::ReaskSameQuestion);
        assert_eq!(first.created_at, second.created_at);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_reask_links WHERE parent_assistant_message_id = 'cmsg-parent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn reask_link_rejects_self_reference() {
        let (_dir, conn) = open_db();
        let command = RecordReaskLinkCommand {
            user_id: "local".into(),
            parent_assistant_message_id: "cmsg-parent".into(),
            new_user_message_id: "cmsg-parent".into(),
        };
        let error = record_reask_link(&conn, &command).unwrap_err();
        assert!(matches!(error, DbError::Validation(_)));
    }

    #[test]
    fn strategy_assignment_history_is_immutable() {
        let (_dir, conn) = open_db();
        let command = RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: "cmsg-parent".into(),
            strategy_id: CoachStrategyId::EvidenceFirstV1,
            skills_addressed: vec!["reading.tfng".into()],
            memory_ids_used: vec!["mem-1".into()],
            context_snapshot_id: None,
            followup_type: CoachFollowupType::Explain,
        };
        let error = record_coach_strategy_assignment(&conn, &command).unwrap_err();
        assert!(error.to_string().contains("verified host trace"));
        let first = seed_history_assignment(&conn, &command).unwrap();
        assert_eq!(first, record_coach_strategy_assignment(&conn, &command).unwrap());
        let mut changed = command.clone();
        changed.strategy_id = CoachStrategyId::ConciseDirectV1;
        assert!(record_coach_strategy_assignment(&conn, &changed)
            .unwrap_err().to_string().contains("immutable"));
        assert_eq!(first, record_coach_strategy_assignment(&conn, &command).unwrap());
    }

    fn seed_history_assignment(
        conn: &rusqlite::Connection,
        command: &RecordCoachStrategyAssignmentCommand,
    ) -> Result<ielts_domain::CoachStrategyAssignmentRecord, DbError> {
        // Historical fixture, not proof of production host strategy selection.
        conn.execute(
            "INSERT INTO coach_strategy_assignments_v0
            (id,user_id,coach_message_id,strategy_id,skills_addressed_json,
             memory_ids_used_json,context_snapshot_id,followup_type,created_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                format!("legacy-{}", command.coach_message_id), command.user_id,
                command.coach_message_id, command.strategy_id.as_str(),
                serde_json::to_string(&command.skills_addressed).unwrap(),
                serde_json::to_string(&command.memory_ids_used).unwrap(),
                command.context_snapshot_id, command.followup_type.as_str(),
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        record_coach_strategy_assignment(conn, command)
    }

    #[test]
    fn strategy_assignment_rejects_unknown_strategy_id() {
        let (_dir, conn) = open_db();
        let error = conn
            .execute(
                "INSERT INTO coach_strategy_assignments_v0
                   (id, user_id, coach_message_id, strategy_id, skills_addressed_json,
                    memory_ids_used_json, context_snapshot_id, followup_type, created_at)
                 VALUES ('csa-x', 'local', 'cmsg-parent', 'random_strategy', '[]', '[]', NULL, 'explain', '2026-08-16T00:00:00Z')",
                [],
            )
            .unwrap_err();
        assert!(error.to_string().contains("CHECK constraint failed"));
    }

    #[test]
    fn outcome_links_cannot_promote_unattributable_observations() {
        let (_dir, conn) = open_db();
        let assignment = seed_history_assignment(
            &conn,
            &RecordCoachStrategyAssignmentCommand {
                user_id: "local".into(),
                coach_message_id: "cmsg-parent".into(),
                strategy_id: CoachStrategyId::StepByStepV1,
                skills_addressed: vec![],
                memory_ids_used: vec![],
                context_snapshot_id: None,
                followup_type: CoachFollowupType::StepByStep,
            },
        )
        .unwrap();
        let satisfaction = link_coach_outcome(
            &conn,
            &LinkCoachOutcomeCommand {
                strategy_assignment_id: assignment.id.clone(),
                future_observation_id: "lobs-1".into(),
                outcome_kind: CoachOutcomeKind::Satisfaction,
            },
        )
        .unwrap_err();
        let learning = link_coach_outcome(
            &conn,
            &LinkCoachOutcomeCommand {
                strategy_assignment_id: assignment.id.clone(),
                future_observation_id: "lobs-1".into(),
                outcome_kind: CoachOutcomeKind::Learning,
            },
        )
        .unwrap_err();
        assert!(matches!(satisfaction, DbError::Validation(_)));
        assert!(matches!(learning, DbError::Validation(_)));
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_outcome_links_v0 WHERE strategy_assignment_id = ?1",
                params![assignment.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn outcome_link_retries_remain_fail_closed() {
        let (_dir, conn) = open_db();
        let assignment = seed_history_assignment(
            &conn,
            &RecordCoachStrategyAssignmentCommand {
                user_id: "local".into(),
                coach_message_id: "cmsg-parent".into(),
                strategy_id: CoachStrategyId::ContrastiveV1,
                skills_addressed: vec![],
                memory_ids_used: vec![],
                context_snapshot_id: None,
                followup_type: CoachFollowupType::Contrast,
            },
        )
        .unwrap();
        let command = LinkCoachOutcomeCommand {
            strategy_assignment_id: assignment.id.clone(),
            future_observation_id: "lobs-1".into(),
            outcome_kind: CoachOutcomeKind::Learning,
        };
        assert!(matches!(
            link_coach_outcome(&conn, &command),
            Err(DbError::Validation(_))
        ));
        assert!(matches!(
            link_coach_outcome(&conn, &command),
            Err(DbError::Validation(_))
        ));
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_outcome_links_v0 WHERE strategy_assignment_id = ?1 AND outcome_kind = 'learning'",
                params![assignment.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn outcome_link_rejects_unknown_assignment_and_observation() {
        let (_dir, conn) = open_db();
        let error = link_coach_outcome(
            &conn,
            &LinkCoachOutcomeCommand {
                strategy_assignment_id: "csa-ghost".into(),
                future_observation_id: "lobs-1".into(),
                outcome_kind: CoachOutcomeKind::Learning,
            },
        )
        .unwrap_err();
        assert!(matches!(error, DbError::Validation(_)));
    }
}
