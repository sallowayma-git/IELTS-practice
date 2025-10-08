(() => {
  const topics = [
    {
      id: 'city-development',
      title: 'The Expansion of Smart Cities',
      description:
        'Smart technologies are increasingly used to manage city infrastructure. Discuss the advantages and potential risks of transforming traditional cities into smart cities.',
      type: 'Task 2 · Technology',
      minWords: 250
    },
    {
      id: 'education-balance',
      title: 'Balancing Theory and Practice in University Education',
      description:
        'Some people believe universities should focus on academic theory, while others think they should emphasize practical skills. Discuss both views and give your own opinion.',
      type: 'Task 2 · Education',
      minWords: 250
    },
    {
      id: 'environment-policy',
      title: 'Individual vs Government Responsibility for the Environment',
      description:
        'Many argue that environmental protection should be the responsibility of individuals, while others believe governments should take the lead. Discuss both sides and give your view.',
      type: 'Task 2 · Environment',
      minWords: 250
    },
    {
      id: 'remote-work',
      title: 'The Rise of Remote Work',
      description:
        'Remote working has become more common. Evaluate the impacts of remote work on employees, employers, and society as a whole.',
      type: 'Task 2 · Work',
      minWords: 250
    }
  ]

  const connectors = [
    'however',
    'moreover',
    'furthermore',
    'in addition',
    'on the other hand',
    'therefore',
    'as a result',
    'consequently',
    'in conclusion',
    'overall',
    'meanwhile',
    'similarly'
  ]

  const topicTitle = document.querySelector('#topic-title')
  const topicDescription = document.querySelector('#topic-description')
  const topicType = document.querySelector('#topic-type')
  const topicWords = document.querySelector('#topic-words')
  const environmentStatus = document.querySelector('#environment-status')
  const lastEvaluated = document.querySelector('#last-evaluated')
  const essayInput = document.querySelector('#essay-input')
  const wordCount = document.querySelector('#word-count')
  const sentenceCount = document.querySelector('#sentence-count')
  const lexicalVariety = document.querySelector('#lexical-variety')
  const cohesionScore = document.querySelector('#cohesion-score')
  const evaluateBtn = document.querySelector('#evaluate-btn')
  const resetBtn = document.querySelector('#reset-btn')
  const randomTopicBtn = document.querySelector('#random-topic-btn')
  const startWritingBtn = document.querySelector('#start-writing-btn')
  const viewHistoryBtn = document.querySelector('#view-history-btn')
  const navButtons = document.querySelectorAll('.nav-btn[data-view]')
  const externalNavButtons = document.querySelectorAll('.nav-btn--external')
  const views = document.querySelectorAll('.view')
  const scoreDisplay = document.querySelector('#score-display .score-value')
  const scoreCard = document.querySelector('#score-display')
  const scoreTask = document.querySelector('#score-task')
  const scoreCoherence = document.querySelector('#score-coherence')
  const scoreLexical = document.querySelector('#score-lexical')
  const scoreGrammar = document.querySelector('#score-grammar')
  const feedbackList = document.querySelector('#feedback-list')
  const historyList = document.querySelector('#history-list')
  const historyTableBody = document.querySelector('#history-table-body')
  const historyTotal = document.querySelector('#history-total')
  const historyAverage = document.querySelector('#history-average')
  const historyLatest = document.querySelector('#history-latest')
  const dbStatus = document.querySelector('#db-status')
  const importBtn = document.querySelector('#import-btn')
  const importInput = document.querySelector('#import-input')
  const importStatus = document.querySelector('#import-status')
  const importSummary = document.querySelector('#import-summary')
  const staticModeCallout = document.querySelector('#static-mode-callout')
  const legacyEntryNote = document.querySelector('#legacy-entry-note')
  const requirementChecklist = document.querySelector('#requirement-checklist')

  let currentTopic = null
  const history = []
  const dbRows = []

  const requirementItems = [
    {
      id: 'writing-flow',
      label: '写作评估主流程（Task 2）',
      status: '静态模拟已覆盖',
      detail: '支持随机题目、作文输入、评分拆解与反馈，与需求文档的写作主流程一致。'
    },
    {
      id: 'history-dashboard',
      label: '历史记录与统计',
      status: '静态模拟已覆盖',
      detail: '提供历史列表、总览指标与最近题目，便于验证记录追踪与数据面板布局。'
    },
    {
      id: 'question-bank',
      label: '题库导入与管理',
      status: '静态 CSV 导入',
      detail: '模拟 CSV 导入并更新题库集合，映射文档中题库管理与状态反馈需求。'
    },
    {
      id: 'legacy-integration',
      label: '听力/阅读 Legacy 模块入口',
      status: '静态入口提示',
      detail: '保留 Legacy 模块导航提示，强调正式版本中通过 Vue Router 集成的要求。'
    },
    {
      id: 'environment-awareness',
      label: '本地离线运行约束',
      status: '静态模式声明',
      detail: '顶部横幅与提示强调当前为静态离线演示，区分 Vite/Express 正式环境。'
    }
  ]

  function warmUpEnvironment() {
    environmentStatus.textContent = 'JS 环境预热中...'
    environmentStatus.classList.add('badge', 'badge--warning')
    console.log('%c[Warmup] Start warming JS runtime...', 'color:#d97706')
    requestAnimationFrame(() => {
      setTimeout(() => {
        environmentStatus.textContent = 'JS 环境已就绪'
        environmentStatus.classList.remove('badge--warning')
        environmentStatus.classList.add('badge', 'badge--success')
        console.log('%c[Warmup] Runtime ready.', 'color:#16a34a')
        if (staticModeCallout) {
          staticModeCallout.dataset.ready = 'true'
        }
      }, 350)
    })
  }

  function pickRandomTopic() {
    const topic = topics[Math.floor(Math.random() * topics.length)]
    applyTopic(topic)
    console.log('[Topic] 切换题目', topic)
  }

  function ensureTopic() {
    if (!currentTopic) {
      pickRandomTopic()
    }
  }

  function switchView(target) {
    views.forEach((view) => {
      view.classList.toggle('is-active', view.id === `view-${target}`)
    })
    navButtons.forEach((button) => {
      const isActive = button.dataset.view === target
      button.classList.toggle('is-active', isActive)
      if (isActive) {
        button.setAttribute('aria-current', 'page')
      } else {
        button.removeAttribute('aria-current')
      }
    })
    console.log(`[Navigation] 切换到 ${target} 视图`)
  }

  function applyTopic(topic) {
    currentTopic = topic
    topicTitle.textContent = topic.title
    topicDescription.textContent = topic.description
    topicType.textContent = topic.type
    topicType.className = 'badge'
    topicWords.textContent = `建议不少于 ${topic.minWords} 词`
    topicWords.className = 'badge'
  }

  function tokenize(text) {
    if (!text) return []
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/gi, ' ')
      .split(/\s+/)
      .filter(Boolean)
  }

  function splitSentences(text) {
    return text
      .split(/(?<=[.!?。！？])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function calculateMetrics(text) {
    const trimmed = text.trim()
    const words = tokenize(trimmed)
    const sentences = splitSentences(trimmed)
    const uniqueWords = new Set(words)
    const paragraphs = trimmed.split(/\n{2,}/).filter(Boolean)
    const connectorsCount = connectors.reduce((sum, connector) => {
      const pattern = new RegExp(`\\b${connector.replace(/\s+/g, '\\s+')}\\b`, 'gi')
      return sum + (trimmed.match(pattern)?.length || 0)
    }, 0)

    const averageSentenceLength = sentences.length ? words.length / sentences.length : words.length
    const longSentenceRatio = sentences.length
      ? sentences.filter((sentence) => tokenize(sentence).length >= 20).length / sentences.length
      : 0

    const lexical = words.length ? uniqueWords.size / words.length : 0

    return {
      wordCount: words.length,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      lexicalVariety: lexical,
      connectorsCount,
      averageSentenceLength,
      longSentenceRatio,
      hasIntroduction: paragraphs.length > 0 && paragraphs[0].length > 40,
      hasConclusion: paragraphs.length > 1 && paragraphs[paragraphs.length - 1].length > 40
    }
  }

  function clampScore(value) {
    return Math.max(0, Math.min(9, Number(value.toFixed(1))))
  }

  function scoreEssay(metrics, topic) {
    const { wordCount, lexicalVariety, paragraphCount, connectorsCount, sentenceCount, averageSentenceLength, longSentenceRatio, hasIntroduction, hasConclusion } = metrics

    const taskBase = 4 + Math.min(2, wordCount / (topic.minWords || 250))
    const taskCompletion = wordCount >= (topic.minWords || 250) ? 1 : wordCount >= 200 ? 0.5 : 0
    const taskStructure = paragraphCount >= 4 ? 0.8 : paragraphCount >= 3 ? 0.5 : 0
    const taskScore = clampScore(taskBase + taskCompletion + taskStructure)

    const coherenceBase = 4.5 + (connectorsCount >= 4 ? 1 : connectorsCount >= 2 ? 0.5 : 0)
    const cohesionQuality = hasIntroduction && hasConclusion ? 0.7 : 0.3
    const sentenceBalance = averageSentenceLength >= 12 && averageSentenceLength <= 25 ? 0.7 : 0.3
    const coherencePenalty = longSentenceRatio > 0.35 ? -0.6 : 0
    const coherenceScore = clampScore(coherenceBase + cohesionQuality + sentenceBalance + coherencePenalty)

    const lexicalBase = 4.2 + lexicalVariety * 5
    const lexicalBonus = wordCount > 320 ? 0.5 : 0
    const lexicalScore = clampScore(lexicalBase + lexicalBonus)

    const grammarBase = 4.3 + (sentenceCount >= 5 ? 1 : 0.4)
    const grammarPenalty = longSentenceRatio > 0.45 ? -0.8 : 0
    const grammarBonus = connectorsCount >= 3 ? 0.4 : 0
    const grammarScore = clampScore(grammarBase + grammarPenalty + grammarBonus)

    const overall = clampScore((taskScore + coherenceScore + lexicalScore + grammarScore) / 4)

    return {
      overall,
      taskScore,
      coherenceScore,
      lexicalScore,
      grammarScore
    }
  }

  function buildFeedback(metrics, scores) {
    const tips = []

    if (metrics.wordCount < 200) {
      tips.push('文章篇幅不足，建议至少达到 250 词以满足考试要求。')
    } else if (metrics.wordCount < 260) {
      tips.push('词数接近下限，尝试进一步拓展论证使文章更充分。')
    }

    if (metrics.lexicalVariety < 0.35) {
      tips.push('词汇多样性较低，尝试使用同义词和更精准的表达。')
    }

    if (metrics.connectorsCount < 2) {
      tips.push('连接词使用较少，可以添加 however、therefore 等衔接语。')
    }

    if (metrics.paragraphCount < 4) {
      tips.push('建议使用四段式结构：引言、两个主体段、结论。')
    }

    if (!metrics.hasConclusion) {
      tips.push('文章缺少有力的结尾，记得总结观点并给出整体评价。')
    }

    if (scores.overall >= 7 && tips.length === 0) {
      tips.push('表现出色！保持清晰结构的同时，进一步打磨词汇和语法亮点。')
    }

    if (tips.length === 0) {
      tips.push('整体表现稳定，可继续通过练习提高词汇多样性和论证深度。')
    }

    return tips
  }

  function updateMetricsUI(metrics) {
    wordCount.textContent = metrics.wordCount
    sentenceCount.textContent = metrics.sentenceCount
    lexicalVariety.textContent = `${Math.round(metrics.lexicalVariety * 100)}%`
    cohesionScore.textContent = metrics.connectorsCount >= 3 ? '良好' : metrics.connectorsCount >= 1 ? '一般' : '较弱'
  }

  function renderFeedback(list) {
    feedbackList.innerHTML = ''
    list.forEach((message) => {
      const li = document.createElement('li')
      li.textContent = message
      feedbackList.appendChild(li)
    })
  }

  function renderHistorySidebar() {
    historyList.innerHTML = ''
    history.slice(0, 5).forEach((item) => {
      const li = document.createElement('li')
      li.className = 'history-item'
      li.innerHTML = `<div><strong>${item.topic}</strong></div><div>${item.score} 分 · ${item.wordCount} 词 · ${item.timestamp}</div>`
      historyList.appendChild(li)
    })
  }

  function renderHistoryTable() {
    historyTableBody.innerHTML = ''
    history.forEach((item) => {
      const row = document.createElement('tr')
      row.innerHTML = `
        <td>${item.timestamp}</td>
        <td>${item.topic}</td>
        <td>${item.score}</td>
        <td>${item.feedbackHighlights.join('、')}</td>
      `
      historyTableBody.appendChild(row)
    })
  }

  function updateHistoryAnalytics() {
    if (!history.length) {
      historyTotal.textContent = '0'
      historyAverage.textContent = '--'
      historyLatest.textContent = '--'
      return
    }

    const totalScore = history.reduce((sum, entry) => sum + Number(entry.score), 0)
    historyTotal.textContent = history.length.toString()
    historyAverage.textContent = (totalScore / history.length).toFixed(1)
    historyLatest.textContent = history[0].topic
  }

  function updateDbStatus() {
    if (!dbRows.length) {
      dbStatus.textContent = '尚未写入任何历史记录。'
      dbStatus.className = ''
      return
    }

    const latest = dbRows[dbRows.length - 1]
    dbStatus.textContent = `模拟数据库包含 ${dbRows.length} 条记录，最近写入：${latest.timestamp} · ${latest.topic}`
    dbStatus.className = 'status-ready'
  }

  function renderRequirementChecklist() {
    if (!requirementChecklist) return
    requirementChecklist.innerHTML = ''

    requirementItems.forEach((item) => {
      const li = document.createElement('li')
      li.className = 'requirement-item'
      li.innerHTML = `
        <div class="requirement-meta">
          <span class="requirement-label">${item.label}</span>
          <span class="requirement-status">${item.status}</span>
        </div>
        <p class="requirement-detail">${item.detail}</p>
      `
      requirementChecklist.appendChild(li)
    })
  }

  function handleLegacyNavigation(module) {
    console.log(`[Navigation] 静态模式提示：${module} 模块需要在正式应用中加载 legacy 资源。`)
    if (legacyEntryNote) {
      legacyEntryNote.textContent =
        module === 'listening'
          ? '听力模块需由正式应用通过 Vue Router 跳转到 legacy/listening 页面，静态模式仅记录操作。'
          : '阅读模块需由正式应用通过 Vue Router 跳转到 legacy/reading 页面，静态模式仅记录操作。'
      legacyEntryNote.classList.add('is-active')
      setTimeout(() => legacyEntryNote.classList.remove('is-active'), 1600)
    }
  }

  function pushHistory(entry) {
    history.unshift(entry)
    if (history.length > 20) {
      history.length = 20
    }
    renderHistorySidebar()
    renderHistoryTable()
    updateHistoryAnalytics()
  }

  function formatTimestamp() {
    const now = new Date()
    return `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  }

  function evaluate() {
    const content = essayInput.value.trim()
    console.log('[Evaluate] 开始评估, 字符数:', content.length)
    if (!content) {
      essayInput.classList.add('is-invalid')
      renderFeedback(['请先输入作文内容，再进行评估。'])
      scoreDisplay.textContent = '--'
      scoreCard.classList.remove('active')
      return
    }

    essayInput.classList.remove('is-invalid')

    ensureTopic()

    const metrics = calculateMetrics(content)
    updateMetricsUI(metrics)
    console.table(metrics)

    const scores = scoreEssay(metrics, currentTopic || topics[0])
    console.log('[Evaluate] 评分详情', scores)

    scoreDisplay.textContent = scores.overall.toFixed(1)
    scoreTask.textContent = scores.taskScore.toFixed(1)
    scoreCoherence.textContent = scores.coherenceScore.toFixed(1)
    scoreLexical.textContent = scores.lexicalScore.toFixed(1)
    scoreGrammar.textContent = scores.grammarScore.toFixed(1)
    scoreCard.classList.add('active')

    const feedback = buildFeedback(metrics, scores)
    renderFeedback(feedback)

    const historyEntry = {
      topic: currentTopic ? currentTopic.title : '自定义题目',
      score: scores.overall.toFixed(1),
      wordCount: metrics.wordCount,
      timestamp: formatTimestamp(),
      feedbackHighlights: feedback.slice(0, 2)
    }
    pushHistory(historyEntry)

    dbRows.push({ ...historyEntry })
    updateDbStatus()

    lastEvaluated.textContent = `最近评估：${historyEntry.timestamp}`
    console.log('[Evaluate] 历史记录已更新', history)
  }

  function resetEssay() {
    essayInput.value = ''
    updateMetricsUI({ wordCount: 0, sentenceCount: 0, lexicalVariety: 0, connectorsCount: 0 })
    cohesionScore.textContent = '--'
    scoreDisplay.textContent = '--'
    scoreTask.textContent = '--'
    scoreCoherence.textContent = '--'
    scoreLexical.textContent = '--'
    scoreGrammar.textContent = '--'
    feedbackList.innerHTML = ''
    scoreCard.classList.remove('active')
    essayInput.classList.remove('is-invalid')
    console.log('[Reset] 编辑区已清空')
  }

  function handleInput() {
    const content = essayInput.value
    const metrics = calculateMetrics(content)
    updateMetricsUI(metrics)
  }

  function parseCsv(text) {
    const trimmed = text.trim()
    if (!trimmed) return []

    const lines = trimmed.split(/\r?\n/).filter(Boolean)
    const [headerLine, ...rows] = lines
    const headers = headerLine.split(',').map((cell) => cell.trim().toLowerCase())

    return rows.map((line, index) => {
      const cells = line.split(',').map((cell) => cell.trim())
      const record = Object.fromEntries(headers.map((key, idx) => [key, cells[idx] || '']))
      return {
        id: `import-${Date.now()}-${index}`,
        title: record.title || `导入题目 ${index + 1}`,
        description: record.description || '（CSV 导入缺少描述）',
        type: record.type || 'Task 2 · General',
        minWords: Number.parseInt(record.minwords || record.min_words || '250', 10) || 250
      }
    })
  }

  function announceImportResult(summary) {
    importStatus.textContent = summary.message
    importStatus.className = summary.success ? 'import-status success' : 'import-status error'
    importSummary.innerHTML = ''
    summary.details.forEach((detail) => {
      const li = document.createElement('li')
      li.textContent = detail
      importSummary.appendChild(li)
    })
  }

  function handleImportText(text, fileName) {
    try {
      const parsed = parseCsv(text)
      if (!parsed.length) {
        announceImportResult({
          success: false,
          message: `文件 ${fileName} 未解析到任何题目，请检查内容。`,
          details: ['确保包含 title, description, type, minWords 字段。']
        })
        return
      }

      parsed.forEach((topic) => topics.push(topic))

      announceImportResult({
        success: true,
        message: `成功导入 ${parsed.length} 道题目（${fileName}）。`,
        details: parsed.map((topic) => `${topic.title} · ${topic.type} · ≥${topic.minWords} 词`)
      })

      console.log('[Import] 题库导入完成', parsed)
    } catch (error) {
      console.error('[Import] 题库导入失败', error)
      announceImportResult({
        success: false,
        message: `导入失败：${error.message}`,
        details: ['请确认 CSV 格式正确。']
      })
    }
  }

  function handleImport(file) {
    const reader = new FileReader()
    importStatus.textContent = `正在读取 ${file.name} ...`
    importStatus.className = 'import-status loading'
    reader.onload = () => {
      handleImportText(reader.result, file.name)
    }
    reader.onerror = () => {
      announceImportResult({
        success: false,
        message: `读取文件 ${file.name} 失败：${reader.error?.message || '未知错误'}`,
        details: []
      })
    }
    reader.readAsText(file, 'utf-8')
  }

  function setupNavigation() {
    navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.view
        if (target) {
          switchView(target)
        }
      })
    })

    viewHistoryBtn.addEventListener('click', () => {
      switchView('history')
    })

    startWritingBtn.addEventListener('click', () => {
      pickRandomTopic()
      switchView('home')
      startWritingBtn.blur()
      console.log('[Action] 用户开始写作流程')
    })
  }

  function setupExternalNavigation() {
    externalNavButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const module = button.dataset.module || 'legacy'
        handleLegacyNavigation(module)
      })
    })
  }

  function setupImport() {
    importBtn.addEventListener('click', () => {
      importInput.click()
    })

    importInput.addEventListener('change', (event) => {
      const [file] = event.target.files || []
      if (file) {
        handleImport(file)
      }
      importInput.value = ''
    })
  }

  essayInput.addEventListener('input', handleInput)
  evaluateBtn.addEventListener('click', evaluate)
  resetBtn.addEventListener('click', resetEssay)
  randomTopicBtn.addEventListener('click', pickRandomTopic)

  setupNavigation()
  setupExternalNavigation()
  setupImport()

  warmUpEnvironment()
  updateDbStatus()
  renderHistorySidebar()
  updateHistoryAnalytics()
  renderRequirementChecklist()
})();
