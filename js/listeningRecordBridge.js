(function () {
  'use strict';

  var TAG = '[ListeningBridge]';

  var state = {
    sessionId: null,
    examId: null,
    suiteSessionId: null,
    startTime: Date.now(),
    initialized: false,
    completed: false,
    parentWindow: null,
    initRequestTimer: null,
    initRequestAttempts: 0
  };

  function log() {
    var args = [TAG];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function warn() {
    var args = [TAG];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.warn.apply(console, args);
  }

  function findParentWindow() {
    if (window.opener && typeof window.opener.postMessage === 'function') {
      return window.opener;
    }
    if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
      return window.parent;
    }
    return null;
  }

  function isHttpOrigin(origin) {
    return typeof origin === 'string' && origin !== 'null' && /^https?:\/\//i.test(origin);
  }

  function getTrustedParentOrigin() {
    var origin = window.location && window.location.origin;
    if (isHttpOrigin(origin)) {
      return origin;
    }

    try {
      var referrer = window.document && window.document.referrer;
      if (referrer) {
        var parsed = new URL(referrer, window.location && window.location.href ? window.location.href : undefined);
        if (isHttpOrigin(parsed.origin)) {
          return parsed.origin;
        }
      }
    } catch (e) {
      warn('无法解析父页面 referrer:', e);
    }

    return '';
  }

  function getMessageTargetOrigin() {
    return getTrustedParentOrigin() || '*';
  }

  function isAllowedParentMessage(event) {
    if (!event) return false;
    var expected = state.parentWindow || findParentWindow();
    if (event.source && expected && event.source !== expected) {
      return false;
    }
    if (!event.origin || event.origin === 'null') {
      return Boolean(window.location && window.location.protocol === 'file:');
    }
    var allowedOrigin = getTrustedParentOrigin();
    if (!allowedOrigin || event.origin !== allowedOrigin) {
      return false;
    }
    return true;
  }

  function sendMessage(type, data) {
    var pw = state.parentWindow || findParentWindow();
    if (!pw) {
      warn('无法 send message — no parent window');
      return false;
    }
    try {
      pw.postMessage({ type: type, data: data || {}, source: 'listening_record_bridge', timestamp: Date.now() }, getMessageTargetOrigin());
      return true;
    } catch (e) {
      warn('postMessage failed:', e);
      return false;
    }
  }

  function buildSessionReadyPayload(status) {
    return {
      sessionId: state.sessionId,
      examId: state.examId,
      suiteSessionId: state.suiteSessionId,
      status: status || (state.initialized ? 'ready' : 'bootstrapped'),
      initialized: !!state.initialized,
      readyState: state.initialized ? 'initialized' : 'bootstrapped',
      pageType: 'listening',
      type: 'listening',
      url: window.location && window.location.href || '',
      title: window.document && window.document.title || '',
      source: 'listening_record_bridge',
      protocolVersion: 2
    };
  }

  function sendSessionReady(status) {
    return sendMessage('SESSION_READY', buildSessionReadyPayload(status));
  }

  function sendInitRequest(reason) {
    return sendMessage('REQUEST_INIT', {
      sessionId: state.sessionId,
      examId: state.examId,
      suiteSessionId: state.suiteSessionId,
      reason: reason || 'init_required',
      initialized: !!state.initialized,
      pageType: 'listening',
      type: 'listening',
      source: 'listening_record_bridge',
      protocolVersion: 2
    });
  }

  function stopInitRequestLoop() {
    if (state.initRequestTimer) {
      clearInterval(state.initRequestTimer);
      state.initRequestTimer = null;
    }
  }

  function startInitRequestLoop() {
    if (state.initialized || state.initRequestTimer) return;
    if (!state.parentWindow && !findParentWindow()) return;

    state.initRequestAttempts = 0;
    var tick = function () {
      if (state.initialized) {
        stopInitRequestLoop();
        return;
      }
      state.initRequestAttempts++;
      sendInitRequest(state.initRequestAttempts === 1 ? 'bootstrap' : 'retry');
      if (state.initRequestAttempts >= 20) {
        stopInitRequestLoop();
      }
    };

    tick();
    state.initRequestTimer = setInterval(tick, 500);
  }

  function cssAttr(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function getText(node) {
    return String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function cleanAnswer(text) {
    var value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return '';
    if (/^(?:No Answer|未作答|[-—–]+)$/i.test(value)) return '';
    return value;
  }

  function normalizeComparableAnswer(text) {
    var v = String(text || '').trim().toLowerCase();
    v = v.replace(/^['"]+|['"]+$/g, '');
    v = v.replace(/[-—–]/g, ' ');
    v = v.replace(/\s+/g, ' ').trim();
    return v;
  }

  function compareAnswersSimple(userAnswer, correctAnswer) {
    if (window.AnswerMatchCore && typeof window.AnswerMatchCore.compareAnswers === 'function') {
      try {
        var result = window.AnswerMatchCore.compareAnswers(userAnswer, correctAnswer);
        if (result === true) return true;
        if (result === false) return false;
      } catch (e) {}
    }
    var nu = normalizeComparableAnswer(userAnswer);
    var nc = normalizeComparableAnswer(correctAnswer);
    if (!nu || !nc) return false;
    return nu === nc;
  }

  function toTimestampMs(value, fallback) {
    var numeric = Number(value);
    if (isFinite(numeric) && numeric > 0) return numeric;
    var parsed = Date.parse(value);
    if (isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
  }

  function normalizeAcceptedAnswers(value, mode) {
    var values = Array.isArray(value) ? value.slice() : [value];
    var splitPattern = mode === 'multiple' ? /[|,;]+/ : /\|+/;
    var result = [];
    for (var i = 0; i < values.length; i++) {
      var raw = values[i];
      if (raw == null) continue;
      var parts = String(raw).split(splitPattern);
      for (var j = 0; j < parts.length; j++) {
        var item = String(parts[j] || '').trim();
        if (item) result.push(item);
      }
    }
    return result;
  }

  function formatCorrectAnswer(value, mode) {
    var answers = normalizeAcceptedAnswers(value, mode);
    if (mode === 'multiple') return answers.join(', ');
    return answers.join(' / ');
  }

  function compareAgainstAccepted(userAnswer, correctValue, mode) {
    var accepted = normalizeAcceptedAnswers(correctValue, mode);
    if (!accepted.length) return false;
    for (var i = 0; i < accepted.length; i++) {
      if (compareAnswersSimple(userAnswer, accepted[i])) return true;
    }
    return false;
  }

  function makeDetail(question, userAnswer, correctAnswer, isCorrect, acceptedAnswers) {
    var accepted = Array.isArray(acceptedAnswers)
      ? acceptedAnswers.map(function (value) { return String(value || '').trim(); }).filter(Boolean)
      : [];
    var canonical = accepted[0] || String(correctAnswer || '').trim();
    return {
      question: question,
      userAnswer: userAnswer,
      correctAnswer: correctAnswer,
      acceptedAnswers: accepted,
      canonicalAnswer: canonical,
      isCorrect: !!isCorrect
    };
  }

  function arraysEqualSet(a, b) {
    if (a.length !== b.length) return false;
    var sortedA = a.slice().sort();
    var sortedB = b.slice().sort();
    for (var i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return false;
    }
    return true;
  }

  function normalizeQuestionLabel(rawQuestion, fallbackIndex) {
    var raw = String(rawQuestion != null ? rawQuestion : '').replace(/\s+/g, ' ').trim();
    if (!raw) return String((fallbackIndex || 0) + 1);
    var explicitKey = raw.match(/[（(]\s*(q?\d{1,3}(?:\s*[-–—_]\s*\d{1,3})?)\s*[）)]/i);
    if (explicitKey) {
      return explicitKey[1].replace(/\s+/g, '').replace(/^Q/, 'q');
    }
    raw = raw.replace(/^questions?\s*/i, '').replace(/^q\s*/i, '');
    var range = raw.match(/(\d{1,3})(?:\s*[-–—_]\s*(\d{1,3}))?/);
    if (range) {
      return range[2] ? range[1] + '-' + range[2] : range[1];
    }
    return raw.replace(/^q/i, '');
  }

  function toQuestionKey(rawQuestion, fallbackIndex) {
    var label = normalizeQuestionLabel(rawQuestion, fallbackIndex);
    if (!label) return 'q' + ((fallbackIndex || 0) + 1);
    return /^q/i.test(label) ? label.replace(/^Q/, 'q') : 'q' + label;
  }

  function detectSource(examId) {
    if (!examId || typeof examId !== 'string') return 'other';
    var low = examId.toLowerCase();
    if (low.indexOf('p1') >= 0 || low.indexOf('part1') >= 0 || low.indexOf('part-1') >= 0) return 'p1';
    if (low.indexOf('p4') >= 0 || low.indexOf('part4') >= 0 || low.indexOf('part-4') >= 0) return 'p4';
    if (window.spellingErrorCollector && typeof window.spellingErrorCollector.detectSource === 'function') {
      return window.spellingErrorCollector.detectSource(examId);
    }
    return 'other';
  }

  function parseTableRows(doc, selector, options) {
    options = options || {};
    var rows = Array.prototype.slice.call(doc.querySelectorAll(selector));
    var validRows = rows.filter(function (row) {
      return row.querySelectorAll('td').length >= 3;
    });
    if (!validRows.length) return [];

    return validRows.map(function (row) {
      var cells = row.querySelectorAll('td');
      var question = getText(cells[0]);
      var userAnswer = cleanAnswer(getText(cells[1]));
      var correctAnswer = cleanAnswer(getText(cells[2]));
      var resultCell = cells.length >= 4 ? cells[3] : null;
      var resultText = getText(resultCell);
      var resultClass = String(resultCell && resultCell.className || '');
      var sameAnswer = !!userAnswer && normalizeComparableAnswer(userAnswer) === normalizeComparableAnswer(correctAnswer);
      var isCorrect = sameAnswer;
      if (!isCorrect && resultCell && options.checker) {
        isCorrect = options.checker(resultText, resultClass, resultCell);
      }
      return makeDetail(question, userAnswer, correctAnswer, isCorrect, normalizeAcceptedAnswers(correctAnswer, 'text'));
    });
  }

  function parseResultsFromDocument(doc) {
    var s1 = parseTableRows(doc, '.results-table tbody tr, .results-table tr', {
      checker: function (t) { return /correct/i.test(t) && !/incorrect/i.test(t); }
    });
    if (s1.length) return s1;

    var s2 = parseTableRows(doc, '.result-table tr', {
      checker: function (t, c) {
        return ((/correct|right/i.test(t) && !/incorrect|wrong/i.test(t))
          || /res-correct|ans-correct|correct/i.test(c)
          || /^(?:✓|✔|\u2713|\u2714)$/u.test(t));
      }
    });
    if (s2.length) return s2;

    var s3 = parseTableRows(doc, '.review-table tr');
    if (s3.length) return s3;

    var s4 = parseTableRows(doc, '.ans-table tbody tr, .ans-table tr');
    if (s4.length) return s4;

    var s5 = parseTableRows(doc, '.feedback .grade-report tr', {
      checker: function (t, c, cell) {
        var styleColor = String(cell && cell.style && cell.style.color || '').trim().toLowerCase();
        return ((/correct|right|✓|✔|\u2713|\u2714/i.test(t))
          || /correct/i.test(c)
          || styleColor === 'green'
          || styleColor === 'rgb(0, 128, 0)'
          || (cell && cell.matches && cell.matches('[style*="green" i]')))
          && !/incorrect|wrong/i.test(t);
      }
    });
    if (s5.length) return s5;

    var reviewItems = Array.prototype.slice.call(doc.querySelectorAll('#reviewList .rvItem'));
    if (reviewItems.length) {
      return reviewItems.map(function (item) {
        var question = getText(item.querySelector('.rvQ'));
        var rows = item.querySelectorAll('.rvRow');
        var userBadge = rows[0] && rows[0].querySelector('span:last-child');
        var correctBadge = rows[1] && rows[1].querySelector('span:last-child');
        var userAnswer = cleanAnswer(getText(userBadge));
        var correctAnswer = cleanAnswer(getText(correctBadge));
        var isCorrect = !!userBadge && userBadge.classList.contains('badge') && !userBadge.classList.contains('bad');
        return makeDetail(question, userAnswer, correctAnswer, isCorrect, normalizeAcceptedAnswers(correctAnswer, 'text'));
      });
    }

    return [];
  }

  function parseGeneratedResultsHtml(html) {
    if (typeof html !== 'string' || !html.trim() || typeof DOMParser !== 'function') {
      return [];
    }
    try {
      var parsedDoc = new DOMParser().parseFromString(html, 'text/html');
      return parseResultsFromDocument(parsedDoc);
    } catch (e) {
      warn('parseGeneratedResultsHtml failed:', e);
      return [];
    }
  }

  function parseObjectLiteral(text, startIndex, label) {
    label = label || 'inline';
    if (startIndex >= text.length) return null;
    var depth = 0;
    var i = startIndex;
    var started = false;
    var objectStart = -1;
    for (; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '{') {
        if (!started) objectStart = i;
        depth++;
        started = true;
      }
      else if (ch === '}') { depth--; if (started && depth === 0) break; }
      else if (ch === '\'' || ch === '"') {
        var quote = ch;
        for (i++; i < text.length; i++) {
          if (text.charAt(i) === '\\' && i + 1 < text.length) { i++; continue; }
          if (text.charAt(i) === quote) break;
        }
      }
    }
    if (!started || depth !== 0) return null;
    var snippet = text.substring(objectStart, i + 1);
    try {
      return parseSafeObjectLiteral(snippet);
    } catch (e) {
      warn('parseObjectLiteral failed for', label, e);
      return null;
    }
  }

  function parseSafeObjectLiteral(snippet) {
    var source = String(snippet || '').trim();
    if (!source) return null;
    if (/[`;]|\bfunction\b|=>/.test(source) || /[{,]\s*\[/.test(source)) {
      throw new Error('unsafe object literal');
    }
    var json = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, function (_, body) {
        return JSON.stringify(body.replace(/\\'/g, "'"));
      })
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(json);
  }

  function readInlineAnswerConfig(doc) {
    var scripts = Array.prototype.slice.call(doc.scripts || []);

    for (var si = 0; si < scripts.length; si++) {
      var text = scripts[si].textContent || '';
      var configMatch = text.match(/\b(?:const|let|var)\s+(?:CONFIG_DATA|CONFIG)\s*=/);
      if (configMatch) {
        var config = parseObjectLiteral(text, configMatch.index + configMatch[0].length, 'inline CONFIG');
        if (config && (config.answerKey || config.answers)) {
          return {
            answerKey: config.answerKey || null,
            answers: config.answers || null,
            questionList: config.questionList || config.questionIds || config.questions || config.qs || []
          };
        }
      }
    }

    var answerKey = null;
    var questionList = null;
    try {
      if (typeof ANSWER_KEY !== 'undefined') answerKey = ANSWER_KEY;
      if (typeof QUESTION_LIST !== 'undefined') questionList = QUESTION_LIST;
    } catch (e) {}
    try {
      if (!answerKey && window.ANSWER_KEY) answerKey = window.ANSWER_KEY;
      if (!questionList && window.QUESTION_LIST) questionList = window.QUESTION_LIST;
    } catch (e) {}
    try {
      var rootConfig = window.CONFIG_DATA || window.CONFIG;
      if (rootConfig && typeof rootConfig === 'object') {
        if (!answerKey && rootConfig.answerKey) answerKey = rootConfig.answerKey;
        if (!questionList && rootConfig.questionList) questionList = rootConfig.questionList;
      }
    } catch (e) {}
    if (answerKey) {
      return { answerKey: answerKey, answers: null, questionList: questionList || [] };
    }

    for (var ai = 0; ai < scripts.length; ai++) {
      var script = scripts[ai];
      var src = String(script && script.src || '');
      text = script && script.textContent || '';
      if (/listeningRecordBridge\.js/i.test(src) || /__listeningBridgeComplete|ListeningBridge/.test(text)) {
        continue;
      }

      var akIndex = text.search(/\banswerKey\s*:/);
      if (akIndex >= 0) {
        var ak = parseObjectLiteral(text, akIndex + 'answerKey:'.length, 'inline answerKey');
        if (ak) return { answerKey: ak, answers: null, questionList: [] };
      }
      var ansIndex = text.search(/\banswers\s*:/);
      if (ansIndex >= 0) {
        var ans = parseObjectLiteral(text, ansIndex + 'answers:'.length, 'inline answers');
        if (ans) return { answerKey: null, answers: ans, questionList: [] };
      }
    }

    return null;
  }

  function getAnswerInputValue(doc, question, correctAnswer, sourceKey) {
    var directName = 'q' + question;
    var rawSourceName = String(sourceKey || '');
    var sourceInputs = rawSourceName ? Array.prototype.slice.call(doc.querySelectorAll('[name="' + cssAttr(rawSourceName) + '"]')) : [];
    var directInputs = Array.prototype.slice.call(doc.querySelectorAll('[name="' + cssAttr(directName) + '"]'));
    var sourceDataInputs = rawSourceName ? Array.prototype.slice.call(doc.querySelectorAll('[data-q="' + cssAttr(rawSourceName) + '"]')) : [];
    var questionDataInputs = question ? Array.prototype.slice.call(doc.querySelectorAll('[data-q="' + cssAttr(question) + '"], [data-q="' + cssAttr(directName) + '"]')) : [];
    var multipleName = (question === '11' || question === '12') ? 'q11_12' : '';
    var multipleInputs = multipleName ? Array.prototype.slice.call(doc.querySelectorAll('[name="' + cssAttr(multipleName) + '"]')) : [];
    var inputs = sourceInputs.length
      ? sourceInputs
      : (directInputs.length
        ? directInputs
        : (sourceDataInputs.length
          ? sourceDataInputs
          : (questionDataInputs.length ? questionDataInputs : multipleInputs)));
    if (!inputs.length) return '';

    var first = inputs[0];
    if (first.type === 'checkbox' || first.type === 'radio') {
      var checked = inputs.filter(function (el) { return el.checked; }).map(function (el) { return String(el.value || '').trim(); }).filter(Boolean);
      if (first.type === 'checkbox') {
        var correct = String(correctAnswer != null ? correctAnswer : '').trim();
        if (correct && checked.indexOf(correct) >= 0) return correct;
        return checked.join(', ');
      }
      return checked[0] || '';
    }
    return String(first.value || '').trim();
  }

  function getSlotAnswerValue(doc, question, sourceKey) {
    var selectors = [
      '.match-slot[data-q="' + cssAttr(question) + '"] .tag',
      '.match-slot[data-q="' + cssAttr(sourceKey) + '"] .tag',
      '.flow-slot[data-q="' + cssAttr(question) + '"] .tag',
      '.flow-slot[data-q="' + cssAttr(sourceKey) + '"] .tag',
      '.map-slot[data-q="' + cssAttr(question) + '"] .tag',
      '.map-slot[data-q="' + cssAttr(sourceKey) + '"] .tag',
      '[data-q="' + cssAttr(question) + '"] .tag',
      '[data-q="' + cssAttr(sourceKey) + '"] .tag'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var slot = doc.querySelector(selectors[i]);
      var value = String(slot && slot.dataset && slot.dataset.value || slot && slot.textContent || '').trim();
      if (value) return value;
    }
    return '';
  }

  function isMultipleAnswerControl(doc, question, sourceKey) {
    if (!doc) return false;
    var names = [];
    if (sourceKey) names.push(String(sourceKey));
    if (question) names.push('q' + String(question).replace(/-/g, '_'));
    for (var i = 0; i < names.length; i++) {
      var inputs = Array.prototype.slice.call(doc.querySelectorAll('[name="' + cssAttr(names[i]) + '"]'));
      if (inputs.some(function (el) { return el && el.type === 'checkbox'; })) return true;
    }
    return /(?:_|-)/.test(String(sourceKey || question || ''));
  }

  function flattenAnswerKey(answerKey) {
    if (!answerKey || typeof answerKey !== 'object') return [];
    var sections = ['multiple', 'text', 'single', 'matching', 'map', 'flow', 'flowChart'];
    var flattened = [];
    for (var si = 0; si < sections.length; si++) {
      var type = sections[si];
      var group = answerKey[type];
      if (!group || typeof group !== 'object') continue;
      var keys = Object.keys(group);
      for (var ki = 0; ki < keys.length; ki++) {
        flattened.push({ type: type, key: keys[ki], value: group[keys[ki]] });
      }
    }
    if (!flattened.length) {
      var allKeys = Object.keys(answerKey);
      for (var ai = 0; ai < allKeys.length; ai++) {
        var k = allKeys[ai];
        var v = answerKey[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) continue;
        flattened.push({ type: Array.isArray(v) ? 'auto' : 'text', key: k, value: v });
      }
    }
    return flattened;
  }

  function buildDetailsFromAnswerKey(doc, answerKey) {
    if (!doc) return [];
    return flattenAnswerKey(answerKey).map(function (entry) {
      var type = entry.type;
      var key = entry.key;
      var value = entry.value;
      var question = String(key || '').replace(/^q/i, '').replace(/_/g, '-');
      if (!question) return null;
      if (type === 'auto') {
        type = isMultipleAnswerControl(doc, question, key) ? 'multiple' : 'text';
      }

      var acceptedAnswers = normalizeAcceptedAnswers(value, type);
      var correctAnswer = formatCorrectAnswer(value, type);

      var userAnswer;
      if (type === 'matching' || type === 'flow' || type === 'flowChart' || type === 'map') {
        userAnswer = getSlotAnswerValue(doc, question, key);
      } else {
        userAnswer = getAnswerInputValue(doc, question, correctAnswer, key);
      }

      var isCorrect;
      if (type === 'multiple') {
        var userTokens = String(userAnswer || '').split(',').map(normalizeComparableAnswer).filter(Boolean).sort();
        var correctTokens = acceptedAnswers.map(normalizeComparableAnswer).filter(Boolean).sort();
        isCorrect = arraysEqualSet(userTokens, correctTokens);
      } else {
        isCorrect = compareAgainstAccepted(userAnswer, value, type);
      }

      return makeDetail(question, userAnswer, correctAnswer, isCorrect, acceptedAnswers);
    }).filter(Boolean).sort(function (a, b) {
      return parseInt(a.question, 10) - parseInt(b.question, 10) || a.question.localeCompare(b.question, undefined, { numeric: true });
    });
  }

  function buildDetailsFromSimpleAnswers(doc, answers) {
    if (!doc || !answers || typeof answers !== 'object') return [];
    return Object.keys(answers).map(function (key) {
      var rawAnswer = answers[key];
      var question = String(key || '').replace(/^q/i, '');
      if (!question) return null;
      var correctAnswer = formatCorrectAnswer(rawAnswer, 'text');
      var acceptedAnswers = normalizeAcceptedAnswers(rawAnswer, 'text');
      var userAnswer = getAnswerInputValue(doc, question, correctAnswer, key);
      var isCorrect = compareAgainstAccepted(userAnswer, rawAnswer, 'text');
      return makeDetail(question, userAnswer, correctAnswer, isCorrect, acceptedAnswers);
    }).filter(Boolean).sort(function (a, b) {
      return parseInt(a.question, 10) - parseInt(b.question, 10) || a.question.localeCompare(b.question, undefined, { numeric: true });
    });
  }

  function buildDetailsFromInlineConfig(doc) {
    var config = readInlineAnswerConfig(doc);
    if (!config) return [];
    var fromAnswerKey = buildDetailsFromAnswerKey(doc, config.answerKey);
    if (fromAnswerKey.length) return fromAnswerKey;
    return buildDetailsFromSimpleAnswers(doc, config.answers);
  }

  function buildDetailsFromAppState(win) {
    var app = win && win.App;
    var config = app && app.config;
    var answerKey = config && config.answerKey;
    var questionList = Array.isArray(config && config.questionList) ? config.questionList : [];
    if (!answerKey || !questionList.length) return [];
    var doc = win.document;

    return questionList.map(function (rawNum) {
      var qNum = String(rawNum != null ? rawNum : '').trim();
      if (!qNum) return null;
      var qKey = qNum.indexOf('-') >= 0 ? 'q' + qNum.replace(/-/g, '_') : 'q' + qNum;

      if (answerKey.multiple && Array.isArray(answerKey.multiple[qKey])) {
        var userAnswers = Array.prototype.slice.call(doc.querySelectorAll('[name="' + cssAttr(qKey) + '"]:checked')).map(function (el) { return String(el.value || '').trim(); }).filter(Boolean).sort();
        var correctAnswers = Array.prototype.slice.call(answerKey.multiple[qKey]).map(function (v) { return String(v || '').trim(); }).filter(Boolean).sort();
        var nu = userAnswers.map(normalizeComparableAnswer).filter(Boolean).sort();
        var nc = correctAnswers.map(normalizeComparableAnswer).filter(Boolean).sort();
        return makeDetail(qNum, userAnswers.join(', '), correctAnswers.join(', '), arraysEqualSet(nu, nc), correctAnswers);
      }

      if (answerKey.text && answerKey.text[qKey] != null) {
        var textInput = doc.querySelector('[name="' + cssAttr(qKey) + '"]');
        var userAnswer = String(textInput && textInput.value || '').trim();
        var correctAnswer = formatCorrectAnswer(answerKey.text[qKey], 'text');
        return makeDetail(qNum, userAnswer, correctAnswer, compareAgainstAccepted(userAnswer, answerKey.text[qKey], 'text'), normalizeAcceptedAnswers(answerKey.text[qKey], 'text'));
      }

      if (answerKey.single && answerKey.single[qKey] != null) {
        var checkedEl = doc.querySelector('[name="' + cssAttr(qKey) + '"]:checked');
        var ua = checkedEl ? String(checkedEl.value || '').trim() : '';
        var ca = formatCorrectAnswer(answerKey.single[qKey], 'single');
        return makeDetail(qNum, ua, ca, compareAgainstAccepted(ua, answerKey.single[qKey], 'single'), normalizeAcceptedAnswers(answerKey.single[qKey], 'single'));
      }

      if (answerKey.matching && answerKey.matching[qKey] != null) {
        var mUA = getSlotAnswerValue(doc, qNum, qKey);
        var mCA = formatCorrectAnswer(answerKey.matching[qKey], 'matching');
        return makeDetail(qNum, mUA, mCA, compareAgainstAccepted(mUA, answerKey.matching[qKey], 'matching'), normalizeAcceptedAnswers(answerKey.matching[qKey], 'matching'));
      }

      if (answerKey.flow && answerKey.flow[qKey] != null) {
        var fUA = getSlotAnswerValue(doc, qNum, qKey);
        var fCA = formatCorrectAnswer(answerKey.flow[qKey], 'flow');
        return makeDetail(qNum, fUA, fCA, compareAgainstAccepted(fUA, answerKey.flow[qKey], 'flow'), normalizeAcceptedAnswers(answerKey.flow[qKey], 'flow'));
      }

      if (answerKey.flowChart && answerKey.flowChart[qKey] != null) {
        var fcUA = getSlotAnswerValue(doc, qNum, qKey);
        var fcCA = formatCorrectAnswer(answerKey.flowChart[qKey], 'flowChart');
        return makeDetail(qNum, fcUA, fcCA, compareAgainstAccepted(fcUA, answerKey.flowChart[qKey], 'flowChart'), normalizeAcceptedAnswers(answerKey.flowChart[qKey], 'flowChart'));
      }

      if (answerKey.map && answerKey.map[qKey] != null) {
        var mapUA = getSlotAnswerValue(doc, qNum, qKey);
        var mapCA = formatCorrectAnswer(answerKey.map[qKey], 'map');
        return makeDetail(qNum, mapUA, mapCA, compareAgainstAccepted(mapUA, answerKey.map[qKey], 'map'), normalizeAcceptedAnswers(answerKey.map[qKey], 'map'));
      }

      return null;
    }).filter(Boolean);
  }

  function extractAttemptDetails(win, options) {
    options = options || {};
    var allowGenerated = !!options.allowGenerated;
    var doc = win && win.document;
    if (!doc) return [];

    var s1 = parseResultsFromDocument(doc);
    if (s1.length) return s1;

    var app = win.App;
    var isReviewing = !!(app && app.state && (app.state.isReviewing || app.state.review));

    if ((allowGenerated || isReviewing) && app && typeof app.generateResultsTable === 'function') {
      try {
        var html = app.generateResultsTable();
        var s2 = parseGeneratedResultsHtml(html);
        if (s2.length) return s2;
      } catch (e) {
        warn('parseResultsFromHtml failed:', e);
      }
    }

    if (isReviewing) {
      var s3 = buildDetailsFromAppState(win);
      if (s3.length) return s3;
    }

    if (allowGenerated || isReviewing) {
      var s4 = buildDetailsFromInlineConfig(doc);
      if (s4.length) return s4;
    }

    return [];
  }

  function hasReviewArtifacts(doc) {
    if (!doc) return false;
    return !!doc.querySelector('.results-table, .result-table, .review-table, .ans-table, .feedback .grade-report, #reviewList');
  }

  function buildBridgePayload(details) {
    var answers = {};
    var correctAnswers = {};
    var answerComparison = {};
    var answerDetails = {};
    var correct = 0;
    var total = details.length;

    for (var i = 0; i < details.length; i++) {
      var d = details[i];
      var qId = toQuestionKey(d.question, i);
      answers[qId] = d.userAnswer;
      correctAnswers[qId] = d.correctAnswer;
      answerComparison[qId] = {
        questionId: qId,
        userAnswer: d.userAnswer,
        correctAnswer: d.correctAnswer,
        acceptedAnswers: Array.isArray(d.acceptedAnswers) ? d.acceptedAnswers.slice() : undefined,
        canonicalAnswer: d.canonicalAnswer || d.correctAnswer,
        isCorrect: d.isCorrect
      };
      answerDetails[qId] = {
        questionId: qId,
        question: d.question,
        userAnswer: d.userAnswer,
        correctAnswer: d.correctAnswer,
        acceptedAnswers: Array.isArray(d.acceptedAnswers) ? d.acceptedAnswers.slice() : undefined,
        canonicalAnswer: d.canonicalAnswer || d.correctAnswer,
        isCorrect: d.isCorrect
      };
      if (d.isCorrect) correct++;
    }

    var accuracy = total > 0 ? correct / total : 0;
    var percentage = Math.round(accuracy * 100);

    var spellingErrors = [];
    try {
      var collector = window.spellingErrorCollector;
      if (collector && typeof collector.detectErrors === 'function') {
        spellingErrors = collector.detectErrors(answerComparison, state.suiteSessionId, state.examId);
      }
    } catch (e) {
      warn('spelling error detection failed:', e);
    }

    var endTimeMs = Date.now();
    var startTimeMs = toTimestampMs(state.startTime, endTimeMs);
    var durationSec = Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000));

    return {
      examId: state.examId,
      sessionId: state.sessionId,
      suiteSessionId: state.suiteSessionId,
      startTime: startTimeMs,
      endTime: endTimeMs,
      duration: durationSec,
      answers: answers,
      correctAnswers: correctAnswers,
      answerComparison: answerComparison,
      answerDetails: answerDetails,
      scoreInfo: {
        correct: correct,
        total: total,
        accuracy: accuracy,
        percentage: percentage,
        source: 'listening_record_bridge',
        details: answerDetails
      },
      spellingErrors: spellingErrors,
      practiceType: 'listening',
      type: 'listening',
      pageType: 'listening',
      metadata: {
        type: 'listening',
        examType: 'listening',
        source: 'listening_record_bridge'
      }
    };
  }

  function onComplete(options) {
    options = options || {};
    if (state.completed) {
      log('already completed, skipping');
      return true;
    }
    state.completed = true;

    var allowGenerated = !!options.allowGenerated;
    var details = extractAttemptDetails(window, { allowGenerated: allowGenerated });
    if (!details.length && !allowGenerated) {
      var app = window.App;
      var isReviewing = !!(app && app.state && (app.state.isReviewing || app.state.review));
      if (isReviewing || hasReviewArtifacts(window.document)) {
        details = extractAttemptDetails(window, { allowGenerated: true });
      }
    }
    if (!details.length) {
      warn('no details extracted, cannot complete');
      state.completed = false;
      return false;
    }

    var payload = buildBridgePayload(details);
    log('sending PRACTICE_COMPLETE, correct=' + payload.scoreInfo.correct + '/' + payload.scoreInfo.total);
    if (!state.initialized) {
      sendInitRequest('complete_before_init');
    }
    sendMessage('PRACTICE_COMPLETE', payload);
    clearCompletionRetryTimers();
    return true;
  }

  var completionDebounceTimer = null;
  var completionDebounceOptions = null;
  var completionRetryTimers = [];
  function clearCompletionRetryTimers() {
    for (var i = 0; i < completionRetryTimers.length; i++) {
      clearTimeout(completionRetryTimers[i]);
    }
    completionRetryTimers = [];
  }

  function scheduleCompletionRetries(options) {
    clearCompletionRetryTimers();
    var retryDelays = [400, 1200, 2500];
    for (var i = 0; i < retryDelays.length; i++) {
      (function (delay) {
        completionRetryTimers.push(setTimeout(function () {
          if (!state.completed) {
            onComplete(options || {});
          }
        }, delay));
      })(retryDelays[i]);
    }
  }

  function debouncedOnComplete(delay, options) {
    if (state.completed) return;
    if (completionDebounceTimer) clearTimeout(completionDebounceTimer);
    completionDebounceOptions = options || null;
    completionDebounceTimer = setTimeout(function () {
      completionDebounceTimer = null;
      var runOptions = completionDebounceOptions || {};
      completionDebounceOptions = null;
      if (!onComplete(runOptions)) {
        scheduleCompletionRetries(runOptions);
      }
    }, delay || 300);
  }

  function hookAppFinish() {
    var app = window.App;
    if (app && !app.__listeningBridgeHooked) {
      app.__listeningBridgeHooked = true;

      var methods = ['finishTest', 'gradeAnswers', 'enterReviewMode'];
      for (var mi = 0; mi < methods.length; mi++) {
        var method = methods[mi];
        if (typeof app[method] === 'function') {
          (function (m) {
            var original = app[m];
            if (original._bridgeOriginal) return;
            app[m] = function () {
              var result = original.apply(this, arguments);
              debouncedOnComplete(500, { allowGenerated: true });
              return result;
            };
            app[m]._bridgeOriginal = original;
          })(method);
        }
      }
    }

    if (typeof window.finishTest === 'function') {
      var origWindowFinish = window.finishTest;
      if (!origWindowFinish._bridgeOriginal) {
        window.finishTest = function () {
          var result = origWindowFinish.apply(this, arguments);
          debouncedOnComplete(500, { allowGenerated: true });
          return result;
        };
        window.finishTest._bridgeOriginal = origWindowFinish;
      }
    }

    if (typeof window.gradeAnswers === 'function') {
      var origGrade = window.gradeAnswers;
      if (!origGrade._bridgeOriginal) {
        window.gradeAnswers = function () {
          var result = origGrade.apply(this, arguments);
          debouncedOnComplete(500, { allowGenerated: true });
          return result;
        };
        window.gradeAnswers._bridgeOriginal = origGrade;
      }
    }
  }

  function areCoreFinishHooksReady() {
    var hasHookTarget = !!(
      window.App
      || typeof window.finishTest === 'function'
      || typeof window.gradeAnswers === 'function'
    );
    if (!hasHookTarget) return false;
    var appReady = !window.App || !!window.App.__listeningBridgeHooked;
    var finishReady = (typeof window.finishTest !== 'function') || !!window.finishTest._bridgeOriginal;
    var gradeReady = (typeof window.gradeAnswers !== 'function') || !!window.gradeAnswers._bridgeOriginal;
    return appReady && finishReady && gradeReady;
  }

  function startHookSync() {
    var attempts = 0;
    var maxAttempts = 60; // ~30s
    var timer = setInterval(function () {
      attempts++;
      hookAppFinish();
      if (areCoreFinishHooksReady() || attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 500);
  }

  function hookButtonFinish() {
    var doc = window.document;
    if (doc.__listeningBridgeFinishDelegated) return;
    doc.__listeningBridgeFinishDelegated = true;
    var finishPattern = /\b(?:finish|submit|check(?:\s+answers?)?|review|grade|score)\b|完成|提交|交卷|查看答案|批改|评分/i;
    var actionNamePattern = /(?:^|[\s_-])(?:finish|submit|check|review|grade)(?:[\s_-]|$)|(?:finish|submit|check|review|grade)[\s_-]*(?:btn|button)|(?:btn|button)[\s_-]*(?:finish|submit|check|review|grade)/i;

    function readAttr(node, name) {
      if (!node || typeof node.getAttribute !== 'function') return '';
      return String(node.getAttribute(name) || '');
    }

    function isActionCandidate(node) {
      if (!node || node === doc || node === doc.documentElement) return false;
      var tag = String(node.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'a') return true;
      if (tag === 'input' && /^(?:button|submit)$/i.test(String(node.type || ''))) return true;
      if (String(readAttr(node, 'role')).toLowerCase() === 'button') return true;
      if (readAttr(node, 'onclick') || typeof node.onclick === 'function') return true;
      if (readAttr(node, 'data-action') || readAttr(node, 'data-submit') || readAttr(node, 'data-testid')) return true;
      return actionNamePattern.test([node.id, node.className, node.name].map(function (value) {
        return String(value || '');
      }).join(' '));
    }

    function isFinishLikeElement(el) {
      var node = el;
      while (node && node !== doc && node !== doc.documentElement) {
        if (isActionCandidate(node)) {
          var haystack = [
            node.id,
            node.className,
            node.name,
            node.value,
            readAttr(node, 'data-action'),
            readAttr(node, 'data-submit'),
            readAttr(node, 'data-testid'),
            readAttr(node, 'aria-label'),
            readAttr(node, 'title'),
            readAttr(node, 'onclick'),
            getText(node)
          ].map(function (value) { return String(value || ''); }).join(' ');
          if (finishPattern.test(haystack)) {
            return node;
          }
        }
        node = node.parentNode;
      }
      return null;
    }

    var buttonSelectors = [
      '.finish-btn', '#finish-btn', '#finishBtn', '[data-action="finish"]',
      '.submit-btn', '#submit-btn', '#submitBtn', '[data-action="submit"]',
      '.check-btn', '#check-btn', '[data-action="check"]',
      '.review-btn', '#review-btn', '[data-action="review"]',
      'button.finish', 'button.submit', 'button.check-answers'
    ];

    for (var i = 0; i < buttonSelectors.length; i++) {
      var btns = doc.querySelectorAll(buttonSelectors[i]);
      for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener('click', function () {
          debouncedOnComplete(800, { allowGenerated: true });
        });
      }
    }

    function formHasFinishControl(form) {
      if (!form || typeof form.querySelectorAll !== 'function') return false;
      var controls = form.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"], [onclick], [data-action], [data-submit]');
      for (var i = 0; i < controls.length; i++) {
        if (isFinishLikeElement(controls[i])) return true;
      }
      return false;
    }

    function queueFinishCompletion(event) {
      if (isFinishLikeElement(event && event.target)) {
        debouncedOnComplete(800, { allowGenerated: true });
      }
    }

    doc.addEventListener('click', queueFinishCompletion, true);
    doc.addEventListener('pointerup', queueFinishCompletion, true);
    doc.addEventListener('touchend', queueFinishCompletion, true);
    doc.addEventListener('submit', function (event) {
      var submitter = event && event.submitter;
      var form = event && event.target;
      if (isFinishLikeElement(submitter) || isFinishLikeElement(form) || formHasFinishControl(form)) {
        debouncedOnComplete(500, { allowGenerated: true });
      }
    }, true);
    doc.addEventListener('keydown', function (event) {
      var key = event && (event.key || event.code);
      if (key !== 'Enter' && key !== ' ' && key !== 'Space' && key !== 'Spacebar') return;
      var target = (event && event.target) || doc.activeElement;
      if (isFinishLikeElement(target)) {
        debouncedOnComplete(500, { allowGenerated: true });
      }
    }, true);
  }

  function hookMutationObserver() {
    var doc = window.document;
    if (!doc.body) return;
    if (typeof MutationObserver === 'undefined') return;

    var reviewSelectors = '.results-table, .result-table, .review-table, .ans-table, .feedback .grade-report, #reviewList';
    var observer = new MutationObserver(function () {
      var reviewEl = doc.querySelector(reviewSelectors);
      if (reviewEl && !state.completed) {
        debouncedOnComplete(1500, { allowGenerated: false });
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  function initMessageListener() {
    window.addEventListener('message', function (event) {
      if (!event || !event.data) return;
      if (!isAllowedParentMessage(event)) return;
      var data = event.data;
      var type = data.type;

      if (type === 'INIT_SESSION' || type === 'init_exam_session') {
        var payload = data.data || data;
        if (event.source && event.source !== window && typeof event.source.postMessage === 'function') {
          state.parentWindow = event.source;
        }
        state.sessionId = payload.sessionId || state.sessionId || (state.examId + '_' + Date.now());
        state.examId = payload.examId || state.examId;
        state.suiteSessionId = payload.suiteSessionId || state.suiteSessionId || null;
        state.startTime = toTimestampMs(payload.startTime, toTimestampMs(state.startTime, Date.now()));
        state.initialized = true;
        stopInitRequestLoop();

        log('INIT_SESSION received — examId=' + state.examId + ' sessionId=' + state.sessionId);
        sendSessionReady('ready');
      }
    });
  }

  function extractExamIdFromUrl() {
    try {
      var url = window.location.href;
      var match = url.match(/[?&]examId=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
      var srcMatch = url.match(/[?&]src=([^&]+)/);
      if (srcMatch) {
        var src = decodeURIComponent(srcMatch[1]);
        var partMatch = src.match(/(P[1-4])/i);
        if (partMatch) return 'listening-' + partMatch[1].toLowerCase();
      }
      var pathParts = window.location.pathname.split('/');
      for (var i = pathParts.length - 1; i >= 0; i--) {
        var pm = pathParts[i].match(/(P[1-4])/i);
        if (pm) return 'listening-' + pm[1].toLowerCase();
      }
    } catch (e) {}
    return 'listening-unknown';
  }

  function bootstrap() {
    state.parentWindow = findParentWindow();
    if (!state.examId) {
      state.examId = extractExamIdFromUrl();
    }
    if (!state.sessionId) {
      state.sessionId = state.examId + '_' + Date.now();
    }
    state.startTime = Date.now();

    log('bootstrap — examId=' + state.examId);

    initMessageListener();

    hookAppFinish();
    startHookSync();
    hookButtonFinish();

    if (window.document.body) {
      hookMutationObserver();
    } else if (window.document.readyState !== 'loading') {
      hookMutationObserver();
    } else {
      window.document.addEventListener('DOMContentLoaded', hookMutationObserver);
    }

    sendSessionReady('bootstrapped');
    startInitRequestLoop();
  }

  window.__listeningBridgeComplete = onComplete;
  window.__listeningBridgeGetState = function () { return state; };

  if (window.document.readyState === 'complete' || window.document.readyState === 'interactive') {
    bootstrap();
  } else {
    window.document.addEventListener('DOMContentLoaded', bootstrap);
  }
})();
