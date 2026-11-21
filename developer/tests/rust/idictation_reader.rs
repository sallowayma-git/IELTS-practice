use super::*;

fn response() -> Value {
    let fixture: Value = serde_json::from_str(include_str!("../fixtures/idictation/observed-materials.json")).unwrap();
    let mut value = fixture["reader"].clone();
    value["version"]["sentence_count"] = json!(5);
    value["media"] = json!([]);
    value
}

fn catalog_value() -> Value {
    json!({"page":1,"page_size":24,"total":1,"items":[{
        "id":2,"subject":"reading","track":"a","book_number":21,"test_number":1,
        "part_number":1,"title":"The Davies Sisters","word_count":836,"version_id":245
    }]})
}

#[test]
fn catalog_validates_page_scope_complete_count_and_unique_ids() {
    let mut session = ReaderSession::default();
    let page = catalog(&mut session, catalog_value(), "a", 21, 1).unwrap();
    assert_eq!(page.items.len(), 1);
    assert!(session.grants.contains_key("2"));
    for (field, bad) in [("page", json!(2)), ("total", json!(2)), ("page_size", json!(0))] {
        let mut value = catalog_value(); value[field] = bad;
        assert!(catalog(&mut session, value, "a", 21, 1).is_err());
    }
    assert!(catalog(&mut session, catalog_value(), "g", 21, 1).is_err());
    let mut duplicate = catalog_value();
    duplicate["total"] = json!(2);
    duplicate["items"].as_array_mut().unwrap().push(catalog_value()["items"][0].clone());
    assert!(catalog(&mut session, duplicate, "a", 21, 1).is_err());
    let mut empty = catalog_value(); empty["items"] = json!([]); empty["total"] = json!(0);
    catalog(&mut session, empty, "a", 21, 1).unwrap();
    assert!(session.grants.is_empty());
}

#[test]
fn reader_material_is_owner_scoped_and_version_checked() {
    let mut session = ReaderSession::default();
    catalog(&mut session, catalog_value(), "a", 21, 1).unwrap();
    let grant = session.grants.get("2").unwrap();
    let value = response();
    let alice = convert("account-a", grant, &value).unwrap();
    let bob = convert("account-b", grant, &value).unwrap();
    assert_ne!(alice.asset.id, bob.asset.id);
    assert_eq!(alice.asset.id, convert("account-a", grant, &value).unwrap().asset.id);
    assert!(alice.asset.content_ref.is_none());
    assert_eq!(alice.payload["practiceKind"], "material");
    assert_eq!(alice.payload["capabilities"]["localDraft"], false);
    assert_eq!(alice.payload["answerKey"], json!({}));
    let mut changed = value.clone(); changed["version"]["id"] = json!(246);
    assert!(convert("account-a", grant, &changed).unwrap_err().contains("版本"));
    let mut wrong_book = value.clone(); wrong_book["document"]["book_number"] = json!(20);
    assert!(convert("account-a", grant, &wrong_book).is_err());
}
