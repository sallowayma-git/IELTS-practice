//! The learner profile a reading coach thread is tailored with.
//!
//! Selected once, on the thread's first coach run, and frozen on the thread row
//! (`coach_threads.learner_profile_json`). Every later turn replays the stored
//! bytes, so the prompt prefix stays identical even when memory changes.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use ielts_domain::{estimate_tokens, is_safe_for_prompt};

use crate::sqlite::{DbError, DbResult};

const PROFILE_USER_ID: &str = "local";
const READING_SCOPE: &str = "activity:reading";

/// Per-list caps, then one total cap over the serialized snapshot.
pub const PROFILE_MAX_PREFERENCES: usize = 5;
pub const PROFILE_MAX_MEMORIES: usize = 8;
pub const PROFILE_MAX_WEAK_SKILLS: usize = 3;
pub const PROFILE_TOKEN_BUDGET: u32 = 800;
/// A statement longer than this is skipped, never cut mid-sentence.
const MAX_STATEMENT_CHARS: usize = 300;
/// A skill is only claimed weak below this mastery...
pub const WEAK_SKILL_MASTERY_CEILING: f64 = 0.6;
/// ...and only with evidence from at least this many distinct articles.
pub const WEAK_SKILL_MIN_DISTINCT_ASSETS: i64 = 2;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerProfileSnapshot {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preferences: Vec<ProfileStatement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memories: Vec<ProfileStatement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weak_skills: Vec<WeakSkill>,
}

/// One preference or learned memory. `id` is the memory id (`mem-...`) for a
/// memory item, or `preference:<scope>:<key>` for an explicit preference row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatement {
    pub id: String,
    pub statement: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeakSkill {
    pub skill_key: String,
    pub label: String,
    /// Mastery mean rounded to two decimals.
    pub mastery: f64,
    pub distinct_articles: u32,
}

impl LearnerProfileSnapshot {
    pub fn is_empty(&self) -> bool {
        self.preferences.is_empty() && self.memories.is_empty() && self.weak_skills.is_empty()
    }

    /// Memory item ids present in the snapshot, in prompt order.
    pub fn memory_ids(&self) -> Vec<String> {
        self.preferences
            .iter()
            .chain(&self.memories)
            .map(|entry| entry.id.clone())
            .filter(|id| id.starts_with("mem-"))
            .collect()
    }

    fn tokens(&self) -> u32 {
        estimate_tokens(&serde_json::to_string(self).unwrap_or_default())
    }

    /// Deterministic shrink to the budget: learned memories go first, then
    /// weak skills, then explicit preferences — each from its tail.
    fn fit(mut self, budget: u32) -> Self {
        while self.tokens() > budget {
            if self.memories.pop().is_none()
                && self.weak_skills.pop().is_none()
                && self.preferences.pop().is_none()
            {
                break;
            }
        }
        self
    }
}

fn accept(statement: String) -> Option<String> {
    let statement = statement.trim().to_owned();
    (!statement.is_empty()
        && statement.chars().count() <= MAX_STATEMENT_CHARS
        && is_safe_for_prompt(&statement))
    .then_some(statement)
}

/// Pure selection from current store state (no writes).
pub fn select_learner_profile(conn: &Connection) -> DbResult<LearnerProfileSnapshot> {
    let mut preferences = explicit_preference_rows(conn)?;
    preferences.extend(memory_rows(conn, true)?);
    preferences.truncate(PROFILE_MAX_PREFERENCES);
    let mut memories = memory_rows(conn, false)?;
    memories.truncate(PROFILE_MAX_MEMORIES);
    let weak_skills = weak_skill_rows(conn)?;
    Ok(LearnerProfileSnapshot { preferences, memories, weak_skills }.fit(PROFILE_TOKEN_BUDGET))
}

fn explicit_preference_rows(conn: &Connection) -> DbResult<Vec<ProfileStatement>> {
    let mut statement = conn.prepare(
        "SELECT preference_key,scope,value_json FROM explicit_user_preferences
         WHERE user_id=?1 AND status='active' AND scope IN ('global',?2)
         ORDER BY preference_key,scope",
    )?;
    let rows = statement.query_map(params![PROFILE_USER_ID, READING_SCOPE], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (key, scope, raw) = row?;
        let value: Value = serde_json::from_str(&raw)?;
        let rendered = match value {
            Value::String(text) => text,
            other => other.to_string(),
        };
        if let Some(statement) = accept(format!("{key}: {rendered}")) {
            out.push(ProfileStatement { id: format!("preference:{scope}:{key}"), statement });
        }
    }
    Ok(out)
}

/// Active, non-archived, normal-sensitivity reading memories. `explicit`
/// selects the user-stated ones (preferences) or the learned ones.
fn memory_rows(conn: &Connection, explicit: bool) -> DbResult<Vec<ProfileStatement>> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut statement = conn.prepare(
        "SELECT id,content FROM memory_items
         WHERE user_id=?1 AND scope=?2 AND status='active' AND sensitivity='normal'
           AND (source_class='user_explicit')=?3
           AND (valid_to IS NULL OR valid_to>?4)
         ORDER BY importance DESC,confidence DESC,
                  COALESCE(last_observed_at,updated_at) DESC,id",
    )?;
    let rows = statement.query_map(params![PROFILE_USER_ID, READING_SCOPE, explicit, now], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, content) = row?;
        if let Some(statement) = accept(content) {
            out.push(ProfileStatement { id, statement });
        }
    }
    Ok(out)
}

/// Lowest mastery first. No claim without evidence from enough articles.
fn weak_skill_rows(conn: &Connection) -> DbResult<Vec<WeakSkill>> {
    let mut statement = conn.prepare(
        "SELECT s.skill_key,c.label,s.mastery_mean,s.distinct_asset_count
         FROM learner_skill_state s
         JOIN skill_catalog c ON c.skill_key=s.skill_key AND c.activity='reading' AND c.active=1
         WHERE s.user_id=?1 AND s.mastery_mean<?2 AND s.distinct_asset_count>=?3
         ORDER BY s.mastery_mean ASC,s.skill_key ASC",
    )?;
    let rows = statement.query_map(
        params![PROFILE_USER_ID, WEAK_SKILL_MASTERY_CEILING, WEAK_SKILL_MIN_DISTINCT_ASSETS],
        |row| {
            Ok(WeakSkill {
                skill_key: row.get(0)?,
                label: row.get(1)?,
                mastery: (row.get::<_, f64>(2)? * 100.0).round() / 100.0,
                distinct_articles: row.get::<_, i64>(3)?.max(0) as u32,
            })
        },
    )?;
    let mut out = Vec::new();
    for row in rows {
        let skill = row?;
        if is_safe_for_prompt(&skill.label) {
            out.push(skill);
        }
        if out.len() == PROFILE_MAX_WEAK_SKILLS {
            break;
        }
    }
    Ok(out)
}

/// The thread's frozen profile, selected and stored on first use. The first
/// freeze also counts one recall for every memory item it carries, in the same
/// transaction. An empty profile is frozen too, so it stays empty.
pub fn freeze_coach_learner_profile(
    conn: &Connection,
    thread_id: &str,
) -> DbResult<LearnerProfileSnapshot> {
    let tx = conn.unchecked_transaction()?;
    let stored: Option<Option<String>> = tx
        .query_row(
            "SELECT learner_profile_json FROM coach_threads WHERE id=?1",
            [thread_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(stored) = stored else {
        return Err(DbError::Message(format!("coach thread not found: {thread_id}")));
    };
    if let Some(raw) = stored {
        return Ok(serde_json::from_str(&raw)?);
    }
    let snapshot = select_learner_profile(&tx)?;
    tx.execute(
        "UPDATE coach_threads SET learner_profile_json=?1 WHERE id=?2 AND learner_profile_json IS NULL",
        params![serde_json::to_string(&snapshot)?, thread_id],
    )?;
    let now = chrono::Utc::now().to_rfc3339();
    for id in snapshot.memory_ids() {
        tx.execute(
            "UPDATE memory_items SET recall_count=recall_count+1,last_recalled_at=?1 WHERE id=?2",
            params![now, id],
        )?;
    }
    tx.commit()?;
    Ok(snapshot)
}

/// Memory ids of a thread's frozen profile (empty before the first freeze).
pub fn frozen_profile_memory_ids(conn: &Connection, thread_id: &str) -> DbResult<Vec<String>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT learner_profile_json FROM coach_threads WHERE id=?1",
            [thread_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    match raw {
        Some(raw) => Ok(serde_json::from_str::<LearnerProfileSnapshot>(&raw)?.memory_ids()),
        None => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn statement(id: &str, text: &str) -> ProfileStatement {
        ProfileStatement { id: id.into(), statement: text.into() }
    }

    #[test]
    fn fit_drops_memories_then_skills_then_preferences_from_the_tail() {
        let long = "x".repeat(280);
        let snapshot = LearnerProfileSnapshot {
            preferences: (0..5).map(|i| statement(&format!("preference:global:k{i}"), &long)).collect(),
            memories: (0..8).map(|i| statement(&format!("mem-{i}"), &long)).collect(),
            weak_skills: vec![],
        };
        let fitted = snapshot.clone().fit(PROFILE_TOKEN_BUDGET);
        assert!(fitted.tokens() <= PROFILE_TOKEN_BUDGET);
        assert_eq!(fitted.preferences, snapshot.preferences, "preferences survive while memories remain");
        assert_eq!(fitted.memories[..], snapshot.memories[..fitted.memories.len()]);
        assert!(fitted.memories.len() < 8);
    }

    #[test]
    fn memory_ids_name_only_memory_items() {
        let snapshot = LearnerProfileSnapshot {
            preferences: vec![statement("preference:global:tone", "tone: brief"), statement("mem-p", "x")],
            memories: vec![statement("mem-a", "y")],
            weak_skills: vec![],
        };
        assert_eq!(snapshot.memory_ids(), vec!["mem-p", "mem-a"]);
        assert!(LearnerProfileSnapshot::default().is_empty());
    }

    #[test]
    fn empty_snapshot_serializes_to_an_empty_object() {
        assert_eq!(serde_json::to_string(&LearnerProfileSnapshot::default()).unwrap(), "{}");
    }
}
