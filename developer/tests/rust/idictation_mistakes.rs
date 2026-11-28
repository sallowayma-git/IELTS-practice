use super::*;

fn record(n: u64) -> Value {
    json!({"id":n,"user_id":"7","is_delete":0,"lexicon":{
        "id":1000+n,"word":format!("word {n}"),"translate":"释义","phonetic_transcription":"/wɜːd/"
    }})
}

fn page(current: u64, total: u64, data: Vec<Value>) -> Value {
    json!({"current_page":current,"per_page":PAGE_SIZE,"last_page":total.div_ceil(PAGE_SIZE).max(1),"total":total,"data":data})
}

#[test]
fn requires_complete_pagination_and_rejects_changed_account_and_duplicate_records() {
    let first = page(1, 201, (1..=200).map(record).collect());
    let mut snapshot = Snapshot::new();
    assert!(!snapshot.accept("7", &first).unwrap());
    assert!(snapshot
        .accept("7", &page(2, 201, vec![record(200)]))
        .is_err());
    assert!(snapshot
        .accept("8", &page(2, 201, vec![record(201)]))
        .is_err());
    assert!(snapshot
        .accept("7", &page(2, 202, vec![record(201)]))
        .is_err());
    assert!(snapshot.accept("7", &page(2, 201, vec![])).is_err());
    assert!(snapshot
        .accept("7", &page(2, 201, vec![record(201)]))
        .unwrap());
    let import = snapshot.into_import("7").unwrap();
    assert_eq!(import.words.len(), 201);
    assert_eq!(import.words.last().unwrap().source_id, "201");
    assert_eq!(import.provider, "idictation-mistakes");
    assert_ne!(import.owner_key, "7");
}

#[test]
fn empty_list_does_not_create_book_and_deleted_or_missing_words_are_skipped() {
    let mut snapshot = Snapshot::new();
    assert!(snapshot.accept("7", &page(1, 0, vec![])).unwrap());
    assert!(snapshot.into_import("7").is_none());
    let mut deleted = record(2);
    deleted["is_delete"] = json!(1);
    let mut missing = record(3);
    missing["lexicon"] = Value::Null;
    let mut snapshot = Snapshot::new();
    assert!(snapshot
        .accept("7", &page(1, 3, vec![record(1), deleted, missing]))
        .unwrap());
    let import = snapshot.into_import("7").unwrap();
    assert_eq!(import.words.len(), 1);
    assert_eq!(import.words[0].phonetic.as_deref(), Some("/wɜːd/"));
}
