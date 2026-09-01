# Phase 8 — Annotations, Dictionary, Vocab, Coach

> Status: implemented  
> Date: 2026-07-12

## Delivered

| Item | Location |
|---|---|
| Migration 0005 | `0005_annotations_vocab_coach.sql` |
| Stable text anchors | `annotations/mod.rs` |
| Dictionary index | `dictionary/mod.rs` |
| Vocab + review state | `vocab/mod.rs` |
| Coach threads/messages | `coach/mod.rs` |
| Tauri | `commands/enrichment.rs` |
| Vue | `enrichment-repository.js` |

## Invariants

- Coach failure does not mutate attempt scores.
- Annotation revalidate marks mismatch.

## Verify

```bash
cargo test -p ielts-db --test phase8_annotations_coach
cargo test -p ielts-db
```
