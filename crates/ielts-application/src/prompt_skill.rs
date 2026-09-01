//! M11 Prompt/Skill Evolution application service.
//!
//! Thin persistence-backed service over the db authority. Owns the release-
//! gate boundary: the LLM may only propose candidates; promotion is gated on
//! a passing eval run and manual approval. Rust is the release gate; the
//! online Agent never edits its own Soul (M11-01). The versioned registry is
//! an overlay over the existing hardcoded prompt constants.

use ielts_domain::{
    ApproveCandidateCommand, CandidateDecision, CandidatePromotion, EvalCase, EvalRunOutcome,
    PromptModule, PromptTemplate, PromptVersion, PromoteCandidateCommand,
    ProposeCandidateCommand, RollbackCommand, RollbackOutcome, RunEvalCommand, SkillName,
    SkillVersion,
};

use crate::ApplicationError;

/// Persistence port for the M11 prompt/skill evolution layer.
pub trait PromptSkillStore {
    fn ensure_prompt_template(
        &self,
        module: PromptModule,
        description: Option<&str>,
    ) -> Result<PromptTemplate, ApplicationError>;
    fn create_prompt_version(
        &self,
        template_id: &str,
        content_text: &str,
        prompt_metadata: &serde_json::Value,
        created_by: &str,
    ) -> Result<PromptVersion, ApplicationError>;
    fn list_prompt_versions(
        &self,
        module: PromptModule,
    ) -> Result<Vec<PromptVersion>, ApplicationError>;
    fn get_active_prompt_version(
        &self,
        module: PromptModule,
    ) -> Result<Option<PromptVersion>, ApplicationError>;
    fn ensure_skill_definition(
        &self,
        skill_name: SkillName,
        description: Option<&str>,
    ) -> Result<ielts_domain::SkillDefinition, ApplicationError>;
    fn create_skill_version(
        &self,
        skill_definition_id: &str,
        definition: &serde_json::Value,
        created_by: &str,
    ) -> Result<SkillVersion, ApplicationError>;
    fn list_skill_versions(
        &self,
        skill_name: SkillName,
    ) -> Result<Vec<SkillVersion>, ApplicationError>;
    fn insert_eval_case(
        &self,
        case_kind: ielts_domain::EvalCaseKind,
        input: &serde_json::Value,
        expected: &serde_json::Value,
        holdout: bool,
    ) -> Result<EvalCase, ApplicationError>;
    fn list_eval_cases(&self, include_holdout: bool) -> Result<Vec<EvalCase>, ApplicationError>;
    fn propose_candidate(
        &self,
        command: &ProposeCandidateCommand,
    ) -> Result<CandidatePromotion, ApplicationError>;
    fn run_eval(&self, command: &RunEvalCommand) -> Result<EvalRunOutcome, ApplicationError>;
    fn approve_candidate(
        &self,
        command: &ApproveCandidateCommand,
    ) -> Result<CandidatePromotion, ApplicationError>;
    fn promote_candidate(
        &self,
        command: &PromoteCandidateCommand,
    ) -> Result<CandidateDecision, ApplicationError>;
    fn rollback_version(
        &self,
        command: &RollbackCommand,
    ) -> Result<RollbackOutcome, ApplicationError>;
    fn record_shadow_run(
        &self,
        candidate_id: &str,
        input_hash: &str,
        output_diff: &serde_json::Value,
        no_user_visible_side_effect: bool,
    ) -> Result<(), ApplicationError>;
}

pub struct PromptSkillService<'a> {
    store: &'a dyn PromptSkillStore,
}

impl<'a> PromptSkillService<'a> {
    pub fn new(store: &'a dyn PromptSkillStore) -> Self {
        Self { store }
    }

    /// M11-02: ensure a prompt template row exists for the given module.
    pub fn ensure_prompt_template(
        &self,
        module: PromptModule,
        description: Option<&str>,
    ) -> Result<PromptTemplate, ApplicationError> {
        self.store.ensure_prompt_template(module, description)
    }

    /// M11-05: create a prompt version (starts at draft).
    pub fn create_prompt_version(
        &self,
        template_id: &str,
        content_text: &str,
        prompt_metadata: &serde_json::Value,
        created_by: &str,
    ) -> Result<PromptVersion, ApplicationError> {
        self.store
            .create_prompt_version(template_id, content_text, prompt_metadata, created_by)
    }

    /// M11-05: list prompt versions for a module, ordered by version desc.
    pub fn list_prompt_versions(
        &self,
        module: PromptModule,
    ) -> Result<Vec<PromptVersion>, ApplicationError> {
        self.store.list_prompt_versions(module)
    }

    /// M11-05: get the active prompt version for a module. Returns None when
    /// no registry version is active (callers fall back to the compiled-in
    /// const). M11-05: holdout cases never enter this read path.
    pub fn get_active_prompt_version(
        &self,
        module: PromptModule,
    ) -> Result<Option<PromptVersion>, ApplicationError> {
        self.store.get_active_prompt_version(module)
    }

    /// M11-03: ensure a skill definition row exists.
    pub fn ensure_skill_definition(
        &self,
        skill_name: SkillName,
        description: Option<&str>,
    ) -> Result<ielts_domain::SkillDefinition, ApplicationError> {
        self.store.ensure_skill_definition(skill_name, description)
    }

    /// M11-05: create a skill version (starts at draft).
    pub fn create_skill_version(
        &self,
        skill_definition_id: &str,
        definition: &serde_json::Value,
        created_by: &str,
    ) -> Result<SkillVersion, ApplicationError> {
        self.store
            .create_skill_version(skill_definition_id, definition, created_by)
    }

    /// M11-05: list skill versions.
    pub fn list_skill_versions(
        &self,
        skill_name: SkillName,
    ) -> Result<Vec<SkillVersion>, ApplicationError> {
        self.store.list_skill_versions(skill_name)
    }

    /// M11-04: insert an eval case. Holdout cases never enter prompt
    /// generation context.
    pub fn insert_eval_case(
        &self,
        case_kind: ielts_domain::EvalCaseKind,
        input: &serde_json::Value,
        expected: &serde_json::Value,
        holdout: bool,
    ) -> Result<EvalCase, ApplicationError> {
        self.store
            .insert_eval_case(case_kind, input, expected, holdout)
    }

    /// M11-04/05: list eval cases. When `include_holdout` is false, holdout
    /// cases are excluded (the prompt-generation read path).
    pub fn list_eval_cases(
        &self,
        include_holdout: bool,
    ) -> Result<Vec<EvalCase>, ApplicationError> {
        self.store.list_eval_cases(include_holdout)
    }

    /// M11-05: propose a candidate (prompt or skill version). The candidate
    /// starts at proposed; promotion is gated on a passing eval run.
    pub fn propose_candidate(
        &self,
        command: &ProposeCandidateCommand,
    ) -> Result<CandidatePromotion, ApplicationError> {
        self.store.propose_candidate(command)
    }

    /// M11-05: run the offline eval for a candidate. The candidate advances
    /// to eval_passed only when all cases pass.
    pub fn run_eval(&self, command: &RunEvalCommand) -> Result<EvalRunOutcome, ApplicationError> {
        self.store.run_eval(command)
    }

    /// M11-05: approve a candidate (manual gate). Requires eval_passed.
    pub fn approve_candidate(
        &self,
        command: &ApproveCandidateCommand,
    ) -> Result<CandidatePromotion, ApplicationError> {
        self.store.approve_candidate(command)
    }

    /// M11-05: promote a candidate. Requires approved; sets the underlying
    /// version active and the previously active version rollback.
    pub fn promote_candidate(
        &self,
        command: &PromoteCandidateCommand,
    ) -> Result<CandidateDecision, ApplicationError> {
        self.store.promote_candidate(command)
    }

    /// M11-05: exact rollback. Marks the active version rollback and
    /// reinstates the prior version.
    pub fn rollback_version(
        &self,
        command: &RollbackCommand,
    ) -> Result<RollbackOutcome, ApplicationError> {
        self.store.rollback_version(command)
    }

    /// M11-05: record a shadow run. Asserts no user-visible side effect.
    pub fn record_shadow_run(
        &self,
        candidate_id: &str,
        input_hash: &str,
        output_diff: &serde_json::Value,
        no_user_visible_side_effect: bool,
    ) -> Result<(), ApplicationError> {
        self.store.record_shadow_run(
            candidate_id,
            input_hash,
            output_diff,
            no_user_visible_side_effect,
        )
    }
}
