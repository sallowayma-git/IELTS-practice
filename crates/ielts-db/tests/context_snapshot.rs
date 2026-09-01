//! M5-08 context snapshot persistence tests.
//!
//! Round-3 audit (R7b): `agent_context_snapshots.id` is a PRIMARY KEY
//! (migration 0016:7). `snapshot_id` used to be minted as
//! `format!("ctx-{}", content_hash)` in the application materializer, which
//! made the id a deterministic function of the rendered text — so two
//! materializations that rendered identically (the same plan re-run against
//! unchanged corpus) minted the same id and the second INSERT failed on the
//! PK. These tests pin the contract from the persistence side: the id is a
//! per-materialization identity, `content_hash` is the deterministic digest,
//! and two snapshots sharing a hash must both persist.

use ielts_db::{insert_context_snapshot, load_context_snapshot, migrate, open_connection, DbOpenOptions};
use ielts_domain::{
    ContextManifest, ContextMaterializedItem, ContextMaterializedSection, ContextSection,
};
use serde_json::json;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("ctx.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

/// A manifest whose `content_hash` is fixed by the caller so two manifests can
/// deliberately share one while carrying distinct ids.
fn manifest(snapshot_id: &str, content_hash: &str) -> ContextManifest {
    ContextManifest {
        snapshot_id: snapshot_id.to_string(),
        run_id: None,
        planner_version: "planner-v1".into(),
        scope: "internal".into(),
        token_budget: 4096,
        used_tokens: 12,
        content_hash: content_hash.to_string(),
        rendered_at: "2026-08-31T10:00:00+00:00".into(),
        sections: vec![ContextMaterializedSection {
            section: ContextSection::CurrentTask,
            estimated_tokens: 12,
            items: vec![ContextMaterializedItem {
                item_id: "reading:a:v1:0".into(),
                section: ContextSection::CurrentTask,
                source_kind: "reading".into(),
                source_id: "a".into(),
                content_hash: "item-hash".into(),
                sensitivity: "internal".into(),
                estimated_tokens: 12,
                rank: 1,
                score: 1.0,
                inclusion_reason: "exact".into(),
            }],
        }],
    }
}

#[test]
fn identical_renders_persist_as_two_snapshots() {
    // The regression: same rendered text, same content_hash, distinct ids.
    // Before the fix the materializer derived the id from the hash, so this
    // second insert was a PRIMARY KEY violation on a completely ordinary
    // re-run of one plan.
    let (_dir, conn) = open_db();
    let plan = json!({"planner_version": "planner-v1"});

    insert_context_snapshot(&conn, &manifest("ctx-a", "same-hash"), "rendered", &plan, "internal")
        .expect("first snapshot persists");
    insert_context_snapshot(&conn, &manifest("ctx-b", "same-hash"), "rendered", &plan, "internal")
        .expect("a re-render with the same content_hash must also persist");

    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_context_snapshots", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 2, "both materializations are retained as separate audit rows");

    // Neither row was overwritten: each id still resolves to its own snapshot,
    // and each kept its own item set. An upsert-based "fix" would collapse
    // these into one row and silently re-point the FKs at 0017:87 / 0020:69.
    for id in ["ctx-a", "ctx-b"] {
        let (loaded, rendered) = load_context_snapshot(&conn, id)
            .unwrap()
            .unwrap_or_else(|| panic!("{id} must still be loadable"));
        assert_eq!(loaded.snapshot_id, id);
        assert_eq!(loaded.content_hash, "same-hash");
        assert_eq!(loaded.sections.len(), 1);
        assert_eq!(rendered, "rendered");
    }

    let items: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_context_items", [], |row| row.get(0))
        .unwrap();
    assert_eq!(items, 2, "each snapshot keeps its own items");
}

#[test]
fn reinserting_one_id_is_still_rejected() {
    // The PK is load-bearing and must stay that way: uniqueness of the id is
    // what makes a snapshot row an immutable audit record. The fix makes ids
    // unique at the mint site; it does not loosen the constraint.
    let (_dir, conn) = open_db();
    let plan = json!({"planner_version": "planner-v1"});

    insert_context_snapshot(&conn, &manifest("ctx-dup", "hash-1"), "rendered", &plan, "internal")
        .expect("first insert persists");
    let err = insert_context_snapshot(
        &conn,
        &manifest("ctx-dup", "hash-2"),
        "rendered-differently",
        &plan,
        "internal",
    );
    assert!(err.is_err(), "the same snapshot_id must never be written twice");

    // The failed insert left nothing behind, and the original row is intact.
    let (loaded, rendered) = load_context_snapshot(&conn, "ctx-dup").unwrap().unwrap();
    assert_eq!(loaded.content_hash, "hash-1", "the original row was not overwritten");
    assert_eq!(rendered, "rendered", "the rejected insert did not replace the text");
}

#[test]
fn an_unknown_run_id_is_rejected_with_a_typed_error() {
    // Round-3 audit (R7a). `run_id` is an FK into `agent_runs(id)` (0016:17)
    // with enforcement on for every connection (sqlite/mod.rs:76). The
    // materializer used to lift this value out of the caller-supplied plan's
    // `retrieval_run_ids`, which hold Python-minted `rr-<hex12>` ids — a shape
    // no `agent_runs` row ever has. Every populated value aborted the whole
    // snapshot+items transaction.
    //
    // The FK alone would catch it, but only as an opaque
    // "FOREIGN KEY constraint failed". This pins the typed error instead, and
    // pins it at the persistence boundary so it holds for any future caller.
    let (_dir, conn) = open_db();
    let plan = json!({"planner_version": "planner-v1"});

    let mut bad = manifest("ctx-bad-run", "hash-1");
    bad.run_id = Some("rr-deadbeefcafe".into());
    let error = insert_context_snapshot(&conn, &bad, "rendered", &plan, "internal")
        .expect_err("an unknown run_id must not persist");
    let message = error.to_string();
    assert!(
        message.contains("context.unknown_run_id"),
        "expected a typed attributable error, got: {message}"
    );
    assert!(
        message.contains("rr-deadbeefcafe"),
        "the error must name the offending id, got: {message}"
    );

    // Nothing was written — the guard runs before the INSERT, so there is no
    // partial snapshot and no orphan items.
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_context_snapshots", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 0);
    let items: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_context_items", [], |row| row.get(0))
        .unwrap();
    assert_eq!(items, 0);
}

#[test]
fn a_null_run_id_is_the_normal_case_and_persists() {
    // The materializer now always writes NULL here (it never attributes a run
    // from a caller-supplied plan), so NULL must stay a first-class value —
    // the guard checks only `Some`.
    let (_dir, conn) = open_db();
    let plan = json!({"planner_version": "planner-v1"});
    let unattributed = manifest("ctx-null-run", "hash-1");
    assert!(unattributed.run_id.is_none());

    insert_context_snapshot(&conn, &unattributed, "rendered", &plan, "internal")
        .expect("an unattributed snapshot is the ordinary case");
    let (loaded, _) = load_context_snapshot(&conn, "ctx-null-run").unwrap().unwrap();
    assert!(loaded.run_id.is_none());
}
