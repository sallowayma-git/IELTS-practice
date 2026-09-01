use serde::{Deserialize, Serialize};

use crate::domain::{Activity, AssetSourceKind};

#[cfg(feature = "ts-export")]
use ts_rs::TS;

/// Reading / writing asset metadata v2.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct PracticeAssetV2 {
    pub schema_version: u32,
    pub id: String,
    pub activity: Activity,
    pub source_kind: AssetSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_key: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_ref: Option<String>,
    pub fingerprint: String,
    /// True when the asset is not answerable (PDF-only / passage-only).
    #[serde(default)]
    pub pdf_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

impl PracticeAssetV2 {
    pub const SCHEMA_VERSION: u32 = 2;
}

/// A canonical asset record paired with its complete versioned JSON payload.
///
/// Index commands intentionally return only metadata. Practice flows request this
/// DTO when the learner opens one concrete asset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts-export",
    derive(TS),
    ts(export, export_to = "../../../apps/writing-vue/src/types/generated/")
)]
pub struct PracticeAssetV2Payload {
    pub asset: PracticeAssetV2,
    pub payload: serde_json::Value,
}
