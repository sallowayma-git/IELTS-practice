# 贡献指南（Contribution Policy）

感谢你为 IELTS Practice 做出贡献。本文档定义仓库的分支与 Pull Request（PR）流程，尤其适用于没有本仓库写入权限的外部贡献者。

## 提案与代码评审

- 建议贡献者始终在提交 PR 前先创建 Issue，说明待解决的问题、实际需求与拟议方案，供维护者审查需求与贡献方案是否匹配，并决定是否推进及改动范围。在提交 PR 时，建议关联对应 Issue，便于追溯讨论与决策。
- 没有本仓库写入权限的贡献者不得自行通过 `@codex` 请求或触发代码评审（code review）。是否调用 Codex 进行评审，由具有仓库写入权限的维护者决定并发起。

## 分支政策

- `main` 是由维护者管理的稳定分支，不接受外部贡献者直接发起的 PR。
- `opensource` 是公开贡献的唯一目标分支，也是外部贡献者创建工作分支时必须使用的基线。
- 即使一项改动最终计划进入 `main`，外部贡献者也必须先向 `opensource` 提交 PR。由维护者负责后续从 `opensource` 向 `main` 提升经过审核的改动。
- 只有维护者明确要求时，才可使用其他基线或目标分支。

因此，没有仓库写入权限的贡献者应使用以下 PR 关系：

```text
上游仓库：sallowayma-git/IELTS-practice
基线分支：upstream/opensource（最新状态）
工作分支：贡献者 fork 中的临时分支
PR 目标：sallowayma-git/IELTS-practice:opensource
```

不要将外部贡献 PR 的目标分支设置为 `main`。

## 外部贡献流程

### 1. Fork 并配置远端

先在 GitHub 上 fork 本仓库，再克隆自己的 fork。以下命令约定 `origin` 指向你的 fork，`upstream` 指向本仓库：

```bash
git clone https://github.com/<your-account>/IELTS-practice.git
cd IELTS-practice
git remote add upstream https://github.com/sallowayma-git/IELTS-practice.git
git remote -v
```

如果已经配置过 `upstream`，不要重复添加；请确认它指向上述官方仓库。

### 2. 将 fork 的 `opensource` 同步到上游最新状态

创建工作分支之前，必须先获取并同步最新的 `upstream/opensource`：

```bash
git fetch upstream opensource
```

如果本地已经有 `opensource` 分支，请执行：

```bash
git switch opensource
git merge --ff-only upstream/opensource
git push origin opensource
```

如果本地还没有 `opensource` 分支，请改为执行：

```bash
git switch --create opensource --track upstream/opensource
git push --set-upstream origin opensource
```

若 `git merge --ff-only` 失败，请先运行 `git status` 确认工作区是否干净，并检查本地 `opensource` 是否含有与上游不同的提交。不要在该分支上继续开发，也不要强制推送；请先保存未提交改动、备份有关提交，并重新从 `upstream/opensource` 建立干净基线。

### 3. 从最新 `opensource` 创建临时工作分支

不要直接在 `opensource` 上开发。每项贡献都应重新获取上游状态，并显式从最新的 `upstream/opensource` 创建一个用途单一的临时分支：

```bash
git fetch upstream opensource
git switch --create contrib/<short-description> upstream/opensource
```

例如：

```bash
git switch --create contrib/fix-reading-progress upstream/opensource
```

完成改动、测试和提交后，将该临时分支推送到自己的 fork：

```bash
git push --set-upstream origin contrib/<short-description>
```

### 4. 创建 PR 并选择正确目标

在 GitHub 创建 PR 时，请逐项确认：

- **base repository**：`sallowayma-git/IELTS-practice`
- **base branch**：`opensource`
- **head repository**：你的 fork
- **compare branch**：本次贡献的临时工作分支

PR 标题和说明应清楚描述改动目的、主要实现、验证方式及已知影响。一个 PR 应只解决一个独立问题，避免混入无关格式化、生成文件或本地配置改动。

### 5. 在评审期间保持基线更新

如果 `upstream/opensource` 在评审期间发生变化，请把最新基线合入你的工作分支，解决冲突并重新验证：

```bash
git fetch upstream opensource
git switch contrib/<short-description>
git merge upstream/opensource
git push origin contrib/<short-description>
```

只更新你自己的临时工作分支，不要向上游仓库直接推送，也不要把 PR 改为指向 `main`。

## PR 合并与分支清理

- 维护者在审核通过后将外部贡献合入 `opensource`。
- 是否以及何时将改动从 `opensource` 提升到 `main`，由维护者根据发布与稳定性要求决定；外部贡献者无需另开一个指向 `main` 的 PR。
- PR 合并或关闭后，可以删除 fork 中的临时工作分支。后续贡献应再次从最新 `upstream/opensource` 开始。
- 目标分支错误、基线过旧或包含无关历史的 PR，可能会被要求重新基于 `opensource` 提交或被维护者关闭。

## 提交前检查

提交 PR 前请确认：

- 工作分支直接源于最新的 `upstream/opensource`。
- PR 的目标分支是 `opensource`，不是 `main`。
- 改动范围集中，且未包含密钥、个人数据、本地缓存或不应公开分发的第三方材料。
- 已按改动类型运行相关测试，并在 PR 说明中记录结果；纯文档改动至少应检查链接、路径和命令是否有效。
- 已阅读并遵守仓库的 [README](README.md) 与 [LICENSE](LICENSE)。
