//! The learner profile a coach thread is tailored with.
//!
//! Selected once, on the thread's first coach run, and frozen on the thread row
//! (`coach_threads.learner_profile_json`). Every later turn replays the stored
//! bytes, so the prompt prefix stays identical even when memory changes.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use ielts_domain::{estimate_tokens, is_safe_for_prompt, Activity, MemoryScope};

use crate::soul::soul_profile;
use crate::sqlite::{DbError, DbResult};

const PROFILE_USER_ID: &str = "local";
/// Soul settings shown to the coach, in prompt order.
const SOUL_LABELS: [(&str, &str); 5] = [
    ("soul.nickname", "nickname"),
    ("soul.address", "address"),
    ("soul.tone", "tone"),
    ("soul.targetBand", "target band"),
    ("soul.examDate", "exam date"),
];
pub const PROFILE_MAX_SOUL_LINES: usize = 6;
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
const PROFILE_MAX_GLOBAL_MEMORIES: usize = 2;
/// The rest of the total memory cap belongs to the scene's own scope.
const PROFILE_MAX_MODULE_MEMORIES: usize = PROFILE_MAX_MEMORIES - PROFILE_MAX_GLOBAL_MEMORIES;
pub const PROFILE_MAX_WEAK_SKILLS: usize = 3;
pub const PROFILE_TOKEN_BUDGET: u32 = 800;
/// A statement longer than this is skipped, never cut mid-sentence.
const MAX_STATEMENT_CHARS: usize = 300;
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
    /// Soul settings as labelled lines. Outside `fit()`: never changes which memories survive.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub soul: Vec<String>,
    /// Standing teaching instructions distilled from recent negative feedback.
    /// Outside `fit()` and rendered in the system prompt only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub teaching_notes: Vec<String>,
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
    /// Empty means no profile data message is needed. Soul settings and
    /// teaching notes live only in the system prompt, so they are excluded.
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

    /// Deterministic shrink to the budget. `memories` is `[module..., global...]`
    /// with `module_memories` leading scene-scoped entries; while over budget it
    /// drops, each from its tail: (a) module memories, (b) weak skills,
    /// (c) explicit preferences, (d) global memories last.
    fn fit(mut self, budget: u32, module_memories: usize) -> Self {
        let mut module = module_memories.min(self.memories.len());
        while self.tokens() > budget && self.shrink_one(&mut module) {}
        self
    }

    fn shrink_one(&mut self, module: &mut usize) -> bool {
        if *module > 0 {
            *module -= 1;
            self.memories.remove(*module);
            return true;
        }
        self.weak_skills.pop().is_some()
            || self.preferences.pop().is_some()
            || self.memories.pop().is_some()
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
pub fn select_learner_profile(
    conn: &Connection,
    scene: &CoachScene,
) -> DbResult<LearnerProfileSnapshot> {
    let scope = MemoryScope::Activity { key: scene.activity }.storage_key();
    let mut preferences = explicit_preference_rows(conn, scope)?;
    preferences.extend(memory_rows(conn, scope, true, PROFILE_MAX_PREFERENCES)?);
    preferences.truncate(PROFILE_MAX_PREFERENCES);
    let mut memories = memory_rows(conn, scope, false, PROFILE_MAX_MODULE_MEMORIES)?;
    let module_memories = memories.len();
    memories.extend(memory_rows(conn, MemoryScope::Global.storage_key(), false, PROFILE_MAX_GLOBAL_MEMORIES)?);
    let weak_skills = weak_skill_rows(conn, scene.activity)?;
    let mut snapshot = LearnerProfileSnapshot {
        preferences,
        memories,
        weak_skills,
        soul: Vec::new(),
        teaching_notes: Vec::new(),
    }
    .fit(PROFILE_TOKEN_BUDGET, module_memories);
    // Added after fit(): soul lines and teaching notes are separate small lists
    // and never shrink or evict memories.
    snapshot.soul = soul_lines(conn)?;
    snapshot.teaching_notes = teaching_note_lines(conn)?;
    Ok(snapshot)
}

/// The most frequent mapped negative-feedback kinds from the last 30 days, as
/// standing teaching instructions, most frequent first then by kind.
fn teaching_note_lines(conn: &Connection) -> DbResult<Vec<String>> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    let mut statement = conn.prepare(
        "SELECT feedback_kind, COUNT(*) FROM coach_feedback
         WHERE user_id=?1 AND created_at>=?2
         GROUP BY feedback_kind
         ORDER BY COUNT(*) DESC, feedback_kind ASC",
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

/// Soul settings that are set, as `label: value` lines that pass the prompt filter.
fn soul_lines(conn: &Connection) -> DbResult<Vec<String>> {
    let profile = soul_profile(conn, PROFILE_USER_ID)?;
    Ok(SOUL_LABELS
        .iter()
        .filter_map(|(key, label)| accept(format!("{label}: {}", soul_text(profile.get(*key)?)?)))
        .take(PROFILE_MAX_SOUL_LINES)
        .collect())
}

fn soul_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => number.as_f64().map(|band| format!("{band:.1}")),
        _ => None,
    }
}

fn explicit_preference_rows(conn: &Connection, scope: &str) -> DbResult<Vec<ProfileStatement>> {
    let mut statement = conn.prepare(
        "SELECT preference_key,scope,value_json FROM explicit_user_preferences
         WHERE user_id=?1 AND status='active' AND scope IN ('global',?2)
         ORDER BY preference_key,scope",
    )?;
    let rows = statement.query_map(params![PROFILE_USER_ID, scope], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (key, scope, raw) = row?;
        // These settings reach the coach as system-prompt soul lines; listing them
        // here too would repeat them and crowd real preferences out of the cap.
        if SOUL_LABELS.iter().any(|(soul_key, _)| *soul_key == key) {
            continue;
        }
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

/// Active, non-archived, normal-sensitivity memories in one scope. `explicit`
/// selects the user-stated ones (preferences) or the learned ones; at most
/// `limit` survive the prompt-safety filter.
fn memory_rows(
    conn: &Connection,
    scope: &str,
    explicit: bool,
    limit: usize,
) -> DbResult<Vec<ProfileStatement>> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut statement = conn.prepare(
        "SELECT id,content FROM memory_items
         WHERE user_id=?1 AND scope=?2 AND status='active' AND sensitivity='normal'
           AND (source_class='user_explicit')=?3
           AND (valid_to IS NULL OR valid_to>?4)
         ORDER BY importance DESC,confidence DESC,
                  COALESCE(last_observed_at,updated_at) DESC,id",
    )?;
    let rows = statement.query_map(params![PROFILE_USER_ID, scope, explicit, now], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, content) = row?;
        if let Some(statement) = accept(content) {
            out.push(ProfileStatement { id, statement });
            if out.len() == limit {
                break;
            }
        }
    }
    Ok(out)
}

/// The `skill_catalog.activity` spelling of an activity (`reading`, ...).
fn activity_name(activity: Activity) -> &'static str {
    MemoryScope::Activity { key: activity }.storage_key().trim_start_matches("activity:")
}

/// Lowest mastery first. No claim without evidence from enough articles.
fn weak_skill_rows(conn: &Connection, activity: Activity) -> DbResult<Vec<WeakSkill>> {
    let mut statement = conn.prepare(
        "SELECT s.skill_key,c.label,s.mastery_mean,s.distinct_asset_count
         FROM learner_skill_state s
         JOIN skill_catalog c ON c.skill_key=s.skill_key AND c.activity=?2 AND c.active=1
         WHERE s.user_id=?1 AND s.mastery_mean<?3 AND s.distinct_asset_count>=?4
         ORDER BY s.mastery_mean ASC,s.skill_key ASC",
    )?;
    let rows = statement.query_map(
        params![
            PROFILE_USER_ID,
            activity_name(activity),
            WEAK_SKILL_MASTERY_CEILING,
            WEAK_SKILL_MIN_DISTINCT_ASSETS
        ],
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
        return Ok(serde_json::from_str(&raw)?);
    }
    let snapshot = select_learner_profile(&tx, &CoachScene { activity })?;
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
            soul: vec![],
            teaching_notes: vec![],
        };
        let fitted = snapshot.clone().fit(PROFILE_TOKEN_BUDGET, 8);
        assert!(fitted.tokens() <= PROFILE_TOKEN_BUDGET);
        assert_eq!(fitted.preferences, snapshot.preferences, "preferences survive while memories remain");
        assert_eq!(fitted.memories[..], snapshot.memories[..fitted.memories.len()]);
        assert!(fitted.memories.len() < 8);
    }

    #[test]
    fn fit_drops_module_memories_then_skills_then_preferences_and_globals_last() {
        let long = "x".repeat(280);
        let skill = |i: usize| WeakSkill {
            skill_key: format!("reading.s{i}"),
            label: long.clone(),
            mastery: 0.2,
            distinct_articles: 2,
        };
        let base = LearnerProfileSnapshot {
            preferences: (0..2).map(|i| statement(&format!("preference:global:k{i}"), &long)).collect(),
            memories: (0..2)
                .map(|i| statement(&format!("mem-m{i}"), &long))
                .chain((0..2).map(|i| statement(&format!("mem-g{i}"), &long)))
                .collect(),
            weak_skills: (0..2).map(skill).collect(),
            soul: vec![],
            teaching_notes: vec![],
        };
        let globals = base.memories[2..].to_vec();
        let with = |memories: Vec<ProfileStatement>, weak: usize, preferences: usize| LearnerProfileSnapshot {
            preferences: base.preferences[..preferences].to_vec(),
            memories,
            weak_skills: base.weak_skills[..weak].to_vec(),
            soul: vec![],
            teaching_notes: vec![],
        };

        let fitted = base.clone().fit(with(base.memories[1..].to_vec(), 2, 2).tokens(), 2);
        assert_eq!(fitted.memories.len(), 3, "the tail module memory goes first");
        assert_eq!(fitted.memories[0], base.memories[0]);

        let fitted = base.clone().fit(with(globals.clone(), 2, 2).tokens(), 2);
        assert_eq!(fitted.memories, globals, "then the remaining module memories");
        assert_eq!(fitted.weak_skills, base.weak_skills);
        assert_eq!(fitted.preferences, base.preferences);

        let fitted = base.clone().fit(with(globals.clone(), 1, 2).tokens(), 2);
        assert_eq!(fitted.weak_skills, base.weak_skills[..1], "weak skills go before preferences");
        assert_eq!(fitted.preferences, base.preferences);
        assert_eq!(fitted.memories, globals);

        let fitted = base.clone().fit(with(globals.clone(), 0, 1).tokens(), 2);
        assert_eq!(fitted.preferences, base.preferences[..1], "preferences go before global memories");
        assert!(fitted.weak_skills.is_empty());
        assert_eq!(fitted.memories, globals);

        let fitted = base.clone().fit(with(globals.clone(), 0, 0).tokens(), 2);
        assert_eq!(fitted.memories, globals, "global memories survive until the end");
        assert!(fitted.preferences.is_empty() && fitted.weak_skills.is_empty());
    }

    #[test]
    fn memory_ids_name_only_memory_items() {
        let snapshot = LearnerProfileSnapshot {
            preferences: vec![statement("preference:global:tone", "tone: brief"), statement("mem-p", "x")],
            memories: vec![statement("mem-a", "y")],
            weak_skills: vec![],
            soul: vec![],
            teaching_notes: vec![],
        };
        assert_eq!(snapshot.memory_ids(), vec!["mem-p", "mem-a"]);
        assert!(LearnerProfileSnapshot::default().is_empty());
    }

    #[test]
    fn profile_json_without_soul_still_deserializes() {
        let old = r#"{"preferences":[{"id":"preference:global:tone","statement":"tone: brief"}],"memories":[],"weakSkills":[]}"#;
        let snapshot: LearnerProfileSnapshot = serde_json::from_str(old).unwrap();
        assert!(snapshot.soul.is_empty());
        assert_eq!(snapshot.preferences.len(), 1);
        assert!(serde_json::from_str::<LearnerProfileSnapshot>("{}").unwrap().is_empty());
    }

    #[test]
    fn empty_snapshot_serializes_to_an_empty_object() {
        assert_eq!(serde_json::to_string(&LearnerProfileSnapshot::default()).unwrap(), "{}");
    }
}
