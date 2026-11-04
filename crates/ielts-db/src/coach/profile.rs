//! The learner profile a reading coach thread is tailored with.
//!
//! Selected once, on the thread's first coach run, and frozen on the thread row
//! (`coach_threads.learner_profile_json`). Every later turn replays the stored
//! bytes, so the prompt prefix stays identical even when memory changes.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::sqlite::{DbError, DbResult};

const PROFILE_USER_ID: &str = "local";

/// Per-list caps, then one total cap over the serialized snapshot.
pub const PROFILE_MAX_PREFERENCES: usize = 5;
pub const PROFILE_MAX_MEMORIES: usize = 8;
pub const PROFILE_MAX_WEAK_SKILLS: usize = 3;
pub const PROFILE_TOKEN_BUDGET: u32 = 800;
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
}

/// Pure selection from current store state (no writes).
pub fn select_learner_profile(conn: &Connection) -> DbResult<LearnerProfileSnapshot> {
    crate::system_context::build_coach_system_context(conn, PROFILE_USER_ID)
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
