# 版本 0.6.0 发布说明

## 发布信息
- **版本号**: v0.6.0
- **发布日期**: 2025-12-18
- **分支**: release → main
- **合并提交数**: 115 个

## 主要功能更新

### 🔧 修复🐛
- **练习记录页闪屏**: 修复题库加载后练习记录视图闪烁/重绘问题
- **练习记录长标题**: 修复长标题导致的溢出与布局异常问题
- **题库浏览列表间隔**: 修复题库浏览页面列表间隔异常，视觉回正

### 👀 视觉与交互
- **Bloom 主题背景**: 背景渲染升级为 WebGL 噪点渲染（更细腻、更省资源）
- **UI 重构**: 引入 HeroUI 组件库样式桥接，对按钮/卡片/表单/弹窗进行统一重设计
- **题目卡片**: 显示与信息层级优化，提升可读性
- **彩蛋**: 开发者新增「阿橙」，新增 POI 与 Nana 彩蛋🥚

### ✅ 功能🛠
- **题库索引更新**: 更新题库索引与路径映射，扩充与整理 ListeningPractice 数据
- **频次标签**: 新增频次标签，支持按频次筛选与统计
- **听力拼写错误收集**: 新增听力 P1/P4 拼写错误自动抓取，并支持导入词表
- **词表切换**: 新增词表切换功能，支持在不同词表间快速切换学习目标
- **数据管理**: 设置页数据管理新增“增量导入”选项，避免全量覆盖

## 技术改进

### 新增组件
- `css/heroui-bridge.css` - HeroUI 样式桥接层
- `js/presentation/shuiBackground.js` - Bloom WebGL 噪点背景渲染
- `js/app/spellingErrorCollector.js` - 听力拼写错误抓取与入库
- `js/app/vocabListSwitcher.js` - 词表切换器
- `js/core/dataLoadOptimizer.js` - 数据加载优化器
- `js/runtime/bootScreen.js` / `js/runtime/lazyLoader.js` - 启动屏与懒加载
- `js/services/GlobalStateService.js` / `js/services/libraryManager.js` - 全局状态与题库管理服务

### 主要修改文件
- `index.html` - 入口与视图挂载更新
- `css/main.css` - 主题与组件样式重构，修复列表/标题样式
- `js/app.js` / `js/app/main-entry.js` - 启动流程与控制器组织调整
- `js/components/practiceHistory.js` / `js/components/practiceRecordModal.js` - 练习记录体验修复与优化
- `assets/data/path-map.json` - 题库索引与路径映射更新
- `js/utils/storage.js` - file:// 环境跳过内置备份恢复，避免 Chromium fetch(file://) 直接抛错

## 数据统计
- **新增代码行数**: +86,730 行
- **修改代码行数**: -27,589 行
- **影响文件**: 115 个文件
- **题库数据**: ListeningPractice 扩充与整理（P1/P4 高频套题）

## 升级说明
此版本包含 UI 重构与题库/词表能力增强，建议升级。若已有本地数据，请先在设置页导出备份；导入新数据建议优先使用“增量导入”以避免覆盖。

## 兼容性
- 向后兼容之前版本数据
- 支持现代浏览器 (Chrome, Firefox, Safari, Edge)
- WebGL 背景在不支持 WebGL 或“减少动态效果”环境自动回退
- file:// 协议继续支持（Chromium 下内置备份恢复会安全跳过）

## 下一步计划
- 持续降低首屏启动成本与渲染抖动
- 完善词表学习策略与错题回顾链路
- 题库索引自动校验与增量更新

---

**发布团队**: Sallowaymmm 
**发布地址**: https://github.com/sallowayma-git/IELTS-practice/releases/tag/v0.6.0

