# IELTS Multi-Device — 多设备练习系统

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/sallowayma-git/IELTS-practice)

IELTS Multi-Device 是面向个人 NAS、私人服务器和可信局域网的自托管雅思练习系统。本分支通过一个 Node.js 后端提供练习网页、账号会话和练习记录 API，使用 PostgreSQL 保存服务端数据，让手机、平板和电脑通过同一部署访问自己的练习记录。

当前产品分支为 **`product/multi-device`**。本文涵盖这套自托管部署的安装、账号、数据管理和维护；静态版及其已有的 Sync 功能请参阅对应版本文档。

[部署](#多设备后端部署) · [账号与多设备使用](#账号与多设备使用) · [升级与备份](#升级与备份) · [常见问题](#常见问题) · [贡献指南](CONTRIBUTING.md)

## 版本定位与能力范围

| 版本 | 入口与用途 |
| --- | --- |
| **IELTS Multi-Device（本分支）** | 从 `product/multi-device` 源码部署 Node.js 应用与 PostgreSQL，自行管理账号、会话、服务端练习记录及备份。 |
| [IELTS Atlas / IELTS Practice](https://github.com/sallowayma-git/IELTS-practice/tree/main) | 静态网页版；其 Sync 功能、运行方式和发布包请查看该版本文档。 |
| [IELTS-WRITING-FEAT](https://github.com/sallowayma-git/IELTS-practice/tree/IELTS-WRITING-FEAT) | 写作与 AI 协作客户端，按对应分支文档安装和使用。 |

本分支提供以下能力：

| 能力 | 当前行为 |
| --- | --- |
| 个人账号与独立设备会话 | 在设置页注册或登录，同一账号可在多台设备使用；默认只允许注册第一个账号。 |
| 服务端练习记录 | PostgreSQL 保存账号、会话和练习记录；前端保留本地数据，通过后端合并记录与处理冲突。 |
| 阅读与练习回顾 | 题库浏览、阅读答题、解析、笔记、高亮、答案对比及历史记录回顾。 |
| 听力与套题 | 接入自备听力资源，支持阅读套题和听力 P1–P4 套题；题源与音频需要自行准备。 |
| 学习管理 | 练习统计、Markdown 报告、数据导入导出、应用内备份、本地磁盘备份、词汇工具与成就。 |
| 自托管部署 | Docker Compose 管理应用与数据库；可选 Tor onion service 指向同一个应用入口。 |

产品范围以个人练习和轻量部署为主，当前不包含管理员 UI/API、TOTP、独立认证域、多个业务入口或多层代理架构。通用前端功能与静态版分别演进，不能假定本分支包含静态版的每一项新功能。更完整的独立服务端方案可参考 [IELTS-Project](https://github.com/k-undurkhaan-2/IELTS-Project)。

## 重要使用声明

本项目允许个人基于学习、研究和自用目的进行本地运行、私人部署或在个人控制的网页环境中使用。部署到电脑、私人服务器、NAS 或个人网页空间时，应确保访问范围和传播范围可控。

请勿将包含题源、音频、PDF、解析、二次修改页面或打包产物的网站、镜像站、压缩包继续公开分发给更多人；请勿将本项目用于商业售卖、付费社群、引流推广、公开宣传或其他盈利行为。题源和部分素材涉及第三方版权，公开部署不代表取得这些内容的传播许可。

请遵循：**自行部署，个人使用，控制传播范围，不以项目或其题源牟利。** 代码授权以 [LICENSE](LICENSE) 为准；题源、文章、音频、PDF、图片及其他第三方内容版权归原权利人所有。

## 多设备后端部署

### 准备环境与源码

- 服务端：能够运行 Linux 容器的 Docker 环境，以及 Docker Compose。以下命令以 Compose 2.24.4 或更新版本为基线，与部署冒烟测试要求一致。
- 浏览器：建议使用支持 IndexedDB 的近期 Chrome 或 Edge，允许练习页弹窗，并保留站点数据。移动浏览器的弹窗、音频和本地文件访问行为可能不同。
- Docker 部署无需在宿主机另外安装 Node.js 或 PostgreSQL；当前应用镜像使用 Node.js 24，数据库镜像使用 PostgreSQL 16。

首次部署时，克隆本产品分支。已有部署请先阅读[升级与备份](#升级与备份)。

```bash
git clone --branch product/multi-device --single-branch https://github.com/sallowayma-git/IELTS-practice.git
cd IELTS-practice
```

以下命令均在仓库根目录执行。请使用完整源码检出，包含 `backend/`、`assets/`、`css/`、`js/`、`templates/` 和 `index.html`；静态版运行 ZIP 不包含这套后端部署。

### 创建配置并启动

从 [backend/.env.example](backend/.env.example) 创建本地配置，仅在首次配置时复制，已有部署应保留原文件。

Linux / macOS / Git Bash：

```bash
cp backend/.env.example backend/.env
```

Windows PowerShell：

```powershell
Copy-Item backend/.env.example backend/.env
```

编辑 `backend/.env`，至少替换 `POSTGRES_PASSWORD` 和 `SESSION_SECRET`。后者应是至少 32 个字符的随机密钥，生产模式会拒绝示例值或过短的值。不要将个人配置提交到 Git。

```bash
docker compose --env-file backend/.env -f backend/docker-compose.yml config --quiet
docker compose --env-file backend/.env -f backend/docker-compose.yml up -d --build
docker compose --env-file backend/.env -f backend/docker-compose.yml ps
```

容器启动时会等待数据库就绪，再执行尚未应用的迁移并启动后端。应用直接提供仓库中已提交的前端 bundle，无需另建前端服务。

在服务器本机打开 [http://127.0.0.1:3000/](http://127.0.0.1:3000/)。[健康接口](http://127.0.0.1:3000/api/health) 返回 `{"ok":true}` 表示应用能够响应；还需完成注册、保存一条记录并在另一设备读取，才能确认账号与数据库流程可用。

启动失败时查看日志：

```bash
docker compose --env-file backend/.env -f backend/docker-compose.yml logs --tail=100 app postgres
```

### 配置项与访问地址

| 配置项 | 用途 |
| --- | --- |
| `POSTGRES_PASSWORD` | Compose 数据库密码，同时传给应用连接数据库；首次部署必须替换示例值。 |
| `SESSION_SECRET` | 会话签名密钥。升级时保留；更换后现有浏览器会话可能需要重新登录。 |
| `REGISTRATION_MODE` | `first-user` 仅允许首个账号注册，`disabled` 关闭注册，`open` 允许继续注册。个人部署通常使用前两种。 |
| `APP_BIND_ADDRESS` | Docker 应用端口绑定地址，默认 `127.0.0.1`，仅服务器本机可访问。 |
| `APP_PORT` | Docker 对外应用端口，默认 `3000`。 |
| `HOST` / `PORT` | 直接运行 Node.js 后端时的监听配置；Compose 内部固定为 `0.0.0.0:3000`。 |
| `DATABASE_URL` | 直接运行 Node.js 时使用的数据库连接串；Compose 应用使用容器内的 PostgreSQL 连接配置。 |
| `COOKIE_SECURE` | 默认 `false`，适用于本地 HTTP；通过 HTTPS 访问时可设为 `true`，浏览器只在安全连接上发送会话 Cookie。 |
| `TRUST_PROXY` / `TRUSTED_PROXY_IPS` | 在受控反向代理后启用并指定可信代理地址，配合代理转发的协议与客户端信息。 |

手机或另一台电脑不能用服务器的 `127.0.0.1` 地址访问。需要局域网访问时，将 `APP_BIND_ADDRESS` 改为服务器的局域网地址，或 `0.0.0.0`，重新执行启动命令，并通过防火墙限制访问范围。例如，服务器地址为 `192.168.1.10` 时，在其他设备打开 `http://192.168.1.10:3000/`。

应用本身不终止 TLS。通过 HTTPS 反向代理访问时，应让网页与 `/api/` 指向同一个后端，并按实际代理链配置上述 Cookie 与代理选项。普通 HTTP 入口不要启用 `COOKIE_SECURE=true`，否则可能无法维持登录。

Compose 同时将数据库端口绑定到服务器本机 `127.0.0.1:55432`；浏览器只访问应用端口。数据库已有数据卷时，仅修改 `POSTGRES_PASSWORD` 不会更改库内已有账号的密码，应通过数据库维护流程协调变更。

### 不使用 Docker

使用 Node.js 24 和独立 PostgreSQL，先创建可访问的数据库，再准备 `backend/.env`。将 `DATABASE_URL` 改为实际连接信息；示例中的 `55432` 是 Compose 映射端口，不能直接当作所有 PostgreSQL 实例的端口。连接串中的密码如含 URL 保留字符，需要按连接串规则编码。

```bash
npm ci --prefix backend
npm run migrate --prefix backend
npm start --prefix backend
```

后端会读取 `backend/.env`。长期运行时可在该文件中设置 `NODE_ENV=production`，使用符合要求的会话密钥，并通过自己的进程管理方式维护服务。此方式下，修改 `APP_BIND_ADDRESS` 不会改变 Node.js 的监听地址，应设置 `HOST` 和 `PORT`。

### 可选 Tor 入口

Tor profile 为同一个应用提供 onion 入口，使用同一套账号、记录和数据库：

```bash
docker compose --profile onion --env-file backend/.env -f backend/docker-compose.yml up -d --build
docker compose --profile onion --env-file backend/.env -f backend/docker-compose.yml exec -T tor cat /var/lib/tor/hidden_service/hostname
```

等待 Tor 完成初始化后，通过 Tor Browser 访问输出的 onion 地址。`tor_hidden_service` 数据卷保存 onion 服务身份，删除该卷会失去原身份。普通地址与 onion 地址属于不同浏览器来源，各自保存登录 Cookie 和本地数据；服务端账号及记录仍属于同一部署。

CI 会检查 profile 配置并构建 Tor 镜像，实际 onion 连通性需要手动验证。

## 账号与多设备使用

### 首次注册与连接已有记录

1. 从后端地址打开网页，进入 **设置 → 账号与多设备同步**。首次部署可点击“注册首个账号”；已有账号时直接登录。注册密码至少 8 个字符，包含大小写字母和数字，且不超过 72 个 UTF-8 字节。
2. 此浏览器已有练习记录时，点击 **备份并合并本地记录，启用同步**。应用先创建本地备份，再将本地记录与当前账号合并。空白浏览器登录后会直接连接并下载服务端记录。
3. 在另一台设备访问同一部署，登录同一账号。完成一次练习后，保留应用主页面，检查设置页的同步状态和最近同步时间；必要时点击 **立即同步**。
4. 首个账号创建后，可将 `REGISTRATION_MODE` 改为 `disabled` 并重新执行 Compose 启动命令，以明确关闭注册。保留 `first-user` 也会阻止继续注册。

未登录时仍可在当前浏览器练习并保存本地记录。界面中的“云端”指你部署的后端及数据库。

### 哪些数据会进入服务端

| 数据 | 保存与同步方式 |
| --- | --- |
| 账号、密码哈希与登录会话 | 保存在服务端 PostgreSQL；每台设备拥有自己的登录会话。 |
| 已保存的练习记录及完整回顾数据 | 在启用同步后合并到服务端，包括答案、成绩、笔记、高亮、标记和套题子记录。 |
| 练习记录的修改与删除 | 随记录同步到其他设备；遇到双方修改或删除冲突时，等待用户选择。 |
| 题库文件、音频、PDF、词汇、偏好设置、备份文件及答题草稿 | 不通过练习记录 API 同步。随部署提供的资源由服务器提供；自定义题库、浏览器配置和本地文件需另行准备。 |

统计和回顾基于设备当前已有的记录显示，读取另一设备的新记录后更新。进行中的套题和答题草稿不支持通过本后端跨设备接续。

### 离线、冲突与退出登录

- **离线或服务暂时不可用**：已经打开的页面会保留能够正常保存的本地练习记录，联网、回到页面或重新登录后可重试。显示“同步未完成”时，记录尚不能视为已到达服务端；这不保证断网后能重新加载全部网页、题目和音频。
- **同一条记录发生冲突**：同步暂停并显示冲突记录列表。先备份需要保留的数据，再选择“保留这些记录的本地版本”或“使用这些记录的云端版本”。当前按钮会应用到列表中的全部冲突记录。
- **退出登录**：停止同步并保留当前浏览器的本地记录，再次登录原账号后继续。已经绑定的本地数据不会自动改归其他账号；使用其他账号时应使用独立浏览器配置，或先导出备份再清除本地数据。
- **清除本地数据与删除记录**：设置页清除本地数据不等于清空服务端；重新连接账号后会下载服务端记录。需要跨设备删除练习时，使用练习记录页的删除操作，并确认同步完成。

### 从静态版或其他浏览器迁入

在原页面导出数据，在后端页面导入，再登录并合并记录。应用不会自动读取其他域名、端口、协议、浏览器配置或 `file://` 来源中的数据。

尽量保持日常访问地址稳定。更换域名、端口、HTTPS 协议或 SSH 隧道入口后，本地缓存、账号 Cookie 和题库配置可能需要重新建立；已成功保存到同一数据库的服务端记录可在登录后重新获取。

## 练习功能与题库资源

### 阅读、听力与套题

从“题库浏览”按类型、分类或关键词查找题目，允许弹窗后开始练习。提交后在“练习记录”查看答案、解析、笔记、高亮和套题结果；使用统计、趋势、热力图及 Markdown 导出整理学习记录。主页面承担记录接收与同步，练习时应保持打开。

阅读资产位于 [assets/generated/reading-exams/](assets/generated/reading-exams/) 与 [assets/generated/reading-explanations/](assets/generated/reading-explanations/)，实际题量以当前索引为准。阅读背题、词汇练习和成就仍可从对应入口使用。

套题支持经典、模拟和驻足模式。听力套题按 P1–P4 组织，模拟模式可统一提交四个 Part；其他模式按界面提示提交或继续。套题记录包含子项及回顾数据，进行中的恢复状态保留在当前设备。

### 自备听力与自定义题库

仓库包含共享听力运行页面 [listening-practice-unified.html](assets/generated/listening-exams/listening-practice-unified.html)，不附带听力音频、题源、PDF、完整 `ListeningPractice/` 或个人生成的听力索引。

如需启用听力扩展，自行准备资源并按题库导入流程配置；使用本地生成索引时，约定位置为：

```text
assets/generated/listening-exams/manifest.js
assets/generated/listening-exams/listening-index.compat.js
```

默认仓库中缺少这两个索引属于正常情况。导入后需验证题目页面与音频实际可访问，保持资源目录及题目 ID 稳定，避免历史记录无法回顾。

当前后端只提供 `css/`、`js/`、`assets/` 和 `templates/` 的静态资源，Dockerfile 也不会复制仓库根目录的 `ListeningPractice/`。仅把听力目录放到仓库根下或启用静态打包参数，并不能让它在后端入口可访问；服务端提供自备资源需要同时适配资源路径与服务映射。设备本地导入的资源也不会随练习记录自动上传。

## 升级与备份

### 区分三类备份

- **应用内备份**：保存在当前浏览器，适合操作前快速恢复；清除站点数据可能一并删除这些备份。
- **导出文件或本地磁盘备份**：适合浏览器迁移和长期留存。通过设置页导出，并确认文件已保存到浏览器存储之外；本地文件夹绑定取决于浏览器支持及授权。
- **服务端备份**：备份 PostgreSQL 数据库，并妥善保管 `backend/.env`；使用 Tor 时还需保留 `tor_hidden_service` 卷中的身份。浏览器导出不能替代账号、会话和数据库备份。

服务端记录会接收删除操作，因此同步副本不能替代独立备份。数据库备份应使用 PostgreSQL 备份工具或适当的数据库备份流程，避免把运行中数据目录的直接复制当作已验证的备份；恢复应先在独立实例验证。

### 更新现有部署

1. 确认当前分支为 `product/multi-device`，妥善保存本地改动，导出尚未同步的浏览器数据，并备份数据库与配置。
2. 在原部署目录更新源码，保留原 Compose 项目、数据库数据卷和 `backend/.env`：

```bash
git switch product/multi-device
git pull --ff-only origin product/multi-device
docker compose --env-file backend/.env -f backend/docker-compose.yml up -d --build
docker compose --env-file backend/.env -f backend/docker-compose.yml ps
```

3. 使用 Tor profile 的部署，更新时沿用带 `--profile onion` 的启动命令。直接运行 Node.js 的部署则重新安装锁定依赖、执行迁移，再重启后端。
4. 查看应用日志，确认迁移和启动成功；浏览器强制刷新后，核对旧记录、登录状态和两台设备间的新记录同步。

迁移脚本会记录已执行的 SQL，容器启动时只应用尚未执行的迁移。具体升级仍应检查本次变更涉及的数据结构和配置，不假定后续版本永远无需迁移。

不要把 `docker compose down -v` 或“清除本地数据”当作升级步骤：前者会删除部署的数据卷。迁移到另一台服务器或更换 Compose 项目名时，需要显式迁移数据库和所需数据卷；仅复制源码不会带走服务端记录。发生数据库结构变更后，也不能仅切回旧代码就认定完成回退。

## 本分支的本地兼容模式

本分支保留直接打开 `index.html` 或通过普通静态服务器运行的方式，用于本地练习和兼容性验证。此时本分支的“账号与多设备同步”面板不会显示，也不会请求本后端的认证与练习记录 API。

```bash
python -m http.server 8000
```

从仓库根目录运行后访问 [http://localhost:8000/](http://localhost:8000/)。它提供的是本地静态入口；要使用本文的服务端账号和 PostgreSQL 数据，请访问后端地址。关于静态版产品及其已有 Sync 功能，仍以 `main` 分支的文档为准。

## 开发、构建与验证

### 目录与运行资产

| 路径 | 用途 |
| --- | --- |
| [backend/src/](backend/src/) | 后端认证、会话、练习记录 API 与静态资源入口。 |
| [backend/migrations/](backend/migrations/) | PostgreSQL 数据库迁移。 |
| [backend/docker-compose.yml](backend/docker-compose.yml) | 应用、PostgreSQL 与可选 Tor 的部署配置。 |
| [backend/scripts/ci-smoke.mjs](backend/scripts/ci-smoke.mjs) | 隔离部署与持久化冒烟检查。 |
| [js/services/practiceCloud.js](js/services/practiceCloud.js) | 本分支的前端账号、记录合并与冲突处理。 |
| [js/](js/) / [js/bundles/](js/bundles/) | 前端源码与运行时 bundle。 |
| [assets/generated/](assets/generated/) | 阅读题库、解析、共享练习页面及可选本地扩展资产。 |
| [developer/tests/](developer/tests/) | 前后端相关回归、浏览器流程及 CI 辅助脚本。后端 API 测试位于 [backend/test/](backend/test/)。 |

修改前端源码后生成并检查 bundle，再构建部署镜像；不要手工编辑生成的 bundle：

```bash
node scripts/build-bundles.mjs
node scripts/build-bundles.mjs --check
```

[developer/release.sh](developer/release.sh) 和 [developer/release.ps1](developer/release.ps1) 生成的是静态运行 ZIP，不包含后端服务与数据库。`INCLUDE_LOCAL_LISTENING=1` 只控制该静态打包流程。本产品的部署入口是源码中的 Docker Compose 或直接运行 `backend/`，不是静态 ZIP。

### 验证与贡献

具体环境和命令见 [贡献指南](CONTRIBUTING.md#按改动类型验证) 与 [Multi-device CI 说明](developer/tests/ci/MULTI_DEVICE_CI.md)。当前 CI 对目标为 `product/multi-device` 的 PR 执行：

| 检查 | 内容 |
| --- | --- |
| `md-quality` | Bundle 一致性、JavaScript/IndexedDB、Python 与阅读数据完整性。 |
| `md-backend` | 内存存储下的认证、会话、记录 API、并发保护与静态资源测试。 |
| `md-e2e` | 阅读、听力、套题、导入导出及 `file://` 的统一浏览器回归。 |
| `md-deploy-smoke` | 真实 PostgreSQL、迁移、重启持久化和浏览器登录与多设备记录流程。 |
| `md-ci` | 汇总检查，要求以上四项全部成功。 |

单独运行内存后端测试不能证明数据库持久化正确。草稿及纯文档 PR 也会运行完整 CI；纯文档修改的本地验证以链接、命令、配置一致性及 `git diff --check` 为主。

本分支贡献以最新 `product/multi-device` 为基线并向该分支提交 PR；与部署无关的通用前端贡献按 `opensource` 的贡献指南处理。提交信息、PR 标题、正文和评审回复使用英文。

## 常见问题

### 手机或另一台电脑打不开页面

确认访问的是服务器的局域网地址，而非手机自己的 `127.0.0.1`。检查 `APP_BIND_ADDRESS`、`APP_PORT`、容器状态、防火墙和网络连通性。修改 `.env` 后重新执行 Compose 启动命令，让服务配置生效。

### 没有账号面板，或登录后立即失效

本分支的账号面板只在后端返回的网页中启用。确认没有打开 `file://`、普通静态服务器或其他版本的网页。经反向代理访问时，检查网页与 `/api/` 是否来自同一部署，以及 HTTPS、`COOKIE_SECURE` 和可信代理配置是否匹配；也需允许站点 Cookie。

### 无法注册新账号

默认 `REGISTRATION_MODE=first-user` 只接受第一次注册。已有账号时请登录；`disabled` 会拒绝注册。密码还需满足长度、大小写、数字与 UTF-8 字节上限。当前产品没有管理员界面或自助密码重置流程。

### 本地已有记录，另一台设备仍看不到

在设置页确认两端使用同一部署与账号，已完成本地记录合并，并且显示同步成功。保持主页面打开，检查是否离线、会话失效或存在冲突。未完成同步前，不要清除仍持有记录的设备数据。

### 清除本地数据后记录又出现

服务端记录仍然存在，连接账号后会重新下载。跨设备删除应在练习记录页操作；清除浏览器数据用于重置本地环境。

### 练习页打不开、听力没有音频或回顾缺失

允许弹窗并保持主页面打开，检查题目页面、bundle 与音频是否可访问。默认部署没有完整自备听力题库，根目录的 `ReadingPractice/` 和 `ListeningPractice/` 也不是后端自动公开的路径。同步完整记录不会同时复制题库文件；回顾仍需要相应题目资源。

### 更新后看不到原来的服务端记录

先确认访问地址、账号、数据库连接和 Compose 项目是否与原部署一致。目录或项目名改变可能让 Compose 使用新的空数据卷；应找回原卷或从备份恢复。浏览器地址变化也会形成独立的本地数据，不应立即当作数据库记录已丢失。

### 应用无法启动或健康检查失败

查看 `app` 与 `postgres` 日志，核对数据库密码、数据库可用性、迁移结果和会话密钥。Docker 生产模式要求 `SESSION_SECRET` 至少 32 个字符且不是示例值。`/api/health` 只验证应用响应，仍需通过实际登录与记录操作确认数据库正常。

## 许可证与内容版权

代码使用 GNU GPL v3，具体授权条款见 [LICENSE](LICENSE)。题源、文章、音频、PDF、图片和解析材料可能来自第三方或原始考试资料，版权归原权利人所有；代码许可证不授予这些内容的商业使用权或公开传播权。
