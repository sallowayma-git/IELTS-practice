//! Unified LLM usage ledger over `llm_invocations`.
//!
//! One row per gateway call that its caller did not trace itself (the coach
//! trace owns its own row). Rows hold hashes and counts, never prompt text.
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::sqlite::DbResult;

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
/// `None`). Coach trace rows store the legacy snake_case keys; both spellings
/// are read so their spend is counted.
pub fn llm_usage_summary(conn: &Connection, since: Option<&str>) -> DbResult<LlmUsageSummary> {
    const SQL: &str = "
        WITH usage AS (
          SELECT
            COALESCE(json_extract(usage_json,'$.promptTokens'), json_extract(usage_json,'$.input_tokens'), 0) AS prompt,
            COALESCE(json_extract(usage_json,'$.completionTokens'), json_extract(usage_json,'$.output_tokens'), 0) AS completion,
            COALESCE(json_extract(usage_json,'$.cachedInputTokens'), json_extract(usage_json,'$.cached_input_tokens'), 0) AS cached,
            COALESCE(json_extract(usage_json,'$.reasoningTokens'), json_extract(usage_json,'$.reasoning_tokens'), 0) AS reasoning,
            COALESCE(json_extract(usage_json,'$.estimated'), 0) AS estimated
          FROM llm_invocations
          WHERE ?1 IS NULL OR julianday(created_at) >= julianday(?1)
        )
        SELECT COUNT(*),
          COALESCE(SUM(prompt),0), COALESCE(SUM(completion),0),
          COALESCE(SUM(cached),0), COALESCE(SUM(reasoning),0),
          COALESCE(SUM(estimated),0),
          COALESCE(SUM(CASE WHEN estimated = 0 THEN cached END),0),
          COALESCE(SUM(CASE WHEN estimated = 0 THEN prompt END),0)
        FROM usage";
    let totals = conn.query_row(SQL, [since], |row| {
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
    let count = |value: i64| value.max(0) as u64;
    Ok(LlmUsageSummary {
        calls: count(totals.calls),
        prompt_tokens: count(totals.prompt),
        completion_tokens: count(totals.completion),
        cached_input_tokens: count(totals.cached),
        reasoning_tokens: count(totals.reasoning),
        estimated_calls: count(totals.estimated),
        // Clamped: a provider that reports more cached than prompt tokens must not
        // push the rate past 100%.
        cache_hit_rate: (totals.metered_prompt > 0)
            .then(|| (totals.metered_cached as f64 / totals.metered_prompt as f64).min(1.0)),
    })
}

struct Totals {
    calls: i64,
    prompt: i64,
    completion: i64,
    cached: i64,
    reasoning: i64,
    estimated: i64,
    metered_cached: i64,
    metered_prompt: i64,
}
