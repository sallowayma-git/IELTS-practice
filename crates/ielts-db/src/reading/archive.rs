//! Canonical Reading history archive snapshot/import.
//!
//! This is a product path, not a browser compatibility shim: SQLite owns the
//! snapshot and import is validate-then-commit. Legacy browser archives are
//! accepted only at the conversion boundary.

use std::collections::HashSet;

use chrono::Utc;
use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus};
use ielts_domain::dto::AttemptRecord;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::attempts::{ensure_asset_stub, upsert_attempt};
use crate::history::load_attempt;
use crate::import::convert::reading_submission_to_attempt;
use crate::sqlite::DbResult;

/// The first archive schema that is a direct serialization of the canonical
/// persisted Reading attempt shape. The top-level `submissions` key remains
/// intentionally stable for existing downloaded files and Library backup UI.
pub const READING_ARCHIVE_SCHEMA_VERSION: &str = "practice-history-archive.v2";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingArchiveSnapshot {
    pub activity: String,
    pub schema_version: String,
    pub exported_at: String,
    pub count: usize,
    pub submissions: Vec<AttemptRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingArchiveReportEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_index: Option<usize>,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingArchiveImportResult {
    /// Number of records durably committed. It is always zero after a failed
    /// validation or rolled-back transaction.
    pub imported: usize,
    /// Number of source records not imported. It is never paired with a
    /// partial durable write.
    pub failed: usize,
    /// Machine-readable failure context for UI and diagnostics.
    pub report: Vec<ReadingArchiveReportEntry>,
    pub attempt_ids: Vec<String>,
    pub committed: bool,
}

impl ReadingArchiveImportResult {
    fn rejected(failed: usize, report: Vec<ReadingArchiveReportEntry>) -> Self {
        Self {
            imported: 0,
            failed,
            report,
            attempt_ids: Vec::new(),
            committed: false,
        }
    }
}

/// Export all finished, non-memorize Reading attempts from one SQLite read
/// transaction. The result is a portable canonical snapshot, not a frontend
/// reconstruction from history cards.
pub fn export_reading_archive(conn: &Connection) -> DbResult<ReadingArchiveSnapshot> {
    let tx = conn.unchecked_transaction()?;
    let ids = {
        let mut stmt = tx.prepare(
            "SELECT id
             FROM attempts
             WHERE activity = 'reading'
               AND mode != 'memorize'
               AND lower(status) NOT IN ('draft', 'active')
             ORDER BY COALESCE(submitted_at, started_at) DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        ids
    };

    let mut submissions = Vec::with_capacity(ids.len());
    for id in ids {
        submissions.push(load_attempt(&tx, &id)?);
    }
    drop(tx);

    Ok(ReadingArchiveSnapshot {
        activity: "reading".into(),
        schema_version: READING_ARCHIVE_SCHEMA_VERSION.into(),
        exported_at: Utc::now().to_rfc3339(),
        count: submissions.len(),
        submissions,
    })
}

/// Validate all source records first, then write every normalized attempt in
/// one transaction. A malformed record or write conflict produces a report
/// and leaves the database unchanged.
pub fn import_reading_archive_value(
    conn: &Connection,
    doc: &Value,
) -> DbResult<ReadingArchiveImportResult> {
    let attempts = match validate_archive(conn, doc) {
        Ok(attempts) => attempts,
        Err(result) => return Ok(result),
    };

    let attempt_ids = attempts.iter().map(|attempt| attempt.id.clone()).collect();
    let tx = conn.unchecked_transaction()?;
    for attempt in &attempts {
        if let Err(error) = import_attempt(&tx, attempt) {
            drop(tx);
            return Ok(ReadingArchiveImportResult::rejected(
                attempts.len(),
                vec![report_entry(
                    None,
                    "transaction_rolled_back",
                    format!("导入已回滚：{error}"),
                )],
            ));
        }
    }
    if let Err(error) = tx.commit() {
        return Ok(ReadingArchiveImportResult::rejected(
            attempts.len(),
            vec![report_entry(
                None,
                "transaction_commit_failed",
                format!("导入未提交：{error}"),
            )],
        ));
    }

    Ok(ReadingArchiveImportResult {
        imported: attempts.len(),
        failed: 0,
        report: Vec::new(),
        attempt_ids,
        committed: true,
    })
}

fn validate_archive(
    conn: &Connection,
    doc: &Value,
) -> Result<Vec<AttemptRecord>, ReadingArchiveImportResult> {
    let Some(root) = doc.as_object() else {
        return Err(ReadingArchiveImportResult::rejected(
            1,
            vec![report_entry(
                None,
                "archive_not_object",
                "归档根节点必须是对象",
            )],
        ));
    };
    let Some(records) = root
        .get("submissions")
        .or_else(|| root.get("records"))
        .and_then(Value::as_array)
    else {
        return Err(ReadingArchiveImportResult::rejected(
            1,
            vec![report_entry(
                None,
                "archive_missing_records",
                "阅读归档缺少 submissions[] 或 records[]",
            )],
        ));
    };

    let schema_version = root.get("schemaVersion");
    let canonical = schema_version
        .and_then(Value::as_str)
        .is_some_and(|version| version == READING_ARCHIVE_SCHEMA_VERSION);
    if !canonical && !is_supported_legacy_schema(schema_version) {
        return Err(ReadingArchiveImportResult::rejected(
            records.len(),
            vec![report_entry(
                None,
                "archive_schema_unsupported",
                "不支持的阅读归档 schemaVersion",
            )],
        ));
    }
    let mut report = Vec::new();

    if canonical {
        validate_canonical_header(root, records.len(), &mut report);
    }

    let mut attempts = Vec::with_capacity(records.len());
    let mut seen_ids = HashSet::new();
    let mut seen_annotation_ids = HashSet::new();
    for (index, raw) in records.iter().enumerate() {
        let converted = if canonical {
            serde_json::from_value::<AttemptRecord>(raw.clone())
                .map_err(|error| format!("规范记录格式无效：{error}"))
        } else {
            reading_submission_to_attempt(raw).map_err(|error| error.to_string())
        };
        let mut attempt = match converted {
            Ok(attempt) => attempt,
            Err(message) => {
                report.push(report_entry(Some(index), "record_invalid", message));
                continue;
            }
        };
        validate_attempt(
            index,
            &mut attempt,
            &mut seen_ids,
            &mut seen_annotation_ids,
            &mut report,
        );
        attempts.push(attempt);
    }

    if report.is_empty() {
        if let Err(error) = validate_existing_annotation_ownership(conn, &attempts, &mut report) {
            report.push(report_entry(
                None,
                "archive_validation_failed",
                format!("归档关联校验失败：{error}"),
            ));
        }
    }

    if report.is_empty() {
        Ok(attempts)
    } else {
        let has_global_error = report.iter().any(|entry| entry.record_index.is_none());
        let failed = if has_global_error {
            records.len()
        } else {
            report
                .iter()
                .filter_map(|entry| entry.record_index)
                .collect::<HashSet<_>>()
                .len()
        };
        Err(ReadingArchiveImportResult::rejected(failed, report))
    }
}

fn is_supported_legacy_schema(value: Option<&Value>) -> bool {
    match value {
        None => true,
        Some(Value::Number(number)) => number.as_u64() == Some(1),
        Some(Value::String(version)) => version == "practice-history-archive.v1",
        _ => false,
    }
}

fn validate_canonical_header(
    root: &serde_json::Map<String, Value>,
    actual_count: usize,
    report: &mut Vec<ReadingArchiveReportEntry>,
) {
    if root.get("activity").and_then(Value::as_str) != Some("reading") {
        report.push(report_entry(
            None,
            "archive_activity_invalid",
            "规范阅读归档的 activity 必须为 reading",
        ));
    }
    match root.get("count").and_then(Value::as_u64) {
        Some(count) if count == actual_count as u64 => {}
        Some(_) => report.push(report_entry(
            None,
            "archive_count_mismatch",
            "归档 count 与 submissions[] 数量不一致",
        )),
        None => report.push(report_entry(
            None,
            "archive_count_missing",
            "规范阅读归档必须提供整数 count",
        )),
    }
    if root
        .get("exportedAt")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .is_none()
    {
        report.push(report_entry(
            None,
            "archive_exported_at_missing",
            "规范阅读归档必须提供 exportedAt",
        ));
    }
}

fn validate_attempt(
    index: usize,
    attempt: &mut AttemptRecord,
    seen_ids: &mut HashSet<String>,
    seen_annotation_ids: &mut HashSet<String>,
    report: &mut Vec<ReadingArchiveReportEntry>,
) {
    if attempt.schema_version != AttemptRecord::SCHEMA_VERSION {
        report.push(report_entry(
            Some(index),
            "record_schema_unsupported",
            format!("不支持的记录 schemaVersion: {}", attempt.schema_version),
        ));
    }
    if attempt.activity != Activity::Reading {
        report.push(report_entry(
            Some(index),
            "record_activity_invalid",
            "阅读归档中不能包含非阅读记录",
        ));
    }
    if attempt.id.trim().is_empty() || attempt.id == "unknown-attempt" {
        report.push(report_entry(
            Some(index),
            "record_id_invalid",
            "记录缺少稳定 id",
        ));
    } else if !seen_ids.insert(attempt.id.clone()) {
        report.push(report_entry(
            Some(index),
            "record_id_duplicate",
            format!("归档中存在重复记录 id: {}", attempt.id),
        ));
    }
    if attempt.started_at.trim().is_empty() {
        report.push(report_entry(
            Some(index),
            "record_started_at_missing",
            "记录缺少 startedAt",
        ));
    }
    if matches!(attempt.status, AttemptStatus::Draft | AttemptStatus::Active) {
        report.push(report_entry(
            Some(index),
            "record_status_open",
            "归档不能包含未完成的阅读草稿",
        ));
    }
    if attempt.mode == AttemptMode::Memorize {
        report.push(report_entry(
            Some(index),
            "record_mode_memorize",
            "归档不能包含临时记忆模式记录",
        ));
    }
    if attempt.task_type.is_some() {
        report.push(report_entry(
            Some(index),
            "record_task_type_invalid",
            "阅读记录不能携带写作 taskType",
        ));
    }

    let mut answer_ids = HashSet::new();
    for answer in &attempt.answers {
        if answer.question_id.trim().is_empty() {
            report.push(report_entry(
                Some(index),
                "answer_question_id_invalid",
                "答案缺少 questionId",
            ));
        } else if !answer_ids.insert(answer.question_id.clone()) {
            report.push(report_entry(
                Some(index),
                "answer_question_id_duplicate",
                format!("记录中存在重复 questionId: {}", answer.question_id),
            ));
        }
    }
    for annotation in &mut attempt.annotations {
        if annotation.id.trim().is_empty() || annotation.asset_id.trim().is_empty() {
            report.push(report_entry(
                Some(index),
                "annotation_invalid",
                "标注缺少 id 或 assetId",
            ));
        } else if !seen_annotation_ids.insert(annotation.id.clone()) {
            report.push(report_entry(
                Some(index),
                "annotation_id_duplicate",
                format!("归档中存在重复标注 id: {}", annotation.id),
            ));
        }
        if let Some(annotation_attempt_id) = annotation.attempt_id.as_deref() {
            if annotation_attempt_id != attempt.id {
                report.push(report_entry(
                    Some(index),
                    "annotation_attempt_mismatch",
                    "标注 attemptId 与所属记录不一致",
                ));
            }
        } else {
            // Old archives did not always carry this field. It is safe to
            // normalize only after the record has been bound to its parent.
            annotation.attempt_id = Some(attempt.id.clone());
        }
    }
}

/// Annotation IDs are global primary keys, not children scoped by attempt.
/// A snapshot may replace annotations already owned by the same attempt, but
/// it must never steal an annotation from another attempt (or a global note).
fn validate_existing_annotation_ownership(
    conn: &Connection,
    attempts: &[AttemptRecord],
    report: &mut Vec<ReadingArchiveReportEntry>,
) -> DbResult<()> {
    for (index, attempt) in attempts.iter().enumerate() {
        for annotation in &attempt.annotations {
            let owner: Option<Option<String>> = conn
                .query_row(
                    "SELECT attempt_id FROM attempt_annotations WHERE id = ?1",
                    params![annotation.id],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(owner) = owner {
                if owner.as_deref() != Some(attempt.id.as_str()) {
                    report.push(report_entry(
                        Some(index),
                        "annotation_id_conflict",
                        format!("标注 id 已属于另一条本地记录: {}", annotation.id),
                    ));
                }
            }
        }
    }
    Ok(())
}

fn import_attempt(conn: &Connection, attempt: &AttemptRecord) -> DbResult<()> {
    let mut asset_ids = HashSet::new();
    if let Some(asset_id) = attempt.asset_id.as_deref() {
        asset_ids.insert(asset_id);
    }
    for annotation in &attempt.annotations {
        asset_ids.insert(annotation.asset_id.as_str());
    }
    for asset_id in asset_ids {
        ensure_asset_stub(
            conn,
            asset_id,
            Activity::Reading,
            attempt
                .title_snapshot
                .as_deref()
                .unwrap_or("Imported reading"),
            Some(asset_id),
        )?;
    }
    // `upsert_attempt` replaces answers but intentionally preserves live
    // annotations for normal practice writes. An archive is a complete
    // snapshot, so preserving absent annotations here would make restore
    // non-deterministic and leave stale user data behind.
    conn.execute(
        "DELETE FROM attempt_annotations WHERE attempt_id = ?1",
        params![attempt.id],
    )?;
    upsert_attempt(conn, attempt)
}

fn report_entry(
    record_index: Option<usize>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> ReadingArchiveReportEntry {
    ReadingArchiveReportEntry {
        record_index,
        code: code.into(),
        message: message.into(),
    }
}
