//! M7-03 Daily Journal application use cases.
//!
//! Thin persistence-backed service that builds the deterministic `JournalFacts`
//! (§23.14), inserts versioned journal rows, and supersedes prior versions on
//! same-day rerun (M7-05). The service owns the use-case boundary; the Tauri
//! adapter only supplies the persistence port and maps the result to an IPC
//! envelope. The LLM never changes numeric facts (M7-04).

use ielts_domain::{DailyJournal, DailyJournalQuery, JournalFacts};

use crate::ApplicationError;

/// Persistence port for the M7 Daily Journal projection.
pub trait JournalStore {
    /// Build the deterministic `JournalFacts` for a given day (§23.14) from
    /// up-to-date derived projections.
    fn build_facts(&self, query: &DailyJournalQuery) -> Result<JournalFacts, ApplicationError>;

    /// Insert a new journal row and supersede the previous published journal
    /// for the same day (M7-05).
    fn insert_journal(
        &self,
        facts: &JournalFacts,
        rendered_markdown: Option<&str>,
    ) -> Result<DailyJournal, ApplicationError>;

    /// Load the latest (highest version) journal for a given day.
    fn load_latest_journal(
        &self,
        query: &DailyJournalQuery,
    ) -> Result<Option<DailyJournal>, ApplicationError>;

    /// Every stored version of a day's journal, newest first.
    fn list_journal_versions(
        &self,
        query: &DailyJournalQuery,
    ) -> Result<Vec<DailyJournal>, ApplicationError>;
}

pub struct JournalService<'a> {
    store: &'a dyn JournalStore,
}

impl<'a> JournalService<'a> {
    pub fn new(store: &'a dyn JournalStore) -> Self {
        Self { store }
    }

    /// M7-03: build the deterministic facts for a day (no LLM).
    pub fn build_facts(&self, query: &DailyJournalQuery) -> Result<JournalFacts, ApplicationError> {
        self.store.build_facts(query)
    }

    /// M7-05: insert a new versioned journal row and supersede the previous
    /// published journal for the same day. `rendered_markdown` is an export
    /// view; the canonical record is the `facts_json` column.
    pub fn insert_journal(
        &self,
        facts: &JournalFacts,
        rendered_markdown: Option<&str>,
    ) -> Result<DailyJournal, ApplicationError> {
        self.store.insert_journal(facts, rendered_markdown)
    }

    /// Load the latest journal for a given day.
    pub fn load_latest_journal(
        &self,
        query: &DailyJournalQuery,
    ) -> Result<Option<DailyJournal>, ApplicationError> {
        self.store.load_latest_journal(query)
    }

    /// The day's current journal: build fresh facts, reuse the latest version
    /// when its `source_hash` matches, otherwise insert a new version. The one
    /// path every reader (command, worker, weekly anchor) goes through, so a
    /// stored journal can never outlive the practice it summarises.
    pub fn ensure_journal(&self, query: &DailyJournalQuery) -> Result<DailyJournal, ApplicationError> {
        let facts = self.store.build_facts(query)?;
        match self.store.load_latest_journal(query)? {
            Some(journal) if journal.source_hash == facts.source_hash => Ok(journal),
            _ => self.store.insert_journal(&facts, None),
        }
    }

    /// Every stored version of a day's journal, newest first.
    pub fn list_journal_versions(
        &self,
        query: &DailyJournalQuery,
    ) -> Result<Vec<DailyJournal>, ApplicationError> {
        self.store.list_journal_versions(query)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use ielts_domain::{DailyJournal, DailyJournalStatus, DailyJournalQuery, JournalFacts};

    use super::*;

    #[derive(Default)]
    struct FakeStore {
        facts: Mutex<Option<JournalFacts>>,
        journals: Mutex<Vec<DailyJournal>>,
    }

    impl JournalStore for FakeStore {
        fn build_facts(&self, query: &DailyJournalQuery) -> Result<JournalFacts, ApplicationError> {
            let facts = self.facts.lock().unwrap();
            Ok(facts
                .clone()
                .unwrap_or_else(|| JournalFacts {
                    journal_date: query.journal_date.clone(),
                    attempts_count: 0,
                    writing_eval_summary: Default::default(),
                    skill_deltas: Vec::new(),
                    memory_changes: Default::default(),
                    coach_feedback_count: 0,
                    coach_reask_count: 0,
                    time_spent_ms: 0,
                    source_hash: "fake-hash".into(),
                    today_observation_ids: Vec::new(),
                    memory_events: Vec::new(),
                }))
        }

        fn insert_journal(
            &self,
            facts: &JournalFacts,
            rendered_markdown: Option<&str>,
        ) -> Result<DailyJournal, ApplicationError> {
            let mut journals = self.journals.lock().unwrap();
            let version = journals.len() as u32 + 1;
            let journal = DailyJournal {
                id: format!("djnl-fake-{}", version),
                user_id: "local".into(),
                journal_date: facts.journal_date.clone(),
                version,
                status: DailyJournalStatus::Published,
                facts: facts.clone(),
                source_hash: facts.source_hash.clone(),
                rendered_markdown: rendered_markdown.map(str::to_owned),
                superseded_by: None,
                created_at: "2026-08-16T00:00:00Z".into(),
                updated_at: "2026-08-16T00:00:00Z".into(),
            };
            journals.push(journal.clone());
            Ok(journal)
        }

        fn load_latest_journal(
            &self,
            _query: &DailyJournalQuery,
        ) -> Result<Option<DailyJournal>, ApplicationError> {
            Ok(self.journals.lock().unwrap().last().cloned())
        }

        fn list_journal_versions(
            &self,
            _query: &DailyJournalQuery,
        ) -> Result<Vec<DailyJournal>, ApplicationError> {
            Ok(self.journals.lock().unwrap().iter().rev().cloned().collect())
        }
    }

    fn facts_with_hash(hash: &str) -> JournalFacts {
        JournalFacts {
            journal_date: "2026-08-16".into(),
            attempts_count: 0,
            writing_eval_summary: Default::default(),
            skill_deltas: Vec::new(),
            memory_changes: Default::default(),
            coach_feedback_count: 0,
            coach_reask_count: 0,
            time_spent_ms: 0,
            source_hash: hash.into(),
            today_observation_ids: Vec::new(),
            memory_events: Vec::new(),
        }
    }

    #[test]
    fn ensure_journal_reuses_a_fresh_version_and_replaces_a_stale_one() {
        let store = FakeStore::default();
        let service = JournalService::new(&store);
        let query = DailyJournalQuery {
            user_id: "local".into(),
            journal_date: "2026-08-16".into(),
        };
        *store.facts.lock().unwrap() = Some(facts_with_hash("before-practice"));
        let first = service.ensure_journal(&query).unwrap();
        assert_eq!(service.ensure_journal(&query).unwrap().id, first.id);

        // New practice changes the facts: the stored journal is stale and a
        // read must not return it.
        *store.facts.lock().unwrap() = Some(facts_with_hash("after-practice"));
        let second = service.ensure_journal(&query).unwrap();
        assert_ne!(second.id, first.id);
        assert_eq!(second.version, 2);
        assert_eq!(second.source_hash, "after-practice");
        let versions = service.list_journal_versions(&query).unwrap();
        assert_eq!(
            versions.iter().map(|j| j.version).collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    #[test]
    fn delegates_build_facts_to_store() {
        let store = FakeStore::default();
        let service = JournalService::new(&store);
        let facts = service
            .build_facts(&DailyJournalQuery {
                user_id: "local".into(),
                journal_date: "2026-08-16".into(),
            })
            .unwrap();
        assert_eq!(facts.journal_date, "2026-08-16");
    }

    #[test]
    fn insert_journal_returns_versioned_row() {
        let store = FakeStore::default();
        let service = JournalService::new(&store);
        let facts = JournalFacts {
            journal_date: "2026-08-16".into(),
            attempts_count: 3,
            writing_eval_summary: Default::default(),
            skill_deltas: Vec::new(),
            memory_changes: Default::default(),
            coach_feedback_count: 0,
            coach_reask_count: 0,
            time_spent_ms: 0,
            source_hash: "hash-1".into(),
            today_observation_ids: Vec::new(),
            memory_events: Vec::new(),
        };
        let journal = service.insert_journal(&facts, Some("# Markdown")).unwrap();
        assert_eq!(journal.version, 1);
        assert_eq!(journal.facts.attempts_count, 3);
        let latest = service
            .load_latest_journal(&DailyJournalQuery {
                user_id: "local".into(),
                journal_date: "2026-08-16".into(),
            })
            .unwrap();
        assert!(latest.is_some());
        assert_eq!(latest.unwrap().version, 1);
    }
}
