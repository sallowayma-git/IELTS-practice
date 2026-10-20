//! Weekly report v3 with the local narrative and Soul layers, end to end.
//!
//! A v3 report is built from real submissions (blocks), projected into the fact
//! map, written against by a validated narrative, persisted, listed back,
//! changed inside one transaction together with its Soul revisions, undone, and
//! carried whole through a format-22 backup. Each test owns its database and
//! uses its own window so it never collides with the older weekly suites.

use std::collections::BTreeSet;

use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use ielts_db::{
    build_daily_facts, build_weekly_report, create_backup_package, finish_dream_run,
    has_usable_body, import_asset_payload_file, import_backup, insert_dream_run, insert_journal,
    list_weekly_reports, migrate, open_connection, project_weekly_facts, put_weekly_report,
    soul, start_dream_run, submit_reading_attempt, validate_narrative, weekly_pack, DbOpenOptions,
    WeeklyPack, WeeklyWindow, WEEKLY_PACK_SCHEMA_VERSION,
};
use ielts_domain::{
    display_title, AppliedProfileEdit, WeeklyReport, WeeklyReportState, WEEKLY_REPORT_SCHEMA_VERSION,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use tempfile::tempdir;

const UTC: FixedOffset = FixedOffset::east_opt(0).unwrap();
const WEEK: &str = "2026-W47";
const WINDOW_START: &str = "2026-11-14T09:30:00Z";
const WINDOW_END: &str = "2026-11-21T09:30:00Z";
const EXAM_DAY: &str = "2099-06-12";
const TITLE: &str = "先看题干再定位";
const BODY: &str = "这周读了 {{f:volume.reading}} 篇，判断题错了 {{f:qtype.tfng.wrong}} 道。";
const ASSET_A: &str = "asset-w47-a";
const ASSET_B: &str = "asset-w47-b";

fn at(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Utc)
}

fn as_of() -> NaiveDate {
    NaiveDate::parse_from_str(&WINDOW_END[..10], "%Y-%m-%d").unwrap()
}

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("weekly-v3.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

/// Two passages with the same key. A misses tfng q1 and matching q3; B misses
/// tfng q1 and q2. So tfng is missed in two passages (citable Soul evidence) and
/// matching in one (not enough evidence).
fn report_fixture() -> (tempfile::TempDir, Connection) {
    let (dir, conn) = open_db();
    for id in [ASSET_A, ASSET_B] {
        import_asset(&conn, &dir, id);
    }
    submit(&conn, "w47-a1", ASSET_A, json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-11-17T09:00:00Z");
    submit(&conn, "w47-b1", ASSET_B, json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), "2026-11-18T10:00:00Z");
    soul::soul_update(
        &conn,
        "local",
        &json!({"soul.address": "您", "soul.targetBand": 7.5, "soul.examDate": EXAM_DAY}),
    )
    .unwrap();
    (dir, conn)
}

fn import_asset(conn: &Connection, dir: &tempfile::TempDir, id: &str) {
    let path = dir.path().join(format!("{id}.json"));
    let payload = json!({
        "examId": id, "meta": {"title": format!("Passage {id}"), "category": "P1"},
        "questionCount": 3, "questionOrder": ["q1", "q2", "q3"],
        "answerKey": {"q1": "TRUE", "q2": "FALSE", "q3": "B"},
        "questionDisplayMap": {"q1": "14", "q2": "15", "q3": "16"},
        "passage": {"blocks": [{"html": "<p>Never leaves the host.</p>"}]},
        "questionGroups": [
            {"kind": "tfng", "questionIds": ["q1", "q2"]},
            {"kind": "matching", "questionIds": ["q3"]}
        ]
    });
    std::fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
    import_asset_payload_file(conn, &path).unwrap();
}

fn submit(conn: &Connection, attempt: &str, asset: &str, answers: Value, when: &str) {
    let command = json!({
        "attemptId": attempt, "assetId": asset, "answers": answers, "idempotencyKey": attempt
    });
    submit_reading_attempt(conn, &serde_json::from_value(command).unwrap()).unwrap();
    conn.execute(
        "UPDATE learning_events SET occurred_at = ?1 WHERE json_extract(payload_json, '$.attemptId') = ?2",
        rusqlite::params![when, attempt],
    )
    .unwrap();
    conn.execute("UPDATE attempts SET completed_at = ?1 WHERE id = ?2", rusqlite::params![when, attempt]).unwrap();
}

fn journal_for(conn: &Connection, day: &str) -> String {
    let facts = build_daily_facts(conn, "local", day).unwrap();
    insert_journal(conn, "local", &facts, None).unwrap().id
}

fn window() -> WeeklyWindow {
    WeeklyWindow::new(WEEK, at(WINDOW_START), at(WINDOW_END))
}

fn run_with_marker(conn: &Connection) -> String {
    let journal = journal_for(conn, "2026-11-21");
    let marker = format!("weekly:{WEEK}:{WINDOW_START}..{WINDOW_END}");
    insert_dream_run(conn, "local", &journal, Some(&marker)).unwrap().id
}

fn started_run(conn: &Connection) -> String {
    let id = run_with_marker(conn);
    start_dream_run(conn, &id, WINDOW_END).unwrap();
    id
}

fn completed_run(conn: &Connection) -> String {
    let id = started_run(conn);
    finish_dream_run(conn, &id, "out", WINDOW_END).unwrap();
    id
}

/// The report a finished weekly run leaves behind: real blocks, the facts their
/// one projection gives, and a narrative that passed the validator.
fn final_report(conn: &Connection) -> WeeklyReport {
    report_from(
        conn,
        json!({
            "title": TITLE,
            "body": [BODY],
            "nextSteps": [{"text": "下周再练判断题。", "target": {"type": "kind", "key": "reading.tfng"}}],
        }),
    )
}

fn report_from(conn: &Connection, raw: Value) -> WeeklyReport {
    let mut report =
        build_weekly_report(conn, "local", &window(), UTC, WeeklyReportState::Final, at(WINDOW_END)).unwrap();
    assert_eq!(report.schema_version, WEEKLY_REPORT_SCHEMA_VERSION);
    let profile = soul::soul_profile(conn, "local").unwrap();
    let outcome = validate_narrative(&raw, &report.facts, &profile, as_of());
    assert!(outcome.usable, "{:?}", outcome.narrative.validation.final_report);
    report.narrative = Some(outcome.narrative);
    report.display_title = display_title(report.narrative.as_ref(), &report.blocks);
    report
}

fn facts_value(report: &WeeklyReport) -> Value {
    serde_json::to_value(&report.facts).unwrap()
}

fn profile_value(conn: &Connection, key: &str) -> Value {
    soul::soul_profile(conn, "local").unwrap().get(key).cloned().unwrap_or(Value::Null)
}

#[test]
fn a_real_v3_report_round_trips_with_the_exact_projection_and_one_title() {
    let (_dir, conn) = report_fixture();
    let report = final_report(&conn);
    assert_eq!(report.display_title, TITLE);
    // Two attempts, four wrong answers: the facts come from the blocks, not
    // from the test.
    assert_eq!(report.facts["volume.reading"].value, json!(2));
    assert_eq!(report.facts["qtype.tfng.wrong"].value, json!(3));
    let days_to_exam = (NaiveDate::parse_from_str(EXAM_DAY, "%Y-%m-%d").unwrap() - as_of()).num_days();
    assert_eq!(report.facts["exam.days"].value, json!(days_to_exam));

    let run = completed_run(&conn);
    put_weekly_report(&conn, "local", &run, &report, UTC, WINDOW_END).unwrap();

    let listed = list_weekly_reports(&conn, "local", 8).unwrap();
    assert_eq!(listed, vec![report.clone()]);
    let stored = &listed[0];
    assert_eq!(stored.schema_version, WEEKLY_REPORT_SCHEMA_VERSION);
    assert_eq!(stored.schema_version, 3);
    assert_eq!(stored.window, WEEK);
    assert_eq!(stored.window_start, WINDOW_START);
    assert_eq!(stored.window_end, WINDOW_END);
    assert_eq!(stored.display_title, TITLE);
    assert_eq!(stored.display_title, display_title(stored.narrative.as_ref(), &stored.blocks));
    let exam = soul::soul_exam_date(&conn, "local").unwrap();
    assert_eq!(stored.facts, project_weekly_facts(&stored.blocks, exam, as_of()));

    // Facts are not hand-written: one changed value is refused.
    let mut edited = report.clone();
    edited.facts.get_mut("volume.reading").unwrap().value = json!(99);
    assert!(put_weekly_report(&conn, "local", &run, &edited, UTC, WINDOW_END).is_err());
    // The title is derived exactly once.
    let mut retitled = report.clone();
    retitled.display_title = "另一个标题".to_owned();
    assert!(put_weekly_report(&conn, "local", &run, &retitled, UTC, WINDOW_END).is_err());
    // A rejected write leaves the stored report untouched.
    assert_eq!(list_weekly_reports(&conn, "local", 8).unwrap(), vec![report]);
}

#[test]
fn soul_edits_and_the_report_commit_together_and_undo_restores_the_field() {
    let (_dir, conn) = report_fixture();
    let mut report = final_report(&conn);
    let facts = facts_value(&report);
    let evidence = &report.facts["qtype.tfng.wrong"].provenance.asset_ids;
    assert_eq!(evidence.len(), 2, "the tfng fact must cover two passages");
    let run = started_run(&conn);
    let edits = json!([{
        "key": "soul.companionNotes",
        "value": "做题前先圈出定位词。",
        "evidenceIds": ["qtype.tfng.wrong"],
        "reason": "两篇都在判断题上丢分"
    }]);

    // A report that fails validation in the same transaction rolls the Soul
    // revision back with it: the pair is one unit.
    let tx = conn.unchecked_transaction().unwrap();
    let applied = soul::soul_apply_edits_in_transaction(&tx, "local", &run, &edits, &facts).unwrap();
    assert_eq!(applied.len(), 1);
    let mut doomed = report.clone();
    doomed.display_title = "不是派生标题".to_owned();
    assert!(put_weekly_report(&tx, "local", &run, &doomed, UTC, WINDOW_END).is_err());
    drop(tx);
    assert_eq!(profile_value(&conn, "soul.companionNotes"), Value::Null);
    let model_revisions: i64 = conn
        .query_row("SELECT COUNT(*) FROM soul_revisions WHERE actor = 'model'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(model_revisions, 0);

    // The committed path: Soul edit, report, run completion, one transaction.
    let tx = conn.unchecked_transaction().unwrap();
    let applied = soul::soul_apply_edits_in_transaction(&tx, "local", &run, &edits, &facts).unwrap();
    assert_eq!(applied.len(), 1);
    report.profile_edits = applied
        .into_iter()
        .map(|edit| serde_json::from_value::<AppliedProfileEdit>(edit).unwrap())
        .collect();
    put_weekly_report(&tx, "local", &run, &report, UTC, WINDOW_END).unwrap();
    finish_dream_run(&tx, &run, "out", WINDOW_END).unwrap();
    tx.commit().unwrap();

    assert_eq!(profile_value(&conn, "soul.companionNotes"), json!("做题前先圈出定位词。"));
    let (revision_id, key, run_id, evidence_json): (String, String, String, String) = conn
        .query_row(
            "SELECT id, preference_key, run_id, evidence_ids_json FROM soul_revisions
              WHERE actor = 'model'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(key, "soul.companionNotes");
    assert_eq!(run_id, run);
    assert_eq!(serde_json::from_str::<Value>(&evidence_json).unwrap(), json!(["qtype.tfng.wrong"]));

    let listed = list_weekly_reports(&conn, "local", 8).unwrap();
    assert_eq!(listed, vec![report.clone()]);
    assert_eq!(listed[0].profile_edits.len(), 1);
    assert_eq!(listed[0].profile_edits[0].revision_id, revision_id);

    // The settings page can undo it; the field goes back to absent and the undo
    // itself is audited.
    let undone = soul::soul_undo(&conn, "local", &revision_id).unwrap();
    assert!(undone["profile"].get("soul.companionNotes").is_none());
    assert_eq!(profile_value(&conn, "soul.companionNotes"), Value::Null);
    let undo_rows = undone["revisions"].as_array().unwrap();
    assert!(undo_rows.iter().any(|row| {
        row["actor"] == "undo" && row["key"] == "soul.companionNotes" && row["revertsId"] == revision_id
    }));
    // The report keeps its audit reference: it did apply the edit back then.
    assert_eq!(list_weekly_reports(&conn, "local", 8).unwrap()[0].profile_edits.len(), 1);
}

#[test]
fn soul_refuses_thin_evidence_non_editable_keys_and_overwrites_after_a_user_edit() {
    let (_dir, conn) = report_fixture();
    let report = final_report(&conn);
    let facts = facts_value(&report);
    let run = started_run(&conn);
    assert_eq!(report.facts["qtype.matching.wrong"].provenance.asset_ids, vec![ASSET_A.to_owned()]);
    assert_eq!(report.facts["qtype.tfng.wrong"].provenance.asset_ids.len(), 2);

    // One passage cited twice is one passage.
    let single = json!([{
        "key": "soul.companionNotes",
        "value": "只看一篇不够。",
        "evidenceIds": ["qtype.matching.wrong"],
        "reason": "只有一篇"
    }]);
    assert!(soul::soul_apply_edits_in_transaction(&conn, "local", &run, &single, &facts).unwrap().is_empty());

    // The user's address, target band and exam date are not the model's to move.
    let locked = json!([
        {"key": "soul.address", "value": "你", "evidenceIds": ["qtype.tfng.wrong"], "reason": "越权"},
        {"key": "soul.targetBand", "value": 8.0, "evidenceIds": ["qtype.tfng.wrong"], "reason": "越权"},
        {"key": "soul.examDate", "value": "2099-12-31", "evidenceIds": ["qtype.tfng.wrong"], "reason": "越权"}
    ]);
    assert!(soul::soul_apply_edits_in_transaction(&conn, "local", &run, &locked, &facts).unwrap().is_empty());
    assert_eq!(profile_value(&conn, "soul.address"), json!("您"));
    assert_eq!(profile_value(&conn, "soul.targetBand"), json!(7.5));
    assert_eq!(profile_value(&conn, "soul.examDate"), json!(EXAM_DAY));
    let refused: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM soul_revisions WHERE actor = 'model'
               AND preference_key IN ('soul.address', 'soul.targetBand', 'soul.examDate')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(refused, 0);

    // A two-passage edit lands, then the user rewrites the same field.
    let edits = json!([{
        "key": "soul.companionNotes",
        "value": "判断题先圈出定位词。",
        "evidenceIds": ["qtype.tfng.wrong"],
        "reason": "两篇都在判断题上丢分"
    }]);
    let applied = soul::soul_apply_edits_in_transaction(&conn, "local", &run, &edits, &facts).unwrap();
    assert_eq!(applied.len(), 1);
    let revision = applied[0]["revisionId"].as_str().unwrap().to_owned();
    assert_eq!(profile_value(&conn, "soul.companionNotes"), json!("判断题先圈出定位词。"));

    soul::soul_update(&conn, "local", &json!({"soul.companionNotes": "用户后来自己写的备注"})).unwrap();
    assert_eq!(profile_value(&conn, "soul.companionNotes"), json!("用户后来自己写的备注"));
    let error = soul::soul_undo(&conn, "local", &revision).unwrap_err();
    assert!(
        error.to_string().contains("字段后来已修改，不能覆盖；请手动编辑。"),
        "{error}"
    );
    // The user's value survived the refused undo, and no undo revision exists.
    assert_eq!(profile_value(&conn, "soul.companionNotes"), json!("用户后来自己写的备注"));
    let undos: i64 = conn
        .query_row("SELECT COUNT(*) FROM soul_revisions WHERE actor = 'undo'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(undos, 0);
}

#[test]
fn chinese_counts_die_in_prose_but_next_steps_reach_the_store() {
    let (_dir, conn) = report_fixture();
    let facts = final_report(&conn).facts;
    let profile = soul::soul_profile(&conn, "local").unwrap();

    // A body that counts in Chinese has no body left: the run is not usable.
    let count_body = json!({"title": "这周", "body": ["这周做了两次阅读。"]});
    let outcome = validate_narrative(&count_body, &facts, &profile, as_of());
    assert!(!outcome.usable);
    assert!(outcome.narrative.body.is_empty());
    assert!(outcome.narrative.validation.final_report.violations.iter().any(|violation| {
        violation.path == "body/0" && violation.code == "literal_chinese_count"
    }));
    assert!(!has_usable_body(&count_body, &facts));

    // nextSteps may size the drill; every other group obeys the prose rule.
    let mut report = report_from(
        &conn,
        json!({
            "title": TITLE,
            "body": [BODY],
            "nextSteps": [{"text": "再练两组判断题。", "target": {"type": "kind", "key": "reading.tfng"}}],
            "changes": [{"text": "先回看两道错题。"}],
        }),
    );
    let narrative = report.narrative.as_ref().unwrap();
    assert_eq!(narrative.next_steps.len(), 1);
    assert_eq!(narrative.next_steps[0].text, "再练两组判断题。");
    assert!(narrative.changes.is_empty(), "the other group is dropped");
    assert!(narrative.validation.final_report.violations.iter().any(|violation| {
        violation.path == "changes/0" && violation.code == "literal_chinese_count"
    }));
    report.display_title = display_title(report.narrative.as_ref(), &report.blocks);

    let run = completed_run(&conn);
    put_weekly_report(&conn, "local", &run, &report, UTC, WINDOW_END).unwrap();
    let stored = list_weekly_reports(&conn, "local", 8).unwrap();
    assert_eq!(stored.len(), 1);
    let stored_narrative = stored[0].narrative.as_ref().unwrap();
    assert_eq!(stored_narrative.next_steps[0].text, "再练两组判断题。");
    assert_eq!(stored_narrative.next_steps[0].target.as_ref().unwrap().key, "reading.tfng");
    assert!(stored_narrative.changes.is_empty());
    assert_eq!(stored_narrative.body, vec![BODY.to_owned()]);
}

fn pack_fixture() -> (tempfile::TempDir, Connection) {
    let (dir, conn) = open_db();
    for id in [ASSET_A, ASSET_B] {
        import_asset(&conn, &dir, id);
    }
    submit(&conn, "w47-a1", ASSET_A, json!({"q1": "FALSE", "q2": "FALSE", "q3": "A"}), "2026-11-17T09:00:00Z");
    submit(&conn, "w47-b1", ASSET_B, json!({"q1": "FALSE", "q2": "TRUE", "q3": "B"}), "2026-11-18T10:00:00Z");
    conn.execute(
        "INSERT INTO memory_items (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
            source_class,created_by,content_hash,last_observed_at,created_at,updated_at)
         VALUES ('mem-w47','local','strategy','activity:reading','procedural','reading.tfng.stem_first','stem first',
            'Reads the stem first.','active','inferred','weekly_dream','mem-w47-hash',
            '2026-11-18T00:00:00Z','2026-11-18T00:00:00Z','2026-11-18T00:00:00Z')",
        [],
    )
    .unwrap();
    (dir, conn)
}

fn build_pack(conn: &Connection) -> WeeklyPack {
    weekly_pack(conn, "local", at(WINDOW_START), at(WINDOW_END)).unwrap()
}

#[test]
fn the_v3_pack_is_deterministic_and_carries_only_its_own_sections() {
    let (_dir, conn) = pack_fixture();
    let pack = build_pack(&conn);
    let value = pack.to_value();
    assert_eq!(WEEKLY_PACK_SCHEMA_VERSION, 3);
    assert_eq!(value["schemaVersion"], json!(3));
    assert_eq!(value["window"], json!({"start": WINDOW_START, "end": WINDOW_END}));

    // Citable ids come from the lines, targetable memories from `memories`, and
    // nothing else.
    let line_ids: BTreeSet<String> = pack.lines.iter().flat_map(|line| line.ids.clone()).collect();
    assert_eq!(pack.evidence_ids(), line_ids);
    let memory_ids: BTreeSet<String> = pack.memories.iter().map(|memory| memory.memory_id.clone()).collect();
    assert_eq!(pack.memory_ids(), memory_ids);
    assert_eq!(memory_ids, BTreeSet::from(["mem-w47".to_string()]));
    assert!(!pack.lines.is_empty());
    assert!(value["lines"].as_array().unwrap().iter().all(|line| {
        line["ids"].as_array().is_none_or(|ids| {
            ids.iter().all(|id| line_ids.contains(id.as_str().unwrap_or_default()))
        })
    }));

    // Facts, blocks, Soul and the persona are host additions, never pack keys.
    for absent in ["facts", "blocks", "soul", "persona"] {
        assert!(value.get(absent).is_none(), "{absent} leaked into the pack");
    }
    for present in ["schemaVersion", "window", "observationCount", "header", "lines", "memories", "preferences"] {
        assert!(value.get(present).is_some(), "{present} missing from the pack");
    }
    let keys: BTreeSet<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
    assert!(keys.iter().all(|key| {
        ["schemaVersion", "window", "observationCount", "header", "lines", "memories", "preferences", "omitted"]
            .contains(key)
    }));

    // The same database and window give the same bytes, header and lines alike.
    let again = build_pack(&conn);
    assert_eq!(value, again.to_value());
}

#[test]
fn a_format_22_backup_carries_the_report_its_facts_and_the_model_revision() {
    let (_dir, conn) = report_fixture();
    let mut report = final_report(&conn);
    let facts = facts_value(&report);
    let run = started_run(&conn);
    let edits = json!([{
        "key": "soul.toneSuggestion",
        "value": "温和",
        "evidenceIds": ["qtype.tfng.wrong"],
        "reason": "两篇判断题失分，先接住挫折"
    }]);
    let tx = conn.unchecked_transaction().unwrap();
    let applied = soul::soul_apply_edits_in_transaction(&tx, "local", &run, &edits, &facts).unwrap();
    assert_eq!(applied.len(), 1);
    report.profile_edits = applied
        .into_iter()
        .map(|edit| serde_json::from_value::<AppliedProfileEdit>(edit).unwrap())
        .collect();
    put_weekly_report(&tx, "local", &run, &report, UTC, WINDOW_END).unwrap();
    finish_dream_run(&tx, &run, "out", WINDOW_END).unwrap();
    tx.commit().unwrap();
    let source_snapshot = soul::soul_snapshot(&conn, "local").unwrap();

    let package = create_backup_package(&conn, "weekly-soul-v3").unwrap();
    assert_eq!(package.manifest.schema_version, 22);
    assert!(package.database.iter().any(|table| table.name == "weekly_digests" && !table.rows.is_empty()));
    assert!(package.database.iter().any(|table| table.name == "soul_revisions" && !table.rows.is_empty()));

    let (_target_dir, target) = open_db();
    let restored = import_backup(&target, &package, false).unwrap();
    assert!(restored.ok, "{:?}", restored.errors);

    let listed = list_weekly_reports(&target, "local", 8).unwrap();
    assert_eq!(listed, vec![report.clone()]);
    assert_eq!(listed[0].facts, report.facts);
    assert_eq!(listed[0].narrative, report.narrative);
    assert_eq!(listed[0].profile_edits, report.profile_edits);
    assert_eq!(soul::soul_snapshot(&target, "local").unwrap(), source_snapshot);
    assert_eq!(profile_value(&target, "soul.toneSuggestion"), json!("温和"));

    let digest: Value = serde_json::from_str(
        &target
            .query_row("SELECT digest_json FROM weekly_digests WHERE run_id = ?1", [&run], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
    )
    .unwrap();
    assert_eq!(digest["schemaVersion"], json!(3));
    assert_eq!(digest["facts"], serde_json::to_value(&report.facts).unwrap());
    assert_eq!(digest["narrative"]["nextSteps"][0]["text"], json!("下周再练判断题。"));

    let (actor, evidence_json): (String, String) = target
        .query_row(
            "SELECT actor, evidence_ids_json FROM soul_revisions WHERE preference_key = 'soul.toneSuggestion'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(actor, "model");
    assert_eq!(serde_json::from_str::<Value>(&evidence_json).unwrap(), json!(["qtype.tfng.wrong"]));
}
