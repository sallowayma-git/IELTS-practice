# OneDrive sync verification: deployment branch

Date: 2026-11-08 (Asia/Shanghai).

Base: `feature/multi-device-easy-deploy`, commit `3099bfce5d13a331b84c86e1de5543381ad265ab`.

This is a focused port of the earlier static-edition prototype. It does not merge the newer static branch's history, question assets, diagnostics framework or vocabulary / practice-review modules into this branch.

## Executed checks

Windows; Node.js v24.16.0; npm 11.13.0. Dependencies were installed locally with each existing lockfile: developer Playwright 1.56.1 and the existing backend dependencies. The sync browser tests prefer installed Chrome / Edge, falling back to Playwright Chromium.

| Check | Result |
|---|---|
| `npm --prefix developer test` | 121 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm --prefix developer run test:sync` | 21 sync tests are included in the full suite; also runnable separately |
| `npm --prefix backend test` | 5 passed, 0 failed, 0 skipped |
| `npm --prefix developer run test:sync:backend` | 1 passed; production backend HTTP entry, panel, CSS and automatic publication |
| `node scripts/build-bundles.mjs --check` | Passed: 14 outputs current |
| `git diff --check` | Passed |

The build reports the branch's existing eight duplicate-symbol warnings. No dependency lockfile, backend route, SQL migration, deployment configuration or question asset was changed.

## Scope demonstrated

- Canonical JSON SHA-256, independent offline attempts, duplicate / reordered operations, concurrent annotations, tombstones and bulk-delete confirmation.
- Atomic outbox rollback and durability across reloads using real IndexedDB; receiving operations does not generate a local echo.
- Real origin-private FileSystemDirectoryHandle read/write, persistent binding, queued delivery after reload, permission loss, truncated local files and malformed remote files.
- Vocabulary word union, causal removal and complete alternatives for concurrent word review-state edits on this branch's existing vocabulary schema.
- Built pages over file:// and HTTP, including the production backend entry. Tests accept the first-run notice through the UI and observe automatic publication after completing a synthetic attempt.
- Rejection of the newer static prototype's protocol format, so incompatible schemas cannot silently share one workspace.

Tests use isolated browser contexts and synthetic data. Directory selection is substituted with a real origin-private directory; log copying simulates OneDrive transport. The backend integration uses in-memory auth, session and record stores.

## PR #282 review regressions

The unified **启用 OneDrive 同步** entry detects a project root or the legacy user-data directory. Creation requires complete project-root entries, no existing sync directory and explicit confirmation. Missing/truncated/incompatible markers stop safely. Confirmation-time folder arrival is rechecked, known local space identities prevent replacement initialization, and existing marker bytes / space IDs are preserved. The browser cannot establish OneDrive cloud download completeness when no local sync directory is visible; the confirmation explicitly requires first-ever use and a completed download.

The five added browser regression tests cover:

- An old-client empty vocabulary seed followed by a word edit; an empty joining client emits no default operation and receives the word without conflict. A joining client with pre-existing words and a practice attempt preserves and merges both.
- Existing root and direct user-data connection, declined initialization, partial / empty / malformed / incompatible markers, and directory arrival during confirmation.
- A real second tab attempting a learning commit while reset is paused in external-backup preparation. The system-store barrier aborts that transaction; previously accepted records have already been published before database deletion.
- Refused reset with an unpublished outbox and failed reset preparation; data survives and writes resume after barrier release.
- A rejected AppData readiness promise with no folder binding versus an existing binding: unbound site reset succeeds; bound reset stops without deleting the binding.

Permission restoration is exercised through reauthorize with an origin-private handle. Real permission prompts and OneDrive transfer remain manual cases. The panel screenshot was regenerated from the production backend-served page. Evidence is saved locally in ignored developer/doc/onedrive-sync-review-{all,focused,backend,http,build,bundle-check}.log files.

## Permission recovery interaction update

The panel now shows only **启用 OneDrive 同步** before setup. Connected, authorized browsers see **自动同步已开启** with sync/disconnect/preferences controls and no setup/recovery button. When permission expires, **同步已暂停** and **恢复同步** appear; immediate sync is disabled until access is restored. Disconnect returns to setup. Conflict and bulk-deletion controls remain available.

The production backend browser test now verifies these real rendered states, denies one simulated browser permission request (queue retained), grants the next request (queue drains automatically), verifies that recovery does not reopen the directory picker or change the space ID, and disconnects/reconnects without losing the practice record. Only the browser permission results and directory chooser are substituted; production service, IndexedDB and file writing code execute unchanged. The initial panel screenshot was regenerated and visually inspected.

Rerun commands use the existing dependency lockfiles: frontend suite (121 tests including 21 sync tests), focused sync, backend (5 tests), production HTTP browser integration (1 extended test), bundle build/check and git diff check. Local evidence is saved in ignored developer/doc/onedrive-sync-ui-*.log files. No dependency, storage protocol, data-write barrier or backend API changes are included in this UI update.

## Pending external validation

Real OneDrive upload/download, two physical computers, Files On-Demand and actual directory reauthorization still require [manual acceptance](OneDrive-Sync-Manual-Test.md). No personal browser database or OneDrive account was used.

Python tests, the complete Python browser suite, Node.js 22/Linux coverage, Docker/PostgreSQL persistence and deployment smoke were not executed locally in this run. The existing Multi-device CI must be read separately; local checks do not establish its result.

The earlier static-branch results (853 tests / Playwright 1.62.1 / 18 build outputs) do not describe this port.

## Reproduce

Follow the lockfile installation and browser setup in [ONEDRIVE_SYNC.md](../../ONEDRIVE_SYNC.md). Run the commands above from the repository root. Raw logs are local evidence and are not committed; reviewers should save their own results.

![Deployment-branch sync panel](onedrive-sync-panel.png)
