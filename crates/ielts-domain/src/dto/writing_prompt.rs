use serde::{Deserialize, Serialize};

use crate::domain::WritingTaskType;

#[cfg(feature = "ts-export")]
use ts_rs::TS;

/// Durable evaluation-prompt policy. Prompt selection is database state, not a
/// frontend preference: exactly one version per writing task may be active.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingPromptDto {
    pub id: String,
    pub task_type: WritingTaskType,
    pub version: String,
    pub body: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct UpsertWritingPromptCommand {
    /// Omit for a Rust-generated opaque ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(alias = "task_type")]
    pub task_type: WritingTaskType,
    #[serde(default)]
    pub version: Option<String>,
    pub body: String,
    /// Omitted during an update means keep the stored activation state. New
    /// prompts are inactive unless the caller explicitly opts in.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "is_active")]
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ImportWritingPromptsCommand {
    #[serde(default)]
    pub prompts: Vec<UpsertWritingPromptCommand>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingPromptImportReport {
    pub created: u32,
    pub updated: u32,
    pub items: Vec<WritingPromptDto>,
}
