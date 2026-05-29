# Task Plan: Reading/Writing Vue Unification

## Goal
把阅读业务链路重构为写作模块内的一等能力，使用 Vue renderer 统一实现，并收束 Electron/Server/API/设置入口，形成一个 AI native 的完整练习体验。

## Current Phase
Slice 33 checkpoint complete: OpenSource/legacy custom suite selection is restored in Vue. The suite selector can enter `custom` scope, the existing browse list captures one P1/P2/P3 asset each, and `/api/practice/reading-suite` creates the suite from an explicit canonical `sequence` while still using the same `ReadingSuiteSession.sequence` contract. No reading AI prompt/RAG code was changed.

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
- **Status:** in progress

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
- [ ] Move migration/deletion matrix out of the user-facing product surface and into tests/dev docs only.
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
- **Status:** implementation in progress

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
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

## Notes
- Do not touch the existing dirty `apps/writing-vue/src/views/SettingsPage.vue` or screenshot files unless the refactor plan requires reading them.
- Required regression commands after implementation changes:
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`
