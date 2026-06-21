# 多设备便捷部署后端说明

## 定位

本分支把原本只能依赖浏览器本地存储的 IELTS Atlas，扩展为可选的个人后端部署模式。目标不是做公开 SaaS，而是方便用户把应用放在自己的电脑、NAS、私人服务器或受控网络入口上，在多台设备之间共享同一份练习记录。

静态模式仍然保留：直接打开 `index.html`、使用本地静态服务器或静态网页空间时，应用继续使用 IndexedDB/localStorage 保存数据。后端模式只在 API 可用且用户登录后接管练习记录读写。

## 使用场景

- 桌面、平板、手机或不同浏览器之间共用练习历史。
- 在私人服务器或 NAS 上统一托管前端页面和练习记录。
- 管理员为自己或小范围用户创建、维护账号。
- 通过可选 Tor hidden service 访问个人部署环境。
- 在浏览器本地存储被清理或切换设备后，减少手动导出导入次数。

## 主要能力

- `backend/` 提供 Node.js/Express 服务，同源托管首页、静态资产、API 和 `/admin`。
- PostgreSQL 保存用户、session、练习记录、TOTP 设置、恢复码和流量事件。
- 用户可用用户名和密码注册、登录、登出。
- 登录后练习记录通过 `/api/practice-records` 读写远端数据库。
- 首次登录时可以把本地 `practice_records` 导入当前账号。
- API 不可用或未登录时，前端继续使用本地存储 fallback。
- 管理员页面支持用户管理、练习记录查看、统计和基础流量分析。
- TOTP 可作为普通用户的可选二次验证；管理员访问 `/admin` 前必须启用并验证 TOTP。
- Docker Compose 可以同时启动 `postgres`、`app` 和 `tor`。

## 运行方式

### Docker Compose

在项目根目录准备环境变量：

```powershell
Copy-Item backend\.env.example backend\.env
```

至少替换以下值：

```text
POSTGRES_PASSWORD
SESSION_SECRET
ADMIN_USERNAME
ADMIN_PASSWORD
```

启动：

```powershell
docker compose --env-file backend\.env -f backend\docker-compose.yml up --build
```

访问：

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/admin
```

镜像启动时会执行：

```text
node scripts/migrate.mjs
node scripts/bootstrap-admin.mjs
node src/server.js
```

### 本机 Node.js

本机运行时需要先准备可访问的 PostgreSQL，并让 `backend/.env` 中的 `DATABASE_URL` 指向该数据库。

```powershell
npm --prefix backend install
npm --prefix backend run migrate
npm --prefix backend run bootstrap:admin
npm --prefix backend start
```

默认监听：

```text
http://127.0.0.1:3000/
```

## 环境变量

核心变量：

- `DATABASE_URL`：本机 Node.js 模式连接 PostgreSQL 时使用。
- `POSTGRES_PASSWORD`：Docker Compose 中 PostgreSQL 容器密码。
- `SESSION_SECRET`：session 签名密钥，生产环境必须使用长随机值。
- `PORT` / `HOST`：后端监听端口和地址。
- `COOKIE_SECURE`：HTTPS 部署时应设为 `true`。
- `TRUST_PROXY`：反向代理或 HTTPS 终止在代理层时应设为 `true`。

管理员和 TOTP：

- `ADMIN_USERNAME`：管理员用户名。
- `ADMIN_PASSWORD`：管理员密码，必须满足密码强度要求。
- `TOTP_ENABLED`：是否启用 TOTP。
- `TOTP_ISSUER`：认证器中显示的发行者名称。
- `TOTP_ENCRYPTION_KEY`：可选的 TOTP 密钥加密材料。
- `ADMIN_RESET_TOTP`：管理员丢失认证器和恢复码时临时设为 `true`，重新初始化后应恢复为 `false`。

Tor 和健康检查：

- `TOR_BRIDGES`：直接传入 obfs4 bridge。
- `TOR_BRIDGES_FILE`：容器内 bridge 文件路径。
- `TOR_BRIDGES_LOCAL_FILE`：宿主机 bridge 文件路径。
- `SITE_HEALTH_BRIDGE_WARNING_THRESHOLD`：站点健康监控的 bridge 告警阈值。

## API 面

认证：

- `GET /api/auth/me`
- `GET /api/auth/csrf`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `PATCH /api/auth/account/username`
- `PATCH /api/auth/account/password`
- `DELETE /api/auth/account`
- `GET /api/auth/totp/status`
- `POST /api/auth/totp/setup`
- `POST /api/auth/totp/verify-setup`
- `POST /api/auth/totp/login`
- `POST /api/auth/totp/recovery-codes`
- `POST /api/auth/totp/disable`

练习记录：

- `GET /api/practice-records`
- `PUT /api/practice-records`
- `POST /api/practice-records/import`
- `DELETE /api/practice-records/:id`
- `DELETE /api/practice-records`

管理员：

- `GET /api/admin/summary`
- `GET /api/admin/stats`
- `GET /api/admin/analytics`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/users/:userId/stats`
- `GET /api/admin/users/:userId/practice-records`
- `PATCH /api/admin/users/:userId`
- `DELETE /api/admin/users/:userId`
- `DELETE /api/admin/users/:userId/practice-records/:recordId`
- `GET /api/admin/traffic`

健康检查：

- `GET /api/health`

## 数据边界

远端保存：

- 用户账号和角色。
- session。
- 练习记录。
- TOTP 设置和恢复码。
- 管理员流量统计事件。

仍保留本地：

- 题库索引和题库配置。
- 主题和浏览偏好。
- 词表、部分统计派生状态和 UI 缓存。
- 未登录、API 不可用或用户未导入时的本地练习记录。

本地记录不会自动上传。首次登录导入需要用户确认，导入完成后以 `remote_import_completed:<userId>` 标记，避免重复提示。

## 安全约束

- 不提交真实 `backend/.env`。
- 生产部署必须替换 `SESSION_SECRET`、数据库密码和管理员密码。
- 管理员访问 `/admin` 必须满足管理员角色和 TOTP 验证。
- API 写操作使用 CSRF token。
- 静态文件托管会拒绝 dotfiles，并限制模板测试夹等不应暴露的路径。
- 隐私日志和诊断输出应继续脱敏，不记录完整桥接信息、session、密码、TOTP 密钥或恢复码。
- 公开传播包含题源的站点仍有版权和平台风险；后端部署只解决个人访问和多设备便利性，不改变使用声明。

## 验证

后端代码改动后至少运行：

```powershell
npm --prefix backend test
```

连接真实 PostgreSQL 的验证：

```powershell
npm --prefix backend run migrate
npm --prefix backend run smoke:postgres
```

前端 bundle 或数据层改动后还应运行：

```powershell
node scripts/build-bundles.mjs
python developer/tests/ci/run_static_suite.py
```

手动验收：

1. 启动后端并访问 `http://127.0.0.1:3000/`。
2. 注册或登录普通账号。
3. 完成一次练习，刷新后确认记录仍存在。
4. 换浏览器登录同一账号，确认能看到同一记录。
5. 用管理员账号登录、绑定 TOTP、访问 `/admin`。
6. 检查 Docker Compose 的 `postgres`、`app`、`tor` 健康状态。
