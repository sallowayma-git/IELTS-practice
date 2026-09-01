# Findings: Agent Evolution Phase 1

## Confirmed Baseline

- Authoritative plan: `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md` (224,276 bytes, modified 2026-08-10).
- Product target: packaged Tauri 2 desktop client with Vue, Rust domain/application layers, and SQLite persistence.
- Current branch: `IELTS-WRITING-FEAT`, tracking `origin/IELTS-WRITING-FEAT`.
- Worktree was clean at task start.
- An active Codex goal was created for complete Phase 1 delivery, verification, and closeout.
- Existing root planning files describe prior Tauri refactoring, Agent backend stage one, Vue visual migration, and CI gate work; they are historical input, not this task's execution record.

## Prior Implemented Foundations Visible From Existing Plan

- `ielts-application` already exists as a vertical use-case layer.
- Agent model/tool protocols and a bounded tool-call loop already exist.
- Agent run/tool-call audit persistence and backup coverage were previously completed.
- Tauri already has OpenAI-compatible tool calling and workspace-scoped file tools.
- Workspace grants, path containment, SHA-256 write protection, loop limits, and lock-release tests were previously completed.

These are leads only. Phase 1 reuse decisions require direct verification against current code and the new Evolution Plan.

## Phase 1 Specification

The engineering roadmap defines stages `M0` through `M12`. The first stage is therefore `M0: baseline freeze, architecture contracts, and observability`; `M1` is the later Learning Event Ledger stage. This task will not skip M0.

The first 650 lines establish these non-negotiable constraints:

- The product is a learning evidence operating system, not a generic chat workspace.
- Learning Truth is immutable to the Agent; Agent output is derived state with provenance.
- Explicit profile, inferred profile, learner model, journal, memory, and procedural strategy are separate data classes.
- SQLite remains the canonical local store; no initial graph/vector/cloud-memory dependency.
- Online capture and offline consolidation are separate; Dream emits proposals and deterministic validators own mutations.
- Active context is bounded and snapshot-based; complete history is retrieved just in time.
- Product Prompt/Skill evolution is offline, eval-gated, versioned, and never hot-swapped mid-session.
- The existing Agent loop, application ports, run/tool audit, LLM runtime, and secure workspace file tools are foundations to reuse.
- The visible Agent workspace is currently a simulated UI prototype and must not be mistaken for the product core.

The roadmap outline shows M0 at lines 5640-5757 with six work items: baseline freeze, real AgentWorkspace wiring, model invocation trace, fake-model replay, Agent security baseline, and ADRs. Exact contracts and DoD remain to be extracted from the full source read.

## Architecture Notes From Full Read

- The plan baseline is commit `5c9fd7c`, with backend foundation `93e4ed4`; current HEAD must be checked for changes beyond that snapshot.
- Keep a Rust modular monolith. External Agent frameworks are research references, not runtime dependencies.
- Four independent chains must stay separate: learning truth, memory, context, and evolution.
- The plan explicitly rejects full event sourcing. Existing attempt tables remain query/current-state models; the future event ledger is an analysis and incremental-processing feed.
- Data-class permissions are explicit: practice truth is read-only to Agent; memory candidates are proposals; active inferred memory changes only through gated services; Soul and active Prompt/Skill versions remain production-Agent read-only.
- Long-term target services are `LearningEventService`, `LearnerModelService`, `MemoryExtractionService`, `DreamService`, `ContextCompiler`, `AgentRunService`, and `EvolutionService`, introduced incrementally rather than as an empty directory/framework dump.
- The future personalized Coach path requires a persisted context snapshot and provenance, while Dream operates on bounded read-only evidence and atomic validated proposals.
- User Profile and Learner Model are different structures: preferences/goals versus measured skill state. A temporary skill weakness must never become a stable personality label.
- The proposed schema is deliberately phased (`0012` through `0018`); M0 should not add the later ledger/memory/dream/learner/eval migrations.
- Every future migration requires fresh-DB and v11-upgrade tests, one transaction, backup coverage, retention/privacy behavior, and rollback/recovery documentation.
- Agent execution audit is distinct from durable conversation threads; the later thread/checkpoint schema must not be pulled into M0 unless M0 explicitly says so.
- Model invocation/context observability must avoid copying large or sensitive business payloads. Stable IDs, content hashes, schema versions, and source references are preferred.
- Business-success and learning-event append must eventually share a Rust transaction; Vue must never construct authoritative learning events. This belongs to M1, not M0.
- FTS5 is the first retrieval layer; embeddings require measured retrieval failure and an index/model rollback story.
- Memory and teaching strategy write thresholds differ: procedural memory has the highest behavioral impact and therefore a higher promotion bar.
- Future memory lifecycle is candidate -> deterministic promotion/review -> active -> superseded/archived/quarantined; conflict never leaves contradictory active slots.
- Dream is an engineering consolidation job, not an online free-form writer. Only its deterministic "Deep" phase may mutate active memory; REM output is proposal-only.
- Desktop scheduling is restart/idle aware. It must not assume the app stays open overnight, and jobs need dedupe/checkpoint/cancellation behavior.
- The learner model begins with human-versioned skill/error taxonomies and an explainable weighted Beta-Bernoulli baseline. Same-question repetitions are explicitly down-weighted.
- Stable weakness claims require evidence diversity across assets/dates and must expose uncertainty; UI must avoid fake precision.
- Context Compiler, not Memory Store, owns relevance, trust, deduplication, token budgeting, provenance, and final model-ready context. It belongs in `ielts-application`, not Vue string assembly.
- User deletion semantics cover both derived memory and source retention so a later Dream cannot silently recreate deleted private conclusions.
- Task kind should primarily come from UI surface/entity hints and deterministic rules, using a classifier only as fallback.
- Context observability requires selected source IDs, scores, truncation reasons, estimates, Prompt/model versions, and hashes/redacted previews; full sensitive text is not the default trace payload.
- Thread compaction is checkpoint state, not long-term memory. Its later promotion requires a separate extractor decision.
- Existing Rust Agent loop remains the runtime. Later thread/checkpoint/cancel/approval/background/streaming capabilities extend it rather than replacing it with an external framework.
- Tool policy must separate effect class, approval, run-kind allowlist, byte/time limits, sensitivity, and idempotency. Canonical learning facts, scores, Soul, and global Prompt are never mutable Agent tools.
- Tool model payload, audit payload, and UI payload have different data-minimization requirements. Current M0 model trace work must preserve that separation.
- Workspace is an observability/advanced-entry surface. Scenario-specific reading/writing features eventually call scoped run kinds directly.
- Coach optimization priority is correctness and safety before adaptation or style; weak behavioral signals alone cannot create stable memory.
- Personalized Coach responses are structured and traceable (`context_snapshot_id`, strategy, evidence, diagnosis), but intervention outcomes must use weak-causal language until stronger study design exists.
- Prompt/Skill/product evolution is a separate developer-governed lane with train/validation/holdout/red-team splits, deterministic and calibrated graders, shadow/canary, hard safety gates, and rollback.
- Production Prompt/Skill runtime reads only active versions; candidate generation is neither evaluator nor release authority.
- Application may temporarily reuse DB DTOs to reduce migration risk, but must not depend on Tauri, reqwest, Keyring, or raw SQLite connections.
- M0's model observability target is materially specified: invocation ID, optional run/thread, feature, Prompt bundle hash/version IDs, optional context/response schema, requested/actual model, status, attempts, token usage, latency, provider request ID, structured error/retryability, timestamps.
- Raw Prompt/response retention is opt-in developer diagnostics only and requires redaction. Normal invocation trace stores metadata/hashes, not full content.
- Tauri commands remain adapters; events improve live UX but SQLite remains the authoritative state for page rehydration.
- Plan inconsistency to resolve during implementation: the sample `llm_invocations` foreign key names `context_snapshots(id)`, while the earlier schema defines `agent_context_snapshots`. M0 must not copy this mismatch blindly.
- M0 UI scope is explicitly the Agent Workspace "first version": real workspace picker, real Agent command, real run ID/round/tool-call/run-result rendering, and removal of simulated timeout. The later three-column/thread/context/approval modes are not M0.
- Feature-unavailable behavior is a compatibility contract: without AI, practice/history still work; deterministic summaries may remain; failed Dream never partially mutates state.
- Trust labels are not decorative. External/model content remains untrusted data after persistence, and only product policy may govern permissions.
- Security baseline prohibits generic SQL/shell/Keyring tools and requires semantic bounded tools, approval for writes/sensitive export, provider data minimization, and continued path/hash protections.
- Backup/audit retention excludes API keys and temporary grants. Default traces should be metadata-heavy and content-light.
- Evaluation is layered from unit/schema through repository, application, model contract, trace, product E2E, longitudinal outcome, and red-team. PR Agent checks use fake models and no external provider.
- Every roadmap phase is a vertical slice with observable UI, tests, and rollback, not a schema-first batch.

## Exact M0 Contract

- Goal: turn the current Agent backend into a replayable, measurable stable baseline before adding Memory automation.
- Scope prohibition: no Memory automation, no Agent tool behavior changes, no product Prompt semantic changes.
- No migration in M0. The full `llm_invocations` table belongs to M2/M3; M0 extends current run results with metadata only.
- Real UI means repository -> `agent_pick_workspace` -> existing `agent_run` -> `agent_get_run` hydration -> actual tool calls/final result. Preserve layout and delete demo data/timers.
- Fake-model baseline enumerates 13 required scenarios: content, read-then-content, multiple tools, unknown tool, invalid args, duplicate ID, max rounds, max tools, provider failure, store failure, interrupted run, hash conflict, and path escape.
- Security evidence enumerates expired grants, symlink containment, sensitive paths, read-hash writes, atomic writes, size/UTF-8 limits, and no file body in audit.
- Required ADRs freeze local-first runtime, SQLite canonical/derived memory, memory-not-truth, offline-only Prompt evolution, and two-product-line/shared-content-UI-language decisions.
- DoD requires a real workspace run, SQLite run/tool hydration, no regression, baseline tests in CI, and a baseline eval report.
- Rollback is route-level only and must leave Reading/Writing/History intact; M0 adds no migration.

Later-stage boundary confirmed: Learning Event Ledger is M1; durable threads/checkpoints/cancellation and the formal invocation table are M2; explicit/manual memory is M3. None belongs in M0.
- Later roadmap confirms strict dependency order: M0 baseline -> M1 ledger -> M2 thread/trace and M3 manual memory -> M4 context; automated candidate/journal/dream/learner/Coach/evolution follow only after their evidence/governance dependencies.
- M0 is the foundation for Alpha A, not an excuse to implement Alpha A in full. Read tools are M1 and durable thread UI is M2.
- Each stage's general deliverable template includes design/ADR, interfaces, adapter/UI, tests, backup/privacy/metrics/rollback/limitations/gate report; for M0, "no migration" means schema/backup changes are explicitly not applicable and should be documented as such.
- Suggested end-state directories are convergence guidance only. The plan repeatedly forbids creating all modules up front; M0 should add only actual code/docs/tests it uses.
- The plan's pseudocode reinforces transaction/network separation, idempotency, proposal-only memory extraction, frozen replay, and read-only shadow tools; these guide later phases but are not M0 implementation scope.
- M0 baseline replay means deterministic fake-model traces against today's Agent contracts, not the M11 frozen-context Prompt evolution replay system.
- Risk controls align with M0: characterization before refactor, wrapper-first UI integration, current route rollback, workspace kept as advanced/trace surface, and no authority derived from model text.
- Final-plan acceptance reinforces the M0 trace/security subset: every tool call has begin/end/status, limits apply, output is size/sensitivity bounded, API keys never enter trace/backup, workspace containment and atomic optimistic writes remain mandatory.
- The complete source read is finished. No later-stage scope is needed to satisfy M0.

## Completion Reconciliation

This section supersedes the historical pre-implementation delta below.

- M0-01: `docs/architecture/agent-m0-baseline.md` records baseline identity, dependency layers, sequence diagram, trace semantics, route rollback, schema version, and checkpoint tag.
- M0-02: `AgentWorkspacePage.vue` now uses `agent-repository.js/.d.ts` and the real `agent_pick_workspace -> agent_run -> agent_get_run` chain. Static files and timer completion were removed.
- M0-03: successful and failed terminal runs persist the same minimized six-field trace in existing `result_json`; no content or user Prompt is persisted there and no migration was added.
- M0-04: all 13 required replay/error/security scenarios have direct tests at the appropriate application, DB, or real file-tool layer.
- M0-05: Windows executes a real symlink or junction containment test without silent skip; sensitive paths use exact table-driven assertions; read/write/replace audit bodies are excluded.
- M0-06: all five required ADRs exist under `docs/architecture/adr/`.
- Rollback: one compile-time flag controls Agent route and navigation. A disabled production build was served and verified in Chromium; Reading/Writing/History remained reachable.
- Final evidence: Rust workspace pass; Vue typecheck/build pass; visual matrix 17/17; static gate 18/18; packaged Tauri gate 16/16; packaged Agent run `9eb1c4da-a59b-4391-820b-74bc742ae99a` rehydrated from SQLite with successful `read_file`, matching path/hash, and header-first provider request ID.

## Final Independent Review Delta (2026-08-11, closed)

- Workspace selection, reset, context selection, and run now share one lock; the reset label describes frontend selection rather than claiming backend grant revocation.
- Runtime parsing uses provider request headers before body completion IDs in both completion and Agent paths.
- Transport/HTTP/malformed-envelope failures preserve `actualModel = null` until a valid provider envelope identifies a model.
- Failed command envelopes expose the generated `runId`; the bridge preserves context/cause ID and Vue hydrates the authoritative failed record while retaining the original error message.
- The packaged Agent gate rejects a failed or incorrect `read_file`, verifies `status`, exact path and SHA-256, verifies the provider observed the real tool result, and proves header request-ID precedence.
- These fixes stayed within M0: no schema migration, tool authority expansion, Prompt semantic change, or M1 behavior was introduced.

## Implementation Delta (historical pre-implementation audit)

### M0-02 Frontend (confirmed missing)

- `apps/writing-vue/src/views/AgentWorkspacePage.vue:209-212` hard-codes three demo files.
- `AgentWorkspacePage.vue:247-249` toggles fake workspace names locally.
- `AgentWorkspacePage.vue:266-276` uses a 420 ms timer to fabricate completion and output.
- The page imports no bridge/repository and calls none of `agent_pick_workspace`, `agent_run`, or `agent_get_run`.
- `apps/writing-vue/src/api/tauri-bridge.js` provides only the generic invoke transport; no Agent repository exists.

Required action: add typed Agent repository, wire picker/run/hydration, replace static file/run data with backend results, preserve current layout.

The current page contract to preserve is a three-panel workbench. Its state machine is only `idle/running/complete`; M0 implementation must add an error state and actual backend-derived details without redesigning geometry. The generic bridge already unwraps `CommandResponse`, so Agent repository can be a narrow adapter rather than duplicate Tauri import/fallback logic.

### M0-03 Backend Trace (partially missing)

- `AgentModelResponse` already carries actual model, latency, usage, and provider request ID; runtime populates them.
- `AgentRunOutcome` currently exposes final-round `model` and `provider_request_id` plus aggregate usage, rounds, and tool count.
- Outcome and SQLite reload lack latency, retry count, and Prompt hash. SQLite also lacks typed persisted actual model/provider request ID/usage.
- Runtime retry loop discards the actual attempt/retry count.
- `agent_get_run` returns `AgentRunRecord`; DB hydration already loads tool calls ordered by sequence, with integration coverage.
- M0 forbids a new invocation table, so the minimal design must extend the current run result/audit JSON and typed DTOs rather than add a migration.

### M0-04 Replay Coverage (incomplete)

- Existing application tests cover content, read-then-content/multiple tools, unknown tool, duplicate call ID, round/tool limits, provider failure, and store-failure semantics.
- Interrupted recovery exists at DB integration level only.
- Explicit invalid-arguments replay is missing from the application fake executor.
- Hash-conflict and path-escape are covered in `src-tauri/src/agent/file_tools.rs`; interrupted recovery is covered in DB tests. They are baseline behaviors but not one consolidated replay fixture.

### M0-05 Security (already implemented and directly covered)

- Workspace expiry/process-local behavior: `workspace.rs` test.
- Symlink containment and path escape: `file_tools.rs` tests.
- `.git`, `.env`, absolute/parent path rejection and non-UTF-8 rejection: one direct test.
- Existing-file writes require the current SHA-256; stale hash returns conflict; successful replacement leaves no temp artifact.
- File read/write size limit and content-minimized audit arguments are tested.
- Atomic replacement implementation exists for Unix and Windows. M0 needs to preserve and report these tests, not rewrite the file layer.

Remaining security test gap: explicit malformed/invalid JSON tool arguments should be pinned as its own replay case. Audit result-body minimization for successful reads/writes must also be checked, not inferred only from argument minimization.

### CI Leads

- Both `tauri-ci.yml` and `release.yml` already run `cargo test --workspace --locked`, so Rust replay/security tests automatically enter CI.
- Existing packaged runtime test directly exercises `agent_get_run` and invalid `agent_run`, but its exact coverage must be read before claiming M0 workspace smoke.
- Existing Agent workspace visual test exists, but current screenshots necessarily validate the demo UI and must be updated for the real state contract.
- `agent_workspace_visual_check.py` directly clicks the second hard-coded file and waits 550 ms for the fake timer. It will become invalid when M0-02 is implemented; the test must inject a deterministic Tauri bridge and assert command-driven state instead.

### M0 Trace Data Flow (main-agent verification)

- `AgentService` begins one persisted run, clones the current message/tool definition request per round, aggregates token usage, audits each tool synchronously, and stores only `{model, hasContent}` at successful finish.
- The current persistence schema already has a flexible minimized `result_json`; M0 metadata can be added there and exposed in `AgentRunOutcome` with no migration.
- Runtime latency currently measures the whole request including retries. The retry loop knows the actual attempt index but returns only `(envelope, latency)`, so a small response-metadata return is needed to preserve retry count.
- Prompt hash should represent stable product-controlled prompt material without persisting user text. M0 can hash the system Prompt used by the run and record the algorithm/meaning in the baseline report.
- Multi-round run metadata requires explicit semantics: aggregate latency/retry/usage across all model calls; final actual model/provider request ID identify the terminal response. This must be documented and tested.
- DB `AgentRunRecord.result` is intentionally flexible JSON; the Vue repository must normalize both immediate `AgentRunOutcome` and hydrated `AgentRunRecord` instead of forcing a schema migration.
- Existing Vue repositories use a JS implementation plus `.d.ts` contract and the shared invoke/unwrap bridge. M0 should follow this pattern with `agent-repository.js` and `agent-repository.d.ts`.
- Vue typecheck includes `src/api/*.d.ts` but does not typecheck `.vue` pages under the current tsconfig. The repository contract will be checked; page behavior needs build/visual/E2E assertions.
- The packaged flow currently proves route rendering, missing-run hydration, and empty-prompt validation only. It does not execute a successful Agent run or exercise workspace selection.
- A successful packaged run cannot rely on external AI. M0 needs either a deterministic local provider fixture within the packaged harness or a clearly scoped packaged adapter smoke plus separate real command integration evidence; route screenshots alone are insufficient.

### Minimal M0 Trace Design Decision

- Add `retry_count` to `AgentModelResponse`; only the Tauri runtime and application fake constructor instantiate this type today.
- Aggregate `latency_ms` and `retry_count` across rounds alongside token usage. Keep terminal `model` and `provider_request_id` semantics.
- Add `prompt_hash` as SHA-256 of the stable system Prompt only. This proves product Prompt identity without hashing/persisting user content.
- Persist the complete minimized metadata object in existing `agent_runs.result_json` and return the same fields in `AgentRunOutcome`.
- Do not change `AgentRunRecord` columns or add migration. Vue hydration reads the result JSON; startup model remains available separately as `record.model`.

## Current Baseline Identity

- Current HEAD: `10b609a14fc275f175d56498a7a7a69592f69dbe` (`test: freeze writing result visual contract`, 2026-08-10T21:41:46+08:00).
- HEAD parent: `2da451f19619185e6f41db3fb4155ff748538b0a`.
- Evolution Plan UI/backend baselines `5c9fd7c`/`93e4ed4` are ancestors; multiple CI/test commits followed the plan snapshot.
- `Cargo.lock` SHA-256 at M0 start: `3323FE5418DDD3D3F22D2B0A8324F794AAFB1C2BBBF0358B265E61B256A68259`, 144,610 bytes.
- Migration directory contains 11 files; the exact latest migration is `0011_agent_runs_tool_calls.sql` and M0 adds none.
