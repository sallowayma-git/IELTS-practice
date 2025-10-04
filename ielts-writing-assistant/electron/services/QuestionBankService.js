/**
 * 题库资源管理服务
 * 管理IELTS题库的导入、索引、缓存和访问
 */

const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { app, dialog } = require('electron')

class QuestionBankService {
  constructor() {
    this.config = {
      // 题库目录配置
      questionBankDir: path.join(app.getPath('userData'), 'question-bank'),
      indexFile: 'question-bank-index.json',
      cacheDir: 'cache',

      // 支持的文件类型
      supportedFormats: ['.json', '.txt', '.md', '.csv'],

      // 题库结构
      categories: ['writing-task1', 'writing-task2', 'listening', 'reading', 'vocabulary'],

      // 缓存配置
      maxCacheSize: 100 * 1024 * 1024, // 100MB
      cacheExpiry: 30 * 24 * 60 * 60 * 1000, // 30天

      // 索引配置
      indexingBatchSize: 100,
      maxRetries: 3
    }

    // 状态管理
    this.isInitialized = false
    this.indexData = null
    this.currentImportProgress = null
    this.importQueue = []

    // 事件监听器
    this.eventListeners = new Map()

    // 缓存管理
    this.cache = new Map()
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    }
  }

  /**
   * 初始化题库服务
   */
  async initialize() {
    try {
      // 创建必要的目录
      await this.ensureDirectories()

      // 加载或创建索引
      await this.loadIndex()

      // 清理过期缓存
      await this.cleanupExpiredCache()

      this.isInitialized = true
      this.emit('service-initialized', { timestamp: Date.now() })

      console.log('✅ 题库服务初始化完成')
      return true
    } catch (error) {
      console.error('❌ 题库服务初始化失败:', error)
      this.emit('service-error', { error, timestamp: Date.now() })
      return false
    }
  }

  /**
   * 确保必要目录存在
   */
  async ensureDirectories() {
    const directories = [
      this.config.questionBankDir,
      path.join(this.config.questionBankDir, this.config.cacheDir),
      path.join(this.config.questionBankDir, 'backups'),
      path.join(this.config.questionBankDir, 'temp')
    ]

    for (const dir of directories) {
      try {
        await fs.access(dir)
      } catch {
        await fs.mkdir(dir, { recursive: true })
        console.log(`📁 创建目录: ${dir}`)
      }
    }
  }

  /**
   * 加载索引文件
   */
  async loadIndex() {
    const indexPath = path.join(this.config.questionBankDir, this.config.indexFile)

    try {
      const data = await fs.readFile(indexPath, 'utf8')
      this.indexData = JSON.parse(data)

      // 验证索引完整性
      await this.validateIndex()

      console.log('📚 题库索引加载成功')
      this.emit('index-loaded', {
        questions: this.indexData.totalQuestions,
        categories: Object.keys(this.indexData.categories),
        timestamp: Date.now()
      })
    } catch (error) {
      console.log('📝 题库索引不存在，创建新索引')
      this.indexData = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalQuestions: 0,
        categories: {},
        tags: new Set(),
        statistics: {},
        checksum: null
      }
      await this.saveIndex()
    }
  }

  /**
   * 保存索引文件
   */
  async saveIndex() {
    const indexPath = path.join(this.config.questionBankDir, this.config.indexFile)

    try {
      // 创建备份
      await this.createIndexBackup()

      // 计算校验和
      this.indexData.checksum = this.calculateIndexChecksum()
      this.indexData.updatedAt = new Date().toISOString()

      // 写入临时文件
      const tempPath = indexPath + '.tmp'
      await fs.writeFile(tempPath, JSON.stringify(this.indexData, null, 2), 'utf8')

      // 原子性重命名
      await fs.rename(tempPath, indexPath)

      console.log('💾 题库索引保存成功')
      this.emit('index-saved', {
        questions: this.indexData.totalQuestions,
        timestamp: Date.now()
      })
    } catch (error) {
      console.error('❌ 题库索引保存失败:', error)
      throw error
    }
  }

  /**
   * 创建索引备份
   */
  async createIndexBackup() {
    const indexPath = path.join(this.config.questionBankDir, this.config.indexFile)
    const backupDir = path.join(this.config.questionBankDir, 'backups')

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupPath = path.join(backupDir, `index-backup-${timestamp}.json`)

      if (await this.fileExists(indexPath)) {
        await fs.copyFile(indexPath, backupPath)

        // 清理旧备份（保留最近10个）
        await this.cleanupOldBackups(backupDir, 10)
      }
    } catch (error) {
      console.warn('⚠️ 索引备份失败:', error.message)
    }
  }

  /**
   * 清理旧备份文件
   */
  async cleanupOldBackups(backupDir, keepCount) {
    try {
      const files = await fs.readdir(backupDir)
      const backupFiles = files
        .filter(file => file.startsWith('index-backup-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          time: new Date(file.match(/index-backup-(.+)\.json/)[1].replace(/-/g, ':'))
        }))
        .sort((a, b) => b.time - a.time)

      if (backupFiles.length > keepCount) {
        const filesToDelete = backupFiles.slice(keepCount)

        for (const file of filesToDelete) {
          await fs.unlink(file.path)
          console.log(`🗑️ 删除旧备份: ${file.name}`)
        }
      }
    } catch (error) {
      console.warn('⚠️ 清理备份失败:', error.message)
    }
  }

  /**
   * 导入题库目录
   */
  async importQuestionBank(selectedPath) {
    if (this.currentImportProgress) {
      throw new Error('已有题库导入进行中')
    }

    const importId = this.generateImportId()
    this.currentImportProgress = {
      id: importId,
      sourcePath: selectedPath,
      startTime: Date.now(),
      status: 'initializing',
      progress: 0,
      totalFiles: 0,
      processedFiles: 0,
      errors: [],
      importedQuestions: 0,
      skippedQuestions: 0
    }

    try {
      this.emit('import-started', this.currentImportProgress)

      // 验证题库目录
      await this.validateQuestionBankDirectory(selectedPath)

      // 扫描文件
      const files = await this.scanQuestionBankFiles(selectedPath)
      this.currentImportProgress.totalFiles = files.length

      // 开始导入
      await this.processImportFiles(files, selectedPath)

      // 更新索引
      await this.saveIndex()

      // 完成导入
      this.currentImportProgress.status = 'completed'
      this.currentImportProgress.endTime = Date.now()
      this.currentImportProgress.duration = this.currentImportProgress.endTime - this.currentImportProgress.startTime

      this.emit('import-completed', this.currentImportProgress)
      console.log(`✅ 题库导入完成: ${this.currentImportProgress.importedQuestions} 道题目`)

      return this.currentImportProgress

    } catch (error) {
      this.currentImportProgress.status = 'failed'
      this.currentImportProgress.error = error.message
      this.currentImportProgress.endTime = Date.now()

      this.emit('import-failed', this.currentImportProgress)
      console.error('❌ 题库导入失败:', error)

      throw error
    } finally {
      this.currentImportProgress = null
    }
  }

  /**
   * 验证题库目录
   */
  async validateQuestionBankDirectory(dirPath) {
    try {
      const stats = await fs.stat(dirPath)
      if (!stats.isDirectory()) {
        throw new Error('选择的路径不是目录')
      }

      // 检查必要结构
      const requiredDirs = ['writing', 'listening', 'reading']
      const dirContents = await fs.readdir(dirPath)

      for (const requiredDir of requiredDirs) {
        const dirExists = dirContents.some(item =>
          item.toLowerCase() === requiredDir.toLowerCase()
        )
        if (!dirExists) {
          console.warn(`⚠️ 缺少建议目录: ${requiredDir}`)
        }
      }

      this.currentImportProgress.status = 'validated'
      console.log('✅ 题库目录验证通过')

    } catch (error) {
      throw new Error(`题库目录验证失败: ${error.message}`)
    }
  }

  /**
   * 扫描题库文件
   */
  async scanQuestionBankFiles(dirPath) {
    const files = []

    async function scanDirectory(currentPath) {
      try {
        const items = await fs.readdir(currentPath)

        for (const item of items) {
          const itemPath = path.join(currentPath, item)
          const stats = await fs.stat(itemPath)

          if (stats.isDirectory()) {
            await scanDirectory(itemPath)
          } else {
            const ext = path.extname(item).toLowerCase()
            if (this.config.supportedFormats.includes(ext)) {
              files.push({
                path: itemPath,
                relativePath: path.relative(dirPath, itemPath),
                size: stats.size,
                modifiedTime: stats.mtime,
                category: this.determineCategory(itemPath, item)
              })
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️ 扫描目录失败: ${currentPath}`, error.message)
      }
    }

    await scanDirectory.call(this, dirPath)

    this.currentImportProgress.status = 'scanned'
    console.log(`📂 扫描完成: 找到 ${files.length} 个题库文件`)

    return files
  }

  /**
   * 确定文件类别
   */
  determineCategory(filePath, fileName) {
    const lowerPath = filePath.toLowerCase()
    const lowerName = fileName.toLowerCase()

    if (lowerPath.includes('writing') || lowerPath.includes('作文')) {
      if (lowerName.includes('task1') || lowerName.includes('task-1')) {
        return 'writing-task1'
      }
      return 'writing-task2'
    }

    if (lowerPath.includes('listening') || lowerPath.includes('听力')) {
      return 'listening'
    }

    if (lowerPath.includes('reading') || lowerPath.includes('阅读')) {
      return 'reading'
    }

    if (lowerPath.includes('vocabulary') || lowerPath.includes('词汇')) {
      return 'vocabulary'
    }

    return 'other'
  }

  /**
   * 处理导入文件
   */
  async processImportFiles(files, basePath) {
    this.currentImportProgress.status = 'importing'

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      try {
        // 更新进度
        this.currentImportProgress.processedFiles = i + 1
        this.currentImportProgress.progress = Math.round(((i + 1) / files.length) * 100)

        this.emit('import-progress', {
          ...this.currentImportProgress,
          currentFile: file.relativePath
        })

        // 处理文件
        const result = await this.processQuestionFile(file, basePath)
        this.currentImportProgress.importedQuestions += result.imported
        this.currentImportProgress.skippedQuestions += result.skipped

        // 避免阻塞UI
        if (i % 10 === 0) {
          await new Promise(resolve => setImmediate(resolve))
        }

      } catch (error) {
        this.currentImportProgress.errors.push({
          file: file.relativePath,
          error: error.message
        })
        console.warn(`⚠️ 文件处理失败: ${file.relativePath}`, error.message)
      }
    }
  }

  /**
   * 处理单个题库文件
   */
  async processQuestionFile(file, basePath) {
    const result = { imported: 0, skipped: 0 }

    try {
      const content = await fs.readFile(file.path, 'utf8')
      const questions = this.parseQuestionFile(content, file.category)

      for (const question of questions) {
        try {
          // 生成唯一ID
          const questionId = this.generateQuestionId(question, file.relativePath)

          // 添加到索引
          await this.addQuestionToIndex(questionId, question, file, basePath)
          result.imported++

        } catch (error) {
          result.skipped++
          console.warn(`⚠️ 题目跳过: ${question.title || 'Unknown'}`, error.message)
        }
      }

    } catch (error) {
      console.warn(`⚠️ 文件解析失败: ${file.relativePath}`, error.message)
    }

    return result
  }

  /**
   * 解析题库文件
   */
  parseQuestionFile(content, category) {
    const questions = []

    try {
      // 尝试JSON格式
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        const data = JSON.parse(content)
        return Array.isArray(data) ? data : [data]
      }

      // 尝试Markdown格式
      if (content.includes('#') || content.includes('**')) {
        return this.parseMarkdownQuestions(content, category)
      }

      // 尝试CSV格式
      if (content.includes(',')) {
        return this.parseCSVQuestions(content, category)
      }

      // 默认按文本块解析
      return this.parseTextQuestions(content, category)

    } catch (error) {
      console.warn('⚠️ 文件格式解析失败，使用默认解析:', error.message)
      return this.parseTextQuestions(content, category)
    }
  }

  /**
   * 解析Markdown格式题目
   */
  parseMarkdownQuestions(content, category) {
    const questions = []
    const blocks = content.split(/\n\s*\n/)

    for (const block of blocks) {
      if (block.trim()) {
        const question = {
          id: null,
          title: this.extractTitle(block),
          content: block.trim(),
          category,
          difficulty: this.extractDifficulty(block),
          tags: this.extractTags(block),
          wordCount: block.trim().length,
          createdAt: new Date().toISOString()
        }
        questions.push(question)
      }
    }

    return questions
  }

  /**
   * 解析CSV格式题目
   */
  parseCSVQuestions(content, category) {
    const questions = []
    const lines = content.split('\n')
    const headers = lines[0].split(',').map(h => h.trim())

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim())

      if (values.length === headers.length) {
        const question = {
          id: null,
          title: values[0] || 'Untitled',
          content: values[1] || '',
          category,
          difficulty: values[2] || 'medium',
          tags: values[3] ? values[3].split(';') : [],
          wordCount: (values[1] || '').length,
          createdAt: new Date().toISOString()
        }
        questions.push(question)
      }
    }

    return questions
  }

  /**
   * 解析文本格式题目
   */
  parseTextQuestions(content, category) {
    const questions = []
    const blocks = content.split(/\n\s*\n/)

    for (const block of blocks) {
      if (block.trim().length > 50) { // 过滤太短的块
        const question = {
          id: null,
          title: block.trim().substring(0, 50) + '...',
          content: block.trim(),
          category,
          difficulty: 'medium',
          tags: [],
          wordCount: block.trim().length,
          createdAt: new Date().toISOString()
        }
        questions.push(question)
      }
    }

    return questions
  }

  /**
   * 提取标题
   */
  extractTitle(block) {
    const titleMatch = block.match(/^#\s+(.+)$/m) || block.match(/^(.+)$/m)
    return titleMatch ? titleMatch[1].trim() : 'Untitled'
  }

  /**
   * 提取难度
   */
  extractDifficulty(block) {
    const difficultyPatterns = {
      'easy': ['简单', '容易', 'easy', '初级'],
      'medium': ['中等', 'medium', '中级'],
      'hard': ['困难', '难', 'hard', '高级']
    }

    const lowerBlock = block.toLowerCase()
    for (const [level, patterns] of Object.entries(difficultyPatterns)) {
      if (patterns.some(pattern => lowerBlock.includes(pattern))) {
        return level
      }
    }

    return 'medium'
  }

  /**
   * 提取标签
   */
  extractTags(block) {
    const tags = []

    // 提取#标签
    const tagMatches = block.match(/#\w+/g)
    if (tagMatches) {
      tags.push(...tagMatches.map(tag => tag.substring(1)))
    }

    return tags
  }

  /**
   * 生成题目ID
   */
  generateQuestionId(question, filePath) {
    const content = question.title + question.content + filePath
    return crypto.createHash('md5').update(content).digest('hex')
  }

  /**
   * 添加题目到索引
   */
  async addQuestionToIndex(questionId, question, file, basePath) {
    if (!this.indexData.categories[question.category]) {
      this.indexData.categories[question.category] = {
        count: 0,
        questions: {}
      }
    }

    const category = this.indexData.categories[question.category]
    category.questions[questionId] = {
      id: questionId,
      title: question.title,
      content: question.content,
      difficulty: question.difficulty,
      tags: question.tags,
      wordCount: question.wordCount,
      createdAt: question.createdAt,
      sourceFile: file.relativePath,
      indexedAt: new Date().toISOString()
    }

    category.count++
    this.indexData.totalQuestions++

    // 更新标签集合
    for (const tag of question.tags) {
      if (!this.indexData.tags) {
        this.indexData.tags = new Set()
      }
      this.indexData.tags.add(tag)
    }
  }

  /**
   * 验证索引完整性
   */
  async validateIndex() {
    if (!this.indexData || !this.indexData.categories) {
      throw new Error('索引数据无效')
    }

    // 检查必要的字段
    const requiredFields = ['version', 'totalQuestions', 'categories']
    for (const field of requiredFields) {
      if (!(field in this.indexData)) {
        throw new Error(`索引缺少必要字段: ${field}`)
      }
    }

    console.log('✅ 索引完整性验证通过')
  }

  /**
   * 计算索引校验和
   */
  calculateIndexChecksum() {
    const dataForChecksum = {
      version: this.indexData.version,
      totalQuestions: this.indexData.totalQuestions,
      categories: this.indexData.categories,
      tags: Array.from(this.indexData.tags || [])
    }

    const content = JSON.stringify(dataForChecksum)
    return crypto.createHash('md5').update(content).digest('hex')
  }

  /**
   * 获取题目列表
   */
  async getQuestions(options = {}) {
    const {
      category,
      difficulty,
      tags,
      limit = 50,
      offset = 0,
      search
    } = options

    let questions = []

    // 收集所有题目
    for (const [catName, catData] of Object.entries(this.indexData.categories)) {
      if (category && catName !== category) continue

      for (const question of Object.values(catData.questions)) {
        // 难度过滤
        if (difficulty && question.difficulty !== difficulty) continue

        // 标签过滤
        if (tags && tags.length > 0) {
          const hasAllTags = tags.every(tag => question.tags.includes(tag))
          if (!hasAllTags) continue
        }

        // 搜索过滤
        if (search) {
          const searchLower = search.toLowerCase()
          const titleMatch = question.title.toLowerCase().includes(searchLower)
          const contentMatch = question.content.toLowerCase().includes(searchLower)
          if (!titleMatch && !contentMatch) continue
        }

        questions.push({
          ...question,
          category: catName
        })
      }
    }

    // 排序
    questions.sort((a, b) => new Date(b.indexedAt) - new Date(a.indexedAt))

    // 分页
    const total = questions.length
    questions = questions.slice(offset, offset + limit)

    return {
      questions,
      total,
      offset,
      limit,
      hasMore: offset + limit < total
    }
  }

  /**
   * 获取题目详情
   */
  async getQuestionById(questionId) {
    for (const category of Object.values(this.indexData.categories)) {
      if (category.questions[questionId]) {
        return category.questions[questionId]
      }
    }
    return null
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const stats = {
      totalQuestions: this.indexData.totalQuestions,
      categories: {},
      difficulties: { easy: 0, medium: 0, hard: 0 },
      tags: {},
      lastUpdated: this.indexData.updatedAt
    }

    // 分类统计
    for (const [catName, catData] of Object.entries(this.indexData.categories)) {
      stats.categories[catName] = catData.count

      // 难度统计
      for (const question of Object.values(catData.questions)) {
        stats.difficulties[question.difficulty] = (stats.difficulties[question.difficulty] || 0) + 1

        // 标签统计
        for (const tag of question.tags) {
          stats.tags[tag] = (stats.tags[tag] || 0) + 1
        }
      }
    }

    return stats
  }

  /**
   * 清理过期缓存
   */
  async cleanupExpiredCache() {
    const cacheDir = path.join(this.config.questionBankDir, this.config.cacheDir)
    const now = Date.now()

    try {
      const files = await fs.readdir(cacheDir)

      for (const file of files) {
        const filePath = path.join(cacheDir, file)
        const stats = await fs.stat(filePath)

        if (now - stats.mtime.getTime() > this.config.cacheExpiry) {
          await fs.unlink(filePath)
          this.cacheStats.evictions++
        }
      }

      console.log('🧹 过期缓存清理完成')
    } catch (error) {
      console.warn('⚠️ 缓存清理失败:', error.message)
    }
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 生成导入ID
   */
  generateImportId() {
    return `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 事件发射器
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data)
        } catch (error) {
          console.error(`事件监听器执行失败: ${event}`, error)
        }
      }
    }
  }

  /**
   * 添加事件监听器
   */
  on(event, listener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event).add(listener)
  }

  /**
   * 移除事件监听器
   */
  off(event, listener) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      totalQuestions: this.indexData?.totalQuestions || 0,
      categories: Object.keys(this.indexData?.categories || {}),
      currentImport: this.currentImportProgress,
      cacheStats: this.cacheStats,
      config: this.config
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.cache.clear()
    this.eventListeners.clear()
    this.currentImportProgress = null
    this.isInitialized = false

    console.log('🧹 题库服务资源清理完成')
  }
}

module.exports = QuestionBankService