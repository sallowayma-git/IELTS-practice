# Weekly integration plan

Authorized 2026-10-20. Base: 690c87f5; source snapshot: 01157c95; common base: 0156c9e2.
Original workspace and source branch must remain intact. No push. Frozen `.atlas-exam` theme stays unchanged.

## Phases
1. Isolated worktree and baseline: complete.
2. Contract and port inventory: complete.
3. Database, backup and historical weekly compatibility: complete (adversarial verification passed).
4. Port reading tags, independent UI, typed-report cards and dev mock: complete.
5. Data matrix and rebuilt frozen runtime: complete.
6. Static suite then packaged practice flow, exam freeze checks: complete.

## Decisions
- Remote typed blocks/narrative is the only current weekly writer.
- Preserve remote data safety, retry, canonical writing/matching, cleanup and IPC ACL.
- Preserve legacy snapshot data/history without reactivating old Soul/model writer.
- Soul product controls and free-form prose generation are deferred independent features.
- Resolve migrations before porting UI. No legacy prompt-skill code/test resurrection.

## Acceptance
- Fresh DB, common-base v30, local v33 and remote v33 upgrade paths.
- Both legacy backup families and new-format round trips.
- Legacy weekly rows remain accessible; only typed reports are newly generated.
- Sidecar source fingerprint/hash and handshake match final Python code.
- Run in order: `python developer/tests/ci/run_static_suite.py`, then `python developer/tests/e2e/suite_practice_flow.py`.

## Verification
Static 56/56, packaged native 23/23; same-host exam comparison 18/18.
Cross-host tracked exam baseline drift is documented; no baseline or threshold changed.
See progress.md for earlier failed runs, root causes and fixes.
