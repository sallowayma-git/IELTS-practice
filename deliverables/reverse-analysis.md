# My Melody IELTS 与考试总览系统 前端逆向分析（描述文档）

本文档基于以下页面与资源进行逆向分析：

- HTML：`index.html`、`.superdesign/design_iterations/my_melody_ielts_1.html`
- 样式：`css/main.css`
- 脚本（部分）：
  - 主逻辑：`js/app.js`、`js/main.js`、`js/boot-fallbacks.js`
  - 工具/组件：`js/utils/{helpers,storage,markdownExporter,dataConsistencyManager}.js`
    `js/components/{PDFHandler,IndexValidator,CommunicationTester,PerformanceOptimizer,PracticeHistoryEnhancer,BrowseStateManager,DataIntegrityManager}.js`
  - 主题与数据：`js/theme-switcher.js`、`assets/scripts/{complete-exam-data.js,listening-exam-data.js}`

---

## HTML 结构概览（树状）

### index.html（考试总览系统）
- `html`
  - `head`
    - `title` 考试总览系统
    - `link` `css/main.css`
  - `body`
    - `input#folder-picker[webkitdirectory]`
    - `.message-container#message-container`
    - `.container`
      - `.header`
        - `h1` 标题
        - `p > a[onclick=showDeveloperTeam()]` 开发团队
      - `nav.main-nav`
        - `button.nav-btn.active` → `showView('overview')`
        - `button.nav-btn` → `showView('browse')`
        - `button.nav-btn` → `showView('practice')`
        - `button.nav-btn` → `showView('settings')`
      - `#overview-view.view.active`
        - `h2`
        - `.category-grid#category-overview`（JS 注入）
      - `#browse-view.view`
        - 标题/筛选按钮、`input.search-input`
        - `#exam-list-container` + `.loading`
    - `#practice-view.view`
      - `h2` + `.practice-stats`（四张统计卡）
      - `.practice-history`（导出/批量/清除 + `#practice-history-list`）
    - `#developer-modal.developer-modal`（开发者名单）
    - `#theme-switcher-modal.theme-modal`（主题切换：Academic/Bloom/Melody）
    - 脚本：数据→工具→组件→增强→主题→主逻辑

### my_melody_ielts_1.html（🎀 My Melody 主题）
- `head`
  - Font Awesome CDN
  - `<style>`：主题变量、动画、玻璃风格等
- `body`
  - `.particles#particles`（粒子背景）
  - `.notification#notification`
  - `.container`
    - `header.header`（emoji 云、标题、副标题）
    - `nav.nav-islands`（浮岛导航：overview/browse/practice/settings）
    - `.page#overview.active`（统计 + 快速开始 + 最近练习）
    - `.page#browse`（过滤、分类卡、列表模态、加载）
    - `.page#practice`（批量操作、记录列表、空态、详情弹窗）
    - `.page#settings`（开关、数据操作、系统信息、主题）
  - `<script>`：内联主逻辑（状态、渲染、提醒、题库加载、通信）

---

## 样式拆解（核心区域表格）

### index.html（`css/main.css`）

| 区域 | 选择器 | 布局与尺寸 | 视觉与玻璃 | 动画/过渡 | 响应式 |
| --- | --- | --- | --- | --- | --- |
| 容器 | `.container` | `max-width:1200px; margin:0 auto; padding:2rem` | - | - | 小屏缩小 padding |
| 页头 | `.header` | 居中/留白 | 背景、描边、圆角、阴影 | - | 小屏缩字距与内边距 |
| 导航 | `.main-nav .nav-btn` | Flex 居中/Wrapping | active 渐变背景；`::before` 渐变条 | 200ms 过渡、hover 阴影 | 小屏纵向、宽 100% |
| 内容区 | `.view(.active)` | 容器块、内边距 | 背景、圆角、阴影、描边 | - | 小屏缩小内边距 |
| 分类卡 | `.category-card` | Grid 卡片 | `backdrop-filter: blur(10px)` | hover 阴影/位移 | 小屏缩内边距 |
| 列表项 | `.exam-item` | Flex 两端 | `backdrop-filter: blur(10px)` | hover 轻移位 | 小屏纵向排列 |
| 统计卡 | `.stat-card` | Grid 卡片 | 玻璃 + 顶部渐变条 | hover 轻移位 | 小屏缩小 |
| 模态 | `.developer-modal` | fixed 居中 | 蒙层 `backdrop-filter: blur(4px)` | 渐显 | 小屏自适应 |

### my_melody_ielts_1.html（内联 `<style>`）

| 区域 | 选择器 | 布局与尺寸 | 视觉与玻璃 | 动画/过渡 | 响应式 |
| --- | --- | --- | --- | --- | --- |
| 根变量 | `:root` | - | 粉蓝紫薄荷等色板、阴影、渐变 | - | - |
| 背景 | `body` | `min-height:100vh` | 400% 渐变背景 | `rainbowFlow 15s` | - |
| 粒子 | `.particles/.particle` | 顶层固定 | 透明度/emoji | `float` 漂浮 | - |
| 页头 | `.header` | 圆角 30px、内边距 | `backdrop-filter: blur(15px)` + 多层 glow | 复杂光晕动效 | - |
| 导航 | `.nav-islands .island` | 浮岛 | 主题色、阴影、圆角 | hover 慢动效 | - |
| 卡片 | `.stat-card/.exam-card` | 卡片 | 主题色、阴影 | JS 鼠标跟随 3D 倾斜 | - |
| 模态 | `.modal-overlay/.modal-container` | 居中 | 半透明 + blur | 渐显 | - |
| 深色 | `body.dark-mode` | - | 变量整体切换 | 过渡 | - |

---

## 动态效果实现（代码摘录）

1) 视图切换（index fallback）

```html
<nav class="main-nav">
  <button class="nav-btn active" onclick="window.showView('overview')">📊 总览</button>
  <button class="nav-btn" onclick="window.showView('browse')">📚 题库浏览</button>
</nav>
<script>
// js/boot-fallbacks.js（简化）
window.showView = function(viewName){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(viewName+'-view')?.classList.add('active');
};
</script>
```

2) 题库加载/渲染（index）

```js
// js/main.js（节选）
function loadLibrary(){
  const cached = storage.get('exam_index');
  if (cached) { examIndex = cached; return finishLibraryLoading(); }
  const reading = (window.completeExamIndex||[]).map(e=>({...e,type:'reading'}));
  const listening = (window.listeningExamIndex||[]);
  examIndex = [...reading, ...listening];
  storage.set('exam_index', examIndex);
  finishLibraryLoading();
}
```

3) 真实题库打开与通信（melody）

```js
function openRealExam(examId){
  const exam = app.examData.find(e=>e.id===examId);
  const fullPath = buildResourcePath(exam,'html');
  fetch(fullPath,{method:'HEAD'}).then(r=>{
    if(r.ok){
      const w = window.open(fullPath,'_blank');
      const onMsg = (ev)=>{
        if(ev.data?.type==='PRACTICE_COMPLETE' || ev.data?.type==='practice_completed'){
          syncRealPracticeRecords();
          window.removeEventListener('message', onMsg);
        }
      };
      window.addEventListener('message', onMsg);
    }
  });
}
```

4) 虚拟滚动（index/组件）

```js
// js/components/PerformanceOptimizer.js（概念）
new VirtualScroller(container, items, renderItem, { itemHeight: 100, containerHeight: 650 });
```

---

## 玻璃质感实现（Glassmorphism）

```css
.glass-card {
  background: rgba(255,255,255,.15);
  border: 1px solid rgba(255,255,255,.25);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(31,38,135,.37), inset 0 1px 0 rgba(255,255,255,.2);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease;
}
.glass-card:hover { transform: translateY(-2px); box-shadow: 0 12px 48px rgba(31,38,135,.45); }
```

兼容性处理：
- 为不支持 `backdrop-filter` 的浏览器提供降级：提高不透明度（如 `rgba(255,255,255,.6)`）、减少阴影层数；必要时放弃模糊保留圆角/阴影。
- 控制 blur 半径与玻璃层数量以降低复合开销。

---

## 响应式与适配（要点）

- 布局：
  - 栅格 `repeat(auto-fit, minmax(320px, 1fr))` 自适应分栏（分类/卡片）。
  - Flex 横向排布 + Wrap（导航、操作条）。
- 断点：`max-width: 768px/480px` 缩小字体、内边距、改为单列与纵向 Nav。
- 主题：
  - `index`：`body.bloom-dark-mode` 切换暗色；按钮 `toggleBloomDarkMode()`。
  - `melody`：`body.dark-mode` 切换整套 CSS 变量（文本/背景/边框/阴影）。

---

## 性能优化（评估与建议）

- 已有措施：
  - 列表虚拟化（练习历史）。
  - 题库/记录缓存（`localStorage`）。
  - 模块化拆分与回退机制（`boot-fallbacks.js`）。
- 风险点：
  - 全屏背景渐变动画、玻璃模糊和多层阴影在低端设备代价较高。
  - 批量 `fetch(HEAD)` 校验文件建议节流/合并，并只在需要时触发。
- 建议：
  - 动效尊重 `prefers-reduced-motion`，设置中默认跟随系统；非关键区减少 blur/阴影层数。
  - 懒加载非首屏脚本（模态、导出、详情）；构建期代码分割与缓存命中。

---

## 可维护性评估（改进点）

- 模板渲染：减少字符串拼接，使用组件/模板函数或引入框架（React/Vue）。
- 存储统一：对齐 `StorageManager` 与页面内轻量 `storage` 的接口差异，抽象成单例模块。
- 事件域：收敛全局函数为模块方法/命名空间，减少冲突；统一消息通信常量枚举。
- 类型：引入 TypeScript 提升数据形态与 API 的可靠性。

---

## 优化建议（组件化与工程化）

- 组件切分（示例）：
  - 基础：`Header`、`Nav`、`Toast`、`Modal`、`ThemeSwitcher`。
  - Overview：`CategoryGrid`、`CategoryCard`。
  - Browse：`FilterBar`、`ExamList`、`ExamCard`、`ExamModal`。
  - Practice：`StatsRow`、`HistoryList`（`react-window`/`vue-virtual-scroller`）、`RecordItem`、`RecordDetailsModal`。
  - Settings：`ToggleGroup`、`BackupPanel`、`ThemePanel`。

- CSS 工具：统一 Glass 类（`.glass-card`, `.glass-modal`）、变量分层（色板/阴影/间距）、`prefers-reduced-motion` 支持。

- JS 工具：集中 `debounce`/`throttle`/`format*`/`storage` 到单一工具模块并辅以单元测试。

- 构建/流程：
  - Vite + TypeScript + ESLint/Prettier/Stylelint；代码分割与按需加载；静态资产指纹。
  - Git 流程建议：Conventional Commits + SemVer + 变更日志自动化。

---

## 附：最小玻璃/通知/切换示例

```html
<div class="glass-card">示例玻璃卡片</div>
<script>
  function showToast(msg){ const c=document.getElementById('message-container'); const d=document.createElement('div'); d.className='message info'; d.textContent=msg; c.appendChild(d); setTimeout(()=>d.remove(),3000); }
</script>
```

