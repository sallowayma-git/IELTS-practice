//! Article material shares the listening route but never enters the exam index.
use super::{material, service::{verify,Account}, transport, vocabulary::{self,id}};
use crate::app::state::AppDb;
use serde::Serialize;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::collections::{HashMap,VecDeque};
use tauri::{AppHandle,State};

#[derive(Default)]
pub(super) struct ArticleSession {
    books:HashMap<String,Value>,
    chapters:HashMap<String,Chapter>,
    assets:VecDeque<(String,String)>,
    playback:Option<(String,String)>,
}

impl ArticleSession {
    pub(super) fn playback_asset(&self, session_id: &str) -> Option<&str> {
        self.playback.as_ref().filter(|(id, _)| id == session_id).map(|(_, asset)| asset.as_str())
    }
}

#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Book {id:String,title:String,available:bool}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Chapter {id:String,book_id:String,title:String,short_count:Option<u64>}

fn books(session:&mut ArticleSession,value:&Value)->Result<Vec<Book>,String> {
    let rows=value.as_array().filter(|v|v.len()<=5000).ok_or("精听目录格式异常")?;
    let mut grants=HashMap::new();let mut output=Vec::new();
    // This operation is only for the observed article scene 152. Its source
    // rows say type=lexicon too; type alone is not a material discriminator.
    for row in rows {
        let source=if row["type"]=="article" {&row["g_id"]}else{&row["id"]};
        let key=id(source)?;
        let title=row["name"].as_str().filter(|s|!s.trim().is_empty()).ok_or("精听书名缺失")?;
        let available=!vocabulary::enabled(&row["need_buy"])||vocabulary::enabled(&row["already_buy"]);
        if grants.insert(key.clone(),row.clone()).is_some(){return Err("精听书目身份重复".into());}
        output.push(Book{id:key,title:title.into(),available});
    }
    session.books=grants;session.chapters.clear();Ok(output)
}
fn chapters(session:&mut ArticleSession,book_id:&str,value:&Value)->Result<Vec<Chapter>,String>{
    let groups=value["chapters"].as_array().ok_or("精听章节格式异常")?;
    let mut grants=HashMap::new();let mut output=Vec::new();
    for group in groups {
        for row in group["list"].as_array().ok_or("精听章节分组格式异常")? {
            if output.len()>=2000||id(&row["g_id"])?!=book_id{return Err("精听章节归属或数量异常".into());}
            let key=id(&row["id"])?;
            let title=row["name"].as_str().filter(|s|!s.trim().is_empty()).ok_or("精听章节名称缺失")?;
            let chapter=Chapter{id:key.clone(),book_id:book_id.into(),title:title.into(),short_count:row["short_chapter"]["word_total"].as_u64()};
            if grants.insert(key,chapter.clone()).is_some(){return Err("精听章节身份重复".into());}
            output.push(chapter);
        }
    }
    session.chapters=grants;Ok(output)
}
fn convert(owner:&str,grant:&Chapter,mode:&str,value:&Value)->Result<(String,Value),String>{
    if id(&value["canonical_g_id"])?!=grant.book_id||id(&value["canonical_c_id"])?!=grant.id {
        return Err("精听内容与目录归属不一致".into());
    }
    let converted=material::article(&grant.id,mode,&grant.title,value)?;
    if mode=="short"&&grant.short_count.is_some_and(|n|value["total"].as_u64()!=Some(n)) {
        return Err("精听短句数量与章节目录不一致，请重新加载目录".into());
    }
    let scope=hex::encode(Sha256::digest(json!([owner,grant.book_id,grant.id,mode,converted.fingerprint]).to_string().as_bytes()));
    let asset_id=format!("idictation-article-{scope}");
    let mut payload=converted.payload;payload["examId"]=json!(asset_id);
    payload["articleMarking"] = super::article_marking::snapshot(value, mode);
    payload["articleDictation"] = super::article_dictation::snapshot(value, mode);
    Ok((asset_id,payload))
}
fn frontend_payload(mut payload:Value)->Value {
    // Media URLs remain in the provider cache, never become main-window src.
    if let Some(rows)=payload["studyMaterial"]["media"].as_array_mut(){for row in rows{if let Some(row)=row.as_object_mut(){row.remove("url");}}}
    if let Some(marking) = payload["articleMarking"].as_object_mut() { marking.remove("round"); }
    if let Some(dictation) = payload["articleDictation"].as_object_mut() { dictation.remove("round"); }
    payload
}

pub(super) fn practice_round(round: &Value) -> Value {
    if id(round).is_ok() { round.clone() }
    else if round.is_null() || round == "" { json!(chrono::Utc::now().timestamp_millis()) }
    else { Value::Null }
}

#[tauri::command]
pub async fn idictation_article_books(app:AppHandle,account:State<'_,Account>)->Result<Vec<Book>,String>{
    let mut session=account.0.lock().await;verify(&app,&mut session).await?;
    session.article.books.clear();session.article.chapters.clear();
    let value=transport::read(&app,"books",json!({"s_id":152,"check_data":1,"scene_type":1})).await?;
    verify(&app,&mut session).await?;books(&mut session.article,&value)
}
#[tauri::command]
pub async fn idictation_article_chapters(app:AppHandle,account:State<'_,Account>,book_id:String)->Result<Vec<Chapter>,String>{
    let mut session=account.0.lock().await;verify(&app,&mut session).await?;
    let book=session.article.books.get(&book_id).ok_or("请先加载精听书目")?;
    if vocabulary::enabled(&book["need_buy"])&&!vocabulary::enabled(&book["already_buy"]){return Err("此书需要原站授权".into());}
    let source=book_id.parse::<u64>().map_err(|_|"精听书目编号异常")?;
    session.article.chapters.clear();
    let value=transport::read(&app,"articleChapters",json!({"g_id":source})).await?;
    verify(&app,&mut session).await?;chapters(&mut session.article,&book_id,&value)
}
#[tauri::command]
pub async fn idictation_open_article(app:AppHandle,account:State<'_,Account>,db:State<'_,AppDb>,chapter_id:String,mode:String)->Result<String,String>{
    if !matches!(mode.as_str(),"short"|"long"){return Err("请选择长句或短句".into());}
    let mut session=account.0.lock().await;verify(&app,&mut session).await?;
    let chapter=session.article.chapters.get(&chapter_id).cloned().ok_or("请从当前精听目录选择章节")?;
    let source=chapter_id.parse::<u64>().map_err(|_|"精听章节编号异常")?;
    let value=transport::read(&app,"articleDocument",json!({"c_id":source,"pagesize":9999,"sentence_mode":mode,"is_only_listen_answer_collect_sentences":0})).await?;
    verify(&app,&mut session).await?;
    let (asset_id,payload)=convert(session.owner.as_deref().ok_or("尚未连接账号")?,&chapter,&mode,&value)?;
    remember_article(&db, &mut session.article, &asset_id, payload)?;
    Ok(asset_id)
}

fn remember_article(db: &AppDb, session: &mut ArticleSession, id: &str, payload: Value) -> Result<(), String> {
    let title = payload["meta"]["title"].as_str().unwrap_or("").to_owned();
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", id, payload))
        .map_err(|e| e.to_string())?;
    session.assets.retain(|(previous, _)| previous != id);
    session.assets.push_back((id.to_owned(), title));
    while session.assets.len() > 16 { session.assets.pop_front(); }
    Ok(())
}

#[tauri::command]
pub async fn idictation_article_collections(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>, page: u64) -> Result<String, String> {
    if !(1..=10_000).contains(&page) { return Err("精听收藏页码无效".into()); }
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let value = transport::read(&app, "articleCollections", json!({
        "collect_date":[], "error_tags":[], "jingting_choices":[],
        "page":page, "pagesize":material::COLLECTION_PAGE_SIZE
    })).await?;
    verify(&app, &mut session).await?;
    let owner = session.owner.as_deref().ok_or("尚未连接账号")?;
    let result = material::article_collection(owner, page, &value)?;
    let scope = hex::encode(Sha256::digest(json!([owner, result.fingerprint]).to_string().as_bytes()));
    let asset_id = format!("idictation-article-collection-{scope}");
    let mut payload = result.payload;
    payload["examId"] = json!(asset_id);
    remember_article(&db, &mut session.article, &asset_id, payload)?;
    Ok(asset_id)
}
#[tauri::command]
pub async fn idictation_article_payload(app:AppHandle,account:State<'_,Account>,db:State<'_,AppDb>,asset_id:String)->Result<Value,String>{
    let mut session=account.0.lock().await;verify(&app,&mut session).await?;
    if !session.article.assets.iter().any(|(id,_)|id==&asset_id){return Err("请从当前账号的精听目录重新打开".into());}
    let payload=db.with_conn(|conn|ielts_db::transient_assets::get(conn,&asset_id)).map_err(|e|e.to_string())?;
    let playback=open_playback(&app,&mut session.article,asset_id);
    Ok(json!({"sessionId":playback,"payload":frontend_payload(payload)}))
}

pub(super) fn open_playback(app: &AppHandle, session: &mut ArticleSession, asset_id: String) -> String {
    transport::stop_article_audio(app, None);
    transport::stop_audio(app);
    let playback = uuid::Uuid::new_v4().to_string();
    session.playback = Some((playback.clone(), asset_id));
    playback
}

fn media_request(payload:&Value,media_id:&str,session_id:&str,rate:f64)->Result<Value,String>{
    if !rate.is_finite()||!(0.5..=2.0).contains(&rate){return Err("播放速度无效".into());}
    let media=payload["studyMaterial"]["media"].as_array().and_then(|rows|rows.iter().find(|r|r["id"]==media_id)).ok_or("该句没有已验证音频")?;
    Ok(json!({"sessionId":session_id,"mediaId":media_id,"url":media["url"],"start":media["startSeconds"],"end":media["endSeconds"],"rate":rate}))
}
#[tauri::command]
pub async fn idictation_article_audio(app:AppHandle,account:State<'_,Account>,db:State<'_,AppDb>,session_id:String,action:String,media_id:Option<String>,value:Option<f64>)->Result<Value,String>{
    if matches!(action.as_str(),"play"|"resume"){transport::prepare_article_play(&app,&session_id);}
    // Stop cancels a pending play before waiting for the account lock.
    if action=="close"{transport::stop_article_audio(&app,Some(&session_id));}
    if action=="pause"{transport::pause_article_audio(&app,&session_id);}
    let mut session=account.0.lock().await;
    if matches!(action.as_str(),"play"|"resume"){
        verify(&app,&mut session).await?;
    }
    let playback=session.article.playback.as_ref().filter(|(id,_)|id==&session_id);
    if action=="close" {
        if playback.is_some(){session.article.playback=None;transport::stop_article_audio(&app,Some(&session_id));}
        return Ok(Value::Null);
    }
    let asset_id=playback.map(|(_,asset)|asset.clone()).ok_or("精听会话已改变，请重新打开章节")?;
    if !matches!(action.as_str(),"play"|"resume"){return transport::article_audio_control(&app,&session_id,&action,value).await;}
    let payload=db.with_conn(|conn|ielts_db::transient_assets::get(conn,&asset_id)).map_err(|e|e.to_string())?;
    let mut request=media_request(&payload,media_id.as_deref().ok_or("请选择句子")?,&session_id,value.unwrap_or(1.0))?;
    request["resume"]=json!(action=="resume");
    transport::stop_audio(&app);
    let result=transport::read(&app,"articleAudio",request).await;
    if result.is_err(){transport::pause_article_audio(&app,&session_id);}
    result
}

#[cfg(test)]
#[path="../../developer/tests/rust/idictation_article.rs"]
mod tests;
