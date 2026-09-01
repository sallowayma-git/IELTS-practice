# Phase 6 — Reading Assets, Scoring, Drafts

> Status: implemented  
> Date: 2026-07-12

## Delivered

| Item | Location |
|---|---|
| Answer normalize / single / alternatives / set + weights | `crates/ielts-db/src/reading/scoring.rs` |
| Asset index + fingerprint | `reading/assets.rs` |
| Draft + incremental answer patch | `reading/attempt.rs` |
| Idempotent submit in DB transaction | `submit_reading_attempt` |
| Tauri commands | `src-tauri/src/commands/reading.rs` |
| Vue repository | `apps/writing-vue/src/api/reading-repository.js` |
| Vue attempt VM | `useReadingAttempt.ts` + `PracticeReadingPage` Tauri path |

## Parity notes

Matching rules ported from `server/src/lib/practice/reading-sessions.ts`:
token normalize, TRUE/FALSE/NG aliases, letter options, alternatives, checkbox sets, weights.

Legacy HTML renderer remains for Vue pages; data path no longer requires sessionStorage as sole draft store under Tauri.

## Verify

```bash
cargo test -p ielts-db --test phase6_reading
cargo test -p ielts-db
```
