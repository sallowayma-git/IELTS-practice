//! Phase 9: query plan baselines and performance budget constants.

use rusqlite::Connection;

use crate::sqlite::{DbError, DbResult};

/// Soft performance budgets (milliseconds). Enforced in diagnostics, not hard runtime aborts.
#[derive(Debug, Clone, Copy)]
pub struct PerformanceBudgets {
    pub cold_start_interactive_ms: u64,
    pub warm_start_interactive_ms: u64,
    pub library_first_paint_ms: u64,
    pub answer_local_save_ms: u64,
    pub history_first_page_ms: u64,
    pub result_open_ms: u64,
    pub evaluation_ui_latency_ms: u64,
}

pub const DEFAULT_BUDGETS: PerformanceBudgets = PerformanceBudgets {
    cold_start_interactive_ms: 2500,
    warm_start_interactive_ms: 1200,
    library_first_paint_ms: 500,
    answer_local_save_ms: 50,
    history_first_page_ms: 500,
    result_open_ms: 300,
    evaluation_ui_latency_ms: 100,
};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryPlanBaseline {
    pub name: &'static str,
    pub sql: &'static str,
    pub plan: String,
    pub uses_index: bool,
}

const HISTORY_LIST_SQL: &str = r#"
SELECT id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
       duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
       prompt_snapshot, content_text, schema_version
FROM attempts
WHERE mode != 'memorize' AND activity = 'reading'
ORDER BY COALESCE(submitted_at, started_at) DESC, id DESC
LIMIT 20 OFFSET 0
"#;

const ASSETS_BY_ACTIVITY_SQL: &str = r#"
SELECT id, title, category, difficulty, frequency, fingerprint, schema_version, content_ref
FROM practice_assets
WHERE activity = 'reading'
ORDER BY category, id
LIMIT 100
"#;

const COACH_MESSAGES_SQL: &str = r#"
SELECT id, thread_id, role, content, structured_payload, status, created_at, sequence
FROM coach_messages
WHERE thread_id = 'x' AND sequence > 0
ORDER BY sequence ASC
LIMIT 100
"#;

fn explain_query_plan(conn: &Connection, sql: &str) -> DbResult<String> {
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?;
    let rows = stmt.query_map([], |row| {
        // detail is usually column 3 in SQLite explain query plan
        let detail: String = row
            .get::<_, String>(3)
            .or_else(|_| row.get::<_, String>(0))?;
        Ok(detail)
    })?;
    let mut parts = Vec::new();
    for row in rows {
        parts.push(row?);
    }
    Ok(parts.join(" | "))
}

fn plan_uses_index(plan: &str) -> bool {
    let lower = plan.to_ascii_lowercase();
    lower.contains("using index")
        || lower.contains("using covering index")
        || lower.contains("search")
}

pub fn collect_query_plan_baselines(conn: &Connection) -> DbResult<Vec<QueryPlanBaseline>> {
    let specs = [
        ("history_list_reading", HISTORY_LIST_SQL),
        ("assets_by_activity", ASSETS_BY_ACTIVITY_SQL),
        ("coach_messages_incremental", COACH_MESSAGES_SQL),
    ];
    let mut out = Vec::new();
    for (name, sql) in specs {
        let plan = explain_query_plan(conn, sql)?;
        let uses_index = plan_uses_index(&plan);
        out.push(QueryPlanBaseline {
            name,
            sql,
            plan,
            uses_index,
        });
    }
    Ok(out)
}

/// Seed synthetic attempts for history pagination benchmarks (test/diagnostics only).
pub fn seed_history_benchmark_rows(conn: &Connection, count: u32) -> DbResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    for i in 0..count {
        let id = format!("bench-attempt-{i}");
        conn.execute(
            "INSERT OR IGNORE INTO attempts (
                id, activity, asset_id, mode, suite_id, status, started_at, submitted_at, completed_at,
                duration_ms, score_value, score_scale, correct_count, question_count, title_snapshot,
                prompt_snapshot, content_text, schema_version, created_at, updated_at
             ) VALUES (
                ?1, 'reading', NULL, 'single', NULL, 'completed', ?2, ?2, ?2,
                1000, 0.8, 'ratio', 8, 10, ?3,
                NULL, NULL, 1, ?2, ?2
             )",
            rusqlite::params![id, now, format!("Benchmark {i}")],
        )?;
    }
    Ok(())
}

pub fn measure_history_list_ms(conn: &Connection) -> DbResult<u128> {
    use std::time::Instant;
    let start = Instant::now();
    let page = crate::history::list_history(
        conn,
        &ielts_domain::dto::ListHistoryQuery {
            activity: Some(ielts_domain::domain::Activity::Reading),
            limit: 20,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )?;
    let _ = page.items.len();
    Ok(start.elapsed().as_millis())
}

pub fn budgets_ok(elapsed_ms: u64, budget_ms: u64) -> bool {
    elapsed_ms <= budget_ms
}

#[allow(dead_code)]
fn _err_link() -> DbError {
    DbError::Message("perf".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate::migrate;
    use crate::sqlite::{open_connection, DbOpenOptions};
    use tempfile::tempdir;

    #[test]
    fn query_plans_and_history_budget() {
        let dir = tempdir().unwrap();
        let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("p.db"))).unwrap();
        migrate(&mut conn).unwrap();
        seed_history_benchmark_rows(&conn, 200).unwrap();
        let plans = collect_query_plan_baselines(&conn).unwrap();
        assert_eq!(plans.len(), 3);
        // plans should be non-empty text
        assert!(plans.iter().all(|p| !p.plan.is_empty()));

        let ms = measure_history_list_ms(&conn).unwrap();
        assert!(
            budgets_ok(ms as u64, DEFAULT_BUDGETS.history_first_page_ms * 20),
            "history list too slow even with generous CI multiplier: {ms}ms"
        );
    }
}
