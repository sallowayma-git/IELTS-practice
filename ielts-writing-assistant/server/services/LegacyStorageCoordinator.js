/**
 * Legacy双轨存储协调器
 * 协调Legacy系统本地存储与主应用数据库的同步
 */

const path = require('path')
const fs = require('fs').promises
const crypto = require('crypto')

class LegacyStorageCoordinator {
  constructor(database, config = {}) {
    this.db = database
    this.config = {
      // Legacy存储路径
      legacyStoragePath: config.legacyStoragePath || path.join(process.cwd(), 'data', 'legacy-storage'),
      // 同步间隔（毫秒）
      syncInterval: config.syncInterval || 30000, // 30秒
      // 冲突解决策略
      conflictStrategy: config.conflictStrategy || 'latest', // latest, legacy, main
      // 自动同步
      autoSync: config.autoSync !== false,
      // 备份保留数量
      backupCount: config.backupCount || 5,
      // 日志级别
      logLevel: config.logLevel || 'info'
    }

    // 存储表映射
    this.tableMappings = {
      // Legacy数据类型 -> 主应用表名
      'listening_progress': 'legacy_listening_progress',
      'reading_progress': 'legacy_reading_progress',
      'vocabulary_progress': 'legacy_vocabulary_progress',
      'user_settings': 'legacy_user_settings',
      'practice_records': 'legacy_practice_records',
      'bookmarks': 'legacy_bookmarks',
      'notes': 'legacy_notes'
    }

    // 同步状态
    this.syncStatus = {
      lastSync: null,
      inProgress: false,
      errors: [],
      stats: {
        totalRecords: 0,
        syncedRecords: 0,
        conflicts: 0,
        errors: 0
      }
    }

    // 同步队列
    this.syncQueue = []
    this.isProcessingQueue = false

    // 事件监听器
    this.eventListeners = new Map()

    // 初始化
    this.initialized = false
  }

  /**
   * 初始化存储协调器
   */
  async initialize() {
    try {
      // 创建存储目录
      await this.ensureStorageDirectories()

      // 创建数据库表
      await this.createDatabaseTables()

      // 启动自动同步
      if (this.config.autoSync) {
        this.startAutoSync()
      }

      // 加载上次的同步状态
      await this.loadSyncStatus()

      this.initialized = true
      this.log('info', 'Legacy存储协调器初始化完成')

      return true
    } catch (error) {
      this.log('error', 'Legacy存储协调器初始化失败', error)
      return false
    }
  }

  /**
   * 确保存储目录存在
   */
  async ensureStorageDirectories() {
    const directories = [
      this.config.legacyStoragePath,
      path.join(this.config.legacyStoragePath, 'backups'),
      path.join(this.config.legacyStoragePath, 'temp'),
      path.join(this.config.legacyStoragePath, 'logs')
    ]

    for (const dir of directories) {
      try {
        await fs.access(dir)
      } catch {
        await fs.mkdir(dir, { recursive: true })
        this.log('info', `创建存储目录: ${dir}`)
      }
    }
  }

  /**
   * 创建数据库表
   */
  async createDatabaseTables() {
    const tables = [
      // 听力进度表
      `CREATE TABLE IF NOT EXISTS legacy_listening_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        progress_data TEXT NOT NULL, -- JSON格式
        completion_rate REAL DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        last_position TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 阅读进度表
      `CREATE TABLE IF NOT EXISTS legacy_reading_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        passage_id TEXT NOT NULL,
        progress_data TEXT NOT NULL, -- JSON格式
        completion_rate REAL DEFAULT 0,
        time_spent INTEGER DEFAULT 0,
        last_position TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 词汇进度表
      `CREATE TABLE IF NOT EXISTS legacy_vocabulary_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        word_set_id TEXT NOT NULL,
        progress_data TEXT NOT NULL, -- JSON格式
        mastered_words TEXT, -- JSON数组
        difficult_words TEXT, -- JSON数组
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 用户设置表
      `CREATE TABLE IF NOT EXISTS legacy_user_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        settings_data TEXT NOT NULL, -- JSON格式
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 练习记录表
      `CREATE TABLE IF NOT EXISTS legacy_practice_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        module TEXT NOT NULL, -- listening, reading, vocabulary
        exercise_id TEXT NOT NULL,
        score REAL,
        answers TEXT, -- JSON格式
        time_spent INTEGER,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 书签表
      `CREATE TABLE IF NOT EXISTS legacy_bookmarks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        module TEXT NOT NULL,
        item_id TEXT NOT NULL,
        position TEXT,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 笔记表
      `CREATE TABLE IF NOT EXISTS legacy_notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        module TEXT NOT NULL,
        item_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        synced_at DATETIME,
        legacy_key TEXT UNIQUE,
        checksum TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // 同步日志表
      `CREATE TABLE IF NOT EXISTS legacy_sync_logs (
        id TEXT PRIMARY KEY,
        sync_type TEXT NOT NULL, -- full, incremental, conflict
        direction TEXT NOT NULL, -- legacy_to_main, main_to_legacy
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        records_processed INTEGER DEFAULT 0,
        records_synced INTEGER DEFAULT 0,
        conflicts INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        error_details TEXT, -- JSON格式
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ]

    for (const sql of tables) {
      await this.db.run(sql)
    }

    // 创建索引
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_legacy_listening_progress_user_id ON legacy_listening_progress(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_reading_progress_user_id ON legacy_reading_progress(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_vocabulary_progress_user_id ON legacy_vocabulary_progress(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_user_settings_user_id ON legacy_user_settings(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_practice_records_user_id ON legacy_practice_records(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_bookmarks_user_id ON legacy_bookmarks(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_notes_user_id ON legacy_notes(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_legacy_sync_logs_start_time ON legacy_sync_logs(start_time)'
    ]

    for (const sql of indexes) {
      await this.db.run(sql)
    }

    this.log('info', '数据库表创建完成')
  }

  /**
   * 从Legacy存储读取数据
   */
  async readFromLegacyStorage(userId, dataType) {
    try {
      const storageFile = path.join(this.config.legacyStoragePath, `${userId}_${dataType}.json`)

      const data = await fs.readFile(storageFile, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null // 文件不存在
      }
      throw error
    }
  }

  /**
   * 写入数据到Legacy存储
   */
  async writeToLegacyStorage(userId, dataType, data) {
    try {
      const storageFile = path.join(this.config.legacyStoragePath, `${userId}_${dataType}.json`)
      const tempFile = storageFile + '.tmp'

      // 写入临时文件
      await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8')

      // 原子性重命名
      await fs.rename(tempFile, storageFile)

      this.log('info', `Legacy数据已写入: ${storageFile}`)
      return true
    } catch (error) {
      this.log('error', `Legacy数据写入失败: ${dataType}`, error)
      return false
    }
  }

  /**
   * 从主应用数据库读取数据
   */
  async readFromMainDatabase(userId, dataType) {
    const tableName = this.tableMappings[dataType]
    if (!tableName) {
      throw new Error(`未知的数据类型: ${dataType}`)
    }

    const sql = `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY updated_at DESC`
    const records = await this.db.all(sql, [userId])

    return records.map(record => ({
      ...record,
      data: JSON.parse(record.progress_data || record.settings_data || record.answers || '{}')
    }))
  }

  /**
   * 写入数据到主应用数据库
   */
  async writeToMainDatabase(userId, dataType, record) {
    const tableName = this.tableMappings[dataType]
    if (!tableName) {
      throw new Error(`未知的数据类型: ${dataType}`)
    }

    // 计算校验和
    const checksum = this.calculateChecksum(record)

    // 根据数据类型构建SQL
    let sql, params

    switch (dataType) {
      case 'listening_progress':
      case 'reading_progress':
        sql = `
          INSERT OR REPLACE INTO ${tableName}
          (id, user_id, ${dataType === 'listening_progress' ? 'exercise_id' : 'passage_id'},
           progress_data, completion_rate, time_spent, last_position, updated_at, legacy_key, checksum)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        params = [
          record.id || this.generateId(),
          userId,
          record.exercise_id || record.passage_id,
          JSON.stringify(record.data),
          record.completion_rate || 0,
          record.time_spent || 0,
          record.last_position || null,
          new Date().toISOString(),
          record.legacy_key || null,
          checksum
        ]
        break

      case 'vocabulary_progress':
        sql = `
          INSERT OR REPLACE INTO ${tableName}
          (id, user_id, word_set_id, progress_data, mastered_words, difficult_words, updated_at, legacy_key, checksum)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        params = [
          record.id || this.generateId(),
          userId,
          record.word_set_id,
          JSON.stringify(record.data),
          JSON.stringify(record.mastered_words || []),
          JSON.stringify(record.difficult_words || []),
          new Date().toISOString(),
          record.legacy_key || null,
          checksum
        ]
        break

      case 'user_settings':
        sql = `
          INSERT OR REPLACE INTO ${tableName}
          (id, user_id, settings_data, updated_at, legacy_key, checksum)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        params = [
          record.id || this.generateId(),
          userId,
          JSON.stringify(record.data),
          new Date().toISOString(),
          record.legacy_key || null,
          checksum
        ]
        break

      case 'practice_records':
        sql = `
          INSERT OR REPLACE INTO ${tableName}
          (id, user_id, module, exercise_id, score, answers, time_spent, completed_at, updated_at, legacy_key, checksum)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        params = [
          record.id || this.generateId(),
          userId,
          record.module,
          record.exercise_id,
          record.score,
          JSON.stringify(record.answers || {}),
          record.time_spent,
          record.completed_at,
          new Date().toISOString(),
          record.legacy_key || null,
          checksum
        ]
        break

      default:
        throw new Error(`不支持的数据类型: ${dataType}`)
    }

    await this.db.run(sql, params)
    this.log('info', `数据已写入主数据库: ${dataType}`)
    return true
  }

  /**
   * 同步单个数据类型
   */
  async syncDataType(userId, dataType, direction = 'both') {
    const startTime = Date.now()
    let recordsProcessed = 0
    let recordsSynced = 0
    let conflicts = 0
    let errors = 0

    try {
      this.log('info', `开始同步数据: ${userId} - ${dataType} (${direction})`)

      // 读取两边的数据
      const legacyData = await this.readFromLegacyStorage(userId, dataType) || {}
      const mainData = await this.readFromMainDatabase(userId, dataType)

      recordsProcessed = Object.keys(legacyData).length + mainData.length

      // 根据方向进行同步
      if (direction === 'legacy_to_main' || direction === 'both') {
        const result = await this.syncLegacyToMain(userId, dataType, legacyData, mainData)
        recordsSynced += result.synced
        conflicts += result.conflicts
        errors += result.errors
      }

      if (direction === 'main_to_legacy' || direction === 'both') {
        const result = await this.syncMainToLegacy(userId, dataType, legacyData, mainData)
        recordsSynced += result.synced
        conflicts += result.conflicts
        errors += result.errors
      }

      // 记录同步日志
      await this.logSyncActivity({
        sync_type: 'incremental',
        direction,
        data_type: dataType,
        user_id: userId,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date().toISOString(),
        records_processed: recordsProcessed,
        records_synced: recordsSynced,
        conflicts,
        errors
      })

      this.log('info', `同步完成: ${dataType} (处理: ${recordsProcessed}, 同步: ${recordsSynced}, 冲突: ${conflicts}, 错误: ${errors})`)

      return {
        success: true,
        recordsProcessed,
        recordsSynced,
        conflicts,
        errors
      }

    } catch (error) {
      errors++
      this.log('error', `同步失败: ${dataType}`, error)

      await this.logSyncActivity({
        sync_type: 'incremental',
        direction,
        data_type: dataType,
        user_id: userId,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date().toISOString(),
        records_processed: recordsProcessed,
        records_synced: recordsSynced,
        conflicts,
        errors,
        error_details: JSON.stringify(error.message)
      })

      return {
        success: false,
        error: error.message,
        recordsProcessed,
        recordsSynced,
        conflicts,
        errors
      }
    }
  }

  /**
   * 从Legacy同步到主应用
   */
  async syncLegacyToMain(userId, dataType, legacyData, mainData) {
    let synced = 0
    let conflicts = 0
    let errors = 0

    // 构建主数据索引
    const mainDataIndex = new Map()
    for (const record of mainData) {
      if (record.legacy_key) {
        mainDataIndex.set(record.legacy_key, record)
      }
    }

    for (const [key, legacyRecord] of Object.entries(legacyData)) {
      try {
        const mainRecord = mainDataIndex.get(key)

        if (!mainRecord) {
          // 新记录，直接插入
          await this.writeToMainDatabase(userId, dataType, {
            ...legacyRecord,
            legacy_key: key
          })
          synced++
        } else {
          // 检查冲突
          if (this.hasConflict(legacyRecord, mainRecord)) {
            await this.resolveConflict(userId, dataType, key, legacyRecord, mainRecord)
            conflicts++
          } else if (this.shouldUpdate(legacyRecord, mainRecord)) {
            // 更新记录
            await this.writeToMainDatabase(userId, dataType, {
              ...legacyRecord,
              legacy_key: key,
              id: mainRecord.id
            })
            synced++
          }
        }
      } catch (error) {
        errors++
        this.log('error', `同步记录失败: ${key}`, error)
      }
    }

    return { synced, conflicts, errors }
  }

  /**
   * 从主应用同步到Legacy
   */
  async syncMainToLegacy(userId, dataType, legacyData, mainData) {
    let synced = 0
    let conflicts = 0
    let errors = 0

    // 构建Legacy数据索引
    const legacyDataIndex = new Map(Object.entries(legacyData))

    for (const mainRecord of mainData) {
      try {
        const key = mainRecord.legacy_key
        const legacyRecord = legacyDataIndex.get(key)

        if (!legacyRecord) {
          // 新记录，添加到Legacy
          legacyData[key] = {
            ...mainRecord.data,
            id: mainRecord.id,
            updated_at: mainRecord.updated_at
          }
          synced++
        } else {
          // 检查冲突
          if (this.hasConflict(legacyRecord, mainRecord)) {
            await this.resolveConflict(userId, dataType, key, legacyRecord, mainRecord)
            conflicts++
          } else if (this.shouldUpdateLegacy(legacyRecord, mainRecord)) {
            // 更新Legacy记录
            legacyData[key] = {
              ...mainRecord.data,
              id: mainRecord.id,
              updated_at: mainRecord.updated_at
            }
            synced++
          }
        }
      } catch (error) {
        errors++
        this.log('error', `同步记录到Legacy失败: ${mainRecord.id}`, error)
      }
    }

    // 写回Legacy存储
    if (synced > 0 || conflicts > 0) {
      await this.writeToLegacyStorage(userId, dataType, legacyData)
    }

    return { synced, conflicts, errors }
  }

  /**
   * 检查是否有冲突
   */
  hasConflict(legacyRecord, mainRecord) {
    const legacyTime = new Date(legacyRecord.updated_at || legacyRecord.timestamp)
    const mainTime = new Date(mainRecord.updated_at)

    // 如果两边都在最后同步时间后修改，则认为有冲突
    const lastSyncTime = mainRecord.synced_at ? new Date(mainRecord.synced_at) : new Date(0)

    return legacyTime > lastSyncTime && mainTime > lastSyncTime &&
           this.calculateChecksum(legacyRecord) !== mainRecord.checksum
  }

  /**
   * 检查是否应该更新主数据库
   */
  shouldUpdate(legacyRecord, mainRecord) {
    const legacyTime = new Date(legacyRecord.updated_at || legacyRecord.timestamp)
    const mainTime = new Date(mainRecord.updated_at)

    return legacyTime > mainTime
  }

  /**
   * 检查是否应该更新Legacy
   */
  shouldUpdateLegacy(legacyRecord, mainRecord) {
    const legacyTime = new Date(legacyRecord.updated_at || legacyRecord.timestamp)
    const mainTime = new Date(mainRecord.updated_at)

    return mainTime > legacyTime
  }

  /**
   * 解决冲突
   */
  async resolveConflict(userId, dataType, key, legacyRecord, mainRecord) {
    const resolution = this.config.conflictStrategy
    let resolvedRecord

    switch (resolution) {
      case 'latest':
        // 使用最新的记录
        const legacyTime = new Date(legacyRecord.updated_at || legacyRecord.timestamp)
        const mainTime = new Date(mainRecord.updated_at)

        if (legacyTime > mainTime) {
          resolvedRecord = legacyRecord
        } else {
          resolvedRecord = { ...mainRecord.data, updated_at: mainRecord.updated_at }
        }
        break

      case 'legacy':
        // 优先使用Legacy记录
        resolvedRecord = legacyRecord
        break

      case 'main':
        // 优先使用主应用记录
        resolvedRecord = { ...mainRecord.data, updated_at: mainRecord.updated_at }
        break

      default:
        // 默认使用合并策略
        resolvedRecord = this.mergeRecords(legacyRecord, mainRecord)
    }

    // 更新两边的数据
    await this.writeToMainDatabase(userId, dataType, {
      ...resolvedRecord,
      legacy_key: key,
      id: mainRecord.id
    })

    const legacyData = await this.readFromLegacyStorage(userId, dataType) || {}
    legacyData[key] = resolvedRecord
    await this.writeToLegacyStorage(userId, dataType, legacyData)

    this.log('info', `冲突已解决: ${dataType} - ${key} (策略: ${resolution})`)
  }

  /**
   * 合并记录
   */
  mergeRecords(legacyRecord, mainRecord) {
    // 简单的合并策略：以主应用为基础，用Legacy数据更新非空字段
    const merged = { ...mainRecord.data }

    for (const [key, value] of Object.entries(legacyRecord)) {
      if (key !== 'updated_at' && key !== 'timestamp' && value !== null && value !== undefined) {
        merged[key] = value
      }
    }

    merged.updated_at = new Date().toISOString()
    return merged
  }

  /**
   * 全量同步
   */
  async fullSync(userId) {
    const startTime = Date.now()
    this.log('info', `开始全量同步: ${userId}`)

    const dataTypes = Object.keys(this.tableMappings)
    const results = []

    for (const dataType of dataTypes) {
      const result = await this.syncDataType(userId, dataType, 'both')
      results.push({ dataType, ...result })
    }

    // 更新同步状态
    this.syncStatus.lastSync = new Date().toISOString()
    this.syncStatus.inProgress = false
    await this.saveSyncStatus()

    const totalTime = Date.now() - startTime
    const totalRecords = results.reduce((sum, r) => sum + r.recordsProcessed, 0)
    const totalSynced = results.reduce((sum, r) => sum + r.recordsSynced, 0)
    const totalConflicts = results.reduce((sum, r) => sum + r.conflicts, 0)
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0)

    this.log('info', `全量同步完成: ${userId} (耗时: ${totalTime}ms, 处理: ${totalRecords}, 同步: ${totalSynced}, 冲突: ${totalConflicts}, 错误: ${totalErrors})`)

    return {
      success: totalErrors === 0,
      totalTime,
      summary: {
        totalRecords,
        totalSynced,
        totalConflicts,
        totalErrors
      },
      details: results
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    setInterval(async () => {
      if (!this.syncStatus.inProgress) {
        try {
          this.syncStatus.inProgress = true
          // 这里可以获取需要同步的用户列表
          const userIds = await this.getActiveUserIds()

          for (const userId of userIds) {
            await this.incrementalSync(userId)
          }
        } catch (error) {
          this.log('error', '自动同步失败', error)
        } finally {
          this.syncStatus.inProgress = false
        }
      }
    }, this.config.syncInterval)

    this.log('info', `自动同步已启动 (间隔: ${this.config.syncInterval}ms)`)
  }

  /**
   * 增量同步
   */
  async incrementalSync(userId) {
    // 获取上次同步时间
    const lastSync = this.syncStatus.lastSync

    if (!lastSync) {
      return await this.fullSync(userId)
    }

    // 只同步自上次同步以来有变化的数据
    const dataTypes = Object.keys(this.tableMappings)

    for (const dataType of dataTypes) {
      await this.syncDataType(userId, dataType, 'both')
    }

    this.syncStatus.lastSync = new Date().toISOString()
    await this.saveSyncStatus()
  }

  /**
   * 获取活跃用户ID列表
   */
  async getActiveUserIds() {
    // 从数据库获取活跃用户
    const sql = `
      SELECT DISTINCT user_id FROM legacy_listening_progress
      UNION SELECT DISTINCT user_id FROM legacy_reading_progress
      UNION SELECT DISTINCT user_id FROM legacy_vocabulary_progress
      UNION SELECT DISTINCT user_id FROM legacy_user_settings
      LIMIT 10
    `

    const result = await this.db.all(sql)
    return result.map(row => row.user_id)
  }

  /**
   * 计算校验和
   */
  calculateChecksum(data) {
    const str = JSON.stringify(data)
    return crypto.createHash('md5').update(str).digest('hex')
  }

  /**
   * 记录同步活动
   */
  async logSyncActivity(logData) {
    const sql = `
      INSERT INTO legacy_sync_logs
      (id, sync_type, direction, start_time, end_time, records_processed,
       records_synced, conflicts, errors, error_details, data_type, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      this.generateId(),
      logData.sync_type,
      logData.direction,
      logData.start_time,
      logData.end_time,
      logData.records_processed,
      logData.records_synced,
      logData.conflicts,
      logData.errors,
      logData.error_details || null,
      logData.data_type || null,
      logData.user_id
    ]

    await this.db.run(sql, params)
  }

  /**
   * 加载同步状态
   */
  async loadSyncStatus() {
    try {
      const statusFile = path.join(this.config.legacyStoragePath, 'sync-status.json')
      const data = await fs.readFile(statusFile, 'utf8')
      this.syncStatus = { ...this.syncStatus, ...JSON.parse(data) }
    } catch (error) {
      // 文件不存在，使用默认状态
      this.log('info', '同步状态文件不存在，使用默认状态')
    }
  }

  /**
   * 保存同步状态
   */
  async saveSyncStatus() {
    try {
      const statusFile = path.join(this.config.legacyStoragePath, 'sync-status.json')
      await fs.writeFile(statusFile, JSON.stringify(this.syncStatus, null, 2), 'utf8')
    } catch (error) {
      this.log('error', '保存同步状态失败', error)
    }
  }

  /**
   * 备份数据
   */
  async backupData(userId) {
    const backupDir = path.join(this.config.legacyStoragePath, 'backups')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = path.join(backupDir, `backup_${userId}_${timestamp}.json`)

    try {
      const backup = {
        userId,
        timestamp: new Date().toISOString(),
        data: {}
      }

      // 收集所有数据类型的数据
      for (const dataType of Object.keys(this.tableMappings)) {
        const data = await this.readFromLegacyStorage(userId, dataType)
        if (data) {
          backup.data[dataType] = data
        }
      }

      await fs.writeFile(backupFile, JSON.stringify(backup, null, 2), 'utf8')

      // 清理旧备份
      await this.cleanupOldBackups(userId)

      this.log('info', `数据备份完成: ${backupFile}`)
      return backupFile
    } catch (error) {
      this.log('error', '数据备份失败', error)
      return null
    }
  }

  /**
   * 清理旧备份
   */
  async cleanupOldBackups(userId) {
    try {
      const backupDir = path.join(this.config.legacyStoragePath, 'backups')
      const files = await fs.readdir(backupDir)

      const userBackups = files
        .filter(file => file.startsWith(`backup_${userId}_`))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          time: new Date(file.split('_').pop().replace('.json', '').replace(/-/g, ':'))
        }))
        .sort((a, b) => b.time - a.time)

      // 删除超过保留数量的旧备份
      if (userBackups.length > this.config.backupCount) {
        const filesToDelete = userBackups.slice(this.config.backupCount)

        for (const file of filesToDelete) {
          await fs.unlink(file.path)
          this.log('info', `删除旧备份: ${file.name}`)
        }
      }
    } catch (error) {
      this.log('error', '清理旧备份失败', error)
    }
  }

  /**
   * 生成ID
   */
  generateId() {
    return crypto.randomUUID()
  }

  /**
   * 日志记录
   */
  log(level, message, error = null) {
    const logLevels = { error: 0, warn: 1, info: 2, debug: 3 }
    const currentLevel = logLevels[this.config.logLevel] || 2

    if (logLevels[level] <= currentLevel) {
      const timestamp = new Date().toISOString()
      const logMessage = `[${timestamp}] [LegacyStorage] [${level.toUpperCase()}] ${message}`

      if (level === 'error') {
        console.error(logMessage, error)
      } else {
        console.log(logMessage)
      }

      // 触发事件
      this.emit('log', { level, message, error, timestamp })
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
   * 触发事件
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
   * 获取统计信息
   */
  getStats() {
    return {
      initialized: this.initialized,
      syncStatus: this.syncStatus,
      queueLength: this.syncQueue.length,
      isProcessingQueue: this.isProcessingQueue,
      config: this.config,
      tableMappings: Object.keys(this.tableMappings)
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    // 保存最后的同步状态
    await this.saveSyncStatus()

    // 清理事件监听器
    this.eventListeners.clear()

    this.initialized = false
    this.log('info', 'Legacy存储协调器资源清理完成')
  }
}

module.exports = LegacyStorageCoordinator