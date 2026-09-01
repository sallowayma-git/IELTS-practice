# Findings: Agent Evolution M1

## Recovered Baseline

- M0 is frozen at commit `aa29e81699f266e2af504149e27b5f3301db4918` and annotated tag `agent-m0-baseline-20260811`.
- Branch `IELTS-WRITING-FEAT` is one commit ahead of its remote at M1 start.
- M0 added no migration; the latest schema remains `0011_agent_runs_tool_calls.sql`.
- The authoritative Evolution Plan identifies M1 as Learning Event Ledger and explicitly keeps existing attempt/business tables as canonical query models.
- M1 must make event capture authoritative in Rust and atomic with its corresponding successful business mutation. Vue must never construct canonical events.
- The M1 audit must preserve user-owned unstaged deletions under `.Jules/palette.md` and `ListeningPractice/**`.

## Scope Guard

- In scope: ledger envelope/taxonomy, migration and indexes, deterministic producers, transactions, idempotency, backfill/repair if required by the plan, privacy/minimization, backup and verification evidence.
- Out of scope: Memory, Dream, Learner Model, Context Compiler, embeddings, skill evolution, and general event sourcing.

## Authoritative M1 Contract

- The exact M1 stage is `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md:5758-5917`.
- Migration `0012_learning_event_ledger.sql` owns one append-only `learning_events` table, five indexes, sensitivity/consolidation state, and a unique idempotency key.
- M1 registers exactly 11 Rust event variants: AttemptStarted, AnswerChanged, AttemptSubmitted, AttemptCompleted, ReadingQuestionOutcome, WritingEvaluationCompleted, CoachQuestionAsked, CoachResponseGenerated, CoachFeedbackProvided, VocabularyReviewCompleted, and AnnotationCreated. Each has an explicit schema version.
- M1 requires Reading completion and question outcomes, Writing completion/degraded/failed quality evidence, Coach question/response/feedback/re-ask evidence, deterministic rebuild/verify, four bounded read-only Agent tools, AttemptReview run kind, and a minimal Reading-result comparison UI.
- Required proof: source mutation plus event atomicity, idempotent retry, rebuild equivalence, cascade/delete behavior, repeated-attempt output, bounded tool output, and no Agent mutation authority.
- Rollback is a generation feature flag; existing business success must not depend on event reads and the table may remain unused.

## Contract Reconciliation Decisions

- The M1 enum at lines 5785-5805 is the stage registry. The broader taxonomy at lines 1879-1931 describes the long-term system and is not permission to add profile, memory, recommendation, or general Agent events in M1.
- Event payloads store stable IDs, schema-versioned structured snapshots that cannot be reconstructed later, sensitivity, and a content hash. They do not copy prompts, messages, answers, essays, or other large text.
- Deterministic keys use event type, stable canonical source identity, and schema version; inserts use the unique key as the database idempotency boundary.
- The plan's DDL uses `attempt_id ... ON DELETE CASCADE`; M1 therefore treats the ledger as privacy-aware rebuildable evidence, not permanent audit. History deletion must remove attempt-bound projections.
- The migration creates schema only. Existing v11 data is handled by a separate deterministic rebuild/backfill path and must never trigger LLM, Coach, Dream, or another network effect.

## Current Architecture Delta

- Existing `&Connection` plus caller-owned `Transaction` patterns are sufficient. M1 does not need a generic Unit of Work abstraction.
- Reading single/suite/endless share an inner submit scope; event production must be placed there so all modes receive the same atomic projection and replay behavior.
- Writing evaluation finalization already has transaction-aware completion/failure cores; those are the event ownership points. Model I/O remains outside the transaction.
- Coach message insert plus thread update currently use separate autocommit statements. Adding event append without first making those operations atomic would be broken dual-write behavior.
- Vocab currently stores only aggregate review state; historical individual grades cannot be rebuilt. A stable per-review canonical record or a deliberately documented post-M1-only projection boundary is required before claiming rebuild equivalence.
- Annotation is an upsert; final state alone cannot distinguish create from update. The producer must use the database operation result, not guess from Vue behavior.
- Explicit Coach feedback and re-ask linkage currently have no canonical DTO/table/command/UI. M1 must add the minimum explicit business record/entry point or honestly leave those event variants dormant; it may not synthesize them from model text.
- Backup uses explicit schema-versioned table allowlists. Adding the ledger requires a new backup schema while freezing the exact v7 table shape for old package compatibility.
- Current migration tests cover fresh/idempotent creation but not a real v11-to-v12 fixture; M1 must add both.
- Static CI uses an explicit Rust test-target allowlist, so new M1 tests must be registered rather than assumed to run.

## Resumed Implementation Findings

- The backend M1 spine is now present: migration 0012, exact 11-type registry, deterministic Reading projector/rebuild/verify, four bounded read tools, AttemptReview run kind, backup v8, propagated generation feature, and Tauri commands.
- The minimum Reading UI is additive and defaults off through `VITE_FEATURE_READING_ATTEMPT_REVIEW_V1`; deterministic comparison loads independently, and Agent explanation requires an explicit click.
- Existing Review UI expected `submission.scoreInfo`, while three Tauri adapters did not uniformly provide it. The adapters now normalize this field rather than adding more template special cases.
- Writing terminal Completed/Degraded/Failed paths have a real transaction boundary. Structured learning events are appended inside that transaction and exclude essay/prompt text.
- Coach user/assistant messages are canonical SQLite truth. Each message now appends its corresponding event in the same short transaction; provider I/O remains outside SQLite transactions.
- AttemptReview event search currently needs an explicit sensitivity filter. Audit redaction alone is not authorization.
- The existing test called “v11 fixture” is not a real upgrade fixture; it opens an already migrated v12 database and must be replaced or supplemented.

## Final M1 Evidence

- The authoritative M1 contract is satisfied without adding a second migration: `0012_learning_event_ledger.sql` is fresh/idempotent, a genuine v11 fixture upgrades to v12, and backup v8 preserves v2-v7 compatibility.
- Reading completion and question outcomes are generated in the shared submit transaction for single/suite/endless flows. Deterministic idempotency, rollback, rebuild equivalence, consistency verification, and `ON DELETE CASCADE` are covered by `crates/ielts-db/tests/learning_events.rs`.
- Writing terminal evaluation projections include score/degradation/error/provider/model references while omitting essay and prompt bodies. Coach user/assistant message events are appended in the message transaction and public frontend append/failure commands were removed; provider I/O remains outside SQLite transactions.
- AttemptReview exposes exactly four bounded read tools. `private`/`restricted` learning events are excluded from search, audit payloads contain summaries only, and model content over 64 KiB is rejected without copying the raw payload to audit.
- The Reading comparison UI is additive and feature-flagged off by default. Deterministic comparison is available independently; an explicit action starts the Agent explanation and persists the run/tool trace.
- The default feature enables event generation; `--no-default-features` compiles the host with generation disabled, preserving business success as the rollback path. Developer rebuild/verify commands are not registered in the default command surface.
- Verification evidence is complete: Rust format/checks/tests, Vue typecheck/build, static CI 18/18, and packaged Tauri practice-flow checks all pass. A default-target Windows linker artifact lock was isolated with `target\\m1-verify`; no source or user-owned data was deleted.
