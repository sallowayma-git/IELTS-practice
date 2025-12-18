# Design Document

## Overview

本设计文档描述了将新的听力练习资源（100 P1 和 100 P4）集成到现有IELTS练习管理平台的技术实现方案。系统将采用模块化设计，通过扩展现有组件和新增专用模块来实现功能需求。

核心设计目标：
1. 最小化对现有代码的侵入性修改
2. 保持与现有套题模式的一致性
3. 实现单词错误收集和背诵功能的无缝集成
4. 确保数据持久化的可靠性和性能

## Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Application                        │
│                        (index.html)                          │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────┼────────────┬──────────────┬────────────────┐
    │            │            │              │                │
    ▼            ▼            ▼              ▼                ▼
┌────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐  ┌──────────────┐
│Overview│  │ Browse │  │Practice │  │   More   │  │   Settings   │
│  View  │  │  View  │  │  View   │  │   View   │  │     View     │
└────┬───┘  └───┬────┘  └────┬────┘  └────┬─────┘  └──────────────┘
     │          │             │            │
     │          │             │            │
     ▼          ▼             ▼            ▼
┌────────────────────────────────────────────────────────────┐
│              Enhanced Browse Controller                     │
│  - Frequency Filter Mode (超高频/高频/中频)                │
│  - Dynamic Button Rendering                                │
│  - P1/P4 Context Detection                                 │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│           Practice Page Enhancer (Enhanced)                 │
│  - Multi-Suite Detection                                    │
│  - Per-Suite Submission Handling                           │
│  - Spelling Error Detection                                │
│  - Message Format Standardization                          │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│              Spelling Error Collector                       │
│  - Error Detection Logic                                    │
│  - Word Extraction & Normalization                         │
│  - Vocabulary List Management                              │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│            Vocabulary Learning System                       │
│  - VocabStore (Enhanced with Multiple Lists)               │
│  - List Switcher Component                                 │
│  - Leitner + Ebbinghaus Scheduler                         │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│              Data Persistence Layer                         │
│  - IndexedDB (Primary)                                      │
│  - LocalStorage (Fallback)                                  │
│  - Data Sync & Integrity Check                             │
└────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
User Action → Overview Card Click → Browse View (Frequency Mode)
                                          ↓
                              Exam Selection → Practice Page
                                          ↓
                              Answer Submission → Enhancer
                                          ↓
                              Error Detection → Spelling Collector
                                          ↓
                              Vocabulary List → VocabStore
                                          ↓
                              User Review → Vocab Session View
```

## Components and Interfaces

### 1. Enhanced Overview View

**Purpose:** 在总览界面添加100 P1和100 P4入口卡片

**Interface:**
```javascript
// 新增卡片配置
const LISTENING_CATEGORIES = {
  'listening-p1-100': {
    id: 'listening-p1-100',
    title: '100 P1',
    type: 'listening',
    icon: '🎧',
    description: 'Part 1 听力练习 - 100题',
    path: 'ListeningPractice/100 P1',
    filterMode: 'frequency-p1',
    stats: { total: 0, completed: 0 }
  },
  'listening-p4-100': {
    id: 'listening-p4-100',
    title: '100 P4',
    type: 'listening',
    icon: '🎧',
    description: 'Part 4 听力练习 - 100题',
    path: 'ListeningPractice/100 P4',
    filterMode: 'frequency-p4',
    stats: { total: 0, completed: 0 }
  }
};
```

**Methods:**
- `renderListeningCards()`: 渲染听力练习卡片
- `handleCardClick(categoryId)`: 处理卡片点击，设置浏览模式
- `updateCardStats(categoryId, stats)`: 更新卡片统计信息



### 2. Enhanced Browse Controller

**Purpose:** 扩展题库浏览控制器以支持频率筛选模式

**Data Structure:**
```javascript
// 浏览模式配置
const BROWSE_MODES = {
  'default': {
    filters: ['all', 'reading', 'listening'],
    filterLogic: 'type-based'
  },
  'frequency-p1': {
    filters: ['ultra-high', 'high', 'medium'],
    filterLogic: 'folder-based',
    basePath: 'ListeningPractice/100 P1',
    folderMap: {
      'ultra-high': 'P1 超高频（43）',
      'high': 'P1 高频（35）',
      'medium': 'P1 中频(48)'
    }
  },
  'frequency-p4': {
    filters: ['all', 'ultra-high', 'high', 'medium'],
    filterLogic: 'folder-based',
    basePath: 'ListeningPractice/100 P4',
    folderMap: {
      'all': ['1-10', '11-20', '21-30', '31-40', '41-50', 
              '51-60', '61-70', '71-80', '81-90', '91-100'],
      'ultra-high': 'P4 超高频(51)',
      'high': 'P4 高频(52)',
      'medium': 'P4 中频(64)'
    }
  }
};
```

**Interface:**
```javascript
class BrowseController {
  constructor() {
    this.currentMode = 'default';
    this.activeFilter = 'all';
  }
  
  // 设置浏览模式
  setMode(mode) {
    this.currentMode = mode;
    this.renderFilterButtons();
    this.applyFilter(this.activeFilter);
  }
  
  // 渲染筛选按钮
  renderFilterButtons() {
    const config = BROWSE_MODES[this.currentMode];
    // 动态生成按钮UI
  }
  
  // 应用筛选
  applyFilter(filter) {
    const config = BROWSE_MODES[this.currentMode];
    if (config.filterLogic === 'folder-based') {
      this.filterByFolder(filter);
    } else {
      this.filterByType(filter);
    }
  }
}
```

### 3. Practice Page Enhancer Extensions

**Purpose:** 扩展 practice-page-enhancer.js 以支持多套题结构

**Key Enhancements:**


```javascript
// 多套题检测
detectMultiSuiteStructure() {
  // 检测页面是否包含多套题
  const suiteContainers = document.querySelectorAll('[data-suite-id], .suite-container');
  return suiteContainers.length > 1;
}

// 套题标识提取
extractSuiteId(element) {
  // 从DOM元素中提取套题ID
  return element.dataset.suiteId || 
         element.closest('[data-suite-id]')?.dataset.suiteId ||
         'set1';
}

// 增强的答案收集
collectAllAnswers() {
  const isMultiSuite = this.detectMultiSuiteStructure();
  
  if (isMultiSuite) {
    // 按套题分组收集
    const suiteAnswers = {};
    document.querySelectorAll('[data-suite-id]').forEach(suite => {
      const suiteId = suite.dataset.suiteId;
      suiteAnswers[suiteId] = this.collectSuiteAnswers(suite);
    });
    return suiteAnswers;
  } else {
    // 单套题收集（现有逻辑）
    return this.collectSingleSuiteAnswers();
  }
}

// 提交拦截增强
interceptSubmit() {
  // 拦截所有提交按钮
  document.addEventListener('click', (e) => {
    const submitBtn = e.target.closest('[data-submit-suite], .submit-btn');
    if (submitBtn) {
      e.preventDefault();
      const suiteId = submitBtn.dataset.submitSuite || 
                      this.extractSuiteId(submitBtn);
      this.handleSuiteSubmit(suiteId);
    }
  });
}

// 单套题提交处理
handleSuiteSubmit(suiteId) {
  // 收集该套题的答案
  const suiteContainer = document.querySelector(`[data-suite-id="${suiteId}"]`);
  const answers = this.collectSuiteAnswers(suiteContainer);
  const correctAnswers = this.extractSuiteCorrectAnswers(suiteId);
  
  // 生成答案比较
  const comparison = this.generateAnswerComparison(answers, correctAnswers);
  
  // 检测拼写错误
  const spellingErrors = this.detectSpellingErrors(comparison, suiteId);
  
  // 发送消息
  this.sendMessage('PRACTICE_COMPLETE', {
    examId: `${this.examId}_${suiteId}`,
    suiteId: suiteId,
    answers: answers,
    correctAnswers: correctAnswers,
    answerComparison: comparison,
    spellingErrors: spellingErrors,
    scoreInfo: this.calculateScore(comparison)
  });
}
```

### 4. Spelling Error Collector

**Purpose:** 新建组件用于检测和收集单词拼写错误

**Data Structure:**
```javascript
// 拼写错误记录
interface SpellingError {
  word: string;              // 正确单词
  userInput: string;         // 用户输入
  questionId: string;        // 题目ID
  suiteId: string;          // 套题ID
  examId: string;           // 考试ID
  timestamp: number;        // 错误时间
  errorCount: number;       // 错误次数
  source: 'p1' | 'p4';     // 来源
}

// 词表结构
interface VocabularyList {
  id: string;               // 词表ID
  name: string;             // 词表名称
  source: string;           // 来源标识
  words: SpellingError[];   // 单词列表
  createdAt: number;
  updatedAt: number;
}
```

**Interface:**
```javascript
class SpellingErrorCollector {
  constructor() {
    this.errorCache = new Map();
  }
  
  // 检测拼写错误
  detectErrors(answerComparison, suiteId, examId) {
    const errors = [];
    
    for (const [qId, comparison] of Object.entries(answerComparison)) {
      if (!comparison.isCorrect && this.isSpellingError(comparison)) {
        errors.push({
          word: comparison.correctAnswer,
          userInput: comparison.userAnswer,
          questionId: qId,
          suiteId: suiteId,
          examId: examId,
          timestamp: Date.now(),
          errorCount: 1,
          source: this.detectSource(examId)
        });
      }
    }
    
    return errors;
  }
  
  // 判断是否为拼写错误
  isSpellingError(comparison) {
    const { userAnswer, correctAnswer } = comparison;
    
    // 过滤非单词类型
    if (!this.isWord(correctAnswer)) return false;
    
    // 检查是否为拼写相似
    return this.isSimilarSpelling(userAnswer, correctAnswer);
  }
  
  // 判断是否为单词
  isWord(text) {
    // 排除数字、短语、特殊符号
    if (!text || typeof text !== 'string') return false;
    if (/^\d+$/.test(text)) return false;
    if (text.includes(' ') && text.split(' ').length > 2) return false;
    return /^[a-zA-Z\s-]+$/.test(text);
  }
  
  // 检查拼写相似度
  isSimilarSpelling(input, correct) {
    if (!input || !correct) return false;
    
    const normalize = (s) => s.toLowerCase().trim();
    const inputNorm = normalize(input);
    const correctNorm = normalize(correct);
    
    // 完全相同（仅大小写不同）
    if (inputNorm === correctNorm) return true;
    
    // 编辑距离检查
    const distance = this.levenshteinDistance(inputNorm, correctNorm);
    const maxLen = Math.max(inputNorm.length, correctNorm.length);
    
    // 相似度阈值：80%
    return (distance / maxLen) <= 0.2;
  }
  
  // 计算编辑距离
  levenshteinDistance(a, b) {
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
  
  // 保存错误到词表
  async saveErrors(errors) {
    if (!errors || errors.length === 0) return;
    
    const source = errors[0].source;
    const listId = `spelling-errors-${source}`;
    
    // 加载现有词表
    let vocabList = await this.loadVocabList(listId);
    
    if (!vocabList) {
      vocabList = {
        id: listId,
        name: `${source.toUpperCase()} 拼写错误词表`,
        source: source,
        words: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
    
    // 合并新错误
    errors.forEach(error => {
      const existing = vocabList.words.find(w => 
        w.word.toLowerCase() === error.word.toLowerCase()
      );
      
      if (existing) {
        existing.errorCount++;
        existing.timestamp = Date.now();
        existing.userInput = error.userInput; // 更新最新错误
      } else {
        vocabList.words.push(error);
      }
    });
    
    vocabList.updatedAt = Date.now();
    
    // 保存到存储
    await this.saveVocabList(vocabList);
    
    // 同步到综合词表
    await this.syncToMasterList(errors);
  }
}
```


### 5. Vocabulary Learning System Enhancement

**Purpose:** 扩展现有单词背诵系统以支持多词表切换

**Data Structure:**
```javascript
// 词表元数据
const VOCAB_LISTS = {
  'spelling-errors-p1': {
    id: 'spelling-errors-p1',
    name: 'P1 拼写错误',
    icon: '📝',
    source: 'p1',
    storageKey: 'vocab_list_p1_errors'
  },
  'spelling-errors-p4': {
    id: 'spelling-errors-p4',
    name: 'P4 拼写错误',
    icon: '📝',
    source: 'p4',
    storageKey: 'vocab_list_p4_errors'
  },
  'spelling-errors-master': {
    id: 'spelling-errors-master',
    name: '综合错误词表',
    icon: '📚',
    source: 'all',
    storageKey: 'vocab_list_master_errors'
  },
  'custom': {
    id: 'custom',
    name: '自定义词表',
    icon: '✏️',
    source: 'user',
    storageKey: 'vocab_list_custom'
  }
};
```

**Interface:**
```javascript
class VocabListSwitcher {
  constructor(vocabStore) {
    this.vocabStore = vocabStore;
    this.currentListId = 'spelling-errors-master';
  }
  
  // 渲染词表切换器
  render(container) {
    const switcher = document.createElement('div');
    switcher.className = 'vocab-list-switcher';
    switcher.innerHTML = `
      <button class="switcher-btn" id="vocab-list-menu-btn">
        <span class="current-list-name"></span>
        <span class="dropdown-icon">▼</span>
      </button>
      <div class="switcher-dropdown" id="vocab-list-dropdown" style="display: none;">
        ${this.renderListOptions()}
      </div>
    `;
    
    container.appendChild(switcher);
    this.attachEventListeners();
    this.updateCurrentListDisplay();
  }
  
  // 渲染词表选项
  renderListOptions() {
    return Object.values(VOCAB_LISTS).map(list => `
      <div class="list-option" data-list-id="${list.id}">
        <span class="list-icon">${list.icon}</span>
        <span class="list-name">${list.name}</span>
        <span class="list-count" data-list-id="${list.id}">0</span>
      </div>
    `).join('');
  }
  
  // 切换词表
  async switchList(listId) {
    if (!VOCAB_LISTS[listId]) {
      console.error('Invalid list ID:', listId);
      return;
    }
    
    try {
      // 加载新词表
      const list = await this.vocabStore.loadList(listId);
      
      if (!list) {
        this.showEmptyListMessage(listId);
        return;
      }
      
      // 更新当前词表
      this.currentListId = listId;
      this.vocabStore.setActiveList(list);
      
      // 保存用户偏好
      await storage.set('vocab_active_list', listId);
      
      // 刷新UI
      this.updateCurrentListDisplay();
      this.vocabStore.refreshView();
      
    } catch (error) {
      console.error('Failed to switch list:', error);
      this.showErrorMessage('词表加载失败，请重试');
    }
  }
  
  // 更新词表计数
  async updateListCounts() {
    for (const listId of Object.keys(VOCAB_LISTS)) {
      const count = await this.vocabStore.getListWordCount(listId);
      const countEl = document.querySelector(
        `.list-count[data-list-id="${listId}"]`
      );
      if (countEl) {
        countEl.textContent = count;
      }
    }
  }
}
```

### 6. Suite Practice Mixin Extensions

**Purpose:** 扩展 suitePracticeMixin.js 以支持多套题记录

**Key Methods:**
```javascript
// 处理多套题完成
async handleMultiSuitePracticeComplete(examId, suiteData) {
  // 检查是否为多套题模式
  if (!suiteData.suiteId) {
    // 单套题，使用现有逻辑
    return this.handleSuitePracticeComplete(examId, suiteData);
  }
  
  // 多套题模式
  const sessionId = this.getOrCreateMultiSuiteSession(examId);
  const session = this.multiSuiteSessionsMap.get(sessionId);
  
  // 添加套题结果
  session.suiteResults.push({
    suiteId: suiteData.suiteId,
    examId: examId,
    answers: suiteData.answers,
    correctAnswers: suiteData.correctAnswers,
    answerComparison: suiteData.answerComparison,
    scoreInfo: suiteData.scoreInfo,
    spellingErrors: suiteData.spellingErrors || [],
    timestamp: Date.now()
  });
  
  // 检查是否所有套题都已完成
  if (this.isMultiSuiteComplete(session)) {
    await this.finalizeMultiSuiteRecord(session);
  }
}

// 生成多套题聚合记录
async finalizeMultiSuiteRecord(session) {
  const aggregated = {
    id: session.id,
    examId: session.examId,
    title: this.generateMultiSuiteTitle(session),
    type: 'listening',
    multiSuite: true,
    date: new Date().toISOString(),
    startTime: session.startTime,
    endTime: Date.now(),
    duration: Math.round((Date.now() - session.startTime) / 1000),
    
    // 聚合分数
    scoreInfo: this.aggregateScores(session.suiteResults),
    
    // 聚合答案
    answers: this.aggregateAnswers(session.suiteResults),
    correctAnswers: this.aggregateCorrectAnswers(session.suiteResults),
    answerComparison: this.aggregateComparisons(session.suiteResults),
    
    // 套题详情
    suiteEntries: session.suiteResults.map(r => ({
      suiteId: r.suiteId,
      examId: r.examId,
      scoreInfo: r.scoreInfo,
      answers: r.answers,
      answerComparison: r.answerComparison,
      spellingErrors: r.spellingErrors
    })),
    
    // 拼写错误汇总
    spellingErrors: this.aggregateSpellingErrors(session.suiteResults)
  };
  
  // 保存记录
  await this.savePracticeRecord(aggregated);
  
  // 保存拼写错误到词表
  if (aggregated.spellingErrors.length > 0) {
    await window.spellingErrorCollector.saveErrors(aggregated.spellingErrors);
  }
  
  // 清理会话
  this.multiSuiteSessionsMap.delete(session.id);
}
```

## Data Models

### Exam Index Entry (Extended)
```javascript
{
  id: string,
  title: string,
  type: 'reading' | 'listening',
  category: 'P1' | 'P2' | 'P3' | 'P4',
  frequency?: 'ultra-high' | 'high' | 'medium',  // 新增
  path: string,
  multiSuite?: boolean,  // 新增：标识是否为多套题
  suiteCount?: number,   // 新增：套题数量
  metadata: {
    difficulty?: string,
    tags?: string[],
    estimatedTime?: number
  }
}
```

### Practice Record (Extended)
```javascript
{
  id: string,
  examId: string,
  title: string,
  type: 'reading' | 'listening',
  multiSuite?: boolean,  // 新增
  suiteEntries?: Array<{  // 新增：套题详情
    suiteId: string,
    examId: string,
    scoreInfo: ScoreInfo,
    answers: Record<string, any>,
    answerComparison: Record<string, AnswerComparison>,
    spellingErrors: SpellingError[]
  }>,
  date: string,
  startTime: number,
  endTime: number,
  duration: number,
  scoreInfo: ScoreInfo,
  answers: Record<string, any>,
  correctAnswers: Record<string, any>,
  answerComparison: Record<string, AnswerComparison>,
  spellingErrors?: SpellingError[],  // 新增
  metadata: {
    source: string,
    frequency?: string
  }
}
```

### Spelling Error
```javascript
{
  word: string,
  userInput: string,
  questionId: string,
  suiteId?: string,
  examId: string,
  timestamp: number,
  errorCount: number,
  source: 'p1' | 'p4' | 'other',
  metadata?: {
    context?: string,
    difficulty?: string
  }
}
```

### Vocabulary List
```javascript
{
  id: string,
  name: string,
  source: 'p1' | 'p4' | 'all' | 'user',
  words: SpellingError[],
  createdAt: number,
  updatedAt: number,
  stats: {
    totalWords: number,
    masteredWords: number,
    reviewingWords: number
  }
}
```

## Error Handling

### 1. 数据加载失败
- **场景**: 词表或练习记录加载失败
- **处理**: 使用降级存储（localStorage），显示用户友好的错误提示

### 2. 多套题提交冲突
- **场景**: 用户快速连续提交多套题
- **处理**: 使用提交队列，确保顺序处理

### 3. 拼写错误检测误判
- **场景**: 将非拼写错误识别为拼写错误
- **处理**: 提供用户手动移除功能，优化检测算法

### 4. 词表切换失败
- **场景**: 切换词表时数据加载失败
- **处理**: 回退到上一个词表，显示错误提示

## Testing Strategy

### Unit Tests
1. **SpellingErrorCollector**
   - 测试拼写错误检测逻辑
   - 测试编辑距离计算
   - 测试单词过滤规则

2. **VocabListSwitcher**
   - 测试词表切换逻辑
   - 测试词表计数更新
   - 测试用户偏好保存

3. **BrowseController**
   - 测试频率筛选逻辑
   - 测试按钮渲染
   - 测试模式切换

### Integration Tests
1. **多套题提交流程**
   - 测试单套题提交
   - 测试多套题聚合
   - 测试记录保存

2. **拼写错误收集流程**
   - 测试错误检测
   - 测试词表保存
   - 测试词表同步

3. **词表切换流程**
   - 测试词表加载
   - 测试UI更新
   - 测试数据持久化

### E2E Tests
1. **完整练习流程**
   - 从总览进入 → 选择题目 → 答题 → 提交 → 查看记录
   
2. **单词背诵流程**
   - 答题出错 → 错误收集 → 打开背诵 → 切换词表 → 背诵单词

3. **频率筛选流程**
   - 点击P1/P4入口 → 筛选按钮显示 → 应用筛选 → 题目列表更新

## Performance Considerations

### 1. 数据加载优化
- 使用懒加载策略，仅在需要时加载词表数据
- 缓存频繁访问的数据（如当前词表）

### 2. DOM操作优化
- 使用文档片段批量插入元素
- 避免频繁的重排和重绘

### 3. 存储优化
- 定期清理过期数据
- 压缩大型数据结构
- 使用索引加速查询

### 4. 内存管理
- 及时清理不再使用的会话数据
- 限制词表大小（如最多1000个单词）

## Migration Strategy

### Phase 1: 基础集成
1. 添加总览卡片
2. 实现频率筛选
3. 扩展 practice-page-enhancer

### Phase 2: 多套题支持
1. 实现多套题检测
2. 实现单套题提交
3. 实现记录聚合

### Phase 3: 拼写错误收集
1. 实现错误检测
2. 实现词表保存
3. 集成到背诵系统

### Phase 4: 词表切换
1. 实现切换UI
2. 实现词表加载
3. 实现用户偏好保存

### Phase 5: 优化和测试
1. 性能优化
2. 完整测试
3. 文档更新

## Security Considerations

1. **数据验证**: 所有用户输入必须经过验证和清理
2. **存储安全**: 敏感数据不应存储在本地
3. **XSS防护**: 所有动态插入的内容必须经过转义
4. **CSRF防护**: 虽然是纯前端应用，但仍需注意跨域请求安全

## Accessibility

1. **键盘导航**: 所有交互元素支持键盘操作
2. **屏幕阅读器**: 提供适当的ARIA标签
3. **对比度**: 确保文字和背景有足够的对比度
4. **焦点管理**: 合理管理焦点顺序和可见性
