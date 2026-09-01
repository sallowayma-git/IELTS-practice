//! First-class writing topic aggregate.
//!
//! `practice_assets` remains the only asset identity referenced by attempts;
//! `writing_topics` adds the rich writing-only fields. This prevents the old
//! settings-KV topic bank from becoming a second source of truth.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{
    ImportWritingTopicsCommand, ListWritingTopicsQuery, UpsertWritingTopicCommand,
    WritingTopicCount, WritingTopicDto, WritingTopicImportReport, WritingTopicPage,
    WritingTopicStatistics,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

const LEGACY_MIGRATION_KEY: &str = "writing_topics.settings_v1_imported";
const LEGACY_TOPICS_NAMESPACE: &str = "topics";
const MAX_TOPIC_ID_LEN: usize = 160;
const MAX_CATEGORY_LEN: usize = 120;
const MAX_TITLE_JSON_LEN: usize = 64 * 1024;
const MAX_IMPORT_TOPICS: usize = 500;
const MAX_TOPIC_IMAGE_BYTES: usize = 5 * 1024 * 1024;

/// Outcome of indexing the immutable writing catalog shipped with the app.
/// `preserved` means a user-owned record already claimed the catalog id, so
/// startup deliberately left it intact instead of treating it as a catalog
/// update.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltinWritingCatalogSeedReport {
    pub declared: usize,
    pub created: u32,
    pub updated: u32,
    pub unchanged: u32,
    pub preserved: u32,
}

#[derive(Debug, Deserialize)]
struct BuiltinWritingCatalog {
    topics: Vec<BuiltinWritingCatalogTopic>,
}

#[derive(Debug, Deserialize)]
struct BuiltinWritingCatalogTopic {
    #[serde(alias = "sourceId")]
    source_id: String,
    #[serde(rename = "type", alias = "taskType", alias = "task_type")]
    task_type: String,
    prompt: String,
    category: String,
    difficulty: u8,
}

#[derive(Debug)]
struct RawTopic {
    id: String,
    task_type: String,
    category: String,
    difficulty: String,
    title_json: String,
    image_path: Option<String>,
    is_official: i64,
    usage_count: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Copy)]
enum TopicSource {
    User,
    Import,
    LegacySettings,
}

impl TopicSource {
    fn asset_source_kind(self, is_official: bool) -> &'static str {
        if is_official {
            "builtin"
        } else {
            match self {
                Self::User => "freeform",
                Self::Import | Self::LegacySettings => "imported",
            }
        }
    }
}

/// Lazily import old UI-owned settings records. The marker is a digest of the
/// source rows, not a one-way boolean: a restored old backup or a previously
/// malformed row must get another chance, while an unchanged source never
/// overwrites the first-class projection.
pub fn ensure_legacy_writing_topics_imported(conn: &Connection) -> DbResult<()> {
    let previous_marker: Option<String> = conn
        .query_row(
            "SELECT value FROM migration_meta WHERE key = ?1",
            params![LEGACY_MIGRATION_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let mut stmt =
        conn.prepare("SELECT key, value_json FROM settings WHERE namespace = ?1 ORDER BY key ASC")?;
    let legacy_rows = stmt
        .query_map(params![LEGACY_TOPICS_NAMESPACE], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    if legacy_rows.is_empty() {
        return Ok(());
    }
    let source_digest = legacy_settings_digest(&legacy_rows);
    if previous_marker
        .as_deref()
        .is_some_and(|marker| legacy_marker_is_current(marker, &source_digest))
    {
        return Ok(());
    }
    // The first checkpoint used an `{ imported, skipped }` marker with random
    // fallback IDs. Replaying it in-place would duplicate user topics. A v2
    // backup restore explicitly clears that marker before this function runs.
    if previous_marker
        .as_deref()
        .is_some_and(legacy_marker_is_pre_digest)
    {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    let mut imported = 0u32;
    let mut skipped = 0u32;
    for (key, raw_json) in legacy_rows {
        let Ok(value) = serde_json::from_str::<Value>(&raw_json) else {
            skipped += 1;
            continue;
        };
        for (fallback_id, candidate) in legacy_topic_candidates(&key, value) {
            let Some(command) = legacy_topic_command(fallback_id.as_deref(), &candidate) else {
                skipped += 1;
                continue;
            };
            let id = command.id.as_deref().unwrap_or_default();
            if topic_exists(&tx, id)? {
                // A post-migration topic is newer truth than the legacy shadow.
                continue;
            }
            match upsert_writing_topic_inner(&tx, &command, TopicSource::LegacySettings) {
                Ok((_, true)) => imported += 1,
                Ok((_, false)) => {}
                Err(_) => skipped += 1,
            }
        }
    }

    let marker = json!({
        "version": 2,
        "sourceDigest": source_digest,
        "imported": imported,
        "skipped": skipped,
    })
    .to_string();
    tx.execute(
        "INSERT INTO migration_meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![LEGACY_MIGRATION_KEY, marker],
    )?;
    tx.commit()?;
    Ok(())
}

/// A schema-v2 backup predates `writing_topics`, so its restored settings need
/// to seed the new projection again. This is intentionally narrow: a schema-v3
/// restore already contains canonical topic rows and must not replay settings.
pub fn reset_legacy_writing_topics_import_marker(conn: &Connection) -> DbResult<()> {
    conn.execute(
        "DELETE FROM migration_meta WHERE key = ?1",
        params![LEGACY_MIGRATION_KEY],
    )?;
    Ok(())
}

/// Index the official catalog bundled with the desktop application.
///
/// The catalog is immutable application data, while `writing_topics` is the
/// SQLite projection used by every product path.  We deliberately preserve a
/// non-official record that already owns a catalog id: a seed must never turn
/// a user/imported topic into an official one merely because an identifier
/// collides.
pub fn seed_builtin_writing_catalog(
    conn: &Connection,
    catalog_path: &Path,
) -> DbResult<BuiltinWritingCatalogSeedReport> {
    let raw = fs::read_to_string(catalog_path)?;
    let catalog: BuiltinWritingCatalog = serde_json::from_str(&raw)
        .map_err(|error| DbError::Validation(format!("writing catalog: {error}")))?;
    if catalog.topics.is_empty() {
        return Err(DbError::Validation(
            "writing catalog must contain at least one topic".into(),
        ));
    }
    if catalog.topics.len() > MAX_IMPORT_TOPICS {
        return Err(DbError::Validation(format!(
            "writing catalog contains more than {MAX_IMPORT_TOPICS} topics"
        )));
    }

    let mut ids = HashSet::new();
    let mut commands = Vec::with_capacity(catalog.topics.len());
    for topic in catalog.topics {
        let command = builtin_catalog_command(topic)?;
        let id = command
            .id
            .as_deref()
            .expect("builtin catalog IDs are required");
        if !ids.insert(id.to_string()) {
            return Err(DbError::Validation(format!(
                "duplicate writing catalog topic id: {id}"
            )));
        }
        commands.push(command);
    }

    // A pre-Rust UI may still have an old settings projection. Import it first
    // so a user-owned collision is visible and can be preserved below.
    ensure_legacy_writing_topics_imported(conn)?;

    let tx = conn.unchecked_transaction()?;
    let mut report = BuiltinWritingCatalogSeedReport {
        declared: commands.len(),
        created: 0,
        updated: 0,
        unchanged: 0,
        preserved: 0,
    };
    for command in &commands {
        match builtin_catalog_seed_action(&tx, command)? {
            BuiltinCatalogSeedAction::Create => {
                upsert_writing_topic_inner(&tx, command, TopicSource::Import)?;
                report.created += 1;
            }
            BuiltinCatalogSeedAction::Update => {
                upsert_writing_topic_inner(&tx, command, TopicSource::Import)?;
                report.updated += 1;
            }
            BuiltinCatalogSeedAction::Unchanged => report.unchanged += 1,
            BuiltinCatalogSeedAction::Preserve => report.preserved += 1,
        }
    }
    tx.commit()?;
    Ok(report)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BuiltinCatalogSeedAction {
    Create,
    Update,
    Unchanged,
    Preserve,
}

fn builtin_catalog_command(raw: BuiltinWritingCatalogTopic) -> DbResult<UpsertWritingTopicCommand> {
    let id = validate_topic_id(&raw.source_id)?;
    let task_type = WritingTaskType::parse_loose(&raw.task_type).ok_or_else(|| {
        DbError::Validation(format!(
            "writing catalog topic {id} has invalid task type: {}",
            raw.task_type
        ))
    })?;
    let command = UpsertWritingTopicCommand {
        id: Some(id),
        task_type,
        category: raw.category,
        difficulty: raw.difficulty,
        title_json: raw.prompt,
        image_path: None,
        is_official: Some(true),
    };
    validate_writing_topic_command(&command)?;
    Ok(command)
}

fn builtin_catalog_seed_action(
    conn: &Connection,
    command: &UpsertWritingTopicCommand,
) -> DbResult<BuiltinCatalogSeedAction> {
    let id = command
        .id
        .as_deref()
        .ok_or_else(|| DbError::Message("builtin writing topic is missing an id".into()))?;
    let normalized = normalize_writing_topic_command(command)?;
    let expected_fingerprint = topic_fingerprint(
        task_type_name(command.task_type),
        &normalized.category,
        normalized.difficulty,
        &normalized.title_json,
        normalized.image_path.as_deref(),
        true,
    );
    let existing: Option<(String, Option<i64>, String)> = conn
        .query_row(
            "SELECT pa.activity, wt.is_official, pa.fingerprint
             FROM practice_assets pa
             LEFT JOIN writing_topics wt ON wt.asset_id = pa.id
             WHERE pa.id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((activity, official, fingerprint)) = existing else {
        return Ok(BuiltinCatalogSeedAction::Create);
    };

    if activity != "writing" || official != Some(1) {
        return Ok(BuiltinCatalogSeedAction::Preserve);
    }
    if fingerprint == expected_fingerprint {
        Ok(BuiltinCatalogSeedAction::Unchanged)
    } else {
        Ok(BuiltinCatalogSeedAction::Update)
    }
}

pub fn list_writing_topics(
    conn: &Connection,
    query: &ListWritingTopicsQuery,
) -> DbResult<WritingTopicPage> {
    ensure_legacy_writing_topics_imported(conn)?;

    let limit = query.limit.clamp(1, MAX_IMPORT_TOPICS as u32);
    let offset = query.offset;
    let task_type = query.task_type.map(task_type_name);
    let category = normalized_optional_text(query.category.as_deref());
    let difficulty = query
        .difficulty
        .filter(|value| (1..=5).contains(value))
        .map(i64::from);
    let search = normalized_optional_text(query.search.as_deref());

    let total: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM writing_topics wt
         JOIN practice_assets pa ON pa.id = wt.asset_id
         WHERE pa.activity = 'writing'
           AND (?1 IS NULL OR wt.task_type = ?1)
           AND (?2 IS NULL OR pa.category = ?2)
           AND (?3 IS NULL OR CAST(pa.difficulty AS INTEGER) = ?3)
           AND (
             ?4 IS NULL
             OR lower(pa.title) LIKE '%' || lower(?4) || '%'
             OR lower(wt.title_json) LIKE '%' || lower(?4) || '%'
           )",
        params![
            task_type,
            category.as_deref(),
            difficulty,
            search.as_deref()
        ],
        |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT
            wt.asset_id, wt.task_type, COALESCE(pa.category, ''), COALESCE(pa.difficulty, ''),
            wt.title_json, wt.image_path, wt.is_official,
            COUNT(at.id), pa.created_at, pa.updated_at
         FROM writing_topics wt
         JOIN practice_assets pa ON pa.id = wt.asset_id
         LEFT JOIN attempts at ON at.asset_id = wt.asset_id AND at.activity = 'writing'
         WHERE pa.activity = 'writing'
           AND (?1 IS NULL OR wt.task_type = ?1)
           AND (?2 IS NULL OR pa.category = ?2)
           AND (?3 IS NULL OR CAST(pa.difficulty AS INTEGER) = ?3)
           AND (
             ?4 IS NULL
             OR lower(pa.title) LIKE '%' || lower(?4) || '%'
             OR lower(wt.title_json) LIKE '%' || lower(?4) || '%'
           )
         GROUP BY wt.asset_id
         ORDER BY pa.updated_at DESC, wt.asset_id ASC
         LIMIT ?5 OFFSET ?6",
    )?;
    let rows = stmt.query_map(
        params![
            task_type,
            category.as_deref(),
            difficulty,
            search.as_deref(),
            i64::from(limit),
            i64::from(offset),
        ],
        raw_topic_from_row,
    )?;
    let mut items = Vec::new();
    for row in rows {
        items.push(raw_topic_into_dto(row?)?);
    }

    Ok(WritingTopicPage {
        items,
        total: total.clamp(0, i64::from(u32::MAX)) as u32,
        limit,
        offset,
    })
}

pub fn get_writing_topic(conn: &Connection, id: &str) -> DbResult<Option<WritingTopicDto>> {
    ensure_legacy_writing_topics_imported(conn)?;
    load_writing_topic(conn, id)
}

pub fn upsert_writing_topic(
    conn: &Connection,
    command: &UpsertWritingTopicCommand,
) -> DbResult<WritingTopicDto> {
    ensure_legacy_writing_topics_imported(conn)?;
    let tx = conn.unchecked_transaction()?;
    let (topic, _) = upsert_writing_topic_inner(&tx, command, TopicSource::User)?;
    tx.commit()?;
    Ok(topic)
}

pub fn import_writing_topics(
    conn: &Connection,
    command: &ImportWritingTopicsCommand,
) -> DbResult<WritingTopicImportReport> {
    ensure_legacy_writing_topics_imported(conn)?;
    if command.topics.len() > MAX_IMPORT_TOPICS {
        return Err(DbError::Validation(format!(
            "at most {MAX_IMPORT_TOPICS} writing topics may be imported at once"
        )));
    }

    // Validate the complete input before opening the mutation transaction so a
    // malformed row cannot leave the user with a half-imported topic bank.
    let mut supplied_ids = HashSet::new();
    for topic in &command.topics {
        validate_writing_topic_command(topic)?;
        if let Some(id) = topic.id.as_deref() {
            let id = validate_topic_id(id)?;
            if !supplied_ids.insert(id.clone()) {
                return Err(DbError::Validation(format!("duplicate topic id: {id}")));
            }
        }
    }

    let tx = conn.unchecked_transaction()?;
    let mut report = WritingTopicImportReport {
        created: 0,
        updated: 0,
    };
    for topic in &command.topics {
        let (_, created) = upsert_writing_topic_inner(&tx, topic, TopicSource::Import)?;
        if created {
            report.created += 1;
        } else {
            report.updated += 1;
        }
    }
    tx.commit()?;
    Ok(report)
}

pub fn delete_writing_topic(conn: &Connection, id: &str) -> DbResult<bool> {
    ensure_legacy_writing_topics_imported(conn)?;
    let id = validate_topic_id(id)?;
    let tx = conn.unchecked_transaction()?;
    let is_official: Option<i64> = tx
        .query_row(
            "SELECT is_official FROM writing_topics WHERE asset_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(is_official) = is_official else {
        tx.commit()?;
        return Ok(false);
    };
    if is_official != 0 {
        return Err(DbError::Validation(
            "official writing topics cannot be deleted".into(),
        ));
    }

    // Keep the generic asset row so existing attempts retain their stable
    // asset_id and historical links. Only the topic-bank projection disappears.
    let deleted = tx.execute(
        "DELETE FROM writing_topics WHERE asset_id = ?1",
        params![id],
    )?;
    tx.commit()?;
    Ok(deleted > 0)
}

pub fn writing_topic_statistics(conn: &Connection) -> DbResult<WritingTopicStatistics> {
    ensure_legacy_writing_topics_imported(conn)?;
    let mut task1 = 0u32;
    let mut task2 = 0u32;
    let mut stmt = conn.prepare(
        "SELECT task_type, COUNT(*)
         FROM writing_topics
         GROUP BY task_type",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (task_type, count) = row?;
        let count = count.clamp(0, i64::from(u32::MAX)) as u32;
        match task_type.as_str() {
            "task1" => task1 = count,
            "task2" => task2 = count,
            _ => {}
        }
    }

    Ok(WritingTopicStatistics {
        total: task1.saturating_add(task2),
        by_task_type: vec![
            WritingTopicCount {
                task_type: WritingTaskType::Task1,
                count: task1,
            },
            WritingTopicCount {
                task_type: WritingTaskType::Task2,
                count: task2,
            },
        ],
    })
}

fn upsert_writing_topic_inner(
    conn: &Connection,
    command: &UpsertWritingTopicCommand,
    source: TopicSource,
) -> DbResult<(WritingTopicDto, bool)> {
    let id = resolve_topic_id(command.id.as_deref())?;
    let normalized = normalize_writing_topic_command(command)?;
    let existing_asset: Option<(String, String, Option<String>, String)> = conn
        .query_row(
            "SELECT activity, source_kind, source_key, fingerprint
             FROM practice_assets WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    if existing_asset
        .as_ref()
        .is_some_and(|asset| asset.0 != "writing")
    {
        return Err(DbError::Validation(format!(
            "writing topic id collides with non-writing asset: {id}"
        )));
    }

    let existing_official: Option<i64> = conn
        .query_row(
            "SELECT is_official FROM writing_topics WHERE asset_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    if existing_asset.is_some()
        && existing_official.is_none()
        && !existing_asset.as_ref().is_some_and(|asset| {
            is_legacy_writing_stub(&id, &asset.1, asset.2.as_deref(), &asset.3)
        })
    {
        return Err(DbError::Validation(format!(
            "writing topic id collides with an existing writing asset: {id}"
        )));
    }
    let created = existing_official.is_none();
    let is_official = command
        .is_official
        .unwrap_or_else(|| existing_official.unwrap_or(0) != 0);
    let now = chrono::Utc::now().to_rfc3339();
    let task_type = task_type_name(command.task_type);
    let metadata_json = json!({ "kind": "writing_topic", "taskType": task_type }).to_string();
    let fingerprint = topic_fingerprint(
        task_type,
        &normalized.category,
        normalized.difficulty,
        &normalized.title_json,
        normalized.image_path.as_deref(),
        is_official,
    );

    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, category, difficulty, frequency,
            content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
         ) VALUES (
            ?1, 'writing', ?2, ?3, ?4, ?5, ?6, NULL,
            NULL, 2, ?7, 0, ?8, ?9, ?9
         )
         ON CONFLICT(id) DO UPDATE SET
            activity = 'writing',
            source_kind = excluded.source_kind,
            source_key = excluded.source_key,
            title = excluded.title,
            category = excluded.category,
            difficulty = excluded.difficulty,
            frequency = NULL,
            content_ref = NULL,
            schema_version = excluded.schema_version,
            fingerprint = excluded.fingerprint,
            pdf_only = 0,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at",
        params![
            id,
            source.asset_source_kind(is_official),
            format!("writing-topic:{id}"),
            normalized.title_text,
            normalized.category,
            normalized.difficulty.to_string(),
            fingerprint,
            metadata_json,
            now,
        ],
    )?;
    conn.execute(
        "INSERT INTO writing_topics (
            asset_id, task_type, title_json, image_path, is_official, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(asset_id) DO UPDATE SET
            task_type = excluded.task_type,
            title_json = excluded.title_json,
            image_path = excluded.image_path,
            is_official = excluded.is_official,
            updated_at = excluded.updated_at",
        params![
            id,
            task_type,
            normalized.title_json,
            normalized.image_path,
            if is_official { 1 } else { 0 },
            now,
        ],
    )?;

    let topic = load_writing_topic(conn, &id)?.ok_or_else(|| {
        DbError::Message(format!("writing topic disappeared during upsert: {id}"))
    })?;
    Ok((topic, created))
}

#[derive(Debug)]
struct NormalizedTopicInput {
    category: String,
    difficulty: u8,
    title_json: String,
    title_text: String,
    image_path: Option<String>,
}

fn validate_writing_topic_command(command: &UpsertWritingTopicCommand) -> DbResult<()> {
    if let Some(id) = command.id.as_deref() {
        validate_topic_id(id)?;
    }
    normalize_writing_topic_command(command)?;
    Ok(())
}

fn normalize_writing_topic_command(
    command: &UpsertWritingTopicCommand,
) -> DbResult<NormalizedTopicInput> {
    let category = command.category.trim();
    if category.is_empty() || category.chars().count() > MAX_CATEGORY_LEN {
        return Err(DbError::Validation(format!(
            "writing topic category must contain 1..={MAX_CATEGORY_LEN} characters"
        )));
    }
    if !(1..=5).contains(&command.difficulty) {
        return Err(DbError::Validation(
            "writing topic difficulty must be between 1 and 5".into(),
        ));
    }
    let (title_json, title_text) = normalize_title_json(&command.title_json)?;
    Ok(NormalizedTopicInput {
        category: category.to_string(),
        difficulty: command.difficulty,
        title_json,
        title_text,
        image_path: normalize_topic_image_path(command.image_path.as_deref())?,
    })
}

fn normalize_topic_image_path(value: Option<&str>) -> DbResult<Option<String>> {
    let Some(value) = normalized_optional_text(value) else {
        return Ok(None);
    };
    if !value.starts_with("data:") {
        // Preserve historical opaque paths during migration. Shipping UI only
        // renders validated data URLs, so an old local path cannot regain a
        // file:// capability through this field.
        return Ok(Some(value));
    }
    let (header, payload) = value
        .split_once(',')
        .ok_or_else(|| DbError::Validation("topic image data URL is missing its payload".into()))?;
    if !matches!(
        header,
        "data:image/png;base64"
            | "data:image/jpeg;base64"
            | "data:image/jpg;base64"
            | "data:image/webp;base64"
    ) {
        return Err(DbError::Validation(
            "topic image must be a PNG, JPEG, or WebP data URL".into(),
        ));
    }
    let bytes = STANDARD
        .decode(payload)
        .map_err(|_| DbError::Validation("topic image data URL contains invalid base64".into()))?;
    if bytes.is_empty() || bytes.len() > MAX_TOPIC_IMAGE_BYTES {
        return Err(DbError::Validation(format!(
            "topic image must contain 1..={MAX_TOPIC_IMAGE_BYTES} bytes"
        )));
    }
    Ok(Some(value))
}

fn load_writing_topic(conn: &Connection, id: &str) -> DbResult<Option<WritingTopicDto>> {
    let raw = conn
        .query_row(
            "SELECT
                wt.asset_id, wt.task_type, COALESCE(pa.category, ''), COALESCE(pa.difficulty, ''),
                wt.title_json, wt.image_path, wt.is_official,
                COUNT(at.id), pa.created_at, pa.updated_at
             FROM writing_topics wt
             JOIN practice_assets pa ON pa.id = wt.asset_id
             LEFT JOIN attempts at ON at.asset_id = wt.asset_id AND at.activity = 'writing'
             WHERE wt.asset_id = ?1 AND pa.activity = 'writing'
             GROUP BY wt.asset_id",
            params![id],
            raw_topic_from_row,
        )
        .optional()?;
    raw.map(raw_topic_into_dto).transpose()
}

fn raw_topic_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawTopic> {
    Ok(RawTopic {
        id: row.get(0)?,
        task_type: row.get(1)?,
        category: row.get(2)?,
        difficulty: row.get(3)?,
        title_json: row.get(4)?,
        image_path: row.get(5)?,
        is_official: row.get(6)?,
        usage_count: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn raw_topic_into_dto(raw: RawTopic) -> DbResult<WritingTopicDto> {
    let task_type = WritingTaskType::parse_loose(&raw.task_type).ok_or_else(|| {
        DbError::Validation(format!(
            "stored writing topic has invalid task type: {}",
            raw.id
        ))
    })?;
    let difficulty = raw
        .difficulty
        .parse::<u8>()
        .ok()
        .filter(|value| (1..=5).contains(value))
        .ok_or_else(|| {
            DbError::Validation(format!(
                "stored writing topic has invalid difficulty: {}",
                raw.id
            ))
        })?;
    Ok(WritingTopicDto {
        id: raw.id,
        task_type,
        category: raw.category,
        difficulty,
        title_json: raw.title_json,
        image_path: raw.image_path,
        is_official: raw.is_official != 0,
        usage_count: raw.usage_count.clamp(0, i64::from(u32::MAX)) as u32,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    })
}

fn topic_exists(conn: &Connection, id: &str) -> DbResult<bool> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM writing_topics WHERE asset_id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(exists.is_some())
}

fn resolve_topic_id(id: Option<&str>) -> DbResult<String> {
    match id {
        Some(id) => validate_topic_id(id),
        None => Ok(format!("topic-{}", Uuid::new_v4())),
    }
}

fn is_legacy_writing_stub(
    id: &str,
    source_kind: &str,
    source_key: Option<&str>,
    fingerprint: &str,
) -> bool {
    source_kind == "imported"
        && id.starts_with("topic-")
        && source_key == Some(id)
        && fingerprint == format!("import:{id}")
}

fn validate_topic_id(id: &str) -> DbResult<String> {
    let id = id.trim();
    if id.is_empty() || id.chars().count() > MAX_TOPIC_ID_LEN {
        return Err(DbError::Validation(format!(
            "writing topic id must contain 1..={MAX_TOPIC_ID_LEN} characters"
        )));
    }
    if id.chars().any(|ch| ch.is_control()) {
        return Err(DbError::Validation(
            "writing topic id cannot contain control characters".into(),
        ));
    }
    Ok(id.to_string())
}

fn task_type_name(value: WritingTaskType) -> &'static str {
    match value {
        WritingTaskType::Task1 => "task1",
        WritingTaskType::Task2 => "task2",
    }
}

fn normalized_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn topic_fingerprint(
    task_type: &str,
    category: &str,
    difficulty: u8,
    title_json: &str,
    image_path: Option<&str>,
    is_official: bool,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        task_type,
        category,
        &difficulty.to_string(),
        title_json,
        image_path.unwrap_or_default(),
        if is_official { "1" } else { "0" },
    ] {
        hasher.update(value.as_bytes());
        hasher.update([0]);
    }
    hex::encode(hasher.finalize())
}

fn normalize_title_json(raw: &str) -> DbResult<(String, String)> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > MAX_TITLE_JSON_LEN {
        return Err(DbError::Validation(format!(
            "writing topic title must contain 1..={MAX_TITLE_JSON_LEN} bytes"
        )));
    }
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        let text = extract_text_from_json(&value).trim().to_string();
        if text.is_empty() {
            return Err(DbError::Validation(
                "writing topic title must contain visible text".into(),
            ));
        }
        return Ok((
            serde_json::to_string(&value).map_err(|error| DbError::Message(error.to_string()))?,
            text,
        ));
    }

    let text = raw.to_string();
    let title_json = json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{ "type": "text", "text": text }]
        }]
    });
    Ok((
        serde_json::to_string(&title_json).map_err(|error| DbError::Message(error.to_string()))?,
        raw.to_string(),
    ))
}

pub(crate) fn extract_text_from_json(value: &Value) -> String {
    match value {
        Value::String(value) => value.to_string(),
        Value::Array(values) => values
            .iter()
            .map(extract_text_from_json)
            .collect::<Vec<_>>()
            .join(""),
        Value::Object(values) => {
            let own_text = values
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let child_text = values
                .get("content")
                .map(extract_text_from_json)
                .unwrap_or_default();
            format!("{own_text}{child_text}")
        }
        _ => String::new(),
    }
}

fn legacy_topic_candidates(key: &str, value: Value) -> Vec<(Option<String>, Value)> {
    let value = match value {
        Value::String(raw) => serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw)),
        other => other,
    };
    match value {
        Value::Array(values) => values
            .into_iter()
            .enumerate()
            .map(|(index, value)| (Some(legacy_fallback_id(key, index, &value)), value))
            .collect(),
        Value::Object(mut object) if object.get("topics").is_some_and(Value::is_array) => object
            .remove("topics")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .map(|(index, value)| (Some(legacy_fallback_id(key, index, &value)), value))
            .collect(),
        other => vec![(Some(key.to_string()), other)],
    }
}

fn legacy_topic_command(
    fallback_id: Option<&str>,
    value: &Value,
) -> Option<UpsertWritingTopicCommand> {
    let object = value.as_object()?;
    let id = object
        .get("id")
        .or_else(|| object.get("source_id"))
        .or_else(|| object.get("sourceId"))
        .and_then(value_text)
        .or_else(|| fallback_id.map(str::to_string))?;
    let task_type = ["type", "task_type", "taskType"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_text))
        .and_then(|value| WritingTaskType::parse_loose(&value))?;
    let title_raw = ["title_json", "titleJson", "title", "prompt"]
        .iter()
        .find_map(|key| object.get(*key).map(value_to_title_raw))?;
    let category = ["category", "topic", "topicType"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_text))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "uncategorized".into());
    let difficulty = object
        .get("difficulty")
        .and_then(value_to_u8)
        .filter(|value| (1..=5).contains(value))
        .unwrap_or(3);
    let image_path = ["image_path", "imagePath"]
        .iter()
        .find_map(|key| object.get(*key).and_then(value_text));
    let is_official = ["is_official", "isOfficial"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_bool));
    Some(UpsertWritingTopicCommand {
        id: Some(id),
        task_type,
        category,
        difficulty,
        title_json: title_raw,
        image_path,
        is_official,
    })
}

fn legacy_fallback_id(key: &str, index: usize, value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update([0]);
    hasher.update(index.to_string().as_bytes());
    hasher.update([0]);
    hasher.update(serde_json::to_vec(value).unwrap_or_default());
    let digest = hex::encode(hasher.finalize());
    format!("legacy-topic-{}", &digest[..24])
}

fn legacy_settings_digest(rows: &[(String, String)]) -> String {
    let mut hasher = Sha256::new();
    for (key, value) in rows {
        hasher.update(key.as_bytes());
        hasher.update([0]);
        hasher.update(value.as_bytes());
        hasher.update([0]);
    }
    hex::encode(hasher.finalize())
}

fn legacy_marker_is_current(marker: &str, source_digest: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(marker) else {
        return false;
    };
    value.get("version").and_then(Value::as_u64) == Some(2)
        && value
            .get("sourceDigest")
            .and_then(Value::as_str)
            .is_some_and(|digest| digest == source_digest)
        && value.get("skipped").and_then(Value::as_u64) == Some(0)
}

fn legacy_marker_is_pre_digest(marker: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(marker) else {
        return false;
    };
    value.get("imported").is_some()
        && value.get("sourceDigest").is_none()
        && value.get("version").is_none()
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.trim().to_string()).filter(|value| !value.is_empty()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_to_title_raw(value: &Value) -> String {
    match value {
        Value::String(value) => value.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn value_to_u8(value: &Value) -> Option<u8> {
    value
        .as_u64()
        .and_then(|value| u8::try_from(value).ok())
        .or_else(|| value.as_str().and_then(|value| value.trim().parse().ok()))
}
