//! The learner profile a coach thread is tailored with.
//!
//! Selected once, on the thread's first coach run, and frozen on the thread row
//! (`coach_threads.learner_profile_json`). Every later turn replays the stored
//! bytes, so the prompt prefix stays identical even when memory changes.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ielts_domain::Activity;

use crate::sqlite::{DbError, DbResult};

const PROFILE_USER_ID: &str = "local";

pub const PROFILE_MAX_TEACHING_NOTES: usize = 3;

/// Negative feedback kinds that become a standing teaching instruction, keyed
/// by their wire spelling. Verdicts and style corrections are not instructions.
static TEACHING_NOTE_MAP: [(&str, &str); 8] = [
    ("too_long", "Keep every answer under 120 words."),
    ("too_short", "Give the complete reasoning, not just the final answer."),
    ("too_abstract", "Start with one concrete passage example, then state the rule."),
    ("need_example", "Include one concrete example from the passage."),
    ("need_step_by_step", "Walk through the reasoning in numbered steps."),
    ("incorrect", "Re-check the official answer before explaining; never contradict it."),
    ("not_relevant", "Answer the exact question asked and omit unrelated context."),
    ("reask_same_question", "When the learner re-asks, explain differently instead of repeating."),
];

/// Per-list caps, then one total cap over the serialized snapshot.
pub const PROFILE_MAX_PREFERENCES: usize = 5;
pub const PROFILE_MAX_MEMORIES: usize = 8;
pub const PROFILE_MAX_WEAK_SKILLS: usize = 3;
pub const PROFILE_TOKEN_BUDGET: u32 = 800;
/// A skill is only claimed weak below this mastery...
pub const WEAK_SKILL_MASTERY_CEILING: f64 = 0.6;
/// ...and only with evidence from at least this many distinct articles.
pub const WEAK_SKILL_MIN_DISTINCT_ASSETS: i64 = 2;

/// The practice scene a profile is selected for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoachScene {
    pub activity: Activity,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerProfileSnapshot {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preferences: Vec<ProfileStatement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memories: Vec<ProfileStatement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weak_skills: Vec<WeakSkill>,
    /// Unconfirmed observations from recent days of teaching notes, ids
    /// `signal:<messageId>:<noteIndex>`. Absent from every profile frozen before
    /// this field existed, and from the bytes of any profile that has none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_signals: Vec<ProfileStatement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub teaching_notes: Vec<String>,
}

/// One preference, learned memory or recent signal. `id` is the memory id
/// (`mem-...`) for a memory item, `preference:<scope>:<key>` for an explicit
/// preference row, or `signal:<messageId>:<noteIndex>` for a recent signal.
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
    /// Empty means no profile data message is needed.
    pub fn is_empty(&self) -> bool {
        self.preferences.is_empty()
            && self.memories.is_empty()
            && self.weak_skills.is_empty()
            && self.recent_signals.is_empty()
            && self.teaching_notes.is_empty()
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

/// Select the validated profile for the bound practice activity.
pub fn select_learner_profile_for_scene(conn: &Connection, scene: &CoachScene) -> DbResult<LearnerProfileSnapshot> {
    crate::system_context::build_coach_system_context_for_activity(conn, PROFILE_USER_ID, scene.activity)
}

/// The thread's frozen profile, selected and stored on first use. The first
/// freeze also counts one recall for every memory item it carries, in the same
/// transaction. An empty profile is frozen too, so it stays empty.
pub fn freeze_coach_learner_profile_for_activity(
    conn: &Connection,
    thread_id: &str,
    activity: Activity,
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
        let mut profile: LearnerProfileSnapshot = serde_json::from_str(&raw)?;
        let legacy: serde_json::Value = serde_json::from_str(&raw)?;
        if let Some(lines) = legacy.get("soul").and_then(serde_json::Value::as_array) {
            for (index, line) in lines.iter().filter_map(serde_json::Value::as_str).enumerate() {
                if ielts_domain::is_safe_for_prompt(line) {
                    profile.preferences.push(ProfileStatement { id: format!("soul:legacy:{index}"), statement: line.to_owned() });
                }
            }
        }
        return Ok(profile);
    }
    let snapshot = select_learner_profile_for_scene(&tx, &CoachScene { activity })?;
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
            recent_signals: vec![statement("signal:m:0", "z")],
            ..Default::default()
        };
        assert_eq!(snapshot.memory_ids(), vec!["mem-p", "mem-a"]);
        assert!(LearnerProfileSnapshot::default().is_empty());
    }

    #[test]
    fn profile_json_without_soul_still_deserializes() {
        let old = r#"{"preferences":[{"id":"preference:global:tone","statement":"tone: brief"}],"memories":[],"weakSkills":[]}"#;
        let snapshot: LearnerProfileSnapshot = serde_json::from_str(old).unwrap();
        assert!(snapshot.recent_signals.is_empty());
        assert_eq!(snapshot.preferences.len(), 1);
        assert!(serde_json::from_str::<LearnerProfileSnapshot>("{}").unwrap().is_empty());
    }

    #[test]
    fn empty_snapshot_serializes_to_an_empty_object() {
        assert_eq!(serde_json::to_string(&LearnerProfileSnapshot::default()).unwrap(), "{}");
    }
}

pub(crate) fn teaching_note_lines(conn: &Connection) -> DbResult<Vec<String>> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    let mut statement = conn.prepare(
        "SELECT kind, COUNT(*) FROM (
           SELECT feedback_kind AS kind FROM coach_feedback
            WHERE user_id=?1 AND created_at>=?2
           UNION ALL
           SELECT 'reask_same_question' AS kind FROM coach_reask_links
            WHERE created_at>=?2
         )
         GROUP BY kind
         ORDER BY COUNT(*) DESC, kind ASC",
    )?;
    let rows = statement.query_map(params![PROFILE_USER_ID, cutoff], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (kind, _count) = row?;
        let Some((_, instruction)) = TEACHING_NOTE_MAP.iter().find(|(mapped, _)| *mapped == kind)
        else {
            continue;
        };
        out.push((*instruction).to_owned());
        if out.len() == PROFILE_MAX_TEACHING_NOTES {
            break;
        }
    }
    Ok(out)
}


pub fn select_learner_profile(conn: &Connection) -> DbResult<LearnerProfileSnapshot> {
    select_learner_profile_for_scene(conn, &CoachScene { activity: Activity::Reading })
}

pub fn freeze_coach_learner_profile(conn: &Connection, thread_id: &str) -> DbResult<LearnerProfileSnapshot> {
    freeze_coach_learner_profile_for_activity(conn, thread_id, Activity::Reading)
}
