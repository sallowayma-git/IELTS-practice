# IELTS Writing Assistant E2E Test Suite

> 说明：本目录下的端到端测试完全对应《雅思AI作文评判应用完整需求文档》中的前端体验流程，供验收和回归使用。投产时若不需要，请直接移除此文件夹即可。

## 目录结构

- `package.json` – Playwright 本地依赖与 npm 脚本，仅作用于 `developer/e2e` 目录。
- `playwright.config.js` – 测试运行配置，默认指向 `http://localhost:5173`。
- `tests/` – 具体的用户流程脚本：
  - `writing-workflow.spec.js`
  - `configuration-navigation.spec.js`

## 覆盖的核心需求

| 需求模块（节选自需求文档） | 测试脚本 | 核心验证点 |
| --- | --- | --- |
| **3. 写作任务工作流**（Compose → Evaluating → Result） | `writing-workflow.spec.js` | 题目加载、字数与计时、提交评估、评分结果展示、改进建议与再次写作入口 |
| **4. AI 供应商与模型配置**（TopBar） | `configuration-navigation.spec.js` | Task 切换触发题库刷新、AI 供应商/模型联动、跳转设置页 |
| **5. 设置中心导航** | `configuration-navigation.spec.js` | 顶部快捷入口跳转 Settings 并成功渲染 |

> 若需求文档更新，请同步补充新的场景脚本或调整现有断言。

## 运行方式

1. 安装依赖（仅需在本目录运行）：

   ```bash
   cd developer/e2e
   npm install
   npm run install-deps   # 安装 Playwright 浏览器二进制
   ```

2. 启动应用（在项目根目录执行，确保 `http://localhost:5173` 可访问）：

   ```bash
   npm run dev:vue
   ```

   若需配合后端 API，可同时运行 `npm run dev:server`。测试脚本内部已对关键请求做了 mock，后端非必需。

3. 打开新的终端，在 `developer/e2e` 目录执行测试：

   ```bash
   npm run test
   ```

   - `npm run test:headed` 可在有界面模式下调试。
   - 如需连接远程服务器，可设置 `PLAYWRIGHT_BASE_URL` 环境变量覆盖默认地址。

## 移除与注意事项

- 所有测试依赖均限制在 `developer/e2e` 目录中，不会影响 Electron/Vite 正式打包。
- 删除整个文件夹即可彻底移除相关脚本、依赖与文档。
- 若后续引入 CI，请在流水线中显式进入本目录安装依赖并执行测试，避免污染主应用依赖树。
