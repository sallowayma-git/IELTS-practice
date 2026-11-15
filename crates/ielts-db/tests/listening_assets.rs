//! W3-2: listening resource packs, index, view payload and audio serving.

mod listening_fixture;

use std::fs;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};

use ielts_db::{
    list_assets, list_listening_assets, load_listening_audio_data_url, load_listening_payload,
    load_listening_payload_for_view, seed_builtin_listening_pack,
};
use ielts_domain::domain::Activity;
use listening_fixture::{insert_listening_asset, open_db, sample_payload, wav_bytes, write_manifest, write_pack};

fn seed(conn: &rusqlite::Connection, root: &std::path::Path) -> ielts_db::DbResult<usize> {
    seed_builtin_listening_pack(conn, root)
}

#[test]
fn seed_is_validated_idempotent_and_indexes_listening_only() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let sha = write_pack(&pack, &sample_payload(), &wav_bytes());

    assert_eq!(seed(&conn, &pack).unwrap(), 1);
    assert_eq!(seed(&conn, &pack).unwrap(), 1);
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM practice_assets", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 1);

    let listening = list_listening_assets(&conn).unwrap();
    assert_eq!(listening.len(), 1);
    let asset = &listening[0];
    assert_eq!(asset.id, "l1-test");
    assert_eq!(asset.activity, "listening");
    assert_eq!(asset.title, "Listening Test 1");
    assert_eq!(asset.fingerprint, sha);
    assert_eq!(asset.content_ref.as_deref(), Some(pack.join("exam.json").to_str().unwrap()));
    assert_eq!(
        asset.question_kinds,
        vec!["form_completion", "single_choice", "multi_choice", "matching"]
    );

    let stored: (String, String) = conn
        .query_row(
            "SELECT source_kind, source_key FROM practice_assets WHERE id = 'l1-test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(stored, ("builtin".into(), "l1-test".into()));
}

#[test]
fn changed_bytes_update_the_indexed_row() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    seed(&conn, &pack).unwrap();

    let mut renamed = sample_payload();
    renamed["meta"]["title"] = json!("Listening Test 1 (revised)");
    let new_sha = write_pack(&pack, &renamed, &wav_bytes());
    seed(&conn, &pack).unwrap();

    let (title, fingerprint): (String, String) = conn
        .query_row(
            "SELECT title, fingerprint FROM practice_assets WHERE id = 'l1-test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(title, "Listening Test 1 (revised)");
    assert_eq!(fingerprint, new_sha);
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM practice_assets", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn reseeding_unchanged_bytes_repoints_a_moved_pack() {
    // A restored backup or a relocated install directory ships identical pack
    // bytes at a new absolute path; content_ref must follow or the library is
    // unreadable even though the index still lists it.
    let (dir, conn) = open_db();
    let first = dir.path().join("listening");
    write_pack(&first, &sample_payload(), &wav_bytes());
    seed(&conn, &first).unwrap();

    let moved = dir.path().join("listening-moved");
    let sha = write_pack(&moved, &sample_payload(), &wav_bytes());
    assert_eq!(seed(&conn, &moved).unwrap(), 1);

    let listening = list_listening_assets(&conn).unwrap();
    assert_eq!(listening.len(), 1);
    assert_eq!(listening[0].fingerprint, sha);
    assert_eq!(
        listening[0].content_ref.as_deref(),
        Some(moved.join("exam.json").to_str().unwrap())
    );
    load_listening_payload(&conn, "l1-test").unwrap();
    load_listening_audio_data_url(&conn, "l1-test", &moved).unwrap();
}

#[test]
fn reseeding_unchanged_bytes_refreshes_derived_columns() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    seed(&conn, &pack).unwrap();
    conn.execute(
        "UPDATE practice_assets SET question_kinds_json = '[]', metadata_json = '{}'
         WHERE id = 'l1-test'",
        [],
    )
    .unwrap();

    seed(&conn, &pack).unwrap();

    let (kinds, metadata): (String, String) = conn
        .query_row(
            "SELECT question_kinds_json, metadata_json FROM practice_assets WHERE id = 'l1-test'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Vec<String>>(&kinds).unwrap(),
        ["form_completion", "single_choice", "multi_choice", "matching"]
    );
    let metadata: Value = serde_json::from_str(&metadata).unwrap();
    assert_eq!(metadata["audio"], json!("audio/exam.wav"));
    assert_eq!(metadata["durationSeconds"], json!(1800));
}

#[test]
fn checksum_mismatch_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    write_manifest(
        &pack,
        json!([{ "id": "l1-test", "file": "exam.json", "sha256": "0".repeat(64) }]),
    );
    let err = seed(&conn, &pack).unwrap_err();
    assert!(err.to_string().contains("checksum mismatch"), "{err}");
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM practice_assets", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn exam_paths_may_not_escape_the_pack() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());

    for file in [
        "../escape.json",
        "nested\\escape.json",
        "/escape.json",
        "C:\\escape.json",
    ] {
        write_manifest(
            &pack,
            json!([{ "id": "l1-test", "file": file, "sha256": "0".repeat(64) }]),
        );
        let err = seed(&conn, &pack).unwrap_err();
        assert!(
            err.to_string().contains("invalid listening exam path"),
            "{file}: {err}"
        );
    }
}

#[test]
fn audio_paths_may_not_escape_the_pack() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    for audio in ["../escape.wav", "audio\\escape.wav", "/escape.wav"] {
        let mut payload = sample_payload();
        payload["meta"]["audio"] = json!(audio);
        write_pack(&pack, &payload, &wav_bytes());
        let err = seed(&conn, &pack).unwrap_err();
        assert!(
            err.to_string().contains("invalid listening audio path"),
            "{audio}: {err}"
        );
    }
}

/// Every answer key value must be scoreable: one non-empty string or a
/// non-empty list of non-empty strings. Anything else marks every response
/// wrong while looking like a valid key.
#[test]
fn unscoreable_answer_key_values_are_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    for (value, reason) in [
        (json!(""), "empty string"),
        (json!(null), "null"),
        (json!({"value": "silk"}), "object"),
        (json!(42), "number"),
        (json!([]), "empty array"),
        (json!(["silk", ""]), "array must contain only non-empty strings"),
    ] {
        let mut payload = sample_payload();
        payload["answerKey"]["q2"] = value.clone();
        write_pack(&pack, &payload, &wav_bytes());
        let err = seed(&conn, &pack).unwrap_err().to_string();
        assert!(
            err.contains("invalid answerKey value for q2"),
            "{value}: {err}"
        );
        assert!(err.contains(reason), "{value}: {err}");
    }
}

#[test]
fn duplicate_normalized_answer_keys_are_rejected() {
    // "2" and "q2" both normalize to q2. `load_answer_key` would keep only one
    // of them, so the pack must fail here instead of scoring against a key the
    // author did not write.
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["answerKey"]["2"] = json!("cotton");
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err().to_string();
    assert!(err.contains("normalize to the same question"), "{err}");
    assert!(err.contains("q2"), "{err}");
}

#[test]
fn unsupported_audio_extension_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["meta"]["audio"] = json!("audio/exam.ogg");
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err().to_string();
    assert!(
        err.contains("unsupported listening audio extension: ogg"),
        "{err}"
    );
}

#[test]
fn missing_audio_file_is_rejected_at_seed() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["meta"]["audio"] = json!("audio/missing.wav");
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err().to_string();
    assert!(err.contains("not accessible"), "{err}");
    assert!(err.contains("audio/missing.wav"), "{err}");
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM practice_assets", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}

#[test]
fn audio_directory_is_rejected_at_seed() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["meta"]["audio"] = json!("audio/dir.wav");
    write_pack(&pack, &payload, &wav_bytes());
    fs::create_dir_all(pack.join("audio/dir.wav")).unwrap();
    let err = seed(&conn, &pack).unwrap_err().to_string();
    assert!(err.contains("not a regular file"), "{err}");
}

#[test]
fn section_outside_one_to_four_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    for section in [0, 5] {
        let mut payload = sample_payload();
        payload["questionGroups"][0]["section"] = json!(section);
        write_pack(&pack, &payload, &wav_bytes());
        let err = seed(&conn, &pack).unwrap_err();
        assert!(err.to_string().contains("invalid section"), "{section}: {err}");
    }
}

#[test]
fn unknown_question_kind_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["questionGroups"][1]["kind"] = json!("gap_fill");
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err();
    assert!(err.to_string().contains("unknown question kind"), "{err}");
}

/// The scorer maps `multi_choice` to a checkbox group; a paper that renders it
/// as radios would collect answers the scorer cannot compare as a set.
#[test]
fn listening_multi_choice_rendered_as_radio_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["interactionModel"]["q4"] = json!({ "control": "radio" });
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err().to_string();
    assert!(err.contains("q4"), "{err}");
    assert!(err.contains("multi_choice"), "{err}");
    assert!(err.contains("checkbox"), "{err}");
}

/// The mirror case: a single-choice question rendered as checkboxes would let
/// the learner tick several letters for a one-mark question.
#[test]
fn listening_single_choice_rendered_as_checkbox_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["interactionModel"]["q3"] = json!({ "control": "checkbox" });
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err().to_string();
    assert!(err.contains("q3"), "{err}");
    assert!(err.contains("single_choice"), "{err}");
    assert!(err.contains("checkbox"), "{err}");
}

#[test]
fn duplicate_question_across_groups_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["questionGroups"][3]["questionIds"] = json!(["q5", "q6", "q1"]);
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err();
    assert!(err.to_string().contains("appears in two groups"), "{err}");
}

#[test]
fn a_question_missing_from_question_order_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    let mut payload = sample_payload();
    payload["questionGroups"][2]["questionIds"] = json!(["q99"]);
    write_pack(&pack, &payload, &wav_bytes());
    let err = seed(&conn, &pack).unwrap_err();
    assert!(err.to_string().contains("not in questionOrder"), "{err}");
}

#[test]
fn writing_assets_are_not_mislabelled_by_the_unfiltered_list() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    seed(&conn, &pack).unwrap();
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, title, schema_version, fingerprint, pdf_only, created_at, updated_at
         ) VALUES ('w1', 'writing', 'builtin', 'Writing Task 2', 2, 'fp-writing', 0,
                   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    let all = list_assets(&conn, None).unwrap();
    let by_id = |id: &str| all.iter().find(|asset| asset.id == id).unwrap();
    assert_eq!(by_id("w1").activity, "writing");
    assert_eq!(by_id("l1-test").activity, "listening");
    assert_eq!(list_assets(&conn, Some(Activity::Writing)).unwrap().len(), 1);
    assert_eq!(list_assets(&conn, Some(Activity::Reading)).unwrap().len(), 0);

    let listening = list_listening_assets(&conn).unwrap();
    assert_eq!(listening.len(), 1);
    assert!(listening.iter().all(|asset| asset.activity == "listening"));
    assert!(load_listening_payload_for_view(&conn, "w1").is_err());
}

#[test]
fn view_payload_strips_inline_answers_like_reading() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    seed(&conn, &pack).unwrap();

    let raw = load_listening_payload(&conn, "l1-test").unwrap();
    assert!(raw.payload.to_string().contains("data-answer"));
    let view = load_listening_payload_for_view(&conn, "l1-test").unwrap();
    assert!(!view.to_string().contains("data-answer"), "{view}");
    assert_eq!(
        view["questionGroups"][0]["bodyHtml"],
        "<p>1 <input name=\"q1\"></p><p>2 <input name=\"q2\"></p>"
    );
    // The reading view contract leaves the answer key in place.
    assert_eq!(view["answerKey"], raw.payload["answerKey"]);
    assert_eq!(raw.asset.fingerprint, view_fingerprint(&conn));
}

fn view_fingerprint(conn: &rusqlite::Connection) -> String {
    conn.query_row(
        "SELECT fingerprint FROM practice_assets WHERE id = 'l1-test'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn audio_is_served_as_a_wav_data_url() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    seed(&conn, &pack).unwrap();

    let url = load_listening_audio_data_url(&conn, "l1-test", &pack).unwrap();
    let encoded = url
        .strip_prefix("data:audio/wav;base64,")
        .unwrap_or_else(|| panic!("unexpected data url: {url}"));
    assert_eq!(STANDARD.decode(encoded).unwrap(), wav_bytes());
}

#[test]
fn audio_outside_the_pack_root_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    fs::create_dir_all(&pack).unwrap();
    let mut payload = sample_payload();
    payload["meta"]["audio"] = json!("../outside.wav");
    insert_listening_asset(&conn, &pack, &payload);
    fs::write(dir.path().join("outside.wav"), wav_bytes()).unwrap();

    let err = load_listening_audio_data_url(&conn, "l1-test", &pack).unwrap_err();
    assert!(
        err.to_string().contains("invalid listening audio path"),
        "{err}"
    );
}

/// A relative path with no `..` can still escape through a link, so the
/// canonicalize containment check is a second, independent defense. Windows
/// junctions need no administrator rights, unlike `symlink_dir`, so this test
/// always exercises the escape instead of silently returning.
#[test]
fn audio_link_escaping_the_pack_root_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    fs::create_dir_all(&pack).unwrap();
    let outside = dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("escape.wav"), wav_bytes()).unwrap();
    create_directory_link(&outside, &pack.join("linked")).unwrap_or_else(|error| {
        panic!("could not create the directory link used by this test: {error}")
    });

    let mut payload = sample_payload();
    payload["meta"]["audio"] = json!("linked/escape.wav");
    insert_listening_asset(&conn, &pack, &payload);
    let err = load_listening_audio_data_url(&conn, "l1-test", &pack).unwrap_err();
    assert!(err.to_string().contains("escapes the pack root"), "{err}");
}

fn create_directory_link(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(windows)]
    {
        // Junctions resolve without SeCreateSymbolicLinkPrivilege, which a
        // default Windows account does not hold.
        let output = std::process::Command::new("cmd")
            .arg("/c")
            .arg("mklink")
            .arg("/J")
            .arg(link)
            .arg(target)
            .output()?;
        if output.status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other(format!(
                "mklink /J failed: {}{}",
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            )))
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err(std::io::Error::other(
            "no directory link support on this platform",
        ))
    }
}

#[test]
fn audio_over_32_mib_is_rejected() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    fs::create_dir_all(&pack).unwrap();
    let mut payload = sample_payload();
    payload["meta"]["audio"] = json!("audio/huge.wav");
    insert_listening_asset(&conn, &pack, &payload);
    fs::create_dir_all(pack.join("audio")).unwrap();
    let huge = fs::File::create(pack.join("audio/huge.wav")).unwrap();
    huge.set_len(32 * 1024 * 1024 + 1).unwrap();

    let err = load_listening_audio_data_url(&conn, "l1-test", &pack).unwrap_err();
    assert!(err.to_string().contains("exceeds"), "{err}");
}

#[test]
fn tampered_exam_bytes_fail_the_view_load() {
    let (dir, conn) = open_db();
    let pack = dir.path().join("listening");
    write_pack(&pack, &sample_payload(), &wav_bytes());
    seed(&conn, &pack).unwrap();
    let mut tampered: Value = sample_payload();
    tampered["meta"]["title"] = json!("tampered");
    fs::write(pack.join("exam.json"), tampered.to_string()).unwrap();

    let err = load_listening_payload_for_view(&conn, "l1-test").unwrap_err();
    assert!(err.to_string().contains("fingerprint mismatch"), "{err}");
}
