# 贡献指南（Contribution Policy）

感谢你为 IELTS Practice 做出贡献。本文档定义仓库的分支与 Pull Request（PR）流程，尤其适用于没有本仓库写入权限的外部贡献者。

## 提案与代码评审

- 外部贡献者向本仓库提交的每个 PR，均须先创建或使用本仓库中至少一个直接相关的 Issue，说明待解决的问题、实际需求与拟议方案，作为贡献提案的预审与授权记录。小范围 bug 修复及小幅文档更正可使用简短 Issue 和轻量预审，但不得免除 Issue 优先要求。
- 发起上游 PR 前，须由维护者或授权代理人（定义见下文）在 Issue 中记录是否允许该贡献者就相应范围进入 PR 阶段。决定可批准范围、附加条件或缩减／调整范围、要求补充信息、暂缓、拒绝，或按下文分支政策指定所需基线或目标分支。仅在获准且满足相关条件后，才可发起 PR，并关联该 Issue；使用已有 Issue 时，也须明确确认该贡献者可实现相应范围。
- 等待上述决定期间，提案贡献者可在自己的 fork、本地分支或本地测试环境调查问题，准备原型、提交、diff、复现证据、测试、截图等材料，并在 Issue 中链接或展示。准备工作本身不构成上游批准，不授权向本仓库发起 PR 或使用非默认上游分支，也不保证接纳或合并。
- 发起 PR 后会自动触发一次代码评审（code review）。没有本仓库写入权限的贡献者不得自行通过 `@codex` 请求或触发代码评审，包括在首次自动评审后再次拉起自动审查。后续是否需要手动调用 Codex 进行评审，由具有仓库写入权限的维护者决定并发起。

## Issue 归属、协调与代表权限

外部贡献者可在 Issue 中提供新的技术证据、报告复现情况、提出技术观察或设计建议、讨论解决及实现方案、参与评审和评论，以及报告自身贡献的进展。以下规则仅约束本仓库的贡献流程，不限制依仓库许可证在个人 fork 中进行的合法独立修改：

- Issue 公开可见或处于开放状态，本身不应视为向外部贡献者开放实现或可自行认领；维护者创建的 Issue 也不例外。由维护者负责的跟踪、集成、发布、迁移、治理、沟通或执行子任务，应由维护者或该 Issue 的负责人协调。
- 对上述维护者负责的工作，仅在有明确开放信号时，外部贡献者才可承担本仓库贡献流程中的实现任务，例如适用的 `help wanted` / `good first issue` 标签、指派给该贡献者、维护者或授权代理人明确邀请或确认其参与实现，或已按下文分支政策获得使用非默认基线或目标分支的明确授权。这些信号不替代上文进入 PR 阶段的授权；小幅或仅文档改动也适用。Issue 提及其他开发分支，本身不构成使用该分支作为贡献基线或 PR 目标的许可，仍须遵守下文分支政策。
- 外部贡献者为准备自己提议的贡献而创建 Issue 时，提案贡献者为该 Issue 的默认外部实现参与者；维护者及授权代理人保留各自权限范围内的协调与决定权。除非维护者或授权代理人明确允许，其他外部贡献者的参与应限于讨论、证据与评审，不得接管实现、为同一已批准范围发起竞争性上游 PR、将自己的修改作为该 Issue 的正式实现，或声称该 Issue 已指派给自己。默认参与资格本身不构成 PR 授权。
- 默认参与不构成永久或不可撤销的实现权。维护者或在其授权范围内的授权代理人可因放弃、长期缺乏实质进展、实现方向不适合、贡献者请求、项目优先级、并行方案需求、依赖或发布要求等，重新指派或撤回原实现机会、邀请他人、授权共同贡献、要求替代实现、允许竞争方案，或将范围重新向社区开放。
- 未经明确授权，外部贡献者不得接管维护者负责工作的项目级协调，或以权威身份宣布项目整体状态、接纳决定、范围批准或否决、发布或提升决定、Issue 已具备关闭条件或里程碑已完成，也不得代表维护者或所有者发出指示。相关观察和建议应明确表述为贡献者本人的观点。
- 本文的“授权代理人”指经明确且可核验书面授权的代理人。授权须由有权委托相应职责者出具，可独立核验并载明范围；代理人仅可在该范围内行使权限，不自动取得更广泛的所有者或维护者权限。外部贡献者仅可在此类授权范围内声称或暗示代表仓库所有者、维护者、协作者、Issue 负责人或仓库／项目行事；否则，建议应以贡献者本人的名义提出。
- 仓库中可见的写入权限、协作者身份、Issue/PR 指派等，可作为相关仓库职责或操作权限的依据，但不自动授予代表仓库所有者或整个项目的权限，也不授予全部治理、范围、发布、提升、里程碑、接纳或关闭决定权。缺少此类权限并不排除有效授权。如相关授权并非直接记录于本仓库，在依赖该授权作出项目治理决定前，应完成独立核验，并将核验结果及适用授权范围记录于相关 Issue、PR 或其他仓库治理记录中。无需公开私人授权材料、私人消息或个人信息，但仓库记录应能表明授权已核验及其适用范围。仅由声称获授权者自述，不足以核验其权限。授权核验前，其声称的批准、指示、范围、发布、提升或关闭决定，不应视为权威项目决策。

## 分支政策

- `main` 是由维护者管理的稳定分支，不接受外部贡献者直接发起的 PR。
- `opensource` 是公开贡献的唯一目标分支，也是外部贡献者创建工作分支时必须使用的基线。
- 即使一项改动最终计划进入 `main`，外部贡献者也必须先向 `opensource` 提交 PR。由维护者负责后续从 `opensource` 向 `main` 提升经过审核的改动。
- 只有维护者，或经明确且可核验书面授权且授权范围包含相应贡献流程或分支决定的授权代理人明确要求时，才可使用其他基线或目标分支。

因此，没有仓库写入权限的贡献者应使用以下 PR 关系：

```text
上游仓库：sallowayma-git/IELTS-practice
基线分支：upstream/opensource（最新状态）
工作分支：贡献者 fork 中的临时分支
PR 目标：sallowayma-git/IELTS-practice:opensource
```

不要将外部贡献 PR 的目标分支设置为 `main`。

## 外部贡献流程

以下步骤承接上文的 Issue 提案与预审；等待决定期间可准备 fork 与工作分支，第 4 步须在获准进入 PR 阶段后进行。

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

- 已关联本仓库中直接相关的 Issue，且其中已记录维护者或授权代理人允许本人就本次范围进入 PR 阶段的决定，相关条件已满足。
- 工作分支直接源于最新的 `upstream/opensource`。
- PR 的目标分支是 `opensource`，不是 `main`。
- 改动范围集中，且未包含密钥、个人数据、本地缓存或不应公开分发的第三方材料。
- 已按改动类型运行相关测试，并在 PR 说明中记录结果；纯文档改动至少应检查链接、路径和命令是否有效。
- 已阅读并遵守仓库的 [README](README.md) 与 [LICENSE](LICENSE)。
