# Phase 2 — Tauri 2 Security Shell

> Status: implemented skeleton  
> Date: 2026-07-12  
> Rollback: Electron release remains the production runtime; no user DB migration in this phase.

## Delivered

| Item | Location |
|---|---|
| Tauri 2 crate | `src-tauri/` |
| Product config | `src-tauri/tauri.conf.json` |
| Capabilities | `src-tauri/capabilities/{main,library,data-transfer,updater,diagnostics}.json` |
| CSP | `app.security.csp` in tauri.conf.json |
| App data / legacy discovery | `src-tauri/src/app/state.rs` |
| Logging bootstrap | `src-tauri/src/app/logging.rs` |
| Route allowlist + legacy redirect | `src-tauri/src/app/routes.rs` |
| Diagnostics commands | `src-tauri/src/commands/diagnostics.rs` |
| No Fastify | `get_app_info().fastify_enabled == false` |

## Commands exposed (main window only)

- `get_app_info`
- `get_startup_diagnostics`
- `get_app_data_paths`
- `discover_legacy_data_dirs`
- `normalize_shell_route`
- `resolve_legacy_route`

## Explicit non-goals (Phase 2)

- Does **not** start localhost Fastify / local-api-server.
- Does **not** migrate SQLite user data.
- Does **not** replace writing evaluation or reading scoring.
- Updater plugin is wired but **inactive** (`plugins.updater.active: false`, empty pubkey/endpoints) until signing keys exist.

## Verify

```bash
cargo test -p ielts-domain
cargo test -p ielts-practice-tauri
cargo check -p ielts-practice-tauri
# optional full shell (requires WebView2 + frontend dist):
npm --prefix apps/writing-vue run build
cargo tauri build --debug
```

## Capability model

- `main`: window + app metadata + logs
- `library`: scoped app-data / resource reads
- `data-transfer`: dialogs + import/export scopes
- `updater`: main-window updater/restart only
- `diagnostics`: log/diagnostic path reads

Remote web origins are not granted command access.
