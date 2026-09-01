use ielts_domain::{
    LearningEventEvidenceBatch, ObservationBatch, ObservationSnapshot, ObservationSnapshotQuery,
};

use crate::ApplicationError;

/// Production read-only port for the Rust Cognitive Read Gateway.
///
/// This is deliberately separate from the developer-only projection rebuild
/// controls. The port returns bounded, versioned DTOs and never exposes a DB
/// connection or filesystem path to an adapter or sidecar.
pub trait CognitiveReadStore {
    fn observation_snapshot(
        &self,
        query: &ObservationSnapshotQuery,
    ) -> Result<ObservationSnapshot, ApplicationError>;

    fn observations_by_ids(&self, ids: &[String]) -> Result<ObservationBatch, ApplicationError>;

    fn learning_events_by_ids(
        &self,
        ids: &[String],
    ) -> Result<LearningEventEvidenceBatch, ApplicationError>;
}

pub struct CognitiveReadService<'a> {
    store: &'a dyn CognitiveReadStore,
}

impl<'a> CognitiveReadService<'a> {
    pub fn new(store: &'a dyn CognitiveReadStore) -> Self {
        Self { store }
    }

    pub fn snapshot(
        &self,
        query: &ObservationSnapshotQuery,
    ) -> Result<ObservationSnapshot, ApplicationError> {
        self.store.observation_snapshot(query)
    }

    pub fn observations_by_ids(
        &self,
        ids: &[String],
    ) -> Result<ObservationBatch, ApplicationError> {
        self.store.observations_by_ids(ids)
    }

    pub fn learning_events_by_ids(
        &self,
        ids: &[String],
    ) -> Result<LearningEventEvidenceBatch, ApplicationError> {
        self.store.learning_events_by_ids(ids)
    }
}
