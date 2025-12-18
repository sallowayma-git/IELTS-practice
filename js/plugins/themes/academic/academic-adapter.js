/**
 * Academic Theme Adapter (学术主题适配器)
 * 
 * 继承 ThemeAdapterBase，提供 Academic 主题特定的功能：
 * - 主题特定的 UI 集成
 * - 视图状态管理
 * - 与主系统的数据同步
 * 
 * @version 1.0.0
 * @requires ThemeAdapterBase
 */
(function () {
  'use strict';

  // 等待 ThemeAdapterBase 加载
  if (!window.ThemeAdapterBase) {
    console.error('[AcademicAdapter] ThemeAdapterBase 未加载');
    return;
  }

  /**
   * AcademicAdapter - 学术主题适配器
   * 继承 ThemeAdapterBase 的所有功能，并添加 Academic 特定逻辑
   */
  const AcademicAdapter = Object.create(window.ThemeAdapterBase);

  // 版本信息
  AcademicAdapter.version = '1.0.0';
  AcademicAdapter.themeName = 'academic';
  AcademicAdapter.themeDisplayName = 'IELTS Academic Professional';

  // Academic 特定状态
  AcademicAdapter._academicState = {
    currentView: 'overview',
    currentCategory: 'all',
    currentExamType: 'all',
    initialized: false
  };

  /**
   * 初始化 Academic 适配器
   * @param {Object} options - 初始化选项
   * @returns {Promise<void>}
   */
  AcademicAdapter.init = async function (options = {}) {
    console.log('[AcademicAdapter] 开始初始化...');

    try {
      // 调用基类初始化
      await window.ThemeAdapterBase.init.call(this, options);

      // Academic 特定初始化
      this._initAcademicFeatures(options);

      this._academicState.initialized = true;
      console.log('[AcademicAdapter] 初始化完成', {
        version: this.version,
        themeName: this.themeName,
        examCount: this._examIndex.length,
        recordCount: this._practiceRecords.length
      });

      // 记录初始化状态到控制台（Requirements 4.4）
      console.log('[AcademicAdapter] 适配器状态:', {
        isReady: this.isReady,
        currentView: this._academicState.currentView,
        currentCategory: this._academicState.currentCategory
      });

    } catch (error) {
      console.error('[AcademicAdapter] 初始化失败:', error);
      throw error;
    }
  };


  /**
   * 初始化 Academic 特定功能
   * @private
   */
  AcademicAdapter._initAcademicFeatures = function (options) {
    // 设置初始视图
    if (options.initialView) {
      this._academicState.currentView = options.initialView;
    }

    // 设置初始分类
    if (options.initialCategory) {
      this._academicState.currentCategory = options.initialCategory;
    }

    // 设置初始题目类型
    if (options.initialExamType) {
      this._academicState.currentExamType = options.initialExamType;
    }
  };

  /**
   * 获取当前视图
   * @returns {string} 当前视图名称
   */
  AcademicAdapter.getCurrentView = function () {
    return this._academicState.currentView;
  };

  /**
   * 设置当前视图
   * @param {string} viewName - 视图名称
   */
  AcademicAdapter.setCurrentView = function (viewName) {
    this._academicState.currentView = viewName;
  };

  /**
   * 获取当前分类
   * @returns {string} 当前分类
   */
  AcademicAdapter.getCurrentCategory = function () {
    return this._academicState.currentCategory;
  };

  /**
   * 设置当前分类
   * @param {string} category - 分类名称
   */
  AcademicAdapter.setCurrentCategory = function (category) {
    this._academicState.currentCategory = category;
  };

  /**
   * 获取当前题目类型
   * @returns {string} 当前题目类型
   */
  AcademicAdapter.getCurrentExamType = function () {
    return this._academicState.currentExamType;
  };

  /**
   * 设置当前题目类型
   * @param {string} examType - 题目类型
   */
  AcademicAdapter.setCurrentExamType = function (examType) {
    this._academicState.currentExamType = examType;
  };

  /**
   * 显示消息（Academic 主题风格）
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型
   * @param {number} duration - 显示时长
   */
  AcademicAdapter.showMessage = function (message, type, duration) {
    // 尝试使用 Academic 主题的消息系统
    if (window.academicApp && typeof window.academicApp.showNotification === 'function') {
      try {
        window.academicApp.showNotification(message, type, duration || 3000);
        return;
      } catch (error) {
        console.warn('[AcademicAdapter] academicApp.showNotification 失败:', error);
      }
    }

    // 尝试使用页面内的 showMessage 函数
    if (typeof window._originalShowMessage === 'function') {
      try {
        window._originalShowMessage(message, type, duration);
        return;
      } catch (error) {
        console.warn('[AcademicAdapter] _originalShowMessage 失败:', error);
      }
    }

    // 回退到基类实现
    window.ThemeAdapterBase.showMessage.call(this, message, type, duration);
  };

  /**
   * 获取题库索引（带 Academic 特定处理）
   * @returns {Array} 题库索引数组
   */
  AcademicAdapter.getExamIndex = function () {
    const exams = window.ThemeAdapterBase.getExamIndex.call(this);
    
    // 如果基类没有数据，尝试从全局变量获取
    if (exams.length === 0) {
      // Academic 页面可能使用 examIndex 全局变量
      if (Array.isArray(window.examIndex) && window.examIndex.length > 0) {
        return window.examIndex.slice();
      }
      const reading = Array.isArray(window.completeExamIndex) ? window.completeExamIndex : [];
      const listening = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
      return [...reading, ...listening];
    }
    
    return exams;
  };

  /**
   * 获取练习记录（带 Academic 特定处理）
   * @returns {Array} 练习记录数组
   */
  AcademicAdapter.getPracticeRecords = function () {
    const records = window.ThemeAdapterBase.getPracticeRecords.call(this);
    
    // 如果基类没有数据，尝试从全局变量获取
    if (records.length === 0) {
      // Academic 页面可能使用 practiceRecords 全局变量
      if (Array.isArray(window.practiceRecords) && window.practiceRecords.length > 0) {
        return window.practiceRecords.slice();
      }
      // 尝试从 window.storage 获取
      if (window.storage && typeof window.storage.get === 'function') {
        try {
          const stored = window.storage.get('practice_records', []);
          if (stored && typeof stored.then === 'function') {
            stored.then((resolved) => {
              if (!Array.isArray(resolved) || resolved.length === 0) return;
              this._practiceRecords = resolved;
              if (typeof this._notifyDataUpdated === 'function') {
                this._notifyDataUpdated({ practiceRecords: this._practiceRecords });
              }
              if (typeof window.updatePracticeView === 'function') {
                try { window.updatePracticeView(); } catch (_) {}
              }
            }).catch((error) => {
              console.warn('[AcademicAdapter] 从 storage 获取练习记录失败:', error);
            });
          } else if (Array.isArray(stored) && stored.length > 0) {
            return stored;
          }
        } catch (error) {
          console.warn('[AcademicAdapter] 从 storage 获取练习记录失败:', error);
        }
      }
    }
    
    return records;
  };

  /**
   * 打开题目（Academic 主题风格）
   * @param {string|Object} examOrId - 题目 ID 或题目对象
   * @param {Object} options - 打开选项
   * @returns {Window|null}
   */
  AcademicAdapter.openExam = function (examOrId, options = {}) {
    // 显示 Academic 风格的加载提示
    this.showMessage('正在准备题目...', 'info', 2000);

    // 调用基类实现
    return window.ThemeAdapterBase.openExam.call(this, examOrId, options);
  };


  /**
   * 获取统计数据（Academic 主题使用）
   * @returns {Object} 统计数据
   */
  AcademicAdapter.getStatistics = function () {
    const records = this.getPracticeRecords();
    const exams = this.getExamIndex();

    // 计算统计数据
    const totalPractices = records.length;
    const totalExams = exams.length;

    // 计算平均分
    let totalScore = 0;
    let validRecords = 0;
    records.forEach(record => {
      const score = record.percentage || record.score;
      if (typeof score === 'number' && !isNaN(score)) {
        totalScore += score;
        validRecords++;
      }
    });
    const averageScore = validRecords > 0 ? Math.round(totalScore / validRecords) : 0;

    // 计算已完成的题目数
    const completedExamIds = new Set(records.map(r => r.examId).filter(Boolean));
    const completedCount = completedExamIds.size;

    // 计算总学习时长（秒）
    let totalDuration = 0;
    records.forEach(record => {
      if (typeof record.duration === 'number' && !isNaN(record.duration)) {
        totalDuration += record.duration;
      }
    });
    // 转换为小时
    const studyHours = Math.round(totalDuration / 3600 * 10) / 10;

    // 按类型统计
    const readingExams = exams.filter(e => e.type === 'reading');
    const listeningExams = exams.filter(e => e.type === 'listening');
    const readingRecords = records.filter(r => r.type === 'reading');
    const listeningRecords = records.filter(r => r.type === 'listening');

    return {
      totalPractices,
      totalExams,
      averageScore,
      completedCount,
      studyHours,
      readingCount: readingExams.length,
      listeningCount: listeningExams.length,
      readingPractices: readingRecords.length,
      listeningPractices: listeningRecords.length
    };
  };

  /**
   * 获取分类统计（Academic 主题使用）
   * @returns {Array} 分类统计数组
   */
  AcademicAdapter.getCategoryStatistics = function () {
    const exams = this.getExamIndex();
    const records = this.getPracticeRecords();

    const categories = [
      {
        name: '阅读理解',
        icon: 'fas fa-book-open',
        type: 'reading',
        total: 0,
        completed: 0,
        averageScore: 0
      },
      {
        name: '听力练习',
        icon: 'fas fa-headphones',
        type: 'listening',
        total: 0,
        completed: 0,
        averageScore: 0
      }
    ];

    categories.forEach(category => {
      const typeExams = exams.filter(e => e.type === category.type);
      const typeRecords = records.filter(r => r.type === category.type);
      
      category.total = typeExams.length;
      category.completed = new Set(typeRecords.map(r => r.examId).filter(Boolean)).size;
      
      if (typeRecords.length > 0) {
        let totalScore = 0;
        let validCount = 0;
        typeRecords.forEach(r => {
          const score = r.percentage || r.score;
          if (typeof score === 'number' && !isNaN(score)) {
            totalScore += score;
            validCount++;
          }
        });
        category.averageScore = validCount > 0 ? Math.round(totalScore / validCount) : 0;
      }
    });

    return categories;
  };

  /**
   * 筛选题目（Academic 主题使用）
   * @param {Object} filters - 筛选条件
   * @returns {Array} 筛选后的题目数组
   */
  AcademicAdapter.filterExams = function (filters = {}) {
    let exams = this.getExamIndex();
    const { type, category, search } = filters;

    // 按类型筛选
    if (type && type !== 'all') {
      exams = exams.filter(e => e.type === type);
    }

    // 按分类筛选
    if (category && category !== 'all') {
      exams = exams.filter(e => e.category === category);
    }

    // 按搜索词筛选
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      exams = exams.filter(e => {
        const title = (e.title || e.name || '').toLowerCase();
        const cat = (e.category || '').toLowerCase();
        return title.includes(searchLower) || cat.includes(searchLower);
      });
    }

    return exams;
  };

  // 暴露到全局
  window.AcademicAdapter = AcademicAdapter;

  // 同时暴露到 themeAdapter 命名空间（Requirements 4.2）
  window.themeAdapter = AcademicAdapter;

  console.log('[AcademicAdapter] 模块已加载', { version: AcademicAdapter.version });
})();
