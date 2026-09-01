# Phase 1 Domain Contracts

> Status: implemented in `crates/ielts-domain`  
> Date: 2026-07-12

## What landed

| Area | Location |
|---|---|
| Domain enums | `crates/ielts-domain/src/domain.rs` |
| Error envelope | `crates/ielts-domain/src/error.rs` |
| Reading asset v2 | `crates/ielts-domain/src/dto/asset.rs` |
| Attempt / answers | `crates/ielts-domain/src/dto/attempt.rs` |
| Writing evaluation v4 | `crates/ielts-domain/src/dto/evaluation.rs` |
| Command DTOs | `crates/ielts-domain/src/dto/commands.rs` |
| View models | `crates/ielts-domain/src/view.rs` |
| Evaluation v3 adapter | `crates/ielts-domain/src/adapters/evaluation_v3.rs` |
| Reading archive adapter | `crates/ielts-domain/src/adapters/reading_archive.rs` |
| TS bindings | `apps/writing-vue/src/types/generated/domain.ts` |
| Golden tests | `crates/ielts-domain/tests/golden_adapters.rs` |
| Property tests | `crates/ielts-domain/tests/property_adapters.rs` |

## Rules for new code

1. **New writes** may only emit v4 evaluation / v2 asset / AttemptRecord shapes.
2. **Legacy aliases** (`scorecard`, `total_score`, `overall_feedback`, nested `analysis.task_analysis`, etc.) are adapter-input only.
3. Frontend must import generated types from `apps/writing-vue/src/types/generated/domain.ts`.
4. `assertNoLegacyEvaluationAliases` / Rust `assert_no_legacy_aliases` guard writes.

## Verify

```bash
cargo test -p ielts-domain
```

## Exit criterion

Same Phase 0 fixtures convert old → v4/AttemptRecord → view model with stable user-visible scores, answers, feedback, and history titles.
