use serde::{Deserialize, Serialize};

/// Rust-owned corpus export contract for the M5 Python retrieval engine.
///
/// Python consumes these bounded, versioned views; it never opens the canonical
/// SQLite or the payload files directly. Chunk identity is derived from the
/// canonical source identity plus a deterministic chunking version, never a
/// Python-generated UUID.
pub const CORPUS_SCHEMA_VERSION: u32 = 1;
pub const CORPUS_CHUNKING_VERSION: u32 = 1;
pub const MAX_CORPUS_EXPORT_LIMIT: u32 = 500;
pub const MAX_CORPUS_FETCH_IDS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusManifest {
    pub schema_version: u32,
    pub chunking_version: u32,
    pub generated_at: String,
    pub asset_count: u32,
    pub chunk_count: u32,
    pub source_kinds: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusChunk {
    pub chunk_id: String,
    pub source_kind: String,
    pub source_id: String,
    pub source_version: u32,
    pub activity: String,
    pub content_hash: String,
    pub sensitivity: String,
    pub text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusExportQuery {
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default = "default_export_limit")]
    pub limit: u32,
}

impl Default for CorpusExportQuery {
    fn default() -> Self {
        Self {
            cursor: None,
            limit: default_export_limit(),
        }
    }
}

fn default_export_limit() -> u32 {
    200
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusExportPage {
    pub schema_version: u32,
    pub chunking_version: u32,
    pub generated_at: String,
    pub chunks: Vec<CorpusChunk>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorpusFetchQuery {
    pub ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusFetchResult {
    pub schema_version: u32,
    pub chunks: Vec<CorpusChunk>,
    pub missing_ids: Vec<String>,
}

pub fn corpus_chunk_id(activity: &str, asset_id: &str) -> String {
    format!("{activity}:{asset_id}:v{CORPUS_CHUNKING_VERSION}:0")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_id_is_stable_and_versioned() {
        assert_eq!(
            corpus_chunk_id("reading", "p1-high-01"),
            format!("reading:p1-high-01:v{}:0", CORPUS_CHUNKING_VERSION)
        );
    }
}
