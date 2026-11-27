//! Read-only synonym materials, kept separate from vocabulary and SM-2.
use super::{
    service::{verify, Account},
    transport,
    vocabulary::id,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, State};

#[derive(Default)]
pub(super) struct SynonymSession {
    books: HashSet<String>,
    chapters: HashMap<String, ChapterGrant>,
}

struct ChapterGrant {
    book_id: String,
    category_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    id: String,
    title: String,
    pair_count: u64,
}

#[derive(Serialize)]
pub struct Category {
    id: String,
    title: String,
    chapters: Vec<CatalogItem>,
}

#[derive(Serialize)]
pub struct Group {
    id: String,
    version: u64,
    pairs: Vec<Pair>,
}

#[derive(Serialize)]
pub struct Pair {
    id: String,
    left: String,
    right: String,
    meaning: String,
}

type Result<T> = std::result::Result<T, String>;

fn list(value: &Value, max: usize) -> Result<&[Value]> {
    value
        .as_array()
        .filter(|rows| rows.len() <= max)
        .map(Vec::as_slice)
        .ok_or_else(|| "爱听写同义替换列表格式异常".into())
}

fn label(row: &Value, field: &str) -> Result<String> {
    row[field]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 4096)
        .map(str::to_owned)
        .ok_or_else(|| format!("爱听写同义替换缺少有效的 {field}"))
}

fn item(row: &Value) -> Result<CatalogItem> {
    Ok(CatalogItem {
        id: id(&row["id"])?,
        title: label(row, "name")?,
        pair_count: row["pair_count"]
            .as_u64()
            .ok_or("爱听写同义替换词对计数无效")?,
    })
}

fn books(session: &mut SynonymSession, raw: &Value) -> Result<Vec<CatalogItem>> {
    let mut seen = HashSet::new();
    let mut books = Vec::new();
    for row in list(raw, 100)? {
        let book = item(row)?;
        if !seen.insert(book.id.clone()) {
            return Err("爱听写同义替换词书重复".into());
        }
        books.push(book);
    }
    session.books = seen;
    session.chapters.clear();
    Ok(books)
}

fn chapters(session: &mut SynonymSession, book_id: &str, raw: &Value) -> Result<Vec<Category>> {
    if id(&raw["book"]["id"])? != book_id {
        return Err("爱听写同义替换词书与所选目录不一致".into());
    }
    let mut seen = HashSet::new();
    let mut grants = HashMap::new();
    let mut categories = Vec::new();
    for row in list(&raw["categories"], 100)? {
        let category_id = id(&row["id"])?;
        if !seen.insert(category_id.clone()) {
            return Err("爱听写同义替换分类重复".into());
        }
        let mut chapters = Vec::new();
        for child in list(&row["chapters"], 500)? {
            let chapter = item(child)?;
            if id(&child["category_id"])? != category_id
                || grants.contains_key(&chapter.id)
                || grants.len() >= 2000
            {
                return Err("爱听写同义替换章节身份异常".into());
            }
            grants.insert(
                chapter.id.clone(),
                ChapterGrant {
                    book_id: book_id.into(),
                    category_id: category_id.clone(),
                },
            );
            chapters.push(chapter);
        }
        categories.push(Category {
            id: category_id,
            title: label(row, "name")?,
            chapters,
        });
    }
    session.chapters = grants;
    Ok(categories)
}

fn chapter(grant: &ChapterGrant, chapter_id: &str, raw: &Value) -> Result<Vec<Group>> {
    if id(&raw["book"]["id"])? != grant.book_id
        || id(&raw["category"]["id"])? != grant.category_id
        || id(&raw["chapter"]["id"])? != chapter_id
    {
        return Err("爱听写同义替换详情与所选章节不一致".into());
    }
    let mut group_ids = HashSet::new();
    let mut pair_ids = HashSet::new();
    let mut groups = Vec::new();
    for row in list(&raw["groups"], 200)? {
        let group_id = id(&row["id"])?;
        if id(&row["chapter_id"])? != chapter_id || !group_ids.insert(group_id.clone()) {
            return Err("爱听写同义替换题组身份异常".into());
        }
        let mut pairs = Vec::new();
        for entry in list(&row["pairs"], 200)? {
            let pair_id = id(&entry["id"])?;
            if id(&entry["group_id"])? != group_id
                || !pair_ids.insert(pair_id.clone())
                || pair_ids.len() > 2000
            {
                return Err("爱听写同义替换词对身份异常".into());
            }
            match entry["is_delete"].as_u64() {
                Some(1) => continue,
                Some(0) => {}
                _ => return Err("爱听写同义替换词对状态未知".into()),
            }
            pairs.push(Pair {
                id: pair_id,
                left: label(entry, "left_text")?,
                right: label(entry, "right_text")?,
                meaning: entry["meaning_zh"]
                    .as_str()
                    .unwrap_or_default()
                    .chars()
                    .take(1000)
                    .collect(),
            });
        }
        if row["pair_count"].as_u64() != Some(pairs.len() as u64) {
            return Err("爱听写同义替换词对未完整返回".into());
        }
        groups.push(Group {
            id: group_id,
            version: row["version"]
                .as_u64()
                .ok_or("爱听写同义替换题组缺少版本")?,
            pairs,
        });
    }
    Ok(groups)
}

#[tauri::command]
pub async fn idictation_synonym_books(
    app: AppHandle,
    account: State<'_, Account>,
) -> Result<Vec<CatalogItem>> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    session.synonym = SynonymSession::default();
    let raw = transport::read(&app, "synonymBooks", json!({})).await?;
    verify(&app, &mut session).await?;
    books(&mut session.synonym, &raw)
}

#[tauri::command]
pub async fn idictation_synonym_chapters(
    app: AppHandle,
    account: State<'_, Account>,
    book_id: String,
) -> Result<Vec<Category>> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    session.synonym.chapters.clear();
    if !session.synonym.books.contains(&book_id) {
        return Err("请先从当前账号的同义替换目录选择词书".into());
    }
    let source_id = book_id.parse::<u64>().map_err(|_| "同义替换词书身份无效")?;
    let raw = transport::read(&app, "synonymChapters", json!({"book_id":source_id})).await?;
    verify(&app, &mut session).await?;
    chapters(&mut session.synonym, &book_id, &raw)
}

#[tauri::command]
pub async fn idictation_synonym_chapter(
    app: AppHandle,
    account: State<'_, Account>,
    chapter_id: String,
) -> Result<Vec<Group>> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if !session.synonym.chapters.contains_key(&chapter_id) {
        return Err("请先从当前账号的同义替换目录选择章节".into());
    }
    let source_id = chapter_id
        .parse::<u64>()
        .map_err(|_| "同义替换章节身份无效")?;
    let raw = transport::read(&app, "synonymChapter", json!({"chapter_id":source_id})).await?;
    verify(&app, &mut session).await?;
    let grant = session
        .synonym
        .chapters
        .get(&chapter_id)
        .ok_or("同义替换目录已失效")?;
    chapter(grant, &chapter_id, &raw)
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_synonym.rs"]
mod tests;
