/**
 * HP Core Bridge (stable)
 * - Event bus (on/off/emit)
 * - Ready lifecycle (ready(cb))
 * - Data accessors (getExamIndex/getRecords/getExamById)
 * - Actions (startExam/viewExamPDF)
 * - UI helpers (showMessage/showNotification)
 * - Storage + postMessage listeners
 */
(function () {
  'use strict';

  if (window.hpCore && window.hpCore.__stable) {
    try { console.log('[HP Core] Already initialized'); } catch (_) {}
    return;
  }

  const events = Object.create(null);
  const throttleMap = new Map();

  function safeJsonParse(v) { try { return JSON.parse(v); } catch (_) { return null; } }
  function coerceArray(x) { return Array.isArray(x) ? x : (x ? [x] : []); }
  function markTypes(list, type) {
    return (list || []).map(function (e) { if (e && !e.type) e.type = type; return e; });
  }

  const hpCore = {
    __stable: true,
    version: '1.0.1',

    // lifecycle
    isReady: false,
    _readyQ: [],

    // data cache
    examIndex: [],
    practiceRecords: [],
    lastUpdateTime: 0,

    // event bus
    on(event, cb) {
      if (!event || typeof cb !== 'function') return;
      (events[event] || (events[event] = [])).push(cb);
    },
    off(event, cb) {
      if (!event || !events[event]) return;
      if (!cb) { delete events[event]; return; }
      events[event] = events[event].filter(fn => fn !== cb);
    },
    emit(event, payload) {
      const list = events[event];
      if (list && list.length) {
        list.slice().forEach(fn => { try { fn(payload); } catch (e) { console.error('[hpCore emit error]', event, e); } });
      }
      if (event === 'dataUpdated') {
        this._broadcastDataUpdated(payload || {});
      }
    },

    ready(cb) {
      if (typeof cb !== 'function') return;
      if (this.isReady) cb(); else this._readyQ.push(cb);
    },

    // compatibility
    onDataUpdated(cb) { this.on('dataUpdated', cb); },

    // data
    getExamIndex() { return this.examIndex || []; },
    getRecords() { return this.practiceRecords || []; },
    getExamById(id) { return (this.examIndex || []).find(e => e && e.id === id); },

    // utils
    throttle(func, delay) {
      if (typeof func !== 'function') return function () {};
      const key = (func.name || 'fn') + '_' + (delay || 300);
      return function () {
        const now = Date.now();
        const last = throttleMap.get(key) || 0;
        if (now - last >= delay) { throttleMap.set(key, now); return func.apply(this, arguments); }
      };
    },

    // actions
    startExam(examId) {
      try {
        if (typeof window.openExam === 'function') return window.openExam(examId);
        if (window.app && typeof window.app.openExam === 'function') return window.app.openExam(examId);
      } catch (e) { console.error('[hpCore.startExam] failed', e); }
      this.showMessage('无法启动练习：openExam 未就绪', 'error');
    },
    viewExamPDF(examId) {
      try { if (typeof window.viewPDF === 'function') return window.viewPDF(examId); }
      catch (e) { console.error('[hpCore.viewExamPDF] failed', e); }
      this.showMessage('未找到查看 PDF 的方法', 'warning');
    },

    // ui
    showMessage(message, type, duration) {
      if (typeof window.showMessage === 'function') return window.showMessage(message, type, duration);
      try { alert((type ? '[' + type + '] ' : '') + (message || '')); } catch (_) {}
    },
    showNotification(message, type, duration) { this.showMessage(message, type, duration); },

    getStatus() {
      return {
        version: this.version,
        isReady: this.isReady,
        examCount: (this.examIndex || []).length,
        recordCount: (this.practiceRecords || []).length,
        lastUpdateTime: this.lastUpdateTime
      };
    },

    // internal
    _markReady() {
      if (this.isReady) return;
      this.isReady = true;
      const q = this._readyQ.slice();
      this._readyQ.length = 0;
      q.forEach(fn => { try { fn(); } catch (e) { console.error('[hpCore ready cb error]', e); } });
    },
    _broadcastDataUpdated(data) {
      if (data && data.examIndex) this.examIndex = data.examIndex;
      if (data && data.practiceRecords) this.practiceRecords = data.practiceRecords;
      this.lastUpdateTime = Date.now();
    },
    _loadExamIndex() {
      try {
        const fromStorage = (window.storage && storage.get) ? storage.get('exam_index', null) : null;
        if (Array.isArray(fromStorage) && fromStorage.length) return this._setExamIndex(fromStorage);
        const reading = markTypes(window.completeExamIndex || [], 'reading');
        const listening = markTypes(window.listeningExamIndex || [], 'listening');
        const merged = reading.concat(listening);
        this._setExamIndex(merged);
        if (window.storage && storage.set) storage.set('exam_index', merged);
      } catch (e) { console.warn('[hpCore] _loadExamIndex failed', e); }
    },
    _setExamIndex(list) {
      if (!Array.isArray(list)) list = [];
      this.examIndex = list;
      this.emit('dataUpdated', { examIndex: list, practiceRecords: this.practiceRecords });
    },
    _loadRecords() {
      try {
        let rec = null;
        if (window.storage && storage.get) rec = storage.get('practice_records', null);
        if (!rec) rec = safeJsonParse(localStorage.getItem('practice_records'));
        if (!rec) rec = safeJsonParse(localStorage.getItem('exam_system_practice_records'));
        if (!rec) rec = window.practiceRecords || [];
        this._setRecords(coerceArray(rec));
      } catch (e) { console.warn('[hpCore] _loadRecords failed', e); }
    },
    _setRecords(list) {
      if (!Array.isArray(list)) list = [];
      this.practiceRecords = list;
      this.emit('dataUpdated', { examIndex: this.examIndex, practiceRecords: list });
    },
    _installListeners() {
      window.addEventListener('storage', (e) => {
        if (e && (e.key === 'practice_records' || e.key === 'exam_index' || e.key === 'exam_system_practice_records')) {
          try { this._loadRecords(); this._loadExamIndex(); } catch (_) {}
        }
      });
      window.addEventListener('message', (ev) => {
        const d = ev && ev.data;
        if (d && (d.type === 'PRACTICE_COMPLETE' || d.type === 'SESSION_COMPLETE')) {
          setTimeout(() => this._loadRecords(), 800);
        }
      });
      document.addEventListener('DOMContentLoaded', () => {
        this._loadExamIndex();
        this._loadRecords();
        this._markReady();
      });
    }
  };

  window.hpCore = hpCore;
  hpCore._installListeners();
  try { hpCore._loadExamIndex(); hpCore._loadRecords(); hpCore._markReady(); } catch (_) {}
  try { console.log('[HP Core] Initialized', hpCore.getStatus()); } catch (_) {}
})();

