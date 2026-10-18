//! Dream-run domain contracts.
//!
//! The daily journal is a deterministic summary and has no dream run. A dream
//! run is the ledger row of the weekly consolidation (`dream_runs`), which is
//! fail-closed: a failed run never blocks the practice loop. The legacy
//! `dream_candidates` table was dropped by migration 0033.

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

pub const DREAM_SCHEMA_VERSION: u32 = 1;

/// Status of a dream run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DreamRunStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

impl DreamRunStatus {
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

/// A dream run record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../apps/writing-vue/src/types/generated/")
)]
pub struct DreamRun {
    pub id: String,
    pub user_id: String,
    pub journal_id: String,
    pub status: DreamRunStatus,
    pub input_hash: Option<String>,
    pub output_hash: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<serde_json::Value>,
    pub attempts: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// Identifies the journal a dream run is anchored on (FK of `dream_runs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DailyDreamQuery {
    pub user_id: String,
    pub journal_id: String,
}
