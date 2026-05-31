# Progress Log

## Session: 2026-05-21

### Phase 1: Discovery & Current Chain Audit
- **Status:** complete
- **Started:** 2026-05-21 Asia/Shanghai
- Actions taken:
  - Read repository instructions supplied by user.
  - Confirmed user no longer wants confirmation gates for future instructions.
  - Loaded `planning-with-files` skill instructions.
  - Checked previous session catchup, repository file list, and git status.
  - Created root planning files for this refactor planning task.
  - Audited the first layer of the writing Vue shell: `App.vue`, `main.js`, `api/client.js`, `ComposePage.vue`, `useDraft.js`, and `NavBar.vue`.
  - Recorded that the Vue app is currently writing-only and still depends on a legacy return bridge.
  - Audited reading Fastify routes and core reading AI service modules.
  - Identified that reading currently exposes an assistant query, not a full practice session API.
  - Audited Electron preload/main navigation boundary and confirmed legacy/writing are separate top-level pages switched by IPC.
  - Located the heavy legacy reading/session implementation surface in `js/practice-page-enhancer.js`.
  - Audited old reading generated data shape, old practice records, writing backend sessions, management/settings API, and required E2E/static test gates.
  - Created `developer/docs/reading-writing-vue-unification-plan.md` with target architecture, data model, migration slices, deletion criteria, and verification gates.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Not run | Documentation/planning only | No production behavior changed | Skipped intentionally | N/A |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | New `/api/practice` facade passes asset/session/coach contract checks | `practiceApiFacade.test.js passed` | Pass |
| Server build | `npm run build:server` | TypeScript server compiles | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue build compiles after practice client addition | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes | Passed | Pass |
| Required suite E2E | `python3 developer/tests/e2e/suite_practice_flow.py` | Suite practice flow passes | Passed, 0 errors, 9 warnings | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Route/nav/library/client/Compose hydration contract passes | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Practice facade remains compatible after shell work | `practiceApiFacade.test.js passed` | Pass |
| Server build | `npm run build:server` | TypeScript server compiles independently | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue shell and existing writing pages compile | Passed | Pass |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Vue Practice Shell test included | Passed | Pass |
| Required suite E2E | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite reading flow remains intact | Passed, 0 errors, 8 warnings | Pass |
| Browser shell check | Python Playwright with mock local API | `/library` renders reading/writing assets, filters, and starts writing with topic query | Passed; screenshots saved under ignored `developer/tests/e2e/reports/` | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Vue reading page renders and syncs radio/text/checkbox/dropzone fallback answers | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Practice facade covers reading detail payloads and full generated reading interaction coverage | `practiceApiFacade.test.js passed` | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Route/nav/library/reading page/client contracts remain present | Passed | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after reading asset loader | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue shell and PracticeReadingPage compile | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes including Practice API facade and Vue Reading E2E | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite reading flow remains intact | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after reading session scoring service | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue reading submit/review/coach page compiles | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Reading submit/score/review, normalization, checkbox set scoring, session state, and coach context pass | `practiceApiFacade.test.js passed` | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Reading page locks PracticeSession submit/review/coach contract | Passed | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Vue reading page submits, renders readonly review, persists submission snapshot, and sends coach sessionId | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with reading submit/review/coach coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite reading flow remains intact | Passed; script logs 2 existing DataCollection save-verification console errors and 9 warnings while exiting 0 | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after PracticeHistoryStore addition | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue library history panel and reading replay route compile | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Route/client/history/replay contracts are present | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Reading history persists across PracticeService instances, replay state loads, coach snapshot/transcript persists | `practiceApiFacade.test.js passed` | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Submit, coach, library history entry, replay route, readonly restore, and no duplicate submit pass | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with persistent reading history/replay coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite reading flow remains intact | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after dragdrop contract change | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue drag/drop reading page compiles | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Reading interaction contract exposes `dragdrop/dropzone` with option reuse metadata | `practiceApiFacade.test.js passed` | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Reading page has Vue drag/drop handlers, dropzone sync, and accessible fallback | Passed | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Drag from question HTML `.drag-item` into `.match-dropzone`, submit, review, coach, and replay restored dropzone | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Vue drag/drop parity coverage | Passed | Pass |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite reading flow remains intact after Vue drag/drop migration | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after reading analysis artifact contracts | Initially failed on highlight type inference; passed after typed normalization fix | Pass |
| Writing Vue build | `npm run build:writing` | Vue reading analysis panel and marked-question controls compile | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract includes analysis panel, marked questions, timeline submit, and interaction density | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Reading submissions persist analysis artifacts, marked questions, timeline, and replay state | `practiceApiFacade.test.js passed` | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Marked questions, answer-change timeline, analysis panel, readonly replay, and coach session context pass | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 5 analysis artifact coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite reading flow remains intact after Vue analysis artifact migration | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after Practice migration matrix addition | Initially failed on `Object.freeze()` literal widening; passed after removing freeze | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Library migration panel and runtime-ready signal compile | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract includes Electron Vue default entrypoint, migration matrix, Vue runtime-ready, and no legacy dependency in normal reading route | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Practice facade exposes `/api/practice/migration-status` and locks Vue-primary/fallback capability matrix | `practiceApiFacade.test.js passed` | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Vue reading flow still passes after entrypoint/migration matrix changes | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 6 migration matrix and Electron entrypoint guards | Passed | Pass |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Legacy suite fallback remains intact after Electron default entry switches to Vue | Passed, 0 errors, 8 warnings | Pass |
| JS syntax check | `node --check electron/main.js && node --check electron/preload.js && node --check js/app/readingLaunchMixin.js && node --check js/app/examSessionMixin.js` | Modified Electron and legacy entry files parse | Passed | Pass |
| Legacy single-reading Vue route contract | `node developer/tests/js/readingLaunchVueRoute.test.js` | Normal single-reading redirects to Vue route; suite/review stay unified HTML; `openExam` avoids legacy session injection on Vue route | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Route-aware Electron IPC and legacy single-reading redirect static contract are present | Initially failed on brittle old loader signature; passed after assertion update | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration status includes `practiceRouteIpc` and legacy fallback single-reading redirect deletion criteria | `practiceApiFacade.test.js passed` | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after route IPC migration matrix changes | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after entrypoint contract updates | Passed | Pass |
| Reading Vue flow E2E | `python3 developer/tests/e2e/practice_reading_vue_flow.py` | Vue reading flow remains intact after legacy single-reading redirect work | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with legacy single-reading Vue route contract included | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Suite fallback remains intact after legacy single-reading starts route to Vue | Passed, 0 errors, 8 warnings | Pass |
| Legacy suite Vue route contract | `node developer/tests/js/legacySuiteVueRoute.test.js` | Legacy homepage suite launch creates Vue reading suite and keeps explicit fallbacks | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration matrix exposes suite homepage Vue route and legacy fallback surface separately | `practiceApiFacade.test.js passed` | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract includes suite homepage Vue route guard and migration matrix split | Passed | Pass |
| Legacy single-reading Vue route contract | `node developer/tests/js/readingLaunchVueRoute.test.js` | Single-reading redirect remains intact after suite entry cleanup | Passed | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after migration matrix type change | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after suite entry cleanup | Passed | Pass |
| JS syntax check | `node --check js/presentation/app-actions.js && node --check electron/main.js && node --check electron/preload.js && node --check js/app/readingLaunchMixin.js && node --check js/app/examSessionMixin.js` | Modified Electron/legacy entry files parse | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after Slice 9 | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with legacy suite Vue route contract included | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after Slice 9 | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite fallback remains intact after homepage suite redirects to Vue by default | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after Slice 10 cleanup contracts | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after standalone entry deletion | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Product entrypoints forbid standalone writing/legacy IPC and lock runtime boundary text | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration matrix includes runtime asset boundary and removed entrypoint criteria | `practiceApiFacade.test.js passed` | Pass |
| Reading explanation generator unittest | `python3 -m unittest developer/tests/py/test_reading_explanation_generator.py` | Generator works from developer tooling path after leaving runtime assets | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after Slice 10 cleanup | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with `assets/scripts` runtime boundary and dead E2E script boundary | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after Slice 10 cleanup | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite fallback remains intact after cleanup | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after Electron debug runner deletion | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after Electron debug runner deletion | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Migration matrix includes Electron debug runner deletion guard | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Practice migration status exposes Electron debug runner deletion criterion | `practiceApiFacade.test.js passed` | Pass |
| Reading explanation generator unittest | `python3 -m unittest developer/tests/py/test_reading_explanation_generator.py` | Generator still works from developer tooling path | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after Electron debug runner deletion | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with `Electron 调试脚本边界`, runtime asset boundary, and dead E2E script boundary | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after Electron debug runner deletion | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite fallback remains intact after Electron debug runner deletion | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after Shared/Data compression | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after `practicePath()` client compression | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Pagination clamp, corrupt history recovery, migration matrix, reading/writing/suite facade contracts pass | `practiceApiFacade.test.js passed` | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Shared route/http/json helpers and Vue `practicePath()` static contract pass | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after Shared/Data compression | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 11 Shared/Data coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after Shared/Data compression | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite fallback remains intact after Shared/Data compression | Passed, 0 errors, 9 warnings | Pass |
| JS syntax check | `node --check js/presentation/app-actions.js` | Product suite fallback compression keeps app-actions parseable | Passed | Pass |
| Legacy suite Vue route contract | `node developer/tests/js/legacySuiteVueRoute.test.js` | Product suite uses Vue route; API/route failures do not fallback; `test_env`/`suite_test`/`ci` remain explicit regression-only | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract forbids old suite try/fallback shape and stale `continueSuitePractice` public export | Passed | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after migration matrix update | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after product suite fallback compression | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration status exposes suite regression-only legacy surface | `practiceApiFacade.test.js passed` | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after product suite fallback compression | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 12 product suite fallback compression coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after product suite fallback compression | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after product suite fallback compression | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after suite session store migration | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after migration matrix/static contract updates | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract locks suite store/schema/migration and forbids `PracticeService` suite Map | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Suite session progress persists across PracticeService/server app instances | `practiceApiFacade.test.js passed` | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after suite session persistence | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 13 suite session persistence coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after suite session persistence | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after suite session persistence | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after VM-free reading asset parser | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract forbids Practice reading asset runtime VM and locks migration deletion guard | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | VM-free reading asset parser loads generated minified wrapper and preserves payload contract | `practiceApiFacade.test.js passed` | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after VM-free parser migration docs/contracts | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after VM-free reading asset loading | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 14 VM-free reading asset parser coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after VM-free reading asset loading | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after VM-free reading asset loading | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after single-reading session memory owner removal | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract forbids `PracticeService` reading session Map and locks history-backed replay ownership | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Submitted reading session replays from history and cannot be cancelled as an active job | `practiceApiFacade.test.js passed` | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after single-reading session ownership docs/contracts | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after single-reading session data ownership compression | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 15 single-reading session data ownership coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after single-reading session data ownership compression | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after single-reading session data ownership compression | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after shared generated JSON parser and ReadingCoach VM removal | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract locks shared reading generated parser and forbids ReadingCoach VM execution | Passed | Pass |
| Reading Coach service contract | `node developer/tests/js/readingAnalysisService.test.js` | ReadingCoach parses real generated exam/explanation payloads without VM and all question chunks remain resolvable | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Practice coach/session/history contracts remain intact after shared generated parser extraction | `practiceApiFacade.test.js passed` | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after ReadingCoach VM-free parser changes | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after ReadingCoach generated data VM removal | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 16 ReadingCoach generated data VM-free coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after ReadingCoach generated data VM removal | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after ReadingCoach generated data VM removal | Passed, 0 errors, 8 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after reading asset payload cache | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract locks loader-owned cache and forbids `PracticeService` manifest cache | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Repeated reading detail/submit calls reuse bounded payload cache | `practiceApiFacade.test.js passed` | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after cache docs/contracts | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after reading asset payload cache | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 19 reading asset cache coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after reading asset payload cache | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after reading asset cache | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after shared cache primitive and ReadingCoach cache bounds | Passed | Pass |
| Reading Coach service contract | `node developer/tests/js/readingAnalysisService.test.js` | ReadingCoach cache hits, query eviction, exam bundle eviction, and retrieval contracts pass | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract locks shared cache helper, bounded ReadingCoach cache, and migration matrix | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration status exposes bounded ReadingCoach cache surface and Practice contracts remain intact | `practiceApiFacade.test.js passed` | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after cache docs/contracts | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after ReadingCoach cache bound | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with bounded ReadingCoach cache coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after ReadingCoach cache bound | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after ReadingCoach cache bound | Passed, 0 errors, 9 warnings | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after bounded writing SSE replay cache | Passed | Pass |
| Writing evaluation contract probe | `node developer/tests/ci/writing_contract_probe.cjs` | Writing evaluation contracts pass and SSE replay cache stays at 24 sessions / 80 events | Passed | Pass |
| Writing backend contract | `python3 developer/tests/ci/writing_backend_contract.py` | Backend static/runtime contract includes bounded SSE replay cache | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract locks bounded writing replay cache and migration matrix | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration status exposes bounded writing replay cache and Practice contracts remain intact | `practiceApiFacade.test.js passed` | Pass |
| Reading Coach service contract | `node developer/tests/js/readingAnalysisService.test.js` | ReadingCoach remains green after shared cache helper return-value change | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after writing replay cache docs/contracts | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after bounded writing SSE replay cache | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 21 bounded writing SSE replay cache coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after bounded writing SSE replay cache | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after bounded writing SSE replay cache | Passed, 0 errors, 9 warnings | Pass |
| Writing essay history contract | `node developer/tests/ci/writing_essay_history_contract.cjs` | History list summary SQL omits content/evaluation_json, list avoids evaluation parsing, detail still parses full payload, create persists topic_text | Passed | Pass |
| Vue Practice Shell contract | `node developer/tests/js/practiceVueShell.test.js` | Static contract locks essay history summary decorator, topic_text persistence, and no evaluation_json search | Passed | Pass |
| Practice API facade contract | `node developer/tests/js/practiceApiFacade.test.js` | Migration status exposes writing essay history summary list contract | `practiceApiFacade.test.js passed` | Pass |
| Server build | `npm run build:server` | TypeScript server compiles after writing essay history summary changes | Passed | Pass |
| Writing backend contract | `python3 developer/tests/ci/writing_backend_contract.py` | Backend static contract locks topic_text search and summary decorator | Passed | Pass |
| Reading Coach service contract | `node developer/tests/js/readingAnalysisService.test.js` | ReadingCoach remains green after serial rerun | Passed | Pass |
| Writing evaluation contract probe | `node developer/tests/ci/writing_contract_probe.cjs` | Writing evaluation contracts remain green after serial rerun | Passed | Pass |
| Writing Vue build | `npm run build:writing` | Vue Practice Shell bundle compiles after writing history docs/contracts | Passed | Pass |
| Required static suite | `python developer/tests/ci/run_static_suite.py` | Static suite runs after writing essay history summary changes | Failed: `python` command not found | Environment issue |
| Required static suite retry | `python3 developer/tests/ci/run_static_suite.py` | Static suite passes with Slice 22 writing essay history summary coverage | Passed | Pass |
| Required suite E2E | `python developer/tests/e2e/suite_practice_flow.py` | Suite practice flow runs after writing essay history summary changes | Failed: `python` command not found | Environment issue |
| Required suite E2E retry | `python3 developer/tests/e2e/suite_practice_flow.py` | Explicit legacy suite regression remains intact after writing essay history summary changes | Passed, 0 errors, 9 warnings | Pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-05-21 | `python` command not found | 1 | Used `python3` for the same required script. |
| 2026-05-21 | `practiceApiFacade.test.js` expected `config_id: null` | 1 | Corrected the test to match existing `WritingEvaluationService` normalization. |
| 2026-05-21 | `practiceApiFacade.test.js` expected `success: false` in error envelope | 2 | Corrected the test to match existing `{ error, message }` error contract. |
| 2026-05-21 | `practiceVueShell.test.js` expected `hydrateFromPracticeAssetQuery()` after the implementation gained draft preservation options | 1 | Updated the assertion to lock `preserveExistingDraft` behavior instead of a brittle call shape. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 2 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed. |
| 2026-05-21 | `practice_reading_vue_flow.py` timed out waiting for `[data-practice-reading-page]` because it ran stale `dist/writing` output | 1 | Added source mtime checks and rebuild logic to the E2E; rerun passed. |
| 2026-05-21 | Full reading interaction coverage test returned 500 because it requested `/api/practice/assets?limit=300`, exceeding the API max of 200 | 1 | Rewrote the test to paginate with `limit=200`; rerun passed. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable | 1 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 3 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 3 coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 2 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed while logging existing DataCollection verification console errors. |
| 2026-05-21 | `practiceApiFacade.test.js` failed because the test tried to load native `better-sqlite3`, whose binding is unavailable in this Node runtime | 1 | Replaced the direct native dependency with a focused fake SQLite adapter covering the PracticeHistoryStore SQL surface. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 4 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 4 persistent history/replay coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 3 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings. |
| 2026-05-21 | `practice_reading_vue_flow.py` failed after initial drag/drop parity because replay restored the answer panel but not `.match-dropzone.dataset.answerValue` | 1 | Moved `syncDomAnswers()` until after `loading=false` and `nextTick()`, so the `v-if` gated reading workspace exists before Vue syncs native dropzone state. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 5 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Vue drag/drop parity coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 4 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings. |
| 2026-05-21 | `npm run build:server` failed after reading analysis artifact contracts because `normalizeHighlights()` inferred `scope` as plain string and the type predicate narrowed to an incompatible shape | 1 | Rewrote `normalizeHighlights()` as explicit typed array accumulation; server build passed. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 6 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 5 analysis artifact coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 5 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings. |
| 2026-05-21 | `npm run build:server` failed after adding `PRACTICE_MIGRATION_STATUS` because `Object.freeze()` widened typed literal fields to `string` | 1 | Removed the unnecessary freeze and relied on the `PracticeMigrationStatus` annotation; build passed. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 7 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 6 coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 6 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings. |
| 2026-05-21 | `practiceVueShell.test.js` failed because it asserted `function loadPracticeShellPage()` after the loader gained `route = null` | 1 | Replaced the no-arg signature assertion with checks for route normalization, hash URL construction, and `mainWindow.loadURL(shellUrl)`. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 8 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 7 coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 7 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings. |
| 2026-05-21 | Legacy homepage suite adapter initially read `payload.sessionId`, but `/api/practice/reading-suite` returns `{ success, data }` | 1 | Changed the adapter to read `payload.data.sessionId`, reject `success:false`, and updated `legacySuiteVueRoute.test.js` to use the real envelope. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 9 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 9 legacy suite Vue route coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 8 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Slice 9. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 10 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 10 runtime asset and dead E2E script guards. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 9 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Slice 10 cleanup. |
| 2026-05-21 | `python developer/tests/ci/run_static_suite.py` failed again because `python` is unavailable | 11 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Electron debug runner boundary coverage. |
| 2026-05-21 | `python developer/tests/e2e/suite_practice_flow.py` failed again because `python` is unavailable | 10 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Electron debug runner deletion. |
| 2026-05-22 | `npm run build:server` failed after corrupt-history recovery because TypeScript rejected a direct `AnyRecord` to `ReadingPracticeSubmission` cast | 1 | Added `isRecoverableReadingSubmission()` and only recover records with `sessionId`, `activity='reading'`, `status='submitted'`, and `scoreInfo`. |
| 2026-05-22 | `npm run build:server` and `practiceApiFacade.test.js` were accidentally started in parallel while both can rebuild `server/dist` | 1 | The run passed, then final verification was executed serially to avoid build-race noise. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 12 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 11 Shared/Data coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 11 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Shared/Data compression. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 13 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 12 product suite fallback compression coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 12 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after product suite fallback compression. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 14 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 13 reading suite session persistence coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 13 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings after suite session persistence. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 15 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 14 VM-free reading asset parser coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 14 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings after VM-free reading asset loading. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 17 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 16 ReadingCoach generated data VM-free coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 16 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 8 warnings after ReadingCoach generated data VM removal. |
| 2026-05-22 | 5.3 Codex subagent spawn failed because the thread limit was reached | 1 | Completed the Slice 19 asset-cache audit locally instead of blocking on new agents. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 20 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 19 reading asset payload cache coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 19 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Slice 19. |
| 2026-05-22 | 5.3 Codex subagent spawn failed because the thread limit was reached | 2 | Completed the Slice 20 ReadingCoach cache-bound audit locally instead of blocking on new agents. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 21 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with bounded ReadingCoach cache coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 20 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Slice 20. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 22 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 21 bounded writing SSE replay cache coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 21 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Slice 21. |
| 2026-05-22 | 5.3 Codex subagent spawn failed because the thread limit was reached | 3 | Completed the Slice 22 writing history hot-path audit locally instead of blocking on new agents. |
| 2026-05-22 | `writing_contract_probe.cjs` and `readingAnalysisService.test.js` were accidentally run in parallel while both can rebuild `server/dist`; one run failed with `rm: server/dist/types/reading.js: Invalid argument` | 1 | Reran the affected contracts serially; both passed. Keep tests that mutate `server/dist` serial. |
| 2026-05-22 | `python developer/tests/ci/run_static_suite.py` still fails because `python` is unavailable | 23 | Used `python3 developer/tests/ci/run_static_suite.py`; it passed with Slice 22 writing essay history summary coverage. |
| 2026-05-22 | `python developer/tests/e2e/suite_practice_flow.py` still fails because `python` is unavailable | 22 | Used `python3 developer/tests/e2e/suite_practice_flow.py`; it passed with 0 errors and 9 warnings after Slice 22. |
| 2026-05-22 | `npm start` failed at Electron startup because `better-sqlite3` had no native `better_sqlite3.node` binding installed | 1 | Ran `npx electron-builder install-app-deps` to rebuild Electron native deps; reran `npm start` and it stayed running past DB migrator startup. |

### Slice 0: Practice Contract/API Facade
- **Status:** complete
- Actions taken:
  - Added unified practice contracts and a thin `PracticeService`.
  - Registered practice routes in Fastify.
  - Exposed reading/writing assets under `/api/practice/assets`.
  - Proxied writing session creation/state/cancel through `/api/practice/sessions`.
  - Proxied reading coach through `/api/practice/coach`.
  - Added Vue `practice-client` and reused the existing API request helper.
  - Added `developer/tests/js/practiceApiFacade.test.js`.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/routes/practice.ts`
  - `server/src/app.ts`
  - `apps/writing-vue/src/api/client.js`
  - `apps/writing-vue/src/api/practice-client.js`
  - `developer/tests/js/practiceApiFacade.test.js`

### Slice 1: Vue Practice Shell
- **Status:** complete for shell scope; writing component extraction deferred behind reading migration
- Actions taken:
  - Re-read `task_plan.md`, `findings.md`, `progress.md`, and `developer/docs/reading-writing-vue-unification-plan.md`.
  - Used a 5.3 Codex subagent for read-only Vue Shell audit. The audit confirmed that `Compose -> Evaluating -> Result`, SSE event contracts, `temp_essay_${sessionId}`, `evaluation_${sessionId}`, and Result DB/cache fallback are zero-regression boundaries.
  - Added `/library` route and `/writing` compatibility alias in `apps/writing-vue/src/main.js`.
  - Changed `NavBar.vue` product framing to `IELTS Practice Studio` and moved `openLegacy()` into a fallback-only button instead of normal navigation.
  - Added `apps/writing-vue/src/views/PracticeLibraryPage.vue`, driven only by `practice-client`.
  - Made the library load reading and writing assets separately in the combined view so reading pagination does not hide writing assets.
  - Added Compose query hydration for writing practice assets (`topicId` + `taskType`).
  - Protected existing writing drafts during query hydration so opening an asset from the library does not overwrite a user's stored draft before they choose restore/discard.
  - Added `developer/tests/js/practiceVueShell.test.js`.
  - Wired the new Vue shell contract test into `developer/tests/ci/run_static_suite.py`.
  - Ran required static and E2E gates; both passed via `python3`.
  - Ran a browser-level Practice Library smoke check with a mock local API. It confirmed reading/writing assets render, keyword filtering hides non-matching reading assets, and writing asset launch navigates to `/#/?topicId=7&taskType=task2`.
  - Cleaned up temporary local services on ports `5174` and `5188`.
- Files created/modified:
  - `apps/writing-vue/src/main.js`
  - `apps/writing-vue/src/components/NavBar.vue`
  - `apps/writing-vue/src/views/ComposePage.vue`
  - `apps/writing-vue/src/views/PracticeLibraryPage.vue`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/ci/run_static_suite.py`

### Slice 2: Vue Reading Asset Rendering
- **Status:** complete
- Actions taken:
  - Re-read planning files, Practice facade code, old reading loader behavior, generated reading exam data, Vue shell, and existing regression tests.
  - Used a 5.3 Codex subagent for read-only Slice 2 risk audit. The audit confirmed the minimum Vue input channels are radio, text, checkbox, and dropzone fallback; scoring normalization, drag/drop restore, review/readOnly, and AI coach lifecycle cannot be claimed complete in this slice.
  - Added typed reading payload contracts to `server/src/lib/practice/contracts.ts`.
  - Added `server/src/lib/practice/reading-assets.ts`, a dedicated loader that safely evaluates generated reading exam registration scripts in a VM, normalizes passage/questionGroups/answerKey/questionOrder/questionDisplayMap, strips scripts/inline event handlers, and derives `interactionModel`.
  - Extended `PracticeService.getAsset('reading', id)` to return full reading payload details instead of only manifest metadata.
  - Added `/reading/:assetId` route to the Vue shell.
  - Added `apps/writing-vue/src/views/PracticeReadingPage.vue` with passage rendering, question group rendering, local answer sheet, native input sync, select fallback for dropzone-based legacy questions, answer reset, and sessionStorage snapshot.
  - Updated `PracticeLibraryPage.vue` so reading assets enter the Vue reading page directly instead of opening the Slice 1 metadata modal.
  - Extended `developer/tests/js/practiceApiFacade.test.js` to cover reading detail payloads, missing asset 404, p1 dropzone fallback, p2 radio/text/checkbox, and paginated full reading interaction coverage across all generated reading assets.
  - Extended `developer/tests/js/practiceVueShell.test.js` to lock `/reading/:assetId`, PracticeReadingPage, reading library navigation, and the absence of legacy API/client dependencies.
  - Added `developer/tests/e2e/practice_reading_vue_flow.py`, covering library -> reading navigation, passage/question render, radio/text/checkbox/dropzone fallback answer sync, and answer snapshot persistence.
  - Wired Practice API facade, Vue Practice Shell static contract, and Vue Reading E2E into `developer/tests/ci/run_static_suite.py`.
  - Initially preserved reading `/api/practice/sessions` as explicit 501 until Slice 3 implemented the real lifecycle.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/reading-assets.ts`
  - `apps/writing-vue/src/main.js`
  - `apps/writing-vue/src/views/PracticeLibraryPage.vue`
  - `apps/writing-vue/src/views/PracticeReadingPage.vue`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_vue_flow.py`
  - `developer/tests/ci/run_static_suite.py`

### Slice 3: Reading PracticeSession Submit/Review/Coach
- **Status:** complete for synchronous single-reading submission and review
- Actions taken:
  - Re-read planning files, Practice facade code, Vue reading page, old `unifiedReadingPage.js` scoring functions, generated exam data, and existing regression tests.
  - Used a 5.3 Codex subagent for read-only legacy submit/review audit. The audit confirmed the non-negotiable compatibility fields are `answers`, `correctAnswers`, `answerComparison`, `scoreInfo`, and read-only review state; coach snapshot/transcript and advanced analysis can be phased later.
  - Added reading submission contracts to `server/src/lib/practice/contracts.ts`, including comparison entries, score info, question type performance, coach context, and submitted reading payload shape.
  - Added `server/src/lib/practice/reading-sessions.ts`, a server-side scoring module that normalizes answers, compares T/F/NG aliases, handles letter options, loose textual equality, arrays-as-alternatives, and checkbox arrays-as-sets.
  - Upgraded `PracticeService.createSession()` for `activity='reading'` from 501 to a real synchronous submit/score/review session.
  - Added in-memory reading session state retrieval via `/api/practice/sessions/reading/:sessionId`.
  - Updated `/api/practice/coach` and `/api/practice/coach/stream` so a known submitted reading `sessionId` injects authoritative attempt context into the coach request.
  - Kept unknown legacy coach `sessionId` calls compatible by preserving the caller-provided payload instead of hard failing.
  - Upgraded `PracticeReadingPage.vue` from local answer capture to a `draft -> submit -> readonly review -> AI coach` flow.
  - Fixed Vue single-question multi-select handling by rendering checkbox lists for checkbox interactions whose answer key is an array, while preserving existing split-answer behavior for multi-question checkbox groups.
  - Added review score cards, per-question review rows, readonly control disabling, sessionStorage submission snapshots, and coach panel availability after submit.
  - Expanded `practiceApiFacade.test.js` for reading session submit/score/review, answer normalization, checkbox set scoring, reading session state, explicit coach compatibility, and submitted-session coach context injection.
  - Expanded `practiceVueShell.test.js` to lock the Vue reading submit/review/coach contract.
  - Expanded `practice_reading_vue_flow.py` to cover submit, readonly review, submission snapshot, and AI coach `sessionId` propagation.
  - Ran direct builds/tests and full required gates.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/reading-sessions.ts`
  - `server/src/routes/practice.ts`
  - `apps/writing-vue/src/views/PracticeReadingPage.vue`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_vue_flow.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 4: Persistent Reading History & Replay
- **Status:** complete for persistent history/replay, drag/drop parity, and analysis artifact parity; legacy deletion criteria remain pending
- Actions taken:
  - Re-read planning files, current Practice facade, Vue reading page, writing history page, Electron SQLite schema, and legacy `PracticeRecorder`/`ScoreStorage`/`PracticeRepository` persistence contracts.
  - Used a 5.3 Codex subagent for read-only legacy history audit. The audit confirmed `PracticeRepository` is only a weak array repository and the real compatibility contract is the standardized legacy record field set.
  - Added `server/src/lib/practice/practice-history.ts`, which maps `ReadingPracticeSubmission` into a canonical `PracticeHistoryRecord` plus legacy-compatible `legacyRecord`.
  - Added packaged Electron SQLite table `practice_history_records` to `electron/db/schema.sql` and the phase migration file.
  - Wired `PracticeHistoryStore` into `PracticeService`; reading submissions now persist to history immediately after scoring.
  - Added `/api/practice/history` and `/api/practice/history/:activity/:recordId`.
  - Updated `/api/practice/sessions/reading/:sessionId` so it falls back from in-memory submissions to persisted history submissions.
  - Updated `/api/practice/coach` so submitted reading coach responses are written back into history as `readingCoachSnapshot` and `readingCoachTranscript` while preserving `realData` and `resultSnapshot` compatibility.
  - Added `practiceHistory` client facade in `apps/writing-vue/src/api/practice-client.js`.
  - Added `/reading/:assetId/review/:sessionId` route and reused `PracticeReadingPage.vue` for read-only replay.
  - Updated `PracticeReadingPage.vue` to load submitted reading session state, restore answers, render the review panel, and lock controls in replay mode.
  - Added a recent reading reviews panel to `PracticeLibraryPage.vue`, with direct navigation into Vue reading replay.
  - Expanded `practiceApiFacade.test.js` to verify persisted history list/detail, cross-service-instance reading replay, legacy record fields, and coach snapshot/transcript writeback.
  - Expanded `practiceVueShell.test.js` to lock the replay route, history client, library history panel, and replay loader.
  - Expanded `practice_reading_vue_flow.py` to cover library -> reading -> submit -> coach -> library history -> replay, including readonly restoration and no duplicate submit.
  - Ran direct builds/tests and full required gates.
  - Re-audited legacy dropzone behavior through `js/runtime/unifiedReadingPage.js` and confirmed the real model is single-slot `questionId -> answerValue`; `p2-low-148` only has noisy `audit.notes` dragdrop metadata, while real parity data is from fixtures like `p1-high-01`.
  - Changed `ReadingQuestionInteraction` for dropzone questions from `control: 'select'` / `source: 'dropzone_fallback'` to `control: 'dragdrop'` / `source: 'dropzone'`, with `allowOptionReuse` preserved from the generated question group.
  - Updated `PracticeReadingPage.vue` to handle Vue-native drag/drop from generated `.drag-item` sources to `.paragraph-dropzone` / `.match-dropzone`, while keeping a `.dragdrop-select` accessible fallback bound to the same answer state.
  - Implemented dropzone visual sync so `answers[questionId]` writes `dataset.answerValue`, assigned chips, filled/empty classes, and readonly disabled state into the v-html question DOM.
  - Preserved essential drag/drop behavior: single-slot replace, slot-to-slot swap, drag back to pool clear, readonly review lock, and replay restoration.
  - Fixed a replay lifecycle bug where DOM sync ran while `loading=true` and the `v-if` gated reading workspace had not mounted.
  - Updated API/static/E2E tests so drag/drop is a first-class Vue behavior, not a select fallback.
- Files created/modified:
  - `server/src/lib/practice/practice-history.ts`
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/routes/practice.ts`
  - `electron/db/schema.sql`
  - `electron/db/migrations/20260209_phase06_schema.sql`
  - `apps/writing-vue/src/api/practice-client.js`
  - `apps/writing-vue/src/main.js`
  - `apps/writing-vue/src/views/PracticeLibraryPage.vue`
  - `apps/writing-vue/src/views/PracticeReadingPage.vue`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_vue_flow.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 5: Reading Analysis Artifacts & Vue Review Intelligence
- **Status:** complete for analysis artifacts and Vue review intelligence; legacy single-reading runtime deletion criteria remain pending
- Actions taken:
  - Re-read planning files and audited legacy analysis artifact sources in `js/runtime/unifiedReadingPage.js`, `js/core/practiceRecorder.js`, and `js/core/practiceCore.js`.
  - Confirmed `analysisSignals`, `questionTimelineLite`, `highlights`, `markedQuestions`, `singleAttemptAnalysisInput`, and `singleAttemptAnalysis` are real record/replay contracts, not disposable UI state.
  - Added typed reading analysis artifact contracts to `server/src/lib/practice/contracts.ts`.
  - Extended `server/src/lib/practice/reading-sessions.ts` so server-side reading submissions generate canonical `analysisSignals`, `questionTimelineLite`, `singleAttemptAnalysisInput`, `singleAttemptAnalysis`, `markedQuestions`, `highlights`, and `analysisArtifacts`.
  - Kept Vue thin: `PracticeReadingPage.vue` submits observed attempt metadata while the server owns canonical scoring and analysis.
  - Extended `server/src/lib/practice/practice-history.ts` so the same analysis artifacts persist in canonical `submission`, legacy top-level fields, `legacyRecord.realData`, and `legacyRecord.resultSnapshot`.
  - Added Vue-native marked-question controls, answer-change tracking, interaction density submission, and a concise review analysis panel in `PracticeReadingPage.vue`.
  - Ensured review/replay mode restores marked questions and disables marked-question controls together with answer controls.
  - Expanded `practiceApiFacade.test.js` to verify artifact shape, history persistence, legacy-compatible fields, and cross-service replay.
  - Expanded `practiceVueShell.test.js` to lock the analysis panel, marked-question state, timeline submit, and interaction density contract.
  - Expanded `practice_reading_vue_flow.py` to create an answer change, mark q6, assert submit payload metadata, assert analysis panel rendering, and assert readonly replay restoration.
  - Ran direct builds/tests and full required gates.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/reading-sessions.ts`
  - `server/src/lib/practice/practice-history.ts`
  - `apps/writing-vue/src/views/PracticeReadingPage.vue`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_vue_flow.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 6: Electron Vue Entrypoint & Legacy Fallback Matrix
- **Status:** complete
- Actions taken:
  - Re-read planning files and audited `electron/main.js`, `electron/preload.js`, Vue routes, Practice Library, Practice Reading page, and static/E2E tests.
  - Could not spawn another 5.3 Codex subagent because the agent thread limit was reached; completed the audit locally.
  - Confirmed normal Vue reading path (`/library -> /reading/:assetId`) no longer calls `openLegacy()`.
  - Added typed Practice migration contracts to `server/src/lib/practice/contracts.ts`.
  - Added `server/src/lib/practice/migration-status.ts` as the single source of truth for migration state and deletion gates.
  - Registered `/api/practice/migration-status` in `server/src/routes/practice.ts`.
  - Added `PracticeService.getMigrationStatus()` and `practiceMigration.getStatus()` in the Vue Practice client.
  - Updated `PracticeLibraryPage.vue` to render a compact migration matrix with `data-practice-migration-panel`, showing Vue-primary single-reading/writing and legacy fallback suite/listening capabilities.
  - Changed `electron/main.js` so `createMainWindow()` defaults to `loadPracticeShellPage()` instead of `loadLegacyPage()`.
  - Kept `loadWritingPage()` and `navigate-to-writing` as compatibility aliases that load the Practice Shell.
  - Kept `navigate-to-legacy` and `loadLegacyPage()` for explicit fallback and for missing Vue build recovery.
  - Added `app-runtime-ready` dispatch in Vue `main.js` so Electron updater boot-health still receives the renderer-ready signal after the default entry switches to Vue.
  - Expanded `practiceApiFacade.test.js` to verify `/api/practice/migration-status` and the Vue-primary/fallback capability matrix.
  - Expanded `practiceVueShell.test.js` to lock Electron default Vue entrypoint, Vue `app-runtime-ready`, Practice Library migration matrix, Practice client endpoint, and normal reading route no-legacy dependency.
  - Ran direct builds/tests plus required gates.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `server/src/routes/practice.ts`
  - `electron/main.js`
  - `apps/writing-vue/src/api/practice-client.js`
  - `apps/writing-vue/src/main.js`
  - `apps/writing-vue/src/views/PracticeLibraryPage.vue`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 7: Legacy Single-Reading Redirect To Vue
- **Status:** complete
- Actions taken:
  - Re-read planning files and audited `js/app/readingLaunchMixin.js`, `js/app/examSessionMixin.js`, `electron/preload.js`, `electron/main.js`, suite open options, and current Practice tests.
  - Confirmed the real residual debt: legacy fallback surface could still start normal generated single-reading through `reading-practice-unified.html`, even though single-reading is Vue-primary in the migration matrix.
  - Added `normalizePracticeShellRoute()` and `navigate-to-practice-route` in `electron/main.js`, guarded by existing internal navigation source checks and a route allowlist.
  - Updated `loadPracticeShellPage(route = null)` to load `dist/writing/index.html#<route>` for internal Vue Practice routes while preserving missing-build legacy fallback.
  - Added `openPracticeRoute()` and `openPracticeReading()` to `electron/preload.js`; `openPracticeReading()` validates generated reading asset ids before IPC.
  - Updated `readingLaunchMixin` so normal generated single-reading returns `mode: 'vue_practice_reading'` when the Electron route API is present.
  - Added a legacy-context guard so suite, simulation, review, forced legacy, PDF/manual, and listening paths are not routed to Vue prematurely.
  - Updated `examSessionMixin.openExam()` so `vue_practice_reading` launches through `_openVuePracticeReading()` and skips legacy session start/window injection.
  - Kept `buildExamUrl()` forced to legacy descriptor resolution for callers that explicitly need a URL.
  - Updated the Practice migration matrix with `practiceRouteIpc` and legacy fallback single-reading redirect deletion criteria.
  - Added `developer/tests/js/readingLaunchVueRoute.test.js` and wired it into the static suite.
  - Expanded `developer/tests/js/practiceVueShell.test.js` and `developer/tests/js/practiceApiFacade.test.js` to lock the route IPC, preload bridge, descriptor boundary, and migration matrix.
  - Ran JS syntax checks, focused JS contracts, full builds, Vue reading E2E, required static suite, and required suite fallback E2E.
- Files created/modified:
  - `electron/main.js`
  - `electron/preload.js`
  - `js/app/readingLaunchMixin.js`
  - `js/app/examSessionMixin.js`
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/readingLaunchVueRoute.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/ci/run_static_suite.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 8: Vue Reading Suite Session Shell
- **Status:** complete
- Actions taken:
  - Re-read planning files and audited old suite data ownership in `js/app/suitePracticeMixin.js` and `js/runtime/unifiedReadingPage.js`.
  - Could not spawn another 5.3 Codex subagent because the agent thread limit was reached; completed the suite audit locally.
  - Identified the stable suite model as sequence/currentIndex/per-passage submissions/aggregate rather than legacy window reuse and postMessage orchestration.
  - Added typed `ReadingSuiteSession`, `ReadingSuitePassageEntry`, `ReadingSuiteAggregate`, and create/submit response contracts in `server/src/lib/practice/contracts.ts`.
  - Added `server/src/lib/practice/reading-suite-sessions.ts`, which owns P1/P2/P3 selection, active passage order, out-of-order rejection, per-passage submit, and aggregate recompute.
  - Registered `/api/practice/reading-suite`, `/api/practice/reading-suite/:sessionId`, and `/api/practice/reading-suite/:sessionId/passages/:assetId`.
  - Reused `createReadingPracticeSubmission()` for each suite passage so suite scoring does not fork the single-reading scoring rules.
  - Added `practiceReadingSuite` to the Vue Practice client.
  - Added `/reading-suite/:sessionId` route and `PracticeReadingSuitePage.vue` for suite progress, P1/P2/P3 sequence, current passage entry, and submitted passage review navigation.
  - Updated `PracticeLibraryPage.vue` with a Vue-native reading suite entry button.
  - Updated `PracticeReadingPage.vue` to load suite state when `suiteSessionId` is present and submit passages through the suite endpoint while preserving the normal single-reading path.
  - Updated `PracticeReadingPage.vue` and `PracticeReadingSuitePage.vue` so suite passage review routes carry `suiteSessionId` and return to suite progress rather than dropping users back to the general library.
  - Extended Electron Practice route allowlist with `/reading-suite/:sessionId`.
  - Updated the Practice migration matrix: `suite-reading-practice` is now Vue-primary with legacy suite window flow retained as a verified fallback/deletion guard.
  - Added API lifecycle coverage for suite creation, state loading, out-of-order rejection, sequential P1/P2/P3 submission, aggregate completion, and per-passage replay.
  - Added Vue static contract checks for the suite route, suite client, suite page, suite library entry, reading-page suite submit branch, and Electron route guard.
  - Added `developer/tests/e2e/practice_reading_suite_vue_flow.py`, covering library -> suite creation -> P1/P2/P3 passage submit -> aggregate completion without legacy calls.
  - Completed the remaining required legacy suite E2E gate after resuming; `python` is still unavailable, and the exact required script passed under `python3` with 0 errors and 8 warnings.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/reading-suite-sessions.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `server/src/routes/practice.ts`
  - `electron/main.js`
  - `apps/writing-vue/src/api/practice-client.js`
  - `apps/writing-vue/src/main.js`
  - `apps/writing-vue/src/views/PracticeLibraryPage.vue`
  - `apps/writing-vue/src/views/PracticeReadingPage.vue`
  - `apps/writing-vue/src/views/PracticeReadingSuitePage.vue`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_suite_vue_flow.py`
  - `developer/tests/ci/run_static_suite.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 9: Residual Legacy Reading Entrypoint Cleanup
- **Status:** complete
- Actions taken:
  - Re-read planning files and audited residual `reading-practice-unified.html`, `unifiedReadingPage.js`, reading launch descriptor, suite launch, and migration matrix references after suite moved to Vue primary.
  - Confirmed the remaining normal reading debt was the legacy homepage suite button: in packaged Electron it could still start `suitePracticeMixin` by default even though Vue suite had a full Practice API route.
  - Updated `js/presentation/app-actions.js` so legacy homepage suite launch first creates a Vue suite through `/api/practice/reading-suite`, then navigates via `electronAPI.openPracticeRoute('/reading-suite/:sessionId')`.
  - Preserved explicit fallback: `test_env=1`, `suite_test=1`, `ci=1`, missing Electron route API, missing local API, failed fetch, and failed route navigation still fall back to legacy `suitePracticeMixin`.
  - Fixed the Vue suite adapter to read the real Practice API envelope `{ success, data }` instead of a top-level `sessionId`.
  - Added `developer/tests/js/legacySuiteVueRoute.test.js`, covering Vue-first suite launch, API payload shape, route navigation, E2E/test fallback, and no-Electron fallback.
  - Added `legacyFallbackSurface` to the typed migration capability model so Vue primary surfaces and legacy fallback files are not mixed inside `apiSurface`.
  - Updated `server/src/lib/practice/migration-status.ts` so suite reading records `js/presentation/app-actions.js -> /reading-suite/:sessionId` as a Vue surface and keeps `js/app/suitePracticeMixin.js` / `js/runtime/unifiedReadingPage.js` under `legacyFallbackSurface`.
  - Expanded `practiceApiFacade.test.js` and `practiceVueShell.test.js` to lock the new suite entrypoint and migration matrix structure.
  - Wired `legacySuiteVueRoute.test.js` into `developer/tests/ci/run_static_suite.py`.
  - Ran direct builds, direct contract tests, required static suite, and required legacy suite fallback E2E.
- Files created/modified:
  - `js/presentation/app-actions.js`
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/legacySuiteVueRoute.test.js`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/ci/run_static_suite.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 10: Legacy Runtime Deletion Readiness
- **Status:** in progress
- Actions taken:
  - Re-read planning files, migration matrix, Electron main/preload, More tools entry, old suite simulation regression, and current static contracts.
  - Fixed `developer/tests/e2e/simulation_roundtrip_restore_regression.py`: explicit `suite_test=1` was bypassing the mode selector and running classic mode, so the test clicked Reset instead of a real simulation prev button. The regression now presets `suite_flow_mode=simulation` and waits for `SIMULATION_CONTEXT` before each next/prev assertion.
  - Confirmed the standalone simulation roundtrip regression passes after the fixture fix.
  - Removed `openWriting()` from `electron/preload.js`.
  - Removed `navigate-to-writing` and `loadWritingPage()` from `electron/main.js`.
  - Renamed the old `loadLegacyPage()` boot fallback to `loadBootRecoveryPage()` so `index.html` is no longer described as a product legacy entry.
  - Updated `js/presentation/moreView.js` so the old More-page writing button routes through `electronAPI.openPracticeRoute('/writing')` and surfaces route failures non-blockingly.
  - Deleted the dead `electron/pages/writing.html` placeholder; `electron/pages/` is now empty.
  - Updated `server/src/lib/practice/migration-status.ts` so writing practice records `electronAPI.openPracticeRoute('/writing')` as its route surface and deletion criteria explicitly ban standalone writing navigation IPC.
  - Updated static/API contracts to forbid `openWriting`, `navigate-to-writing`, `loadWritingPage`, `openLegacy`, `navigate-to-legacy`, and `loadLegacyPage` in product entrypoints.
  - Audited `assets/scripts` and confirmed `complete-exam-data.js` plus `listening-exam-data.js` remain runtime data sources for boot recovery/listening, while Python reading explanation generation/supervision scripts are developer-only.
  - Moved the live reading explanation generator to `developer/tests/tools/reading-explanations/generate_reading_explanations_with_agent.py`.
  - Deleted dead/unreferenced reading explanation generation supervisors from runtime assets: `generate_reading_explanations.py`, `run_reading_explanation_opencode_batch.py`, `run_reading_explanation_supervisor_pool.py`, and `monitor_reading_supervisor.py`.
  - Removed the now-unnecessary `!assets/scripts/*.py` package exclusion because runtime `assets/scripts` no longer contains Python files.
  - Added a static `assets/scripts` runtime boundary guard so only exam-index JS data can live there.
  - Deleted unscheduled/dead E2E scripts `developer/tests/e2e/path_compatibility_playwright.py`, `developer/tests/e2e/mock_eval_flow.py`, and `developer/tests/e2e/mock_upload_flow.py`.
  - Deleted private path-compatibility fixture pages under `developer/tests/e2e/fixtures/`, while keeping `data-integrity-import-sample.json` because the app E2E import flow still uses it.
  - Added a static E2E dead-script boundary guard so the removed mock/path scripts and private fixture pages cannot silently return.
  - Ran focused syntax and contract checks successfully before the final required gates.
  - Verified the final required gates: `python` remains unavailable in this environment, and the same required scripts pass under `python3`.
  - Ran a final residual-reference scan; old standalone writing/legacy IPC and removed script names only remain inside static guards and contract tests that forbid their return.
  - Used a 5.3 Codex subagent for a final read-only cleanup audit; it identified three orphaned Electron debug runners outside the current runtime/static/E2E graph.
  - Deleted `electron/test_main.js`, `electron/test-electron-module.js`, and `electron/test_api_runner.js`.
  - Removed stale `!electron/test_*.js` and `!electron/test-*.js` package excludes now that those debug runners no longer exist.
  - Added a static Electron debug script boundary guard so the deleted runners and stale package excludes cannot return silently.
  - Updated the Practice migration matrix and JS contract tests to record the Electron debug runner deletion criterion.
  - Updated historical developer chat notes so they no longer point to the deleted API debug runner as an active file.
  - Re-ran focused builds/contracts and the required gates after Electron debug runner deletion; `python` remains unavailable, and both required scripts pass under `python3`.
- Files created/modified:
  - `electron/main.js`
  - `electron/preload.js`
  - `js/presentation/moreView.js`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/e2e/simulation_roundtrip_restore_regression.py`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/ci/run_static_suite.py`
  - `developer/tests/ci/writing_backend_contract.py`
  - `developer/tests/e2e/path_compatibility_playwright.py` (deleted)
  - `developer/tests/e2e/mock_eval_flow.py` (deleted)
  - `developer/tests/e2e/mock_upload_flow.py` (deleted)
  - `developer/tests/e2e/fixtures/index.html` (deleted)
  - `electron/test_main.js` (deleted)
  - `electron/test-electron-module.js` (deleted)
  - `electron/test_api_runner.js` (deleted)
  - `developer/tests/py/test_reading_explanation_generator.py`
  - `developer/tests/tools/reading-explanations/generate_reading_explanations_with_agent.py`
  - `package.json`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`
  - `developer/docs/chat.md`

### Slice 11: Practice Shared/Data Layer Compression
- **Status:** complete
- Actions taken:
  - Re-read planning files and audited `server/src/lib/practice/service.ts`, `server/src/routes/practice.ts`, `server/src/lib/practice/practice-history.ts`, `server/src/lib/practice/reading-assets.ts`, `server/src/lib/practice/reading-suite-sessions.ts`, `apps/writing-vue/src/api/practice-client.js`, and current Practice contract tests.
  - Used a 5.3 Codex subagent for read-only Shared/Data risk audit. It confirmed the correct next pressure points: duplicated pagination/id/path helpers, duplicated reading submission persistence skeletons, and `readingSuiteSessions` still being in-memory only.
  - Added `server/src/lib/shared/http.ts` with `createHttpError()`, `normalizePagination()`, and `paginate()`.
  - Added `server/src/lib/shared/json.ts` with `safeJsonParse()` and `safeJsonStringify()`.
  - Added `server/src/lib/shared/response.ts` with `sendSuccess()` and `sendError()` for Fastify route envelopes.
  - Replaced local Practice service, reading asset loader, and suite session `makeHttpError()` copies with shared `createHttpError()`.
  - Replaced local Practice service and history pagination helpers with shared `normalizePagination()` / `paginate()`.
  - Replaced local history JSON helpers with shared safe JSON helpers.
  - Updated `server/src/routes/practice.ts` to use `sendSuccess()` / `sendError()` and removed ad hoc success/error envelopes from non-SSE handlers.
  - Changed list route schemas so overlarge `limit` values are accepted and clamped by the shared pagination contract instead of being rejected before service normalization.
  - Added `recoverReadingSubmission()` in `PracticeHistoryStore`, allowing reading replay to recover from a corrupt persisted `submission_json` using the same record's legacy snapshot.
  - Added `isRecoverableReadingSubmission()` after TypeScript rejected a direct wide-object cast.
  - Centralized Vue Practice endpoint path construction in `practicePath()` so facade methods do not each hand-roll `encodeURIComponent()` paths.
  - Added API coverage for shared pagination clamp and corrupt `submission_json` replay recovery.
  - Added static contract coverage for shared server helpers, route envelope helpers, history recovery, and Vue `practicePath()`.
  - Updated the Practice migration matrix to include the shared/data layer deletion criterion.
  - Ran focused checks: `npm run build:server`, `node developer/tests/js/practiceApiFacade.test.js`, and `node developer/tests/js/practiceVueShell.test.js`.
  - Ran full serial verification after planning/doc updates: `npm run build:server`, `npm run build:writing`, focused JS contracts, required static suite via `python3`, and required suite E2E via `python3`.
  - Confirmed no `__pycache__` directories remained after test execution.
- Files created/modified:
  - `server/src/lib/shared/http.ts`
  - `server/src/lib/shared/json.ts`
  - `server/src/lib/shared/response.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/practice-history.ts`
  - `server/src/lib/practice/reading-assets.ts`
  - `server/src/lib/practice/reading-suite-sessions.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `server/src/routes/practice.ts`
  - `apps/writing-vue/src/api/practice-client.js`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Slice 12: Product Suite Fallback Compression
- **Status:** complete
- Actions taken:
  - Re-read planning files, `js/presentation/app-actions.js`, the suite migration matrix, and the existing suite route/static contract tests.
  - Used a 5.3 Codex subagent for read-only suite fallback audit. It confirmed product suite failures no longer need automatic legacy fallback and recommended adding `suite_test=1` / `ci=1` explicit regression coverage plus Electron route failure coverage.
  - Replaced the old `tryStartVueReadingSuite() -> false -> startLegacySuite()` control-flow shape with two explicit branches:
    - Product path: `startVueReadingSuite()` creates `/api/practice/reading-suite` and navigates to Vue `/reading-suite/:sessionId`.
    - Regression path: `startExplicitLegacySuiteRegression()` calls legacy `suitePracticeMixin` only for `test_env=1`, `suite_test=1`, or `ci=1`.
  - Removed stale `continueSuitePractice` public export from `AppActions` and `window` because the current product shell does not reference that old bridge.
  - Updated the Practice migration matrix so suite legacy is described as explicit regression-only, while Vue/API/route failure surfaces an error and never starts legacy.
  - Extended `legacySuiteVueRoute.test.js` to cover all three explicit regression flags and route IPC failure without legacy fallback.
  - Extended `practiceVueShell.test.js` to forbid the old try/fallback control-flow shape and stale `continueSuitePractice` export.
  - Updated `task_plan.md`, `findings.md`, and `developer/docs/reading-writing-vue-unification-plan.md` with the new product Vue-only suite contract.
  - Verified syntax, server build, Vue build, Practice API contract, Vue shell static contract, legacy suite route contract, required static suite, and required suite E2E. The `python` binary is still unavailable; the exact required scripts pass under `python3`.
  - Confirmed no `__pycache__` directories remain after test execution.
- Files created/modified:
  - `js/presentation/app-actions.js`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/legacySuiteVueRoute.test.js`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 13: Reading Suite Session Persistence
- **Status:** complete
- Actions taken:
  - Re-read planning files, `PracticeService`, suite session pure functions, `PracticeHistoryStore`, schema/migration files, and Practice API/static tests.
  - Used two 5.3 Codex subagents for read-only audit:
    - One broader data/performance audit identified `readingSuiteSessions` as a real process-memory data owner bug and also flagged future work around VM-based asset loading and history payload duplication.
    - One narrow test audit confirmed the minimum test change: fake SQLite support for suite session upsert/select plus a cross-service-instance suite progress test.
  - Added `server/src/lib/shared/sqlite.ts` and moved the SQLite-like guard out of `PracticeHistoryStore`.
  - Added `server/src/lib/practice/reading-suite-store.ts`, using shared SQLite/JSON helpers and explicit corrupt-row errors.
  - Updated `PracticeService` so `createReadingSuite()`, `getReadingSuite()`, and `submitReadingSuitePassage()` use `ReadingSuiteSessionStore` instead of `readingSuiteSessions = new Map`.
  - Ensured `ReadingSuiteSessionStore` only uses memory fallback when no SQLite DB exists; packaged Electron paths with a DB do not mirror suite state into process memory.
  - Added `practice_reading_suite_sessions` table and `idx_practice_suite_status_updated_at` index to `electron/db/schema.sql` and `electron/db/migrations/20260209_phase06_schema.sql`.
  - Extended `developer/tests/js/practiceApiFacade.test.js` fake DB to support suite session upsert/select/delete SQL.
  - Added `testReadingSuitePersistsAcrossPracticeServiceInstances()`, proving P1/P2 progress survives across separate `createServerApp()` instances sharing the same DB.
  - Extended `developer/tests/js/practiceVueShell.test.js` to lock the store/schema/migration contract and forbid `PracticeService` from regaining a suite session Map.
  - Updated `server/src/lib/practice/migration-status.ts`, `task_plan.md`, `findings.md`, and `developer/docs/reading-writing-vue-unification-plan.md` with the new data-layer ownership rule.
  - Ran focused checks successfully before full gate execution:
    - `npm run build:server`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
  - Ran full verification after planning/doc updates:
    - `npm run build:server`
    - `npm run build:writing`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
  - Confirmed no `__pycache__` directories remained after test execution.
- Files created/modified:
  - `server/src/lib/shared/sqlite.ts`
  - `server/src/lib/practice/reading-suite-store.ts`
  - `server/src/lib/practice/practice-history.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `electron/db/schema.sql`
  - `electron/db/migrations/20260209_phase06_schema.sql`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 14: VM-free Reading Asset Loading
- **Status:** complete
- Actions taken:
  - Re-read planning files, Practice reading asset loader, Practice service manifest path, migration matrix, and current API/static contracts.
  - Used prior and current read-only audit findings to isolate the two Practice runtime VM execution points: manifest loading and generated exam payload loading.
  - Removed `node:vm` from `server/src/lib/practice/reading-assets.ts`.
  - Added strict JSON-container parsing helpers for balanced object extraction, JSON string token parsing, manifest assignment parsing, and generated exam register payload parsing.
  - Moved `loadReadingManifest()` into `reading-assets.ts` and changed `PracticeService` to import `loadReadingManifest()` / `loadReadingPracticePayload()` instead of loading manifest scripts itself.
  - Kept the asset key mismatch guard so extracted register keys still have to match the manifest asset identity.
  - Extended `developer/tests/js/practiceApiFacade.test.js` with `p2-low-051` minified wrapper coverage: asset id, payload exam id, question count, question display map, answer key, passage text, and radio/text interaction controls.
  - Extended migration status and static contracts so `server/src/lib/practice/reading-assets.ts VM-free JSON parser` and `without node:vm or runInNewContext` are deletion criteria.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
  - Ran full verification after planning/doc updates:
    - `npm run build:server`
    - `npm run build:writing`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
- Files created/modified:
  - `server/src/lib/practice/reading-assets.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 15: Single Reading Session Data Ownership
- **Status:** complete
- Actions taken:
  - Re-read `PracticeService`, `PracticeHistoryStore`, Practice session routes, migration matrix, and API/static contract tests.
  - Used the read-only audit result to identify `PracticeService.readingSessions = new Map()` as the next real Electron memory/state-owner bug after suite persistence.
  - Removed the `PracticeService` single-reading session Map.
  - Changed reading session state and reading coach session context to restore from `PracticeHistoryStore.getReadingSubmission()` instead of process memory.
  - Changed submitted reading session cancellation to return `practice_session_not_cancellable` with HTTP 409; submitted reading sessions are history facts, not active jobs.
  - Changed `PracticeHistoryStore.upsert()` so memory fallback is only used when no SQLite database exists; packaged Electron DB paths no longer mirror history rows into process memory.
  - Updated `server/src/lib/practice/migration-status.ts` so single-reading capability exposes `practice_history_records SQLite-backed session replay`, and deletion criteria forbid `PracticeService` reading-session Map ownership.
  - Extended `developer/tests/js/practiceApiFacade.test.js` to prove submitted reading session DELETE returns 409 and replay still works afterwards.
  - Extended `developer/tests/js/practiceVueShell.test.js` to forbid `readingSessions` / `this.readingSessions` in `PracticeService` and lock history-backed replay ownership.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
  - Ran full verification after planning/doc updates:
    - `npm run build:writing`
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Files created/modified:
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/practice-history.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 16: ReadingCoach Generated Data VM Removal
- **Status:** complete
- Actions taken:
  - Re-read `server/src/lib/reading/coach-service.ts`, `server/src/lib/practice/reading-assets.ts`, migration matrix, ReadingCoach tests, and Practice static contracts.
  - Used a 5.3 Codex read-only subagent to confirm the real data shape: exam and explanation generated files are IIFE wrappers around JSON register payloads, not executable business logic.
  - Added `server/src/lib/shared/generated-json.ts` for shared assignment/register JSON-container parsing.
  - Added `server/src/lib/shared/reading-generated-data.ts` for reading manifest, exam, and explanation register payload parsing.
  - Changed `server/src/lib/practice/reading-assets.ts` to reuse the shared reading generated parser instead of owning a separate balanced scanner.
  - Removed `require('vm')` and `runInNewContext` from `server/src/lib/reading/coach-service.ts`.
  - Changed `ReadingCoachService` to parse generated exam and explanation payloads with `parseReadingExamDataSource()` and `parseReadingExplanationDataSource()` while preserving raw payloads for `buildReadingChunks()`.
  - Updated `server/src/lib/practice/migration-status.ts` so VM-free generated data loading covers both Practice and ReadingCoach runtime paths.
  - Extended `developer/tests/js/readingAnalysisService.test.js` to assert Coach source is VM-free and parse a real `p1-high-01` exam/explanation fixture through the shared parser.
  - Extended `developer/tests/js/practiceVueShell.test.js` to lock shared parser ownership and forbid ReadingCoach VM execution.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/readingAnalysisService.test.js`
  - Ran full verification after planning/doc updates:
    - `node developer/tests/js/practiceApiFacade.test.js`
    - `npm run build:writing`
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
  - Ran final hygiene checks:
    - No `__pycache__` directories found.
    - No `require('vm')`, `node:vm`, `import vm`, or `runInNewContext` remains in the ReadingCoach/Practice generated-data runtime path.
    - No `readingSessions` / `this.readingSessions` remains in `server/src/lib/practice/service.ts`.
- Files created/modified:
  - `server/src/lib/shared/generated-json.ts`
  - `server/src/lib/shared/reading-generated-data.ts`
  - `server/src/lib/practice/reading-assets.ts`
  - `server/src/lib/reading/coach-service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/readingAnalysisService.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 17: Practice History Payload Single Source
- **Status:** complete
- Actions taken:
  - Re-read `PracticeHistoryStore`, `PracticeService`, Practice contracts, Electron schema/migration files, API facade tests, Vue shell static contracts, and Vue reading E2E mock responses.
  - Used a 5.3 Codex worker for the bounded test-surface update in `practiceVueShell.test.js` and `practice_reading_vue_flow.py`; it removed E2E mock `legacyRecord` output and added static guards against history shadow fields.
  - Added `readingCoachSnapshot` and `readingCoachTranscript` to `ReadingPracticeSubmission`.
  - Removed `legacyRecord` from `PracticeHistoryRecord` and stopped returning full legacy history records from reading session state.
  - Deleted legacy history shadow builders and corrupt `submission_json` recovery from `PracticeHistoryStore`.
  - Changed `attachReadingCoachResult()` to update canonical `submission_json` with coach snapshot/transcript.
  - Removed `legacy_record_json` from `electron/db/schema.sql` and `electron/db/migrations/20260209_phase06_schema.sql`.
  - Added a `PracticeHistoryStore.ensureSchema()` shadow-column detector that rebuilds `practice_history_records` instead of migrating old shadow data; this matches the initial-client no-compatibility requirement.
  - Updated `server/src/lib/practice/migration-status.ts` so single-reading history advertises `practice_history_records submission_json-only session replay`.
  - Updated `developer/tests/js/practiceApiFacade.test.js` so history replay, analysis artifacts, and coach transcript persistence are asserted through `submission`.
  - Updated `developer/docs/reading-writing-vue-unification-plan.md`, `task_plan.md`, and `findings.md` with the canonical history decision.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
  - Ran full verification after planning/doc updates:
    - `npm run build:writing`
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/reading-sessions.ts`
  - `server/src/lib/practice/practice-history.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `electron/db/schema.sql`
  - `electron/db/migrations/20260209_phase06_schema.sql`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_vue_flow.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 18: Practice History Summary Hot Path
- **Status:** complete
- Actions taken:
  - Re-read planning files, `PracticeHistoryStore`, Practice contracts, Practice routes/service, Vue Practice Library history usage, Vue reading replay usage, and current API/E2E tests.
  - Confirmed the next real data hot-path bug: `/api/practice/history` list used `SELECT *`, parsed `submission_json`, and returned full `submission` even though Vue list rows only need review-launch metadata and score summary.
  - Added `PracticeHistorySummary` and changed `PracticeHistoryRecord` to extend it for detail/replay use.
  - Changed `PracticeHistoryStore.saveReadingSubmission()` to return a summary, so reading create/suite submit responses no longer duplicate the top-level `submission` inside `historyRecord`.
  - Changed `PracticeHistoryStore.list()` memory fallback to project records through `summarizeHistoryRecord()`.
  - Changed SQLite history list SQL to select explicit summary columns only and exclude `submission_json`.
  - Kept `getById()`, `getBySession()`, `getReadingSubmission()`, and coach persistence on full `submission_json`.
  - Updated `server/src/lib/practice/migration-status.ts` with `PracticeHistorySummary list without submission_json parsing`.
  - Updated `developer/tests/js/practiceApiFacade.test.js` to assert create response and history list rows have no `submission`, while session replay/history detail still expose full canonical submission.
  - Updated `developer/tests/js/practiceVueShell.test.js` to lock the summary contract, summary projection, and SQLite list column boundary.
  - Updated `developer/tests/e2e/practice_reading_vue_flow.py` mock API so history list rows are summaries and detail/replay paths own full submissions.
  - Ran focused verification:
    - `npm run build:server` passed.
    - `node developer/tests/js/practiceVueShell.test.js` passed.
    - `node developer/tests/js/practiceApiFacade.test.js` initially failed because a summary score assertion assumed a full-score attempt; fixed the test to compare against the canonical submission score, then it passed.
  - Ran full verification after planning/doc updates:
    - `npm run build:server` passed.
    - `node developer/tests/js/practiceVueShell.test.js` passed.
    - `node developer/tests/js/practiceApiFacade.test.js` passed.
    - `npm run build:writing` passed.
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
  - Ran final hygiene checks:
    - No `__pycache__` directories found.
    - No `historyRecord.submission` or `list.data[0].submission` usage remains in server/Vue/test surfaces.
- Files created/modified:
  - `server/src/lib/practice/contracts.ts`
  - `server/src/lib/practice/practice-history.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `developer/tests/e2e/practice_reading_vue_flow.py`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 19: Practice Reading Asset Payload Cache
- **Status:** complete
- Actions taken:
  - Re-read planning files, `server/src/lib/practice/reading-assets.ts`, `server/src/lib/practice/service.ts`, `server/src/lib/practice/practice-history.ts`, migration status, and current API/static tests.
  - Tried to spawn 5.3 Codex subagents for parallel legacy-runtime and asset-cache audits, but the agent thread limit was reached; completed the asset-cache audit locally.
  - Confirmed the real Electron hot-path issue: after VM-free parsing, reading detail, single reading submit, and suite passage submit still called `loadReadingPracticePayload()` and re-read/re-parsed the same generated exam file.
  - Moved manifest cache ownership from `PracticeService` instance state into `server/src/lib/practice/reading-assets.ts`.
  - Added a 32-entry bounded module-level normalized payload cache in `reading-assets.ts`, with LRU refresh on hit and eviction on overflow.
  - Added test-only cache stats/reset hooks so API tests can assert hot-path behavior without monkey-patching filesystem calls.
  - Removed `PracticeService.readingManifestCache`, keeping asset data ownership in the loader/data layer.
  - Updated `server/src/lib/practice/migration-status.ts` so single-reading API surfaces and deletion criteria include bounded reading payload cache.
  - Updated `developer/tests/js/practiceApiFacade.test.js` with `testReadingAssetPayloadCacheHotPath()`, covering list manifest cache, repeated detail cache hit, submit cache reuse, and bounded payload cache size.
  - Updated `developer/tests/js/practiceVueShell.test.js` to lock loader-level cache ownership and forbid `PracticeService` local manifest cache returning.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
    - `npm run build:writing`
  - Ran full required gates:
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
  - Ran final hygiene checks:
    - `git diff --check` passed.
    - No `__pycache__` directories found.
    - Targeted cache ownership scan confirms `readingManifestCache` only remains in `reading-assets.ts` and docs/tests; `PracticeService` local cache is statically forbidden.
- Files created/modified:
  - `server/src/lib/practice/reading-assets.ts`
  - `server/src/lib/practice/service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 20: ReadingCoach Cache Bound / Shared Cache Primitive
- **Status:** complete
- Actions taken:
  - Re-read planning files and the current ReadingCoach hot path: `server/src/lib/reading/coach-service.ts`, `chunks.ts`, migration status, and the API/static/ReadingCoach tests.
  - Tried to spawn a 5.3 Codex explorer for parallel cache-risk review, but the agent thread limit was reached; completed the cache audit locally.
  - Confirmed the real Electron memory issue: `ReadingCoachService.examBundleCache` was an unbounded Map, while `queryCache` only had TTL expiry and no capacity bound.
  - Added `server/src/lib/shared/cache.ts` with shared `touchCacheEntry()` and `setBoundedCacheEntry()` LRU helpers.
  - Changed `server/src/lib/practice/reading-assets.ts` to reuse the shared cache helper instead of owning a local LRU loop.
  - Changed `server/src/lib/reading/coach-service.ts` to bound exam bundles at 12 entries and query responses at 64 entries while preserving query TTL pruning.
  - Added ReadingCoach behavior tests for repeated query cache hits, query cache eviction, exam bundle reuse, and exam bundle eviction.
  - Updated `server/src/lib/practice/migration-status.ts`, `developer/tests/js/practiceApiFacade.test.js`, and `developer/tests/js/practiceVueShell.test.js` so bounded coach caches are part of the migration/deletion contract.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/js/readingAnalysisService.test.js`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
  - Ran full required gates:
    - `npm run build:writing` passed.
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Files created/modified:
  - `server/src/lib/shared/cache.ts`
  - `server/src/lib/practice/reading-assets.ts`
  - `server/src/lib/reading/coach-service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/js/readingAnalysisService.test.js`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 21: Writing Evaluation SSE Replay Cache Bound
- **Status:** complete
- Actions taken:
  - Re-read planning files, `server/src/lib/writing/evaluate-service.ts`, `server/src/lib/shared/cache.ts`, writing backend contract tests, Practice migration status, and current API/static tests.
  - Confirmed the real Electron memory issue: `EvaluateService.sessionEventCache` had a per-session 80-event cap but no replay-session count cap, so repeated writing evaluations inside the 15-minute TTL window could grow transient SSE hydration memory.
  - Enhanced `server/src/lib/shared/cache.ts` so `setBoundedCacheEntry()` returns evicted keys, allowing feature services to clean companion state without duplicating LRU logic.
  - Changed `server/src/lib/writing/evaluate-service.ts` to import shared cache helpers, bound SSE replay cache to 24 recent sessions, and preserve the existing 80-event tail per session.
  - Changed `getSessionState()` to prune expired replay cache entries and refresh LRU order on cache hit.
  - Added `getRuntimeCacheStats()` for runtime contract probes.
  - Added inactive `sessionProgress` cleanup when replay sessions expire or are evicted.
  - Updated `server/src/lib/practice/migration-status.ts` so writing API surfaces and deletion criteria include bounded SSE replay cache.
  - Expanded `developer/tests/ci/writing_contract_probe.cjs` to verify single-session event tail stays at 80 and total replay sessions stay at 24.
  - Expanded `developer/tests/ci/writing_backend_contract.py`, `developer/tests/js/practiceVueShell.test.js`, and `developer/tests/js/practiceApiFacade.test.js` to lock the bounded writing replay cache contract.
  - Ran focused verification successfully:
    - `npm run build:server`
    - `node developer/tests/ci/writing_contract_probe.cjs` passed with `session_event_cache_entries=24` and `session_event_tail_length=80`.
    - `python3 developer/tests/ci/writing_backend_contract.py`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
    - `node developer/tests/js/readingAnalysisService.test.js`
    - `npm run build:writing`
  - Ran full required gates:
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
  - Ran final hygiene checks:
    - `git diff --check` passed.
    - Removed test-generated `developer/tests/ci/__pycache__`.
- Files created/modified:
  - `server/src/lib/shared/cache.ts`
  - `server/src/lib/writing/evaluate-service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/ci/writing_contract_probe.cjs`
  - `developer/tests/ci/writing_backend_contract.py`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Slice 22: Writing Essay History Summary Hot Path
- **Status:** complete
- Actions taken:
  - Re-read planning files, `electron/db/dao/essays.dao.js`, `electron/services/essay.service.js`, `apps/writing-vue/src/views/HistoryPage.vue`, `server/src/lib/writing/evaluate-service.ts`, migration status, and writing backend/static tests.
  - Could not spawn another 5.3 Codex subagent because the agent thread limit was reached; completed the writing history hot-path audit locally.
  - Confirmed the real Electron hot-path issue: `/api/essays` history list selected `e.*`, returned essay `content` and `evaluation_json`, then parsed evaluation JSON per row just to derive list display fields.
  - Added `essays.topic_text` to `electron/db/schema.sql` and `electron/db/migrations/20260209_phase06_schema.sql`.
  - Added `Migrator._ensureCurrentSchema()` with `_ensureColumn('essays', 'topic_text', 'TEXT')` because the bundled SQLite does not support `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
  - Changed `EssaysDAO.list()` to select explicit summary columns only and exclude `content` / `evaluation_json`.
  - Changed essay history search from `t.title_json LIKE ? OR e.evaluation_json LIKE ? OR e.content LIKE ?` to `t.title_json LIKE ? OR e.topic_text LIKE ? OR e.content LIKE ?`.
  - Changed `EssaysDAO.create()` and writing evaluation persistence to store `topic_text` beside `topic_id`.
  - Changed `EssayService.list()` and `exportCSV()` to use `_decorateEssaySummary()` so list/export paths never parse full evaluation payloads.
  - Kept `EssayService.getById()` on `_decorateEssayRecord()` so detail pages still parse full `evaluation_json` and expose analysis fields.
  - Updated `server/src/lib/practice/migration-status.ts` so writing API surfaces and deletion criteria include the essay history summary list contract.
  - Added `developer/tests/ci/writing_essay_history_contract.cjs`, using poisoned getters to prove list summary never reads `content` or `evaluation_json`, while detail still parses full evaluation JSON.
  - Wired the new contract into `developer/tests/ci/run_static_suite.py`.
  - Expanded `developer/tests/ci/writing_backend_contract.py`, `developer/tests/js/practiceVueShell.test.js`, and `developer/tests/js/practiceApiFacade.test.js` to lock `topic_text`, summary decoration, and no `evaluation_json LIKE` scan.
  - Ran focused verification successfully:
    - `node developer/tests/ci/writing_essay_history_contract.cjs`
    - `node developer/tests/js/practiceVueShell.test.js`
    - `node developer/tests/js/practiceApiFacade.test.js`
    - `npm run build:server`
    - `python3 developer/tests/ci/writing_backend_contract.py`
    - `node developer/tests/js/readingAnalysisService.test.js`
    - `node developer/tests/ci/writing_contract_probe.cjs`
    - `npm run build:writing`
  - An accidental parallel run of `writing_contract_probe.cjs` and `readingAnalysisService.test.js` hit `server/dist` churn once; reran both serially and they passed.
  - Ran full required gates:
    - `python developer/tests/ci/run_static_suite.py` failed because `python` is unavailable.
    - `python3 developer/tests/ci/run_static_suite.py` passed.
    - `python developer/tests/e2e/suite_practice_flow.py` failed because `python` is unavailable.
    - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
  - Ran final hygiene checks:
    - `git diff --check` initially found trailing whitespace in `electron/db/dao/essays.dao.js`; fixed it and reran successfully.
- Files created/modified:
  - `electron/db/schema.sql`
  - `electron/db/migrations/20260209_phase06_schema.sql`
  - `electron/db/migrator.js`
  - `electron/db/dao/essays.dao.js`
  - `electron/services/essay.service.js`
  - `server/src/lib/writing/evaluate-service.ts`
  - `server/src/lib/practice/migration-status.ts`
  - `developer/tests/ci/writing_essay_history_contract.cjs`
  - `developer/tests/ci/run_static_suite.py`
  - `developer/tests/ci/writing_backend_contract.py`
  - `developer/tests/js/practiceApiFacade.test.js`
  - `developer/tests/js/practiceVueShell.test.js`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

### Startup Repair: `npm start` Native Binding Failure
- **Status:** complete
- Actions taken:
  - Reproduced `npm start`.
  - Confirmed `npm run build:server` and `npm run build:writing` both passed.
  - Captured the real startup failure at Electron DB initialization: `better-sqlite3` could not locate `better_sqlite3.node`.
  - Checked `node_modules/better-sqlite3` and confirmed no native `.node` binding existed before repair.
  - Ran `npx electron-builder install-app-deps`, which rebuilt `better-sqlite3` for Electron 31 / ABI 125 under `node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
  - Verified the command-line Node 22 ABI mismatch is expected after Electron rebuild; the rebuilt binding targets Electron, not system Node.
  - Reran `npm start`; it passed server build, writing build, registered Electron navigation IPC, and stayed running instead of crashing at migrator startup.
  - Terminated the verification Electron process manually so no background `npm start` / Electron process remained.
- Files created/modified:
  - Local ignored native artifact: `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
  - `progress.md`

### Slice 23: Legacy Reading UX Parity Rebaseline
- **Status:** planning complete; implementation pending
- Trigger:
  - User reported that the current Vue reading implementation breaks the original overview UI and raises user learning cost.
  - The requested correction is not more redesign; it is full Vue reconstruction of legacy reading screens with the original UI, click paths, and business behavior preserved.
- Actions taken:
  - Re-read legacy `index.html` top-level layout and confirmed the original product shell is `考试总览系统` with `总览`、`题库浏览`、`练习记录`、`更多`、`设置`.
  - Re-read `js/views/overviewView.js` and `js/services/overviewStats.js`; identified the actual overview contract: P1/P2/P3 reading category cards, article counts, `浏览题库`, `随机练习`, `套题模式`, and `无尽模式`.
  - Re-read `js/app/examActions.js` and `js/presentation/indexInteractions.js`; identified the browse contract: type filters, search, sort, list-position preference, exam cards, `开始练习`, and `PDF`.
  - Re-read `PracticeLibraryPage.vue` and confirmed it is an engineering-oriented replacement UI (`Practice Library`, `统一练习库`, `Migration State`, `Entrypoint Matrix`) rather than a Vue version of the legacy overview.
  - Re-read `PracticeReadingPage.vue` and confirmed it front-loads Answer Sheet / AI Coach / analysis panels in a way that changes the original reading workspace rhythm.
  - Updated `task_plan.md`, `findings.md`, and `developer/docs/reading-writing-vue-unification-plan.md` to rebaseline the migration around UX parity.
- New implementation plan:
  - Restore Vue top-level IA to legacy labels and routes: `总览`, `题库浏览`, `练习记录`, `更多`, `设置`.
  - Replace `/library` as user-facing home with Vue overview parity; keep Practice API underneath.
  - Rebuild overview category cards with the same labels and actions as legacy.
  - Rebuild browse list with the same filters/search/sort/start/PDF controls as legacy.
  - Move migration matrix out of normal user surfaces; keep it in API/tests/dev docs.
  - Rework reading workspace toward legacy reading page parity before adding extra AI-native affordances.
  - Add E2E parity tests that click the same visible controls as the legacy app.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`
  - `developer/docs/reading-writing-vue-unification-plan.md`

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Slice 23 UX parity rebaseline planning is complete; implementation should next restore the legacy overview/browse/records/read-through experience in Vue. |
| Where am I going? | Build Vue screens that preserve the old reading product workflow before deleting more legacy UI/runtime code. |
| What's the goal? | Merge reading into the writing/AI native Vue application as one coherent Electron product flow. |
| What have I learned? | See `findings.md`. |
| What have I done? | Added and tested Practice reading detail payloads, Vue reading route/page, answer capture, server-side scoring, readonly review, AI coach session context, persistent reading history, Vue replay route, Vue-native drag/drop parity, reading analysis artifacts, Electron Vue default entrypoint, Practice migration matrix, legacy single-reading Vue redirect, Vue reading suite session shell, legacy homepage suite Vue redirect, removed standalone writing/legacy product navigation IPC, compressed Practice Shared/Data helpers, tightened product suite fallback to Vue-only, moved reading suite progress from `PracticeService` memory into SQLite-backed data ownership, removed VM execution from Practice reading asset loading, removed the single-reading submitted-session Map from `PracticeService`, removed VM execution from ReadingCoach generated exam/explanation loading, compressed Practice history to canonical `submission_json` only, split history list summaries from full submission replay/detail payloads, moved generated reading exam payload reuse into a bounded loader cache, moved ReadingCoach caches onto shared bounded LRU primitives, bounded writing evaluation SSE replay cache by event count and session count, compressed writing essay history lists to topic_text-backed summary rows without content/evaluation JSON reads, repaired local `npm start` native binding failure, and rebaselined the next Vue work around legacy reading UX parity. |

### Slice 23 Implementation Batch: OpenSource Suite Selector + AI Review Race
- **Status:** in progress
- Actions taken:
  - Restored the OpenSource suite flow selector in `PracticeLibraryPage.vue` with `#suite-mode-selector-modal`, `data-suite-flow-mode`, and `#suite-frequency-scope`.
  - Routed suite create through selected `flowMode` / `frequencyScope` preferences and persisted the existing legacy localStorage keys `suite_flow_mode`, `suite_frequency_scope`, and `suite_auto_advance_after_submit`.
  - Removed the hardcoded Vue suite create payload `{ flowMode: 'simulation', frequencyScope: 'all' }`.
  - Preserved field discipline: did not add a backend sequence/custom-field for legacy custom suite selection.
  - Corrected reading asset summary semantics so `payloadRef` is only emitted when a generated reading script exists.
  - Updated Vue random/start behavior so PDF-only reading assets open their PDF instead of entering an empty `/reading/:assetId` page.
  - Changed `PracticeReadingPage.vue` submit flow to await automatic AI review for suite passages as well as single/endless sessions, eliminating the coach persistence race.
  - Added static/API/E2E coverage for suite selector, PDF-only payload semantics, and suite automatic review waiting.
- Verification so far:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `npm run build:writing` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
- Notes:
  - `practice_reading_suite_vue_flow.py` initially waited for the old `考试总览系统` title; updated it to use the stable `[data-practice-reading-home] h1:has-text("IELTS Atlas")` marker.
  - Remaining UI parity debt is concentrated in `PracticeReadingPage.vue` legacy workspace DOM and review navigation semantics.

### Slice 24: Reading Page Legacy Interaction Recovery
- **Status:** checkpoint complete
- Actions taken:
  - Restored the Vue reading page legacy interaction shell around the existing Practice API/AI chain instead of replacing it with legacy scripts.
  - Reintroduced and wired the OpenSource/legacy DOM contracts: `#settings-btn`, `#settings-panel`, `#note-btn`, `#notes-panel`, `.overlay`, `#selbar`, `#btnHL`, `#btnUH`, `#btnNote`, `#review-highlight-dictionary-bubble`, `#question-groups`, `#question-nav`, `#reset-btn`, and `#submit-btn`.
  - Repaired `#divider` as an accessible separator with pointer and keyboard pane resizing.
  - Removed the redesigned bottom-nav answer-control proxy path; bottom nav now stays a legacy question navigator while answer controls remain in the question DOM.
  - Implemented selection highlight/note snapshot and replay in Vue, using the existing `attempt.highlights` / `submission.highlights` / `analysisArtifacts.highlights` fields.
  - Extended `ReadingPracticeHighlightRecord` only with optional metadata needed for reliable replay: `kind`, `before`, `after`, and `occurrence`; no new top-level fields were added.
  - Preserved AI prompt/API behavior. The automatic review prompt and reading coach payload chain were not rewritten.
  - Added lightweight highlight dictionary bubble behavior using the existing fallback key `exam_system_vocab_list_reading_highlights`.
  - Added memorize-mode answer cards and locator highlight helpers that reuse `payload.answerKey`.
  - Updated static and E2E tests to protect the real contract: legacy `Submit`/`Reset`, no answer controls in bottom nav, highlighter submit payload, replay restore, archive restore, and suite reading parity.
- Verification:
  - `npm run build:writing` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
- Notes:
  - `python3 developer/tests/ci/run_static_suite.py` was first started while `practice_reading_suite_vue_flow.py` still had the old `提交并复盘` selector, so that run failed. After updating the suite E2E to `#submit-btn`, the full static suite passed.
  - Subagent read-only audit agreed with the implemented field discipline: extract OpenSource capabilities into Vue/Electron, do not copy the legacy runtime wholesale, and do not add parallel highlight/vocab fields.
  - Remaining OpenSource parity debt: expose a legacy-compatible `window.__IELTS_PRACTICE_TIMER__.getSnapshot()` bridge if any surviving suite/enhancer code still depends on that runtime contract.

### Slice 25: Reading Timer Bridge + Metadata Contraction
- **Status:** complete
- Actions taken:
  - Added the legacy-compatible Vue reading timer bridge `window.__IELTS_PRACTICE_TIMER__` with `getSnapshot()`, `pause()`, `resume()`, `setRunning()`, and the `practiceTimerStateChange` event.
  - Kept timer facts out of new top-level submission fields. Submit now sends legacy-compatible `timerSnapshot`, `effectiveEndTime`, `effectiveEndTimeMs`, and `scrollY`, while the backend normalizes them into `submission.metadata`.
  - Made duration resolution prefer existing canonical duration aliases and timer snapshot values without adding parallel score/history fields.
  - Extended legacy archive/import conversion to preserve timer snapshot and scroll metadata when ingesting older reading records.
  - Restored replay viewport from `metadata.scrollY` after submitted-session load.
  - Updated static/API/E2E coverage for timer bridge, Submit payload metadata, history/archive persistence, and replay restoration.
- Verification:
  - `npm run build:writing` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed.
- Notes:
  - Subagent read-only audit identified remaining OpenSource migration debt after this slice: suite-global timer anchor/mode semantics, richer Coach timeline signals, Settings archive boundary wording/actions, and Shui/Three background ownership.

### Slice 26: Reading AI/RAG Timeline Signal Compression
- **Status:** complete
- Actions taken:
  - Audited the Vue reading submit payload, Practice submission normalization, ReadingCoach payload normalization, RAG retrieval signal extraction, and prompt formatting path.
  - Found a real gap: RAG already consumes `visitCount` and `elapsedMs/durationMs`, but Vue only submitted `firstAnsweredAt`, `lastAnsweredAt`, and `changeCount`.
  - Extended the existing `questionTimelineLite` record instead of creating a parallel behavior table: `visitCount`, `elapsedMs`, and `durationMs` now travel through submit, backend normalization, persisted submission, Coach payload, retrieval attempt signals, and prompt context.
  - Added Vue-side question visit tracking for nav jumps, native inputs, checkbox groups, drag/drop answers, submit flush, and coach payload flush.
  - Confirmed the existing duplicate `recordAnswerTimeline()` call in `assignAnswer()` is not present in the current file state; interaction density is not double-incremented there.
  - Kept AI prompt task wording intact. This slice changes context fidelity only; it does not rewrite the automatic review prompt or coach prompt intent.
- Verification:
  - `npm run build:writing` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `node developer/tests/js/readingAnalysisService.test.js` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed.
- Notes:
  - Remaining debt is now more specific: suite-global timer anchor/mode/limit semantics, Settings archive boundary wording/actions, and Shui/Three background ownership.

### Slice 27: Reading Suite Timer + AI Context Contract
- **Status:** complete
- Actions taken:
  - Audited `origin/opensource` suite timer/runtime changes and current Vue/Electron chain with two read-only subagents.
  - Added canonical `ReadingSuiteSession.timer` instead of copying legacy aliases such as `globalTimerAnchorMs` or `suiteTimerAnchorMs` into the new Practice contract.
  - Created backend suite timer normalization/merge logic. Suite creation owns one `timer` object; passage submit merges the submitted `metadata.timerSnapshot` back into the suite session JSON.
  - Updated Vue `PracticeReadingPage.vue` so suite passages apply the suite-global timer anchor and preserve timer `mode` / `limitSeconds` in the existing timer bridge and submit metadata.
  - Fixed null handling so `limitSeconds: null` stays null and is not converted into a 0-second countdown.
  - Added dynamic tests proving single and suite AI coach requests carry canonical `analysisSignals`, `questionTimelineLite`, and `questionTypePerformance` through the existing `attemptContext`.
  - Preserved prompt wording and backend coach/prompt/RAG implementation. This slice tightens context contracts only.
- Verification:
  - `npm run build:writing` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed.
- Notes:
  - `node developer/tests/js/practiceApiFacade.test.js` rebuilds `server/dist`; keep it serial with other server-build-mutating tests when possible.

### Slice 28: OpenSource Asset + Offline Dictionary Consolidation
- **Status:** checkpoint complete
- Actions taken:
  - Reused existing subagent findings after a new spawn hit the current thread-agent limit.
  - Synced latest OpenSource generated reading exam/explanation assets into the current Electron/Vue catalog.
  - Added OpenSource `js/core/dictionaryService.js` and wired Vue review highlight lookup to load `assets/wordlists/ielts_core.bundle.js` and the dictionary service on demand.
  - Kept dictionary persistence out of Practice backend fields; lookup falls back to the existing `exam_system_vocab_list_reading_highlights` localStorage shape.
  - Added Vue static contracts for dictionary runtime loading, service lookup, embedded wordlist registration, and no new dictionary backend payload/snapshot fields.
  - Added Practice API contracts proving `p2-high-235`, `p2-high-236`, `p3-high-229`, and the latest explanation-bearing assets resolve through `/api/practice/assets/reading/:assetId` with `questionOrder`, `answerKey`, `interactionModel`, and `reviewExplanations`.
  - Fixed real generated-data blockers exposed by the strict Practice loader: `p3-high-192` exam data was normalized back to JSON register format; `p1-high-194` and `p3-low-151` explanation text no longer contains invalid unescaped JSON quotes.
- Verification:
  - `node --check js/core/dictionaryService.js` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `npm run build:writing` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - `practiceApiFacade.test.js` initially failed on generated reading data 500s. These were real API failures, not test noise; fixing the generated data keeps the VM-free parser strict and preserves the current architecture.

### Slice 29: Reading Entry Parity + Suite Field Contraction
- **Status:** checkpoint complete
- Actions taken:
  - Reused completed subagent audits after the thread hit the current subagent limit.
  - Extended `developer/tests/e2e/practice_reading_vue_flow.py` so the dynamic Vue reading flow now starts from the real overview card actions: category browse, PDF button, suite selector modal, random practice, then the existing browse -> start -> reading page path.
  - Kept the existing submit, canonical history replay, archive roundtrip, automatic AI review retry, manual AI coach, analysis artifact, highlight, and official explanation assertions intact.
  - Contracted Vue suite creation to send only canonical `flowMode` and `frequencyScope` to `/api/practice/reading-suite`. The local `autoAdvanceAfterSubmit` preference remains renderer state and no longer leaks into the Practice API body.
  - Updated `practiceVueShell.test.js` and `practice_reading_suite_vue_flow.py` to lock the canonical suite create payload and prevent the fake field from returning.
- Verification:
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - Remaining priority debt from the audits: PDF-only/无尽模式 filtering, suite history replay preserving `suiteSessionId` from library history records, and deeper OpenSource browse position/custom-suite behavior. These should be handled as separate slices without adding parallel Practice fields.

### Slice 30: PDF-only Random/Endless Guard
- **Status:** checkpoint complete
- Actions taken:
  - Fixed `PracticeLibraryPage.vue` so random reading practice and endless mode build their candidate pools only from reading assets with a real Practice payload.
  - Preserved the user-facing PDF path: manually starting a PDF-only reading asset still opens the PDF via the existing `metadata` PDF fields instead of routing to an empty Vue reading page.
  - Extended `practice_reading_vue_flow.py` with a mocked PDF-only reading asset. The test now proves PDF-only start opens a PDF and does not request `/api/practice/assets/reading/:assetId`, while random and endless both skip the PDF-only asset even when `Math.random()` would otherwise pick index 0.
  - Added Vue shell static guards so future rewrites cannot rebuild random/endless pools from unfiltered `readingAssets`.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
- Notes:
  - Remaining priority debt is now narrower: suite passage records opened from the library history should preserve `suiteSessionId`/return context, and browse position memory/custom-suite selection still need OpenSource parity work.

### Slice 31: Suite History Replay Context
- **Status:** checkpoint complete
- Actions taken:
  - Fixed `PracticeLibraryPage.vue` so `openReadingReview(record)` reads existing `record.metadata.suiteSessionId` / `suite_session_id` and carries it into the `PracticeReadingReview` route query.
  - Fixed `HistoryPage.vue` so normalized reading summaries preserve `metadata`, and mixed history reading-detail navigation carries the same suite context query.
  - Extended `practiceVueShell.test.js` to lock the suite-context helper and route query handoff in both history entry points.
  - Extended `practice_reading_suite_vue_flow.py` so the suite mock history endpoint returns submitted passage summaries, then proves Practice Library history -> single passage review opens with `?suiteSessionId=suite-e2e-1` and shows `返回套题进度`.
  - Left reading AI prompt/RAG services untouched; this slice only repairs the route/context handoff for already persisted submissions.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - A new subagent spawn for AI/RAG audit failed because the thread agent limit was reached; the current fix was completed locally with direct source inspection and regression coverage.
  - The first suite E2E update waited for the `/library` alias URL after `返回练习库`; this was corrected to wait for the actual Practice Library DOM because the route redirects to the root library route.

### Slice 32: Browse Remember-Position Recovery
- **Status:** checkpoint complete
- Actions taken:
  - Reused the existing `browse_view_preferences_v2` renderer preference key instead of adding API fields or backend schema.
  - Added `saveBrowsePosition(asset)` before Vue reading navigation so starting an asset records `lastAssetId`, category, type, frequency filter, keyword, sort mode, and timestamp.
  - Added `restoreBrowsePosition()` and a scheduled restore path after mount, asset load, browse activation, and filtered-list changes.
  - Extended `practiceVueShell.test.js` with static guards for save/restore/scroll behavior.
  - Extended `practice_reading_vue_flow.py` so the dynamic flow asserts browse position persistence after `开始练习` and restoration after returning to the library.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
- Notes:
  - This slice is renderer-only and leaves reading AI prompt/RAG/coach contracts untouched.

### Slice 33: Custom Suite Selection Recovery
- **Status:** checkpoint complete
- Actions taken:
  - Audited OpenSource `suitePracticeMixin.js` custom suite behavior and confirmed it collects explicit P1/P2/P3 choices from browse before launching a normal suite.
  - Extended `ReadingSuiteFrequencyScope` to include `custom` and added optional `sequence` to `ReadingSuiteCreateRequest`.
  - Changed `/api/practice/reading-suite` validation and `createReadingSuiteSession()` so explicit sequence requests validate exactly one practice-ready P1/P2/P3 asset in order and then reuse canonical `ReadingSuiteSession.sequence`.
  - Added Vue custom suite selection state and browse selection UI under the existing suite selector modal.
  - Kept the normal high/high_medium/all suite path unchanged and did not add backend tables or parallel suite fields.
  - Added Practice API contract coverage for custom sequence creation and invalid-order rejection.
  - Added Vue static contracts and extended Vue suite E2E to click custom suite selection before the regular suite progression flow.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `npm run build:server` passed.
  - `npm run build:writing` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_suite_vue_flow.py` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - A subagent spawn for this audit failed because the current thread agent limit is reached; the same audit was completed locally.
  - The first custom-suite E2E update exposed a test-stub-only bug: the synthetic suite object reused custom sequence for the next normal suite create. The stub now resets sequence per create, matching real API behavior.

### Slice 34: Submitted Single Reset Recovery
- **Status:** checkpoint complete
- Actions taken:
  - Audited `origin/opensource` recent reading JS changes and confirmed the submitted-single Reset/retry flow was not fully preserved in Vue: the Reset button existed, but `reviewMode` disabled it after submit.
  - Added a Vue-only recycle gate for normal single-reading submissions. It explicitly excludes suite sessions, endless mode, and replay routes so those business chains keep their existing owners.
  - Implemented `recycleSubmittedAttempt()` in `PracticeReadingPage.vue` to clear current review state, coach response/status, LLM review status, answer/timeline metadata, highlighter DOM, readonly controls, timer state, and the cached `practice_reading_submission_${assetId}` session snapshot.
  - Kept the already persisted Practice history record untouched so records, replay, archive export/import, and AI coach transcript persistence remain valid.
  - Extended `practiceVueShell.test.js` and `practice_reading_vue_flow.py` to lock the submitted reset behavior and prove it does not add backend fields or delete history.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - `practiceApiFacade.test.js` rebuilds `server/dist`; keep it serial with other server-build-mutating tests when possible to avoid race noise.
  - No prompt wording, RAG router, coach service, Practice API schema, or history schema was changed.

### Slice 35: OpenSource Explanation Manifest + RAG Passage Notes
- **Status:** checkpoint complete
- Actions taken:
  - Fetched the latest `origin/opensource` and confirmed the current OpenSource delta is reading explanation coverage.
  - Synced `assets/generated/reading-explanations/manifest.js` plus all 58 newly referenced generated explanation files so the manifest has no missing script targets.
  - Added `buildPassageNoteExplanationChunks()` so passage-note-only official explanations become existing `answer_explanation` RAG chunks with stable `passage_explanation` ids and no fake question numbers.
  - Added review-route deterministic injection for no-question official explanation chunks so whole-set review prompts receive OpenSource passageNotes even when the final context budget is crowded by question/answer chunks.
  - Extended Practice API facade coverage for passage-note-only explanation assets and ReadingCoach/RAG coverage for `p1-low-223`.
  - Added Vue shell static contracts that prevent `passageNotes` from being ignored by the Coach chunk builder.
  - Left `server/src/lib/reading/prompt.ts`, Practice API schema, and history schema untouched.
- Verification:
  - `node developer/tests/js/readingAnalysisService.test.js` passed.
  - `node developer/tests/js/practiceApiFacade.test.js` passed.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
- Notes:
  - The first reading analysis run failed because passage-note chunks existed but were not selected into review prompt context. Review deterministic injection fixed the real RAG omission.
  - The settings UI side-audit found a separate remaining issue: `SettingsPage.vue` still uses a fake theme-switcher action instead of the OpenSource modal. That was not mixed into this AI/RAG data slice.

### Slice 36: Settings Theme Modal OpenSource Parity
- **Status:** checkpoint complete
- Actions taken:
  - Restored `#theme-switcher-modal` in `SettingsPage.vue` with the OpenSource card layout.
  - Replaced the direct index-based theme rotation with an explicit modal-open handler plus per-card `applyBackgroundTheme(themeName)`.
  - Preserved `window.switchBgTheme`, `three_bg_theme`, and `shui-bg-theme-change` so existing background behavior remains compatible.
  - Added close-button, overlay-click, and `Escape` close paths with unmount cleanup.
  - Strengthened `practiceVueShell.test.js` so Settings cannot regress to direct rotation or an empty modal shell.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `npm run build:writing` passed.
  - Browser verification over `http://127.0.0.1:4177/#/settings` passed: clicking the theme button showed `theme-modal show` with 3 cards and action values `misty-mountain`, `teal-ocean`, `floral-bloom`.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - No backend, Practice API, history, AI prompt, or RAG code changed.
  - Remaining subagent-audited OpenSource gaps are deferred to later slices: Settings `library-config-btn`, reading `memorize` mode, ECDICT bundle parity, and learning-goal design.

### Slice 37: Reading Memorize Mode Semantics
- **Status:** checkpoint complete
- Actions taken:
  - Changed the More-page `阅读背题` entry to route with explicit `mode=memorize` and `practiceMode=memorize`.
  - Reused `hasReadingPracticePayload()` so memorize entry skips PDF-only reading assets instead of opening an empty reading page.
  - Split memorize detection away from `review`: Vue now treats only `memorize` / `practiceMode=memorize` as memorize mode.
  - Added legacy query normalization so old `mode=review` memorize links are replaced with `mode=memorize&practiceMode=memorize`, then reloaded through the normal asset path.
  - Strengthened static contracts and the Vue reading E2E so both legacy normalized links and the More-page entry render the memorize panel.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `npm run build:writing` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed with memorize route and entry coverage.
- Notes:
  - No backend, Practice API, history, AI prompt, or RAG code changed.
  - The next OpenSource parity gap remains the offline ECDICT dictionary bundle or learning-goal design; Settings `library-config-btn` needs care because writing settings intentionally must not jump into reading pages.

### Slice 38: OpenSource ECDICT Dictionary + Bubble UI Parity
- **Status:** checkpoint complete
- Actions taken:
  - Restored the OpenSource `assets/wordlists/ecdict_reading.bundle.js` and `ECDICT_LICENSE.txt` assets.
  - Updated Vue reading highlight dictionary loading to load both ECDICT and IELTS core wordlist bundles before `DictionaryService`.
  - Brought the Vue dictionary bubble closer to the OpenSource runtime structure: term metadata, phonetic, part of speech, source/license line, examples, and compound lookup parts.
  - Preserved the existing renderer fallback key for reading-highlight vocabulary and did not add Practice API, history, or backend fields.
  - Added `developer/tests/js/dictionaryService.test.js` and wired it into `run_static_suite.py` so offline ECDICT lookup is covered by the required static gate.
- Verification:
  - `node developer/tests/js/dictionaryService.test.js` passed with 20260 entries and 22945 variants.
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `npm run build:writing` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed and includes `阅读本地词典契约测试`.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
- Notes:
  - No backend, Practice API, history schema, AI prompt, or RAG code changed.
  - User explicitly raised that UI parity must be judged against OpenSource DOM/CSS/interaction and screenshots, not just selector presence. Next slices should use screenshot-level OpenSource-vs-Vue comparison for reading/settings/more surfaces.

### Slice 39: Settings Three-Panel OpenSource Parity
- **Status:** checkpoint complete
- Actions taken:
  - Removed the default `写作配置` header toggle from `SettingsPage.vue`.
  - Removed default `#writing-settings-detail` from the first-screen Settings DOM so `/settings` returns to the OpenSource three-panel structure.
  - Moved advanced writing settings into `.settings-detail-modal` / `.settings-detail-panel`, opened by existing business actions such as `#library-config-btn` and backup-list actions.
  - Restored OpenSource system info classes and metric ids: `.settings-system-info`, `.settings-system-info__status`, `#total-exams`, `#html-exams`, `#pdf-exams`, `#last-update`.
  - Reused existing `topics.getStatistics()` for visible topic stats and changed offline fallback to “未连接/等待本地服务” instead of a hard failure label.
  - Changed theme options to use the OpenSource `theme-options-glass` container without the old `theme-options` class.
  - Strengthened `practiceVueShell.test.js` so the first-screen three-panel DOM, absence of the fake detail toggle, overlay close path, system info ids, and theme-options class cannot silently regress.
- Verification:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `npm run build:writing` passed.
  - `git diff --check` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 8 warnings.
  - Browser DOM check at `http://127.0.0.1:4177/#/settings` passed: three panels, no default detail toggle/panel, system-info metrics present, theme class correct, `#library-config-btn` opens the overlay without route drift.
- Notes:
  - No backend, Practice API, history schema, reading AI prompt, RAG, or coach service code changed.
  - A new attempt to spawn parallel UI/test audit subagents failed because the thread agent limit is reached. Continue the reading page OpenSource parity audit locally.

### Slice 40: Reading Bottom Nav OpenSource Parity
- **Status:** checkpoint complete
- Actions taken:
  - Refreshed `origin/opensource` and confirmed latest OpenSource head is `44a552f Add new reading exam entries to manifest`.
  - Audited `reading-practice-unified.html` and `unifiedReadingPage.js`: the bottom nav contract is `.practice-nav` with `.title`, `#question-nav`, compact `.q-item` buttons, and `.controls`.
  - Changed Vue reading bottom nav title back to `题目导航`.
  - Restored each visible question jump target to a compact `.q-item` button under `#question-nav`.
  - Removed redesigned answered/unanswered text and label-card wrappers from the nav.
  - Kept marked-question behavior as a side affordance and preserved `[data-answer-question-id]` status classes so Submit, replay, analysis, and Coach payloads still receive `markedQuestions`.
  - Strengthened `practiceVueShell.test.js` to forbid the redesigned nav text/wrappers and lock the OpenSource-style `.q-item` contract.
- Verification so far:
  - `node developer/tests/js/practiceVueShell.test.js` passed.
  - `git diff --check` passed.
  - `python3 developer/tests/e2e/practice_reading_vue_flow.py` passed, including Submit, automatic AI review, history/replay, archive import/export, and AI Coach session context.
  - `npm run build:writing` passed.
  - `python3 developer/tests/ci/run_static_suite.py` passed.
  - `python3 developer/tests/e2e/suite_practice_flow.py` passed with 0 errors and 9 warnings.
- Notes:
  - No backend, Practice API, history schema, reading AI prompt, RAG, or coach service code changed.
