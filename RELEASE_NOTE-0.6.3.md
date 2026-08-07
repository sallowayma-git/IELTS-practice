# IELTS Practice v0.6.3 Release Notes

## 🏷️ 版本概览

本版本（v0.6.3）是 `release` 预发布线在 v0.6.2-fix 之后的又一次集中收敛。本次更新的核心是一条**全新的数据持久层（AppData v2）**，它替代了此前散落、相互竞争的多套存储实现，并在此之上统一了备份/恢复、练习记录、套卷状态与设置模型；同时补全了**本地磁盘备份（File System Access API）**、**词汇表表格视图**，并把全站 UI 收敛到统一的「液态玻璃（Liquid Glass）」设计系统。题库内容也随八月高频表刷新并修正了若干答案解析。

### 相对 v0.6.2-fix 的主要变化
* **数据层彻底重构**：以 `js/data/v2/`（`appData.js` / `dataCatalog.js` / `dataKernel.js`）为单一可信源，删除了旧的 `DataIntegrityManager`、`dataManagementPanel`、`goalSettingsPanel`、`practiceRecordAPI`、`scoreStorage` 及 `repositories/*` 等多套并存实现。
* **练习记录与恢复标准化**：做题记录、套卷状态、计时、草稿与恢复流程统一到新的记录契约，修复了历史记录重复与丢失问题。
* **本地磁盘备份**：新增基于 File System Access API 的本地文件夹快照备份，浏览器缓存清理后数据仍可恢复。
* **UI 设计系统统一**：移除旧的 hero-btn 体系，所有次级弹窗、设置面板、按钮统一到液态玻璃外壳与胶囊按钮。
* **新功能**：词汇表表格视图、增强的听力练习页与控制、八月阅读高频标签刷新。
* **质量门控增强**：新增 `.github/workflows/ci.yml`（bundle 漂移检查 + JS/Python 测试），并清理了历史遗留测试套件。

---

## 🛠️ 重大架构演进 (Architectural Evolution)

### 1. AppData v2 — 单一数据持久层 (Single Source of Truth)
此前用户数据分散在 `practiceRecordAPI`、`scoreStorage`、`DataIntegrityManager`、`dataManagementPanel` 等多套互不兼容的实现里，存在写入竞争与schema漂移。本次引入统一的 `js/data/v2/` 内核：
* **内核三件套**：
  * `appData.js`：统一的应用数据根对象、变更（mutation）追踪、快照与校验（checksum）能力。
  * `dataCatalog.js`：标准化的数据目录/索引起点。
  * `dataKernel.js`：数据读写内核，承载仓库注册与一致性保障。
* **删除的旧实现**：`DataIntegrityManager`、`dataManagementPanel`、`goalSettingsPanel`、旧 `backupAPI`、`practiceRecordAPI`、`scoreStorage`、`storageProviderRegistry`、`vocabStore`(旧)、以及 `data/repositories/*` 全部子仓库与 `data/index.js` / `practiceRecordSource` 旧路径。
* **收益**：跨模块读写不再 race，`manual_backups` 等字段具备稳定 schema，迁移与重置（reset）流程被大幅简化（`refactor: simplify v2 migration and reset flows`）。

### 2. 备份 I/O 统一与本地磁盘备份 (Unified Backup & Disk Snapshots)
* **BackupAPI 单一写入路径**（`feat(data): unify backup I/O through BackupAPI`）：`DataBackupManager`、`ScoreStorage`、`DataIntegrityManager` 不再各自直写 `manual_backups`；恢复 dual-key payloads、`exam_index` 与导入前清理（pre_import pruning），并修复导入流程与 `includeBackups` 行为。
* **本地磁盘备份（File System Access API）**（`feat(data): add local disk backup via File System Access API`）：
  * 用户在本地选定一个文件夹，应用定期写入 JSON 快照，浏览器缓存清理后数据仍可找回。
  * 应用内备份保留为「仅回滚」用途；磁盘备份在次级玻璃弹窗中呈现，带每日权限/过期提醒，且不自动下载。
  * 配套新增 `js/core/externalBackupService.js`（约 1400 行）与 `css/heroui-bridge.css` 相关样式。

---

## 📊 数据结构与模型重构 (Data Schema Refactoring)

### 1. 练习记录与套卷状态规范化 (Canonical Records & Suite State)
`feat(practice): canonicalize records, recovery, and suite state` 重写了做题链路：
* `examSessionMixin.js`、`suitePracticeMixin.js`、`practiceCore.js`、`practiceRecorder.js`、`practiceHistoryEnhancer.js`、`practiceRecordModal.js` 全部对齐到新的记录契约。
* 修复**重复记录与历史丢失**（`Prevent duplicate records and history loss`）：在 `dataBackupManager`、`browse.bundle`、`settings.bundle`、`main.js` 中补齐去重与持久化逻辑。
* `feat(runtime): secure reading and listening practice flows` / `feat(app): align backup, library, browse, and settings flows`：把备份、题库库、浏览与设置各入口对齐到新数据层与统一弹窗外壳。

### 2. 新手引导对齐数据层
`onboardingTour.js` 的引导流程重写为适配 v2 记录契约（`refactor(onboarding): align tour with post-data-layer record contract`），避免旧引导在迁移后写入不兼容数据。

---

## 🚀 新功能集 (New Features)

### 1. 词汇表表格视图 (Vocabulary List Table View)
`feat: add vocabulary list table view (#99)` 新增词汇表表格视图：
* `js/components/vocabSessionView.js` 重写为表格化呈现，配合 `vocabDataIO.js`、`vocabStore.js` 适配 v2 数据层与遗留进度信封（legacy progress envelope）处理。
* 提供针对 v2 的回归测试覆盖（`vocabSessionView.test.js` / `vocabDataIO.test.js` / `vocabStore.test.js`）。

### 2. 增强的听力练习页与控制 (Listening Page & Controls)
`feat(ui): enhance listening page and practice controls` 大幅增强听力练习体验：
* 新增 `js/listeningUnifiedWrapper.js`（约 945 行）与 `listening-wrapper.bundle`，统一听力运行时外壳。
* `js/app/main-entry.js` 与 `practiceTimerPreferences.js` 增强练习计时与偏好控制；`index.html` 听力入口扩展。
* `fix(listening): address review findings B/C/D`：
  * 拆分 `ensurePartNavigation` 为「一次性结构构建」与「每帧轻量状态刷新」，消除每帧 DOM 创建/移动开销。
  * `has_question_content` 改为多级启发式，闭合实体/&nbsp;/标签/有序列表/图片题导致的误判，新增 4 个回归测试（共 9 个通过）。
  * 新增 `.github/workflows/ci.yml`（bundle 漂移检查 + JS/Python 测试），修正 `.gitignore` 使生成的 `listening-practice-unified.html` 被纳入跟踪，并重建 bundle 以修正此前 `1.0.0` 与 `0.6.2-fix` 的版本漂移。

### 3. 阅读题库内容更新
* `chore(reading): 更新阅读题库 frequency 标签为八月高频表`：按八月高频表刷新 `assets/generated/reading-exams/manifest.js` 与各单篇数据。
* `Add Chinese translations and PDF paths to exams` / `Add three generated reading exams`：补充中文翻译、PDF 路径与三套新生成阅读题。
* `fix(reading): normalize pdf refs and matching questions`：规范化 PDF 引用与匹配题数据，影响大量 P1/P2/P3 单篇文件。

---

## 🔧 缺陷修复与体验优化 (Bug Fixes & UX Polish)

### 内容层答案解析修正
* 修复「羊毛产业」的历史解析（`修复羊毛产业的历史解析`）。
* 修复「Katherine Mansfield」第 6 题答案。
* 修复「交易的本能」第 25 题答案。
* 修复「语言的起源」与「伦敦鞋子」相关解析。
* 补全「时尚产业」阅读段落。

### 运行与兼容修复
* `fix: accept Linux file origins in suite child`：套卷子进程接受 Linux 文件源。
* `ci: align Playwright browser version`：对齐 Playwright 浏览器版本，稳定 e2e。
* `fix: include fallback placeholder in release package`（随后 `Revert` 回退）：发布包占位资源的最终取舍。

### 视觉与体验优化 (Aesthetics)
* **液态玻璃设计系统统一**：
  * `style(ui): make liquid glass the sole theme-modal design system`：主题弹窗统一为液态玻璃。
  * `style(ui): unify secondary modals under shared liquid glass shell`：所有次级弹窗统一外壳。
  * `style(ui): remove hero-btn system and unify glass capsule buttons`：移除 hero-btn 体系，统一玻璃胶囊按钮。
  * `feat(ui): unify settings buttons to light capsule style + refactor practice settings into modal`：设置按钮与练习设置重构为弹窗与浅色胶囊风格。
  * `style(ui): stack practice settings cards and fold loader/backup into theme-modal`：练习设置卡片堆叠，加载器/备份折叠进主题弹窗。
  * `fix(ui): raise library loader overlay above theme modals`：修复题库加载遮罩层级低于主题弹窗的问题。
  * `style: normalize css/main.css to LF and refine theme scroll buttons`：规范化 CSS 换行并优化主题滚动按钮。
* `chore(cleanup): Sprint A subtractive dead code and doc alignment`：裁减遗留死代码并对齐文档。

---

## ⚖️ 许可、合规与启动拦截 (Compliance & Security)

* 继承并保留 v0.6.2-fix 的 **GPL 许可确认机制**与启动门控；本次未改动合规拦截逻辑，但 AppData v2 重写后所有用户数据写入均经过统一内核，数据完整性（checksum）与迁移审计更可追溯（`docs: record the AppData v2 migration audit`）。
* 听力资源仍为**可选本地扩展**，公开仓库不随包提供音频/题源/PDF；相关路径仅作为本地生成资产约定入口。

---

## 🧪 验证与 CI 测试工作流 (Verification & Quality Assurance)

为保障 userspace（用户体验）零破坏，合并发布前**必须严格按顺序运行以下验证脚本**：

1. **执行静态分析与校验套件**（生成 CI 报告）：
   ```powershell
   python developer/tests/ci/run_static_suite.py
   ```
   *验证内容：核心编译状态、GPL 门控状态、包体积完整性门控、bundle 漂移。*

2. **运行 Playwright 自动化流**（回归 UI 截图及用户旅程验证）：
   ```powershell
   python developer/tests/e2e/suite_practice_flow.py
   ```
   *验证内容：从首页 Dashboard -> 选择套卷 -> 做题 -> 提交 -> 查看高亮复习的完整链路。*

3. **（新增）GitHub Actions CI**：`.github/workflows/ci.yml` 在推送时自动执行 bundle 漂移检查与 JS/Python 测试，作为发布前的第二道门控。

---

## ✅ 发布前检查清单 (Release Checklist)

- [ ] 将代码内版本字符串由 `0.6.2-fix` 提升为 `0.6.3`，涉及：
  - `js/components/onboardingTour.js`（`version: '0.6.2-fix'`）
  - `js/core/practiceCore.js`（两处）
  - `js/core/practiceRecorder.js`
  - `js/core/resourceCore.js`
  - `js/utils/vocabDataIO.js`（`DEFAULT_EXPORT_VERSION`，注意导入兼容性）
  - `developer/package.json`（`version` 字段）
- [ ] 重建运行期 bundle（`node scripts/build-bundles.mjs --check` 应通过），确认无 bundle 漂移。
- [ ] 运行静态校验套件与 Playwright 回归，均通过。
- [ ] 更新 `README.md` 中如提及的版本号（若有）。
- [ ] 打 `v0.6.3` 标签并推送。
