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
    RecordStrategyFeedbackCommand, RecordStrategyOutcomeCommand, SelectStrategyCommand,
    StrategyCandidateDisposition, StrategyFeedbackKind, StrategyOutcomeKind,
    StrategySelectionReason, TeachingStrategyId, DEFAULT_OUTCOME_WINDOW,
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
    seed_scored_observation(
        conn,
        id,
        observed_at,
        fingerprint,
        "local",
        "reading.tfng",
        if id == "lobs-1" {
            "asset-original"
        } else {
            "asset-novel"
        },
        if id == "lobs-1" { 0.0 } else { 1.0 },
    );
}

fn seed_scored_observation(
    conn: &rusqlite::Connection,
    id: &str,
    observed_at: &str,
    fingerprint: &str,
    user: &str,
    skill: &str,
    asset: &str,
    score: f64,
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
           (?1, ?4, 'reading.question.outcome', 'reading', 'question', 'question-1',
            NULL, ?5, NULL, ?6, 1.0, 1.0, ?2,
            'learning_observation_v1', 1, ?3, '2026-08-16T00:00:00Z')",
        params![
            id,
            observed_at,
            fingerprint,
            user,
            score,
            serde_json::json!({"assetId": asset, "questionKind": "tfng"}).to_string()
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO learning_events (id, user_id, event_type, source_kind, idempotency_key,
         activity, asset_id, skill_key, occurred_at, payload_json, content_hash, created_at, updated_at)
         VALUES (?1, ?2, 'reading_question_outcome', 'test', ?1, 'reading', ?3, ?4, ?5, '{}', 'hash', ?5, ?5)",
        params![format!("event-{id}"), user, asset, skill, observed_at],
    ).unwrap();
    conn.execute(
        "INSERT INTO learner_observation_evidence (observation_id, event_id) VALUES (?1, ?2)",
        params![id, format!("event-{id}")],
    )
    .unwrap();
}

fn seed_future(conn: &rusqlite::Connection, assignment: &ielts_domain::StrategyAssignmentRecord) {
    let time = chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap()
        + chrono::Duration::seconds(1);
    seed_observation_with_fingerprint(conn, "lobs-future", &time.to_rfc3339(), "fp-future");
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

fn feedback_command(
    assignment_id: &str,
    kind: StrategyFeedbackKind,
) -> RecordStrategyFeedbackCommand {
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
        observation_id: Some("lobs-future".into()),
        novel_asset_id: novel_asset.map(|s| s.into()),
        score_delta: Some(1.0),
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
    assert!(catalog
        .iter()
        .any(|e| e.strategy_id == TeachingStrategyId::ErrorThenRuleV1));
    assert!(catalog
        .iter()
        .any(|e| e.strategy_id == TeachingStrategyId::RuleThenExampleV1));
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
    assert_eq!(
        selection.reason,
        StrategySelectionReason::ExplicitPreference
    );
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
    let feedback = record_strategy_feedback(
        &conn,
        &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp),
    )
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
    seed_future(&conn, &assignment);
    let command = outcome_command(
        &assignment.id,
        StrategyOutcomeKind::NextNovelSkillAttempt,
        Some("asset-novel"),
    );
    let attribution = record_strategy_outcome(&conn, &command).unwrap();
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
    assert_eq!(
        satisfaction_count, 0,
        "a learning outcome is never a satisfaction fact"
    );
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
    let mut command = outcome_command(
        &assignment.id,
        StrategyOutcomeKind::NextNovelSkillAttempt,
        Some("asset-novel"),
    );
    command.observation_id = Some(format!("lobs-future-{}", DEFAULT_OUTCOME_WINDOW + 1));
    let attribution = record_strategy_outcome(&conn, &command).unwrap();
    assert!(
        matches!(attribution, OutcomeAttribution::OutOfWindow),
        "out-of-window must not record"
    );
    let outcome_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_outcomes WHERE assignment_id = ?1",
            params![assignment.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        outcome_count, 0,
        "no effectiveness claim without a future outcome in window"
    );
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
        &outcome_command(
            &assignment.id,
            StrategyOutcomeKind::NextNovelSkillAttempt,
            Some("asset-novel"),
        ),
    )
    .unwrap();
    assert!(
        matches!(attribution, OutcomeAttribution::MissingContextSnapshot),
        "missing context snapshot must not record"
    );
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
    let base = chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap();
    seed_scored_observation(
        &conn,
        "lobs-future",
        &(base + chrono::Duration::seconds(1)).to_rfc3339(),
        "fp-repeat",
        "local",
        "reading.tfng",
        "asset-original",
        1.0,
    );
    // A repeated-asset attempt (no novel_asset_id) is recorded but non-novel.
    let attribution = record_strategy_outcome(
        &conn,
        &outcome_command(
            &assignment.id,
            StrategyOutcomeKind::NextNovelSkillAttempt,
            None,
        ),
    )
    .unwrap();
    match attribution {
        OutcomeAttribution::Attributed { novel_asset, .. } => {
            assert!(
                !novel_asset,
                "repeated same asset is discounted (non-novel)"
            );
        }
        other => panic!("expected Attributed, got {other:?}"),
    }
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::EvidenceFirstV1,
        "reading",
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        state.evidence_count(),
        0,
        "repeated assets neither reward nor punish"
    );
    seed_scored_observation(
        &conn,
        "lobs-new",
        &(base + chrono::Duration::seconds(2)).to_rfc3339(),
        "fp-new",
        "local",
        "reading.tfng",
        "asset-new",
        1.0,
    );
    let mut command = outcome_command(
        &assignment.id,
        StrategyOutcomeKind::TransferToAnotherAsset,
        Some("asset-new"),
    );
    command.observation_id = Some("lobs-new".into());
    // A novel-asset attempt is recorded and flagged novel.
    let attribution = record_strategy_outcome(&conn, &command).unwrap();
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
    // Satisfaction is not learning evidence.
    record_strategy_feedback(
        &conn,
        &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp),
    )
    .unwrap();
    record_strategy_feedback(
        &conn,
        &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp),
    )
    .unwrap();
    record_strategy_feedback(
        &conn,
        &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsDown),
    )
    .unwrap();
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::EvidenceFirstV1,
        "reading",
    )
    .unwrap()
    .expect("state row exists");
    assert_eq!(state.success_count, 0);
    assert_eq!(state.failure_count, 0);
    assert_eq!(state.satisfaction_count, 3);
    assert_eq!(state.confidence, 0.0, "zero evidence remains unknown");
    assert!(
        state.confidence >= 0.0 && state.confidence <= 1.0,
        "clamped to [0,1]"
    );
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
fn missing_unowned_old_unrelated_and_unbacked_observations_cannot_attribute() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    let later = (chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap()
        + chrono::Duration::seconds(1))
    .to_rfc3339();
    seed_scored_observation(
        &conn,
        "other-user",
        &later,
        "other-user",
        "other",
        "reading.tfng",
        "other-asset",
        1.0,
    );
    seed_scored_observation(
        &conn,
        "unrelated",
        &later,
        "unrelated",
        "local",
        "reading.matching_headings",
        "unrelated-asset",
        1.0,
    );
    seed_scored_observation(
        &conn,
        "unbacked",
        &later,
        "unbacked",
        "local",
        "reading.tfng",
        "unbacked-asset",
        1.0,
    );
    // Persisted observation without any supporting event is insufficient.
    conn.execute(
        "DELETE FROM learner_observation_evidence WHERE observation_id = 'unbacked'",
        [],
    )
    .unwrap();
    conn.execute("INSERT INTO learner_observations SELECT 'unbacked', user_id, observation_type, namespace,
        scope_kind, scope_key, polarity, value_num, value_text, payload_json, confidence, evidence_strength,
        ?1, projector_key, projector_version, 'unbacked-restored', created_at FROM learner_observations WHERE id = 'lobs-1'",
        params![later]).unwrap();
    for id in [
        None,
        Some("missing"),
        Some("lobs-1"),
        Some("other-user"),
        Some("unrelated"),
        Some("unbacked"),
    ] {
        let mut command = outcome_command(
            &assignment.id,
            StrategyOutcomeKind::NextNovelSkillAttempt,
            Some("made-up"),
        );
        command.observation_id = id.map(str::to_string);
        assert!(
            record_strategy_outcome(&conn, &command).is_err(),
            "invalid evidence {id:?}"
        );
    }
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM teaching_strategy_outcomes",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::EvidenceFirstV1,
        "reading",
    )
    .unwrap()
    .unwrap();
    assert_eq!(state.evidence_count(), 0);
}

#[test]
fn attribution_window_uses_related_evidence_only_and_stops_at_target() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    let base = chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap();
    for i in 1..=8 {
        let time = (base + chrono::Duration::seconds(i)).to_rfc3339();
        seed_scored_observation(
            &conn,
            &format!("unrelated-{i}"),
            &time,
            &format!("unrelated-{i}"),
            "local",
            "reading.matching_headings",
            &format!("other-{i}"),
            1.0,
        );
    }
    seed_scored_observation(
        &conn,
        "lobs-future",
        &(base + chrono::Duration::seconds(9)).to_rfc3339(),
        "future",
        "local",
        "reading.tfng",
        "asset-novel",
        1.0,
    );
    for i in 10..=17 {
        seed_scored_observation(
            &conn,
            &format!("later-{i}"),
            &(base + chrono::Duration::seconds(i)).to_rfc3339(),
            &format!("later-{i}"),
            "local",
            "reading.tfng",
            &format!("later-asset-{i}"),
            1.0,
        );
    }
    let command = outcome_command(
        &assignment.id,
        StrategyOutcomeKind::NextNovelSkillAttempt,
        None,
    );
    let result = record_strategy_outcome(&conn, &command).unwrap();
    let OutcomeAttribution::Attributed {
        record,
        novel_asset,
    } = result
    else {
        panic!("valid first relevant observation rejected");
    };
    assert!(novel_asset, "novelty does not require a caller assertion");
    assert_eq!(record.novel_asset_id.as_deref(), Some("asset-novel"));
    assert_eq!(record.score_delta, Some(1.0));
    assert_eq!(
        record_strategy_outcome(&conn, &command).unwrap(),
        OutcomeAttribution::Attributed {
            record,
            novel_asset
        }
    );
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::EvidenceFirstV1,
        "reading",
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        (state.success_count, state.failure_count),
        (1, 0),
        "retry is not additional evidence"
    );
}

#[test]
fn caller_cannot_invent_asset_or_score_improvement() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    seed_future(&conn, &assignment);
    let mut command = outcome_command(
        &assignment.id,
        StrategyOutcomeKind::NextNovelSkillAttempt,
        Some("forged-asset"),
    );
    assert!(record_strategy_outcome(&conn, &command).is_err());
    command.novel_asset_id = None;
    for delta in [0.2, f64::NAN, f64::INFINITY] {
        command.score_delta = Some(delta);
        assert!(record_strategy_outcome(&conn, &command).is_err());
    }
    command.score_delta = None;
    command.outcome_kind = StrategyOutcomeKind::NextWritingRevision;
    assert!(record_strategy_outcome(&conn, &command).is_err());
    command.outcome_kind = StrategyOutcomeKind::TransferToAnotherAsset;
    assert!(matches!(
        record_strategy_outcome(&conn, &command).unwrap(),
        OutcomeAttribution::Attributed { .. }
    ));
}

#[test]
fn prior_unscored_or_unrelated_asset_exposure_is_not_novel() {
    let (_dir, conn) = open_db();
    seed_scored_observation(
        &conn,
        "prior-other-skill",
        "2026-08-17T00:00:00Z",
        "prior-other-skill",
        "local",
        "reading.matching_headings",
        "asset-novel",
        0.0,
    );
    conn.execute(
        "UPDATE learner_observations SET value_num = NULL WHERE id = 'prior-other-skill'",
        [],
    )
    .unwrap();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
    )
    .unwrap();
    seed_future(&conn, &assignment);
    let result = record_strategy_outcome(
        &conn,
        &outcome_command(
            &assignment.id,
            StrategyOutcomeKind::TransferToAnotherAsset,
            Some("asset-novel"),
        ),
    )
    .unwrap();
    assert!(matches!(
        result,
        OutcomeAttribution::Attributed {
            novel_asset: false,
            ..
        }
    ));
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::EvidenceFirstV1,
        "reading",
    )
    .unwrap()
    .unwrap();
    assert_eq!((state.success_count, state.failure_count), (0, 0));
}

#[test]
fn writing_delta_uses_comparable_criterion_scores_in_band_units() {
    for bank in [false, true] {
        let (_dir, conn) = open_db();
        production_writing_score(&conn, "writing-baseline", "Original prompt", 6.5, bank);
        let mut assign = assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true);
        assign.skill_keys = vec!["writing.grammar".into()];
        let assignment = record_strategy_assignment(&conn, &assign).unwrap();
        production_writing_score(&conn, "writing-target", "New prompt", 7.0, bank);
        production_writing_score(&conn, "writing-repeat", "New prompt", 7.5, false);
        if bank {
            conn.execute(
                "UPDATE attempts SET asset_id = 'writing-target' WHERE id = 'writing-repeat'",
                [],
            )
            .unwrap();
        }
        let mut command = outcome_command(
            &assignment.id,
            StrategyOutcomeKind::NextWritingRevision,
            None,
        );
        command.observation_id = Some(production_observation(
            &conn,
            "writing-target",
            "writing.evaluation.criterion_score",
            Some("grammar"),
        ));
        command.score_delta = Some(0.5);
        let OutcomeAttribution::Attributed {
            record,
            novel_asset,
        } = record_strategy_outcome(&conn, &command).unwrap()
        else {
            panic!("production writing score rejected");
        };
        assert!(novel_asset);
        assert_eq!(record.score_delta, Some(0.5));
        assert_eq!(
            record.novel_asset_id.as_deref(),
            bank.then_some("writing-target")
        );
        let initial = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "writing",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            (initial.success_count, initial.failure_count),
            (1, 0),
            "bank={bank}, before repeat"
        );

        // All five score observations share an event with no direct asset/skill.
        let events =
            ielts_db::list_learning_events(&conn, None, Some("writing-target"), 20).unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].asset_id.is_none() && events[0].skill_key.is_none());
        command.novel_asset_id = Some("caller-forged-asset".into());
        assert!(record_strategy_outcome(&conn, &command).is_err());
        command.novel_asset_id = None;
        command.observation_id = Some(production_observation(
            &conn,
            "writing-target",
            "writing.evaluation.criterion_score",
            Some("lexical"),
        ));
        command.score_delta = None;
        assert!(
            record_strategy_outcome(&conn, &command).is_err(),
            "lexical is not grammar evidence"
        );

        command.observation_id = Some(production_observation(
            &conn,
            "writing-repeat",
            "writing.evaluation.criterion_score",
            Some("grammar"),
        ));
        assert!(matches!(
            record_strategy_outcome(&conn, &command).unwrap(),
            OutcomeAttribution::Attributed {
                novel_asset: false,
                ..
            }
        ));
        let before = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "writing",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            (before.success_count, before.failure_count),
            (1, 0),
            "bank={bank}, after repeat"
        );
        for kind in StrategyFeedbackKind::ALL {
            record_strategy_feedback(&conn, &feedback_command(&assignment.id, kind)).unwrap();
        }
        let after = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "writing",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            (after.success_count, after.failure_count, after.confidence),
            (
                before.success_count,
                before.failure_count,
                before.confidence
            )
        );

        // Without a persisted source, a projected/caller identity cannot rescue it.
        conn.execute(
            "DELETE FROM teaching_strategy_outcomes WHERE observation_id = ?1",
            params![command.observation_id],
        )
        .unwrap();
        conn.execute("UPDATE attempts SET asset_id = NULL, prompt_snapshot = NULL WHERE id = 'writing-target'", []).unwrap();
        command.observation_id = Some(record.observation_id.unwrap());
        assert!(record_strategy_outcome(&conn, &command).is_err());
        let rebuilt = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "writing",
        )
        .unwrap()
        .unwrap();
        assert_eq!(rebuilt.evidence_count(), 0);
    }
}

fn production_observation(
    conn: &rusqlite::Connection,
    attempt: &str,
    kind: &str,
    criterion: Option<&str>,
) -> String {
    conn.query_row(
        "SELECT o.id FROM learner_observations o
         WHERE o.observation_type = ?2 AND json_extract(o.payload_json, '$.attemptId') = ?1
           AND (?2 <> 'reading.question.outcome' OR json_extract(o.payload_json, '$.questionId') = 'q1')
           AND (?3 IS NULL OR json_extract(o.payload_json, '$.criterion') = ?3)",
        params![attempt, kind, criterion], |row| row.get(0),
    ).unwrap()
}

fn production_writing_score(
    conn: &rusqlite::Connection,
    attempt: &str,
    prompt: &str,
    grammar: f64,
    bank: bool,
) {
    use ielts_domain::{
        Activity, AttemptMode, SaveDraftCommand, SubmitAttemptCommand, WritingFeedbackV4,
        WritingScoreV4, WritingTaskType,
    };
    if bank {
        ielts_db::upsert_writing_topic(
            conn,
            &ielts_domain::UpsertWritingTopicCommand {
                id: Some(attempt.into()),
                task_type: WritingTaskType::Task2,
                category: "Education".into(),
                difficulty: 3,
                title_json: prompt.into(),
                image_path: None,
                is_official: Some(false),
            },
        )
        .unwrap();
    }
    ielts_db::save_writing_draft(
        conn,
        &SaveDraftCommand {
            attempt_id: attempt.into(),
            activity: Activity::Writing,
            mode: if bank {
                AttemptMode::Bank
            } else {
                AttemptMode::Freeform
            },
            asset_id: bank.then(|| attempt.into()),
            content_text: Some("A practical essay. ".repeat(30)),
            prompt_snapshot: Some(prompt.into()),
            task_type: Some(WritingTaskType::Task2),
            idempotency_key: format!("draft-{attempt}"),
        },
    )
    .unwrap();
    ielts_db::submit_writing_attempt(
        conn,
        &SubmitAttemptCommand {
            attempt_id: attempt.into(),
            idempotency_key: format!("submit-{attempt}"),
        },
    )
    .unwrap();
    let prepared = ielts_db::prepare_evaluation(
        conn,
        &ielts_db::StartEvaluationCommand {
            attempt_id: attempt.into(),
            idempotency_key: format!("evaluate-{attempt}"),
            task_type: Some("task2".into()),
            retry_of: None,
        },
        "offline-fixture",
        "offline-fixture",
    )
    .unwrap();
    ielts_db::finish_evaluation(
        conn,
        &prepared,
        Ok(WritingScoreV4 {
            overall: 6.5,
            task_response: 6.5,
            coherence: 6.5,
            lexical: 6.5,
            grammar,
        }),
        Some(WritingFeedbackV4 {
            overall: Some("Offline fixture".into()),
            plan: vec![],
            paragraphs: vec![],
            sentences: vec![],
            rewrites: vec![],
        }),
        None,
    )
    .unwrap();
    ielts_db::learning_observations_rebuild(conn).unwrap();
}

#[test]
fn real_reading_submit_siblings_are_novel_but_independent_repeat_is_not() {
    for (baseline, target, expected) in [("FALSE", "TRUE", (1, 0)), ("TRUE", "FALSE", (0, 1))] {
        let (dir, conn) = open_db();
        production_reading_submit(
            &conn,
            dir.path(),
            "read-baseline",
            "read-original",
            baseline,
        );
        let assignment = record_strategy_assignment(
            &conn,
            &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
        )
        .unwrap();
        production_reading_submit(&conn, dir.path(), "read-target", "read-new", target);
        production_reading_submit(&conn, dir.path(), "read-repeat", "read-new", target);
        let mut command = outcome_command(
            &assignment.id,
            StrategyOutcomeKind::NextNovelSkillAttempt,
            None,
        );
        command.observation_id = Some(production_observation(
            &conn,
            "read-target",
            "reading.question.outcome",
            None,
        ));
        command.score_delta = None;
        let events = ielts_db::list_learning_events(&conn, None, Some("read-target"), 20).unwrap();
        assert_eq!(events.len(), 3, "completion and two question siblings");
        assert!(events
            .iter()
            .all(|event| event.occurred_at == events[0].occurred_at));
        assert!(matches!(
            record_strategy_outcome(&conn, &command).unwrap(),
            OutcomeAttribution::Attributed {
                novel_asset: true,
                ..
            }
        ));
        command.observation_id = Some(production_observation(
            &conn,
            "read-repeat",
            "reading.question.outcome",
            None,
        ));
        assert!(matches!(
            record_strategy_outcome(&conn, &command).unwrap(),
            OutcomeAttribution::Attributed {
                novel_asset: false,
                ..
            }
        ));
        let state = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "reading",
        )
        .unwrap()
        .unwrap();
        assert_eq!((state.success_count, state.failure_count), expected);
    }
}

fn production_reading_submit(
    conn: &rusqlite::Connection,
    dir: &std::path::Path,
    attempt: &str,
    asset: &str,
    answer: &str,
) {
    let path = dir.join(format!("{asset}.json"));
    std::fs::write(&path, serde_json::to_vec(&serde_json::json!({
        "examId": asset, "meta": {"title": "Production reading fixture", "category": "P1"},
        "questionCount": 2, "questionOrder": ["q1", "q2"],
        "answerKey": {"q1": "TRUE", "q2": "B"},
        "questionGroups": [{"kind": "tfng", "questionIds": ["q1"]}, {"kind": "mcq", "questionIds": ["q2"]}]
    })).unwrap()).unwrap();
    let imported = ielts_db::import_asset_payload_file(conn, &path).unwrap();
    ielts_db::submit_reading_attempt(
        conn,
        &ielts_db::ReadingSubmitCommand {
            attempt_id: attempt.into(),
            asset_id: asset.into(),
            asset_revision: Some(imported.schema_version),
            asset_fingerprint: Some(imported.fingerprint),
            answers: serde_json::json!({"q1": answer, "q2": "B"}),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1000),
            title_snapshot: None,
            idempotency_key: format!("submit-{attempt}"),
        },
    )
    .unwrap();
    ielts_db::learning_observations_rebuild(conn).unwrap();
    ielts_db::learner_model_rebuild(conn).unwrap();
}

#[test]
fn measured_score_delta_controls_success_failure_and_unknown() {
    for (baseline, score, expected) in [
        (Some(0.0), 1.0, (1, 0)),
        (Some(1.0), 0.0, (0, 1)),
        (Some(1.0), 1.0, (0, 0)),
        (None, 1.0, (0, 0)),
    ] {
        let (_dir, conn) = open_db();
        conn.execute(
            "UPDATE learner_observations SET value_num = ?1 WHERE id = 'lobs-1'",
            params![baseline],
        )
        .unwrap();
        let assignment = record_strategy_assignment(
            &conn,
            &assignment_command(TeachingStrategyId::EvidenceFirstV1, "cmsg-1", true),
        )
        .unwrap();
        let later = (chrono::DateTime::parse_from_rfc3339(&assignment.created_at).unwrap()
            + chrono::Duration::seconds(1))
        .to_rfc3339();
        seed_scored_observation(
            &conn,
            "lobs-future",
            &later,
            "future",
            "local",
            "reading.tfng",
            "asset-novel",
            score,
        );
        let mut command = outcome_command(
            &assignment.id,
            StrategyOutcomeKind::NextNovelSkillAttempt,
            None,
        );
        command.score_delta = None;
        let OutcomeAttribution::Attributed { record, .. } =
            record_strategy_outcome(&conn, &command).unwrap()
        else {
            panic!("valid score rejected");
        };
        assert_eq!(record.score_delta, baseline.map(|value| score - value));
        let before = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "reading",
        )
        .unwrap()
        .unwrap();
        assert_eq!((before.success_count, before.failure_count), expected);
        for kind in StrategyFeedbackKind::ALL {
            record_strategy_feedback(&conn, &feedback_command(&assignment.id, kind)).unwrap();
        }
        let after = load_user_strategy_state(
            &conn,
            "local",
            TeachingStrategyId::EvidenceFirstV1,
            "reading",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            (after.success_count, after.failure_count, after.confidence),
            (
                before.success_count,
                before.failure_count,
                before.confidence
            )
        );
        assert_eq!((after.satisfaction_count, after.reask_count), (4, 1));
    }
}

#[test]
fn legacy_polluted_cache_and_unproven_outcomes_are_rebuilt_on_read_and_selection() {
    let (_dir, conn) = open_db();
    let assignment = record_strategy_assignment(
        &conn,
        &assignment_command(TeachingStrategyId::ExampleFirstV1, "cmsg-1", true),
    )
    .unwrap();
    record_strategy_feedback(
        &conn,
        &feedback_command(&assignment.id, StrategyFeedbackKind::ThumbsUp),
    )
    .unwrap();
    conn.execute(
        "UPDATE user_strategy_state SET success_count = 99, failure_count = 1,
        novel_transfer_success = 99, confidence = 0.99",
        [],
    )
    .unwrap();
    conn.execute("INSERT INTO teaching_strategy_outcomes (id, outcome_kind, assignment_id, observation_id,
        novel_asset_id, score_delta, created_at) VALUES ('legacy-none', 'next_novel_skill_attempt', ?1, NULL,
        'caller-fake', 9.0, ?2), ('legacy-old', 'next_novel_skill_attempt', ?1, 'lobs-1', 'caller-fake', 9.0, ?2)",
        params![assignment.id, assignment.created_at]).unwrap();
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::ExampleFirstV1,
        "reading",
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        (
            state.success_count,
            state.failure_count,
            state.novel_transfer_success,
            state.satisfaction_count
        ),
        (0, 0, 0, 1)
    );
    assert_eq!(state.confidence, 0.0);
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
    assert_eq!(selection.reason, StrategySelectionReason::Default);
    seed_future(&conn, &assignment);
    // Even old outcome rows are read using measured evidence, not their forged stored delta.
    conn.execute("INSERT INTO teaching_strategy_outcomes (id, outcome_kind, assignment_id, observation_id,
        novel_asset_id, score_delta, created_at) VALUES ('legacy-valid', 'next_novel_skill_attempt', ?1,
        'lobs-future', 'caller-fake', -9.0, ?2)", params![assignment.id, assignment.created_at]).unwrap();
    let state = load_user_strategy_state(
        &conn,
        "local",
        TeachingStrategyId::ExampleFirstV1,
        "reading",
    )
    .unwrap()
    .unwrap();
    assert_eq!((state.success_count, state.failure_count), (1, 0));
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
    assert_eq!(
        evaluation.metrics["evaluatorVersion"],
        "m10-strategy-structure-v1"
    );
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
    assert!(!catalog
        .iter()
        .any(|e| e.prompt_module.contains("proposition_decomposition")));
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
        &RecordStrategyCandidateEvaluationCommand { batch_id: batch.id },
    )
    .unwrap();
    assert!(!evaluation.passed);
    assert_eq!(evaluation.metrics["allPassed"], false);
    assert!(!evaluation.metrics["validationErrors"]
        .as_array()
        .unwrap()
        .is_empty());

    let parsed = serde_json::from_value::<RecordStrategyCandidateEvaluationCommand>(
        serde_json::json!({"batchId": "tscb-test", "passed": true, "metrics": {}}),
    );
    assert!(
        parsed.is_err(),
        "IPC must not accept caller-supplied verdict fields"
    );
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
