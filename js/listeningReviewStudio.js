/**
 * Listening Review Studio
 * Upgrades IELTS listening practice pages with:
 * - Resizable left/right split-screen review (Questions + Interactive Audioscript)
 * - Structured native HTML audioscript with grading-linked evidence highlights
 * - Clear side-by-side mistake comparison cards (User Answer -> Correct Answer + option text)
 * - Bidirectional question <-> transcript navigation, wrong-only filter, and mistake stepper
 * - Independent transcript font zoom, search, and original scan fallback + lightbox
 */
(function initListeningReviewStudio(global) {
  'use strict';

  if (global.__LISTENING_REVIEW_STUDIO_LOADED__) return;
  global.__LISTENING_REVIEW_STUDIO_LOADED__ = true;

  var STORAGE_LEFT_WIDTH = 'lrs_left_width_pct';
  var STORAGE_SCRIPT_SIZE = 'lrs_script_font_px';
  var MIN_SCRIPT_SIZE = 13;
  var MAX_SCRIPT_SIZE = 22;
  var DEFAULT_SCRIPT_SIZE = 16;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncateText(text, maxLen) {
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length <= maxLen) return clean;
    return clean.slice(0, Math.max(1, maxLen - 1)).trim() + '…';
  }

  function partOfQuestion(qNum) {
    var n = Number(qNum) || 1;
    if (n >= 31) return 4;
    if (n >= 21) return 3;
    if (n >= 11) return 2;
    return 1;
  }

  function partQuestionRange(partNumber) {
    var p = Math.min(4, Math.max(1, Number(partNumber) || 1));
    var start = (p - 1) * 10 + 1;
    return { start: start, end: start + 9 };
  }

  function readStorage(key, fallback) {
    try {
      var val = global.localStorage && global.localStorage.getItem(key);
      return val != null ? val : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem(key, String(value));
    } catch (_) { }
  }

  function bootstrap() {
    var doc = global.document;
    if (!doc || !doc.body || typeof doc.querySelector !== 'function' || typeof doc.getElementById !== 'function') return;
    var shell = doc.querySelector('main.shell');
    var questionsPage = doc.getElementById('questionsPage');
    if (!shell || !questionsPage) return;

    var config = global.CONFIG_DATA || (global.App && global.App.config) || {};
    var isFullTest = Boolean(config.isFullTest || doc.querySelector('.part-panel[data-part-panel="2"]'));
    var transcriptData = parseTranscriptData(doc, config, isFullTest);
    var legacyImagesByPart = collectLegacyScanImages(doc, config, isFullTest);

    // Ensure every part knows its scan image list even if embedded JSON omitted it
    transcriptData.parts.forEach(function attachImages(part) {
      if (!Array.isArray(part.images) || !part.images.length) {
        part.images = legacyImagesByPart[part.part] || [];
      }
    });

    var hasStructuredText = transcriptData.parts.some(function (p) {
      return Array.isArray(p.blocks) && p.blocks.length > 0;
    });

    var state = {
      splitOpen: false,
      isReviewing: false,
      isFullTest: isFullTest,
      activePart: isFullTest ? 1 : (Number(config.part) || (transcriptData.parts[0] && transcriptData.parts[0].part) || 1),
      viewMode: hasStructuredText ? 'text' : 'scan',
      filterMode: 'all', // 'all' | 'wrong'
      onlyWrongMarks: false,
      hideMarksPreSubmit: false,
      scriptFontPx: clampScriptSize(Number(readStorage(STORAGE_SCRIPT_SIZE, DEFAULT_SCRIPT_SIZE))),
      scanZoomPct: 100,
      mobilePane: 'questions',
      searchOpen: false,
      searchQuery: '',
      searchMatches: [],
      searchIndex: -1,
      focusedUnitKey: '',
      grading: null, // { rows, byQ, units, mistakes, correctCount, totalCount, percentage, band }
      mistakeCursor: -1,
      isHistoricalReplay: false,
      replayMeta: null,
      lastReplaySignature: ''
    };

    doc.body.classList.add('lrs-enabled');
    doc.body.dataset.lrsMobilePane = state.mobilePane;
    applySavedSplitWidth(doc);
    applyScriptFontSize(doc, state.scriptFontPx);

    // Build split workspace DOM inside main.shell
    var ui = buildWorkspaceDom(doc, shell, questionsPage, transcriptData, state, hasStructuredText);

    // Wire everything
    wireResizer(doc, ui, state);
    wireTranscriptToggleButtons(doc, ui, state);
    wireRightPaneControls(doc, ui, state, transcriptData);
    wireLeftPaneDelegation(doc, ui, state);
    wireAppHooks(doc, ui, state, transcriptData);
    wireLightbox(doc, ui);

    // Initial render of transcript panes
    renderAllTranscriptParts(doc, ui, transcriptData, state);
    setActiveTranscriptPart(doc, ui, state, state.activePart, { syncLeft: false });
    syncHeaderTranscriptButton(doc, state);

    // Expose inspection & replay API
    global.__listeningReviewStudio = {
      state: state,
      openSplit: function () { setSplitOpen(doc, ui, state, true); },
      closeSplit: function () { setSplitOpen(doc, ui, state, false); },
      toggleSplit: function () { setSplitOpen(doc, ui, state, !state.splitOpen); },
      focusQuestion: function (q) { focusQuestion(doc, ui, state, q, { openSplit: true, scrollLeft: true, scrollRight: true }); },
      setFilterMode: function (mode) { setFilterMode(doc, ui, state, mode); },
      setViewMode: function (mode) { setViewMode(doc, ui, state, mode); },
      applyReplayRecord: function (payload) { return applyReplayRecord(doc, ui, state, payload); }
    };

    global.addEventListener('listeningReplayRecord', function (ev) {
      if (ev && ev.detail) {
        applyReplayRecord(doc, ui, state, ev.detail);
      }
    });

    if (global.__pendingListeningReplay) {
      applyReplayRecord(doc, ui, state, global.__pendingListeningReplay);
    }
  }

  function clampScriptSize(value) {
    if (!Number.isFinite(value)) return DEFAULT_SCRIPT_SIZE;
    return Math.min(MAX_SCRIPT_SIZE, Math.max(MIN_SCRIPT_SIZE, Math.round(value)));
  }

  function applyScriptFontSize(doc, px) {
    doc.documentElement.style.setProperty('--lrs-script-size', px + 'px');
  }

  function applySavedSplitWidth(doc) {
    var saved = Number(readStorage(STORAGE_LEFT_WIDTH, '50'));
    if (Number.isFinite(saved) && saved >= 30 && saved <= 70) {
      doc.documentElement.style.setProperty('--lrs-left-width', saved.toFixed(1) + '%');
    }
  }

  function parseTranscriptData(doc, config, isFullTest) {
    var el = doc.getElementById('listening-transcript-data');
    if (el && el.textContent) {
      try {
        var parsed = JSON.parse(el.textContent);
        if (parsed && Array.isArray(parsed.parts) && parsed.parts.length) {
          return parsed;
        }
      } catch (err) {
        console.warn('[ListeningReviewStudio] Failed to parse transcript JSON:', err);
      }
    }
    if (isFullTest) {
      return {
        version: 1,
        parts: [1, 2, 3, 4].map(function (p) {
          return { part: p, title: 'Part ' + p, kind: (p === 1 || p === 3) ? 'dialogue' : 'monologue', blocks: [], images: [] };
        })
      };
    }
    var partNum = Number(config.part) || 1;
    return {
      version: 1,
      parts: [{
        part: partNum,
        title: String(config.examTitle || ('Part ' + partNum)),
        kind: (partNum === 1 || partNum === 3) ? 'dialogue' : 'monologue',
        blocks: [],
        images: []
      }]
    };
  }

  function collectLegacyScanImages(doc, config, isFullTest) {
    var map = {};
    var panel = doc.getElementById('transcript-panel');
    if (!panel) return map;

    if (isFullTest) {
      Array.prototype.slice.call(panel.querySelectorAll('.transcript-part-pane')).forEach(function (pane) {
        var partNum = Number(pane.dataset.transcriptPane) || 1;
        var imgs = Array.prototype.slice.call(pane.querySelectorAll('img.transcript-img'))
          .map(function (img) { return img.getAttribute('src') || ''; })
          .filter(Boolean);
        map[partNum] = imgs;
      });
    } else {
      var partNum = Number(config.part) || 1;
      map[partNum] = Array.prototype.slice.call(panel.querySelectorAll('img.transcript-img'))
        .map(function (img) { return img.getAttribute('src') || ''; })
        .filter(Boolean);
    }
    return map;
  }

  function buildWorkspaceDom(doc, shell, questionsPage, transcriptData, state, hasStructuredText) {
    // Mobile pane switcher right above main.shell
    var mobileSwitcher = doc.createElement('div');
    mobileSwitcher.className = 'lrs-mobile-switcher';
    mobileSwitcher.id = 'lrs-mobile-switcher';
    mobileSwitcher.innerHTML = [
      '<button type="button" class="lrs-mobile-tab active" data-lrs-mobile-tab="questions" data-answer-ignore="true">题目与批改</button>',
      '<button type="button" class="lrs-mobile-tab" data-lrs-mobile-tab="transcript" data-answer-ignore="true">听力原文</button>'
    ].join('');
    shell.parentNode.insertBefore(mobileSwitcher, shell);

    // Left pane wrapping existing #questionsPage
    var leftPane = doc.createElement('div');
    leftPane.className = 'lrs-left-pane';
    leftPane.id = 'lrs-left-pane';

    // Sticky Review Summary Bar at top of left pane
    var reviewBar = doc.createElement('div');
    reviewBar.className = 'lrs-review-bar';
    reviewBar.id = 'lrs-review-bar';
    reviewBar.hidden = true;
    leftPane.appendChild(reviewBar);

    shell.insertBefore(leftPane, questionsPage);
    leftPane.appendChild(questionsPage);

    // Resizer handle
    var resizer = doc.createElement('div');
    resizer.className = 'lrs-resizer';
    resizer.id = 'lrs-resizer';
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-label', '拖动调整左右栏宽度，双击重置 50/50');
    resizer.title = '拖动调整宽度 · 双击还原 50/50';
    resizer.tabIndex = 0;
    shell.appendChild(resizer);

    // Right pane (Interactive Audioscript)
    var rightPane = doc.createElement('section');
    rightPane.className = 'lrs-right-pane';
    rightPane.id = 'lrs-right-pane';
    rightPane.setAttribute('aria-label', 'Interactive Audioscript');

    var partTabsHtml = '';
    if (transcriptData.parts.length > 1) {
      partTabsHtml = '<div class="lrs-script-part-tabs" id="lrs-script-part-tabs">' +
        transcriptData.parts.map(function (p) {
          return '<button type="button" class="lrs-script-part-tab' + (p.part === state.activePart ? ' active' : '') +
            '" data-lrs-script-part="' + p.part + '" data-answer-ignore="true">Part ' + p.part +
            '<span class="lrs-tab-dot" data-lrs-tab-err="' + p.part + '" hidden></span></button>';
        }).join('') + '</div>';
    }

    rightPane.innerHTML = [
      '<div class="lrs-script-header">',
      '  <div class="lrs-script-header-row">',
      '    <div class="lrs-script-title-wrap">',
      '      <span class="lrs-script-badge">原文对照</span>',
      '      <span class="lrs-script-title" id="lrs-script-title">Audioscript</span>',
      '    </div>',
      '    <div class="lrs-script-tools">',
      '      <button type="button" class="lrs-icon-btn" id="lrs-font-dec" title="缩小原文字号" data-answer-ignore="true">A-</button>',
      '      <span class="lrs-font-readout" id="lrs-font-readout">' + state.scriptFontPx + 'px</span>',
      '      <button type="button" class="lrs-icon-btn" id="lrs-font-inc" title="放大原文字号" data-answer-ignore="true">A+</button>',
      '      <button type="button" class="lrs-icon-btn" id="lrs-marks-toggle" title="切换考点高亮显示" data-answer-ignore="true">全部考点</button>',
      '      <button type="button" class="lrs-icon-btn" id="lrs-search-toggle" title="搜索原文关键词" data-answer-ignore="true">🔍</button>',
      hasStructuredText
        ? '<div class="lrs-seg-group" role="group" aria-label="原文视图模式">' +
          '  <button type="button" class="lrs-seg-btn active" data-lrs-view="text" data-answer-ignore="true">精排文本</button>' +
          '  <button type="button" class="lrs-seg-btn" data-lrs-view="scan" data-answer-ignore="true">原版扫描</button>' +
          '</div>'
        : '',
      '      <button type="button" class="lrs-icon-btn" id="lrs-close-split" title="收起原文分屏" data-answer-ignore="true">✕</button>',
      '    </div>',
      '  </div>',
      partTabsHtml,
      '  <div class="lrs-q-jump-strip" id="lrs-q-jump-strip"></div>',
      '  <div class="lrs-search-bar" id="lrs-search-bar">',
      '    <input type="search" class="lrs-search-input" id="lrs-search-input" placeholder="在当前 Part 原文中搜索关键词..." data-answer-ignore="true" />',
      '    <span class="lrs-search-count" id="lrs-search-count"></span>',
      '    <button type="button" class="lrs-icon-btn" id="lrs-search-prev" title="上一处" data-answer-ignore="true">↑</button>',
      '    <button type="button" class="lrs-icon-btn" id="lrs-search-next" title="下一处" data-answer-ignore="true">↓</button>',
      '    <button type="button" class="lrs-icon-btn" id="lrs-search-close" title="关闭搜索" data-answer-ignore="true">✕</button>',
      '  </div>',
      '</div>',
      '<div class="lrs-script-body" id="lrs-script-body">',
      '  <div class="lrs-script-content" id="lrs-script-text-host"></div>',
      '  <div class="lrs-script-scans" id="lrs-script-scan-host" hidden></div>',
      '</div>'
    ].join('\n');

    shell.appendChild(rightPane);

    // Fullscreen Lightbox for original scans
    var lightbox = doc.createElement('div');
    lightbox.className = 'lrs-lightbox';
    lightbox.id = 'lrs-lightbox';
    lightbox.innerHTML = [
      '<div class="lrs-lightbox-bar">',
      '  <span id="lrs-lightbox-caption">原版扫描页</span>',
      '  <button type="button" class="lrs-btn" id="lrs-lightbox-close" data-answer-ignore="true">关闭 (Esc)</button>',
      '</div>',
      '<div class="lrs-lightbox-stage" id="lrs-lightbox-stage"><img id="lrs-lightbox-img" alt="Original scan zoom" /></div>'
    ].join('');
    doc.body.appendChild(lightbox);

    return {
      shell: shell,
      mobileSwitcher: mobileSwitcher,
      leftPane: leftPane,
      reviewBar: reviewBar,
      resizer: resizer,
      rightPane: rightPane,
      scriptTitle: rightPane.querySelector('#lrs-script-title'),
      fontDec: rightPane.querySelector('#lrs-font-dec'),
      fontInc: rightPane.querySelector('#lrs-font-inc'),
      fontReadout: rightPane.querySelector('#lrs-font-readout'),
      marksToggle: rightPane.querySelector('#lrs-marks-toggle'),
      searchToggle: rightPane.querySelector('#lrs-search-toggle'),
      searchBar: rightPane.querySelector('#lrs-search-bar'),
      searchInput: rightPane.querySelector('#lrs-search-input'),
      searchCount: rightPane.querySelector('#lrs-search-count'),
      searchPrev: rightPane.querySelector('#lrs-search-prev'),
      searchNext: rightPane.querySelector('#lrs-search-next'),
      searchClose: rightPane.querySelector('#lrs-search-close'),
      closeSplit: rightPane.querySelector('#lrs-close-split'),
      partTabs: rightPane.querySelector('#lrs-script-part-tabs'),
      qJumpStrip: rightPane.querySelector('#lrs-q-jump-strip'),
      scriptBody: rightPane.querySelector('#lrs-script-body'),
      textHost: rightPane.querySelector('#lrs-script-text-host'),
      scanHost: rightPane.querySelector('#lrs-script-scan-host'),
      lightbox: lightbox,
      lightboxImg: lightbox.querySelector('#lrs-lightbox-img'),
      lightboxCaption: lightbox.querySelector('#lrs-lightbox-caption'),
      lightboxClose: lightbox.querySelector('#lrs-lightbox-close')
    };
  }

  function renderAllTranscriptParts(doc, ui, transcriptData, state) {
    ui.textHost.innerHTML = '';
    ui.scanHost.innerHTML = '';

    transcriptData.parts.forEach(function (part) {
      // Text pane
      var partEl = doc.createElement('div');
      partEl.className = 'lrs-script-part';
      partEl.dataset.lrsPart = String(part.part);
      partEl.hidden = part.part !== state.activePart;

      var range = partQuestionRange(part.part);
      var heading = doc.createElement('div');
      heading.className = 'lrs-part-heading';
      heading.dataset.partFullTitle = 'Part ' + part.part + ' · ' + (part.title || '');
      heading.innerHTML = '<span class="lrs-part-heading-sub">Official Audioscript · Part ' + part.part + ' · Questions ' + range.start + '–' + range.end + '</span>' +
        '<span class="lrs-part-heading-sub">' + (part.kind === 'dialogue' ? '对话 Dialogue' : '独白 Monologue') + '</span>';
      partEl.appendChild(heading);

      var speakerMap = Object.create(null);
      var speakerCount = 0;

      (part.blocks || []).forEach(function (block, blockIdx) {
        if (!block) return;
        if (block.type === 'pause') {
          var pauseEl = doc.createElement('div');
          pauseEl.className = 'lrs-pause-divider';
          pauseEl.textContent = block.label || '录音中段停顿 · Pause';
          partEl.appendChild(pauseEl);
          return;
        }

        var qsInBlock = [];
        var segmentsHtml = renderSegmentsHtml(block.segments || [], qsInBlock);
        var uniqueQs = dedupeNumbers(qsInBlock);

        if (block.type === 'turn') {
          var spName = String(block.speaker || 'SPEAKER').trim();
          var spKey = spName.toUpperCase();
          if (speakerMap[spKey] === undefined) {
            speakerMap[spKey] = speakerCount % 4;
            speakerCount += 1;
          }
          var turn = doc.createElement('article');
          turn.className = 'lrs-turn';
          turn.dataset.speaker = spName;
          turn.dataset.speakerIdx = String(speakerMap[spKey]);
          turn.dataset.blockIndex = String(blockIdx);
          if (uniqueQs.length) turn.dataset.qs = uniqueQs.join(',');
          turn.innerHTML = '<div class="lrs-turn-speaker"><span class="lrs-speaker-badge" title="' + escapeHtml(spName) + '">' + escapeHtml(spName) + '</span></div>' +
            '<div class="lrs-turn-body"><p class="lrs-turn-text">' + segmentsHtml + '</p><div class="lrs-verdicts"></div></div>';
          partEl.appendChild(turn);
        } else {
          var para = doc.createElement('article');
          para.className = 'lrs-para';
          para.dataset.blockIndex = String(blockIdx);
          if (uniqueQs.length) para.dataset.qs = uniqueQs.join(',');
          para.innerHTML = '<p class="lrs-para-text">' + segmentsHtml + '</p><div class="lrs-verdicts"></div>';
          partEl.appendChild(para);
        }
      });

      ui.textHost.appendChild(partEl);

      // Scan fallback pane
      var scanPartEl = doc.createElement('div');
      scanPartEl.className = 'lrs-scan-part';
      scanPartEl.dataset.lrsScanPart = String(part.part);
      scanPartEl.hidden = part.part !== state.activePart;

      var imgs = Array.isArray(part.images) ? part.images : [];
      var toolbarHtml = '<div class="lrs-scan-toolbar">' +
        '<span>点击任意扫描页可全屏放大查看</span>' +
        '<div class="lrs-scan-zoom-wrap">' +
        '  <button type="button" class="lrs-icon-btn" data-lrs-scan-zoom="-15" data-answer-ignore="true">－</button>' +
        '  <span class="lrs-font-readout" data-lrs-scan-readout>' + state.scanZoomPct + '%</span>' +
        '  <button type="button" class="lrs-icon-btn" data-lrs-scan-zoom="15" data-answer-ignore="true">＋</button>' +
        '  <button type="button" class="lrs-icon-btn" data-lrs-scan-reset data-answer-ignore="true">适配</button>' +
        '</div></div>';
      var imgsHtml = imgs.length
        ? '<div class="lrs-scan-list">' + imgs.map(function (src, i) {
            return '<img class="lrs-scan-img" src="' + escapeHtml(src) + '" alt="Part ' + part.part + ' Audioscript page ' + (i + 1) + '" loading="lazy" decoding="async" />';
          }).join('') + '</div>'
        : '<p style="color:var(--lrs-muted);text-align:center;padding:32px 0;">暂无原版扫描图</p>';

      scanPartEl.innerHTML = toolbarHtml + imgsHtml;
      ui.scanHost.appendChild(scanPartEl);
    });

    updateViewModeDom(ui, state);
  }

  function formatQListLabel(qList) {
    if (!qList || !qList.length) return '';
    var sorted = qList.slice().sort(function (a, b) { return a - b; });
    if (sorted.length === 1) return 'Q' + sorted[0];
    if (sorted.length === 2 && sorted[1] === sorted[0] + 1) return 'Q' + sorted[0] + '–' + sorted[1];
    return 'Q' + sorted.join('/');
  }

  function renderSegmentsHtml(segments, qsCollector) {
    return segments.map(function (seg) {
      if (!seg || typeof seg.t !== 'string') return '';
      var qList = Array.isArray(seg.q)
        ? seg.q.map(function (n) { return Number(n); }).filter(function (n) { return Number.isFinite(n) && n > 0; })
        : [];
      if (!qList.length) {
        return escapeHtml(seg.t);
      }
      qList.forEach(function (n) { qsCollector.push(n); });
      var qLabel = formatQListLabel(qList);
      var primaryQ = Math.min.apply(null, qList);
      return '<mark class="lrs-ev" data-q-list="' + qList.join(',') + '" data-primary-q="' + primaryQ + '" data-q-label="' + escapeHtml(qLabel) + '" tabindex="0" title="点击定位第 ' + qList.join('、') + ' 题">' +
        '<span class="lrs-ev-badge">' + escapeHtml(qLabel) + '</span>' +
        '<span class="lrs-ev-text">' + escapeHtml(seg.t) + '</span>' +
        '</mark>';
    }).join('');
  }

  function dedupeNumbers(list) {
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (n) {
      if (!seen[n]) {
        seen[n] = true;
        out.push(n);
      }
    });
    return out;
  }

  function updateViewModeDom(ui, state) {
    var showText = state.viewMode === 'text';
    ui.textHost.hidden = !showText;
    ui.scanHost.hidden = showText;
    Array.prototype.slice.call(ui.rightPane.querySelectorAll('[data-lrs-view]')).forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lrsView === state.viewMode);
    });
    if (ui.fontDec) ui.fontDec.hidden = !showText;
    if (ui.fontInc) ui.fontInc.hidden = !showText;
    if (ui.fontReadout) ui.fontReadout.hidden = !showText;
    if (ui.marksToggle) ui.marksToggle.hidden = !showText;
    if (ui.searchToggle) ui.searchToggle.hidden = !showText;
    if (!showText && ui.searchBar) ui.searchBar.classList.remove('open');
  }

  function setViewMode(doc, ui, state, mode) {
    state.viewMode = mode === 'scan' ? 'scan' : 'text';
    updateViewModeDom(ui, state);
  }

  function setSplitOpen(doc, ui, state, open) {
    state.splitOpen = Boolean(open);
    doc.body.classList.toggle('lrs-split-open', state.splitOpen);
    syncHeaderTranscriptButton(doc, state);
  }

  function syncHeaderTranscriptButton(doc, state) {
    var inlineBtn = doc.getElementById('open-transcript-inline-btn');
    if (inlineBtn) {
      inlineBtn.textContent = state.splitOpen ? '收起原文' : '对照原文';
      inlineBtn.classList.toggle('active', state.splitOpen);
    }
    var reviewBtn = doc.getElementById('review-transcript-btn');
    if (reviewBtn) {
      reviewBtn.textContent = state.splitOpen ? '收起原文分屏' : '打开原文对照';
    }
    var toggleSplitReviewBtn = doc.getElementById('lrs-toggle-split-btn');
    if (toggleSplitReviewBtn) {
      toggleSplitReviewBtn.textContent = state.splitOpen ? '收起原文' : '对照原文';
      toggleSplitReviewBtn.classList.toggle('lrs-btn-primary', !state.splitOpen);
    }
  }

  function setActiveTranscriptPart(doc, ui, state, partNumber, options) {
    var opts = options || {};
    var p = Math.min(4, Math.max(1, Number(partNumber) || 1));
    // Clamp to available parts if single-part exam
    var available = Array.prototype.slice.call(ui.textHost.querySelectorAll('.lrs-script-part'))
      .map(function (el) { return Number(el.dataset.lrsPart); });
    if (available.length && available.indexOf(p) === -1) {
      p = available[0];
    }
    state.activePart = p;

    Array.prototype.slice.call(ui.textHost.querySelectorAll('.lrs-script-part')).forEach(function (el) {
      el.hidden = Number(el.dataset.lrsPart) !== p;
    });
    Array.prototype.slice.call(ui.scanHost.querySelectorAll('.lrs-scan-part')).forEach(function (el) {
      el.hidden = Number(el.dataset.lrsScanPart) !== p;
    });
    if (ui.partTabs) {
      Array.prototype.slice.call(ui.partTabs.querySelectorAll('[data-lrs-script-part]')).forEach(function (btn) {
        btn.classList.toggle('active', Number(btn.dataset.lrsScriptPart) === p);
      });
    }
    Array.prototype.slice.call(ui.reviewBar.querySelectorAll('[data-lrs-part-chip]')).forEach(function (chip) {
      chip.classList.toggle('active', Number(chip.dataset.lrsPartChip) === p);
    });

    var activePartEl = ui.textHost.querySelector('.lrs-script-part[data-lrs-part="' + p + '"]');
    var headingEl = activePartEl && activePartEl.querySelector('.lrs-part-heading');
    if (ui.scriptTitle && headingEl) {
      ui.scriptTitle.textContent = headingEl.dataset.partFullTitle || ('Part ' + p);
    }

    renderQuestionJumpStrip(doc, ui, state);

    if (state.searchOpen && state.searchQuery) {
      runTranscriptSearch(doc, ui, state, state.searchQuery);
    }

    if (opts.syncLeft && state.isFullTest && global.App && typeof global.App.switchPart === 'function') {
      if (global.App.state && Number(global.App.state.activePart) !== p) {
        global.App.switchPart(p, { scrollToTop: opts.scrollToTop !== false });
      }
    }
  }

  function renderQuestionJumpStrip(doc, ui, state) {
    if (!ui.qJumpStrip) return;
    var config = global.CONFIG_DATA || (global.App && global.App.config) || {};
    var range = partQuestionRange(state.activePart);
    var qList = Array.isArray(config.questionList) ? config.questionList : [];
    var partQs = qList.filter(function (q) {
      var n = Number(q);
      return n >= range.start && n <= range.end;
    });
    if (!partQs.length) {
      ui.qJumpStrip.innerHTML = '';
      return;
    }

    var renderedPairs = Object.create(null);
    var pills = [];
    partQs.forEach(function (qNum) {
      var unit = state.grading && state.grading.byQ[qNum];
      if (unit && unit.isPair) {
        if (renderedPairs[unit.key]) return;
        renderedPairs[unit.key] = true;
        var cls = unit.status === 'correct' ? ' is-correct' : (unit.status === 'partial' ? ' is-partial' : ' is-incorrect');
        var activeCls = state.focusedUnitKey === unit.key ? ' is-active' : '';
        pills.push('<button type="button" class="lrs-q-pill' + cls + activeCls + '" data-lrs-jump-q="' + unit.primaryQ + '" data-answer-ignore="true" title="定位 Q' + unit.label + '">' + escapeHtml(unit.shortLabel) + '</button>');
        return;
      }
      var statusCls = '';
      if (unit) {
        statusCls = unit.status === 'correct' ? ' is-correct' : ' is-incorrect';
      }
      var active = unit && state.focusedUnitKey === unit.key ? ' is-active' : '';
      pills.push('<button type="button" class="lrs-q-pill' + statusCls + active + '" data-lrs-jump-q="' + qNum + '" data-answer-ignore="true" title="定位第 ' + qNum + ' 题">Q' + qNum + '</button>');
    });

    ui.qJumpStrip.innerHTML = '<span class="lrs-q-jump-label">定位题号:</span>' + pills.join('');
  }

  /* ========================================================================
     Grading Analysis & Option Label Resolution
     ======================================================================== */
  function resolveOptionText(doc, qNum, letter, pairKey) {
    var L = String(letter || '').trim().toUpperCase();
    if (!L) return '';

    // 1. Multi-choice pair option
    if (pairKey) {
      var mOpt = doc.querySelector('.multi-option[data-pair="' + pairKey + '"][data-val="' + L + '"] .opt-text');
      if (mOpt && mOpt.textContent) return mOpt.textContent.trim();
    }

    // 2. Single choice option
    var sOpt = doc.querySelector('.choice-option[data-q="' + qNum + '"][data-val="' + L + '"] .opt-text');
    if (sOpt && sOpt.textContent) return sOpt.textContent.trim();

    // 3. Matching option inside enclosing .matching-group
    var anchor = doc.getElementById('q-anchor-' + qNum);
    var group = anchor && anchor.closest ? anchor.closest('.matching-group') : null;
    if (group) {
      var boxRow = group.querySelector('.option-box-row[data-opt-letter="' + L + '"] .opt-box-text');
      if (boxRow && boxRow.textContent) return boxRow.textContent.trim();
    }
    return '';
  }

  function formatLetterWithText(doc, qNum, letter, pairKey, maxLen) {
    var L = String(letter || '').trim().toUpperCase();
    if (!L) return '';
    var text = resolveOptionText(doc, qNum, L, pairKey);
    if (!text) return L;
    return L + ' (' + truncateText(text, maxLen || 40) + ')';
  }

  function buildGradingModel(doc, result) {
    var config = global.CONFIG_DATA || (global.App && global.App.config) || {};
    var ak = config.answerKey || {};
    var mult = ak.multiple || {};
    var rows = Array.isArray(result && result.rows) ? result.rows : [];
    var byQ = Object.create(null);
    var units = [];
    var seenPair = Object.create(null);

    // Map pairs first
    var pairByQ = Object.create(null);
    Object.keys(mult).forEach(function (key) {
      var m = key.match(/^q(\d+)_(\d+)$/);
      if (!m) return;
      var q1 = Number(m[1]);
      var q2 = Number(m[2]);
      var info = { key: key, pairAttr: q1 + ',' + q2, fbKey: q1 + '_' + q2, q1: q1, q2: q2, correct: mult[key].map(function (v) { return String(v).toUpperCase(); }).sort() };
      pairByQ[q1] = info;
      pairByQ[q2] = info;
    });

    rows.forEach(function (row) {
      var qNum = Number(row.q);
      var pair = pairByQ[qNum];
      if (pair) {
        if (seenPair[pair.key]) return;
        seenPair[pair.key] = true;
        var checked = Array.prototype.slice.call(doc.querySelectorAll('input[name="' + pair.key + '"]:checked'))
          .map(function (el) { return String(el.value || '').trim().toUpperCase(); })
          .sort();
        var hits = checked.filter(function (v) { return pair.correct.indexOf(v) >= 0; }).length;
        var status = hits === 2 ? 'correct' : (hits === 1 ? 'partial' : 'incorrect');
        var userRich = checked.length
          ? checked.map(function (l) { return formatLetterWithText(doc, pair.q1, l, pair.pairAttr, 32); }).join('、')
          : '';
        var correctRich = pair.correct.map(function (l) { return formatLetterWithText(doc, pair.q1, l, pair.pairAttr, 32); }).join('、');
        var unit = {
          key: 'pair:' + pair.q1 + '-' + pair.q2,
          isPair: true,
          qs: [pair.q1, pair.q2],
          primaryQ: pair.q1,
          part: partOfQuestion(pair.q1),
          label: pair.q1 + '–' + pair.q2,
          shortLabel: 'Q' + pair.q1 + '–' + pair.q2,
          fbKey: pair.fbKey,
          pairAttr: pair.pairAttr,
          hits: hits,
          status: status,
          isCorrect: hits === 2,
          userRaw: checked.join(', '),
          correctRaw: pair.correct.join(', '),
          userDisplay: userRich,
          correctDisplay: correctRich
        };
        byQ[pair.q1] = unit;
        byQ[pair.q2] = unit;
        units.push(unit);
        return;
      }

      var qKey = 'q' + qNum;
      var isSingle = Boolean(ak.single && ak.single[qKey] != null);
      var userRaw = String(row.userAnswer || '').trim();
      var correctRaw = String(row.displayCorrect || row.correctAnswer || '').trim();
      var userDisplay = isSingle && userRaw ? formatLetterWithText(doc, qNum, userRaw, null, 44) : userRaw;
      var correctDisplay = isSingle && correctRaw ? formatLetterWithText(doc, qNum, correctRaw, null, 44) : correctRaw;

      var unit = {
        key: 'q:' + qNum,
        isPair: false,
        isSingle: isSingle,
        isText: Boolean(ak.text && ak.text[qKey] != null),
        qs: [qNum],
        primaryQ: qNum,
        part: partOfQuestion(qNum),
        label: String(qNum),
        shortLabel: 'Q' + qNum,
        fbKey: String(qNum),
        status: row.isCorrect ? 'correct' : 'incorrect',
        isCorrect: Boolean(row.isCorrect),
        userRaw: userRaw,
        correctRaw: correctRaw,
        userDisplay: userDisplay,
        correctDisplay: correctDisplay
      };
      byQ[qNum] = unit;
      units.push(unit);
    });

    var mistakes = units.filter(function (u) { return !u.isCorrect; });
    var correctCount = rows.filter(function (r) { return r.isCorrect; }).length;
    var totalCount = rows.length;
    var percentage = totalCount ? Math.round((correctCount / totalCount) * 100) : 0;

    return {
      rows: rows,
      byQ: byQ,
      units: units,
      mistakes: mistakes,
      correctCount: correctCount,
      totalCount: totalCount,
      wrongCount: totalCount - correctCount,
      percentage: percentage,
      band: result && result.band ? result.band : null
    };
  }

  /* ========================================================================
     Applying Review Mode to Left Pane & Right Pane
     ======================================================================== */
  function enterReviewMode(doc, ui, state, result) {
    var grading = buildGradingModel(doc, result);
    state.isReviewing = true;
    state.grading = grading;
    state.mistakeCursor = -1;
    state.filterMode = 'all';
    doc.body.classList.add('lrs-reviewing');
    doc.body.classList.remove('lrs-filter-wrong');

    enhanceLeftQuestions(doc, grading);
    enhanceResultsTable(doc, grading);
    renderReviewBar(doc, ui, state);
    applyGradingToTranscript(doc, ui, state);
    updateMarksToggleLabel(ui, state);
    renderQuestionJumpStrip(doc, ui, state);

    // Automatically open split-screen side-by-side comparison!
    setSplitOpen(doc, ui, state, true);

    // Keep left pane scrolled neatly to the top (overriding original scroll-to-bottom results-card jump)
    global.setTimeout(function () {
      if (ui.leftPane) ui.leftPane.scrollTo({ top: 0, behavior: 'smooth' });
      if (ui.scriptBody) ui.scriptBody.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
  }

  function exitReviewMode(doc, ui, state) {
    state.isReviewing = false;
    state.grading = null;
    state.mistakeCursor = -1;
    state.filterMode = 'all';
    state.onlyWrongMarks = false;
    state.focusedUnitKey = '';
    doc.body.classList.remove('lrs-reviewing', 'lrs-filter-wrong');

    ui.reviewBar.hidden = true;
    ui.reviewBar.innerHTML = '';

    // Clear left-pane classes added during review
    Array.prototype.slice.call(doc.querySelectorAll('.lrs-q-correct, .lrs-q-incorrect, .lrs-line-correct, .lrs-line-incorrect, .lrs-q-focused')).forEach(function (el) {
      el.classList.remove('lrs-q-correct', 'lrs-q-incorrect', 'lrs-line-correct', 'lrs-line-incorrect', 'lrs-q-focused');
    });

    // Clear transcript grading styles & verdict cards
    ui.rightPane.classList.remove('lrs-only-wrong-marks');
    Array.prototype.slice.call(ui.textHost.querySelectorAll('.lrs-ev')).forEach(function (mark) {
      mark.classList.remove('is-correct', 'is-incorrect', 'is-partial', 'is-focused');
      var badge = mark.querySelector('.lrs-ev-badge');
      if (badge) badge.textContent = mark.dataset.qLabel || '';
    });
    Array.prototype.slice.call(ui.textHost.querySelectorAll('.lrs-turn, .lrs-para')).forEach(function (block) {
      block.classList.remove('has-mistake', 'has-partial');
      var v = block.querySelector('.lrs-verdicts');
      if (v) v.innerHTML = '';
    });
    Array.prototype.slice.call(ui.rightPane.querySelectorAll('[data-lrs-tab-err]')).forEach(function (dot) {
      dot.hidden = true;
      dot.textContent = '';
    });

    updateMarksToggleLabel(ui, state);
    renderQuestionJumpStrip(doc, ui, state);
    setSplitOpen(doc, ui, state, false);
  }

  function enhanceLeftQuestions(doc, grading) {
    // Clear previous state classes first
    Array.prototype.slice.call(doc.querySelectorAll('.lrs-q-correct, .lrs-q-incorrect, .lrs-line-correct, .lrs-line-incorrect')).forEach(function (el) {
      el.classList.remove('lrs-q-correct', 'lrs-q-incorrect', 'lrs-line-correct', 'lrs-line-incorrect');
    });

    var containerLines = new Map(); // li / tr -> { hasWrong: bool }

    grading.units.forEach(function (unit) {
      var fb = doc.querySelector('[data-feedback-for="' + unit.fbKey + '"]');
      var anchor = doc.getElementById('q-anchor-' + unit.primaryQ);

      if (anchor) {
        if (anchor.classList.contains('question-block') || anchor.classList.contains('matching-item')) {
          anchor.classList.add(unit.isCorrect ? 'lrs-q-correct' : 'lrs-q-incorrect');
        } else {
          // Blank inside <li> or <tr>
          var line = anchor.closest('li, tr');
          if (line && !line.closest('#results-card')) {
            var info = containerLines.get(line) || { hasWrong: false };
            if (!unit.isCorrect) info.hasWrong = true;
            containerLines.set(line, info);
          }
        }
      }

      if (!fb) return;

      if (unit.isPair) {
        if (unit.status === 'correct') {
          fb.className = 'inline-feedback ok';
          fb.innerHTML = '<span class="lrs-fb-chip is-ok">✓ 2/2 全对</span>' +
            '<button type="button" class="lrs-locate-btn" data-lrs-locate="' + unit.primaryQ + '" data-answer-ignore="true">📍 原文</button>';
        } else {
          var chipCls = unit.status === 'partial' ? 'is-partial' : 'is-err';
          var labelTxt = unit.status === 'partial' ? '◐ 对 1/2' : '✗ 0/2';
          var userTxt = unit.userRaw ? (' · 你选 ' + escapeHtml(unit.userRaw)) : ' · 未作答';
          fb.className = 'inline-feedback err';
          fb.innerHTML = '<span class="lrs-fb-chip ' + chipCls + '">' + labelTxt + userTxt + '</span>' +
            '<span class="lrs-fb-ans">正解: ' + escapeHtml(unit.correctRaw) + '</span>' +
            '<button type="button" class="lrs-locate-btn is-err-btn" data-lrs-locate="' + unit.primaryQ + '" data-answer-ignore="true">📍 定位原文 Q' + escapeHtml(unit.label) + '</button>';
        }
        return;
      }

      if (unit.isCorrect) {
        fb.className = 'inline-feedback ok';
        var okText = unit.isText ? '✓' : '✓ 正确';
        fb.innerHTML = '<span class="lrs-fb-chip is-ok">' + okText + '</span>' +
          '<button type="button" class="lrs-locate-btn" data-lrs-locate="' + unit.primaryQ + '" data-answer-ignore="true" title="在右侧原文中定位该题依据">📍 原文</button>';
      } else {
        var wrongLabel = unit.userRaw ? (unit.isSingle ? ('✗ 你选 ' + unit.userRaw) : '✗ 错') : '✗ 未作答';
        var ansText = unit.isSingle ? unit.correctDisplay : unit.correctRaw;
        fb.className = 'inline-feedback err';
        fb.innerHTML = '<span class="lrs-fb-chip is-err">' + escapeHtml(wrongLabel) + '</span>' +
          '<span class="lrs-fb-ans">正解: ' + escapeHtml(ansText) + '</span>' +
          '<button type="button" class="lrs-locate-btn is-err-btn" data-lrs-locate="' + unit.primaryQ + '" data-answer-ignore="true">📍 原文 Q' + unit.primaryQ + '</button>';
      }
    });

    containerLines.forEach(function (info, line) {
      line.classList.add(info.hasWrong ? 'lrs-line-incorrect' : 'lrs-line-correct');
    });
  }

  function enhanceResultsTable(doc, grading) {
    var rows = Array.prototype.slice.call(doc.querySelectorAll('#results-table-host .results-table tbody tr'));
    rows.forEach(function (tr, idx) {
      var rowData = grading.rows[idx];
      if (!rowData) return;
      tr.dataset.jumpQ = String(rowData.q);
      tr.classList.toggle('lrs-row-correct', Boolean(rowData.isCorrect));
      tr.classList.toggle('lrs-row-incorrect', !rowData.isCorrect);
      tr.title = '点击定位第 ' + rowData.q + ' 题和原文依据';
    });
  }

  function renderReviewBar(doc, ui, state) {
    var g = state.grading;
    if (!g) return;

    var wrongCount = g.wrongCount;
    var mistakeUnitsCount = g.mistakes.length;
    var summaryHtml = wrongCount === 0
      ? '<span class="lrs-mistake-summary"><strong class="is-ok">全部正确 🎉</strong></span>'
      : '<span class="lrs-mistake-summary">错题 / 未答 <strong class="is-err">' + wrongCount + '</strong> 题</span>';

    var bandHtml = g.band
      ? '<span class="lrs-band-pill">Band ' + escapeHtml(g.band) + '</span>'
      : '';

    var partChipsHtml = '';
    if (state.isFullTest) {
      var chips = [1, 2, 3, 4].map(function (p) {
        var pRows = g.rows.filter(function (r) { return partOfQuestion(r.q) === p; });
        var pOk = pRows.filter(function (r) { return r.isCorrect; }).length;
        var pWrong = pRows.length - pOk;
        var badge = pWrong > 0
          ? '<span class="lrs-part-chip-err">' + pWrong + '错</span>'
          : '<span class="lrs-part-chip-ok">全对</span>';
        return '<button type="button" class="lrs-part-chip' + (p === state.activePart ? ' active' : '') +
          '" data-lrs-part-chip="' + p + '" data-answer-ignore="true">Part ' + p + ' · ' + pOk + '/' + pRows.length + ' ' + badge + '</button>';
      });
      partChipsHtml = '<div class="lrs-part-chips">' + chips.join('') + '</div>';
    }

    var stepperLabel = mistakeUnitsCount > 0
      ? (state.mistakeCursor >= 0 ? ('错题 ' + (state.mistakeCursor + 1) + '/' + mistakeUnitsCount) : '开始看错题 →')
      : '';

    var stepperHtml = mistakeUnitsCount > 0
      ? '<button type="button" class="lrs-btn" id="lrs-prev-mistake" title="上一道错题" data-answer-ignore="true">← 上一错题</button>' +
        '<button type="button" class="lrs-btn lrs-btn-err" id="lrs-next-mistake" title="下一道错题" data-answer-ignore="true">' + escapeHtml(stepperLabel) + '</button>'
      : '';

    var replayBannerHtml = '';
    if (state.isHistoricalReplay) {
      var meta = state.replayMeta || {};
      var metaBits = [];
      if (meta.dateLabel) metaBits.push('完成于 ' + meta.dateLabel);
      if (meta.durationLabel) metaBits.push('用时 ' + meta.durationLabel);
      metaBits.push('只读复盘 · 音频已解锁可自由回听');
      replayBannerHtml = [
        '<div class="lrs-replay-banner" id="lrs-replay-banner">',
        '  <div class="lrs-replay-banner-left">',
        '    <span class="lrs-replay-pill">📜 历史原卷复盘</span>',
        '    <span class="lrs-replay-meta">' + escapeHtml(metaBits.join(' · ')) + '</span>',
        '  </div>',
        '  <button type="button" class="lrs-btn lrs-replay-close-btn" id="lrs-close-replay-btn" data-answer-ignore="true">关闭复盘</button>',
        '</div>'
      ].join('\n');
    }

    ui.reviewBar.innerHTML = [
      replayBannerHtml,
      '<div class="lrs-review-top">',
      '  <div class="lrs-score-cluster">',
      '    <span class="lrs-score-pill">' + g.correctCount + ' / ' + g.totalCount + '<span class="lrs-score-pct">(' + g.percentage + '%)</span></span>',
      bandHtml,
      summaryHtml,
      '  </div>',
      '  <div class="lrs-review-actions">',
      '    <div class="lrs-seg-group" role="group" aria-label="题目筛选">',
      '      <button type="button" class="lrs-seg-btn' + (state.filterMode === 'all' ? ' active' : '') + '" data-lrs-filter="all" data-answer-ignore="true">全部 (' + g.totalCount + ')</button>',
      '      <button type="button" class="lrs-seg-btn is-wrong-tab' + (state.filterMode === 'wrong' ? ' active' : '') + '" data-lrs-filter="wrong" data-answer-ignore="true"' + (wrongCount === 0 ? ' disabled' : '') + '>仅看错题 (' + wrongCount + ')</button>',
      '    </div>',
      stepperHtml,
      '    <button type="button" class="lrs-btn" id="lrs-jump-results" data-answer-ignore="true">答题总表</button>',
      '    <button type="button" class="lrs-btn' + (state.splitOpen ? '' : ' lrs-btn-primary') + '" id="lrs-toggle-split-btn" data-answer-ignore="true">' + (state.splitOpen ? '收起原文' : '对照原文') + '</button>',
      '  </div>',
      '</div>',
      partChipsHtml
    ].join('\n');
    ui.reviewBar.hidden = false;
  }

  function applyGradingToTranscript(doc, ui, state) {
    var g = state.grading;
    if (!g) return;

    // 1. Color every <mark class="lrs-ev"> according to grading status
    var lastBlockByUnitKey = Object.create(null);

    Array.prototype.slice.call(ui.textHost.querySelectorAll('.lrs-turn, .lrs-para')).forEach(function (block) {
      block.classList.remove('has-mistake', 'has-partial');
      var verdictsHost = block.querySelector('.lrs-verdicts');
      if (verdictsHost) verdictsHost.innerHTML = '';

      var blockHasErr = false;
      var blockHasPartial = false;

      Array.prototype.slice.call(block.querySelectorAll('.lrs-ev')).forEach(function (mark) {
        mark.classList.remove('is-correct', 'is-incorrect', 'is-partial');
        var qNums = String(mark.dataset.qList || '').split(',').map(Number).filter(Boolean);
        var primaryQ = qNums[0];
        var unit = g.byQ[primaryQ];
        if (!unit) return;

        var status = unit.status;
        mark.classList.add('is-' + status);
        var badge = mark.querySelector('.lrs-ev-badge');
        if (badge) {
          var icon = status === 'correct' ? '✓ ' : (status === 'partial' ? '◐ ' : '✗ ');
          badge.textContent = icon + (mark.dataset.qLabel || ('Q' + primaryQ));
        }

        if (status === 'incorrect') blockHasErr = true;
        else if (status === 'partial') blockHasPartial = true;

        if (!unit.isCorrect) {
          lastBlockByUnitKey[unit.key] = { block: block, unit: unit };
        }
      });

      if (blockHasErr) block.classList.add('has-mistake');
      else if (blockHasPartial) block.classList.add('has-partial');
    });

    // 2. Render clean Mistake Comparison Callout Cards under the concluding block of each wrong/partial unit
    Object.keys(lastBlockByUnitKey).forEach(function (key) {
      var entry = lastBlockByUnitKey[key];
      var host = entry.block.querySelector('.lrs-verdicts');
      if (!host) return;
      var unit = entry.unit;

      var card = doc.createElement('div');
      card.className = 'lrs-verdict-card' + (unit.status === 'partial' ? ' is-partial' : '');
      card.dataset.verdictQ = String(unit.primaryQ);

      var badgeText = unit.status === 'partial'
        ? ('◐ Q' + unit.label + ' · 对 1/2')
        : ('✗ Q' + unit.label);

      var userPrefix = (unit.isSingle || unit.isPair) ? '你选:' : '你填:';
      var userText = unit.userDisplay || unit.userRaw;
      var userSpan = userText
        ? '<span class="lrs-verdict-user" title="你的答案"><span class="lrs-verdict-user-label">' + userPrefix + '</span><span class="lrs-verdict-user-val">' + escapeHtml(userText) + '</span></span>'
        : '<span class="lrs-verdict-user is-empty">未作答</span>';

      var correctText = unit.correctDisplay || unit.correctRaw;
      var correctSpan = '<span class="lrs-verdict-correct" title="正确答案"><span class="lrs-verdict-correct-label">正解:</span><span>' + escapeHtml(correctText) + '</span></span>';

      card.innerHTML = [
        '<span class="lrs-verdict-q">' + escapeHtml(badgeText) + '</span>',
        '<span class="lrs-verdict-diff">',
        userSpan,
        '  <span class="lrs-verdict-arrow">→</span>',
        correctSpan,
        '</span>',
        '<button type="button" class="lrs-verdict-jump" data-lrs-jump-left="' + unit.primaryQ + '" data-answer-ignore="true">跳到第 ' + escapeHtml(unit.label) + ' 题 ↗</button>'
      ].join('');

      host.appendChild(card);
    });

    // 3. Update Full-Test Part Tab mistake badges
    if (state.isFullTest) {
      [1, 2, 3, 4].forEach(function (p) {
        var dot = ui.rightPane.querySelector('[data-lrs-tab-err="' + p + '"]');
        if (!dot) return;
        var wrongInPart = g.rows.filter(function (r) { return partOfQuestion(r.q) === p && !r.isCorrect; }).length;
        if (wrongInPart > 0) {
          dot.textContent = wrongInPart + '错';
          dot.hidden = false;
        } else {
          dot.textContent = '';
          dot.hidden = true;
        }
      });
    }
  }

  /* ========================================================================
     Bidirectional Focus & Mistake Stepping
     ======================================================================== */
  function focusQuestion(doc, ui, state, qNum, options) {
    var opts = options || {};
    var n = Number(qNum) || 1;
    var targetPart = partOfQuestion(n);

    if (opts.openSplit) {
      setSplitOpen(doc, ui, state, true);
    }

    // Switch part if needed (Full Test)
    if (state.isFullTest && global.App && typeof global.App.switchPart === 'function') {
      if (global.App.state && Number(global.App.state.activePart) !== targetPart) {
        global.App.switchPart(targetPart, { scrollToTop: false });
      }
    }
    setActiveTranscriptPart(doc, ui, state, targetPart, { syncLeft: false });

    // On mobile narrow view, flip to the destination pane
    if (opts.mobileTarget) {
      setMobilePane(doc, ui, state, opts.mobileTarget);
    }

    var unit = state.grading && state.grading.byQ[n];
    state.focusedUnitKey = unit ? unit.key : ('q:' + n);
    if (state.grading && unit && !unit.isCorrect) {
      var idx = state.grading.mistakes.indexOf(unit);
      if (idx >= 0) {
        state.mistakeCursor = idx;
        updateMistakeStepperLabel(ui, state);
      }
    }

    // Highlight active pill
    renderQuestionJumpStrip(doc, ui, state);

    // Scroll & pulse left question
    if (opts.scrollLeft !== false) {
      global.setTimeout(function () {
        var anchor = doc.getElementById('q-anchor-' + n);
        if (!anchor && unit && unit.isPair) {
          anchor = doc.getElementById('q-anchor-' + unit.primaryQ);
        }
        if (anchor) {
          var targetEl = anchor.classList.contains('pair-anchor') ? anchor.closest('.question-block') : anchor;
          if (targetEl) {
            Array.prototype.slice.call(doc.querySelectorAll('.lrs-q-focused')).forEach(function (el) {
              el.classList.remove('lrs-q-focused');
            });
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Retrigger pulse animation
            void targetEl.offsetWidth;
            targetEl.classList.add('lrs-q-focused');
          }
        }
      }, 35);
    }

    // Scroll & pulse right transcript evidence
    if (opts.scrollRight !== false && state.splitOpen && state.viewMode === 'text') {
      global.setTimeout(function () {
        var activePartEl = ui.textHost.querySelector('.lrs-script-part[data-lrs-part="' + targetPart + '"]');
        if (!activePartEl) return;
        Array.prototype.slice.call(ui.textHost.querySelectorAll('.lrs-ev.is-focused')).forEach(function (m) {
          m.classList.remove('is-focused');
        });
        var marks = Array.prototype.slice.call(activePartEl.querySelectorAll('.lrs-ev')).filter(function (m) {
          var list = String(m.dataset.qList || '').split(',').map(Number);
          return list.indexOf(n) >= 0;
        });
        if (marks.length) {
          marks.forEach(function (m) {
            void m.offsetWidth;
            m.classList.add('is-focused');
          });
          marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 45);
    }
  }

  function stepMistake(doc, ui, state, delta) {
    if (!state.grading || !state.grading.mistakes.length) return;
    var total = state.grading.mistakes.length;
    if (state.mistakeCursor < 0) {
      state.mistakeCursor = delta >= 0 ? 0 : total - 1;
    } else {
      state.mistakeCursor = (state.mistakeCursor + delta + total) % total;
    }
    var unit = state.grading.mistakes[state.mistakeCursor];
    updateMistakeStepperLabel(ui, state);
    if (unit) {
      focusQuestion(doc, ui, state, unit.primaryQ, { openSplit: true, scrollLeft: true, scrollRight: true });
    }
  }

  function updateMistakeStepperLabel(ui, state) {
    var nextBtn = ui.reviewBar.querySelector('#lrs-next-mistake');
    if (!nextBtn || !state.grading || !state.grading.mistakes.length) return;
    var total = state.grading.mistakes.length;
    nextBtn.textContent = state.mistakeCursor >= 0
      ? ('错题 ' + (state.mistakeCursor + 1) + '/' + total + ' →')
      : '下一错题 →';
  }

  function setFilterMode(doc, ui, state, mode) {
    state.filterMode = mode === 'wrong' ? 'wrong' : 'all';
    doc.body.classList.toggle('lrs-filter-wrong', state.filterMode === 'wrong');
    Array.prototype.slice.call(ui.reviewBar.querySelectorAll('[data-lrs-filter]')).forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lrsFilter === state.filterMode);
    });
    // In wrong-only filter on Full Test, if current part has 0 mistakes, jump to first part with mistakes
    if (state.filterMode === 'wrong' && state.isFullTest && state.grading && state.grading.mistakes.length) {
      var hasMistakeHere = state.grading.mistakes.some(function (u) { return u.part === state.activePart; });
      if (!hasMistakeHere) {
        var firstMistake = state.grading.mistakes[0];
        focusQuestion(doc, ui, state, firstMistake.primaryQ, { scrollLeft: true, scrollRight: true });
      }
    }
  }

  function updateMarksToggleLabel(ui, state) {
    if (!ui.marksToggle) return;
    if (state.isReviewing) {
      ui.rightPane.classList.remove('lrs-hide-marks');
      ui.rightPane.classList.toggle('lrs-only-wrong-marks', state.onlyWrongMarks);
      ui.marksToggle.textContent = state.onlyWrongMarks ? '仅标错题' : '全部考点';
      ui.marksToggle.classList.toggle('active', state.onlyWrongMarks);
      ui.marksToggle.title = '切换显示全部考点高亮或仅高亮错题';
    } else {
      ui.rightPane.classList.remove('lrs-only-wrong-marks');
      ui.rightPane.classList.toggle('lrs-hide-marks', state.hideMarksPreSubmit);
      ui.marksToggle.textContent = state.hideMarksPreSubmit ? '显示考点' : '隐藏考点';
      ui.marksToggle.classList.toggle('active', !state.hideMarksPreSubmit);
      ui.marksToggle.title = '做题前可隐藏官方 Q 考点下划线防止剧透';
    }
  }

  function setMobilePane(doc, ui, state, pane) {
    state.mobilePane = pane === 'transcript' ? 'transcript' : 'questions';
    doc.body.dataset.lrsMobilePane = state.mobilePane;
    Array.prototype.slice.call(ui.mobileSwitcher.querySelectorAll('[data-lrs-mobile-tab]')).forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lrsMobileTab === state.mobilePane);
    });
  }

  /* ========================================================================
     Transcript Search (Safe DOM Text-Node Highlighting)
     ======================================================================== */
  function clearTranscriptSearch(ui, state) {
    Array.prototype.slice.call(ui.textHost.querySelectorAll('span.lrs-search-hit')).forEach(function (span) {
      var parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(span.ownerDocument.createTextNode(span.textContent || ''), span);
      parent.normalize();
    });
    state.searchMatches = [];
    state.searchIndex = -1;
    if (ui.searchCount) ui.searchCount.textContent = '';
  }

  function runTranscriptSearch(doc, ui, state, rawQuery) {
    clearTranscriptSearch(ui, state);
    var query = String(rawQuery || '').trim();
    state.searchQuery = query;
    if (!query) return;

    var activePartEl = ui.textHost.querySelector('.lrs-script-part[data-lrs-part="' + state.activePart + '"]');
    if (!activePartEl) return;

    var lowerQuery = query.toLowerCase();
    var walker = doc.createTreeWalker(activePartEl, global.NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return global.NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent) return global.NodeFilter.FILTER_REJECT;
        if (parent.closest('.lrs-ev-badge, .lrs-verdicts, .lrs-turn-speaker, .lrs-part-heading')) {
          return global.NodeFilter.FILTER_REJECT;
        }
        return global.NodeFilter.FILTER_ACCEPT;
      }
    });

    var textNodes = [];
    var current;
    while ((current = walker.nextNode())) {
      if (current.nodeValue.toLowerCase().indexOf(lowerQuery) >= 0) {
        textNodes.push(current);
      }
    }

    textNodes.forEach(function (node) {
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var frag = doc.createDocumentFragment();
      var pos = 0;
      var foundAt;
      while ((foundAt = lower.indexOf(lowerQuery, pos)) >= 0) {
        if (foundAt > pos) {
          frag.appendChild(doc.createTextNode(text.slice(pos, foundAt)));
        }
        var hit = doc.createElement('span');
        hit.className = 'lrs-search-hit';
        hit.textContent = text.slice(foundAt, foundAt + query.length);
        frag.appendChild(hit);
        state.searchMatches.push(hit);
        pos = foundAt + query.length;
      }
      if (pos < text.length) {
        frag.appendChild(doc.createTextNode(text.slice(pos)));
      }
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });

    if (state.searchMatches.length) {
      jumpSearchMatch(ui, state, 0);
    } else if (ui.searchCount) {
      ui.searchCount.textContent = '0 处';
    }
  }

  function jumpSearchMatch(ui, state, index) {
    if (!state.searchMatches.length) return;
    var total = state.searchMatches.length;
    var next = ((index % total) + total) % total;
    state.searchMatches.forEach(function (el) { el.classList.remove('is-current'); });
    state.searchIndex = next;
    var target = state.searchMatches[next];
    target.classList.add('is-current');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (ui.searchCount) ui.searchCount.textContent = (next + 1) + ' / ' + total;
  }

  /* ========================================================================
     Event Wiring
     ======================================================================== */
  function wireResizer(doc, ui, state) {
    var dragging = false;

    function updateWidthFromClientX(clientX) {
      var rect = ui.shell.getBoundingClientRect();
      if (!rect.width) return;
      var pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.min(70, Math.max(30, pct));
      doc.documentElement.style.setProperty('--lrs-left-width', pct.toFixed(1) + '%');
      writeStorage(STORAGE_LEFT_WIDTH, pct.toFixed(1));
    }

    ui.resizer.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      ui.resizer.classList.add('is-dragging');
      doc.body.classList.add('lrs-resizing');
      try { ui.resizer.setPointerCapture(e.pointerId); } catch (_) { }
    });

    ui.resizer.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      updateWidthFromClientX(e.clientX);
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      ui.resizer.classList.remove('is-dragging');
      doc.body.classList.remove('lrs-resizing');
      try { if (e && e.pointerId != null) ui.resizer.releasePointerCapture(e.pointerId); } catch (_) { }
    }

    ui.resizer.addEventListener('pointerup', endDrag);
    ui.resizer.addEventListener('pointercancel', endDrag);

    ui.resizer.addEventListener('dblclick', function () {
      doc.documentElement.style.setProperty('--lrs-left-width', '50%');
      writeStorage(STORAGE_LEFT_WIDTH, '50');
    });

    ui.resizer.addEventListener('keydown', function (e) {
      var current = Number(readStorage(STORAGE_LEFT_WIDTH, '50')) || 50;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        var leftNext = Math.max(30, current - 3);
        doc.documentElement.style.setProperty('--lrs-left-width', leftNext + '%');
        writeStorage(STORAGE_LEFT_WIDTH, leftNext);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        var rightNext = Math.min(70, current + 3);
        doc.documentElement.style.setProperty('--lrs-left-width', rightNext + '%');
        writeStorage(STORAGE_LEFT_WIDTH, rightNext);
      }
    });
  }

  function wireTranscriptToggleButtons(doc, ui, state) {
    ['open-transcript-inline-btn', 'toggle-transcript-btn', 'review-transcript-btn'].forEach(function (id) {
      var btn = doc.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var settingsPanel = doc.getElementById('settings-panel');
        if (settingsPanel) settingsPanel.classList.remove('open');
        setSplitOpen(doc, ui, state, !state.splitOpen);
        if (state.splitOpen && global.innerWidth <= 960) {
          setMobilePane(doc, ui, state, 'transcript');
        }
      }, true);
    });
  }

  function wireRightPaneControls(doc, ui, state, transcriptData) {
    ui.mobileSwitcher.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-lrs-mobile-tab]');
      if (!tab) return;
      setMobilePane(doc, ui, state, tab.dataset.lrsMobileTab);
    });

    if (ui.closeSplit) {
      ui.closeSplit.addEventListener('click', function () {
        setSplitOpen(doc, ui, state, false);
      });
    }

    if (ui.fontDec) {
      ui.fontDec.addEventListener('click', function () {
        state.scriptFontPx = clampScriptSize(state.scriptFontPx - 1);
        applyScriptFontSize(doc, state.scriptFontPx);
        writeStorage(STORAGE_SCRIPT_SIZE, state.scriptFontPx);
        if (ui.fontReadout) ui.fontReadout.textContent = state.scriptFontPx + 'px';
      });
    }

    if (ui.fontInc) {
      ui.fontInc.addEventListener('click', function () {
        state.scriptFontPx = clampScriptSize(state.scriptFontPx + 1);
        applyScriptFontSize(doc, state.scriptFontPx);
        writeStorage(STORAGE_SCRIPT_SIZE, state.scriptFontPx);
        if (ui.fontReadout) ui.fontReadout.textContent = state.scriptFontPx + 'px';
      });
    }

    if (ui.marksToggle) {
      ui.marksToggle.addEventListener('click', function () {
        if (state.isReviewing) {
          state.onlyWrongMarks = !state.onlyWrongMarks;
        } else {
          state.hideMarksPreSubmit = !state.hideMarksPreSubmit;
        }
        updateMarksToggleLabel(ui, state);
      });
    }

    // View mode switch (精排文本 | 原版扫描)
    ui.rightPane.addEventListener('click', function (e) {
      var viewBtn = e.target.closest('[data-lrs-view]');
      if (viewBtn) {
        setViewMode(doc, ui, state, viewBtn.dataset.lrsView);
        return;
      }

      var partTab = e.target.closest('[data-lrs-script-part]');
      if (partTab) {
        setActiveTranscriptPart(doc, ui, state, Number(partTab.dataset.lrsScriptPart), { syncLeft: true });
        return;
      }

      var qPill = e.target.closest('[data-lrs-jump-q]');
      if (qPill) {
        focusQuestion(doc, ui, state, Number(qPill.dataset.lrsJumpQ), { scrollLeft: true, scrollRight: true });
        return;
      }

      var jumpLeftBtn = e.target.closest('[data-lrs-jump-left]');
      if (jumpLeftBtn) {
        focusQuestion(doc, ui, state, Number(jumpLeftBtn.dataset.lrsJumpLeft), {
          scrollLeft: true,
          scrollRight: false,
          mobileTarget: global.innerWidth <= 960 ? 'questions' : ''
        });
        return;
      }

      var evMark = e.target.closest('.lrs-ev');
      if (evMark && !ui.rightPane.classList.contains('lrs-hide-marks')) {
        var primaryQ = Number(evMark.dataset.primaryQ);
        if (primaryQ) {
          focusQuestion(doc, ui, state, primaryQ, {
            scrollLeft: true,
            scrollRight: false,
            mobileTarget: global.innerWidth <= 960 ? 'questions' : ''
          });
        }
        return;
      }

      // Scan zoom buttons
      var zoomBtn = e.target.closest('[data-lrs-scan-zoom]');
      if (zoomBtn) {
        var delta = Number(zoomBtn.dataset.lrsScanZoom) || 0;
        state.scanZoomPct = Math.min(220, Math.max(60, state.scanZoomPct + delta));
        applyScanZoom(ui, state);
        return;
      }

      if (e.target.closest('[data-lrs-scan-reset]')) {
        state.scanZoomPct = 100;
        applyScanZoom(ui, state);
        return;
      }

      // Click scan image -> open lightbox
      var scanImg = e.target.closest('img.lrs-scan-img');
      if (scanImg) {
        openLightbox(ui, scanImg.getAttribute('src'), scanImg.getAttribute('alt'));
      }
    });

    // Keyboard activation on focused <mark class="lrs-ev">
    ui.textHost.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('lrs-ev')) {
        e.preventDefault();
        var primaryQ = Number(e.target.dataset.primaryQ);
        if (primaryQ) focusQuestion(doc, ui, state, primaryQ, { scrollLeft: true, scrollRight: false });
      }
    });

    // Search controls
    if (ui.searchToggle && ui.searchBar && ui.searchInput) {
      ui.searchToggle.addEventListener('click', function () {
        state.searchOpen = !state.searchOpen;
        ui.searchBar.classList.toggle('open', state.searchOpen);
        ui.searchToggle.classList.toggle('active', state.searchOpen);
        if (state.searchOpen) {
          ui.searchInput.focus();
          ui.searchInput.select();
        } else {
          clearTranscriptSearch(ui, state);
        }
      });

      ui.searchInput.addEventListener('input', function () {
        runTranscriptSearch(doc, ui, state, ui.searchInput.value);
      });

      ui.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          jumpSearchMatch(ui, state, state.searchIndex + (e.shiftKey ? -1 : 1));
        } else if (e.key === 'Escape') {
          state.searchOpen = false;
          ui.searchBar.classList.remove('open');
          ui.searchToggle.classList.remove('active');
          clearTranscriptSearch(ui, state);
        }
      });

      if (ui.searchPrev) ui.searchPrev.addEventListener('click', function () { jumpSearchMatch(ui, state, state.searchIndex - 1); });
      if (ui.searchNext) ui.searchNext.addEventListener('click', function () { jumpSearchMatch(ui, state, state.searchIndex + 1); });
      if (ui.searchClose) {
        ui.searchClose.addEventListener('click', function () {
          state.searchOpen = false;
          ui.searchBar.classList.remove('open');
          ui.searchToggle.classList.remove('active');
          clearTranscriptSearch(ui, state);
        });
      }
    }
  }

  function applyScanZoom(ui, state) {
    ui.scanHost.style.setProperty('--lrs-scan-scale', state.scanZoomPct + '%');
    Array.prototype.slice.call(ui.scanHost.querySelectorAll('[data-lrs-scan-readout]')).forEach(function (el) {
      el.textContent = state.scanZoomPct + '%';
    });
  }

  function wireLeftPaneDelegation(doc, ui, state) {
    // Review Bar controls
    ui.reviewBar.addEventListener('click', function (e) {
      var filterBtn = e.target.closest('[data-lrs-filter]');
      if (filterBtn) {
        setFilterMode(doc, ui, state, filterBtn.dataset.lrsFilter);
        return;
      }
      var partChip = e.target.closest('[data-lrs-part-chip]');
      if (partChip) {
        setActiveTranscriptPart(doc, ui, state, Number(partChip.dataset.lrsPartChip), { syncLeft: true, scrollToTop: true });
        return;
      }
      if (e.target.closest('#lrs-prev-mistake')) {
        stepMistake(doc, ui, state, -1);
        return;
      }
      if (e.target.closest('#lrs-next-mistake')) {
        stepMistake(doc, ui, state, 1);
        return;
      }
      if (e.target.closest('#lrs-jump-results')) {
        var card = doc.getElementById('results-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('#lrs-toggle-split-btn')) {
        setSplitOpen(doc, ui, state, !state.splitOpen);
        return;
      }
      if (e.target.closest('#lrs-close-replay-btn')) {
        try {
          if (global.top && typeof global.top.close === 'function') {
            global.top.close();
          } else if (typeof global.close === 'function') {
            global.close();
          }
        } catch (_) {
          try { global.close(); } catch (_) { }
        }
      }
    });

    // Locate-in-transcript buttons on inline feedbacks & results table rows
    ui.leftPane.addEventListener('click', function (e) {
      var locBtn = e.target.closest('[data-lrs-locate]');
      if (locBtn) {
        e.preventDefault();
        e.stopPropagation();
        var q = Number(locBtn.dataset.lrsLocate);
        if (q) {
          focusQuestion(doc, ui, state, q, {
            openSplit: true,
            scrollLeft: false,
            scrollRight: true,
            mobileTarget: global.innerWidth <= 960 ? 'transcript' : ''
          });
        }
        return;
      }

      var resultRow = e.target.closest('#results-table-host tbody tr[data-jump-q]');
      if (resultRow) {
        var rq = Number(resultRow.dataset.jumpQ);
        if (rq) {
          focusQuestion(doc, ui, state, rq, { openSplit: true, scrollLeft: true, scrollRight: true });
        }
      }
    });

    // Sync bottom nav question click -> also highlight right transcript when split is open
    doc.addEventListener('click', function (e) {
      var navItem = e.target && e.target.closest ? e.target.closest('.q-nav-item[data-qnum]') : null;
      if (navItem && state.splitOpen) {
        var qNum = Number(navItem.dataset.qnum);
        if (qNum) {
          global.setTimeout(function () {
            focusQuestion(doc, ui, state, qNum, { scrollLeft: false, scrollRight: true });
          }, 50);
        }
      }
    });
  }

  function wireAppHooks(doc, ui, state) {
    var app = global.App;
    if (app && typeof app.finishTest === 'function') {
      var origFinish = app.finishTest;
      var wrappedFinish = function () {
        var res = origFinish.apply(this, arguments);
        try { enterReviewMode(doc, ui, state, res); } catch (err) { console.error('[ListeningReviewStudio] enterReviewMode failed:', err); }
        return res;
      };
      app.finishTest = wrappedFinish;
    }

    if (app && typeof app.resetTest === 'function') {
      var origReset = app.resetTest;
      app.resetTest = async function () {
        var res = await origReset.apply(this, arguments);
        if (!app.state || !app.state.isReviewing) {
          exitReviewMode(doc, ui, state);
        }
        return res;
      };
    }

    if (app && typeof app.switchPart === 'function') {
      var origSwitch = app.switchPart;
      app.switchPart = function (partNumber, options) {
        var res = origSwitch.apply(this, arguments);
        var p = (app.state && Number(app.state.activePart)) || Number(partNumber) || 1;
        if (state.activePart !== p) {
          setActiveTranscriptPart(doc, ui, state, p, { syncLeft: false });
        }
        return res;
      };
    }

    // Observe #results-card so closure-scoped resetTest() clicks on #clear-btn ALWAYS exit review mode cleanly
    var resultsCard = doc.getElementById('results-card');
    if (resultsCard && typeof global.MutationObserver === 'function') {
      var observer = new global.MutationObserver(function () {
        if (state.isReviewing && !resultsCard.classList.contains('show')) {
          exitReviewMode(doc, ui, state);
        }
      });
      observer.observe(resultsCard, { attributes: true, attributeFilter: ['class'] });
    }

    // Sync Full-Test part tabs when user clicks part buttons directly
    if (state.isFullTest) {
      doc.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-switch-part], [data-step-to-part], [data-review-part], #prev-part-btn, #next-part-btn, .listening-part-nav-section .part-nav-info') : null;
        if (!el) return;
        global.setTimeout(function () {
          var currentPart = (global.App && global.App.state && Number(global.App.state.activePart)) || 1;
          if (state.activePart !== currentPart) {
            setActiveTranscriptPart(doc, ui, state, currentPart, { syncLeft: false });
          }
        }, 20);
      });
    }
  }

  /* ========================================================================
     Historical Practice Record Replay
     ======================================================================== */
  function formatReplayDate(rawTs) {
    if (!rawTs) return '';
    try {
      var d = new Date(rawTs);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (_) {
      return '';
    }
  }

  function formatReplayDuration(seconds) {
    var total = Number(seconds);
    if (!Number.isFinite(total) || total < 0) return '';
    var rounded = Math.round(total);
    var mins = Math.floor(rounded / 60);
    var secs = rounded % 60;
    if (mins <= 0) return secs + '秒';
    return mins + '分' + (secs > 0 ? (secs + '秒') : '');
  }

  function readReplayAnswer(answers, comparison, qNum) {
    var keys = ['q' + qNum, String(qNum), 'Q' + qNum];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (answers && Object.prototype.hasOwnProperty.call(answers, k) && answers[k] != null) {
        var val = answers[k];
        if (Array.isArray(val) ? val.length > 0 : String(val).trim() !== '') {
          return val;
        }
      }
    }
    for (var j = 0; j < keys.length; j++) {
      var ck = keys[j];
      var cmp = comparison && comparison[ck];
      if (cmp && cmp.userAnswer != null) {
        var raw = String(cmp.userAnswer).trim();
        if (raw && raw !== '未作答' && raw.toLowerCase() !== 'unanswered') {
          return cmp.userAnswer;
        }
      }
    }
    return '';
  }

  function collectPairReplayLetters(answers, comparison, pairKey, q1, q2) {
    var chosen = Object.create(null);
    var sources = [
      answers && answers[pairKey],
      answers && answers['q' + q1 + '-' + q2],
      answers && answers[q1 + '_' + q2],
      answers && answers[q1 + '-' + q2],
      answers && answers['q' + q1],
      answers && answers['q' + q2],
      answers && answers[String(q1)],
      answers && answers[String(q2)],
      comparison && comparison[pairKey] && comparison[pairKey].userAnswer,
      comparison && comparison['q' + q1 + '-' + q2] && comparison['q' + q1 + '-' + q2].userAnswer,
      comparison && comparison['q' + q1] && comparison['q' + q1].userAnswer,
      comparison && comparison['q' + q2] && comparison['q' + q2].userAnswer,
      comparison && comparison[String(q1)] && comparison[String(q1)].userAnswer,
      comparison && comparison[String(q2)] && comparison[String(q2)].userAnswer
    ];
    sources.forEach(function (raw) {
      if (raw == null) return;
      var tokens = Array.isArray(raw) ? raw : String(raw).split(/[\s,;/、]+/);
      tokens.forEach(function (tok) {
        var clean = String(tok || '').trim().toUpperCase();
        if (/^[A-Z]$/.test(clean)) {
          chosen[clean] = true;
        }
      });
    });
    return chosen;
  }

  function syncNativeAnswerUi(doc, config) {
    var ak = (config && config.answerKey) || {};
    var mult = ak.multiple || {};

    Array.prototype.slice.call(doc.querySelectorAll('.choice-option, .letter-pill')).forEach(function (label) {
      var inp = label.querySelector('input');
      if (inp) label.classList.toggle('selected', Boolean(inp.checked));
    });

    Array.prototype.slice.call(doc.querySelectorAll('.matching-group[data-allow-reuse="false"]')).forEach(function (group) {
      var used = Object.create(null);
      Array.prototype.slice.call(group.querySelectorAll('input[type="radio"]:checked')).forEach(function (r) {
        used[r.value] = true;
      });
      Array.prototype.slice.call(group.querySelectorAll('.option-box-row')).forEach(function (row) {
        row.classList.toggle('is-used', Boolean(used[row.dataset.optLetter]));
      });
    });

    Object.keys(mult).forEach(function (key) {
      var m = key.match(/^q(\d+)_(\d+)$/);
      if (!m) return;
      var count = doc.querySelectorAll('input[name="' + key + '"]:checked').length;
      var counter = doc.querySelector('[data-pair-counter="' + m[1] + ',' + m[2] + '"]');
      if (counter) counter.textContent = count + ' / 2 selected';
    });

    if (Array.isArray(config && config.questionList)) {
      var partCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
      var pairByQ = Object.create(null);
      Object.keys(mult).forEach(function (key) {
        var m = key.match(/^q(\d+)_(\d+)$/);
        if (!m) return;
        var q1 = Number(m[1]);
        var q2 = Number(m[2]);
        pairByQ[q1] = { key: key, q1: q1, q2: q2 };
        pairByQ[q2] = { key: key, q1: q1, q2: q2 };
      });
      config.questionList.forEach(function (qNum) {
        var pair = pairByQ[qNum];
        var answered = false;
        if (pair) {
          var cnt = doc.querySelectorAll('input[name="' + pair.key + '"]:checked').length;
          answered = qNum === pair.q1 ? cnt >= 1 : cnt >= 2;
        } else {
          var textEl = doc.querySelector('input[type="text"][name="q' + qNum + '"]');
          if (textEl) answered = textEl.value.trim().length > 0;
          else answered = Boolean(doc.querySelector('input[name="q' + qNum + '"]:checked'));
        }
        if (answered) partCounts[partOfQuestion(qNum)] += 1;
      });
      for (var p = 1; p <= 4; p++) {
        var countEl = doc.querySelector('[data-part-count="' + p + '"]');
        if (countEl) countEl.textContent = '(' + partCounts[p] + '/10)';
      }
    }
  }

  function lockHistoricalReplayControls(doc, locked) {
    doc.body.classList.toggle('lrs-historical-replay', Boolean(locked));
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="text"], #questionsPage textarea')).forEach(function (el) {
      el.readOnly = Boolean(locked);
    });
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="radio"], #questionsPage input[type="checkbox"], #questionsPage select')).forEach(function (el) {
      el.disabled = Boolean(locked);
    });
    var notesEl = doc.getElementById('notes-textarea');
    if (notesEl) {
      notesEl.readOnly = Boolean(locked);
    }
  }

  function applyReplayRecord(doc, ui, state, replayPayload) {
    if (!replayPayload || typeof replayPayload !== 'object') return false;
    var entry = (replayPayload.entry && typeof replayPayload.entry === 'object') ? replayPayload.entry : replayPayload;
    var sig = [
      replayPayload.reviewSessionId || '',
      replayPayload.recordId || '',
      Number.isInteger(replayPayload.reviewEntryIndex) ? replayPayload.reviewEntryIndex : 0,
      entry.examId || '',
      entry.endTime || entry.startTime || ''
    ].join('|');
    if (sig && state.lastReplaySignature === sig && state.isHistoricalReplay && state.isReviewing) {
      return true;
    }
    state.lastReplaySignature = sig;

    var config = global.CONFIG_DATA || (global.App && global.App.config) || {};
    var ak = config.answerKey || {};
    var answers = (entry.answers && typeof entry.answers === 'object') ? entry.answers : {};
    var comparison = (entry.answerComparison && typeof entry.answerComparison === 'object') ? entry.answerComparison : {};

    // Temporarily unlock & reset form controls before restoring saved answers
    lockHistoricalReplayControls(doc, false);
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="text"], #questionsPage textarea')).forEach(function (el) {
      el.value = '';
    });
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="radio"], #questionsPage input[type="checkbox"]')).forEach(function (el) {
      el.checked = false;
    });

    // 1. Restore fill-in-the-blank text inputs
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="text"][name]')).forEach(function (el) {
      var m = String(el.name || '').match(/^q(\d+)$/i);
      if (!m) return;
      var val = readReplayAnswer(answers, comparison, Number(m[1]));
      el.value = Array.isArray(val) ? val.join(', ') : String(val || '');
    });

    // 2. Restore single-choice & matching radios
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="radio"][name]')).forEach(function (el) {
      var m = String(el.name || '').match(/^q(\d+)$/i);
      if (!m) return;
      var val = String(readReplayAnswer(answers, comparison, Number(m[1])) || '').trim().toUpperCase();
      el.checked = Boolean(val) && String(el.value || '').trim().toUpperCase() === val;
    });

    // 3. Restore Choose-TWO multi-choice pair checkboxes
    var pairKeys = Object.create(null);
    Object.keys(ak.multiple || {}).forEach(function (k) { pairKeys[k] = true; });
    Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="checkbox"][name]')).forEach(function (cb) {
      if (/^q\d+_\d+$/i.test(cb.name)) pairKeys[cb.name] = true;
    });
    Object.keys(pairKeys).forEach(function (pairKey) {
      var m = pairKey.match(/^q(\d+)_(\d+)$/i);
      if (!m) return;
      var chosen = collectPairReplayLetters(answers, comparison, pairKey, Number(m[1]), Number(m[2]));
      Array.prototype.slice.call(doc.querySelectorAll('#questionsPage input[type="checkbox"][name="' + pairKey + '"]')).forEach(function (cb) {
        cb.checked = Boolean(chosen[String(cb.value || '').trim().toUpperCase()]);
      });
    });

    // 4. Restore scratchpad notes if saved
    var notesEl = doc.getElementById('notes-textarea');
    if (notesEl) {
      notesEl.value = typeof entry.noteText === 'string' ? entry.noteText : '';
      var notesBtn = doc.getElementById('toggle-notes-btn');
      if (notesBtn && notesEl.value.trim()) {
        notesBtn.dataset.hasSavedNotes = 'true';
        notesBtn.textContent = 'Notes •';
        notesBtn.title = '查看本次练习保存的笔记';
      }
    }

    syncNativeAnswerUi(doc, config);

    // 5. Mark historical replay metadata BEFORE calling finishTest() so renderReviewBar includes the replay banner
    state.isHistoricalReplay = true;
    state.replayMeta = {
      recordId: replayPayload.recordId ? String(replayPayload.recordId) : '',
      dateLabel: formatReplayDate(entry.endTime || entry.date || entry.startTime),
      durationLabel: formatReplayDuration(entry.duration)
    };

    // 6. Trigger native grading & Review Studio split-screen (PRACTICE_COMPLETE is suppressed by listeningRecordBridge in reviewMode)
    if (global.App && typeof global.App.finishTest === 'function') {
      global.App.finishTest();
    } else if (typeof global.finishTest === 'function') {
      global.finishTest();
    }

    // 7. Lock answers read-only (while keeping audio, transcript, search, font zoom, notes & navigation interactive)
    lockHistoricalReplayControls(doc, true);

    return true;
  }

  function openLightbox(ui, src, caption) {
    if (!ui.lightbox || !ui.lightboxImg || !src) return;
    ui.lightboxImg.src = src;
    if (ui.lightboxCaption) ui.lightboxCaption.textContent = caption || '原版扫描页';
    ui.lightbox.classList.add('open');
  }

  function wireLightbox(doc, ui) {
    if (!ui.lightbox) return;
    function close() { ui.lightbox.classList.remove('open'); }
    if (ui.lightboxClose) ui.lightboxClose.addEventListener('click', close);
    ui.lightbox.addEventListener('click', function (e) {
      if (e.target === ui.lightbox || e.target.id === 'lrs-lightbox-stage') close();
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ui.lightbox.classList.contains('open')) close();
    });
  }

  if (global.document && global.document.readyState === 'loading' && typeof global.document.addEventListener === 'function') {
    global.document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(typeof window !== 'undefined' ? window : globalThis);
