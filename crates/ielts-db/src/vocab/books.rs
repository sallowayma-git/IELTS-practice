//! Source book membership without overwriting user definitions, tags or review state.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use super::{get_vocab, normalize_term, upsert_vocab, UpsertVocabCommand, VocabularyItem};
use crate::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub unit_count: u32,
    pub word_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub id: String,
    pub title: String,
    pub word_count: u32,
}

/// Adapter input. Only a provider's verified content importer should call this;
/// this is deliberately not an arbitrary JSON-to-database Tauri command.
pub struct UnitImport {
    pub provider: String,
    pub owner_key: String,
    pub book_source_id: String,
    pub book_title: String,
    pub unit_source_id: String,
    pub unit_title: String,
    pub unit_position: u32,
    pub words: Vec<SourceWord>,
}

pub struct SourceWord {
    pub source_id: String,
    pub term: String,
    pub definition: Option<String>,
    pub phonetic: Option<String>,
    pub example: Option<String>,
}

/// Internal provider lookup. Source identities stay out of the shared word DTO.
pub struct SourceUnit {
    pub provider: String,
    pub owner_key: String,
    pub book_id: String,
    pub chapter_id: String,
}

pub fn source_unit(conn: &Connection, book_id: &str, unit_id: &str) -> DbResult<SourceUnit> {
    conn.query_row("SELECT b.provider,b.owner_key,b.source_id,u.source_id
        FROM vocabulary_books b JOIN vocabulary_book_units u ON u.book_id=b.id
        WHERE b.id=?1 AND u.id=?2", params![book_id, unit_id], |r| Ok(SourceUnit {
            provider:r.get(0)?,owner_key:r.get(1)?,book_id:r.get(2)?,chapter_id:r.get(3)?
        })).map_err(Into::into)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub book_id: String,
    pub unit_id: String,
    pub imported: usize,
}

fn identity(parts: &[&str]) -> String {
    // Length-delimited JSON avoids ambiguous concatenations of external IDs.
    let data = serde_json::to_vec(parts).expect("string array serialization");
    format!("vbook-{}", hex::encode(Sha256::digest(data)))
}

fn validate(input: &UnitImport) -> DbResult<()> {
    for value in [&input.provider, &input.owner_key, &input.book_source_id,
        &input.book_title, &input.unit_source_id, &input.unit_title]
    {
        if value.trim().is_empty() || value.len() > 1024 {
            return Err(DbError::Validation("invalid vocabulary book identity or title".into()));
        }
    }
    if input.words.len() > 10_000 {
        return Err(DbError::Validation("vocabulary unit exceeds 10000 words".into()));
    }
    let mut ids = HashSet::new();
    for word in &input.words {
        if word.source_id.is_empty() || word.source_id.len() > 128
            || normalize_term(&word.term).is_empty() || word.term.len() > 1024
            || !ids.insert(&word.source_id)
        {
            return Err(DbError::Validation("invalid or duplicate source word".into()));
        }
    }
    Ok(())
}

/// Merge one observed unit atomically. Missing members are retained: a partial
/// response must never delete a user's vocabulary or reset their review history.
pub fn import_unit(conn: &Connection, input: &UnitImport) -> DbResult<ImportResult> {
    validate(input)?;
    let book_id = identity(&[&input.provider, &input.owner_key, &input.book_source_id]);
    let unit_id = identity(&[&book_id, &input.unit_source_id]);
    // AppDb serialises access. A nested transaction is rejected by SQLite;
    // no connection lock is held while the provider fetches the source data.
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO vocabulary_books(id,provider,owner_key,source_id,title,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, updated_at=excluded.updated_at",
        params![book_id, input.provider, input.owner_key, input.book_source_id,
            input.book_title, chrono::Utc::now().to_rfc3339()],
    )?;
    tx.execute(
        "INSERT INTO vocabulary_book_units(id,book_id,source_id,title,position)
         VALUES (?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, position=excluded.position",
        params![unit_id, book_id, input.unit_source_id, input.unit_title, input.unit_position],
    )?;
    for (position, word) in input.words.iter().enumerate() {
        let item_id = ensure_word(&tx, word)?;
        tx.execute(
            "INSERT INTO vocabulary_book_entries(unit_id,source_id,item_id,position)
             VALUES (?1,?2,?3,?4) ON CONFLICT(unit_id,source_id) DO UPDATE SET
             item_id=excluded.item_id, position=excluded.position",
            params![unit_id, word.source_id, item_id, position as i64],
        )?;
    }
    tx.commit()?;
    Ok(ImportResult { book_id, unit_id, imported: input.words.len() })
}

fn ensure_word(conn: &Connection, word: &SourceWord) -> DbResult<String> {
    if let Some(id) = super::find_vocab_id_by_normalized(conn, &normalize_term(&word.term))? {
        return Ok(id);
    }
    Ok(upsert_vocab(conn, &UpsertVocabCommand {
        id: None, term: word.term.clone(), definition: word.definition.clone(),
        phonetic: word.phonetic.clone(), example: word.example.clone(),
        part_of_speech: None, source_asset_id: None, source_attempt_id: None,
        tags: vec![],
    })?.id)
}

pub fn list_books(conn: &Connection) -> DbResult<Vec<Book>> {
    let mut query = conn.prepare(
        "SELECT b.id,b.provider,b.title,COUNT(DISTINCT u.id),COUNT(DISTINCT e.item_id)
         FROM vocabulary_books b LEFT JOIN vocabulary_book_units u ON u.book_id=b.id
         LEFT JOIN vocabulary_book_entries e ON e.unit_id=u.id
         GROUP BY b.id ORDER BY b.title,b.id",
    )?;
    let rows = query.query_map([], |r| Ok(Book {
        id: r.get(0)?, provider: r.get(1)?, title: r.get(2)?,
        unit_count: r.get(3)?, word_count: r.get(4)?,
    }))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn list_units(conn: &Connection, book_id: &str) -> DbResult<Vec<Unit>> {
    let mut query = conn.prepare(
        "SELECT u.id,u.title,COUNT(DISTINCT e.item_id) FROM vocabulary_book_units u
         LEFT JOIN vocabulary_book_entries e ON e.unit_id=u.id WHERE u.book_id=?1
         GROUP BY u.id ORDER BY u.position,u.id",
    )?;
    let rows = query.query_map([book_id], |r| Ok(Unit {
        id: r.get(0)?, title: r.get(1)?, word_count: r.get(2)?,
    }))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

pub fn list_words(conn: &Connection, book_id: &str, unit_id: Option<&str>,
    limit: u32, offset: u32) -> DbResult<Vec<VocabularyItem>>
{
    // A word may occur in multiple units. One review item, ordered by its first
    // occurrence, prevents duplicate SM-2 submissions in a whole-book session.
    let mut query = conn.prepare(
        "SELECT item_id FROM (
           SELECT e.item_id,u.position unit_position,u.id unit_id,e.position,e.source_id,
             ROW_NUMBER() OVER(PARTITION BY e.item_id ORDER BY u.position,u.id,e.position,e.source_id) occurrence
           FROM vocabulary_book_entries e JOIN vocabulary_book_units u ON u.id=e.unit_id
           WHERE u.book_id=?1 AND (?2 IS NULL OR u.id=?2)
         ) WHERE occurrence=1 ORDER BY unit_position,unit_id,position,source_id
         LIMIT ?3 OFFSET ?4",
    )?;
    let ids = query.query_map(params![book_id, unit_id, limit.min(500), offset], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter().map(|id| get_vocab(conn, id)).collect()
}

#[cfg(test)]
#[path = "../../../../developer/tests/rust/vocabulary_books.rs"]
mod tests;
