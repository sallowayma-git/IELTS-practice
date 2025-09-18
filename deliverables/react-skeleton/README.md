# React + Vite Skeleton（My Melody IELTS 组件化骨架）

此项目提供一个最小可运行的 React + Vite + TypeScript 组件化骨架，对应原系统的主要视图（总览/浏览/记录/设置）与基础样式（含玻璃质感示例）。

## 使用

```bash
cd prototype/react-skeleton
npm install
npm run dev
```

打开终端输出的本地地址预览应用。

提示：要从站点中直接“打开题目 HTML/PDF”，请用静态服务器在项目根目录启动服务（确保题目文件也被同源服务）：

```
# 在项目根目录（包含 deliverables/ 和 ListeningPractice/ 等）
npx http-server . -p 8080
# 或任意静态服务器（python -m http.server 8080 等）

# 然后访问：
http://localhost:8080/deliverables/react-skeleton/index.html
```

这样 `open HTML/PDF` 将以相对路径访问根目录中的题目文件。

## 结构

- `src/App.tsx` 顶层布局与路由式视图切换（本地 state）
- `src/components/` 基础组件集合
  - `Header`、`Nav`、`CategoryGrid`、`ExamCard`、`HistoryList`、`ThemeSwitcher`
- `src/styles/glass.css` 玻璃风格示例（可扩展为全局主题）

## 下一步建议

- 将现有题库/记录接口抽象为 hooks（如 `useLibrary`, `useRecords`），对接 `localStorage` 或服务端。
- 引入虚拟滚动库：`react-window` 渲染练习历史/题目列表。
- 使用 CSS 变量按主题切换（Bloom/Melody），将原有变量迁移到 `:root` 并配套暗色方案。
- 分析并迁移 `postMessage` 通信：封装消息常量与 handler。
