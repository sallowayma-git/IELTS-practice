/**
 * IELTS Writing Assessment Prompts
 * 雅思写作AI评分提示词模板
 * 按照官方评分标准和专业考官角色设计
 */

const IELTS_SCORING_PROMPTS = {
  // 核心评分提示词（英文）
  MAIN_PROMPT: `You are an experienced IELTS examiner and writing coach with over 10 years of experience in IELTS assessment. Your task is to provide comprehensive, structured, and constructive feedback on the provided English essay, following these strict requirements:

## Required Output Structure

Your feedback must be organized in the following exact order and structure:

### 1. Overall Assessment
**Overall Score:** Provide an estimated IELTS band score or range (e.g., 6.0, 6.0–6.5).
**Overall Comment:** Summarize the essay's main strength and the most critical area for improvement in one sentence.

### 2. Detailed Analysis by Four Criteria
For each of the four dimensions below, provide analysis with an estimated IELTS band score:

**Task Achievement / Response**
- Current Performance: Highlight what was done well.
- Problems: Identify 1-2 specific issues with concrete examples.
- Actionable Suggestions: Provide specific, practical improvement methods.

**Coherence and Cohesion**
- Current Performance: Highlight what was done well.
- Problems: Identify 1-2 specific issues with concrete examples.
- Actionable Suggestions: Provide specific, practical improvement methods.

**Lexical Resource**
- Current Performance: Highlight what was done well.
- Problems: Identify 1-2 specific issues with concrete examples.
- Actionable Suggestions: Provide specific, practical improvement methods.

**Grammatical Range and Accuracy**
- Current Performance: Highlight what was done well.
- Problems: Identify 1-2 specific issues with concrete examples.
- Actionable Suggestions: Provide specific, practical improvement methods.

### 3. Error List
Provide a concise error list, divided into two categories:

**Vocabulary/Spelling Errors:**
Format: "incorrect form → correct form"

**Grammatical Errors:**
Format: "original sentence → revised sentence (brief rule explanation)"

### 4. Upgraded Version
Provide a complete, high-scoring rewrite version that demonstrates:
- Error corrections from the original
- More effective structure
- More precise language
- Clearer logic flow

### 5. Sentence-by-Sentence Analysis
For each sentence in the original essay (in order), provide:
- **Original Sentence:** Quote the user's original sentence
- **Problem Analysis:** List specific issues (spelling, tense, subject-verb agreement, sentence fragments, inappropriate word choice, etc.)
- **Suggested Revision:** Provide 1-2 improved versions with brief explanations

## Tone and Style Requirements
- **Professional and Objective:** Base evaluation on IELTS scoring criteria, avoid subjective speculation
- **Constructive and Encouraging:** Highlight strengths while providing solutions
- **Use Professional Terminology:** Include terms like "coherence," "lexical resource," "subject-verb agreement," "sentence fragment," etc.

## Essay Context
**Task Type:** {taskType}
**Topic:** {topic}
**Word Count:** {wordCount}
**Target Band Score:** {targetBand}

Please analyze the following essay:`,

  // 中文输出转换提示词
  CHINESE_OUTPUT_PROMPT: `请将以上英文分析结果转换为中文，保持相同的结构、专业术语和建设性语气。确保所有评分标准、错误分析和建议都以中文形式准确传达给用户。`,

  // 语法检查专用提示词
  GRAMMAR_CHECK_PROMPT: `As an IELTS grammar specialist, analyze the provided text for grammar, spelling, punctuation, and style issues. Focus on:

1. **Subject-verb agreement** errors
2. **Tense consistency** problems
3. **Article usage** (a/an/the)
4. **Preposition** mistakes
5. **Sentence structure** issues
6. **Spelling** errors
7. **Punctuation** problems
8. **Vocabulary** appropriateness

For each issue found, provide:
- The exact location (word/phrase)
- Error type classification
- Correction suggestion
- Brief explanation

Return results in Chinese with structured format.`,

  // 流式评估阶段提示词
  STREAMING_PHASES: {
    INITIAL: "Analyzing essay structure and content...",
    ANALYSIS: "Evaluating against IELTS criteria...",
    FEEDBACK: "Generating detailed feedback...",
    FINAL: "Finalizing assessment results..."
  },

  // 评分标准权重
  SCORING_WEIGHTS: {
    Task_1: {
      taskAchievement: 0.33,
      coherenceCohesion: 0.25,
      lexicalResource: 0.25,
      grammaticalRange: 0.17
    },
    Task_2: {
      taskAchievement: 0.25,
      coherenceCohesion: 0.25,
      lexicalResource: 0.25,
      grammaticalRange: 0.25
    }
  },

  // 评分描述
  BAND_DESCRIPTORS: {
    9.0: "Expert user. Fully operational command of the language with only occasional unsystematic inaccuracies.",
    8.5: "Very good user. Fully operational command with only occasional inaccuracies.",
    8.0: "Very good user. Has fully operational command with only occasional inaccuracies.",
    7.5: "Good user. Has operational command but some inaccuracies.",
    7.0: "Good user. Has operational command though with occasional inaccuracies.",
    6.5: "Competent user. Has effective command but noticeable inaccuracies.",
    6.0: "Competent user. Has effective command but with noticeable inaccuracies.",
    5.5: "Modest user. Has partial command with frequent inaccuracies.",
    5.0: "Modest user. Has partial command with frequent inaccuracies.",
    4.5: "Limited user. Basic command with frequent errors.",
    4.0: "Limited user. Basic command with frequent errors.",
    3.5: "Extremely limited user. Conveys only basic meaning.",
    3.0: "Extremely limited user. Conveys and understands only general meaning.",
    2.5: "Intermittent user. No real communication is possible.",
    2.0: "Intermittent user. No real communication is possible.",
    1.5: "Non-user. Essentially has no ability to use the language.",
    1.0: "Non-user. Essentially has no ability to use the language."
  },

  // 错误类型分类
  ERROR_CATEGORIES: {
    GRAMMAR: {
      SUBJECT_VERB_AGREEMENT: "主谓不一致",
      TENSE_CONSISTENCY: "时态一致性",
      ARTICLE_USAGE: "冠词使用",
      PREPOSITION_ERROR: "介词错误",
      SENTENCE_STRUCTURE: "句子结构",
      RUN_ON_SENTENCE: "长句错误",
      FRAGMENT: "句子碎片"
    },
    VOCABULARY: {
      SPELLING_ERROR: "拼写错误",
      WORD_CHOICE: "词汇选择",
      COLLOCATION_ERROR: "搭配错误",
      FORMALITY: "正式性",
      PRECISION: "精确性"
    },
    COHERENCE: {
      COHERENT_DEVICE: "衔接词",
      PARAGRAPH_STRUCTURE: "段落结构",
      LOGIC_FLOW: "逻辑流程",
      THESIS_STATEMENT: "主题句"
    }
  },

  // 常见评分短语
  ASSESSMENT_PHRASES: {
    STRENGTHS: [
      "文章结构清晰",
      "论点明确",
      "词汇使用得当",
      "语法基本正确",
      "逻辑性强"
    ],
    IMPROVEMENTS: [
      "需要提高词汇多样性",
      "语法准确性有待加强",
      "段落衔接可以改善",
      "论据支持不够充分",
      "需要更精确的表达"
    ]
  }
}

// 构建完整评分提示词
function buildScoringPrompt(essay, taskType, topic, wordCount, targetBand = 6.0) {
  return IELTS_SCORING_PROMPTS.MAIN_PROMPT
    .replace('{taskType}', taskType)
    .replace('{topic}', topic)
    .replace('{wordCount}', wordCount)
    .replace('{targetBand}', targetBand)
    + '\n\n' + essay
}

// 构建语法检查提示词
function buildGrammarPrompt(text) {
  return IELTS_SCORING_PROMPTS.GRAMMAR_CHECK_PROMPT + '\n\n' + text
}

// 获取分数等级描述
function getBandDescription(score) {
  return IELTS_SCORING_PROMPTS.BAND_DESCRIPTORS[score] || IELTS_SCORING_PROMPTS.BAND_DESCRIPTORS[6.0]
}

// 获取评分权重
function getScoringWeights(taskType) {
  return IELTS_SCORING_PROMPTS.SCORING_WEIGHTS[taskType] || IELTS_SCORING_PROMPTS.SCORING_WEIGHTS.Task_2
}

module.exports = {
  IELTS_SCORING_PROMPTS,
  buildScoringPrompt,
  buildGrammarPrompt,
  getBandDescription,
  getScoringWeights
}