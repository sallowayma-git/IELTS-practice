//! M7-03/M7-07 JournalService + DreamService integration tests: build_facts
//! delegation, dream capacity bounded, fail-closed (dream failed does not
//! block journal), no active-memory write bypass (dream only produces pending
//! candidates).

use std::sync::Mutex;

use ielts_domain::{
    DailyDreamQuery, DailyDreamResult, DreamCandidate, DreamCandidateDisposition, DreamProposal,
    DreamProposalKind, DreamRun, DreamRunStatus, JournalFacts, MAX_OUTPUT_CANDIDATES,
};

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
}

// ---- DreamStore fake ----

#[derive(Default)]
struct FakeDreamStore {
    runs: Mutex<Vec<DreamRun>>,
    candidates: Mutex<Vec<DreamCandidate>>,
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

    fn insert_dream_candidate(
        &self,
        run_id: &str,
        proposal: &DreamProposal,
    ) -> Result<DreamCandidate, ApplicationError> {
        let candidate = DreamCandidate {
            id: format!("dcand-{}", self.candidates.lock().unwrap().len()),
            run_id: run_id.into(),
            kind: proposal.kind,
            target_memory_id: proposal.target_memory_id.clone(),
            evidence_observation_ids: proposal.evidence_observation_ids.clone(),
            disposition: DreamCandidateDisposition::Pending,
            created_at: "2026-08-16T00:00:00Z".into(),
            proposal: proposal.clone(),
        };
        self.candidates.lock().unwrap().push(candidate.clone());
        Ok(candidate)
    }

    fn start_dream_run(&self, run_id: &str, _now: &str) -> Result<DreamRun, ApplicationError> {
        let mut runs = self.runs.lock().unwrap();
        let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
        run.status = DreamRunStatus::Running;
        run.attempts += 1;
        Ok(run.clone())
    }

    fn finish_dream_run(
        &self,
        run_id: &str,
        output_hash: &str,
        _now: &str,
    ) -> Result<DreamRun, ApplicationError> {
        let mut runs = self.runs.lock().unwrap();
        let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
        run.status = DreamRunStatus::Completed;
        run.output_hash = Some(output_hash.into());
        Ok(run.clone())
    }

    fn fail_dream_run(
        &self,
        run_id: &str,
        error: &serde_json::Value,
        _now: &str,
    ) -> Result<DreamRun, ApplicationError> {
        let mut runs = self.runs.lock().unwrap();
        let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
        run.status = DreamRunStatus::Failed;
        run.error = Some(error.clone());
        Ok(run.clone())
    }

    fn load_daily_dream_result(
        &self,
        run_id: &str,
    ) -> Result<Option<DailyDreamResult>, ApplicationError> {
        let runs = self.runs.lock().unwrap();
        let run = runs.iter().find(|r| r.id == run_id).cloned();
        if run.is_none() {
            return Ok(None);
        }
        let candidates = self
            .candidates
            .lock()
            .unwrap()
            .iter()
            .filter(|c| c.run_id == run_id)
            .cloned()
            .collect();
        Ok(Some(DailyDreamResult {
            run: run.unwrap(),
            candidates,
        }))
    }
}

fn proposal(kind: DreamProposalKind) -> DreamProposal {
    DreamProposal {
        kind,
        target_memory_id: Some("mem-1".into()),
        evidence_observation_ids: vec!["obs-1".into()],
        proposed_statement: "test statement".into(),
        proposal_json: serde_json::json!({"kind": kind.as_str()}),
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
fn dream_capacity_bounded_to_max_output_candidates() {
    let store = FakeDreamStore::default();
    let service = DreamService::new(&store);
    // Provide more proposals than the capacity.
    let proposals: Vec<DreamProposal> = (0..(MAX_OUTPUT_CANDIDATES + 10))
        .map(|_| proposal(DreamProposalKind::Reinforce))
        .collect();
    let (candidates, rejected) = service.record_proposals("drmrun-0", &proposals).unwrap();
    assert_eq!(candidates.len(), MAX_OUTPUT_CANDIDATES);
    assert_eq!(rejected, 10);
}

#[test]
fn dream_candidates_are_always_pending_no_active_memory_write() {
    let store = FakeDreamStore::default();
    let service = DreamService::new(&store);
    let (candidates, _rejected) = service
        .record_proposals(
            "drmrun-0",
            &[
                proposal(DreamProposalKind::Reinforce),
                proposal(DreamProposalKind::Improve),
                proposal(DreamProposalKind::Contradict),
            ],
        )
        .unwrap();
    assert_eq!(candidates.len(), 3);
    // No candidate is promoted: dreams never write active memory directly.
    for candidate in &candidates {
        assert_eq!(candidate.disposition, DreamCandidateDisposition::Pending);
    }
}

#[test]
fn dream_failed_does_not_block_journal_completion() {
    // The journal is always completed first (deterministic); the dream is
    // fail-closed. This test verifies a failed dream run still leaves the
    // journal facts buildable and the result loadable.
    let journal_store = FakeJournalStore::default();
    let journal_service = JournalService::new(&journal_store);
    let dream_store = FakeDreamStore::default();
    let dream_service = DreamService::new(&dream_store);

    // Journal facts build successfully (deterministic, no LLM).
    let facts = journal_service
        .build_facts(&ielts_domain::DailyJournalQuery {
            user_id: "local".into(),
            journal_date: "2026-08-16".into(),
        })
        .unwrap();
    assert_eq!(facts.journal_date, "2026-08-16");

    // Dream run fails (e.g. LLM timeout) — fail-closed.
    dream_store
        .insert_dream_run(
            &DailyDreamQuery {
                user_id: "local".into(),
                journal_id: "djnl-1".into(),
            },
            None,
        )
        .unwrap();
    let failed_run = dream_service
        .fail_run("drmrun-0", &serde_json::json!({"error": "llm timeout"}), "now")
        .unwrap();
    assert_eq!(failed_run.status, DreamRunStatus::Failed);

    // The dream result is still loadable (with the failure recorded).
    let result = dream_service.load_result("drmrun-0").unwrap().unwrap();
    assert_eq!(result.run.status, DreamRunStatus::Failed);
    assert!(result.candidates.is_empty()); // no candidates were recorded
}

#[test]
fn dream_records_pending_candidates_from_python_proposals() {
    let store = FakeDreamStore::default();
    let service = DreamService::new(&store);
    store
        .insert_dream_run(
            &DailyDreamQuery {
                user_id: "local".into(),
                journal_id: "djnl-1".into(),
            },
            Some("input-hash-1"),
        )
        .unwrap();
    let (candidates, _rejected) = service
        .record_proposals(
            "drmrun-0",
            &[
                proposal(DreamProposalKind::Reinforce),
                proposal(DreamProposalKind::Refine),
            ],
        )
        .unwrap();
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].kind, DreamProposalKind::Reinforce);
    assert_eq!(candidates[1].kind, DreamProposalKind::Refine);
    // All pending — promotion still goes through M3.
    assert!(candidates.iter().all(|c| c.disposition == DreamCandidateDisposition::Pending));

    // The result is loadable with the candidates.
    let result = service.load_result("drmrun-0").unwrap().unwrap();
    assert_eq!(result.candidates.len(), 2);
}

#[test]
fn dream_noop_proposal_is_accepted() {
    let store = FakeDreamStore::default();
    let service = DreamService::new(&store);
    let (candidates, _rejected) = service
        .record_proposals("drmrun-0", &[proposal(DreamProposalKind::Noop)])
        .unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].kind, DreamProposalKind::Noop);
    assert_eq!(candidates[0].disposition, DreamCandidateDisposition::Pending);
}
