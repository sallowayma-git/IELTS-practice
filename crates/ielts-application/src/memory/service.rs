use std::collections::BTreeSet;

use ielts_domain::{
    Activity, ExplicitPreference, ExplicitPreferenceUpsert, MemoryCandidateBatchReceipt,
    MemoryCandidateInput,
    MemoryCandidatePersistenceInput, MemoryCatalog, MemoryCatalogQuery, MemoryContextPreview,
    MemoryContextQuery, MemoryForgetCommand,
    MemoryMutationProposalBatch, MemoryMutationReceipt, MemoryPromotionCommand, MemorySourceClass,
    MemoryValidationSnapshot,
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

    fn context_preview(
        &self,
        query: &MemoryContextQuery,
    ) -> Result<MemoryContextPreview, ApplicationError>;

    /// Product-host catalog read (M9/18.3): governable memory items for the
    /// console. Not a Context Pack; private/restricted rows never leave the db.
    fn load_catalog(&self, query: &MemoryCatalogQuery) -> Result<MemoryCatalog, ApplicationError>;

    fn forget_memory(&self, command: &MemoryForgetCommand) -> Result<(), ApplicationError>;
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

    pub fn promote_candidate(
        &self,
        command: &MemoryPromotionCommand,
    ) -> Result<MemoryMutationReceipt, ApplicationError> {
        self.store.promote_candidate(command)
    }

    pub fn put_explicit_preference(
        &self,
        command: &ExplicitPreferenceUpsert,
    ) -> Result<ExplicitPreference, ApplicationError> {
        self.store.upsert_explicit_preference(command)
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

    pub fn forget_memory(&self, command: &MemoryForgetCommand) -> Result<(), ApplicationError> {
        self.store.forget_memory(command)
    }
}
