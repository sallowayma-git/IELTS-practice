use super::*;

fn directory() -> Value {
    json!({"book":{"id":1},"categories":[{
        "id":9,"name":"样例分类","chapters":[{"id":36,"category_id":9,"name":"样例章节","pair_count":1}]
    }]})
}

fn detail() -> Value {
    json!({
        "book":{"id":1},"category":{"id":9},"chapter":{"id":36},
        "groups":[{"id":56,"chapter_id":36,"version":2,"pair_count":1,"pairs":[
            {"id":57,"group_id":56,"is_delete":0,"left_text":"major","right_text":"significant","meaning_zh":"重要的"},
            {"id":58,"group_id":56,"is_delete":1}
        ]}]
    })
}

#[test]
fn directory_binds_readable_material_to_book_category_and_chapter() {
    let mut session = SynonymSession::default();
    books(
        &mut session,
        &json!([{"id":1,"name":"样例词书","pair_count":1}]),
    )
    .unwrap();
    chapters(&mut session, "1", &directory()).unwrap();
    let material = chapter(&session.chapters["36"], "36", &detail()).unwrap();
    let groups = serde_json::to_value(material).unwrap();
    assert_eq!(groups[0]["version"], 2);
    assert_eq!(
        groups[0]["pairs"],
        json!([{"id":"57","left":"major","right":"significant","meaning":"重要的"}])
    );
    books(&mut session, &json!([])).unwrap();
    assert!(session.chapters.is_empty());
}

#[test]
fn wrong_scope_duplicate_and_partial_response_are_rejected() {
    let mut session = SynonymSession::default();
    assert!(chapters(&mut session, "2", &directory()).is_err());
    let mut wrong = directory();
    wrong["categories"][0]["chapters"][0]["category_id"] = json!(10);
    assert!(chapters(&mut session, "1", &wrong).is_err());
    assert!(session.chapters.is_empty());
    chapters(&mut session, "1", &directory()).unwrap();
    let grant = &session.chapters["36"];
    for (pointer, value) in [
        ("/category/id", json!(8)),
        ("/groups/0/chapter_id", json!(37)),
        ("/groups/0/pairs/1/id", json!(57)),
        ("/groups/0/pair_count", json!(2)),
    ] {
        let mut raw = detail();
        *raw.pointer_mut(pointer).unwrap() = value;
        assert!(chapter(grant, "36", &raw).is_err(), "{pointer}");
    }
}
