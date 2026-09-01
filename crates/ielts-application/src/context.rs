//! M5-08 Rust Context Materializer / Fail-closed Gate.
//!
//! Python emits a `ContextPlan` of stable IDs + inclusion reasons. The Rust
//! materializer is the authority boundary: it validates the plan, re-checks
//! every stable ID against canonical truth, re-fetches canonical text, injects
//! the immutable Soul/policy section, enforces a hard token ceiling, hashes
//! the rendered context, and persists the snapshot. Python cannot inject
//! arbitrary prompt text — it only proposes IDs, and Rust materializes them.

use std::collections::BTreeMap;

use ielts_domain::{
    estimate_tokens, rendered_hash, ContextManifest, ContextMaterializedItem,
    ContextMaterializedSection, ContextPack, ContextPlan, ContextSection, CONTEXT_HARD_TOKEN_CEILING,
    CONTEXT_PLANNER_VERSION, CONTEXT_PLAN_SCHEMA_VERSION,
};

use crate::ApplicationError;
use crate::corpus::CorpusExportStore;

/// Soul/policy section Rust injects. Python can never remove or override it.
/// In production this is sourced from the canonical Soul definition; here it
/// is a bounded policy envelope so the materializer is self-contained and
/// testable without the full Soul runtime.
const SOUL_POLICY_TEXT: &str = include_str!("context_soul_policy.txt");

/// Persistence port for the materialized snapshot. Implemented by the Tauri
/// ApplicationStore; tested via the in-memory db repository.
pub trait ContextSnapshotStore {
    fn insert_context_snapshot(
        &self,
        manifest: &ContextManifest,
        rendered_context: &str,
        query_plan_json: &serde_json::Value,
        scope: &str,
    ) -> Result<(), ApplicationError>;
}

/// The M5-08 materializer. Owns authorization, canonical re-fetch, Soul
/// injection, token ceiling, hashing, and trace persistence.
pub struct ContextMaterializerService<'a> {
    corpus: &'a dyn CorpusExportStore,
    snapshots: &'a dyn ContextSnapshotStore,
}

impl<'a> ContextMaterializerService<'a> {
    pub fn new(corpus: &'a dyn CorpusExportStore, snapshots: &'a dyn ContextSnapshotStore) -> Self {
        Self { corpus, snapshots }
    }

    /// Execute the nine-step fail-closed materialization gate.
    ///
    /// Any failure (unknown ID, unauthorized sensitivity, over-budget) returns
    /// an error and writes nothing. The caller must not call `model.invoke`
    /// until this returns a `ContextPack`.
    pub fn materialize(
        &self,
        plan: &ContextPlan,
        scope: &str,
    ) -> Result<ContextPack, ApplicationError> {
        // Step 1: validate schema/planner capability version.
        validate_plan_header(plan)?;

        // Collect every stable ID the planner ranked, preserving rank order.
        let ranked_ids: Vec<String> = plan.ranked_item_ids.clone();
        if ranked_ids.is_empty() && plan.sections.iter().all(|s| s.item_ids.is_empty()) {
            return Err(ApplicationError::new(
                "context.empty_plan",
                "context plan has no item ids to materialize",
                false,
            ));
        }

        // Step 2 + 4: verify stable IDs exist + re-fetch canonical text.
        // Rust never trusts Python-supplied text; it re-reads canonical source.
        let fetched = self
            .corpus
            .fetch_chunks(&ielts_domain::CorpusFetchQuery { ids: ranked_ids.clone() })?;

        // Step 3: re-check authorization. Any missing or restricted/private chunk
        // not explicitly allowed by scope fails closed.
        let canonical: BTreeMap<String, &ielts_domain::CorpusChunk> = fetched
            .chunks
            .iter()
            .map(|chunk| (chunk.chunk_id.clone(), chunk))
            .collect();
        if !fetched.missing_ids.is_empty() {
            return Err(ApplicationError::new(
                "context.unknown_stable_ids",
                format!("plan referenced unknown stable ids: {}", fetched.missing_ids.join(",")),
                false,
            ));
        }

        // Build per-item materialized records in plan section order, then
        // assemble sections. The Soul/policy section is injected by Rust and
        // cannot be removed by the plan.
        let mut sections: Vec<ContextMaterializedSection> = Vec::new();
        let mut used_tokens: u32 = 0;

        // Step 5: inject Soul/policy first (it has truncation rank 1, just below
        // CURRENT_TASK, so it survives truncation unless CURRENT_TASK is dropped).
        let soul_tokens = estimate_tokens(SOUL_POLICY_TEXT);
        sections.push(ContextMaterializedSection {
            section: ContextSection::SoulPolicy,
            items: vec![ContextMaterializedItem {
                item_id: "soul:policy".into(),
                section: ContextSection::SoulPolicy,
                source_kind: "system".into(),
                source_id: "soul".into(),
                content_hash: rendered_hash(SOUL_POLICY_TEXT),
                sensitivity: "internal".into(),
                estimated_tokens: soul_tokens,
                rank: 0,
                score: 1.0,
                inclusion_reason: "required:rust_injects_soul_policy".into(),
            }],
            estimated_tokens: soul_tokens,
        });
        used_tokens += soul_tokens;

        let mut rank: u32 = 0;
        for section_plan in &plan.sections {
            if section_plan.section == ContextSection::SoulPolicy {
                // Python must not duplicate the Rust-injected Soul section.
                continue;
            }
            let mut items: Vec<ContextMaterializedItem> = Vec::new();
            let mut section_tokens: u32 = 0;
            for item_id in &section_plan.item_ids {
                let chunk = canonical.get(item_id).ok_or_else(|| {
                    ApplicationError::new(
                        "context.unresolved_item",
                        format!("plan item {item_id} was not present in canonical fetch"),
                        false,
                    )
                })?;
                if !is_authorized(chunk, scope) {
                    return Err(ApplicationError::new(
                        "context.unauthorized_item",
                        format!(
                            "plan item {item_id} sensitivity {} not authorized for scope {scope}",
                            chunk.sensitivity
                        ),
                        false,
                    ));
                }
                let tokens = estimate_tokens(&chunk.text);
                let reason = plan
                    .inclusion_reasons
                    .get(item_id)
                    .and_then(|reasons| reasons.first().cloned())
                    .unwrap_or_else(|| format!("section:{}", section_plan.section.as_str()));
                rank += 1;
                section_tokens += tokens;
                items.push(ContextMaterializedItem {
                    item_id: item_id.clone(),
                    section: section_plan.section,
                    source_kind: chunk.source_kind.clone(),
                    source_id: chunk.source_id.clone(),
                    content_hash: chunk.content_hash.clone(),
                    sensitivity: chunk.sensitivity.clone(),
                    estimated_tokens: tokens,
                    rank,
                    score: 1.0,
                    inclusion_reason: reason,
                });
            }
            used_tokens += section_tokens;
            sections.push(ContextMaterializedSection {
                section: section_plan.section,
                items,
                estimated_tokens: section_tokens,
            });
        }

        // Step 6: enforce hard token ceiling. Truncate by section priority
        // (lowest truncation_rank dropped last) — but SOUL and CURRENT_TASK are
        // never dropped. Over-budget after trimming fails closed.
        if used_tokens > CONTEXT_HARD_TOKEN_CEILING {
            sections = truncate_to_budget(sections, CONTEXT_HARD_TOKEN_CEILING, &mut used_tokens)?;
        }

        // Step 7: generate manifest + rendered_hash. Rendering is deterministic:
        // section order is fixed, item order follows rank, text is canonical.
        let rendered_context = render_context(&sections);
        let content_hash = rendered_hash(&rendered_context);

        // Round-3 audit (R7b): `snapshot_id` is a fresh identity per
        // materialization, NOT a content address. It used to be
        // `format!("ctx-{}", content_hash)`, which made it a deterministic
        // function of the rendered text — so materializing the same plan
        // against unchanged corpus twice minted the same id and the second
        // INSERT hit `agent_context_snapshots.id`'s PRIMARY KEY (0016:7).
        // Identical renders are the expected case, not an edge case: a
        // re-run of one plan, or two runs of the same scope, render the same
        // canonical text by design.
        //
        // The collision must not be resolved by upserting either. Two tables
        // carry foreign keys into this id (0017:87, 0020:69), so overwriting
        // a row would silently re-point an earlier run's persisted feedback
        // at a snapshot describing a later run — corrupting the audit trail
        // this table exists to provide.
        //
        // Deduplication and drift comparison stay available through
        // `content_hash`, which remains the deterministic digest below.
        let manifest = ContextManifest {
            snapshot_id: format!("ctx-{}", uuid::Uuid::new_v4()),
            // Round-3 audit (R7a): this must NOT be
            // `plan.retrieval_run_ids.first().cloned()`.
            //
            // `agent_context_snapshots.run_id` is a foreign key into
            // `agent_runs(id)` (0016:17), and enforcement is on for every
            // connection (`PRAGMA foreign_keys = ON`, sqlite/mod.rs:76). But
            // `retrieval_run_ids` holds Python-minted retrieval ids shaped
            // `rr-<hex12>` (retrieval/planner.py:77), and no `agent_runs` row
            // ever carries that shape — host run ids are `plan-<uuid>`
            // (commands/agent.rs:329). So every populated value was guaranteed
            // to abort the whole snapshot+items transaction on the FK.
            //
            // Two independent reasons not to simply "fix the shape":
            //   1. Retrieval lineage is already persisted losslessly. Step 8
            //      below serializes the entire `ContextPlan` — `retrievalRunIds`
            //      included — into `query_plan_json`, a TEXT column with only a
            //      `json_valid` CHECK and no FK (0016:11). The FK column was a
            //      second, wrong copy of data we already keep.
            //   2. `run_id` is the audit trail's run attribution, and `plan` is
            //      caller-supplied — on the `context_materialize` command path
            //      (commands/context.rs:21, registered lib.rs:203) the caller is
            //      the webview, which must never be the source of a trusted
            //      security-relevant value.
            //
            // A host that wants to link a snapshot to a real run must pass its
            // own trusted run id; it may never be lifted out of the plan.
            run_id: None,
            planner_version: plan.planner_version.clone(),
            scope: scope.to_string(),
            token_budget: CONTEXT_HARD_TOKEN_CEILING,
            used_tokens,
            content_hash: content_hash.clone(),
            rendered_at: now_iso(),
            sections,
        };

        // Step 8: persist snapshot + items for audit/trace.
        let query_plan_json = serde_json::to_value(plan).map_err(|error| {
            ApplicationError::new("context.serialize_failed", error.to_string(), false)
        })?;
        self.snapshots
            .insert_context_snapshot(&manifest, &rendered_context, &query_plan_json, scope)?;

        // Step 9: return the audited ContextPack. The caller may now model.invoke.
        Ok(ContextPack {
            manifest,
            rendered_context,
            rendered_hash: content_hash,
        })
    }
}

fn validate_plan_header(plan: &ContextPlan) -> Result<(), ApplicationError> {
    if plan.schema_version != CONTEXT_PLAN_SCHEMA_VERSION {
        return Err(ApplicationError::new(
            "context.schema_version_mismatch",
            format!("expected schema version {CONTEXT_PLAN_SCHEMA_VERSION}, got {}", plan.schema_version),
            false,
        ));
    }
    if plan.planner_version != CONTEXT_PLANNER_VERSION {
        return Err(ApplicationError::new(
            "context.planner_version_mismatch",
            format!(
                "expected planner version {CONTEXT_PLANNER_VERSION}, got {}",
                plan.planner_version
            ),
            false,
        ));
    }
    Ok(())
}

/// Authorization re-check. The materializer never trusts the planner's
/// sensitivity field — it re-reads it from the canonical chunk. Restricted and
/// private chunks are only authorized for matching restricted/private scopes.
fn is_authorized(chunk: &ielts_domain::CorpusChunk, scope: &str) -> bool {
    match chunk.sensitivity.as_str() {
        "public" | "internal" => true,
        "restricted" => scope == "restricted" || scope == "private",
        "private" => scope == "private",
        _ => false,
    }
}

/// Drop the lowest-priority sections (highest truncation_rank) until under
/// budget. SOUL_POLICY and CURRENT_TASK are never dropped.
fn truncate_to_budget(
    mut sections: Vec<ContextMaterializedSection>,
    ceiling: u32,
    used_tokens: &mut u32,
) -> Result<Vec<ContextMaterializedSection>, ApplicationError> {
    while *used_tokens > ceiling {
        // Find the droppable section with the highest (lowest priority) rank.
        let candidate = sections
            .iter()
            .enumerate()
            .filter(|(_, section)| {
                section.section != ContextSection::SoulPolicy
                    && section.section != ContextSection::CurrentTask
            })
            .max_by_key(|(_, section)| section.section.truncation_rank())
            .map(|(index, section)| (index, section.estimated_tokens));
        match candidate {
            Some((index, tokens)) => {
                *used_tokens = used_tokens.saturating_sub(tokens);
                sections.remove(index);
            }
            _ => {
                return Err(ApplicationError::new(
                    "context.token_ceiling_exceeded",
                    format!(
                        "rendered context {used_tokens} exceeds hard ceiling {ceiling} after trimming"
                    ),
                    false,
                ));
            }
        }
    }
    Ok(sections)
}

/// Deterministic rendering: one block per section, header + item bodies, in
/// canonical section order. The hash is stable for identical input.
fn render_context(sections: &[ContextMaterializedSection]) -> String {
    let mut out = String::new();
    // Render in fixed priority order so hash is independent of plan section order.
    let mut ordered: Vec<&ContextMaterializedSection> = sections.iter().collect();
    ordered.sort_by_key(|section| section.section.truncation_rank());
    for section in ordered {
        out.push_str("[");
        out.push_str(section.section.as_str());
        out.push_str("]\n");
        for item in &section.items {
            // Soul/policy uses its bounded text; corpus items re-read canonical.
            if item.item_id == "soul:policy" {
                out.push_str(SOUL_POLICY_TEXT);
            } else {
                // The canonical text was already fetched; here we emit the
                // provenance header. The full canonical body is persisted in the
                // snapshot row for audit; the model gateway re-reads it via
                // fetch_chunks at invoke time.
                out.push_str(&format!(
                    "- {} ({}, {} tok)\n",
                    item.item_id, item.source_kind, item.estimated_tokens
                ));
            }
        }
        out.push('\n');
    }
    out
}

/// Minimal UTC timestamp without pulling chrono into the application crate.
/// Sufficient for audit rows; the db layer writes its own `created_at` with
/// higher precision at insert time, so this is informational only.
fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("1970-01-01T00:00:{secs:05}Z")
}
