# Findings

## Baseline

- Branch: `codex/audit-tmp-migration`
- HEAD: `2a1801cd6f8ddc721a6971e9e07c39623083cc2d`
- Divergence from `origin/opensource`: 7 upstream-only / 25 branch-only commits.
- Existing dirty files are user-owned accuracy UI and generated bundle changes; preserve them.

## Verified defects from the audit

- Full restore writes only present document envelopes and listed entity stores.
- Partial practice replace can leave detail/annotation orphans.
- Operation journal survives restore and business IDs are reused as operation IDs.
- v1 nested annotations and `scoreInfo.correct/total` are lost from light/full projection.
- Concurrent vocab writes conflict and one update is lost.
- `file://` fallback uses `"file://"` as target origin; Chromium silently drops the message.
- Listening marks completion before INIT/ACK.
- `examSessionMixin.createFallbackRecorder` overwrites the safer app-level fallback.
- DataKernel listeners are realm-local; file-page BroadcastChannel was proven available.
- Row checksum errors currently latch the entire backend.

## Prior live probes

- Full restore left a post-backup vocab word in place.
- Nested v1 import produced `correctAnswers=0`, `totalQuestions=0`, and null annotations.
- Two concurrent vocab upserts produced one fulfillment, one `CONFLICT`, and one saved word.
- Reusing a record ID as operation ID rejected the changed second save.
- A commit in a second file-page realm was readable by the first realm but absent from its committed listener.

## Implementation decisions

- Full-user-data mirror semantics will be prepared in `createImportPlan`; DataKernel stays a validated atomic installer and receives explicit cleared envelopes/all entity layers.
- `resetJournal` is applied inside the same install transaction after checking replay against the old journal; the new journal contains only the restore receipt.
- Partial practice imports may update a subset of stores only when the resulting three recordId sets remain identical; incomplete replace is rejected.
- Cross-realm commit broadcast must not depend on local listeners being registered, otherwise a writer-only child realm would never notify the parent.
- User-owned accuracy changes are source-backed and will be preserved by rebuilding bundles from the modified source files.

## Implemented worktree checkpoint

- `appData.js` now normalizes accuracy values above 1 to ratios, derives `correctAnswers/totalQuestions` from both `scoreInfo.correctAnswers/totalQuestions` and legacy `scoreInfo.correct/total`, and emits percentage separately.
- `splitPracticeRecord` now fills top-level annotation fields from `realData`, then `rawData`, without persisting either legacy mirror.
- Practice light projection now emits sanitized `suiteEntrySummaries`; Browse consumption and regression coverage remain pending.
- `dataKernel.js` has a partial implementation for `CORRUPT_RECORD`, cross-realm commit broadcast, and restore journal reset; exact transaction/error boundaries still need focused source review.

## Remaining data-layer gaps after source review

- `createImportPlan` still has the old contract: full replace only iterates present envelopes, and practice replace only clears/rebuilds stores present in the payload. It must synthesize cleared envelopes for every importable/exportable user-data catalog entry and require all three practice stores for replace.
- Practice merge currently snapshots only source stores and can still produce unequal recordId sets. The resulting three-store sets need validation before `installSnapshot`.
- `backups.restore` does not pass `resetJournal: true`; DataKernel supports it but the public restore path currently preserves the old journal.
- `vocab.saveCollection`, `saveCollections`, `upsertCollectionWord`, `mergeListWords`, and related collection read-modify-write paths are still unqueued bare CAS operations.
- `operationId()` already generates a fresh ID by default; the remaining idempotency bug is at callers that explicitly pass `record.id/sessionId`. Same-request retries must preserve an explicit request/submission operation ID.
- Full-mirror document scope is exactly catalog entries with `export:true` and an import policy other than `ignore`; this includes `backups.settings` but excludes `backups.entries`, backup history, `recovery.windowSession`, and the journal.
- `DataKernel.listEntities` must skip corrupt summary rows so stats/list rendering continue; direct `readEntity` remains the diagnostic path that returns `CORRUPT_RECORD`.
- Vocab RMW coverage is broader than `upsertCollectionWord`: collection/config/word merge, patch, and progress methods all read revisions before CAS. A single realm-local queue plus bounded re-read/retry is the simplest consistent contract.

## Messaging review checkpoint

- Fallback `main.js` still computes `targetOrigin` by accepting any truthy origin before testing `protocol === 'file:'`; therefore a Chromium value of `"file://"` still reaches `postMessage`. The file check must take precedence and the declared parent origin must be normalized to `"null"`.
- Listening still sets `state.completed = true` before INIT/ACK and only retries while `!state.completed`; it has no persisted submission receipt handler.
- Reading highlight UI still treats successful `postMessage` invocation as persistence success. It needs a generated `requestId`, pending request map, ACK/FAILED listener, and direct-AppData fallback only when no host route is available.
- `app.js` defines the richer fallback recorder, while `examSessionMixin.js` still defines another `createFallbackRecorder`; the later mixin assignment can overwrite the richer implementation.
- The main exam mixin already has the correct opaque-origin endpoint (`expectedOrigin:"null"`, wildcard send) and a persisted `PRACTICE_SUBMIT_ACK/FAILED` receipt cache. Listening can join that contract without inventing a second host protocol.
- Listening bootstrap creates a provisional sessionId before INIT; therefore a pre-INIT completion must cache extracted details/submissionId, then build the final payload only after host INIT replaces the provisional sessionId.
- Completion retry timers must resend the cached payload directly. Calling `onComplete()` and rescheduling all timers from inside each timer would create an endless timer-reset loop.
- Business-id reuse existed in `PracticeRecorder.savePracticeRecord`, suite finalize, and the host completion fallback. Recorder now owns one new op per call and reuses it only for its internal retries; submission-correlated host/suite saves derive the op from submissionId.
- `handlePracticeComplete` called the general recorder-session rebind and then called the listening wrapper that delegates to the same general rebind, producing duplicate `handleSessionStarted`; the second call is redundant.
- The remaining suite reset failure was fixture accounting, not a second reset call: the first reading completion correctly invokes the general recorder rebind, leaving one entry in `recorderStarts`; reset invokes `_syncRecorderSessionStarted` once. Reset the probe before the reset request so the assertion measures only reset behavior.
- The Listening bridge already has the intended pending state machine in source: `onComplete` creates one submission, `sendPendingCompletion` refuses to emit before trusted INIT, and retry timers resend the cached payload. The existing parser test is not visibly read by ordinary `Get-Content`, so inspect its encoding before extending it.
- `listeningRecordBridgeParser.test.js` is normal UTF-8 and only covers safe literal parsing; protocol coverage belongs in a separate VM harness. The bridge deliberately exposes `__listeningBridgeComplete` and `__listeningBridgeGetState`, which makes pre-INIT/retry/ACK assertions possible without production-only test hooks.
- The static runner has an explicit `security_regression_tests` list, so the new Listening protocol VM regression must be registered there rather than merely added to the filesystem.
- The vocab dictionary's public API exposes ACK settlement but not the save initiator. A VM-only source injection can expose closure hooks without changing production code, allowing exact assertions that `postMessage` delivery leaves the button pending, FAILED shows `保存失败` when direct AppData is unavailable, ACK shows `已加入`, and direct AppData commit is also accepted.
- Browse completion is not owned by `browseController.js`; that module only controls modes and filters. Existing Browse record tests exercise `BrowsePreferencesUtils`, so the child completion consumer must be located in the legacy view/presentation layer before choosing the regression harness.
- The actual Browse completion index is `rebuildBrowseCompletionIndex` in `legacyViewBundle.js`; both its indexed path and path/file fallback enumerate only `record.suiteEntries`. The existing `legacyViewReadStatus.test.js` is the exact regression surface and currently labels a full `suiteEntries` object as “lightweight”.
- The cross-realm chain is correctly connected: DataKernel remote BroadcastChannel events are dispatched with `remote:true`; `AppData.backups.onDataCommitted` directly subscribes to that kernel listener; ExternalBackupService subscribes once and calls `markDirty` without filtering remote events. The backup regression should emit an explicit remote event so this contract cannot regress silently.
- `practiceRecordPersistence.test.js` already drives the app-level fallback handshake/submit path, but its harness hardcodes an HTTP origin and discards `postMessage` targetOrigin. Extending this existing test to run the fallback completion under `location.protocol='file:'`, `origin='file://'`, event origin `null`, and asserting every reply target is `*` is the smallest realistic origin regression.
- The production protocol scan found completion senders in the inline suite placeholder, Practice Enhancer, unified reading, Listening bridge, and shipped templates, plus an E2E inline fixture. The host now rejects missing correlation metadata, so each sender path must be checked for enrichment rather than assuming literal payloads contain the fields.

## Current Production Reports

- Built-in Reading exams must come strictly from `assets/generated/reading-exams/manifest.js`; imported-library state or AppData readiness must not replace an available built-in index with an empty list.
- `assets/generated/listening-exams/manifest.js` may be absent in distributed packages. Its loader is optional and must not gate Reading browse startup or practice submission.
- The reported save failure reaches `AppData.practice.completeAttempt` through `ExamSystemApp.saveRealPracticeData`; `canonicalizeRecord` rejects `correctAnswers` because the upstream completion normalization produced a negative or non-finite number. The upstream computation must be fixed rather than weakening the non-negative persistence invariant.

## Confirmed Root Causes

- `js/data/v2/dataKernel.js:143-160` reads legacy IndexedDB rows as the value itself. The v1 store actually persisted `{ key, value, timestamp }`, so `practice_records`, library configuration, and active-key values are currently parsed one level too high. The practice migration therefore sees no array and imports zero records.
- v1 used exact `exam_index` as the built-in/default-library sentinel. `migrateLegacyData` copies that value to `library.activeConfigurationId`, while `importedLibraryId` rejects every `exam_index`/`exam_index_*` ID. `LibraryManager.loadActiveLibrary` then treats the invalid sentinel as a non-default library, receives an empty index, dispatches `examIndexLoaded` with `[]`, and never reads the generated Reading manifest.
- Existing poisoned v2 envelopes survive a source fix because document migration skips any existing envelope and practice migration returns as soon as one summary exists. The repair must be idempotent and must merge missing legacy records instead of using collection non-emptiness as completion.
- Reading, Listening, and the generic practice enhancer use object-valued `correctAnswers` for the answer-key map and place the numeric score in `scoreInfo.correct`. Suite aggregates use numeric top-level `correctAnswers`. `canonicalizeRecord` currently validates the overloaded object field before adapting it, so a valid completion fails persistence. The canonical non-negative invariant is correct; the compatibility boundary must select the first valid scalar score candidate and preserve the map separately.
- `LibraryManager.loadActiveLibrary` already treats the Listening manifest as optional for a default library, but an invalid/non-default active ID returns an empty custom index before reaching that code. Empty or invalid active custom state must reset to the default and continue through the manifest path.

## Chosen Hotfix Contract

- Unwrap legacy IDB rows strictly through `.value`; no historical production writer supports raw business values in that object store.
- Translate the v1 exact default sentinel to v2 `null`; never persist the generated Reading `exam_index` cache as user library data.
- Remap valid v1 custom `exam_index_*` libraries to accepted deterministic IDs, but only when their index is a non-empty array.
- Repair poisoned active-library state on startup and make browse startup fall back to the generated Reading manifest when a selected custom library is missing or empty.
- Merge missing legacy records by stable ID, skip already-migrated IDs, and use a versioned repair operation ID.
- Normalize overloaded completion score fields before canonical validation; preserve `correctAnswerMap`, keep legal zeroes, and never accept a negative/non-finite candidate when a later valid candidate exists.

## Supplied Backup: Confirmed Semantics

- `ielts-atlas-backup-2026-07-28T15-14-09-096Z.json` is checksum-valid (`fnv1a-88bc05b5`) but semantically poisoned: all three practice entity stores are empty, `library.activeConfigurationId` is `"[object Object]"`, `library.importedIndexes` is missing, and settings/vocab/achievements contain old `{key,value,timestamp}` rows rather than business values.
- The exporter faithfully captured an already-corrupted v2 database. The product defect is that it labeled a sparse physical snapshot as `scope:"full"`, generated a valid checksum, and provided no semantic validation or completeness manifest.
- Old opensource main UI exports practice records and stats and defaults to merge; it does not import library configuration/active state, so its normal merge/replace path cannot clear the built-in library. The dangerous old `StorageManager.importData` full clear path existed but was not the normal DataBackupManager UI.
- The v2 migration row-wrapper bug is a new regression. Old `StorageManager.getFromIndexedDB` correctly read `request.result.value`; v2 migration read the entire row.
- The supplied file cannot reconstruct missing practice records or lost library configurations by itself. It can safely recover inner settings/vocab/achievement values. Practice/library recovery additionally needs the original `ExamSystemDB` or another older backup.
- The built-in Reading manifest is code, not user data. Only user custom-library configurations/indexes/active selection belong to snapshot state; `null` active always means load the generated manifest.
- A checksum proves byte-level integrity, not business correctness. Import preview must distinguish `trusted-full`, `degraded-partial`, and `invalid` inputs.
- New exports now materialize every exportable catalog key as an explicit `present` or `cleared` envelope. Missing keys in older sparse snapshots are preserved rather than inferred as deletion requests.
- v2 import canonicalization repairs only exact legacy row aliases and rejects cross-domain wrappers. Full snapshots require a coherent library bundle; valid partial library updates remain importable.
- Destructive import preview reports existing/incoming/final/removed practice counts. Commit requires explicit `confirmDestructive:true` after user confirmation.
- Startup uses one versioned `v1ToV2` state. It migrates only an empty v2 database or repairs an exact known poison fingerprint; marker absence alone never replays a frozen v1 database.
- The supplied JSON itself still cannot yield missing practice records: its three entity arrays are genuinely empty. Recovery succeeds only if the user's old IndexedDB or another older backup still contains those records.

## Raw-Data-First Re-audit (Final)

- Historical production has one IndexedDB row contract: `{key,value,timestamp}`. Its `value` is the serialized storage envelope `{data,timestamp,version[,compressed]}`. The old reader returned `request.result.value`; the bad v2 migration uniquely passed the whole row to the legacy parser.
- The whole corruption chain comes from that one wrong boundary. Object documents retained the wrapper, array documents normalized to `[]`, nullable strings became `"[object Object]"`, and practice extraction found no record array. Checksums later certified those already-wrong bytes.
- Raw unprefixed compatibility exists only in Web Storage for `practice_records`, `vocab_user_config`, and `user_achievements`. The reader now accepts exactly those evidenced variants and no speculative raw-IDB shape.
- Initial migration runs only when v2 has no user envelopes and no practice summaries. Exact wrapper/library poison may trigger a narrow repair. A healthy existing v2 database is marked `existing-v2` without reading or replaying frozen v1 data.
- Wrapper repair requires the expected legacy alias and an object payload. It preserves fields added to the outer v2 document after the bad migration.
- Library poison repair restores only exact wrapped legacy index IDs. A poisoned active ID consults the old active ID only when v2 has no usable current index; otherwise it becomes the built-in/default selection and existing v2 custom libraries remain untouched.
- Practice recovery from old storage is limited to initial migration or an exact poisoned state with an empty summary store. This is the only unavoidable ambiguity: after a bad migration, an intentionally cleared empty practice store is indistinguishable from the original collapse while the poison fingerprint remains.
- The built-in Reading index is never user data. `null`/invalid/empty custom selection displays `assets/generated/reading-exams/manifest.js`; this fallback does not mutate the persisted selection. A healthy custom library remains active even during forced reload.
- Sparse or poisoned old backups are degraded to partial imports. Missing keys do not imply deletion, and the supplied file's merge path preserves current practice/library data. Explicit destructive replace requires `confirmDestructive:true`.
- The supplied backup cannot recover practice records or custom indexes because those arrays/envelopes are already empty or absent. Recovery requires the user's surviving old `ExamSystemDB` or an older intact backup; no code fallback can reconstruct data that is absent from both.

## Persistent v1 Reconciliation Decision

- The user explicitly prefers recovery completeness over preventing old v1 records from reappearing after a later v2 deletion.
- Required startup behavior: if canonical v1 data is readable, merge every valid v1 practice record and user library into v2 on every startup; retain valid v2-only additions; replace known wrapper/`"[object Object]"` migration poison with decoded v1 values.
- Repeated startup must be idempotent by stable record/library IDs and checksum/revision comparisons, not by skipping legacy reads through a completion marker.
- The completion marker is diagnostic only. It must never suppress a legacy read or reconciliation, and it must not be rewritten when no business data changed.
- Practice reconciliation is record-based: a complete healthy v2 three-layer record wins on an ID collision; a missing v1 ID is added; a partially present v2 record is replaced atomically from v1 to avoid mixed summary/detail/annotation provenance.
- Library reconciliation is a deterministic union by remapped legacy ID. Healthy v2-only libraries and healthy active selections survive; missing v1 libraries are added; poisoned or dangling active selection is repaired from the v1 active key.
- A failed or incomplete legacy read produces no v2 writes and no marker update; the application continues on existing v2 and retries next startup.
- Exact current gates to remove are `migrateLegacyData`'s completed-marker return and healthy-v2 `existing-v2` return. Library, document, and practice reconciliation must no longer depend on `freshMigration`, `poisonDetected`, or an empty summary collection.
- Existing `practiceLayers(..., true)` exposes all three revisions and `practiceUpserts` already emits a single atomic three-store mutation, so a partial record can be replaced coherently without adding a new kernel repair API.
- `migrateLegacyLibraryData` already compares configuration/index checksums before writing; changing it to an unconditional deterministic union keeps repeated startup diff-only.
- The VM regression now proves that an old completion marker cannot suppress reconciliation, v1-only and v2-only records coexist, complete healthy same-ID v2 records win, partial three-layer records are atomically rebuilt from v1, and a second boot rereads v1 without incrementing any business revision.
- The real IndexedDB regression now updates `ExamSystemDB` after a completed v4 reconciliation, reloads into a new realm, verifies the newly appended v1 record is migrated beside a v2-only record, then proves a third unchanged boot has identical document/entity revisions and checksums.
- Exact wrappers are not the only historical bad output: array/object legacy documents written by the faulty migration can be recognized by their `legacy-documents-*` operation ID. Those documents should be refreshed from the live v1 alias when values differ; later normal v2 writes have a different operation ID and remain authoritative.
- `AppData.practice.delete` removes all three layers without a tombstone. Under the user-selected persistent-union policy, deleting a record that still exists in v1 must therefore be temporary: the next startup restores it.
- Catalog policies provide the general document merge contract needed for “all v1 data”: `patch` objects should include v1-only keys while healthy v2 values win conflicts; `merge-by-id` arrays should include v1-only items while healthy v2 items win the same identity. Exact bad-migration operation IDs remain a full v1 replacement.
- The existing `mergeImportValue`/`mergeCollection` helpers already implement those policies. Calling them as `(legacyValue, currentV2Value)` produces the desired union with healthy v2 winning collisions and avoids a second merge implementation.
- Persistent document reconciliation now applies those catalog policies on every startup: the test proves legacy-only settings and vocabulary are added, current v2 values win shared keys/IDs, and exact bad-migration writes are still replaced rather than merged.
# 2026-07-30 Review Fixes, v2 Insights, And Endless Mode

## Confirmed review regressions

- `js/data/v2/appData.js`: persistent legacy reconciliation currently re-merges `active_sessions`, `temp_practice_records`, `interrupted_records`, and `rejected_completion_payloads`, resurrecting v2-deleted recovery rows.
- `js/utils/BrowsePreferencesUtils.js`: first synchronous preference read returns/caches defaults while async AppData hydration finishes without reapplying the initial filter/scroll state.
- `developer/tests/ci/run_static_suite.py`: the exam app method-contract collector scans only `js/app/*Mixin.js`, while `createFallbackRecorder` now exists only in `js/app.js`.
- `js/data/v2/appData.js`: achievement projection supports an existing unlocked state, but `getAll()` always passes `{}` and no durable v2 progress document currently owns new unlocks.
- `developer/tests/e2e/suite_practice_flow.py`: the E2E predicate reads properties from the Promise returned by async `resolveSuitePreference()`.
- `js/boot-fallbacks.js`: pre-import backup creation happens before semantic preview and user confirmation.

## Lightweight practice insight gap

- `js/main.js` loads `AppData.practice.list({ projection: 'light' })`, but `PracticePriorityRenderer.calculateReadingRadarData()` reads `questionTypePerformance`, `answerDetails`, and `scoreInfo.details`, all of which live only in v2 detail records.
- The production radar therefore receives records with no classifiable wrong-answer data and reports zero errors.
- Suite child records are deleted after finalization; `suiteEntrySummaries` currently preserve score metadata but no compact question-type error counts.
- The appropriate contract is a compact derived `questionTypeErrorCounts` field on summaries and suite-entry summaries, not a fallback to loading every detail record.
- `filterByExamType()` also ignores existing `suiteEntrySummaries`; it can consume those without a new API.

## Endless mode

- `js/presentation/app-actions.js` initializes `endlessState` as `null`, writes `endlessState.examIndex` before constructing the object, and deterministically throws on the first start.
- The generated runtime-entry bundle contains the same defect and is what `index.html` executes.
- The unified reading page only emits `ENDLESS_USER_EXIT` when an endless marker is present, but current first/subsequent exam opens do not add that marker.
- Subsequent endless exams manually navigate/register/start a session instead of using the normal `app.openExam()` lifecycle, risking stale window/session state.
- Focused regressions must execute the lifecycle; the existing endless test only scans source strings.

## Source-contract decisions after main-agent read

- The root README confirms bundles are the only production runtime and must be rebuilt from source; `file://` remains a required execution mode.
- Recovery documents are cataloged as authoritative/exportable `merge-by-id` data. Their backup/import semantics should remain intact; only startup legacy reconciliation needs a one-shot policy.
- `lightFromCanonical()` is the canonical summary constructor and `lightSuiteEntry()` is the canonical compact suite-entry constructor, so derived error counts belong in those two functions and will naturally persist in `practiceSummaries`.
- `filterByExamType()` currently consults the entire exam index before record metadata. It should first honor `suiteEntrySummaries`, then the summary's own type, and only use the exam index as a legacy fallback.
- The current import fallback has a clean sequencing boundary: preview and optional confirmation end immediately before `commitImport()`, making backup creation safe to move to that point without changing payload validation.
- `openExam()` already owns reused-window cleanup, launch-library provenance, session registration, recorder start, and injection. Endless follow-up navigation should call this path instead of duplicating those responsibilities.
- Achievement tests currently assert `getAll()` performs one `practiceSummaries` list and no document reads; adding durable progress intentionally changes that contract to one `achievements.progress` read and requires updating the focused harness/catalog expectations.
- Existing Browse preference coverage is concentrated in `developer/tests/js/browsePreferencesRecords.test.js`; it already models AppData preference failures and is the right place for delayed-hydration ordering coverage.
- The static method contract has a single collector in `run_static_suite.py`; scanning `app.js` alongside mixins fixes the source-of-truth mismatch without duplicating a method.
- The recovery facade exposes discard/complete methods that write a cleared/current v2 envelope, so the transient reconciliation regression can model the real user path and reboot the shared kernel.
- `unifiedReadingLockRegression.test.js` is already registered by the static suite and can host an executable VM lifecycle check for first open and countdown-driven window reuse without adding another runner block.

## Final implementation and residual gates

- New practice writes persist answer-free `questionTypeErrorCounts` in summaries and suite-entry summaries. `practice.listInsights({limit:10})` supplies the same contract for historical rows by reading only the bounded missing details; annotations and all-history detail scans remain excluded.
- Browse activation now awaits preference hydration before reading the persisted filter, and initial preference UI/scroll restoration use the same readiness promise.
- Achievement unlock facts are stored in exportable/importable `achievements.progress`; deleting source practice rows no longer relocks them.
- Endless mode now constructs state atomically, marks the unified URL, opens first and later exams through `app.openExam()`, reuses the stable tab, and cleans up/report failures.
- The final full static report passed every gate changed by this work. Its remaining failures are outside this scope: the pre-existing v2 migration allowlist mismatch, noisy suite-regression JSON parsing, four NB replay content fixtures, and the 480-second Reading quick audit timeout.
- The suite E2E reached lazy loading, persisted preference setup, and window launch after its two runner API fixes, then stopped at the existing first-passage readiness timeout caused by unavailable local exercise resources.

## Residual gate triage

- The v2 unique-entry failure is a guard allowlist drift: `run_static_suite.py` still anchors the allowed AppData legacy-import region at the removed `findDeclaredValue` symbol. The legacy reads are confined to the intended v1 compatibility/migration boundaries; repair the semantic allowlist and keep a negative guard case.
- `suiteModeRegression.test.js` exits successfully and prints pass JSON on its final stdout line. The static runner incorrectly parses the entire noisy stdout as one JSON document even though it already has a last-line JSON helper.
- All four NB replay failures are stale tests. The runtime now requires a trusted `INIT_SESSION`, `source: exam_host`, and a matching window token; with that protocol the four resources restore answers, answered state, highlights, text, and mirror data correctly. `p2-high-201` also needs its test selector scoped to the clone group.
- Reading quick is not merely a slow-machine timeout. It spends about 218 seconds launching Node/VM once per 232 static datasets, then twelve UI cases each exhaust a 30-second wait for an obsolete or premature `#results` contract. Fix the page-ready/result contract and batch the static exporter before revisiting the 480-second outer bound.
- Suite E2E does not fail because the optional listening manifest is absent. `_buildExamPlaceholderUrl()` drops the parent's test mode, so `exam-placeholder.html` identifies itself as non-test, sets `examState=blocked`, and never enables completion. Propagate the narrow `suite_test=1` flag and rerun the full suite chain.
- Release recommendation: repair the three test-infrastructure failures promptly to restore a trustworthy green gate; keep Reading UI and suite end-to-end paths release-blocking until their real chains run successfully.

## Residual gate repair design

- Reading quick currently opens the unified page as a top-level `file://` document. Even after the click handler binds, submission intentionally cannot post to itself; results render only after a correlated `PRACTICE_SUBMIT_ACK`. The audit must host the page in an iframe, perform the existing `REQUEST_INIT`/`INIT_SESSION` handshake, wait for `SESSION_READY`, and ACK `PRACTICE_COMPLETE`.
- No new Reading runtime-ready sentinel is needed: `SESSION_READY` is emitted only after action and message listeners have been attached.
- The Reading exporter can add an `--all` mode that loads all 232 registered datasets into one VM/context. Python should consume that bundle once instead of launching Node once per exam.
- Suite placeholder propagation should use the already-supported narrow `suite_test=1` query flag. The template and environment detector need no behavior change.
- The NB replay fixture must retain the production trusted-message gate and instead send a valid INIT plus matching token/source. Its selectors must be scoped to the same clone-enabled group so `p2-high-201` covers the intended case.

## Final verification (2026-07-31)

- Placeholder reuse can render before the next `INIT_SESSION`; URL-level `suiteFlowMode` recovery now makes simulation/stationary behavior deterministic, while late contexts preserve submitted-final navigation.
- The unified static suite passes all checks. The only fixture-level correction was adding `practice.listInsights()` to the practice-persistence AppData stub.
- Bundle drift is green for all 14 outputs; eight historical symbol-collision warnings remain explicitly non-blocking.
- The legacy migration fixture should derive its fresh timestamp from `Date.now()` and include a 31-day stale row to keep TTL cleanup explicitly covered.
- Main-agent marker verification confirmed bounded semantic regions: DataKernel legacy constants end before `function clone`; AppData import recognition ends before `entityRowFromLayer`; AppData document migration ends before kernel initialization; migration fixtures are bounded by their harness/main functions rather than whole-file exemptions.
- The existing reliable-submit E2E already contains a compact file-compatible iframe host and correlation helpers. Reading audit can embed a smaller auto-ACK variant, operate on the named frame, and retain page-level screenshots/console collection.
- `suiteModeRegression.test.js` already exposes native `URL`/`URLSearchParams` in its VM sandbox, so the placeholder URL query and special-character round-trip can be covered without new harness dependencies.
