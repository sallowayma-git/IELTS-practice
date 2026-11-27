use super::*;

fn source() -> (SourceBook, SourceChapter, Value) {
    let book = serde_json::from_value(json!({"id": 42, "name": "Example"})).unwrap();
    let chapter = serde_json::from_value(json!({"id": 7, "g_id": 42, "name": "Unit 1"})).unwrap();
    let value = json!({"total": 2, "data": [
        {"id": 8, "c_id": 7, "g_id": 42, "word": "atlas", "translate": "地图册",
         "phonetic-m": "https://audio-1-cdn.idictation.cn/atlas.mp3",
         "phonetic-y": "https://unverified.example/atlas.mp3"},
        {"id": 9, "c_id": 7, "g_id": 42, "word": "map",
         "phonetic-y": "https://audio-1-cdn.idictation.cn/map.mp3"}
    ]});
    (book, chapter, value)
}

#[test]
fn returns_only_playback_ids_and_keeps_verified_media_in_host_payload() {
    let (book, chapter, value) = source();
    let (words, payload) = playlist("owner", &book, &chapter, value).unwrap();
    assert_eq!(words[0]["american"], "8-american");
    assert!(words[0]["british"].is_null());
    assert_eq!(words[1]["british"], "9-british");
    assert!(!words.to_string().contains("https://"));
    assert_eq!(payload["studyMaterial"]["media"].as_array().unwrap().len(), 2);
}

#[test]
fn rejects_partial_and_cross_chapter_playlists() {
    let (book, chapter, mut value) = source();
    value["total"] = json!(3);
    assert!(playlist("owner", &book, &chapter, value.clone()).is_err());
    value["total"] = json!(2);
    value["data"][0]["c_id"] = json!(10);
    assert!(playlist("owner", &book, &chapter, value).is_err());
}
