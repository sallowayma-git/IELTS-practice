# 贡献指南（多设备轻量部署分支）

本文档适用于 `feature/multi-device-easy-deploy` 分支，说明部署相关贡献的范围、工作基线、PR 目标和验证方式。开始前请阅读 [README](README.md) 中的分支范围与部署说明，以及 [LICENSE](LICENSE)。

## 分支政策与贡献范围

- 本分支的贡献以最新的 `upstream/feature/multi-device-easy-deploy` 为基线，PR 也提交到上游的 `feature/multi-device-easy-deploy`。
- 适合本分支的改动包括：`backend/` 中的账号与会话、练习记录 API、PostgreSQL 持久化与迁移、Docker Compose 部署、可选 Tor 入口，以及这些能力所需的测试和文档。
- 部署改动应保留单一后端入口，并兼容现有静态前端、本地练习记录和可直接打开 `index.html` 的使用方式。涉及前端数据格式时，应验证完整记录字段的往返保存，避免丢失答案、标注或套题子项。
- 本分支不扩展为管理员平台、TOTP 系统、多认证/业务入口或多层代理架构；完整范围以 [README](README.md) 为准。
- 与部署无关的通用前端、题库或界面改动，仍应从 `upstream/opensource` 创建工作分支并向 `opensource` 提交 PR，遵循该分支的贡献指南。确有部署兼容性需要的前端改动，应在本分支 PR 中说明依赖关系。
- `main` 仍由维护者管理，不接受外部贡献者直接发起的 PR。本文只规定部署分支的贡献流程，不改变 `opensource` 到 `main` 的维护流程。

本分支的 PR 关系如下：

```text
上游仓库：sallowayma-git/IELTS-practice
基线分支：upstream/feature/multi-device-easy-deploy（最新状态）
工作分支：贡献者 fork 中的临时分支
PR 目标：sallowayma-git/IELTS-practice:feature/multi-device-easy-deploy
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
git fetch upstream feature/multi-device-easy-deploy
git switch --no-track --create contrib/fix-deployment upstream/feature/multi-device-easy-deploy
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

不要提交 `.env`、数据库备份、账号或练习数据、Tor hidden-service 私钥、依赖缓存或测试运行产物。配置示例使用占位符；依赖变更应同步相应锁文件。只有源文件改动确实需要时，才重新生成并提交对应 bundle，避免夹带无关生成资产。

### 4. 创建 PR

在 GitHub 创建 PR 时确认：

- **base repository**：`sallowayma-git/IELTS-practice`
- **base branch**：`feature/multi-device-easy-deploy`
- **head repository**：你的 fork
- **compare branch**：本次贡献的临时工作分支

PR 应说明具体问题、修改后的行为和相关验证结果。涉及部署配置、数据库结构或 API 契约时，还应说明对现有部署和已保存数据的影响，以及必要的升级步骤。一个 PR 只解决一个独立问题。

### 5. 在评审期间保持基线更新

上游部署分支有更新时，将它合入自己的工作分支，解决冲突并重新运行受影响的检查：

```bash
git fetch upstream feature/multi-device-easy-deploy
git switch contrib/fix-deployment
git merge upstream/feature/multi-device-easy-deploy
git push origin contrib/fix-deployment
```

不要自行把基线或 PR 目标改成 `main` 或 `opensource`。维护者负责将 `main` 的更新同步到部署分支，并在同步时保留部署功能；贡献者只需跟进最新部署分支。需要跨分支提交的改动，由维护者协调。

## 按改动类型验证

以下命令均从仓库根目录执行。当前 [CI 配置](.github/workflows/ci.yml) 仅监听 `opensource` 的 push 和 PR，且未运行后端测试，因此本部署分支不能依赖该工作流自动完成验证。

### 后端与记录 API

```bash
npm ci --prefix backend
npm test --prefix backend
```

现有后端测试使用内存中的账号、会话和记录存储，覆盖认证、CSRF、独立设备会话的记录往返及静态资源服务。修改相关行为时，应补充有针对性的回归测试。这些测试不替代真实 PostgreSQL、数据库迁移或容器启动验证。

### 数据库与部署

按照 [README 的多设备后端部署说明](README.md#可选多设备后端部署) 创建本地 `backend/.env`，替换示例密码和会话密钥。验证使用独立的测试数据库或测试部署，避免影响现有数据。

修改 Docker 或 Compose 配置时，检查配置并实际构建、启动受影响的服务：

```bash
docker compose --env-file backend/.env -f backend/docker-compose.yml config --quiet
docker compose --env-file backend/.env -f backend/docker-compose.yml up --build
```

确认 `/api/health`、首页和练习资源可访问，并验证相关注册/登录及记录 API。涉及迁移或数据库存储时，还应验证已有数据升级、重复执行迁移，以及重启服务后记录仍可读取；仅通过内存存储测试不足以证明持久化正确。

涉及 Tor 时，额外验证同一应用入口的 onion profile：

```bash
docker compose --profile onion --env-file backend/.env -f backend/docker-compose.yml config --quiet
docker compose --profile onion --env-file backend/.env -f backend/docker-compose.yml up --build
```

检查实际 onion 访问；配置解析成功本身不代表服务已可用。验证过程不应提交个人配置、密钥、数据库或运行日志。

### 前端、数据格式与生成资源

涉及前端兼容性时，至少执行：

```bash
npm ci --prefix developer
node scripts/build-bundles.mjs --check
npm test --prefix developer
```

修改 bundle 的源文件后，先运行 `node scripts/build-bundles.mjs`，再检查生成差异并重新执行 `--check`。涉及阅读数据或生成器时，还应运行：

```bash
python -X utf8 -m unittest discover -s developer/tests/py -p "test_*.py"
python -X utf8 developer/tests/ci/check_reading_data_integrity.py
```

涉及练习提交、套题、回顾或本地持久化流程时，按 [CI 配置](.github/workflows/ci.yml) 安装 Python Playwright 与 Chromium，再运行对应浏览器测试或完整套件：

```bash
python -X utf8 developer/tests/e2e/e2e_runner.py
```

涉及运行时入口或重置流程时，还应运行相关静态检查及重置回归：

```bash
python -X utf8 developer/tests/ci/run_static_suite.py
python -X utf8 developer/tests/e2e/full_reset_flow.py
```

部署相关前端改动还需通过后端 HTTP 入口验证，并确认原有 `file://` 静态使用方式仍可用。

### 纯文档改动

检查分支名、PR 目标、相对链接、文件路径和命令是否与仓库当前实现一致，并执行 `git diff --check`。只修改文档时，无需运行与改动无关的应用测试。

## 合并与后续贡献

- 维护者审核后将本分支的贡献合入 `feature/multi-device-easy-deploy`；是否另行进入其他分支，由维护者决定。
- PR 合并或关闭后，可以删除 fork 中的临时工作分支；下一次贡献重新从最新上游目标分支开始。
- 基线或目标错误、夹带无关历史、超出轻量部署范围的 PR，可能需要重新整理后提交。
