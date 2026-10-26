use ielts_db::{
    llm_usage_summary, migrate, open_connection, prune_operational_records, record_llm_invocation,
    DbOpenOptions, LlmInvocationRecord, OPERATIONAL_RETENTION_DAYS,
};
use rusqlite::Connection;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn record(id: &str, created_at: &str, usage_json: Option<&str>) -> LlmInvocationRecord {
    LlmInvocationRecord {
        id: id.into(),
        provider: "openai-compatible".into(),
        model: "m".into(),
        request_hash: format!("req-{id}"),
        response_hash: usage_json.map(|_| format!("res-{id}")),
        usage_json: usage_json.map(str::to_string),
        latency_ms: 12,
        provider_request_id: None,
        error_json: usage_json.is_none().then(|| r#"{"message":"down","retryable":true}"#.into()),
        created_at: created_at.into(),
    }
}

#[test]
fn ledger_rows_aggregate_usage_cache_hits_and_estimates() {
    let (_dir, conn) = open_db();
    let fresh = "2026-10-01T00:00:00+00:00";
    let old = "2025-01-01T00:00:00+00:00";
    let provider = r#"{"promptTokens":100,"completionTokens":10,"totalTokens":110,"cachedInputTokens":60,"reasoningTokens":4}"#;
    let estimated = r#"{"promptTokens":50,"completionTokens":5,"totalTokens":55,"estimated":true}"#;
    // Coach trace rows keep the legacy snake_case TokenUsage keys.
    let legacy_coach = r#"{"input_tokens":40,"output_tokens":2,"cached_input_tokens":20}"#;
    let ancient = r#"{"promptTokens":1000,"completionTokens":0,"totalTokens":1000,"cachedInputTokens":1000}"#;
    for row in [
        record("a", fresh, Some(provider)),
        record("b", fresh, Some(estimated)),
        record("c", fresh, Some(legacy_coach)),
        record("d", fresh, None),
        record("e", old, Some(ancient)),
    ] {
        record_llm_invocation(&conn, &row).unwrap();
    }
    let run_scoped: i64 = conn
        .query_row("SELECT COUNT(*) FROM llm_invocations WHERE run_id IS NOT NULL", [], |row| row.get(0))
        .unwrap();
    assert_eq!(run_scoped, 0, "gateway rows carry no run id");

    let all = llm_usage_summary(&conn, None).unwrap();
    assert_eq!(all.calls, 5);
    assert_eq!(all.prompt_tokens, 1190);
    assert_eq!(all.completion_tokens, 17);
    assert_eq!(all.cached_input_tokens, 1080);
    assert_eq!(all.reasoning_tokens, 4);
    assert_eq!(all.estimated_calls, 1);
    assert_eq!(all.cache_hit_rate, Some(1080.0 / 1140.0));

    // The window drops the old row; the estimate stays out of the hit-rate denominator.
    let window = llm_usage_summary(&conn, Some("2026-01-01T00:00:00+00:00")).unwrap();
    assert_eq!((window.calls, window.prompt_tokens, window.cached_input_tokens), (4, 190, 80));
    assert_eq!(window.cache_hit_rate, Some(80.0 / 140.0));

    let empty = llm_usage_summary(&conn, Some("2030-01-01T00:00:00+00:00")).unwrap();
    assert_eq!((empty.calls, empty.cache_hit_rate), (0, None));

    let json = serde_json::to_value(&window).unwrap();
    assert_eq!(json["cacheHitRate"], serde_json::json!(80.0 / 140.0));
    assert_eq!(json["estimatedCalls"], serde_json::json!(1));
}

#[test]
fn ledger_rows_follow_operational_retention() {
    let (_dir, conn) = open_db();
    record_llm_invocation(&conn, &record("old", "2025-01-01T00:00:00+00:00", Some("{}"))).unwrap();
    record_llm_invocation(&conn, &record("new", "2026-10-01T00:00:00+00:00", Some("{}"))).unwrap();
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-26T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let report = prune_operational_records(&conn, now, OPERATIONAL_RETENTION_DAYS).unwrap();
    assert_eq!(report.llm_invocations, 1);
    assert_eq!(llm_usage_summary(&conn, None).unwrap().calls, 1);
}
