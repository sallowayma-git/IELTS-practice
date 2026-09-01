//! Unified history query, export, and detail loading (Phase 4).

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale, WritingTaskType};
use ielts_domain::dto::{
    ExportHistoryResult, HistoryDetailResponse, HistoryExportFormat, HistoryRetentionPolicyDto,
    ListHistoryPage, ListHistoryQuery, SetHistoryRetentionPolicyResult, WritingCriterionScores,
    WritingEvaluationV4, WritingHistoryLatestScore, WritingHistoryStatistics,
    WritingHistoryStatisticsQuery, WritingHistoryStatisticsRange,
};
use ielts_domain::{history_item_from_attempt, AttemptRecord, HistoryListItemVm};

use crate::attempts::{parse_writing_task_type, writing_task_type_str};
use crate::sqlite::{DbError, DbResult};

pub const HISTORY_RETENTION_MIN: u32 = 50;
pub const HISTORY_RETENTION_MAX: u32 = 500;
pub const HISTORY_RETENTION_STEP: u32 = 50;
pub const HISTORY_RETENTION_DEFAULT: u32 = 100;

const RETAINABLE_TERMINAL_STATUS_SQL: &str =
    "lower(status) IN ('completed', 'cancelled', 'failed', 'interrupted')";

#[derive(Debug, Clone, Default)]
struct HistoryFilter {
    activity: Option<Activity>,
    search: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    min_score: Option<f64>,
    max_score: Option<f64>,
    score_scale: Option<ScoreScale>,
    task_type: Option<WritingTaskType>,
}

impl From<&ListHistoryQuery> for HistoryFilter {
    fn from(q: &ListHistoryQuery) -> Self {
        Self {
            activity: q.activity,
            search: q
                .search
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            start_date: q.start_date.clone().filter(|s| !s.is_empty()),
            end_date: q.end_date.clone().filter(|s| !s.is_empty()),
            min_score: q.min_score,
            max_score: q.max_score,
            score_scale: q.score_scale,
            task_type: q.task_type,
        }
    }
}

fn build_where(filter: &HistoryFilter) -> DbResult<(String, Vec<Box<dyn ToSql>>)> {
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Box<dyn ToSql>> = Vec::new();

    // Memorize attempts are temporary read-only sessions; never list in normal history.
    clauses.push("mode != 'memorize'".into());
    // History is terminal work only. `submitted` and `reviewing` are still
    // recoverable workflow state, not a learner-visible historical result.
    clauses.push(RETAINABLE_TERMINAL_STATUS_SQL.into());

    if let Some(activity) = filter.activity {
        clauses.push("activity = ?".into());
        binds.push(Box::new(activity_str(activity).to_string()));
    }
    if let Some(start) = &filter.start_date {
        clauses.push("date(COALESCE(submitted_at, started_at)) >= date(?)".into());
        binds.push(Box::new(start.clone()));
    }
    if let Some(end) = &filter.end_date {
        clauses.push("date(COALESCE(submitted_at, started_at)) <= date(?)".into());
        binds.push(Box::new(end.clone()));
    }
    if let Some(scale) = resolve_score_filter_scale(filter)? {
        clauses.push("score_scale = ?".into());
        binds.push(Box::new(score_scale_str(scale).to_string()));
    }
    if let Some(min) = filter.min_score {
        clauses.push("score_value IS NOT NULL AND score_value >= ?".into());
        binds.push(Box::new(min));
    }
    if let Some(max) = filter.max_score {
        clauses.push("score_value IS NOT NULL AND score_value <= ?".into());
        binds.push(Box::new(max));
    }
    if let Some(task_type) = filter.task_type {
        clauses.push("activity = 'writing'".into());
        clauses.push("task_type = ?".into());
        binds.push(Box::new(writing_task_type_str(task_type).to_string()));
    }
    if let Some(search) = &filter.search {
        clauses.push(
            "(IFNULL(title_snapshot,'') LIKE ? OR IFNULL(prompt_snapshot,'') LIKE ? OR IFNULL(content_text,'') LIKE ? OR id LIKE ?)"
                .into(),
        );
        let like = format!("%{search}%");
        binds.push(Box::new(like.clone()));
        binds.push(Box::new(like.clone()));
        binds.push(Box::new(like.clone()));
        binds.push(Box::new(like));
    }

    let sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    Ok((sql, binds))
}

/// Score values are only meaningful alongside their unit. Keep compatible
/// single-activity callers working by deriving the only valid scale there, but
/// never guess when Reading and Writing are mixed.
fn resolve_score_filter_scale(filter: &HistoryFilter) -> DbResult<Option<ScoreScale>> {
    if filter.min_score.is_none() && filter.max_score.is_none() {
        return Ok(None);
    }

    let activity_scale = filter.activity.map(score_scale_for_activity);
    let scale = match (filter.score_scale, activity_scale) {
        (Some(requested), Some(activity)) if requested != activity => {
            return Err(DbError::Message(
                "history score scale does not match the requested activity".into(),
            ));
        }
        (Some(requested), _) => requested,
        (None, Some(activity)) => activity,
        (None, None) => {
            return Err(DbError::Message(
                "history score range requires scoreScale for mixed activities".into(),
            ));
        }
    };

    validate_score_range(filter.min_score, filter.max_score, scale)?;
    Ok(Some(scale))
}

fn score_scale_for_activity(activity: Activity) -> ScoreScale {
    match activity {
        Activity::Reading => ScoreScale::Ratio,
        Activity::Writing => ScoreScale::Band9,
    }
}

fn score_scale_str(scale: ScoreScale) -> &'static str {
    match scale {
        ScoreScale::Ratio => "ratio",
        ScoreScale::Band9 => "band9",
    }
}

fn validate_score_range(min: Option<f64>, max: Option<f64>, scale: ScoreScale) -> DbResult<()> {
    if let (Some(min), Some(max)) = (min, max) {
        if min > max {
            return Err(DbError::Message(
                "history minimum score cannot exceed maximum score".into(),
            ));
        }
    }

    let (lower, upper, label) = match scale {
        ScoreScale::Ratio => (0.0, 1.0, "ratio"),
        ScoreScale::Band9 => (0.0, 9.0, "band9"),
    };
    for value in [min, max].into_iter().flatten() {
        if !value.is_finite() || value < lower || value > upper {
            return Err(DbError::Message(format!(
                "history {label} score must be between {lower} and {upper}"
            )));
        }
    }
    Ok(())
}

/// Hard cap for normal UI/list pages. Export/bulk use a higher internal max.
const LIST_HISTORY_UI_MAX: u32 = 200;
/// Cap for export and other full-scan internal callers (not UI pages).
const LIST_HISTORY_EXPORT_MAX: u32 = 50_000;

/// UI-facing list: hard-caps `limit` at 200 so normal pages stay bounded.
pub fn list_history(conn: &Connection, query: &ListHistoryQuery) -> DbResult<ListHistoryPage> {
    list_history_capped(conn, query, LIST_HISTORY_UI_MAX)
}

/// Internal list with a configurable max limit (export / bulk full scan).
fn list_history_capped(
    conn: &Connection,
    query: &ListHistoryQuery,
    max_limit: u32,
) -> DbResult<ListHistoryPage> {
    let filter = HistoryFilter::from(query);
    let (where_sql, binds) = build_where(&filter)?;
    let limit = query.limit.max(1).min(max_limit.max(1));
    let offset = query.offset;

    let count_sql = format!("SELECT COUNT(*) FROM attempts {where_sql}");
    let total: u32 = {
        let mut stmt = conn.prepare(&count_sql)?;
        let params_iter = params_from_iter(binds.iter().map(|b| b.as_ref()));
        stmt.query_row(params_iter, |r| r.get::<_, i64>(0))? as u32
    };

    let list_sql = format!(
        "SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version, task_type
         FROM attempts
         {where_sql}
         ORDER BY COALESCE(submitted_at, started_at) DESC, id DESC
         LIMIT ? OFFSET ?"
    );

    let mut all_binds = binds;
    all_binds.push(Box::new(limit as i64));
    all_binds.push(Box::new(offset as i64));

    let mut stmt = conn.prepare(&list_sql)?;
    let params_iter = params_from_iter(all_binds.iter().map(|b| b.as_ref()));
    let rows = stmt.query_map(params_iter, map_attempt_row)?;

    let mut items = Vec::new();
    for row in rows {
        let attempt = row?;
        items.push(history_item_from_attempt(&attempt));
    }

    let next_cursor = if offset + limit < total {
        Some(format!("{}", offset + limit))
    } else {
        None
    };

    Ok(ListHistoryPage {
        items,
        total,
        limit,
        offset,
        next_cursor,
    })
}

/// Page through history using the export max until exhausted (or `requested_limit` hit).
fn list_history_all(
    conn: &Connection,
    query: &ListHistoryQuery,
    requested_limit: u32,
) -> DbResult<Vec<HistoryListItemVm>> {
    let hard_cap = requested_limit.max(1).min(LIST_HISTORY_EXPORT_MAX);
    // Export pages can be large; do not reuse the UI page size of 200.
    let page_size = hard_cap.max(1);
    let mut items = Vec::new();
    let mut offset = 0u32;

    loop {
        if items.len() as u32 >= hard_cap {
            break;
        }
        let remaining = hard_cap - items.len() as u32;
        let mut page_query = query.clone();
        page_query.limit = page_size.min(remaining);
        page_query.offset = offset;
        let page = list_history_capped(conn, &page_query, LIST_HISTORY_EXPORT_MAX)?;
        if page.items.is_empty() {
            break;
        }
        offset = offset.saturating_add(page.items.len() as u32);
        items.extend(page.items);
        if items.len() as u32 >= page.total || items.len() as u32 >= hard_cap {
            break;
        }
    }

    if items.len() as u32 > hard_cap {
        items.truncate(hard_cap as usize);
    }
    Ok(items)
}

pub fn get_history_detail(conn: &Connection, attempt_id: &str) -> DbResult<HistoryDetailResponse> {
    let attempt = load_attempt(conn, attempt_id)?;
    let summary = history_item_from_attempt(&attempt);
    let evaluation = if attempt.activity == Activity::Writing {
        load_evaluation(conn, attempt_id)?
    } else {
        None
    };
    Ok(HistoryDetailResponse {
        summary,
        attempt,
        evaluation,
    })
}

/// Aggregate the actual persisted evaluation rows. The prior Vue implementation
/// scanned a paged history list and returned a different shape than its own
/// page expected, so the four-criterion card could never render truthfully.
pub fn writing_history_statistics(
    conn: &Connection,
    query: &WritingHistoryStatisticsQuery,
) -> DbResult<WritingHistoryStatistics> {
    let range_clause = match query.range {
        WritingHistoryStatisticsRange::All => "",
        WritingHistoryStatisticsRange::Monthly => {
            " AND date(COALESCE(a.completed_at, a.submitted_at, a.started_at)) >= date('now', 'start of month')"
        }
        WritingHistoryStatisticsRange::Task1 => " AND a.task_type = 'task1'",
        WritingHistoryStatisticsRange::Task2 => " AND a.task_type = 'task2'",
    };
    let sql = format!(
        "WITH latest_evaluation AS (
            SELECT attempt_id, result_json,
                   ROW_NUMBER() OVER (
                       PARTITION BY attempt_id
                       ORDER BY COALESCE(completed_at, updated_at, started_at) DESC, id DESC
                   ) AS row_number
            FROM writing_evaluations
            WHERE lower(status) IN ('completed', 'degraded')
              AND result_json IS NOT NULL
         )
         SELECT a.task_type,
                COALESCE(a.completed_at, a.submitted_at, a.started_at),
                latest_evaluation.result_json
         FROM attempts a
         INNER JOIN latest_evaluation
           ON latest_evaluation.attempt_id = a.id
          AND latest_evaluation.row_number = 1
         WHERE a.activity = 'writing'
           AND a.mode != 'memorize'
           AND {RETAINABLE_TERMINAL_STATUS_SQL}
           AND a.task_type IS NOT NULL
           {range_clause}
         ORDER BY COALESCE(a.completed_at, a.submitted_at, a.started_at) DESC, a.id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;

    let mut total = WritingCriterionTotals::default();
    let mut latest = None;
    for row in rows {
        let (task_type, submitted_at, result_json) = row?;
        let Some(task_type) = WritingTaskType::parse_loose(&task_type) else {
            continue;
        };
        let Ok(evaluation) = serde_json::from_str::<WritingEvaluationV4>(&result_json) else {
            continue;
        };
        let Some(score) = evaluation.score else {
            continue;
        };
        let criteria = WritingCriterionScores {
            task_response: score.task_response,
            coherence: score.coherence,
            lexical: score.lexical,
            grammar: score.grammar,
        };
        if !criteria_are_finite(&criteria) {
            continue;
        }
        if latest.is_none() {
            latest = Some(WritingHistoryLatestScore {
                task_type,
                submitted_at,
                score: criteria.clone(),
            });
        }
        total.add(&criteria);
    }

    Ok(WritingHistoryStatistics {
        count: total.count,
        latest,
        average: total.average(),
    })
}

#[derive(Default)]
struct WritingCriterionTotals {
    task_response: f64,
    coherence: f64,
    lexical: f64,
    grammar: f64,
    count: u32,
}

impl WritingCriterionTotals {
    fn add(&mut self, score: &WritingCriterionScores) {
        self.task_response += score.task_response;
        self.coherence += score.coherence;
        self.lexical += score.lexical;
        self.grammar += score.grammar;
        self.count += 1;
    }

    fn average(&self) -> Option<WritingCriterionScores> {
        let divisor = f64::from(self.count);
        (self.count > 0).then(|| WritingCriterionScores {
            task_response: self.task_response / divisor,
            coherence: self.coherence / divisor,
            lexical: self.lexical / divisor,
            grammar: self.grammar / divisor,
        })
    }
}

fn criteria_are_finite(score: &WritingCriterionScores) -> bool {
    [
        score.task_response,
        score.coherence,
        score.lexical,
        score.grammar,
    ]
    .into_iter()
    .all(f64::is_finite)
}

pub fn export_history(
    conn: &Connection,
    format: HistoryExportFormat,
    query: Option<&ListHistoryQuery>,
) -> DbResult<ExportHistoryResult> {
    let mut q = query.cloned().unwrap_or(ListHistoryQuery {
        activity: None,
        limit: 10_000,
        offset: 0,
        cursor: None,
        search: None,
        start_date: None,
        end_date: None,
        min_score: None,
        max_score: None,
        score_scale: None,
        task_type: None,
    });
    // Export must not inherit the UI list hard-cap of 200.
    let requested = q.limit.max(1).min(LIST_HISTORY_EXPORT_MAX);
    q.offset = 0;
    let items = list_history_all(conn, &q, requested)?;
    let body = match format {
        HistoryExportFormat::Csv => render_csv(&items),
        HistoryExportFormat::Markdown => render_markdown(&items),
        HistoryExportFormat::Json => {
            serde_json::to_string_pretty(&items).map_err(|e| DbError::Message(e.to_string()))?
        }
    };
    Ok(ExportHistoryResult {
        format,
        body,
        record_count: items.len() as u32,
    })
}

pub fn delete_attempt(conn: &Connection, attempt_id: &str) -> DbResult<bool> {
    let tx = conn.unchecked_transaction()?;
    let deleted = delete_attempt_graph_in_transaction(&tx, attempt_id)?;
    if deleted {
        crate::learning_observations::learning_observations_rebuild_in_transaction(&tx)?;
    }
    tx.commit()?;
    Ok(deleted)
}

/// Delete a visible history selection atomically. A stale UI must never turn a
/// bulk operation into a half-deleted list, and it must not be able to erase a
/// draft/reviewing workflow that history intentionally hides.
pub fn delete_history_attempts(conn: &Connection, attempt_ids: &[String]) -> DbResult<u32> {
    let ids = normalized_history_ids(attempt_ids)?;
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    for id in &ids {
        ensure_history_attempt(&tx, id)?;
    }
    let mut deleted = 0u32;
    for id in &ids {
        if delete_attempt_graph_in_transaction(&tx, id)? {
            deleted += 1;
        }
    }
    if deleted > 0 {
        crate::learning_observations::learning_observations_rebuild_in_transaction(&tx)?;
    }
    tx.commit()?;
    Ok(deleted)
}

/// Clear terminal history in one transaction. `None` means every activity,
/// matching the Settings wording “all history”; unfinished input is preserved.
pub fn clear_history(conn: &Connection, activity: Option<Activity>) -> DbResult<u32> {
    let tx = conn.unchecked_transaction()?;
    let mut sql = format!(
        "SELECT id FROM attempts
         WHERE mode != 'memorize' AND {RETAINABLE_TERMINAL_STATUS_SQL}"
    );
    let mut ids = Vec::new();
    if let Some(activity) = activity {
        sql.push_str(" AND activity = ?1");
        let mut stmt = tx.prepare(&sql)?;
        let rows = stmt.query_map(params![activity_str(activity)], |row| {
            row.get::<_, String>(0)
        })?;
        for row in rows {
            ids.push(row?);
        }
    } else {
        let mut stmt = tx.prepare(&sql)?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        for row in rows {
            ids.push(row?);
        }
    }
    let mut deleted = 0u32;
    for id in ids {
        if delete_attempt_graph_in_transaction(&tx, &id)? {
            deleted += 1;
        }
    }
    if deleted > 0 {
        crate::learning_observations::learning_observations_rebuild_in_transaction(&tx)?;
    }
    tx.commit()?;
    Ok(deleted)
}

fn normalized_history_ids(input: &[String]) -> DbResult<Vec<String>> {
    let mut ids = Vec::with_capacity(input.len());
    let mut seen = std::collections::HashSet::new();
    for raw in input {
        let id = raw.trim();
        if id.is_empty() || id.len() > 160 {
            return Err(DbError::Validation("invalid history attempt id".into()));
        }
        if seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

fn ensure_history_attempt(conn: &Connection, attempt_id: &str) -> DbResult<()> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT mode, status FROM attempts WHERE id = ?1",
            params![attempt_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((mode, status)) = row else {
        // Missing IDs are harmless replays: the final observable result is
        // still “not in history”, while all existing IDs remain atomic.
        return Ok(());
    };
    let is_terminal = matches!(
        status.as_str(),
        "completed" | "cancelled" | "failed" | "interrupted"
    );
    if mode == "memorize" || !is_terminal {
        return Err(DbError::Validation(
            "only terminal history attempts may be deleted".into(),
        ));
    }
    Ok(())
}

/// Return the only persisted retention policy. A missing row is database
/// corruption after migration, not a UI-default opportunity: callers must see
/// the failure instead of believing a value that SQLite does not own.
pub fn get_history_retention_policy(conn: &Connection) -> DbResult<HistoryRetentionPolicyDto> {
    Ok(HistoryRetentionPolicyDto {
        max_terminal_attempts: load_history_retention_limit(conn)?,
    })
}

/// Persist a policy and immediately apply it to existing terminal history in
/// one transaction. `None` is an explicit unlimited/disabled policy.
pub fn set_history_retention_policy(
    conn: &Connection,
    max_terminal_attempts: Option<u32>,
) -> DbResult<SetHistoryRetentionPolicyResult> {
    validate_history_retention_limit(max_terminal_attempts)?;
    let tx = conn.unchecked_transaction()?;
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO history_retention_policy (singleton, max_terminal_attempts, updated_at)
         VALUES (1, ?1, ?2)
         ON CONFLICT(singleton) DO UPDATE SET
           max_terminal_attempts = excluded.max_terminal_attempts,
           updated_at = excluded.updated_at",
        params![max_terminal_attempts.map(i64::from), now],
    )?;
    let pruned_attempt_count = prune_terminal_attempts_in_transaction(&tx)?;
    tx.commit()?;
    Ok(SetHistoryRetentionPolicyResult {
        policy: HistoryRetentionPolicyDto {
            max_terminal_attempts,
        },
        pruned_attempt_count,
    })
}

/// A v3 backup predates the policy table but can contain the old app KV. When
/// restoring it, migrate that value once and erase the mirror again. If there
/// is no old value, preserve the target's existing policy (normally the v8
/// migration default) rather than silently inventing an unlimited policy.
pub fn restore_legacy_history_retention_policy(conn: &Connection) -> DbResult<()> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE namespace = 'app' AND key = 'history_limit'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let parsed = raw
        .as_deref()
        .and_then(parse_legacy_history_retention_limit)
        .filter(|limit| validate_history_retention_limit(Some(*limit)).is_ok());
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(limit) = parsed {
        conn.execute(
            "INSERT INTO history_retention_policy (singleton, max_terminal_attempts, updated_at)
             VALUES (1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE SET
               max_terminal_attempts = excluded.max_terminal_attempts,
               updated_at = excluded.updated_at",
            params![i64::from(limit), now],
        )?;
    } else {
        conn.execute(
            "INSERT OR IGNORE INTO history_retention_policy (singleton, max_terminal_attempts, updated_at)
             VALUES (1, ?1, ?2)",
            params![i64::from(HISTORY_RETENTION_DEFAULT), now],
        )?;
    }
    conn.execute(
        "DELETE FROM settings WHERE namespace = 'app' AND key = 'history_limit'",
        [],
    )?;
    Ok(())
}

/// Apply the canonical policy after a product path has made an attempt
/// terminal, but before that path commits its own transaction. Cold import and
/// backup restore intentionally never call this function: they replay durable
/// facts rather than creating a new learner completion.
pub fn prune_terminal_attempts_in_transaction(conn: &Connection) -> DbResult<u32> {
    let Some(limit) = load_history_retention_limit(conn)? else {
        return Ok(0);
    };
    let select_sql = format!(
        "SELECT id
         FROM attempts
         WHERE mode != 'memorize' AND {RETAINABLE_TERMINAL_STATUS_SQL}
         ORDER BY COALESCE(completed_at, submitted_at, started_at, created_at) DESC, id DESC
         LIMIT -1 OFFSET ?1"
    );
    let ids = {
        let mut statement = conn.prepare(&select_sql)?;
        let rows = statement.query_map(params![i64::from(limit)], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        ids
    };
    for attempt_id in &ids {
        delete_attempt_graph_in_transaction(conn, attempt_id)?;
    }
    if !ids.is_empty() {
        crate::learning_observations::learning_observations_rebuild_in_transaction(conn)?;
    }
    Ok(ids.len() as u32)
}

/// Delete an attempt together with every non-FK logical edge that would
/// otherwise make a backup or idempotent replay lie about an erased record.
/// The caller owns the transaction.
fn delete_attempt_graph_in_transaction(conn: &Connection, attempt_id: &str) -> DbResult<bool> {
    let evaluation_ids = {
        let mut statement =
            conn.prepare("SELECT id FROM writing_evaluations WHERE attempt_id = ?1 ORDER BY id")?;
        let rows = statement.query_map(params![attempt_id], |row| row.get::<_, String>(0))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        ids
    };
    for evaluation_id in evaluation_ids {
        conn.execute(
            "DELETE FROM evaluation_checkpoints WHERE evaluation_id = ?1",
            params![evaluation_id],
        )?;
        conn.execute(
            "DELETE FROM evaluation_events WHERE evaluation_id = ?1",
            params![evaluation_id],
        )?;
        conn.execute(
            "DELETE FROM evaluation_lineage
             WHERE evaluation_id = ?1 OR retry_of = ?1 OR root_evaluation_id = ?1",
            params![evaluation_id],
        )?;
    }
    conn.execute(
        "DELETE FROM evaluation_lineage WHERE attempt_id = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "UPDATE reading_suite_items SET attempt_id = NULL WHERE attempt_id = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "UPDATE endless_sessions SET current_attempt_id = NULL WHERE current_attempt_id = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "UPDATE coach_threads SET attempt_id = NULL WHERE attempt_id = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "UPDATE vocabulary_items SET source_attempt_id = NULL WHERE source_attempt_id = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "DELETE FROM settings WHERE namespace = 'reading_draft' AND key = ?1",
        params![attempt_id],
    )?;
    conn.execute(
        "DELETE FROM reading_timer_states WHERE scope = 'attempt' AND owner_id = ?1",
        params![attempt_id],
    )?;
    delete_mode_idempotency_replays_for_attempt(conn, attempt_id)?;
    let deleted = conn.execute("DELETE FROM attempts WHERE id = ?1", params![attempt_id])?;
    Ok(deleted > 0)
}

/// Mode idempotency predates a direct attempt foreign key. Its response is
/// JSON, so substring matching is wrong: a short attempt ID such as `a1`
/// matches an unrelated `a100` replay. Only delete exact values at fields
/// whose schema denotes an attempt. The JSON guard also leaves corrupt legacy
/// rows alone instead of turning a history deletion into a database error.
fn delete_mode_idempotency_replays_for_attempt(
    conn: &Connection,
    attempt_id: &str,
) -> DbResult<()> {
    conn.execute(
        "DELETE FROM mode_idempotency
         WHERE (scope = 'memorize.create' AND entity_id = ?1)
            OR CASE
                 WHEN json_valid(response_json) THEN
                   json_extract(response_json, '$.attempt.id') = ?1
                   OR json_extract(response_json, '$.submission.attempt.id') = ?1
                   OR json_extract(response_json, '$.currentAttemptId') = ?1
                   OR json_extract(response_json, '$.current_attempt_id') = ?1
                   OR json_extract(response_json, '$.session.currentAttemptId') = ?1
                   OR json_extract(response_json, '$.session.current_attempt_id') = ?1
                   OR (
                     scope IN ('suite.create', 'suite.submit')
                     AND (
                       EXISTS (
                         SELECT 1
                         FROM json_each(response_json, '$.sequence') AS sequence_item
                         WHERE json_extract(sequence_item.value, '$.attemptId') = ?1
                            OR json_extract(sequence_item.value, '$.attempt_id') = ?1
                            OR json_extract(sequence_item.value, '$.sessionId') = ?1
                            OR json_extract(sequence_item.value, '$.session_id') = ?1
                       )
                       OR EXISTS (
                         SELECT 1
                         FROM json_each(response_json, '$.suiteSession.sequence') AS sequence_item
                         WHERE json_extract(sequence_item.value, '$.attemptId') = ?1
                            OR json_extract(sequence_item.value, '$.attempt_id') = ?1
                            OR json_extract(sequence_item.value, '$.sessionId') = ?1
                            OR json_extract(sequence_item.value, '$.session_id') = ?1
                       )
                       OR EXISTS (
                         SELECT 1
                         FROM json_each(response_json, '$.suite_session.sequence') AS sequence_item
                         WHERE json_extract(sequence_item.value, '$.attemptId') = ?1
                            OR json_extract(sequence_item.value, '$.attempt_id') = ?1
                            OR json_extract(sequence_item.value, '$.sessionId') = ?1
                            OR json_extract(sequence_item.value, '$.session_id') = ?1
                       )
                     )
                   )
                 ELSE 0
               END",
        params![attempt_id],
    )?;
    Ok(())
}

fn load_history_retention_limit(conn: &Connection) -> DbResult<Option<u32>> {
    let stored: Option<Option<i64>> = conn
        .query_row(
            "SELECT max_terminal_attempts FROM history_retention_policy WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let Some(stored) = stored else {
        return Err(DbError::Validation(
            "history retention policy missing after migration".into(),
        ));
    };
    let limit = stored
        .map(|value| {
            u32::try_from(value).map_err(|_| {
                DbError::Validation("history retention policy contains a negative limit".into())
            })
        })
        .transpose()?;
    validate_history_retention_limit(limit)?;
    Ok(limit)
}

fn validate_history_retention_limit(limit: Option<u32>) -> DbResult<()> {
    let Some(limit) = limit else {
        return Ok(());
    };
    if (HISTORY_RETENTION_MIN..=HISTORY_RETENTION_MAX).contains(&limit)
        && limit % HISTORY_RETENTION_STEP == 0
    {
        return Ok(());
    }
    Err(DbError::Validation(format!(
        "history retention limit must be unlimited or {HISTORY_RETENTION_MIN}-{HISTORY_RETENTION_MAX} in increments of {HISTORY_RETENTION_STEP}"
    )))
}

fn parse_legacy_history_retention_limit(raw: &str) -> Option<u32> {
    let value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
    if let Some(value) = value.as_u64() {
        return u32::try_from(value).ok();
    }
    let text = value.as_str()?;
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse::<u32>().ok()
}

fn render_csv(items: &[HistoryListItemVm]) -> String {
    let mut out = String::from("id,activity,task_type,title,status,mode,submitted_at,duration_ms,score_value,score_scale,score_display\n");
    for item in items {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{}\n",
            csv_escape(&item.id),
            activity_str(item.activity),
            item.task_type.map(writing_task_type_str).unwrap_or(""),
            csv_escape(&item.title),
            format!("{:?}", item.status).to_ascii_lowercase(),
            mode_str(item.mode),
            csv_escape(item.submitted_at.as_deref().unwrap_or("")),
            item.duration_ms,
            item.score_value.map(|v| v.to_string()).unwrap_or_default(),
            item.score_scale
                .map(|s| match s {
                    ScoreScale::Ratio => "ratio",
                    ScoreScale::Band9 => "band9",
                })
                .unwrap_or(""),
            csv_escape(&item.score_display),
        ));
    }
    out
}

fn render_markdown(items: &[HistoryListItemVm]) -> String {
    let mut out = String::from("# IELTS Practice History\n\n");
    out.push_str("| Activity | Task | Title | Score | Submitted | Duration |\n");
    out.push_str("|---|---|---|---|---|---|\n");
    for item in items {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} ms |\n",
            activity_str(item.activity),
            item.task_type
                .map(writing_task_type_str)
                .unwrap_or("未标注"),
            md_escape(&item.title),
            item.score_display,
            item.submitted_at.as_deref().unwrap_or("—"),
            item.duration_ms
        ));
    }
    out
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn md_escape(s: &str) -> String {
    s.replace('|', "\\|")
}

fn map_attempt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptRecord> {
    Ok(AttemptRecord {
        schema_version: row.get::<_, i64>(17)? as u32,
        id: row.get(0)?,
        activity: parse_activity(&row.get::<_, String>(1)?),
        asset_id: row.get(2)?,
        mode: parse_mode(&row.get::<_, String>(3)?),
        suite_id: row.get(4)?,
        status: parse_status(&row.get::<_, String>(5)?),
        started_at: row.get(6)?,
        submitted_at: row.get(7)?,
        completed_at: row.get(8)?,
        duration_ms: row.get::<_, i64>(9)? as u64,
        score_value: row.get(10)?,
        score_scale: row
            .get::<_, Option<String>>(11)?
            .and_then(|s| match s.as_str() {
                "ratio" => Some(ScoreScale::Ratio),
                "band9" => Some(ScoreScale::Band9),
                _ => None,
            }),
        correct_count: row.get(12)?,
        question_count: row.get::<_, Option<i64>>(13)?.map(|v| v as u32),
        title_snapshot: row.get(14)?,
        prompt_snapshot: row.get(15)?,
        content_text: row.get(16)?,
        task_type: parse_writing_task_type(row.get(18)?),
        answers: vec![],
        annotations: vec![],
    })
}

pub(crate) fn load_attempt(conn: &Connection, id: &str) -> DbResult<AttemptRecord> {
    let mut attempt = conn.query_row(
        "SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version, task_type
         FROM attempts WHERE id = ?1",
        params![id],
        map_attempt_row,
    )?;

    let mut stmt = conn.prepare(
        "SELECT question_id, answer_json, is_correct, weight, question_kind, change_count, visit_count,
                elapsed_ms, marked, answered_at
         FROM attempt_answers WHERE attempt_id = ?1 ORDER BY question_id",
    )?;
    let answers = stmt.query_map(params![id], |row| {
        let answer_json: String = row.get(1)?;
        let answer = serde_json::from_str(&answer_json).unwrap_or(serde_json::Value::Null);
        Ok(ielts_domain::AttemptAnswer {
            question_id: row.get(0)?,
            answer,
            is_correct: row.get::<_, Option<i64>>(2)?.map(|v| v != 0),
            weight: row.get(3)?,
            question_kind: row.get(4)?,
            change_count: row.get::<_, i64>(5)? as u32,
            visit_count: row.get::<_, i64>(6)? as u32,
            elapsed_ms: row.get::<_, i64>(7)? as u64,
            marked: row.get::<_, i64>(8)? != 0,
            answered_at: row.get(9)?,
        })
    })?;
    for a in answers {
        attempt.answers.push(a?);
    }

    let mut ann_stmt = conn.prepare(
        "SELECT id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text
         FROM attempt_annotations WHERE attempt_id = ?1",
    )?;
    let anns = ann_stmt.query_map(params![id], |row| {
        let anchor_json: String = row.get(6)?;
        let anchor = serde_json::from_str(&anchor_json).unwrap_or(serde_json::json!({}));
        Ok(ielts_domain::AttemptAnnotationDto {
            id: row.get(0)?,
            attempt_id: row.get::<_, Option<String>>(1)?,
            asset_id: row.get(2)?,
            scope: row.get(3)?,
            question_id: row.get(4)?,
            kind: row.get(5)?,
            anchor,
            note_text: row.get(7)?,
        })
    })?;
    for a in anns {
        attempt.annotations.push(a?);
    }

    Ok(attempt)
}

fn load_evaluation(conn: &Connection, attempt_id: &str) -> DbResult<Option<WritingEvaluationV4>> {
    // History and Result must use the same retry ordering as the live writing
    // command. A bare SELECT here was nondeterministic once an attempt had
    // more than one evaluation row.
    crate::writing::load_evaluation_for_attempt(conn, attempt_id)
}

fn activity_str(activity: Activity) -> &'static str {
    match activity {
        Activity::Reading => "reading",
        Activity::Writing => "writing",
    }
}

fn mode_str(mode: AttemptMode) -> &'static str {
    match mode {
        AttemptMode::Single => "single",
        AttemptMode::Suite => "suite",
        AttemptMode::Endless => "endless",
        AttemptMode::Memorize => "memorize",
        AttemptMode::Freeform => "freeform",
        AttemptMode::Bank => "bank",
    }
}

fn parse_activity(raw: &str) -> Activity {
    match raw {
        "writing" => Activity::Writing,
        _ => Activity::Reading,
    }
}

fn parse_mode(raw: &str) -> AttemptMode {
    match raw {
        "suite" => AttemptMode::Suite,
        "endless" => AttemptMode::Endless,
        "memorize" => AttemptMode::Memorize,
        "freeform" => AttemptMode::Freeform,
        "bank" => AttemptMode::Bank,
        _ => AttemptMode::Single,
    }
}

fn parse_status(raw: &str) -> AttemptStatus {
    use AttemptStatus::*;
    match raw {
        "draft" => Draft,
        "active" => Active,
        "submitted" => Submitted,
        "reviewing" => Reviewing,
        "cancelled" => Cancelled,
        "failed" => Failed,
        "interrupted" => Interrupted,
        _ => Completed,
    }
}
