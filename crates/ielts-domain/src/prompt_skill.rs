//! M11 Prompt/Skill Evolution domain contracts.
//!
//! Separates product-level Prompt/Skill evolution from user-level Memory
//! evolution. The online Agent never edits its own Soul (M11-01); product
//! prompts evolve via a controlled engineering pipeline owned by Rust (the
//! release gate):
//!
//! ```text
//! propose -> offline eval -> holdout -> shadow -> approval -> canary ->
//!   promote -> rollback
//! ```
//!
//! The LLM may only PROPOSE candidates; it never executes promotion. The
//! `update_system_prompt`/`edit_soul`/`install_unreviewed_skill` agent tools
//! are denied (M11-06). Holdout eval cases never enter prompt generation
//! context (M11-05). Every prompt/skill invocation pins its version in the
//! trace (M11-08).
//!
//! The versioned registry is an OVERLAY over the existing hardcoded prompt
//! constants: when no active registry version exists, callers fall back to
//! the compiled-in constant. The registry never rewrites the const path.

use serde::{Deserialize, Serialize};

pub const PROMPT_SKILL_SCHEMA_VERSION: u32 = 1;

/// M11-02: prompt module registry. `core_soul` is the stable Policy Layer
/// (M11-01): it is never rewritten by Daily/Weekly Dream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptModule {
    CoreSoul,
    AttemptReview,
    CoachReading,
    CoachWriting,
    MemoryExtract,
    MemoryResolve,
    DailyDream,
    WeeklyDream,
    StrategySelector,
    StudyPlanner,
}

impl PromptModule {
    pub const ALL: [Self; 10] = [
        Self::CoreSoul,
        Self::AttemptReview,
        Self::CoachReading,
        Self::CoachWriting,
        Self::MemoryExtract,
        Self::MemoryResolve,
        Self::DailyDream,
        Self::WeeklyDream,
        Self::StrategySelector,
        Self::StudyPlanner,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CoreSoul => "core_soul",
            Self::AttemptReview => "attempt_review",
            Self::CoachReading => "coach_reading",
            Self::CoachWriting => "coach_writing",
            Self::MemoryExtract => "memory_extract",
            Self::MemoryResolve => "memory_resolve",
            Self::DailyDream => "daily_dream",
            Self::WeeklyDream => "weekly_dream",
            Self::StrategySelector => "strategy_selector",
            Self::StudyPlanner => "study_planner",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }

    /// M11-01: the Soul module is a stable Policy Layer. It is never
    /// rewritten by Daily/Weekly Dream; its versions exist only to pin the
    /// compiled-in Soul text in the trace, not to evolve content.
    pub const fn is_policy_layer(self) -> bool {
        matches!(self, Self::CoreSoul)
    }
}

/// M11-03: skill registry. A skill is a reusable process/capability, not a
/// Memory file. Skill versioning is separated from user memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillName {
    ReadAttemptEvidence,
    CompareRepeatedAttempts,
    ExplainTfngError,
    BuildWeeklyReflection,
}

impl SkillName {
    pub const ALL: [Self; 4] = [
        Self::ReadAttemptEvidence,
        Self::CompareRepeatedAttempts,
        Self::ExplainTfngError,
        Self::BuildWeeklyReflection,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadAttemptEvidence => "read_attempt_evidence",
            Self::CompareRepeatedAttempts => "compare_repeated_attempts",
            Self::ExplainTfngError => "explain_tfng_error",
            Self::BuildWeeklyReflection => "build_weekly_reflection",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }
}

/// M11-04: eval case category. Eight evaluation categories span the
/// product surface. `holdout` cases never enter prompt generation context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalCaseKind {
    MemoryExtractionGoldens,
    FalseMergeSplit,
    ConsolidationZero,
    ContextSelection,
    CoachPersonalization,
    PromptInjection,
    RepeatedFamiliarity,
    StrategyOutcome,
}

impl EvalCaseKind {
    pub const ALL: [Self; 8] = [
        Self::MemoryExtractionGoldens,
        Self::FalseMergeSplit,
        Self::ConsolidationZero,
        Self::ContextSelection,
        Self::CoachPersonalization,
        Self::PromptInjection,
        Self::RepeatedFamiliarity,
        Self::StrategyOutcome,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MemoryExtractionGoldens => "memory_extraction_goldens",
            Self::FalseMergeSplit => "false_merge_split",
            Self::ConsolidationZero => "consolidation_zero",
            Self::ContextSelection => "context_selection",
            Self::CoachPersonalization => "coach_personalization",
            Self::PromptInjection => "prompt_injection",
            Self::RepeatedFamiliarity => "repeated_familiarity",
            Self::StrategyOutcome => "strategy_outcome",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str() == value)
    }
}

/// M11-05: version lifecycle status. Shared by prompt and skill versions.
/// Transitions are owned by Rust (the release gate):
/// `draft -> eval -> holdout -> shadow -> canary -> active`; `rollback`
/// marks a superseded version. Only one version per template/definition may
/// be `active` at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionStatus {
    Draft,
    Eval,
    Holdout,
    Shadow,
    Canary,
    Active,
    Rollback,
}

impl VersionStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Eval => "eval",
            Self::Holdout => "holdout",
            Self::Shadow => "shadow",
            Self::Canary => "canary",
            Self::Active => "active",
            Self::Rollback => "rollback",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "draft" => Some(Self::Draft),
            "eval" => Some(Self::Eval),
            "holdout" => Some(Self::Holdout),
            "shadow" => Some(Self::Shadow),
            "canary" => Some(Self::Canary),
            "active" => Some(Self::Active),
            "rollback" => Some(Self::Rollback),
            _ => None,
        }
    }
}

/// M11-05: candidate promotion lifecycle status. A candidate owns the
/// release pipeline of a single proposed prompt or skill version.
/// `proposed -> eval_passed -> holdout -> shadow -> approved -> canary ->
/// promoted` (or `rolled_back`). Promotion to `active` of the underlying
/// version is gated on `eval_passed` at minimum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Proposed,
    EvalPassed,
    Holdout,
    Shadow,
    Approved,
    Canary,
    Promoted,
    RolledBack,
}

impl CandidateStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::EvalPassed => "eval_passed",
            Self::Holdout => "holdout",
            Self::Shadow => "shadow",
            Self::Approved => "approved",
            Self::Canary => "canary",
            Self::Promoted => "promoted",
            Self::RolledBack => "rolled_back",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "proposed" => Some(Self::Proposed),
            "eval_passed" => Some(Self::EvalPassed),
            "holdout" => Some(Self::Holdout),
            "shadow" => Some(Self::Shadow),
            "approved" => Some(Self::Approved),
            "canary" => Some(Self::Canary),
            "promoted" => Some(Self::Promoted),
            "rolled_back" => Some(Self::RolledBack),
            _ => None,
        }
    }
}

/// M11-05: the kind of target a candidate promotes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateTargetKind {
    Prompt,
    Skill,
}

impl CandidateTargetKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::Skill => "skill",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "prompt" => Some(Self::Prompt),
            "skill" => Some(Self::Skill),
            _ => None,
        }
    }
}

/// M11-05: a candidate promotion record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidatePromotion {
    pub id: String,
    pub target_kind: CandidateTargetKind,
    pub target_version_id: String,
    pub proposal: serde_json::Value,
    pub status: CandidateStatus,
    pub proposed_by: String,
    pub approved_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// M11-02: a prompt template (one per module).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplate {
    pub id: String,
    pub module_name: PromptModule,
    pub description: Option<String>,
    pub created_at: String,
}

/// M11-05: an immutable prompt version row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptVersion {
    pub id: String,
    pub template_id: String,
    pub module_name: PromptModule,
    pub version: i64,
    pub content_hash: String,
    pub content_text: String,
    pub prompt_metadata: serde_json::Value,
    pub status: VersionStatus,
    pub created_by: String,
    pub created_at: String,
}

/// M11-03: a skill definition (one per skill name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    pub id: String,
    pub skill_name: SkillName,
    pub description: Option<String>,
    pub created_at: String,
}

/// M11-05: an immutable skill version row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersion {
    pub id: String,
    pub skill_definition_id: String,
    pub skill_name: SkillName,
    pub version: i64,
    pub definition: serde_json::Value,
    pub status: VersionStatus,
    pub created_by: String,
    pub created_at: String,
}

/// M11-04: an eval case fixture.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalCase {
    pub id: String,
    pub case_kind: EvalCaseKind,
    pub input: serde_json::Value,
    pub expected: serde_json::Value,
    pub holdout: bool,
}

/// M11-05: an eval run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalRun {
    pub id: String,
    pub candidate_promotion_id: String,
    pub status: EvalRunStatus,
    pub metrics: Option<serde_json::Value>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<serde_json::Value>,
    pub created_at: String,
}

/// M11-05: eval run status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalRunStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

impl EvalRunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// M11-05: a single case result within an eval run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalResult {
    pub id: String,
    pub eval_run_id: String,
    pub case_id: String,
    pub passed: bool,
    pub score: f64,
    pub grading: serde_json::Value,
}

/// M11-05: a shadow run record. A shadow run exercises a candidate against
/// real inputs without producing user-visible side effects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowRun {
    pub id: String,
    pub candidate_promotion_id: String,
    pub input_hash: String,
    pub output_diff: serde_json::Value,
    pub no_user_visible_side_effect: bool,
    pub created_at: String,
}

/// M11-05: propose a candidate (prompt or skill version) for the release
/// pipeline. The candidate starts at `proposed`; promotion is gated on a
/// passing eval run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposeCandidateCommand {
    pub target_kind: CandidateTargetKind,
    pub target_version_id: String,
    pub proposal: serde_json::Value,
    pub proposed_by: String,
}

/// M11-05: run the offline eval for a candidate against a set of cases.
/// Records an eval run + per-case results. The candidate is only advanced
/// past `proposed` when at least one `completed` run exists with all cases
/// passing. Holdout cases are included here (they are the held-out
/// evaluation set) but never enter prompt generation context.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunEvalCommand {
    pub candidate_id: String,
    /// Case IDs to score. Must reference existing `eval_cases`. The grader
    /// outputs (`passed`/`score`/`grading`) are supplied by the caller; Rust
    /// is the authority that persists them and advances the candidate.
    pub results: Vec<EvalCaseGrading>,
}

/// M11-08: the grader output for a single case. The deterministic graders
/// live in the Python eval harness; Rust records the verdict and enforces
/// the promotion gate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvalCaseGrading {
    pub case_id: String,
    pub passed: bool,
    pub score: f64,
    pub grading: serde_json::Value,
}

/// M11-05: the result of an eval run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunOutcome {
    pub run: EvalRun,
    pub results: Vec<EvalResult>,
    /// `true` when the candidate advanced to `eval_passed`. `false` when the
    /// run failed (a case did not pass) and the candidate stayed `proposed`.
    pub candidate_advanced: bool,
}

/// M11-05: approve a candidate (manual gate). Only an approved candidate may
/// be promoted to `active`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveCandidateCommand {
    pub candidate_id: String,
    pub approved_by: String,
}

/// M11-05: promote a candidate. Requires `approved` status; sets the
/// candidate to `promoted` and the underlying version to `active` (the
/// previously active version is marked `rollback`). Exact rollback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteCandidateCommand {
    pub candidate_id: String,
}

/// M11-05: rollback a version. Marks the currently active version
/// `rollback` and the prior version `active`. Exact rollback: the prior
/// version's content is reinstated as the active prompt/skill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackCommand {
    pub target_kind: CandidateTargetKind,
    pub target_version_id: String,
    /// Who ordered the rollback. Required, non-empty.
    ///
    /// Round-3 audit (A2): rollback activates a version, which is exactly as
    /// powerful as promote, yet it carried no actor at all while
    /// `ApproveCandidateCommand` requires `approved_by`. An unattributable
    /// operation that changes which prompt is live is not auditable, so the
    /// DoD question "who activated this version" had no answer on this path.
    pub rolled_back_by: String,
}

/// M11-05: the result of a promote or rollback operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDecision {
    pub candidate_id: String,
    pub status: CandidateStatus,
}

/// M11-05: the result of a rollback. Carries the reinstated version id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackOutcome {
    pub target_kind: CandidateTargetKind,
    pub rolled_back_version_id: String,
    pub reinstated_version_id: Option<String>,
}

/// M11-08: a version pin recorded in the invocation trace. Every prompt
/// invocation records its prompt version; every skill invocation records its
/// skill version. This is the audit link between a trace row and the exact
/// prompt/skill content that produced it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptVersionPin {
    pub module_name: PromptModule,
    pub version_id: String,
    pub version: i64,
    pub content_hash: String,
}

/// M11-08: a skill version pin recorded in the run trace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersionPin {
    pub skill_name: SkillName,
    pub version_id: String,
    pub version: i64,
}

/// M11-06: the deny-list of online self-modifying agent tools. The reverse-
/// RPC `tool.invoke` dispatcher rejects these names before any side effect.
/// The online Agent never edits its own Soul, system prompt, or installs an
/// unreviewed skill.
pub const DENIED_SELF_MODIFYING_TOOLS: &[&str] = &[
    "update_system_prompt",
    "edit_soul",
    "install_unreviewed_skill",
];

/// M11-06: returns `true` when a tool name is on the self-modifying deny-
/// list. Used by the reverse-RPC `tool.invoke` dispatcher to fail closed.
pub fn is_denied_self_modifying_tool(name: &str) -> bool {
    DENIED_SELF_MODIFYING_TOOLS.contains(&name)
}
