use std::collections::BTreeSet;

use ielts_domain::{
    is_user_note_key, validate_explicit_preference, Activity, ExplicitPreference,
    ExplicitPreferenceDelete, ExplicitPreferenceIssue, ExplicitPreferenceUpsert, MemoryCandidateBatchReceipt,
    MemoryCandidateInput,
    MemoryCandidatePersistenceInput, MemoryCatalog, MemoryCatalogQuery, MemoryContextPreview,
    MemoryContextQuery, MemoryArchiveCommand, MemoryForgetCommand,
    MemoryMutationProposal, MemoryMutationProposalBatch, MemoryMutationReceipt, MemoryNamespace,
    MemoryProposalDisposition, MemoryProposalValidationReport, MemoryPromotionCommand, MemoryScope, MemorySourceClass,
    MemoryValidationSnapshot, MAX_USER_NOTE_PREFERENCES, MEMORY_PROPOSAL_SCHEMA_VERSION,
};

use crate::ApplicationError;

use super::{MemoryProposalOrigin, MemoryProposalValidator};

#[derive(Debug, Clone)]
pub struct SubmitMemoryCandidatesCommand {
    pub request_id: String,
    pub user_id: String,
    pub run_id: Option<String>,
    pub batch: MemoryMutationProposalBatch,
}

/// One memory the learner wrote or confirmed themselves (a coach preference
/// card, say). It enters through the same validator and promotion as every other
/// memory; only its origin differs.
#[derive(Debug, Clone)]
pub struct CreateLearnerMemoryCommand {
    /// Names the write in logs and audit; one request, one memory.
    pub request_id: String,
    pub user_id: String,
    pub namespace: MemoryNamespace,
    pub canonical_key: String,
    pub scope: MemoryScope,
    pub statement: String,
    /// Observations the memory rests on (the learner's own message, for a coach card).
    pub evidence_observation_ids: Vec<String>,
    pub actor_id: String,
    pub reason: String,
}

/// What happened to one batch of cognitive mutations.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AppliedMutations {
    /// Proposals the validator accepted (pending), whether or not promotion held.
    pub validated: usize,
    /// Proposals the validator did not accept (invalid, duplicate, quarantined).
    pub rejected: usize,
    pub applied: Vec<MemoryMutationReceipt>,
}

pub trait MemoryStore {
    fn prepare_candidate_input(
        &self,
        user_id: &str,
        activity: Activity,
        since: Option<String>,
        max_candidates: usize,
    ) -> Result<MemoryCandidateInput, ApplicationError>;

    fn validation_snapshot(
        &self,
        user_id: &str,
        observation_ids: &[String],
    ) -> Result<MemoryValidationSnapshot, ApplicationError>;

    fn persist_candidate_batch(
        &self,
        input: &MemoryCandidatePersistenceInput,
    ) -> Result<MemoryCandidateBatchReceipt, ApplicationError>;

    fn promote_candidate(
        &self,
        command: &MemoryPromotionCommand,
    ) -> Result<MemoryMutationReceipt, ApplicationError>;

    fn upsert_explicit_preference(
        &self,
        command: &ExplicitPreferenceUpsert,
    ) -> Result<ExplicitPreference, ApplicationError>;

    /// The learner's active explicit preferences (Notebook "你告诉我们的").
    fn list_explicit_preferences(&self, user_id: &str) -> Result<Vec<ExplicitPreference>, ApplicationError>;

    /// Erase one explicit preference on the learner's request.
    fn delete_explicit_preference(&self, command: &ExplicitPreferenceDelete) -> Result<bool, ApplicationError>;

    fn context_preview(
        &self,
        query: &MemoryContextQuery,
    ) -> Result<MemoryContextPreview, ApplicationError>;

    /// Product-host catalog read (M9/18.3): governable memory items for the
    /// console. Not a Context Pack; private/restricted rows never leave the db.
    fn load_catalog(&self, query: &MemoryCatalogQuery) -> Result<MemoryCatalog, ApplicationError>;

    /// Settle a validated candidate that could not be promoted so it does not
    /// linger as pending (pending candidates reach the coach as unverified context).
    fn reject_candidate(&self, candidate_id: &str) -> Result<(), ApplicationError>;

    fn archive_memory(&self, command: &MemoryArchiveCommand) -> Result<(), ApplicationError>;
    fn forget_memory(&self, command: &MemoryForgetCommand) -> Result<(), ApplicationError>;

    /// Write a validated `user_explicit` memory the learner wrote or confirmed, in one
    /// transaction (see `ielts_db::create_learner_memory`). Stores that only serve the
    /// model's proposals need not implement it.
    fn create_learner_memory(
        &self,
        _input: &MemoryCandidatePersistenceInput,
        _actor_id: &str,
        _reason: &str,
    ) -> Result<MemoryMutationReceipt, ApplicationError> {
        Err(ApplicationError::new("memory.unsupported", "this store cannot create learner memories", false))
    }
}

pub struct MemoryService<'a> {
    store: &'a dyn MemoryStore,
    validator: MemoryProposalValidator,
}

impl<'a> MemoryService<'a> {
    pub fn new(store: &'a dyn MemoryStore) -> Self {
        Self {
            store,
            validator: MemoryProposalValidator::default(),
        }
    }

    pub fn prepare_candidate_input(
        &self,
        user_id: &str,
        activity: Activity,
        since: Option<String>,
        max_candidates: usize,
    ) -> Result<MemoryCandidateInput, ApplicationError> {
        self.store
            .prepare_candidate_input(user_id, activity, since, max_candidates)
    }

    pub fn submit_cognitive_candidates(
        &self,
        command: &SubmitMemoryCandidatesCommand,
        source_class: MemorySourceClass,
    ) -> Result<MemoryCandidateBatchReceipt, ApplicationError> {
        let evidence_ids = command
            .batch
            .proposals
            .iter()
            .flat_map(|proposal| proposal.evidence_observation_ids().iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let snapshot = self
            .store
            .validation_snapshot(&command.user_id, &evidence_ids)?;
        let validation = self.validator.validate(
            &command.batch,
            MemoryProposalOrigin::CognitiveRuntime { source_class },
            &snapshot,
        );
        self.store.persist_candidate_batch(&MemoryCandidatePersistenceInput {
            request_id: command.request_id.clone(),
            user_id: command.user_id.clone(),
            run_id: command.run_id.clone(),
            source_class,
            batch: command.batch.clone(),
            validation,
            snapshot,
        })
    }

    /// The weekly dream's write path: validate the batch with the same gate as
    /// every cognitive proposal, then promote each accepted candidate as the
    /// `dream` actor. A candidate that validated but cannot be promoted (its
    /// target moved, or a full scope has nothing evictable) is settled as
    /// rejected and costs the batch nothing else.
    pub fn apply_cognitive_mutations(
        &self,
        command: &SubmitMemoryCandidatesCommand,
        source_class: MemorySourceClass,
        reason: &str,
    ) -> Result<AppliedMutations, ApplicationError> {
        let receipt = self.submit_cognitive_candidates(command, source_class)?;
        let mut outcome = AppliedMutations::default();
        for candidate in &receipt.candidates {
            match candidate.disposition.as_str() {
                "pending" => outcome.validated += 1,
                "noop" => continue,
                _ => {
                    outcome.rejected += 1;
                    continue;
                }
            }
            let promotion = MemoryPromotionCommand {
                candidate_id: candidate.id.clone(),
                expected_candidate_version: candidate.version,
                actor_type: "dream".into(),
                actor_id: Some("weekly_dream".into()),
                reason: reason.into(),
            };
            match self.store.promote_candidate(&promotion) {
                Ok(done) => outcome.applied.push(done),
                Err(_) => self.store.reject_candidate(&candidate.id)?,
            }
        }
        Ok(outcome)
    }

    pub fn promote_candidate(
        &self,
        command: &MemoryPromotionCommand,
    ) -> Result<MemoryMutationReceipt, ApplicationError> {
        self.store.promote_candidate(command)
    }

    /// Create a `user_explicit` memory for what the learner wrote or confirmed. The
    /// same validator as every proposal (the trusted origin may claim `user_explicit`),
    /// then one transaction writes the memory with its evidence and audit row. A
    /// learner memory is never evicted by capacity governance and can only be created,
    /// never used to change another memory.
    pub fn create_learner_memory(
        &self,
        command: &CreateLearnerMemoryCommand,
    ) -> Result<MemoryMutationReceipt, ApplicationError> {
        let batch = MemoryMutationProposalBatch {
            schema_version: MEMORY_PROPOSAL_SCHEMA_VERSION,
            proposals: vec![MemoryMutationProposal::Add {
                namespace: command.namespace,
                canonical_key: command.canonical_key.clone(),
                scope: command.scope,
                statement: command.statement.clone(),
                evidence_observation_ids: command.evidence_observation_ids.clone(),
            }],
        };
        let snapshot = self.store.validation_snapshot(&command.user_id, &command.evidence_observation_ids)?;
        let source_class = MemorySourceClass::UserExplicit;
        let validation =
            self.validator.validate(&batch, MemoryProposalOrigin::RustTrusted { source_class }, &snapshot);
        let accepted = validation.batch_issues.is_empty()
            && matches!(validation.decisions.as_slice(), [decision] if decision.disposition == MemoryProposalDisposition::Pending);
        if !accepted {
            return Err(refusal(&validation));
        }
        let input = MemoryCandidatePersistenceInput {
            request_id: command.request_id.clone(),
            user_id: command.user_id.clone(),
            run_id: None,
            source_class,
            batch,
            validation,
            snapshot,
        };
        self.store.create_learner_memory(&input, &command.actor_id, &command.reason)
    }

    /// Validate a learner-authored preference before it reaches the store, so a
    /// refused write comes back with a stable code and a message the learner
    /// can read. The store validates again; this is the friendly gate.
    pub fn put_explicit_preference(
        &self,
        command: &ExplicitPreferenceUpsert,
    ) -> Result<ExplicitPreference, ApplicationError> {
        let command = validate_explicit_preference(command).map_err(preference_error)?;
        if is_user_note_key(&command.preference_key) {
            let existing = self.store.list_explicit_preferences(&command.user_id)?;
            let notes = existing.iter().filter(|pref| is_user_note_key(&pref.preference_key));
            let replaces = existing.iter().any(|pref| {
                pref.preference_key == command.preference_key && pref.scope == command.scope
            });
            if !replaces && notes.count() >= MAX_USER_NOTE_PREFERENCES {
                return Err(preference_error(ExplicitPreferenceIssue::TooMany));
            }
        }
        self.store.upsert_explicit_preference(&command)
    }

    pub fn list_explicit_preferences(&self, user_id: &str) -> Result<Vec<ExplicitPreference>, ApplicationError> {
        self.store.list_explicit_preferences(user_id)
    }

    pub fn delete_explicit_preference(
        &self,
        command: &ExplicitPreferenceDelete,
    ) -> Result<bool, ApplicationError> {
        self.store.delete_explicit_preference(command)
    }

    pub fn context_preview(
        &self,
        query: &MemoryContextQuery,
    ) -> Result<MemoryContextPreview, ApplicationError> {
        self.store.context_preview(query)
    }

    /// M9/18.3 product-host catalog read for the console.
    pub fn load_catalog(&self, query: &MemoryCatalogQuery) -> Result<MemoryCatalog, ApplicationError> {
        self.store.load_catalog(query)
    }

    pub fn archive_memory(&self, command: &MemoryArchiveCommand) -> Result<(), ApplicationError> {
        self.store.archive_memory(command)
    }

    pub fn forget_memory(&self, command: &MemoryForgetCommand) -> Result<(), ApplicationError> {
        self.store.forget_memory(command)
    }
}

/// Why the validator did not accept a learner's memory, in its own words.
fn refusal(report: &MemoryProposalValidationReport) -> ApplicationError {
    let decision = report.decisions.first();
    let issue = report
        .batch_issues
        .first()
        .or_else(|| decision.and_then(|decision| decision.issues.first()));
    let code = decision.map_or("rejected", |decision| decision.disposition.as_str());
    let message = issue.map_or_else(|| format!("memory was not created ({code})"), |issue| issue.message.clone());
    ApplicationError::new(format!("memory.{code}"), message, false)
}

fn preference_error(issue: ExplicitPreferenceIssue) -> ApplicationError {
    ApplicationError::new(issue.code(), issue.message(), false)
}
