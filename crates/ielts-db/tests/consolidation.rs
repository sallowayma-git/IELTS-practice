//! M8 Weekly Dream consolidation tests (§23.16 / §23.17).
//!
//! Covers the M8 test list: min-supports rejection, same-asset-isn't-independent,
//! cross-scope validation, stable-ID re-validation, hallucinated ID rejection,
//! predicted-only support blocked, superseded support blocked, consolidation
//! preserves lineage (no physical delete), user refute archives without deleting
//! learning facts, empty output is success (M8-01).

use ielts_db::{migrate, open_connection, record_memory_feedback, DbOpenOptions};
use ielts_domain::MemoryFeedbackKind;
use rusqlite::params;
use serde_json::json;
use tempfile::tempdir;

const NOW: &str = "2026-08-16T10:00:00+00:00";
/// The owner every fixture row below belongs to. `insert_memory` writes
/// `user_id='local'`, and the validator is now scoped by owner, so a support
/// belonging to anybody else reads as a hallucinated id.
const USER: &str = "local";

fn support_graph(conn: &rusqlite::Connection) {
    for (id, status) in [("mem-a", "superseded"), ("mem-b", "superseded"),
        ("mem-c", "active"), ("mem-unrelated", "active"), ("mem-other", "active"),
        ("mem-beyond-other", "active")] {
        insert_memory(conn, id, "consolidated", "activity:reading", "asset", status);
    }
    conn.execute("UPDATE memory_items SET user_id='other' WHERE id='mem-other'", []).unwrap();
    for (source, target, kind) in [("mem-a", "mem-b", "supports_consolidation"),
        ("mem-b", "mem-c", "supports_consolidation"),
        ("mem-a", "mem-a", "supports_consolidation"),
        ("mem-b", "mem-a", "supports_consolidation"),
        ("mem-a", "mem-other", "supports_consolidation"),
        ("mem-other", "mem-beyond-other", "supports_consolidation"),
        ("mem-a", "mem-unrelated", "contradicts")] {
        conn.execute("INSERT INTO memory_relations
            (id,source_memory_id,target_memory_id,relation_kind,created_at)
            VALUES (?1,?2,?3,?4,?5)",
            params![format!("mrel-{source}-{target}"),source,target,kind,NOW]).unwrap();
    }
}

fn lifecycle_action(conn: &rusqlite::Connection, action: &str) -> ielts_db::DbResult<()> {
    match action {
        "archive" => ielts_db::archive_memory(conn, &ielts_domain::MemoryArchiveCommand {
            memory_id: "mem-a".into(), expected_version: 1, actor_type: "user".into(),
            actor_id: Some(USER.into()), reason: "user archive".into(),
        }),
        "forget" => ielts_db::forget_memory(conn, &ielts_domain::MemoryForgetCommand {
            memory_id: "mem-a".into(), expected_version: 1, actor_type: "user".into(),
            actor_id: Some(USER.into()), reason: "user forget".into(),
        }),
        "inaccurate" => record_memory_feedback(conn, "mem-a", MemoryFeedbackKind::Inaccurate,
            USER, &json!({}), NOW).map(|_| ()),
        _ => panic!("unknown test action"),
    }
}

fn memory_state(conn: &rusqlite::Connection, id: &str) -> (String, i64, String) {
    conn.query_row("SELECT status,version,content FROM memory_items WHERE id=?1",
        [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap()
}

#[test]
fn lifecycle_invalidates_transitive_supports_once_without_crossing_owners() {
    for action in ["archive", "forget", "inaccurate"] {
        let (_dir, conn) = open_db();
        support_graph(&conn);
        lifecycle_action(&conn, action).unwrap();
        for id in ["mem-b", "mem-c"] {
            assert_eq!(memory_state(&conn, id), ("archived".into(),2,format!("content-{id}")), "{action}");
        }
        let source = memory_state(&conn, "mem-a");
        assert_eq!(source.0, if action == "forget" { "deleted" } else { "archived" });
        assert_eq!(source.1, 2, "cycle must not mutate the source again");
        for id in ["mem-other", "mem-beyond-other", "mem-unrelated"] {
            assert_eq!(memory_state(&conn, id).0, "active", "{action}: {id}");
            assert_eq!(memory_state(&conn, id).1, 1);
        }
        let relation_count: i64 = conn.query_row("SELECT COUNT(*) FROM memory_relations", [], |r| r.get(0)).unwrap();
        assert_eq!(relation_count, 7, "lineage survives {action}");
        let archived_audits: i64 = conn.query_row("SELECT COUNT(*) FROM memory_mutations
            WHERE operation='archive' AND memory_id IN ('mem-b','mem-c')", [], |r| r.get(0)).unwrap();
        assert_eq!(archived_audits, 2);
        let context = ielts_db::memory_context_preview(&conn, &ielts_domain::MemoryContextQuery {
            user_id: USER.into(), activity: ielts_domain::Activity::Reading,
            current_instruction: None, limit: 100,
        }).unwrap();
        assert!(!context.entries.iter().any(|e| matches!(e.id.as_deref(), Some("mem-a" | "mem-b" | "mem-c"))));
    }
}

#[test]
fn lifecycle_failure_rolls_back_source_feedback_audit_and_all_dependents() {
    for action in ["archive", "forget", "inaccurate"] {
        let (_dir, conn) = open_db();
        support_graph(&conn);
        conn.execute_batch("CREATE TRIGGER fail_late_dependent BEFORE UPDATE ON memory_items
            WHEN OLD.id='mem-c' BEGIN SELECT RAISE(ABORT,'test propagation failure'); END;").unwrap();
        assert!(lifecycle_action(&conn, action).is_err());
        for (id, status) in [("mem-a","superseded"),("mem-b","superseded"),("mem-c","active")] {
            assert_eq!(memory_state(&conn, id), (status.into(),1,format!("content-{id}")), "{action}");
        }
        for table in ["memory_feedback", "memory_mutations"] {
            let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(count, 0, "{action} must not leave {table}");
        }
    }
}

#[test]
fn feedback_rejects_foreign_or_deleted_memory_and_preserves_positive_feedback() {
    let (_dir, conn) = open_db();
    support_graph(&conn);
    assert!(record_memory_feedback(&conn, "mem-a", MemoryFeedbackKind::Inaccurate,
        "other", &json!({}), NOW).is_err());
    record_memory_feedback(&conn, "mem-c", MemoryFeedbackKind::Accurate, USER, &json!({}), NOW).unwrap();
    assert_eq!(memory_state(&conn, "mem-c").0, "active");
    lifecycle_action(&conn, "forget").unwrap();
    assert!(record_memory_feedback(&conn, "mem-a", MemoryFeedbackKind::Accurate,
        USER, &json!({}), NOW).is_err());
}

#[test]
fn outdated_and_not_about_me_stop_source_and_dependents() {
    for kind in [MemoryFeedbackKind::Outdated, MemoryFeedbackKind::NotAboutMe] {
        let (_dir, conn) = open_db();
        support_graph(&conn);
        record_memory_feedback(&conn, "mem-a", kind, USER, &json!({}), NOW).unwrap();
        for id in ["mem-a", "mem-b", "mem-c"] {
            assert_eq!(memory_state(&conn,id).0, "archived");
        }
    }
}

#[test]
fn stale_sweep_counts_and_audits_transitive_archives() {
    let (_dir, conn) = open_db();
    support_graph(&conn);
    conn.execute("UPDATE memory_items SET namespace='behavior',status='active',
        updated_at='2020-01-01T00:00:00Z',created_at='2020-01-01T00:00:00Z'
        WHERE id='mem-a'", []).unwrap();
    let report = ielts_db::archive_stale(&conn, NOW).unwrap();
    assert_eq!(report.archived_count, 3);
    for id in ["mem-a", "mem-b", "mem-c"] {
        assert_eq!(memory_state(&conn,id).0, "archived");
    }
    let audits: i64 = conn.query_row("SELECT COUNT(*) FROM memory_mutations WHERE operation='archive'", [], |r| r.get(0)).unwrap();
    assert_eq!(audits, 3);
    assert_eq!(ielts_db::archive_stale(&conn,NOW).unwrap().archived_count, 0);
}


fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("consol.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn insert_memory(
    conn: &rusqlite::Connection,
    id: &str,
    source_class: &str,
    scope: &str,
    subject_key: &str,
    status: &str,
) {
    conn.execute(
        "INSERT INTO memory_items (
            id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
            content, status, source_class, confidence, importance, source_trust,
            sensitivity, improvement_state, version, created_by, content_hash,
            created_at, updated_at, subject_key
         ) VALUES (?1,'local','strategy',?2,'procedural',?3,?4,?5,?6,?7,0.7,0.5,0.7,
                   'normal','baseline',1,'test',?8,?9,?9,?10)",
        params![
            id,
            scope,
            format!("key-{id}"),
            format!("label-{id}"),
            format!("content-{id}"),
            status,
            source_class,
            format!("hash-{id}"),
            NOW,
            subject_key,
        ],
    )
    .unwrap();
    attach_practice(conn, id, subject_key, if scope.contains("writing") { "writing" } else { "reading" });
}

fn attach_practice(conn: &rusqlite::Connection, id: &str, asset: &str, activity: &str) {
    let attempt = format!("attempt-{id}");
    let event = format!("event-{id}");
    let observation = format!("obs-{id}");
    let skill = format!("test.{activity}");
    conn.execute("INSERT OR IGNORE INTO practice_assets
        (id,activity,source_kind,title,schema_version,fingerprint,created_at,updated_at)
        VALUES (?1,?2,'builtin',?1,1,?1,?3,?3)", params![asset,activity,NOW]).unwrap();
    conn.execute("INSERT OR IGNORE INTO skill_catalog
        (skill_key,activity,label,description,taxonomy_version,mapping_source)
        VALUES (?1,?2,?1,?1,1,'manual')", params![skill,activity]).unwrap();
    conn.execute("INSERT INTO attempts
        (id,activity,asset_id,mode,status,started_at,completed_at,schema_version,created_at,updated_at)
        VALUES (?1,?2,?3,'single','completed',?4,?4,1,?4,?4)",
        params![attempt,activity,asset,NOW]).unwrap();
    conn.execute("INSERT INTO attempt_answers (attempt_id,question_id,answer_json,is_correct)
        VALUES (?1,'q1','\"answer\"',0)", [&attempt]).unwrap();
    conn.execute("INSERT INTO learning_events
        (id,user_id,event_type,source_kind,idempotency_key,activity,asset_id,attempt_id,
         question_id,skill_key,occurred_at,payload_json,content_hash,created_at,updated_at)
        VALUES (?1,?2,'reading_question_outcome','test',?1,?3,?4,?5,'q1',?6,?7,'{}',?1,?7,?7)",
        params![event,USER,activity,asset,attempt,skill,NOW]).unwrap();
    conn.execute("INSERT INTO learner_observations
        (id,user_id,observation_type,namespace,scope_kind,scope_key,payload_json,observed_at,
         projector_key,projector_version,source_fingerprint,created_at)
        VALUES (?1,?2,'practice','strategy','skill',?3,'{}',?4,'test',1,?1,?4)",
        params![observation,USER,skill,NOW]).unwrap();
    conn.execute("INSERT INTO learner_observation_evidence (observation_id,event_id)
        VALUES (?1,?2)", params![observation,event]).unwrap();
    conn.execute("INSERT INTO memory_evidence
        (memory_id,observation_id,source_fingerprint,projector_key,projector_version,
         event_ids_json,evidence_hash,created_at)
        VALUES (?1,?2,?2,'test',1,?3,?2,?4)",
        params![id,observation,json!([event]).to_string(),NOW]).unwrap();
}


/// Insert an active row in an arbitrary namespace with an explicit write time
/// and `last_observed_at` left NULL. This is the exact shape
/// `apply_consolidation` writes, and the shape the stale sweep must age from
/// `created_at`/`updated_at` rather than treat as infinitely stale.
fn insert_memory_aged(
    conn: &rusqlite::Connection,
    id: &str,
    namespace: &str,
    written_at: &str,
) {
    conn.execute(
        "INSERT INTO memory_items (
            id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
            content, status, source_class, confidence, importance, source_trust,
            sensitivity, improvement_state, version, created_by, content_hash,
            created_at, updated_at
         ) VALUES (?1,'local',?2,'consolidated','procedural',?3,?4,?5,'active',
                   'consolidated',0.7,0.5,0.7,'normal','baseline',1,'test',?6,?7,?7)",
        params![
            id,
            namespace,
            format!("key-{id}"),
            format!("label-{id}"),
            format!("content-{id}"),
            format!("hash-{id}"),
            written_at,
        ],
    )
    .unwrap();
}

fn set_last_observed(conn: &rusqlite::Connection, id: &str, observed_at: &str) {
    conn.execute(
        "UPDATE memory_items SET last_observed_at=?2 WHERE id=?1",
        params![id, observed_at],
    )
    .unwrap();
}

fn status_of(conn: &rusqlite::Connection, id: &str) -> String {
    conn.query_row(
        "SELECT status FROM memory_items WHERE id=?1",
        params![id],
        |row| row.get(0),
    )
    .unwrap()
}



#[test]
fn user_refute_inaccurate_does_not_delete_learning_facts() {
    let (_dir, conn) = open_db();
    insert_memory(&conn,"mem-a","observed","reading","asset-1","active");
    let record = record_memory_feedback(
        &conn,
        "mem-a",
        MemoryFeedbackKind::Inaccurate,
        "local",
        &json!({"note":"wrong"}),
        NOW,
    )
    .unwrap();
    assert_eq!(record.feedback_kind, MemoryFeedbackKind::Inaccurate);
    // The memory row still exists (not deleted).
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_items WHERE id='mem-a'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(exists, 1);
    // Feedback row recorded.
    let feedback_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_feedback WHERE memory_id='mem-a'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(feedback_count, 1);
}

#[test]
fn archive_stale_matches_namespace_not_memory_type() {
    let (_dir, conn) = open_db();
    // namespace='strategy' (medium => 60 days), memory_type='procedural'.
    insert_memory(&conn, "mem-old", "observed", "reading", "asset-1", "active");
    set_last_observed(&conn, "mem-old", "2026-01-01T00:00:00+00:00");

    let report = ielts_db::archive_stale(&conn, NOW).unwrap();

    assert_eq!(
        report.archived_count, 1,
        "stale strategy-namespace memory must archive; binding the kind to \
         memory_type matched zero rows"
    );
    assert_eq!(status_of(&conn, "mem-old"), "archived");
    // preference/goal are never auto-archived (never_auto / validity_driven).
    assert!(report.skipped_kinds.contains(&"preference".to_string()));
    assert!(report.skipped_kinds.contains(&"goal".to_string()));
    // The report must actually carry the per-kind policy it resolved.
    assert!(
        report
            .policy_by_kind
            .iter()
            .any(|(kind, policy)| kind == "strategy" && policy == "medium"),
        "policy_by_kind was hardcoded empty: {:?}",
        report.policy_by_kind
    );
}

#[test]
fn archive_stale_keeps_recent_and_non_active_memories() {
    let (_dir, conn) = open_db();
    insert_memory(&conn, "mem-fresh", "observed", "reading", "asset-1", "active");
    set_last_observed(&conn, "mem-fresh", NOW);
    insert_memory(
        &conn,
        "mem-superseded",
        "observed",
        "reading",
        "asset-2",
        "superseded",
    );
    set_last_observed(&conn, "mem-superseded", "2026-01-01T00:00:00+00:00");

    let report = ielts_db::archive_stale(&conn, NOW).unwrap();

    assert_eq!(report.archived_count, 0);
    assert_eq!(status_of(&conn, "mem-fresh"), "active");
    assert_eq!(
        status_of(&conn, "mem-superseded"),
        "superseded",
        "the sweep only touches active rows"
    );
}



#[test]
fn archive_stale_ages_a_never_observed_row_from_its_write_time() {
    let (_dir, conn) = open_db();
    // strategy => medium => 60 days. NOW is 2026-08-16.
    insert_memory_aged(&conn, "mem-recent", "strategy", "2026-08-01T00:00:00+00:00");
    insert_memory_aged(&conn, "mem-ancient", "strategy", "2026-01-01T00:00:00+00:00");

    let report = ielts_db::archive_stale(&conn, NOW).unwrap();

    assert_eq!(report.archived_count, 1);
    assert_eq!(
        status_of(&conn, "mem-recent"),
        "active",
        "written 15 days ago, inside the 60-day window"
    );
    assert_eq!(
        status_of(&conn, "mem-ancient"),
        "archived",
        "written 227 days ago, outside the 60-day window"
    );
}


#[test]
fn archive_stale_applies_the_per_namespace_policy_window() {
    let (_dir, conn) = open_db();
    // 40 days before NOW: past behavior's 21d, inside knowledge's 120d.
    let forty_days_ago = "2026-07-07T00:00:00+00:00";
    insert_memory_aged(&conn, "mem-behavior", "behavior", forty_days_ago);
    insert_memory_aged(&conn, "mem-knowledge", "knowledge", forty_days_ago);
    // preference is never_auto — no window at all, regardless of age.
    insert_memory_aged(&conn, "mem-pref", "preference", "2020-01-01T00:00:00+00:00");

    let report = ielts_db::archive_stale(&conn, NOW).unwrap();

    assert_eq!(status_of(&conn, "mem-behavior"), "archived", "fast = 21 days");
    assert_eq!(status_of(&conn, "mem-knowledge"), "active", "slow = 120 days");
    assert_eq!(
        status_of(&conn, "mem-pref"),
        "active",
        "never_auto kinds are never swept, at any age"
    );
    assert_eq!(report.archived_count, 1);
    assert!(report.skipped_kinds.contains(&"preference".to_string()));
}

// ---------------------------------------------------------------------------
// Round-3 audit (A1): the weekly channel wrote the raw LLM statement straight
// into `memory_items` with `status='active'`. Every guard below was declared in
// `ielts-domain` and never wired: `MAX_PATTERN_STATEMENT_BYTES` had no
// reference anywhere in the workspace, and `ForbiddenStatementContent` was
// never constructed.
// ---------------------------------------------------------------------------
