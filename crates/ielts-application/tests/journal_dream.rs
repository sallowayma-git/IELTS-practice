//! JournalService + DreamService integration tests: build_facts delegation and
//! fail-closed dream runs (a failed run does not block the journal).

use std::sync::Mutex;

use ielts_domain::{DailyDreamQuery, DreamRun, DreamRunStatus, JournalFacts};

use ielts_application::{ApplicationError, DreamService, DreamStore, JournalService, JournalStore};

// ---- JournalStore fake ----

#[derive(Default)]
struct FakeJournalStore {
    facts: Mutex<Option<JournalFacts>>,
}

impl JournalStore for FakeJournalStore {
    fn build_facts(
        &self,
        query: &ielts_domain::DailyJournalQuery,
    ) -> Result<JournalFacts, ApplicationError> {
        Ok(self.facts.lock().unwrap().clone().unwrap_or_else(|| JournalFacts {
            journal_date: query.journal_date.clone(),
            attempts_count: 5,
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
        _facts: &JournalFacts,
        _rendered_markdown: Option<&str>,
    ) -> Result<ielts_domain::DailyJournal, ApplicationError> {
        unreachable!("not used in these tests")
    }

    fn load_latest_journal(
        &self,
        _query: &ielts_domain::DailyJournalQuery,
    ) -> Result<Option<ielts_domain::DailyJournal>, ApplicationError> {
        unreachable!("not used in these tests")
    }

    fn list_journal_versions(
        &self,
        _query: &ielts_domain::DailyJournalQuery,
    ) -> Result<Vec<ielts_domain::DailyJournal>, ApplicationError> {
        unreachable!("not used in these tests")
    }
}

// ---- DreamStore fake ----

#[derive(Default)]
struct FakeDreamStore {
    runs: Mutex<Vec<DreamRun>>,
}

impl FakeDreamStore {
    fn update(&self, run_id: &str, change: impl FnOnce(&mut DreamRun)) -> DreamRun {
        let mut runs = self.runs.lock().unwrap();
        let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
        change(run);
        run.clone()
    }
}

impl DreamStore for FakeDreamStore {
    fn insert_dream_run(
        &self,
        query: &DailyDreamQuery,
        input_hash: Option<&str>,
    ) -> Result<DreamRun, ApplicationError> {
        let run = DreamRun {
            id: format!("drmrun-{}", self.runs.lock().unwrap().len()),
            user_id: query.user_id.clone(),
            journal_id: query.journal_id.clone(),
            status: DreamRunStatus::Queued,
            input_hash: input_hash.map(str::to_owned),
            output_hash: None,
            started_at: None,
            finished_at: None,
            error: None,
            attempts: 0,
            created_at: "2026-08-16T00:00:00Z".into(),
            updated_at: "2026-08-16T00:00:00Z".into(),
        };
        self.runs.lock().unwrap().push(run.clone());
        Ok(run)
    }

    fn start_dream_run(&self, run_id: &str, _now: &str) -> Result<DreamRun, ApplicationError> {
        Ok(self.update(run_id, |run| run.status = DreamRunStatus::Running))
    }

    fn finish_dream_run(
        &self,
        run_id: &str,
        output_hash: &str,
        _now: &str,
    ) -> Result<DreamRun, ApplicationError> {
        Ok(self.update(run_id, |run| {
            run.status = DreamRunStatus::Completed;
            run.output_hash = Some(output_hash.into());
        }))
    }

    fn fail_dream_run(
        &self,
        run_id: &str,
        error: &serde_json::Value,
        _now: &str,
    ) -> Result<DreamRun, ApplicationError> {
        Ok(self.update(run_id, |run| {
            run.status = DreamRunStatus::Failed;
            run.error = Some(error.clone());
        }))
    }
}

// ---- Tests ----

#[test]
fn journal_service_delegates_build_facts_to_store() {
    let store = FakeJournalStore::default();
    let service = JournalService::new(&store);
    let query = ielts_domain::DailyJournalQuery {
        user_id: "local".into(),
        journal_date: "2026-08-16".into(),
    };
    let facts = service.build_facts(&query).unwrap();
    assert_eq!(facts.journal_date, "2026-08-16");
    assert_eq!(facts.attempts_count, 5);
}

#[test]
fn a_failed_weekly_run_does_not_block_the_deterministic_journal() {
    // The journal is deterministic and always buildable; the weekly run is
    // fail-closed, so a failure is only recorded on the run row.
    let journal_store = FakeJournalStore::default();
    let journal_service = JournalService::new(&journal_store);
    let dream_store = FakeDreamStore::default();
    let dream_service = DreamService::new(&dream_store);

    let facts = journal_service
        .build_facts(&ielts_domain::DailyJournalQuery {
            user_id: "local".into(),
            journal_date: "2026-08-16".into(),
        })
        .unwrap();
    assert_eq!(facts.journal_date, "2026-08-16");

    let run = dream_service
        .insert_dream_run(
            &DailyDreamQuery { user_id: "local".into(), journal_id: "djnl-1".into() },
            Some("weekly:2026-W33"),
        )
        .unwrap();
    dream_service.start_dream_run(&run.id, "now").unwrap();
    let failed = dream_service
        .fail_run(&run.id, &serde_json::json!({"error": "llm timeout"}), "now")
        .unwrap();
    assert_eq!(failed.status, DreamRunStatus::Failed);
    assert!(failed.error.is_some());
}
