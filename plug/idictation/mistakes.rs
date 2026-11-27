//! Import the account's wrong words into the existing local review queue.
use super::{
    service::{verify, Account},
    transport,
    vocabulary::id,
};
use crate::app::state::AppDb;
use ielts_db::vocab::books::{self, ImportResult, SourceWord, UnitImport};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::{AppHandle, State};

const PAGE_SIZE: u64 = 200;
const MAX_ROWS: u64 = 10_000;

struct Snapshot {
    total: Option<u64>,
    next_page: u64,
    records: HashSet<String>,
    words: Vec<SourceWord>,
}

impl Snapshot {
    fn new() -> Self {
        Self {
            total: None,
            next_page: 1,
            records: HashSet::new(),
            words: Vec::new(),
        }
    }

    fn accept(&mut self, owner: &str, response: &Value) -> Result<bool, String> {
        let total = response["total"].as_u64().ok_or("爱听写错词总数无效")?;
        if total > MAX_ROWS {
            return Err("爱听写错词超过 10000 条，本次未导入".into());
        }
        let last_page = total.div_ceil(PAGE_SIZE).max(1);
        let start = (self.next_page - 1) * PAGE_SIZE;
        let expected = total.saturating_sub(start).min(PAGE_SIZE);
        let rows = response["data"].as_array().ok_or("爱听写错词列表无效")?;
        if response["current_page"].as_u64() != Some(self.next_page)
            || response["per_page"].as_u64() != Some(PAGE_SIZE)
            || response["last_page"].as_u64() != Some(last_page)
            || self.total.is_some_and(|previous| previous != total)
            || self.next_page > last_page
            || rows.len() as u64 != expected
        {
            return Err("爱听写错词列表在读取中变化或未完整返回，请重试".into());
        }
        self.total = Some(total);
        for row in rows {
            self.accept_record(owner, row)?;
        }
        self.next_page += 1;
        Ok(self.next_page > last_page)
    }

    fn accept_record(&mut self, owner: &str, row: &Value) -> Result<(), String> {
        let record_id = id(&row["id"])?;
        if id(&row["user_id"])? != owner || !self.records.insert(record_id.clone()) {
            return Err("爱听写错词账号不一致或分页记录重复".into());
        }
        let lexicon = &row["lexicon"];
        if row["is_delete"] == 1 || lexicon.is_null() {
            return Ok(());
        }
        let term = lexicon["word"]
            .as_str()
            .map(str::trim)
            .filter(|word| !word.is_empty() && word.len() <= 1024)
            .ok_or("爱听写错词词条内容无效")?;
        // The outer ID belongs to the wrong-word record. The product prefers
        // the nested lexicon ID when displaying the attached word.
        id(&lexicon["id"])?;
        let text = |field: &str, max: usize| {
            lexicon[field]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.chars().take(max).collect())
        };
        self.words.push(SourceWord {
            source_id: record_id,
            term: term.into(),
            definition: text("translate", 4000),
            phonetic: text("phonetic_transcription", 256),
            example: text("example", 4000),
        });
        Ok(())
    }

    fn into_import(self, owner: &str) -> Option<UnitImport> {
        if self.words.is_empty() {
            return None;
        }
        Some(UnitImport {
            provider: "idictation-mistakes".into(),
            owner_key: hex::encode(Sha256::digest(owner.as_bytes())),
            book_source_id: "wrong-words".into(),
            book_title: "爱听写错词".into(),
            unit_source_id: "all".into(),
            unit_title: "已导入的错词".into(),
            unit_position: 0,
            words: self.words,
        })
    }
}

#[tauri::command]
pub async fn idictation_import_mistakes(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
) -> Result<Option<ImportResult>, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let owner = session.owner.clone().ok_or("请先连接爱听写账号")?;
    let mut snapshot = Snapshot::new();
    let read = async {
        loop {
            let raw = transport::read(
                &app,
                "mistakeWords",
                json!({
                    "error_dates":[], "recently":false, "c_ids":[], "g_ids":[], "error_nums":[],
                    "page":snapshot.next_page, "pagesize":PAGE_SIZE
                }),
            )
            .await?;
            if snapshot.accept(&owner, &raw)? {
                return Ok::<(), String>(());
            }
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(120), read)
        .await
        .map_err(|_| "爱听写错词读取超时，本次未导入")??;
    verify(&app, &mut session).await?;
    let Some(input) = snapshot.into_import(&owner) else {
        return Ok(None);
    };
    db.with_conn(|conn| books::import_unit(conn, &input))
        .map(Some)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_mistakes.rs"]
mod tests;
