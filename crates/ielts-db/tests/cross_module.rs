use ielts_db::{migrate, open_connection, promote_cross_module_memories, DbOpenOptions};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::tempdir;

const NOW: &str = "2026-11-14T00:00:00+00:00";
const LATER: &str = "2026-11-21T00:00:00+00:00";
const LATEST: &str = "2026-11-28T00:00:00+00:00";
const CHRONIC_KEY: &str = "language.vocabulary.chronic_reading_misses";

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn =
        open_connection(&DbOpenOptions::create(dir.path().join("cross-module.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

#[allow(clippy::too_many_arguments)]
fn insert_memory(
    conn: &Connection,
    id: &str,
    scope: &str,
    namespace: &str,
    memory_type: &str,
    canonical_key: &str,
    content: &str,
) {
    conn.execute(
        "INSERT INTO memory_items (
            id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
            source_class,confidence,importance,source_trust,sensitivity,improvement_state,
            first_observed_at,last_observed_at,version,created_by,content_hash,created_at,updated_at
         ) VALUES (?1,'local',?2,?3,?4,?5,?5,?6,'active','inferred',0.7,0.5,0.7,'normal',
                   'baseline','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,'test',?7,
                   '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
        params![
            id,
            namespace,
            scope,
            memory_type,
            canonical_key,
            content,
            format!("hash-{id}")
        ],
    )
    .unwrap();
}

struct GlobalRow {
    id: String,
    namespace: String,
    memory_type: String,
    content: String,
    structured_json: Option<String>,
    source_class: String,
    confidence: f64,
    importance: f64,
    source_trust: f64,
    created_by: String,
    content_hash: String,
    updated_at: String,
}

fn active_global(conn: &Connection, canonical_key: &str) -> Option<GlobalRow> {
    conn.query_row(
        "SELECT id,namespace,memory_type,content,structured_json,source_class,confidence,
                importance,source_trust,created_by,content_hash,updated_at
         FROM memory_items
         WHERE user_id='local' AND scope='global' AND canonical_key=?1 AND status='active'",
        [canonical_key],
        |row| {
            Ok(GlobalRow {
                id: row.get(0)?,
                namespace: row.get(1)?,
                memory_type: row.get(2)?,
                content: row.get(3)?,
                structured_json: row.get(4)?,
                source_class: row.get(5)?,
                confidence: row.get(6)?,
                importance: row.get(7)?,
                source_trust: row.get(8)?,
                created_by: row.get(9)?,
                content_hash: row.get(10)?,
                updated_at: row.get(11)?,
            })
        },
    )
    .optional()
    .unwrap()
}

fn active_global_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM memory_items WHERE scope='global' AND status='active'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn relation_count(conn: &Connection, target_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM memory_relations
         WHERE target_memory_id=?1 AND relation_kind='supports_consolidation'",
        [target_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn sha256(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn insert_vocabulary(
    conn: &Connection,
    id: &str,
    term: &str,
    normalized_term: &str,
    source_asset_id: &str,
    lapses: i64,
) {
    conn.execute(
        "INSERT INTO vocabulary_items (
            id,term,normalized_term,source_asset_id,created_at,updated_at
         ) VALUES (?1,?2,?3,?4,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
        params![id, term, normalized_term, source_asset_id],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO vocabulary_review_state (item_id,lapses) VALUES (?1,?2)",
        params![id, lapses],
    )
    .unwrap();
}

fn insert_reading_outcome(
    conn: &Connection,
    id: &str,
    asset_id: &str,
    is_correct: bool,
    answered: Option<bool>,
) {
    let mut payload = json!({"isCorrect": is_correct});
    if let Some(answered) = answered {
        payload["answered"] = json!(answered);
    }
    let payload = payload.to_string();
    conn.execute(
        "INSERT INTO learning_events (
            id,user_id,event_type,source_kind,source_id,idempotency_key,activity,asset_id,
            occurred_at,payload_json,content_hash,schema_version,consolidation_state,sensitivity,
            created_at,updated_at
         ) VALUES (?1,'local','reading_question_outcome','test',?1,?1,'reading',?2,
                   '2026-11-01T00:00:00Z',?3,?4,1,'pending','normal',
                   '2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')",
        params![id, asset_id, payload, sha256(&payload)],
    )
    .unwrap();
}

#[test]
fn a_key_in_two_activity_scopes_becomes_one_global_memory_with_support_edges() {
    let (_dir, conn) = open_db();
    insert_memory(
        &conn,
        "mem-read",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Read the stem before the passage.",
    );
    insert_memory(
        &conn,
        "mem-write",
        "activity:writing",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Plan the paragraph before writing.",
    );

    let report = promote_cross_module_memories(&conn, "local", NOW).unwrap();

    assert_eq!(report.promoted, vec!["strategy.skim_stem"]);
    assert!(report.updated.is_empty());
    let row = active_global(&conn, "strategy.skim_stem").expect("one global memory");
    assert_eq!(
        row.content,
        "Read the stem before the passage. / Plan the paragraph before writing."
    );
    assert_eq!(row.namespace, "strategy");
    assert_eq!(row.memory_type, "procedural");
    assert_eq!(row.source_class, "consolidated");
    assert_eq!(row.created_by, "weekly-cross-module");
    assert_eq!(
        (row.confidence, row.importance, row.source_trust),
        (0.7, 0.6, 0.7)
    );
    assert_eq!(row.content_hash, sha256(&row.content));
    assert_eq!(active_global_count(&conn), 1);

    assert_eq!(relation_count(&conn, &row.id), 2);
    let sources: Vec<String> = conn
        .prepare(
            "SELECT source_memory_id FROM memory_relations
             WHERE target_memory_id=?1 AND relation_kind='supports_consolidation'
             ORDER BY source_memory_id",
        )
        .unwrap()
        .query_map([&row.id], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(sources, vec!["mem-read", "mem-write"]);
}

#[test]
fn only_keys_shared_by_two_scopes_with_one_identity_promote() {
    let (_dir, conn) = open_db();
    insert_memory(
        &conn,
        "mem-solo",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.solo",
        "Only reading knows this.",
    );
    for (id, scope) in [
        ("mem-pref-read", "activity:reading"),
        ("mem-pref-write", "activity:writing"),
    ] {
        insert_memory(
            &conn,
            id,
            scope,
            "preference",
            "inferred_profile",
            "preference.tone",
            "Keep feedback direct.",
        );
    }
    insert_memory(
        &conn,
        "mem-conflict-read",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.conflict",
        "Reading strategy.",
    );
    insert_memory(
        &conn,
        "mem-conflict-write",
        "activity:writing",
        "behavior",
        "procedural",
        "strategy.conflict",
        "Writing behaviour.",
    );
    insert_memory(
        &conn,
        "mem-type-read",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.type_conflict",
        "Procedural version.",
    );
    insert_memory(
        &conn,
        "mem-type-write",
        "activity:writing",
        "strategy",
        "semantic",
        "strategy.type_conflict",
        "Semantic version.",
    );

    let report = promote_cross_module_memories(&conn, "local", NOW).unwrap();

    assert!(report.promoted.is_empty() && report.updated.is_empty());
    assert_eq!(active_global_count(&conn), 0);
}

#[test]
fn a_rerun_is_idempotent_and_changed_source_content_refreshes_the_global_row() {
    let (_dir, conn) = open_db();
    insert_memory(
        &conn,
        "mem-read",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Read the stem first.",
    );
    insert_memory(
        &conn,
        "mem-write",
        "activity:writing",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Plan before writing.",
    );

    let first = promote_cross_module_memories(&conn, "local", NOW).unwrap();
    assert_eq!(first.promoted, vec!["strategy.skim_stem"]);
    let original = active_global(&conn, "strategy.skim_stem").unwrap();
    assert_eq!(relation_count(&conn, &original.id), 2);

    let second = promote_cross_module_memories(&conn, "local", LATER).unwrap();
    assert!(second.promoted.is_empty() && second.updated.is_empty());
    let unchanged = active_global(&conn, "strategy.skim_stem").unwrap();
    assert_eq!(unchanged.id, original.id);
    assert_eq!(unchanged.content, original.content);
    assert_eq!(unchanged.updated_at, original.updated_at);
    assert_eq!(active_global_count(&conn), 1);
    assert_eq!(relation_count(&conn, &original.id), 2);

    conn.execute(
        "UPDATE memory_items SET content=?1 WHERE id='mem-write'",
        ["Write the plan before drafting."],
    )
    .unwrap();
    let third = promote_cross_module_memories(&conn, "local", LATEST).unwrap();
    assert!(third.promoted.is_empty());
    assert_eq!(third.updated, vec!["strategy.skim_stem"]);
    let refreshed = active_global(&conn, "strategy.skim_stem").unwrap();
    assert_eq!(refreshed.id, original.id);
    assert_eq!(
        refreshed.content,
        "Read the stem first. / Write the plan before drafting."
    );
    assert_ne!(refreshed.content_hash, original.content_hash);
    assert_eq!(refreshed.updated_at, LATEST);
    assert_eq!(active_global_count(&conn), 1);
    assert_eq!(relation_count(&conn, &original.id), 2);
}

#[test]
fn a_full_global_scope_skips_promotion_without_failing() {
    let (_dir, conn) = open_db();
    for index in 0..128 {
        insert_memory(
            &conn,
            &format!("mem-cap-{index:03}"),
            "global",
            "strategy",
            "procedural",
            &format!("strategy.filler_{index:03}"),
            &format!("Filler memory {index}."),
        );
    }
    insert_memory(
        &conn,
        "mem-read",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Read the stem first.",
    );
    insert_memory(
        &conn,
        "mem-write",
        "activity:writing",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Plan before writing.",
    );
    insert_vocabulary(&conn, "vocab-abandon", "abandon", "abandon", "asset-A", 5);
    insert_vocabulary(&conn, "vocab-brittle", "brittle", "brittle", "asset-B", 4);
    insert_reading_outcome(&conn, "ev-a-wrong", "asset-A", false, None);
    insert_reading_outcome(&conn, "ev-b-wrong", "asset-B", false, None);

    let report = promote_cross_module_memories(&conn, "local", NOW).unwrap();

    assert!(report.promoted.is_empty() && report.updated.is_empty());
    assert!(active_global(&conn, "strategy.skim_stem").is_none());
    assert!(active_global(&conn, CHRONIC_KEY).is_none());
    assert_eq!(active_global_count(&conn), 128);
}

#[test]
fn chronic_vocabulary_across_two_assets_becomes_one_global_language_memory() {
    let (_dir, conn) = open_db();
    insert_vocabulary(&conn, "vocab-abandon", "abandon", "abandon", "asset-A", 5);
    insert_vocabulary(&conn, "vocab-brittle", "brittle", "brittle", "asset-B", 4);
    insert_vocabulary(&conn, "vocab-candid", "candid", "candid", "asset-A", 3);
    insert_vocabulary(&conn, "vocab-dormant", "dormant", "dormant", "asset-B", 2);
    insert_vocabulary(&conn, "vocab-erratic", "erratic", "erratic", "asset-C", 9);
    insert_reading_outcome(&conn, "ev-a-wrong", "asset-A", false, None);
    insert_reading_outcome(&conn, "ev-b-wrong", "asset-B", false, Some(true));
    insert_reading_outcome(&conn, "ev-c-correct", "asset-C", true, None);
    insert_reading_outcome(&conn, "ev-c-unanswered", "asset-C", false, Some(false));

    let report = promote_cross_module_memories(&conn, "local", NOW).unwrap();

    assert_eq!(report.promoted, vec![CHRONIC_KEY]);
    let row = active_global(&conn, CHRONIC_KEY).expect("one chronic vocabulary memory");
    assert_eq!(row.namespace, "language");
    assert_eq!(row.memory_type, "semantic");
    assert_eq!(row.source_class, "consolidated");
    assert_eq!(row.created_by, "weekly-cross-module");
    assert!(
        row.content.contains("abandon (5 lapses)"),
        "{}",
        row.content
    );
    assert!(
        row.content.contains("brittle (4 lapses)"),
        "{}",
        row.content
    );
    assert!(row.content.contains("candid (3 lapses)"), "{}", row.content);
    assert!(!row.content.contains("dormant"), "{}", row.content);
    assert!(!row.content.contains("erratic"), "{}", row.content);
    assert_eq!(relation_count(&conn, &row.id), 0);

    let structured: Value =
        serde_json::from_str(row.structured_json.as_deref().expect("structured terms")).unwrap();
    assert_eq!(structured["assetCount"], 2);
    let terms = structured["terms"].as_array().unwrap();
    assert_eq!(terms.len(), 3);
    assert_eq!(terms[0]["term"], "abandon");
    assert_eq!(terms[0]["lapses"], 5);
    assert_eq!(terms[0]["assetIds"], json!(["asset-A"]));
    assert_eq!(terms[1]["term"], "brittle");
    assert_eq!(terms[2]["term"], "candid");

    let rerun = promote_cross_module_memories(&conn, "local", LATER).unwrap();
    assert!(rerun.promoted.is_empty() && rerun.updated.is_empty());
    assert_eq!(active_global_count(&conn), 1);
}

#[test]
fn chronic_vocabulary_from_one_asset_is_not_promoted() {
    let (_dir, conn) = open_db();
    insert_vocabulary(&conn, "vocab-abandon", "abandon", "abandon", "asset-A", 5);
    insert_vocabulary(&conn, "vocab-brittle", "brittle", "brittle", "asset-A", 4);
    // A second asset exists, but this term never crossed the lapse threshold.
    insert_vocabulary(&conn, "vocab-candid", "candid", "candid", "asset-B", 2);
    insert_reading_outcome(&conn, "ev-a-wrong", "asset-A", false, None);
    insert_reading_outcome(&conn, "ev-b-wrong", "asset-B", false, None);

    let report = promote_cross_module_memories(&conn, "local", NOW).unwrap();

    assert!(report.promoted.is_empty() && report.updated.is_empty());
    assert!(active_global(&conn, CHRONIC_KEY).is_none());
}

#[test]
fn both_rules_can_promote_in_the_same_weekly_call() {
    let (_dir, conn) = open_db();
    insert_memory(
        &conn,
        "mem-read",
        "activity:reading",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Read the stem first.",
    );
    insert_memory(
        &conn,
        "mem-write",
        "activity:writing",
        "strategy",
        "procedural",
        "strategy.skim_stem",
        "Plan before writing.",
    );
    insert_vocabulary(&conn, "vocab-abandon", "abandon", "abandon", "asset-A", 5);
    insert_vocabulary(&conn, "vocab-brittle", "brittle", "brittle", "asset-B", 4);
    insert_reading_outcome(&conn, "ev-a-wrong", "asset-A", false, None);
    insert_reading_outcome(&conn, "ev-b-wrong", "asset-B", false, None);

    let report = promote_cross_module_memories(&conn, "local", NOW).unwrap();

    let mut promoted = report.promoted.clone();
    promoted.sort();
    let mut expected = vec!["strategy.skim_stem".to_owned(), CHRONIC_KEY.to_owned()];
    expected.sort();
    assert_eq!(promoted, expected);
    assert_eq!(active_global_count(&conn), 2);
    assert!(active_global(&conn, "strategy.skim_stem").is_some());
    assert!(active_global(&conn, CHRONIC_KEY).is_some());
}
