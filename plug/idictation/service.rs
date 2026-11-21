use crate::app::state::AppDb;
use super::{transport, vocabulary::{self, SourceBook, SourceChapter, Chapters, WordPage}};
use ielts_db::vocab::books;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Account(pub(super) Mutex<Session>);

#[derive(Default)]
pub(super) struct Session {
    pub(super) owner: Option<String>,
    books: HashMap<String, SourceBook>,
    chapters: HashMap<(String, String), (SourceChapter, u32)>,
    pub(super) reader: super::reader::ReaderSession,
    pub(super) training: Option<super::training::Training>,
    pub(super) article: super::article::ArticleSession,
    pub(super) reading: super::reading::ReadingSession,
}

impl Session {
    pub(super) fn reset(&mut self) {
        *self = Self::default();
        ielts_db::transient_assets::clear_provider("idictation");
    }

    fn accept_owner(&mut self, owner: String) -> Result<(), String> {
        if self.owner.as_ref().is_some_and(|previous| previous != &owner) {
            self.reset();
            return Err("爱听写账号已改变，请重新连接后加载词书".into());
        }
        self.owner = Some(owner);
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    connected: bool,
    member_status: String,
}

pub(super) async fn verify(app: &AppHandle, session: &mut Session) -> Result<ConnectionStatus, String> {
    let result = async {
        transport::ensure_open(app).await?;
        transport::read(app, "account", json!({})).await
    }.await;
    let value = match result {
        Ok(value) => value,
        Err(error) => { session.reset(); transport::stop_audio(app); transport::stop_article_audio(app,None); return Err(error); }
    };
    let owner = match vocabulary::id(&value["id"]) {
        Ok(owner) => owner,
        Err(_) => { session.reset(); transport::stop_audio(app); transport::stop_article_audio(app,None); return Err("请先在爱听写窗口完成登录".into()); }
    };
    if let Err(error)=session.accept_owner(owner) {transport::stop_audio(app);transport::stop_article_audio(app,None);return Err(error);}
    Ok(ConnectionStatus {
        connected: true,
        member_status: value["memberStatus"].as_str().unwrap_or("").to_owned(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogBook {
    id: String,
    title: String,
    word_count: u64,
    chapter_count: u64,
    available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChapter {
    id: String,
    title: String,
}

#[tauri::command]
pub async fn idictation_open_login(app: AppHandle, account: State<'_, Account>) -> Result<(), String> {
    let _session = account.0.lock().await;
    transport::open(&app)
}

#[tauri::command]
pub async fn idictation_connect(app: AppHandle, account: State<'_, Account>) -> Result<ConnectionStatus, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await
}

#[tauri::command]
pub async fn idictation_disconnect(app: AppHandle, account: State<'_, Account>) -> Result<(), String> {
    let mut session = account.0.lock().await;
    session.reset();
    transport::disconnect(&app)
}

fn catalog(session: &mut Session, data: Value) -> Result<Vec<CatalogBook>, String> {
    let rows = data.as_array().filter(|rows| rows.len() <= 5000).ok_or("词书目录格式异常")?;
    let mut books = HashMap::new();
    let mut output = Vec::new();
    for row in rows {
        if row["type"] != "lexicon" { continue; }
        let book: SourceBook = serde_json::from_value(row.clone()).map_err(|_| "词书信息不完整")?;
        let id = vocabulary::id(&book.id)?;
        let available = !vocabulary::enabled(&book.need_buy) || vocabulary::enabled(&book.already_buy);
        output.push(CatalogBook { id: id.clone(), title: book.name.clone(),
            word_count: row["word_total"].as_u64().unwrap_or(0),
            chapter_count: row["chapter_total"].as_u64().unwrap_or(0), available });
        if books.insert(id, book).is_some() { return Err("词书目录存在重复身份".into()); }
    }
    session.books = books;
    session.chapters.clear();
    Ok(output)
}

fn accessible_book(session: &Session, book_id: &str) -> Result<SourceBook, String> {
    let book = session.books.get(book_id).ok_or("请先从当前账号目录选择词书")?;
    if vocabulary::enabled(&book.need_buy) && !vocabulary::enabled(&book.already_buy) {
        return Err("该词书需要原站购书权限".into());
    }
    Ok(book.clone())
}

#[tauri::command]
pub async fn idictation_books(app: AppHandle, account: State<'_, Account>, scope: String) -> Result<Vec<CatalogBook>, String> {
    let scene = match scope.as_str() { "mine" => 2, "ielts" => 158, _ => return Err("不支持的词书分类".into()) };
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let value = transport::read(&app, "books", json!({"s_id":scene,"check_data":1,"scene_type":1})).await?;
    verify(&app, &mut session).await?;
    catalog(&mut session, value)
}

#[tauri::command]
pub async fn idictation_chapters(app: AppHandle, account: State<'_, Account>, book_id: String) -> Result<Vec<CatalogChapter>, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let book = accessible_book(&session, &book_id)?;
    let value = transport::read(&app, "chapters", json!({"g_id":book.id})).await?;
    verify(&app, &mut session).await?;
    let chapters: Chapters = serde_json::from_value(value).map_err(|_| "章节目录格式异常")?;
    let mut additions = HashMap::new();
    let mut output = Vec::new();
    for (position, chapter) in chapters.chapters.into_iter().flat_map(|g| g.list).enumerate() {
        if position >= 2000 { return Err("词书章节过多".into()); }
        let id = vocabulary::id(&chapter.id)?;
        if vocabulary::id(&chapter.g_id)? != book_id { return Err("章节不属于当前词书".into()); }
        output.push(CatalogChapter { id: id.clone(), title: chapter.name.clone() });
        if additions.insert((book_id.clone(), id), (chapter, position as u32)).is_some() {
            return Err("章节目录存在重复身份".into());
        }
    }
    session.chapters.retain(|(book, _), _| book != &book_id);
    session.chapters.extend(additions);
    Ok(output)
}

#[tauri::command]
pub async fn idictation_sync_chapter(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    book_id: String, chapter_id: String) -> Result<books::ImportResult, String>
{
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let book = accessible_book(&session, &book_id)?;
    let (chapter, position) = session.chapters.get(&(book_id, chapter_id))
        .cloned().ok_or("请先从当前词书目录选择章节")?;
    // Matches the product's special-book table in index-f5cb0b84.js (fa/or).
    let compact = if [947261, 947262, 947263, 947264, 947265].contains(&book.id.as_u64().unwrap_or(0)) { 0 } else { 1 };
    let value = transport::read(&app, "words", json!({"c_id":chapter.id,"compact":compact,"pagesize":9999})).await?;
    verify(&app, &mut session).await?;
    let page: WordPage = serde_json::from_value(value).map_err(|_| "词条返回不完整")?;
    let input = vocabulary::convert_unit(session.owner.as_deref().ok_or("尚未连接账号")?, &book, &chapter, position, page)?;
    db.with_conn(|conn| books::import_unit(conn, &input)).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_service.rs"]
mod tests;
