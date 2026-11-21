use super::*;
use crate::{backup, migrate::migrate, vocab::{review_vocab, ReviewVocabCommand}};

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn input(book: &str, unit: &str, terms: &[&str]) -> UnitImport {
    UnitImport {
        provider: "idictation".into(), owner_key: "test-owner-hash".into(),
        book_source_id: book.into(), book_title: format!("Book {book}"),
        unit_source_id: unit.into(), unit_title: format!("Unit {unit}"), unit_position: 0,
        words: terms.iter().enumerate().map(|(n, term)| SourceWord {
            source_id: n.to_string(), term: (*term).into(), definition: Some("source definition".into()),
            phonetic: None, example: None,
        }).collect(),
    }
}

#[test]
fn books_share_words_without_overwriting_user_data_or_reviews() {
    let mut conn = database();
    let item = upsert_vocab(&conn, &UpsertVocabCommand {
        id: None, term: "Apple".into(), definition: Some("my definition".into()),
        phonetic: None, part_of_speech: None, example: None, source_asset_id: None,
        source_attempt_id: None, tags: vec!["reading".into()],
    }).unwrap();
    let reviewed = review_vocab(&conn, &ReviewVocabCommand { item_id: item.id.clone(), grade: 2 }).unwrap();
    let first = import_unit(&mut conn, &input("1", "1", &["apple", "banana"])).unwrap();
    import_unit(&mut conn, &input("1", "2", &["APPLE"])).unwrap();
    let second = import_unit(&mut conn, &input("2", "1", &["apple"])).unwrap();
    import_unit(&mut conn, &input("1", "1", &["apple", "banana"])).unwrap();
    assert_eq!(get_vocab(&conn, &item.id).unwrap(), reviewed);
    assert_eq!(list_books(&conn).unwrap().len(), 2);
    assert_eq!(list_units(&conn, &first.book_id).unwrap().len(), 2);
    assert_eq!(list_words(&conn, &first.book_id, None, 500, 0).unwrap().len(), 2);
    assert_eq!(list_words(&conn, &second.book_id, None, 500, 0).unwrap()[0].id, item.id);
}

#[test]
fn invalid_unit_leaves_no_partial_book_or_words() {
    let mut conn = database();
    let mut data = input("1", "1", &["apple", "banana"]);
    data.words[1].source_id = "0".into();
    assert!(import_unit(&mut conn, &data).is_err());
    assert!(list_books(&conn).unwrap().is_empty());
    assert!(crate::list_vocab(&conn, 500, 0).unwrap().is_empty());
}

#[test]
fn account_and_book_identities_are_distinct() {
    let mut conn = database();
    let mut data = input("1", "1", &["apple"]);
    let a = import_unit(&mut conn, &data).unwrap();
    data.owner_key = "another-owner".into();
    let b = import_unit(&mut conn, &data).unwrap();
    assert_ne!(a.book_id, b.book_id);
    assert_ne!(a.unit_id, b.unit_id);
    let source=source_unit(&conn,&a.book_id,&a.unit_id).unwrap();
    assert_eq!(source.provider,"idictation");
    assert_eq!(source.owner_key,"test-owner-hash");
    assert_eq!(source.book_id,"1");
    assert_eq!(source.chapter_id,"1");
    assert!(source_unit(&conn,&a.book_id,&b.unit_id).is_err());
}

#[test]
fn membership_and_progress_survive_backup_restore() {
    let mut conn = database();
    let imported = import_unit(&mut conn, &input("1", "1", &["apple"])).unwrap();
    let word = list_words(&conn, &imported.book_id, None, 500, 0).unwrap().remove(0);
    let reviewed = review_vocab(&conn, &ReviewVocabCommand { item_id: word.id.clone(), grade: 1 }).unwrap();
    let package = backup::create_backup_package(&conn, "test").unwrap();
    backup::validate_backup(&package).unwrap();
    let other = database();
    let report = backup::import_backup(&other, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert_eq!(list_words(&other, &imported.book_id, Some(&imported.unit_id), 500, 0).unwrap().len(), 1);
    assert_eq!(get_vocab(&other, &word.id).unwrap().review, reviewed.review);
}

#[test]
fn format22_restore_into_book_schema_keeps_words_and_review_state() {
    let mut source = database();
    let imported = import_unit(&mut source, &input("1", "1", &["apple"])).unwrap();
    let word = list_words(&source, &imported.book_id, None, 500, 0).unwrap().remove(0);
    let reviewed = review_vocab(&source, &ReviewVocabCommand { item_id: word.id.clone(), grade: 2 }).unwrap();
    let mut package = backup::create_backup_package(&source, "format22-fixture").unwrap();
    package.manifest.schema_version = 22;
    package.manifest.database_schema_version = 41;
    package.database.retain(|t| !matches!(t.name.as_str(),
        "vocabulary_books" | "vocabulary_book_units" | "vocabulary_book_entries"));
    package.manifest.table_count = package.database.len() as u32;
    package.manifest.row_count = package.database.iter().map(|t| t.rows.len() as u64).sum::<u64>()
        + package.secret_refs.len() as u64;
    package.manifest.checksum_sha256.clear();
    package.manifest.checksum_sha256 = hex::encode(Sha256::digest(serde_json::to_vec(&package).unwrap()));
    let mut target = database();
    import_unit(&mut target, &input("other", "1", &["pear"])).unwrap();
    let report = backup::import_backup(&target, &package, false).unwrap();
    assert!(report.ok, "{:?}", report.errors);
    assert!(list_books(&target).unwrap().is_empty());
    assert_eq!(get_vocab(&target, &word.id).unwrap().review, reviewed.review);
}
