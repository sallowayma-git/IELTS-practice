//! Conversion contract derived from the public web client on 2026-11-20.
//! Static contract tests are not evidence that an account can access the content.
use ielts_db::vocab::books::{SourceWord, UnitImport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Debug, Clone, Deserialize)]
pub struct SourceBook {
    pub id: Value,
    pub name: String,
    #[serde(default)]
    pub need_buy: Value,
    #[serde(default)]
    pub already_buy: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SourceChapter {
    pub id: Value,
    pub name: String,
    #[serde(default)]
    pub g_id: Value,
}

#[derive(Debug, Deserialize)]
pub struct ChapterGroup {
    pub list: Vec<SourceChapter>,
}

#[derive(Debug, Deserialize)]
pub struct Chapters {
    pub chapters: Vec<ChapterGroup>,
}

#[derive(Debug, Deserialize)]
pub struct WordPage {
    pub data: Vec<Word>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
pub struct Word {
    pub id: Value,
    pub word: String,
    pub c_id: Value,
    pub g_id: Value,
    #[serde(default)]
    pub translate: Option<String>,
    #[serde(default)]
    pub phonetic_transcription: Option<String>,
    #[serde(default)]
    pub example: Option<String>,
    #[serde(default, rename = "phonetic-m")]
    pub american_audio: Option<String>,
    #[serde(default, rename = "phonetic-y")]
    pub british_audio: Option<String>,
}

pub(super) fn id(value: &Value) -> Result<String, String> {
    let value = match value {
        Value::Number(n) if n.as_u64().is_some_and(|v| v > 0) => n.to_string(),
        Value::String(s) if !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_digit()) => s.clone(),
        _ => return Err("爱听写来源 ID 无效".into()),
    };
    if value.bytes().all(|b| b == b'0') {
        return Err("爱听写来源 ID 无效".into());
    }
    Ok(value)
}

pub(super) fn enabled(value: &Value) -> bool {
    value == &Value::Bool(true) || value.as_u64() == Some(1) || value.as_str() == Some("1")
}

/// Convert a complete chapter from the logged-in account's observed response.
/// Authorization and audio host validation belong to the future transport layer.
/// This function does not grant access, fetch URLs, or submit practice results.
pub fn convert_unit(owner: &str, book: &SourceBook, chapter: &SourceChapter,
    position: u32, page: WordPage) -> Result<UnitImport, String>
{
    if owner.trim().is_empty() || owner.len() > 128 {
        return Err("缺少爱听写账号归属".into());
    }
    if enabled(&book.need_buy) && !enabled(&book.already_buy) {
        return Err("该词书需要原站授权".into());
    }
    let book_id = id(&book.id)?;
    let chapter_id = id(&chapter.id)?;
    if !chapter.g_id.is_null() && id(&chapter.g_id)? != book_id {
        return Err("章节不属于当前词书".into());
    }
    if page.total != page.data.len() || page.total > 9999 {
        return Err("章节词条未完整返回".into());
    }
    let mut seen = HashSet::new();
    let mut words = Vec::with_capacity(page.total);
    for word in page.data {
        let source_id = id(&word.id)?;
        if id(&word.c_id)? != chapter_id || id(&word.g_id)? != book_id || !seen.insert(source_id.clone()) {
            return Err("词条归属冲突或重复".into());
        }
        words.push(SourceWord {
            source_id, term: word.word, definition: word.translate,
            phonetic: word.phonetic_transcription, example: word.example,
        });
    }
    Ok(UnitImport {
        provider: "idictation".into(), owner_key: hex::encode(Sha256::digest(owner.as_bytes())),
        book_source_id: book_id, book_title: book.name.clone(),
        unit_source_id: chapter_id, unit_title: chapter.name.clone(),
        unit_position: position, words,
    })
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadContract {
    pub path: &'static str,
    pub fields: &'static [&'static str],
}

// Each uses the product's POST wrapper. No arbitrary endpoint or write passthrough.
pub const CATALOG: &[ReadContract] = &[
    ReadContract { path: "/api/study/lexicon/v1/language/list", fields: &[] },
    ReadContract { path: "/api/study/lexicon/v1/v1/category/list", fields: &["l_id", "check_data"] },
    ReadContract { path: "/api/study/lexicon/v1/scene/list", fields: &["l_id", "c_id", "check_data"] },
    ReadContract { path: "/api/study/lexicon/v1/group/list", fields: &["s_id", "check_data", "scene_type"] },
    ReadContract { path: "/api/study/lexicon/v2/chapter/list", fields: &["g_id", "s_id"] },
    ReadContract { path: "/api/study/lexicon/v1/list", fields: &["c_id", "compact", "pagesize", "s_id"] },
    ReadContract { path: "/api/study/lexicon/v1/detail", fields: &["id"] },
];

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_vocabulary.rs"]
mod tests;
