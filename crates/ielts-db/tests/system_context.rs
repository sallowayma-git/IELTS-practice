//! The coach's single assembly point for Soul, preferences, memories and weak
//! skills (`build_coach_system_context`), against real SQLite.
use ielts_db::soul::soul_update;
use ielts_db::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn open() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("system-context.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn profile(conn: &Connection) -> LearnerProfileSnapshot {
    build_coach_system_context(conn, "local").unwrap()
}

fn ids(statements: &[ProfileStatement]) -> Vec<&str> {
    statements.iter().map(|entry| entry.id.as_str()).collect()
}

#[allow(clippy::too_many_arguments)]
fn memory(conn: &Connection, id: &str, namespace: &str, content: &str, source: &str, importance: f64, status: &str) {
    conn.execute(
        "INSERT INTO memory_items (id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
           source_class,confidence,importance,sensitivity,created_by,content_hash,created_at,updated_at)
         VALUES (?1,?2,'activity:reading','semantic',?1,?1,?3,?4,?5,0.8,?6,'normal','test',?1,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
        params![id, namespace, content, status, source, importance],
    )
    .unwrap();
}

fn preference(conn: &Connection, key: &str, value: Value) {
    conn.execute(
        "INSERT INTO explicit_user_preferences (user_id,preference_key,scope,value_json,status,source,created_at,updated_at)
         VALUES ('local',?1,'global',?2,'active','user','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
        params![key, value.to_string()],
    )
    .unwrap();
}

#[test]
fn an_empty_store_has_nothing_to_say_and_no_message() {
    let (_dir, conn) = open();
    let snapshot = profile(&conn);
    assert!(snapshot.is_empty());
    assert_eq!(coach_profile_message(&snapshot), None);
}

#[test]
fn soul_is_rendered_from_the_validated_profile_not_raw_preference_rows() {
    let (_dir, conn) = open();
    soul_update(
        &conn,
        "local",
        &json!({"soul.address": "您", "soul.nickname": "小明", "soul.tone": "直接", "soul.targetBand": 7.5, "soul.examDate": "2099-06-01"}),
    )
    .unwrap();
    // A cleared field is an active JSON null: it must not appear as "soul.nickname: null".
    soul_update(&conn, "local", &json!({"soul.message": null})).unwrap();

    let snapshot = profile(&conn);
    assert_eq!(
        ids(&snapshot.preferences),
        vec!["soul:address", "soul:nickname", "soul:tone", "soul:targetBand", "soul:examDate"]
    );
    let statements: Vec<&str> = snapshot.preferences.iter().map(|entry| entry.statement.as_str()).collect();
    assert_eq!(
        statements,
        vec!["称呼用「您」", "昵称：小明", "语气：直接", "目标分：7.5", "考试日期：2099-06-01"]
    );
    let rendered = serde_json::to_string(&snapshot).unwrap();
    assert!(!rendered.contains("null"), "{rendered}");
    assert!(!rendered.contains("preference:global:soul."), "Soul must not also appear as a raw preference row");
}

#[test]
fn the_learners_tone_beats_the_models_suggestion_and_notes_are_marked_observations() {
    let (_dir, conn) = open();
    soul_update(&conn, "local", &json!({"soul.toneSuggestion": "温和", "soul.companionNotes": "最近常因为太长而放弃阅读讲解"}))
        .unwrap();
    let snapshot = profile(&conn);
    assert!(snapshot.preferences.is_empty(), "nothing the learner set");
    assert_eq!(ids(&snapshot.memories), vec!["soul:toneSuggestion", "soul:companionNotes"]);
    assert!(snapshot.memories[0].statement.contains("学习者未设定"));
    assert!(snapshot.memories[1].statement.starts_with("陪练备注（系统观察）"));

    soul_update(&conn, "local", &json!({"soul.tone": "直接"})).unwrap();
    let snapshot = profile(&conn);
    assert_eq!(ids(&snapshot.preferences), vec!["soul:tone"]);
    assert_eq!(ids(&snapshot.memories), vec!["soul:companionNotes"], "the suggestion yields to the learner's tone");
    assert!(snapshot.memory_ids().is_empty(), "Soul entries are not recalled memories");
}

#[test]
fn soul_fields_do_not_use_up_the_explicit_preference_slots() {
    let (_dir, conn) = open();
    soul_update(
        &conn,
        "local",
        &json!({"soul.address": "你", "soul.nickname": "A", "soul.tone": "平衡", "soul.targetBand": 7.0, "soul.examDate": "2099-06-01", "soul.message": "请多鼓励我"}),
    )
    .unwrap();
    for key in ["coach.a", "coach.b", "coach.c", "coach.d", "coach.e", "coach.f"] {
        preference(&conn, key, json!("v"));
    }
    let snapshot = profile(&conn);
    let kept: Vec<&str> = ids(&snapshot.preferences).into_iter().filter(|id| id.starts_with("preference:")).collect();
    assert_eq!(kept.len(), PROFILE_MAX_PREFERENCES, "the five-slot cap still holds for the learner's other preferences");
    assert_eq!(ids(&snapshot.preferences).iter().filter(|id| id.starts_with("soul:")).count(), 6);
}

#[test]
fn a_cleared_non_soul_preference_is_not_offered() {
    let (_dir, conn) = open();
    preference(&conn, "coach.tone", json!(null));
    preference(&conn, "coach.language", json!("English"));
    let snapshot = profile(&conn);
    assert_eq!(ids(&snapshot.preferences), vec!["preference:global:coach.language"]);
}

#[test]
fn predicted_hypotheses_never_reach_the_coach_and_teaching_namespaces_come_first() {
    let (_dir, conn) = open();
    memory(&conn, "mem-knowledge", "knowledge", "Misses qualifiers such as 'only' in TFNG.", "inferred", 0.9, "active");
    memory(&conn, "mem-strategy", "strategy", "Commits to an answer before locating evidence.", "consolidated", 0.5, "active");
    memory(&conn, "mem-pref", "preference", "Wants a short example before the rule.", "consolidated", 0.5, "active");
    memory(&conn, "mem-guess", "preference", "Might prefer diagrams.", "predicted", 1.0, "active");
    memory(&conn, "mem-old", "preference", "Archived preference.", "consolidated", 1.0, "archived");
    let snapshot = profile(&conn);
    assert_eq!(ids(&snapshot.memories), vec!["mem-pref", "mem-strategy", "mem-knowledge"]);
}

#[test]
fn an_expired_memory_is_not_offered() {
    let (_dir, conn) = open();
    memory(&conn, "mem-live", "strategy", "Rereads the question stem twice.", "inferred", 0.5, "active");
    memory(&conn, "mem-expired", "strategy", "Was rushing last month.", "inferred", 0.9, "active");
    conn.execute("UPDATE memory_items SET valid_to='2000-01-01T00:00:00Z' WHERE id='mem-expired'", []).unwrap();
    assert_eq!(ids(&profile(&conn).memories), vec!["mem-live"]);
}

#[test]
fn soul_survives_the_budget_squeeze_that_drops_memories_first() {
    let (_dir, conn) = open();
    soul_update(&conn, "local", &json!({"soul.address": "你", "soul.tone": "温和"})).unwrap();
    let long = "word ".repeat(55);
    for key in ["coach.a", "coach.b", "coach.c", "coach.d", "coach.e"] {
        preference(&conn, key, json!(long.trim()));
    }
    for i in 0..12 {
        memory(&conn, &format!("mem-{i:02}"), "strategy", &format!("{long} habit {i}"), "inferred", 1.0 - f64::from(i) / 100.0, "active");
    }
    let snapshot = profile(&conn);
    assert_eq!(&ids(&snapshot.preferences)[..2], ["soul:address", "soul:tone"]);
    assert!(snapshot.memories.len() < PROFILE_MAX_MEMORIES, "memories shrink first");
    assert!(ielts_domain::estimate_tokens(&serde_json::to_string(&snapshot).unwrap()) <= PROFILE_TOKEN_BUDGET);
}

#[test]
fn the_snapshot_keeps_the_frozen_thread_shape_and_the_message_names_how_to_read_soul() {
    let (_dir, conn) = open();
    soul_update(&conn, "local", &json!({"soul.tone": "温和"})).unwrap();
    let snapshot = profile(&conn);
    // What is frozen on the thread must still load as the coach's own snapshot type.
    let stored = serde_json::to_string(&snapshot).unwrap();
    assert_eq!(serde_json::from_str::<LearnerProfileSnapshot>(&stored).unwrap(), snapshot);
    let message = coach_profile_message(&snapshot).unwrap();
    assert!(message.starts_with(COACH_PROFILE_LABEL));
    assert!(message.ends_with(&stored));
    assert!(COACH_PROFILE_LABEL.contains("soul:"));
}

#[test]
fn another_user_s_soul_is_not_visible() {
    let (_dir, conn) = open();
    soul_update(&conn, "local", &json!({"soul.tone": "温和"})).unwrap();
    assert!(build_coach_system_context(&conn, "someone-else").unwrap().is_empty());
}

/// Swapping the coach's own selection for this one must not change what an
/// ordinary learner (no Soul, no hypotheses) sees.
#[test]
fn without_soul_or_hypotheses_it_matches_the_selection_the_coach_used_before() {
    let (_dir, conn) = open();
    memory(&conn, "mem-a", "strategy", "Misses qualifiers such as 'only' in TFNG statements.", "inferred", 0.9, "active");
    memory(&conn, "mem-b", "strategy", "Rushes the last passage when time is short.", "inferred", 0.5, "active");
    memory(&conn, "mem-said", "strategy", "Prefers explanations in English.", "user_explicit", 0.1, "active");
    memory(&conn, "mem-archived", "strategy", "Archived note.", "inferred", 1.0, "archived");
    preference(&conn, "coach.tone", json!("brief"));
    conn.execute(
        "INSERT INTO learner_skill_state (user_id,skill_key,mastery_mean,distinct_asset_count,evidence_count,model_version,explanation_json,updated_at)
         VALUES ('local','reading.tfng',0.4,3,3,'test','{}','2026-10-01T00:00:00Z')",
        [],
    )
    .unwrap();
    assert_eq!(profile(&conn), select_learner_profile(&conn).unwrap());
}
