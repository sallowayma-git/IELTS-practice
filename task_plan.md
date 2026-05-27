# Listening Record Persistence Repair Plan

## Goal
Restore reliable listening practice completion persistence for child listening pages opened from the parent app, including direct `file://` use.

## Current Understanding
- Parent app opens/listens to a child page and expects `postMessage` completion payloads.
- Current failure appears to be: child page finish/submit DOM interaction is not captured reliably, so no completion message returns to parent.
- Parent/child protocol also lacks a robust handshake, so listener timing and session identity can drift.

## Constraints
- Preserve existing reading/listening practice flows.
- Stay compatible with `file://`; avoid server-only assumptions.
- Keep QA code under `developer/tests/`.
- Do not include planning files in release/commit unless explicitly requested.
- After code changes, run:
  - `python developer/tests/ci/run_static_suite.py`
  - `python developer/tests/e2e/suite_practice_flow.py`

## Phases
| Phase | Status | Notes |
| --- | --- | --- |
| 1. Recover context | complete | Previous catchup script returned exit 1 with no output; inspected dirty worktree and prior partial changes. |
| 2. Trace protocol/data flow | complete | Found `SESSION_READY` conflated bridge-loaded with init-ack, letting parent stop handshake too early. |
| 3. Implement minimal protocol fix | complete | Child now distinguishes pre-init/initialized ready and asks for init; parent keeps handshake alive until initialized. |
| 4. Add regression coverage | complete | Added parent handshake regression and optional browser finish-DOM coverage. |
| 5. Verify | complete | Targeted JS checks, bundle build, optional listening E2E, static suite, and suite practice E2E passed using `py` because `python` alias is broken. |
| 6. Continue handoff repair | complete | Fixed remaining complete-before-ready recorder session hole and legacy fallback parent handshake/session matching. |
| 7. Final fallback/listening QA hardening | complete | Fixed legacy fallback spelling-error persistence, strengthened optional listening E2E for 3-column/data-q/real parent vocab assertions, rebuilt bundles, and reran required suites. |
| 8. Real file:// static bridge repair | complete | Added static listening bridge to all 225 P1-P4 HTML pages, removed 55 legacy listening `practice-page-enhancer.js` producers, added CI/static/E2E coverage for true no-flag file:// persistence. |
| 9. Spelling error vocab audit | complete | Repaired spelling-error-to-vocab data shape so saved misspellings are full study words with Chinese meanings, notes, examples, SM-2 fields, and preserved error metadata. |
| 10. Optional built-in listening manifest gate | complete | `assets/generated/listening-exams/manifest.js` now gates built-in listening; imported listening libraries still restore the entrance; static/release guards added. |

## Errors Encountered
| Error | Attempt | Resolution |
| --- | --- | --- |
| `session-catchup.py` exited 1 with no output | `python D:\codex\.codex\skills\planning-with-files\scripts\session-catchup.py ...` | Logged and continued from git diff/planning files. |
| Optional listening E2E failed on 3-column spelling errors | `py developer/tests/e2e/listening_bridge_optional.py` | Fixture asserted `spellingErrors` without loading `spellingErrorCollector.js`; centralized bridge fixture injection. |
| Optional listening E2E timed out in `data-q` fixture | `py developer/tests/e2e/listening_bridge_optional.py` | Fixture had no result table and manually called completion with `allowGenerated:false`; switched only that fixture to generated-detail mode. |
| Real Chrome file:// unique-origin blocked parent injection | User reproduced with `P2 Plan of Community Center` and parent handshake timeout | Made each P1-P4 listening child page self-load `js/bundles/listening-record-bridge.bundle.js`; parent injection remains fallback only. |
| Old listening `practice-page-enhancer.js` could double-submit with new bridge | Static scan found 55 pages with old enhancer | Removed old enhancer from formal listening P1-P4 pages so each page has one completion producer. |
| `bash -n developer/release.sh` failed on CRLF line endings | Syntax check reported `unexpected token elif` | Normalized `developer/release.sh` to LF and added `.gitattributes` to keep it LF. |
| Default release script smoke run could not create zip | `bash developer/release.sh manifest-gate-check` | Current bash environment lacks `zip`; release logic was still syntax-checked and guarded by static suite, but no dist zip was generated. |

## Final Repair Notes
- Parent app now treats the current opened window's `examId + expectedSessionId` as the identity source of truth for listening bridge completions.
- Before a listening bridge completion reaches `PracticeRecorder.handleSessionCompleted`, the parent now ensures an active recorder session exists and synchronizes its `sessionId`.
- This keeps `PracticeRecorder`'s production synthetic-session guard intact while removing the bad timing dependency on initialized `SESSION_READY`.
- Legacy `main.js` fallback messaging now keeps INIT retries alive for `initialized:false`, responds to `REQUEST_INIT`, and can match completion messages by child window when the child still carries a temporary session id.
- Legacy fallback now recognizes `{ realData: ... }` completion wrappers and saves normalized `spellingErrors` to the vocabulary collector after the practice record is persisted.
- Optional listening E2E now proves real `file://` parent persistence writes both `practice_records` and `vocab_list_p1_errors` / `vocab_list_master_errors` with the parent exam id, `p1` source, and captured user input.
- Formal listening HTML now owns its bridge dependency. All 225 P1-P4 HTML pages include exactly one `listening-record-bridge.bundle.js` script before `</body>` with `data-listening-record-bridge="true"` and a relative path that resolves under `file://`.
- The 55 old `practice-page-enhancer.js` tags in listening P1-P4 were removed to eliminate duplicate `PRACTICE_COMPLETE` producers.
- `developer/tests/ci/run_static_suite.py` now fails if any formal listening page misses the bridge, uses a bad relative path, lacks the data marker, duplicates the bridge, places it after `</body>`, or reintroduces the old enhancer.
- Optional listening E2E now opens `P2/次高频/8. P2 Plan of Community Center (VIP)` in a browser launched without `--allow-file-access-from-files`; it verifies static bridge load, initialized handshake, Finish capture, and `practice_records` persistence.

## Spelling Error Vocabulary Repair Notes
- The spelling-error collector now accepts both legacy object lists (`{ id, words: [...] }`) and arrays written back by the vocab study store.
- Saved spelling errors are enriched before persistence: `meaning`, `example`, `note`, SM-2 scheduling defaults, `createdAt/updatedAt`, and spelling metadata are present at rest.
- Chinese meanings come from `window.__EMBEDDED_WORDLISTS__.ielts_core` when available; otherwise the collector can load `assets/wordlists/ielts_core.json` with a `file://` compatible XHR fallback.
- `VocabStore` no longer treats `你曾拼写为: ...` as `meaning`. Missing lexicon entries use `暂无中文释义`, while misspelling context stays in `note`.
- Vocab study updates now preserve `userInput`, `questionId`, `examId`, `errorCount`, accepted answers, canonical answer, reason code, confidence, token index, and metadata.

## Optional Built-in Listening Manifest Gate Notes
- Built-in listening is now a local optional asset: `assets/generated/listening-exams/manifest.js` must load and register a manifest before `listening-index.compat.js` is loaded.
- Default reading data no longer depends on generated listening assets, so missing listening manifest cannot poison reading browse/load flows.
- The browse listening entrance starts hidden in static `index.html`; `BrowseController` shows it only when the active library contains listening entries.
- User-imported listening libraries still show the entrance because visibility is based on active index contents, not on the built-in manifest.
- Generated listening assets are removed from hard bundle inputs and staged for removal from Git tracking while remaining local/ignored.
- Default release output excludes both `ListeningPractice/` and `assets/generated/listening-exams/`; opt-in local listening release requires manifest/index to be present together.
