//! The weekly pass's forgetting sweep, against real SQLite: the three rules and their
//! exact boundaries, what is never forgotten, the audit trail, idempotence and the
//! all-or-nothing transaction.

use chrono::{DateTime, Duration, Utc};
use ielts_db::*;
use rusqlite::{params, Connection};

fn open() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("forget.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-11-04T12:00:00Z").unwrap().with_timezone(&Utc)
}

fn ago(delta: Duration) -> String {
    (now() - delta).to_rfc3339()
}

/// A memory row; every field a rule reads is spelled out by the test that needs it.
struct Row {
    id: &'static str,
    namespace: &'static str,
    source: &'static str,
    status: &'static str,
    state: &'static str,
    valid_to: Option<String>,
    observed: Option<String>,
    recalled: Option<String>,
    recalls: i64,
    user: &'static str,
}

fn row(id: &'static str) -> Row {
    Row {
        id,
        namespace: "strategy",
        source: "consolidated",
        status: "active",
        state: "baseline",
        valid_to: None,
        // Freshly observed unless a test says otherwise: no rule applies by default.
        observed: Some(ago(Duration::days(1))),
        recalled: None,
        recalls: 0,
        user: "local",
    }
}

fn insert(conn: &Connection, row: Row) {
    let quiet = ago(Duration::days(200));
    conn.execute(
        "INSERT INTO memory_items (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
            source_class,confidence,created_by,content_hash,created_at,updated_at,valid_to,last_observed_at,
            last_recalled_at,recall_count,improvement_state)
         VALUES (?1,?2,?3,'activity:reading','procedural',?1,'label','该学习者在判断题上需要先确认证据。',?4,
            ?5,0.5,'weekly_dream',?1,?6,?6,?7,?8,?9,?10,?11)",
        params![row.id, row.user, row.namespace, row.status, row.source, quiet, row.valid_to, row.observed, row.recalled, row.recalls, row.state],
    )
    .unwrap();
}

fn status(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT status FROM memory_items WHERE id = ?1", [id], |row| row.get(0)).unwrap()
}

fn sweep(conn: &Connection) -> ForgetReport {
    sweep_forgotten_memories(conn, "local", now()).unwrap()
}

#[test]
fn the_thresholds_are_the_documented_ones() {
    assert_eq!((IMPROVED_FORGET_DAYS, STALE_FORGET_DAYS, STALE_RECALL_FLOOR), (21, 90, 3));
}

#[test]
fn a_memory_expires_exactly_when_its_valid_to_comes() {
    let (_dir, conn) = open();
    insert(&conn, Row { valid_to: Some(now().to_rfc3339()), ..row("mem-due") });
    insert(&conn, Row { valid_to: Some((now() + Duration::seconds(1)).to_rfc3339()), ..row("mem-not-yet") });
    insert(&conn, Row { valid_to: Some((now() - Duration::days(40)).to_rfc3339()), ..row("mem-long-gone") });
    insert(&conn, row("mem-forever"));
    let report = sweep(&conn);
    assert_eq!(report, ForgetReport { expired: vec!["mem-due".into(), "mem-long-gone".into()], ..ForgetReport::default() });
    assert_eq!(report.total(), 2);
    assert_eq!(
        ["mem-due", "mem-long-gone", "mem-not-yet", "mem-forever"].map(|id| status(&conn, id)),
        ["archived", "archived", "active", "active"]
    );
}

#[test]
fn an_improved_memory_is_forgotten_only_after_twenty_one_quiet_days() {
    let (_dir, conn) = open();
    let improved = |id, observed: Duration| Row { state: "improved", observed: Some(ago(observed)), ..row(id) };
    insert(&conn, improved("mem-exactly-21", Duration::days(21)));
    insert(&conn, improved("mem-21-and-a-second", Duration::days(21) + Duration::seconds(1)));
    insert(&conn, improved("mem-recent", Duration::days(3)));
    // Better, then worse again: not improved any more, so not this rule's.
    insert(&conn, Row { state: "regressed", observed: Some(ago(Duration::days(60))), recalled: Some(ago(Duration::days(1))), ..row("mem-regressed") });
    // No `last_observed_at` at all: it ages from `updated_at` (200 days ago here).
    insert(&conn, Row { state: "improved", observed: None, ..row("mem-never-observed") });
    let report = sweep(&conn);
    assert_eq!(report.improved, vec!["mem-21-and-a-second".to_string(), "mem-never-observed".to_string()]);
    assert!(report.expired.is_empty() && report.stale.is_empty(), "{report:?}");
    assert_eq!(status(&conn, "mem-exactly-21"), "active");
    assert_eq!(status(&conn, "mem-recent"), "active");
    assert_eq!(status(&conn, "mem-regressed"), "active");
}

#[test]
fn a_quiet_memory_is_forgotten_after_ninety_days_and_fewer_than_three_recalls() {
    let (_dir, conn) = open();
    let quiet = |id, ns, observed: Duration, recalls| Row { namespace: ns, observed: Some(ago(observed)), recalls, ..row(id) };
    insert(&conn, quiet("mem-exactly-90", "strategy", Duration::days(90), 0));
    insert(&conn, quiet("mem-90-and-a-second", "strategy", Duration::days(90) + Duration::seconds(1), 0));
    insert(&conn, quiet("mem-two-recalls", "preference", Duration::days(120), 2));
    insert(&conn, quiet("mem-three-recalls", "preference", Duration::days(120), 3));
    insert(&conn, quiet("mem-behavior", "behavior", Duration::days(120), 0));
    insert(&conn, quiet("mem-meta", "metacognition", Duration::days(120), 0));
    let report = sweep(&conn);
    assert_eq!(
        report.stale,
        ["mem-90-and-a-second", "mem-behavior", "mem-meta", "mem-two-recalls"].map(String::from).to_vec()
    );
    assert_eq!(status(&conn, "mem-exactly-90"), "active", "ninety days to the second is not yet longer than ninety");
    assert_eq!(status(&conn, "mem-three-recalls"), "active", "three recalls is proof it is used");
}

#[test]
fn what_counts_as_quiet_is_the_latest_of_observed_and_recalled() {
    let (_dir, conn) = open();
    // Recalled long ago but observed again yesterday: the weekly pass still sees it.
    insert(&conn, Row { observed: Some(ago(Duration::days(1))), recalled: Some(ago(Duration::days(300))), ..row("mem-seen-lately") });
    // Observed long ago but recalled last week: the coach still uses it.
    insert(&conn, Row { observed: Some(ago(Duration::days(300))), recalled: Some(ago(Duration::days(7))), ..row("mem-used-lately") });
    insert(&conn, Row { observed: Some(ago(Duration::days(300))), recalled: Some(ago(Duration::days(100))), ..row("mem-both-old") });
    assert_eq!(sweep(&conn).stale, vec!["mem-both-old".to_string()]);
}

#[test]
fn the_learners_policy_goal_and_foreign_memories_are_never_forgotten() {
    let (_dir, conn) = open();
    // Every rule applies to each of them: expired, improved long ago, quiet and barely recalled.
    let doomed = |id: &'static str| Row {
        state: "improved",
        valid_to: Some(ago(Duration::days(10))),
        observed: Some(ago(Duration::days(400))),
        ..row(id)
    };
    insert(&conn, Row { source: "user_explicit", namespace: "preference", ..doomed("mem-learner") });
    insert(&conn, Row { source: "system_policy", namespace: "behavior", ..doomed("mem-policy") });
    insert(&conn, Row { namespace: "goal", valid_to: None, ..doomed("mem-goal") });
    insert(&conn, Row { user: "someone-else", ..doomed("mem-foreign") });
    let report = sweep(&conn);
    // The goal is improved long ago, so only that rule may take it; expiry is not set on it and quietness never applies.
    assert_eq!(report.improved, vec!["mem-goal".to_string()]);
    assert!(report.expired.is_empty() && report.stale.is_empty(), "{report:?}");
    for kept in ["mem-learner", "mem-policy", "mem-foreign"] {
        assert_eq!(status(&conn, kept), "active", "{kept}");
    }

    // A goal that is merely quiet stays, and so do the namespaces the stale rule does not cover.
    let (_dir, conn) = open();
    insert(&conn, Row { namespace: "goal", observed: Some(ago(Duration::days(400))), ..row("mem-quiet-goal") });
    insert(&conn, Row { namespace: "knowledge", observed: Some(ago(Duration::days(400))), ..row("mem-knowledge") });
    insert(&conn, Row { namespace: "language", observed: Some(ago(Duration::days(400))), ..row("mem-language") });
    // A prediction is a hypothesis nobody shows: it is neither outgrown nor stale.
    insert(&conn, Row { source: "predicted", state: "improved", observed: Some(ago(Duration::days(400))), ..row("mem-predicted") });
    assert_eq!(sweep(&conn), ForgetReport::default());
}

#[test]
fn only_active_memories_are_considered() {
    let (_dir, conn) = open();
    for (id, state) in [("mem-superseded", "superseded"), ("mem-archived", "archived"), ("mem-rejected", "rejected")] {
        insert(&conn, Row { status: state, valid_to: Some(ago(Duration::days(5))), ..row(id) });
    }
    assert_eq!(sweep(&conn), ForgetReport::default());
    assert_eq!(status(&conn, "mem-superseded"), "superseded", "a superseded memory is not turned into an archived one");
}

#[test]
fn a_memory_that_matches_two_rules_is_archived_once_under_the_first_reason() {
    let (_dir, conn) = open();
    insert(&conn, Row { valid_to: Some(ago(Duration::days(1))), observed: Some(ago(Duration::days(200))), ..row("mem-both") });
    let report = sweep(&conn);
    assert_eq!((report.expired.len(), report.improved.len(), report.stale.len()), (1, 0, 0));
    let reasons: Vec<String> = conn
        .prepare("SELECT reason FROM memory_mutations WHERE memory_id = 'mem-both'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(reasons, vec!["expired".to_string()]);
}

#[test]
fn every_forgotten_memory_leaves_one_audit_row_with_its_reason_and_keeps_its_content() {
    let (_dir, conn) = open();
    insert(&conn, Row { valid_to: Some(ago(Duration::days(1))), ..row("mem-a-expired") });
    insert(&conn, Row { state: "improved", observed: Some(ago(Duration::days(30))), ..row("mem-b-improved") });
    insert(&conn, Row { observed: Some(ago(Duration::days(100))), ..row("mem-c-stale") });
    insert(&conn, row("mem-d-kept"));
    let report = sweep(&conn);
    assert_eq!(report.total(), 3);

    for (id, reason) in [("mem-a-expired", "expired"), ("mem-b-improved", "improved"), ("mem-c-stale", "stale")] {
        let (status, version, content): (String, i64, String) = conn
            .query_row("SELECT status, version, content FROM memory_items WHERE id = ?1", [id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        assert_eq!((status.as_str(), version), ("archived", 2), "{id}");
        assert_eq!(content, "该学习者在判断题上需要先确认证据。", "forgetting archives, it never deletes or redacts");
        let audit: Vec<(String, String, String, Option<String>, String, String)> = conn
            .prepare(
                "SELECT operation, actor_type, reason, actor_id, before_json, after_json FROM memory_mutations WHERE memory_id = ?1",
            )
            .unwrap()
            .query_map([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(audit.len(), 1, "{id}");
        let (operation, actor, why, actor_id, before, after) = &audit[0];
        assert_eq!((operation.as_str(), actor.as_str(), why.as_str()), ("archive", "dream", reason));
        assert_eq!(actor_id.as_deref(), Some("weekly_dream"));
        assert!(before.contains("\"active\"") && after.contains("\"archived\""), "{before} -> {after}");
    }
    let untouched: i64 = conn.query_row("SELECT COUNT(*) FROM memory_mutations WHERE memory_id = 'mem-d-kept'", [], |row| row.get(0)).unwrap();
    assert_eq!(untouched, 0);
}

fn snapshot(conn: &Connection) -> Vec<Vec<String>> {
    ["memory_items", "memory_mutations"]
        .into_iter()
        .map(|table| {
            let mut statement = conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid")).unwrap();
            let columns = statement.column_count();
            let rows = statement
                .query_map([], |row| {
                    (0..columns).map(|index| row.get::<_, rusqlite::types::Value>(index).map(|v| format!("{v:?}"))).collect::<Result<Vec<_>, _>>()
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            rows.into_iter().map(|row| row.join("|")).collect()
        })
        .collect()
}

#[test]
fn the_sweep_is_idempotent() {
    let (_dir, conn) = open();
    insert(&conn, Row { valid_to: Some(ago(Duration::days(1))), ..row("mem-a") });
    insert(&conn, Row { state: "improved", observed: Some(ago(Duration::days(30))), ..row("mem-b") });
    insert(&conn, Row { observed: Some(ago(Duration::days(100))), ..row("mem-c") });
    let first = sweep(&conn);
    assert_eq!(first.total(), 3);
    let after_first = snapshot(&conn);
    assert_eq!(sweep(&conn), ForgetReport::default());
    assert_eq!(snapshot(&conn), after_first, "a second run at the same time changes nothing at all");
    // And later in time, with nothing new to forget, it still does not touch the archived rows.
    assert_eq!(sweep_forgotten_memories(&conn, "local", now() + Duration::days(400)).unwrap(), ForgetReport::default());
    assert_eq!(snapshot(&conn), after_first);
}

#[test]
fn a_failure_in_the_middle_archives_nothing() {
    let (_dir, conn) = open();
    insert(&conn, Row { valid_to: Some(ago(Duration::days(1))), ..row("mem-a-fine") });
    insert(&conn, Row { state: "improved", observed: Some(ago(Duration::days(30))), ..row("mem-z-boom") });
    conn.execute_batch(
        "CREATE TRIGGER boom BEFORE UPDATE ON memory_items WHEN NEW.id = 'mem-z-boom' AND NEW.status = 'archived'
         BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    let before = snapshot(&conn);
    assert!(sweep_forgotten_memories(&conn, "local", now()).is_err());
    assert_eq!(snapshot(&conn), before, "the first rule's archive was rolled back with the failure");
    assert_eq!(status(&conn, "mem-a-fine"), "active");

    // Once the cause is gone the next run does the whole job.
    conn.execute_batch("DROP TRIGGER boom").unwrap();
    assert_eq!(sweep(&conn).total(), 2);
}

#[test]
fn a_memory_at_any_version_is_archived_once_at_that_version_plus_one() {
    let (_dir, conn) = open();
    insert(&conn, Row { valid_to: Some(ago(Duration::days(1))), ..row("mem-moved") });
    conn.execute("UPDATE memory_items SET version = 5 WHERE id = 'mem-moved'", []).unwrap();
    assert_eq!(sweep(&conn).expired, vec!["mem-moved".to_string()]);
    let version: i64 = conn.query_row("SELECT version FROM memory_items WHERE id = 'mem-moved'", [], |row| row.get(0)).unwrap();
    assert_eq!(version, 6);
}
