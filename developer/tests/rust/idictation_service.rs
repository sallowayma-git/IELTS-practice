use super::*;

#[test]
fn only_catalog_granted_books_are_readable() {
    let mut session = Session::default();
    catalog(&mut session, json!([
        {"id":1,"name":"Free","type":"lexicon","need_buy":0},
        {"id":2,"name":"Locked","type":"lexicon","need_buy":1,"already_buy":false},
        {"id":3,"name":"Purchased","type":"lexicon","need_buy":1,"already_buy":true},
        {"id":4,"name":"Article","type":"article"}
    ])).unwrap();
    assert!(accessible_book(&session, "1").is_ok());
    assert!(accessible_book(&session, "2").is_err());
    assert!(accessible_book(&session, "3").is_ok());
    assert!(accessible_book(&session, "4").is_err());
    assert!(accessible_book(&session, "999").is_err());
}

#[test]
fn changing_account_invalidates_all_grants() {
    let mut session = Session::default();
    session.accept_owner("1".into()).unwrap();
    catalog(&mut session, json!([{"id":1,"name":"Book","type":"lexicon"}])).unwrap();
    assert!(session.accept_owner("2".into()).is_err());
    assert!(session.owner.is_none());
    assert!(session.books.is_empty());
    assert!(session.chapters.is_empty());
    session.accept_owner("2".into()).unwrap();
    assert_eq!(session.owner.as_deref(), Some("2"));
}

#[test]
fn duplicate_catalog_is_rejected_without_replacing_grants() {
    let mut session = Session::default();
    assert!(catalog(&mut session, json!([
        {"id":1,"name":"A","type":"lexicon"},
        {"id":1,"name":"B","type":"lexicon"}
    ])).is_err());
    assert!(session.books.is_empty());
}
