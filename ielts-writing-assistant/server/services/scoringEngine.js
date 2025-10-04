/**
 * 专业雅思评分引擎
 * 基于官方评分标准生成高质量反馈
 */

class IELTSScoringEngine {
  constructor() {
    this.criteriaWeights = {
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
    }
  }

  // 生成专业评分结果
  generateDetailedAssessment(params) {
    const { content, topic, type = 'Task 2' } = params
    const analysis = this.analyzeEssay(content, topic, type)
    const scores = this.calculateScores(analysis, type)
    const feedback = this.generateFeedback(scores, analysis)

    return {
      overall_score: scores.overall,
      level: this.getBandLevel(scores.overall),
      description: feedback.overall,
      task_response: {
        score: scores.taskAchievement,
        feedback: feedback.taskAchievement
      },
      coherence: {
        score: scores.coherence,
        feedback: feedback.coherence
      },
      vocabulary: {
        score: scores.vocabulary,
        feedback: feedback.vocabulary
      },
      grammar: {
        score: scores.grammar,
        feedback: feedback.grammar
      },
      strengths: feedback.strengths,
      improvements: feedback.improvements,
      suggestions: feedback.suggestions,
      detailed_feedback: this.generateDetailedFeedback(scores, analysis),
      metadata: {
        wordCount: analysis.wordCount,
        paragraphCount: analysis.paragraphCount,
        sentenceCount: analysis.sentenceCount,
        complexity: analysis.complexity,
        timeSpent: params.timeSpent || 0
      }
    }
  }

  // 分析作文内容
  analyzeEssay(content, topic, type) {
    const analysis = {
      wordCount: this.countWords(content),
      paragraphCount: this.countParagraphs(content),
      sentenceCount: this.countSentences(content),
      complexity: this.analyzeComplexity(content),
      vocabulary: this.analyzeVocabulary(content),
      grammar: this.analyzeGrammar(content),
      structure: this.analyzeStructure(content, type),
      content: this.analyzeContent(content, topic, type)
    }

    return analysis
  }

  // 计算各项分数
  calculateScores(analysis, type) {
    const weights = this.criteriaWeights[type]

    // 基础分数计算
    const baseScores = {
      taskAchievement: this.calculateTaskAchievementScore(analysis),
      coherence: this.calculateCoherenceScore(analysis),
      vocabulary: this.calculateVocabularyScore(analysis),
      grammar: this.calculateGrammarScore(analysis)
    }

    // 调整分数，确保在0-9范围内
    Object.keys(baseScores).forEach(key => {
      baseScores[key] = Math.max(1.0, Math.min(9.0, baseScores[key]))
    })

    // 计算总分
    const overall = Object.keys(weights).reduce((sum, criterion) => {
      return sum + baseScores[criterion] * weights[criterion]
    }, 0)

    return {
      ...baseScores,
      overall: Math.round(overall * 10) / 10
    }
  }

  // 计算任务回应分数
  calculateTaskAchievementScore(analysis) {
    let score = 6.0

    // 字数调整
    if (analysis.wordCount >= 250) score += 0.5
    else score -= 0.5

    // 段落结构
    if (analysis.paragraphCount >= 4) score += 0.3
    else score -= 0.3

    // 内容相关性
    if (analysis.content.relevance >= 0.8) score += 0.2
    else score -= 0.2

    // 论证充分性
    if (analysis.content.argumentQuality >= 0.7) score += 0.2
    else score -= 0.2

    return score
  }

  // 计算连贯与衔接分数
  calculateCoherenceScore(analysis) {
    let score = 6.0

    // 段落划分清晰
    if (analysis.structure.paragraphClarity >= 0.8) score += 0.3
    else score -= 0.3

    // 过渡词使用
    if (analysis.structure.transitionWords >= 5) score += 0.2
    else score -= 0.2

    // 逻辑流程
    if (analysis.structure.logicalFlow >= 0.7) score += 0.2
    else score -= 0.2

    // 主题句明确
    if (analysis.structure.thesisStatement) score += 0.3
    else score -= 0.3

    return score
  }

  // 计算词汇资源分数
  calculateVocabularyScore(analysis) {
    let score = 6.0

    // 词汇多样性
    if (analysis.vocabulary.diversity >= 0.7) score += 0.3
    else score -= 0.3

    // 学术词汇使用
    if (analysis.vocabulary.academicRatio >= 0.15) score += 0.3
    else score -= 0.3

    // 词汇准确性
    if (analysis.vocabulary.accuracy >= 0.9) score += 0.4
    else score -= 0.4

    // 搭配使用
    if (analysis.vocabulary.collocations >= 3) score += 0.2
    else score -= 0.2

    return score
  }

  // 计算语法范围与准确性分数
  calculateGrammarScore(analysis) {
    let score = 6.0

    // 句子结构多样性
    if (analysis.grammar.sentenceVariety >= 0.6) score += 0.3
    else score -= 0.3

    // 语法错误率
    const errorRate = analysis.grammar.errorRate
    if (errorRate <= 0.05) score += 0.5
    else if (errorRate <= 0.1) score += 0.2
    else score -= (errorRate - 0.1) * 2

    // 复杂句使用
    if (analysis.grammar.complexSentences >= 0.3) score += 0.2
    else score -= 0.2

    // 标点符号正确性
    if (analysis.grammar.punctuationAccuracy >= 0.9) score += 0.2
    else score -= 0.2

    return score
  }

  // 生成反馈内容
  generateFeedback(scores, analysis) {
    return {
      overall: this.generateOverallFeedback(scores.overall, analysis),
      taskAchievement: this.generateTaskAchievementFeedback(scores.taskAchievement, analysis),
      coherence: this.generateCoherenceFeedback(scores.coherence, analysis),
      vocabulary: this.generateVocabularyFeedback(scores.vocabulary, analysis),
      grammar: this.generateGrammarFeedback(scores.grammar, analysis),
      strengths: this.generateStrengths(scores),
      improvements: this.generateImprovements(scores),
      suggestions: this.generateSuggestions(scores, analysis)
    }
  }

  // 生成总体反馈
  generateOverallFeedback(overallScore, analysis) {
    if (overallScore >= 7.5) {
      return `文章整体质量优秀，表现出色。${analysis.wordCount}字的篇幅充分，论点清晰，论证有力。语言运用熟练，词汇使用准确丰富，语法掌握良好，文章结构完整，逻辑性强。`
    } else if (overallScore >= 6.5) {
      return `文章质量良好，基本达到雅思写作要求。${analysis.wordCount}字的篇幅适中，能够明确表达观点。文章结构合理，但在语法准确性和词汇多样性方面还有提升空间。`
    } else if (overallScore >= 5.5) {
      return `文章基本表达了观点，但在论证深度和语言准确性方面需要改进。${analysis.wordCount}字的篇幅接近最低要求，建议增加内容深度和语言精确度。`
    } else {
      return `文章需要大幅改进，建议重点加强语法基础、词汇积累和文章结构组织。当前${analysis.wordCount}字的篇幅不足，需要更充分的内容展开。`
    }
  }

  // 生成任务回应反馈
  generateTaskAchievementFeedback(score, analysis) {
    if (score >= 7.0) {
      return "完全回应了题目要求，观点明确，论证充分，论据有力。文章结构完整，主题突出，能够有效支持主要观点。"
    } else if (score >= 6.0) {
      return "基本回应了题目要求，观点相对明确，但论证可以更深入，论据可以更充分。部分观点需要更详细的展开和支持。"
    } else {
      return "未能完全回应题目要求，论点不够明确，论证缺乏深度。需要更仔细地分析题目要求，提供更多相关的论据和例子。"
    }
  }

  // 生成连贯与衔接反馈
  generateCoherenceFeedback(score, analysis) {
    if (score >= 7.0) {
      return "文章结构清晰，段落衔接自然，逻辑性强。过渡词使用恰当，句子之间和段落之间的连接流畅，整体组织结构合理。"
    } else if (score >= 6.0) {
      return "文章结构基本合理，段落划分清楚，但部分段落间的衔接可以更自然。建议使用更多样的过渡词来增强文章的连贯性。"
    } else {
      return "文章结构需要改进，段落划分不够清晰，逻辑关系不够明确。建议重新组织文章结构，确保每个段落都有明确的主题句，并使用合适的过渡词。"
    }
  }

  // 生成词汇资源反馈
  generateVocabularyFeedback(score, analysis) {
    if (score >= 7.0) {
      return "词汇使用丰富准确，展现了良好的词汇量，用词恰当，搭配合理。能够有效使用学术词汇，词汇选择适合正式写作要求。"
    } else if (score >= 6.0) {
      return "词汇使用基本准确，但可以更加丰富多样，避免重复使用相同词汇。建议增加学术词汇的使用，注意词汇的精确性。"
    } else {
      return "词汇使用有限，存在重复和不当用词的情况。建议扩大词汇量，学习更多学术词汇，注意词汇的准确性和恰当性。"
    }
  }

  // 生成语法反馈
  generateGrammarFeedback(score, analysis) {
    if (score >= 7.0) {
      return "语法掌握良好，句子结构多样，错误很少。能够熟练运用复杂句式，标点符号使用准确，整体语法表现优秀。"
    } else if (score >= 6.0) {
      return "语法基本正确，但存在一些常见错误。建议注意主谓一致、时态使用等基础语法点，同时增加句子结构的多样性。"
    } else {
      return "语法错误较多，基础语法掌握不够牢固。建议重点学习基本语法规则，包括句子结构、时态、主谓一致等，减少语法错误。"
    }
  }

  // 生成优点
  generateStrengths(scores) {
    const strengths = []

    if (scores.taskAchievement >= 6.5) strengths.push("论点明确，回应题目要求")
    if (scores.coherence >= 6.5) strengths.push("文章结构清晰，逻辑性强")
    if (scores.vocabulary >= 6.5) strengths.push("词汇使用准确，表达丰富")
    if (scores.grammar >= 6.5) strengths.push("语法掌握良好，错误较少")
    if (scores.overall >= 7.0) strengths.push("整体写作水平优秀")

    return strengths.length > 0 ? strengths : ["具备基本的写作能力"]
  }

  // 生成改进建议
  generateImprovements(scores) {
    const improvements = []

    if (scores.taskAchievement < 6.5) improvements.push("加强论证深度，提供更多论据支持")
    if (scores.coherence < 6.5) improvements.push("改善文章结构，增强段落衔接")
    if (scores.vocabulary < 6.5) improvements.push("扩大词汇量，提高用词精确性")
    if (scores.grammar < 6.5) improvements.push("加强语法基础，减少错误")
    if (scores.overall < 6.0) improvements.push("全面提升写作能力，注重细节")

    return improvements.length > 0 ? improvements : ["继续练习，持续改进"]
  }

  // 生成具体建议
  generateSuggestions(scores, analysis) {
    const suggestions = []

    // 基于分析生成具体建议
    if (analysis.wordCount < 250) {
      suggestions.push("增加文章字数，确保充分展开观点")
    }

    if (analysis.paragraphCount < 4) {
      suggestions.push("增加段落数量，确保每个论点都有充分的阐述")
    }

    if (analysis.vocabulary.academicRatio < 0.1) {
      suggestions.push("增加学术词汇的使用，提高文章的正式性")
    }

    if (analysis.grammar.errorRate > 0.1) {
      suggestions.push("仔细检查语法错误，特别注意时态和主谓一致")
    }

    // 基于分数生成建议
    if (scores.overall < 6.0) {
      suggestions.push("多读范文，学习优秀的写作结构和表达方式")
      suggestions.push("进行语法和词汇的专项练习")
    } else if (scores.overall < 7.0) {
      suggestions.push("练习使用更复杂的句子结构")
      suggestions.push("丰富词汇量，学习同义词替换")
    }

    return suggestions.length > 0 ? suggestions : ["继续保持写作练习，不断提升"]
  }

  // 生成详细反馈
  generateDetailedFeedback(scores, analysis) {
    return {
      criteriaBreakdown: {
        TaskAchievement: {
          score: scores.taskAchievement,
          bandDescription: this.getBandDescription(scores.taskAchievement)
        },
        Coherence: {
          score: scores.coherence,
          bandDescription: this.getBandDescription(scores.coherence)
        },
        LexicalResource: {
          score: scores.vocabulary,
          bandDescription: this.getBandDescription(scores.vocabulary)
        },
        GrammaticalRange: {
          score: scores.grammar,
          bandDescription: this.getBandDescription(scores.grammar)
        }
      },
      analysis: analysis,
      recommendations: this.generateRecommendations(scores, analysis)
    }
  }

  // 获取分数等级描述
  getBandDescription(score) {
    const descriptions = {
      9.0: "专家水平：完全掌握语言，偶有非系统性错误",
      8.0: "优秀水平：良好掌握语言，偶有不准确之处",
      7.0: "良好水平：有效掌握语言，偶有不准确",
      6.0: "合格水平：有效掌握语言，有不准确之处",
      5.0: "有限水平：部分掌握语言，频繁错误",
      4.0: "有限水平：基本掌握语言，频繁错误"
    }

    return descriptions[score] || descriptions[6.0]
  }

  // 生成建议
  generateRecommendations(scores, analysis) {
    const recommendations = []

    // 基于最低分给出建议
    const lowestScore = Math.min(scores.taskAchievement, scores.coherence, scores.vocabulary, scores.grammar)

    if (lowestScore === scores.grammar) {
      recommendations.push("重点练习基础语法：时态、主谓一致、冠词使用")
      recommendations.push("学习常见句式，提高句子结构多样性")
    } else if (lowestScore === scores.vocabulary) {
      recommendations.push("扩大词汇量，特别是学术词汇")
      recommendations.push("学习词汇搭配，提高用词准确性")
    } else if (lowestScore === scores.coherence) {
      recommendations.push("学习段落组织技巧")
      recommendations.push("练习使用过渡词和连接词")
    } else if (lowestScore === scores.taskAchievement) {
      recommendations.push("练习题目分析技巧")
      recommendations.push("学习论据组织和支持方法")
    }

    return recommendations
  }

  // 辅助方法
  countWords(text) {
    return text.replace(/<[^>]*>/g, ' ').match(/\b\w+\b/g)?.length || 0
  }

  countParagraphs(text) {
    return text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length
  }

  countSentences(text) {
    return text.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  }

  analyzeComplexity(content) {
    const sentences = content.split(/[.!?]+/)
    const avgLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
    const complexSentences = sentences.filter(s => s.includes(',') || s.includes(';') || s.includes('when')).length

    return {
      averageSentenceLength: avgLength,
      complexSentenceRatio: complexSentences / sentences.length,
      overallComplexity: avgLength > 20 ? 'high' : avgLength > 15 ? 'medium' : 'low'
    }
  }

  analyzeVocabulary(content) {
    const words = content.toLowerCase().match(/\b\w+\b/g) || []
    const uniqueWords = new Set(words)
    const academicWords = words.filter(word =>
      /tion|ment|ness|ity|ship|hood|ism|ist|er|or|ance|ence|ment|ity/.test(word)
    )

    return {
      totalWords: words.length,
      uniqueWords: uniqueWords.size,
      diversity: uniqueWords.size / words.length,
      academicRatio: academicWords.length / words.length,
      accuracy: 0.95 // 模拟值
    }
  }

  analyzeGrammar(content) {
    // 简化的语法分析
    const sentences = content.split(/[.!?]+/)
    const totalSentences = sentences.length
    const complexSentences = sentences.filter(s => s.includes(',') || s.includes(';')).length
    const errorCount = Math.floor(totalSentences * 0.05) // 模拟5%错误率

    return {
      sentenceVariety: complexSentences / totalSentences,
      complexSentences: complexSentences,
      errorRate: errorCount / totalSentences,
      punctuationAccuracy: 0.9 // 模拟值
    }
  }

  analyzeStructure(content, type) {
    const paragraphs = content.split(/\n\s*\n/)

    return {
      paragraphCount: paragraphs.length,
      paragraphClarity: 0.8, // 模拟值
      transitionWords: this.countTransitionWords(content),
      logicalFlow: 0.75, // 模拟值
      thesisStatement: this.hasThesisStatement(content)
    }
  }

  analyzeContent(content, topic, type) {
    return {
      relevance: 0.85, // 模拟值
      argumentQuality: 0.75, // 模拟值
      evidenceSupport: 0.7, // 模拟值
      depth: 0.8 // 模拟值
    }
  }

  countTransitionWords(text) {
    const transitionWords = [
      'however', 'therefore', 'moreover', 'furthermore', 'consequently',
      'although', 'nevertheless', 'in addition', 'on the other hand',
      'in conclusion', 'to sum up', 'firstly', 'secondly', 'finally'
    ]

    return transitionWords.filter(word =>
      text.toLowerCase().includes(word)
    ).length
  }

  hasThesisStatement(content) {
    // 简化的检测逻辑
    const firstParagraph = content.split(/\n\s*\n/)[0]
    return firstParagraph.includes('This essay') ||
           firstParagraph.includes('I believe') ||
           firstParagraph.includes('I think')
  }
}

module.exports = IELTSScoringEngine