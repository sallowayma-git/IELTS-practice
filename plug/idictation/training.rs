//! Online vocabulary rounds are independent of local vocabulary/SM-2 reviews.
use super::{service::{verify, Account}, transport, vocabulary::{self, SourceBook, SourceChapter, WordPage}};
use crate::app::state::AppDb;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashSet, VecDeque};
use tauri::{AppHandle, State};

const SPECIAL: [u64; 5] = [947261,947262,947263,947264,947265];
const WRITE_NAMESPACE: &str = "idictation.pending";

// A transport timeout cannot tell us whether a server write committed. Keep a
// chapter-scoped fence across close, disconnect, account changes and restart.
// Only a confirmed response clears it; a stale list read is not a receipt.
fn write_scope(owner: &str, book: &Value, chapter: &Value) -> String {
    let book=book.as_str().map(str::to_owned).unwrap_or_else(||book.to_string());
    let chapter=chapter.as_str().map(str::to_owned).unwrap_or_else(||chapter.to_string());
    hex::encode(Sha256::digest(format!("{owner}:{book}:{chapter}").as_bytes()))
}
fn ensure_confirmed(db: &AppDb, scope: &str) -> Result<(), String> {
    let pending=db.with_conn(|conn|ielts_db::settings::get_setting(conn,WRITE_NAMESPACE,scope)).map_err(|_|"无法读取原站提交状态")?;
    if pending.is_some() {return Err("本章有未确认的原站提交。请到爱听写核对并继续本章，Atlas 暂不重复提交".into());}
    Ok(())
}
fn record_pending(db: &AppDb, scope: &str) -> Result<(), String> {
    db.with_conn(|conn|ielts_db::settings::upsert_setting(conn,WRITE_NAMESPACE,scope,&json!(true)))
        .map(|_|()).map_err(|_|"无法保存提交状态，本次尚未提交".into())
}
fn confirm_write(db: &AppDb, scope: &str) -> Result<(), String> {
    db.with_conn(|conn|ielts_db::settings::delete_setting(conn,WRITE_NAMESPACE,scope))
        .map(|_|()).map_err(|_|"原站已确认，但本地提交状态未能更新，请到原站继续".into())
}

pub(super) struct Training {
    id: String,
    key: Value,
    mode: u8,
    queue: VecDeque<Value>,
    dictionary: Value,
    ignore_case: bool,
    cycle: bool,
    report_learned: bool,
    book_id: Value,
    chapter_id: Value,
    finished: Option<Value>,
    owner: String,
    pronunciation: u8,
    speed: f64,
    total: usize,
    completed: HashSet<String>,
    options: Vec<Choice>,
    prompt: String,
    uncertain: bool,
}

#[derive(Clone, Serialize)]
pub struct Choice { label: String, #[serde(skip)] word: String }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Prompt {
    session_id: String,
    prompt_id: String,
    mode: u8,
    completed: usize,
    total: usize,
    remaining: usize,
    word: Option<String>,
    definition: Option<String>,
    options: Vec<Choice>,
    has_audio: bool,
    has_sentence_audio: bool,
}

#[derive(Serialize)]
pub struct Answer { correct: bool, word: String, definition: String, next: Prompt }

fn text<'a>(value: &'a Value, field: &str) -> &'a str { value[field].as_str().unwrap_or_default() }
fn special_id(value: &Value) -> bool { SPECIAL.contains(&value.as_u64().or_else(||value.as_str()?.parse().ok()).unwrap_or_default()) }
fn special(row: &Value) -> bool { special_id(&row["g_id"]) }

fn sound(row: &Value, pronunciation: u8, sentence: bool) -> Result<String, String> {
    if sentence && !special(row) {return Err("该词没有原句音频".into());}
    let selected = if special(row) && sentence { text(row,"answer_sentence_audio_url") }
        else if special(row) && !text(row,"word_audio_url").trim().is_empty() { text(row,"word_audio_url") }
        else { text(row,if pronunciation==2 {"phonetic-m"} else {"phonetic-y"}) };
    validated_audio(selected)
}

pub(super) fn validated_audio(selected: &str) -> Result<String, String> {
    let url=tauri::Url::parse(selected.trim()).map_err(|_| "该词音频不可用")?;
    if url.scheme()!="https" || url.port().is_some() || !url.username().is_empty() || url.password().is_some()
        || !matches!(url.host_str(),Some("idictation-article.oss-cn-beijing.aliyuncs.com"|"lbxl-audio.oss-cn-beijing.aliyuncs.com"|"itx-jingting.oss-cn-beijing.aliyuncs.com"|"audio-1-cdn.idictation.cn")) {
        return Err("音频来源尚未验证，请在原站播放".into());
    }
    Ok(url.into())
}

fn definition_hint(value: &str) -> String {
    // Same word/POS rule as the source Go(): [A-Za-z]+(?:['-][A-Za-z]+)*.
    let mut chars=value.chars().peekable();let mut output=String::new();
    while let Some(ch)=chars.next() {
        if !ch.is_ascii_alphabetic() {output.push(ch);continue;}
        let mut word=String::from(ch);
        loop {
            if chars.peek().is_some_and(|c|c.is_ascii_alphabetic()) {word.push(chars.next().unwrap());continue;}
            let mut ahead=chars.clone();
            if matches!(ahead.next(),Some('\''|'-')) && ahead.next().is_some_and(|c|c.is_ascii_alphabetic()) {word.push(chars.next().unwrap());continue;}
            break;
        }
        if chars.peek()==Some(&'.') && matches!(word.to_ascii_lowercase().as_str(),"n"|"v"|"adj"|"adv"|"prep"|"pron"|"conj"|"num"|"art"|"int"|"abbr"|"pl") {output.push_str(&word);}
        else {output.push_str("***");}
    }
    output
}

fn first_definition(value: &str) -> String {
    // The source strips English POS markers and Chinese parenthesized text.
    let first=value.split(['；',';','\n']).next().unwrap_or_default();
    let mut output=String::new();
    let mut chars=first.chars().peekable();
    while let Some(ch)=chars.next() {
        if ch=='（' && chars.clone().any(|c|c=='）') { for c in chars.by_ref() { if c=='）' { break; } } continue; }
        if ch.is_ascii_alphabetic() {
            let mut letters=String::from(ch);
            while chars.peek().is_some_and(|c|c.is_ascii_alphabetic()) { letters.push(chars.next().unwrap()); }
            if chars.peek()==Some(&'.') { while chars.peek()==Some(&'.') { chars.next(); } }
            else { output.push_str(&letters); }
        } else { output.push(ch); }
    }
    output
}

fn choices(row: &Value, mode: u8) -> Result<Vec<Choice>, String> {
    if !matches!(mode,2|4) { return Ok(vec![]); }
    if text(row,"error_options").is_empty() { return Ok(vec![]); }
    let errors: Value=serde_json::from_str(text(row,"error_options")).map_err(|_| "该词缺少原站选择题选项")?;
    let errors=errors.as_array().filter(|v|v.len()<=20).ok_or("原站选择题选项无效")?;
    let word=text(row,"word");
    let mut options=Vec::new();
    for item in errors {
        let candidate=text(item,"word");
        if candidate.is_empty() { return Err("原站选项缺少词条".into()); }
        if candidate.to_lowercase()!=word.to_lowercase() {
            options.push(Choice { word:candidate.into(),label:format!("{} {}",text(item,"pos"),first_definition(text(item,"definition"))) });
        }
    }
    let definition=text(row,"translate");
    let pos=if definition.contains('.') { definition.split('.').next().unwrap_or_default() } else {""};
    let label=if word.bytes().all(|b|b.is_ascii_digit()) {word.to_owned()} else {first_definition(definition)};
    options.push(Choice {word:word.into(),label:format!("{pos} {label}")});
    // Random order, exactly the source options; never invent local distractors.
    for i in (1..options.len()).rev() {
        let j=(uuid::Uuid::new_v4().as_u128() % (i+1) as u128) as usize;
        options.swap(i,j);
    }
    Ok(options)
}

impl Training {
    fn prepare(&mut self) -> Result<(), String> {
        self.options=match self.queue.front() { Some(row)=>choices(row,self.mode)?,None=>vec![] };
        self.prompt=uuid::Uuid::new_v4().to_string();
        Ok(())
    }

    fn view(&self) -> Prompt {
        let current=self.queue.front();
        Prompt {session_id:self.id.clone(),prompt_id:self.prompt.clone(),mode:self.mode,
            completed:self.completed.len(),total:self.total,remaining:self.queue.len(),
            word:current.filter(|_|self.mode==4).map(|r|text(r,"word").into()),
            definition:current.filter(|_|self.mode==3).map(|r|definition_hint(text(r,"translate"))),options:self.options.clone(),
            has_audio:current.is_some_and(|r|sound(r,self.pronunciation,false).is_ok()),
            has_sentence_audio:current.is_some_and(|r|special(r)&&sound(r,self.pronunciation,true).is_ok())}
    }

    fn request(&self, typed: &str, choice: Option<usize>, skip_missing: bool) -> Result<Value,String> {
        if self.uncertain { return Err("上次提交结果尚未确认，请到爱听写核对并继续本章".into()); }
        if typed.len()>4096 { return Err("输入过长".into()); }
        let row=self.queue.front().ok_or("本章词条已作答")?;
        if skip_missing && (!matches!(self.mode,2|4) || !self.options.is_empty() || choice.is_some()) {
            return Err("当前词条不允许按缺失选项跳过".into());
        }
        let choice_correct=if skip_missing { Some(true) } else if matches!(self.mode,2|4) {
            Some(choice.map(|index|self.options.get(index).map(|option|option.word==text(row,"word")).ok_or("选项已改变"))
                .transpose()?.unwrap_or(false))
        } else { if choice.is_some() { return Err("当前模式需要拼写".into()); } None };
        let has_future=self.queue.iter().skip(1).any(|r|r["id"]==row["id"]);
        Ok(json!({"word":{"word":row["word"],"various_words":row["various_words"],"spelling_combinations":row["spelling_combinations"]},
            "typed":typed,"choiceCorrect":choice_correct,"ignoreCase":self.ignore_case,"dictionary":self.dictionary,
            "cycle":self.report_learned,"hasFuture":has_future,
            "expectedOwner":self.owner,
            "request":{"key":self.key,"lexicon_id":row["id"],"mode":self.mode,"sence":1}}))
    }

    fn accept(&mut self, correct: bool) -> Result<Answer,String> {
        let row=self.queue.pop_front().ok_or("本章词条已作答")?;
        let word=text(&row,"word").to_owned();
        let definition=text(&row,"translate").to_owned();
        if !correct && self.cycle {
            self.queue.retain(|other|other["id"]!=row["id"]);
            // Original inserts at current+4/current+10, after removing duplicates.
            self.queue.insert(3.min(self.queue.len()),row.clone());
            self.queue.insert(9.min(self.queue.len()),row.clone());
        }
        if !self.queue.iter().any(|other|other["id"]==row["id"]) { self.completed.insert(vocabulary::id(&row["id"])?); }
        self.uncertain=false;
        self.prepare()?;
        Ok(Answer {correct,word,definition,next:self.view()})
    }
}

fn start(owner: &str, book: &SourceBook, chapter: &SourceChapter, value: Value, dictionary: Value,
    preferences: &Value, mode: u8, resume: bool) -> Result<Training,String> {
    if !(1..=4).contains(&mode) { return Err("不支持的词汇练习模式".into()); }
    if special_id(&book.id) && mode!=1 { return Err("原站号码类词书仅支持听写".into()); }
    let page: WordPage=serde_json::from_value(value.clone()).map_err(|_|"词条响应不完整")?;
    vocabulary::convert_unit(owner,book,chapter,0,page)?;
    let rows=value["data"].as_array().ok_or("词条响应不完整")?;
    if rows.is_empty() { return Err("该章节没有词条".into()); }
    let ids: HashSet<String>=rows.iter().map(|r|vocabulary::id(&r["id"])).collect::<Result<_,_>>()?;
    let mut completed=HashSet::new();
    if resume {
        for item in value["existing_id"].as_array().ok_or("原站进度格式不完整")? {
            let id=vocabulary::id(item)?;
            if ids.contains(&id) { completed.insert(id); }
        }
    }
    let key=if !completed.is_empty() {
        vocabulary::id(&value["last_key"])?;
        value["last_key"].clone()
    } else {json!(chrono::Utc::now().timestamp_millis())};
    let map=dictionary.as_object().filter(|m|m.len()<=10000).ok_or("原站判分字典无效")?;
    if map.iter().any(|(k,v)|k.len()>256||!v.as_str().is_some_and(|s|s.len()<=256)) {return Err("原站判分字典无效".into());}
    let mut queue=VecDeque::new();
    for row in rows {
        let id=vocabulary::id(&row["id"])?;
        if completed.contains(&id) {continue;}
        if vocabulary::enabled(&row["is_proficient"]) {completed.insert(id);continue;}
        choices(row,mode)?;
        queue.push_back(row.clone());
    }
    let mut training=Training {id:uuid::Uuid::new_v4().to_string(),key,mode,queue,dictionary,
        ignore_case:vocabulary::enabled(&preferences["is_check_size"]),
        cycle:vocabulary::enabled(&preferences["word_wrong_word_cycle"]),
        report_learned:vocabulary::enabled(&preferences["word_wrong_word_cycle"])||vocabulary::enabled(&preferences["wrong_wrong_word_cycle"]),
        book_id:book.id.clone(),chapter_id:chapter.id.clone(),finished:None,owner:owner.into(),
        pronunciation:if preferences["phonetic_type"]==1 || preferences["phonetic_type"]=="1" {1}else{2},
        speed:preferences["play_speed"].as_f64().or_else(||text(preferences,"play_speed").parse().ok()).unwrap_or(1.0).clamp(0.5,2.0),
        total:rows.len(),completed,options:vec![],prompt:String::new(),uncertain:false};
    training.prepare()?;
    Ok(training)
}

pub(super) fn source_unit(db: &AppDb, owner: &str, book_id: &str, unit_id: &str)
    -> Result<ielts_db::vocab::books::SourceUnit, String>
{
    let source = db.with_conn(|conn| ielts_db::vocab::books::source_unit(conn, book_id, unit_id))
        .map_err(|_| "请先同步并选择爱听写章节")?;
    if source.provider != "idictation" || source.owner_key != hex::encode(Sha256::digest(owner.as_bytes())) {
        return Err("请连接导入该词书时的爱听写账号".into());
    }
    Ok(source)
}

pub(super) async fn authorized_chapter(app: &AppHandle, source: &ielts_db::vocab::books::SourceUnit,
    book_value: u64) -> Result<(SourceBook, SourceChapter), String>
{
    let mut found=None;
    for scope in [2,158] {
        let catalog=transport::read(app,"books",json!({"s_id":scope,"check_data":1,"scene_type":1})).await?;
        found=catalog.as_array().ok_or("词书目录无效")?.iter().find(|r|r["type"]=="lexicon"&&vocabulary::id(&r["id"]).ok().as_deref()==Some(&source.book_id)).cloned();
        if found.is_some() {break;}
    }
    let book:SourceBook=serde_json::from_value(found.ok_or("当前账号目录中未找到该词书，请在原站确认访问权限")?).map_err(|_|"词书目录无效")?;
    if vocabulary::enabled(&book.need_buy)&&!vocabulary::enabled(&book.already_buy) {return Err("该词书需要原站授权".into());}
    let chapters=transport::read(app,"chapters",json!({"g_id":book_value})).await?;
    let chapters:super::vocabulary::Chapters=serde_json::from_value(chapters).map_err(|_|"章节目录无效")?;
    let chapter=chapters.chapters.into_iter().flat_map(|g|g.list).find(|r|vocabulary::id(&r.id).ok().as_deref()==Some(&source.chapter_id)).ok_or("章节已不在当前词书")?;
    Ok((book, chapter))
}

#[tauri::command]
pub async fn idictation_training_start(app: AppHandle, account: State<'_,Account>, db: State<'_,AppDb>, book_id:String, unit_id:String, mode:u8, resume:bool) -> Result<Prompt,String> {
    let mut session=account.0.lock().await;
    verify(&app,&mut session).await?;
    transport::stop_audio(&app);
    transport::stop_article_audio(&app,None);
    session.training=None;
    let owner=session.owner.as_deref().ok_or("尚未连接账号")?.to_owned();
    let source=source_unit(&db,&owner,&book_id,&unit_id)?;
    let book_value=source.book_id.parse::<u64>().map_err(|_|"词书来源编号无效")?;
    let chapter_value=source.chapter_id.parse::<u64>().map_err(|_|"章节来源编号无效")?;
    ensure_confirmed(&db,&write_scope(&owner,&json!(book_value),&json!(chapter_value)))?;
    if !(1..=4).contains(&mode) || SPECIAL.contains(&book_value)&&mode!=1 {return Err("模式不可用：号码类词书仅支持听写".into());}
    let (book,chapter)=authorized_chapter(&app,&source,book_value).await?;
    verify(&app,&mut session).await?;
    let words=transport::read(&app,"trainingWords",json!({"c_id":chapter_value,"compact":if SPECIAL.contains(&book_value){0}else{1},"pagesize":9999})).await?;
    let dictionary=transport::read(&app,"trainingDictionary",json!({})).await?;
    let dictionary=serde_json::from_str(text(&dictionary,"string")).map_err(|_|"原站判分字典解析失败")?;
    let config=transport::read(&app,"trainingPreferences",json!({})).await?;
    verify(&app,&mut session).await?;
    if vocabulary::id(&config["id"])?!=owner {session.reset();return Err("爱听写账号已改变".into());}
    let training=start(&owner,&book,&chapter,words,dictionary,&config["config"],mode,resume)?;
    let prompt=training.view();session.training=Some(training);Ok(prompt)
}

fn current<'a>(training:&'a mut Option<Training>,session_id:&str,prompt_id:&str)->Result<&'a mut Training,String> {
    let training=training.as_mut().filter(|s|s.id==session_id&&s.prompt==prompt_id).ok_or("练习会话或词条已改变，请重新打开章节")?;
    if training.uncertain {return Err("上次提交结果尚未确认，请到爱听写核对并继续本章".into());}
    Ok(training)
}

#[tauri::command]
pub async fn idictation_training_answer(app:AppHandle,account:State<'_,Account>,db:State<'_,AppDb>,session_id:String,prompt_id:String,typed:String,choice:Option<usize>,skip_missing:bool)->Result<Answer,String> {
    let mut session=account.0.lock().await;
    verify(&app,&mut session).await?;
    let training=current(&mut session.training,&session_id,&prompt_id)?;
    let body=training.request(&typed,choice,skip_missing)?;
    let scope=write_scope(&training.owner,&training.book_id,&training.chapter_id);
    ensure_confirmed(&db,&scope)?;
    record_pending(&db,&scope)?;
    training.uncertain=true;
    transport::stop_audio(&app);
    let result=transport::read(&app,"trainingAnswer",body).await.map_err(|_|"提交结果未确认，未自动重试。请到爱听写核对并继续本章".to_owned())?;
    let correct=result["correct"].as_bool().ok_or("原站提交回执格式异常，请重新读取进度")?;
    confirm_write(&db,&scope)?;
    verify(&app,&mut session).await?;
    let training=session.training.as_mut().ok_or("练习会话已失效")?;
    training.accept(correct)
}

#[tauri::command]
pub async fn idictation_training_audio(app:AppHandle,account:State<'_,Account>,session_id:String,prompt_id:String,sentence:bool)->Result<(),String> {
    let mut session=account.0.lock().await;
    verify(&app,&mut session).await?;
    let training=current(&mut session.training,&session_id,&prompt_id)?;
    let row=training.queue.front().ok_or("本章词条已作答")?;
    let url=sound(row,training.pronunciation,sentence)?;
    if let Err(error)=transport::read(&app,"trainingAudio",json!({"url":url,"speed":training.speed,"sessionId":session_id})).await {
        // Still holds the account lock: no newer practice can start here.
        // Stop playback without marking the current session as closed.
        transport::stop_audio(&app);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn idictation_training_close(app:AppHandle,account:State<'_,Account>,session_id:String)->Result<(),String> {
    // Cancel a pending play() before waiting for its account lock. Match the
    // session so a late unmount cannot stop a newer practice's audio.
    transport::stop_session_audio(&app,Some(&session_id));
    let mut session=account.0.lock().await;
    if session.training.as_ref().is_some_and(|s|s.id==session_id) {session.training=None;transport::stop_session_audio(&app,Some(&session_id));}
    Ok(())
}

#[tauri::command]
pub async fn idictation_training_finish(app:AppHandle,account:State<'_,Account>,db:State<'_,AppDb>,session_id:String,prompt_id:String)->Result<Value,String> {
    let mut session=account.0.lock().await;
    verify(&app,&mut session).await?;
    let training=current(&mut session.training,&session_id,&prompt_id)?;
    if !training.queue.is_empty() {return Err("还有词条未作答".into());}
    if let Some(result)=&training.finished {return Ok(result.clone());}
    let body=json!({"expectedOwner":training.owner,"request":{"id":training.chapter_id,"g_id":training.book_id,"is_generate_stories":true,"is_chapter_finished":true}});
    let scope=write_scope(&training.owner,&training.book_id,&training.chapter_id);
    ensure_confirmed(&db,&scope)?;
    record_pending(&db,&scope)?;
    training.uncertain=true;
    let result=transport::read(&app,"trainingFinish",body).await.map_err(|_|"章节完成结果未确认，未自动重试。请在原站查看结果".to_owned())?;
    confirm_write(&db,&scope)?;
    verify(&app,&mut session).await?;
    let training=session.training.as_mut().ok_or("练习会话已失效")?;
    training.uncertain=false;
    training.finished=Some(result.clone());
    // The original page refreshes the mastery count after finishing. A failed
    // read does not replay the successful chapter completion write.
    let _=transport::read(&app,"trainingMastery",json!({"if_end":true})).await;
    Ok(result)
}

#[cfg(test)]
#[path="../../developer/tests/rust/idictation_training.rs"]
mod tests;
