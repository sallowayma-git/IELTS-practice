# 词汇学习系统：SM-2 算法 + 两阶段评估

**更新时间**：2025-11-13  
**实现文件**：`js/core/vocabScheduler.js`, `js/components/vocabSessionView.js`

---

## 目录

1. [用户学习流程](#一用户学习流程)
2. [SM-2 算法原理](#二sm-2-算法原理)
3. [质量评分计算](#三质量评分计算)
4. [数据结构](#四数据结构)
5. [API 接口](#五api-接口)
6. [UI 交互](#六ui-交互)
7. [键盘快捷键](#七键盘快捷键)
8. [向后兼容](#八向后兼容)

---

## 一、用户学习流程

### 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                     1. 认识判断（Recognition）                  │
│                                                             │
│  显示：单词 + 释义（可折叠）                                      │
│  问题："你对这个单词的熟悉程度如何？"                               │
│  操作：[困难] [一般] [简单]                                      │
│                                                             │
│  用户选择 → 记录 recognitionQuality                            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     2. 拼写测试（Spelling）                     │
│                                                             │
│  显示：仅释义（不显示单词）                                        │
│  问题："根据释义，拼写出这个单词"                                   │
│  操作：输入框 + [提交] [跳过]                                    │
│                                                             │
│  错误处理：                                                    │
│  - 每次错误：难度因子 -0.15                                     │
│  - 最多 3 次机会                                              │
│  - 第 3 次错误后强制进入反馈                                     │
│                                                             │
│  最终难度因子 = 基础 EF - (0.15 × 错误次数)                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     3. 反馈（Feedback）                        │
│                                                             │
│  显示：                                                       │
│  - 结果图标（✅/🟡/❌）                                         │
│  - 正确拼写                                                   │
│  - 释义                                                      │
│  - SM-2 数据（间隔天数、难度因子、连续正确次数）                     │
│  - 质量评分分解（认识判断 + 拼写惩罚 → 最终难度因子）                │
│                                                             │
│  操作：[下一词]                                               │
└─────────────────────────────────────────────────────────────┘
```

### 设计原则

1. **两阶段评估**：
   - 认识判断：评估被动记忆（看到单词能否想起释义）
   - 拼写测试：评估主动记忆（看到释义能否拼写单词）

2. **渐进式惩罚**：
   - 不是"一错就重置"，而是根据错误次数调整难度因子
   - 保留部分学习进度，避免挫败感

3. **即时反馈**：
   - 每次拼写错误立即提示
   - 反馈页面展示完整的评分分解过程

---

## 二、为什么选择 SM-2 算法？

### 问题：旧的 Leitner 分箱算法缺陷

旧实现只是**固定间隔的分箱系统**：
```
Box 1 → 6h
Box 2 → 24h
Box 3 → 72h
Box 4 → 168h
Box 5 → 720h
```

**致命缺陷**：
1. ❌ 间隔固定，不考虑个体差异
2. ❌ 所有"正确"一视同仁，无法区分"秒答"和"勉强答对"
3. ❌ 错误直接重置为 Box 1，太粗暴
4. ❌ 不是真正的艾宾浩斯曲线（应该是指数增长，而非线性）

### 解决方案：SuperMemo SM-2 算法

SM-2 是艾宾浩斯遗忘曲线的经典实现，被 Anki、SuperMemo 等主流工具采用。

**核心优势**：
1. ✅ 间隔指数增长：`新间隔 = 旧间隔 × 难度因子`
2. ✅ 难度因子动态调整：根据回忆质量自动优化
3. ✅ 个性化学习：每个词条独立追踪难度
4. ✅ 科学验证：基于大量实验数据优化

---

## 三、SM-2 算法核心公式

### 1. 难度因子（Ease Factor）更新

```
EF' = EF + (0.1 - (5 - q) × (0.08 + (5 - q) × 0.02))

其中：
- EF：旧难度因子（1.3-2.5）
- q：质量评分（0-5）
- EF'：新难度因子（限制在 1.3-2.5）
```

**质量评分映射**：
| 评分 | 含义 | UI 按钮 |
|------|------|---------|
| 5 | 完美回忆（秒答） | 简单 |
| 4 | 正确但有犹豫 | 一般 |
| 3 | 正确但很困难 | 困难 |
| 2 | 错误但有印象 | — |
| 1 | 完全不记得 | — |
| 0 | 完全错误 | 错误 |

### 2. 间隔（Interval）计算

```
if repetitions == 0:
    interval = 1 天
elif repetitions == 1:
    interval = 6 天
else:
    interval = 上次间隔 × 难度因子
```

**示例**（假设难度因子 = 2.5）：
```
第 1 次正确：1 天后复习
第 2 次正确：6 天后复习
第 3 次正确：6 × 2.5 = 15 天后复习
第 4 次正确：15 × 2.5 = 38 天后复习
第 5 次正确：38 × 2.5 = 95 天后复习
```

### 3. 失败处理

质量评分 < 3 时：
- 重置 `repetitions = 0`
- 间隔重置为 1 天
- 难度因子降低 0.2（但不低于 1.3）

---

## 四、质量评分计算

### 1. 认识判断质量

| 用户选择 | 质量评分 | 含义 | SM-2 质量 |
|---------|---------|------|----------|
| 简单 | easy | 完全认识，秒答 | 5 |
| 一般 | good | 认识但有犹豫 | 4 |
| 困难 | hard | 勉强认识 | 3 |

### 2. 三档起始 + 12次轮内循环机制

**核心思想**：根据用户首次判断设置不同起始难度因子，然后通过轮内循环精细调节。

#### 2.1 三档起始难度因子

```javascript
const INITIAL_EASE_FACTORS = {
    easy: 2.8,    // 简单：高起始难度因子，间隔长
    good: 2.5,    // 一般：标准起始难度因子
    hard: 1.8     // 困难：低起始难度因子，间隔短，需要更多复习
};
```

**EaseFactor 含义**：
- EF 越大 = 间隔增长越快 = 单词越"容易" = 复习次数少
- EF 越小 = 间隔增长越慢 = 单词越"困难" = 复习次数多

#### 2.2 分流策略

```
用户首次判断：
├─ easy → 直接进入复习队列（不验证，不进入轮内循环）
├─ good → 进入轮内循环（最多12次）
└─ hard → 进入轮内循环（最多12次）
```

#### 2.3 轮内循环调整

**每次反馈的EF调整**：
```javascript
const INTRA_EF_ADJUSTMENTS = {
    easy: +0.15,   // 简单：提升难度因子
    good: +0.05,   // 一般：小幅提升
    hard: -0.10    // 困难：降低难度因子
};
```

**循环退出条件**：
1. 轮内任何一次选择"简单" → 进入长间隔验证（20-30个单词后）
2. 达到12次循环上限 → 强制进入复习队列
3. 表现稳定 → 提前进入复习队列

#### 2.4 Easy验证机制

```
Easy验证流程：
1. 用户首次选择"简单" → 直接进入复习队列
   - 不验证，不进入轮内循环（intraCycles = 0）
   - 理由：首次就觉得简单，说明真的掌握了
2. 轮内循环中选择"简单" → 触发验证（20-30个单词后）
   - 重置循环计数（intraCycles = 0）
   - 理由：之前选了good/hard，现在突然选easy，需要验证
3. 验证时再次选择"简单" → 正式进入复习队列
4. 验证时选择"一般"或"困难" → 重新进入轮内循环（intraCycles = 1）
```

**关键规则**：
- 首次 easy：直接进入复习队列，不验证
- 轮内 easy：触发验证（防止"虚报"简单）
- 验证失败（选 good/hard）：重新进入12次循环

### 3. 拼写惩罚机制

**方案**：直接调整难度因子，而不是降档

```javascript
// 基础难度因子（根据认识判断计算）
baseEF = VocabScheduler.calculateEaseFactor(oldEF, recognitionQuality)

// 拼写惩罚：每次错误 -0.15
spellingPenalty = 0.15 * spellingAttempts

// 最终难度因子
finalEF = Math.max(1.3, baseEF - spellingPenalty)
```

**示例**：

```javascript
// 场景 1：认识"简单"，拼写第 1 次正确
oldEF = 2.5
recognitionQuality = 'easy' (5)
baseEF = 2.5 + 0.1 = 2.6
spellingAttempts = 0
finalEF = 2.6

// 场景 2：认识"简单"，拼写第 1 次错误
oldEF = 2.5
recognitionQuality = 'easy' (5)
baseEF = 2.6
spellingAttempts = 1
finalEF = 2.6 - 0.15 = 2.45

// 场景 3：认识"困难"，拼写第 2 次错误
oldEF = 2.5
recognitionQuality = 'hard' (3)
baseEF = 2.5 - 0.14 = 2.36
spellingAttempts = 2
finalEF = 2.36 - 0.30 = 2.06

// 场景 4：认识"困难"，拼写第 3 次错误
oldEF = 2.5
recognitionQuality = 'hard' (3)
baseEF = 2.36
spellingAttempts = 3
finalEF = 2.36 - 0.45 = 1.91
```

### 4. 跳过拼写

用户可以选择跳过拼写测试，此时：
- 难度因子额外 -0.2（相当于 1 次拼写错误的惩罚）
- 反馈页面显示"已跳过拼写"

---

## 五、数据结构

### 词条对象（Word）

```javascript
{
  // 基础字段
  id: "uuid-123",
  word: "ecology",
  meaning: "生态",
  example: "The ecology of the rainforest is complex.",
  
  // SM-2 核心字段
  easeFactor: 2.5,        // 难度因子（1.3-2.5）
  interval: 1,            // 当前间隔（天）
  repetitions: 0,         // 连续正确次数
  
  // 时间戳
  lastReviewed: "2025-11-13T10:00:00Z",
  nextReview: "2025-11-14T10:00:00Z",
  
  // 向后兼容（保留但不再使用）
  box: 1,                 // 旧的 Leitner 箱号
  correctCount: 0         // 总正确次数
}
```

---

### 分箱机制（已废弃）

**问题**：引入 SM-2 后，`box` 字段已经冗余。

**原因**：
- SM-2 使用 `easeFactor` + `interval` + `repetitions` 完整描述记忆状态
- `box` 只是固定间隔的分箱，无法表达个性化难度

**结论**：
- ✅ `box` 字段已完全移除
- ✅ 专注于 SM-2 算法优化，不考虑向后兼容

---

## 六、API 接口

### `scheduleAfterResult(word, quality, referenceTime)`

根据回忆质量更新词条调度。

**参数**：
- `word` (Object)：词条对象
- `quality` (string)：质量评分 `'wrong'|'hard'|'good'|'easy'`
- `referenceTime` (Date)：基准时间（默认当前时间）

**返回**：
- (Object)：更新后的词条对象

**示例**：
```javascript
const word = {
  id: "123",
  word: "ecology",
  easeFactor: 2.5,
  interval: 6,
  repetitions: 2
};

// 用户回答"一般"
const updated = VocabScheduler.scheduleAfterResult(word, 'good');
// => { easeFactor: 2.5, interval: 15, repetitions: 3, ... }

// 用户回答"简单"
const updated2 = VocabScheduler.scheduleAfterResult(word, 'easy');
// => { easeFactor: 2.6, interval: 16, repetitions: 3, ... }

// 用户回答错误
const updated3 = VocabScheduler.scheduleAfterResult(word, 'wrong');
// => { easeFactor: 2.3, interval: 1, repetitions: 0, ... }
```

### `calculateEaseFactor(oldEF, quality)`

计算新的难度因子。

**参数**：
- `oldEF` (number)：旧难度因子
- `quality` (number)：质量评分（0-5）

**返回**：
- (number)：新难度因子（1.3-2.5）

### `calculateInterval(repetitions, oldInterval, easeFactor)`

计算新的复习间隔。

**参数**：
- `repetitions` (number)：连续正确次数
- `oldInterval` (number)：旧间隔（天）
- `easeFactor` (number)：难度因子

**返回**：
- (number)：新间隔（天）

---

## 七、UI 交互

### 认识判断阶段

```
┌─────────────────────────────────────┐
│                                     │
│           ecology                   │
│                                     │
│  [看释义 (F)]                        │
│                                     │
│  评估你对这个单词的熟悉程度             │
│                                     │
│  [困难]  [一般]  [简单]              │
│                                     │
└─────────────────────────────────────┘
```

### 拼写测试阶段

```
┌─────────────────────────────────────┐
│                                     │
│         生态                         │
│                                     │
│  根据释义，拼写出这个单词              │
│                                     │
│  已尝试 1 次，剩余 2 次机会           │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 在此输入拼写                  │   │
│  └─────────────────────────────┘   │
│                                     │
│  [跳过]           [提交 (Enter)]    │
│                                     │
└─────────────────────────────────────┘
```

### 反馈阶段

```
┌─────────────────────────────────────┐
│  ✅ 太棒了！                         │
│  将于 2025-11-28 10:00 再次复习      │
│                                     │
│  正确拼写：ecology                   │
│  释义：生态                          │
│  间隔天数：15 天                     │
│  难度因子：2.45                      │
│  连续正确：3 次                      │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 质量评分分解：                 │   │
│  │ 认识判断：简单 (EF +0.1)       │   │
│  │ 拼写错误 1 次 (EF -0.15)       │   │
│  │ 最终难度因子：2.45             │   │
│  └─────────────────────────────┘   │
│                                     │
│         [下一词 (Enter)]            │
│                                     │
└─────────────────────────────────────┘
```

---

## 八、键盘快捷键

| 按键 | 功能 | 适用阶段 |
|------|------|---------|
| F | 显示/隐藏释义 | 认识判断 |
| Enter | 提交拼写 | 拼写测试 |
| Enter | 下一词 | 反馈 |
| Esc | 关闭菜单/面板 | 全局 |

---

## 九、向后兼容

### 旧数据迁移

旧词条只有 `box` 和 `correctCount`，自动迁移逻辑：

```javascript
// 旧数据
{
  box: 3,
  correctCount: 5
}

// 自动迁移为
{
  box: 3,              // 保留
  correctCount: 5,     // 保留
  easeFactor: 2.5,     // 默认值
  interval: 1,         // 默认值
  repetitions: 2       // 从 box 推断（box - 1）
}
```

### 废弃的 API

以下函数已标记为 `@deprecated`，但保留向后兼容：

- `promote(word)` → 使用 `scheduleAfterResult(word, 'good')` 替代
- `demote(word)` → 使用 `scheduleAfterResult(word, 'wrong')` 替代
- `REVIEW_INTERVAL_HOURS` → 不再使用固定间隔

---

## 十、性能优化

### 反馈页面显示

```
✅ 太棒了！
将于 2025-11-28 10:00 再次复习。

正确拼写：ecology
释义：生态
下次复习：2025-11-28 10:00
间隔天数：15 天
难度因子：2.50
连续正确：3 次

回忆质量：
[困难] [一般] [简单]

[下一词]
```

### 回忆质量评分

用户可以在反馈页面重新评分：
- **困难**：正确但很吃力 → 间隔增长较慢
- **一般**：正确且流畅 → 间隔正常增长
- **简单**：秒答 → 间隔增长更快

---

---

## 十一、测试用例

### 批量调度

`pickDailyTask` 函数优化：
1. 优先选择逾期词（按 `nextReview` 排序）
2. 补充新词（按词频排序）
3. 限制每日任务量（避免过载）

### 内存占用

每个词条新增 3 个字段（12 字节），3610 词条约增加 43KB 内存。

---

## 十二、参考资料

- [SuperMemo SM-2 算法原文](https://www.supermemo.com/en/archives1990-2015/english/ol/sm2)
- [Anki 间隔重复算法](https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html)
- [艾宾浩斯遗忘曲线](https://zh.wikipedia.org/wiki/%E9%81%97%E5%BF%98%E6%9B%B2%E7%BA%BF)

---

## 十三、实现细节

### 场景 1：新词学习（Easy路径）

```javascript
// 新词，用户首次选择"简单"
const word = { word: "ecology", easeFactor: null };

// 设置起始EF并直接进入复习队列（不验证）
const r1 = setInitialEaseFactor(word, 'easy');
// => { easeFactor: 2.8, intraCycles: 0 }

const r2 = scheduleAfterResult(r1, 'easy');
// => { easeFactor: 2.9, interval: 1, repetitions: 1, intraCycles: 0 }
// 直接保存到数据库，下次按SM-2算法复习
```

### 场景 2：新词学习（Good路径 + 轮内循环 + Easy验证）

```javascript
// 新词，用户首次选择"一般"
const word = { word: "elaborate", easeFactor: null };

// 设置起始EF，进入轮内循环
const r1 = setInitialEaseFactor(word, 'good');
// => { easeFactor: 2.5, intraCycles: 1 }

// 3-8个单词后再次出现，用户选择"简单"
const r2 = adjustIntraCycleEF(r1, 'easy');
// => { easeFactor: 2.65, intraCycles: 0 }

// 触发Easy验证（20-30个单词后）
// 验证时用户再次选择"简单"，验证通过
const r3 = scheduleAfterResult(r2, 'easy');
// => { easeFactor: 2.8, interval: 1, repetitions: 1, intraCycles: 0 }
```

### 场景 3：新词学习（Hard路径 + 轮内循环）

```javascript
// 新词，用户首次选择"困难"
const word = { word: "meticulous", easeFactor: null };

// 设置起始EF，进入轮内循环
const r1 = setInitialEaseFactor(word, 'hard');
// => { easeFactor: 1.8, intraCycles: 1 }

// 轮内循环第1次，用户选择"困难"
const r2 = adjustIntraCycleEF(r1, 'hard');
// => { easeFactor: 1.7, intraCycles: 2 }

// 轮内循环第2次，用户选择"一般"
const r3 = adjustIntraCycleEF(r2, 'good');
// => { easeFactor: 1.75, intraCycles: 3 }

// ... 继续循环直到达到12次或选择easy进入验证
```

### 场景 4：轮内循环中选择Easy

```javascript
// 轮内循环中，用户选择"简单"
const word = { easeFactor: 2.5, intraCycles: 5 };

// 调整EF并触发验证
const r1 = adjustIntraCycleEF(word, 'easy');
// => { easeFactor: 2.65, intraCycles: 6 }

// 20-30个单词后验证
// 如果验证时选择"简单" → 正式进入复习队列
// 如果验证时选择"一般"或"困难" → 重新进入轮内循环（intraCycles重置为1）
```

### 场景 5：遗忘重学

```javascript
const word = { easeFactor: 2.5, interval: 15, repetitions: 3 };

// 回答错误，重置进度并进入轮内循环
const r1 = scheduleAfterResult(word, 'wrong');
// => { easeFactor: 2.3, interval: 1, repetitions: 0, intraCycles: 1 }

// 轮内循环重新学习
const r2 = adjustIntraCycleEF(r1, 'good');
// => { easeFactor: 2.35, intraCycles: 2 }
```

---

## 十四、未来优化方向

1. **Fuzz 因子**：在间隔上增加 ±10% 随机波动，避免"复习堆积"
2. **学习模式**：区分"学习"和"复习"，学习阶段使用更短间隔（10m → 1d → 3d）
3. **难度预测**：根据词频、词长、历史数据预测初始难度
4. **遗忘曲线可视化**：展示记忆强度随时间衰减的曲线
