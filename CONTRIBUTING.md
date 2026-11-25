# 贡献指南（多设备产品分支）

本文档适用于 `product/multi-device` 分支，说明个人多设备同步与轻量部署相关贡献的范围、工作基线、PR 目标和验证方式。开始前请阅读 [README](README.md) 中的分支范围与部署说明，以及 [LICENSE](LICENSE)。

## 分支政策与贡献范围

- 本分支的贡献以最新的 `upstream/product/multi-device` 为基线，PR 也提交到上游的 `product/multi-device`。
- 适合本分支的改动包括：`backend/` 中的账号与会话、练习记录 API、PostgreSQL 持久化与迁移、Docker Compose 部署、可选 Tor 入口，以及前端账号面板、本地记录合并、跨设备同步、离线恢复、冲突处理和对应的测试与文档。
- 部署改动应保留单一后端入口，并兼容现有静态前端、本地练习记录和可直接打开 `index.html` 的使用方式。普通静态模式应继续使用本地数据，不显示账号面板，也不请求认证或同步 API。
- 同步范围是练习记录及其完整回顾数据，包括答案、笔记、高亮和套题子记录；题库文件、词汇、偏好设置、备份文件和进行中的答题草稿仍保留在当前设备。涉及记录格式或同步协议时，应验证完整字段的往返保存、本地记录合并前的备份、删除传播、冲突处理及账号归属，避免丢失记录或让旧快照覆盖其他设备的更新。
- 本分支不扩展为管理员平台、TOTP 系统、多认证/业务入口或多层代理架构；完整范围以 [README](README.md) 为准。
- 与部署无关的通用前端、题库或界面改动，仍应从 `upstream/opensource` 创建工作分支并向 `opensource` 提交 PR，遵循该分支的贡献指南。确有部署兼容性需要的前端改动，应在本分支 PR 中说明依赖关系。
- `main` 仍由维护者管理，不接受外部贡献者直接发起的 PR。本文只规定部署分支的贡献流程，不改变 `opensource` 到 `main` 的维护流程。

本分支的 PR 关系如下：

```text
上游仓库：sallowayma-git/IELTS-practice
基线分支：upstream/product/multi-device（最新状态）
工作分支：贡献者 fork 中的临时分支
PR 目标：sallowayma-git/IELTS-practice:product/multi-device
```

## 外部贡献流程

### 1. Fork 并配置远端

在 GitHub 上 fork 本仓库，再克隆自己的 fork。以下命令约定 `origin` 指向你的 fork，`upstream` 指向上游仓库：

```bash
git clone https://github.com/<your-account>/IELTS-practice.git
cd IELTS-practice
git remote add upstream https://github.com/sallowayma-git/IELTS-practice.git
git remote -v
```

如果已经配置过 `upstream`，请确认地址，不要重复添加。

### 2. 从最新部署分支创建工作分支

先确认工作区干净；已有未提交改动时先妥善保存。直接从上游跟踪分支创建用途单一的临时工作分支，无需先同步 fork 的同名部署分支：

```bash
git fetch upstream product/multi-device
git switch --no-track --create contrib/fix-deployment upstream/product/multi-device
```

将示例中的 `contrib/fix-deployment` 换成本次贡献的分支名，并在后续命令中保持一致。不要直接在 `main`、`opensource` 或共享的部署分支上开发，也不要从其他分支带入无关历史。

### 3. 修改、验证并推送到 fork

按下文运行与改动相关的检查。提交前检查差异，只暂存本次贡献涉及的文件；提交信息、PR 标题与正文、评审回复使用英文。

```bash
git diff --check
git status --short
git diff
# 使用 git add 暂存本次改动涉及的文件
git diff --cached
git commit -m "fix(deploy): describe the deployment change"
git push --set-upstream origin contrib/fix-deployment
```

不要提交 `.env`、数据库备份、账号或练习数据、Tor hidden-service 私钥、依赖缓存、测试运行产物或本地工作目录。具体忽略规则见 [.gitignore](.gitignore)，不要通过强制暂存绕过它。配置示例使用占位符；依赖变更应同步 `backend/package-lock.json` 或 `developer/package-lock.json`。数据库迁移 SQL 应提交到 `backend/migrations/`。

运行时依赖的 bundle 需要纳入版本控制；只有对应源文件变化时，才重新生成并提交相关 bundle。自备听力题源、音频、PDF、`ListeningPractice/` 目录和本地生成的听力索引不属于可提交资产；共享听力运行页面按现有跟踪规则维护。

### 4. 创建 PR

在 GitHub 创建 PR 时确认：

- **base repository**：`sallowayma-git/IELTS-practice`
- **base branch**：`product/multi-device`
- **head repository**：你的 fork
- **compare branch**：本次贡献的临时工作分支

PR 应用英文说明具体问题、修改后的行为、实际执行的验证命令及结果。涉及部署配置、数据库结构、API 契约或同步数据格式时，还应说明对现有部署和已保存数据的影响，以及必要的升级步骤。涉及账号或同步界面时，附上不含个人数据的复现步骤和必要截图。一个 PR 只解决一个独立问题。

### 5. 在评审期间保持基线更新

上游部署分支有更新时，将它合入自己的工作分支，解决冲突并重新运行受影响的检查：

```bash
git fetch upstream product/multi-device
git switch contrib/fix-deployment
git merge upstream/product/multi-device
git push origin contrib/fix-deployment
```

不要自行把基线或 PR 目标改成 `main` 或 `opensource`。维护者负责将 `main` 的更新同步到部署分支，并在同步时保留部署功能；贡献者只需跟进最新部署分支。需要跨分支提交的改动，由维护者协调。

## 按改动类型验证

以下命令均从仓库根目录执行。本地按改动范围选择检查；CI 则对目标为 `product/multi-device` 的 PR 执行全部检查，包括草稿 PR 和纯文档 PR。

[Multi-device CI](.github/workflows/ci-multi-device.yml) 在 PR 打开、提交更新、重新打开、转为可评审或编辑时触发；未引起 PR 更新的直接 push、定时任务和 PR 关闭本身不会触发该工作流。检查项和运行环境如下，具体配置以工作流文件为准：

| 检查 | CI 环境 | 验证内容 |
| --- | --- | --- |
| `md-quality` | Node.js 22、Python 3.12、Chromium | Bundle 一致性、JavaScript/IndexedDB 回归、Python 单元测试、阅读数据完整性 |
| `md-backend` | Node.js 24 | 后端认证、会话、记录 API、同步并发保护与静态资源服务 |
| `md-e2e` | Node.js 22、Python 3.12、Chromium | 统一浏览器套件，包含阅读、听力、套题、导入导出及 `file://` 流程 |
| `md-deploy-smoke` | Node.js 24、Chromium、Docker Compose | 真实 PostgreSQL 部署、迁移、重启持久化及浏览器登录与同步 |
| `md-ci` | 汇总检查 | 以上四项均为 `success` 才通过；失败、取消或跳过均不满足要求 |

本地复现时使用对应的运行环境。浏览器检查需要 Node Playwright；Python 浏览器脚本还需要单独安装 Python Playwright。两套依赖的安装命令见下文。Windows PowerShell 下先设置以下环境变量，让 Python 及其子进程统一使用 UTF-8：

```powershell
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
```

E2E 和部署诊断文件写入 `developer/tests/e2e/reports/`，CI 分别上传对应产物并保留 14 天。触发细节、部署清理方式与本地复现说明见 [Multi-device CI 说明](developer/tests/ci/MULTI_DEVICE_CI.md)。

### 后端与记录 API

```bash
npm ci --prefix backend
npm test --prefix backend
```

现有后端测试使用内存中的账号、会话和记录存储，覆盖首个账号注册、认证、CSRF、独立设备会话的完整记录往返、账号与快照版本校验、并发更新保护及静态资源服务。修改相关行为时，应补充有针对性的回归测试。这些测试不替代真实 PostgreSQL、数据库迁移或容器启动验证。

登录与同步界面的浏览器回归需要前后端依赖和 Node Playwright Chromium：

```bash
npm ci --prefix backend
npm ci --prefix developer
node developer/node_modules/playwright/cli.js install chromium --only-shell
node developer/tests/e2e/multi_device_sync.cjs
```

该脚本默认启动隔离的内存后端，验证本地记录备份与合并、双设备同步、离线恢复、冲突处理、删除传播和完整回顾数据。`md-deploy-smoke` 会在独立的 PostgreSQL 容器部署上执行相同的浏览器操作；这项同步回归不包含在 `md-e2e` 的统一套件中。

### 数据库与部署

修改数据库、迁移、容器构建或部署配置时，先复现 CI 的隔离部署冒烟检查。需要 Node.js 24、正在运行的 Linux Docker 引擎和 Docker Compose 2.24.4 或更新版本：

```bash
npm ci --prefix developer
node developer/node_modules/playwright/cli.js install chromium --only-shell
node backend/scripts/ci-smoke.mjs
```

脚本通过 [CI Compose 覆盖配置](backend/docker-compose.ci.yml) 使用独立项目名、临时凭据、数据库卷和可用的本机端口。它检查普通及 onion profile 配置、构建应用和 Tor 镜像、启动应用与 PostgreSQL，验证迁移重复执行、账号与会话、完整记录、应用重启后的持久化及浏览器同步，结束时清理本次创建的部署。Linux 环境缺少浏览器系统依赖时，在 Chromium 安装命令中添加 `--with-deps`，与 CI 保持一致。

如果运行被强制中断，按 [部署冒烟清理说明](developer/tests/ci/MULTI_DEVICE_CI.md#reproduce-the-deployment-smoke-test) 设置 `MD_SMOKE_STATE_DIR` 并执行 `node backend/scripts/ci-smoke.mjs --cleanup`。不要上传该临时状态目录或其中的环境文件。

按照 [README 的多设备后端部署说明](README.md#多设备后端部署) 创建本地 `backend/.env`，替换示例密码和会话密钥。验证使用独立的测试数据库或测试部署，避免影响现有数据。

需要手动检查实际配置或受影响服务时，再执行：

```bash
docker compose --env-file backend/.env -f backend/docker-compose.yml config --quiet
docker compose --env-file backend/.env -f backend/docker-compose.yml up --build
```

确认 `/api/health`、首页和练习资源可访问，并验证相关注册/登录及记录 API。涉及迁移或数据库存储时，还应验证已有数据升级、重复执行迁移，以及重启服务后记录仍可读取；仅通过内存存储测试不足以证明持久化正确。

冒烟脚本会构建 Tor 镜像，但不会验证实际 Tor 网络连通性。涉及 Tor 时，额外启动同一应用入口的 onion profile：

```bash
docker compose --profile onion --env-file backend/.env -f backend/docker-compose.yml config --quiet
docker compose --profile onion --env-file backend/.env -f backend/docker-compose.yml up --build
```

检查实际 onion 访问；配置解析成功本身不代表服务已可用。验证过程不应提交个人配置、密钥、数据库或运行日志。

### 前端、数据格式与生成资源

涉及前端兼容性时，至少执行：

```bash
npm ci --prefix developer
node developer/node_modules/playwright/cli.js install chromium --only-shell
node scripts/build-bundles.mjs --check
npm test --prefix developer
```

Chromium 用于 IndexedDB 等浏览器回归。修改 bundle 的源文件后，先运行 `node scripts/build-bundles.mjs`，再检查生成差异并重新执行 `--check`。涉及阅读数据或生成器时，还应运行：

```bash
python -X utf8 -m unittest discover -s developer/tests/py -p "test_*.py"
python -X utf8 developer/tests/ci/check_reading_data_integrity.py
```

涉及练习提交、阅读或听力套题、回顾、导入导出或本地持久化流程时，在安装上述前端依赖和 Node Playwright Chromium 后，再安装与 CI 一致的 Python Playwright 及其 Chromium，运行统一浏览器套件：

```bash
python -m pip install playwright==1.56.0
python -m playwright install chromium
python -X utf8 developer/tests/e2e/e2e_runner.py
```

Linux 环境需要浏览器系统依赖时，将 Python 的安装浏览器命令改为 `python -m playwright install --with-deps chromium`，Node Playwright 同样使用 `--with-deps`。

涉及运行时入口或重置流程时，在准备好上述浏览器依赖后，还应运行相关静态检查及重置回归。这两项属于按改动补充的本地验证，当前 `Multi-device CI` 不直接执行它们：

```bash
python -X utf8 developer/tests/ci/run_static_suite.py
python -X utf8 developer/tests/e2e/full_reset_flow.py
```

部署相关前端改动还需通过后端 HTTP 入口验证，并确认原有 `file://` 静态使用方式仍可用。

### 纯文档改动

检查分支名、PR 目标、相对链接、文件路径、命令前置依赖和 CI 说明是否与仓库当前实现一致，并执行 `git diff --check`。只修改文档时，本地无需运行与改动无关的应用测试；提交 PR 后仍会触发上述全部 CI 检查。

## 合并与后续贡献

- 维护者审核后将本分支的贡献合入 `product/multi-device`；是否另行进入其他分支，由维护者决定。
- PR 合并或关闭后，可以删除 fork 中的临时工作分支；下一次贡献重新从最新上游目标分支开始。
- 基线或目标错误、夹带无关历史、超出轻量部署范围的 PR，可能需要重新整理后提交。
