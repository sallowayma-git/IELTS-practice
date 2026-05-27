/**
 * Melody Theme Adapter (美乐蒂主题适配器)
 * 
 * 继承 ThemeAdapterBase，提供 My Melody 主题特定的功能：
 * - 主题特定的 UI 集成
 * - 导航状态管理
 * - 与主系统的数据同步
 * 
 * @version 1.0.0
 * @requires ThemeAdapterBase
 */
(function () {
  'use strict';

  // 等待 ThemeAdapterBase 加载
  if (!window.ThemeAdapterBase) {
    console.error('[MelodyAdapter] ThemeAdapterBase 未加载');
    return;
  }

  /**
   * MelodyAdapter - 美乐蒂主题适配器
   * 继承 ThemeAdapterBase 的所有功能，并添加 Melody 特定逻辑
   */
  const MelodyAdapter = Object.create(window.ThemeAdapterBase);

  // 版本信息
  MelodyAdapter.version = '1.0.0';
  MelodyAdapter.themeName = 'melody';
  MelodyAdapter.themeDisplayName = 'My Melody IELTS';

  // Melody 特定状态
  MelodyAdapter._melodyState = {
    currentPage: 'overview',
    darkMode: false,
    initialized: false
  };

  /**
   * 初始化 Melody 适配器
   * @param {Object} options - 初始化选项
   * @returns {Promise<void>}
   */
  MelodyAdapter.init = async function (options = {}) {
    console.log('[MelodyAdapter] 开始初始化...');

    try {
      // 调用基类初始化
      await window.ThemeAdapterBase.init.call(this, options);

      // Melody 特定初始化
      this._initMelodyFeatures(options);

      this._melodyState.initialized = true;
      console.log('[MelodyAdapter] 初始化完成', {
        version: this.version,
        themeName: this.themeName,
        examCount: this._examIndex.length,
        recordCount: this._practiceRecords.length
      });

      // 记录初始化状态到控制台（Requirements 4.4）
      console.log('[MelodyAdapter] 适配器状态:', {
        isReady: this.isReady,
        darkMode: this._melodyState.darkMode,
        currentPage: this._melodyState.currentPage
      });

    } catch (error) {
      console.error('[MelodyAdapter] 初始化失败:', error);
      throw error;
    }
  };

  /**
   * 初始化 Melody 特定功能
   * @private
   */
  MelodyAdapter._initMelodyFeatures = function (options) {
    // 检测深色模式
    this._detectDarkMode();

    // 监听深色模式变化
    this._watchDarkMode();

    // 设置初始页面
    if (options.initialPage) {
      this._melodyState.currentPage = options.initialPage;
    }
  };

  /**
   * 检测当前深色模式状态
   * @private
   */
  MelodyAdapter._detectDarkMode = function () {
    const body = document.body;
    if (body) {
      this._melodyState.darkMode = body.classList.contains('dark-mode');
    }
  };

  /**
   * 监听深色模式变化
   * @private
   */
  MelodyAdapter._watchDarkMode = function () {
    // 使用 MutationObserver 监听 body class 变化
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.attributeName === 'class') {
            const wasDark = this._melodyState.darkMode;
            this._detectDarkMode();
            if (wasDark !== this._melodyState.darkMode) {
              console.log('[MelodyAdapter] 深色模式变化:', this._melodyState.darkMode);
            }
          }
        });
      });

      observer.observe(document.body, { attributes: true });
    }
  };

  /**
   * 获取当前页面
   * @returns {string} 当前页面名称
   */
  MelodyAdapter.getCurrentPage = function () {
    return this._melodyState.currentPage;
  };

  /**
   * 设置当前页面
   * @param {string} pageName - 页面名称
   */
  MelodyAdapter.setCurrentPage = function (pageName) {
    this._melodyState.currentPage = pageName;
  };

  /**
   * 检查是否为深色模式
   * @returns {boolean}
   */
  MelodyAdapter.isDarkMode = function () {
    return this._melodyState.darkMode;
  };

  /**
   * 显示消息（Melody 主题风格）
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型
   * @param {number} duration - 显示时长
   */
  MelodyAdapter.showMessage = function (message, type, duration) {
    // 尝试使用 Melody 主题的通知系统
    if (window.melodyApp && typeof window.melodyApp.showNotification === 'function') {
      try {
        window.melodyApp.showNotification(message, duration || 3000);
        return;
      } catch (error) {
        console.warn('[MelodyAdapter] melodyApp.showNotification 失败:', error);
      }
    }

    // 尝试使用 Melody 主题的弹跳通知
    if (window.melodyApp && typeof window.melodyApp.showBouncingNotification === 'function') {
      try {
        const emoji = type === 'success' ? '🎀' : (type === 'error' ? '😿' : '💖');
        window.melodyApp.showBouncingNotification(message, emoji, duration || 3000);
        return;
      } catch (error) {
        console.warn('[MelodyAdapter] melodyApp.showBouncingNotification 失败:', error);
      }
    }

    // 回退到基类实现
    window.ThemeAdapterBase.showMessage.call(this, message, type, duration);
  };

  /**
   * 获取题库索引（带 Melody 特定处理）
   * @returns {Array} 题库索引数组
   */
  MelodyAdapter.getExamIndex = function () {
    const exams = window.ThemeAdapterBase.getExamIndex.call(this);
    
    // 如果基类没有数据，尝试从全局变量获取
    if (exams.length === 0) {
      const reading = Array.isArray(window.completeExamIndex) ? window.completeExamIndex : [];
      const listening = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
      return [...reading, ...listening];
    }
    
    return exams;
  };

  /**
   * 获取练习记录（带 Melody 特定处理）
   * @returns {Array} 练习记录数组
   */
  MelodyAdapter.getPracticeRecords = function () {
    const records = window.ThemeAdapterBase.getPracticeRecords.call(this);
    
    // 如果基类没有数据，尝试从统一记录 API 获取
    if (records.length === 0 && window.PracticeRecordAPI && typeof window.PracticeRecordAPI.list === 'function') {
      try {
        const stored = window.PracticeRecordAPI.list();
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
            console.warn('[MelodyAdapter] 从 PracticeRecordAPI 获取练习记录失败:', error);
          });
        } else if (Array.isArray(stored) && stored.length > 0) {
          return stored;
        }
      } catch (error) {
        console.warn('[MelodyAdapter] 从 PracticeRecordAPI 获取练习记录失败:', error);
      }
    }
    
    return records;
  };

  /**
   * 打开题目（Melody 主题风格）
   * @param {string|Object} examOrId - 题目 ID 或题目对象
   * @param {Object} options - 打开选项
   * @returns {Window|null}
   */
  MelodyAdapter.openExam = function (examOrId, options = {}) {
    // 显示 Melody 风格的加载提示
    this.showMessage('正在准备题目...', 'info', 2000);

    // 调用基类实现
    return window.ThemeAdapterBase.openExam.call(this, examOrId, options);
  };

  /**
   * 获取统计数据（Melody 主题使用）
   * @returns {Object} 统计数据
   */
  MelodyAdapter.getStatistics = function () {
    const records = this.getPracticeRecords();
    const exams = this.getExamIndex();

    // 计算统计数据
    const totalPractices = records.length;
    const totalExams = exams.length;

    // 计算平均分
    let totalScore = 0;
    let validRecords = 0;
    records.forEach(record => {
      if (typeof record.percentage === 'number' && !isNaN(record.percentage)) {
        totalScore += record.percentage;
        validRecords++;
      }
    });
    const averageScore = validRecords > 0 ? Math.round(totalScore / validRecords) : 0;

    // 计算今日练习数
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPractices = records.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate >= today;
    }).length;

    // 计算本周练习数
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekPractices = records.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate >= weekStart;
    }).length;

    // 计算连续练习天数
    const streakDays = this._calculateStreakDays(records);

    return {
      totalPractices,
      totalExams,
      averageScore,
      todayPractices,
      weekPractices,
      streakDays,
      readingCount: exams.filter(e => e.type === 'reading').length,
      listeningCount: exams.filter(e => e.type === 'listening').length
    };
  };

  /**
   * 计算连续练习天数
   * @private
   */
  MelodyAdapter._calculateStreakDays = function (records) {
    if (!records || records.length === 0) return 0;

    // 按日期分组
    const dateSet = new Set();
    records.forEach(record => {
      if (record.date) {
        const date = new Date(record.date);
        const dateStr = date.toISOString().split('T')[0];
        dateSet.add(dateStr);
      }
    });

    if (dateSet.size === 0) return 0;

    // 排序日期
    const dates = Array.from(dateSet).sort().reverse();
    
    // 检查今天是否有练习
    const today = new Date().toISOString().split('T')[0];
    if (dates[0] !== today) {
      // 检查昨天
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      if (dates[0] !== yesterdayStr) {
        return 0; // 连续中断
      }
    }

    // 计算连续天数
    let streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const current = new Date(dates[i - 1]);
      const prev = new Date(dates[i]);
      const diffDays = Math.round((current - prev) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  };

  // 暴露到全局
  window.MelodyAdapter = MelodyAdapter;

  // 同时暴露到 themeAdapter 命名空间（Requirements 4.2）
  window.themeAdapter = MelodyAdapter;

  console.log('[MelodyAdapter] 模块已加载', { version: MelodyAdapter.version });
})();
