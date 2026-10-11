//! M8 memory lifecycle application service (§23.16/§23.17): user feedback on a
//! memory and the stale-archive sweep. Both archive, never delete.

use ielts_domain::{MemoryFeedbackKind, MemoryFeedbackRecord, StaleArchiveReport};

use crate::ApplicationError;

/// Persistence port for the memory lifecycle.
pub trait ConsolidationStore {
    fn archive_stale(&self, now: &str) -> Result<StaleArchiveReport, ApplicationError>;
    fn record_memory_feedback(
        &self,
        memory_id: &str,
        kind: MemoryFeedbackKind,
        user_id: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<MemoryFeedbackRecord, ApplicationError>;
}

pub struct ConsolidationService<'a> {
    store: &'a dyn ConsolidationStore,
}

impl<'a> ConsolidationService<'a> {
    pub fn new(store: &'a dyn ConsolidationStore) -> Self {
        Self { store }
    }

    /// M8-08: stale archive sweep (per-kind policy; archive not delete).
    pub fn archive_stale(&self, now: &str) -> Result<StaleArchiveReport, ApplicationError> {
        self.store.archive_stale(now)
    }

    /// M8-09: record user feedback against a stable memory_id.
    pub fn record_memory_feedback(
        &self,
        memory_id: &str,
        kind: MemoryFeedbackKind,
        user_id: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<MemoryFeedbackRecord, ApplicationError> {
        self.store
            .record_memory_feedback(memory_id, kind, user_id, payload, now)
    }
}
