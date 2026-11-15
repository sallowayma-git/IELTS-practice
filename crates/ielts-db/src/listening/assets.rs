//! Listening asset index, resource pack seeding and audio serving.
//!
//! `practice_assets` is the queryable index; the exam payload stays in the
//! immutable resource pack and is verified against its indexed sha256 on every
//! load. Audio never reaches the webview as a path: it is resolved inside the
//! pack root and returned as a data URL, exactly like the reading PDF path.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use ielts_domain::domain::{Activity, AssetSourceKind};
use ielts_domain::dto::{PracticeAssetV2, PracticeAssetV2Payload};

use crate::reading::assets::{
    list_assets, practice_asset_from_row, set_question_kinds, strip_answer_attributes, AssetIndexEntry,
};
use crate::reading::scoring::normalize_question_id;
use crate::sqlite::{DbError, DbResult};

use super::question_kinds;

/// The exam payload is a listening recording plus a paper; 32 MiB is far above
/// any IELTS audio file and keeps a corrupt pack from exhausting memory.
const MAX_AUDIO_BYTES: u64 = 32 * 1024 * 1024;

const LISTENING_ACTIVITY: &str = "listening";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningResourceManifestV1 {
    pub schema_version: u32,
    pub assets: Vec<ListeningResourceAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningResourceAsset {
    pub id: String,
    pub file: String,
    pub sha256: String,
}

/// The versioned exam source a listening resource file carries.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningExamSourceV1 {
    pub schema_version: u32,
    pub exam_id: String,
    pub meta: ListeningExamMeta,
    pub question_count: u32,
    pub question_order: Vec<String>,
    pub question_groups: Vec<ListeningQuestionGroup>,
    #[serde(default)]
    pub interaction_model: Value,
    pub answer_key: Map<String, Value>,
    #[serde(default)]
    pub question_display_map: Value,
    #[serde(default)]
    pub review_explanations: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningExamMeta {
    pub title: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub difficulty: Option<String>,
    #[serde(default)]
    pub frequency: Option<String>,
    pub audio: String,
    #[serde(default)]
    pub duration_seconds: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningQuestionGroup {
    pub group_id: String,
    pub section: u8,
    pub kind: String,
    pub question_ids: Vec<String>,
    #[serde(default)]
    pub lead_html: Option<String>,
    #[serde(default)]
    pub body_html: Option<String>,
}

/// Register every asset of a built-in listening pack.
///
/// Returns the number of assets the manifest declares and that were validated.
/// Every run rewrites the indexed row from the pack, exactly like the reading
/// seeder: `content_ref` is an absolute path, so a restored database or a moved
/// install directory must re-point it even when the bytes are unchanged, and the
/// derived `question_kinds_json`/`metadata_json` must follow the current code.
pub fn seed_builtin_listening_pack(conn: &Connection, pack_root: &Path) -> DbResult<usize> {
    let manifest_path = pack_root.join("manifest.json");
    let manifest_raw = fs::read_to_string(&manifest_path)?;
    let manifest: ListeningResourceManifestV1 = serde_json::from_str(&manifest_raw)
        .map_err(|err| DbError::Validation(format!("listening resource manifest: {err}")))?;
    if manifest.schema_version != 1 {
        return Err(DbError::Validation(format!(
            "unsupported listening resource manifest schema: {}",
            manifest.schema_version
        )));
    }

    let tx = conn.unchecked_transaction()?;
    for entry in &manifest.assets {
        validate_relative_path(&entry.file, "listening exam")?;
        let exam_path = pack_root.join(&entry.file);
        let raw = fs::read_to_string(&exam_path)?;
        let sha256 = hex::encode(Sha256::digest(raw.as_bytes()));
        if sha256 != entry.sha256 {
            return Err(DbError::Validation(format!(
                "listening resource checksum mismatch: {}",
                entry.id
            )));
        }
        let value: Value = serde_json::from_str(&raw).map_err(|err| {
            DbError::Validation(format!("listening resource {}: {err}", entry.id))
        })?;
        let payload: ListeningExamSourceV1 = serde_json::from_value(value.clone()).map_err(|err| {
            DbError::Validation(format!("listening resource {}: {err}", entry.id))
        })?;
        if payload.exam_id != entry.id {
            return Err(DbError::Validation(format!(
                "listening resource examId mismatch: manifest {}, payload {}",
                entry.id, payload.exam_id
            )));
        }
        validate_exam_source(&payload)?;

        let existing_activity: Option<String> = tx
            .query_row(
                "SELECT activity FROM practice_assets WHERE id = ?1",
                params![entry.id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(activity) = existing_activity {
            if activity != LISTENING_ACTIVITY {
                return Err(DbError::Validation(format!(
                    "listening resource id belongs to a {activity} asset: {}",
                    entry.id
                )));
            }
        }

        let asset = PracticeAssetV2 {
            schema_version: PracticeAssetV2::SCHEMA_VERSION,
            id: entry.id.clone(),
            activity: Activity::Listening,
            source_kind: AssetSourceKind::Builtin,
            source_key: Some(entry.id.clone()),
            title: payload.meta.title.clone(),
            category: payload.meta.category.clone(),
            difficulty: payload.meta.difficulty.clone(),
            frequency: payload.meta.frequency.clone(),
            content_ref: Some(exam_path.display().to_string()),
            fingerprint: sha256.clone(),
            pdf_only: false,
            metadata: Some(json!({
                "resourcePack": pack_root
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(LISTENING_ACTIVITY),
                "sha256": sha256,
                "audio": payload.meta.audio,
                "durationSeconds": payload.meta.duration_seconds,
            })),
        };
        crate::reading::assets::upsert_practice_asset(&tx, &asset)?;
        set_question_kinds(
            &tx,
            &asset.id,
            &question_kinds::classify_question_kinds(&value),
        )?;
    }
    tx.commit()?;

    Ok(manifest.assets.len())
}

/// Validate the payload's paper structure before it can become an asset.
pub fn validate_exam_source(payload: &ListeningExamSourceV1) -> DbResult<()> {
    if payload.schema_version != 1 {
        return Err(DbError::Validation(format!(
            "unsupported listening exam schema: {}",
            payload.schema_version
        )));
    }
    if payload.exam_id.trim().is_empty() {
        return Err(DbError::Validation(
            "listening exam is missing examId".into(),
        ));
    }
    validate_relative_path(&payload.meta.audio, "listening audio")?;
    if payload.question_order.is_empty() {
        return Err(DbError::Validation(format!(
            "listening exam {} has no questions",
            payload.exam_id
        )));
    }
    if payload.question_count as usize != payload.question_order.len() {
        return Err(DbError::Validation(format!(
            "listening exam {} declares {} questions but orders {}",
            payload.exam_id,
            payload.question_count,
            payload.question_order.len()
        )));
    }

    let mut ordered = std::collections::BTreeSet::new();
    for raw in &payload.question_order {
        let question_id = normalize_question_id(raw);
        if question_id.is_empty() {
            return Err(DbError::Validation(format!(
                "listening exam {} has an empty question id",
                payload.exam_id
            )));
        }
        if !ordered.insert(question_id.clone()) {
            return Err(DbError::Validation(format!(
                "listening exam {} lists {question_id} twice",
                payload.exam_id
            )));
        }
    }

    let answer_key: std::collections::BTreeSet<String> = payload
        .answer_key
        .keys()
        .map(|raw| normalize_question_id(raw))
        .collect();
    let mut grouped = std::collections::BTreeSet::new();
    for group in &payload.question_groups {
        if !(1..=4).contains(&group.section) {
            return Err(DbError::Validation(format!(
                "listening group {} has invalid section {}",
                group.group_id, group.section
            )));
        }
        if !question_kinds::is_allowed_kind(&group.kind) {
            return Err(DbError::Validation(format!(
                "listening group {} has unknown question kind: {}",
                group.group_id, group.kind
            )));
        }
        if group.question_ids.is_empty() {
            return Err(DbError::Validation(format!(
                "listening group {} has no questions",
                group.group_id
            )));
        }
        for raw in &group.question_ids {
            let question_id = normalize_question_id(raw);
            if !ordered.contains(&question_id) {
                return Err(DbError::Validation(format!(
                    "listening group {} references {question_id}, which is not in questionOrder",
                    group.group_id
                )));
            }
            if !answer_key.contains(&question_id) {
                return Err(DbError::Validation(format!(
                    "listening question {question_id} has no answerKey entry"
                )));
            }
            if !grouped.insert(question_id.clone()) {
                return Err(DbError::Validation(format!(
                    "listening question {question_id} appears in two groups"
                )));
            }
        }
    }
    if grouped.len() != ordered.len() {
        let unassigned = ordered
            .difference(&grouped)
            .next()
            .cloned()
            .unwrap_or_default();
        return Err(DbError::Validation(format!(
            "listening question {unassigned} is not assigned to a group"
        )));
    }
    Ok(())
}

/// A manifest or payload path must stay inside the pack root.
fn validate_relative_path(raw: &str, label: &str) -> DbResult<()> {
    let invalid = |reason: &str| {
        Err(DbError::Validation(format!(
            "invalid {label} path ({reason}): {raw}"
        )))
    };
    if raw.trim().is_empty() {
        return invalid("empty");
    }
    if raw.contains('\\') {
        // "\Windows\x" has a root but no drive prefix, so is_absolute() is
        // false on Windows and join would discard the pack dir entirely.
        return invalid("backslash");
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        return invalid("absolute");
    }
    for component in path.components() {
        match component {
            Component::ParentDir => return invalid("parent directory"),
            Component::RootDir | Component::Prefix(_) => return invalid("rooted"),
            _ => {}
        }
    }
    Ok(())
}

/// Indexed listening assets only. Reuses the fixed `list_assets` filter so a
/// reading or writing row can never leak into the listening library.
pub fn list_listening_assets(conn: &Connection) -> DbResult<Vec<AssetIndexEntry>> {
    list_assets(conn, Some(Activity::Listening))
}

/// Load the verified listening payload (answer material included).
pub fn load_listening_payload(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<PracticeAssetV2Payload> {
    let asset = load_listening_asset(conn, asset_id)?;
    let content_ref = asset.content_ref.as_deref().ok_or_else(|| {
        DbError::Validation(format!("listening asset has no content_ref: {asset_id}"))
    })?;
    let raw = fs::read_to_string(content_ref)?;
    let actual = hex::encode(Sha256::digest(raw.as_bytes()));
    if actual != asset.fingerprint {
        return Err(DbError::Validation(format!(
            "listening asset fingerprint mismatch: {asset_id}"
        )));
    }
    let payload: Value = serde_json::from_str(&raw)
        .map_err(|err| DbError::Validation(format!("listening asset json: {err}")))?;
    Ok(PracticeAssetV2Payload { asset, payload })
}

/// The payload the practice webview may see.
///
/// Same contract as [`crate::reading::assets::load_practice_asset_payload_for_view`]:
/// the indexed fingerprint is verified and inline `data-answer` attributes are
/// removed. `answerKey` is left in place because the reading view contract
/// leaves it in place; scoring never trusts the caller's copy.
pub fn load_listening_payload_for_view(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<Value> {
    let mut loaded = load_listening_payload(conn, asset_id)?;
    strip_answer_attributes(&mut loaded.payload);
    Ok(loaded.payload)
}

/// questionId (normalized) -> section, read from a payload value.
pub fn load_sections(payload: &Value) -> BTreeMap<String, u8> {
    question_kinds::load_sections(payload)
}

/// questionId (normalized) -> section for one indexed asset.
pub fn load_listening_sections(
    conn: &Connection,
    asset_id: &str,
) -> DbResult<BTreeMap<String, u8>> {
    let payload = load_listening_payload_for_view(conn, asset_id)?;
    Ok(load_sections(&payload))
}

/// Resolve `meta.audio` inside the pack root and return it as a data URL.
pub fn load_listening_audio_data_url(
    conn: &Connection,
    asset_id: &str,
    pack_root: &Path,
) -> DbResult<String> {
    let asset = load_listening_asset(conn, asset_id)?;
    let content_ref = asset.content_ref.as_deref().ok_or_else(|| {
        DbError::Validation(format!("listening asset has no content_ref: {asset_id}"))
    })?;
    let raw = fs::read_to_string(content_ref)?;
    if hex::encode(Sha256::digest(raw.as_bytes())) != asset.fingerprint {
        return Err(DbError::Validation(format!(
            "listening asset fingerprint mismatch: {asset_id}"
        )));
    }
    let payload: Value = serde_json::from_str(&raw)
        .map_err(|err| DbError::Validation(format!("listening asset json: {err}")))?;
    let audio = payload
        .pointer("/meta/audio")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            DbError::Validation(format!("listening asset has no meta.audio: {asset_id}"))
        })?;
    validate_relative_path(audio, "listening audio")?;

    let root = pack_root.canonicalize()?;
    let resolved = root.join(audio).canonicalize()?;
    if !resolved.starts_with(&root) {
        return Err(DbError::Validation(format!(
            "listening audio escapes the pack root: {audio}"
        )));
    }
    if fs::metadata(&resolved)?.len() > MAX_AUDIO_BYTES {
        return Err(DbError::Validation(format!(
            "listening audio exceeds {MAX_AUDIO_BYTES} bytes: {audio}"
        )));
    }
    let bytes = fs::read(&resolved)?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_AUDIO_BYTES {
        return Err(DbError::Validation(format!(
            "listening audio is empty or exceeds {MAX_AUDIO_BYTES} bytes: {audio}"
        )));
    }
    Ok(format!(
        "data:{};base64,{}",
        audio_mime(&resolved)?,
        STANDARD.encode(bytes)
    ))
}

fn load_listening_asset(conn: &Connection, asset_id: &str) -> DbResult<PracticeAssetV2> {
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
                DbError::Validation(format!("listening asset not found: {asset_id}"))
            }
            other => DbError::Sqlite(other),
        })?;
    if asset.activity != Activity::Listening {
        return Err(DbError::Validation(format!(
            "asset is not a {LISTENING_ACTIVITY} asset: {asset_id}"
        )));
    }
    Ok(asset)
}

fn audio_mime(path: &Path) -> DbResult<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => Ok("audio/mpeg"),
        Some("m4a") => Ok("audio/mp4"),
        Some("wav") => Ok("audio/wav"),
        other => Err(DbError::Validation(format!(
            "unsupported listening audio extension: {}",
            other.unwrap_or("<none>")
        ))),
    }
}
