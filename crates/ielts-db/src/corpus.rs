//! M5 Rust-owned corpus export gateway.
//!
//! This is the only place Rust hands canonical corpus text to the Python
//! retrieval engine. Chunk identity is derived from `{activity}:{asset_id}` plus
//! a deterministic chunking version; the content hash is the asset fingerprint,
//! so any source change invalidates the derived index. Rust never builds a
//! retrieval/vector index here.

use std::collections::BTreeSet;

use ielts_domain::{
    corpus_chunk_id, CorpusChunk, CorpusExportPage, CorpusExportQuery, CorpusFetchQuery,
    CorpusFetchResult, CorpusManifest, CORPUS_CHUNKING_VERSION, CORPUS_SCHEMA_VERSION,
    MAX_CORPUS_EXPORT_LIMIT, MAX_CORPUS_FETCH_IDS,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::reading::load_practice_asset_payload;
use crate::sqlite::{DbError, DbResult};
use crate::writing::extract_text_from_json;

const CHUNK_SOURCE_READING: &str = "reading_asset";
const CHUNK_SOURCE_WRITING: &str = "writing_topic";

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn corpus_manifest(conn: &Connection) -> DbResult<CorpusManifest> {
    let reading: i64 = conn.query_row(
        "SELECT COUNT(*) FROM practice_assets WHERE activity='reading' AND pdf_only=0",
        [],
        |row| row.get(0),
    )?;
    let writing: i64 = conn.query_row("SELECT COUNT(*) FROM writing_topics", [], |row| row.get(0))?;
    let mut source_kinds = Vec::new();
    if reading > 0 {
        source_kinds.push(CHUNK_SOURCE_READING.to_string());
    }
    if writing > 0 {
        source_kinds.push(CHUNK_SOURCE_WRITING.to_string());
    }
    Ok(CorpusManifest {
        schema_version: CORPUS_SCHEMA_VERSION,
        chunking_version: CORPUS_CHUNKING_VERSION,
        generated_at: now_rfc3339(),
        asset_count: (reading + writing) as u32,
        chunk_count: (reading + writing) as u32,
        source_kinds,
    })
}

pub fn export_corpus_chunks(
    conn: &Connection,
    query: &CorpusExportQuery,
) -> DbResult<CorpusExportPage> {
    let limit = query.limit.clamp(1, MAX_CORPUS_EXPORT_LIMIT) as usize;
    let (cursor_activity, cursor_id) = match query.cursor.as_deref() {
        Some(cursor) => decode_cursor(cursor).ok_or_else(|| {
            DbError::Validation(format!("invalid corpus export cursor: {cursor}"))
        })?,
        None => (None, None),
    };
    let keys = load_asset_keys(conn, cursor_activity.as_deref(), cursor_id.as_deref(), limit + 1)?;
    let truncated = keys.len() > limit;
    let page = keys.into_iter().take(limit).collect::<Vec<_>>();
    let mut chunks = Vec::with_capacity(page.len());
    for (activity, asset_id, updated_at) in page {
        chunks.push(build_chunk(conn, &activity, &asset_id, &updated_at)?);
    }
    let next_cursor = if truncated {
        chunks
            .last()
            .map(|chunk| encode_cursor(&chunk.activity, &chunk.source_id))
    } else {
        None
    };
    Ok(CorpusExportPage {
        schema_version: CORPUS_SCHEMA_VERSION,
        chunking_version: CORPUS_CHUNKING_VERSION,
        generated_at: now_rfc3339(),
        chunks,
        next_cursor,
        truncated,
    })
}

pub fn fetch_corpus_chunks(conn: &Connection, query: &CorpusFetchQuery) -> DbResult<CorpusFetchResult> {
    let requested = unique_bounded_ids(&query.ids)?;
    let mut chunks = Vec::with_capacity(requested.len());
    let mut missing_ids = Vec::new();
    for chunk_id in &requested {
        match parse_chunk_id(chunk_id) {
            Some((activity, asset_id)) => {
                match (load_asset_key(conn, &activity, &asset_id), build_chunk(conn, &activity, &asset_id, &now_rfc3339())) {
                    (Ok(_key), Ok(chunk)) if chunk.chunk_id == *chunk_id => chunks.push(chunk),
                    _ => missing_ids.push(chunk_id.clone()),
                }
            }
            None => missing_ids.push(chunk_id.clone()),
        }
    }
    Ok(CorpusFetchResult {
        schema_version: CORPUS_SCHEMA_VERSION,
        chunks,
        missing_ids,
    })
}

fn build_chunk(
    conn: &Connection,
    activity: &str,
    asset_id: &str,
    updated_at: &str,
) -> DbResult<CorpusChunk> {
    match activity {
        "reading" => {
            let loaded = load_practice_asset_payload(conn, asset_id)?;
            let text = reading_text(&loaded.payload);
            Ok(CorpusChunk {
                chunk_id: corpus_chunk_id("reading", asset_id),
                source_kind: CHUNK_SOURCE_READING.into(),
                source_id: asset_id.to_string(),
                source_version: loaded.asset.schema_version,
                activity: "reading".into(),
                content_hash: loaded.asset.fingerprint,
                sensitivity: "normal".into(),
                text,
                updated_at: updated_at.to_string(),
            })
        }
        "writing" => {
            let (title_json, fingerprint, schema_version) = conn
                .query_row(
                    "SELECT wt.title_json, pa.fingerprint, pa.schema_version
                     FROM writing_topics wt
                     JOIN practice_assets pa ON pa.id = wt.asset_id
                     WHERE wt.asset_id = ?1",
                    params![asset_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| DbError::Validation(format!("writing topic not found: {asset_id}")))?;
            let parsed: Value = serde_json::from_str(&title_json).unwrap_or(Value::String(title_json));
            let text = extract_text_from_json(&parsed);
            Ok(CorpusChunk {
                chunk_id: corpus_chunk_id("writing", asset_id),
                source_kind: CHUNK_SOURCE_WRITING.into(),
                source_id: asset_id.to_string(),
                source_version: schema_version as u32,
                activity: "writing".into(),
                content_hash: fingerprint,
                sensitivity: "normal".into(),
                text,
                updated_at: updated_at.to_string(),
            })
        }
        other => Err(DbError::Validation(format!("unsupported corpus activity: {other}"))),
    }
}

fn load_asset_key(
    conn: &Connection,
    activity: &str,
    asset_id: &str,
) -> DbResult<(String, String, String)> {
    let row = match activity {
        "reading" => conn
            .query_row(
                "SELECT activity, id, updated_at FROM practice_assets
                 WHERE activity='reading' AND pdf_only=0 AND id=?1",
                params![asset_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?,
        "writing" => conn
            .query_row(
                "SELECT 'writing', wt.asset_id, pa.updated_at
                 FROM writing_topics wt
                 JOIN practice_assets pa ON pa.id = wt.asset_id
                 WHERE wt.asset_id=?1",
                params![asset_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?,
        _ => None,
    };
    row.ok_or_else(|| DbError::Validation(format!("chunk source not found: {activity}:{asset_id}")))
}

fn load_asset_keys(
    conn: &Connection,
    cursor_activity: Option<&str>,
    cursor_id: Option<&str>,
    limit: usize,
) -> DbResult<Vec<(String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT activity, asset_id, updated_at FROM (
            SELECT 'reading' AS activity, id AS asset_id, updated_at
            FROM practice_assets WHERE activity='reading' AND pdf_only=0
            UNION ALL
            SELECT 'writing' AS activity, wt.asset_id AS asset_id, pa.updated_at
            FROM writing_topics wt JOIN practice_assets pa ON pa.id = wt.asset_id
         )
         WHERE (?1 IS NULL) OR (activity > ?1) OR (activity = ?1 AND asset_id > ?2)
         ORDER BY activity, asset_id
         LIMIT ?3",
    )?;
    let rows = statement.query_map(
        params![cursor_activity, cursor_id, limit as i64],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn reading_text(payload: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(blocks) = payload.pointer("/passage/blocks").and_then(Value::as_array) {
        for block in blocks {
            if let Some(html) = block.get("html").and_then(Value::as_str) {
                let text = html_to_text(html);
                if !text.is_empty() {
                    parts.push(text);
                }
            }
        }
    }
    if let Some(groups) = payload.get("questionGroups").and_then(Value::as_array) {
        for group in groups {
            if let Some(html) = group.get("bodyHtml").and_then(Value::as_str) {
                let text = html_to_text(html);
                if !text.is_empty() {
                    parts.push(text);
                }
            }
        }
    }
    parts.join("\n")
}

fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' => {
                in_tag = false;
                let lower = tag.to_ascii_lowercase();
                if matches!(
                    lower.as_str(),
                    "br" | "/p" | "/div" | "/li" | "/h1" | "/h2" | "/h3" | "/h4" | "/h5"
                        | "/h6" | "/tr"
                ) {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(ch),
            _ => out.push(ch),
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn encode_cursor(activity: &str, asset_id: &str) -> String {
    serde_json::to_string(&[activity, asset_id]).unwrap_or_default()
}

fn decode_cursor(cursor: &str) -> Option<(Option<String>, Option<String>)> {
    let parts: Vec<String> = serde_json::from_str(cursor).ok()?;
    match parts.as_slice() {
        [activity, asset_id] => Some((Some(activity.clone()), Some(asset_id.clone()))),
        _ => None,
    }
}

fn parse_chunk_id(chunk_id: &str) -> Option<(String, String)> {
    let suffix = format!(":v{CORPUS_CHUNKING_VERSION}:0");
    let rest = chunk_id.strip_suffix(&suffix)?;
    let (activity, asset_id) = rest.split_once(':')?;
    match activity {
        "reading" | "writing" if !asset_id.is_empty() => Some((activity.to_string(), asset_id.to_string())),
        _ => None,
    }
}

fn unique_bounded_ids(ids: &[String]) -> DbResult<Vec<String>> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for id in ids {
        if id.trim().is_empty() {
            return Err(DbError::Validation("corpus chunk id is empty".into()));
        }
        if seen.insert(id.clone()) {
            out.push(id.clone());
        }
        if out.len() > MAX_CORPUS_FETCH_IDS {
            return Err(DbError::Validation(format!(
                "corpus fetch exceeds {MAX_CORPUS_FETCH_IDS} ids"
            )));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_stripping_collapses_tags_and_entities() {
        let text = html_to_text("<p>Governments <strong>should</strong> make &amp; people responsible.</p>");
        assert_eq!(text, "Governments should make & people responsible.");
    }

    #[test]
    fn chunk_id_round_trips_through_parse() {
        let id = corpus_chunk_id("reading", "p1:high:01");
        assert_eq!(parse_chunk_id(&id), Some(("reading".into(), "p1:high:01".into())));
        assert!(parse_chunk_id("bogus:x:v1:0").is_none());
        assert!(parse_chunk_id("reading:missing:v2:0").is_none());
    }

    #[test]
    fn cursor_round_trips() {
        let cursor = encode_cursor("reading", "p1-high-01");
        assert_eq!(
            decode_cursor(&cursor),
            Some((Some("reading".into()), Some("p1-high-01".into())))
        );
    }
}
