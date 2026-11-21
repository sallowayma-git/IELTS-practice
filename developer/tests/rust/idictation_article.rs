use super::*;
fn sample()->Value{
    let fixture:Value=serde_json::from_str(include_str!("../fixtures/idictation/observed-materials.json")).unwrap();
    let mut data=fixture["article"].clone();data["total"]=json!(2);data["sentence_mode"]=json!("short");data
}
fn chapter()->Chapter{Chapter{id:"1197472".into(),book_id:"444692".into(),title:"Test 1 Part 1".into(),short_count:Some(2)}}
#[test]
fn article_scene_preserves_legacy_book_identity_and_rejects_cross_book_chapter(){
    let mut session=ArticleSession::default();
    let rows=books(&mut session,&json!([
        {"id":1,"name":"source lexicon type","type":"lexicon","need_buy":0},
        {"id":2,"g_id":3,"name":"legacy article","type":"article","need_buy":1,"already_buy":false}
    ])).unwrap();
    assert_eq!(rows[0].id,"1");assert_eq!(rows[1].id,"3");assert!(!rows[1].available);
    assert!(chapters(&mut session,"1",&json!({"chapters":[{"list":[{"id":4,"g_id":3,"name":"wrong"}]}]})).is_err());
}
#[test]
fn article_material_is_owner_scoped_complete_and_never_exposes_audio_url(){
    let mut data=sample();data["data"][0]["split_audio_url_new"]=json!("https://itx-jingting.oss-cn-beijing.aliyuncs.com/test.mp3");
    let (asset,payload)=convert("owner-a",&chapter(),"short",&data).unwrap();
    assert_ne!(asset,convert("owner-b",&chapter(),"short",&data).unwrap().0);
    assert_eq!(payload["questionCount"],0);
    let media=payload["studyMaterial"]["media"][0]["id"].as_str().unwrap();
    let request=media_request(&payload,media,"session",1.0).unwrap();
    assert_eq!(request["start"],0.0);assert!(request["end"].is_null());
    assert!(media_request(&payload,"ungranted","s",1.0).is_err());
    assert!(media_request(&payload,media,"s",f64::NAN).is_err());
    assert!(frontend_payload(payload)["studyMaterial"]["media"][0].get("url").is_none());
    data["canonical_g_id"]=json!(999);assert!(convert("owner-a",&chapter(),"short",&data).is_err());
}
#[test]
fn mismatched_short_count_is_not_silently_opened(){
    let mut grant=chapter();grant.short_count=Some(84);
    assert!(convert("owner",&grant,"short",&sample()).unwrap_err().contains("数量"));
}
