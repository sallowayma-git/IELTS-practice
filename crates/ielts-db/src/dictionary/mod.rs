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

/// Bundled ECDICT subset (`assets/wordlists/ecdict_reading.bundle.js`), read-only and
/// held in memory. User-imported `dictionary_entries` rows always win over it.
#[derive(Debug, Default)]
pub struct BundledDictionary {
    entries: Vec<BundledRaw>,
    /// normalized headword or inflected form -> index into `entries`.
    index: std::collections::HashMap<String, usize>,
}

#[derive(Debug, Deserialize)]
struct BundledRaw {
    w: String,
    #[serde(default)]
    t: String,
    #[serde(default)]
    d: String,
    #[serde(default)]
    p: Option<String>,
    #[serde(default)]
    x: Option<String>,
}

pub const BUNDLED_DICTIONARY_LABEL: &str = "ECDICT";
pub const BUNDLED_DICTIONARY_LICENSE: &str = "MIT";

impl BundledDictionary {
    /// Parses the JS bundle: `... entries: [ {...}, ... ] };` — the array is plain JSON.
    pub fn from_bundle_js(text: &str) -> DbResult<Self> {
        let invalid = || DbError::Validation("ECDICT bundle: entries array not found".into());
        let start = text.find("entries: [").ok_or_else(invalid)? + "entries: ".len();
        let end = text.rfind("] };").ok_or_else(invalid)? + 1;
        if end <= start {
            return Err(invalid());
        }
        let entries: Vec<BundledRaw> = serde_json::from_str(&text[start..end])
            .map_err(|e| DbError::Validation(format!("ECDICT bundle: {e}")))?;
        Ok(Self::from_entries(entries))
    }

    pub fn load(path: &std::path::Path) -> DbResult<Self> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| DbError::Message(format!("read {}: {e}", path.display())))?;
        Self::from_bundle_js(&text)
    }

    fn from_entries(entries: Vec<BundledRaw>) -> Self {
        let mut index = std::collections::HashMap::with_capacity(entries.len() * 2);
        for (i, e) in entries.iter().enumerate() {
            index.insert(normalize_term(&e.w), i);
        }
        // ECDICT exchange field, e.g. `d:abandoned/i:abandoning/3:abandons`: map inflected
        // forms to their base entry unless the form is itself a headword.
        for (i, e) in entries.iter().enumerate() {
            for part in e.x.as_deref().unwrap_or("").split('/') {
                let Some((kind, form)) = part.split_once(':') else {
                    continue;
                };
                if matches!(kind, "p" | "d" | "i" | "3" | "s" | "r" | "t") {
                    index.entry(normalize_term(form)).or_insert(i);
                }
            }
        }
        Self { entries, index }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&self, term: &str) -> Option<DictionaryEntry> {
        let e = &self.entries[*self.index.get(&normalize_term(term))?];
        let definition = if e.t.trim().is_empty() { &e.d } else { &e.t };
        if definition.trim().is_empty() {
            return None;
        }
        Some(DictionaryEntry {
            term: e.w.clone(),
            normalized_term: normalize_term(&e.w),
            definition: definition.trim().to_string(),
            phonetic: e.p.clone().filter(|p| !p.trim().is_empty()),
            part_of_speech: None,
            example: None,
            source_label: Some(BUNDLED_DICTIONARY_LABEL.into()),
            license: Some(BUNDLED_DICTIONARY_LICENSE.into()),
            payload: Some(serde_json::json!({
                "english": e.d,
                "exchange": e.x,
                "requested": term.trim(),
            })),
            found: true,
        })
    }
}

/// SQLite (user imports) first, then the bundled ECDICT subset.
pub fn lookup_term_with_bundled(
    conn: &Connection,
    term: &str,
    bundled: Option<&BundledDictionary>,
) -> DbResult<DictionaryEntry> {
    let local = lookup_term(conn, term)?;
    if local.found {
        return Ok(local);
    }
    Ok(bundled.and_then(|b| b.get(term)).unwrap_or(local))
}
