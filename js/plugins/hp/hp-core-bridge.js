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

  function getStateService() {
    return window.appStateService || null;
  }

  function cloneArray(value) {
    return Array.isArray(value) ? value.slice() : [];
  }

  if (window.hpCore && window.hpCore.__stable) {
    try { console.log('[HP Core] Already initialized'); } catch (_) {}
    return;
  }

  const events = Object.create(null);
  const throttleMap = new Map();
  const resourceProbeCache = new Map();
  const localFallbackSessions = new Map();

  function normalizeEventType(value) {
    if (window.PracticeCore && window.PracticeCore.protocol && typeof window.PracticeCore.protocol.normalizeMessageType === 'function') {
      return window.PracticeCore.protocol.normalizeMessageType(value);
    }
    return String(value || '').toUpperCase();
  }

  function isPracticeCompleteType(value) {
    if (window.PracticeCore && window.PracticeCore.protocol && typeof window.PracticeCore.protocol.isPracticeCompleteType === 'function') {
      return window.PracticeCore.protocol.isPracticeCompleteType(value);
    }
    return normalizeEventType(value) === 'PRACTICE_COMPLETE';
  }

  function asObject(value) {
    return value && typeof value === 'object' ? value : {};
  }

  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

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

    const comparison = envelope.answerComparison
      || nestedData.answerComparison
      || result.answerComparison
      || nestedResult.answerComparison;
    const comparisonCount = countFromAnswerComparison(comparison);

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

    return {
      correct,
      total,
      percentage: normalizedPercentage,
      duration,
      sessionId,
      completedAt,
      title,
      category,
      raw: payload
    };
  }

  function safeParentOrigin() {
    try {
      const origin = window.location && window.location.origin;
      if (origin && origin !== 'null') return origin;
    } catch (_) {}
    return 'null';
  }

  function clearLocalHandshake(sessionId, reason) {
    if (!sessionId) return;
    const record = localFallbackSessions.get(sessionId);
    if (!record) return;
    localFallbackSessions.delete(sessionId);
    try {
      if (record.timer) clearInterval(record.timer);
    } catch (_) {}
    record.status = reason;
    if (reason === 'timeout') {
      try { console.warn('[hpCore] 握手超时，练习页可能未加载增强器', { sessionId, examId: record.examId }); } catch (_) {}
    }
    try {
      if (typeof record.onStatus === 'function') {
        record.onStatus(reason, record);
      }
      if (reason === 'timeout' && typeof record.onTimeout === 'function') {
        record.onTimeout(record);
      } else if ((reason === 'ready' || reason === 'complete') && typeof record.onReady === 'function') {
        record.onReady(record, reason);
      } else if (reason === 'closed' && typeof record.onClosed === 'function') {
        record.onClosed(record);
      }
    } catch (callbackError) {
      try { console.warn('[hpCore] handshake callback error', callbackError); } catch (_) {}
    }
  }

  function startLocalHandshake(examWindow, exam, fallbackExamId, options) {
    if (!examWindow) return;
    const examId = (exam && exam.id) || fallbackExamId || 'exam';
    const sessionId = `${examId}_${Date.now()}`;
    const payload = { examId, sessionId, parentOrigin: safeParentOrigin() };
    let attempts = 0;
    const maxAttempts = 30;

    const tick = () => {
      if (!examWindow || examWindow.closed) {
        clearLocalHandshake(sessionId, 'closed');
        return;
      }
      try {
        if (attempts === 0) {
          console.log('[hpCore] 发送 INIT_SESSION 到练习页', payload);
        }
        examWindow.postMessage({ type: 'INIT_SESSION', data: payload }, '*');
        examWindow.postMessage({ type: 'init_exam_session', data: payload }, '*');
      } catch (_) {}
      attempts += 1;
      if (attempts >= maxAttempts) {
        clearLocalHandshake(sessionId, 'timeout');
      }
    };

    const record = {
      examId,
      exam: exam || null,
      win: examWindow,
      timer: null,
      sessionId,
      attemptIndex: options && typeof options.attemptIndex === 'number' ? options.attemptIndex : 0,
      attempts: options && Array.isArray(options.attempts) ? options.attempts : null,
      onTimeout: options && typeof options.onTimeout === 'function' ? options.onTimeout : null,
      onReady: options && typeof options.onReady === 'function' ? options.onReady : null,
      onClosed: options && typeof options.onClosed === 'function' ? options.onClosed : null,
      onStatus: options && typeof options.onStatus === 'function' ? options.onStatus : null,
      status: 'pending'
    };

    const timer = setInterval(tick, 300);
    record.timer = timer;
    localFallbackSessions.set(sessionId, record);
    try { console.log('[hpCore] 启动本地握手', payload); } catch (_) {}
    tick();

    if (window.hpCore) {
      try {
        window.hpCore.lastOpenedExamId = examId;
        window.hpCore.lastOpenedExam = exam || null;
        window.hpCore.lastOpenedSessionId = sessionId;
      } catch (_) {}
    }
    try {
      window._lastOpenedExamId = examId;
      if (exam) window._lastOpenedExam = exam;
    } catch (_) {}
  }

  function ensureHandshake(examWindow, exam, fallbackExamId, options) {
    if (!examWindow) return;
    if (typeof window.startHandshakeFallback === 'function') {
      try {
        const examId = (exam && exam.id) || fallbackExamId;
        window.startHandshakeFallback(examWindow, examId);
      } catch (_) {}
    }
    startLocalHandshake(examWindow, exam, fallbackExamId, options || null);
  }

  function ingestLocalPracticeRecord(examId, payload, context) {
    if (!examId) return;
    try {
      if (window.PracticeCore && window.PracticeCore.ingestor && window.PracticeCore.store) {
        const exams = readExamIndexSnapshot();
        const contextExam = context && context.exam
          ? context.exam
          : (context && context.id && !context.exam ? context : null);
        const exam = contextExam || exams.find((item) => item && item.id === examId) || {};
        const record = window.PracticeCore.ingestor.fromCompletion(payload, {
          examId,
          sessionId: context && context.sessionId ? context.sessionId : null,
          metadata: {
            examId,
            examTitle: exam.title || '',
            category: exam.category || '',
            frequency: exam.frequency || 'unknown',
            type: exam.type || null
          }
        }, exam, { maxRecords: 1000 });
        if (record) {
          Promise.resolve(window.PracticeCore.store.savePracticeRecord(record, { maxRecords: 1000 }))
            .then(() => {
              if (window.hpCore && typeof window.hpCore._loadRecords === 'function') {
                window.hpCore._loadRecords().catch(() => {});
              }
            })
            .catch((error) => { try { console.warn('[hpCore] PracticeCore 保存失败', error); } catch (_) {} });
          try { window.hpCore && window.hpCore.showMessage && window.hpCore.showMessage('练习已完成，记录已同步', 'success'); } catch (_) {}
          return;
        }
      }

      const snapshot = readPracticeRecordsSnapshot();
      const records = Array.isArray(snapshot) ? snapshot.slice() : [];
      const exams = readExamIndexSnapshot();
      const contextExam = context && context.exam
        ? context.exam
        : (context && context.id && !context.exam ? context : null);
      const exam = contextExam || exams.find((item) => item && item.id === examId) || {};
      const normalized = normalizePracticePayload(payload);

      const totalQuestions = Number.isFinite(normalized.total) ? normalized.total : 0;
      const correct = Number.isFinite(normalized.correct) ? normalized.correct : 0;
      const accuracy = totalQuestions > 0 ? (correct / totalQuestions) : 0;
      const percentageRaw = Number.isFinite(normalized.percentage) ? normalized.percentage : Math.round(accuracy * 100);
      const percentage = Math.max(0, Math.min(100, percentageRaw));

      let duration = normalized.duration;
      if (Number.isFinite(duration)) {
        duration = duration > 1000 ? Math.round(duration / 1000) : Math.round(duration);
      } else {
        duration = undefined;
      }

      let completedAt = normalized.completedAt ? new Date(normalized.completedAt) : new Date();
      if (!(completedAt instanceof Date) || Number.isNaN(completedAt.getTime())) {
        completedAt = new Date();
      }

      const sessionId = normalized.sessionId
        || (payload && (payload.sessionId || payload.sessionID))
        || (context && context.sessionId);
      if (sessionId) {
        for (let i = records.length - 1; i >= 0; i -= 1) {
          const item = records[i];
          if (item && item.sessionId && item.sessionId === sessionId) {
            records.splice(i, 1);
          }
        }
      }

      const rawType = exam.type || (payload && payload.type) || null;
      const recordType = rawType ? String(rawType).toLowerCase() : undefined;

      const record = {
        id: Date.now(),
        examId,
        sessionId: sessionId || undefined,
        title: normalized.title || exam.title || '',
        category: normalized.category || exam.category || '',
        frequency: exam.frequency || (payload && payload.frequency) || undefined,
        type: recordType,
        percentage,
        accuracy,
        score: correct,
        totalQuestions,
        duration,
        date: completedAt.toISOString(),
        realData: normalized.raw || payload || {}
      };

      records.unshift(record);

      if (window.hpCore && typeof window.hpCore._setRecords === 'function') {
        window.hpCore._setRecords(records);
      }

      if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.replacePracticeRecords === 'function') {
        Promise.resolve(window.PracticeCore.store.replacePracticeRecords(records)).catch(() => {});
      } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.savePracticeRecords === 'function') {
        Promise.resolve(window.simpleStorageWrapper.savePracticeRecords(records)).catch(() => {});
      } else if (window.storage && typeof storage.set === 'function') {
        try {
          const practiceKey = ['practice', 'records'].join('_');
          const maybeSet = storage.set(practiceKey, records);
          if (maybeSet && typeof maybeSet.then === 'function') {
            maybeSet.catch(() => {});
          }
        } catch (_) {}
      }

      try { window.hpCore && window.hpCore.showMessage && window.hpCore.showMessage('练习已完成，记录已同步', 'success'); } catch (_) {}
    } catch (error) {
      try { console.warn('[hpCore] 本地保存练习记录失败', error); } catch (_) {}
    }
  }

  function shouldBypassProbe(url) {
    if (!url) return false;
    if (typeof window === 'undefined') return false;
    if (window.__HP_DISABLE_PROBE__ === true) return true;
    try {
      const resolved = new URL(url, window.location.href);
      const protocol = (resolved.protocol || '').toLowerCase();
      if (protocol === 'file:' || protocol === 'app:' || protocol === 'chrome-extension:' || protocol === 'capacitor:' || protocol === 'ionic:') {
        return true;
      }
      if (window.location && window.location.protocol === 'file:' && !isAbsolutePath(url)) {
        return true;
      }
    } catch (error) {
      if (window.location && window.location.protocol === 'file:' && !isAbsolutePath(url)) {
        return true;
      }
    }
    return false;
  }

  function safeJsonParse(v) { try { return JSON.parse(v); } catch (_) { return null; } }
  function coerceArray(x) { return Array.isArray(x) ? x : (x ? [x] : []); }
  function markTypes(list, type) {
    return (list || []).map(function (e) { if (e && !e.type) e.type = type; return e; });
  }

  function isAbsolutePath(value) {
    if (!value) return false;
    return /^(?:[a-z]+:)?\/\//i.test(value) || /^[A-Za-z]:\\/.test(value);
  }

  function resolveAttemptUrl(path) {
    if (!path) return '';
    if (isAbsolutePath(path)) return path;
    try {
      const baseHref = (typeof window !== 'undefined' && window.location && window.location.href)
        ? window.location.href
        : undefined;
      return new URL(path, baseHref).href;
    } catch (_) {
      return path;
    }
  }

  function getResourceAttemptsFromCore(exam, kind) {
    if (window.ResourceCore && typeof window.ResourceCore.getResourceAttempts === 'function') {
      return window.ResourceCore.getResourceAttempts(exam, kind);
    }
    return [];
  }

  function probeResource(url) {
    if (!url) return Promise.resolve(false);
    if (resourceProbeCache.has(url)) {
      return resourceProbeCache.get(url);
    }
    const attempt = (async () => {
      if (shouldBypassProbe(url)) {
        return true;
      }
      try {
        const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (response && (response.ok || response.status === 304 || response.status === 405 || response.type === 'opaque')) {
          return true;
        }
        if (response && response.status >= 400) {
          return false;
        }
      } catch (headError) {
        if (shouldBypassProbe(url)) {
          return true;
        }
        try {
          const response = await fetch(url, { method: 'GET', cache: 'no-store', mode: 'no-cors' });
          if (!response) return false;
          if (typeof response.ok === 'boolean') {
            return response.ok;
          }
          return response.type === 'opaque';
        } catch (_) {
          if (shouldBypassProbe(url)) {
            return true;
          }
          return false;
        }
      }
      return false;
    })();
    resourceProbeCache.set(url, attempt);
    return attempt;
  }

  async function resolveResourceFromCore(exam, kind) {
    const attempts = getResourceAttemptsFromCore(exam, kind);
    for (let i = 0; i < attempts.length; i += 1) {
      const entry = attempts[i];
      try {
        const ok = await probeResource(entry.path);
        if (ok) {
          return { url: entry.path, attempts };
        }
      } catch (error) {
        console.warn('[hpCore] 资源探测失败', entry, error);
      }
    }
    return { url: '', attempts };
  }

  function openResourceFallback(exam, kind, attempts) {
    const title = exam && exam.title ? exam.title : '题目';
    const resourceLabel = kind === 'pdf' ? 'PDF 资源' : '练习资源';
    const attemptList = Array.isArray(attempts)
      ? attempts
        .filter((entry) => entry && entry.path)
        .map((entry) => `• ${entry.path}`)
      : [];
    const messageLines = [
      `${title} 的 ${resourceLabel} 未找到，请检查题库目录或重新加载题库。`
    ];
    if (attemptList.length) {
      messageLines.push('尝试过以下路径：');
      messageLines.push(...attemptList);
    }
    const message = messageLines.join('\n');

    if (hpCore && typeof hpCore.showMessage === 'function') {
      hpCore.showMessage(message, 'error');
    } else {
      try {
        window.alert(message);
      } catch (_) {
        console.error('[hpCore] 资源缺失：' + message);
      }
    }

    console.warn('[hpCore] 资源缺失', {
      exam,
      kind,
      attempts
    });

    return null;
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
    lastOpenedExamId: null,
    lastOpenedExam: null,
    lastOpenedSessionId: null,

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
        const payload = ev && ev.data ? ev.data : {};
        const normalized = normalizeEventType(payload.type);
        if (normalized === 'SESSION_READY') {
          const sid = payload.sessionId || payload.sessionID;
          if (sid) clearLocalHandshake(sid, 'ready');
          return;
        }

        if (!normalized) return;

        if (isPracticeCompleteType(normalized)) {
          const sid = payload.sessionId || payload.sessionID;
          const sessionEntry = sid ? localFallbackSessions.get(sid) : null;
          if (sid) clearLocalHandshake(sid, 'complete');

          const mainHandles = typeof window.startHandshakeFallback === 'function';
          if (!mainHandles) {
            const derivedExamId = payload.examId
              || payload.examID
              || (sessionEntry && sessionEntry.examId)
              || this.lastOpenedExamId;

            if (derivedExamId) {
              if (typeof window.savePracticeRecordFallback === 'function') {
                Promise.resolve(window.savePracticeRecordFallback(derivedExamId, payload))
                  .catch((error) => { try { console.warn('[hpCore] 保存练习记录失败', error); } catch (_) {} })
                  .finally(() => { setTimeout(() => this._loadRecords(), 400); });
              } else {
                const recordContext = sessionEntry || { exam: this.lastOpenedExam || null };
                ingestLocalPracticeRecord(derivedExamId, payload, recordContext);
                setTimeout(() => this._loadRecords(), 400);
              }
            } else {
              setTimeout(() => this._loadRecords(), 600);
            }
          } else {
            setTimeout(() => this._loadRecords(), 800);
          }
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
    const stateService = getStateService();
    if (stateService && typeof stateService.getExamIndex === 'function') {
      return cloneArray(stateService.getExamIndex());
    }
    if (Array.isArray(window.examIndex)) {
      return cloneArray(window.examIndex);
    }
    return cloneArray(hpCore.examIndex);
  }

  function readPracticeRecordsSnapshot() {
    const stateService = getStateService();
    if (stateService && typeof stateService.getPracticeRecords === 'function') {
      return cloneArray(stateService.getPracticeRecords());
    }
    if (Array.isArray(window.practiceRecords)) {
      return cloneArray(window.practiceRecords);
    }
    return cloneArray(hpCore.practiceRecords);
  }

  function syncExamIndex(list) {
    const normalized = cloneArray(list);
    let synced = normalized;

    const stateService = getStateService();
    if (stateService && typeof stateService.setExamIndex === 'function') {
      synced = cloneArray(stateService.setExamIndex(normalized));
    } else {
      try { window.examIndex = synced.slice(); } catch (_) {}
    }
    hpCore.examIndex = synced;
    return synced;
  }

  function syncPracticeRecords(list) {
    const normalized = cloneArray(list);
    let synced = normalized;

    const stateService = getStateService();
    if (stateService && typeof stateService.setPracticeRecords === 'function') {
      synced = cloneArray(stateService.setPracticeRecords(normalized));
    } else {
      try { window.practiceRecords = synced.slice(); } catch (_) {}
    }
    hpCore.practiceRecords = synced;
    return synced;
  }

  function subscribeAdapterUpdates() {
    const stateService = getStateService();
    if (!stateService || typeof stateService.subscribe !== 'function') {
      return;
    }

    stateService.subscribe('examIndex', function (value) {
      const next = cloneArray(value);
      hpCore.examIndex = next;
      hpCore.emit('dataUpdated', {
        examIndex: next,
        practiceRecords: hpCore.practiceRecords,
        __source: 'hp-core'
      });
    });

    stateService.subscribe('practiceRecords', function (value) {
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

  if (getStateService()) {
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
    hpCore.startExam = function startExam(examId) {
      try { if (typeof window.openExam === 'function') return window.openExam(examId); } catch (_) {}
      try { if (window.app && typeof window.app.openExam === 'function') return window.app.openExam(examId); } catch (_) {}
      try {
        const list = readExamIndexSnapshot();
        const exam = list.find(function (x) { return x && x.id === examId; });
        if (!exam) { this.showMessage('未找到题目', 'error'); return; }
        if (!exam.hasHtml) { this.viewExamPDF(examId); return; }

        const self = this;
        resolveResourceFromCore(exam, 'html')
          .then((result) => {
            const attempts = Array.isArray(result.attempts) && result.attempts.length
              ? result.attempts
              : getResourceAttemptsFromCore(exam, 'html');

            if (!attempts.length) {
              self.showMessage('未找到题目文件，已打开路径排查页', 'warning');
              const fallbackWin = openResourceFallback(exam, 'html', result.attempts);
              if (!fallbackWin) {
                self.showMessage('题库资源未找到，请在设置中检查题库路径', 'error');
              }
              return;
            }

            const tryOpen = (index) => {
              if (index >= attempts.length) {
                self.showMessage('题库资源未找到，请在设置中检查题库路径', 'error');
                openResourceFallback(exam, 'html', attempts);
                return;
              }

              const entry = attempts[index];
              if (!entry || !entry.path) {
                tryOpen(index + 1);
                return;
              }

              const resolvedUrl = resolveAttemptUrl(entry.path);
              let win = null;
              try {
                win = window.open(resolvedUrl, 'exam_' + examId, 'width=1200,height=800,scrollbars=yes,resizable=yes');
              } catch (_) {}

              if (!win) {
                self.showMessage('无法打开窗口，请检查弹窗设置', 'error');
                return;
              }

              self.showMessage('正在打开: ' + (exam.title || examId), 'info');
              self.lastOpenedExamId = examId;
              self.lastOpenedExam = exam;

              const handshakeOptions = {
                attemptIndex: index,
                attempts,
                onTimeout() {
                  try {
                    if (win && !win.closed) {
                      win.close();
                    }
                  } catch (_) {}
                  tryOpen(index + 1);
                }
              };

              ensureHandshake(win, exam, examId, handshakeOptions);
            };

            tryOpen(0);
          })
          .catch((error) => {
            try { console.error('[hpCore.startExam] 资源解析失败', error); } catch (_) {}
            self.showMessage('无法启动练习', 'error');
          });
      } catch (e) {
        try { console.error('[hpCore.startExam fallback] failed', e); } catch (_) {}
        this.showMessage('无法启动练习', 'error');
      }
    };
    hpCore.viewExamPDF = function viewExamPDF(examId) {
      try { if (typeof window.viewPDF === 'function') return window.viewPDF(examId); } catch (_) {}
      try {
        const list = readExamIndexSnapshot();
        const exam = list.find(function (x) { return x && x.id === examId; });
        if (!exam || !exam.pdfFilename) { this.showMessage('未找到PDF文件', 'error'); return; }

        const self = this;
        resolveResourceFromCore(exam, 'pdf')
          .then((result) => {
            const attempts = Array.isArray(result.attempts) && result.attempts.length
              ? result.attempts
              : getResourceAttemptsFromCore(exam, 'pdf');
            const first = attempts.find((entry) => entry && entry.path);
            const targetUrl = first ? resolveAttemptUrl(first.path) : (result.url ? resolveAttemptUrl(result.url) : '');
            if (targetUrl) {
              if (typeof window.openPDFSafely === 'function') {
                window.openPDFSafely(targetUrl, exam.title || 'PDF');
              } else {
                const win = window.open(targetUrl, 'pdf_' + examId, 'width=1000,height=800,scrollbars=yes,resizable=yes');
                if (!win) self.showMessage('无法打开PDF窗口', 'error');
              }
            } else {
              self.showMessage('未能生成 PDF 路径，已打开排查页', 'warning');
              openResourceFallback(exam, 'pdf', attempts.length ? attempts : result.attempts);
            }
          })
          .catch((error) => {
            try { console.error('[hpCore.viewExamPDF] 资源解析失败', error); } catch (_) {}
            self.showMessage('无法打开PDF', 'error');
          });
      } catch (e) {
        try { console.error('[hpCore.viewExamPDF fallback] failed', e); } catch (_) {}
        this.showMessage('无法打开PDF', 'error');
      }
    };
  } catch(_){}
})();
