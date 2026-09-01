use ielts_domain::{
    CorpusExportPage, CorpusExportQuery, CorpusFetchQuery, CorpusFetchResult, CorpusManifest,
};

use crate::ApplicationError;

/// Rust-owned corpus export port consumed by the M5 Python retrieval engine.
///
/// The store returns bounded, versioned corpus views and never exposes a DB
/// connection, filesystem path, or credential to a caller. Python syncs its
/// derived index from these views; final materialization re-reads canonical text.
pub trait CorpusExportStore {
    fn corpus_manifest(&self) -> Result<CorpusManifest, ApplicationError>;

    fn export_chunks(&self, query: &CorpusExportQuery) -> Result<CorpusExportPage, ApplicationError>;

    fn fetch_chunks(&self, query: &CorpusFetchQuery) -> Result<CorpusFetchResult, ApplicationError>;
}

pub struct CorpusExportService<'a> {
    store: &'a dyn CorpusExportStore,
}

impl<'a> CorpusExportService<'a> {
    pub fn new(store: &'a dyn CorpusExportStore) -> Self {
        Self { store }
    }

    pub fn corpus_manifest(&self) -> Result<CorpusManifest, ApplicationError> {
        self.store.corpus_manifest()
    }

    pub fn export_chunks(
        &self,
        query: &CorpusExportQuery,
    ) -> Result<CorpusExportPage, ApplicationError> {
        self.store.export_chunks(query)
    }

    pub fn fetch_chunks(
        &self,
        query: &CorpusFetchQuery,
    ) -> Result<CorpusFetchResult, ApplicationError> {
        self.store.fetch_chunks(query)
    }
}
