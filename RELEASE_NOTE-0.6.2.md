# IELTS Practice v0.6.2 Release Notes

## 🏷️ 版本概览

本版本（v0.6.2）是一个重大的里程碑更新，标志着从 `opensource` 分支到主生产发布分支（`release`）的全面合并。本次更新彻底升级了前端架构、重构了高亮底层数据模型、集成了听力套卷动态导入，并引入了静态 CI 自动化验证工作流。

---

## 🛠️ 重大架构演进 (Architectural Evolution)

### 1. 前端 Bundle 化收敛 (Single-Bundle Convergence)
为了彻底解决在浏览器 `file://` 协议下零散 JavaScript 模块加载过慢、跨域沙箱限制及模块路径依赖混乱等问题，我们完成了核心阅读页面的单 Bundle 化改造：
* **编译整合**：将所有应用逻辑（`js/app/`、`js/core/` 等开发态源码）在发布时通过 `esbuild` 构建收敛编译为 `js/bundles/*.bundle.js` 统一调用。
* **冗余清理**：彻底废弃并删除了过时的单点 UI 控制脚本 [practice-page-ui.js](file:///c:/Users/lenovo/Desktop/working space/0.3.1 working/js/practice-page-ui.js)，将所有散落的 UI 交互与生命周期钩子合并入统一的页面处理器中。
* **分发包体积瘦身**：优化了分发打包排除逻辑，分发 zip 包不再打包开发环境的 `developer/`、`scripts/` 以及未引用的本地日志，生成的听力资源文件采取可选 manifest 机制进行控制。

### 2. 自动化打包与多平台发布脚本 (Release Automation)
* **跨平台发布脚本**：新增了 Windows 平台专属发布脚本 `developer/release.ps1`，与原有的 Unix 脚本 `developer/release.sh` 行为高度对齐。
* **CI 验证门控**：在自动化打包过程中引入了 zip 压缩包完整性检查与文件白名单门控，确保发布包可以直接解压并双击 `index.html` 运行。

---

## 📊 数据结构与模型重构 (Data Schema Refactoring)

### 1. 统一高亮笔记模型 (Unified Highlight Note Model)
我们重构了之前散落的、非标准的高亮存储设计，建立了以 **`hl note`** 为核心的独立数据实体：
* **数据模型设计**：
  ```typescript
  interface HighlightNote {
    id: string;          // 唯一标识符
    examId: string;      // 关联的套卷/试卷 ID
    range: {             // 字符偏移量范围
      start: number;
      end: number;
    };
    text: string;        // 被划线高亮的文本内容
    note: string;        // 关联的笔记/草稿内容
    color: string;       // 高亮颜色类别
    updatedAt: number;   // 最后修改时间戳
  }
  ```
* **缺陷修复**：解决了单次练习复习时，历史划线高亮无法正常重放（Replay）及多重高亮重叠导致 DOM 渲染崩溃的顽固 Bug。

### 2. 试卷元数据扩展与难度排序
* **属性引入**：在核心试卷 JSON 中为每套阅读题目增加了 `difficulty`（难度评分，数值型）字段。
* **UI 展现**：前台 Dashboard 支持按难度对试卷进行动态排序与过滤。废弃了原来作为兜底的原始 HTML 纯文本解析降级逻辑，使全量试卷数据具备标准化的渲染层。

---

## 🚀 新功能集 (New Features)

### 1. 统一总览仪表盘 (Overview Dashboard)
* 实现了集“试卷浏览、模式切换、历史记录追踪”于一体的总览仪表盘视图。
* 优化了做题热力图（Heatmap）的口径，将其统计逻辑从“记录提交次数”修改为**“统计实际完成套卷数”**，数据更具参考价值。

### 2. 记忆/背诵模式 (Memorize Mode)
* 为阅读界面开发了**记忆模式**，支持在同一阅读页面无缝切换。该模式下会对文章的高频词汇或段落进行智能遮挡，帮助用户进行记忆和回想。

### 3. 离线高亮词典 (Offline Review Dictionary)
* 在用户查看复习高亮时，提供离线的英汉词典即时释义查询功能，极大地提升了复习效率。

### 4. 听力套卷动态导入与 PDF 支持
* 新增了听力练习源集成，支持动态导入听力库，并在前端直接渲染关联的 PDF 资源。
* 健全了动态库导入报告和配置流程，防止因导入格式错误引发前端白屏。

---

## 🔧 缺陷修复与体验优化 (Bug Fixes & UX Polish)

* **系统级缺陷修复（核心解决的 11 个顽固 Bug）**：
  1. 解决了部分极端情况下由于页面关闭或异常退出导致的用户答题**数据丢失**问题。
  2. 优化了**答案对比准确性算法**（处理了首尾空格、大小写、标点符号归一化等细节问题）。
  3. 修复了**草稿同步失效**以及多页面切换时的草稿冲突。
  4. 修复了计时器在暂停/恢复时可能引起的有效用时计算偏大问题。
  5. 修复了单页复习时多个划线高亮重合导致节点无法渲染的问题。
* **视觉与体验优化 (Aesthetics)**：
  * 精细化了套卷 UI 玻璃材质（Glassmorphic UI）、引入了精美平滑的弹窗动画。
  * 重新设计了新手引导组件（Onboarding Tour），降低新用户的上手门槛。

---

## ⚖️ 许可、合规与启动拦截 (Compliance & Security)

* **GPL 许可协议确认机制**：
  * 引入了统一的 GPL 开源协议许可弹窗，逻辑使用 `localStorage` 中的 `acceptGplLicense` 进行状态持久化。
  * **安全门控**：在主应用初始化流程中加入阻断，只有用户同意许可后才能加载核心业务数据，确保开源项目的合规性。

---

## 🧪 验证与 CI 测试工作流 (Verification & Quality Assurance)

为保障 userspace（用户体验）零破坏，合并发布前**必须严格按顺序运行以下验证脚本**：

1. **执行静态分析与校验套件**（生成 CI 报告）：
   ```powershell
   python developer/tests/ci/run_static_suite.py
   ```
   *验证内容：核心编译状态、GPL 门控状态、包体积完整性门控。*

2. **运行 Playwright 自动化流**（回归 UI 截图及用户旅程验证）：
   ```powershell
   python developer/tests/e2e/suite_practice_flow.py
   ```
   *验证内容：从首页 Dashboard -> 选择套卷 -> 做题 -> 提交 -> 查看高亮复习的完整链路。*
