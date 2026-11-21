use super::*;
use serde_json::json;

fn sample() -> (SourceBook, SourceChapter, WordPage) {
    // Synthetic shape fixture from public-client consumption, not an account capture.
    (
        serde_json::from_value(json!({"id":1,"name":"Fixture book","need_buy":0})).unwrap(),
        serde_json::from_value(json!({"id":2,"name":"Fixture unit","g_id":1})).unwrap(),
        serde_json::from_value(json!({"total":1,"data":[{"id":3,"word":"apple","c_id":2,"g_id":1,
            "translate":"n. 苹果","phonetic_transcription":"ˈæpl","phonetic-m":"https://example.invalid/audio.mp3"}]})).unwrap(),
    )
}

#[test]
fn maps_source_identity_and_phonetic_text_without_treating_audio_as_phonetics() {
    let (book, chapter, page) = sample();
    let converted = convert_unit("test-owner", &book, &chapter, 0, page).unwrap();
    assert_eq!(converted.book_source_id, "1");
    assert_eq!(converted.unit_source_id, "2");
    assert_eq!(converted.words[0].source_id, "3");
    assert_eq!(converted.words[0].phonetic.as_deref(), Some("ˈæpl"));
    assert_ne!(converted.owner_key, "test-owner");
}

#[test]
fn rejects_locked_incomplete_and_cross_book_data() {
    let (mut book, chapter, page) = sample();
    book.need_buy = json!(1);
    assert!(convert_unit("owner", &book, &chapter, 0, page).is_err());
    let (book, chapter, mut page) = sample();
    page.total = 2;
    assert!(convert_unit("owner", &book, &chapter, 0, page).is_err());
    let (book, chapter, mut page) = sample();
    page.data[0].g_id = json!(9);
    assert!(convert_unit("owner", &book, &chapter, 0, page).is_err());
}

#[test]
fn chapters_preserve_group_and_word_order() {
    let chapters: Chapters = serde_json::from_value(json!({"chapters":[
        {"list":[{"id":2,"name":"A"}]}, {"list":[{"id":3,"name":"B"}]}
    ]})).unwrap();
    let ids = chapters.chapters.into_iter().flat_map(|g| g.list).map(|c| id(&c.id).unwrap()).collect::<Vec<_>>();
    assert_eq!(ids, vec!["2", "3"]);
}

#[test]
fn observed_compact_and_full_chapters_keep_entry_identity() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../fixtures/idictation/observed-vocabulary.json"
    )).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 2);
    for case in cases {
        let book: SourceBook = serde_json::from_value(case["book"].clone()).unwrap();
        let chapter: SourceChapter = serde_json::from_value(case["chapter"].clone()).unwrap();
        let page: WordPage = serde_json::from_value(case["page"].clone()).unwrap();
        let expected = case["page"]["data"].as_array().unwrap();
        let converted = convert_unit("fixture-owner", &book, &chapter, 0, page).unwrap();
        assert_eq!(converted.words.len(), expected.len());
        for (word, source) in converted.words.iter().zip(expected) {
            assert_eq!(source["lexicon_id"], 0);
            assert_eq!(word.source_id, source["id"].to_string());
            assert_eq!(word.term, source["word"].as_str().unwrap());
            assert_eq!(word.definition.as_deref(), source["translate"].as_str());
            assert_eq!(word.phonetic.as_deref(), source["phonetic_transcription"].as_str());
        }
    }
}
