use ielts_db::{
    append_coach_message, begin_coach_trace, complete_traced_coach, ensure_coach_thread, llm_usage_summary,
    migrate, open_connection, prune_operational_records, record_llm_invocation,
    AppendCoachMessageCommand, DbOpenOptions, EnsureCoachThreadCommand, LlmInvocationRecord,
    OPERATIONAL_RETENTION_DAYS,
};
use rusqlite::Connection;
use serde_json::json;
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

/// One coach row written through the real trace path: `begin_coach_trace` and
/// `complete_traced_coach`, with the coach's own camelCase `TokenUsage`.
fn write_coach_trace_row(conn: &Connection, created_at: &str) {
    let thread = ensure_coach_thread(
        conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: None,
            asset_id: None,
            kind: "chat".into(),
        },
    )
    .unwrap();
    let user = append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.id.clone(),
            role: "user".into(),
            content: "why".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap();
    let run = begin_coach_trace(
        conn,
        &thread.id,
        &user.id,
        &json!({"messages":[{"role":"user","content":"why"}]}),
        "fake-provider",
        "requested-model",
        30_000,
    )
    .unwrap();
    let response = json!({
        "content": "{\"answer\":\"because\"}",
        "model": "actual-model",
        "latencyMs": 42,
        "retryCount": 0,
        "usage": {"inputTokens": 40, "outputTokens": 2, "cachedInputTokens": 20},
        "providerRequestId": "request-42"
    });
    complete_traced_coach(conn, &run, &thread.id, "because", json!({}), &response).unwrap();
    conn.execute(
        "UPDATE llm_invocations SET created_at = ?1 WHERE run_id IS NOT NULL",
        [created_at],
    )
    .unwrap();
}

#[test]
fn ledger_rows_aggregate_usage_cache_hits_and_estimates() {
    let (_dir, conn) = open_db();
    let fresh = "2026-10-01T00:00:00+00:00";
    let old = "2025-01-01T00:00:00+00:00";
    let provider = r#"{"promptTokens":100,"completionTokens":10,"totalTokens":110,"cachedInputTokens":60,"reasoningTokens":4}"#;
    let estimated = r#"{"promptTokens":50,"completionTokens":5,"totalTokens":55,"estimated":true}"#;
    let ancient = r#"{"promptTokens":1000,"completionTokens":0,"totalTokens":1000,"cachedInputTokens":1000}"#;
    record_llm_invocation(&conn, &record("a", fresh, Some(provider))).unwrap();
    record_llm_invocation(&conn, &record("b", fresh, Some(estimated))).unwrap();
    record_llm_invocation(&conn, &record("d", fresh, None)).unwrap();
    record_llm_invocation(&conn, &record("e", old, Some(ancient))).unwrap();
    write_coach_trace_row(&conn, fresh);
    let run_scoped: i64 = conn
        .query_row("SELECT COUNT(*) FROM llm_invocations WHERE run_id IS NOT NULL", [], |row| row.get(0))
        .unwrap();
    assert_eq!(run_scoped, 1, "the coach row is the traced one");

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
fn hostile_usage_values_are_skipped_or_clamped_and_never_fail_the_summary() {
    let (_dir, conn) = open_db();
    let at = "2026-10-01T00:00:00+00:00";
    let rows = [
        // A string count is not a count.
        r#"{"promptTokens":"12","completionTokens":1}"#,
        // A negative count contributes nothing.
        r#"{"promptTokens":-5,"completionTokens":-1}"#,
        // u64::MAX reads as an integer in SQLite and is clamped to the cap.
        r#"{"promptTokens":18446744073709551615,"completionTokens":1}"#,
        // i64::MAX is an integer and is clamped to the SQL cap.
        r#"{"promptTokens":9223372036854775807,"completionTokens":9223372036854775807}"#,
        // A non-boolean "estimated" is not an estimate.
        r#"{"promptTokens":7,"estimated":"yes"}"#,
    ];
    for (index, usage) in rows.iter().enumerate() {
        record_llm_invocation(&conn, &record(&format!("hostile-{index}"), at, Some(usage))).unwrap();
    }
    let summary = llm_usage_summary(&conn, None).unwrap();
    // Exact: two capped prompts (4e15 each) and the small counts. The string
    // and the negative contribute nothing.
    let cap = 4_000_000_000_000_000u64;
    assert_eq!(summary.calls, 5);
    assert_eq!(summary.prompt_tokens, 2 * cap + 7);
    assert_eq!(summary.completion_tokens, cap + 2);
    assert_eq!(summary.estimated_calls, 0, "a string flag is not an estimate");
}

#[test]
fn many_capped_rows_never_overflow_the_summary() {
    let (_dir, conn) = open_db();
    let at = "2026-10-01T00:00:00+00:00";
    let usage = r#"{"promptTokens":9223372036854775807,"completionTokens":9223372036854775807}"#;
    for index in 0..2_000 {
        record_llm_invocation(&conn, &record(&format!("cap-{index}"), at, Some(usage))).unwrap();
    }
    // Each row is clamped to the cap, so the total (8e18) would overflow an i64
    // SUM. The summary still answers: the sum is a float, so it is approximate
    // past 2^53 tokens, which no real ledger reaches.
    let summary = llm_usage_summary(&conn, None).expect("capped rows must not fail the summary");
    assert_eq!(summary.calls, 2_000);
    let cap = 4_000_000_000_000_000f64;
    assert!((summary.prompt_tokens as f64 - cap * 2_000.0).abs() / (cap * 2_000.0) < 1e-9);
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

#[test]
fn cache_hit_rate_is_clamped_to_one() {
    let (_dir, conn) = open_db();
    // A provider reporting more cached than prompt tokens must not push the rate past 100%.
    let overreported = r#"{"promptTokens":100,"completionTokens":1,"totalTokens":101,"cachedInputTokens":150}"#;
    record_llm_invocation(&conn, &record("over", "2026-10-01T00:00:00+00:00", Some(overreported))).unwrap();
    let summary = llm_usage_summary(&conn, None).unwrap();
    assert_eq!(summary.cache_hit_rate, Some(1.0));
    assert_eq!(summary.cached_input_tokens, 150);
}
