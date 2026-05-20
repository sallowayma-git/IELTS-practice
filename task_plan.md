# Refactor Task Plan

## Goal
Converge the frontend runtime while preserving existing browser behavior and `file://` compatibility. Prefer fewer source concepts over façade proliferation.

## Guardrails
- Keep IIFE/classic script style; no Vite/Webpack/ESM runtime.
- Rebuild bundles after every source edit.
- Run:
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`
- Do not revert unrelated worktree changes.

## Phases
| Phase | Status | Notes |
| --- | --- | --- |
| Bundle entry chain | complete | Existing work reduced index script chain to bundles. |
| Diagnostics split | complete | `diagnostics.bundle.js` exists and is lazy-loaded. |
| Main runtime façade | partial | `mainRuntime.js` and split façade files exist; `main.js` still carries legacy body. |
| Browse façade | partial | `ExamFilterService` and `ExamListView` exist; some fallback DOM remains in `examActions.js`. |
| Session services | partial | Service files exist; mixins still forward/hold legacy details. |
| Legacy public API | partial | `legacyPublicAPI.js` exists; `main-entry.js` still has duplicate fallback proxies. |
| Index inline cleanup | partial | Inline `<style>` and inline `<script>` removed; inline `onclick` and `style` remain. |
| Settings bundle | pending | Need evaluate safe conservative grouping. |
| Anti-bloat correction | complete | Removed forwarding-only service/runtime façades and kept only real extracted logic. |
| Mixin convergence | complete | App-level mixins and reading launch mixin merged into host files; only high-risk session/suite hosts remain. |
| Final verification | pending | Run build, static suite, E2E after new edits. |

## Current Next Steps
1. Run full static suite and suite practice E2E after anti-bloat deletion.
2. Inspect remaining new feature files only if tests expose regressions.
3. Keep future changes deletion-first: no new façade unless it removes an old responsibility.

## Errors Encountered
| Error | Resolution |
| --- | --- |
| Planning files missing | Created `task_plan.md`, `findings.md`, and `progress.md`. |

## Latest Verified State
- `index.html` has no inline event handlers, inline style blocks, or inline scripts by `rg`.
- `settings-tools` lazy group and `settings.bundle.js` are active.
- Final verification commands passed:
  - `node scripts/build-bundles.mjs`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`

## Post-Confirmation Work
- MainRuntime now installs global entry wrappers while preserving captured `main.js` legacy implementations.
- `index.html` has no inline event attributes, inline style blocks, or inline script blocks under CI guard.
- `settings-tools` split is enforced by CI guard.
- Latest verification passed:
  - `node scripts/build-bundles.mjs`
  - `python3 developer/tests/ci/run_static_suite.py`
  - `python3 developer/tests/e2e/suite_practice_flow.py`

## Anti-Bloat Correction
- User flagged that the refactor added too many scripts/components and increased maintenance cost.
- Removed forwarding-only layers:
  - `js/features/app/app-init.js`
  - `js/features/practice/practice-sync.js`
  - `js/features/overview/overview-runtime.js`
  - `js/features/session/examSessionService.js`
  - `js/features/session/sessionFeature.js`
  - `js/runtime/mainRuntime.js`
  - `js/runtime/legacyPublicAPI.js`
- Kept real convergence modules:
  - `js/core/practiceStore.js`
  - `js/features/browse/ExamFilterService.js`
  - `js/features/browse/ExamListView.js`
  - `js/features/session/customSuiteSelection.js`
  - `js/features/session/readingLaunchService.js`
- `main-entry.js` now owns the startup global fallback directly instead of dynamically loading another API shim.

## Mixin Convergence
- Removed:
  - `js/app/stateMixin.js`
  - `js/app/bootstrapMixin.js`
  - `js/app/lifecycleMixin.js`
  - `js/app/navigationMixin.js`
  - `js/app/fallbackMixin.js`
  - `js/app/readingLaunchMixin.js`
- Merged low-risk app methods into `js/app.js`.
- Merged reading launch URL/PDF/unified-reading helpers into `js/app/examSessionMixin.js`.
- Kept `js/app/examSessionMixin.js` and `js/app/suitePracticeMixin.js` as remaining high-risk business hosts.
- Reduced repeated suite practice storage fallback logic inside `js/app/suitePracticeMixin.js`.
