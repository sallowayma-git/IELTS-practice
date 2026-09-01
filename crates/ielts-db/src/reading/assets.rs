//! Reading asset index + fingerprint (Phase 6).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use ielts_domain::domain::{Activity, AssetSourceKind};
use ielts_domain::dto::{PracticeAssetV2, PracticeAssetV2Payload};

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexEntry {
    pub id: String,
    pub title: String,
    pub category: Option<String>,
    pub difficulty: Option<String>,
    pub frequency: Option<String>,
    pub fingerprint: String,
    pub schema_version: u32,
    pub content_ref: Option<String>,
    /// Vue guards historically looked for payloadRef; keep both names.
    pub payload_ref: Option<String>,
    /// Always present so list filters (`activity === 'reading'`) work.
    pub activity: String,
    pub pdf_only: bool,
}

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingResourceManifest {
    pub schema_version: u32,
    pub pack_id: String,
    pub asset_count: usize,
    pub entries: Vec<ReadingResourceEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingResourceEntry {
    pub exam_id: String,
    pub file: String,
    pub title: String,
    pub category: Option<String>,
    pub difficulty: Option<String>,
    pub frequency: Option<String>,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSeedReport {
    pub pack_id: String,
    pub declared: usize,
    pub imported: usize,
}

pub fn fingerprint_payload(payload: &Value) -> String {
    let bytes = serde_json::to_vec(payload).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hex::encode(hasher.finalize())
}

/// Validate and register the immutable reading resource pack shipped with the app.
/// Payloads remain in the bundle; SQLite stores only the queryable index and absolute content ref.
pub fn seed_builtin_reading_pack(
    conn: &Connection,
    pack_dir: &Path,
) -> DbResult<ReadingSeedReport> {
    let manifest_path = pack_dir.join("manifest.json");
    let manifest_raw = fs::read_to_string(&manifest_path)?;
    let manifest: ReadingResourceManifest = serde_json::from_str(&manifest_raw)
        .map_err(|err| DbError::Validation(format!("reading resource manifest: {err}")))?;
    if manifest.schema_version != 1 {
        return Err(DbError::Validation(format!(
            "unsupported reading resource manifest schema: {}",
            manifest.schema_version
        )));
    }
    if manifest.asset_count != manifest.entries.len() {
        return Err(DbError::Validation(format!(
            "reading resource count mismatch: declared {}, found {}",
            manifest.asset_count,
            manifest.entries.len()
        )));
    }

    let tx = conn.unchecked_transaction()?;
    for entry in &manifest.entries {
        let relative = Path::new(&entry.file);
        if relative.is_absolute() || entry.file.contains("..") {
            return Err(DbError::Validation(format!(
                "invalid reading resource path: {}",
                entry.file
            )));
        }
        let payload_path = pack_dir.join(relative);
        let raw = fs::read_to_string(&payload_path)?;
        let raw_hash = hex::encode(Sha256::digest(raw.as_bytes()));
        if raw_hash != entry.sha256 {
            return Err(DbError::Validation(format!(
                "reading resource checksum mismatch: {}",
                entry.exam_id
            )));
        }
        let payload: Value = serde_json::from_str(&raw).map_err(|err| {
            DbError::Validation(format!("reading resource {}: {err}", entry.exam_id))
        })?;
        let payload_id = payload
            .get("examId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                DbError::Validation(format!("resource missing examId: {}", entry.file))
            })?;
        if payload_id != entry.exam_id {
            return Err(DbError::Validation(format!(
                "reading resource examId mismatch: manifest {}, payload {}",
                entry.exam_id, payload_id
            )));
        }
        let asset = PracticeAssetV2 {
            schema_version: PracticeAssetV2::SCHEMA_VERSION,
            id: entry.exam_id.clone(),
            activity: Activity::Reading,
            source_kind: AssetSourceKind::Builtin,
            source_key: Some(format!("{}:{}", manifest.pack_id, entry.exam_id)),
            title: entry.title.clone(),
            category: entry.category.clone(),
            difficulty: entry.difficulty.clone(),
            frequency: entry.frequency.clone(),
            content_ref: Some(payload_path.display().to_string()),
            fingerprint: fingerprint_payload(&payload),
            pdf_only: false,
            metadata: Some(json!({ "resourcePack": &manifest.pack_id, "sha256": &entry.sha256 })),
        };
        upsert_practice_asset(&tx, &asset)?;
    }
    tx.commit()?;

    Ok(ReadingSeedReport {
        pack_id: manifest.pack_id,
        declared: manifest.asset_count,
        imported: manifest.entries.len(),
    })
}

pub fn upsert_practice_asset(conn: &Connection, asset: &PracticeAssetV2) -> DbResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let meta = asset.metadata.as_ref().map(|v| v.to_string());
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, category, difficulty, frequency,
            content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            category = excluded.category,
            difficulty = excluded.difficulty,
            frequency = excluded.frequency,
            content_ref = excluded.content_ref,
            schema_version = excluded.schema_version,
            fingerprint = excluded.fingerprint,
            pdf_only = excluded.pdf_only,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at",
        params![
            asset.id,
            "reading",
            match asset.source_kind {
                AssetSourceKind::Builtin => "builtin",
                AssetSourceKind::Imported => "imported",
                AssetSourceKind::Freeform => "freeform",
            },
            asset.source_key,
            asset.title,
            asset.category,
            asset.difficulty,
            asset.frequency,
            asset.content_ref,
            asset.schema_version as i64,
            asset.fingerprint,
            if asset.pdf_only { 1 } else { 0 },
            meta,
            now,
        ],
    )?;
    Ok(())
}

pub fn list_assets(
    conn: &Connection,
    activity: Option<Activity>,
) -> DbResult<Vec<AssetIndexEntry>> {
    let mut sql = String::from(
        "SELECT id, title, category, difficulty, frequency, fingerprint, schema_version, content_ref, pdf_only
         FROM practice_assets",
    );
    if activity.is_some() {
        sql.push_str(" WHERE activity = ?1");
    }
    sql.push_str(" ORDER BY category, title");
    let mut stmt = conn.prepare(&sql)?;
    let map_row = |row: &rusqlite::Row<'_>| {
        let content_ref: Option<String> = row.get(7)?;
        Ok(AssetIndexEntry {
            id: row.get(0)?,
            title: row.get(1)?,
            category: row.get(2)?,
            difficulty: row.get(3)?,
            frequency: row.get(4)?,
            fingerprint: row.get(5)?,
            schema_version: row.get::<_, i64>(6)? as u32,
            content_ref: content_ref.clone(),
            payload_ref: content_ref,
            activity: "reading".into(),
            pdf_only: row.get::<_, i64>(8)? != 0,
        })
    };
    let rows = if let Some(act) = activity {
        let a = match act {
            Activity::Reading => "reading",
            Activity::Writing => "writing",
        };
        stmt.query_map(params![a], map_row)?
    } else {
        stmt.query_map([], map_row)?
    };
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Return a verified PDF-only resource as a data URL for the packaged Tauri
/// webview. Vue receives no filesystem path and cannot ask for arbitrary files.
pub fn load_pdf_data_url(conn: &Connection, asset_id: &str) -> DbResult<String> {
    let (activity, pdf_only, content_ref): (String, i64, Option<String>) = conn
        .query_row(
            "SELECT activity, pdf_only, content_ref FROM practice_assets WHERE id = ?1",
            params![asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                DbError::Validation(format!("reading asset not found: {asset_id}"))
            }
            other => DbError::Sqlite(other),
        })?;
    if activity != "reading" || pdf_only == 0 {
        return Err(DbError::Validation(format!(
            "asset is not a PDF-only reading resource: {asset_id}"
        )));
    }
    let path = content_ref.ok_or_else(|| {
        DbError::Validation(format!("PDF reading asset has no content_ref: {asset_id}"))
    })?;
    let bytes = fs::read(path)?;
    if bytes.is_empty() || bytes.len() > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err(DbError::Validation(format!(
            "PDF reading asset is invalid or exceeds {MAX_PDF_BYTES} bytes: {asset_id}"
        )));
    }
    Ok(format!(
        "data:application/pdf;base64,{}",
        STANDARD.encode(bytes)
    ))
}

/// Load the complete JSON payload for one reading asset.
///
/// `practice_assets` remains the queryable index. The payload stays in the
/// referenced resource file and is verified against the indexed fingerprint on
/// every load, so a stale or damaged resource cannot silently enter a session.
pub fn load_practice_asset_payload(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<PracticeAssetV2Payload> {
    let asset = conn
        .query_row(
            "SELECT id, activity, source_kind, source_key, title, category, difficulty,
                    frequency, content_ref, schema_version, fingerprint, pdf_only, metadata_json
             FROM practice_assets WHERE id = ?1",
            params![asset_id],
            practice_asset_from_row,
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => {
                DbError::Validation(format!("reading asset not found: {asset_id}"))
            }
            other => DbError::Sqlite(other),
        })?;

    if asset.activity != Activity::Reading {
        return Err(DbError::Validation(format!(
            "asset is not a reading asset: {asset_id}"
        )));
    }
    let content_ref = asset.content_ref.as_deref().ok_or_else(|| {
        DbError::Validation(format!("reading asset has no content_ref: {asset_id}"))
    })?;
    let raw = fs::read_to_string(content_ref)?;
    let payload: Value = serde_json::from_str(&raw)
        .map_err(|err| DbError::Validation(format!("asset json: {err}")))?;
    let actual_fingerprint = fingerprint_payload(&payload);
    if actual_fingerprint != asset.fingerprint {
        return Err(DbError::Validation(format!(
            "reading asset fingerprint mismatch: {asset_id}"
        )));
    }

    Ok(PracticeAssetV2Payload { asset, payload })
}

fn practice_asset_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PracticeAssetV2> {
    let activity = match row.get::<_, String>(1)?.as_str() {
        "reading" => Activity::Reading,
        "writing" => Activity::Writing,
        value => return Err(invalid_column_value(1, value, "activity")),
    };
    let source_kind = match row.get::<_, String>(2)?.as_str() {
        "builtin" => AssetSourceKind::Builtin,
        "imported" => AssetSourceKind::Imported,
        "freeform" => AssetSourceKind::Freeform,
        value => return Err(invalid_column_value(2, value, "source_kind")),
    };
    let metadata_json: Option<String> = row.get(12)?;
    let metadata = metadata_json
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|err| {
                rusqlite::Error::FromSqlConversionFailure(
                    12,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            })
        })
        .transpose()?;

    Ok(PracticeAssetV2 {
        schema_version: row.get::<_, i64>(9)? as u32,
        id: row.get(0)?,
        activity,
        source_kind,
        source_key: row.get(3)?,
        title: row.get(4)?,
        category: row.get(5)?,
        difficulty: row.get(6)?,
        frequency: row.get(7)?,
        content_ref: row.get(8)?,
        fingerprint: row.get(10)?,
        pdf_only: row.get::<_, i64>(11)? != 0,
        metadata,
    })
}

fn invalid_column_value(index: usize, value: &str, field: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        format!("invalid {field}: {value}").into(),
    )
}

/// Load a reading payload JSON file and register it as a practice asset.
pub fn import_asset_payload_file(conn: &Connection, path: &Path) -> DbResult<PracticeAssetV2> {
    let raw = fs::read_to_string(path)?;
    let payload: Value =
        serde_json::from_str(&raw).map_err(|e| DbError::Validation(format!("asset json: {e}")))?;
    import_asset_payload(conn, &payload, Some(path.display().to_string()))
}

pub fn import_asset_payload(
    conn: &Connection,
    payload: &Value,
    content_ref: Option<String>,
) -> DbResult<PracticeAssetV2> {
    let exam_id = payload
        .get("examId")
        .or_else(|| payload.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| DbError::Validation("asset missing examId".into()))?
        .to_string();
    let title = payload
        .pointer("/meta/title")
        .or_else(|| payload.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or(&exam_id)
        .to_string();
    let category = payload
        .pointer("/meta/category")
        .or_else(|| payload.get("category"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let frequency = payload
        .pointer("/meta/frequency")
        .or_else(|| payload.get("frequency"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let fp = fingerprint_payload(payload);
    let asset = PracticeAssetV2 {
        schema_version: PracticeAssetV2::SCHEMA_VERSION,
        id: exam_id.clone(),
        activity: Activity::Reading,
        source_kind: AssetSourceKind::Imported,
        source_key: Some(exam_id.clone()),
        title,
        category,
        difficulty: None,
        frequency,
        content_ref,
        fingerprint: fp,
        pdf_only: false,
        metadata: Some(json_meta(payload)),
    };
    upsert_practice_asset(conn, &asset)?;
    Ok(asset)
}

fn json_meta(payload: &Value) -> Value {
    json!({
        "questionCount": payload.get("questionCount").cloned().unwrap_or(Value::Null),
        "hasAnswerKey": payload.get("answerKey").is_some(),
    })
}

use serde_json::json;

/// Scan a directory of JSON reading payloads.
pub fn scan_asset_directory(dir: &Path) -> DbResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod resource_pack_tests {
    use super::*;
    use crate::{migrate, open_connection, DbOpenOptions};

    #[test]
    fn seed_is_validated_and_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let pack = temp.path().join("reading");
        fs::create_dir_all(pack.join("payloads")).unwrap();
        let payload = json!({
            "examId": "p1-test-1",
            "meta": { "title": "Test passage", "category": "P1", "frequency": "low" },
            "answerKey": { "q1": "A" }
        });
        let raw = format!("{}\n", serde_json::to_string_pretty(&payload).unwrap());
        fs::write(pack.join("payloads/p1-test-1.json"), &raw).unwrap();
        let checksum = hex::encode(Sha256::digest(raw.as_bytes()));
        let manifest = json!({
            "schemaVersion": 1,
            "packId": "test-pack",
            "assetCount": 1,
            "entries": [{
                "examId": "p1-test-1",
                "file": "payloads/p1-test-1.json",
                "title": "Test passage",
                "category": "P1",
                "difficulty": null,
                "frequency": "low",
                "sha256": checksum
            }]
        });
        fs::write(
            pack.join("manifest.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let mut conn =
            open_connection(&DbOpenOptions::create(temp.path().join("test.db"))).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(seed_builtin_reading_pack(&conn, &pack).unwrap().imported, 1);
        assert_eq!(seed_builtin_reading_pack(&conn, &pack).unwrap().imported, 1);
        assert_eq!(
            list_assets(&conn, Some(Activity::Reading)).unwrap().len(),
            1
        );
        assert_eq!(
            load_practice_asset_payload(&conn, "p1-test-1")
                .unwrap()
                .payload["answerKey"]["q1"],
            "A"
        );
    }
}

pub fn load_answer_key(payload: &Value) -> serde_json::Map<String, Value> {
    let mut map = serde_json::Map::new();
    if let Some(obj) = payload.get("answerKey").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            map.insert(normalize_qid(k), v.clone());
        }
    }
    map
}

pub fn load_controls(payload: &Value) -> serde_json::Map<String, Value> {
    let mut map = serde_json::Map::new();
    if let Some(obj) = payload.get("interactionModel").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let Some(control) = v.get("control") {
                map.insert(normalize_qid(k), control.clone());
            }
        }
    }
    map
}

pub fn load_kinds(payload: &Value) -> serde_json::Map<String, Value> {
    let mut map = HashMap::new();
    if let Some(groups) = payload.get("questionGroups").and_then(|v| v.as_array()) {
        for g in groups {
            let kind = g
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            if let Some(ids) = g.get("questionIds").and_then(|v| v.as_array()) {
                for id in ids {
                    if let Some(s) = id.as_str() {
                        map.insert(normalize_qid(s), kind.clone());
                    }
                }
            }
        }
    }
    map.into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect()
}

fn normalize_qid(s: &str) -> String {
    crate::reading::scoring::normalize_question_id(s)
}
