# Phase 3 — SQLite v2 + Dual-read Shadow Migration

> Status: implemented in `crates/ielts-db`  
> Date: 2026-07-12

## Delivered

| Item | Location |
|---|---|
| Single migration chain | `crates/ielts-db/migrations/0001_v2_core.sql` + `src/migrate` |
| WAL + busy timeout + checkpoint | `src/sqlite/mod.rs` |
| Legacy SQLite scanner | `src/import/sqlite_legacy.rs` |
| Reading archive importer | `src/import/reading_archive.rs` |
| Browser export importer | `src/import/browser_export.rs` |
| Pre-migration file backup | `migrate_legacy_sqlite_to_v2(..., backup_dir)` |
| Shadow read/diff | `src/shadow/mod.rs` |
| Integration tests | `tests/phase3_migration.rs` |

## Tables (v2)

`practice_assets`, `attempts`, `attempt_answers`, `attempt_annotations`, `writing_evaluations`, `reading_suites`, `reading_suite_items`, `coach_threads`, `coach_messages`, `settings`, `schema_migrations`, `migration_meta`

## Safety

- Legacy DB opened **read-only**.
- Migration writes only to the new v2 path.
- Automatic file backup of legacy DB when `backup_dir` provided.
- Shadow diffs are observational; no user-facing branch on mismatch.

## Verify

```bash
cargo test -p ielts-db
```

## Exit

Representative fixtures import cleanly; legacy synthetic DB migrates with matching history view models; re-migrate is idempotent; old DB remains intact.
