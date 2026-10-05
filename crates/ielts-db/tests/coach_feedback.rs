//! M6 coach closed-loop integration tests.
//!
//! Verifies the canonical feedback/re-ask/strategy/outcome contract at the
//! SQLite boundary: idempotency, enum enforcement, re-ask linkage, and separate
//! satisfaction/learning outcome rows.

use ielts_db::{
    append_coach_message, ensure_coach_thread, import_asset_payload_file,
    learning_observations_rebuild, link_coach_outcome, migrate, open_connection,
    record_coach_feedback, record_coach_strategy_assignment, record_reask_link,
    submit_reading_attempt, AppendCoachMessageCommand, DbOpenOptions, EnsureCoachThreadCommand,
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
    let first = record_coach_feedback(
        &conn,
        &feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp),
    )
    .unwrap();
    let second = record_coach_feedback(
        &conn,
        &feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp),
    )
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
#[cfg(feature = "learning-event-ledger-v1")]
fn feedback_event_trigger_failure_rolls_back_and_retry_is_exactly_once() {
    let (_dir, conn) = open_db();
    let command = feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp);
    conn.execute_batch(
        "CREATE TRIGGER reject_feedback_event BEFORE INSERT ON learning_events
         WHEN NEW.source_kind='coach_feedback'
         BEGIN SELECT RAISE(ABORT, 'feedback event failure'); END;",
    ).unwrap();
    assert!(record_coach_feedback(&conn, &command).unwrap_err()
        .to_string().contains("feedback event failure"));
    let counts = || {
        conn.query_row(
            "SELECT (SELECT COUNT(*) FROM coach_feedback),
                    (SELECT COUNT(*) FROM learning_events WHERE source_kind='coach_feedback')",
            [], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        ).unwrap()
    };
    assert_eq!(counts(), (0, 0));
    conn.execute_batch("DROP TRIGGER reject_feedback_event").unwrap();
    let first = record_coach_feedback(&conn, &command).unwrap();
    for _ in 0..3 {
        assert_eq!(first, record_coach_feedback(&conn, &command).unwrap());
    }
    assert_eq!(counts(), (1, 1));
    let event: (String, String) = conn.query_row(
        "SELECT json_extract(payload_json, '$.feedbackId'), occurred_at
         FROM learning_events WHERE source_kind='coach_feedback'",
        [], |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();
    assert_eq!(event, (first.id, first.created_at));
}

#[test]
fn feedback_hydration_failure_rolls_back() {
    let (_dir, conn) = open_db();
    conn.execute_batch(
        "CREATE TRIGGER remove_feedback AFTER INSERT ON coach_feedback
         BEGIN DELETE FROM coach_feedback WHERE id=NEW.id; END;",
    ).unwrap();
    assert!(record_coach_feedback(&conn,
        &feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp))
        .unwrap_err().to_string().contains("did not hydrate"));
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM learning_events WHERE source_kind='coach_feedback'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn feedback_requires_local_completed_assistant_and_preserves_legacy_history() {
    let (_dir, conn) = open_db();
    let mut command = feedback_command("cmsg-parent", CoachFeedbackKind::ThumbsUp);
    command.user_id = "other-user".into();
    assert!(record_coach_feedback(&conn, &command).is_err());
    command.user_id = "local".into();
    command.coach_message_id = "cmsg-user".into();
    assert!(record_coach_feedback(&conn, &command).is_err());
    command.coach_message_id = "cmsg-parent".into();
    conn.execute("UPDATE coach_messages SET status='failed' WHERE id='cmsg-parent'", []).unwrap();
    assert!(record_coach_feedback(&conn, &command).is_err());
    conn.execute("UPDATE coach_messages SET status='completed' WHERE id='cmsg-parent'", []).unwrap();
    // Legal legacy history needs no invented host trace or remote identity.
    conn.execute(
        "INSERT INTO coach_feedback VALUES
         ('legacy-feedback','local','cmsg-parent','thumbs_up',NULL,'2026-08-16T00:00:03Z')",
        [],
    ).unwrap();
    let first = record_coach_feedback(&conn, &command).unwrap();
    assert_eq!(first.id, "legacy-feedback");
    assert_eq!(first, record_coach_feedback(&conn, &command).unwrap());
    conn.execute("UPDATE coach_feedback SET user_id='other-user' WHERE id='legacy-feedback'", []).unwrap();
    assert!(record_coach_feedback(&conn, &command).is_err());
}

#[test]
fn assignment_rejects_roles_owners_and_every_metadata_conflict() {
    let (_dir, conn) = open_db();
    let command = RecordCoachStrategyAssignmentCommand {
        user_id: "local".into(),
        coach_message_id: "cmsg-parent".into(),
        strategy_id: CoachStrategyId::EvidenceFirstV1,
        skills_addressed: vec![],
        memory_ids_used: vec![],
        context_snapshot_id: None,
        followup_type: CoachFollowupType::Explain,
    };
    let first = seed_history_assignment(&conn, &command).unwrap();
    let mut changes = vec![command.clone(); 6];
    changes[0].user_id = "other-user".into();
    changes[1].strategy_id = CoachStrategyId::ConciseDirectV1;
    changes[2].skills_addressed.push("reading.tfng".into());
    changes[3].memory_ids_used.push("memory".into());
    changes[4].context_snapshot_id = Some("caller-snapshot".into());
    changes[5].followup_type = CoachFollowupType::ConciseDirect;
    for changed in changes {
        assert!(record_coach_strategy_assignment(&conn, &changed).is_err());
        assert_eq!(first, record_coach_strategy_assignment(&conn, &command).unwrap());
    }
    let mut user_message = command.clone();
    user_message.coach_message_id = "cmsg-user".into();
    assert!(record_coach_strategy_assignment(&conn, &user_message)
        .unwrap_err().to_string().contains("completed assistant"));
    conn.execute("UPDATE coach_messages SET status='failed' WHERE id='cmsg-parent'", []).unwrap();
    assert!(record_coach_strategy_assignment(&conn, &command).is_err());
    conn.execute("UPDATE coach_messages SET status='completed' WHERE id='cmsg-parent'", []).unwrap();
    conn.execute("UPDATE coach_strategy_assignments_v0 SET user_id='other-user'", []).unwrap();
    assert!(record_coach_strategy_assignment(&conn, &command).is_err());
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
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM coach_strategy_assignments_v0", [], |r| r.get(0),
    ).unwrap();
    assert_eq!(count, 0);
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
) -> Result<ielts_domain::CoachStrategyAssignmentRecord, ielts_db::DbError> {
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
fn outcome_links_reject_unattributable_learning_and_satisfaction() {
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
    assert!(matches!(satisfaction, ielts_db::DbError::Validation(_)));
    assert!(matches!(learning, ielts_db::DbError::Validation(_)));
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
fn outcome_link_retry_does_not_create_untrusted_rows() {
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
    assert!(link_coach_outcome(&conn, &command).is_err());
    assert!(link_coach_outcome(&conn, &command).is_err());
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM coach_outcome_links_v0 WHERE strategy_assignment_id = ?1 AND outcome_kind = 'learning'",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

fn real_thread(conn: &rusqlite::Connection, attempt: Option<String>) -> String {
    ensure_coach_thread(
        conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: attempt,
            asset_id: None,
            kind: "practice".into(),
        },
    )
    .unwrap()
    .id
}

fn real_message(conn: &rusqlite::Connection, thread: &str, role: &str) -> String {
    append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.into(),
            role: role.into(),
            content: "Please explain this answer".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap()
    .id
}

#[test]
fn real_message_api_reasks_validate_relationship_and_do_not_mark_followups() {
    let (_dir, conn) = open_db();
    let thread = real_thread(&conn, None);
    let other_thread = real_thread(&conn, None);
    let old_user = real_message(&conn, &thread, "user");
    let parent = real_message(&conn, &thread, "assistant");
    let new = real_message(&conn, &thread, "user");
    let other_user = real_message(&conn, &other_thread, "user");
    // Fix fixture times without depending on wall-clock precision.
    for (id, time) in [
        (&old_user, "2026-08-16T00:00:00Z"),
        (&parent, "2026-08-16T00:00:01Z"),
        (&new, "2026-08-16T00:00:02Z"),
        (&other_user, "2026-08-16T00:00:03Z"),
    ] {
        conn.execute(
            "UPDATE coach_messages SET created_at=?2 WHERE id=?1",
            params![id, time],
        )
        .unwrap();
    }
    let count = || {
        conn.query_row("SELECT COUNT(*) FROM coach_reask_links", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
    };
    assert_eq!(
        count(),
        0,
        "ordinary append/followup must not infer a re-ask"
    );
    for (from, to, user) in [
        (&old_user, &parent, "local"),
        (&parent, &other_user, "local"),
        (&parent, &old_user, "local"),
        (&parent, &new, "other-user"),
        (&parent, &parent, "local"),
    ] {
        let error = record_reask_link(
            &conn,
            &RecordReaskLinkCommand {
                user_id: user.into(),
                parent_assistant_message_id: from.clone(),
                new_user_message_id: to.clone(),
            },
        )
        .unwrap_err();
        assert!(matches!(error, ielts_db::DbError::Validation(_)));
        assert_eq!(count(), 0);
    }
    let command = RecordReaskLinkCommand {
        user_id: "local".into(),
        parent_assistant_message_id: parent.clone(),
        new_user_message_id: new.clone(),
    };
    for bad_time in [
        "2026-08-16T00:00:01Z",
        "2026-08-16T01:00:00+02:00",
        "invalid",
    ] {
        conn.execute(
            "UPDATE coach_messages SET created_at=?2 WHERE id=?1",
            params![new, bad_time],
        )
        .unwrap();
        assert!(record_reask_link(&conn, &command).is_err());
        assert_eq!(count(), 0);
    }
    conn.execute(
        "UPDATE coach_messages SET created_at='2026-08-16T01:00:02+01:00' WHERE id=?1",
        [&new],
    )
    .unwrap();
    // Time alone does not compensate for an equal/decreasing sequence.
    conn.execute("UPDATE coach_messages SET sequence=2 WHERE id=?1", [&new])
        .unwrap();
    assert!(record_reask_link(&conn, &command).is_err());
    conn.execute("UPDATE coach_messages SET sequence=3 WHERE id=?1", [&new])
        .unwrap();
    let first = record_reask_link(&conn, &command).unwrap();
    assert_eq!(first, record_reask_link(&conn, &command).unwrap());
    assert_eq!(count(), 1);
}

fn real_reading_observation(
    conn: &rusqlite::Connection,
    dir: &tempfile::TempDir,
    asset: &str,
    attempt: &str,
) -> String {
    let path = dir.path().join(format!("{asset}.json"));
    let payload = serde_json::json!({"examId": asset, "meta": {"title": asset, "category": "P1"},
        "questionCount": 1, "questionOrder": ["q1"], "answerKey": {"q1": "TRUE"},
        "passage": {"blocks": [{"html": "<p>Practice evidence</p>"}]},
        "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]}]});
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(conn, &path).unwrap();
    submit_reading_attempt(conn, &serde_json::from_value(serde_json::json!({
        "attemptId": attempt, "assetId": asset, "answers": {"q1": "TRUE"}, "idempotencyKey": attempt,
    })).unwrap()).unwrap();
    learning_observations_rebuild(conn).unwrap();
    conn.query_row(
        "SELECT id FROM learner_observations WHERE observation_type='reading.question.outcome'
        AND json_extract(payload_json, '$.attemptId')=?1",
        [attempt],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn real_submission_projection_cannot_bypass_v0_attribution_limitations() {
    let (dir, conn) = open_db();
    let past = real_reading_observation(&conn, &dir, "asset-a", "attempt-a");
    let thread = real_thread(&conn, Some("attempt-a".into()));
    let parent = real_message(&conn, &thread, "assistant");
    let assignment = seed_history_assignment(
        &conn,
        &RecordCoachStrategyAssignmentCommand {
            user_id: "local".into(),
            coach_message_id: parent.clone(),
            strategy_id: CoachStrategyId::EvidenceFirstV1,
            skills_addressed: vec!["reading.tfng".into()],
            memory_ids_used: vec![],
            context_snapshot_id: None,
            followup_type: CoachFollowupType::Explain,
        },
    )
    .unwrap();
    let repeated = real_reading_observation(&conn, &dir, "asset-a", "attempt-repeat");
    let novel = real_reading_observation(&conn, &dir, "asset-c", "attempt-c");
    // Even an existing context snapshot is not proof of its Coach ownership.
    conn.execute(
        "INSERT INTO agent_context_snapshots (id, planner_version, scope, query_plan_json,
        token_budget, used_tokens, rendered_context, content_hash, created_at)
        VALUES ('unbound-snapshot', 'v1', 'internal', '{}', 0, 0, '', 'hash', ?1)",
        [&assignment.created_at],
    )
    .unwrap();
    conn.execute("UPDATE coach_strategy_assignments_v0 SET context_snapshot_id='unbound-snapshot' WHERE id=?1", [&assignment.id]).unwrap();
    let command = |id: &str, kind| LinkCoachOutcomeCommand {
        strategy_assignment_id: assignment.id.clone(),
        future_observation_id: id.into(),
        outcome_kind: kind,
    };
    let error = link_coach_outcome(&conn, &command(&past, CoachOutcomeKind::Learning)).unwrap_err();
    assert!(error.to_string().contains("later observation"));
    // Use an exact future instant to make this independent of timer resolution.
    let future = (chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap()
        + chrono::Duration::seconds(1))
    .to_rfc3339();
    for id in [&repeated, &novel] {
        conn.execute(
            "UPDATE learner_observations SET observed_at=?2 WHERE id=?1",
            params![id, future],
        )
        .unwrap();
        for _ in 0..2 {
            let error =
                link_coach_outcome(&conn, &command(id, CoachOutcomeKind::Learning)).unwrap_err();
            assert!(error
                .to_string()
                .contains("missing trusted context scope/snapshot binding"));
        }
    }
    conn.execute("UPDATE learner_observations SET user_id='other-user', observation_type='writing.criterion.band' WHERE id=?1", [&novel]).unwrap();
    let error =
        link_coach_outcome(&conn, &command(&novel, CoachOutcomeKind::Learning)).unwrap_err();
    assert!(error
        .to_string()
        .contains("observation owner must be local"));
    conn.execute(
        "UPDATE learner_observations SET user_id='local' WHERE id=?1",
        [&novel],
    )
    .unwrap();
    assert!(link_coach_outcome(&conn, &command(&novel, CoachOutcomeKind::Learning)).is_err());
    let error =
        link_coach_outcome(&conn, &command(&novel, CoachOutcomeKind::Satisfaction)).unwrap_err();
    assert!(error
        .to_string()
        .contains("no canonical feedback observation projection"));
    conn.execute(
        "UPDATE coach_strategy_assignments_v0 SET user_id='other-user' WHERE id=?1",
        [&assignment.id],
    )
    .unwrap();
    assert!(
        link_coach_outcome(&conn, &command(&novel, CoachOutcomeKind::Learning))
            .unwrap_err()
            .to_string()
            .contains("assignment owner must be local")
    );
    conn.execute(
        "UPDATE coach_strategy_assignments_v0 SET user_id='local' WHERE id=?1",
        [&assignment.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE coach_messages SET role='user' WHERE id=?1",
        [&parent],
    )
    .unwrap();
    assert!(
        link_coach_outcome(&conn, &command(&novel, CoachOutcomeKind::Learning))
            .unwrap_err()
            .to_string()
            .contains("assistant message")
    );
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM coach_outcome_links_v0", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(count, 0);
    conn.execute("UPDATE coach_messages SET role='assistant' WHERE id=?1", [&parent]).unwrap();
    // Existing v0 interaction flows remain available despite unavailable attribution.
    let feedback = record_coach_feedback(
        &conn,
        &feedback_command(&parent, CoachFeedbackKind::ThumbsUp),
    )
    .unwrap();
    assert_eq!(
        feedback,
        record_coach_feedback(
            &conn,
            &feedback_command(&parent, CoachFeedbackKind::ThumbsUp)
        )
        .unwrap()
    );
}
