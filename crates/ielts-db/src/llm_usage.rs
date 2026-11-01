//! Unified LLM usage ledger over `llm_invocations`.
//!
//! One row per gateway call that its caller did not trace itself (the coach
//! trace owns its own row). Rows hold counts, a finish reason and an error
//! class, never prompt or answer text, provider error bodies or URLs. Ledger
//! rows have no run, so history deletion cannot redact them later: their
//! `request_hash` is the constant [`UNLINKED_REQUEST_HASH`] (the column is NOT
//! NULL) and `response_hash` stays NULL.
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::sqlite::DbResult;

/// `request_hash` of a ledger row: no content hash, because nothing can redact
/// a hash of an unlinked call later.
pub const UNLINKED_REQUEST_HASH: &str = "unlinked";

/// Largest count a usage value may hold. Writers clamp to it, and the summary
/// clamps again in SQL, so one bad row cannot overflow an aggregate.
pub const MAX_USAGE_COUNT: u64 = (i64::MAX / 4) as u64;

/// One ledger row. `usage_json` and `error_json` are canonical JSON text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LlmInvocationRecord {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub request_hash: String,
    pub response_hash: Option<String>,
    pub usage_json: Option<String>,
    pub latency_ms: u64,
    pub provider_request_id: Option<String>,
    pub error_json: Option<String>,
    pub created_at: String,
}

pub fn record_llm_invocation(conn: &Connection, record: &LlmInvocationRecord) -> DbResult<()> {
    conn.execute(
        "INSERT INTO llm_invocations
         (id,run_id,kind,provider,model,request_hash,response_hash,usage_json,latency_ms,provider_request_id,error_json,created_at)
         VALUES (?1,NULL,'completion',?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            record.id,
            record.provider,
            record.model,
            record.request_hash,
            record.response_hash,
            record.usage_json,
            record.latency_ms,
            record.provider_request_id,
            record.error_json,
            record.created_at,
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsageSummary {
    pub calls: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached_input_tokens: u64,
    pub reasoning_tokens: u64,
    pub estimated_calls: u64,
    /// Cached share of prompt tokens over calls with provider-reported usage
    /// only; `None` when no such prompt tokens exist.
    pub cache_hit_rate: Option<f64>,
}

/// Aggregate `usage_json` for rows created at or after `since` (all rows when
/// `None`). Each count is read only when the stored value is a JSON integer,
/// under the gateway's camelCase keys and the coach trace's keys (the coach
/// records its `TokenUsage` in camelCase). A count is clamped to
/// `[0, SQL_COUNT_CAP]` and sums are `TOTAL()`, which cannot overflow, so a bad
/// row can never make the summary fail.
pub fn llm_usage_summary(conn: &Connection, since: Option<&str>) -> DbResult<LlmUsageSummary> {
    let sql = format!(
        "WITH usage AS (
          SELECT
            {prompt} AS prompt,
            {completion} AS completion,
            {cached} AS cached,
            {reasoning} AS reasoning,
            CASE WHEN json_type(usage_json,'$.estimated') = 'true' THEN 1 ELSE 0 END AS estimated
          FROM llm_invocations
          WHERE ?1 IS NULL OR julianday(created_at) >= julianday(?1)
        )
        SELECT COUNT(*),
          TOTAL(prompt), TOTAL(completion),
          TOTAL(cached), TOTAL(reasoning),
          TOTAL(estimated),
          TOTAL(CASE WHEN estimated = 0 THEN cached ELSE 0 END),
          TOTAL(CASE WHEN estimated = 0 THEN prompt ELSE 0 END)
        FROM usage",
        prompt = count_expr(&["promptTokens", "inputTokens"]),
        completion = count_expr(&["completionTokens", "outputTokens"]),
        cached = count_expr(&["cachedInputTokens"]),
        reasoning = count_expr(&["reasoningTokens"]),
    );
    let totals = conn.query_row(&sql, [since], |row| {
        Ok(Totals {
            calls: row.get(0)?,
            prompt: row.get(1)?,
            completion: row.get(2)?,
            cached: row.get(3)?,
            reasoning: row.get(4)?,
            estimated: row.get(5)?,
            metered_cached: row.get(6)?,
            metered_prompt: row.get(7)?,
        })
    })?;
    let count = |value: f64| value.max(0.0) as u64;
    Ok(LlmUsageSummary {
        calls: totals.calls.max(0) as u64,
        prompt_tokens: count(totals.prompt),
        completion_tokens: count(totals.completion),
        cached_input_tokens: count(totals.cached),
        reasoning_tokens: count(totals.reasoning),
        estimated_calls: count(totals.estimated),
        // Clamped: a provider that reports more cached than prompt tokens must not
        // push the rate past 100%.
        cache_hit_rate: (totals.metered_prompt > 0.0)
            .then(|| (totals.metered_cached / totals.metered_prompt).clamp(0.0, 1.0)),
    })
}

/// Upper bound of one count in SQL: well above any real usage, far below the
/// range where sums would lose integer precision.
const SQL_COUNT_CAP: u64 = 4_000_000_000_000_000;

/// The first integer-valued key of `keys` in `usage_json`, clamped to
/// `[0, SQL_COUNT_CAP]`; 0 when none is an integer.
fn count_expr(keys: &[&str]) -> String {
    let typed = keys
        .iter()
        .map(|key| {
            format!(
                "CASE WHEN json_type(usage_json,'$.{key}') = 'integer' THEN json_extract(usage_json,'$.{key}') END"
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("MIN(MAX(COALESCE({typed}, 0), 0), {SQL_COUNT_CAP})")
}

struct Totals {
    calls: i64,
    prompt: f64,
    completion: f64,
    cached: f64,
    reasoning: f64,
    estimated: f64,
    metered_cached: f64,
    metered_prompt: f64,
}
