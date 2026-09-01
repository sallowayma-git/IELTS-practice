# Phase 5 — Writing Evaluation State Machine

> Status: implemented  
> Date: 2026-07-12

## Delivered

| Item | Location |
|---|---|
| Migration 0002/0003 sessions, checkpoints, events, lineage | `crates/ielts-db/migrations/` |
| Draft repo + idempotent submit | `crates/ielts-db/src/writing/draft.rs` |
| Evaluation FSM + checkpoints + events | `crates/ielts-db/src/writing/evaluation.rs` |
| Deterministic provider + orchestrator hooks | same |
| Cancel keeps inputs; retry lineage | `request_cancel`, `evaluation_lineage` |
| Boot recovery of interrupted sessions | `recover_interrupted_sessions` + Tauri setup |
| Tauri commands | `src-tauri/src/commands/writing.rs` |
| Vue writing repository | `apps/writing-vue/src/api/writing-repository.js` |

## Event contract

Each event has `sequence`, `revision`, `eventType`, optional `stage`, `payload`.  
UI consumes DB-backed events (Channel-shaped); sessionStorage is cache-only.

## Provider note

Phase 5 ships `DeterministicProvider` for offline parity tests. Real provider orchestration uses the same trait and will pull API keys via Phase 4 secret vault.

## Verify

```bash
cargo test -p ielts-db
cargo check -p ielts-practice-tauri
```
