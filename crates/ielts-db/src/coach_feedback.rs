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
//! - `coach_outcome_links_v0` is keyed on (strategy_assignment_id,
//!   future_observation_id, outcome_kind); satisfaction and learning are
//!   recorded on separate rows.

use ielts_domain::{
    CoachFeedbackKind, CoachFeedbackRecord, CoachFollowupType, CoachOutcomeKind,
    CoachOutcomeLinkRecord, CoachReaskLinkRecord, CoachStrategyAssignmentRecord,
    CoachStrategyId, LinkCoachOutcomeCommand, RecordCoachFeedbackCommand,
    RecordCoachStrategyAssignmentCommand, RecordReaskLinkCommand,
};
use rusqlite::{params, Connection, OptionalExtension};
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
    require_text(&command.coach_message_id, "coach_message_id")?;
    require_message_exists(conn, &command.coach_message_id)?;
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
            let payload = payload_text
                .and_then(|text| serde_json::from_str::<Value>(&text).ok());
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
    require_text(&command.parent_assistant_message_id, "parent_assistant_message_id")?;
    require_text(&command.new_user_message_id, "new_user_message_id")?;
    if command.parent_assistant_message_id == command.new_user_message_id {
        return Err(DbError::Validation(
            "parent_assistant_message_id and new_user_message_id must differ".into(),
        ));
    }
    require_message_exists(conn, &command.parent_assistant_message_id)?;
    require_message_exists(conn, &command.new_user_message_id)?;
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
    load_reask_link(conn, &command.parent_assistant_message_id, &command.new_user_message_id)?
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

/// M6-04: record the teaching-strategy provenance for a coach response. One
/// strategy assignment per assistant message (unique on coach_message_id).
pub fn record_coach_strategy_assignment(
    conn: &Connection,
    command: &RecordCoachStrategyAssignmentCommand,
) -> DbResult<CoachStrategyAssignmentRecord> {
    require_text(&command.coach_message_id, "coach_message_id")?;
    require_message_exists(conn, &command.coach_message_id)?;
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
    let skills_json = serde_json::to_string(&command.skills_addressed)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let memory_ids_json = serde_json::to_string(&command.memory_ids_used)
        .map_err(|error| DbError::Message(error.to_string()))?;
    let id = format!("csa-{}", Uuid::new_v4());
    let now = chrono::Utc::now().to_rfc3339();
    let user_id = normalize_user_id(&command.user_id);
    conn.execute(
        "INSERT INTO coach_strategy_assignments_v0
           (id, user_id, coach_message_id, strategy_id, skills_addressed_json,
            memory_ids_used_json, context_snapshot_id, followup_type, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(coach_message_id) DO UPDATE SET
           strategy_id = excluded.strategy_id,
           skills_addressed_json = excluded.skills_addressed_json,
           memory_ids_used_json = excluded.memory_ids_used_json,
           context_snapshot_id = excluded.context_snapshot_id,
           followup_type = excluded.followup_type",
        params![
            id,
            user_id,
            command.coach_message_id,
            command.strategy_id.as_str(),
            skills_json,
            memory_ids_json,
            command.context_snapshot_id,
            command.followup_type.as_str(),
            now,
        ],
    )?;
    load_strategy_assignment(conn, &command.coach_message_id)?
        .ok_or_else(|| DbError::Message("coach strategy assignment insert did not hydrate".into()))
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
            let skills: Vec<String> =
                serde_json::from_str(&skills_str).unwrap_or_default();
            let memory_ids: Vec<String> =
                serde_json::from_str(&memory_ids_str).unwrap_or_default();
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

/// M6-10: link a strategy assignment to a future observation. Satisfaction and
/// learning outcomes are recorded on separate rows; a thumbs-up is never
/// treated as a learning outcome.
pub fn link_coach_outcome(
    conn: &Connection,
    command: &LinkCoachOutcomeCommand,
) -> DbResult<CoachOutcomeLinkRecord> {
    require_text(&command.strategy_assignment_id, "strategy_assignment_id")?;
    require_text(&command.future_observation_id, "future_observation_id")?;
    require_strategy_assignment_exists(conn, &command.strategy_assignment_id)?;
    require_observation_exists(conn, &command.future_observation_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO coach_outcome_links_v0
           (strategy_assignment_id, future_observation_id, outcome_kind, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(strategy_assignment_id, future_observation_id, outcome_kind) DO NOTHING",
        params![
            command.strategy_assignment_id,
            command.future_observation_id,
            command.outcome_kind.as_str(),
            now,
        ],
    )?;
    load_outcome_link(
        conn,
        &command.strategy_assignment_id,
        &command.future_observation_id,
        command.outcome_kind,
    )?
    .ok_or_else(|| DbError::Message("coach outcome link insert did not hydrate".into()))
}

fn load_outcome_link(
    conn: &Connection,
    strategy_assignment_id: &str,
    future_observation_id: &str,
    outcome_kind: CoachOutcomeKind,
) -> DbResult<Option<CoachOutcomeLinkRecord>> {
    conn.query_row(
        "SELECT strategy_assignment_id, future_observation_id, outcome_kind, created_at
         FROM coach_outcome_links_v0
         WHERE strategy_assignment_id = ?1 AND future_observation_id = ?2 AND outcome_kind = ?3",
        params![
            strategy_assignment_id,
            future_observation_id,
            outcome_kind.as_str(),
        ],
        |row| {
            Ok(CoachOutcomeLinkRecord {
                strategy_assignment_id: row.get(0)?,
                future_observation_id: row.get(1)?,
                outcome_kind,
                created_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn require_message_exists(conn: &Connection, message_id: &str) -> DbResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM coach_messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    )?;
    if count == 1 {
        Ok(())
    } else {
        Err(DbError::Validation(format!(
            "coach message not found: {message_id}"
        )))
    }
}

fn require_strategy_assignment_exists(
    conn: &Connection,
    assignment_id: &str,
) -> DbResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM coach_strategy_assignments_v0 WHERE id = ?1",
        params![assignment_id],
        |row| row.get(0),
    )?;
    if count == 1 {
        Ok(())
    } else {
        Err(DbError::Validation(format!(
            "coach strategy assignment not found: {assignment_id}"
        )))
    }
}

fn require_observation_exists(conn: &Connection, observation_id: &str) -> DbResult<()> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learner_observations WHERE id = ?1",
        params![observation_id],
        |row| row.get(0),
    )?;
    if count == 1 {
        Ok(())
    } else {
        Err(DbError::Validation(format!(
            "learner observation not found: {observation_id}"
        )))
    }
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
    fn feedback_is_idempotent_on_same_message_and_kind() {
        let (_dir, conn) = open_db();
        let first = record_coach_feedback(&conn, &feedback_command(CoachFeedbackKind::ThumbsUp))
            .unwrap();
        let second = record_coach_feedback(&conn, &feedback_command(CoachFeedbackKind::ThumbsUp))
            .unwrap();
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
    fn strategy_assignment_is_upsert_on_message() {
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
        let first = record_coach_strategy_assignment(&conn, &command).unwrap();
        let mut updated = command.clone();
        updated.strategy_id = CoachStrategyId::ExampleFirstV1;
        let second = record_coach_strategy_assignment(&conn, &updated).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.strategy_id, CoachStrategyId::ExampleFirstV1);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_strategy_assignments_v0 WHERE coach_message_id = 'cmsg-parent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
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
    fn outcome_links_satisfaction_and_learning_are_separate_rows() {
        let (_dir, conn) = open_db();
        let assignment = record_coach_strategy_assignment(
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
        .unwrap();
        let learning = link_coach_outcome(
            &conn,
            &LinkCoachOutcomeCommand {
                strategy_assignment_id: assignment.id.clone(),
                future_observation_id: "lobs-1".into(),
                outcome_kind: CoachOutcomeKind::Learning,
            },
        )
        .unwrap();
        assert_eq!(satisfaction.outcome_kind, CoachOutcomeKind::Satisfaction);
        assert_eq!(learning.outcome_kind, CoachOutcomeKind::Learning);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_outcome_links_v0 WHERE strategy_assignment_id = ?1",
                params![assignment.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn outcome_link_is_idempotent_on_same_kind() {
        let (_dir, conn) = open_db();
        let assignment = record_coach_strategy_assignment(
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
        link_coach_outcome(&conn, &command).unwrap();
        link_coach_outcome(&conn, &command).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM coach_outcome_links_v0 WHERE strategy_assignment_id = ?1 AND outcome_kind = 'learning'",
                params![assignment.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
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
