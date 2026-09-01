# Findings

## 2026-08-16 功能不可用根因探查

### 根因 1（最大）：AI provider 未配置 → 所有 AI 功能失败
- **现象**：`agent_run`/`coach_run`/`writing_start_evaluation`/`agent_run_attempt_review` 等 AI 依赖命令全部返回 `ai_not_configured` / "provider does not support network AI requests"。
- **根因**：app DB（`C:\Users\25788\AppData\Roaming\IELTS Practice\db\ielts-practice-v2.db`）`settings` 表 `ai.provider = "unconfigured"`；10 个 AI 配置全部 `isDefault=false` 且 `hasSecret=false`。
- **机制**：`load_provider_config` → `reconcile_default_ai_config_with_secret_availability`（`crates/ielts-db/src/settings/mod.rs:212`）需要至少一个 `is_enabled && has_secret` 的配置才设 default；`hasSecret` 由 `vault_has_secret`（`src-tauri/src/ai/config.rs:34`）判定，它调 `SecretVault::get_secret_by_ref`（`crates/ielts-db/src/secrets/mod.rs:78`）→ OS keyring 查 `ai.config.<id>.api_key`。vault.json 有 10 个 entry（ref_id 匹配），但 keyring 查找返回 None → 全部 `hasSecret=false` → reconcile 选 `None` → 写 `provider="unconfigured"`（line 277）→ `load_runtime_from_provider_config` 拒绝（`config.rs:179`）。
- **修复**：环境/配置问题——用户需在 Settings 页重新输入 API key（触发 `set_secret` → keyring 写入 → reconcile 设 default）。**非代码缺陷**。但可考虑：启动时若检测到 vault.json 有 entry 但 keyring 全部缺失，在 Settings 页提示「重新输入 API key」。

### 根因 2（已修复）：EvaluatingPage 空白渲染
- `normalizeTopicId` 未定义（pre-existing，`5c9fd7c6` 引入）→ `hydrateSessionState` 抛 ReferenceError → try/catch 吞错 → 评测页作文正文/主题显示空白。已修复（commit `9a36f464`）。

### 根因 3（已修复）：MemoryCenterPage 语法错误 + 拼写错误
- pre-existing（`1df006d0`）：template literal `/n`（应为 `\n`）+ `obsationIds`（应为 `observationIds`）。已修复（commit `9a36f464`）。页面被 `memoryCenterV1` flag（默认 off）保护，默认不可达。

### 确认非缺陷
- Anthropic 重构（`cb392260`）**未破坏功能**：仅改 CSS + 2 组件 scoped 样式 + ShuiBackground 静态化；所有 87 个前端调用的 Tauri 命令全部在 invoke_handler 注册；CommandResponse wire shape `{ok,data,error}` 与前端 `unwrapCommandResponse` 匹配。
- feature flags 默认 off（`readingAttemptReviewV1`/`learnerModelV1`/`memoryCenterV1`）挡住部分页面——这是「不破坏默认 UX」设计，非 bug。

## 2026-08-16 阅读答题 + agent/memory 探查

### 根因 4：agent 不能启动 — AI provider 未配置（同根因 1）
- `agent_run`（`src-tauri/src/commands/agent.rs:82`）调 `load_runtime(&db, &vault)` → 无 default config → `ai_not_configured`。前端看到 `agent.ai_not_configured`。
- 不是 bug，是环境配置（AI provider 未配）。

### 根因 5：记忆功能失败 — 双重依赖
1. **功能 flag 关闭**：`memory_generate_candidates`（`src-tauri/src/commands/memory.rs:91-108`）检查 `settings.features.memory_auto_candidates_v1`，DB 中 **未设置** → `is_none_or` 返回 false → 返回 `memory.learning_disabled`（"automatic memory learning is disabled"）。
2. **AI provider 未配置**：即使 flag 开，`reserve_generation` → `start`（sidecar spawn，`cognitive_runtime.rs:518`）+ `load_provider_config`（line 119）都需要 AI provider。
- sidecar 二进制存在（`src-tauri/binaries/ielts-agent-runtime-x86_64-pc-windows-msvc.exe` 12MB + sha256），spawn 路径正常，但 memory 命令在 flag + provider 双关之前就拒绝。

### 修复方向
1. 设置 `features.memory_auto_candidates_v1 = "proposal_only"`（DB settings）开启 memory 自动候选。
2. 配置 AI provider（同根因 1）。
3. agent_run 的 error 需清晰传达前端（已由 `73b1e0ee` 错误展示修复覆盖）。
