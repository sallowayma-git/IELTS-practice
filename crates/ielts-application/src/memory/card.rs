//! Preference cards: the coach offers to remember a note, the learner decides.
//!
//! Confirming writes one `user_explicit` `preference` memory through
//! [`MemoryService::create_learner_memory`] (the one validator, the one promotion,
//! the one capacity rule) and records the decision in the coach message's payload.
//! Dismissing only records the decision. Neither adds a table: the card and its
//! decision live in the assistant message's own payload (`memoryCard`,
//! `memoryCardState`), which keeps the note, the card and the learner's answer in one
//! row that the backup and history deletion already cover.
//!
//! Confirming is idempotent per (message, note): the memory's identity is derived
//! from the pair, so a repeat (or a retry after a crash between the memory and the
//! decision) finds the memory that is already there and only records the decision.

use ielts_db::{memory_card_key, MemoryCardSource, CARD_CONFIRMED, CARD_DISMISSED};
use ielts_domain::{is_safe_for_prompt, Activity, MemoryNamespace, MemoryScope};
use sha2::{Digest, Sha256};

use crate::ApplicationError;

use super::{CreateLearnerMemoryCommand, MemoryService, MemoryStore};

/// Longest card text the learner may confirm, in characters: the length the coach
/// is held to for a note, so editing a card never needs more room than writing it.
pub const MEMORY_CARD_TEXT_CHARS: usize = 300;

pub trait MemoryCardStore {
    /// The card under a note of an assistant message, if there is one.
    fn card_source(
        &self,
        user_id: &str,
        message_id: &str,
        note_index: usize,
    ) -> Result<Option<MemoryCardSource>, ApplicationError>;

    /// The learner's active memory for this card key, if confirmed before.
    fn active_card_memory(&self, user_id: &str, canonical_key: &str) -> Result<Option<String>, ApplicationError>;

    /// Write `memoryCardState` (`confirmed` | `dismissed`) into the message payload.
    fn record_card_state(&self, message_id: &str, state: &str) -> Result<(), ApplicationError>;
}

pub struct MemoryCardService<'a> {
    memory: &'a dyn MemoryStore,
    cards: &'a dyn MemoryCardStore,
}

impl<'a> MemoryCardService<'a> {
    pub fn new(memory: &'a dyn MemoryStore, cards: &'a dyn MemoryCardStore) -> Self {
        Self { memory, cards }
    }

    /// Remember the card as the learner wrote it. Returns the memory's id.
    pub fn confirm(&self, user_id: &str, message_id: &str, note_index: usize, text: &str) -> Result<String, ApplicationError> {
        let text = card_text(text)?;
        let card = self.card(user_id, message_id, note_index)?;
        let key = memory_card_key(message_id, note_index);
        let memory_id = match self.cards.active_card_memory(user_id, &key)? {
            Some(existing) => existing,
            None => self.create(user_id, message_id, note_index, &key, &text, card)?,
        };
        self.cards.record_card_state(message_id, CARD_CONFIRMED)?;
        Ok(memory_id)
    }

    /// Decline the card. A confirmed card is a memory now: it is governed in the
    /// memory center, not taken back here.
    pub fn dismiss(&self, user_id: &str, message_id: &str, note_index: usize) -> Result<(), ApplicationError> {
        let card = self.card(user_id, message_id, note_index)?;
        if card.state.as_deref() == Some(CARD_CONFIRMED) {
            return Err(ApplicationError::new(
                "memory_card.already_confirmed",
                "这条偏好已经记住了。要改动它，请到记忆中心操作。",
                false,
            ));
        }
        self.cards.record_card_state(message_id, CARD_DISMISSED)
    }

    fn card(&self, user_id: &str, message_id: &str, note_index: usize) -> Result<MemoryCardSource, ApplicationError> {
        self.cards.card_source(user_id, message_id, note_index)?.ok_or_else(|| {
            ApplicationError::new("memory_card.not_found", "找不到这张偏好卡片，它可能已被删除。", false)
        })
    }

    fn create(
        &self,
        user_id: &str,
        message_id: &str,
        note_index: usize,
        key: &str,
        text: &str,
        card: MemoryCardSource,
    ) -> Result<String, ApplicationError> {
        let evidence = card.evidence_observation_id.ok_or_else(|| {
            ApplicationError::new(
                "memory_card.no_source",
                "找不到这张卡片对应的提问记录，暂时不能保存。",
                false,
            )
        })?;
        let created = MemoryService::new(self.memory)
            .create_learner_memory(&CreateLearnerMemoryCommand {
                // The text is part of the key: after a refusal, the learner may edit it and try again.
                request_id: format!("coach-card:{message_id}:{note_index}:{}", text_hash(text)),
                user_id: user_id.to_owned(),
                namespace: MemoryNamespace::Preference,
                canonical_key: key.to_owned(),
                scope: MemoryScope::Activity { key: Activity::Reading },
                statement: text.to_owned(),
                evidence_observation_ids: vec![evidence],
                actor_id: "coach_memory_card".into(),
                reason: "learner confirmed a coach preference card".into(),
            })
            .map_err(card_error)?;
        created.memory_id.ok_or_else(|| {
            ApplicationError::new("memory_card.rejected", "这条偏好没有保存成功，请稍后再试。", true)
        })
    }
}

/// The text the learner confirmed: trimmed, non-empty, bounded, and fit for a prompt.
fn card_text(text: &str) -> Result<String, ApplicationError> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let refuse = |message: &str| Err(ApplicationError::new("memory_card.invalid_text", message, false));
    if text.is_empty() {
        return refuse("请先写下要记住的偏好。");
    }
    if text.chars().count() > MEMORY_CARD_TEXT_CHARS {
        return refuse("这条偏好太长了，请控制在 300 个字以内。");
    }
    if !is_safe_for_prompt(&text) {
        return refuse("这句话里有不能交给教练的内容（像指令、密钥或健康、性格类判断），不能保存。请换一种说法。");
    }
    Ok(text)
}

fn text_hash(text: &str) -> String {
    Sha256::digest(text.as_bytes())[..6].iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A refusal of the validator becomes the card's own code; anything else is passed through.
fn card_error(error: ApplicationError) -> ApplicationError {
    match error.code.as_str() {
        "memory.rejected" | "memory.quarantined" | "memory.duplicate" => ApplicationError::new(
            "memory_card.rejected",
            format!("这条偏好不能保存：{}", error.message),
            false,
        ),
        _ => error,
    }
}
