use super::{article_dictation::sentence, service::{verify, Account}, transport, vocabulary};
use crate::app::state::AppDb;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, State};

const PENDING: &str = "idictation.article-mark.pending";

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Mark {
    choice: u8,
    collected: bool,
}

pub(super) fn snapshot(value: &Value, mode: &str) -> Value {
    let round = super::article::practice_round(&value["last_key_jingting"]);
    if round.is_null() { return Value::Null; }
    let submitted: HashSet<_> = value["existing_id_jingting"].as_array().into_iter()
        .flatten().filter_map(|id| vocabulary::id(id).ok()).collect();
    let states: HashMap<_, _> = value["data"].as_array().into_iter().flatten().filter_map(|row| {
        let id = vocabulary::id(&row["id"]).ok()?;
        let completed = row["markCompleted"].as_bool().unwrap_or_else(|| submitted.contains(&id));
        let choice = row["markChoice"].as_u64().filter(|choice| (1..=3).contains(choice)).unwrap_or(0) as u8;
        Some((format!("idictation-article-{mode}-{id}"), Mark {
            choice: if completed { choice } else { 0 },
            collected: row["collected"] == true,
        }))
    }).collect();
    json!({"round":round,"states":states})
}

fn clear_pending(db: &AppDb, scope: &str) -> Result<(), String> {
    db.with_conn(|conn| ielts_db::settings::delete_setting(conn, PENDING, scope))
        .map(|_|()).map_err(|_| "无法更新本机标记确认状态".into())
}

fn resolves(pending: &Value, round: &str, previous: Mark) -> bool {
    pending["round"] == round && pending["choice"] == u64::from(previous.choice)
        && (pending["collect"] == false || previous.collected)
}

#[tauri::command]
pub async fn idictation_article_mark(
    app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    session_id: String, sentence_id: String, choice: u8,
) -> Result<Mark, String> {
    if !(1..=3).contains(&choice) { return Err("精听标记无效".into()); }
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let asset = session.article.playback_asset(&session_id).ok_or("请重新打开当前精听章节")?;
    let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
    let mut payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, asset))
        .map_err(|error| error.to_string())?;
    let article_id = sentence(&payload, &sentence_id)?["id"].clone();
    let id = vocabulary::id(&article_id)?;
    let scope = hex::encode(Sha256::digest(json!([owner, id]).to_string()));
    let marking = &mut payload["articleMarking"];
    let key = marking["round"].clone();
    let round = vocabulary::id(&key).map_err(|_| "原站精听轮次无效，请重新打开章节")?;
    let state = &mut marking["states"][&sentence_id];
    let previous: Mark = serde_json::from_value(state.clone()).map_err(|_| "当前精听标记缺失")?;

    let pending = db.with_conn(|conn| ielts_db::settings::get_setting(conn, PENDING, &scope))
        .map_err(|_| "无法读取精听标记确认状态")?;
    if let Some(pending) = pending {
        if !resolves(&pending.value, &round, previous) {
            return Err("上次标记或收藏尚未确认。请重新打开章节核对，或到爱听写查看该句".into());
        }
        clear_pending(&db, &scope)?;
    }
    let collect = choice != 1 && !previous.collected;
    if choice == previous.choice && !collect { return Ok(previous); }
    db.with_conn(|conn| ielts_db::settings::upsert_setting(conn, PENDING, &scope,
        &json!({"round":round,"choice":choice,"collect":collect})))
        .map_err(|_| "无法保存本机确认状态，本次未提交")?;

    let options = json!({"articleId":article_id,"choice":choice,"key":key,"expectedOwner":owner});
    if choice != previous.choice {
        transport::read(&app, "articleMark", options.clone()).await
            .map_err(|error| format!("标记尚未确认：{error}。请重新打开章节核对"))?;
    }
    if collect {
        transport::read(&app, "articleCollect", options).await
            .map_err(|error| format!("标记已保存，自动收藏尚未确认：{error}。请重新打开章节核对"))?;
    }
    let result = Mark { choice, collected: previous.collected || collect };
    *state = json!(result);
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", asset, payload))
        .map_err(|_| "原站已确认，请重新打开章节刷新标记")?;
    clear_pending(&db, &scope)?;
    Ok(result)
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_article_marking.rs"]
mod tests;
