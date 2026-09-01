//! M10 Teaching Strategy Evolution integration tests at the SQLite boundary.
//!
//! Covers the M10 contract at the persistence layer:
//! - explicit preference wins (M10-06 rule 1)
//! - satisfaction vs learning reward separated (M10-03: never cross-attributed)
//! - no future outcome → no effectiveness claim (M10-04 out-of-window)
//! - repeated same asset discounted (M10-04 novel asset preferred)
//! - exploration cap (M10-06 rule 5: only when evidence sufficient)
//! - strategy rollback (M10-08 candidate reject)
//! - incorrect attribution window (M10-04: missing context snapshot)
//! - missing context snapshot (M10-04: no outcome recorded)

use ielts_db::{
    load_catalog, load_user_strategy_state, migrate, open_connection, promote_strategy_candidate,
    record_strategy_assignment, record_strategy_candidate_batch,
    record_strategy_candidate_evaluation, record_strategy_feedback, record_strategy_outcome,
    select_strategy, DbOpenOptions,
};
use ielts_domain::{
    OutcomeAttribution, PromoteStrategyCandidateCommand, RecordStrategyAssignmentCommand,
    RecordStrategyCandidateBatchCommand, RecordStrategyCandidateEvaluationCommand,
    RecordStrategyFeedbackCommand,
    RecordStrategyOutcomeCommand, SelectStrategyCommand, StrategyCandidateDisposition,
    StrategyFeedbackKind, StrategyOutcomeKind, StrategySelectionReason, TeachingStrategyId,
    DEFAULT_OUTCOME_WINDOW,
};
use rusqlite::params;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    seed_coach_thread(&conn);
    seed_context_snapshot(&conn);
    seed_observation(&conn, "lobs-1", "2026-08-16T00:00:00Z");
    (dir, conn)
}

fn valid_candidate_batch() -> serde_json::Value {
    serde_json::json!([{
        "strategyId": "proposition_decomposition_v1",
        "promptModule": "coach.strategies.evidence_first",
        "applicableActivity": "any",
        "applicableSkillKind": "any",
        "contraindications": [],
        "maxVerbosity": 3,
        "version": 1
    }])
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
           ('cmsg-1', 'thread-1', 'assistant', 'body', 'completed', '2026-08-16T00:00:01Z', 1)",
        [],
    )
    .unwrap();
}

fn seed_context_snapshot(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO agent_context_snapshots
           (id, run_id, planner_version, scope, query_plan_json, token_budget,
            used_tokens, rendered_context, content_hash, created_at)
         VALUES
           ('snap-1', NULL, 'planner-v1', 'reading', '{}', 100, 50, 'rendered', 'hash-1',
            '2026-08-16T00:00:00Z')",
        [],
    )
    .unwrap();
}

fn seed_observation(conn: &rusqlite::Connection, id: &str, observed_at: &str) {
    seed_observation_with_fingerprint(conn, id, observed_at, "fp");
}

fn seed_observation_with_fingerprint(
    conn: &rusqlite::Connection,
    id: &str,
    observed_at: &str,
    fingerprint: &str,
) {
    conn.execute(
        "INSERT INTO learning_projection_runs
           (id, projector_key, projector_version, input_hash, output_hash, status, started_at, finished_at)
         VALUES
           ('lpr-1', 'learning_observation_v1', 1, 'in', 'out', 'completed',
            '2026-08-16T00:00:00Z', '2026-08-16T00:00:00Z')",
        [],
    )
    .ok();
    conn.execute(
        "INSERT INTO learner_observations
           (id, user_id, observation_type, namespace, scope_kind, scope_key, polarity,
            value_num, value_text, payload_json, confidence, evidence_strength, observed_at,
            projector_key, projector_version, source_fingerprint, created_at)
         VALUES
           (?1, 'local', 'reading.question.outcome', 'knowledge', 'activity', 'reading',
            NULL, 1.0, NULL, '{}', 1.0, 1.0, ?2,
            'learning_observation_v1', 1, ?3, '2026-08-16T00:00:00Z')",
        params![id, observed_at, fingerprint],
    )
    .unwrap();
}

fn assignment_command(
    strategy_id: TeachingStrategyId,
    response_message_id: &str,
    with_snapshot: bool,
) -> RecordStrategyAssignmentCommand {
    RecordStrategyAssignmentCommand {
        user_id: "local".into(),
        strategy_id,
        why_selected: serde_json::json!({"rule": "default"}),
        memory_ids: vec![],
        skill_keys: vec!["reading.tfng".into()],
        context_snapshot_id: if with_snapshot {
            Some("snap-1".into())
        } else {
            None
        },
        response_message_id: response_message_id.into(),
    }
}

fn feedback_command(assignment_id: &str, kind: StrategyFeedbackKind) -> RecordStrategyFeedbackCommand {
    RecordStrategyFeedbackCommand {
        assignment_id: assignment_id.into(),
        feedback_kind: kind,
    }
}

fn outcome_command(
    assignment_id: &str,
    kind: StrategyOutcomeKind,
    novel_asset: Option<&str>,
) -> RecordStrategyOutcomeCommand {
    RecordStrategyOutcomeCommand {
        assignment_id: assignment_id.into(),
        outcome_kind: kind,
        observation_id: Some("lobs-1".into()),
        novel_asset_id: novel_asset.map(|s| s.into()),
        score_delta: Some(0.2),
    }
}

#[test]
fn catalog_is_seeded_with_eight_strategies_and_one_default() {
    let (_dir, conn) = open_db();
    let catalog = load_catalog(&conn).unwrap();
    assert_eq!(catalog.len(), 8, "eight developer-defined strategies");
    let defaults: Vec<_> = catalog.iter().filter(|e| e.is_default).collect();
    assert_eq!(defaults.len(), 1, "exactly one default strategy");
    assert_eq!(defaults[0].strategy_id, TeachingStrategyId::EvidenceFirstV1);
    // The two new strategies are present.
    assert!(catalog.iter().any(|e| e.strategy_id == TeachingStrategyId::ErrorThenRuleV1));
    assert!(catalog.iter().any(|e| e.strategy_id == TeachingStrategyId::RuleThenExampleV1));
}

#[test]
fn explicit_preference_wins_over_default() {
    let (_dir, conn) = open_db();
    // No user state -> without an explicit preference, default wins.
    let selection = select_strategy(
        &conn,
        &SelectStrategyCommand {
            user_id: "local".into(),
            scope: "reading".into(),
            skill_kind: "any".into(),
            explicit_preference: None,
            memory_ids: vec![],
            context_snapshot_id: None,
        },
    )
    .unwrap();
    assert_eq!(selection.strategy_id, TeachingStrategyId::EvidenceFirstV1);
    assert_eq!(selection.reason, StrategySelectionReason::Default);

    // With an explicit preference (applicable: catalog "any"/"any"), it wins.
    let selection = select_strategy(
        &conn,
        &SelectStrategyCommand {
            user_id: "local".into(),
            scope: "reading".into(),
            skill_kind: "any".into(),
            explicit_preference: Some(TeachingStrategyId::ExampleFirstV1),
            memory_ids: vec![],
            context_snapshot_id: None,
        },
    )
    .unwrap();
    assert_eq!(selection.strategy_id, TeachingStrategyId::ExampleFirstV1);
    assert_eq!(selection.reason, StrategySelectionReason::ExplicitPreference);
}

#[test]
fn satisfaction_feedback_never_written_to_learning_outcomes_table() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    // Record a satisfaction feedback (thumbs_up).
    let feedback =
        record_strategy_feedback(&conn, &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp))
            .unwrap();
    assert_eq!(feedback.feedback_kind, StrategyFeedbackKind::ThumbsUp);

    // The satisfaction table has a row; the learning outcomes table has none.
    let satisfaction_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_feedback WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(satisfaction_count, 1);
    let outcome_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_outcomes WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(outcome_count, 0, "a thumbs-up is never a learning outcome");
}

#[test]
fn learning_outcome_never_written_to_satisfaction_table() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    let attribution = record_strategy_outcome(
        &conn,
        &outcome_command(&assignment.id, StrategyOutcomeKind::NextNovelSkillAttempt, Some("asset-novel")),
    )
    .unwrap();
    assert!(matches!(attribution, OutcomeAttribution::Attributed { .. }));

    // The outcomes table has a row; the satisfaction table has none.
    let outcome_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_outcomes WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(outcome_count, 1);
    let satisfaction_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_feedback WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(satisfaction_count, 0, "a learning outcome is never a satisfaction fact");
}

#[test]
fn out_of_window_observation_is_not_recorded() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    // Seed more than DEFAULT_OUTCOME_WINDOW subsequent observations, all
    // after the assignment's created_at (the assignment's created_at is now,
    // so any earlier observed_at is "before"; we use future timestamps).
    let base = chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap();
    for i in 1..=(DEFAULT_OUTCOME_WINDOW + 1) {
        let later = base + chrono::Duration::seconds(i as i64);
        seed_observation_with_fingerprint(
            &conn,
            &format!("lobs-future-{i}"),
            &later.to_rfc3339(),
            &format!("fp-{i}"),
        );
    }
    let attribution = record_strategy_outcome(
        &conn,
        &outcome_command(&assignment.id, StrategyOutcomeKind::NextNovelSkillAttempt, Some("asset-novel")),
    )
    .unwrap();
    assert!(matches!(attribution, OutcomeAttribution::OutOfWindow), "out-of-window must not record");
    let outcome_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_outcomes WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(outcome_count, 0, "no effectiveness claim without a future outcome in window");
}

#[test]
fn missing_context_snapshot_blocks_outcome_recording() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", false),
    )
    .unwrap();
    let attribution = record_strategy_outcome(
        &conn,
        &outcome_command(&assignment.id, StrategyOutcomeKind::NextNovelSkillAttempt, Some("asset-novel")),
    )
    .unwrap();
    assert!(matches!(attribution, OutcomeAttribution::MissingContextSnapshot), "missing context snapshot must not record");
    let outcome_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_outcomes WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(outcome_count, 0);
}

#[test]
fn repeated_same_asset_outcome_is_recorded_but_flagged_non_novel() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    // A repeated-asset attempt (no novel_asset_id) is recorded but non-novel.
    let attribution = record_strategy_outcome(
        &conn,
        &outcome_command(&assignment.id, StrategyOutcomeKind::NextNovelSkillAttempt, None),
    )
    .unwrap();
    match attribution {
        OutcomeAttribution::Attributed { novel_asset, .. } => {
            assert!(!novel_asset, "repeated same asset is discounted (non-novel)");
        }
        other => panic!("expected Attributed, got {other:?}"),
    }
    // A novel-asset attempt is recorded and flagged novel.
    let attribution = record_strategy_outcome(
        &conn,
        &outcome_command(&assignment.id, StrategyOutcomeKind::TransferToAnotherAsset, Some("asset-new")),
    )
    .unwrap();
    match attribution {
        OutcomeAttribution::Attributed { novel_asset, .. } => {
            assert!(novel_asset, "novel asset is flagged");
        }
        other => panic!("expected Attributed, got {other:?}"),
    }
}

#[test]
fn user_strategy_state_aggregates_confidence_bounded() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    // 2 successes (thumbs_up) + 1 failure (thumbs_down).
    record_strategy_feedback(&conn, &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp)).unwrap();
    record_strategy_feedback(&conn, &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp)).unwrap();
    record_strategy_feedback(&conn, &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsDown)).unwrap();
    let state = load_user_strategy_state(&conn, "local", TeachingStrategyId::EvidenceFirstV1, "reading")
        .unwrap()
        .expect("state row exists");
    assert_eq!(state.success_count, 2);
    assert_eq!(state.failure_count, 1);
    assert_eq!(state.satisfaction_count, 3);
    // confidence = 2/(2+1) = 0.666...
    assert!((state.confidence - 2.0 / 3.0).abs() < 1e-6, "bounded confidence formula");
    assert!(state.confidence >= 0.0 && state.confidence <= 1.0, "clamped to [0,1]");
}

#[test]
fn candidate_batch_rejected_is_never_executable() {
    let (_dir, conn) = open_db();
    let batch = record_strategy_candidate_batch(
        &conn,
        &RecordStrategyCandidateBatchCommand {
            batch: serde_json::json!([{"candidate": "proposition_decomposition_v1"}]),
        },
    )
    .unwrap();
    assert_eq!(batch.disposition, StrategyCandidateDisposition::Pending);
    let decision = promote_strategy_candidate(
        &conn,
        &PromoteStrategyCandidateCommand {
            batch_id: batch.id.clone(),
            promote: false,
        },
    )
    .unwrap();
    assert_eq!(decision.disposition, StrategyCandidateDisposition::Rejected);
    let stored: String = conn
        .query_row(
            "SELECT disposition FROM strategy_candidate_batches WHERE id = ?1",
            params![batch.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "rejected", "candidate rollback persists");
}

#[test]
fn candidate_batch_promoted_marks_for_offline_eval() {
    let (_dir, conn) = open_db();
    let batch = record_strategy_candidate_batch(
        &conn,
        &RecordStrategyCandidateBatchCommand {
            batch: valid_candidate_batch(),
        },
    )
    .unwrap();
    let err = promote_strategy_candidate(
        &conn,
        &PromoteStrategyCandidateCommand {
            batch_id: batch.id.clone(),
            promote: true,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("passing offline evaluation"));

    let evaluation = record_strategy_candidate_evaluation(
        &conn,
        &RecordStrategyCandidateEvaluationCommand {
            batch_id: batch.id.clone(),
        },
    )
    .unwrap();
    assert!(evaluation.passed);
    assert_eq!(evaluation.metrics["evaluatorVersion"], "m10-strategy-structure-v1");
    let decision = promote_strategy_candidate(
        &conn,
        &PromoteStrategyCandidateCommand {
            batch_id: batch.id.clone(),
            promote: true,
        },
    )
    .unwrap();
    assert_eq!(decision.disposition, StrategyCandidateDisposition::Promoted);
    // A promoted candidate is still NOT in the executable catalog enum.
    let catalog = load_catalog(&conn).unwrap();
    assert!(!catalog.iter().any(|e| e.prompt_module.contains("proposition_decomposition")));
}

#[test]
fn latest_failed_strategy_eval_blocks_promotion() {
    let (_dir, conn) = open_db();
    let batch = record_strategy_candidate_batch(
        &conn,
        &RecordStrategyCandidateBatchCommand {
            batch: valid_candidate_batch(),
        },
    )
    .unwrap();
    record_strategy_candidate_evaluation(
        &conn,
        &RecordStrategyCandidateEvaluationCommand {
            batch_id: batch.id.clone(),
        },
    )
    .unwrap();
    conn.execute(
        "INSERT INTO strategy_candidate_evaluations
           (id, batch_id, passed, metrics_json, created_at)
         VALUES ('tsev-forged-test', ?1, 0, '{\"evaluatorVersion\":\"test\"}',
                 '9999-01-01T00:00:00Z')",
        params![batch.id],
    )
    .unwrap();

    let err = promote_strategy_candidate(
        &conn,
        &PromoteStrategyCandidateCommand {
            batch_id: batch.id.clone(),
            promote: true,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("passing offline evaluation"));
    let stored: String = conn
        .query_row(
            "SELECT disposition FROM strategy_candidate_batches WHERE id = ?1",
            params![batch.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "eval");
}

#[test]
fn candidate_evaluator_derives_failure_and_rejects_caller_verdict_fields() {
    let (_dir, conn) = open_db();
    let batch = record_strategy_candidate_batch(
        &conn,
        &RecordStrategyCandidateBatchCommand {
            batch: serde_json::json!([{"candidate": "caller_cannot_choose_verdict"}]),
        },
    )
    .unwrap();
    let evaluation = record_strategy_candidate_evaluation(
        &conn,
        &RecordStrategyCandidateEvaluationCommand {
            batch_id: batch.id,
        },
    )
    .unwrap();
    assert!(!evaluation.passed);
    assert_eq!(evaluation.metrics["allPassed"], false);
    assert!(!evaluation.metrics["validationErrors"].as_array().unwrap().is_empty());

    let parsed = serde_json::from_value::<RecordStrategyCandidateEvaluationCommand>(
        serde_json::json!({"batchId": "tscb-test", "passed": true, "metrics": {}}),
    );
    assert!(parsed.is_err(), "IPC must not accept caller-supplied verdict fields");
}

#[test]
fn rejected_strategy_batch_cannot_be_promoted_later() {
    let (_dir, conn) = open_db();
    let batch = record_strategy_candidate_batch(
        &conn,
        &RecordStrategyCandidateBatchCommand {
            batch: serde_json::json!([{"candidate": "proposition_decomposition_v1"}]),
        },
    )
    .unwrap();
    promote_strategy_candidate(
        &conn,
        &PromoteStrategyCandidateCommand {
            batch_id: batch.id.clone(),
            promote: false,
        },
    )
    .unwrap();
    let err = promote_strategy_candidate(
        &conn,
        &PromoteStrategyCandidateCommand {
            batch_id: batch.id,
            promote: true,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("cannot transition"));
}

#[test]
fn exploration_does_not_fire_with_insufficient_evidence() {
    let (_dir, conn) = open_db();
    // Cold state: no evidence. Selection must be Default, never Exploration.
    for _ in 0..10 {
        let selection = select_strategy(
            &conn,
            &SelectStrategyCommand {
                user_id: "local".into(),
                scope: "reading".into(),
                skill_kind: "any".into(),
                explicit_preference: None,
                memory_ids: vec![],
                context_snapshot_id: Some("snap-1".into()),
            },
        )
        .unwrap();
        assert_ne!(
            selection.reason,
            StrategySelectionReason::Exploration,
            "exploration must not fire with insufficient evidence"
        );
    }
}
