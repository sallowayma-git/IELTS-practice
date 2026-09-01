//! M11 Prompt/Skill Evolution integration tests at the SQLite boundary.
//!
//! Covers the M11 contract at the persistence layer:
//! - candidate cannot skip eval (M11-05: promote without eval fails)
//! - candidate cannot skip approval (M11-05: promote without approval fails)
//! - holdout never enters prompt generation context (M11-05)
//! - shadow has no user-visible side effect (M11-05)
//! - rollback exact (M11-05: prior version reinstated)
//! - only one active version per template (M11-05)
//! - online self-modifying prompt tool denied (M11-06)

use ielts_db::{
    approve_candidate, create_prompt_version, ensure_prompt_template, get_active_prompt_version,
    insert_eval_case, list_eval_cases, list_prompt_versions, migrate, open_connection,
    propose_candidate, promote_candidate, record_shadow_run, rollback_version, run_eval,
    DbOpenOptions,
};
use ielts_domain::{
    CandidateStatus, CandidateTargetKind, EvalCaseGrading, EvalCaseKind, PromptModule,
    ProposeCandidateCommand, PromoteCandidateCommand, RollbackCommand, RunEvalCommand,
};
use rusqlite::params;
use serde_json::json;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn seed_prompt_version(conn: &rusqlite::Connection, content: &str, created_by: &str) -> String {
    let template = ensure_prompt_template(conn, PromptModule::AttemptReview, None).unwrap();
    let version =
        create_prompt_version(conn, &template.id, content, &json!({}), created_by).unwrap();
    version.id
}

fn seed_eval_case(conn: &rusqlite::Connection, kind: EvalCaseKind, holdout: bool) -> String {
    insert_eval_case(
        conn,
        kind,
        &json!({"input": "test"}),
        &json!({"expected": "ok"}),
        holdout,
    )
    .unwrap()
    .id
}

fn full_pipeline(conn: &rusqlite::Connection, version_id: &str, case_id: &str, approver: &str) {
    let candidate = propose_candidate(
        conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: version_id.to_string(),
            proposal: json!({}),
            proposed_by: "tester".into(),
        },
    )
    .unwrap();
    run_eval(
        conn,
        &RunEvalCommand {
            candidate_id: candidate.id.clone(),
            results: vec![EvalCaseGrading {
                case_id: case_id.to_string(),
                passed: true,
                score: 1.0,
                grading: json!({}),
            }],
        },
    )
    .unwrap();
    approve_candidate(
        conn,
        &ielts_domain::ApproveCandidateCommand {
            candidate_id: candidate.id.clone(),
            approved_by: approver.into(),
        },
    )
    .unwrap();
    promote_candidate(
        conn,
        &PromoteCandidateCommand {
            candidate_id: candidate.id.clone(),
        },
    )
    .unwrap();
}

#[test]
fn candidate_cannot_skip_eval() {
    let (_dir, conn) = open_db();
    let version_id = seed_prompt_version(&conn, "v1 content", "tester");
    let candidate = propose_candidate(
        &conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: version_id,
            proposal: json!({"reason": "improve clarity"}),
            proposed_by: "tester".into(),
        },
    )
    .unwrap();
    let err = promote_candidate(
        &conn,
        &PromoteCandidateCommand {
            candidate_id: candidate.id.clone(),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("approved"));
}

#[test]
fn candidate_cannot_skip_approval() {
    let (_dir, conn) = open_db();
    let version_id = seed_prompt_version(&conn, "v1 content", "tester");
    let candidate = propose_candidate(
        &conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: version_id.clone(),
            proposal: json!({"reason": "improve clarity"}),
            proposed_by: "tester".into(),
        },
    )
    .unwrap();
    let case_id = seed_eval_case(&conn, EvalCaseKind::ContextSelection, false);
    let outcome = run_eval(
        &conn,
        &RunEvalCommand {
            candidate_id: candidate.id.clone(),
            results: vec![EvalCaseGrading {
                case_id,
                passed: true,
                score: 1.0,
                grading: json!({}),
            }],
        },
    )
    .unwrap();
    assert!(outcome.candidate_advanced);
    let err = promote_candidate(
        &conn,
        &PromoteCandidateCommand {
            candidate_id: candidate.id.clone(),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("approved"));
}

#[test]
fn promote_advances_version_to_active() {
    let (_dir, conn) = open_db();
    let version_id = seed_prompt_version(&conn, "v1 content", "tester");
    let candidate = propose_candidate(
        &conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: version_id.clone(),
            proposal: json!({}),
            proposed_by: "tester".into(),
        },
    )
    .unwrap();
    let case_id = seed_eval_case(&conn, EvalCaseKind::ContextSelection, false);
    run_eval(
        &conn,
        &RunEvalCommand {
            candidate_id: candidate.id.clone(),
            results: vec![EvalCaseGrading {
                case_id,
                passed: true,
                score: 1.0,
                grading: json!({}),
            }],
        },
    )
    .unwrap();
    let approved = approve_candidate(
        &conn,
        &ielts_domain::ApproveCandidateCommand {
            candidate_id: candidate.id.clone(),
            approved_by: "release-manager".into(),
        },
    )
    .unwrap();
    assert_eq!(approved.status, CandidateStatus::Approved);
    let decision = promote_candidate(
        &conn,
        &PromoteCandidateCommand {
            candidate_id: candidate.id.clone(),
        },
    )
    .unwrap();
    assert_eq!(decision.status, CandidateStatus::Promoted);
    let active = get_active_prompt_version(&conn, PromptModule::AttemptReview).unwrap().unwrap();
    assert_eq!(active.id, version_id);
}

#[test]
fn only_one_active_version_per_template() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1", &json!({}), "tester").unwrap();
    let v2 = create_prompt_version(&conn, &template.id, "v2", &json!({}), "tester").unwrap();
    let case = seed_eval_case(&conn, EvalCaseKind::ContextSelection, false);
    full_pipeline(&conn, &v1.id, &case, "rm");
    full_pipeline(&conn, &v2.id, &case, "rm");
    let active = get_active_prompt_version(&conn, PromptModule::AttemptReview).unwrap().unwrap();
    assert_eq!(active.id, v2.id);
    let v1_status: String = conn
        .query_row(
            "SELECT status FROM prompt_versions WHERE id = ?1",
            params![v1.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(v1_status, "rollback");
}

#[test]
fn rollback_is_exact() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1", &json!({}), "tester").unwrap();
    let v2 = create_prompt_version(&conn, &template.id, "v2", &json!({}), "tester").unwrap();
    let case = seed_eval_case(&conn, EvalCaseKind::ContextSelection, false);
    full_pipeline(&conn, &v1.id, &case, "rm");
    full_pipeline(&conn, &v2.id, &case, "rm");
    assert_eq!(
        get_active_prompt_version(&conn, PromptModule::AttemptReview)
            .unwrap()
            .unwrap()
            .id,
        v2.id
    );
    let outcome = rollback_version(
        &conn,
        &RollbackCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: v2.id.clone(),
            rolled_back_by: "operator".into(),
        },
    )
    .unwrap();
    assert_eq!(outcome.rolled_back_version_id, v2.id);
    assert_eq!(outcome.reinstated_version_id, Some(v1.id.clone()));
    assert_eq!(
        get_active_prompt_version(&conn, PromptModule::AttemptReview)
            .unwrap()
            .unwrap()
            .id,
        v1.id
    );
    let v2_status: String = conn
        .query_row(
            "SELECT status FROM prompt_versions WHERE id = ?1",
            params![v2.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(v2_status, "rollback");
}

#[test]
fn holdout_never_enters_prompt_generation_context() {
    let (_dir, conn) = open_db();
    insert_eval_case(
        &conn,
        EvalCaseKind::PromptInjection,
        &json!({"input": "holdout"}),
        &json!({"expected": "reject"}),
        true,
    )
    .unwrap();
    insert_eval_case(
        &conn,
        EvalCaseKind::ContextSelection,
        &json!({"input": "normal"}),
        &json!({"expected": "ok"}),
        false,
    )
    .unwrap();
    let cases = list_eval_cases(&conn, false).unwrap();
    assert_eq!(cases.len(), 1);
    assert!(!cases[0].holdout);
    let all_cases = list_eval_cases(&conn, true).unwrap();
    assert_eq!(all_cases.len(), 2);
}

#[test]
fn shadow_run_rejects_user_visible_side_effect() {
    let (_dir, conn) = open_db();
    let version_id = seed_prompt_version(&conn, "v1", "tester");
    let candidate = propose_candidate(
        &conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: version_id,
            proposal: json!({}),
            proposed_by: "tester".into(),
        },
    )
    .unwrap();
    let err = record_shadow_run(
        &conn,
        &candidate.id,
        "input-hash-1",
        &json!({"diff": "none"}),
        false,
    )
    .unwrap_err();
    assert!(err.to_string().contains("side effect"));
    record_shadow_run(
        &conn,
        &candidate.id,
        "input-hash-1",
        &json!({"diff": "none"}),
        true,
    )
    .unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shadow_runs WHERE candidate_promotion_id = ?1",
            params![candidate.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn eval_failure_leaves_candidate_at_proposed() {
    let (_dir, conn) = open_db();
    let version_id = seed_prompt_version(&conn, "v1", "tester");
    let candidate = propose_candidate(
        &conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: version_id,
            proposal: json!({}),
            proposed_by: "tester".into(),
        },
    )
    .unwrap();
    let case_id = seed_eval_case(&conn, EvalCaseKind::ContextSelection, false);
    let outcome = run_eval(
        &conn,
        &RunEvalCommand {
            candidate_id: candidate.id.clone(),
            results: vec![EvalCaseGrading {
                case_id,
                passed: false,
                score: 0.0,
                grading: json!({"reason": "wrong"}),
            }],
        },
    )
    .unwrap();
    assert!(!outcome.candidate_advanced);
    let status_str: String = conn
        .query_row(
            "SELECT status FROM candidate_promotions WHERE id = ?1",
            params![candidate.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(status_str, "proposed");
}

#[test]
fn list_prompt_versions_orders_by_version_desc() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1", &json!({}), "tester").unwrap();
    let v2 = create_prompt_version(&conn, &template.id, "v2", &json!({}), "tester").unwrap();
    let v3 = create_prompt_version(&conn, &template.id, "v3", &json!({}), "tester").unwrap();
    let versions = list_prompt_versions(&conn, PromptModule::AttemptReview).unwrap();
    assert_eq!(versions.len(), 3);
    assert_eq!(versions[0].id, v3.id);
    assert_eq!(versions[1].id, v2.id);
    assert_eq!(versions[2].id, v1.id);
}

#[test]
fn denied_self_modifying_tools_are_listed() {
    assert!(ielts_domain::is_denied_self_modifying_tool("update_system_prompt"));
    assert!(ielts_domain::is_denied_self_modifying_tool("edit_soul"));
    assert!(ielts_domain::is_denied_self_modifying_tool("install_unreviewed_skill"));
    assert!(!ielts_domain::is_denied_self_modifying_tool("memory.candidate_input"));
}

// ---------------------------------------------------------------------------
// Round-3 audit (A2): rollback activates a version, so it is exactly as
// powerful as promote. It used to pick its reinstatement target with
// `ORDER BY version DESC` and no status filter, and to require no actor.
// ---------------------------------------------------------------------------

fn status_of_version(conn: &rusqlite::Connection, version_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM prompt_versions WHERE id = ?1",
        params![version_id],
        |row| row.get(0),
    )
    .unwrap()
}

/// The escalation: `create_prompt_version` assigns `MAX(version) + 1` with
/// status `draft`, so an unevaluated draft is normally the HIGHEST version.
/// Rollback must never reinstate it — that would make the live prompt a version
/// which never ran an eval and was never approved, bypassing the whole gate
/// `promote_candidate` enforces.
#[test]
fn rollback_never_activates_a_never_active_draft() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1 body", &json!({}), "seed").unwrap();
    let v2 = create_prompt_version(&conn, &template.id, "v2 body", &json!({}), "seed").unwrap();
    // v1 was active and got superseded by v2, which is the live version.
    conn.execute(
        "UPDATE prompt_versions SET status='rollback' WHERE id=?1",
        params![v1.id],
    )
    .unwrap();
    conn.execute(
        "UPDATE prompt_versions SET status='active' WHERE id=?1",
        params![v2.id],
    )
    .unwrap();
    // A fresh, unevaluated draft now carries the highest version number.
    let draft = create_prompt_version(&conn, &template.id, "evil body", &json!({}), "sidecar")
        .unwrap();
    assert_eq!(status_of_version(&conn, &draft.id), "draft");
    assert!(draft.version > v2.version);

    let outcome = rollback_version(
        &conn,
        &RollbackCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: v2.id.clone(),
            rolled_back_by: "operator".into(),
        },
    )
    .unwrap();

    assert_eq!(
        outcome.reinstated_version_id,
        Some(v1.id.clone()),
        "rollback must reinstate the previously-active version, not the newest row"
    );
    assert_eq!(
        status_of_version(&conn, &draft.id),
        "draft",
        "an unevaluated draft must never be activated by a rollback"
    );
    assert_eq!(
        get_active_prompt_version(&conn, PromptModule::AttemptReview)
            .unwrap()
            .unwrap()
            .id,
        v1.id
    );
}

/// With no previously-active version to return to, rollback deactivates and
/// reinstates nothing rather than promoting an arbitrary row.
#[test]
fn rollback_with_no_prior_active_version_reinstates_nothing() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1 body", &json!({}), "seed").unwrap();
    conn.execute(
        "UPDATE prompt_versions SET status='active' WHERE id=?1",
        params![v1.id],
    )
    .unwrap();
    let draft = create_prompt_version(&conn, &template.id, "draft body", &json!({}), "seed")
        .unwrap();

    let outcome = rollback_version(
        &conn,
        &RollbackCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: v1.id.clone(),
            rolled_back_by: "operator".into(),
        },
    )
    .unwrap();

    assert_eq!(outcome.reinstated_version_id, None);
    assert_eq!(status_of_version(&conn, &draft.id), "draft");
    assert!(
        get_active_prompt_version(&conn, PromptModule::AttemptReview)
            .unwrap()
            .is_none(),
        "falling back to the const default is correct; activating a draft is not"
    );
}

/// Rollback changes which version is live, so it must be attributable — the
/// same standard `approve_candidate` holds for `approved_by`.
#[test]
fn rollback_requires_an_actor() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1 body", &json!({}), "seed").unwrap();
    conn.execute(
        "UPDATE prompt_versions SET status='active' WHERE id=?1",
        params![v1.id],
    )
    .unwrap();

    for actor in ["", "   "] {
        let outcome = rollback_version(
            &conn,
            &RollbackCommand {
                target_kind: CandidateTargetKind::Prompt,
                target_version_id: v1.id.clone(),
                rolled_back_by: actor.into(),
            },
        );
        assert!(outcome.is_err(), "a blank actor must be rejected: {actor:?}");
    }
    assert_eq!(
        status_of_version(&conn, &v1.id),
        "active",
        "a rejected rollback must not have mutated anything"
    );
}

/// The end-to-end property: a rollback can only ever land on a version that
/// already passed the promote gate. Promote is what writes `rollback` status.
#[test]
fn promote_then_rollback_round_trips_through_the_gate() {
    let (_dir, conn) = open_db();
    let template = ensure_prompt_template(&conn, PromptModule::AttemptReview, None).unwrap();
    let v1 = create_prompt_version(&conn, &template.id, "v1 body", &json!({}), "seed").unwrap();
    conn.execute(
        "UPDATE prompt_versions SET status='active' WHERE id=?1",
        params![v1.id],
    )
    .unwrap();
    let v2 = create_prompt_version(&conn, &template.id, "v2 body", &json!({}), "seed").unwrap();

    // Full gate: propose -> eval -> approve -> promote.
    let candidate = propose_candidate(
        &conn,
        &ProposeCandidateCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: v2.id.clone(),
            proposal: json!({"body": "v2 body"}),
            proposed_by: "operator".into(),
        },
    )
    .unwrap();
    let case_id = seed_eval_case(&conn, EvalCaseKind::ContextSelection, false);
    run_eval(
        &conn,
        &RunEvalCommand {
            candidate_id: candidate.id.clone(),
            results: vec![EvalCaseGrading {
                case_id,
                passed: true,
                score: 1.0,
                grading: json!({}),
            }],
        },
    )
    .unwrap();
    approve_candidate(
        &conn,
        &ielts_domain::ApproveCandidateCommand {
            candidate_id: candidate.id.clone(),
            approved_by: "operator".into(),
        },
    )
    .unwrap();
    promote_candidate(
        &conn,
        &PromoteCandidateCommand {
            candidate_id: candidate.id.clone(),
        },
    )
    .unwrap();
    assert_eq!(status_of_version(&conn, &v1.id), "rollback");
    assert_eq!(status_of_version(&conn, &v2.id), "active");

    // Now rollback returns to v1, which promote itself blessed.
    let outcome = rollback_version(
        &conn,
        &RollbackCommand {
            target_kind: CandidateTargetKind::Prompt,
            target_version_id: v2.id.clone(),
            rolled_back_by: "operator".into(),
        },
    )
    .unwrap();
    assert_eq!(outcome.reinstated_version_id, Some(v1.id.clone()));
    assert_eq!(status_of_version(&conn, &v1.id), "active");
    assert_eq!(status_of_version(&conn, &v2.id), "rollback");
}
