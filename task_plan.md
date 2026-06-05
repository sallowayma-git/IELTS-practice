# Task Plan: Reading/Writing Vue Unification

## Goal
把阅读业务链路重构为写作模块内的一等能力，使用 Vue renderer 统一实现，并收束 Electron/Server/API/设置入口，形成一个 AI native 的完整练习体验。

## Current Phase
Taskbook CORE-10 checkpoint complete. CORE-10 closed the remaining Vue reading test matrix and acceptance gates: reading library/history/asset composables now have explicit core tests, server-side reading provider/parser/sanitizer/suite/history contracts are covered, Vue single-reading E2E is stable across library return/replay/archive flows, and Vue suite-reading E2E accepts the current auto-advance suite state machine instead of assuming a forced per-passage review stop. Required gates now pass: `python3 developer/tests/ci/run_static_suite.py`, `python3 developer/tests/e2e/suite_practice_flow.py`, `node developer/tests/js/practiceVueShell.test.js`, `node developer/tests/js/practiceReadingCore10.test.js`, and `git diff --check`.

## Phases

### Phase 1: Discovery & Current Chain Audit
- [x] Capture user intent and repository constraints.
- [x] Map reading entry points, data ownership, state mutation, API calls, and Electron bridges.
- [x] Map writing Vue app structure and integration surface.
- [x] Record findings in `findings.md`.
- **Status:** complete

### Phase 2: Unified Domain Model
- [x] Define the shared practice/session model for reading, writing, AI coaching, history, and evaluation.
- [x] Identify old reading structures that become adapters only during migration.
- [x] Remove model-level special cases before UI design.
- **Status:** complete

### Phase 3: Renderer Architecture Plan
- [x] Design Vue route/view/component boundaries for the unified AI native practice surface.
- [x] Decide which writing settings remain global and which become session-scoped.
- [x] Define navigation that eliminates the current two-interface transition state.
- **Status:** complete

### Phase 4: API & Electron Boundary Plan
- [x] Collapse scattered reading/writing service calls behind a single client facade.
- [x] Define IPC/local-server contracts aligned with packaged Electron.
- [x] Plan compatibility shims and deletion sequence for legacy file-level hacks.
- **Status:** complete

### Phase 5: Migration Slices
- [x] Split the rewrite into safe vertical slices with rollback points.
- [x] Specify test coverage per slice.
- [x] Keep production behavior intact until replacement path is verified.
- **Status:** complete

### Phase 6: Verification & Delivery
- [x] Produce final architecture/refactor plan.
- [x] Verify plan against existing tests and required CI commands.
- [x] List files/modules affected and first implementation step.
- **Status:** complete

## Key Questions
1. What is the smallest stable data model that can represent both reading and writing practice without compatibility garbage?
2. Which reading features are true product behavior, and which are legacy UI/API patches?
3. Where should AI coaching orchestration live so Vue views do not call random APIs directly?
4. What old entry points must remain temporarily to avoid breaking packaged Electron users?
5. Which tests already cover the current reading/writing flow, and where are the gaps?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Treat the target as a unified practice product, not a reading skin inside writing | The user explicitly wants one complete AI native body, not two switching interfaces. |
| Prefer packaged Electron contracts over legacy `file://` compatibility | Repository instruction says product target is packaged Electron desktop client. |
| Use file-based planning for this task | The refactor plan spans many modules and must survive context compaction. |
| Make Vue the future primary renderer with legacy as fallback during migration | Current Electron navigation is the two-interface transition state the user wants eliminated. |
| Preserve reading coach internals behind a practice API instead of rewriting AI logic first | The AI retrieval/prompt kernel is useful; the broken part is lifecycle ownership and UI/API boundary. |
| Implement Slice 0 as a thin `/api/practice` facade before renderer rewrites | This locks the target contract without changing current user flows. |
| Make Electron load the Vue Practice Shell by default and reserve `index.html` for boot recovery only | This removes the two-interface default without keeping product navigation tied to the old renderer. |
| Store migration/deletion gates in a typed Practice migration matrix | Deletion criteria must be testable data, not comments scattered across UI and Electron code. |
| Route legacy fallback single-reading starts back into Vue through a bounded Electron IPC | Single-reading is Vue-primary even when the user temporarily opens the legacy fallback surface; suite moved to Vue-primary in Slice 8, while listening and some fallback/review surfaces remain guarded legacy paths. |
| Model reading suite as `ReadingSuiteSession` instead of copying window orchestration | The real data is sequence/currentIndex/passages/aggregate; old window postMessage flow is implementation baggage. |
| Delete standalone writing navigation IPC instead of keeping it as a Practice Shell alias | Writing is already a Vue route inside the unified shell; `openWriting` / `navigate-to-writing` would preserve the fake two-page product model. |
| Keep `assets/scripts` as runtime exam-index data only | Python generation/supervisor tools do not belong in packaged runtime assets; moving the live generator under `developer/tests/tools` and deleting dead supervisors keeps the bundle boundary clean. |
| Delete unscheduled mock/path-compatibility E2E scripts | `mock_eval_flow.py`, `mock_upload_flow.py`, and `path_compatibility_playwright.py` are not in the current E2E/static execution graph; real HTTP writing E2E and current runner flows are the maintained coverage. |
| Delete orphaned Electron debug test runners | `electron/test_main.js`, `electron/test-electron-module.js`, and `electron/test_api_runner.js` are standalone debug scripts outside the current CI/runtime graph; keeping package excludes for deleted scripts is repository noise. |
| Make product suite reading Vue-only instead of Vue-then-legacy fallback | Silent product fallback hides broken Vue/API/route failures and keeps users on `suitePracticeMixin`; explicit legacy suite remains only as `test_env`/`suite_test`/`ci` regression coverage. |
| Persist reading suite session state in the Practice data layer | `PracticeService.readingSuiteSessions = new Map()` loses active suite progress on Electron server restart and creates unbounded process memory state. Suite progress belongs in SQLite through `ReadingSuiteSessionStore`, with memory fallback only when no DB exists. |
| Parse Practice reading assets as JSON data instead of executing generated JS | Generated reading exam files are data containers. Running them through `node:vm` keeps script execution in the hot Practice path, increases Electron server overhead, and makes malformed data look like code behavior. |
| Restore submitted single-reading sessions from history, not `PracticeService` memory | Reading submit is synchronous and immediately persisted. A second in-process Map duplicates the same submission, wastes Electron server memory, and disappears on restart. |
| Parse ReadingCoach generated data through the shared reading JSON parser | AI coach retrieval needs raw exam/explanation payloads, but it does not need script execution. Sharing the parser removes the second generated-data execution path without normalizing away coach-specific fields. |
| Store Practice reading history as canonical `submission_json` only | The initial Electron client has no old user data to preserve. Keeping `legacy_record_json`, `legacyRecord`, `realData`, and `resultSnapshot` duplicates payloads, wastes SQLite/JSON parse work, and keeps old replay contracts alive. |
| Bound ReadingCoach generated-data and query caches through a shared cache primitive | AI coach is part of the reading hot path. Unbounded exam bundles and query responses can grow for the entire Electron process lifetime; sharing the bounded LRU helper keeps cache policy in the data layer instead of duplicating local Map pruning. |
| Persist writing `topic_text` as an essay-row summary field | History list/search needs topic text, but not full `evaluation_json`. Burying display/search metadata inside evaluation payload forces every list row to parse a large JSON blob. |
| Rebaseline the Vue rewrite around legacy UX parity | The user asked for Vue-ification of the legacy reading product, not a redesigned resource library. Existing overview/browse/records/read-through clicks are product behavior, not legacy garbage. |
| Use one AI Coach feature setting: `practice.readingCoach.enabled` | CORE-07 needs a customer-disable switch without creating localStorage shadow state or a second settings model. |

## Execution Slices

### Slice 0: Practice Contract/API Facade
- [x] Add `PracticeSession`/`PracticeAsset` contract module.
- [x] Register `/api/practice/assets`, `/api/practice/sessions`, and `/api/practice/coach`.
- [x] Expose reading manifest assets through the practice facade.
- [x] Proxy writing evaluation sessions through the practice facade.
- [x] Add Vue `practice-client` without switching existing pages.
- [x] Add focused API facade regression test.
- **Status:** complete

### Slice 1: Vue Practice Shell
- [x] Convert writing island into practice shell while preserving current writing flow.
- [x] Remove product-level `openLegacy()` dependency from normal Vue navigation.
- [x] Add `/library` route driven by `/api/practice/assets`.
- [x] Add `/writing` compatibility alias back to Compose.
- [x] Let writing assets open Compose through query hydration without overwriting existing drafts.
- [x] Add Vue Practice Shell static contract test and wire it into the static suite.
- [ ] Extract writing compose flow into session-oriented components.
- [x] Keep old routes and writing result flow compatible during migration.
- **Status:** complete for shell scope; writing component extraction deferred behind reading migration

### Slice 2: Vue Reading Asset Rendering
- [x] Load reading asset details from `/api/practice/assets/:activity/:assetId`.
- [x] Render passage and question groups in Vue without executing generated reading scripts.
- [x] Keep answer state in a session-scoped Vue page model.
- [x] Add deterministic reading render/answer contract tests.
- [x] Implement reading submit/scoring/review lifecycle as a real Practice session.
- [x] Wire reading AI coach into the Vue reading page after submit without bypassing Practice context.
- **Status:** complete

### Slice 3: Reading PracticeSession Submit/Review/Coach
- [x] Add server-side reading session submission with `answers`, `correctAnswers`, `answerComparison`, `scoreInfo`, `questionTypePerformance`, and `coachContext`.
- [x] Normalize and compare reading answers server-side, including T/F/NG aliases, letter casing, punctuation trimming, loose text comparison, arrays-as-alternatives, and checkbox arrays-as-sets.
- [x] Store submitted reading sessions in the Practice facade for immediate review state retrieval.
- [x] Let `/api/practice/coach` use a submitted reading `sessionId` to inject authoritative `attemptContext` instead of making Vue compose random coach payloads.
- [x] Upgrade Vue reading page from local answer capture to submit -> readonly review -> AI coach flow.
- [x] Cover submit/review/coach with API facade tests, Vue static contract tests, and browser E2E.
- **Status:** complete for synchronous single-reading submission and review

### Slice 4: Persistent Reading History & Replay
- [x] Persist Vue reading submissions into canonical packaged-Electron SQLite practice history instead of only in-memory/sessionStorage.
- [x] Add Vue-native reading replay route that can load submitted attempts from history.
- [x] Replace select fallback with full drag/drop restore where the product expects drag/drop interaction, while preserving fallback accessibility.
- [x] Persist reading coach snapshot/transcript for submitted Vue reading sessions in the history record.
- [x] Migrate higher-level analysis artifacts into the new PracticeSession model.
- [x] Decide deletion criteria for legacy single-reading runtime after Vue history/replay reaches parity.
- **Status:** complete for persistent history/replay, drag/drop parity, analysis artifact parity, and deletion-gate definition; actual legacy deletion remains blocked by listening and residual fallback/review surfaces

### Slice 5: Reading Analysis Artifacts & Vue Review Intelligence
- [x] Audit legacy `analysisSignals`, `questionTimelineLite`, `highlights`, `markedQuestions`, `singleAttemptAnalysis`, and `realData/resultSnapshot` persistence contracts.
- [x] Promote reading analysis artifacts into the typed `ReadingPracticeSubmission` model instead of burying them in ad hoc metadata.
- [x] Generate canonical analysis signals, question timeline, single-attempt analysis input/output, marked questions, and highlights in the server-side Practice session.
- [x] Persist the same artifacts into `ReadingPracticeSubmission`; Slice 17 removes the legacy history shadow so replay reads the canonical submission only.
- [x] Add Vue-native marked-question controls, answer-change timeline tracking, interaction density submission, and a concise review analysis panel.
- [x] Cover API shape/persistence/replay, Vue static contract, and browser E2E for marked questions, answer changes, analysis panel, and readonly replay.
- [x] Decide deletion criteria for legacy single-reading runtime after Vue analysis/replay parity is validated against real packaged Electron usage.
- **Status:** complete for analysis artifacts and Vue review intelligence; deletion criteria now live in the Practice migration matrix

### Slice 6: Electron Vue Entrypoint & Legacy Fallback Matrix
- [x] Audit Electron `loadLegacyPage()` / `loadWritingPage()` boundary and Vue normal reading route usage.
- [x] Add a typed Practice migration matrix that marks single-reading and writing as Vue-primary.
- [x] Mark suite reading/simulation and listening as legacy fallback with explicit deletion gates at Slice 6; suite reading was later promoted to Vue-primary in Slice 8.
- [x] Expose the migration matrix through `/api/practice/migration-status` and the Vue `practice-client`.
- [x] Render the migration matrix in the Vue Practice Library without adding another settings surface.
- [x] Make Electron default to the Vue Practice Shell while retaining legacy fallback IPC and missing-build fallback.
- [x] Emit `app-runtime-ready` from Vue so the packaged updater boot-health path still works.
- [x] Cover API shape, Vue shell contract, Electron entrypoint, and legacy fallback boundaries with focused tests and full gates.
- **Status:** complete

### Slice 7: Legacy Single-Reading Redirect To Vue
- [x] Audit legacy `openExam()` and `resolveReadingLaunchDescriptor()` entrypoints.
- [x] Add route-aware Electron IPC for internal Practice Shell hash routes.
- [x] Expose `openPracticeRoute()` / `openPracticeReading()` from preload with asset-id validation.
- [x] Return `vue_practice_reading` descriptors for normal generated single-reading launches when the Electron route API is available.
- [x] Keep suite, simulation, review, forced legacy, PDF/manual, and listening paths on existing fallback behavior.
- [x] Update the migration matrix to record `navigate-to-practice-route` as the official Vue route IPC.
- [x] Add VM/static/API tests for legacy single-reading redirect and suite fallback preservation.
- [x] Run full build, static, Vue reading E2E, and suite fallback gates.
- **Status:** complete

### Slice 8: Vue Reading Suite Session Shell
- [x] Audit `suitePracticeMixin` and identify the real suite data model: sequence, current index, per-passage results, drafts/elapsed, and aggregate completion.
- [x] Add typed `ReadingSuiteSession`, passage entries, aggregate score, and create/submit response contracts.
- [x] Add `server/src/lib/practice/reading-suite-sessions.ts` to own P1/P2/P3 selection, active passage ordering, per-passage submit, and aggregate recompute.
- [x] Register `/api/practice/reading-suite`, `/api/practice/reading-suite/:sessionId`, and `/api/practice/reading-suite/:sessionId/passages/:assetId`.
- [x] Add Vue `practiceReadingSuite` client facade.
- [x] Add `/reading-suite/:sessionId` route and `PracticeReadingSuitePage.vue`.
- [x] Update `PracticeLibraryPage.vue` with a Vue-native reading suite entry point.
- [x] Reuse `PracticeReadingPage.vue` for suite passages with `suiteSessionId`, returning to suite progress after submit.
- [x] Extend Electron route allowlist for `/reading-suite/:sessionId`.
- [x] Update migration matrix: suite reading is now Vue-primary, legacy suite remains verified fallback/deletion guard.
- [x] Add API lifecycle, Vue static, and browser E2E coverage for suite creation, P1/P2/P3 progression, passage submit, and aggregate completion.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 9: Residual Legacy Reading Entrypoint Cleanup
- [x] Audit all remaining calls into `reading-practice-unified.html`, `unifiedReadingPage.js`, and reading launch descriptors after suite moved to Vue primary.
- [x] Separate real reading blockers from listening/diagnostic blockers in the migration matrix.
- [x] Remove or reroute legacy reading entrypoints that now have Vue equivalents.
- [x] Add static/API/E2E coverage that proves normal single-reading and suite-reading prefer Vue while explicit fallback remains verified.
- [x] Run full required gates after implementation.
- **Status:** complete

### Slice 10: Legacy Runtime Deletion Readiness
- [x] Audit product-level legacy/writing navigation IPC and residual boot recovery naming.
- [x] Remove `openWriting`, `navigate-to-writing`, `loadWritingPage`, `openLegacy`, `navigate-to-legacy`, and `loadLegacyPage` from product Electron entrypoints.
- [x] Route old More-page writing entry through `electronAPI.openPracticeRoute('/writing')`.
- [x] Split blockers into `boot recovery`, `listening migration`, `explicit legacy suite regression`, and `deletable reading compatibility` buckets in findings/migration status.
- [ ] Audit listening, diagnostic, replay, endless/random, PDF/manual, and forced legacy surfaces that still require `index.html`, `reading-practice-unified.html`, or `unifiedReadingPage.js`.
- [x] Delete or isolate developer-only reading explanation scripts from runtime `assets/scripts`.
- [x] Delete unscheduled mock/path-compatibility E2E scripts and their private fixture pages.
- [x] Delete orphaned Electron debug test runners and remove stale package excludes.
- [ ] Delete or isolate reading-only legacy runtime branches that now have Vue equivalent coverage.
- [x] Add deletion-readiness static checks so new product entrypoints cannot reference standalone writing/legacy IPC.
- [x] Add runtime asset boundary checks so `assets/scripts` cannot grow new Python/supervisor tooling.
- [x] Add dead E2E script boundary checks so removed mock/path-compat scripts cannot silently return.
- [x] Add Electron debug script boundary checks so standalone debug runners cannot silently return.
- [x] Run full required gates after implementation.
- **Status:** checkpoint complete for CORE-10 gate closure; residual legacy runtime deletion remains a later-phase concern outside the current taskbook checkpoint

### Slice 11: Practice Shared/Data Layer Compression
- [x] Audit duplicated Practice helpers in service, route, asset loader, suite sessions, history store, and Vue client.
- [x] Extract shared HTTP error, pagination, JSON, and response envelope helpers under `server/src/lib/shared/`.
- [x] Replace local Practice helper copies with shared calls without changing public API envelopes.
- [x] Centralize Vue Practice endpoint path encoding behind `practicePath()`.
- [x] Centralize JSON parse/stringify helpers for Practice persistence; Slice 17 removes the legacy recovery fallback and makes `submission_json` the only reading replay payload.
- [x] Add API/static tests for pagination clamp, shared route helpers, shared Practice data helpers, and Vue path helper.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 12: Product Suite Fallback Compression
- [x] Re-audit `js/presentation/app-actions.js` suite launch control flow after Slice 11.
- [x] Rename and split the suite paths into product `startVueReadingSuite()` and explicit regression `startExplicitLegacySuiteRegression()`.
- [x] Remove the `tryStartVueReadingSuite() -> false -> startLegacySuite()` control-flow shape.
- [x] Remove stale public `continueSuitePractice` export from `AppActions` because it is no longer referenced by the current product shell.
- [x] Update migration matrix text so suite legacy is regression-only, not product fallback.
- [x] Add contract coverage for Vue API failure, Electron route failure, and all explicit `test_env` / `suite_test` / `ci` legacy regression flags.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 13: Reading Suite Session Persistence
- [x] Re-audit suite session data ownership after product suite fallback compression.
- [x] Add `server/src/lib/practice/reading-suite-store.ts` backed by shared SQLite/JSON helpers.
- [x] Remove `PracticeService` ownership of `readingSuiteSessions = new Map`.
- [x] Persist suite create/get/submit through `practice_reading_suite_sessions`.
- [x] Add schema and phase migration table/index for suite sessions.
- [x] Add API behavior coverage proving suite progress survives across multiple `createServerApp()` instances with the same DB.
- [x] Add static/source contract coverage so `PracticeService` cannot regain a suite-session Map and schema/migration cannot drop the table.
- [x] Update migration matrix so suite session data ownership is a deletion criterion.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 14: VM-free Reading Asset Loading
- [x] Re-audit Practice reading asset loading and identify the two production VM execution points: manifest loading in `PracticeService` and generated exam payload loading in `reading-assets.ts`.
- [x] Move manifest loading into `server/src/lib/practice/reading-assets.ts`.
- [x] Replace `node:vm` execution with strict extraction of the `__READING_EXAM_MANIFEST__ = {...}` assignment and `__READING_EXAM_DATA__.register("key", {...})` payload.
- [x] Parse the extracted object literals with `JSON.parse` and keep the existing asset key mismatch guard.
- [x] Add API coverage for a minified generated wrapper (`p2-low-051`) so the parser is not only tested against pretty output.
- [x] Add static/source contracts forbidding `node:vm` and `runInNewContext` in the Practice reading asset runtime path.
- [x] Update the migration matrix so VM-free reading asset parsing is a deletion criterion.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 15: Single Reading Session Data Ownership
- [x] Re-audit single-reading session ownership after suite sessions moved to SQLite.
- [x] Remove `PracticeService.readingSessions = new Map`.
- [x] Make submitted reading session state and coach context restore only through `PracticeHistoryStore.getReadingSubmission()`.
- [x] Make submitted reading sessions non-cancellable instead of deleting a process-local cache entry.
- [x] Stop `PracticeHistoryStore` from mirroring records into memory when a SQLite database is available; memory fallback remains only for no-DB tests/development.
- [x] Update migration matrix so single-reading session replay ownership is a deletion criterion.
- [x] Add API/static coverage proving submitted reading sessions still replay, cannot be cancelled as active jobs, and cannot regress to `PracticeService` memory ownership.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 16: ReadingCoach Generated Data VM Removal
- [x] Re-audit `server/src/lib/reading/coach-service.ts` generated data loading and confirm it still executes `reading-exams` and `reading-explanations` via VM.
- [x] Extract shared generated JSON assignment/register parser under `server/src/lib/shared/generated-json.ts`.
- [x] Add `server/src/lib/shared/reading-generated-data.ts` for reading manifest, exam, and explanation register payload parsing.
- [x] Make `server/src/lib/practice/reading-assets.ts` reuse the shared reading parser instead of owning a second scanner.
- [x] Replace `ReadingCoachService` VM evaluation with `parseReadingExamDataSource()` / `parseReadingExplanationDataSource()` while preserving raw payloads for chunk building.
- [x] Add static and behavior coverage proving ReadingCoach no longer imports VM and still parses real exam/explanation generated assets.
- [x] Update migration matrix so VM-free generated data loading covers Practice and ReadingCoach runtime paths.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 17: Practice History Payload Single Source
- [x] Re-audit `PracticeHistoryStore`, schema/migration, Practice service state, API facade tests, and Vue E2E mocks for legacy shadow dependencies.
- [x] Add canonical coach persistence fields to `ReadingPracticeSubmission`.
- [x] Remove `legacyRecord` from `PracticeHistoryRecord` contracts and API responses.
- [x] Delete legacy history shadow builders and corrupt-submission recovery from `PracticeHistoryStore`.
- [x] Store and replay reading history through `submission_json` only; existing shadow-column databases are rebuilt instead of migrated because no initial-client data compatibility is required.
- [x] Remove `legacy_record_json` from Electron schema and phase migration.
- [x] Make reading session state return `submission.legacy` only, not a full legacy history record.
- [x] Update API/static/E2E contracts so replay, analysis artifacts, and coach transcript persistence are asserted through `submission`.
- [x] Update migration matrix so the deletion criterion says Practice history is canonical `submission_json` only.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 18: Practice History Summary Hot Path
- [x] Re-audit `/api/practice/history`, `PracticeHistoryStore`, `PracticeService`, Vue Practice Library usage, and reading replay usage after Slice 17.
- [x] Add `PracticeHistorySummary` as the list/create response contract and keep `PracticeHistoryRecord` as detail/replay only.
- [x] Make `PracticeHistoryStore.list()` return summaries in both SQLite and memory fallback paths.
- [x] Change SQLite history list SQL from `SELECT *` to explicit summary columns, excluding `submission_json`.
- [x] Keep `getById()`, `getBySession()`, `getReadingSubmission()`, and coach transcript persistence on full canonical `submission_json`.
- [x] Remove duplicate `historyRecord.submission` from reading create/suite submit responses; the response already returns canonical `submission` at top level.
- [x] Update Vue E2E mocks so history list rows do not carry full submission payloads while history detail/session replay still do.
- [x] Update migration matrix and API/static contracts to lock summary-only history lists.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 19: Practice Reading Asset Payload Cache
- [x] Re-audit `loadReadingManifest()` and `loadReadingPracticePayload()` hot paths after VM-free parsing.
- [x] Move manifest caching fully into `server/src/lib/practice/reading-assets.ts` instead of `PracticeService` instance state.
- [x] Add a bounded module-level normalized payload cache for generated reading exam assets.
- [x] Keep cache ownership at the asset loader/data layer so detail, single-submit, and suite-submit paths share the same normalized payload.
- [x] Add API behavior coverage proving repeated detail/submit calls for the same asset do not grow the payload cache.
- [x] Add cache-bound coverage proving generated payload cache entries stay within the configured limit.
- [x] Update migration matrix and static contracts so repeated generated exam parsing cannot return silently.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 20: ReadingCoach Cache Bound / Shared Cache Primitive
- [x] Re-audit `ReadingCoachService` cache ownership after VM-free generated data parsing.
- [x] Identify `examBundleCache` and `queryCache` as long-running Electron process memory risks.
- [x] Add `server/src/lib/shared/cache.ts` with reusable LRU touch and bounded set helpers.
- [x] Make `server/src/lib/practice/reading-assets.ts` reuse the shared cache helper instead of owning a second local LRU implementation.
- [x] Make `server/src/lib/reading/coach-service.ts` use fixed cache limits for generated exam bundles and query responses.
- [x] Preserve query TTL behavior while adding capacity pruning.
- [x] Add ReadingCoach behavior coverage for cache hits, query-cache eviction, and exam-bundle eviction.
- [x] Update migration matrix/API/static contracts so bounded coach caches cannot silently regress.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 21: Writing Evaluation SSE Replay Cache Bound
- [x] Re-audit `EvaluateService` session ownership and SSE replay cache behavior.
- [x] Identify `sessionEventCache` as a long-running Electron process memory risk because it had a per-session event limit but no session-count limit.
- [x] Reuse `server/src/lib/shared/cache.ts` for replay cache LRU touch and bounded writes.
- [x] Bound writing SSE replay cache to 24 recent sessions while preserving the existing 80-event tail per session.
- [x] Keep active evaluation sessions in `sessions`; treat `sessionEventCache` as transient UI hydration state, not persisted user data.
- [x] Clean inactive `sessionProgress` entries when replay sessions expire or are evicted.
- [x] Add runtime cache stats and writing contract probes for event-tail and replay-session bounds.
- [x] Update migration matrix/API/static/backend contracts so bounded writing replay cache cannot silently regress.
- [x] Run full required gates after planning-file update.
- **Status:** complete

### Slice 22: Writing Essay History Summary Hot Path
- [x] Re-audit `/api/essays`, `EssaysDAO`, `EssayService`, Vue History page usage, and writing evaluation persistence.
- [x] Identify the real Electron hot path: essay history list selected `e.*`, returned `content` / `evaluation_json`, and parsed evaluation JSON per row only to render list summaries.
- [x] Add `essays.topic_text` as a row-level snapshot in schema and migrator.
- [x] Change essay list SQL to select explicit summary columns only, excluding `content` and `evaluation_json`.
- [x] Change history search to use topic title, row-level `topic_text`, and content; stop scanning `evaluation_json`.
- [x] Make `EssayService.list()` use `_decorateEssaySummary()` so list rows never parse full evaluation payloads.
- [x] Keep `getById()` on `_decorateEssayRecord()` so detail paths still parse full `evaluation_json`.
- [x] Persist `topic_text` from writing evaluation sessions into essay rows.
- [x] Add `writing_essay_history_contract.cjs` and static/backend/Vue contract coverage so summary-only history cannot silently regress.
- [x] Run full required gates after implementation.
- **Status:** complete

### Slice 23: Legacy Reading UX Parity Rebaseline
- [x] Re-audit legacy `index.html` information architecture: `总览`, `题库浏览`, `练习记录`, `更多`, `设置`.
- [x] Re-audit legacy overview cards: P1/P2/P3 reading counts, `浏览题库`, `随机练习`, `套题模式`, `无尽模式`.
- [x] Re-audit legacy browse path: type filter, search, sort, list-position preference, `开始练习`, `PDF`.
- [x] Re-audit current Vue deviation: `PracticeLibraryPage.vue` exposes `Practice Library`, migration matrix, resource rows, and engineering copy instead of the original exam overview mental model.
- [x] Reclassify legacy UI shell, overview cards, browse list, and reading workspace layout as product behavior to preserve, not compatibility baggage.
- [x] Restore the opensource suite flow selector in Vue using existing `flowMode` / `frequencyScope` fields instead of hardcoding `simulation/all`.
- [x] Preserve PDF-only asset behavior by making `payloadRef` mean a real generated reading payload and routing PDF-only random/start actions to PDF.
- [x] Remove the suite-submit AI review race by waiting for automatic review persistence before ending submit, including suite passages.
- [ ] Replace `/library` with a Vue `ExamOverviewShell` that mirrors the legacy top-level navigation and labels.
- [ ] Build Vue `OverviewView` using the same category model and action names as `overviewStats` / `overviewView`.
- [ ] Build Vue `BrowseView` that preserves search/filter/sort/list-position/start/PDF behavior while calling Vue/Practice API internally.
- [x] Move migration/deletion matrix out of the user-facing product surface and into tests/dev docs only.
- [x] Rework Vue reading workspace to restore the legacy reading-page interaction shell: settings/notes, selection highlighter, pane divider, bottom question nav, Submit/Reset, and replayable highlights.
- [x] Add the Vue reading `__IELTS_PRACTICE_TIMER__` bridge and submit timer/scroll metadata through the existing attempt -> submission metadata path.
- [x] Preserve legacy timer/scroll aliases during archive/import normalization while writing only canonical submission metadata.
- [x] Feed ReadingCoach/RAG richer per-question behavior context through the existing `questionTimelineLite` records: visit count and elapsed time.
- [x] Add canonical `ReadingSuiteSession.timer` and make Vue suite passages preserve one global timer anchor/mode/limit through the existing timer bridge and submission metadata.
- [x] Add API/E2E guards proving automatic review and manual Coach payloads keep canonical `analysisSignals`, `questionTimelineLite`, and `questionTypePerformance`.
- [x] Sync latest OpenSource generated reading exam/explanation assets needed by the current Vue/Electron reading catalog.
- [x] Restore OpenSource offline highlight dictionary lookup in Vue review mode by loading `assets/wordlists/ielts_core.bundle.js` and `js/core/dictionaryService.js` on demand.
- [x] Keep dictionary/highlight data on existing frontend runtime and canonical `highlights` / vocab fallback paths; do not add Practice backend dictionary fields.
- [x] Fix generated reading data blockers exposed by the VM-free Practice loader: `p3-high-192` exam payload is back to strict JSON data, and `p1-high-194` / `p3-low-151` explanations no longer contain invalid unescaped quotes.
- [x] Add API/static tests for latest OpenSource asset availability, official explanations, dictionary runtime loading, and field discipline.
- [x] Add E2E parity tests that click the same user-visible controls as legacy: 总览 -> 浏览题库, 总览 -> 随机练习, 总览 -> 套题模式, 题库浏览 -> 开始练习, 题库浏览 -> PDF, 练习记录 -> 复盘.
- [x] Preserve suite review return context from history list rows by reusing existing `metadata.suiteSessionId` in both Practice Library history and mixed History page review routes.
- [x] Restore browse list-position memory by reusing `browse_view_preferences_v2` for last asset, filters, search, sort, and scroll restoration.
- [x] Restore custom suite selection by reusing the existing suite create API and `ReadingSuiteSession.sequence` for explicit P1/P2/P3 selections.
- [x] Restore submitted single-reading Reset/retry behavior without changing history schema: clear current review UI/session cache, re-enable controls, reset answer/timer/highlight state, and keep the persisted submission available in history/replay.
- [x] Sync latest OpenSource reading explanation manifest/files and feed passage-note-only official explanations into existing ReadingCoach/RAG explanation chunks without changing prompt wording or API schema.
- [x] Restore the OpenSource Settings theme switcher modal in Vue instead of the fake direct theme rotation, preserving the existing theme application contract.
- [x] Restore OpenSource reading memorize semantics: explicit `mode=memorize&practiceMode=memorize`, normalize old `mode=review` memorize links, and skip PDF-only assets.
- [x] Restore OpenSource ECDICT dictionary bundle and richer reading highlight dictionary bubble metadata in Vue without adding backend/schema fields.
- [x] Restore the OpenSource Settings three-panel first screen in Vue: remove the fake default writing-config panel/toggle, preserve `.settings-system-info` metrics, keep theme options on `theme-options-glass`, and move advanced writing settings into a modal overlay opened by existing actions.
- [x] Restore the Vue reading bottom question nav toward OpenSource structure: `题目导航`, compact `.q-item` primary buttons under `#question-nav`, no redesigned answered/unanswered text, and marked-question affordance kept outside the `.q-item` button while preserving `markedQuestions` payloads.
- [x] Restore Vue reading header controls toward OpenSource structure: header controls keep timer/settings/note, while return/progress/snapshot actions move into bottom `practice-nav` controls with the existing route and snapshot behavior intact.
- [x] Restore Vue submitted review container toward OpenSource structure: submitted results live in `#results`, the score table also uses `.results-table`, and correct/incorrect cells expose `.result-correct` / `.result-incorrect` while AI review/Coach chains remain intact.
- [x] Add dynamic writing top-nav regression coverage so `写作` / `写作题库` / `写作记录` / `设置` / brand clicks stay inside writing routes and never fall back to the reading overview shell.
- [x] Restore Practice Library browse/history OpenSource action markers: `filter-exams`, `search-exams`, `clear-search`, `filter-records`, `export-practice-markdown`, `toggle-bulk-delete`, and `clear-practice-data`.
- [x] Restore the reading page stable OpenSource `#results` injection point immediately after `#question-groups` while keeping review content hidden until submission.
- [x] Restore the OpenSource hidden browse `听力` marker without enabling unsupported listening history controls in Vue.
- [x] Restore the legacy floating Reading Coach host (`#reading-coach-fab` / `#reading-coach-panel`) in Vue while preserving existing Coach payload/action/surface/prompt contracts.
- [x] Restore the OpenSource centered Reading Notes modal geometry and close behavior while preserving existing note persistence.
- **Status:** implementation in progress

### Slice 43: Writing Top Navigation No-Crossline Guard
- [x] Re-audit Vue `NavBar.vue`, `App.vue`, and `main.js` route ownership: reading overview is frameless, writing routes keep the shell nav.
- [x] Confirm existing static contract already forbids leaked reading labels (`题库浏览`, `练习记录`, `练习主页`) in the writing top nav.
- [x] Extend `writing_compose_draft_restore_e2e.py` to rebuild stale writing bundles before file-runtime testing.
- [x] Extend the same E2E to click `写作题库`, `写作记录`, `设置`, `写作`, and the brand route, then assert the URL/page stays on writing routes and `[data-practice-reading-home]` never appears.
- [x] Keep the change test-only: no product navigation rewrite, no Practice API/schema/history change, no AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 44: Migration Matrix Product UI Boundary
- [x] Re-audit Vue product sources for migration/deletion engineering surface: `PracticeLibraryPage.vue`, `PracticeReadingPage.vue`, `PracticeReadingSuitePage.vue`, `HistoryPage.vue`, `SettingsPage.vue`, `App.vue`, and `NavBar.vue`.
- [x] Confirm product Vue pages do not import/use `practiceMigration` and do not render migration/deletion/fallback matrix copy.
- [x] Keep `/api/practice/migration-status`, `practiceMigration`, and `server/src/lib/practice/migration-status.ts` as API/dev/test-owned contracts.
- [x] Add static guard in `practiceVueShell.test.js` so migration/deletion matrix snippets cannot re-enter user-facing Vue UI.
- [x] Keep the change test-only: no product UI rewrite, no Practice API/schema/history change, no AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 45: Practice Library Action Marker Parity
- [x] Re-audit `origin/opensource:index.html` browse/history controls against Vue `PracticeLibraryPage.vue`.
- [x] Identify real DOM parity drift: Vue kept the visual browse/history controls but used local `data-action` / `data-input-action` markers where OpenSource uses `data-index-action` and `data-action-value`.
- [x] Restore OpenSource markers for browse type filter, search, clear-search, record filters, markdown export, bulk delete, and clear records while keeping existing Vue `@click` / `v-model` handlers.
- [x] Strengthen `practiceVueShell.test.js` so these OpenSource markers cannot regress to Vue-only marker names.
- [x] Keep the change renderer-DOM-only: no Practice API/schema/history change, no AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 46: Reading Results Injection Point Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and runtime bundle usage of `#results`.
- [x] Identify real DOM lifecycle drift: OpenSource always mounts empty `#results` after `#question-groups`, while Vue only created it after `submission`.
- [x] Make Vue keep `#results` mounted and hidden when there is no submission; keep the review content, `data-reading-review-panel`, analysis, results table, and Coach lifecycle gated by `submission`.
- [x] Strengthen `practiceVueShell.test.js` so `#question-groups -> #results` and submitted-only review marker behavior cannot regress.
- [x] Keep the change renderer-DOM-only: no scoring, Practice API/schema/history change, no AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 47: Browse Filter Hidden Listening Marker Parity
- [x] Re-audit `origin/opensource:index.html` browse/history type filters against Vue `PracticeLibraryPage.vue`.
- [x] Restore the hidden OpenSource browse `听力` filter marker while keeping Vue history scoped to canonical reading history.
- [x] Strengthen `practiceVueShell.test.js` so the hidden marker and non-reading normalization cannot regress.
- [x] Keep the change renderer-DOM-only: no listening business route, Practice API/schema/history change, or AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 48: Floating Reading Coach Host Parity
- [x] Re-audit `js/runtime/unifiedReadingPage.js` and confirm the original Reading Coach host is floating `#reading-coach-fab` + `#reading-coach-panel`, not an inline right-pane card.
- [x] Replace the Vue inline `.coach-panel` with the legacy floating FAB/panel ids, title, composer ids, message/action/follow-up classes, and open class.
- [x] Keep existing `data-reading-coach-*` anchors and existing Practice Coach payload/action/surface/prompt contracts intact.
- [x] Add UI-only `readingCoachOpen` state so submit/replay expose the floating Coach host while load/reset close it.
- [x] Strengthen `practiceVueShell.test.js` to lock the legacy floating Coach host structure without rewriting AI Coach prompt/RAG/service code.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 49: Reading Notes Modal Parity
- [x] Re-audit `assets/generated/reading-exams/reading-practice-unified.html` and confirm `#notes-panel` is a centered modal, not a right-top floating panel.
- [x] Restore Vue `#notes-panel` modal geometry: centered 400x300 surface, header separator, fixed textarea, `#close-note`, overlay click close, and dialog semantics.
- [x] Keep existing `notesText` localStorage persistence and `#note-btn` lifecycle intact.
- [x] Update `practice_reading_vue_flow.py` so overlay-close coverage clicks a safe backdrop coordinate instead of the modal center.
- [x] Strengthen `practiceVueShell.test.js` so notes modal geometry cannot regress to the redesigned right floating panel.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 50: Reading Settings Panel Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `#settings-panel` uses the compact OpenSource floating panel, not the redesigned wider Vue panel.
- [x] Restore Vue `#settings-panel` geometry and skin: `top: 60px`, `right: 20px`, 260px width, 16px section spacing, equal-width setting buttons, and active accent background with white text.
- [x] Keep existing `readingFontSize`, `readingThemeMode`, suite flow controls, `#settings-btn`, overlay close, and local settings persistence behavior intact.
- [x] Strengthen `practiceVueShell.test.js` so settings panel geometry and active button skin cannot regress to the redesigned 320px panel.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 51: Reading Split Pane Grid Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `.shell` is a three-column grid driven by `--reading-left-pane-width` and `--reading-divider-width`.
- [x] Identify real behavior drift: Vue had `leftPanePercent` and `readingWorkspaceStyle`, but the flex shell ignored the pane-width CSS variable, so divider state did not drive real layout.
- [x] Restore Vue `.reading-workspace.shell` grid columns, 10px divider width, pane min-width behavior, divider drag handle, and hover/focus/drag skin.
- [x] Keep existing pointer drag, keyboard resize, ARIA separator, and pane state ownership intact.
- [x] Strengthen static and E2E coverage so divider resize must change the actual rendered left pane width, not just ARIA state.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 52: Reading Selection Toolbar Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `#selbar` is a compact dark floating toolbar with transparent white-text buttons.
- [x] Restore Vue `.reading-selection-toolbar` geometry/skin: dark `#1e293b` background, white text, 4px padding/gap, transparent buttons, and `#334155` hover.
- [x] Keep existing selection detection, `#btnHL`, `#btnUH`, `#btnNote`, highlight/note behavior, dictionary bubble, and Coach selected context behavior intact.
- [x] Strengthen static and E2E coverage so the toolbar style is checked while visible before highlight application.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 53: Reading Question Nav Item Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `.q-item` is a compact text button using `padding: 6px 12px`, not a fixed square tile.
- [x] Restore Vue `.practice-nav .q-item` padding and remove fixed 42x34 square sizing.
- [x] Keep existing question jump, answered/review status classes, adjacent mark button, marked-question state, and submit/replay payload behavior intact.
- [x] Strengthen static and E2E coverage so q-item padding/min-size is checked on a live answered nav item.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 54: Reading Results/Button Flattening Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `#results`, `.results-table`, `.header-btn`, `.q-item`, `.practice-nav .controls button`, and `.submit-btn` are flattened to 4px OpenSource corners after the IELTS aesthetic tweaks.
- [x] Restore Vue `#results.review-panel` spacing/skin: `margin-top: 18px`, `padding: 18px`, 4px radius, and `.results-table` `margin-top: 12px`.
- [x] Restore Vue reading bottom control and primary submit CSS so `#reset-btn`, `#submit-btn`, and `.q-item` keep 4px radius and `#submit-btn` remains the blue OpenSource primary button despite `.practice-nav .controls button` cascade specificity.
- [x] Restore dropzone and drag-item flattening to 4px without changing drag/drop data ownership, answer payloads, replay, or scoring.
- [x] Strengthen static and E2E coverage for computed `#results`, result table, nav item, and bottom control styles.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 55: Reading Question Group Panel Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `.unified-group` / `.group` use compact OpenSource rhythm: wrapper margin 16px, inner `.group` padding `18px 22px`, `margin-bottom: 0`, and 4px final radius.
- [x] Identify the bad CSS data structure: Vue used one shared `.reading-html :deep(.group), .review-panel` rule, so question groups inherited the redesigned review card's 24px/32px padding and 12px radius.
- [x] Split `.group` and `#results.review-panel` into separate CSS owners so restoring compact question groups cannot pollute submitted review results.
- [x] Keep rendered question HTML, answer inputs, drag/drop, Submit, review table, analysis, replay, and Coach lifecycle unchanged.
- [x] Strengthen static and E2E coverage for live question group wrapper and inner group computed styles.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 56: Reading Dark Mode Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm dark mode is owned by reading shell variables and dark skins, not only a `.dark-mode` class.
- [x] Restore Vue `.reading-page.dark-mode` OpenSource variables and dark skins across header, panels, groups/results, nav, dropzones, drag items, and input/table surfaces.
- [x] Fix the scoped-CSS/v-html ownership bug where legacy dropzones could stay light after theme switch by syncing theme styles through the Vue dropzone lifecycle.
- [x] Strengthen static and E2E coverage for real computed dark colors instead of class-only dark-mode checks.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 57: Reading Pane Density And Timer Affordance Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `#right` padding and `#timer` click affordance.
- [x] Restore Vue `#right` compact `12px 14px` padding.
- [x] Fix timer affordance so clickable pause/resume state renders with pointer cursor, hover opacity, and paused opacity instead of generic `.reading-stat` default cursor.
- [x] Strengthen static and E2E coverage for live right-pane padding and timer cursor.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 58: Reading Mobile Shell Scroll Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` mobile breakpoint and confirm the shell switches to scrollable stacked layout.
- [x] Restore Vue mobile scroll model: page `height:auto`, `overflow:auto`, nav-height bottom padding, shell `display:block`, `height:auto`, and `overflow:visible`.
- [x] Restore OpenSource mobile bottom-control alignment with full-width controls and right alignment.
- [x] Strengthen static and E2E coverage at an 820px viewport for page overflow, shell display/overflow, nav padding, and control alignment.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 59: Reading Question Nav Active State Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `.q-item.active` uses the OpenSource current-question skin: accent border/text, `#eff6ff` light background, and weight 600.
- [x] Add UI-only `activeQuestionId` state driven by existing question-visit lifecycle instead of adding submission/history fields.
- [x] Apply `active` to question nav entries and `.q-item` reactively while preserving answered/review/marked states and question jump behavior.
- [x] Fix the cascade bug where `.answered` could override `.active` by making `answered.active` explicitly keep the current-question skin in light and dark modes.
- [x] Strengthen static and E2E coverage for active q-item state, including live computed styles after returning from dark mode to light mode.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 60: Reading Fixed Bottom Nav Safe Area Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `.practice-nav` is fixed at viewport bottom on desktop and mobile.
- [x] Restore Vue `.practice-nav` fixed bottom docking with `top:auto; right:0; bottom:0; left:0`, overriding stale `.answer-panel` sticky top pollution.
- [x] Move the fixed-nav safe area to `.reading-page` via `padding-bottom: var(--reading-nav-height)` and `box-sizing:border-box`, instead of hard-coding shell height against a fragile header pixel value.
- [x] Preserve OpenSource mobile stacked scrolling, controls alignment, question nav, Submit/Reset, return route, answer state, replay, suite progress, and Coach lifecycle.
- [x] Strengthen static and E2E coverage for fixed nav docking, shell/nav non-overlap, and mobile fixed bottom nav.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 61: Reading Highlight Visual Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm normal `.hl` uses dark brown `#72361c` with white text, while `.hl[data-hl-type="note"]` uses blue `#0369d9` with white text.
- [x] Restore Vue highlight and note-highlight CSS to those OpenSource tokens instead of the redesigned yellow marker and pale-blue note skins.
- [x] Preserve the existing selection toolbar, highlight/note lifecycle, dictionary bubble, selected Coach context, canonical `highlights` persistence, replay, and archive behavior.
- [x] Strengthen `practiceVueShell.test.js` so OpenSource highlight tokens are locked and the old yellow/pale-blue colors cannot return.
- [x] Strengthen `practice_reading_vue_flow.py` so a live Highlight action must render the OpenSource dark-brown background and white text.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 62: Reading Option Label Layout Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm exam option labels use a scoped flex selector group for `.choice-item`, `.checkbox-options`, `.options-list`, `.multiple-choice-options`, `.matching-options`, `.mcq-group`, `.radio-options`, `.radio-group`, `.multiple-choice`, and `.true-false-ng`.
- [x] Identify Vue drift: the generic `.reading-html label` rule rendered option labels as block rows with different spacing, so radio/checkbox controls and text did not match OpenSource alignment.
- [x] Restore the OpenSource option-label and input alignment CSS in the Vue `v-html` question surface without changing question data, answer sync, scoring, or submission payloads.
- [x] Update the Vue reading E2E fixture to use real `.radio-options` and `.checkbox-options` wrappers so computed-style coverage tests the production selector path.
- [x] Strengthen `practiceVueShell.test.js` and `practice_reading_vue_flow.py` for the OpenSource option-label flex layout and input alignment.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 63: Reading Table And Summary Drop Target Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm `.table-section` / `input.blank` and `.drop-target-summary` have separate CSS owners.
- [x] Identify Vue drift: `.drop-target-summary` was grouped with block `.paragraph-dropzone` / `.match-dropzone` dashed boxes, and table completion content only inherited generic table/input rules.
- [x] Restore `.table-section`, `.table-section table`, header/body cells, list spacing, and `input.blank` compact inline sizing to the OpenSource layout.
- [x] Split `.drop-target-summary` back into an inline underline blank with OpenSource base, drag-over, filled, and chip styles.
- [x] Update Vue dropzone theme sync so summary blanks are not force-painted like block dropzones during dark-mode changes.
- [x] Strengthen `practiceVueShell.test.js` and `practice_reading_vue_flow.py` for live table-section and summary blank computed styles.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 64: Reading Settings Font Button Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and confirm the reading settings font-size controls all display `A`, using inline font size (`1.1rem`, `1.25rem`) as the visual cue.
- [x] Identify Vue drift: `fontSizeOptions` used redesigned labels `A+` and `A++`, which changed the visible settings panel copy even though the underlying font-size state worked.
- [x] Restore the OpenSource button semantics in Vue: `normal`, `large`, and `xlarge` all render label `A`, while the larger options apply the OpenSource inline size cue via `:style="option.style"`.
- [x] Strengthen `practiceVueShell.test.js` so `A+` / `A++` cannot return and the inline size cue remains locked.
- [x] Strengthen `practice_reading_vue_flow.py` so the live settings panel must show three `A` buttons with the expected computed font sizes while still applying `font-large` and dark mode.
- [x] Keep the change renderer DOM/CSS/test only: no Practice API/schema/history change, no AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 65: More Vocab Card Copy Parity
- [x] Re-audit `origin/opensource:index.html` More tools card copy and confirm the vocab entry says `SM-2记忆算法，随时继续你的词汇任务。`.
- [x] Identify Vue drift: the vocab card exposed redesigned implementation copy, `本地 Leitner 分箱 + 艾宾浩斯复习节奏`, which is not OpenSource UI copy and leaks scheduling internals into the launcher card.
- [x] Restore the OpenSource vocab card copy while preserving the existing `data-action="open-vocab"` handler and local vocab view mount.
- [x] Strengthen `practiceVueShell.test.js` so the OpenSource vocab card copy is locked and the redesigned implementation copy cannot return.
- [x] Keep the change renderer copy/test only: no vocab scheduling algorithm change, no Practice API/schema/history change, no AI Coach prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 66: More Achievements DOM Contract Parity
- [x] Re-audit `origin/opensource:index.html` and `origin/opensource:css/main.css` for the More-page achievements entry and modal.
- [x] Identify Vue drift: the achievements entry/close button only exposed Vue-local `data-action` markers, the modal content used an inline `max-width: 600px`, and the title was rebuilt with a Vue SVG span instead of the OpenSource `🏆 我的成就` heading.
- [x] Restore OpenSource `data-index-action="show-achievements"` / `data-index-action="hide-achievements"` markers while preserving Vue compatibility `data-action` markers.
- [x] Guard the Vue `showAchievementsTool` / `hideAchievementsTool` handlers with `preventDefault()` and `stopImmediatePropagation()` so restored legacy markers cannot double-trigger delegated handlers.
- [x] Restore the OpenSource `theme-modal-content achievements-modal-content` class, `max-width: 720px`, compact achievements grid density, hidden scrollbar, and plain title copy.
- [x] Strengthen `practiceVueShell.test.js` to lock these DOM/action/class/CSS contracts and forbid returning to inline modal width or the redesigned SVG heading.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 67: First-Run GPL License Modal Parity
- [x] Re-audit `origin/opensource:index.html`, `origin/opensource:css/main.css`, and `origin/opensource:js/presentation/indexInteractions.js` for the first-run license modal.
- [x] Identify Vue drift: packaged Electron now defaults to Vue Practice Library, but Vue had no `#license-modal`, no `data-index-action="accept-license"`, and no `hasSeenGplLicense` first-run gate, so the OpenSource GPL/anti-resale notice disappeared from the primary renderer path.
- [x] Restore the OpenSource modal DOM/copy, `hasSeenGplLicense` localStorage key, double-`requestAnimationFrame` reveal, accept behavior, and `data-index-action="accept-license"` marker in Vue.
- [x] Restore the OpenSource modal CSS owner: backdrop, z-index, card width, typography, warning/info box, and accept-button states.
- [x] Keep this as Vue state/lifecycle only; do not load `indexInteractions.js` or reintroduce legacy delegated action ownership into Vue.
- [x] Strengthen `practiceVueShell.test.js` to lock the modal DOM/copy/storage/action/CSS contracts and forbid inline legacy `onclick`.
- [x] Strengthen `practice_reading_vue_flow.py` so the first Practice Library load accepts the modal through the real button and verifies localStorage persistence before continuing the reading flow.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 68: Reading Header Title Marker Parity
- [x] Re-audit `origin/opensource:assets/generated/reading-exams/reading-practice-unified.html` and compare stable reading-page ids against Vue.
- [x] Identify Vue drift: the header kept the OpenSource `.header-content` structure but dropped `id="exam-title"` and `id="exam-subtitle"`, leaving the final static marker diff in the reading page header.
- [x] Restore the two id markers on the Vue `pageTitle` and `headerSummary` nodes without changing their dynamic text or route/session state.
- [x] Strengthen `practiceVueShell.test.js` so the id markers stay tied to Vue title/summary state.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 69: AI Coach Surface Contract Compression
- [x] Audit current Coach surface/action/promptKind owners across Vue, `js/runtime/unifiedReadingPage.js`, reading routes/types/router, and API facade tests.
- [x] Identify stale contract drift: `practiceApiFacade.test.js` used legacy `surface: 'review_panel'` in the returned `singleAttemptAnalysisLlm` preservation test.
- [x] Replace the stale test payload with canonical `surface: 'review_workspace'`.
- [x] Strengthen `practiceVueShell.test.js` so `review_panel` cannot reappear in Vue reading Coach code.
- [x] Keep the change test-contract-only: no AI Coach prompt rewrite, no RAG route rewrite, no Practice API/schema/history change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 70: Reading History Summary Ownership
- [x] Audit Practice history service list/detail/archive paths and confirm SQLite list omits `submission_json` while detail/replay/export read canonical submissions only when needed.
- [x] Identify Vue drift: `getReadingHistorySuiteSessionId()` looked into `record?.submission?.metadata` and `record?.raw?.metadata`, coupling the history list to detail-only payload shapes.
- [x] Restrict suite context routing from history list to summary `record.metadata` only.
- [x] Strengthen `practiceVueShell.test.js` so the Practice Library source cannot reintroduce `record?.submission?.metadata` or `record?.raw?.metadata` in history list code.
- [x] Keep the change renderer/test only: no server schema, archive, replay, Coach, prompt, RAG, scoring, or submit behavior change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 71: Writing Navigation Audit
- [x] Audit `NavBar.vue`, `main.js`, and `App.vue` for writing top navigation routes, labels, brand target, and frameless reading route boundary.
- [x] Audit existing static tests and `writing_compose_draft_restore_e2e.py` for writing nav positive/negative coverage.
- [x] Confirm writing nav already keeps users in writing module: `/writing`, `/topics`, `/history`, `/settings`, with no reading home route or reading browse/practice query leakage.
- [x] Confirm browser E2E clicks writing nav/brand and fails if `[data-practice-reading-home]` appears.
- [x] Make no code change because no real bug was found.
- **Status:** audit complete

### Slice 72: AI Coach Failure Transcript E2E Contract
- [x] Audit automatic review failure handling and existing backend/API canonical history coverage.
- [x] Identify the real E2E gap: the browser mock returned an SSE error but did not mimic the production failed transcript/snapshot write.
- [x] Update `practice_reading_vue_flow.py` so failed automatic `review_set` writes `readingCoachSnapshot.error`, a `review_set` user turn, and an error assistant turn into the same mocked submission.
- [x] Assert the failed transcript is visible before retry and remains in the cached canonical submission snapshot.
- [x] Keep the change test-only: no AI Coach prompt/query/RAG/Practice API/history schema change.
- [x] Run full required gates.
- **Status:** checkpoint complete

### Slice 73: AI Coach Stream Progress Visibility
- [x] Audit stream status coverage and identify that synchronous E2E streams could skip user-visible intermediate states.
- [x] Add delayed SSE stream helper for successful Coach streams in `practice_reading_vue_flow.py`.
- [x] Emit route, retrieval, generation_start, generation_complete, and complete events for successful automatic review retry.
- [x] Assert `[data-reading-llm-review-status]` visibly shows route, RAG retrieval, review generation, and completion-sync states before success.
- [x] Keep the change test-only: no AI Coach prompt/query/RAG/Practice API/history schema change.
- [x] Run full required gates.
- **Status:** checkpoint complete

### Slice 74: Manual Coach Stream Progress Visibility
- [x] Audit manual `chat_widget` Coach coverage and identify that it asserted payload/final answer but not visible stream progress.
- [x] Reuse the delayed SSE mock for manual Coach requests.
- [x] Assert `[data-reading-coach-stream-status]` visibly shows route, RAG retrieval, manual answer generation, and completion-sync states after clicking `询问教练`.
- [x] Preserve prompt semantics, selectedContext, RAG route, transcript persistence, Practice API, and history schema unchanged.
- [x] Run required gates:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Slice 75: Canonical Archive Field Roundtrip
- [x] Audit `PracticeHistoryStore` list/detail/archive/import paths for canonical ownership.
- [x] Confirm list reads summary columns without `submission_json`; detail/replay/archive read canonical `submission_json` only when needed.
- [x] Confirm archive import reuses `saveReadingSubmission()` and does not create a second reading history shape.
- [x] Strengthen `practiceApiFacade.test.js` archive roundtrip to cover `answers`, `scoreInfo`, `answerComparison`, `duration`, `timerSnapshot`, `markedQuestions`, `highlights`, `questionTimelineLite`, `analysisArtifacts`, `readingCoachSnapshot`, and `readingCoachTranscript`.
- [x] Keep the slice test-only: no schema fields, no Practice API shape change, no legacy `practice_records` write path, no AI prompt/RAG change.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 76: Replay No-Resubmit Audit
- [x] Audit Vue reading replay loader and submit guard.
- [x] Confirm replay route uses `practiceSessions.getState('reading', sessionId)` and not `practiceSessions.create()`.
- [x] Confirm `readOnlyMode` disables controls and blocks `canSubmit`.
- [x] Confirm single-reading E2E request counting fails if replay or archive-import replay posts another `/api/practice/sessions`.
- [x] Confirm suite E2E request counting fails if replay bypasses session/history GETs or calls legacy.
- [x] Make no code change because no real bug was found.
- **Status:** audit complete

### Slice 77: Practice History Action Button Parity
- [x] Compare OpenSource practice-history toolbar button DOM/copy with Vue.
- [x] Restore `📄 导出Markdown` copy.
- [x] Restore OpenSource checkmark SVG before the bulk-delete label while preserving dynamic selected-count copy.
- [x] Restore `🗑️ 清除记录` copy.
- [x] Add static guards for the OpenSource history action copy and icon layer.
- [x] Run required gates:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Slice 78: Practice History Empty-State Parity
- [x] Re-audit latest `origin/opensource:index.html` practice history empty state.
- [x] Identify Vue drift: the empty state used a redesigned `.practice-history-empty` card, `📂`, `暂无任何练习记录`, and a `去题库练习` CTA.
- [x] Restore the OpenSource `history-empty-placeholder` DOM, `📋` icon, `暂无练习记录` copy, and note text.
- [x] Remove the Vue-only empty-card CSS from `PracticeLibraryPage.vue` and add the OpenSource placeholder CSS owner.
- [x] Strengthen `practiceVueShell.test.js` so the redesigned empty state cannot return.
- [x] Run required gates:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Slice 79: Reading Vue Screenshot Acceptance Evidence
- [x] Audit Phase 5 screenshot acceptance coverage and identify that `practice_reading_vue_flow.py` visited the target states but did not persist stable screenshot artifacts.
- [x] Add `REPORT_DIR` and a single `capture_acceptance_screenshot()` helper that saves screenshots and rejects empty files.
- [x] Capture six required single-reading Vue states:
  - reading homepage: `practice-reading-vue-home.png`
  - browse page: `practice-reading-vue-browse.png`
  - settings three-panel page: `practice-reading-vue-settings.png`
  - reading answer page: `practice-reading-vue-answer.png`
  - submitted result page: `practice-reading-vue-result.png`
  - history replay page: `practice-reading-vue-replay.png`
- [x] Return screenshot paths in the E2E JSON evidence.
- [x] Add static guards so screenshot filenames/helper/report directory cannot disappear silently.
- [x] Repair a real canonical Coach persistence regression found by static gates: successful `singleAttemptAnalysisLlm` writeback again updates `submission.analysisArtifacts.singleAttemptAnalysisLlm`.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 83: Reading Suite Review Nav Parity
- [x] Refresh/verify OpenSource reference: `origin/opensource` and `FETCH_HEAD` are both `44a552f265cfddeb844425200fcacfe665d1b340`.
- [x] Audit OpenSource `reading-practice-unified.html` / `unifiedReadingPage.js` against Vue `PracticeReadingPage.vue`.
- [x] Confirm core reading controls are already covered: timer, settings, notes, selection toolbar, divider, question nav, reset, submit, exit, results, memorize/endless status, and Coach panel.
- [x] Identify real parity gap: OpenSource review context injects `#review-nav-bar` with `上一题` / `下一题`, while Vue suite replay exposed only the suite page list and no same-page review nav.
- [x] Restore `#review-nav-bar` in Vue suite replay, deriving prev/next from canonical `suiteSession.sequence`.
- [x] Route navigation through Vue `PracticeReadingReview` / `PracticeReading` routes; do not revive legacy `REVIEW_NAVIGATE` postMessage.
- [x] Add static contract guards and Vue suite E2E assertions for the review nav.
- [x] Run full required gates after planning-file update.
- **Status:** checkpoint complete

### Slice 84: Reading Settings Force Refresh
- [x] Refresh/verify OpenSource reference: local `origin/opensource` / `FETCH_HEAD` are both `44a552f265cfddeb844425200fcacfe665d1b340`; network fetch remains blocked by `HTTP2 framing layer`.
- [x] Audit OpenSource settings/more DOM against Vue `PracticeLibraryPage.vue`.
- [x] Preserve the visible More-page writing card as a current Electron userspace bridge because `App.vue` hides top writing nav on `PracticeLibrary`.
- [x] Identify the real bug: Vue `#force-refresh-btn` reused ordinary `loadReadingData()`, so it did not clear the bounded reading manifest/payload cache.
- [x] Add `refresh` parsing for `/api/practice/assets` and `/api/practice/assets/:activity/:assetId`.
- [x] Route reading refresh through `PracticeService` to `clearReadingAssetCaches()` before list/detail loading.
- [x] Update Vue `practiceAssets.listAll()` so `refresh=true` is sent only on the first pagination page; subsequent pages consume the refreshed manifest without repeating cache invalidation.
- [x] Wire `#force-refresh-btn` to `forceRefreshReadingData()` while keeping ordinary load-library on the hot cache path.
- [x] Add API/static guards for route/client/service refresh wiring and page-1-only full pagination.
- [x] Run required gates:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `node developer/tests/js/practiceApiFacade.test.js`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Taskbook CORE-01/02/03: Practice Core Convergence
- [x] Add explicit `ReadingLibraryStatus` and `ReadingAssetProvider` contracts.
- [x] Add provider files under `server/src/lib/practice/reading/`: `ReadingAssetProvider.ts`, `BuiltinReadingAssetProvider.ts`, and `reading-generated-loader.ts`.
- [x] Reduce `server/src/lib/practice/reading-assets.ts` to a compatibility re-export for generated-loader callers.
- [x] Make reading asset list/detail/session/suite flows resolve data through the provider boundary instead of direct generated-loader imports in `PracticeService`.
- [x] Update `reading-suite-sessions.ts` so suite creation consumes `PracticeAsset[]` instead of manifest entries.
- [x] Split server-side Practice core into `PracticeAssetFacade`, `PracticeHistoryFacade`, `LegacyReadingHistoryAdapter`, `ReadingSuiteFacade`, and `ReadingCoachFacade`.
- [x] Keep `PracticeService` public method names as a compatibility shell so `routes/practice.ts` and `routes/reading.ts` do not need a route rewrite.
- [x] Update API/static contract coverage for provider injection and facade ownership.
- [x] Run full required gates after planning-file update:
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Taskbook CORE-04: Vue Practice Reading API Layer
- [x] Add `apps/writing-vue/src/modules/practice-reading/contracts.ts`.
- [x] Add `apps/writing-vue/src/modules/practice-reading/api.ts` as the single reading module wrapper around raw `practice-client.js`.
- [x] Add `useReadingLibrary.ts`, `useReadingHistory.ts`, `useReadingSuite.ts`, and `useReadingAttempt.ts`.
- [x] Replace `PracticeLibraryPage.vue` direct `practiceAssets` / `practiceHistory` / `practiceReadingSuite` imports with reading composables.
- [x] Preserve UI state ownership in `PracticeLibraryPage.vue`; no panel split yet.
- [x] Update static contract coverage so raw Practice client usage is locked inside the reading module API.
- [x] Run full required gates after planning-file update:
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Taskbook CORE-05: PracticeLibraryPage Panel Split
- [x] Audit existing `PracticeLibraryPage.vue` panel template boundaries and event/data ownership.
- [x] Add `components/ReadingOverviewPanel.vue`, `ReadingBrowsePanel.vue`, `ReadingHistoryPanel.vue`, `ReadingMoreToolsPanel.vue`, `ReadingSettingsPanel.vue`, `ReadingSuiteSelector.vue`, and `ReadingLibraryConfigPanel.vue`.
- [x] Move one panel at a time, preserving existing ids/classes/data attributes and visible copy.
- [x] Keep `PracticeLibraryPage.vue` as layout and active-view/state coordinator for this checkpoint; do not create a second state owner inside child panels.
- [x] Make the page stylesheet global after panel extraction so legacy styles still reach moved DOM.
- [x] Update static coverage for component boundaries, event wiring, exposed settings archive input, and legacy marker preservation.
- [x] Run required gates after implementation:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `npm run build:writing`
  - `npm run build:server`
  - `node developer/tests/js/practiceApiFacade.test.js`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Taskbook CORE-06: PracticeReadingPage Engine Split
- [x] Audit `PracticeReadingPage.vue` against the taskbook order and confirm first slice must be API/loadAsset only.
- [x] Add `apps/writing-vue/src/modules/practice-reading/useReadingAsset.ts`.
- [x] Move reading asset detail state (`asset`, `payload`, `loading`, `error`) and asset list loading behind `useReadingAsset()`.
- [x] Rewire `PracticeReadingPage.vue` so `loadAsset()` delegates asset fetch to `loadReadingAsset()` and keeps suite/replay orchestration in an `afterLoad` hook.
- [x] Rewire endless mode pool refresh through `loadReadingAssetPool()` instead of raw `practiceAssets.listAll`.
- [x] Update static coverage so `PracticeReadingPage.vue` cannot call raw `practiceAssets` again.
- [x] Run required gates for the API/loadAsset slice:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `npm run build:writing`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- [x] Extract timer state, suite timer normalization, and legacy timer bridge into `useReadingTimer.ts`.
- [x] Run required gates for the timer slice:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `npm run build:writing`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- [x] Extract answer read/write model into `useReadingAnswers.ts`.
- [x] Run required gates for the answer-model slice:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `npm run build:writing`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- [x] Extract Coach state/orchestration into `useReadingCoach.ts` after timer and answers are stable.
- [x] Run required gates for the Coach slice:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `npm run build:writing`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- [x] Extract display components only after the engine composables stop owning tangled state.
- [x] Add `ReadingPassagePane.vue`, `ReadingQuestionPane.vue`, `ReadingReviewPanel.vue`, `ReadingCoachPanel.vue`, and `ReadingAnswerNav.vue` as pure props/emits display components.
- [x] Rewire `PracticeReadingPage.vue` to render the five display components while keeping asset, answer, timer, Coach, drag/drop, highlight, submit, replay, and suite lifecycle ownership in the page/composables.
- [x] Convert `PracticeReadingPage.vue` from scoped CSS to page-level CSS and remove `:deep()` selectors so extracted child DOM keeps legacy reading styles.
- [x] Run required gates for the display component slice:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `npm run build:writing`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

### Taskbook CORE-07: AI Coach Isolation
- [x] Spawn three `gpt-5.4` / `xhigh` subagents for disjoint backend, frontend, and test work scopes.
- [x] Add canonical server setting contract `READING_COACH_ENABLED_SETTING_KEY = 'practice.readingCoach.enabled'`.
- [x] Add shared server/front-end normalizers so missing or invalid values default to enabled.
- [x] Gate `ReadingCoachFacade.coach()` before session-context hydration and before `ReadingAssistantService.query()`.
- [x] Return `practice_coach_disabled` when Coach is disabled while keeping `/api/practice/coach` and `/api/practice/coach/stream` registered.
- [x] Reuse the same Practice service gate for legacy `/api/reading/assistant/query` and `/api/reading/assistant/query/stream`.
- [x] Add `readingCoachSettingsApi` under the reading module API so `PracticeReadingPage.vue` does not import raw settings HTTP client.
- [x] Load the Coach setting before loading reading assets/replay state in the reading page.
- [x] Hide `ReadingCoachPanel`, close/reset Coach state, and gate submit-time automatic review and replay-time automatic review refresh when disabled.
- [x] Add a reading settings panel control for enabling/disabling Coach through `/api/settings`.
- [x] Extend API/static coverage for disabled Coach rejection, no ReadingCoach service call, canonical settings key usage, and submit/history/suite availability while disabled.
- [x] Run CORE-07 verification:
  - `node developer/tests/js/practiceVueShell.test.js`
  - `node developer/tests/js/practiceApiFacade.test.js`
  - `npm run build:writing`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
  - `git diff --check`
- **Status:** checkpoint complete

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `git fetch origin opensource` failed with `Error in the HTTP2 framing layer` | 1 | Treated network refresh as non-blocking because `origin/opensource` was already available locally at `44a552f`; continued using the local remote ref for OpenSource parity evidence. |
| `git fetch origin opensource` failed again with `Error in the HTTP2 framing layer` | 2 | Treated network refresh as non-blocking again because local `origin/opensource` still points to `44a552f`; continued the UI parity audit from the available remote ref. |
| `python3 developer/tests/e2e/suite_practice_flow.py` failed once in manual review mode because `#practice-review-nav button[data-review-nav="next"]` stayed disabled until Playwright timed out | 1 | Static suite had already passed its internal suite flow run; reran `python3 developer/tests/e2e/suite_practice_flow.py` serially and it passed with 0 errors and 8 warnings. Logged as a transient E2E timing failure, not a product/code regression from the copy-only Slice 65. |
| `python3 developer/tests/ci/run_static_suite.py` failed during Slice 67 because `practice_reading_suite_vue_flow.py` tried to click `[data-start-reading-suite]` while the newly restored `#license-modal.show` intercepted pointer events | 1 | Added a real `accept_license_modal()` step to the Vue suite E2E, clicking `[data-index-action="accept-license"]` and verifying `hasSeenGplLicense`; added a static guard so the suite E2E cannot forget the first-run license path again. |
| `practice_reading_vue_flow.py` initially failed after adding button skin assertions because `.practice-nav .controls button` overrode `.submit-btn`, making `#submit-btn` render white despite the class being present | 1 | Restored the OpenSource primary override with `!important` on `.submit-btn` border/background/color and added a static guard for that cascade contract. |
| `practiceVueShell.test.js` initially failed after splitting `#results.review-panel` because the assertion depended on exact CSS declaration adjacency | 1 | Replaced the brittle substring with a regex that still locks margin, padding, border, and radius while allowing harmless declaration additions. |
| `python3 developer/tests/ci/run_static_suite.py` failed after centering `#notes-panel` because `practice_reading_vue_flow.py` clicked `.overlay` at its center, which now correctly intersects the centered notes textarea | 1 | Updated the E2E to click a safe backdrop coordinate (`position={"x": 8, "y": 8}`), preserving outside-panel close coverage; reran the Vue reading E2E and full static suite successfully. |
| `python developer/tests/ci/run_static_suite.py` failed because `python` command is unavailable | 1 | Re-ran the same suite with `python3`; it passed. |
| `practiceVueShell.test.js` failed after draft-preservation change because the assertion expected an old zero-argument hydration call | 1 | Updated the test to assert the real contract: query hydration plus `preserveExistingDraft`. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` command is unavailable | 2 | Re-ran the same suite with `python3`; it passed again with the Vue Practice Shell test included. |
| `practice_reading_vue_flow.py` initially waited for a selector missing from stale `dist/writing` output | 1 | Made the E2E rebuild the Vue bundle when source files are newer than `dist/writing/index.html`; rerun passed. |
| Full reading interaction coverage test used `limit=300`, exceeding the Practice API max of `200` | 1 | Changed the test to paginate through all reading assets with `limit=200`; rerun passed. |
| `python developer/tests/e2e/suite_practice_flow.py` failed because `python` command is unavailable | 1 | Re-ran the same E2E with `python3`; it passed with 0 errors and 8 warnings. |
| `python developer/tests/ci/run_static_suite.py` failed again because `python` command is unavailable | 3 | Re-ran with `python3`; it passed with the new reading submit/review/coach coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` command is unavailable | 2 | Re-ran with `python3`; it passed. The script still logs two existing DataCollection save-verification console errors while exiting successfully. |
| `practiceApiFacade.test.js` initially tried to load native `better-sqlite3` for an in-memory persistence test, but the local Node binding is unavailable | 1 | Replaced the direct native dependency with a focused fake SQLite adapter that covers the PracticeHistoryStore SQL surface and still verifies cross-service-instance replay. |
| `python developer/tests/ci/run_static_suite.py` failed again because `python` command is unavailable | 4 | Re-ran with `python3`; it passed with persistent reading history/replay coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` command is unavailable | 3 | Re-ran with `python3`; it passed with 0 errors and 8 warnings. |
| `practice_reading_vue_flow.py` initially failed after drag/drop implementation because replay restored the answer panel but not the native dropzone DOM | 1 | Moved `syncDomAnswers()` until after `loading=false` and `nextTick()` so replay DOM exists before Vue writes dropzone state. |
| `python developer/tests/ci/run_static_suite.py` failed again because `python` command is unavailable | 5 | Re-ran with `python3`; it passed with Vue drag/drop parity coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` command is unavailable | 4 | Re-ran with `python3`; it passed with 0 errors and 8 warnings. |
| `npm run build:server` failed after adding highlight artifact contracts because TypeScript inferred `scope` as plain string and rejected the type predicate | 1 | Rewrote `normalizeHighlights()` as explicit typed array accumulation; server build passed. |
| `npm run build:server` failed after introducing `PRACTICE_MIGRATION_STATUS` because `Object.freeze()` widened literal `renderer/support` fields to `string` | 1 | Removed the pointless freeze and let the `PracticeMigrationStatus` annotation provide the contract; server build passed. |
| `python developer/tests/ci/run_static_suite.py` failed again because `python` command is unavailable | 7 | Re-ran the same required suite with `python3`; it passed with the Slice 6 migration matrix and Electron entrypoint guards. |
| `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` command is unavailable | 6 | Re-ran the same required E2E with `python3`; it passed with 0 errors and 8 warnings. |
| `practiceVueShell.test.js` failed after `loadPracticeShellPage()` gained a route parameter because the assertion was pinned to the old no-arg signature | 1 | Replaced the brittle signature check with route-aware loader assertions: route normalizer, shell URL construction, hash route load, and `mainWindow.loadURL(shellUrl)`. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 8 | Re-ran the same required suite with `python3`; it passed with the legacy single-reading Vue route contract included. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 7 | Re-ran the same E2E with `python3`; suite fallback passed with 0 errors and 8 warnings. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 8 | Re-ran the same required E2E with `python3`; suite fallback passed with 0 errors and 8 warnings after Slice 8. |
| Legacy homepage suite adapter initially read `payload.sessionId` from `/api/practice/reading-suite`, but the real route envelope is `{ success, data }` | 1 | Changed the adapter to read `payload.data.sessionId` and updated `legacySuiteVueRoute.test.js` to use the real envelope. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 9 | Re-ran the same required suite with `python3`; it passed with the legacy suite Vue route contract included. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 9 | Re-ran the same required E2E with `python3`; legacy suite fallback passed with 0 errors and 9 warnings after Slice 9. |
| `simulation_roundtrip_restore_regression.py` failed with `unexpected_back_to_p1:p2-low-148` after explicit `suite_test=1` kept the legacy suite path in classic mode | 1 | Preset suite preferences to `simulation`, waited for real `SIMULATION_CONTEXT`, and verified the standalone regression passes. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 10 | Re-ran the same required static suite with `python3`; it passed with runtime asset and dead E2E boundary guards. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 10 | Re-ran the same required E2E with `python3`; explicit legacy suite fallback passed with 0 errors and 9 warnings after Slice 10 cleanup. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 11 | Re-ran the same required static suite with `python3`; it passed after Electron debug runner deletion, including `Electron 调试脚本边界`. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 11 | Re-ran the same required E2E with `python3`; explicit legacy suite fallback passed with 0 errors and 9 warnings after Electron debug runner deletion. |
| `npm run build:server` failed after the removed Slice 11 corrupt-history recovery because TypeScript rejected a direct `AnyRecord` to `ReadingPracticeSubmission` cast | 1 | That fallback is now deleted in Slice 17; Practice history no longer recovers reading replay from legacy shadow payloads. |
| `npm run build:server` and `practiceApiFacade.test.js` were accidentally started in parallel, and the facade test also builds the server | 1 | Both completed successfully this time, but subsequent required gates are run serially to avoid `server/dist` build-race noise. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 12 | Re-ran the same required static suite with `python3`; it passed with Slice 11 Shared/Data coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 11 | Re-ran the same required E2E with `python3`; explicit legacy suite fallback passed with 0 errors and 9 warnings after Shared/Data compression. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 13 | Re-ran the same required static suite with `python3`; it passed with Slice 12 Product Suite Fallback Compression coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 12 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after product suite fallback compression. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 14 | Re-ran the same required static suite with `python3`; it passed with Slice 13 reading suite session persistence coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 13 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 8 warnings after suite session persistence. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 15 | Re-ran the same required static suite with `python3`; it passed with Slice 14 VM-free reading asset parser coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 14 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 8 warnings after VM-free reading asset loading. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 16 | Re-ran the same required static suite with `python3`; it passed with Slice 15 single-reading session data ownership coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 15 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after Slice 15. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 17 | Re-ran the same required static suite with `python3`; it passed with Slice 16 ReadingCoach generated data VM-free coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 16 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 8 warnings after Slice 16. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 15 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after single-reading session data ownership compression. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 18 | Re-ran the same required static suite with `python3`; it passed with Slice 17 canonical history coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 17 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after Slice 17. |
| `practiceApiFacade.test.js` initially failed after Slice 18 because the new history summary assertion assumed a full-score submission | 1 | Corrected the test to compare summary score against the canonical top-level submission score instead of hard-coding 13. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 19 | Re-ran the same required static suite with `python3`; it passed with Slice 18 history summary coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 18 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 8 warnings after Slice 18. |
| 5.3 Codex subagent spawn failed because the thread limit was reached | 1 | Completed the Slice 19 asset-cache audit locally instead of blocking on new agents. |
| Reading/UI parity subagent spawn failed because the thread limit was reached | 1 | Continue the OpenSource reading DOM/CSS/test audit locally; do not block the Settings checkpoint or subsequent reading-page fix on unavailable agents. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 20 | Re-ran the same required static suite with `python3`; it passed with Slice 19 reading asset payload cache coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 19 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after Slice 19. |
| 5.3 Codex subagent spawn failed because the thread limit was reached | 2 | Completed the Slice 20 ReadingCoach cache-bound audit locally instead of blocking on new agents. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 21 | Re-ran the same required static suite with `python3`; it passed with bounded ReadingCoach cache coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 20 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after Slice 20. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 22 | Re-ran the same required static suite with `python3`; it passed with Slice 21 bounded writing SSE replay cache coverage. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 21 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after Slice 21. |
| 5.3 Codex subagent spawn failed because the thread limit was reached | 3 | Completed the Slice 22 writing history hot-path audit locally instead of blocking on new agents. |
| `writing_contract_probe.cjs` and `readingAnalysisService.test.js` were accidentally run in parallel while both can rebuild `server/dist`; one run failed with a transient `rm: server/dist/types/reading.js: Invalid argument` | 1 | Reran the affected contracts serially; both passed. Keep server-build-mutating tests serial. |
| `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 23 | Re-ran the same required static suite with `python3`; it passed with Slice 22 writing essay history summary coverage. |
| `node developer/tests/js/readingAnalysisService.test.js` failed because OpenSource passage-note-only explanation chunks were generated but not selected into review prompt context | 24 | Added review-route deterministic injection for no-question official explanation chunks and reran the test; it passed. |
| `node developer/tests/js/practiceVueShell.test.js` failed because the new static contract referenced `chunksSource` before reading `server/src/lib/reading/chunks.ts` | 24 | Added the missing source read and reran the test; it passed. |
| `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 22 | Re-ran the same required E2E with `python3`; explicit legacy suite regression passed with 0 errors and 9 warnings after Slice 22. |
| New subagent spawn failed because the thread limit was reached | 4 | Reused existing completed subagent findings and completed the OpenSource asset/dictionary slice locally. |
| `practiceApiFacade.test.js` failed on `p1-high-194` with `reading_explanation_parse_failed` | 1 | Fixed invalid generated explanation JSON by replacing unescaped straight quotes inside JSON strings with valid Chinese quotes. |
| `practiceApiFacade.test.js` failed on `p3-low-151` with `reading_explanation_parse_failed` | 1 | Fixed the same invalid generated explanation JSON issue in the remaining explanation text. |
| `practiceApiFacade.test.js` failed on `p3-high-192` with `reading_asset_parse_failed` because the file had become an executable JS object literal instead of JSON data | 1 | Mechanically normalized the captured payload back into the strict generated JSON register format required by the VM-free Practice loader. |
| New subagent spawn failed because the thread limit was reached | 5 | Reused existing completed subagent findings and continued locally; the active agent findings were sufficient to prioritize entry E2E parity and suite field contraction. |
| New subagent spawn failed because the thread limit was reached | 6 | Completed the suite history replay context fix locally and covered it with static contracts plus Vue suite E2E. |
| `practice_reading_suite_vue_flow.py` initially timed out waiting for `#/library` after clicking `返回练习库` | 1 | The `/library` route is an alias that redirects to the Practice Library root; changed the E2E to wait for `[data-practice-reading-home]` instead of the alias URL. |
| New subagent spawn failed because the thread limit was reached | 7 | Completed the custom suite selection audit locally, using OpenSource `suitePracticeMixin.js` and current Vue/Practice API contracts as source evidence. |
| `practice_reading_suite_vue_flow.py` initially timed out after custom suite creation because the E2E stub reused the same synthetic suite object for the next normal suite create | 1 | Reset the stub sequence on every create call, matching the real API behavior where each create returns a fresh session. |
| `practice_reading_vue_flow.py` initially failed Slice 59 active-state coverage because the test asserted light active colors while the page was still in dark mode | 1 | Changed the E2E to reopen settings, switch back to light mode, wait for `.reading-page` to lose `dark-mode`, then assert the light OpenSource active skin. |
| `practice_reading_vue_flow.py` then failed Slice 59 because `.answered` overrode `.active` on q6 | 2 | Added explicit `.practice-nav .q-item.answered.active` and dark-mode `answered.active` rules so the current-question state wins over answered state. |
| `python3 developer/tests/ci/run_static_suite.py` initially failed Slice 60 in `practice_reading_suite_vue_flow.py` because fixed `.practice-nav` exposed stale `.answer-panel { top: 92px; }` pollution and intercepted q1 radio clicks | 1 | Added `.practice-nav { top: auto; }`, moved safe-area ownership to `.reading-page`, and reran the Vue suite E2E plus full static suite successfully. |
| `practice_reading_vue_flow.py` initially failed Slice 60 non-overlap coverage after using a hard-coded shell height assertion | 1 | Replaced the brittle pixel assertion with DOM geometry: shell bottom must not extend below the fixed nav top, then verified the full single-reading flow. |
| `practice_reading_suite_vue_flow.py` initially timed out waiting for `#review-nav-bar` during the forced suite-state-failure replay branch | 1 | Moved the review-nav assertion to the normal suite replay path. The forced-failure branch intentionally lacks `suiteSession.sequence` and should still prove history-backed replay without same-page suite navigation. |
| `practice_reading_suite_vue_flow.py` then timed out looking for the suite `复盘` button after using `page.goto(file://...)` to enter review | 2 | Avoided full document reloads in the stateful E2E path. The normal review-nav assertion enters the route directly, then returns through the SPA router; the forced-failure branch changes `window.location.hash` inside the existing page so the mock suite/submission state remains intact. |

## Notes
- Do not touch the existing dirty `apps/writing-vue/src/views/SettingsPage.vue` or screenshot files unless the refactor plan requires reading them.
- Required regression commands after implementation changes:
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
