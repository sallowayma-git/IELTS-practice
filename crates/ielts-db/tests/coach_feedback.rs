//! M6 coach closed-loop integration tests.
//!
//! Verifies the canonical feedback/re-ask/strategy/outcome contract at the
//! SQLite boundary: idempotency, enum enforcement, re-ask linkage, and separate
//! satisfaction/learning outcome rows.

use ielts_db::{
    link_coach_outcome, migrate, open_connection, record_coach_feedback,
    record_coach_strategy_assignment, record_reask_link, DbOpenOptions,
};
use ielts_domain::{
    CoachFeedbackKind, CoachFollowupType, CoachOutcomeKind, CoachStrategyId,
    LinkCoachOutcomeCommand, RecordCoachFeedbackCommand, RecordCoachStrategyAssignmentCommand,
    RecordReaskLinkCommand,
};
use rusqlite::params;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    seed_coach_thread(&conn);
    seed_observation(&conn);
    (dir, conn)
}

fn seed_coach_thread(conn: &rusqlite::Connection) {
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
}

fn seed_observation(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO learning_projection_runs
           (id, projector_key, projector_version, input_hash, output_hash, status, started_at, finished_at)
         VALUES
           ('lpr-1', 'learning_observation_v1', 1, 'in', 'out', 'completed',
            '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
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
            NULL, 1.0, NULL, '{}', 1.0, 1.0, '2026-08-16T00:00:00Z',
            'learning_observation_v1', 1, 'fp', '2026-08-16T00:00:00Z')",
        [],
    )
    .unwrap();
}

fn feedback_command(message_id: &str, kind: CoachFeedbackKind) -> RecordCoachFeedbackCommand {
    RecordCoachFeedbackCommand {
        user_id: "local".into(),
        coach_message_id: message_id.into(),
        feedback_kind: kind,
        payload: None,
    }
}

#[test]
fn feedback_retry_is_idempotent_and_hydrates() {
    let (_dir, conn) = open_db();
    let first =
        record_coach_feedback(&conn, &feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp))
            .unwrap();
    let second =
        record_coach_feedback(&conn, &feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp))
            .unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(first.created_at, second.created_at);
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
fn feedback_enum_check_rejects_unknown_kind() {
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
fn reask_link_records_explicit_linkage_and_is_idempotent() {
    let (_dir, conn) = open_db();
    let command = RecordReaskLinkCommand {
        user_id: "local".into(),
        parent_assistant_message_id: "cmsg-parent".into(),
        new_user_message_id: "cmsg-user".into(),
    };
    let first = record_reask_link(&conn, &command).unwrap();
    let second = record_reask_link(&conn, &command).unwrap();
    assert_eq!(first.created_at, second.created_at);
    assert_eq!(first.feedback_kind, CoachFeedbackKind::ReaskSameQuestion);
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
fn strategy_assignment_upserts_on_message_and_persists_metadata() {
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
    updated.strategy_id = CoachStrategyId::ConciseDirectV1;
    updated.followup_type = CoachFollowupType::ConciseDirect;
    let second = record_coach_strategy_assignment(&conn, &updated).unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(second.strategy_id, CoachStrategyId::ConciseDirectV1);
    assert_eq!(second.followup_type, CoachFollowupType::ConciseDirect);
    let stored_strategy: String = conn
        .query_row(
            "SELECT strategy_id FROM coach_strategy_assignments_v0 WHERE coach_message_id = 'cmsg-parent'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored_strategy, "concise_direct_v1");
}

#[test]
fn outcome_links_keep_satisfaction_and_learning_separate() {
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
    assert_ne!(satisfaction.outcome_kind, learning.outcome_kind);
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
fn outcome_link_same_kind_is_idempotent() {
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
