# Agent M0 Baseline Eval Report

日期：2026-08-11
目标：证明当前 bounded Agent loop 可重放、可测量、可安全回滚。所有模型行为均使用 fake/replay，不访问外部 provider。

## Replay matrix

| 场景 | 证据 | 状态 |
|---|---|---|
| model returns content | `ielts-application::agent::tests::completes_without_calling_tools` | pass |
| read_file then content | `replays_read_file_then_content` | pass |
| multiple tools | `replays_multiple_tools_in_sequence` | pass |
| unknown tool | `replays_unknown_tool_as_rejected_result` | pass |
| invalid arguments | `rejects_malformed_tool_arguments_without_losing_audit` | pass |
| duplicate call ID | `rejects_duplicate_tool_call_ids` | pass |
| max rounds | `enforces_round_limit_and_rejects_empty_final_response` | pass |
| max tools | `enforces_tool_call_limit` | pass |
| provider failure | `persists_provider_failure` | pass |
| store failure | `tool_audit_finish_failure_stops_before_next_model_round`, `successful_run_audit_finish_failure_is_returned` | pass |
| interrupted run | `ielts-db/tests/agent_runs.rs::recovers_running_calls_and_runs_as_interrupted` | pass |
| hash conflict | `src-tauri/src/agent/file_tools.rs::existing_write_requires_current_hash` | pass |
| path escape | `rejects_escape_absolute_sensitive_and_non_utf8_paths` and symlink test | pass |

## Security matrix

| 合同 | 证据 |
|---|---|
| expired/process-local workspace grant | `workspace_grants_are_short_lived_and_process_local` |
| symlink containment | `rejects_symlink_escape`；Windows 无 symlink 权限时使用 junction，创建失败会 fail 而不是静默 return |
| `.git` 与 secret 策略 | `rejects_every_sensitive_path_before_filesystem_access` 精确覆盖所有 blocked components/files 与大小写 |
| absolute、parent path 与 UTF-8 | `rejects_escape_absolute_sensitive_and_non_utf8_paths` 精确断言错误码 |
| existing write requires current SHA-256 | `existing_write_requires_current_hash` |
| atomic replacement and temp cleanup | `existing_write_requires_current_hash` asserts final content and no `.ielts-agent-*` artifact |
| maximum file size and UTF-8 | `enforces_size_limit_and_keeps_content_out_of_audit` and `rejects_escape_absolute_sensitive_and_non_utf8_paths` |
| audit excludes body | `audit_payloads_exclude_file_bodies_for_every_file_tool` 覆盖 read/write/replace arguments 与 results；application successful-audit assertion 覆盖持久化边界 |

## Trace acceptance

`aggregates_trace_metadata_across_model_rounds` proves `latencyMs=18`, `retryCount=3`, terminal model/request ID, and summed usage. `persists_provider_failure` and `persists_aggregated_trace_when_a_later_model_round_fails` prove provider failures write the same six-field trace with `hasContent=false`, including a failure after an earlier successful tool round; pre-envelope failures now persist `actualModel: null`. Runtime tests prove a provider request header wins over a body completion ID and that parsed-envelope failures retain model/request ID/latency/retry telemetry. The completion characterization proves the exact SHA-256 of `Use tools when needed.` and asserts `result_json` contains metadata but no response `content` field.

The browser Agent visual check now replays a provider failure before a successful run. It verifies the run mutex disables workspace controls during the pending promise, the error context's `runId` hydrates the failed SQLite record, the requested model is not shown as actual, and the original provider message remains visible before the success replay restores the final screenshot state.

## Rollback acceptance

- `featureFlags.agentWorkspaceV1` is the single source used by both router and navigation.
- Default production build keeps the Agent route enabled.
- A production build with `VITE_FEATURE_AGENT_WORKSPACE_V1=false` was served locally and verified with Chromium: Agent navigation hidden, `#/agent` redirected to `#/`, Reading/Writing/History still reachable.
- No migration was added; schema remains at `0011_agent_runs_tool_calls.sql`.

## Commands run

```text
cargo test -p ielts-application --no-fail-fast
cargo test -p ielts-practice-tauri ai::runtime::tests --no-fail-fast
cargo test -p ielts-practice-tauri agent::file_tools::tests --no-fail-fast
cargo fmt --all -- --check
cargo test --workspace --locked --no-fail-fast
npm.cmd --prefix apps/writing-vue run typecheck
npm.cmd --prefix apps/writing-vue run build
python developer/tests/e2e/agent_workspace_visual_check.py
python developer/tests/e2e/packaged_tauri_flow.py
python developer/tests/e2e/run_visual_regressions.py
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

The visual check injects a deterministic Tauri mock and asserts the exact command order `agent_pick_workspace -> agent_run -> agent_get_run`, hydrated `read_file`, final output, and all trace metadata at mobile width; all four viewport geometry checks have zero horizontal overflow.

The packaged Tauri gate passes against release binary SHA-256 `e3fb4722b6640e183a9156452f9329c288f0f7d0c3891a2d68539fa921ad9d95`. It isolates `APPDATA`, selects a real temporary workspace through the native Windows folder dialog, configures a localhost OpenAI-compatible fake provider through the existing AI commands, performs two real model rounds and one `read_file`, then reloads run `9eb1c4da-a59b-4391-820b-74bc742ae99a` from SQLite. The hydrated tool call is `succeeded`, its result path is `note.txt`, its SHA-256 is `3a96791a505e07c9516ea17a72b2da23ef1e50311bd4632018554bdca7f8c315`, and the trace stores header request ID `packaged-request-final` rather than body completion ID `chatcmpl-packaged-final`. The hydrated result contains all six trace fields and no response content. All 16 packaged checks, 18 static checks, and 17 visual-regression scripts pass. The gates remain in `release.yml` / `tauri-ci.yml`.

The packaged report records `gitDirty=true` because it was generated immediately before the M0 checkpoint while unrelated, user-owned `ListeningPractice/**` and `.Jules/palette.md` deletions remained in the worktree. Those paths are outside the shipping Tauri/Vue/Rust tree and are excluded from the scoped M0 commit; the tested M0 source content is identical to the checkpoint.

## Limitations intentionally deferred

- Full `llm_invocations` table and invocation-level rows belong to M2/M3.
- Memory, Dream, journal, context compiler, threads, approvals, and tool expansion are out of M0.
- The native folder-picker automation is Windows-specific because the packaged WebView gate itself currently targets the Windows release job. Cross-platform packaging remains covered by the existing release matrix, but cross-platform Agent picker automation is not claimed in M0.
