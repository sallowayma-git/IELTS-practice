# Refactor Findings

## Known Verified State
- Static suite and E2E previously passed after bundle generation and diagnostics split.
- `browse.bundle.js` still contains references to diagnostics names from runtime checks in `examActions.js` and `main.js`, but not the class source bodies.
- `index.html` has no inline `<style>` or inline `<script>`, but still has many `onclick=` and `style=` attributes.

## Risk Notes
- `main.js` is closure-heavy; do not move large function bodies blindly.
- `lazyLoader` uses virtual provided scripts; any bundle input changes require `node scripts/build-bundles.mjs`.
- `practiceCore.guard.test.js` scans source text; avoid new direct `storage.set('practice_records')` or `storage.remove('practice_records')`.
- `file://` compatibility means no runtime dependency on module imports or fetch-only HTML partials for critical UI.

## Inline Handler Cleanup
- `index.html` now has no `onclick=`, `onkeyup=`, inline `<style>`, or inline `<script>` hits by `rg`.
- Declarative handlers are centralized in `js/presentation/indexInteractions.js` under `data-index-action`.
- `theme-switcher.js` needed selector cleanup because it referenced the old `onclick="showThemeSwitcherModal()"` shape.

## Settings Tools Split
- `settings.bundle.js` is a conservative bundle for `DataIntegrityManager` and `DataBackupManager` only.
- `LibraryManager` remains in core; moving it would create avoidable risk.
- `boot-fallbacks.js` previously loaded `browse-runtime` to get `DataIntegrityManager`; this was a wrong module dependency and now targets `settings-tools`.

## Anti-Bloat Review
- Forwarding-only files are harmful in this codebase because legacy globals remain the actual behavior owner.
- Deleted façade files should stay deleted unless their replacement removes the old implementation in the same change.
- `PracticeStore`, `ExamFilterService`, `ReadingLaunchService`, and `CustomSuiteSelection` are not equivalent thin wrappers; they carry real data or decision logic and are currently worth keeping.
- `legacyPublicAPI.js` duplicated `main-entry.js` fallback installation. Keeping both creates a two-owner global API problem.

## Mixin Convergence Review
- Low-risk app mixins were artificial load-order fragments. Merging them into `app.js` reduces script count without changing the public `ExamSystemApp` API.
- `readingLaunchMixin.js` was small enough to fold into `examSessionMixin.js`; reading launch is part of session opening, not an independent runtime boundary.
- `examSessionMixin.js` and `suitePracticeMixin.js` remain large, but deleting them outright would be high-risk. Current safe direction is internal duplication removal first.
- `suitePracticeMixin.js` had repeated PracticeRecorder/PracticeCore/PracticeStore/storage fallback chains. Those are now centralized inside the same host file.
