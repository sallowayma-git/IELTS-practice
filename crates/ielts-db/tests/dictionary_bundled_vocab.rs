//! Bundled ECDICT lookup on a fresh database + vocabulary dedupe by normalized term.

use std::path::PathBuf;

use tempfile::tempdir;

use ielts_db::{
    list_vocab, lookup_term, lookup_term_with_bundled, migrate, open_connection, upsert_vocab,
    BundledDictionary, DbOpenOptions, UpsertVocabCommand, PLACEHOLDER_DEFINITION,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn bundle_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../assets/wordlists/ecdict_reading.bundle.js")
}

fn save(conn: &rusqlite::Connection, term: &str, definition: Option<&str>) -> String {
    upsert_vocab(
        conn,
        &UpsertVocabCommand {
            id: None,
            term: term.into(),
            definition: definition.map(Into::into),
            phonetic: None,
            part_of_speech: None,
            example: None,
            source_asset_id: Some("asset-1".into()),
            source_attempt_id: None,
            tags: vec!["reading".into()],
        },
    )
    .unwrap()
    .id
}

#[test]
fn fresh_install_resolves_common_words_from_bundled_ecdict() {
    let (_dir, conn) = open_db();
    let bundled = BundledDictionary::load(&bundle_path()).unwrap();
    assert!(
        bundled.len() > 10_000,
        "bundle parsed only {} entries",
        bundled.len()
    );

    // Empty SQLite table: the old path misses.
    assert!(!lookup_term(&conn, "abandon").unwrap().found);

    let hit = lookup_term_with_bundled(&conn, "abandon", Some(&bundled)).unwrap();
    assert!(hit.found);
    assert_eq!(hit.term, "abandon");
    assert!(hit.definition.contains("放弃"), "{}", hit.definition);
    assert_eq!(hit.source_label.as_deref(), Some("ECDICT"));

    // Case + surrounding punctuation from a highlight.
    assert!(
        lookup_term_with_bundled(&conn, " “Abandon,” ", Some(&bundled))
            .unwrap()
            .found
    );
    // Inflected form without its own headword resolves via the exchange field.
    let inflected = lookup_term_with_bundled(&conn, "abandons", Some(&bundled)).unwrap();
    assert!(inflected.found);
    assert_eq!(inflected.term, "abandon");

    assert!(
        !lookup_term_with_bundled(&conn, "zzzz-not-a-word", Some(&bundled))
            .unwrap()
            .found
    );
}

#[test]
fn vocab_upsert_dedupes_by_normalized_term_and_replaces_placeholder() {
    let (_dir, conn) = open_db();
    let first = save(&conn, "Abandon", Some(PLACEHOLDER_DEFINITION));
    let item = &list_vocab(&conn, 10, 0).unwrap()[0];
    assert_eq!(item.definition, None, "placeholder must not be stored");

    let second = save(&conn, " abandon. ", Some("vt. 放弃"));
    assert_eq!(first, second);
    let third = save(&conn, "ABANDON", None);
    assert_eq!(first, third);

    let items = list_vocab(&conn, 10, 0).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].definition.as_deref(), Some("vt. 放弃"));
    assert_eq!(items[0].source_asset_id.as_deref(), Some("asset-1"));
}

#[test]
fn legacy_placeholder_row_is_cleared_on_next_save() {
    let (_dir, conn) = open_db();
    let id = save(&conn, "ephemeral", None);
    conn.execute(
        "UPDATE vocabulary_items SET definition = ?1 WHERE id = ?2",
        rusqlite::params![PLACEHOLDER_DEFINITION, id],
    )
    .unwrap();
    save(&conn, "ephemeral", Some(PLACEHOLDER_DEFINITION));
    let items = list_vocab(&conn, 10, 0).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].definition, None);
    save(&conn, "ephemeral", Some("adj. 短暂的"));
    assert_eq!(
        list_vocab(&conn, 10, 0).unwrap()[0].definition.as_deref(),
        Some("adj. 短暂的")
    );
}
