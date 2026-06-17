# PostgreSQL + 普通登录认证落地计划

## Summary

- 新增 `Node.js/Express` 后端，目录使用 `backend/`，避免现有 `.gitignore` 中被忽略的 `/server/`。
- PostgreSQL 成为练习记录的主存储；浏览器本地 IndexedDB/localStorage 仅作为未登录 fallback 和首次导入来源。
- 登录认证使用用户名 + 密码 + 服务端 session cookie；注册开放，但加入基础限流、密码强度、CSRF 和安全响应头。
- 暂不实现 FIDO2、`.onion` 配置、完整多端冲突同步；后端先服务本机普通登录和练习记录持久化。

## Key Changes

- 后端新增：
  - `backend/package.json`：依赖 `express`, `pg`, `bcryptjs`, `express-session`, `connect-pg-simple`, `helmet`, `dotenv`, `zod`。
  - `backend/.env.example`：包含 `DATABASE_URL`, `SESSION_SECRET`, `PORT=3000`, `COOKIE_SECURE=false`。
  - `backend/migrations/001_init.sql`：创建 `users`, `practice_records`, `session` 表。
  - `backend/src/app.js`：Express app，先注册 API，再静态托管项目根目录。
  - `backend/src/db.js` / `backend/src/auth.js` / `backend/src/practiceRecords.js`：拆分数据库、认证、练习记录逻辑。
- `.gitignore` 调整：
  - 忽略 `backend/.env`、`backend/node_modules/`。
  - 显式允许 `backend/package-lock.json` 进入版本控制。
- 后端静态服务：
  - `GET /` 返回现有 `index.html`。
  - 静态文件使用 `dotfiles: "deny"`，避免暴露 `.git` 等隐藏目录。
  - API 与前端同源运行在 `http://127.0.0.1:3000/`，避免 CORS 和 cookie 复杂度。

## Public API / Schema

- Auth API：
  - `GET /api/auth/me`：返回当前用户或 `401`。
  - `GET /api/auth/csrf`：返回 `{ csrfToken }`，前端写操作使用 `X-CSRF-Token`。
  - `POST /api/auth/register`：开放注册，字段 `{ username, password }`。
  - `POST /api/auth/login`：字段 `{ username, password }`。
  - `POST /api/auth/logout`：销毁 session。
- Practice API：
  - `GET /api/practice-records`：返回当前用户全部练习记录数组。
  - `PUT /api/practice-records`：替换当前用户全部练习记录，用于兼容现有 `PracticeRepository.overwrite()`。
  - `POST /api/practice-records/import`：批量导入本地记录，按 `id` 和非空 `sessionId` 去重合并。
  - `DELETE /api/practice-records/:id`：删除单条记录。
  - `DELETE /api/practice-records`：清空当前用户记录。
- PostgreSQL：
  - `users`: `id uuid`, `username text`, `username_lower text unique`, `password_hash text`, timestamps。
  - `practice_records`: `user_id uuid`, `id text`, `session_id text`, `exam_id text`, `type text`, `title text`, score fields, `payload jsonb`, timestamps。
  - 主键：`(user_id, id)`。
  - 唯一索引：`(user_id, session_id)` where `session_id is not null`。
- 前端接口：
  - 新增 `RemoteApiClient`，统一处理 `fetch`, session cookie, CSRF, `401`。
  - 新增 remote-backed data source：只把 `practice_records` 路由到 API；其他现有设置、词表、题库索引继续保留本地存储。
  - 在 `js/data/index.js` 初始化时，如果 API 可用且用户已登录，使用 remote-backed data source；否则走现有本地存储。
  - 更新 bundle 构建输入并运行 `node scripts/build-bundles.mjs` 生成同步产物。

## Frontend Behavior

- 页面启动后调用 `GET /api/auth/me`：
  - 已登录：进入应用，读取 PostgreSQL 练习记录。
  - 未登录：显示登录/注册遮罩；API 数据不可用，本地数据不自动上传。
- 首次登录后：
  - 检测本地 `practice_records`。
  - 如果本地有记录且当前账号未完成导入，显示一次导入确认。
  - 用户确认后调用 `POST /api/practice-records/import`，成功后写入本地标记 `remote_import_completed:<userId>`。
- 保存练习记录：
  - 已登录时写入 PostgreSQL，并把返回/读取结果镜像到本地，保持现有 UI 兼容。
  - API 不可用或未登录时沿用当前本地存储 fallback。

## Test Plan

- 后端测试：
  - 注册成功、用户名重复、弱密码拒绝。
  - 登录成功/失败、登出后 API 返回 `401`。
  - 未登录访问练习记录 API 返回 `401`。
  - 批量导入按 `id` 和 `sessionId` 去重。
  - `PUT /api/practice-records` 替换后 `GET` 返回一致数据。
- 前端测试：
  - fake `fetch` 验证 remote-backed data source 对 `practice_records` 使用 API，对其他 key 继续本地存储。
  - `401` 时回退本地，不破坏现有启动流程。
  - 首次登录导入标记按 `userId` 隔离。
- 手动验收：
  - 启动 PostgreSQL，执行 migration。
  - `npm --prefix backend start` 后访问 `http://127.0.0.1:3000/`。
  - 注册、登录、完成一次练习、刷新页面后记录仍存在。
  - 换浏览器登录同一账号，能看到 PostgreSQL 中的练习记录。
  - 运行 `node scripts/build-bundles.mjs` 后现有静态入口仍可加载。

## Assumptions

- 后端使用 Node/Express，账号模型为开放注册，本地记录采用一次性导入。
- PostgreSQL 通过 `DATABASE_URL` 连接；实现不负责自动安装 PostgreSQL 服务。
- v1 只保护 API 数据；静态题库页面本身仍可被访问，但没有登录不能读写服务端练习记录。
- v1 不做 FIDO2、邮件验证、找回密码、管理员后台、`.onion` 服务配置。
