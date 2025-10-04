/**
 * 语法检查服务
 * 提供语法错误检测、建议和标记功能
 */

class GrammarChecker {
  constructor() {
    this.rules = this.initializeGrammarRules()
    this.patterns = this.initializePatterns()
  }

  /**
   * 初始化语法规则
   */
  initializeGrammarRules() {
    return {
      // 主谓一致
      subjectVerbAgreement: [
        {
          pattern: /\b(he|she|it)\s+\w+s\b/gi,
          message: "第三人称单数需要加s",
          type: "error",
          suggestion: "在动词后加 's'"
        },
        {
          pattern: /\b(they|we|you)\s+\w+s\b/gi,
          message: "复数主语不需要加s",
          type: "error",
          suggestion: "去掉动词后的 's'"
        }
      ],

      // 时态一致性
      tenseConsistency: [
        {
          pattern: /\byesterday\b.*?\b\w+s\b/gi,
          message: "过去时态中动词不应使用现在时",
          type: "warning",
          suggestion: "使用过去时态"
        },
        {
          pattern: /\bnext\s+week\b.*?\b\w+ed\b/gi,
          message: "将来时态中不应使用过去时",
          type: "warning",
          suggestion: "使用将来时态"
        }
      ],

      // 冠词错误
      articles: [
        {
          pattern: /\b(a|an)\s+[aeiouAEIOU]/g,
          message: "元音前应该用 'an'",
          type: "error",
          suggestion: "将 'a' 改为 'an'"
        },
        {
          pattern: /\ban\s+[^aeiouAEIOU]/g,
          message: "辅音前应该用 'a'",
          type: "error",
          suggestion: "将 'an' 改为 'a'"
        }
      ],

      // 介词错误
      prepositions: [
        {
          pattern: /\b(depend|rely)\s+on\b/gi,
          message: "正确的搭配是 'depend on'",
          type: "error",
          suggestion: "使用正确的介词 'on'"
        },
        {
          pattern: /\b(interested)\s+in\b/gi,
          message: "正确的搭配是 'interested in'",
          type: "error",
          suggestion: "使用正确的介词 'in'"
        }
      ],

      // 拼写错误
      spelling: [
        {
          pattern: /\baccomodate\b/gi,
          message: "拼写错误",
          type: "error",
          suggestion: "正确拼写: 'accommodate'"
        },
        {
          pattern: /\bdefinately\b/gi,
          message: "拼写错误",
          type: "error",
          suggestion: "正确拼写: 'definitely'"
        },
        {
          pattern: /\brecieve\b/gi,
          message: "拼写错误",
          type: "error",
          suggestion: "正确拼写: 'receive'"
        }
      ],

      // 标点符号
      punctuation: [
        {
          pattern: /\w+\s*,\s*\w+/g,
          message: "逗号后应有空格",
          type: "warning",
          suggestion: "在逗号后添加空格"
        },
        {
          pattern: /\w+\.\w+/g,
          message: "句号后应有空格",
          type: "warning",
          suggestion: "在句号后添加空格"
        }
      ]
    }
  }

  /**
   * 初始化检测模式
   */
  initializePatterns() {
    return {
      // 句子长度检测
      longSentences: {
        maxLength: 30,
        message: "句子过长，建议分解",
        type: "style"
      },

      // 重复词检测
      repeatedWords: {
        pattern: /\b(\w+)\s+\1\b/gi,
        message: "重复的词语",
        type: "style"
      },

      // 被动语态检测
      passiveVoice: {
        pattern: /\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi,
        message: "被动语态，考虑使用主动语态",
        type: "suggestion"
      }
    }
  }

  /**
   * 检查文本语法
   * @param {string} text - 要检查的文本
   * @returns {Object} 检查结果
   */
  checkGrammar(text) {
    const issues = []
    const suggestions = []

    // 应用语法规则
    Object.entries(this.rules).forEach(([category, rules]) => {
      rules.forEach(rule => {
        const matches = text.match(rule.pattern)
        if (matches) {
          matches.forEach(match => {
            const index = text.indexOf(match)
            const issue = {
              id: this.generateIssueId(),
              type: rule.type,
              category: category,
              message: rule.message,
              suggestion: rule.suggestion,
              text: match,
              startIndex: index,
              endIndex: index + match.length,
              severity: this.getSeverity(rule.type)
            }
            issues.push(issue)

            if (rule.suggestion) {
              suggestions.push({
                issueId: issue.id,
                text: match,
                suggestion: rule.suggestion,
                startIndex: index,
                endIndex: index + match.length
              })
            }
          })
        }
      })
    })

    // 应用模式检测
    Object.entries(this.patterns).forEach(([patternName, pattern]) => {
      switch (patternName) {
        case 'longSentences':
          const sentences = text.split(/[.!?]+/)
          sentences.forEach((sentence, index) => {
            const words = sentence.trim().split(/\s+/)
            if (words.length > pattern.maxLength) {
              const startIndex = text.indexOf(sentence)
              issues.push({
                id: this.generateIssueId(),
                type: pattern.type,
                category: 'style',
                message: pattern.message,
                text: sentence.trim(),
                startIndex: startIndex,
                endIndex: startIndex + sentence.length,
                severity: 'low',
                wordCount: words.length
              })
            }
          })
          break

        case 'repeatedWords':
          const repeatedMatches = text.match(pattern.pattern)
          if (repeatedMatches) {
            repeatedMatches.forEach(match => {
              const index = text.indexOf(match)
              issues.push({
                id: this.generateIssueId(),
                type: pattern.type,
                category: 'style',
                message: pattern.message,
                text: match,
                startIndex: index,
                endIndex: index + match.length,
                severity: 'low'
              })
            })
          }
          break

        case 'passiveVoice':
          const passiveMatches = text.match(pattern.pattern)
          if (passiveMatches) {
            passiveMatches.forEach(match => {
              const index = text.indexOf(match)
              issues.push({
                id: this.generateIssueId(),
                type: pattern.type,
                category: 'style',
                message: pattern.message,
                text: match,
                startIndex: index,
                endIndex: index + match.length,
                severity: 'low'
              })
            })
          }
          break
      }
    })

    // 统计信息
    const stats = this.calculateStatistics(text, issues)

    return {
      success: true,
      data: {
        issues: issues,
        suggestions: suggestions,
        statistics: stats,
        score: this.calculateGrammarScore(issues, text)
      }
    }
  }

  /**
   * 生成问题ID
   */
  generateIssueId() {
    return 'grammar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
  }

  /**
   * 获取严重程度
   */
  getSeverity(type) {
    const severityMap = {
      'error': 'high',
      'warning': 'medium',
      'suggestion': 'low',
      'style': 'low'
    }
    return severityMap[type] || 'medium'
  }

  /**
   * 计算统计信息
   */
  calculateStatistics(text, issues) {
    const words = text.match(/\b\w+\b/g) || []
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)

    return {
      totalWords: words.length,
      totalSentences: sentences.length,
      averageWordsPerSentence: sentences.length > 0 ? Math.round(words.length / sentences.length) : 0,
      totalIssues: issues.length,
      errors: issues.filter(i => i.type === 'error').length,
      warnings: issues.filter(i => i.type === 'warning').length,
      suggestions: issues.filter(i => i.type === 'suggestion' || i.type === 'style').length
    }
  }

  /**
   * 计算语法评分
   */
  calculateGrammarScore(issues, text) {
    const words = text.match(/\b\w+\b/g) || []
    const wordCount = words.length

    if (wordCount === 0) return 100

    const errorCount = issues.filter(i => i.type === 'error').length
    const warningCount = issues.filter(i => i.type === 'warning').length

    // 基础分100分，根据错误和警告扣分
    let score = 100

    // 错误扣分（每个错误扣2分）
    score -= errorCount * 2

    // 警告扣分（每个警告扣1分）
    score -= warningCount * 1

    // 确保分数在0-100之间
    score = Math.max(0, Math.min(100, score))

    return score
  }

  /**
   * 应用建议修复
   * @param {string} text - 原始文本
   * @param {Array} suggestions - 建议列表
   * @returns {string} 修复后的文本
   */
  applySuggestions(text, suggestions) {
    let correctedText = text

    // 按照索引倒序排列，避免位置偏移问题
    suggestions.sort((a, b) => b.startIndex - a.startIndex)

    suggestions.forEach(suggestion => {
      const before = correctedText.substring(0, suggestion.startIndex)
      const after = correctedText.substring(suggestion.endIndex)

      // 这里应该有更智能的替换逻辑
      // 现在暂时用简单的字符串替换
      correctedText = before + suggestion.suggestion + after
    })

    return correctedText
  }
}

module.exports = GrammarChecker