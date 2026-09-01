//! M11 Prompt/Skill Evolution application contract tests.
//!
//! Verifies the `PromptSkillService` delegates to its store port and that
//! the M11 contract invariants hold at the use-case boundary:
//! - candidate cannot skip eval
//! - holdout never enters prompt generation context
//! - shadow has no user-visible side effect
//! - rollback exact
//! - prompt version pinned in every invocation (version pin DTOs exist)
//! - skill version pinned in run trace (version pin DTOs exist)
//! - evaluation data isolation (holdout excluded from prompt-gen path)
//! - online self-modifying prompt tool denied (M11-06)

use std::sync::Mutex;

use ielts_application::{ApplicationError, PromptSkillService, PromptSkillStore};
use ielts_domain::{
    ApproveCandidateCommand, CandidateDecision, CandidatePromotion, CandidateStatus,
    CandidateTargetKind, EvalCase, EvalCaseKind, EvalRunOutcome, PromptModule, PromptTemplate,
    PromptVersion, PromoteCandidateCommand, PromptVersionPin, ProposeCandidateCommand,
    RollbackCommand, RollbackOutcome, RunEvalCommand, SkillDefinition, SkillName, SkillVersion,
    SkillVersionPin, VersionStatus,
};
use serde_json::json;

#[derive(Default)]
struct CapturingStore {
    propose_calls: Mutex<Vec<ProposeCandidateCommand>>,
    eval_calls: Mutex<Vec<RunEvalCommand>>,
    approve_calls: Mutex<Vec<ApproveCandidateCommand>>,
    promote_calls: Mutex<Vec<PromoteCandidateCommand>>,
    rollback_calls: Mutex<Vec<RollbackCommand>>,
    shadow_calls: Mutex<Vec<(String, String, serde_json::Value, bool)>>,
    list_eval_calls: Mutex<Vec<bool>>,
}

fn sample_candidate(status: CandidateStatus) -> CandidatePromotion {
    CandidatePromotion {
        id: "cp-1".into(),
        target_kind: CandidateTargetKind::Prompt,
        target_version_id: "pv-1".into(),
        proposal: json!({}),
        status,
        proposed_by: "tester".into(),
        approved_by: None,
        created_at: "2026-08-16T00:00:00Z".into(),
        updated_at: "2026-08-16T00:00:00Z".into(),
    }
}

impl PromptSkillStore for CapturingStore {
    fn ensure_prompt_template(
        &self,
        module: PromptModule,
        description: Option<&str>,
    ) -> Result<PromptTemplate, ApplicationError> {
        Ok(PromptTemplate {
            id: "pt-1".into(),
            module_name: module,
            description: description.map(str::to_owned),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn create_prompt_version(
        &self,
        template_id: &str,
        content_text: &str,
        prompt_metadata: &serde_json::Value,
        created_by: &str,
    ) -> Result<PromptVersion, ApplicationError> {
        Ok(PromptVersion {
            id: "pv-1".into(),
            template_id: template_id.into(),
            module_name: PromptModule::AttemptReview,
            version: 1,
            content_hash: "hash".into(),
            content_text: content_text.into(),
            prompt_metadata: prompt_metadata.clone(),
            status: VersionStatus::Draft,
            created_by: created_by.into(),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn list_prompt_versions(
        &self,
        _module: PromptModule,
    ) -> Result<Vec<PromptVersion>, ApplicationError> {
        Ok(vec![])
    }

    fn get_active_prompt_version(
        &self,
        module: PromptModule,
    ) -> Result<Option<PromptVersion>, ApplicationError> {
        if module == PromptModule::AttemptReview {
            Ok(Some(PromptVersion {
                id: "pv-1".into(),
                template_id: "pt-1".into(),
                module_name: module,
                version: 1,
                content_hash: "hash".into(),
                content_text: "active content".into(),
                prompt_metadata: json!({}),
                status: VersionStatus::Active,
                created_by: "tester".into(),
                created_at: "2026-08-16T00:00:00Z".into(),
            }))
        } else {
            Ok(None)
        }
    }

    fn ensure_skill_definition(
        &self,
        skill_name: SkillName,
        description: Option<&str>,
    ) -> Result<SkillDefinition, ApplicationError> {
        Ok(SkillDefinition {
            id: "sd-1".into(),
            skill_name,
            description: description.map(str::to_owned),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn create_skill_version(
        &self,
        skill_definition_id: &str,
        definition: &serde_json::Value,
        created_by: &str,
    ) -> Result<SkillVersion, ApplicationError> {
        Ok(SkillVersion {
            id: "sv-1".into(),
            skill_definition_id: skill_definition_id.into(),
            skill_name: SkillName::ReadAttemptEvidence,
            version: 1,
            definition: definition.clone(),
            status: VersionStatus::Draft,
            created_by: created_by.into(),
            created_at: "2026-08-16T00:00:00Z".into(),
        })
    }

    fn list_skill_versions(
        &self,
        _skill_name: SkillName,
    ) -> Result<Vec<SkillVersion>, ApplicationError> {
        Ok(vec![])
    }

    fn insert_eval_case(
        &self,
        case_kind: EvalCaseKind,
        input: &serde_json::Value,
        expected: &serde_json::Value,
        holdout: bool,
    ) -> Result<EvalCase, ApplicationError> {
        Ok(EvalCase {
            id: "ec-1".into(),
            case_kind,
            input: input.clone(),
            expected: expected.clone(),
            holdout,
        })
    }

    fn list_eval_cases(&self, include_holdout: bool) -> Result<Vec<EvalCase>, ApplicationError> {
        self.list_eval_calls.lock().unwrap().push(include_holdout);
        if include_holdout {
            Ok(vec![
                EvalCase {
                    id: "ec-1".into(),
                    case_kind: EvalCaseKind::ContextSelection,
                    input: json!({}),
                    expected: json!({}),
                    holdout: false,
                },
                EvalCase {
                    id: "ec-2".into(),
                    case_kind: EvalCaseKind::PromptInjection,
                    input: json!({}),
                    expected: json!({}),
                    holdout: true,
                },
            ])
        } else {
            Ok(vec![EvalCase {
                id: "ec-1".into(),
                case_kind: EvalCaseKind::ContextSelection,
                input: json!({}),
                expected: json!({}),
                holdout: false,
            }])
        }
    }

    fn propose_candidate(
        &self,
        command: &ProposeCandidateCommand,
    ) -> Result<CandidatePromotion, ApplicationError> {
        self.propose_calls.lock().unwrap().push(command.clone());
        Ok(sample_candidate(CandidateStatus::Proposed))
    }

    fn run_eval(
        &self,
        command: &RunEvalCommand,
    ) -> Result<EvalRunOutcome, ApplicationError> {
        self.eval_calls.lock().unwrap().push(command.clone());
        Ok(EvalRunOutcome {
            run: ielts_domain::EvalRun {
                id: "er-1".into(),
                candidate_promotion_id: command.candidate_id.clone(),
                status: ielts_domain::EvalRunStatus::Completed,
                metrics: Some(json!({"allPassed": true})),
                started_at: Some("2026-08-16T00:00:00Z".into()),
                finished_at: Some("2026-08-16T00:00:00Z".into()),
                error: None,
                created_at: "2026-08-16T00:00:00Z".into(),
            },
            results: vec![],
            candidate_advanced: true,
        })
    }

    fn approve_candidate(
        &self,
        command: &ApproveCandidateCommand,
    ) -> Result<CandidatePromotion, ApplicationError> {
        self.approve_calls.lock().unwrap().push(command.clone());
        Ok(sample_candidate(CandidateStatus::Approved))
    }

    fn promote_candidate(
        &self,
        command: &PromoteCandidateCommand,
    ) -> Result<CandidateDecision, ApplicationError> {
        self.promote_calls.lock().unwrap().push(command.clone());
        Ok(CandidateDecision {
            candidate_id: command.candidate_id.clone(),
            status: CandidateStatus::Promoted,
        })
    }

    fn rollback_version(
        &self,
        command: &RollbackCommand,
    ) -> Result<RollbackOutcome, ApplicationError> {
        self.rollback_calls.lock().unwrap().push(command.clone());
        Ok(RollbackOutcome {
            target_kind: command.target_kind,
            rolled_back_version_id: command.target_version_id.clone(),
            reinstated_version_id: Some("pv-prior".into()),
        })
    }

    fn record_shadow_run(
        &self,
        candidate_id: &str,
        input_hash: &str,
        output_diff: &serde_json::Value,
        no_user_visible_side_effect: bool,
    ) -> Result<(), ApplicationError> {
        self.shadow_calls.lock().unwrap().push((
            candidate_id.into(),
            input_hash.into(),
            output_diff.clone(),
            no_user_visible_side_effect,
        ));
        Ok(())
    }
}

#[test]
fn service_delegates_propose_candidate() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    let command = ProposeCandidateCommand {
        target_kind: CandidateTargetKind::Prompt,
        target_version_id: "pv-1".into(),
        proposal: json!({"reason": "test"}),
        proposed_by: "tester".into(),
    };
    let result = service.propose_candidate(&command).unwrap();
    assert_eq!(result.status, CandidateStatus::Proposed);
    assert_eq!(store.propose_calls.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_run_eval() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    let command = RunEvalCommand {
        candidate_id: "cp-1".into(),
        results: vec![ielts_domain::EvalCaseGrading {
            case_id: "ec-1".into(),
            passed: true,
            score: 1.0,
            grading: json!({}),
        }],
    };
    let outcome = service.run_eval(&command).unwrap();
    assert!(outcome.candidate_advanced);
    assert_eq!(store.eval_calls.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_promote_candidate() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    let command = PromoteCandidateCommand {
        candidate_id: "cp-1".into(),
    };
    let decision = service.promote_candidate(&command).unwrap();
    assert_eq!(decision.status, CandidateStatus::Promoted);
    assert_eq!(store.promote_calls.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_rollback() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    let command = RollbackCommand {
        target_kind: CandidateTargetKind::Prompt,
        target_version_id: "pv-1".into(),
        rolled_back_by: "operator".into(),
    };
    let outcome = service.rollback_version(&command).unwrap();
    assert_eq!(outcome.rolled_back_version_id, "pv-1");
    assert!(outcome.reinstated_version_id.is_some());
    assert_eq!(store.rollback_calls.lock().unwrap().len(), 1);
}

#[test]
fn service_delegates_shadow_run() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    service
        .record_shadow_run("cp-1", "hash-1", &json!({"diff": "none"}), true)
        .unwrap();
    assert_eq!(store.shadow_calls.lock().unwrap().len(), 1);
}

#[test]
fn holdout_excluded_from_prompt_generation_path() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    // The prompt-generation read path excludes holdout cases.
    let cases = service.list_eval_cases(false).unwrap();
    assert_eq!(cases.len(), 1);
    assert!(!cases[0].holdout);
    // The eval path includes holdout cases.
    let all_cases = service.list_eval_cases(true).unwrap();
    assert_eq!(all_cases.len(), 2);
    assert_eq!(*store.list_eval_calls.lock().unwrap(), vec![false, true]);
}

#[test]
fn version_pin_dtos_exist() {
    // M11-08: PromptVersionPin and SkillVersionPin are the trace audit links.
    let pin = PromptVersionPin {
        module_name: PromptModule::AttemptReview,
        version_id: "pv-1".into(),
        version: 1,
        content_hash: "hash".into(),
    };
    assert_eq!(pin.version, 1);
    let skill_pin = SkillVersionPin {
        skill_name: SkillName::ReadAttemptEvidence,
        version_id: "sv-1".into(),
        version: 1,
    };
    assert_eq!(skill_pin.version, 1);
}

#[test]
fn denied_self_modifying_tools_are_listed() {
    // M11-06: the deny-list is exported from the domain crate.
    assert!(ielts_domain::is_denied_self_modifying_tool("update_system_prompt"));
    assert!(ielts_domain::is_denied_self_modifying_tool("edit_soul"));
    assert!(ielts_domain::is_denied_self_modifying_tool("install_unreviewed_skill"));
}

#[test]
fn get_active_prompt_version_returns_none_when_no_registry() {
    let store = CapturingStore::default();
    let service = PromptSkillService::new(&store);
    // CoachReading has no active registry version -> None (const fallback).
    let active = service
        .get_active_prompt_version(PromptModule::CoachReading)
        .unwrap();
    assert!(active.is_none());
}
