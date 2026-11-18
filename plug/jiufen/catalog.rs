use super::service::{authorized, identifier, Account};
use crate::app::state::AppDb;
use ielts_db::settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::State;

const MODES: &str = "?includeEntryModes=memory_link,spelling_recall";

#[derive(Default)]
pub(super) struct Access {
    units: HashMap<String, String>,
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_default()
}
fn list(v: &Value) -> Result<&Vec<Value>, String> {
    v["data"]["list"]
        .as_array()
        .ok_or_else(|| "题源列表格式异常".into())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    id: String,
    title: String,
    channel: String,
    parts: Vec<String>,
    available: bool,
}

fn parts(row: &Value) -> Vec<String> {
    let mut labels = Vec::new();
    let parts = std::iter::once(&row["partNo"]).chain(
        row["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| &p["partNo"]),
    );
    for part in parts {
        let raw = part
            .as_str()
            .unwrap_or_default()
            .trim_start_matches("Part ")
            .trim_start_matches('P');
        if let Ok(n @ 1..=4) = raw.parse::<u8>() {
            labels.push(format!("P{n}"));
        }
    }
    labels.sort();
    labels.dedup();
    labels
}
async fn fetch_catalog(
    session: &mut Option<super::service::Session>,
) -> Result<Vec<Entry>, String> {
    let response = authorized(session, "/practice/v1/runtime-mode", None).await?;
    if response["data"]["effectiveMode"] != "online" {
        return Err("当前题源需要资源包".into());
    }
    let response = authorized(session, &format!("/practice/v1/albums{MODES}"), None).await?;
    let mut units = std::collections::BTreeMap::new();
    for album in list(&response)? {
        let channel = text(album, "channel");
        if album["hidden"] == true || !matches!(channel, "reading" | "listening") {
            continue;
        }
        let id = identifier(&album["id"]).ok_or("专辑标识无效")?;
        let response = authorized(
            session,
            &format!("/practice/v1/albums/{id}/units{MODES}"),
            None,
        )
        .await?;
        if response["data"]["albumId"] != id {
            return Err("专辑不匹配".into());
        }
        for u in list(&response)? {
            if u["entryMode"] != "exam" || u["albumId"] != id || u["channel"] != channel {
                continue;
            }
            let id = identifier(&u["id"]).ok_or("题目标识无效")?;
            let available = u["available"] == true && u["lockedForOrdinaryUsers"] == false;
            let entry = units
                .entry((channel.to_owned(), id.clone()))
                .or_insert_with(|| Entry {
                    id,
                    title: text(u, "title").into(),
                    channel: channel.into(),
                    parts: vec![],
                    available: false,
                });
            entry.parts.extend(parts(u));
            entry.parts.sort();
            entry.parts.dedup();
            entry.available |= available;
        }
    }
    Ok(units.into_values().collect())
}
#[tauri::command]
pub async fn jiufen_library(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    refresh: bool,
) -> Result<Vec<Entry>, String> {
    let mut session = account.0.lock().await;
    let Some(current) = session.as_ref() else {
        return Ok(vec![]);
    };
    let key = format!(
        "catalog-v1-{}",
        hex::encode(Sha256::digest(current.owner.as_bytes()))
    );
    let rows: Vec<Entry> = if refresh {
        let rows = fetch_catalog(&mut session).await?;
        db.with_conn(|c| {
            settings::upsert_setting(c, super::service::NS, &key, &serde_json::json!(rows))
        })
        .map_err(|e| e.to_string())?;
        rows
    } else {
        let row = db
            .with_conn(|c| settings::get_setting(c, super::service::NS, &key))
            .map_err(|e| e.to_string())?;
        match row {
            Some(r) => serde_json::from_value(r.value).map_err(|_| "题目目录需重新同步")?,
            None => vec![],
        }
    };
    if let Some(current) = session.as_mut() {
        current.catalog.units = rows
            .iter()
            .filter(|r| r.available)
            .map(|r| (r.id.clone(), r.channel.clone()))
            .collect();
    }
    Ok(rows)
}

pub(super) fn media_url(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("static.9fnnn.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then(|| url.to_string())
}
pub(super) async fn fetch_unit(
    session: &mut Option<super::service::Session>,
    unit_id: &str,
) -> Result<Value, String> {
    let channel = session
        .as_ref()
        .and_then(|s| s.catalog.units.get(unit_id))
        .ok_or("请从题库选择可用的九分学长题目")?
        .clone();
    let response = authorized(session, &format!("/practice/v1/units/{unit_id}/exam"), None).await?;
    let unit = &response["data"];
    if unit["id"] != unit_id || unit["channel"] != channel {
        return Err("返回的试题与所选题目不一致".into());
    }
    Ok(unit.clone())
}
