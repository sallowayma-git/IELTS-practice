use super::{article, service::{verify, Account}, training, transport, vocabulary::{self, SourceBook, SourceChapter}};
use crate::app::state::AppDb;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

fn playlist(owner: &str, book: &SourceBook, chapter: &SourceChapter, value: Value) -> Result<(Value, Value), String> {
    let page: vocabulary::WordPage = serde_json::from_value(value).map_err(|_| "随身听词条格式异常")?;
    let clips: Vec<_> = page.data.iter().map(|word| {
        [word.american_audio.as_deref(), word.british_audio.as_deref()]
            .map(|url| url.and_then(|url| training::validated_audio(url).ok()))
    }).collect();
    let imported = vocabulary::convert_unit(owner, book, chapter, 0, page)?;
    let mut words = Vec::new();
    let mut media = Vec::new();
    for (word, clips) in imported.words.into_iter().zip(clips) {
        let [american, british] = clips;
        let mut add_clip = |accent, url: Option<String>| {
            url.map(|url| {
                let id = format!("{}-{accent}", word.source_id);
                media.push(json!({"id": id, "url": url, "startSeconds": 0, "endSeconds": null}));
                id
            })
        };
        let american = add_clip("american", american);
        let british = add_clip("british", british);
        words.push(json!({"id":word.source_id, "term":word.term, "definition":word.definition,
            "american":american, "british":british}));
    }
    Ok((json!(words), json!({"studyMaterial":{"media":media}})))
}

#[tauri::command]
pub async fn idictation_walkman_open(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    book_id: String, unit_id: String) -> Result<Value, String>
{
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let owner = session.owner.as_deref().ok_or("尚未连接账号")?.to_owned();
    let source = training::source_unit(&db, &owner, &book_id, &unit_id)?;
    let book_id = source.book_id.parse::<u64>().map_err(|_| "词书来源编号无效")?;
    let chapter_id = source.chapter_id.parse::<u64>().map_err(|_| "章节来源编号无效")?;
    let (book, chapter) = training::authorized_chapter(&app, &source, book_id).await?;
    verify(&app, &mut session).await?;
    let value = transport::read(&app, "trainingWords", json!({
        "c_id": chapter_id, "pagesize": 9999, "s_id": null, "compact": 1
    })).await?;
    verify(&app, &mut session).await?;
    let (words, payload) = playlist(&owner, &book, &chapter, value)?;
    let asset_id = format!("idictation-walkman-{}", uuid::Uuid::new_v4());
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, payload))
        .map_err(|error| error.to_string())?;
    let session_id = article::open_playback(&app, &mut session.article, asset_id);
    Ok(json!({"sessionId":session_id, "words":words}))
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_walkman.rs"]
mod tests;
