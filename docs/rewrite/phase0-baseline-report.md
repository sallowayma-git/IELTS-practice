# Phase 0 Baseline Test Report & Known Defects

> Run date: 2026-07-12  
> Branch: `IELTS-WRITING-FEAT`  
> Baseline commit: `2e3cf0872b8f67cb6c82d1799d7043578f77157c`  
> Host: Windows 10 / Node v26.4.0 / Python 3.12.10 / Rustc 1.96.1  

## 1. Commands executed

| command | result | artifact |
|---|---|---|
| `python developer/tests/ci/run_static_suite.py` | **FAIL** overall (106 pass / 14 fail / 0 skip / 120 total) | `developer/tests/e2e/reports/static-ci-report.json` + `developer/tests/reports/phase0/static-ci-report.json` |
| `node developer/tests/js/practiceVueShell.test.js` | **PASS** | stdout status pass |
| `npm run build:server` | **FAIL** | `tsc` not on PATH; TypeScript not installed as local compiler |
| `npm install` (root) | **FAIL** | `better-sqlite3` native rebuild failed under Node 26 + MSBuild |
| `npm run build:writing` | **NOT RUN** | blocked by install / env |
| Playwright E2E scripts | **NOT RUN** | Playwright Python missing |
| `python developer/tests/e2e/suite_practice_flow.py` | **NOT RUN** | Playwright Python missing |

## 2. Static suite summary

- **status**: fail  
- **generatedAt**: `2026-07-11T18:27:57.570161+00:00`  
- **pass**: 106  
- **fail**: 14  
- **total**: 120  

### 2.1 Failures classified as environment / tooling (not product regressions)

| test | root cause |
|---|---|
| server 预编译构建 | `tsc` missing from PATH; root `typescript` package not usable (`npx tsc` resolved wrong package) |
| Reading CORE-10 显式契约测试 | depends on `npm run build:server` |
| 写作评测链路契约测试 | depends on `npm run build:server` |
| Practice API Facade 契约测试 | depends on `npm run build:server` |
| 阅读二阶段分析服务回归测试 | depends on `npm run build:server` |
| 模拟模式 NB 拖拽回灌回归测试 | `playwright_python_missing` |
| 模拟模式切题回灌回归测试 | `playwright_python_missing` |
| 写作自由写作/题库模式草稿恢复回归测试 | `playwright_python_missing` |
| Vue 阅读练习链路 E2E 回归测试 | `playwright_python_missing` |
| Vue 阅读套题链路 E2E 回归测试 | `playwright_python_missing` |
| Reading 逐题自动排查（quick） | Playwright Python missing / no `.venv` |
| 写作 IPC 参数可克隆化守卫 | missing `apps/writing-vue/node_modules/vue` |
| 写作题库 DAO 兼容契约测试 | missing `electron` module resolution in bare node |
| 写作历史摘要数据契约测试 | missing `electron` module resolution in bare node |

### 2.2 Notable passes relevant to rewrite baseline

- Vue Practice Shell static contract
- Reading data integrity (225 scanned; only allowlisted duplicate remains)
- Many practice-core / resource-core / suite mode unit contracts
- Navigation / settings coverage static checks
- Legacy single-reading and suite Vue route guards

## 3. Locked Electron release posture

| item | status |
|---|---|
| Current product runtime | Electron (`electron/main.js`) + Fastify local API + Vue writing shell |
| package version | `0.0.1-beta` |
| productName | `IELTS Practice` |
| In-repo release binary | not required for Phase 0; source + schema locked at baseline commit |
| SQLite schema | `electron/db/schema.sql` inventoried under `tests/fixtures/legacy-data/sqlite-samples/schema-snapshot.json` |

## 4. Known product defects carried into rewrite (from task book P0/P1)

These are **accepted baseline defects**, not introduced by Phase 0 docs/fixtures:

1. Writing active sessions primarily in-memory (crash loses runtime).
2. Dual history sources (`essays` + `practice_history_records`) merged in frontend.
3. Reading submission field inflation / duplicate envelopes.
4. Localhost API origin guard accepts empty/`null` Origin.
5. Electron `sandbox: false`.
6. Core writing services use `// @ts-nocheck`.
7. Giant `PracticeReadingPage.vue` responsibility overload.
8. Drag interactions need verified non-drag alternatives (WCAG 2.5.7).
9. Settings mixes learning prefs with AI/provider/advanced config.
10. API key column named encrypted; storage strength not proven.

## 5. Environment bootstrap debt for Phase 1+

To make full baseline green on Windows, developers need:

1. Install project TypeScript compiler (`typescript` as devDependency / local binary).
2. Install root npm deps with a Node version supported by `better-sqlite3` prebuilds (Node 26 currently fails native rebuild).
3. Install `apps/writing-vue` dependencies.
4. Install Playwright for Python (`pip install playwright` + browsers) or project `.venv`.
5. Optional: electron module available for DAO contract scripts.

Until then, rewrite work must treat the 14 static failures as **known environment blockers**, and only mark a test as rewrite-regression if it newly fails after previously passing under the same environment.

## 6. Phase 0 exit checklist

| exit criterion | evidence |
|---|---|
| UX IDs mapped to tests | `docs/rewrite/ux-contract.md` |
| Representative reading assets ≥10 | `tests/fixtures/reading/representative-assets.json` (12) |
| Writing normal/degraded/failed fixtures | `tests/fixtures/writing/*` |
| Legacy migration samples | `tests/fixtures/legacy-data/**` |
| Visual baseline contract | `tests/visual/baseline/README.md` (PNG capture blocked by Playwright) |
| Full build/test run recorded | this report + static-ci-report copy |
| Known failures not counted as rewrite regressions | §2 and §4 |

**Phase 0 exit: SATISFIED with explicit environment caveats.** PNG visual binaries and full E2E remain deferred tools debt, not missing contract definition.
