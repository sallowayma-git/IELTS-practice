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

#[test]
fn collection_open_reuses_reader_and_locates_only_the_verified_version_and_sentence() {
    let source = response();
    let material = material::reader("2", &source).unwrap();
    let sentence = &material.payload["studyMaterial"]["parts"][0]["paragraphs"].as_array().unwrap()
        .iter().find(|p| !p["sentences"].as_array().unwrap().is_empty()).unwrap()["sentences"][0];
    let focus = sentence["id"].as_str().unwrap();
    let sid = focus.rsplit("-s").next().unwrap();
    let list = json!({"page":1,"page_size":20,"total":1,"items":[{
        "document":{"id":2,"title":"Example","subject":"reading"},
        "sentence":{"id":sid,"document_version_id":245,"text":sentence["text"]},
        "annotations":[{"note":"do not import"}]
    }]});
    let (page, grants) = reader_collections::page(&list, 1).unwrap();
    let grant = &grants[&format!("2:245:{sid}")];
    let (loaded, located) = resolve_collected("owner", grant, &source).unwrap();
    assert_eq!(located, focus);
    assert_eq!(loaded.payload["capabilities"]["remoteSubmit"], false);
    assert!(!serde_json::to_string(&page).unwrap().contains("do not import"));
    let mut changed = grant.clone();
    changed.text = "Changed source".into();
    assert!(resolve_collected("owner", &changed, &source).is_err());
    changed.version = "246".into();
    assert!(resolve_collected("owner", &changed, &source).is_err());
    let (empty, grants) = reader_collections::page(&json!({"page":1,"page_size":20,"total":0,"items":[]}),1).unwrap();
    assert!(empty.items.is_empty() && grants.is_empty());
}

#[test]
fn reader_position_stays_inside_loaded_utf16_blocks() {
    let payload = json!({"idictation":{"blocks":[{"block_key":"p1","text":"😀a"}]}});
    assert!(position_exists(&payload, "p1", 3));
    assert!(!position_exists(&payload, "p1", 4));
    assert!(!position_exists(&payload, "other", 0));
    assert!(matches!(
        serde_json::from_value::<ProgressAction>(json!({"kind":"save","blockKey":"p1","textOffset":3})).unwrap(),
        ProgressAction::Save { text_offset: 3, .. }
    ));
}

#[test]
fn reader_annotations_restore_only_exact_sentence_anchors() {
    let payload = json!({"idictation":{"document":{"id":2},"version":{"id":245},"blocks":[
        {"block_key":"p1","text":"😀 Hello.","sentences":[{"id":9,"start_offset":3,"end_offset":9}]}
    ]}});
    let annotations = super::super::reader_annotations::snapshot(&payload, &json!([
        {"kind":"note","id":4,"client_key":"one","lock_version":1,"note":"A note",
         "anchor":{"block_key":"p1","start":3,"end":9,"quote":"Hello."}},
        {"kind":"note","id":5,"client_key":"two","lock_version":1,"note":"Wrong anchor",
         "anchor":{"block_key":"p1","start":3,"end":9,"quote":"Hello!"}}
    ]));
    assert_eq!(annotations["idictation-reader-2-v245-s9"][0]["note"], "A note");
    assert_eq!(annotations["idictation-reader-2-v245-s9"].as_array().unwrap().len(), 1);
}
