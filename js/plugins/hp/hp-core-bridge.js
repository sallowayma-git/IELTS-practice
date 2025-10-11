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

  const stateAdapter = window.LegacyStateAdapter ? window.LegacyStateAdapter.getInstance() : null;
  const legacyBridge = window.LegacyStateBridge && typeof window.LegacyStateBridge.getInstance === 'function'
    ? window.LegacyStateBridge.getInstance()
    : null;

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

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
      const payload = data || {};

      if (payload.examIndex) {
        this.examIndex = cloneArray(payload.examIndex);
        if (payload.__source !== 'hp-core') {
          syncExamIndex(this.examIndex);
        }
      }

      if (payload.practiceRecords) {
        this.practiceRecords = cloneArray(payload.practiceRecords);
        if (payload.__source !== 'hp-core') {
          syncPracticeRecords(this.practiceRecords);
        }
      }

      this.lastUpdateTime = Date.now();
    },
    async _loadExamIndex() {
      try {
        const existing = readExamIndexSnapshot();
        if (existing.length) {
          this._setExamIndex(existing);
          return;
        }

        let fromStorage = null;
        if (window.storage && storage.get) {
          const maybePromise = storage.get('exam_index', null);
          fromStorage = (maybePromise && typeof maybePromise.then === 'function')
            ? await maybePromise
            : maybePromise;
        }
        if (Array.isArray(fromStorage) && fromStorage.length) {
          this._setExamIndex(fromStorage);
          return;
        }

        const reading = markTypes(window.completeExamIndex || [], 'reading');
        const listening = markTypes(window.listeningExamIndex || [], 'listening');
        const merged = reading.concat(listening);
        this._setExamIndex(merged);
        if (window.storage && storage.set) {
          try {
            const maybeSet = storage.set('exam_index', merged);
            if (maybeSet && typeof maybeSet.then === 'function') {
              await maybeSet;
            }
          } catch (setError) {
            console.warn('[hpCore] 写入 exam_index 失败:', setError);
          }
        }
      } catch (e) { console.warn('[hpCore] _loadExamIndex failed', e); }
    },
    _setExamIndex(list) {
      const normalized = cloneArray(list);
      const synced = syncExamIndex(normalized);
      this.examIndex = synced;
      this.emit('dataUpdated', {
        examIndex: synced,
        practiceRecords: this.practiceRecords,
        __source: 'hp-core'
      });
      return synced;
    },
    async _loadRecords() {
      try {
        const existing = readPracticeRecordsSnapshot();
        if (existing.length) {
          this._setRecords(existing);
          return;
        }

        let rec = null;
        if (window.storage && storage.get) rec = await storage.get('practice_records', null);
        if (!rec) rec = window.practiceRecords || [];
        this._setRecords(coerceArray(rec));
      } catch (e) { console.warn('[hpCore] _loadRecords failed', e); }
    },
    _setRecords(list) {
      const normalized = cloneArray(list);
      const synced = syncPracticeRecords(normalized);
      this.practiceRecords = synced;
      this.emit('dataUpdated', {
        examIndex: this.examIndex,
        practiceRecords: synced,
        __source: 'hp-core'
      });
      return synced;
    },
    _installListeners() {
      window.addEventListener('storage', (e) => {
        if (e && (e.key === 'practice_records' || e.key === 'exam_index')) {
          try {
            this._loadRecords();
            this._loadExamIndex().catch(() => {});
          } catch (_) {}
        }
      });
      window.addEventListener('message', (ev) => {
        const d = ev && ev.data;
        if (d && (d.type === 'PRACTICE_COMPLETE' || d.type === 'SESSION_COMPLETE')) {
          setTimeout(() => this._loadRecords(), 800);
        }
      });
      document.addEventListener('DOMContentLoaded', () => {
        this._loadExamIndex().catch(() => {});
        this._loadRecords();
        this._markReady();
      });
    }
  };

  function readExamIndexSnapshot() {
    if (stateAdapter && typeof stateAdapter.getExamIndex === 'function') {
      return cloneArray(stateAdapter.getExamIndex());
    }
    if (Array.isArray(window.examIndex)) {
      return cloneArray(window.examIndex);
    }
    return cloneArray(hpCore.examIndex);
  }

  function readPracticeRecordsSnapshot() {
    if (stateAdapter && typeof stateAdapter.getPracticeRecords === 'function') {
      return cloneArray(stateAdapter.getPracticeRecords());
    }
    if (Array.isArray(window.practiceRecords)) {
      return cloneArray(window.practiceRecords);
    }
    return cloneArray(hpCore.practiceRecords);
  }

  function syncExamIndex(list) {
    const normalized = cloneArray(list);
    let synced = normalized;

    if (stateAdapter && typeof stateAdapter.setExamIndex === 'function') {
      synced = cloneArray(stateAdapter.setExamIndex(normalized, { source: 'hp-core' }));
    } else if (legacyBridge && typeof legacyBridge.setExamIndex === 'function') {
      synced = cloneArray(legacyBridge.setExamIndex(normalized, { source: 'hp-core' }));
    } else {
      try { window.examIndex = synced.slice(); } catch (_) {}
    }
    hpCore.examIndex = synced;
    return synced;
  }

  function syncPracticeRecords(list) {
    const normalized = cloneArray(list);
    let synced = normalized;

    if (stateAdapter && typeof stateAdapter.setPracticeRecords === 'function') {
      synced = cloneArray(stateAdapter.setPracticeRecords(normalized, { source: 'hp-core' }));
    } else if (legacyBridge && typeof legacyBridge.setPracticeRecords === 'function') {
      synced = cloneArray(legacyBridge.setPracticeRecords(normalized, { source: 'hp-core' }));
    } else {
      try { window.practiceRecords = synced.slice(); } catch (_) {}
    }
    hpCore.practiceRecords = synced;
    return synced;
  }

  function subscribeAdapterUpdates() {
    if (!stateAdapter || typeof stateAdapter.subscribe !== 'function') {
      return;
    }

    stateAdapter.subscribe('examIndex', function (value) {
      const next = cloneArray(value);
      hpCore.examIndex = next;
      hpCore.emit('dataUpdated', {
        examIndex: next,
        practiceRecords: hpCore.practiceRecords,
        __source: 'hp-core'
      });
    });

    stateAdapter.subscribe('practiceRecords', function (value) {
      const next = cloneArray(value);
      hpCore.practiceRecords = next;
      hpCore.emit('dataUpdated', {
        examIndex: hpCore.examIndex,
        practiceRecords: next,
        __source: 'hp-core'
      });
    });
  }

  subscribeAdapterUpdates();

  if (stateAdapter) {
    hpCore.examIndex = readExamIndexSnapshot();
    hpCore.practiceRecords = readPracticeRecordsSnapshot();
  }

  window.hpCore = hpCore;
  hpCore._installListeners();
  try {
    hpCore._loadExamIndex().catch(() => {});
    hpCore._loadRecords();
    hpCore._markReady();
  } catch (_) {}
  try { console.log('[HP Core] Initialized', hpCore.getStatus()); } catch (_) {}
  // Override actions with safe fallbacks that do not depend on main.js globals being populated
  try {
    hpCore.startExam = function(examId){
      try { if (typeof window.openExam==='function') return window.openExam(examId); } catch(_){}
      try { if (window.app && typeof window.app.openExam==='function') return window.app.openExam(examId); } catch(_){}
      try {
        var list = readExamIndexSnapshot();
        var ex = list.find(function(x){ return x && x.id===examId; });
        if (!ex) return this.showMessage('未找到题目', 'error');
        if (!ex.hasHtml) return this.viewExamPDF(examId);
        var fullPath;
        if (typeof window.buildResourcePath==='function') {
          fullPath = window.buildResourcePath(ex,'html');
        } else {
          var __base = (window.HP_BASE_PREFIX || './');
          if (__base && !/\/$/.test(__base)) __base += '/';
          var __raw = String(ex.path||'');
          if (__raw && !/\/$/.test(__raw)) __raw += '/';
          __raw += String(ex.filename||'');
          if (/^(?:[a-z]+:)?\/\//i.test(__raw) || /^[A-Za-z]:\\/.test(__raw)) {
            fullPath = __raw;
          } else {
            __raw = __raw.replace(/^\.\//,'');
            fullPath = __base + __raw;
          }
        }
        var w = window.open(fullPath, 'exam_'+examId, 'width=1200,height=800,scrollbars=yes,resizable=yes');
        if (!w) return this.showMessage('无法打开窗口，请检查弹窗设置', 'error');
        this.showMessage('正在打开: '+(ex.title||examId), 'info');
        return w;
      } catch (e) { try { console.error('[hpCore.startExam fallback] failed', e); } catch(_){} this.showMessage('无法启动练习', 'error'); }
    };
    hpCore.viewExamPDF = function(examId){
      try { if (typeof window.viewPDF==='function') return window.viewPDF(examId); } catch(_){}
      try {
        var list = readExamIndexSnapshot();
        var ex = list.find(function(x){ return x && x.id===examId; });
        if (!ex || !ex.pdfFilename) return this.showMessage('未找到PDF文件', 'error');
        var pdfPath;
        if (typeof window.buildResourcePath==='function') {
          pdfPath = window.buildResourcePath(ex,'pdf');
        } else {
          var __b = (window.HP_BASE_PREFIX || './');
          if (__b && !/\/$/.test(__b)) __b += '/';
          var __r = String(ex.path||'');
          if (__r && !/\/$/.test(__r)) __r += '/';
          __r += String(ex.pdfFilename||'');
          if (/^(?:[a-z]+:)?\/\//i.test(__r) || /^[A-Za-z]:\\/.test(__r)) {
            pdfPath = __r;
          } else {
            __r = __r.replace(/^\.\//,'');
            pdfPath = __b + __r;
          }
        }
        var w = (typeof window.openPDFSafely==='function') ? window.openPDFSafely(pdfPath, ex.title||'PDF') : window.open(pdfPath, 'pdf_'+examId, 'width=1000,height=800,scrollbars=yes,resizable=yes');
        if (!w) return this.showMessage('无法打开PDF窗口', 'error');
        return w;
      } catch (e) { try { console.error('[hpCore.viewExamPDF fallback] failed', e); } catch(_){} this.showMessage('无法打开PDF', 'error'); }
    };
  } catch(_){}
})();

