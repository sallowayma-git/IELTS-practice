//! Local dictionary index (Phase 8). Static entries loaded into SQLite for offline lookup.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::sqlite::{DbError, DbResult};
use crate::vocab::normalize_term;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub term: String,
    pub normalized_term: String,
    pub definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_of_speech: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    pub found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDictionaryCommand {
    pub entries: Vec<DictionaryEntry>,
}

pub fn upsert_dictionary_entry(conn: &Connection, entry: &DictionaryEntry) -> DbResult<()> {
    let term = entry.term.trim();
    if term.is_empty() || entry.definition.trim().is_empty() {
        return Err(DbError::Validation("term and definition required".into()));
    }
    let normalized = if entry.normalized_term.trim().is_empty() {
        normalize_term(term)
    } else {
        entry.normalized_term.clone()
    };
    let payload = entry.payload.as_ref().map(|v| v.to_string());
    conn.execute(
        "INSERT INTO dictionary_entries (
            term, normalized_term, definition, phonetic, part_of_speech, example, source_label, license, payload_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(term) DO UPDATE SET
            normalized_term = excluded.normalized_term,
            definition = excluded.definition,
            phonetic = excluded.phonetic,
            part_of_speech = excluded.part_of_speech,
            example = excluded.example,
            source_label = excluded.source_label,
            license = excluded.license,
            payload_json = excluded.payload_json",
        params![
            term,
            normalized,
            entry.definition.trim(),
            entry.phonetic,
            entry.part_of_speech,
            entry.example,
            entry.source_label,
            entry.license,
            payload,
        ],
    )?;
    Ok(())
}

pub fn import_dictionary(conn: &Connection, cmd: &ImportDictionaryCommand) -> DbResult<u32> {
    let mut n = 0u32;
    for entry in &cmd.entries {
        upsert_dictionary_entry(conn, entry)?;
        n += 1;
    }
    Ok(n)
}

pub fn lookup_term(conn: &Connection, term: &str) -> DbResult<DictionaryEntry> {
    let normalized = normalize_term(term);
    if normalized.is_empty() {
        return Ok(DictionaryEntry {
            term: term.into(),
            normalized_term: normalized,
            definition: String::new(),
            phonetic: None,
            part_of_speech: None,
            example: None,
            source_label: None,
            license: None,
            payload: None,
            found: false,
        });
    }
    let row = conn.query_row(
        "SELECT term, normalized_term, definition, phonetic, part_of_speech, example, source_label, license, payload_json
         FROM dictionary_entries WHERE normalized_term = ?1 OR term = ?2 LIMIT 1",
        params![normalized, term.trim()],
        |r| {
            let payload_json: Option<String> = r.get(8)?;
            Ok(DictionaryEntry {
                term: r.get(0)?,
                normalized_term: r.get(1)?,
                definition: r.get(2)?,
                phonetic: r.get(3)?,
                part_of_speech: r.get(4)?,
                example: r.get(5)?,
                source_label: r.get(6)?,
                license: r.get(7)?,
                payload: payload_json.and_then(|s| serde_json::from_str(&s).ok()),
                found: true,
            })
        },
    );
    match row {
        Ok(entry) => Ok(entry),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(DictionaryEntry {
            term: term.trim().into(),
            normalized_term: normalized,
            definition: String::new(),
            phonetic: None,
            part_of_speech: None,
            example: None,
            source_label: Some("local".into()),
            license: None,
            payload: None,
            found: false,
        }),
        Err(e) => Err(e.into()),
    }
}

pub fn dictionary_count(conn: &Connection) -> DbResult<i64> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM dictionary_entries", [], |r| r.get(0))?;
    Ok(n)
}
