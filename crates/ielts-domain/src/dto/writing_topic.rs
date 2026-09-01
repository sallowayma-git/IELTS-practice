use serde::{Deserialize, Serialize};

use crate::domain::WritingTaskType;

#[cfg(feature = "ts-export")]
use ts_rs::TS;

/// Canonical user-visible writing topic. The generic asset row owns the
/// attempt foreign key; this DTO owns writing-specific policy and rich title.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingTopicDto {
    /// Stable opaque string. Never coerce this to a number in a client.
    pub id: String,
    pub task_type: WritingTaskType,
    pub category: String,
    pub difficulty: u8,
    /// Canonical ProseMirror/Tiptap JSON. Plain legacy titles are normalized
    /// into a paragraph document when imported.
    pub title_json: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(default)]
    pub is_official: bool,
    /// Derived from writing attempts; never independently written by a UI.
    pub usage_count: u32,
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
pub struct UpsertWritingTopicCommand {
    /// Omit for a server-generated ID. A supplied ID is always treated as a
    /// string and is validated before any mutation.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "source_id",
        alias = "sourceId"
    )]
    pub id: Option<String>,
    #[serde(alias = "type", alias = "task_type")]
    pub task_type: WritingTaskType,
    pub category: String,
    pub difficulty: u8,
    #[serde(alias = "title_json")]
    pub title_json: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "image_path")]
    pub image_path: Option<String>,
    /// Omitted edits preserve an existing topic's official flag. Imports may
    /// explicitly retain the flag from a legacy package.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "is_official"
    )]
    pub is_official: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ListWritingTopicsQuery {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "type")]
    pub task_type: Option<WritingTaskType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(default = "default_topic_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

fn default_topic_limit() -> u32 {
    20
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingTopicPage {
    pub items: Vec<WritingTopicDto>,
    pub total: u32,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct ImportWritingTopicsCommand {
    #[serde(default)]
    pub topics: Vec<UpsertWritingTopicCommand>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingTopicImportReport {
    pub created: u32,
    pub updated: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingTopicCount {
    pub task_type: WritingTaskType,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct WritingTopicStatistics {
    pub total: u32,
    pub by_task_type: Vec<WritingTopicCount>,
}
