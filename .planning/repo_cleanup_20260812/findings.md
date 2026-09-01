# 审计发现

## 初始状态

- 分支 `IELTS-WRITING-FEAT` 与 `origin/IELTS-WRITING-FEAT` 当前同步，工作树干净。
- 权威总任务书：`developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md`。
- 根目录存在 `docs/architecture/**`、`docs/evaluations/**`、`docs/rewrite/**`、`developer/docs/**`、`developer/tasks/**`、`.planning/**` 等多个文档群，不能仅按文件名判断过时。
- 根目录 `js/**`、`css/**`、`templates/**`、`index.html`、`developer/tests/**` 包含历史静态产品与测试工具，需先查引用。

## 待核验

- 文档是否仍被 README、CI、脚本或发布流程引用。
- 旧静态入口和旧脚本是否仍是静态回归/资源生成的输入。
- 生成物、报告和临时文件是否被版本控制且是否有保留价值。

## 只读审计结果（2026-08-12）

### 文档

- `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan.md` 是当前唯一权威总任务书，必须保留。
- `docs/architecture/` 的 M0 基线与 5 份 ADR 仍被总任务书和 M1 记录引用，保留。
- `docs/evaluations/agent-m0-baseline-eval.md` 是 M0 验收证据，保留。
- `developer/docs/phase10-release-runbook.md` 与 `.github/workflows/release.yml`、`developer/tests/ci/prepare_tauri_release.py` 对应，保留。
- `docs/rewrite/ux-contract.md`、`docs/rewrite/fixtures-manifest.md` 仍被视觉基线或 Rust 迁移测试引用，保留。
- `docs/rewrite/phase10-cutover.md` 仍被 README 引用，但其中的 Electron/Fastify 回退说明已过时，应修订而不是直接删除。
- `developer/docs/IELTS_Practice_Rust_Tauri_重构任务书.md` 与 `docs/rewrite/phase0`–`phase9` 是完整迁移历史；建议先整体归档或在确认后删除，不零散处理。
- 明确无当前输入且内容已过时的候选：`docs/rewrite/RELEASE_NOTES_tauri_cutover.md`。
- 已完成且无当前引用的旧 `.planning` 记录候选：`tauri_refactor_audit_20260713/`、`repair_data_truth_batch/`、`repair_reading_archive_transaction/`。`agent_evolution_m1_20260812/` 不得删除。

### 旧代码与脚本

- 当前 shipping 入口是 `src-tauri/tauri.conf.json:7-10` 指向 `apps/writing-vue`；静态门禁明确忽略退役 Electron/Fastify/root HTML。
- 根 `scripts/` 8 个文件均属于 Electron/Fastify/资源双包发布链；`npm run check:update-syntax` 已实测因缺少 `electron/appConfig.js` 失败。
- `package.json` 中 `check:update-syntax`、`build:resource-release`、`verify:resource-release`、`verify:resource-release-smoke` 是上述退役脚本入口；删除脚本前必须同步删除这些入口并重新评估根依赖。
- `developer/tests/update/` 5 个脚本都验证旧 `electron/update`、`dist/electron` 或旧资源归档，当前 GitHub workflow 与静态门禁不调用，属于高置信删除候选。
- `developer/tests/backend-test.cjs`、`developer/tests/ci/*` 中若干 writing/provider 合同测试、`developer/tests/e2e/standalone-api-server.cjs`、旧 phase05/旧 index.html/file:// 流程，以及 `developer/tests/js/` 中直接加载 `js/**`/`server/dist`/`electron/**` 的测试，均引用已不存在的旧运行时；应按明确路径清单删除，不批量误删当前 Vue/Tauri 测试。
- `developer/tests/e2e/suite_practice_flow.py`、`packaged_tauri_flow.py`、`run_visual_regressions.py` 及其真实 Vue/Tauri 流程必须保留。

### 生成物与配置

- 可从 Git 删除的无引用输出候选：`.playwright-mcp/`、`logs/app-2026-04-02.log`、`tmp/pdfs/mona.txt`、`developer/tests/reports/phase0/static-ci-report.json`、`developer/tests/reports/listeningpractice-normalize.json`、`developer/tests/verification/browse_a11y.png`；删除前需再次确认没有验收用途。
- `target/`、`node_modules/`、`dist/` 属于可重建且已忽略的本地输出，不纳入 Git 删除；是否清理本机缓存另行处理。
- `README.md`、`AGENTS.md` 含已退役 Electron/file:///根静态入口描述，应做小范围事实修正，不删除。
- `.gitignore` 有旧 Electron/server 条目和重复项，可在确认清理范围后做最小整理。

## 已执行的清理

- 删除根 `scripts/` 的 8 个 Electron/Fastify/旧资源发布脚本、对应 npm 入口和根 Node 依赖；重生成根 `package-lock.json`。
- 删除 `developer/tests/update/`、`developer/tests/baseline/`、旧根静态/index.html 测试、旧 JS integration 测试及明确引用已删除宿主的合同测试；`developer/tasks/ielts-writing-electron/` 作为历史归档候选保留，未纳入本轮删除。
- 删除无引用的 `.planning` 一次性修复记录、Playwright 快照、旧报告、旧日志和临时文本。
- 删除 `docs/rewrite/RELEASE_NOTES_tauri_cutover.md`。
- 重写 `README.md`，修正 `AGENTS.md` 组件图和 `docs/rewrite/phase10-cutover.md` 的当前发布说明。
- `.gitignore` 新增根 `/tmp/` 与 `.playwright-mcp/` 忽略，并移除已删除 ListeningPractice 的旧放行规则。

## 验证结果

- `python developer/tests/ci/run_static_suite.py`：18/18 通过。
- `cargo fmt --all -- --check`、`cargo test --workspace --locked --no-fail-fast`：通过。
- `python developer/tests/e2e/suite_practice_flow.py`：最终重跑通过，页面、路由、Reading IPC、Agent 工作台、备份边界、资源完整性和 SQLite 重启全部通过。此前两次运行在重启后的 WebDriver `wait_for_vue` 收尾条件处出现瞬时超时，最终运行未复现。
