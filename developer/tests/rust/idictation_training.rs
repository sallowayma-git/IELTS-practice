use super::*;

fn fixture() -> (SourceBook,SourceChapter,Value) {
    let fixture:Value=serde_json::from_str(include_str!("../fixtures/idictation/observed-vocabulary.json")).unwrap();
    let case=&fixture["cases"][1];
    let mut page=case["page"].clone();
    page["existing_id"]=json!([]);page["last_key"]=Value::Null;
    for row in page["data"].as_array_mut().unwrap() {row["error_options"]=json!(r#"[{"word":"other","pos":"n.","definition":"不同；次要"}]"#);}
    (serde_json::from_value(case["book"].clone()).unwrap(),serde_json::from_value(case["chapter"].clone()).unwrap(),page)
}

fn training(mode:u8)->Training {
    let (book,chapter,page)=fixture();
    start("owner",&book,&chapter,page,json!({"1":"one"}),&json!({"word_wrong_word_cycle":1,"is_check_size":1}),mode,true).unwrap()
}

#[test]
fn four_modes_hide_the_answer_and_keep_local_reviews_out() {
    for mode in 1..=4 {
        let training=training(mode);let view=training.view();
        assert_eq!(view.word.is_some(),mode==4);
        assert_eq!(view.definition.is_some(),mode==3);
        assert_eq!(!view.options.is_empty(),matches!(mode,2|4));
        let public=serde_json::to_value(view).unwrap();
        assert!(public.get("key").is_none());
        assert!(public.get("review").is_none());
        if matches!(mode,2|4) {assert!(public["options"][0].get("word").is_none());}
    }
}

#[test]
fn resume_preserves_string_round_and_uses_source_entry_not_lexicon_zero() {
    let (book,chapter,mut page)=fixture();
    let first=page["data"][0]["id"].clone();
    let second=page["data"][1]["id"].clone();
    page["existing_id"]=json!([first,99999999]);page["last_key"]=json!("1760000000000");
    let training=start("owner",&book,&chapter,page.clone(),json!({}),&json!({}),1,true).unwrap();
    assert_eq!(training.key,json!("1760000000000"));
    assert_eq!(training.view().completed,1);
    let request=training.request("answer",None,false).unwrap();
    assert_eq!(request["request"]["lexicon_id"],second);
    assert_eq!(request["request"]["mode"],1);
    assert!(request["request"].get("s_id").is_none());
    let fresh=start("owner",&book,&chapter,page,json!({}),&json!({}),1,false).unwrap();
    assert!(fresh.key.is_i64());assert_eq!(fresh.completed.len(),0);
}

#[test]
fn failed_cycle_inserts_two_retests_and_only_last_success_finishes_word() {
    let mut session=training(1);
    let first=session.queue.front().unwrap()["id"].clone();
    let size=session.queue.len();
    session.accept(false).unwrap();
    assert_eq!(session.queue.len(),size+1);
    assert_eq!(session.queue[3]["id"],first);assert_eq!(session.queue[9]["id"],first);
    assert!(!session.completed.contains(&vocabulary::id(&first).unwrap()));
    for _ in 0..3 {session.accept(true).unwrap();}
    assert_eq!(session.request("x",None,false).unwrap()["hasFuture"],true);
    session.accept(true).unwrap();
    assert!(!session.completed.contains(&vocabulary::id(&first).unwrap()));
    for _ in 0..5 {session.accept(true).unwrap();}
    assert_eq!(session.request("x",None,false).unwrap()["hasFuture"],false);
    session.accept(true).unwrap();
    assert!(session.completed.contains(&vocabulary::id(&first).unwrap()));
}

#[test]
fn uncertain_write_and_stale_prompts_cannot_be_replayed() {
    let mut session=training(2);
    let id=session.id.clone();let prompt=session.prompt.clone();
    assert!(session.request("",Some(99),false).is_err());
    assert!(session.request("",None,true).is_err());
    session.uncertain=true;
    assert!(session.request("",None,false).is_err());
    let mut option=Some(session);
    assert!(current(&mut option,&id,&prompt).is_err());
    option.as_mut().unwrap().uncertain=false;
    option.as_mut().unwrap().accept(true).unwrap();
    assert!(current(&mut option,&id,&prompt).is_err());
}

#[test]
fn learned_reporting_is_independent_of_normal_chapter_requeue() {
    let (book,chapter,page)=fixture();
    let mut session=start("owner",&book,&chapter,page,json!({}),&json!({"wrong_wrong_word_cycle":1}),1,false).unwrap();
    let before=session.queue.len();
    assert_eq!(session.request("wrong",None,false).unwrap()["cycle"],true);
    session.accept(false).unwrap();
    assert_eq!(session.queue.len(),before-1);
}

#[test]
fn audio_preserves_special_sentence_role_and_rejects_unknown_or_embedded_credentials() {
    let mut row=json!({"g_id":947263,"phonetic-m":"https://lbxl-audio.oss-cn-beijing.aliyuncs.com/fallback.mp3",
        "word_audio_url":"https://idictation-article.oss-cn-beijing.aliyuncs.com/word.wav"});
    assert!(sound(&row,2,false).unwrap().ends_with("word.wav"));
    row["g_id"]=json!("947263");
    assert!(sound(&row,2,false).unwrap().ends_with("word.wav"));
    assert!(sound(&row,2,true).is_err());
    row["answer_sentence_audio_url"]=json!("https://user@lbxl-audio.oss-cn-beijing.aliyuncs.com/sentence.mp3");
    assert!(sound(&row,2,true).is_err());
    row["word_audio_url"]=json!("https://unverified.invalid/word.mp3");
    assert!(sound(&row,2,false).is_err());
    assert_eq!(first_definition("adj. 大的（比较级）；其他")," 大的");
    assert_eq!(first_definition("n. （未闭合")," （未闭合");
}

#[test]
fn source_pronunciation_accepts_string_preferences_and_american_default() {
    for (pref,expected) in [(Value::Null,2),(json!(0),2),(json!("2"),2),(json!(2),2),(json!("1"),1),(json!(1),1)] {
        let (book,chapter,page)=fixture();
        let session=start("owner",&book,&chapter,page,json!({}),&json!({"phonetic_type":pref}),1,false).unwrap();
        assert_eq!(session.pronunciation,expected);
        assert_eq!(session.request("",None,false).unwrap()["expectedOwner"],"owner");
    }
}

#[test]
fn missing_options_can_only_skip_after_explicit_action() {
    let (book,chapter,mut page)=fixture();
    page["data"][0]["error_options"]=Value::Null;
    let session=start("owner",&book,&chapter,page,json!({}),&json!({}),2,false).unwrap();
    assert!(session.view().options.is_empty());
    assert_eq!(session.request("",None,true).unwrap()["choiceCorrect"],true);
    assert_eq!(session.request("",None,false).unwrap()["choiceCorrect"],false);
}

#[test]
fn dictation_masks_english_hints_but_feedback_keeps_the_definition() {
    assert_eq!(definition_hint("n. nurse 的复数；ADJ. well-known；phrase. one's home"),"n. *** 的复数；ADJ. ***；***. *** ***");
    let mut session=training(3);
    session.queue.front_mut().unwrap()["translate"]=json!("n. schedule 的变体");
    assert_eq!(session.view().definition.as_deref(),Some("n. *** 的变体"));
    assert_eq!(session.accept(true).unwrap().definition,"n. schedule 的变体");
}

#[test]
fn uncertain_write_survives_new_session_and_account_reset_until_receipt() {
    let conn=rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE settings(namespace TEXT NOT NULL,key TEXT NOT NULL,value_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,key));").unwrap();
    let db=AppDb::from_test_connection(conn,std::path::PathBuf::new());
    let scope=write_scope("owner",&json!(1),&json!(2));
    assert_eq!(scope,write_scope("owner",&json!("1"),&json!("2")));
    ensure_confirmed(&db,&scope).unwrap();
    record_pending(&db,&scope).unwrap();
    let mut session=super::super::service::Session::default();
    session.reset();
    assert!(ensure_confirmed(&db,&scope).is_err());
    assert!(ensure_confirmed(&db,&write_scope("other",&json!(1),&json!(2))).is_ok());
    assert!(ensure_confirmed(&db,&write_scope("owner",&json!(1),&json!(3))).is_ok());
    confirm_write(&db,&scope).unwrap();
    ensure_confirmed(&db,&scope).unwrap();
}
