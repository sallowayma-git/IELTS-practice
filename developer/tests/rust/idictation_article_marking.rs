use super::*;

#[test]
fn restores_only_completed_marks_and_uses_the_original_round() {
    let value = snapshot(&json!({
        "last_key_jingting":"42","existing_id_jingting":[3,4],
        "data":[{"id":3,"markChoice":2,"markCompleted":null,"collected":true},
                {"id":4,"markChoice":3,"markCompleted":false,"collected":false}]
    }), "short");
    assert_eq!(value["round"], "42");
    assert_eq!(value["states"]["idictation-article-short-3"], json!({"choice":2,"collected":true}));
    assert_eq!(value["states"]["idictation-article-short-4"]["choice"], 0);
}

#[test]
fn a_partial_receipt_cannot_clear_an_uncertain_mark_and_collect() {
    let pending = json!({"round":"42","choice":2,"collect":true});
    assert!(!resolves(&pending, "42", Mark { choice: 2, collected: false }));
    assert!(!resolves(&pending, "43", Mark { choice: 2, collected: true }));
    assert!(resolves(&pending, "42", Mark { choice: 2, collected: true }));
}
