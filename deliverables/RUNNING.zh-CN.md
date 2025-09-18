# 运行指南（本地与生产）

本项目在 `deliverables/react-skeleton/` 下提供了一个基于 React + Vite 的网站。由于现代前端使用 ES Modules、TypeScript 与构建工具，直接双击 `index.html`（file:// 协议）会出现空白/报错，原因如下：

- `<script type="module" src="/src/main.tsx">` 需要开发服务器进行模块解析与 TS 转换，浏览器无法直接加载 TS 源码。
- 我们还会从本地读取题库与 PDF/HTML 文件，浏览器在 file:// 下的安全策略会限制访问与路径解析。

请按以下任意方式运行：

## 方式 A：开发预览（适合调试 UI 与数据）

前提：安装 Node.js 18+。

```
cd deliverables/react-skeleton
npm install
npm run dev
```

打开终端输出的本地地址（默认 `http://localhost:5173/`）。

- 功能：页面 UI、筛选、题库/记录读取（localStorage 或导入）均可用。
- 限制：页面内的“打开 HTML/PDF”会尝试从同源根路径加载题目文件；Vite 开发服务器默认只服务 `react-skeleton/` 目录，不包含你仓库根目录的题目文件，因此会 404。

> 如需“打开 HTML/PDF”，请使用“方式 B”。

## 方式 B：一键本地静态服务器（完整功能，包括打开 HTML/PDF）

思路：在“项目根目录”启动一个静态服务器，让网站与题目文件同源可访问；然后直接访问该网站。

1) 在项目根目录（包含 `deliverables/` 与题库目录）启动静态服务：

- Node 方案（推荐）
```
npx http-server . -p 8080
```
- Python 方案
```
python -m http.server 8080
```

2) 使用浏览器打开：
```
http://localhost:8080/deliverables/react-skeleton/index.html
```

- 此时网站与题目文件在同一服务器根路径下，页面中的“打开 HTML/PDF”会以绝对路径 `/` 访问题库文件，能够正常打开。
- 若 Windows 弹出防火墙提示，请允许本地网络访问。

## 方式 C：生产构建（推荐部署）

1) 生成构建产物：
```
cd deliverables/react-skeleton
npm install
npm run build
npm run preview  # 仅查看 dist 内容，预览服务器只服务 dist 目录
```

2) 部署建议：将 `dist/` 发布到任意静态站点根路径，同时确保题库文件也位于同域根路径。页面“打开 HTML/PDF”使用根路径 `/` 寻址题库文件。

> 注意：`vite preview` 或将 dist 放到子路径时，dist 下相对的 `../../` 寻址会受限。因此生产部署请尽量使用同域根路径方案（`https://example.com/`），并将题库文件保留在同域根路径可访问位置（例如 `https://example.com/ListeningPractice/...`）。

## 常见问题（FAQ）

- 双击 `index.html` 空白？
  - 这是正常现象。请使用 A/B/C 任一方案中的“HTTP 服务器”访问（`http://...`），不要使用 `file://`。
- 打开题目 404？
  - 请确认是否采用了“方式 B”并在“项目根目录”开启静态服务器；并通过 `http://localhost:8080/deliverables/react-skeleton/index.html` 打开网站。
- 数据来源与导入
  - 页面会在首次打开时，把 `public/data/complete-exam-data.js` 与 `listening-exam-data.js` 合并写入 `localStorage: exam_index`。
  - 你也可以在“设置-数据管理”里手动“从 LocalStorage 读取”，或“导入 JSON”。

## 路径说明（题目文件）

- 我们为“打开 HTML/PDF”构建了以“网站根路径”为前缀的绝对路径：`/` + 题库路径 + 文件名。
- 因此只要你用静态服务在“项目根目录”启动（方式 B），就能直接访问题目文件。

祝使用愉快。如需“完全离线双击运行（不启服务）”的版本，我可以另外生成一个“纯静态打包版”（不含 TS），请告知我是否需要创建 `deliverables/melody-static/`。

