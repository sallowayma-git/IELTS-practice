# TOTP 二次验证说明

## 定位

TOTP 用于后端模式下的账号二次验证。它不依赖 WebAuthn 或浏览器硬件能力，因此可以同时用于 localhost、局域网、反向代理入口和 onion 访问场景。

当前策略：

- 密码仍是第一登录因子。
- 普通用户可以在账号面板中自行启用或关闭 TOTP。
- 管理员必须启用并完成 TOTP 验证后才能访问 `/admin` 和 `/api/admin`。
- 启用 TOTP 时会生成一次性恢复码，恢复码只显示一次。

## 用户流程

启用：

1. 登录应用。
2. 打开账号面板。
3. 进入 TOTP 设置。
4. 使用认证器扫描二维码或保存密钥。
5. 输入当前 6 位验证码完成绑定。
6. 保存界面显示的一次性恢复码。

登录：

1. 输入用户名和密码。
2. 如果账号已启用 TOTP，页面会进入二次验证步骤。
3. 输入认证器验证码，或使用未用过的恢复码。
4. 验证通过后 session 标记为当前用户已完成 TOTP。

关闭：

1. 登录账号并通过必要的 TOTP 验证。
2. 在账号面板中选择关闭 TOTP。
3. 输入当前密码或界面要求的确认信息。
4. 关闭后原有恢复码失效。

## 管理员流程

管理员账号由环境变量初始化：

```text
ADMIN_USERNAME
ADMIN_PASSWORD
```

Docker 模式会在容器启动时自动执行管理员初始化。本机 Node.js 模式手动执行：

```powershell
npm --prefix backend run bootstrap:admin
```

管理员访问要求：

1. 使用管理员账号登录首页。
2. 如果还没有启用 TOTP，先在账号面板完成绑定。
3. 完成 TOTP 登录验证。
4. 访问 `/admin`。

如果管理员没有启用 TOTP，`/admin` 会返回管理员 TOTP 设置要求；如果启用了但当前 session 没有完成验证，`/admin` 会返回管理员 TOTP 验证要求。

## 恢复码

- 恢复码在启用 TOTP 或重新生成时显示。
- 恢复码只显示一次，应该保存在应用外部。
- 每个恢复码只能使用一次。
- 重新生成恢复码会替换旧恢复码。
- 不应在日志、截图、issue 或文档中暴露恢复码。

## 管理员 TOTP 重置

如果管理员同时丢失认证器和恢复码：

1. 临时设置：

   ```text
   ADMIN_RESET_TOTP=true
   ```

2. 重新执行管理员初始化：

   ```powershell
   npm --prefix backend run bootstrap:admin
   ```

   Docker 模式也可以重启 `app` 容器触发初始化。

3. 用管理员账号重新登录。
4. 重新绑定 TOTP。
5. 把 `ADMIN_RESET_TOTP` 改回 `false` 或从环境中移除。

重置会删除管理员原有 TOTP 设置和恢复码，并清理相关 session，避免旧 session 继续访问管理员页面。

## 数据和安全

数据库表：

- `user_totp_settings`
- `user_totp_recovery_codes`

安全注意事项：

- 不提交真实 `backend/.env`。
- 不记录 TOTP secret、恢复码、session cookie 或完整验证码。
- `TOTP_ENCRYPTION_KEY` 如在部署中使用，应作为密钥管理，不写入公开仓库。
- 生产环境应配合强 `SESSION_SECRET`、HTTPS、`COOKIE_SECURE=true` 和合适的反向代理配置。
- 管理员密码更新、角色变化或 TOTP 重置会清理相关 session。

## 相关 API

TOTP 路由挂载在 `/api/auth/totp`：

- `GET /status`
- `POST /setup`
- `POST /verify-setup`
- `POST /login`
- `POST /recovery-codes`
- `POST /disable`

除 `GET /status` 外，写操作需要 CSRF token。普通用户启用 TOTP 时需要已登录；管理员首次登录如果尚未绑定 TOTP，会进入 forced setup 的 pending session。`/login` 使用密码登录后产生的 pending TOTP session，恢复码轮换和关闭 TOTP 需要当前用户已认证。
