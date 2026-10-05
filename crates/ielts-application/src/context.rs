//! M5-08 Rust Context Materializer / Fail-closed Gate.
//!
//! Python emits a `ContextPlan` of stable IDs + inclusion reasons. The Rust
//! materializer is the authority boundary: it validates the plan, re-checks
//! every stable ID against canonical truth, re-fetches canonical text, injects
//! the immutable Soul/policy section, enforces a hard token ceiling, hashes
//! the rendered context, and persists the snapshot. Python cannot inject
//! arbitrary prompt text — it only proposes IDs, and Rust materializes them.

use std::collections::{BTreeMap, BTreeSet};

use ielts_domain::{
    estimate_tokens, rendered_hash, ContextManifest, ContextMaterializedItem,
    ContextMaterializedSection, ContextPack, ContextPlan, ContextSection,
    CONTEXT_HARD_TOKEN_CEILING, CONTEXT_PLANNER_VERSION, CONTEXT_PLAN_SCHEMA_VERSION,
};

use crate::corpus::CorpusExportStore;
use crate::ApplicationError;

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
    current_task: Option<&'a str>,
}

impl<'a> ContextMaterializerService<'a> {
    pub fn new(corpus: &'a dyn CorpusExportStore, snapshots: &'a dyn ContextSnapshotStore) -> Self {
        Self {
            corpus,
            snapshots,
            current_task: None,
        }
    }

    /// Only the host supplies task text; a planner's corpus IDs cannot become
    /// task instructions. This value must come from the trusted active task.
    pub fn with_current_task(mut self, text: &'a str) -> Self {
        self.current_task = Some(text);
        self
    }

    /// Webview/sidecar scopes are requests, not authority to disclose secrets.
    pub fn materialize_for_caller(
        &self,
        plan: &ContextPlan,
        scope: &str,
    ) -> Result<ContextPack, ApplicationError> {
        if !matches!(scope, "public" | "internal") {
            return Err(ApplicationError::new(
                "context.unauthorized_scope",
                "caller cannot elevate context scope",
                false,
            ));
        }
        self.materialize(plan, scope)
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
        validate_plan_ids(plan)?;
        if !matches!(scope, "public" | "internal" | "restricted" | "private") {
            return Err(ApplicationError::new(
                "context.invalid_scope",
                "unknown context scope",
                false,
            ));
        }

        // Collect every stable ID the planner ranked, preserving rank order.
        let ranked_ids: Vec<String> = plan.ranked_item_ids.clone();
        if ranked_ids.is_empty() && self.current_task.is_none() {
            return Err(ApplicationError::new(
                "context.empty_plan",
                "context plan has no item ids to materialize",
                false,
            ));
        }

        // Step 2 + 4: verify stable IDs exist + re-fetch canonical text.
        // Rust never trusts Python-supplied text; it re-reads canonical source.
        let fetched = self.corpus.fetch_chunks(&ielts_domain::CorpusFetchQuery {
            ids: ranked_ids.clone(),
        })?;

        // Step 3: re-check authorization. Any missing or restricted/private chunk
        // not explicitly allowed by scope fails closed.
        let mut canonical: BTreeMap<String, &ielts_domain::CorpusChunk> = fetched
            .chunks
            .iter()
            .map(|chunk| (chunk.chunk_id.clone(), chunk))
            .collect();
        if !fetched.missing_ids.is_empty()
            || canonical.len() != ranked_ids.len()
            || ranked_ids.iter().any(|id| !canonical.contains_key(id))
        {
            return Err(ApplicationError::new(
                "context.unknown_stable_ids",
                format!(
                    "plan referenced unknown stable ids: {}",
                    fetched.missing_ids.join(",")
                ),
                false,
            ));
        }

        // Validate every source assignment and authority before trimming can hide it.
        for section in &plan.sections {
            for id in &section.item_ids {
                validate_source_section(canonical[id], section.section)?;
            }
        }
        for item_id in &ranked_ids {
            let chunk = canonical[item_id];
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
        }

        let task_chunk = self.current_task.map(|text| ielts_domain::CorpusChunk {
            chunk_id: "host:current_task".into(),
            source_kind: "host_task".into(),
            source_id: "current_task".into(),
            source_version: 1,
            activity: plan.task_kind.clone(),
            content_hash: rendered_hash(text),
            sensitivity: "internal".into(),
            text: text.into(),
            updated_at: String::new(),
        });
        if let Some(task) = &task_chunk {
            canonical.insert(task.chunk_id.clone(), task);
        }

        // Build per-item materialized records in plan section order, then
        // assemble sections. The Soul/policy section is injected by Rust and
        // cannot be removed by the plan.
        let mut sections: Vec<ContextMaterializedSection> = Vec::new();
        if let Some(task) = &task_chunk {
            let tokens =
                estimate_tokens(&render_item(&task.chunk_id, &task.source_kind, &task.text));
            sections.push(ContextMaterializedSection {
                section: ContextSection::CurrentTask,
                estimated_tokens: tokens,
                items: vec![ContextMaterializedItem {
                    item_id: task.chunk_id.clone(),
                    section: ContextSection::CurrentTask,
                    source_kind: task.source_kind.clone(),
                    source_id: task.source_id.clone(),
                    content_hash: task.content_hash.clone(),
                    sensitivity: task.sensitivity.clone(),
                    estimated_tokens: tokens,
                    rank: 0,
                    score: 1.0,
                    inclusion_reason: "required:host_current_task".into(),
                }],
            });
            let section_budget = plan
                .sections
                .iter()
                .find(|section| section.section == ContextSection::CurrentTask)
                .map_or(0, |section| section.requested_token_budget);
            if section_budget > 0
                && estimate_tokens(&render_context(&sections, &canonical)) > section_budget
            {
                return Err(ApplicationError::new(
                    "context.token_ceiling_exceeded",
                    "current task exceeds section budget",
                    false,
                ));
            }
        }

        // Step 5: inject mandatory Soul/policy; neither host section is droppable.
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
        let soul_budget = plan.sections.iter()
            .find(|section| section.section == ContextSection::SoulPolicy)
            .map_or(0, |section| section.requested_token_budget);
        if soul_budget > 0 {
            truncate_to_budget(vec![sections.last().unwrap().clone()], soul_budget, &canonical)?;
        }
        for section_plan in &plan.sections {
            if section_plan.section == ContextSection::SoulPolicy
                || section_plan.item_ids.is_empty()
            {
                // Python must not duplicate the Rust-injected Soul section.
                continue;
            }
            let mut items: Vec<ContextMaterializedItem> = Vec::new();
            let mut section_tokens: u32 = 0;
            let mut ids = section_plan.item_ids.clone();
            ids.sort_by_key(|id| ranked_ids.iter().position(|ranked| ranked == id).unwrap());
            for item_id in &ids {
                let chunk = canonical.get(item_id).ok_or_else(|| {
                    ApplicationError::new(
                        "context.unresolved_item",
                        format!("plan item {item_id} was not present in canonical fetch"),
                        false,
                    )
                })?;
                let tokens =
                    estimate_tokens(&render_item(item_id, &chunk.source_kind, &chunk.text));
                let reason = plan
                    .inclusion_reasons
                    .get(item_id)
                    .and_then(|reasons| reasons.first().cloned())
                    .unwrap_or_else(|| format!("section:{}", section_plan.section.as_str()));
                let rank = ranked_ids.iter().position(|id| id == item_id).unwrap() as u32 + 1;
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
            let section = ContextMaterializedSection {
                section: section_plan.section,
                items,
                estimated_tokens: section_tokens,
            };
            if section_plan.requested_token_budget > 0 {
                sections.extend(truncate_to_budget(
                    vec![section],
                    section_plan.requested_token_budget,
                    &canonical,
                )?);
            } else {
                sections.push(section);
            }
        }

        // Step 6: enforce hard token ceiling. Trim items by section priority
        // (lowest truncation_rank dropped last) — but SOUL and CURRENT_TASK are
        // never dropped. Over-budget after trimming fails closed.
        let budget = if plan.requested_token_budget == 0 {
            CONTEXT_HARD_TOKEN_CEILING
        } else {
            plan.requested_token_budget.min(CONTEXT_HARD_TOKEN_CEILING)
        };
        sections = truncate_to_budget(sections, budget, &canonical)?;

        // Step 7: generate manifest + rendered_hash. Rendering is deterministic:
        // section order is fixed, item order follows rank, text is canonical.
        sections.sort_by_key(|section| section.section.truncation_rank());
        let rendered_context = render_context(&sections, &canonical);
        let used_tokens = estimate_tokens(&rendered_context);
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
            token_budget: budget,
            used_tokens,
            content_hash: content_hash.clone(),
            rendered_at: chrono::Utc::now().to_rfc3339(),
            sections,
        };

        // Step 8: persist snapshot + items for audit/trace.
        let query_plan_json = serde_json::to_value(plan).map_err(|error| {
            ApplicationError::new("context.serialize_failed", error.to_string(), false)
        })?;
        self.snapshots.insert_context_snapshot(
            &manifest,
            &rendered_context,
            &query_plan_json,
            scope,
        )?;

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
            format!(
                "expected schema version {CONTEXT_PLAN_SCHEMA_VERSION}, got {}",
                plan.schema_version
            ),
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

fn validate_plan_ids(plan: &ContextPlan) -> Result<(), ApplicationError> {
    let ranked: BTreeSet<_> = plan.ranked_item_ids.iter().collect();
    let mut selected = BTreeSet::new();
    let mut sections = BTreeSet::new();
    let mut valid = ranked.len() == plan.ranked_item_ids.len()
        && ranked.len() <= ielts_domain::MAX_CORPUS_FETCH_IDS;
    for section in &plan.sections {
        valid &= sections.insert(section.section.truncation_rank());
        valid &= section.section != ContextSection::SoulPolicy || section.item_ids.is_empty();
        for id in &section.item_ids {
            valid &= selected.insert(id) && !id.trim().is_empty();
        }
    }
    if !valid || ranked != selected {
        return Err(ApplicationError::new(
            "context.inconsistent_plan_ids",
            "ranked and section IDs must match exactly, without duplicates or caller-supplied Soul",
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
        "public" => true,
        "normal" | "internal" => scope != "public",
        "restricted" => scope == "restricted" || scope == "private",
        "private" => scope == "private",
        _ => false,
    }
}

/// The current corpus gateway exports curated reading/writing material only.
/// It has no preference, profile, learner, memory, journal or few-shot source
/// contract. New source kinds fail closed until their ownership rules exist.
fn validate_source_section(
    chunk: &ielts_domain::CorpusChunk,
    section: ContextSection,
) -> Result<(), ApplicationError> {
    if matches!(
        chunk.source_kind.as_str(),
        "reading_asset" | "writing_topic"
    ) && section == ContextSection::RetrievedCorpus
    {
        return Ok(());
    }
    Err(ApplicationError::new(
        "context.invalid_source_section",
        format!(
            "canonical source {} cannot enter {}",
            chunk.source_kind,
            section.as_str()
        ),
        false,
    ))
}

/// Trim one lowest-ranked item from the lowest-priority section at a time.
/// Include all rendering overhead in the budget; remove empty optional sections.
/// SOUL_POLICY and CURRENT_TASK are never trimmed.
fn truncate_to_budget(
    mut sections: Vec<ContextMaterializedSection>,
    ceiling: u32,
    canonical: &BTreeMap<String, &ielts_domain::CorpusChunk>,
) -> Result<Vec<ContextMaterializedSection>, ApplicationError> {
    while estimate_tokens(&render_context(&sections, canonical)) > ceiling {
        // Find the droppable section with the highest (lowest priority) rank.
        let candidate = sections
            .iter()
            .enumerate()
            .filter(|(_, section)| {
                section.section != ContextSection::SoulPolicy
                    && section.section != ContextSection::CurrentTask
                    && !section.items.is_empty()
            })
            .max_by_key(|(_, section)| section.section.truncation_rank())
            .map(|(index, _)| index);
        match candidate {
            Some(index) => {
                let section = &mut sections[index];
                let item_index = section
                    .items
                    .iter()
                    .enumerate()
                    .max_by_key(|(_, item)| item.rank)
                    .map(|(index, _)| index)
                    .unwrap();
                let removed = section.items.remove(item_index);
                section.estimated_tokens -= removed.estimated_tokens;
                if section.items.is_empty() {
                    sections.remove(index);
                }
            }
            _ => {
                return Err(ApplicationError::new(
                    "context.token_ceiling_exceeded",
                    format!(
                        "rendered context exceeds token estimate ceiling {ceiling} after trimming"
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
fn render_context(
    sections: &[ContextMaterializedSection],
    canonical: &BTreeMap<String, &ielts_domain::CorpusChunk>,
) -> String {
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
                let chunk = canonical[&item.item_id];
                out.push_str(&render_item(&item.item_id, &item.source_kind, &chunk.text));
            }
        }
        out.push('\n');
    }
    out
}

fn render_item(id: &str, source_kind: &str, text: &str) -> String {
    // JSON quoting keeps source text/IDs from forging section delimiters. All
    // reference material remains data, never a policy/system instruction.
    serde_json::json!({"itemId": id, "sourceKind": source_kind, "text": text}).to_string() + "\n"
}
