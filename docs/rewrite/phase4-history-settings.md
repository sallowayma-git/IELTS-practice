# Phase 4 — Unified History, Settings, Backup

> Status: implemented  
> Date: 2026-07-12

## Delivered

| Item | Location |
|---|---|
| Unified history query (activity/date/score/search/pagination) | `crates/ielts-db/src/history` |
| History detail + CSV/MD/JSON export | `history/mod.rs` |
| Settings namespaces + localStorage migrate | `crates/ielts-db/src/settings` |
| Secret vault + SQLite refs only | `crates/ielts-db/src/secrets` |
| Backup package + checksum + dry-run import | `crates/ielts-db/src/backup` |
| Tauri commands | `src-tauri/src/commands/{history,settings,backup}.rs` |
| Vue single-source repository | `apps/writing-vue/src/api/history-repository.js` |
| HistoryPage no longer merges two fetches | `HistoryPage.vue` → `historyRepository.listHistory` |

## Security

- Ordinary backups set `includesSecrets=false` and store only secret **refs**.
- `upsert_setting` rejects keys/values that look like API keys.
- Vault file holds secret bytes; SQLite never stores plaintext keys.

## Verify

```bash
cargo test -p ielts-db
cargo check -p ielts-practice-tauri
```

## Exit

History has one repository surface; global pagination is server-side (Tauri) or repository-side (Electron fallback); export/import dry-run works; ordinary backup excludes secrets.
