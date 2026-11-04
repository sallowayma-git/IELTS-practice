//! From a memory back to the coach words it was learned from.
//!
//! A teaching note is the coach's reading of one exchange. When the weekly
//! consolidation (or the learner, on a preference card) turns notes into a
//! `preference` or `strategy` memory, the memory cites the `coach.question.asked`
//! observation of the learner message the coach answered (`weekly_pack` puts it on
//! the coach line, paired by the answer, not by what a note quotes). This read walks
//! the same lineage the other way, with no new table: memory evidence ->
//! observation -> coach message ids, so a memory can always answer "which exchange
//! said so?". Read-only; the lineage is the memory's own `memory_evidence` rows.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sqlite::DbResult;

/// One learner coach message a memory rests on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachMessageSource {
    /// The evidence observation the memory cites.
    pub observation_id: String,
    pub thread_id: String,
    /// The learner's own message: where the words came from.
    pub learner_message_id: String,
    /// The coach answer that recorded the teaching notes, when there is one.
    pub answer_message_id: Option<String>,
    pub attempt_id: Option<String>,
    /// The learner quotes an older answer's teaching notes recorded as `evidence`,
    /// kept only when they really occur in the learner message. Current notes carry
    /// no quote, so this is empty for them.
    pub quotes: Vec<String>,
}

/// The coach messages behind `memory_id`, oldest message first. Empty for a
/// memory with no coach evidence, for another user's memory, and for evidence
/// whose observation the projection no longer holds.
pub fn memory_coach_sources(conn: &Connection, user_id: &str, memory_id: &str) -> DbResult<Vec<CoachMessageSource>> {
    let mut statement = conn.prepare(
        "SELECT o.id, o.payload_json
           FROM memory_evidence e
           JOIN memory_items m ON m.id = e.memory_id
           JOIN learner_observations o ON o.id = e.observation_id
          WHERE e.memory_id = ?1 AND m.user_id = ?2 AND o.user_id = ?2
            AND o.observation_type = 'coach.question.asked'
          ORDER BY o.id",
    )?;
    let rows = statement.query_map(params![memory_id, user_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut sources = Vec::new();
    for row in rows {
        let (observation_id, payload) = row?;
        let payload: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
        let text = |key: &str| payload.get(key).and_then(Value::as_str).map(str::to_owned);
        let (Some(learner_message_id), Some(thread_id)) = (text("messageId"), text("threadId")) else { continue };
        sources.push(source(conn, observation_id, thread_id, learner_message_id, text("attemptId"))?);
    }
    sources.sort_by(|left, right| {
        (&left.thread_id, &left.learner_message_id).cmp(&(&right.thread_id, &right.learner_message_id))
    });
    Ok(sources)
}

fn source(
    conn: &Connection,
    observation_id: String,
    thread_id: String,
    learner_message_id: String,
    attempt_id: Option<String>,
) -> DbResult<CoachMessageSource> {
    let message: Option<(String, i64)> = conn
        .query_row(
            "SELECT content, sequence FROM coach_messages WHERE id = ?1 AND thread_id = ?2 AND role = 'user'",
            params![learner_message_id, thread_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let answer: Option<(String, Option<String>)> = match &message {
        Some((_, sequence)) => conn
            .query_row(
                "SELECT id, structured_payload FROM coach_messages
                  WHERE thread_id = ?1 AND role = 'assistant' AND status = 'completed' AND sequence > ?2
                  ORDER BY sequence LIMIT 1",
                params![thread_id, sequence],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?,
        None => None,
    };
    let content = message.map(|(content, _)| content.trim().to_owned()).unwrap_or_default();
    let quotes = answer
        .as_ref()
        .and_then(|(_, payload)| payload.as_deref())
        .and_then(|payload| serde_json::from_str::<Value>(payload).ok())
        .map(|payload| {
            let notes = payload["teachingNotes"].as_array().into_iter().flatten();
            let mut quotes: Vec<String> = notes
                .filter_map(|note| note["evidence"].as_str())
                .filter(|quote| !quote.is_empty() && content.contains(quote))
                .map(str::to_owned)
                .collect();
            quotes.dedup();
            quotes
        })
        .unwrap_or_default();
    Ok(CoachMessageSource {
        observation_id,
        thread_id,
        learner_message_id,
        answer_message_id: answer.map(|(id, _)| id),
        attempt_id,
        quotes,
    })
}
