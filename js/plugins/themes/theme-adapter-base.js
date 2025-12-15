/**
 * Theme Adapter Base (主题适配器基类)
 * 
 * 提供主题变体与主系统之间的统一接口，包括：
 * - 数据访问：题库索引、练习记录
 * - 数据写入：保存练习记录
 * - 路径解析：资源路径构建与回退
 * - UI 反馈：消息显示
 * - 事件监听：storage 事件同步
 * 
 * @version 1.0.0
 */
(function () {
  'use strict';

  // 存储键常量 - 与主系统保持一致
  const STORAGE_KEYS = {
    EXAM_INDEX: 'exam_index',
    PRACTICE_RECORDS: 'practice_records'
  };

  // 有效的 type 值
  const VALID_TYPES = new Set(['reading', 'listening']);

  // 路径解析备用策略顺序
  const PATH_FALLBACK_ORDER = ['map', 'fallback', 'raw', 'relative-up', 'relative-design'];

  // 练习完成消息类型集合
  const PRACTICE_COMPLETE_TYPES = new Set([
    'PRACTICE_COMPLETE',
    'PRACTICE_COMPLETED',
    'SESSION_COMPLETE',
    'SESSION_COMPLETED',
    'EXAM_FINISHED',
    'QUIZ_COMPLETE',
    'QUIZ_COMPLETED',
    'TEST_COMPLETE',
    'LESSON_COMPLETE',
    'WORKOUT_COMPLETE'
  ]);

  /**
   * 深拷贝数组
   */
  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  /**
   * 安全解析 JSON
   */
  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  /**
   * 规范化路径基础部分
   */
  function normalizeBasePath(value) {
    if (!value) return '';
    return String(value).replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  /**
   * 规范化路径段
   */
  function normalizePathSegment(value) {
    if (!value) return '';
    return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
  }

  /**
   * 判断是否为绝对路径
   */
  function isAbsolutePath(value) {
    if (!value) return false;
    return /^(?:[a-z]+:)?\/\//i.test(value) || /^[A-Za-z]:\\/.test(value);
  }

  /**
   * 拼接资源路径
   */
  function joinResourcePath(base, folder, file) {
    if (isAbsolutePath(file)) return file;
    if (isAbsolutePath(folder)) {
      const folderPart = normalizePathSegment(folder);
      const filePart = normalizePathSegment(file);
      return filePart ? folderPart + '/' + filePart : folderPart;
    }
    const segments = [];
    const basePart = normalizeBasePath(base);
    if (basePart) segments.push(basePart);
    const folderPart = normalizePathSegment(folder);
    if (folderPart) segments.push(folderPart);
    const filePart = normalizePathSegment(file);
    if (filePart) segments.push(filePart);
    return segments.join('/');
  }

  /**
   * 编码资源路径
   */
  function encodeResourcePath(path) {
    if (!path) return '';
    if (isAbsolutePath(path)) return path;
    return encodeURI(path).replace(/#/g, '%23');
  }

  /**
   * 类型规范化 - 将 type 字段规范化为 'reading' 或 'listening'
   * @param {string} type - 原始类型值
   * @returns {string} - 规范化后的类型 ('reading' | 'listening')
   */
  function normalizeType(type) {
    if (!type) return 'reading'; // 默认为 reading
    const normalized = String(type).toLowerCase().trim();
    
    // 直接匹配
    if (VALID_TYPES.has(normalized)) {
      return normalized;
    }
    
    // 别名映射
    if (normalized === 'read' || normalized === 'r') {
      return 'reading';
    }
    if (normalized === 'listen' || normalized === 'l' || normalized === 'audio') {
      return 'listening';
    }
    
    // 默认返回 reading
    return 'reading';
  }

  /**
   * 规范化题目数据中的 type 字段
   * @param {Array} exams - 题目数组
   * @returns {Array} - 规范化后的题目数组
   */
  function normalizeExamTypes(exams) {
    if (!Array.isArray(exams)) return [];
    return exams.map(exam => {
      if (!exam) return exam;
      return {
        ...exam,
        type: normalizeType(exam.type)
      };
    });
  }

  /**
   * 记录去重 - 根据 sessionId 去重，保留时间戳较新的记录
   * @param {Array} records - 练习记录数组
   * @returns {Array} - 去重后的记录数组
   */
  function deduplicateRecords(records) {
    if (!Array.isArray(records)) return [];
    
    const recordMap = new Map();
    
    records.forEach(record => {
      if (!record) return;
      
      // 使用 sessionId 作为主键，如果没有则使用 id
      const key = record.sessionId || record.id;
      if (!key) {
        // 没有标识符的记录直接保留
        recordMap.set(Symbol(), record);
        return;
      }
      
      const existing = recordMap.get(key);
      if (!existing) {
        recordMap.set(key, record);
        return;
      }
      
      // 比较时间戳，保留较新的
      const existingTime = getRecordTimestamp(existing);
      const currentTime = getRecordTimestamp(record);
      
      if (currentTime > existingTime) {
        recordMap.set(key, record);
      }
    });
    
    return Array.from(recordMap.values());
  }

  /**
   * 获取记录的时间戳
   */
  function getRecordTimestamp(record) {
    if (!record) return 0;
    
    // 优先使用 timestamp 字段
    if (typeof record.timestamp === 'number') {
      return record.timestamp;
    }
    
    // 尝试解析 date 字段
    if (record.date) {
      const parsed = new Date(record.date).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    
    // 尝试使用 id（通常是时间戳）
    if (typeof record.id === 'number') {
      return record.id;
    }
    
    return 0;
  }

  /**
   * 规范化消息类型
   * @param {string} value - 原始消息类型
   * @returns {string} - 大写规范化后的消息类型
   */
  function normalizeMessageType(value) {
    return String(value || '').toUpperCase();
  }

  /**
   * 安全转换为对象
   */
  function asObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  /**
   * 转换为有限数字
   */
  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  /**
   * 从多个来源中提取第一个有效数字
   */
  function pickFirstNumber(keys, sources) {
    for (let i = 0; i < sources.length; i += 1) {
      const source = asObject(sources[i]);
      for (let j = 0; j < keys.length; j += 1) {
        const candidate = source[keys[j]];
        const num = toFiniteNumber(candidate);
        if (num !== null) {
          return num;
        }
      }
    }
    return null;
  }

  /**
   * 提取答案条目
   */
  function extractAnswerEntries(target) {
    if (!target) return [];
    if (Array.isArray(target)) {
      return target.map((value, index) => ({ key: index, value }));
    }
    if (typeof target === 'object') {
      return Object.keys(target).map((key) => ({ key, value: target[key] }));
    }
    return [];
  }

  /**
   * 从答案比较结果中计算分数
   */
  function countFromAnswerComparison(comparison) {
    const entries = extractAnswerEntries(comparison);
    if (!entries.length) {
      return { total: null, correct: null };
    }
    let total = 0;
    let correct = 0;
    entries.forEach(({ value }) => {
      total += 1;
      if (value === true) {
        correct += 1;
        return;
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          if (parsed === true || parsed?.isCorrect === true || parsed?.correct === true || parsed?.result === true) {
            correct += 1;
          }
          return;
        } catch (_) {}
      }
      if (typeof value === 'object' && value) {
        if (value.isCorrect === true || value.correct === true || value.result === true) {
          correct += 1;
        }
      }
    });
    return { total, correct };
  }

  /**
   * 从答案和正确答案中计算分数
   */
  function countFromAnswers(answers, correctAnswers) {
    const entries = extractAnswerEntries(answers);
    if (!entries.length) {
      return { total: null, correct: null };
    }
    let correct = null;
    if (correctAnswers && typeof correctAnswers === 'object') {
      correct = 0;
      entries.forEach(({ key, value }) => {
        if (Object.prototype.hasOwnProperty.call(correctAnswers, key) && correctAnswers[key] === value) {
          correct += 1;
        }
      });
    }
    return { total: entries.length, correct };
  }

  /**
   * 规范化练习完成消息的 payload
   * @param {Object} payload - 原始消息数据
   * @returns {Object} - 规范化后的数据
   */
  function normalizePracticePayload(payload) {
    const envelope = asObject(payload);
    const nestedData = asObject(envelope.data);
    const scoreInfo = asObject(envelope.scoreInfo);
    const result = asObject(envelope.result);
    const nestedResult = asObject(nestedData.result);
    const meta = asObject(envelope.meta);
    const sources = [scoreInfo, result, nestedResult, nestedData, envelope, meta];

    const percentageKeys = ['percentage', 'accuracy', 'percent', 'scorePercent'];
    const correctKeys = ['correct', 'score', 'correctCount', 'right', 'correctAnswers'];
    const totalKeys = ['total', 'totalQuestions', 'questionCount', 'questions', 'max', 'totalCount'];
    const durationKeys = ['duration', 'totalTime', 'elapsedTime', 'timeSpent', 'time'];

    let correct = pickFirstNumber(correctKeys, sources);
    let total = pickFirstNumber(totalKeys, sources);

    // 从 answerComparison 计算
    const comparison = envelope.answerComparison
      || nestedData.answerComparison
      || result.answerComparison
      || nestedResult.answerComparison;
    const comparisonCount = countFromAnswerComparison(comparison);

    // 从 answers 计算
    const answers = envelope.answers
      || nestedData.answers
      || nestedData.userAnswers
      || result.answers
      || nestedResult.answers
      || envelope.userAnswers;
    const correctAnswers = envelope.correctAnswers
      || nestedData.correctAnswers
      || result.correctAnswers
      || nestedResult.correctAnswers;
    const answerCount = countFromAnswers(answers, correctAnswers);

    if (total === null && comparisonCount.total !== null) {
      total = comparisonCount.total;
    }
    if (total === null && answerCount.total !== null) {
      total = answerCount.total;
    }

    if (correct === null && comparisonCount.correct !== null) {
      correct = comparisonCount.correct;
    }
    if (correct === null && answerCount.correct !== null) {
      correct = answerCount.correct;
    }

    if (correct !== null && total !== null && correct > total) {
      correct = total;
    }

    const percentage = pickFirstNumber(percentageKeys, sources);
    let normalizedPercentage = percentage;
    if (normalizedPercentage === null && correct !== null && total) {
      normalizedPercentage = Math.round((correct / total) * 100);
    }

    const duration = pickFirstNumber(durationKeys, sources);

    const sessionId = envelope.sessionId
      || envelope.sessionID
      || nestedData.sessionId
      || nestedData.sessionID
      || result.sessionId
      || nestedResult.sessionId;

    const completedAt = envelope.endTime
      || envelope.completedAt
      || envelope.date
      || nestedData.endTime
      || nestedData.completedAt
      || result.endTime
      || nestedResult.endTime
      || envelope.timestamp;

    const title = envelope.title
      || nestedData.title
      || result.title
      || nestedResult.title
      || envelope.examTitle
      || nestedData.examTitle;

    const category = envelope.category
      || nestedData.category
      || result.category
      || nestedResult.category
      || envelope.part
      || nestedData.part;

    const examId = envelope.examId
      || envelope.examID
      || nestedData.examId
      || nestedData.examID
      || result.examId
      || nestedResult.examId;

    const examType = envelope.type
      || nestedData.type
      || result.type
      || nestedResult.type
      || envelope.examType
      || nestedData.examType;

    return {
      examId,
      correct,
      total,
      percentage: normalizedPercentage,
      duration,
      sessionId,
      completedAt,
      title,
      category,
      type: examType,
      raw: payload
    };
  }


  /**
   * ThemeAdapterBase - 主题适配器基类
   */
  const ThemeAdapterBase = {
    version: '1.0.0',
    isReady: false,
    
    // 内部状态
    _examIndex: [],
    _practiceRecords: [],
    _callbacks: [],
    _storageListenerInstalled: false,
    _messageListenerInstalled: false,
    _messageCallbacks: [],

    /**
     * 获取存储键名（与主系统一致）
     * @returns {Object} 存储键对象
     */
    getStorageKeys() {
      return { ...STORAGE_KEYS };
    },

    /**
     * 初始化适配器
     * @param {Object} options - 初始化选项
     * @returns {Promise<void>}
     */
    async init(options = {}) {
      console.log('[ThemeAdapterBase] 开始初始化...');
      
      try {
        // 安装 storage 事件监听
        this._installStorageListener();
        
        // 安装 postMessage 事件监听
        this._installMessageListener();
        
        // 加载初始数据
        await this._loadExamIndex();
        await this._loadPracticeRecords();
        
        this.isReady = true;
        console.log('[ThemeAdapterBase] 初始化完成', {
          examCount: this._examIndex.length,
          recordCount: this._practiceRecords.length
        });
      } catch (error) {
        console.error('[ThemeAdapterBase] 初始化失败:', error);
        throw error;
      }
    },

    /**
     * 获取题库索引
     * @returns {Array} 题库索引数组
     */
    getExamIndex() {
      return cloneArray(this._examIndex);
    },

    /**
     * 获取练习记录
     * @returns {Array} 练习记录数组
     */
    getPracticeRecords() {
      return cloneArray(this._practiceRecords);
    },

    /**
     * 根据 ID 获取题目
     * @param {string} id - 题目 ID
     * @returns {Object|null} 题目对象或 null
     */
    getExamById(id) {
      return this._examIndex.find(exam => exam && exam.id === id) || null;
    },

    /**
     * 保存练习记录
     * @param {Object} record - 练习记录
     * @returns {Promise<void>}
     */
    async savePracticeRecord(record) {
      if (!record) {
        console.warn('[ThemeAdapterBase] 无效的练习记录');
        return;
      }

      try {
        // 规范化 type 字段
        const normalizedRecord = {
          ...record,
          type: normalizeType(record.type),
          timestamp: record.timestamp || Date.now()
        };

        // 添加到本地缓存
        this._practiceRecords.unshift(normalizedRecord);
        
        // 去重
        this._practiceRecords = deduplicateRecords(this._practiceRecords);

        // 写入存储
        await this._writeToStorage(STORAGE_KEYS.PRACTICE_RECORDS, this._practiceRecords);
        
        // 触发更新回调
        this._notifyDataUpdated({ practiceRecords: this._practiceRecords });
        
        console.log('[ThemeAdapterBase] 练习记录已保存', normalizedRecord.id || normalizedRecord.sessionId);
      } catch (error) {
        console.error('[ThemeAdapterBase] 保存练习记录失败:', error);
        throw error;
      }
    },

    /**
     * 构建资源路径
     * @param {Object} exam - 题目对象
     * @param {string} kind - 资源类型 ('html' | 'pdf')
     * @returns {string} 资源路径
     */
    buildResourcePath(exam, kind) {
      if (!exam) return '';

      // 优先使用 window.hpPath 或 window.buildResourcePath
      if (window.hpPath && typeof window.hpPath.buildResourcePath === 'function') {
        try {
          const result = window.hpPath.buildResourcePath(exam, kind);
          if (result) return result;
        } catch (error) {
          console.warn('[ThemeAdapterBase] hpPath.buildResourcePath 失败:', error);
        }
      }

      if (typeof window.buildResourcePath === 'function') {
        try {
          const result = window.buildResourcePath(exam, kind);
          if (result) return result;
        } catch (error) {
          console.warn('[ThemeAdapterBase] window.buildResourcePath 失败:', error);
        }
      }

      // 备用路径生成逻辑
      return this._buildFallbackPath(exam, kind);
    },

    /**
     * 获取资源路径尝试列表（按顺序：map → fallback → raw → relative-up → relative-design）
     * @param {Object} exam - 题目对象
     * @param {string} kind - 资源类型
     * @returns {Array} 路径尝试列表，每项包含 { label, path }
     */
    getResourceAttempts(exam, kind) {
      if (!exam) return [];

      const attempts = [];
      const seen = new Set();

      const addAttempt = (label, path) => {
        if (path && !seen.has(path)) {
          seen.add(path);
          attempts.push({ label, path });
        }
      };

      const base = window.HP_BASE_PREFIX || './';
      const folder = exam.path || '';
      const primaryFile = kind === 'pdf'
        ? (exam.pdfFilename || exam.filename || '')
        : (exam.filename || '');

      // 1. map - 使用外部路径解析器（不调用 this.buildResourcePath 避免循环）
      let mapPath = '';
      if (window.hpPath && typeof window.hpPath.buildResourcePath === 'function') {
        try {
          mapPath = window.hpPath.buildResourcePath(exam, kind) || '';
        } catch (_) {}
      } else if (typeof window.buildResourcePath === 'function') {
        try {
          mapPath = window.buildResourcePath(exam, kind) || '';
        } catch (_) {}
      }
      addAttempt('map', mapPath);

      // 2. fallback - 使用 HP_BASE_PREFIX
      addAttempt('fallback', encodeResourcePath(joinResourcePath(base, folder, primaryFile)));

      // 3. raw - 直接使用 path + filename
      addAttempt('raw', encodeResourcePath(joinResourcePath('', folder, primaryFile)));

      // 4. relative-up - 上一级目录
      addAttempt('relative-up', encodeResourcePath(joinResourcePath('..', folder, primaryFile)));

      // 5. relative-design - 上两级目录（适用于 .superdesign/design_iterations/ 下的主题）
      addAttempt('relative-design', encodeResourcePath(joinResourcePath('../..', folder, primaryFile)));

      return attempts;
    },

    /**
     * 获取备用路径策略顺序
     * @returns {Array<string>} 策略名称列表
     */
    getFallbackOrder() {
      return [...PATH_FALLBACK_ORDER];
    },

    /**
     * 打开题目（包装器）
     * @param {string|Object} examOrId - 题目 ID 或题目对象
     * @param {Object} options - 打开选项
     * @returns {Window|null} 打开的窗口对象
     */
    openExam(examOrId, options = {}) {
      // 解析题目
      const exam = typeof examOrId === 'string' 
        ? this.getExamById(examOrId) 
        : examOrId;
      
      if (!exam) {
        this.showMessage('未找到题目', 'error');
        return null;
      }

      const examId = exam.id;

      // 优先使用主系统的 openExam
      if (window.app && typeof window.app.openExam === 'function') {
        try {
          window.app.openExam(examId, options);
          return null; // app.openExam 内部管理窗口
        } catch (error) {
          console.warn('[ThemeAdapterBase] app.openExam 失败，使用本地逻辑:', error);
        }
      }

      if (typeof window.openExam === 'function') {
        try {
          window.openExam(examId, options);
          return null;
        } catch (error) {
          console.warn('[ThemeAdapterBase] window.openExam 失败，使用本地逻辑:', error);
        }
      }

      // 本地打开逻辑
      return this._openExamLocal(exam, options);
    },

    /**
     * 本地打开题目逻辑
     * @private
     */
    _openExamLocal(exam, options = {}) {
      if (!exam) return null;

      // 如果没有 HTML 版本，尝试打开 PDF
      if (!exam.hasHtml && exam.pdfFilename) {
        return this._openPDF(exam);
      }

      // 构建资源路径
      const fullPath = this.buildResourcePath(exam, 'html');
      if (!fullPath) {
        this.showMessage('无法解析题目路径', 'error');
        return null;
      }

      // 计算窗口特性
      const windowFeatures = options.windowFeatures || this._calculateWindowFeatures();
      const windowName = options.windowName || `exam_${exam.id}`;

      // 打开窗口
      let examWindow = null;
      try {
        examWindow = window.open(fullPath, windowName, windowFeatures);
      } catch (error) {
        console.error('[ThemeAdapterBase] window.open 失败:', error);
      }

      if (!examWindow) {
        this.showMessage('无法打开窗口，请检查弹窗设置', 'error');
        return null;
      }

      this.showMessage('正在打开: ' + exam.title, 'success');

      // 启动握手协议
      this._startHandshake(examWindow, exam);

      return examWindow;
    },

    /**
     * 打开 PDF 文件
     * @private
     */
    _openPDF(exam) {
      if (!exam || !exam.pdfFilename) {
        this.showMessage('未找到 PDF 文件', 'error');
        return null;
      }

      const fullPath = this.buildResourcePath(exam, 'pdf');
      if (!fullPath) {
        this.showMessage('无法解析 PDF 路径', 'error');
        return null;
      }

      // 优先使用主系统的 PDF 打开函数
      if (typeof window.openPDFSafely === 'function') {
        try {
          window.openPDFSafely(fullPath, exam.title);
          return null;
        } catch (error) {
          console.warn('[ThemeAdapterBase] openPDFSafely 失败:', error);
        }
      }

      // 回退到直接打开
      const pdfWindow = window.open(fullPath, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes');
      if (!pdfWindow) {
        this.showMessage('无法打开 PDF，请检查弹窗设置', 'error');
        return null;
      }

      return pdfWindow;
    },

    /**
     * 计算窗口特性
     * @private
     */
    _calculateWindowFeatures() {
      const screenWidth = window.screen.availWidth || 1200;
      const screenHeight = window.screen.availHeight || 800;
      const width = Math.min(Math.floor(screenWidth * 0.8), 1400);
      const height = Math.min(Math.floor(screenHeight * 0.8), 900);
      const left = Math.floor((screenWidth - width) / 2);
      const top = Math.floor((screenHeight - height) / 2);
      return `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`;
    },

    /**
     * 启动握手协议
     * @private
     */
    _startHandshake(examWindow, exam) {
      if (!examWindow || !exam) return;

      const sessionId = `${exam.id}_${Date.now()}`;
      const initPayload = {
        examId: exam.id,
        sessionId,
        parentOrigin: window.location.origin,
        examTitle: exam.title,
        examType: exam.type
      };

      // 存储会话信息
      this._activeSessions = this._activeSessions || new Map();
      this._activeSessions.set(sessionId, {
        examId: exam.id,
        window: examWindow,
        timer: null,
        attempts: 0
      });

      let attempts = 0;
      const maxAttempts = 30; // ~9s

      const tick = () => {
        if (!examWindow || examWindow.closed) {
          this._cleanupSession(sessionId);
          return;
        }

        try {
          examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
          examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
        } catch (error) {
          console.warn('[ThemeAdapterBase] postMessage 失败:', error);
        }

        attempts++;
        if (attempts >= maxAttempts) {
          console.warn('[ThemeAdapterBase] 握手超时，练习页可能未加载增强器');
          this._cleanupSession(sessionId);
        }
      };

      const timer = setInterval(tick, 300);
      const session = this._activeSessions.get(sessionId);
      if (session) {
        session.timer = timer;
      }

      // 立即发送第一次
      tick();
    },

    /**
     * 清理会话
     * @private
     */
    _cleanupSession(sessionId) {
      if (!this._activeSessions) return;
      const session = this._activeSessions.get(sessionId);
      if (session) {
        if (session.timer) {
          clearInterval(session.timer);
        }
        this._activeSessions.delete(sessionId);
      }
    },

    /**
     * 显示消息
     * @param {string} message - 消息内容
     * @param {string} type - 消息类型 ('success' | 'error' | 'info' | 'warning')
     * @param {number} duration - 显示时长（毫秒）
     */
    showMessage(message, type, duration) {
      // 优先使用 window.showMessage
      if (typeof window.showMessage === 'function') {
        try {
          return window.showMessage(message, type, duration);
        } catch (error) {
          console.warn('[ThemeAdapterBase] window.showMessage 失败:', error);
        }
      }

      // 回退到 alert
      try {
        const prefix = type ? `[${type.toUpperCase()}] ` : '';
        window.alert(prefix + (message || ''));
      } catch (_) {
        console.log(`[ThemeAdapterBase] ${type || 'info'}: ${message}`);
      }
    },

    /**
     * 注册数据更新回调
     * @param {Function} callback - 回调函数
     */
    onDataUpdated(callback) {
      if (typeof callback === 'function') {
        this._callbacks.push(callback);
      }
    },

    /**
     * 移除数据更新回调
     * @param {Function} callback - 回调函数
     */
    offDataUpdated(callback) {
      const index = this._callbacks.indexOf(callback);
      if (index > -1) {
        this._callbacks.splice(index, 1);
      }
    },

    /**
     * 注册消息回调
     * @param {string} type - 消息类型（如 'PRACTICE_COMPLETE', 'SESSION_READY' 等）
     * @param {Function} callback - 回调函数
     */
    onMessage(type, callback) {
      if (typeof callback === 'function') {
        this._messageCallbacks.push({ type: normalizeMessageType(type), callback });
      }
    },

    /**
     * 移除消息回调
     * @param {string} type - 消息类型
     * @param {Function} callback - 回调函数
     */
    offMessage(type, callback) {
      const normalizedType = normalizeMessageType(type);
      const index = this._messageCallbacks.findIndex(
        item => item.type === normalizedType && item.callback === callback
      );
      if (index > -1) {
        this._messageCallbacks.splice(index, 1);
      }
    },

    /**
     * 检查消息类型是否为练习完成类型
     * @param {string} type - 消息类型
     * @returns {boolean}
     */
    isPracticeCompleteType(type) {
      return PRACTICE_COMPLETE_TYPES.has(normalizeMessageType(type));
    },

    // ========== 内部方法 ==========

    /**
     * 安装 storage 事件监听器
     */
    _installStorageListener() {
      if (this._storageListenerInstalled) return;

      window.addEventListener('storage', (event) => {
        if (!event || !event.key) return;

        // 检查是否是我们关心的键
        const key = event.key.replace(/^exam_system_/, '');
        
        if (key === STORAGE_KEYS.EXAM_INDEX) {
          console.log('[ThemeAdapterBase] 检测到题库索引变化');
          this._loadExamIndex().catch(console.error);
        } else if (key === STORAGE_KEYS.PRACTICE_RECORDS) {
          console.log('[ThemeAdapterBase] 检测到练习记录变化');
          this._loadPracticeRecords().catch(console.error);
        }
      });

      this._storageListenerInstalled = true;
      console.log('[ThemeAdapterBase] storage 事件监听已安装');
    },

    /**
     * 安装 postMessage 事件监听器
     */
    _installMessageListener() {
      if (this._messageListenerInstalled) return;

      const self = this;
      window.addEventListener('message', (event) => {
        self._handleMessage(event);
      });

      this._messageListenerInstalled = true;
      console.log('[ThemeAdapterBase] postMessage 事件监听已安装');
    },

    /**
     * 处理 postMessage 消息
     * @param {MessageEvent} event - 消息事件
     */
    _handleMessage(event) {
      if (!event || !event.data) return;

      const payload = event.data;
      const rawType = payload.type;
      if (!rawType) return;

      const normalizedType = normalizeMessageType(rawType);

      // 处理 SESSION_READY 消息
      if (normalizedType === 'SESSION_READY') {
        const sessionId = payload.sessionId || payload.sessionID || (payload.data && (payload.data.sessionId || payload.data.sessionID));
        if (sessionId) {
          this._handleSessionReady(sessionId, payload);
        }
        this._notifyMessageCallbacks('SESSION_READY', payload);
        return;
      }

      // 处理练习完成消息
      if (PRACTICE_COMPLETE_TYPES.has(normalizedType)) {
        console.log('[ThemeAdapterBase] 收到练习完成消息:', normalizedType, payload);
        this._handlePracticeComplete(payload);
        this._notifyMessageCallbacks('PRACTICE_COMPLETE', payload);
        return;
      }

      // 处理进度更新消息
      if (normalizedType === 'PROGRESS_UPDATE') {
        this._notifyMessageCallbacks('PROGRESS_UPDATE', payload);
        return;
      }

      // 处理错误消息
      if (normalizedType === 'ERROR_OCCURRED') {
        console.warn('[ThemeAdapterBase] 收到错误消息:', payload);
        this._notifyMessageCallbacks('ERROR_OCCURRED', payload);
        return;
      }

      // 处理初始化请求消息
      if (normalizedType === 'REQUEST_INIT') {
        this._notifyMessageCallbacks('REQUEST_INIT', payload);
        return;
      }
    },

    /**
     * 处理 SESSION_READY 消息
     * @param {string} sessionId - 会话 ID
     * @param {Object} payload - 消息数据
     */
    _handleSessionReady(sessionId, payload) {
      console.log('[ThemeAdapterBase] 会话就绪:', sessionId);
      
      // 清理握手定时器
      if (this._activeSessions && this._activeSessions.has(sessionId)) {
        this._cleanupSession(sessionId);
      }
    },

    /**
     * 处理练习完成消息
     * @param {Object} payload - 消息数据
     */
    _handlePracticeComplete(payload) {
      try {
        // 规范化 payload
        const normalized = normalizePracticePayload(payload);
        const sessionId = normalized.sessionId;

        // 清理握手定时器
        if (sessionId && this._activeSessions && this._activeSessions.has(sessionId)) {
          this._cleanupSession(sessionId);
        }

        // 检查主系统是否已处理
        const mainHandles = typeof window.startHandshakeFallback === 'function';
        if (mainHandles) {
          // 主系统会处理，延迟刷新本地缓存
          console.log('[ThemeAdapterBase] 主系统将处理练习完成消息');
          setTimeout(() => this._loadPracticeRecords().catch(console.error), 800);
          return;
        }

        // 尝试使用主系统的保存函数
        if (typeof window.savePracticeRecordFallback === 'function') {
          const examId = normalized.examId || this._getLastOpenedExamId();
          if (examId) {
            Promise.resolve(window.savePracticeRecordFallback(examId, payload))
              .then(() => {
                console.log('[ThemeAdapterBase] 通过主系统保存练习记录成功');
              })
              .catch((error) => {
                console.warn('[ThemeAdapterBase] 主系统保存失败，使用本地保存:', error);
                this._saveLocalPracticeRecord(normalized, payload);
              })
              .finally(() => {
                setTimeout(() => this._loadPracticeRecords().catch(console.error), 400);
              });
            return;
          }
        }

        // 本地保存
        this._saveLocalPracticeRecord(normalized, payload);
      } catch (error) {
        console.error('[ThemeAdapterBase] 处理练习完成消息失败:', error);
      }
    },

    /**
     * 本地保存练习记录
     * @param {Object} normalized - 规范化后的数据
     * @param {Object} rawPayload - 原始消息数据
     */
    _saveLocalPracticeRecord(normalized, rawPayload) {
      const examId = normalized.examId || this._getLastOpenedExamId();
      if (!examId) {
        console.warn('[ThemeAdapterBase] 无法确定 examId，跳过保存');
        return;
      }

      // 查找题目信息
      const exam = this.getExamById(examId) || {};

      // 计算分数
      const totalQuestions = Number.isFinite(normalized.total) ? normalized.total : 0;
      const correct = Number.isFinite(normalized.correct) ? normalized.correct : 0;
      const accuracy = totalQuestions > 0 ? (correct / totalQuestions) : 0;
      const percentageRaw = Number.isFinite(normalized.percentage) ? normalized.percentage : Math.round(accuracy * 100);
      const percentage = Math.max(0, Math.min(100, percentageRaw));

      // 处理时长
      let duration = normalized.duration;
      if (Number.isFinite(duration)) {
        duration = duration > 1000 ? Math.round(duration / 1000) : Math.round(duration);
      } else {
        duration = undefined;
      }

      // 处理完成时间
      let completedAt = normalized.completedAt ? new Date(normalized.completedAt) : new Date();
      if (!(completedAt instanceof Date) || Number.isNaN(completedAt.getTime())) {
        completedAt = new Date();
      }

      // 构建记录
      const record = {
        id: Date.now(),
        examId,
        sessionId: normalized.sessionId || undefined,
        title: normalized.title || exam.title || '',
        category: normalized.category || exam.category || '',
        type: normalizeType(normalized.type || exam.type),
        percentage,
        accuracy,
        score: correct,
        totalQuestions,
        duration,
        date: completedAt.toISOString(),
        realData: rawPayload
      };

      // 保存记录
      this.savePracticeRecord(record)
        .then(() => {
          console.log('[ThemeAdapterBase] 本地保存练习记录成功:', record.id);
        })
        .catch((error) => {
          console.error('[ThemeAdapterBase] 本地保存练习记录失败:', error);
        });
    },

    /**
     * 获取最后打开的题目 ID
     * @returns {string|null}
     */
    _getLastOpenedExamId() {
      // 从活动会话中获取
      if (this._activeSessions && this._activeSessions.size > 0) {
        const lastSession = Array.from(this._activeSessions.values()).pop();
        if (lastSession && lastSession.examId) {
          return lastSession.examId;
        }
      }

      // 从全局变量获取
      if (window._lastOpenedExamId) {
        return window._lastOpenedExamId;
      }

      // 从 hpCore 获取
      if (window.hpCore && window.hpCore.lastOpenedExamId) {
        return window.hpCore.lastOpenedExamId;
      }

      return null;
    },

    /**
     * 通知消息回调
     * @param {string} type - 消息类型
     * @param {Object} payload - 消息数据
     */
    _notifyMessageCallbacks(type, payload) {
      const normalizedType = normalizeMessageType(type);
      this._messageCallbacks.forEach(item => {
        if (item.type === normalizedType || item.type === '*') {
          try {
            item.callback(payload, type);
          } catch (error) {
            console.error('[ThemeAdapterBase] 消息回调执行失败:', error);
          }
        }
      });
    },

    /**
     * 加载题库索引
     */
    async _loadExamIndex() {
      try {
        let data = await this._readFromStorage(STORAGE_KEYS.EXAM_INDEX);
        
        // 回退到全局变量
        if (!data || !Array.isArray(data) || data.length === 0) {
          console.log('[ThemeAdapterBase] 存储中无题库索引，尝试全局变量');
          const reading = Array.isArray(window.completeExamIndex) ? window.completeExamIndex : [];
          const listening = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
          data = [...reading, ...listening];
        }

        // 规范化 type 字段
        this._examIndex = normalizeExamTypes(data);
        
        this._notifyDataUpdated({ examIndex: this._examIndex });
      } catch (error) {
        console.error('[ThemeAdapterBase] 加载题库索引失败:', error);
        this._examIndex = [];
      }
    },

    /**
     * 加载练习记录
     */
    async _loadPracticeRecords() {
      try {
        let data = await this._readFromStorage(STORAGE_KEYS.PRACTICE_RECORDS);
        
        if (!Array.isArray(data)) {
          data = [];
        }

        // 去重并规范化
        this._practiceRecords = deduplicateRecords(data).map(record => ({
          ...record,
          type: normalizeType(record.type)
        }));
        
        this._notifyDataUpdated({ practiceRecords: this._practiceRecords });
      } catch (error) {
        console.error('[ThemeAdapterBase] 加载练习记录失败:', error);
        this._practiceRecords = [];
      }
    },

    /**
     * 从存储读取数据
     */
    async _readFromStorage(key) {
      // 优先使用 window.storage
      if (window.storage && typeof window.storage.get === 'function') {
        try {
          const result = window.storage.get(key, null);
          if (result && typeof result.then === 'function') {
            return await result;
          }
          return result;
        } catch (error) {
          console.warn('[ThemeAdapterBase] storage.get 失败:', error);
        }
      }

      // 回退到 localStorage
      try {
        const prefixedKey = 'exam_system_' + key;
        const raw = localStorage.getItem(prefixedKey);
        if (raw) {
          const parsed = safeJsonParse(raw);
          return parsed ? parsed.data : null;
        }
      } catch (error) {
        console.warn('[ThemeAdapterBase] localStorage 读取失败:', error);
      }

      return null;
    },

    /**
     * 写入存储
     */
    async _writeToStorage(key, value) {
      // 优先使用 window.storage
      if (window.storage && typeof window.storage.set === 'function') {
        try {
          const result = window.storage.set(key, value);
          if (result && typeof result.then === 'function') {
            await result;
          }
          return;
        } catch (error) {
          console.warn('[ThemeAdapterBase] storage.set 失败:', error);
        }
      }

      // 回退到 localStorage
      try {
        const prefixedKey = 'exam_system_' + key;
        const serialized = JSON.stringify({
          data: value,
          timestamp: Date.now(),
          version: this.version
        });
        localStorage.setItem(prefixedKey, serialized);
      } catch (error) {
        console.error('[ThemeAdapterBase] localStorage 写入失败:', error);
        throw error;
      }
    },

    /**
     * 构建备用路径
     */
    _buildFallbackPath(exam, kind) {
      const base = window.HP_BASE_PREFIX || './';
      const folder = exam.path || '';
      const file = kind === 'pdf'
        ? (exam.pdfFilename || exam.filename || '')
        : (exam.filename || '');

      return encodeResourcePath(joinResourcePath(base, folder, file));
    },

    /**
     * 通知数据更新
     */
    _notifyDataUpdated(data) {
      const payload = {
        examIndex: data.examIndex || this._examIndex,
        practiceRecords: data.practiceRecords || this._practiceRecords
      };

      this._callbacks.forEach(callback => {
        try {
          callback(payload);
        } catch (error) {
          console.error('[ThemeAdapterBase] 回调执行失败:', error);
        }
      });
    }
  };

  // 导出工具函数供测试使用
  ThemeAdapterBase._utils = {
    normalizeType,
    normalizeExamTypes,
    deduplicateRecords,
    getRecordTimestamp,
    normalizeMessageType,
    normalizePracticePayload,
    STORAGE_KEYS,
    VALID_TYPES,
    PATH_FALLBACK_ORDER,
    PRACTICE_COMPLETE_TYPES
  };

  // 暴露到全局
  window.ThemeAdapterBase = ThemeAdapterBase;

  console.log('[ThemeAdapterBase] 模块已加载', { version: ThemeAdapterBase.version });
})();
