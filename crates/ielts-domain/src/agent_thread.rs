//! M12 General Agent Thread domain contracts.
//!
//! Pure enums + DTOs for the thread, checkpoint, and controlled-action gate.
//! These are the only vocabulary that crosses the application/adapter
//! boundary for M12. The persistence layer (`ielts_db::agent_thread`) owns the
//! SQLite rows; the application service (`ielts_application::agent_thread`)
//! owns the use-case boundary.

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

/// M12-01: the workspace surface a thread belongs to. Drives the context
/// scope and which tools are offered. `workspace` is the general fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum ThreadKind {
    Workspace,
    StudyPlan,
    CoachReview,
    AttemptReview,
    MemoryManager,
}

impl ThreadKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::StudyPlan => "study_plan",
            Self::CoachReview => "coach_review",
            Self::AttemptReview => "attempt_review",
            Self::MemoryManager => "memory_manager",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "workspace" => Some(Self::Workspace),
            "study_plan" => Some(Self::StudyPlan),
            "coach_review" => Some(Self::CoachReview),
            "attempt_review" => Some(Self::AttemptReview),
            "memory_manager" => Some(Self::MemoryManager),
            _ => None,
        }
    }
}

impl Default for ThreadKind {
    fn default() -> Self {
        Self::Workspace
    }
}

/// M12-01: thread lifecycle. `archived` threads are hidden from the active
/// list but retained for audit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum ThreadStatus {
    Active,
    Archived,
}

impl ThreadStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "archived" => Some(Self::Archived),
            _ => None,
        }
    }
}

/// M12-01: the role of a message in a thread transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum MessageRole {
    User,
    Assistant,
    Tool,
    System,
}

impl MessageRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
            Self::System => "system",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            "tool" => Some(Self::Tool),
            "system" => Some(Self::System),
            _ => None,
        }
    }
}

/// M12-02: the checkpoint stage state machine. A run advances through these
/// stages; the latest persisted stage is the recovery point after restart.
/// `final` is terminal; any other stage on an interrupted run is replay-safe
/// for read-only tools but write tools require approval (M12-02).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum CheckpointStage {
    ContextBuilt,
    ModelResponse,
    ToolBefore,
    ToolAfter,
    WaitingApproval,
    Final,
}

impl CheckpointStage {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ContextBuilt => "context_built",
            Self::ModelResponse => "model_response",
            Self::ToolBefore => "tool_before",
            Self::ToolAfter => "tool_after",
            Self::WaitingApproval => "waiting_approval",
            Self::Final => "final",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "context_built" => Some(Self::ContextBuilt),
            "model_response" => Some(Self::ModelResponse),
            "tool_before" => Some(Self::ToolBefore),
            "tool_after" => Some(Self::ToolAfter),
            "waiting_approval" => Some(Self::WaitingApproval),
            "final" => Some(Self::Final),
            _ => None,
        }
    }

    /// Returns true when the stage is terminal. An interrupted run whose
    /// latest checkpoint is not terminal is a recovery candidate.
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Final)
    }
}

/// M12-06: the controlled-action three-layer gate.
///
/// - `Allow`: executed without approval (low-risk, reversible).
/// - `ApprovalGate`: requires explicit user approval before execution.
/// - `Forbidden`: never offered to the agent; rejected by the Rust authority
///   before persistence.
///
/// The forbidden set is a Rust authority constant, not a persisted enum
/// variant: the reverse-RPC `tool.invoke` dispatcher rejects those
/// `action_kind` values before any row is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum ActionKind {
    CreateStudyPlanDraft,
    MarkPlanItemDone,
    ArchiveMemoryWithUserConfirmation,
    SetExplicitPreference,
    BulkArchive,
    ResetDerivedMemory,
    ChangePersonalizationSettings,
    ModifyLongTermPlan,
}

impl ActionKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CreateStudyPlanDraft => "create_study_plan_draft",
            Self::MarkPlanItemDone => "mark_plan_item_done",
            Self::ArchiveMemoryWithUserConfirmation => "archive_memory_with_user_confirmation",
            Self::SetExplicitPreference => "set_explicit_preference",
            Self::BulkArchive => "bulk_archive",
            Self::ResetDerivedMemory => "reset_derived_memory",
            Self::ChangePersonalizationSettings => "change_personalization_settings",
            Self::ModifyLongTermPlan => "modify_long_term_plan",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "create_study_plan_draft" => Some(Self::CreateStudyPlanDraft),
            "mark_plan_item_done" => Some(Self::MarkPlanItemDone),
            "archive_memory_with_user_confirmation" => Some(Self::ArchiveMemoryWithUserConfirmation),
            "set_explicit_preference" => Some(Self::SetExplicitPreference),
            "bulk_archive" => Some(Self::BulkArchive),
            "reset_derived_memory" => Some(Self::ResetDerivedMemory),
            "change_personalization_settings" => Some(Self::ChangePersonalizationSettings),
            "modify_long_term_plan" => Some(Self::ModifyLongTermPlan),
            _ => None,
        }
    }

    /// M12-06: the gate classification for this action kind.
    pub const fn gate(self) -> ActionGate {
        match self {
            Self::CreateStudyPlanDraft
            | Self::MarkPlanItemDone
            | Self::ArchiveMemoryWithUserConfirmation
            | Self::SetExplicitPreference => ActionGate::Allow,
            Self::BulkArchive
            | Self::ResetDerivedMemory
            | Self::ChangePersonalizationSettings
            | Self::ModifyLongTermPlan => ActionGate::ApprovalGate,
        }
    }
}

/// M12-06: the three-layer classification. `Forbidden` is a return value
/// from the authority boundary, never a persisted row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionGate {
    Allow,
    ApprovalGate,
    Forbidden,
}

/// M12-06: the forbidden action kinds that are never offered to the agent.
/// The reverse-RPC `tool.invoke` dispatcher rejects these names before any
/// side effect. Keep this list in sync with the M12-06 contract.
pub const FORBIDDEN_ACTION_KINDS: &[&str] = &[
    "direct_sql",
    "arbitrary_filesystem",
    "api_key_read",
    "production_prompt_mutation",
    "schema_migration",
    "silent_delete_history",
];

/// M12-06: returns true when an action kind name is on the forbidden list.
/// Used by the reverse-RPC `tool.invoke` dispatcher to fail closed.
pub fn is_forbidden_action_kind(name: &str) -> bool {
    FORBIDDEN_ACTION_KINDS.contains(&name)
}

/// M12-06: the approval status for an approval-gated action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
}

impl ApprovalStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "approved" => Some(Self::Approved),
            "rejected" => Some(Self::Rejected),
            _ => None,
        }
    }
}

/// M12-01: a thread row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThread {
    pub id: String,
    pub user_id: String,
    pub thread_kind: ThreadKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub sequence: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
    pub status: ThreadStatus,
    pub created_at: String,
    pub updated_at: String,
}

/// M12-01: a message in a thread transcript.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageRecord {
    pub id: String,
    pub thread_id: String,
    pub role: MessageRole,
    pub sequence: u32,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    pub created_at: String,
}

/// M12-02: a checkpoint for thread-run recovery.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCheckpointRecord {
    pub id: String,
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub stage: CheckpointStage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    pub created_at: String,
}

/// M12-04: a study plan proposal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlan {
    pub id: String,
    pub user_id: String,
    pub goal: String,
    pub available_minutes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Latest plan plus items for the product host. Plan IDs are not thread IDs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanSnapshot {
    pub plan: StudyPlan,
    pub items: Vec<StudyPlanItem>,
}

/// Host → Python planner request. Rust fills this; Python orchestrates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerateStudyPlanCommand {
    #[serde(default = "default_local_user_id")]
    pub user_id: String,
    #[serde(default = "default_study_goal")]
    pub user_goal: String,
    #[serde(default = "default_available_minutes")]
    pub available_minutes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
}

fn default_local_user_id() -> String {
    "local".into()
}

fn default_study_goal() -> String {
    "IELTS practice".into()
}

fn default_available_minutes() -> u32 {
    60
}

/// M12-04: a study plan item (a skill probe proposal).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanItem {
    pub id: String,
    pub plan_id: String,
    pub skill_probe: String,
    pub why_text: String,
    pub estimated_minutes: u32,
    pub done: bool,
    pub created_at: String,
}

/// M12-06: a controlled-action approval record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionApproval {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    pub action_kind: ActionKind,
    pub payload: serde_json::Value,
    pub status: ApprovalStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
}

/// M12-01: command to create a thread.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThreadCommand {
    pub user_id: String,
    pub thread_kind: ThreadKind,
    pub title: String,
}

/// M12-01: command to append a message to a thread.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendMessageCommand {
    pub thread_id: String,
    pub role: MessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

/// M12-02: command to save a checkpoint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCheckpointCommand {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub stage: CheckpointStage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

/// M12-02: command to request cancellation of a thread run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestCancelCommand {
    pub thread_id: String,
}

/// M12-02: the outcome of a cancellation request. `cancelled` is true when a
/// non-terminal checkpoint existed and was marked interrupted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOutcome {
    pub thread_id: String,
    pub cancelled: bool,
}

/// M12-02: the recovery report after restart. Threads whose latest checkpoint
/// is non-terminal are marked interrupted; their runs are not auto-replayed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRecoveryReport {
    pub interrupted_threads: u32,
    pub interrupted_checkpoints: u32,
}

/// M12-04: command to create a study plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyPlanCommand {
    pub user_id: String,
    pub goal: String,
    pub available_minutes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
    #[serde(default)]
    pub items: Vec<CreateStudyPlanItemCommand>,
}

/// M12-04: a proposed item within a study plan command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateStudyPlanItemCommand {
    pub skill_probe: String,
    pub why_text: String,
    pub estimated_minutes: u32,
}

/// M12-04: command to mark a plan item done.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkPlanItemDoneCommand {
    pub item_id: String,
    pub done: bool,
}

/// M12-06: command to record an approval-gated action as pending.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordApprovalCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    pub action_kind: ActionKind,
    pub payload: serde_json::Value,
}

/// M12-06: command to decide a pending approval.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideApprovalCommand {
    pub approval_id: String,
    pub status: ApprovalStatus,
    pub approved_by: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_kind_gate_classification_is_total() {
        for kind in [
            ActionKind::CreateStudyPlanDraft,
            ActionKind::MarkPlanItemDone,
            ActionKind::ArchiveMemoryWithUserConfirmation,
            ActionKind::SetExplicitPreference,
        ] {
            assert_eq!(kind.gate(), ActionGate::Allow);
        }
        for kind in [
            ActionKind::BulkArchive,
            ActionKind::ResetDerivedMemory,
            ActionKind::ChangePersonalizationSettings,
            ActionKind::ModifyLongTermPlan,
        ] {
            assert_eq!(kind.gate(), ActionGate::ApprovalGate);
        }
    }

    #[test]
    fn forbidden_action_kinds_are_rejected() {
        assert!(is_forbidden_action_kind("direct_sql"));
        assert!(is_forbidden_action_kind("silent_delete_history"));
        assert!(!is_forbidden_action_kind("create_study_plan_draft"));
        assert!(!is_forbidden_action_kind("bulk_archive"));
    }

    #[test]
    fn checkpoint_stage_round_trips() {
        for stage in [
            CheckpointStage::ContextBuilt,
            CheckpointStage::ModelResponse,
            CheckpointStage::ToolBefore,
            CheckpointStage::ToolAfter,
            CheckpointStage::WaitingApproval,
            CheckpointStage::Final,
        ] {
            assert_eq!(CheckpointStage::parse(stage.as_str()), Some(stage));
        }
        assert!(CheckpointStage::Final.is_terminal());
        assert!(!CheckpointStage::ToolBefore.is_terminal());
    }
}
