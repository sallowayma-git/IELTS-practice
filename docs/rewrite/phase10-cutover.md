# Phase 10 cutover — migration, backup, known limits

> Date: 2026-07-12  
> Runtime: **Tauri 2 + Rust only**. Electron + Fastify removed from the product tree.

## What changed

| Removed from product surface | Kept |
|---|---|
| `electron/` main/preload/local-api-server | `crates/ielts-db` legacy importers |
| `server/` Fastify/SSE/business HTTP | SQLite v2 migrations + domain crates |
| `package.json` electron-builder main path | `src-tauri` bundle + Vue `apps/writing-vue` |
| Shadow-read dual-write production path | One-shot legacy import tools in DB crate |

## Data migration

1. **Backup first** (Tauri settings → backup, or copy app data dir).
2. On first Tauri launch, SQLite v2 is created/migrated under the app data path.
3. Legacy Electron SQLite / browser export JSON can be imported via Phase 3/4 importers:
   - `migrate_legacy_sqlite_to_v2`
   - reading archive import
   - backup package import (`create_backup` / `import_backup_path`)
4. Secrets never travel in ordinary backups; vault refs only.

## Current release notes

- The release workflow supplies updater endpoint and pubkey overlays; the local base config intentionally remains unconfigured.
- AI provider calls, reading resources and the Agent runtime are implemented in Rust and exercised through the Tauri host.
- The static suite and packaged Windows Tauri WebView flow are the first shipping gates. Retain reports from passing runs.
- Release builds generate a SHA-256 bundle manifest and fail when the bundle is empty.
- Windows/macOS signing, updater installation and rollback drills still require external secrets and real devices.

## Developer commands

```bash
npm run prepare:writing
npm run build:writing
cargo test -p ielts-db
cargo tauri dev
cargo tauri build
```

## Rollback

Use the release artifact rollback procedure and restore user data from a backup when required. Do not reintroduce the removed Electron/Fastify runtime or a dual-write path.

## Required release evidence

- `static-ci-report.json` with status `pass`.
- `suite-practice-flow-report.json` with target `packaged-tauri-2` and status `passed`.
- One non-empty `tauri-bundle-<platform>.json` manifest per release platform.
- Platform signing/notarization logs and an updater install/rollback record. These cannot be produced without release secrets and devices.
