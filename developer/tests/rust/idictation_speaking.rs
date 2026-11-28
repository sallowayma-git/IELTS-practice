use super::*;

fn card(id: u64, locked: u8) -> Value {
    json!({"id":id,"title":"Topic","part":2,"locked":locked,"offline":0})
}

fn topic() -> Value {
    json!({"id":"17","part":2,"title":"Topic","locked":"0","offline":false,"questions":[
        {"id":7,"owner":17,"part":2,"title":"Describe an activity.","cues":["When?"],"ideas":[],
         "audio":"https://audio-1-cdn.idictation.cn/question.mp3"},
        {"id":"8","owner":"17","part":3,"title":"Why?","cues":[],"ideas":[],
         "audio":"https://example.invalid/unverified.mp3"}
    ]})
}

#[test]
fn catalog_keeps_groups_and_never_grants_a_restricted_topic() {
    let mut session = SpeakingSession::default();
    let cards = catalog(&json!([[card(17,0),card(18,0)],[],[card(18,1)]]), 2, &mut session).unwrap();
    assert_eq!(session.grants, HashMap::from([("17".into(), 2)]));
    assert!(cards[0][0].available);
    assert!(!cards[0][1].available);
    assert!(!cards[2][0].available);
    assert!(catalog(&json!([[card(17,0)],[],[]]), 1, &mut session).is_err());
}

#[test]
fn detail_keeps_part_three_and_exposes_only_verified_audio_ids() {
    let (result, payload) = convert(&topic(), "17", 2).unwrap();
    assert_eq!(result["questions"][0]["mediaId"], "7");
    assert_eq!(result["questions"][1]["part"], 3);
    assert!(result["questions"][1]["mediaId"].is_null());
    assert!(!result.to_string().contains("https://"));
    assert_eq!(payload["studyMaterial"]["media"].as_array().unwrap().len(), 1);
}

#[test]
fn detail_rejects_owner_part_and_permission_changes() {
    assert!(convert(&topic(), "18", 2).is_err());
    assert!(convert(&topic(), "17", 1).is_err());
    let mut mismatched = topic();
    mismatched["questions"][1]["owner"] = json!(18);
    assert!(convert(&mismatched, "17", 2).is_err());
    mismatched = topic();
    mismatched["locked"] = json!(1);
    assert!(convert(&mismatched, "17", 2).is_err());
}
