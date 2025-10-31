# 📘 开发任务文档：轻量级本地背单词模块（Leitner + Ebbinghaus）

## 一、目标与定位

* **定位**：离线运行、本地存储、零依赖的词汇记忆系统
* **核心机制**：

  * 莱特纳分箱（Leitner Box）管理记忆阶段
  * 艾宾浩斯遗忘曲线调度复习时间
* **集成方式**：作为“更多”页的可选轻量模块加载，不影响主 IELTS 流程
* **依赖约束**：

  * 不引入第三方包
  * 不创建新的全局事件或根路由
  * 与现有 `DataIntegrityManager`、`StorageHelper` 完全兼容

---

## 二、文件结构与放置规范

以下目录遵循你仓库现有组织方式（`js/core/`, `js/components/`, `assets/`, `data/` 等）。

```
IELTS-practice/
├── assets/
│   ├── wordlists/                   # ✅ 预置词表目录
│   │   ├── cet4.json
│   │   ├── ielts_core.json
│   │   └── user_imports/            # 用户导入的词表
│   └── icons/                       # 复用现有图标
│
├── js/
│   ├── utils/
│   │   └── vocabDataIO.js           # 文件导入/导出、JSON 校验
│   ├── core/
│   │   ├── vocabStore.js            # 词汇状态存储与加载
│   │   └── vocabScheduler.js        # 算法层（分箱+曲线）
│   └── components/
│       ├── vocabSessionView.js      # UI 交互（学习、复习）
│       └── vocabDashboardCards.js   # 概览统计卡片（可选）
│
├── index.html
│   └── <section id="vocab-view" data-view="vocab" hidden></section>
│
└── js/main.js                       # 在更多页入口注册事件分发
```

> ⚠️ 加载顺序：
> Utils → Core → Components，与当前 `index.html` 的 `script` 加载顺序一致。

---

## 三、数据结构定义

### 1️⃣ 词表 JSON 结构（位于 `assets/wordlists/`）

```json
[
  {
    "word": "ecology",
    "meaning": "生态",
    "example": "The ecology of the rainforest is complex.",
    "freq": 0.7
  },
  {
    "word": "elaborate",
    "meaning": "详尽说明",
    "example": "",
    "freq": 0.3
  }
]
```

* `word`：英文单词
* `meaning`：释义（可多义）
* `example`：例句，可为空
* `freq`：词频或难度（0–1，选填）

> 参考：`feat(ui): add vocabulary mini-game` 提交中已有词表 JSON 结构，保持字段一致性。

> 📚 **默认词库来源**：`assets/wordlists/ielts_core.json` 已通过联网拉取 `sxwang1991/ielts-word-list` 项目中的 `word-list.yaml` 并转换而来，共 3610 个词条，涵盖词性、释义与中文注解，后续如需更新请复用转换脚本。

---

### 2️⃣ 本地存储 Schema

| 键名                   | 类型            | 示例值                                                   | 说明       |
| -------------------- | ------------- | ----------------------------------------------------- | -------- |
| `vocab_words`        | Array<Object> | 详见下表                                                  | 全部学习状态记录 |
| `vocab_user_config`  | Object        | `{ dailyNew: 20, reviewLimit: 100, masteryCount: 4 }` | 学习偏好     |
| `vocab_review_queue` | Array<string> | `["word_id_12", "word_id_24"]`                        | 待复习队列快照  |

#### `vocab_words` 每项结构：

```json
{
  "id": "uuid-123",
  "word": "ecology",
  "meaning": "生态",
  "example": "The ecology of the rainforest is complex.",
  "box": 2,
  "correctCount": 3,
  "lastReviewed": "2025-10-21T09:30:00Z",
  "nextReview": "2025-10-25T09:30:00Z"
}
```

---

## 四、模块 API 规范

### 📦 `vocabDataIO.js`

> 负责文件导入、导出、JSON 校验，与现有异步导出机制对接。

| 方法名                    | 参数   | 返回              | 描述                       |
| ---------------------- | ---- | --------------- | ------------------------ |
| `importWordList(file)` | File | Promise<Word[]> | 读取 `.json`/`.csv` 文件并格式化 |
| `exportProgress()`     | –    | Blob            | 导出学习进度 JSON              |
| `validateSchema(data)` | any  | Boolean         | 校验词表格式                   |

---

### 🧠 `vocabStore.js`

> 封装 localStorage 接口，统一键空间（`vocab_*`）。

| 方法名                                       | 描述 |
| ----------------------------------------- | -- |
| `init()` → 初始化默认配置与词库状态                   |    |
| `getWords()` / `setWords(list)` → 读写词汇对象  |    |
| `updateWord(id, patch)` → 局部更新（如 box+1）   |    |
| `getConfig()` / `setConfig(cfg)` → 读写用户偏好 |    |
| `getDueWords()` → 按 `nextReview` < 当前时间过滤 |    |

---

### ⏰ `vocabScheduler.js`

> 算法模块（纯函数，不依赖 DOM）。

| 函数                                   | 输入         | 输出    | 描述           |
| ------------------------------------ | ---------- | ----- | ------------ |
| `calculateNextReview(box, lastTime)` | int, Date  | Date  | 基于艾宾浩斯曲线生成间隔 |
| `promote(word)` / `demote(word)`     | Word       | Word  | 提升/降级分箱      |
| `pickDailyTask(allWords, limit)`     | Array, int | Array | 自动筛选今日任务     |

---

### 🪄 `vocabSessionView.js`

> 控制 UI 流程（学习/复习会话），挂载在 `<section data-view="vocab">` 内。

| 方法                                     | 描述 |
| -------------------------------------- | -- |
| `mount(containerSelector)` → 渲染主界面     |    |
| `startSession(mode)` → 初始化新词 or 复习模式   |    |
| `renderCard(word)` → 显示单词卡片（含按钮与输入框）   |    |
| `handleAnswer(isCorrect)` → 更新状态、触发下一词 |    |
| `showStats()` → 任务完成后展示概览              |    |

---

### 📊 `vocabDashboardCards.js`（可选）

* 复用 `.category-card` UI 样式
* 展示学习量、掌握率、下次复习预测图

---

## 五、UI 与交互规范

### 页面入口

* “更多”页按钮需添加：

  ```html
  <button class="category-card" data-more-action="open-vocab">
    <span>背单词模式</span>
  </button>
  ```
* 在 `js/main.js` 中的事件委托加：

  ```js
  if (action === 'open-vocab') navigateToView('vocab');
  ```

### 视图容器

```html
<section id="vocab-view" data-view="vocab" hidden></section>
```

自动由 `VocabUI.mount('#vocab-view')` 渲染以下区块：

* 顶部：今日任务进度条
* 主区：单词卡片（点击“认识 / 不认识”→ 填写阶段）
* 底部：统计 + 复习提示

---

## 六、算法逻辑说明

1. **分箱规则**

   ```
   正确 → box+1 （最多5）
   错误 → box=1
   ```

2. **艾宾浩斯时间间隔（单位：小时）**

   | box | 间隔（小时） |
   | --- | ------ |
   | 1   | 6      |
   | 2   | 24     |
   | 3   | 72     |
   | 4   | 168    |
   | 5   | 720    |

   `nextReview = lastReviewed + interval[box]`

3. **任务生成逻辑**

   ```
   allDue = getDueWords()
   if allDue.length < reviewLimit:
       fillWithNewWords(newLimit)
   ```

---

## 七、配置与默认值

| 参数             | 默认值    | 说明           |
| -------------- | ------ | ------------ |
| `dailyNew`     | 20     | 每日新词上限       |
| `reviewLimit`  | 100    | 每日复习上限       |
| `masteryCount` | 4      | 连续正确次数达此视为掌握 |
| `theme`        | `auto` | 继承系统主题       |
| `notify`       | true   | 启动时检查过期任务    |

---

## 八、开发任务拆解（推荐执行顺序）

| 阶段 | 模块        | 内容                                 |
| -- | --------- | ---------------------------------- |
| 1  | 接线与 UI 框架 | 在“更多”页注册入口、创建 `<section>` 容器       |
| 2  | 数据与算法     | 实现 `vocabStore` 与 `vocabScheduler` |
| 3  | 基础交互      | 实现 `vocabSessionView` 单词卡逻辑        |
| 4  | 统计与可视化    | 实现本地图表与掌握率计算                       |
| 5  | 导入导出      | 接入 `vocabDataIO` 文件读取功能            |
| 6  | E2E 测试    | 为入口按钮注册 `interactionTargets` 覆盖    |

---

## 九、扩展规划（后续迭代）

| 版本   | 新特性                |
| ---- | ------------------ |
| v1.1 | 自定义助记卡片、本地主题切换     |
| v1.2 | 发音/听写模式、PDF 学习报告导出 |
| v1.3 | 记忆风险预测曲线 + 本地图表导出  |

---

## 🔚 结语

此方案与当前仓库架构完全对齐，

* 不新增全局依赖
* 不改变导航逻辑
* 能直接在“更多”页挂载词汇子模块

---

## 十、现有代码基线调研

* **更多页入口现状**：`index.html` 中 `#more-view` 仍使用 `data-action="open-vocab"` 的占位按钮，只显示“预告”文案，`js/main.js` 的 `handleVocabEntry` 直接弹出提示，尚未注册真实视图切换流程。【F:index.html†L190-L214】【F:js/main.js†L4705-L4715】
* **导航体系**：主入口依赖 `window.app.navigateToView` 切换 `data-view` 容器，更多页交互在 `setupMoreViewInteractions` 内集中绑定，新增视图需沿用该入口并为旧版（无 app 实例）提供降级路径。【F:js/main.js†L4620-L4715】【F:js/main.js†L232-L240】
* **数据层**：`js/data/index.js` 使用 `ExamData.MetaRepository` 预注册键集合，目前未包含 `vocab_*` 键；`SimpleStorageWrapper` 仅暴露练习/设置/备份/Meta 常规键，需要扩展或新建仓库访问层来读写词汇状态。【F:js/data/index.js†L17-L115】【F:js/utils/simpleStorageWrapper.js†L1-L84】
* **现有词汇功能**：迷你游戏 `Vocab Spark` 已加载 `assets/data/vocabulary.json` 并在 `js/main.js` 内维护状态，需要确保新模块不会复用或污染该状态，必要时提供工具函数共享词表处理逻辑。【F:js/main.js†L3920-L4398】
* **工具链兼容**：`DataIntegrityManager`、`StorageProviderRegistry`、`SimpleStorageWrapper` 通过注册表异步注入，所有新存储逻辑必须在 `registerStorageProviders` 回调或已有实例可用时初始化，避免轮询或直接触达 `localStorage`。【F:js/core/storageProviderRegistry.js†L1-L80】【F:js/components/DataIntegrityManager.js†L6-L220】

---

## 十一、细化执行任务拆分

### 阶段1｜入口与视图框架

1. **更新更多页按钮** ✅
   - 调整 `index.html` 的词汇卡片文案与 CTA，改为“进入”并描述实际功能。✅ 已完成
   - 在 `#more-view` 下方追加 `<section id="vocab-view" data-view="vocab" hidden></section>` 与必要的骨架容器（如空 div，供组件挂载）。✅ 已完成
2. **脚本加载顺序** ✅
   - 在 `index.html` 脚本列表中，按 “Utils → Core → Components” 插入 `js/utils/vocabDataIO.js`、`js/core/vocabStore.js`、`js/core/vocabScheduler.js`、`js/components/vocabSessionView.js`、`js/components/vocabDashboardCards.js`。✅ 已完成
3. **导航绑定** ✅
   - 修改 `js/main.js`：
     - 将 `handleVocabEntry` 替换为调用 `navigateToView('vocab')` 并触发 `VocabSessionView.mount`。✅ 已完成
     - 在 `setupMoreViewInteractions` 中保留兼容逻辑，确保旧浏览器无 `app.navigateToView` 时也能手动切换 `data-view` 显隐。✅ 已完成
   - 若全局需要，注册 `window.vocabModule` 暴露基础 API（加载状态、刷新任务）。✅ 已完成

### 阶段2｜数据持久化与仓库接入

1. **MetaRepository 扩展** ✅
   - 在 `js/data/index.js` 注册 `vocab_words`、`vocab_user_config`、`vocab_review_queue` 键，指定默认值、校验函数与必要的迁移钩子。✅ 已完成
   - 将该键列表纳入 `runConsistencyChecks` 与自动备份白名单（需与 `DataIntegrityManager` 对齐，检查其 `getCriticalDataKeys` 是否需要补充）。✅ 已完成
2. **VocabStore 实现** ✅
   - 创建 `js/core/vocabStore.js`：
     - 订阅 `StorageProviderRegistry.onProvidersReady`，优先使用仓库；若回调之前被调用，检测 `window.simpleStorageWrapper`。✅ 已完成
     - 提供 `init()`, `getWords()`, `setWords()`, `updateWord()`, `getConfig()`, `setConfig()`, `getReviewQueue()`, `setReviewQueue()`，以及便捷方法 `getDueWords(now)`、`getNewWords(limit)`。✅ 已完成
     - 所有读写需捕获异常并记录 `console.warn`，防止阻塞应用。✅ 已完成
3. **数据导入导出工具** ✅
   - 在 `js/utils/vocabDataIO.js` 实现 `importWordList`, `exportProgress`, `validateSchema`：
     - 解析 JSON/CSV（CSV 可复用 `FileReader` + 简单 split），校验字段并生成 `{ word, meaning, example, freq }`。✅ 已完成
     - `exportProgress` 需序列化 `VocabStore` 的当前状态，附带导出时间戳与版本号。✅ 已完成
   - 与 `asyncExportHandler` 对齐，返回 `Blob` 供现有下载流程调用。⏳ 待与导出流程串联

### 阶段3｜调度算法与任务生成

1. **调度模块** ✅
   - `js/core/vocabScheduler.js`：
     - 定义常量 `REVIEW_INTERVAL_HOURS`，实现 `calculateNextReview`、`promoteWord`, `resetWordBox`, `scheduleAfterResult`（综合更新 `box`, `correctCount`, `lastReviewed`, `nextReview`）。✅ 已完成
     - `pickDailyTask` 根据 `reviewLimit` 先选逾期词，再补充新词，保证不重复。✅ 已完成
2. **Store 集成** ✅
   - 在 `VocabStore.init()` 中加载默认词表（若 `vocab_words` 为空），使用 `vocabDataIO.validateSchema` 校验内置 JSON（`assets/wordlists/ielts_core.json`）。✅ 校验逻辑已接入
   - 生成词条唯一 ID（建议 `crypto.randomUUID()` 或手工 fallback）。✅ 已完成

### 阶段4｜UI 会话流

1. **组件框架** ⏳
   - `js/components/vocabSessionView.js`：
     - 提供 `mount`, `startSession(mode)`, `renderCard`, `handleAnswer`, `showStats`, `refreshDashboard`。⏳ 当前仅实现 `mount/refreshDashboard`，其余待补充
     - UI 结构可参考 `js/components/practiceDashboard.js` 的 DOM 构造方式，保持无框架实现。⏳ 待完成
   - 处理键盘交互（Enter 提交、空格翻面）、按钮状态与无词汇时的空态提示。⏳ 未开始
   - ✅ 已完成：会话视图骨架与仪表盘占位刷新

#### 2025-03-XX｜交互界面建设需求拆分

- [x] 页面骨架（示意） ✅ 已上线

  ```html
  <section id="vocab-view" data-view="vocab">
    [TopBar]
    [ContentArea]
      ├─ [DueBanner]（有到期复习时提示）
      ├─ [SessionCard]（单词卡）
      └─ [SideInfoPanel]（可折叠：例句/词源/标签）
    [BottomBar]
  </section>
  ```

- [x] TopBar（顶部工具栏） ✅ 完成
  - [x] 左：返回“更多” / 标题「背单词」
  - [x] 中：今日进度（进度条 + “新词/复习/正确率”）
  - [x] 右：溢出菜单（导入/导出、设置）

- [x] ContentArea（主区域） ✅ 基础交互可用
  - [x] DueBanner：当有过期复习，显示“你有 X 个待复习，建议先复习”
  - [x] SessionCard（核心卡片） ✅ 主流程上线
    - [x] 状态 1：认识判断（仅新词首次）
      - [x] 大字词头 + 小字释义可折叠（默认隐藏，一键“看释义”）
      - [x] 行为：认识 / 不认识
    - [x] 状态 2：主动回忆（选择题切换待后续迭代）
      - [x] 题型：默认“拼写/填空”，选择题切换待规划
      - [x] 输入框 + 辅助键（显示释义、听例句（预留）、跳过）
      - [x] 回答后：即时反馈 + 正确拼写高亮 + 小动画
- [x] SideInfoPanel（右侧/下方折叠）
  - [x] 释义/例句面板与当前词条实时同步，缺失例句时展示离线占位文案
    - [x] 标签、来源词表、笔记（note）

- [x] BottomBar（底部会话条） ✅ 键盘快捷键映射同步
  - [x] 左：当前第 i / n、箱级/下次复习提示
  - [x] 中：错（1） 近似（2） 对（3）（按钮 + 快捷键）
  - [x] 右：结束本轮 / 下一批（批次学习，避免一次塞太多）

- [x] 交互规范（关键点） ✅ 首轮交互验收
  - [x] 优先复习：进入视图时先弹出 DueBanner，引导“先复习，后新词”。
  - [x] 即时重测：错题立即插回当前批次末尾（不写入正式间隔），会话内记一条“短步长”（1m/10m/1d）。
  - [x] 近似正确：拼写距离 ≤1 记“近似”；不升箱，仅轻微加权。
  - [x] 批次策略：每批 20–30 个，完成后自动拉取下一批（若仍有 due）。
  - [x] 键盘：Enter=提交，1/2/3=错/近似/对，F=显示释义，Esc=返回/关闭模态（如有）。
  - [x] 移动端：输入框自带“完成”即提交；BottomBar 固定吸底，避免被软键盘遮挡。
  - [x] 可访问性：按钮最少 44px 高；aria-live 告知反馈；焦点先落输入框。

- [x] 版式与样式复用 ✅ 新样式遵循原主题变量
  - [x] 复用既有的卡片/按钮/主题类名（例如 .category-card, .btn, .badge 等），新增样式尽量以内联变量或极少量新类扩展。
  - [x] 高对比主题（仓库已有）默认兼容：文字/按钮边框基于主题 token 取值。
  - [x] 图标优先用现有 SVG；不要引新图标库。

- [x] 模块分区与组件 ✅ 各子组件 DOM 已落地
  - [x] VocabTopBar：标题、进度、菜单
  - [x] DueBanner：有/无状态切换
  - [x] SessionCard：内部状态机（认识→回忆→反馈）
  - [x] SideInfoPanel：折叠/展开（移动端置底抽屉）
  - [x] BottomBar：三键操作条（状态提示合并回主内容）
  - [ ] Toast/Alert：导入成功/校验失败等轻提示（复用已有）

- [x] 信息密度与留白 ✅ 一屏一词卡
  - [x] 一屏仅放“一个词卡”，避免双栏挤压（大屏可显示 SideInfoPanel，不强制）。
  - [x] 进度/统计做“迷你化”，详细统计统一在“统计”子视图或二级面板里看。
  - [x] 默认关闭释义，防止“看了就对”的假记忆。

#### 2025-03-XX｜界面视觉优化（二次）

- [x] 页面背景与卡片层级 ✅ 调整为浅灰渐变 + 轻阴影，留足呼吸感
- [x] 顶部任务条 ✅ 统一 12 栏网格、主操作集中右侧，软标签降饱和
- [x] 提示条（Due Banner） ✅ 改用浅米黄底 + 描边幽灵按钮，提示更克制
- [x] 主词卡 ✅ 重构为“词头+释义折叠+指引+操作”四段式，空态卡片全幅居中
- [x] 侧栏 ✅ 桌面版保持轻量面板，移动端折叠为抽屉并优化展开动画
- [x] 底部会话条 ✅ 吸底容器加阴影、三键语义色块化并支持 hover 动效，空态自动隐藏
- [x] 按钮与标签 ✅ 在 vocab 视图内重写按钮体系，主/描边/柔光三套规格
- [x] 响应式栅格 ✅ 12 栏布局下 SessionCard 占 8 栏，SidePanel 占 4 栏；平板以下改纵向
- [x] 反馈态 ✅ 采用语义色描边+柔色背景提醒，保留 aria-live 提示
- [ ] Sparklines：待引入轻量折线（保留占位）

- [ ] 数据可视与反馈
  - [x] 顶部进度条：已完成 / 今日目标
  - [ ] 小图（sparklines）：未来 7 天复习压力（仅一条轻线，不引图表库）
  - [x] 完成本批后弹“完成面板”：成功率、下次计划时间点、Top-N 高风险词（高风险词筛选待加强）

- [ ] 导航与状态保留
  - [ ] 打开 vocab 视图时，URL（如有 hash）可追加 #view=vocab（遵循现有路由习惯）。
  - [ ] 关闭/返回时保留会话快照（vocab_review_queue_snapshot），再次进入直达上次位置。
  - [ ] 刷新页面恢复：初始化时检查快照，有则复原。

- [x] 小屏（≤768px）与大屏（≥1024px）差异 ✅ 响应式样式生效
  - [x] 小屏：SideInfoPanel 变底部抽屉（手势上拉/按钮展开）；BottomBar 采用更大的触控按钮；输入框占满宽度。
  - [x] 大屏：SideInfoPanel 固定右侧栏（宽 280–320px），SessionCard 居中。

2. **Dashboard（可选）** ✅
   - 若实现 `vocabDashboardCards.js`，在 `mount` 后插入统计卡片：学习进度、待复习、掌握率。✅ 仪表盘卡片渲染已上线，待与真实任务数据联动

### 阶段5｜导入导出 & 配置

1. **设置表单** ⏳
   - 在会话视图中添加设置入口，允许修改 `dailyNew`, `reviewLimit`, `masteryCount`, `notify`，并立即写回 `VocabStore`。⏳ 规划中
   - 细分任务：
     - [ ] 设计设置弹层/抽屉 DOM 骨架
     - [ ] 将表单字段与 `VocabStore.setConfig` 绑定
     - [ ] 增加即时校验（范围提示 + 本地化文案）
2. **导入/导出入口** ⏳
   - 提供按钮触发文件选择与 `exportProgress`，下载文件命名包含日期（`vocab-progress-YYYYMMDD.json`）。⏳ 待集成 UI
   - 细分任务：
     - [ ] 导入：封装 `<input type="file">` 交互 + 错误提示
     - [ ] 导出：复用现有下载助手并验证 `Blob` 输出
     - [ ] 完成 `asyncExportHandler` 对接及 DataIntegrity 备份流程联调

### 阶段6｜测试与验证

1. **静态测试** ⏳
   - 每轮提交前运行 `python developer/tests/ci/run_static_suite.py`，确保基线 E2E 通过。⏳ 待修复现有失败用例（suiteModeFlow.test）
2. **手动验证清单** ⏳
   - 更多页入口 → 词汇视图 → 学习流程 → 复习流程。⏳ 学习流程待实现
   - 导入空文件/格式错误时弹出警告但不崩溃。⏳ UI 层需补充
   - 切换视图后返回保持进度（`VocabStore` 状态持久）。✅ 核心数据层已支持，待完成交互验证

---

## 十二、执行准备清单

- [x] 完成 `VocabStore` 与 `vocabScheduler` 的 API 骨架实现。✅
  - [ ] 编写 `scheduleAfterResult` / `updateWord` 使用范例与快照校验，补齐“单元示例”文档。
- [x] 定义默认词表文件与目录结构，确保 `assets/wordlists/` 被构建系统拾取。✅（`ielts_core.json` 已填充 3610 词条，并补齐示例句/清洗释义）
  - [x] 释义去重：移除释义中出现的词头本身（如 former、interrupt 等），保留词性标签，避免提示作弊信息。
- [x] 与 `DataIntegrityManager` 对齐备份键清单，确认新键会在自动备份中被采集。✅（已拉取 `vocab_*` 数据）
- [ ] 评估与 `Vocab Spark` mini-game 共存策略，必要时在 `VocabSessionView` 初始化时暂停/销毁迷你游戏状态。
