//! M5-08 Rust Context Materializer / fail-closed gate integration tests.
//!
//! Verifies the nine-step contract: schema/planner validation, stable-ID
//! existence, canonical re-fetch, sensitivity re-authorization, Soul/policy
//! injection, token-ceiling truncation, rendered-hash stability, snapshot
//! persistence, and fail-closed behaviour on unknown/unauthorized items.

use ielts_application::{
    ApplicationError, ContextMaterializerService, ContextSnapshotStore, CorpusExportStore,
};
use ielts_domain::{
    ContextManifest, ContextPlan, ContextSection, ContextSectionPlan,
    CONTEXT_HARD_TOKEN_CEILING, CONTEXT_PLANNER_VERSION, CONTEXT_PLAN_SCHEMA_VERSION,
    CorpusChunk, CorpusExportPage, CorpusExportQuery, CorpusFetchQuery, CorpusFetchResult,
    CorpusManifest,
};
use serde_json::Value;

/// In-memory fake host store: serves canned corpus chunks + records snapshots.
/// Mirrors the Rust ApplicationStore contract without a real SQLite connection.
struct FakeStore {
    chunks: Vec<CorpusChunk>,
    recorded_snapshot: std::sync::Mutex<Option<String>>,
    /// The `query_plan_json` handed to the store. Captured so a test can assert
    /// retrieval lineage is persisted here (R7a) rather than in the FK column.
    recorded_query_plan: std::sync::Mutex<Option<Value>>,
}

impl FakeStore {
    fn new(chunks: Vec<CorpusChunk>) -> Self {
        Self {
            chunks,
            recorded_snapshot: std::sync::Mutex::new(None),
            recorded_query_plan: std::sync::Mutex::new(None),
        }
    }
}

impl CorpusExportStore for FakeStore {
    fn corpus_manifest(&self) -> Result<CorpusManifest, ApplicationError> {
        Ok(CorpusManifest {
            schema_version: 1,
            chunking_version: 1,
            generated_at: "2026-08-15T00:00:00Z".into(),
            asset_count: self.chunks.len() as u32,
            chunk_count: self.chunks.len() as u32,
            source_kinds: vec!["builtin".into()],
        })
    }

    fn export_chunks(
        &self,
        _query: &CorpusExportQuery,
    ) -> Result<CorpusExportPage, ApplicationError> {
        Ok(CorpusExportPage {
            schema_version: 1,
            chunking_version: 1,
            generated_at: "2026-08-15T00:00:00Z".into(),
            chunks: self.chunks.clone(),
            next_cursor: None,
            truncated: false,
        })
    }

    fn fetch_chunks(&self, query: &CorpusFetchQuery) -> Result<CorpusFetchResult, ApplicationError> {
        let mut found = Vec::new();
        let mut missing = Vec::new();
        for id in &query.ids {
            match self.chunks.iter().find(|chunk| &chunk.chunk_id == id) {
                Some(chunk) => found.push(chunk.clone()),
                None => missing.push(id.clone()),
            }
        }
        Ok(CorpusFetchResult {
            schema_version: 1,
            chunks: found,
            missing_ids: missing,
        })
    }
}

impl ContextSnapshotStore for FakeStore {
    fn insert_context_snapshot(
        &self,
        _manifest: &ContextManifest,
        rendered_context: &str,
        query_plan_json: &Value,
        _scope: &str,
    ) -> Result<(), ApplicationError> {
        *self.recorded_snapshot.lock().unwrap() = Some(rendered_context.to_string());
        *self.recorded_query_plan.lock().unwrap() = Some(query_plan_json.clone());
        Ok(())
    }
}

fn chunk(id: &str, sensitivity: &str) -> CorpusChunk {
    CorpusChunk {
        chunk_id: id.into(),
        source_kind: "builtin".into(),
        source_id: id.into(),
        source_version: 1,
        activity: "reading".into(),
        content_hash: format!("hash-{id}"),
        sensitivity: sensitivity.into(),
        text: format!("canonical body text for {id}"),
        updated_at: "2026-08-15T00:00:00Z".into(),
    }
}

fn plan(sections: Vec<ContextSectionPlan>, ranked: Vec<String>) -> ContextPlan {
    ContextPlan {
        schema_version: CONTEXT_PLAN_SCHEMA_VERSION,
        planner_version: CONTEXT_PLANNER_VERSION.into(),
        task_kind: "reading_review".into(),
        sections,
        ranked_item_ids: ranked,
        inclusion_reasons: std::collections::BTreeMap::new(),
        requested_token_budget: 0,
        retrieval_run_ids: vec!["run-1".into()],
    }
}

#[test]
fn materializes_valid_plan_with_soul_injected() {
    let store = FakeStore::new(vec![chunk("reading:a:v1:0", "internal")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::CurrentTask,
            item_ids: vec!["reading:a:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["exact".into()],
        }],
        vec!["reading:a:v1:0".into()],
    );
    let pack = service.materialize(&plan, "internal").unwrap();
    assert!(pack.manifest.snapshot_id.starts_with("ctx-"));
    // Soul section must be present and never removed by the plan.
    assert!(pack
        .manifest
        .sections
        .iter()
        .any(|section| section.section == ContextSection::SoulPolicy));
    // Rendered hash is non-empty and stable.
    assert!(!pack.rendered_hash.is_empty());
    assert_eq!(pack.rendered_hash, pack.manifest.content_hash);
    // Snapshot was persisted.
    assert!(store
        .recorded_snapshot
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .contains("SOUL_POLICY"));
}

#[test]
fn fails_closed_on_unknown_stable_id() {
    let store = FakeStore::new(vec![chunk("reading:a:v1:0", "internal")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::CurrentTask,
            item_ids: vec!["reading:ghost:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["exact".into()],
        }],
        vec!["reading:ghost:v1:0".into()],
    );
    let error = service.materialize(&plan, "internal").unwrap_err();
    assert_eq!(error.code, "context.unknown_stable_ids");
    // Nothing was persisted — fail closed.
    assert!(store.recorded_snapshot.lock().unwrap().is_none());
}

#[test]
fn rejects_unauthorized_restricted_item_in_internal_scope() {
    let store = FakeStore::new(vec![chunk("reading:secret:v1:0", "restricted")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::RetrievedCorpus,
            item_ids: vec!["reading:secret:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["lexical".into()],
        }],
        vec!["reading:secret:v1:0".into()],
    );
    let error = service.materialize(&plan, "internal").unwrap_err();
    assert_eq!(error.code, "context.unauthorized_item");
}

#[test]
fn authorizes_restricted_item_in_restricted_scope() {
    let store = FakeStore::new(vec![chunk("reading:secret:v1:0", "restricted")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::RetrievedCorpus,
            item_ids: vec!["reading:secret:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["lexical".into()],
        }],
        vec!["reading:secret:v1:0".into()],
    );
    let pack = service.materialize(&plan, "restricted").unwrap();
    assert!(pack
        .manifest
        .sections
        .iter()
        .any(|section| section.section == ContextSection::RetrievedCorpus));
}

#[test]
fn rejects_wrong_planner_version() {
    let store = FakeStore::new(vec![]);
    let service = ContextMaterializerService::new(&store, &store);
    let mut plan = plan(vec![], vec![]);
    plan.planner_version = "unknown-planner".into();
    let error = service.materialize(&plan, "internal").unwrap_err();
    assert_eq!(error.code, "context.planner_version_mismatch");
}

#[test]
fn rendered_hash_stable_for_identical_plan() {
    let store = FakeStore::new(vec![chunk("reading:a:v1:0", "internal")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::CurrentTask,
            item_ids: vec!["reading:a:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["exact".into()],
        }],
        vec!["reading:a:v1:0".into()],
    );
    let first = service.materialize(&plan, "internal").unwrap();
    let second = service.materialize(&plan, "internal").unwrap();
    assert_eq!(first.rendered_hash, second.rendered_hash);
}

#[test]
fn token_ceiling_enforced_and_does_not_drop_soul_or_current_task() {
    // A single chunk whose text balloons well past the hard ceiling so the
    // truncator engages. CURRENT_TASK and SOUL_POLICY must both survive.
    let big_chunk = CorpusChunk {
        chunk_id: "reading:big:v1:0".into(),
        source_kind: "builtin".into(),
        source_id: "reading:big:v1:0".into(),
        source_version: 1,
        activity: "reading".into(),
        content_hash: "hash-big".into(),
        sensitivity: "internal".into(),
        text: "a".repeat((CONTEXT_HARD_TOKEN_CEILING as usize) * 8),
        updated_at: "2026-08-15T00:00:00Z".into(),
    };
    let store = FakeStore::new(vec![big_chunk]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![
            ContextSectionPlan {
                section: ContextSection::CurrentTask,
                item_ids: vec!["reading:big:v1:0".into()],
                requested_token_budget: 0,
                inclusion_reasons: vec!["exact".into()],
            },
            ContextSectionPlan {
                section: ContextSection::RetrievedCorpus,
                item_ids: vec![],
                requested_token_budget: 0,
                inclusion_reasons: vec![],
            },
        ],
        vec!["reading:big:v1:0".into()],
    );
    let result = service.materialize(&plan, "internal");
    // The oversized current-task chunk cannot be dropped, so the gate fails closed.
    let error = result.unwrap_err();
    assert_eq!(error.code, "context.token_ceiling_exceeded");
}

#[test]
fn repeated_materialization_mints_a_fresh_snapshot_id_but_a_stable_content_hash() {
    // Round-3 audit (R7b). `snapshot_id` used to be
    // `format!("ctx-{}", content_hash)`, i.e. a content address. Because
    // rendering is deterministic by design (fixed section order, rank-ordered
    // items, canonical text), re-materializing one plan against unchanged
    // corpus produced a byte-identical render — and therefore a duplicate id,
    // which `agent_context_snapshots.id`'s PRIMARY KEY (migration 0016:7)
    // rejects. Re-running a plan is ordinary use, not an edge case.
    //
    // The contract this pins: identity is per-materialization, digest is
    // deterministic. Both properties are needed — uniqueness so the audit row
    // always inserts, determinism so drift/dedup comparisons still work.
    let store = FakeStore::new(vec![chunk("reading:a:v1:0", "internal")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::CurrentTask,
            item_ids: vec!["reading:a:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["exact".into()],
        }],
        vec!["reading:a:v1:0".into()],
    );

    let first = service.materialize(&plan, "internal").unwrap();
    let second = service.materialize(&plan, "internal").unwrap();

    assert_ne!(
        first.manifest.snapshot_id, second.manifest.snapshot_id,
        "each materialization must own a distinct primary key"
    );
    assert!(first.manifest.snapshot_id.starts_with("ctx-"));
    assert!(second.manifest.snapshot_id.starts_with("ctx-"));

    // The render itself is unchanged, which is exactly why the old scheme
    // collided. Determinism is preserved; only identity was decoupled from it.
    assert_eq!(first.rendered_context, second.rendered_context);
    assert_eq!(
        first.manifest.content_hash, second.manifest.content_hash,
        "content_hash stays a deterministic digest of the rendered text"
    );
    assert_eq!(first.rendered_hash, second.rendered_hash);

    // And the id is not merely a reshuffle of the hash: it must carry no
    // dependence on the content, or the collision returns in another form.
    assert!(!first.manifest.snapshot_id.contains(&first.manifest.content_hash));
}

#[test]
fn retrieval_run_ids_are_recorded_in_the_query_plan_not_the_fk_column() {
    // Round-3 audit (R7a). `manifest.run_id` is persisted into
    // `agent_context_snapshots.run_id`, an FK into `agent_runs(id)` (0016:17)
    // enforced on every connection. It used to be filled from
    // `plan.retrieval_run_ids.first()`, but those are Python-minted
    // `rr-<hex12>` retrieval ids (retrieval/planner.py:77) that match no
    // `agent_runs` row, so any populated value aborted the insert outright.
    //
    // Two properties are pinned here. First, the materializer no longer
    // attributes a run from the plan at all — `run_id` is None, and it must
    // stay that way because on the `context_materialize` command path the plan
    // comes from the webview, which may never dictate audit attribution.
    // Second, the fix loses nothing: the full plan (retrieval ids included) is
    // already persisted in `query_plan_json`, which has no FK.
    let store = FakeStore::new(vec![chunk("reading:a:v1:0", "internal")]);
    let service = ContextMaterializerService::new(&store, &store);
    let plan = plan(
        vec![ContextSectionPlan {
            section: ContextSection::CurrentTask,
            item_ids: vec!["reading:a:v1:0".into()],
            requested_token_budget: 256,
            inclusion_reasons: vec!["exact".into()],
        }],
        vec!["reading:a:v1:0".into()],
    );
    // The helper seeds a retrieval id, so this test would pass vacuously if the
    // plan carried none.
    assert_eq!(plan.retrieval_run_ids, vec!["run-1".to_string()]);

    let pack = service.materialize(&plan, "internal").unwrap();

    assert!(
        pack.manifest.run_id.is_none(),
        "the FK column must not be attributed from a caller-supplied plan, got {:?}",
        pack.manifest.run_id
    );

    // Lineage is still queryable: it lives in the JSON column, under the wire
    // name Python sends.
    let recorded = store
        .recorded_query_plan
        .lock()
        .unwrap()
        .clone()
        .expect("the store received a query plan");
    assert_eq!(
        recorded
            .get("retrievalRunIds")
            .and_then(Value::as_array)
            .map(|ids| ids.iter().filter_map(Value::as_str).collect::<Vec<_>>()),
        Some(vec!["run-1"]),
        "retrieval lineage must survive in query_plan_json: {recorded}"
    );
}
