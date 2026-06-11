(function initUnifiedReadingPage(global) {
    'use strict';

    const MESSAGE_SOURCE = 'practice_page';
    const INIT_RETRY_MS = 1500;
    const SIMULATION_DRAFT_SYNC_MS = 1200;
    const EXPLANATION_STYLE_ID = 'reading-explanation-style';
    const MEMORIZE_STYLE_ID = 'reading-memorize-style';
    const PRACTICE_TIMER_BRIDGE_KEY = '__IELTS_PRACTICE_TIMER__';
    const PRACTICE_TIMER_EVENT = 'practiceTimerStateChange';
    const EXPLANATION_NODE_SELECTOR = [
        '.reading-explanation-card',
        '.reading-group-explanation',
        '.reading-question-explanation',
        '.reading-question-explanation-list'
    ].join(', ');
    const EXPLANATION_SPLIT_KINDS = new Set([
        'single_choice',
        'multi_choice',
        'true_false_not_given',
        'yes_no_not_given'
    ]);
    const navStatus = new Map();
    const scriptCache = new Map();
    const LOCATOR_HIGHLIGHT_SELECTOR = '.reading-locator-highlight, .reading-locator-block';
    function getAnswerMatchCore() {
        const core = global.AnswerMatchCore;
        if (!core || typeof core !== 'object') {
            return null;
        }
        return core;
    }

    function getAnswerSanitizer() {
        const sanitizer = global.AnswerSanitizer;
        if (!sanitizer || typeof sanitizer !== 'object') {
            return null;
        }
        return sanitizer;
    }

    function getReviewHighlightDictionary() {
        const dictionary = global.ReviewHighlightDictionary;
        if (!dictionary || typeof dictionary !== 'object') {
            return null;
        }
        return dictionary;
    }

    const state = {
        examId: null,
        dataKey: null,
        sessionId: null,
        suiteSessionId: null,
        reviewSessionId: null,
        reviewEntryIndex: 0,
        reviewMode: false,
        reviewViewMode: null,
        practiceMode: 'single',
        memorizeMode: false,
        readOnly: false,
        readOnlyReason: '',
        reviewContext: null,
        suiteReviewMode: false,
        pageStartTime: Date.now(),
        pagePausedAtMs: null,
        pagePausedOffsetMs: 0,
        simulationGlobalAnchorMs: null,
        suiteTimerAnchorMs: null,
        suiteTimerMode: null,
        endlessCountdownSeconds: 0,
        endlessCountdownEndTime: null,
        suiteTimerLimitSeconds: null,
        ready: false,
        submitted: false,
        initTimer: null,
        manifestLoaded: false,
        dataset: null,
        explanation: null,
        lastResults: null,
        simulationMode: false,
        simulationCtx: null,
        simulationContextReady: false,
        countdownExpiredAutoSubmit: false,
        suite: {
            inline: false,
            flowMode: '',
            sequence: [],
            activeExamId: null,
            currentIndex: 0,
            activeStartedAtMs: null,
            slotsByExamId: new Map(),
            activating: false
        },
        simulationDraftSyncTimer: null,
        simulationDraftFingerprint: '',
        lastInitSignature: '',
        lastReplaySignature: '',
        sessionReadySent: false,
        parentWindow: global.opener || global.parent || null
    };

    const dom = {
        title: null,
        subtitle: null,
        shell: null,
        left: null,
        right: null,
        divider: null,
        groups: null,
        results: null,
        nav: null,
        submitBtn: null,
        resetBtn: null,
        exitBtn: null
    };

    const interaction = {
        timerRunning: true,
        timerInterval: null,
        lastRange: null,
        currentHighlightNode: null,
        keepToolbar: false
    };

    function ensurePracticeTimerBridge() {
        if (global[PRACTICE_TIMER_BRIDGE_KEY] && typeof global[PRACTICE_TIMER_BRIDGE_KEY].getSnapshot === 'function') {
            return;
        }
        global[PRACTICE_TIMER_BRIDGE_KEY] = {
            eventName: PRACTICE_TIMER_EVENT,
            getSnapshot() {
                const nowMs = Date.now();
                const anchorMs = resolveTimerAnchorMs();
                const elapsedMs = resolveElapsedMs();
                const elapsedSeconds = Math.round(elapsedMs / 1000);
                const durationSeconds = Math.max(0, Math.round(elapsedSeconds));
                const effectiveStartTimeMs = Math.max(0, anchorMs);
                const effectiveEndTimeMs = Math.max(effectiveStartTimeMs, effectiveStartTimeMs + elapsedMs);
                return {
                    running: !Number.isFinite(state.pagePausedAtMs),
                    elapsedSeconds,
                    durationSeconds,
                    displaySeconds: Math.floor(elapsedSeconds),
                    effectiveStartTimeMs,
                    effectiveEndTimeMs,
                    anchorMs,
                    mode: state.suiteTimerMode || 'elapsed',
                    limitSeconds: state.suiteTimerLimitSeconds,
                    source: state.suiteSessionId ? 'suite' : 'local',
                    actualEndTimeMs: nowMs,
                    pausedAtMs: Number.isFinite(state.pagePausedAtMs) ? state.pagePausedAtMs : null,
                    pausedOffsetMs: Math.max(0, Number(state.pagePausedOffsetMs) || 0)
                };
            }
        };
    }

    function getPracticeTimerBridge() {
        ensurePracticeTimerBridge();
        return global[PRACTICE_TIMER_BRIDGE_KEY];
    }

    function getPracticeTimerSnapshot() {
        return getPracticeTimerBridge().getSnapshot();
    }

    function resolveTimerAnchorMs() {
        const suiteAnchorMs = Number(state.suiteTimerAnchorMs);
        if (state.suiteSessionId && Number.isFinite(suiteAnchorMs) && suiteAnchorMs > 0) {
            return Math.floor(suiteAnchorMs);
        }
        return Math.floor(Number(state.pageStartTime) || Date.now());
    }

    function resolveElapsedMs() {
        const referenceNow = Number.isFinite(state.pagePausedAtMs)
            ? state.pagePausedAtMs
            : Date.now();
        return Math.max(
            0,
            referenceNow - resolveTimerAnchorMs() - Math.max(0, Number(state.pagePausedOffsetMs) || 0)
        );
    }

    function getPageElapsedSeconds() {
        return Math.round(resolveElapsedMs() / 1000);
    }

    function syncPagePauseState(isRunning) {
        const running = isRunning !== false;
        const now = Date.now();
        if (!running) {
            if (!Number.isFinite(state.pagePausedAtMs)) {
                state.pagePausedAtMs = now;
            }
            return;
        }
        if (Number.isFinite(state.pagePausedAtMs)) {
            state.pagePausedOffsetMs += Math.max(0, now - state.pagePausedAtMs);
            state.pagePausedAtMs = null;
        }
    }

    function resolvePracticeTiming(minDurationSeconds = 0, timerSnapshot = null) {
        const snapshot = timerSnapshot && typeof timerSnapshot === 'object'
            ? timerSnapshot
            : getPracticeTimerSnapshot();
        const startTimeMs = Math.floor(Number(snapshot.effectiveStartTimeMs));
        const duration = Math.max(minDurationSeconds, Math.round(Number(snapshot.durationSeconds)));
        const actualEndTimeMsRaw = Number(snapshot.actualEndTimeMs);
        const endTimeMs = Number.isFinite(actualEndTimeMsRaw)
            ? Math.floor(actualEndTimeMsRaw)
            : Date.now();
        const effectiveEndTimeMs = Math.max(startTimeMs, startTimeMs + duration * 1000);
        return {
            duration,
            startTimeMs,
            endTimeMs,
            effectiveEndTimeMs
        };
    }

    var COUNTDOWN_WARN_10_MIN = 600;
    var COUNTDOWN_WARN_5_MIN = 300;

    function formatTimerSeconds(totalSeconds) {
        const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
        const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, '0');
        const seconds = String(safeSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function renderTimer() {
        const timer = document.getElementById('timer');
        if (!timer) return;
        var displaySeconds;
        var limitSeconds = Number.isFinite(Number(state.suiteTimerLimitSeconds)) ? Number(state.suiteTimerLimitSeconds) : 3600;
        if (state.endlessCountdownEndTime && Number.isFinite(state.endlessCountdownEndTime)) {
            var remainingMs = state.endlessCountdownEndTime - Date.now();
            displaySeconds = Math.max(0, Math.ceil(remainingMs / 1000));
            if (remainingMs <= 0) {
                state.endlessCountdownSeconds = 0;
                state.endlessCountdownEndTime = null;
                timer.classList.remove('endless-countdown');
            }
            var remainingMinutes = Math.max(0, Math.ceil(displaySeconds / 60));
            timer.textContent = remainingMinutes + ' minutes remaining';
        } else if (!state.suiteSessionId) {
            var elapsed = getPageElapsedSeconds();
            timer.textContent = formatTimerSeconds(elapsed);
        } else {
            var elapsed = getPageElapsedSeconds();
            displaySeconds = Math.max(0, limitSeconds - elapsed);
            var remainingMinutes = Math.max(0, Math.ceil(displaySeconds / 60));
            timer.textContent = remainingMinutes + ' minutes remaining';
        }
        var hasEndlessCountdown = state.endlessCountdownEndTime && Number.isFinite(state.endlessCountdownEndTime);
        timer.classList.toggle('paused', !interaction.timerRunning && !hasEndlessCountdown);
        timer.style.opacity = (interaction.timerRunning || hasEndlessCountdown) ? '1' : '0.5';
        var _warnRemaining = state.suiteTimerMode === 'countdown' && state.suiteTimerLimitSeconds !== null && state.suiteTimerLimitSeconds > 0
            ? Math.max(0, state.suiteTimerLimitSeconds - getPageElapsedSeconds())
            : null;
        if (_warnRemaining !== null) {
            timer.classList.remove('countdown-warn-10', 'countdown-warn-5', 'countdown-expired');
            if (_warnRemaining <= 0) {
                timer.classList.add('countdown-expired');
                if (!state.countdownExpiredAutoSubmit && !state.submitted) {
                    state.countdownExpiredAutoSubmit = true;
                    handleCountdownExpired();
                }
            } else if (_warnRemaining <= COUNTDOWN_WARN_5_MIN) {
                timer.classList.add('countdown-warn-5');
            } else if (_warnRemaining <= COUNTDOWN_WARN_10_MIN) {
                timer.classList.add('countdown-warn-10');
            }
        } else {
            timer.classList.remove('countdown-warn-10', 'countdown-warn-5', 'countdown-expired');
        }
    }

    function setTimerRunning(nextRunning) {
        interaction.timerRunning = !!nextRunning;
        syncPagePauseState(interaction.timerRunning);
        renderTimer();
        try {
            global.dispatchEvent(new CustomEvent(PRACTICE_TIMER_EVENT, {
                detail: getPracticeTimerSnapshot()
            }));
        } catch (_) {
            // ignore timer bridge event failures
        }
    }

    function handleCountdownExpired() {
        setTimerRunning(false);
        if (typeof handleSubmit === 'function' && !state.submitted) {
            handleSubmit().catch(function () {});
        }
    }

    function attachUnifiedTimer() {
        ensurePracticeTimerBridge();
        const timer = document.getElementById('timer');
        if (timer) {
            timer.addEventListener('click', () => setTimerRunning(!interaction.timerRunning));
        }
        if (!interaction.timerInterval) {
            interaction.timerInterval = global.setInterval(() => {
                if (interaction.timerRunning || (state.endlessCountdownEndTime && Number.isFinite(state.endlessCountdownEndTime))) {
                    renderTimer();
                }
            }, 250);
        }
        renderTimer();
    }

    function closeFloatingPanels() {
        const settingsPanel = document.getElementById('settings-panel');
        const notesPanel = document.getElementById('notes-panel');
        const overlay = document.querySelector('.overlay');
        if (settingsPanel) settingsPanel.style.display = 'none';
        if (notesPanel) notesPanel.style.display = 'none';
        if (overlay) overlay.style.display = 'none';
    }

    function attachUnifiedPanels() {
        const settingsPanel = document.getElementById('settings-panel');
        const notesPanel = document.getElementById('notes-panel');
        const overlay = document.querySelector('.overlay');
        const settingsBtn = document.getElementById('settings-btn');
        const noteBtn = document.getElementById('note-btn');
        const closeNoteBtn = document.getElementById('close-note');

        settingsBtn?.addEventListener('click', (event) => {
            event.stopPropagation();
            const nextVisible = settingsPanel?.style.display !== 'block';
            closeFloatingPanels();
            if (settingsPanel && nextVisible) {
                settingsPanel.style.display = 'block';
            }
        });
        noteBtn?.addEventListener('click', () => {
            closeFloatingPanels();
            if (notesPanel) notesPanel.style.display = 'flex';
            if (overlay) overlay.style.display = 'block';
        });
        closeNoteBtn?.addEventListener('click', closeFloatingPanels);
        overlay?.addEventListener('click', closeFloatingPanels);
        document.querySelectorAll('.settings-option[data-size]').forEach((button) => {
            button.addEventListener('click', () => {
                document.documentElement.className = `font-${button.dataset.size || 'normal'}`;
                document.querySelectorAll('.settings-option[data-size]').forEach((item) => item.classList.remove('active'));
                button.classList.add('active');
            });
        });
        document.querySelectorAll('.settings-option[data-mode]').forEach((button) => {
            button.addEventListener('click', () => {
                document.body.classList.toggle('dark-mode', button.dataset.mode === 'dark');
                document.querySelectorAll('.settings-option[data-mode]').forEach((item) => item.classList.remove('active'));
                button.classList.add('active');
            });
        });
    }

    function positionSelectionToolbar(rect) {
        const toolbar = document.getElementById('selbar');
        if (!toolbar) return;
        toolbar.style.display = 'flex';
        global.requestAnimationFrame(() => {
            const top = global.scrollY + rect.top - toolbar.offsetHeight - 8;
            const left = global.scrollX + rect.left + (rect.width / 2) - (toolbar.offsetWidth / 2);
            toolbar.style.top = `${top > 0 ? top : global.scrollY + rect.bottom + 8}px`;
            toolbar.style.left = `${Math.max(8, left)}px`;
        });
    }

    function updateSelectionToolbar() {
        const toolbar = document.getElementById('selbar');
        if (!toolbar) return;
        const selection = global.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            if (!interaction.keepToolbar && !interaction.currentHighlightNode) {
                toolbar.style.display = 'none';
                interaction.currentHighlightNode = null;
            }
            return;
        }
        const range = selection.getRangeAt(0);
        let container = range.commonAncestorContainer;
        if (container.nodeType === Node.TEXT_NODE) {
            container = container.parentElement;
        }
        const leftPane = dom.left;
        const rightPane = document.getElementById('right');
        const isInAllowedPane = (leftPane && leftPane.contains(container)) || (rightPane && rightPane.contains(container));
        
        let highlightNode = container instanceof HTMLElement
            ? (container.matches('.hl') ? container : container.closest('.hl'))
            : null;

        let hasHighlight = !!highlightNode;
        let finalHighlightNode = highlightNode;
        if (!hasHighlight && range) {
            const containerElement = container instanceof HTMLElement ? container : container.parentElement;
            if (containerElement) {
                const hls = containerElement.querySelectorAll('.hl');
                for (let i = 0; i < hls.length; i++) {
                    const hl = hls[i];
                    let intersects = false;
                    if (typeof range.intersectsNode === 'function') {
                        intersects = range.intersectsNode(hl);
                    } else if (selection && typeof selection.containsNode === 'function') {
                        intersects = selection.containsNode(hl, true);
                    }
                    if (intersects) {
                        hasHighlight = true;
                        finalHighlightNode = hl;
                        break;
                    }
                }
            }
        }

        if (!isInAllowedPane && !hasHighlight) {
            toolbar.style.display = 'none';
            return;
        }
        interaction.lastRange = range.cloneRange();
        interaction.currentHighlightNode = finalHighlightNode || null;

        const btnUH = document.getElementById('btnUH');
        if (btnUH) {
            btnUH.style.display = hasHighlight ? '' : 'none';
        }

        positionSelectionToolbar(range.getBoundingClientRect());
    }

    function applySelectionHighlight(kind = 'highlight') {
        const toolbar = document.getElementById('selbar');
        const selection = global.getSelection();
        if (!interaction.lastRange || interaction.lastRange.collapsed || interaction.currentHighlightNode) {
            return;
        }
        const span = document.createElement('span');
        span.className = 'hl';
        if (kind === 'note') {
            span.dataset.hlType = 'note';
        }
        try {
            interaction.lastRange.surroundContents(span);
        } catch (_) {
            return;
        }
        selection?.removeAllRanges();
        if (toolbar) toolbar.style.display = 'none';
        interaction.lastRange = null;
        interaction.currentHighlightNode = null;
        syncSimulationDraftSnapshot('highlight');
    }

    function removeSelectionHighlight() {
        const toolbar = document.getElementById('selbar');
        const selection = global.getSelection();
        let target = interaction.currentHighlightNode;
        if (!target && interaction.lastRange) {
            const ancestor = interaction.lastRange.commonAncestorContainer;
            target = ancestor.nodeType === Node.TEXT_NODE
                ? ancestor.parentElement?.closest('.hl')
                : ancestor.closest?.('.hl');
        }
        if (target && target.parentNode) {
            const parent = target.parentNode;
            while (target.firstChild) {
                parent.insertBefore(target.firstChild, target);
            }
            parent.removeChild(target);
            parent.normalize();
        }
        selection?.removeAllRanges();
        if (toolbar) toolbar.style.display = 'none';
        interaction.lastRange = null;
        interaction.currentHighlightNode = null;
        syncSimulationDraftSnapshot('unhighlight');
    }

    function attachSelectionHighlightToolbar() {
        const toolbar = document.getElementById('selbar');
        if (!toolbar) return;
        document.addEventListener('selectionchange', () => {
            global.setTimeout(updateSelectionToolbar, 10);
        });
        toolbar.addEventListener('mousedown', () => {
            interaction.keepToolbar = true;
        });
        toolbar.addEventListener('mouseup', () => {
            interaction.keepToolbar = false;
        });
        document.getElementById('btnHL')?.addEventListener('click', () => applySelectionHighlight('highlight'));
        document.getElementById('btnNote')?.addEventListener('click', () => {
            let targetNode = interaction.currentHighlightNode;
            let text = '';

            if (targetNode) {
                if (targetNode.dataset.hlType !== 'note') {
                    targetNode.dataset.hlType = 'note';
                    syncSimulationDraftSnapshot('highlight');
                }
                text = (targetNode.textContent || '').trim();
            } else if (interaction.lastRange && !interaction.lastRange.collapsed) {
                const span = document.createElement('span');
                span.className = 'hl';
                span.dataset.hlType = 'note';
                try {
                    interaction.lastRange.surroundContents(span);
                    targetNode = span;
                    text = (span.textContent || '').trim();
                    const selection = global.getSelection();
                    selection?.removeAllRanges();
                    syncSimulationDraftSnapshot('highlight');
                } catch (_) {
                    // Ignore
                }
            }

            const toolbar = document.getElementById('selbar');
            if (toolbar) toolbar.style.display = 'none';
            interaction.lastRange = null;
            interaction.currentHighlightNode = null;

            if (text) {
                const noteArea = document.querySelector('#notes-panel textarea');
                if (noteArea) {
                    noteArea.value += (noteArea.value ? '\n\n' : '') + '> ' + text + '\n';
                    noteArea.scrollTop = noteArea.scrollHeight;
                    noteArea.focus();
                }
                closeFloatingPanels();
                const notesPanel = document.getElementById('notes-panel');
                const overlay = document.querySelector('.overlay');
                if (notesPanel) notesPanel.style.display = 'flex';
                if (overlay) overlay.style.display = 'block';
            }
        });
        document.getElementById('btnUH')?.addEventListener('click', removeSelectionHighlight);
    }

    function isReviewDictionaryEnabled() {
        return Boolean(state.readOnly || state.reviewMode || state.submitted);
    }

    function getReviewDictionaryContext() {
        return {
            examId: state.examId,
            dataKey: state.dataKey,
            title: state.dataset?.meta?.title || '',
            category: state.dataset?.meta?.category || '',
            frequency: state.dataset?.meta?.frequency || '',
            suiteSessionId: state.suiteSessionId || null,
            reviewSessionId: state.reviewSessionId || null,
            reviewMode: state.reviewMode,
            submitted: state.submitted
        };
    }

    function enhanceReviewHighlights() {
        const dictionary = getReviewHighlightDictionary();
        if (!dictionary || typeof dictionary.enhance !== 'function') {
            return;
        }
        dictionary.enhance({
            roots: {
                left: dom.left,
                groups: dom.groups
            },
            isEnabled: isReviewDictionaryEnabled,
            getContext: getReviewDictionaryContext,
            postMessage
        });
    }

    function attachReviewHighlightDictionary() {
        const dictionary = getReviewHighlightDictionary();
        if (!dictionary || typeof dictionary.attach !== 'function') {
            return;
        }
        dictionary.attach({
            roots: {
                left: dom.left,
                groups: dom.groups
            },
            isEnabled: isReviewDictionaryEnabled,
            getContext: getReviewDictionaryContext,
            postMessage
        });
    }

    function closeReviewHighlightDictionary() {
        const dictionary = getReviewHighlightDictionary();
        if (dictionary && typeof dictionary.close === 'function') {
            dictionary.close();
        }
    }

    function decodeParam(value) {
        if (!value) return '';
        try {
            return decodeURIComponent(value.replace(/\+/g, ' '));
        } catch (_) {
            return value;
        }
    }

    function normalizePracticeMode(value) {
        return String(value || '').trim().toLowerCase();
    }

    function applyPracticeMode(value) {
        const mode = normalizePracticeMode(value);
        const wasMemorizeMode = state.memorizeMode;
        state.practiceMode = mode || 'single';
        state.memorizeMode = mode === 'memorize';
        if (wasMemorizeMode && !state.memorizeMode) {
            clearMemorizeAnswerKeys();
            clearMemorizeLocatorHighlights();
            clearExplanations();
        }
        syncPracticeModeDom();
    }

    function syncPracticeModeDom() {
        if (!document.body) {
            return;
        }
        const practiceMode = state.memorizeMode ? 'memorize' : (state.practiceMode || 'single');
        document.body.dataset.practiceMode = practiceMode;
        document.body.classList.toggle('reading-memorize-mode', state.memorizeMode);
    }

    function renderReadingSubtitle() {
        if (!dom.subtitle) {
            return;
        }
        const questionCount = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder.length : 0;
        const parts = ['统一阅读页'];
        if (state.memorizeMode) {
            parts.push('背题模式');
        }
        if (state.dataset?.meta?.category) {
            parts.push(state.dataset.meta.category);
        }
        if (questionCount) {
            parts.push(`${questionCount} 题`);
        }
        dom.subtitle.textContent = parts.join(' · ');
    }

    function parseQuery() {
        const params = new URLSearchParams(global.location.search);
        state.examId = decodeParam(params.get('examId')) || null;
        state.dataKey = decodeParam(params.get('dataKey')) || state.examId;
        applyPracticeMode(params.get('practiceMode') || params.get('mode') || '');
        const suiteSessionId = decodeParam(params.get('suiteSessionId')) || null;
        if (suiteSessionId) {
            state.suiteSessionId = suiteSessionId;
        }
        const suiteTimerAnchorMs = Number(params.get('suiteTimerAnchorMs') || params.get('globalTimerAnchorMs'));
        if (Number.isFinite(suiteTimerAnchorMs) && suiteTimerAnchorMs > 0) {
            state.suiteTimerAnchorMs = Math.floor(suiteTimerAnchorMs);
            state.simulationGlobalAnchorMs = Math.floor(suiteTimerAnchorMs);
        }
        const suiteTimerMode = decodeParam(params.get('suiteTimerMode')).trim().toLowerCase();
        if (suiteTimerMode === 'countdown' || suiteTimerMode === 'elapsed') {
            state.suiteTimerMode = suiteTimerMode;
        }
        const rawSuiteTimerLimit = params.get('suiteTimerLimitSeconds');
        if (rawSuiteTimerLimit !== null && rawSuiteTimerLimit !== '') {
            const suiteTimerLimitSeconds = Number(rawSuiteTimerLimit);
            if (Number.isFinite(suiteTimerLimitSeconds) && suiteTimerLimitSeconds >= 0) {
                state.suiteTimerLimitSeconds = Math.floor(suiteTimerLimitSeconds);
            }
        }
        const queryFlowMode = decodeParam(params.get('suiteFlowMode')).trim().toLowerCase();
        if (queryFlowMode === 'simulation') {
            const rawIndex = Number(params.get('suiteSequenceIndex'));
            const rawTotal = Number(params.get('suiteSequenceTotal'));
            const currentIndex = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : 0;
            const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 3;
            const isLast = currentIndex >= total - 1;
            state.simulationMode = true;
            state.simulationCtx = {
                currentIndex,
                total,
                isLast,
                canPrev: currentIndex > 0,
                canNext: !isLast,
                flowMode: 'simulation'
            };
        }
    }

    function captureDom() {
        dom.title = document.getElementById('exam-title');
        dom.subtitle = document.getElementById('exam-subtitle');
        dom.shell = document.querySelector('.shell');
        dom.left = document.getElementById('left');
        dom.right = document.getElementById('right');
        dom.divider = document.getElementById('divider');
        dom.groups = document.getElementById('question-groups');
        dom.results = document.getElementById('results');
        dom.nav = document.getElementById('question-nav');
        dom.submitBtn = document.getElementById('submit-btn');
        dom.resetBtn = document.getElementById('reset-btn');
        dom.exitBtn = document.getElementById('exit-btn');
    }

    function loadScript(url) {
        if (!url) {
            return Promise.reject(new Error('reading_exam_script_missing'));
        }
        if (scriptCache.has(url)) {
            return scriptCache.get(url);
        }
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.defer = true;
            script.onload = () => resolve(true);
            script.onerror = () => reject(new Error(`reading_exam_script_failed:${url}`));
            document.head.appendChild(script);
        });
        scriptCache.set(url, promise);
        return promise;
    }

    async function ensureManifest() {
        if (global.__READING_EXAM_MANIFEST__) {
            return global.__READING_EXAM_MANIFEST__;
        }
        await loadScript('./manifest.js');
        return global.__READING_EXAM_MANIFEST__ || {};
    }

    async function ensureDataset() {
        const manifest = await ensureManifest();
        const entry = manifest[state.dataKey] || manifest[state.examId];
        const registry = global.__READING_EXAM_DATA__;
        if (!entry) {
            throw new Error(`reading_exam_manifest_entry_missing:${state.examId}`);
        }
        if (!registry || typeof registry.get !== 'function') {
            throw new Error('reading_exam_registry_missing');
        }
        if (!registry.has(entry.dataKey)) {
            await loadScript(entry.script);
        }
        const dataset = registry.get(entry.dataKey);
        if (!dataset) {
            throw new Error(`reading_exam_dataset_missing:${entry.dataKey}`);
        }
        state.dataset = dataset;
        state.dataKey = entry.dataKey;
        return dataset;
    }

    function normalizeSuiteSequence(rawSequence = []) {
        const seen = new Set();
        return (Array.isArray(rawSequence) ? rawSequence : [])
            .map((entry, index) => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }
                const examId = entry.examId != null ? String(entry.examId).trim() : '';
                if (!examId || seen.has(examId)) {
                    return null;
                }
                seen.add(examId);
                const dataKey = entry.dataKey != null && String(entry.dataKey).trim()
                    ? String(entry.dataKey).trim()
                    : examId;
                return {
                    examId,
                    dataKey,
                    title: entry.title != null ? String(entry.title) : '',
                    category: entry.category != null ? String(entry.category) : '',
                    index
                };
            })
            .filter(Boolean);
    }

    async function loadDatasetByEntry(sequenceEntry) {
        const manifest = await ensureManifest();
        const lookupKey = sequenceEntry?.dataKey || sequenceEntry?.examId;
        const entry = manifest[lookupKey] || manifest[sequenceEntry?.examId];
        const registry = global.__READING_EXAM_DATA__;
        if (!entry) {
            throw new Error(`reading_exam_manifest_entry_missing:${sequenceEntry?.examId || lookupKey}`);
        }
        if (!registry || typeof registry.get !== 'function') {
            throw new Error('reading_exam_registry_missing');
        }
        if (!registry.has(entry.dataKey)) {
            await loadScript(entry.script);
        }
        const dataset = registry.get(entry.dataKey);
        if (!dataset) {
            throw new Error(`reading_exam_dataset_missing:${entry.dataKey}`);
        }
        return {
            dataset,
            dataKey: entry.dataKey,
            manifestEntry: entry
        };
    }

    function getSuiteSlot(examId = state.examId) {
        const key = examId != null ? String(examId).trim() : '';
        if (!key || !state.suite || !(state.suite.slotsByExamId instanceof Map)) {
            return null;
        }
        return state.suite.slotsByExamId.get(key) || null;
    }

    function getActiveSuiteSlot() {
        return getSuiteSlot(state.suite?.activeExamId || state.examId);
    }

    function getNotesText() {
        const noteArea = document.querySelector('#notes-panel textarea');
        return noteArea ? String(noteArea.value || '') : '';
    }

    function setNotesText(value) {
        const noteArea = document.querySelector('#notes-panel textarea');
        if (noteArea) {
            noteArea.value = String(value || '');
        }
    }

    function buildEmptyDraft() {
        return {
            answers: {},
            highlights: [],
            noteText: '',
            scrollY: 0,
            updatedAt: Date.now()
        };
    }

    function mergeDraft(baseDraft, nextDraft) {
        const base = baseDraft && typeof baseDraft === 'object' ? baseDraft : {};
        const next = nextDraft && typeof nextDraft === 'object' ? nextDraft : {};
        return Object.assign(buildEmptyDraft(), base, next, {
            answers: next.answers && typeof next.answers === 'object'
                ? { ...next.answers }
                : (base.answers && typeof base.answers === 'object' ? { ...base.answers } : {}),
            highlights: Array.isArray(next.highlights)
                ? next.highlights.slice()
                : (Array.isArray(base.highlights) ? base.highlights.slice() : []),
            noteText: typeof next.noteText === 'string'
                ? next.noteText
                : (typeof base.noteText === 'string' ? base.noteText : ''),
            scrollY: Number.isFinite(Number(next.scrollY))
                ? Number(next.scrollY)
                : (Number.isFinite(Number(base.scrollY)) ? Number(base.scrollY) : 0),
            updatedAt: Number.isFinite(Number(next.updatedAt))
                ? Number(next.updatedAt)
                : (Number.isFinite(Number(base.updatedAt)) ? Number(base.updatedAt) : Date.now())
        });
    }

    function mergeSuiteDraftPayload(data = {}) {
        if (!state.suite?.inline) {
            return;
        }
        const draftsByExam = data && data.draftsByExam && typeof data.draftsByExam === 'object'
            ? data.draftsByExam
            : null;
        if (draftsByExam) {
            Object.entries(draftsByExam).forEach(([examId, draft]) => {
                const slot = getSuiteSlot(examId);
                if (slot && draft && typeof draft === 'object') {
                    slot.draft = mergeDraft(slot.draft, draft);
                }
            });
        }

        const contextExamId = data && data.examId != null ? String(data.examId).trim() : '';
        const draft = data && data.draft && typeof data.draft === 'object'
            ? data.draft
            : null;
        if (contextExamId && draft) {
            const slot = getSuiteSlot(contextExamId);
            if (slot) {
                slot.draft = mergeDraft(slot.draft, draft);
            }
        }
    }

    function resolveSuiteTargetExamId(data = {}, options = {}) {
        if (options.preferExistingActive) {
            const activeExamId = state.suite?.activeExamId ? String(state.suite.activeExamId).trim() : '';
            if (activeExamId && getSuiteSlot(activeExamId)) {
                return activeExamId;
            }
        }
        const contextExamId = data && data.examId != null ? String(data.examId).trim() : '';
        if (contextExamId && getSuiteSlot(contextExamId)) {
            return contextExamId;
        }
        const rawIndex = Number((data && data.currentIndex) ?? (data && data.suiteSequenceIndex));
        const index = Number.isFinite(rawIndex) ? Math.max(0, Math.floor(rawIndex)) : 0;
        const indexedEntry = state.suite.sequence[index];
        if (indexedEntry && indexedEntry.examId && getSuiteSlot(indexedEntry.examId)) {
            return indexedEntry.examId;
        }
        return state.suite.sequence[0]?.examId || state.examId || '';
    }

    function updateActiveSlotFromCurrentDom(reason = 'snapshot') {
        if (!state.suite?.inline || state.suite.activating) {
            return null;
        }
        const slot = getActiveSuiteSlot();
        if (!slot || !state.dataset) {
            return null;
        }
        const draft = mergeDraft(slot.draft, {
            answers: collectAnswers(),
            highlights: collectHighlights(),
            noteText: getNotesText(),
            scrollY: global.scrollY || 0,
            updatedAt: Date.now()
        });
        slot.draft = draft;
        slot.navStatus = new Map(navStatus);
        slot.lastResults = state.lastResults || slot.lastResults || null;
        if (Number.isFinite(Number(state.suite.activeStartedAtMs)) && state.suite.activeStartedAtMs > 0) {
            const elapsedSeconds = Math.max(0, Math.round((Date.now() - state.suite.activeStartedAtMs) / 1000));
            if (elapsedSeconds > 0) {
                slot.durationSeconds = Math.max(0, Number(slot.durationSeconds) || 0) + elapsedSeconds;
                state.suite.activeStartedAtMs = Date.now();
            }
        }
        state.simulationDraftFingerprint = reason === 'activate'
            ? state.simulationDraftFingerprint
            : buildDraftFingerprint(draft);
        return draft;
    }

    function getSuiteSequenceIndex(examId) {
        const key = examId != null ? String(examId).trim() : '';
        return state.suite.sequence.findIndex((entry) => entry && entry.examId === key);
    }

    function syncSimulationCtxForActiveSlot() {
        if (!state.suite?.inline) {
            return;
        }
        const index = getSuiteSequenceIndex(state.suite.activeExamId);
        const total = state.suite.sequence.length || 1;
        const currentIndex = index >= 0 ? index : 0;
        state.suite.currentIndex = currentIndex;
        state.simulationCtx = Object.assign({}, state.simulationCtx || {}, {
            suiteSessionId: state.suiteSessionId || state.simulationCtx?.suiteSessionId || null,
            flowMode: 'simulation',
            examId: state.suite.activeExamId,
            suiteSequence: state.suite.sequence.map((entry) => ({ ...entry })),
            currentIndex,
            total,
            isLast: currentIndex >= total - 1,
            canPrev: currentIndex > 0,
            canNext: currentIndex < total - 1
        });
    }

    async function ensureSuiteDatasets(rawSequence = []) {
        const sequence = normalizeSuiteSequence(rawSequence);
        if (!sequence.length) {
            return false;
        }
        state.suite.inline = true;
        state.suite.flowMode = 'simulation';
        state.suite.sequence = sequence;
        await Promise.all(sequence.map(async (entry) => {
            const loaded = await loadDatasetByEntry(entry);
            const existing = getSuiteSlot(entry.examId);
            const inheritedDraft = state.simulationCtx?.draft
                && state.simulationCtx.examId === entry.examId
                ? state.simulationCtx.draft
                : null;
            state.suite.slotsByExamId.set(entry.examId, Object.assign({}, existing || {}, {
                examId: entry.examId,
                dataKey: loaded.dataKey,
                title: entry.title || loaded.dataset?.meta?.title || loaded.manifestEntry?.title || entry.examId,
                category: entry.category || loaded.dataset?.meta?.category || loaded.manifestEntry?.category || '',
                dataset: loaded.dataset,
                draft: mergeDraft(existing?.draft, inheritedDraft),
                navStatus: existing?.navStatus instanceof Map ? existing.navStatus : new Map(),
                lastResults: existing?.lastResults || null,
                durationSeconds: Number.isFinite(Number(existing?.durationSeconds)) ? Number(existing.durationSeconds) : 0
            }));
        }));
        return true;
    }

    function initDragPools() {
        document.querySelectorAll('.pool-items').forEach((pool, index) => {
            if (!pool.id) {
                pool.id = `practice-pool-${index}`;
            }
        });
        document.querySelectorAll('.pool-items .drag-item').forEach((item) => {
            if (!item.dataset.originPool) {
                const pool = item.closest('.pool-items');
                if (pool?.id) {
                    item.dataset.originPool = pool.id;
                }
            }
        });
    }

    function refreshDynamicQuestionEnhancements() {
        getDropzones().forEach((dropzone, index) => {
            if (!dropzone.dataset.dropzoneId) {
                dropzone.dataset.dropzoneId = `dropzone-${index + 1}`;
            }
            ensureDropzoneHolder(dropzone);
            updateDropzoneState(dropzone);
        });
        document.querySelectorAll('.drag-item, .draggable-word, .card').forEach((item) => {
            if (item instanceof HTMLElement) {
                attachDraggableBehavior(item);
            }
        });
        initDragPools();
    }

    async function activateSuiteSlot(examId, options = {}) {
        if (!state.suite?.inline) {
            return false;
        }
        const targetExamId = examId != null ? String(examId).trim() : '';
        const slot = getSuiteSlot(targetExamId);
        if (!slot || !slot.dataset) {
            return false;
        }
        if (!options.skipSave) {
            updateActiveSlotFromCurrentDom('deactivate');
        }
        state.suite.activating = true;
        state.suite.activeExamId = targetExamId;
        state.suite.activeStartedAtMs = Date.now();
        state.examId = targetExamId;
        state.dataKey = slot.dataKey || targetExamId;
        state.dataset = slot.dataset;
        state.lastResults = slot.lastResults || null;
        navStatus.clear();
        if (slot.navStatus instanceof Map) {
            slot.navStatus.forEach((value, key) => navStatus.set(key, value));
        }
        renderDataset(slot.dataset);
        refreshDynamicQuestionEnhancements();
        clearCurrentAnswers();
        applyDraftToDom(slot.draft || buildEmptyDraft());
        setNotesText(slot.draft?.noteText || '');
        syncSimulationCtxForActiveSlot();
        state.simulationMode = true;
        state.simulationContextReady = true;
        updateNavStatuses(slot.lastResults || null);
        syncPrimaryActionButtons();
        state.suite.activating = false;
        if (Number.isFinite(Number(slot.draft?.scrollY))) {
            global.scrollTo(0, Number(slot.draft.scrollY) || 0);
        }
        if (!options.skipDraftSync) {
            syncSimulationDraftSnapshot('activate');
        }
        if (!options.silent) {
            postMessage('SIMULATION_ACTIVE_EXAM_CHANGE', {
                examId: targetExamId,
                currentIndex: state.suite.currentIndex,
                suiteSequence: state.suite.sequence.map((entry) => ({ ...entry }))
            });
        }
        return true;
    }

    async function ensureExplanationManifest() {
        if (global.__READING_EXPLANATION_MANIFEST__) {
            return global.__READING_EXPLANATION_MANIFEST__;
        }
        await loadScript('../reading-explanations/manifest.js');
        return global.__READING_EXPLANATION_MANIFEST__ || {};
    }

    async function ensureExplanationDataset() {
        const registry = global.__READING_EXPLANATION_DATA__;
        if (!registry || typeof registry.get !== 'function') {
            return null;
        }
        let manifest = {};
        try {
            manifest = await ensureExplanationManifest();
        } catch (_) {
            return null;
        }
        const entry = manifest[state.dataKey] || manifest[state.examId];
        if (!entry || !entry.dataKey || !entry.script) {
            return null;
        }
        if (!registry.has(entry.dataKey)) {
            try {
                await loadScript(entry.script);
            } catch (_) {
                return null;
            }
        }
        const payload = registry.get(entry.dataKey);
        state.explanation = payload || null;
        return state.explanation;
    }

    function ensureExplanationStyles() {
        if (document.getElementById(EXPLANATION_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = EXPLANATION_STYLE_ID;
        style.textContent = `
            .reading-explanation-card {
                margin: 10px 0 14px;
                padding: 10px 12px;
                border: 1px solid rgba(37, 99, 235, 0.22);
                border-left: 4px solid rgba(37, 99, 235, 0.9);
                border-radius: 8px;
                background: rgba(239, 246, 255, 0.75);
            }
            .reading-explanation-card__label {
                font-size: 12px;
                line-height: 1.3;
                margin-bottom: 6px;
                font-weight: 700;
                color: #1d4ed8;
            }
            .reading-explanation-card__text {
                font-size: 14px;
                line-height: 1.6;
                color: #1f2937;
                white-space: pre-wrap;
            }
            .reading-group-explanation {
                margin-top: 10px;
            }
            .reading-question-explanation {
                margin-top: 8px;
            }
            .reading-question-explanation-list {
                margin-top: 10px;
                padding: 10px 12px;
                border: 1px dashed rgba(59, 130, 246, 0.45);
                border-radius: 8px;
                background: rgba(239, 246, 255, 0.45);
            }
            .reading-question-explanation-list h5 {
                margin: 0 0 8px;
                font-size: 13px;
                color: #1e3a8a;
            }
            .reading-question-explanation-list .reading-question-explanation-item + .reading-question-explanation-item {
                margin-top: 8px;
            }
        `;
        document.head.appendChild(style);
    }

    function ensureMemorizeStyles() {
        if (document.getElementById(MEMORIZE_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = MEMORIZE_STYLE_ID;
        style.textContent = `
            .reading-answer-key-card {
                margin: 8px 0 10px;
                padding: 9px 11px;
                border: 1px solid rgba(22, 163, 74, 0.24);
                border-left: 4px solid rgba(22, 163, 74, 0.9);
                border-radius: 8px;
                background: rgba(240, 253, 244, 0.82);
            }
            .reading-answer-key-card__label {
                font-size: 12px;
                line-height: 1.35;
                margin-bottom: 4px;
                font-weight: 700;
                color: #166534;
            }
            .reading-answer-key-card__value {
                font-size: 14px;
                line-height: 1.55;
                color: #14532d;
                white-space: pre-wrap;
            }
            .reading-locator-highlight {
                border-radius: 3px;
                background: rgba(250, 204, 21, 0.42);
                box-shadow: 0 0 0 1px rgba(202, 138, 4, 0.18);
                cursor: pointer;
            }
            .reading-locator-highlight:hover {
                background: rgba(250, 204, 21, 0.62);
            }
        `;
        document.head.appendChild(style);
    }

    function clearExplanations() {
        document.querySelectorAll(EXPLANATION_NODE_SELECTOR).forEach((node) => node.remove());
    }

    function clearMemorizeAnswerKeys() {
        document.querySelectorAll('.reading-answer-key-row, .reading-answer-key-card').forEach((node) => node.remove());
    }

    function clearMemorizeLocatorHighlights() {
        const shared = getHighlightShared();
        if (!shared || typeof shared.unwrapMatchingHighlights !== 'function') {
            return;
        }
        shared.unwrapMatchingHighlights(dom.left, LOCATOR_HIGHLIGHT_SELECTOR);
    }

    function getHighlightShared() {
        return global.__READING_HIGHLIGHT_SHARED__ || null;
    }

    function parseQuestionNumber(value) {
        const match = String(value || '').match(/\d+/);
        return match ? Number(match[0]) : null;
    }

    function questionNumberFromId(questionId) {
        const label = displayLabel(questionId);
        const parsed = parseQuestionNumber(label);
        if (parsed != null) {
            return parsed;
        }
        return parseQuestionNumber(questionId);
    }

    function sectionOverlap(section, numbers = []) {
        const range = section?.questionRange;
        if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
            return 0;
        }
        return numbers.filter((value) => Number.isFinite(value) && value >= range.start && value <= range.end).length;
    }

    function pickSectionForGroup(questionNumbers = [], preferMode = null) {
        const sections = Array.isArray(state.explanation?.questionExplanations) ? state.explanation.questionExplanations : [];
        const filtered = preferMode ? sections.filter((item) => item?.mode === preferMode) : sections;
        if (!filtered.length) {
            return null;
        }
        let best = null;
        let bestScore = -1;
        filtered.forEach((section) => {
            const score = sectionOverlap(section, questionNumbers);
            if (score > bestScore) {
                best = section;
                bestScore = score;
            }
        });
        if (best && bestScore > 0) {
            return best;
        }
        return null;
    }

    function createExplanationCard(label, text, className = '') {
        const card = document.createElement('div');
        card.className = `reading-explanation-card ${className}`.trim();
        if (label) {
            const header = document.createElement('div');
            header.className = 'reading-explanation-card__label';
            header.textContent = label;
            card.appendChild(header);
        }
        const body = document.createElement('div');
        body.className = 'reading-explanation-card__text';
        body.textContent = String(text || '').trim();
        card.appendChild(body);
        return card;
    }

    function createGroupMarkup(group) {
        const questionIds = Array.isArray(group.questionIds) ? group.questionIds.join(',') : '';
        const allowOptionReuseFlag = resolveAllowOptionReuse(group);
        const allowOptionReuse = typeof allowOptionReuseFlag === 'boolean'
            ? ` data-allow-option-reuse="${allowOptionReuseFlag ? 'true' : 'false'}"`
            : '';
        return `
            <section class="unified-group" data-group-id="${group.groupId}" data-question-ids="${questionIds}"${allowOptionReuse}>
                ${group.bodyHtml || ''}
            </section>
        `;
    }

    function renderDataset(dataset) {
        clearExplanations();
        const passageHtml = (dataset.passage?.blocks || [])
            .map((block) => block?.bodyHtml || block?.html || '')
            .join('\n');
        const groupsHtml = (dataset.questionGroups || [])
            .map((group) => createGroupMarkup(group))
            .join('\n');
        const questionCount = Array.isArray(dataset.questionOrder) ? dataset.questionOrder.length : 0;

        document.title = dataset.meta?.title || 'IELTS 阅读练习';
        if (dom.title) {
            dom.title.textContent = dataset.meta?.title || 'IELTS 阅读练习';
        }
        if (dom.subtitle) {
            renderReadingSubtitle();
        }
        if (dom.left) {
            dom.left.innerHTML = passageHtml;
        }
        if (dom.groups) {
            dom.groups.innerHTML = groupsHtml;
        }
        applyNbHints();
        if (dom.results) {
            dom.results.style.display = 'none';
            dom.results.innerHTML = '';
        }
        updateRedesignedSubHeader();
    }

    function resolveAllowOptionReuse(group) {
        if (!group || typeof group !== 'object') {
            return false;
        }
        if (typeof group.allowOptionReuse === 'boolean') {
            return group.allowOptionReuse;
        }
        const html = String(group.bodyHtml || '').toLowerCase();
        if (!html) {
            return false;
        }
        if (html.includes('data-clone="true"') || html.includes("data-clone='true'")) {
            return true;
        }
        if (/(nb[^a-z0-9]*you may use|可重复使用|可重复选|可多次使用)/i.test(html)) {
            return true;
        }
        return false;
    }

    function applyNbHints() {
        if (!dom.groups) return;
        const groups = Array.from(dom.groups.querySelectorAll('.unified-group'));
        groups.forEach((groupEl) => {
            if (groupEl.dataset.allowOptionReuse !== 'true') {
                return;
            }
            if (groupEl.querySelector('.nb-hint')) {
                return;
            }
            const text = (groupEl.textContent || '').toUpperCase();
            if (/\bNB\b/.test(text)) {
                return;
            }
            const hint = document.createElement('p');
            hint.className = 'nb-hint';
            hint.textContent = 'NB: 该题型允许同一选项重复使用。';
            const anchor = groupEl.querySelector('h4, h3, p');
            if (anchor && anchor.parentElement === groupEl) {
                anchor.insertAdjacentElement('afterend', hint);
            } else {
                groupEl.insertAdjacentElement('afterbegin', hint);
            }
        });
    }

    function displayLabel(questionId) {
        const map = state.dataset?.questionDisplayMap || {};
        if (map[questionId]) {
            return map[questionId];
        }
        return String(questionId).replace(/^q/i, '');
    }

    function getQuestionRangeText() {
        const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
        if (!order.length) return '';
        const labels = order.map(qId => parseInt(displayLabel(qId))).filter(num => !isNaN(num));
        if (!labels.length) return '';
        const min = Math.min(...labels);
        const max = Math.max(...labels);
        return `${min}-${max}`;
    }

    function updateRedesignedSubHeader() {
        const partEl = document.getElementById('sub-header-part');
        const instEl = document.getElementById('sub-header-instruction');
        if (partEl && instEl) {
            const category = (state.dataset?.meta?.category || '').toUpperCase();
            let partName = 'Part 1';
            if (category === 'P2') partName = 'Part 2';
            else if (category === 'P3') partName = 'Part 3';
            partEl.textContent = partName;
            
            const range = getQuestionRangeText();
            instEl.textContent = range ? `Read the text and answer questions ${range}.` : '';
        }
    }

    function getPassageQuestionStates() {
        if (state.suite?.inline && state.suite.sequence.length) {
            const info = {
                p1: { questions: [], answeredCount: 0, total: 13 },
                p2: { questions: [], answeredCount: 0, total: 13 },
                p3: { questions: [], answeredCount: 0, total: 14 }
            };
            const activeExamId = state.suite.activeExamId || state.examId;
            let currentPart = 'p1';
            state.suite.sequence.forEach((entry, index) => {
                const slot = getSuiteSlot(entry.examId);
                const dataset = slot?.dataset;
                const category = String(entry.category || dataset?.meta?.category || '').toUpperCase();
                const partKey = category === 'P2' ? 'p2' : (category === 'P3' ? 'p3' : `p${Math.min(3, index + 1)}`);
                if (entry.examId === activeExamId) {
                    currentPart = partKey;
                }
                const order = Array.isArray(dataset?.questionOrder) ? dataset.questionOrder : [];
                const answers = slot?.draft?.answers && typeof slot.draft.answers === 'object' ? slot.draft.answers : {};
                const statusMap = slot?.navStatus instanceof Map ? slot.navStatus : new Map();
                info[partKey].total = order.length || info[partKey].total;
                info[partKey].questions = order.map((qId) => {
                    const labelMap = dataset?.questionDisplayMap || {};
                    const label = labelMap[qId] || String(qId).replace(/^q/i, '');
                    let status = statusMap.get(qId) || '';
                    const answered = Object.prototype.hasOwnProperty.call(answers, qId)
                        && splitAnswerTokens(answers[qId]).length > 0;
                    if (answered && !status) {
                        status = 'answered';
                    }
                    if (answered) {
                        info[partKey].answeredCount += 1;
                    }
                    const comparison = slot?.lastResults?.answerComparison?.[qId];
                    if (comparison) {
                        status = comparison.isCorrect ? 'correct' : 'incorrect';
                    }
                    return { qId, label, status, examId: entry.examId };
                });
            });
            return { info, currentPart };
        }
        const info = {
            p1: { questions: [], answeredCount: 0, total: 13 },
            p2: { questions: [], answeredCount: 0, total: 13 },
            p3: { questions: [], answeredCount: 0, total: 14 }
        };

        const p1PlaceholderOrder = Array.from({ length: 13 }, (_, i) => `q${i + 1}`);
        const p2PlaceholderOrder = Array.from({ length: 13 }, (_, i) => `q${i + 14}`);
        const p3PlaceholderOrder = Array.from({ length: 14 }, (_, i) => `q${i + 27}`);

        let sequenceExams = [];
        let draftsByExam = {};
        let resultsByExam = {};
        try {
            const raw = global.sessionStorage?.getItem('ielts_sim_session');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) {
                    if (Array.isArray(parsed.sequence)) sequenceExams = parsed.sequence;
                    if (parsed.draftsByExam) draftsByExam = parsed.draftsByExam;
                    if (Array.isArray(parsed.results)) {
                        parsed.results.forEach(res => {
                            if (res && res.examId) resultsByExam[res.examId] = res;
                        });
                    }
                }
            }
        } catch (_) {}

        const category = (state.dataset?.meta?.category || '').toUpperCase();
        let currentPart = 'p1';
        if (category === 'P2') currentPart = 'p2';
        else if (category === 'P3') currentPart = 'p3';

        // Part 1
        if (currentPart === 'p1') {
            const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
            info.p1.total = order.length;
            info.p1.questions = order.map(qId => {
                const label = displayLabel(qId);
                const status = navStatus.get(qId) || '';
                if (hasAnswer(qId)) info.p1.answeredCount++;
                return { qId, label, status };
            });
        } else {
            const examId = sequenceExams[0]?.examId;
            const draft = examId ? draftsByExam[examId] : null;
            const draftAnswers = draft ? (draft.answers || {}) : {};
            const result = examId ? resultsByExam[examId] : null;
            const comparison = result ? (result.answerComparison || {}) : {};
            
            info.p1.questions = p1PlaceholderOrder.map(qId => {
                const label = qId.replace(/^q/i, '');
                let status = '';
                const answered = draftAnswers[qId] != null && String(draftAnswers[qId]).trim() !== '';
                if (answered) {
                    info.p1.answeredCount++;
                    status = 'answered';
                }
                if (comparison[qId]) {
                    status = comparison[qId].isCorrect ? 'correct' : 'incorrect';
                }
                return { qId, label, status };
            });
        }

        // Part 2
        if (currentPart === 'p2') {
            const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
            info.p2.total = order.length;
            info.p2.questions = order.map(qId => {
                const label = displayLabel(qId);
                const status = navStatus.get(qId) || '';
                if (hasAnswer(qId)) info.p2.answeredCount++;
                return { qId, label, status };
            });
        } else {
            const examId = sequenceExams[1]?.examId;
            const draft = examId ? draftsByExam[examId] : null;
            const draftAnswers = draft ? (draft.answers || {}) : {};
            const result = examId ? resultsByExam[examId] : null;
            const comparison = result ? (result.answerComparison || {}) : {};
            
            info.p2.questions = p2PlaceholderOrder.map(qId => {
                const label = qId.replace(/^q/i, '');
                let status = '';
                const answered = draftAnswers[qId] != null && String(draftAnswers[qId]).trim() !== '';
                if (answered) {
                    info.p2.answeredCount++;
                    status = 'answered';
                }
                if (comparison[qId]) {
                    status = comparison[qId].isCorrect ? 'correct' : 'incorrect';
                }
                return { qId, label, status };
            });
        }

        // Part 3
        if (currentPart === 'p3') {
            const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
            info.p3.total = order.length;
            info.p3.questions = order.map(qId => {
                const label = displayLabel(qId);
                const status = navStatus.get(qId) || '';
                if (hasAnswer(qId)) info.p3.answeredCount++;
                return { qId, label, status };
            });
        } else {
            const examId = sequenceExams[2]?.examId;
            const draft = examId ? draftsByExam[examId] : null;
            const draftAnswers = draft ? (draft.answers || {}) : {};
            const result = examId ? resultsByExam[examId] : null;
            const comparison = result ? (result.answerComparison || {}) : {};
            
            info.p3.questions = p3PlaceholderOrder.map(qId => {
                const label = qId.replace(/^q/i, '');
                let status = '';
                const answered = draftAnswers[qId] != null && String(draftAnswers[qId]).trim() !== '';
                if (answered) {
                    info.p3.answeredCount++;
                    status = 'answered';
                }
                if (comparison[qId]) {
                    status = comparison[qId].isCorrect ? 'correct' : 'incorrect';
                }
                return { qId, label, status };
            });
        }

        return { info, currentPart };
    }

    function updateActiveQuestionHighlight(qId) {
        state.currentActiveQuestionId = qId;
        document.querySelectorAll('.q-item').forEach((item) => {
            if (item.dataset.questionId === qId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function buildQuestionNav() {
        const { info, currentPart } = getPassageQuestionStates();
        
        const renderQuestionsHtml = (partKey, questions, isCurrent) => {
            return questions.map(q => {
                const segmentClass = q.status ? q.status : '';
                const activeClass = (isCurrent && q.qId === state.currentActiveQuestionId) ? 'active' : '';
                const disabledClass = isCurrent || state.suite?.inline ? '' : 'disabled';
                const qidAttr = isCurrent ? `data-question-id="${q.qId}"` : '';
                const examAttr = q.examId ? ` data-exam-id="${escapeHtml(q.examId)}"` : '';
                
                return `
                    <div class="q-column" data-question-id="${q.qId}" data-part="${partKey}"${examAttr}>
                        <div class="q-bar-segment ${segmentClass}"></div>
                        <button class="q-item ${activeClass} ${q.status} ${disabledClass}" ${qidAttr} type="button">${q.label}</button>
                    </div>
                `;
            }).join('');
        };
        
        const p1Status = document.getElementById('part1-status-text');
        const p1QuestionsContainer = document.getElementById('part1-questions');
        if (p1Status) p1Status.textContent = `${info.p1.answeredCount} of ${info.p1.total}`;
        if (p1QuestionsContainer) {
            p1QuestionsContainer.innerHTML = renderQuestionsHtml('p1', info.p1.questions, currentPart === 'p1');
        }
        
        const p2Status = document.getElementById('part2-status-text');
        const p2QuestionsContainer = document.getElementById('part2-questions');
        if (p2Status) p2Status.textContent = `${info.p2.answeredCount} of ${info.p2.total}`;
        if (p2QuestionsContainer) {
            p2QuestionsContainer.innerHTML = renderQuestionsHtml('p2', info.p2.questions, currentPart === 'p2');
        }
        
        const p3Status = document.getElementById('part3-status-text');
        const p3QuestionsContainer = document.getElementById('part3-questions');
        if (p3Status) p3Status.textContent = `${info.p3.answeredCount} of ${info.p3.total}`;
        if (p3QuestionsContainer) {
            p3QuestionsContainer.innerHTML = renderQuestionsHtml('p3', info.p3.questions, currentPart === 'p3');
        }

        const isSingleMode = !state.suiteSessionId;
        const p1Section = document.getElementById('part-section-1');
        if (p1Section) {
            p1Section.classList.toggle('active', currentPart === 'p1');
        }
        const p1Name = document.querySelector('#part-section-1 .part-nav-name');
        if (p1Name) {
            p1Name.classList.toggle('inactive', isSingleMode && currentPart !== 'p1');
        }
        const p2Section = document.getElementById('part-section-2');
        if (p2Section) {
            p2Section.classList.toggle('active', currentPart === 'p2');
        }
        const p2Name = document.querySelector('#part-section-2 .part-nav-name');
        if (p2Name) {
            p2Name.classList.toggle('inactive', isSingleMode && currentPart !== 'p2');
        }
        const p3Section = document.getElementById('part-section-3');
        if (p3Section) {
            p3Section.classList.toggle('active', currentPart === 'p3');
        }
        const p3Name = document.querySelector('#part-section-3 .part-nav-name');
        if (p3Name) {
            p3Name.classList.toggle('inactive', isSingleMode && currentPart !== 'p3');
        }

        const prevBtn = document.getElementById('float-prev-btn');
        const nextBtn = document.getElementById('float-next-btn');
        if (prevBtn && nextBtn) {
            const hasPrev = state.simulationMode && state.simulationCtx && state.simulationCtx.canPrev;
            const hasNext = state.simulationMode && state.simulationCtx && state.simulationCtx.canNext;
            prevBtn.disabled = !hasPrev;
            nextBtn.disabled = !hasNext;
        }
    }

    function attachPaneResizer() {
        const shell = dom.shell;
        const divider = dom.divider;
        const leftPane = dom.left;
        const rightPane = dom.right;
        if (!shell || !divider || !leftPane || !rightPane || divider.dataset.resizeBound === '1') {
            return;
        }
        divider.dataset.resizeBound = '1';

        const baseMinLeft = 280;
        const baseMinRight = 320;
        const minPane = 220;

        const isResizableLayout = () => {
            const dividerStyle = global.getComputedStyle ? global.getComputedStyle(divider) : null;
            const shellStyle = global.getComputedStyle ? global.getComputedStyle(shell) : null;
            return !!(
                dividerStyle
                && shellStyle
                && dividerStyle.display !== 'none'
                && shellStyle.display === 'grid'
            );
        };

        const resolveConstraints = () => {
            const shellRect = shell.getBoundingClientRect();
            const dividerRect = divider.getBoundingClientRect();
            const dividerWidth = Math.max(1, Math.round(dividerRect.width || 10));
            const contentWidth = Math.max(0, Math.round(shellRect.width - dividerWidth));
            let minLeft = baseMinLeft;
            let minRight = baseMinRight;
            if (contentWidth < minLeft + minRight) {
                minLeft = Math.max(minPane, Math.floor(contentWidth * 0.42));
                minRight = Math.max(0, contentWidth - minLeft);
            }
            return {
                shellRect,
                contentWidth,
                minLeft,
                minRight,
                minWidth: minLeft,
                maxWidth: Math.max(minLeft, contentWidth - minRight)
            };
        };

        const setDividerA11y = (leftWidth, constraints) => {
            const contentWidth = constraints.contentWidth || 1;
            const percent = Math.round((leftWidth / contentWidth) * 100);
            const clampedPercent = Math.max(0, Math.min(100, percent));
            divider.setAttribute('aria-valuenow', String(clampedPercent));
            divider.setAttribute('aria-valuetext', `原文 ${clampedPercent}%`);
        };

        const applyPaneWidth = (leftWidth) => {
            if (!isResizableLayout()) {
                return;
            }
            const constraints = resolveConstraints();
            const clamped = Math.max(
                constraints.minWidth,
                Math.min(constraints.maxWidth, Math.round(leftWidth))
            );
            shell.style.setProperty('--reading-left-pane-width', `${clamped}px`);
            setDividerA11y(clamped, constraints);
        };

        const applyPointerPosition = (clientX) => {
            const constraints = resolveConstraints();
            applyPaneWidth(clientX - constraints.shellRect.left);
        };

        let dragging = false;

        function handlePointerMove(event) {
            if (!dragging || !event) {
                return;
            }
            event.preventDefault();
            applyPointerPosition(event.clientX);
        }

        function stopDragging(event) {
            if (!dragging) {
                return;
            }
            dragging = false;
            divider.classList.remove('is-dragging');
            document.body.classList.remove('reading-pane-resizing');
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', stopDragging);
            document.removeEventListener('pointercancel', stopDragging);
            try {
                if (event && typeof divider.releasePointerCapture === 'function') {
                    divider.releasePointerCapture(event.pointerId);
                }
            } catch (_) {
                // Pointer capture may already be released by the browser.
            }
        }

        divider.addEventListener('pointerdown', (event) => {
            if (
                !isResizableLayout()
                || !event
                || (Number.isFinite(Number(event.button)) && event.button > 0)
            ) {
                return;
            }
            event.preventDefault();
            dragging = true;
            divider.classList.add('is-dragging');
            document.body.classList.add('reading-pane-resizing');
            try {
                if (typeof divider.setPointerCapture === 'function') {
                    divider.setPointerCapture(event.pointerId);
                }
            } catch (_) {
                // Pointer capture is progressive enhancement.
            }
            document.addEventListener('pointermove', handlePointerMove);
            document.addEventListener('pointerup', stopDragging);
            document.addEventListener('pointercancel', stopDragging);
            applyPointerPosition(event.clientX);
        });

        divider.addEventListener('keydown', (event) => {
            if (!isResizableLayout()) {
                return;
            }
            const currentWidth = leftPane.getBoundingClientRect().width;
            const step = event.shiftKey ? 80 : 32;
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                applyPaneWidth(currentWidth - step);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                applyPaneWidth(currentWidth + step);
            } else if (event.key === 'Home') {
                event.preventDefault();
                applyPaneWidth(resolveConstraints().contentWidth * 0.36);
            } else if (event.key === 'End') {
                event.preventDefault();
                applyPaneWidth(resolveConstraints().contentWidth * 0.64);
            }
        });

        global.addEventListener('resize', () => {
            if (isResizableLayout()) {
                applyPaneWidth(leftPane.getBoundingClientRect().width);
            }
        });

        applyPaneWidth(leftPane.getBoundingClientRect().width || shell.getBoundingClientRect().width * 0.5);
    }

    function normalizeQuestionId(rawValue) {
        if (!rawValue) return null;
        const value = String(rawValue).trim().toLowerCase();
        const match = value.match(/q(\d+)/);
        return match ? `q${match[1]}` : null;
    }

    const READING_QUESTION_TYPE_NAMES = {
        'heading-matching': true,
        'true-false-not-given': true,
        'yes-no-not-given': true,
        'multiple-choice': true,
        'summary-completion': true,
        'sentence-completion': true,
        'short-answer': true,
        'diagram-labelling': true,
        'flow-chart': true,
        'table-completion': true,
        'matching-information': true,
        'matching-features': true,
        'matching-people-ideas': true,
        other: true
    };

    const READING_QUESTION_TYPE_ALIASES = {
        headingmatching: 'heading-matching',
        headingsmatching: 'heading-matching',
        matchingheadings: 'heading-matching',
        listofheadings: 'heading-matching',
        truefalsenotgiven: 'true-false-not-given',
        tfng: 'true-false-not-given',
        yesnonotgiven: 'yes-no-not-given',
        ynng: 'yes-no-not-given',
        multiplechoice: 'multiple-choice',
        mcq: 'multiple-choice',
        summarycompletion: 'summary-completion',
        sentencecompletion: 'sentence-completion',
        shortanswer: 'short-answer',
        shortanswerquestions: 'short-answer',
        diagramlabelling: 'diagram-labelling',
        diagramlabeling: 'diagram-labelling',
        flowchart: 'flow-chart',
        flowchartcompletion: 'flow-chart',
        tablecompletion: 'table-completion',
        matchinginformation: 'matching-information',
        matchingfeatures: 'matching-features',
        matchingpeopleideas: 'matching-people-ideas',
        matchingpeople: 'matching-people-ideas',
        matchingnames: 'matching-people-ideas',
        matching: 'matching-features',
        general: 'other',
        unknown: 'other',
        other: 'other'
    };

    function normalizeQuestionTypeToken(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
    }

    function normalizeReadingQuestionType(value) {
        const token = normalizeQuestionTypeToken(value);
        if (!token) {
            return 'other';
        }
        if (READING_QUESTION_TYPE_NAMES[token]) {
            return token;
        }
        const compact = token.replace(/-/g, '');
        return READING_QUESTION_TYPE_ALIASES[compact] || READING_QUESTION_TYPE_ALIASES[token] || 'other';
    }

    function textFromHtml(value) {
        return String(value || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function inferReadingQuestionTypeFromGroup(group) {
        group = group || {};
        const explicitType = normalizeReadingQuestionType(group.questionType || group.kind || group.type);
        if (explicitType !== 'other') {
            return explicitType;
        }
        const text = textFromHtml([group.leadHtml, group.bodyHtml, group.html, group.title].join(' '));
        if (/which paragraph contains|paragraph contains the following information|contains the following information/.test(text)) {
            return 'matching-information';
        }
        if (/list of headings|choose the correct heading|match.*heading|headings/.test(text)) {
            return 'heading-matching';
        }
        if (/true\s+if|false\s+if|not given/.test(text) && /true/.test(text) && /false/.test(text)) {
            return 'true-false-not-given';
        }
        if (/yes\s+if|no\s+if|not given/.test(text) && /yes/.test(text) && /no/.test(text)) {
            return 'yes-no-not-given';
        }
        if (/choose the correct letter|choose the correct answer|multiple choice/.test(text)) {
            return 'multiple-choice';
        }
        if (/complete the summary|summary below/.test(text)) {
            return 'summary-completion';
        }
        if (/complete each sentence|complete the sentences|sentence endings|correct ending/.test(text)) {
            return 'sentence-completion';
        }
        if (/complete the table|table below/.test(text)) {
            return 'table-completion';
        }
        if (/flow[- ]?chart|flow chart/.test(text)) {
            return 'flow-chart';
        }
        if (/diagram|label the diagram|labelling|labeling|map below/.test(text)) {
            return 'diagram-labelling';
        }
        if (/answer the questions|short answer/.test(text)) {
            return 'short-answer';
        }
        if (/look at the following people|list of people|match each person|match each statement with the correct person|list of ideas/.test(text)) {
            return 'matching-people-ideas';
        }
        if (/match each|match the following|classify the following|list of (points|features|options|events)/.test(text)) {
            return 'matching-features';
        }
        return explicitType;
    }

    function addQuestionTypeMapEntry(map, questionId, type) {
        const normalizedId = normalizeQuestionId(questionId);
        if (!normalizedId || !type) {
            return;
        }
        map[normalizedId] = type;
        map[String(questionId).trim().toLowerCase()] = type;
    }

    function buildQuestionTypeMap(dataset = state.dataset) {
        const map = {};
        const groups = Array.isArray(dataset?.questionGroups) ? dataset.questionGroups : [];
        groups.forEach((group) => {
            const type = inferReadingQuestionTypeFromGroup(group);
            const questionIds = Array.isArray(group?.questionIds) ? group.questionIds : [];
            questionIds.forEach((questionId) => addQuestionTypeMapEntry(map, questionId, type));
        });
        return map;
    }

    function isQuestionIdMatch(value, target) {
        return normalizeQuestionId(value) === normalizeQuestionId(target);
    }

    function findQuestionAnchor(questionId) {
        const directCandidates = [
            document.getElementById(`${questionId}-anchor`),
            document.querySelector(`[data-question="${questionId}"]`),
            document.querySelector(`[data-question-id="${questionId}"]`),
            document.querySelector(`[name="${questionId}"]`)
        ].filter(Boolean);
        if (directCandidates.length) {
            return directCandidates[0];
        }

        const groups = document.querySelectorAll('.unified-group[data-question-ids]');
        for (const group of groups) {
            const values = (group.dataset.questionIds || '').split(',').map((entry) => entry.trim()).filter(Boolean);
            if (values.some((entry) => isQuestionIdMatch(entry, questionId))) {
                return group;
            }
        }
        return null;
    }

    function updateNavStatuses(results = null) {
        const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
        order.forEach((questionId) => {
            if (!results) {
                navStatus.set(questionId, hasAnswer(questionId) ? 'answered' : '');
                return;
            }
            const entry = results.answerComparison?.[questionId];
            if (!entry) {
                navStatus.set(questionId, hasAnswer(questionId) ? 'answered' : '');
                return;
            }
            navStatus.set(questionId, entry.isCorrect ? 'correct' : 'incorrect');
        });
        buildQuestionNav();
        syncPrimaryActionButtons();
    }

    function attachNavListeners() {
        const handler = (event) => {
            const column = event.target.closest('.q-column');
            if (!column) return;
            const questionId = column.dataset.questionId;
            const partKey = column.dataset.part;
            
            const category = (state.dataset?.meta?.category || '').toUpperCase();
            let currentPartKey = 'p1';
            if (category === 'P2') currentPartKey = 'p2';
            else if (category === 'P3') currentPartKey = 'p3';
            
            if (partKey === currentPartKey) {
                const target = findQuestionAnchor(questionId);
                if (target && typeof global.scrollToElement === 'function') {
                    global.scrollToElement(target);
                } else {
                    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                }
                updateActiveQuestionHighlight(questionId);
            } else {
                if (state.suite?.inline) {
                    const targetExamId = column.dataset.examId || '';
                    if (targetExamId) {
                        activateSuiteSlot(targetExamId).then((activated) => {
                            if (activated && questionId) {
                                const target = findQuestionAnchor(questionId);
                                if (target && typeof global.scrollToElement === 'function') {
                                    global.scrollToElement(target);
                                } else {
                                    target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                                }
                                updateActiveQuestionHighlight(questionId);
                            }
                        }).catch((error) => {
                            console.warn('[UnifiedReadingPage] inline suite navigate failed:', error);
                        });
                    }
                    return;
                }
                if (state.simulationMode) {
                    if (partKey === 'p1' && currentPartKey === 'p2') dispatchSimulationNavigate('prev');
                    else if (partKey === 'p2' && currentPartKey === 'p3') dispatchSimulationNavigate('prev');
                    else if (partKey === 'p2' && currentPartKey === 'p1') dispatchSimulationNavigate('next');
                    else if (partKey === 'p3' && currentPartKey === 'p2') dispatchSimulationNavigate('next');
                    else if (partKey === 'p3' && currentPartKey === 'p1') {
                        dispatchSimulationNavigate('next');
                    }
                    else if (partKey === 'p1' && currentPartKey === 'p3') {
                        dispatchSimulationNavigate('prev');
                    }
                }
            }
        };
        
        document.getElementById('part1-questions')?.addEventListener('click', handler);
        document.getElementById('part2-questions')?.addEventListener('click', handler);
        document.getElementById('part3-questions')?.addEventListener('click', handler);

        dom.right?.addEventListener('focusin', (event) => {
            const input = event.target.closest('input, select, textarea');
            if (!input) return;
            const name = input.getAttribute('name');
            if (name) {
                const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
                const cleanName = name.replace(/^q/i, '');
                const matched = order.find(qId => {
                    const cleanQId = qId.replace(/^q/i, '');
                    return cleanQId === cleanName;
                });
                if (matched) {
                    updateActiveQuestionHighlight(matched);
                }
            }
        });
    }

    function attachFloatingNavListeners() {
        const prevBtn = document.getElementById('float-prev-btn');
        const nextBtn = document.getElementById('float-next-btn');
        
        prevBtn?.addEventListener('click', () => {
            if (state.simulationMode && state.simulationCtx) {
                if (state.simulationCtx.canPrev) {
                    if (state.suite?.inline) {
                        dispatchSimulationNavigate('prev', buildSubmissionSnapshot());
                        return;
                    }
                    dispatchSimulationNavigate('prev', buildSubmissionSnapshot());
                }
            }
        });
        
        nextBtn?.addEventListener('click', () => {
            if (state.simulationMode && state.simulationCtx) {
                if (!state.simulationCtx.isLast) {
                    syncSimulationDraftSnapshot('submit');
                    dispatchSimulationNavigate('next', buildSubmissionSnapshot());
                }
            }
        });
    }

    function attachMemorizeLocatorListeners() {
        document.addEventListener('click', (event) => {
            const target = event.target instanceof HTMLElement
                ? event.target.closest('.reading-locator-highlight[data-question-id]')
                : null;
            if (!target) {
                return;
            }
            const questionId = target.dataset.questionId || '';
            const anchor = findQuestionAnchor(questionId);
            if (anchor && typeof global.scrollToElement === 'function') {
                global.scrollToElement(anchor);
                return;
            }
            anchor?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        });
    }

    function resolvePassageTargets() {
        if (!dom.left) return [];
        const wrapped = Array.from(dom.left.querySelectorAll('.paragraph-wrapper > p'));
        if (wrapped.length) {
            return wrapped;
        }
        const paragraphs = Array.from(dom.left.querySelectorAll('p')).filter((node) => {
            const text = (node.textContent || '').trim();
            return text.length > 0 && !/you should spend about/i.test(text);
        });
        return paragraphs;
    }

    function renderPassageExplanations() {
        const notes = Array.isArray(state.explanation?.passageNotes) ? state.explanation.passageNotes : [];
        if (!notes.length) {
            return;
        }
        const targets = resolvePassageTargets();
        if (!targets.length) {
            return;
        }
        ensureExplanationStyles();
        const size = Math.min(notes.length, targets.length);
        for (let index = 0; index < size; index += 1) {
            const note = notes[index];
            const target = targets[index];
            if (!note || !target) continue;
            const label = note.label || `${state.explanation?.meta?.noteType || '段落讲解'} ${index + 1}`;
            const card = createExplanationCard(label, note.text || '', 'reading-passage-explanation');
            target.insertAdjacentElement('afterend', card);
        }
    }

    function locateQuestionContainer(groupEl, questionId) {
        const itemContainerSelector = '.question-item, .tfng-item, .match-question-item, .question-row, .summary-completion, tr, li';
        const escaped = escapeSelector(questionId);
        const directByAnchor = groupEl.querySelector(`#${escaped}-anchor`);
        if (directByAnchor) {
            return directByAnchor.closest(itemContainerSelector)
                || directByAnchor.parentElement;
        }
        const inputByName = groupEl.querySelector(`[name="${escaped}"]`);
        if (inputByName) {
            return inputByName.closest(itemContainerSelector);
        }
        const byData = groupEl.querySelector(`[data-question="${escaped}"]`);
        if (byData) {
            return byData.closest('.question-item, .match-question-item, .question-row, .summary-completion, .paragraph-wrapper, tr, li')
                || byData.parentElement;
        }
        const displayNumber = Number(questionNumberFromId(questionId));
        if (Number.isFinite(displayNumber)) {
            const candidates = Array.from(groupEl.querySelectorAll(itemContainerSelector));
            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index];
                const text = String(candidate.textContent || '');
                if (!text) continue;
                if (new RegExp(`\\b${displayNumber}\\b`).test(text)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    function renderGroupExplanation(groupEl, section, questionNumbers) {
        const title = section?.sectionTitle || `题型讲解（Q${questionNumbers[0] || ''}）`;
        const text = section?.text || '';
        if (!text) {
            return;
        }
        const card = createExplanationCard(title, text, 'reading-group-explanation');
        groupEl.appendChild(card);
    }

    function renderPerQuestionExplanations(groupEl, section, questionPairs) {
        const itemMap = new Map();
        (section?.items || []).forEach((item) => {
            const number = Number(item?.questionNumber);
            if (!Number.isFinite(number)) return;
            itemMap.set(number, item.text || '');
        });
        if (!itemMap.size) {
            renderGroupExplanation(groupEl, section, questionPairs.map((pair) => pair.number));
            return;
        }

        const fallback = [];
        questionPairs.forEach(({ questionId, number }) => {
            const text = itemMap.get(number);
            if (!text) return;
            const container = locateQuestionContainer(groupEl, questionId);
            if (container) {
                const card = createExplanationCard(`Q${number} 讲解`, text, 'reading-question-explanation');
                container.appendChild(card);
            } else {
                fallback.push({ number, text });
            }
        });

        if (!fallback.length) {
            return;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'reading-question-explanation-list';
        const heading = document.createElement('h5');
        heading.textContent = section?.sectionTitle || '题目讲解';
        wrapper.appendChild(heading);
        fallback.forEach(({ number, text }) => {
            const item = createExplanationCard(`Q${number}`, text, 'reading-question-explanation-item');
            wrapper.appendChild(item);
        });
        groupEl.appendChild(wrapper);
    }

    function renderQuestionExplanations() {
        if (!dom.groups) return;
        const groups = Array.from(dom.groups.querySelectorAll('.unified-group'));
        if (!groups.length) return;
        ensureExplanationStyles();

        const datasetGroups = Array.isArray(state.dataset?.questionGroups) ? state.dataset.questionGroups : [];
        groups.forEach((groupEl, index) => {
            const group = datasetGroups[index] || {};
            const questionIds = Array.isArray(group.questionIds) ? group.questionIds : [];
            const questionPairs = questionIds.map((questionId) => ({
                questionId,
                number: questionNumberFromId(questionId)
            })).filter((pair) => Number.isFinite(pair.number));
            const questionNumbers = questionPairs.map((pair) => pair.number);
            const sectionForGroup = pickSectionForGroup(questionNumbers, 'per_question')
                || pickSectionForGroup(questionNumbers, 'group')
                || pickSectionForGroup(questionNumbers, null);
            const hasPerQuestionItems = Array.isArray(sectionForGroup?.items) && sectionForGroup.items.length > 0;
            const splitMode = EXPLANATION_SPLIT_KINDS.has(group.kind) || hasPerQuestionItems;

            if (splitMode) {
                const section = sectionForGroup || pickSectionForGroup(questionNumbers, null);
                if (section) {
                    renderPerQuestionExplanations(groupEl, section, questionPairs);
                }
                return;
            }

            const section = pickSectionForGroup(questionNumbers, 'group')
                || pickSectionForGroup(questionNumbers, null);
            if (section) {
                renderGroupExplanation(groupEl, section, questionNumbers);
            }
        });
    }

    async function renderExplanations() {
        clearExplanations();
        const explanation = await ensureExplanationDataset();
        if (!explanation) {
            return;
        }
        renderPassageExplanations();
        renderQuestionExplanations();
    }

    function createAnswerKeyCard(questionId, answerValue) {
        const card = document.createElement('div');
        card.className = 'reading-answer-key-card';
        card.dataset.questionId = questionId;

        const label = document.createElement('div');
        label.className = 'reading-answer-key-card__label';
        label.textContent = `Q${displayLabel(questionId)} 答案`;

        const value = document.createElement('div');
        value.className = 'reading-answer-key-card__value';
        value.textContent = displayAnswerValue(answerValue, '无答案');

        card.appendChild(label);
        card.appendChild(value);
        return card;
    }

    function renderMemorizeAnswerKeys() {
        clearMemorizeAnswerKeys();
        if (!state.memorizeMode || !dom.groups) {
            return;
        }
        ensureMemorizeStyles();
        const answerKey = state.dataset?.answerKey || {};
        const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : Object.keys(answerKey);
        const groups = Array.from(dom.groups.querySelectorAll('.unified-group'));
        const datasetGroups = Array.isArray(state.dataset?.questionGroups) ? state.dataset.questionGroups : [];

        order.forEach((questionId) => {
            if (!Object.prototype.hasOwnProperty.call(answerKey, questionId)) {
                return;
            }
            const groupIndex = datasetGroups.findIndex((group) => (
                Array.isArray(group?.questionIds)
                && group.questionIds.some((entry) => isQuestionIdMatch(entry, questionId))
            ));
            const groupEl = groupIndex >= 0 ? groups[groupIndex] : null;
            if (!groupEl) {
                return;
            }
            const container = locateQuestionContainer(groupEl, questionId) || groupEl;
            if (container.querySelector(`.reading-answer-key-card[data-question-id="${escapeSelector(questionId)}"]`)) {
                return;
            }
            container.appendChild(createAnswerKeyCard(questionId, answerKey[questionId]));
        });
    }

    function buildDisplayNumberQuestionMap() {
        const map = new Map();
        const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
        order.forEach((questionId) => {
            const number = questionNumberFromId(questionId);
            if (Number.isFinite(number) && !map.has(number)) {
                map.set(number, questionId);
            }
        });
        return map;
    }

    function resolveExplanationItemQuestionId(item, numberMap) {
        const direct = normalizeQuestionId(item?.questionId);
        if (direct) {
            return direct;
        }
        const number = Number(item?.questionNumber);
        if (Number.isFinite(number) && numberMap.has(number)) {
            return numberMap.get(number);
        }
        return '';
    }

    function addLocatorSnippet(snippetsByQuestionId, questionId, text) {
        if (!questionId || !text) {
            return;
        }
        const cleaned = String(text)
            .replace(/\s+/g, ' ')
            .replace(/^[\s"'“”‘’「」『』()（）.,;:，。；：]+|[\s"'“”‘’「」『』()（）.,;:，。；：]+$/g, '')
            .trim();
        if (cleaned.length < 10 || !/[A-Za-z]/.test(cleaned)) {
            return;
        }
        const list = snippetsByQuestionId.get(questionId) || [];
        if (!list.some((entry) => entry.toLowerCase() === cleaned.toLowerCase())) {
            list.push(cleaned);
        }
        snippetsByQuestionId.set(questionId, list);
    }

    function extractQuotedLocatorSnippets(text) {
        const snippets = [];
        const source = String(text || '');
        const pattern = /["“”]([^"“”]{8,220})["“”]/g;
        let match = pattern.exec(source);
        while (match) {
            String(match[1] || '')
                .split(/(?:\.{3,}|…+|。|；|;)/)
                .map((entry) => entry.trim())
                .filter(Boolean)
                .forEach((entry) => snippets.push(entry));
            match = pattern.exec(source);
        }
        return snippets;
    }

    function buildMemorizeLocatorSnippets() {
        const snippetsByQuestionId = new Map();
        const sections = Array.isArray(state.explanation?.questionExplanations)
            ? state.explanation.questionExplanations
            : [];
        if (!sections.length) {
            return snippetsByQuestionId;
        }
        const numberMap = buildDisplayNumberQuestionMap();

        sections.forEach((section) => {
            const items = Array.isArray(section?.items) ? section.items : [];
            items.forEach((item) => {
                const questionId = resolveExplanationItemQuestionId(item, numberMap);
                extractQuotedLocatorSnippets(item?.text).forEach((snippet) => {
                    addLocatorSnippet(snippetsByQuestionId, questionId, snippet);
                });
            });

            if (items.length) {
                return;
            }
            const range = section?.questionRange || {};
            const targetIds = [];
            const start = Number(range.start);
            const end = Number(range.end);
            if (Number.isFinite(start) && Number.isFinite(end)) {
                for (let number = start; number <= end; number += 1) {
                    const questionId = numberMap.get(number);
                    if (questionId) {
                        targetIds.push(questionId);
                    }
                }
            }
            extractQuotedLocatorSnippets(section?.text).forEach((snippet) => {
                targetIds.forEach((questionId) => addLocatorSnippet(snippetsByQuestionId, questionId, snippet));
            });
        });
        return snippetsByQuestionId;
    }

    function applyMemorizeLocatorHighlights() {
        clearMemorizeLocatorHighlights();
        if (!state.memorizeMode || !dom.left) {
            return 0;
        }
        const shared = getHighlightShared();
        if (!shared || typeof shared.wrapTextMatches !== 'function') {
            return 0;
        }
        ensureMemorizeStyles();
        const snippetsByQuestionId = buildMemorizeLocatorSnippets();
        let applied = 0;
        snippetsByQuestionId.forEach((snippets, questionId) => {
            snippets.slice(0, 4).forEach((snippet) => {
                const matches = shared.wrapTextMatches(dom.left, snippet, {
                    className: 'reading-locator-highlight',
                    attrs: {
                        'data-question-id': questionId,
                        title: `Q${displayLabel(questionId)} 定位`
                    },
                    limit: 2,
                    skipSelector: '.hl, .reading-locator-highlight, .reading-locator-block'
                });
                applied += matches.length;
            });
        });
        return applied;
    }

    async function renderMemorizeStudyLayer() {
        if (!state.memorizeMode) {
            return;
        }
        ensureMemorizeStyles();
        renderReadingSubtitle();
        renderMemorizeAnswerKeys();
        await renderExplanations();
        applyMemorizeLocatorHighlights();
        syncPracticeModeDom();
        syncPrimaryActionButtons();
    }

    function getDropzones() {
        return Array.from(document.querySelectorAll('.paragraph-dropzone, .match-dropzone, .drop-target-summary'));
    }

    function ensureDropzoneHolder(dropzone) {
        if (!dropzone) return null;
        if (dropzone.classList.contains('drop-target-summary')) {
            return dropzone; // inline dropzones operate on themselves
        }
        let holder = dropzone.querySelector('.dropped-items');
        if (!holder) {
            holder = document.createElement('div');
            holder.className = 'dropped-items';
            dropzone.appendChild(holder);
        }
        return holder;
    }

    function updateDropzoneState(dropzone) {
        if (!dropzone) return;
        const hasValue = !!String(dropzone.dataset.answerValue || '').trim();
        dropzone.classList.toggle('dropzone-filled', hasValue);
        dropzone.classList.toggle('dropzone-empty', !hasValue);
    }

    function clearDropzone(dropzone) {
        if (!dropzone) return;
        dropzone.dataset.answerValue = '';
        dropzone.dataset.answerLabel = '';
        if (dropzone.classList.contains('drop-target-summary')) {
            dropzone.innerHTML = '';
        } else {
            const holder = ensureDropzoneHolder(dropzone);
            if (holder) {
                holder.innerHTML = '';
            }
        }
        updateDropzoneState(dropzone);
    }

    function getDropzonePayload(dropzone) {
        if (!dropzone) return null;
        const value = String(dropzone.dataset.answerValue || '').trim();
        if (!value) return null;
        return {
            value,
            label: String(dropzone.dataset.answerLabel || value).trim(),
            sourceDropzoneId: String(dropzone.dataset.dropzoneId || '').trim()
        };
    }

    function buildDragPayload(item) {
        if (!item) return null;
        const sourceDropzone = item.closest('.paragraph-dropzone, .match-dropzone, .drop-target-summary');
        return {
            value: item.dataset.heading || item.dataset.option || item.dataset.word || item.dataset.value || item.dataset.answerValue || item.textContent.trim(),
            label: item.dataset.answerLabel || item.dataset.word || item.dataset.value || item.textContent.trim(),
            sourceDropzoneId: sourceDropzone?.dataset?.dropzoneId || ''
        };
    }

    function parseDragPayload(rawValue) {
        if (!rawValue) return null;
        try {
            const payload = JSON.parse(rawValue);
            if (!payload || typeof payload !== 'object') {
                return null;
            }
            return {
                value: String(payload.value || payload.label || '').trim(),
                label: String(payload.label || payload.value || '').trim(),
                sourceDropzoneId: String(payload.sourceDropzoneId || '').trim()
            };
        } catch (_) {
            const fallback = String(rawValue).trim();
            if (!fallback) {
                return null;
            }
            return {
                value: fallback,
                label: fallback,
                sourceDropzoneId: ''
            };
        }
    }

    function attachDraggableBehavior(item) {
        if (!item || item.dataset.dragBound === '1') {
            return;
        }
        item.dataset.dragBound = '1';
        item.addEventListener('dragstart', (event) => {
            const payload = buildDragPayload(item);
            if (!payload || !payload.value) {
                event.preventDefault();
                return;
            }
            event.dataTransfer?.setData('text/plain', JSON.stringify(payload));
            event.dataTransfer.effectAllowed = 'move';
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
        });
    }

    function setDropzoneAnswer(dropzone, value, label) {
        if (!dropzone) return;
        const normalizedValue = String(value || '').trim();
        const normalizedLabel = String(label || value || '').trim();
        dropzone.dataset.answerValue = normalizedValue;
        dropzone.dataset.answerLabel = normalizedLabel;
        const holder = ensureDropzoneHolder(dropzone);
        if (!holder) {
            return;
        }
        holder.innerHTML = '';
        if (normalizedValue) {
            const item = document.createElement('div');
            item.className = 'drag-item drag-item--assigned';
            item.textContent = normalizedLabel;
            item.dataset.answerValue = normalizedValue;
            item.dataset.answerLabel = normalizedLabel;
            item.setAttribute('draggable', 'true');
            item.addEventListener('click', () => {
                clearDropzone(dropzone);
                updateNavStatuses();
            });
            attachDraggableBehavior(item);

            if (dropzone.classList.contains('drop-target-summary')) {
                dropzone.innerHTML = '';
                dropzone.appendChild(item);
            } else {
                holder.appendChild(item);
            }
        }
        updateDropzoneState(dropzone);
    }

    function handleDropOnDropzone(dropzone, payload) {
        if (!dropzone || !payload || !payload.value) {
            return;
        }
        const sourceDropzone = payload.sourceDropzoneId
            ? document.querySelector(`[data-dropzone-id="${payload.sourceDropzoneId}"]`)
            : null;
        if (sourceDropzone && sourceDropzone === dropzone) {
            updateDropzoneState(dropzone);
            return;
        }
        const previousPayload = getDropzonePayload(dropzone);
        setDropzoneAnswer(dropzone, payload.value, payload.label);
        if (sourceDropzone && sourceDropzone !== dropzone) {
            if (previousPayload && previousPayload.value) {
                setDropzoneAnswer(sourceDropzone, previousPayload.value, previousPayload.label);
            } else {
                clearDropzone(sourceDropzone);
            }
        }
        updateNavStatuses();
    }

    function handleDropBackToPool(payload) {
        if (!payload || !payload.sourceDropzoneId) {
            return;
        }
        const sourceDropzone = document.querySelector(`[data-dropzone-id="${payload.sourceDropzoneId}"]`);
        if (!sourceDropzone) {
            return;
        }
        clearDropzone(sourceDropzone);
        updateNavStatuses();
    }

    function attachDragDrop() {
        getDropzones().forEach((dropzone, index) => {
            if (!dropzone.dataset.dropzoneId) {
                dropzone.dataset.dropzoneId = `dropzone-${index + 1}`;
            }
            ensureDropzoneHolder(dropzone);
            updateDropzoneState(dropzone);
        });
        document.querySelectorAll('.drag-item, .draggable-word, .card').forEach((item) => {
            if (item instanceof HTMLElement) {
                attachDraggableBehavior(item);
            }
        });
        document.addEventListener('dragover', (event) => {
            const target = event.target instanceof HTMLElement
                ? event.target.closest('.paragraph-dropzone, .match-dropzone, .drop-target-summary, .pool-items')
                : null;
            if (!target) {
                return;
            }
            event.preventDefault();
            target.classList.add('drag-over');
        });
        document.addEventListener('dragleave', (event) => {
            const target = event.target instanceof HTMLElement
                ? event.target.closest('.paragraph-dropzone, .match-dropzone, .drop-target-summary, .pool-items')
                : null;
            target?.classList?.remove('drag-over');
        });
        document.addEventListener('drop', (event) => {
            const target = event.target instanceof HTMLElement
                ? event.target.closest('.paragraph-dropzone, .match-dropzone, .drop-target-summary, .pool-items')
                : null;
            if (!target) {
                return;
            }
            event.preventDefault();
            target.classList.remove('drag-over');
            const raw = event.dataTransfer?.getData('text/plain') || '';
            const payload = parseDragPayload(raw);
            if (!payload) {
                return;
            }
            if (target.classList.contains('pool-items')) {
                handleDropBackToPool(payload);
                return;
            }
            handleDropOnDropzone(target, payload);
        });
    }

    function getCheckboxAnswers() {
        const grouped = new Map();
        document.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
            const name = input.name;
            if (!grouped.has(name)) {
                grouped.set(name, []);
            }
            if (input.checked) {
                grouped.get(name).push(String(input.value).trim());
            }
        });
        return grouped;
    }

    function expandQuestionSequence(rawValue) {
        if (!rawValue) return [];
        const value = String(rawValue).trim().toLowerCase();
        const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry));
        if ((value.includes('-') || value.includes('–')) && numbers.length > 2) {
            return numbers.map((entry) => `q${entry}`);
        }
        if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
            const ids = [];
            for (let current = numbers[0]; current <= numbers[1]; current += 1) {
                ids.push(`q${current}`);
            }
            return ids;
        }
        if (value.includes('_') && numbers.length >= 2) {
            return numbers.map((entry) => `q${entry}`);
        }
        const normalized = normalizeQuestionId(value);
        return normalized ? [normalized] : [];
    }

    function getTextualAnswer(questionId) {
        const aliases = resolveAnswerAliases(questionId);
        const fieldMap = new Map();
        aliases.forEach((alias) => {
            document.querySelectorAll(`[name="${alias}"]`).forEach((field) => {
                if (!fieldMap.has(field)) {
                    fieldMap.set(field, true);
                }
            });
        });
        const fields = Array.from(fieldMap.keys());
        const values = [];
        for (const field of fields) {
            if (field.type === 'radio') continue;
            if (field.tagName === 'SELECT') {
                const value = String(field.value || '').trim();
                if (value) {
                    values.push(value);
                }
                continue;
            }
            const value = String(field.value || '').trim();
            if (value) {
                values.push(value);
            }
        }
        if (!values.length) {
            aliases.forEach((alias) => {
                const inputById = document.getElementById(`${alias}_input`);
                if (!inputById || !('value' in inputById)) {
                    return;
                }
                const value = String(inputById.value || '').trim();
                if (value) {
                    values.push(value);
                }
            });
        }
        if (!values.length) {
            return '';
        }
        if (values.length === 1) {
            return values[0];
        }
        return values;
    }

    function getDropzoneAnswer(questionId) {
        const dropzone = findDropzoneByQuestionId(questionId);
        if (!dropzone) {
            return '';
        }
        const explicitValue = String(dropzone.dataset.answerValue || '').trim();
        if (explicitValue) {
            return explicitValue;
        }
        const items = dropzone.querySelectorAll('.drag-item, .draggable-word, .card');
        if (!items.length) {
            return '';
        }
        return Array.from(items).map((item) => normalizeDragValue(item)).filter(Boolean).join(', ');
    }

    function getObjectAnswerField(value, keys) {
        if (!value || typeof value !== 'object') {
            return '';
        }
        for (let index = 0; index < keys.length; index += 1) {
            const key = keys[index];
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
            }
            const fieldValue = value[key];
            if (fieldValue == null || typeof fieldValue === 'object') {
                continue;
            }
            const text = String(fieldValue).trim();
            if (text) {
                return text;
            }
        }
        return '';
    }

    function normalizeAnswerForReplay(value, mode = 'value') {
        const sanitizer = getAnswerSanitizer();
        if (Array.isArray(value)) {
            return value
                .map((item) => normalizeAnswerForReplay(item, mode))
                .filter(Boolean)
                .join(', ');
        }
        if (value && typeof value === 'object') {
            const valueKeys = ['value', 'answerValue', 'key', 'option', 'heading', 'word', 'answer', 'text', 'label', 'answerLabel', 'content'];
            const labelKeys = ['label', 'answerLabel', 'text', 'content', 'value', 'answerValue', 'key', 'option', 'heading', 'word', 'answer'];
            const extracted = getObjectAnswerField(value, mode === 'label' ? labelKeys : valueKeys);
            if (extracted) {
                return extracted;
            }
            if (sanitizer && typeof sanitizer.normalizeValue === 'function') {
                return sanitizer.normalizeValue(value);
            }
            return '';
        }
        if (sanitizer && typeof sanitizer.normalizeValue === 'function') {
            return sanitizer.normalizeValue(value);
        }
        const text = String(value == null ? '' : value).trim();
        return /^\[object\s/i.test(text) ? '' : text;
    }

    function displayAnswerValue(value, fallback = '未作答') {
        const text = normalizeAnswerForReplay(value, 'label');
        return text || fallback;
    }

    function normalizeAnswerForCompare(value) {
        if (Array.isArray(value)) {
            return value.map((item) => normalizeAnswerForCompare(item)).filter((item) => item !== '');
        }
        if (value && typeof value === 'object') {
            return normalizeAnswerForReplay(value, 'value');
        }
        return normalizeAnswerForReplay(value, 'value');
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function splitAnswerTokens(rawValue) {
        if (Array.isArray(rawValue)) {
            return rawValue
                .flatMap((item) => splitAnswerTokens(item))
                .filter(Boolean);
        }
        const text = normalizeAnswerForReplay(rawValue, 'value');
        if (!text) return [];
        if (text.includes(',')) {
            return text.split(',').map((item) => String(item || '').trim()).filter(Boolean);
        }
        return [text];
    }

    function resolveAnswerAliases(questionId) {
        const normalized = normalizeQuestionId(questionId);
        if (!normalized) return [];
        const numeric = normalized.replace(/^q/i, '');
        const displayMap = state.dataset?.questionDisplayMap || {};
        const displayLabel = String(displayMap[normalized] || '').trim();
        return Array.from(new Set([
            normalized,
            numeric,
            `question${numeric}`,
            displayLabel,
            displayLabel ? `q${displayLabel}` : ''
        ].filter(Boolean)));
    }

    function findDropzoneByQuestionId(questionId) {
        const aliases = resolveAnswerAliases(questionId);
        for (let index = 0; index < aliases.length; index += 1) {
            const alias = aliases[index];
            const escaped = escapeSelector(alias);
            const selector = [
                `.match-dropzone[data-question="${escaped}"]`,
                `.match-dropzone[data-question-id="${escaped}"]`,
                `.drop-target-summary[data-question="${escaped}"]`,
                `.drop-target-summary[data-question-id="${escaped}"]`,
                `.dropzone[data-target="${escaped}"]`,
                `.dropzone[data-question="${escaped}"]`,
                `.paragraph-dropzone[data-question="${escaped}"]`,
                `.match-dropzone[data-target="${escaped}"]`,
                `.paragraph-dropzone[data-target="${escaped}"]`,
                `#${escaped}-dropzone`,
                `#${escaped}-target`
            ].join(', ');
            let direct = null;
            try {
                direct = document.querySelector(selector);
            } catch (_) {
                direct = null;
            }
            if (direct) {
                return direct;
            }
            const anchor = document.getElementById(`${alias}-anchor`);
            const paragraphZone = anchor?.parentElement?.querySelector?.('.paragraph-dropzone');
            if (paragraphZone) {
                return paragraphZone;
            }
        }
        return null;
    }

    function applyDropzoneAnswer(questionId, rawValue) {
        const dropzone = findDropzoneByQuestionId(questionId);
        if (!dropzone) {
            return false;
        }
        const tokens = splitAnswerTokens(rawValue);
        if (!tokens.length) {
            clearDropzone(dropzone);
            return true;
        }
        const value = canonicalizeAnswerToken(tokens[0]);
        if (!value) {
            clearDropzone(dropzone);
            return true;
        }
        const label = normalizeAnswerForReplay(rawValue, 'label') || value;
        setDropzoneAnswer(dropzone, value, label);
        return true;
    }

    function normalizeDragValue(item) {
        if (!item) return '';
        const dataset = item.dataset || {};
        const explicit = String(
            dataset.answerValue
            || dataset.key
            || dataset.option
            || dataset.heading
            || dataset.word
            || dataset.value
            || ''
        ).trim();
        if (explicit) {
            return canonicalizeAnswerToken(explicit);
        }
        const text = String(item.textContent || '').trim();
        if (!text) {
            return '';
        }
        const leading = text.match(/^([A-Za-z])(?:[.)])?\s+/);
        if (leading) {
            return leading[1].toUpperCase();
        }
        return canonicalizeAnswerToken(text);
    }

    function collectAnswers() {
        const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
        const answers = {};
        const checkboxGroups = getCheckboxAnswers();

        checkboxGroups.forEach((values, name) => {
            const questionIds = expandQuestionSequence(name);
            if (!questionIds.length) {
                return;
            }
            const sorted = values.slice().sort((left, right) => left.localeCompare(right, 'en'));
            if (questionIds.length === 1) {
                answers[questionIds[0]] = sorted.length > 1 ? sorted : (sorted[0] || '');
                return;
            }
            questionIds.forEach((questionId, index) => {
                answers[questionId] = sorted[index] || '';
            });
        });

        order.forEach((questionId) => {
            if (Object.prototype.hasOwnProperty.call(answers, questionId)) {
                return;
            }
            const radios = document.querySelectorAll(`input[type="radio"][name="${questionId}"]`);
            if (radios.length) {
                const checked = Array.from(radios).find((input) => input.checked);
                answers[questionId] = checked ? String(checked.value).trim() : '';
                return;
            }
            const dropzoneAnswer = getDropzoneAnswer(questionId);
            if (dropzoneAnswer) {
                answers[questionId] = dropzoneAnswer;
                return;
            }
            answers[questionId] = getTextualAnswer(questionId);
        });

        return answers;
    }

    function normalizeAnswerValue(value) {
        if (Array.isArray(value)) {
            return splitAnswerTokens(value);
        }
        if (value == null) return '';
        return canonicalizeAnswerToken(value);
    }

    function canonicalizeAnswerToken(value) {
        value = normalizeAnswerForReplay(value, 'value');
        const core = getAnswerMatchCore();
        if (core && typeof core.normalizeToken === 'function') {
            return core.normalizeToken(value);
        }
        const cleaned = String(value)
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[‐‑‒–—]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^[\s"'`()[\]{}<>.,;:!?]+|[\s"'`()[\]{}<>.,;:!?]+$/g, '');
        if (!cleaned) {
            return '';
        }
        const lowered = cleaned.toLowerCase();
        if (['true', 't', 'yes', 'y'].includes(lowered)) return 'true';
        if (['false', 'f', 'no', 'n'].includes(lowered)) return 'false';
        if (['ng', 'notgiven', 'not-given'].includes(lowered)) return 'not given';
        if (/^[a-z]$/i.test(cleaned)) return cleaned.toUpperCase();
        const leadingOption = cleaned.match(/^([A-Za-z])(?:[.)])?\s+/);
        if (leadingOption && cleaned.length > 2) {
            return leadingOption[1].toUpperCase();
        }
        return cleaned;
    }

    function compareAnswers(userAnswer, correctAnswer) {
        const core = getAnswerMatchCore();
        const normalizedUserAnswer = normalizeAnswerForCompare(userAnswer);
        const normalizedCorrectAnswer = normalizeAnswerForCompare(correctAnswer);
        if (core && typeof core.compareAnswers === 'function') {
            return core.compareAnswers(normalizedUserAnswer, normalizedCorrectAnswer) === true;
        }
        const toTokens = (value) => {
            const source = Array.isArray(value) ? value : splitAnswerTokens(value);
            return Array.from(new Set(
                source.map((entry) => canonicalizeAnswerToken(entry)).filter(Boolean)
            ));
        };
        const actualTokens = toTokens(normalizedUserAnswer);
        const expectedTokens = toTokens(normalizedCorrectAnswer);
        if (!actualTokens.length && !expectedTokens.length) {
            return null;
        }
        if (!actualTokens.length || !expectedTokens.length) {
            return false;
        }
        const tokenEquivalent = (left, right) => {
            if (left === right) {
                return true;
            }
            if (/^[A-Z]$/.test(left) || /^[A-Z]$/.test(right)) {
                return false;
            }
            const looseLeft = String(left).toLowerCase().replace(/[^a-z0-9]+/g, '');
            const looseRight = String(right).toLowerCase().replace(/[^a-z0-9]+/g, '');
            return !!looseLeft && looseLeft === looseRight;
        };
        const tokenSetEqual = (leftValues, rightValues) => (
            leftValues.length === rightValues.length
            && leftValues.every((leftItem) => rightValues.some((rightItem) => tokenEquivalent(leftItem, rightItem)))
        );
        if (Array.isArray(correctAnswer)) {
            if (actualTokens.length === 1) {
                return expectedTokens.some((token) => tokenEquivalent(token, actualTokens[0]));
            }
            return tokenSetEqual(actualTokens, expectedTokens);
        }
        if (actualTokens.length > 1 || expectedTokens.length > 1) {
            return tokenSetEqual(actualTokens, expectedTokens);
        }
        return tokenEquivalent(actualTokens[0], expectedTokens[0]);
    }

    function questionWeight(correctAnswer) {
        const normalized = normalizeAnswerValue(correctAnswer);
        if (Array.isArray(normalized) && normalized.length > 0) {
            return normalized.length;
        }
        return 1;
    }

    function hasAnswer(questionId) {
        const answers = collectAnswers();
        const value = answers[questionId];
        return splitAnswerTokens(value).length > 0;
    }

    function buildResultsFromAnswers(dataset, answers = {}) {
        const answerKey = dataset?.answerKey || {};
        const questionOrder = Array.isArray(dataset?.questionOrder) ? dataset.questionOrder : Object.keys(answerKey);
        const questionTypeMap = buildQuestionTypeMap(dataset);
        const questionTypePerformance = {};
        const answerComparison = {};
        const details = {};
        let correctCount = 0;
        let totalQuestions = 0;

        questionOrder.forEach((questionId) => {
            const userAnswer = answers[questionId] || '';
            const correctAnswer = answerKey[questionId];
            const isCorrect = compareAnswers(userAnswer, correctAnswer);
            const weight = questionWeight(correctAnswer);
            const normalizedQuestionId = normalizeQuestionId(questionId) || questionId;
            const questionType = questionTypeMap[normalizedQuestionId] || 'other';
            if (!questionTypePerformance[questionType]) {
                questionTypePerformance[questionType] = {
                    total: 0,
                    correct: 0,
                    accuracy: 0
                };
            }
            totalQuestions += weight;
            questionTypePerformance[questionType].total += weight;
            if (isCorrect) {
                correctCount += weight;
                questionTypePerformance[questionType].correct += weight;
            }
            answerComparison[questionId] = {
                questionId,
                userAnswer,
                correctAnswer,
                isCorrect,
                questionType
            };
            details[questionId] = {
                questionId,
                userAnswer,
                correctAnswer,
                isCorrect,
                questionType
            };
        });

        Object.keys(questionTypePerformance).forEach((type) => {
            const performance = questionTypePerformance[type];
            performance.accuracy = performance.total > 0 ? performance.correct / performance.total : 0;
        });

        const accuracy = totalQuestions > 0 ? correctCount / totalQuestions : 0;
        return {
            answers,
            answerComparison,
            correctAnswers: answerKey,
            questionTypeMap,
            questionTypePerformance,
            scoreInfo: {
                correct: correctCount,
                total: totalQuestions,
                totalQuestions,
                accuracy,
                percentage: Math.round(accuracy * 100),
                details,
                source: 'unified_reading_page'
            }
        };
    }

    function buildResults() {
        return buildResultsFromAnswers(state.dataset, collectAnswers());
    }

    function renderResults(results) {
        if (!dom.results) return;
        const rows = Object.values(results.answerComparison).map((entry) => {
            const label = escapeHtml(displayLabel(entry.questionId));
            const userAnswer = escapeHtml(displayAnswerValue(entry.userAnswer));
            const correctAnswer = escapeHtml(displayAnswerValue(entry.correctAnswer, ''));
            const status = entry.isCorrect ? '✓' : '✗';
            return `
                <tr>
                    <td>${label}</td>
                    <td>${userAnswer}</td>
                    <td>${correctAnswer || ''}</td>
                    <td class="${entry.isCorrect ? 'result-correct' : 'result-incorrect'}">${status}</td>
                </tr>
            `;
        }).join('');
        dom.results.innerHTML = `
            <h4>答题结果</h4>
            <p>得分 ${results.scoreInfo.correct} / ${results.scoreInfo.totalQuestions} · ${results.scoreInfo.percentage}%</p>
            <table class="results-table">
                <thead>
                    <tr>
                        <th>题号</th>
                        <th>你的答案</th>
                        <th>正确答案</th>
                        <th>结果</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
        dom.results.style.display = 'block';
    }

    function escapeSelector(value) {
        if (global.CSS && typeof global.CSS.escape === 'function') {
            try {
                return global.CSS.escape(value);
            } catch (_) {
                // ignore and use fallback
            }
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function normalizeReplayQuestionId(rawValue) {
        if (rawValue == null) return '';
        const raw = String(rawValue).trim();
        if (!raw) return '';
        const splitIndex = raw.lastIndexOf('::');
        const value = splitIndex >= 0 ? raw.slice(splitIndex + 2) : raw;
        const direct = normalizeQuestionId(value);
        if (direct) return direct;
        const digits = value.match(/(\d+)/);
        return digits ? `q${digits[1]}` : value.toLowerCase();
    }

    function normalizeReplayMap(rawMap = {}) {
        const normalized = {};
        if (!rawMap || typeof rawMap !== 'object') {
            return normalized;
        }
        Object.entries(rawMap).forEach(([key, value]) => {
            const normalizedKey = normalizeReplayQuestionId(key);
            if (!normalizedKey) return;
            normalized[normalizedKey] = value;
        });
        return normalized;
    }

    function buildReplayResults(entry = {}) {
        const normalizedAnswers = normalizeReplayMap(entry.answers || {});
        const normalizedCorrectAnswers = normalizeReplayMap(entry.correctAnswers || {});
        const normalizedComparison = {};
        const rawComparison = normalizeReplayMap(entry.answerComparison || {});
        const questionIds = new Set([
            ...Object.keys(normalizedAnswers),
            ...Object.keys(normalizedCorrectAnswers),
            ...Object.keys(rawComparison),
            ...(Array.isArray(entry.allQuestionIds)
                ? entry.allQuestionIds.map((item) => normalizeReplayQuestionId(item)).filter(Boolean)
                : [])
        ]);

        let correctCount = 0;
        questionIds.forEach((questionId) => {
            const rawEntry = rawComparison[questionId];
            const comparisonEntry = (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry))
                ? rawEntry
                : {};
            const userAnswer = Object.prototype.hasOwnProperty.call(comparisonEntry, 'userAnswer')
                ? comparisonEntry.userAnswer
                : (Object.prototype.hasOwnProperty.call(normalizedAnswers, questionId) ? normalizedAnswers[questionId] : '');
            const correctAnswer = Object.prototype.hasOwnProperty.call(comparisonEntry, 'correctAnswer')
                ? comparisonEntry.correctAnswer
                : (Object.prototype.hasOwnProperty.call(normalizedCorrectAnswers, questionId) ? normalizedCorrectAnswers[questionId] : '');
            let isCorrect = typeof comparisonEntry.isCorrect === 'boolean'
                ? comparisonEntry.isCorrect
                : compareAnswers(userAnswer, correctAnswer);
            if (isCorrect) {
                correctCount += 1;
            }
            normalizedComparison[questionId] = {
                questionId,
                userAnswer,
                correctAnswer,
                isCorrect
            };
        });

        const totalQuestions = questionIds.size;
        const scoreInfo = Object.assign({}, entry.scoreInfo || {});
        scoreInfo.correct = Number.isFinite(Number(scoreInfo.correct)) ? Number(scoreInfo.correct) : correctCount;
        scoreInfo.total = Number.isFinite(Number(scoreInfo.total)) ? Number(scoreInfo.total) : totalQuestions;
        scoreInfo.totalQuestions = Number.isFinite(Number(scoreInfo.totalQuestions)) ? Number(scoreInfo.totalQuestions) : scoreInfo.total;
        scoreInfo.accuracy = scoreInfo.totalQuestions > 0 ? scoreInfo.correct / scoreInfo.totalQuestions : 0;
        scoreInfo.percentage = Number.isFinite(Number(scoreInfo.percentage))
            ? Number(scoreInfo.percentage)
            : Math.round(scoreInfo.accuracy * 100);

        return {
            answers: normalizedAnswers,
            correctAnswers: normalizedCorrectAnswers,
            answerComparison: normalizedComparison,
            scoreInfo
        };
    }

    function applyReplayAnswersToDom(answers = {}) {
        Object.entries(answers).forEach(([questionId, rawValue]) => {
            const normalizedId = normalizeReplayQuestionId(questionId);
            if (!normalizedId) return;
            if (applyDropzoneAnswer(normalizedId, rawValue)) {
                return;
            }
            const aliases = Array.from(new Set([
                normalizedId,
                normalizedId.replace(/^q/i, ''),
                `question${normalizedId.replace(/^q/i, '')}`
            ])).filter(Boolean);

            const valueList = splitAnswerTokens(rawValue);
            const firstValue = valueList[0] || '';

            aliases.forEach((alias) => {
                const escapedAlias = escapeSelector(alias);
                const selector = [
                    `input[name="${escapedAlias}"]`,
                    `textarea[name="${escapedAlias}"]`,
                    `select[name="${escapedAlias}"]`,
                    `input[id="${escapedAlias}"]`,
                    `textarea[id="${escapedAlias}"]`,
                    `select[id="${escapedAlias}"]`
                ].join(', ');
                const fields = Array.from(document.querySelectorAll(selector));
                fields.forEach((field) => {
                    if (!(field instanceof HTMLElement)) return;
                    if (field instanceof HTMLInputElement) {
                        if (field.type === 'radio') {
                            const candidate = String(field.value || field.dataset?.option || '').trim();
                            field.checked = valueList.includes(candidate) || valueList.includes(field.id || '');
                            return;
                        }
                        if (field.type === 'checkbox') {
                            const candidate = String(field.value || field.dataset?.option || '').trim();
                            field.checked = valueList.includes(candidate) || valueList.includes(field.id || '');
                            return;
                        }
                        field.value = firstValue;
                        return;
                    }
                    if (field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
                        field.value = firstValue;
                    }
                });
            });
        });
    }

    function setReadOnlyMode(enabled, reason = '') {
        state.readOnly = Boolean(enabled);
        state.readOnlyReason = state.readOnly
            ? (reason || state.readOnlyReason || 'readonly')
            : '';
        document.body.classList.toggle('review-readonly-mode', state.readOnly);
        if (dom.submitBtn) {
            if (!dom.submitBtn.dataset.defaultLabel) {
                dom.submitBtn.dataset.defaultLabel = dom.submitBtn.title || 'Submit';
            }
            dom.submitBtn.disabled = state.readOnly;
            const label = state.readOnly ? '回顾模式' : dom.submitBtn.dataset.defaultLabel;
            if (dom.submitBtn.classList.contains('nav-submit-circle-btn')) {
                dom.submitBtn.title = label;
            } else {
                dom.submitBtn.textContent = label;
            }
        }
        if (dom.resetBtn) {
            dom.resetBtn.disabled = state.readOnly;
        }
        const controls = document.querySelectorAll('input, textarea, select');
        controls.forEach((control) => {
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
                control.disabled = state.readOnly;
            }
        });
        syncPrimaryActionButtons();
        refreshSimulationDraftSyncLifecycle();
        enhanceReviewHighlights();
    }

    function disableDragInteractions() {
        document.querySelectorAll('.drag-item, .draggable-word, .card').forEach((item) => {
            if (!(item instanceof HTMLElement)) return;
            item.setAttribute('draggable', state.readOnly ? 'false' : 'true');
            item.classList.toggle('drag-item-locked', state.readOnly);
        });
    }

    function setExitButtonVisible(visible) {
        if (!dom.exitBtn) return;
        dom.exitBtn.style.display = visible ? 'block' : 'none';
    }

    function enterSubmittedReadOnlyState(reason = 'submit') {
        state.submitted = true;
        setReadOnlyMode(true, reason);
        disableDragInteractions();
        setTimerRunning(false);
        if (dom.submitBtn) dom.submitBtn.disabled = true;
        setExitButtonVisible(true);
        if (reason === 'simulation-final-submit' || reason === 'replay-review') {
            stopSimulationDraftSync();
        }
        syncPrimaryActionButtons();
    }

    function syncSimulationRuntimeFlags() {
        try {
            global.__UNIFIED_READING_SIMULATION_MODE__ = Boolean(state.simulationMode);
            global.__UNIFIED_READING_SIMULATION_IS_LAST__ = Boolean(state.simulationCtx && state.simulationCtx.isLast);
        } catch (_) {
            // ignore
        }
    }

    function syncPrimaryActionButtons() {
        if (dom.submitBtn && !dom.submitBtn.dataset.defaultLabel) {
            dom.submitBtn.dataset.defaultLabel = dom.submitBtn.classList.contains('nav-submit-circle-btn') 
                ? 'Submit' 
                : (dom.submitBtn.textContent || 'Submit');
        }
        if (dom.submitBtn && !dom.submitBtn.dataset.defaultType) {
            dom.submitBtn.dataset.defaultType = dom.submitBtn.getAttribute('type') || '';
        }
        if (dom.resetBtn && !dom.resetBtn.dataset.defaultLabel) {
            dom.resetBtn.dataset.defaultLabel = dom.resetBtn.textContent || 'Reset';
        }
        if (dom.resetBtn && !dom.resetBtn.dataset.defaultType) {
            dom.resetBtn.dataset.defaultType = dom.resetBtn.getAttribute('type') || '';
        }
        const ctx = state.simulationCtx && typeof state.simulationCtx === 'object' ? state.simulationCtx : null;
        const simulationEnabled = Boolean(state.simulationMode && ctx);
        syncSimulationRuntimeFlags();
        
        const setSubmitLabel = (label) => {
            if (!dom.submitBtn) return;
            if (dom.submitBtn.classList.contains('nav-submit-circle-btn')) {
                dom.submitBtn.title = label;
            } else {
                dom.submitBtn.textContent = label;
            }
        };

        if (state.memorizeMode && !state.reviewMode && !simulationEnabled) {
            if (dom.submitBtn) {
                dom.submitBtn.style.display = '';
                dom.submitBtn.setAttribute('type', 'button');
                setSubmitLabel('Exit');
                dom.submitBtn.disabled = false;
            }
            if (dom.resetBtn) {
                dom.resetBtn.style.display = '';
                dom.resetBtn.setAttribute('type', 'button');
                dom.resetBtn.textContent = '重置测试';
                dom.resetBtn.disabled = false;
            }
            return;
        }
        if (!simulationEnabled || state.reviewMode) {
            const canResetSubmittedSingle = Boolean(
                state.submitted
                && state.readOnly
                && state.readOnlyReason === 'final-submit'
                && !state.reviewMode
                && !state.suiteSessionId
            );
            if (dom.submitBtn) {
                dom.submitBtn.style.display = '';
                if (dom.submitBtn.dataset.defaultType) {
                    dom.submitBtn.setAttribute('type', dom.submitBtn.dataset.defaultType);
                }
                if (!state.readOnly || canResetSubmittedSingle) {
                    setSubmitLabel(dom.submitBtn.dataset.defaultLabel || 'Submit');
                }
                dom.submitBtn.disabled = state.readOnly;
            }
            if (dom.resetBtn) {
                dom.resetBtn.style.display = '';
                if (dom.resetBtn.dataset.defaultType) {
                    dom.resetBtn.setAttribute('type', dom.resetBtn.dataset.defaultType);
                }
                if (!state.readOnly || canResetSubmittedSingle) {
                    dom.resetBtn.textContent = dom.resetBtn.dataset.defaultLabel || 'Reset';
                }
                dom.resetBtn.disabled = state.readOnly && !canResetSubmittedSingle;
            }
            return;
        }
        if (dom.resetBtn) {
            dom.resetBtn.style.display = 'none';
        }
        if (dom.submitBtn) {
            dom.submitBtn.style.display = ctx.isLast ? '' : 'none';
            dom.submitBtn.setAttribute('type', 'button');
            setSubmitLabel('Submit');
            dom.submitBtn.disabled = state.readOnly;
        }
    }

    function ensureReviewNavStyle() {
        if (document.getElementById('review-nav-style')) return;
        const style = document.createElement('style');
        style.id = 'review-nav-style';
        style.textContent = `
            #review-nav-bar { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 8px; z-index: 2; }
            #review-nav-bar button { border: 1px solid rgba(148, 163, 184, 0.6); border-radius: 6px; padding: 4px 10px; background: #fff; color: #0f172a; cursor: pointer; font-size: 12px; font-weight: 600; }
            #review-nav-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
        `;
        document.head.appendChild(style);
    }

    function ensureReviewNavBar() {
        let bar = document.getElementById('review-nav-bar');
        if (bar) return bar;
        ensureReviewNavStyle();
        bar = document.createElement('div');
        bar.id = 'review-nav-bar';
        bar.innerHTML = `
            <button type="button" data-review-dir="prev">上一题</button>
            <button type="button" data-review-dir="next">下一题</button>
        `;
        bar.addEventListener('click', (event) => {
            const button = event.target instanceof HTMLElement ? event.target.closest('button[data-review-dir]') : null;
            if (!button || button.disabled) return;
                const direction = button.getAttribute('data-review-dir') || '';
                if (!direction) return;
                const barNode = button.closest('#review-nav-bar');
                const finalizeOnNext = Boolean(
                    direction === 'next'
                    && barNode
                    && barNode.dataset
                    && barNode.dataset.finalizeOnNext === 'true'
                );
                postMessage('REVIEW_NAVIGATE', {
                    direction,
                    sessionId: null,
                    reviewSessionId: state.reviewSessionId || state.reviewContext?.reviewSessionId || null,
                    suiteSessionId: state.suiteSessionId || state.reviewContext?.suiteSessionId || null,
                    suiteReviewMode: state.suiteReviewMode === true,
                    currentIndex: Number.isInteger(state.reviewContext?.currentIndex) ? state.reviewContext.currentIndex : state.reviewEntryIndex,
                    finalizeOnNext
                });
            });
        const header = document.querySelector('body > header') || document.querySelector('header');
        if (header) {
            try {
                if (global.getComputedStyle(header).position === 'static') {
                    header.style.position = 'relative';
                    header.dataset.reviewNavPatched = '1';
                }
            } catch (_) {
                header.style.position = 'relative';
                header.dataset.reviewNavPatched = '1';
            }
            header.appendChild(bar);
        } else {
            document.body.insertAdjacentElement('afterbegin', bar);
        }
        return bar;
    }

    function setReviewNavVisibility(visible) {
        const bar = ensureReviewNavBar();
        bar.style.display = visible ? 'inline-flex' : 'none';
    }

    function resetToAnsweringPresentation() {
        state.lastResults = null;
        state.submitted = false;
        state.readOnly = false;
        closeReviewHighlightDictionary();
        if (dom.results) {
            dom.results.style.display = 'none';
            dom.results.innerHTML = '';
        }
        clearExplanations();
        document.body.classList.remove('review-readonly-mode');
        enhanceReviewHighlights();
        document.querySelectorAll('input, textarea, select').forEach((control) => {
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
                control.disabled = false;
            }
        });
        disableDragInteractions();
        setTimerRunning(true);
        setExitButtonVisible(false);
        updateNavStatuses();
        syncPrimaryActionButtons();
    }

    function applyReviewContext(data = {}) {
        const contextExamId = data && data.examId != null ? String(data.examId).trim() : '';
        const currentExamId = state.examId != null ? String(state.examId).trim() : '';
        if (contextExamId && currentExamId && contextExamId !== currentExamId) {
            return;
        }
        state.reviewContext = data;
        state.suiteReviewMode = Boolean(data.suiteReviewMode);
        const viewMode = data.viewMode === 'answering' ? 'answering' : 'review';
        state.reviewViewMode = viewMode;
        if (data.reviewSessionId) {
            state.reviewSessionId = data.reviewSessionId;
        }
        if (Number.isInteger(data.currentIndex)) {
            state.reviewEntryIndex = data.currentIndex;
        }
        const bar = ensureReviewNavBar();
        const prevBtn = bar.querySelector('button[data-review-dir="prev"]');
        const nextBtn = bar.querySelector('button[data-review-dir="next"]');
        const shouldShowNav = data.showNav !== false;
        setReviewNavVisibility(shouldShowNav);
        const currentIndex = Number.isFinite(Number(data.currentIndex)) ? Number(data.currentIndex) : state.reviewEntryIndex;
        const total = Number.isFinite(Number(data.total)) ? Number(data.total) : 1;
        bar.dataset.reviewIndex = String(currentIndex);
        bar.dataset.reviewTotal = String(total);
        bar.dataset.viewMode = viewMode;
        bar.dataset.finalizeOnNext = data.finalizeOnNext ? 'true' : 'false';
        if (prevBtn) prevBtn.disabled = !data.canPrev;
        if (nextBtn) nextBtn.disabled = !data.canNext;
        if (viewMode === 'answering') {
            state.reviewMode = false;
            resetToAnsweringPresentation();
            setReadOnlyMode(false);
            syncPrimaryActionButtons();
        } else {
            state.reviewMode = true;
            if (data.readOnly !== false) {
                enterSubmittedReadOnlyState('stationary-review');
            } else {
                setReadOnlyMode(false);
            }
        }
    }

    async function applyReplayRecord(data = {}) {
        const entry = data.entry && typeof data.entry === 'object' ? data.entry : data;
        const entryExamId = entry && entry.examId != null ? String(entry.examId).trim() : '';
        const currentExamId = state.examId != null ? String(state.examId).trim() : '';
        if (entryExamId && currentExamId && entryExamId !== currentExamId) {
            return;
        }
        const replayResults = buildReplayResults(entry);
        const replayMarks = Array.isArray(data.markedQuestions)
            ? data.markedQuestions
            : (Array.isArray(entry.markedQuestions)
                ? entry.markedQuestions
                : (Array.isArray(entry.metadata && entry.metadata.markedQuestions)
                    ? entry.metadata.markedQuestions
                    : []));
        if (data.reviewSessionId) {
            state.reviewSessionId = data.reviewSessionId;
        }
        if (Number.isInteger(data.reviewEntryIndex)) {
            state.reviewEntryIndex = data.reviewEntryIndex;
        }
        state.reviewMode = true;
        state.reviewViewMode = 'review';
        applyReplayAnswersToDom(replayResults.answers || {});
        const replayHighlights = Array.isArray(entry.highlights) ? entry.highlights : [];
        applyHighlights(replayHighlights);
        enhanceReviewHighlights();
        if (Number.isFinite(Number(entry.scrollY))) {
            global.scrollTo(0, Number(entry.scrollY));
        }
        state.lastResults = replayResults;
        renderResults(replayResults);
        await renderExplanations();
        applyHighlights(replayHighlights);
        enhanceReviewHighlights();
        updateNavStatuses(replayResults);
        if (data.readOnly !== false) {
            enterSubmittedReadOnlyState('replay-review');
        } else {
            setReadOnlyMode(false);
        }
        if (typeof global.setPracticeMarkedQuestions === 'function') {
            try {
                global.setPracticeMarkedQuestions(replayMarks);
            } catch (_) {
                // ignore mark replay failures
            }
        }
    }

    function buildEnvelope(type, payload) {
        return {
            type,
            data: Object.assign({
                examId: state.examId,
                sessionId: state.sessionId,
                suiteSessionId: state.suiteSessionId,
                practiceMode: state.practiceMode,
                suiteTimerAnchorMs: state.suiteTimerAnchorMs,
                globalTimerAnchorMs: state.suiteTimerAnchorMs,
                suiteTimerMode: state.suiteTimerMode,
                suiteTimerLimitSeconds: state.suiteTimerLimitSeconds,
                source: MESSAGE_SOURCE
            }, payload || {}),
            source: MESSAGE_SOURCE
        };
    }

    function postMessage(type, payload) {
        const envelope = buildEnvelope(type, payload);
        const candidates = [global.opener, state.parentWindow, global.parent];
        const visited = new Set();
        for (let index = 0; index < candidates.length; index += 1) {
            const target = candidates[index];
            if (!target || target === global || visited.has(target)) {
                continue;
            }
            visited.add(target);
            try {
                target.postMessage(envelope, '*');
                state.parentWindow = target;
                return true;
            } catch (_) {
                // try next candidate
            }
        }
        return false;
    }

    function stopInitLoop() {
        if (state.initTimer) {
            clearInterval(state.initTimer);
            state.initTimer = null;
        }
    }

    function sendSessionReady() {
        postMessage('SESSION_READY', {
            url: global.location.href,
            pageType: 'unified-reading',
            title: state.dataset?.meta?.title || document.title,
            reviewMode: state.reviewMode,
            readOnly: state.readOnly,
            practiceMode: state.practiceMode,
            reviewSessionId: state.reviewSessionId,
            reviewEntryIndex: state.reviewEntryIndex,
            suiteTimerAnchorMs: state.suiteTimerAnchorMs,
            globalTimerAnchorMs: state.suiteTimerAnchorMs,
            suiteTimerMode: state.suiteTimerMode,
            suiteTimerLimitSeconds: state.suiteTimerLimitSeconds
        });
        state.sessionReadySent = true;
    }

    function buildInitSignature(data = {}) {
        return JSON.stringify({
            examId: data && data.examId != null ? String(data.examId).trim() : '',
            sessionId: data && data.sessionId != null ? String(data.sessionId).trim() : '',
            suiteSessionId: data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '',
            reviewSessionId: data && data.reviewSessionId != null ? String(data.reviewSessionId).trim() : '',
            reviewEntryIndex: Number.isInteger(data && data.reviewEntryIndex) ? data.reviewEntryIndex : 0,
            reviewMode: Boolean(data && data.reviewMode),
            readOnly: data && Object.prototype.hasOwnProperty.call(data, 'readOnly') ? Boolean(data.readOnly) : null,
            practiceMode: data && typeof data.practiceMode === 'string' ? data.practiceMode.trim().toLowerCase() : '',
            suiteFlowMode: data && typeof data.suiteFlowMode === 'string' ? data.suiteFlowMode.trim().toLowerCase() : '',
            suiteTimerAnchorMs: Number.isFinite(Number(data && (data.suiteTimerAnchorMs ?? data.globalTimerAnchorMs))) ? Number(data && (data.suiteTimerAnchorMs ?? data.globalTimerAnchorMs)) : null,
            suiteTimerMode: data && typeof data.suiteTimerMode === 'string' ? data.suiteTimerMode.trim().toLowerCase() : '',
            suiteTimerLimitSeconds: Number.isFinite(Number(data && data.suiteTimerLimitSeconds)) ? Number(data.suiteTimerLimitSeconds) : null,
            globalTimerAnchorMs: Number.isFinite(Number(data && data.globalTimerAnchorMs)) ? Number(data.globalTimerAnchorMs) : null
        });
    }

    function buildReplaySignature(data = {}) {
        const entry = data && data.entry && typeof data.entry === 'object' ? data.entry : {};
        const entryExamId = entry && entry.examId != null ? String(entry.examId).trim() : '';
        const currentExamId = state.examId != null ? String(state.examId).trim() : '';
        return JSON.stringify({
            examId: entryExamId || currentExamId,
            reviewSessionId: data && data.reviewSessionId != null ? String(data.reviewSessionId).trim() : '',
            suiteSessionId: data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '',
            reviewEntryIndex: Number.isInteger(data && data.reviewEntryIndex) ? data.reviewEntryIndex : 0
        });
    }

    function dispatchReady() {
        postMessage('REQUEST_INIT', {
            derivedExamId: state.examId,
            url: global.location.href,
            title: state.dataset?.meta?.title || document.title || '',
            practiceMode: state.practiceMode
        });
    }

    function restartInitHandshake() {
        state.sessionId = null;
        state.sessionReadySent = false;
        state.lastInitSignature = '';
        dispatchReady();
        startInitLoop();
    }

    function buildNormalPracticeUrl() {
        try {
            const url = new URL(global.location.href);
            url.searchParams.delete('practiceMode');
            url.searchParams.delete('mode');
            return url.href;
        } catch (_) {
            const raw = String(global.location.href || '');
            return raw
                .replace(/([?&])practiceMode=memorize(&?)/i, '$1')
                .replace(/([?&])mode=memorize(&?)/i, '$1')
                .replace(/[?&]$/, '');
        }
    }

    function requestNormalPracticeRestart(reason = 'reset') {
        const delivered = postMessage('PRACTICE_RESET_REQUEST', {
            reason,
            previousSessionId: state.sessionId || null,
            fromPracticeMode: state.practiceMode || 'single',
            targetPracticeMode: 'single',
            dataKey: state.dataKey || state.examId || '',
            url: global.location.href,
            normalUrl: buildNormalPracticeUrl(),
            title: state.dataset?.meta?.title || document.title || ''
        });
        if (!delivered && reason === 'memorize-start-test') {
            global.location.href = buildNormalPracticeUrl();
            return;
        }
        restartInitHandshake();
    }

    function startInitLoop() {
        stopInitLoop();
        state.initTimer = setInterval(() => {
            if (state.sessionId) {
                stopInitLoop();
                return;
            }
            dispatchReady();
        }, 500);
    }

    function getSimulationDraftStorageKey() {
        const suiteSessionId = state.suiteSessionId ? String(state.suiteSessionId).trim() : '';
        const examId = state.examId ? String(state.examId).trim() : '';
        if (!suiteSessionId || !examId) {
            return '';
        }
        return `ielts_sim_draft::${suiteSessionId}::${examId}`;
    }

    function cloneDraftSafely(draft) {
        if (!draft || typeof draft !== 'object') {
            return null;
        }
        try {
            return JSON.parse(JSON.stringify(draft));
        } catch (_) {
            return {
                answers: draft.answers && typeof draft.answers === 'object' ? { ...draft.answers } : {},
                highlights: Array.isArray(draft.highlights) ? draft.highlights.slice() : [],
                noteText: typeof draft.noteText === 'string' ? draft.noteText : '',
                scrollY: Number.isFinite(Number(draft.scrollY)) ? Number(draft.scrollY) : 0
            };
        }
    }

    function buildDraftFingerprint(draft) {
        if (!draft || typeof draft !== 'object') {
            return '';
        }
        try {
            return JSON.stringify(draft);
        } catch (_) {
            return '';
        }
    }

    function persistSimulationDraftMirror(draft) {
        const key = getSimulationDraftStorageKey();
        if (!key || !global.sessionStorage || !draft) {
            return;
        }
        try {
            global.sessionStorage.setItem(key, JSON.stringify({
                draft,
                updatedAt: Date.now()
            }));
        } catch (_) {
            // ignore sessionStorage failures in restricted environments
        }
    }

    function restoreSimulationDraftMirror() {
        const key = getSimulationDraftStorageKey();
        if (!key || !global.sessionStorage) {
            return null;
        }
        try {
            const raw = global.sessionStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            return parsed.draft && typeof parsed.draft === 'object'
                ? parsed.draft
                : null;
        } catch (_) {
            return null;
        }
    }

    function clearSimulationDraftMirror() {
        const key = getSimulationDraftStorageKey();
        if (!key || !global.sessionStorage) {
            return;
        }
        try {
            global.sessionStorage.removeItem(key);
        } catch (_) {
            // ignore sessionStorage failures in restricted environments
        }
    }

    function stopSimulationDraftSync() {
        if (state.simulationDraftSyncTimer) {
            clearInterval(state.simulationDraftSyncTimer);
            state.simulationDraftSyncTimer = null;
        }
    }

    function collectCurrentDraft() {
        const answers = collectAnswers();
        const updatedAt = Date.now();
        return {
            answers,
            highlights: collectHighlights(),
            noteText: getNotesText(),
            scrollY: global.scrollY || 0,
            updatedAt
        };
    }

    function syncSimulationDraftSnapshot(reason = 'periodic') {
        if (!state.simulationMode || state.readOnly || !state.suiteSessionId) {
            return;
        }
        const draft = state.suite?.inline
            ? (updateActiveSlotFromCurrentDom(reason) || collectCurrentDraft())
            : collectCurrentDraft();
        const fingerprint = buildDraftFingerprint(draft);
        if (reason === 'periodic' && fingerprint && fingerprint === state.simulationDraftFingerprint) {
            return;
        }
        state.simulationDraftFingerprint = fingerprint;
        const mirroredDraft = cloneDraftSafely(draft);
        if (!mirroredDraft) {
            return;
        }
        if (!state.suite?.inline) {
            persistSimulationDraftMirror(mirroredDraft);
        }
        postMessage('SIMULATION_DRAFT_SYNC', {
            examId: state.examId,
            draft: mirroredDraft,
            draftUpdatedAt: Number.isFinite(Number(mirroredDraft.updatedAt)) ? Number(mirroredDraft.updatedAt) : Date.now(),
            elapsed: getPageElapsedSeconds()
        });
    }

    function refreshSimulationDraftSyncLifecycle() {
        const shouldSync = Boolean(
            state.simulationMode
            && state.simulationContextReady
            && !state.readOnly
            && state.suiteSessionId
            && (state.examId || state.suite?.activeExamId)
        );
        if (!shouldSync) {
            stopSimulationDraftSync();
            return;
        }
        if (!state.simulationDraftSyncTimer) {
            state.simulationDraftSyncTimer = setInterval(() => {
                syncSimulationDraftSnapshot('periodic');
            }, SIMULATION_DRAFT_SYNC_MS);
        }
        syncSimulationDraftSnapshot('activate');
    }

    function applyDraftToDom(draft) {
        if (!draft || typeof draft !== 'object') {
            return;
        }
        if (draft.answers && typeof draft.answers === 'object') {
            const answers = draft.answers;
            const groupedHandledQuestionIds = new Set();
            const groupedChoiceInputs = new Map();

            document.querySelectorAll('input[type="radio"][name], input[type="checkbox"][name]').forEach((input) => {
                const groupName = String(input.getAttribute('name') || '').trim();
                if (!groupName) return;
                const questionIds = expandQuestionSequence(groupName);
                if (questionIds.length <= 1) return;
                const existing = groupedChoiceInputs.get(groupName) || {
                    questionIds,
                    inputs: []
                };
                existing.inputs.push(input);
                groupedChoiceInputs.set(groupName, existing);
            });

            groupedChoiceInputs.forEach((group) => {
                const mergedValues = [];
                group.questionIds.forEach((questionId) => {
                    groupedHandledQuestionIds.add(questionId);
                    if (!Object.prototype.hasOwnProperty.call(answers, questionId)) {
                        return;
                    }
                    splitAnswerTokens(answers[questionId]).forEach((entry) => {
                        const normalized = canonicalizeAnswerToken(entry);
                        if (normalized) {
                            mergedValues.push(normalized);
                        }
                    });
                });
                const normalizedValues = Array.from(new Set(mergedValues));
                group.inputs.forEach((input) => {
                    const candidate = canonicalizeAnswerToken(
                        input.value || input.dataset?.option || input.dataset?.value || input.id || ''
                    );
                    input.checked = normalizedValues.includes(candidate)
                        || normalizedValues.some((value) => compareAnswers(input.value, value));
                });
            });

            Object.entries(answers).forEach(([qid, value]) => {
                const normalized = normalizeQuestionId(qid);
                if (!normalized) return;
                if (groupedHandledQuestionIds.has(normalized)) {
                    return;
                }
                if (applyDropzoneAnswer(normalized, value)) {
                    return;
                }
                const escapedId = escapeSelector(normalized);
                // Radio / checkbox
                const choices = document.querySelectorAll(
                    `input[type="radio"][name="${escapedId}"], input[type="checkbox"][name="${escapedId}"]`
                );
                if (choices.length) {
                    const normalizedValues = splitAnswerTokens(value)
                        .map((entry) => canonicalizeAnswerToken(entry))
                        .filter(Boolean);
                    choices.forEach((input) => {
                        const candidate = canonicalizeAnswerToken(
                            input.value || input.dataset?.option || input.dataset?.value || input.id || ''
                        );
                        input.checked = normalizedValues.includes(candidate) || compareAnswers(input.value, value);
                    });
                    return;
                }
                // Text input
                const textInput = document.querySelector(`input[data-question-id="${escapedId}"], input#${escapedId}`);
                if (textInput && textInput.type !== 'radio' && textInput.type !== 'checkbox') {
                    textInput.value = displayAnswerValue(value, '');
                    return;
                }
                const namedTextFields = Array.from(
                    document.querySelectorAll(`input[name="${escapedId}"], textarea[name="${escapedId}"]`)
                ).filter((field) => field.type !== 'radio' && field.type !== 'checkbox');
                if (namedTextFields.length) {
                    const normalizedTextValue = displayAnswerValue(value, '');
                    namedTextFields.forEach((field) => {
                        field.value = normalizedTextValue;
                    });
                    return;
                }
                // Select
                const select = document.querySelector(`select[data-question-id="${escapedId}"], select#${escapedId}`);
                if (select) {
                    for (let i = 0; i < select.options.length; i++) {
                        if (compareAnswers(select.options[i].value, value)) {
                            select.selectedIndex = i;
                            break;
                        }
                    }
                }
                const namedSelects = document.querySelectorAll(`select[name="${escapedId}"]`);
                namedSelects.forEach((namedSelect) => {
                    for (let i = 0; i < namedSelect.options.length; i++) {
                        if (compareAnswers(namedSelect.options[i].value, value)) {
                            namedSelect.selectedIndex = i;
                            break;
                        }
                    }
                });
            });
        }
        if (Array.isArray(draft.highlights)) {
            applyHighlights(draft.highlights);
        }
        if (typeof draft.noteText === 'string') {
            setNotesText(draft.noteText);
        }
        if (typeof draft.scrollY === 'number') {
            global.scrollTo(0, draft.scrollY);
        }
    }

    function resolveHighlightRoot(scope) {
        if (scope === 'left') return dom.left;
        return dom.groups;
    }

    function collectHighlights() {
        const shared = getHighlightShared();
        if (!shared) {
            return [];
        }
        return shared.snapshotHighlights({
            left: dom.left,
            groups: dom.groups
        });
    }

    function applyHighlights(records = []) {
        const shared = getHighlightShared();
        if (!shared) {
            return 0;
        }
        const restored = shared.restoreHighlights({
            left: dom.left,
            groups: dom.groups
        }, Array.isArray(records) ? records : []);
        enhanceReviewHighlights();
        return restored;
    }

    function preserveHighlightsDuring(callback) {
        const shared = getHighlightShared();
        if (!shared) {
            return callback();
        }
        return shared.preserveHighlights({
            left: dom.left,
            groups: dom.groups
        }, callback);
    }

    function buildSubmissionSnapshot() {
        const results = buildResults();
        const timerSnapshot = getPracticeTimerSnapshot();
        return {
            results,
            answers: results.answers || {},
            highlights: collectHighlights(),
            noteText: getNotesText(),
            scrollY: global.scrollY || 0,
            elapsed: Math.max(0, Number(timerSnapshot.durationSeconds) || 0),
            timerSnapshot,
            updatedAt: Date.now()
        };
    }

    function prefixSuiteMap(examId, source = {}) {
        const prefixed = {};
        const prefix = examId ? `${examId}::` : '';
        Object.entries(source || {}).forEach(([questionId, value]) => {
            prefixed[`${prefix}${questionId}`] = value;
        });
        return prefixed;
    }

    function mergeQuestionTypePerformance(target, source = {}) {
        Object.entries(source || {}).forEach(([type, performance]) => {
            if (!target[type]) {
                target[type] = { total: 0, correct: 0, accuracy: 0 };
            }
            target[type].total += Number(performance && performance.total) || 0;
            target[type].correct += Number(performance && performance.correct) || 0;
            target[type].accuracy = target[type].total > 0
                ? target[type].correct / target[type].total
                : 0;
        });
    }

    function buildInlineSuiteSubmissionSnapshot() {
        updateActiveSlotFromCurrentDom('submit');
        const timerSnapshot = getPracticeTimerSnapshot();
        const suiteEntries = [];
        const aggregatedAnswers = {};
        const aggregatedComparison = {};
        const aggregatedCorrectAnswers = {};
        const aggregatedQuestionTypeMap = {};
        const aggregatedQuestionTypePerformance = {};
        let totalCorrect = 0;
        let totalQuestions = 0;
        let latestUpdatedAt = Date.now();

        state.suite.sequence.forEach((entry) => {
            const slot = getSuiteSlot(entry.examId);
            if (!slot || !slot.dataset) {
                return;
            }
            const draft = mergeDraft(slot.draft, {});
            const results = buildResultsFromAnswers(slot.dataset, draft.answers || {});
            slot.lastResults = results;
            slot.navStatus = new Map();
            Object.entries(results.answerComparison || {}).forEach(([questionId, comparison]) => {
                slot.navStatus.set(questionId, comparison && comparison.isCorrect ? 'correct' : 'incorrect');
            });
            const scoreInfo = results.scoreInfo || {};
            totalCorrect += Number(scoreInfo.correct) || 0;
            totalQuestions += Number(scoreInfo.total ?? scoreInfo.totalQuestions) || 0;
            latestUpdatedAt = Math.max(latestUpdatedAt, Number(draft.updatedAt) || latestUpdatedAt);
            Object.assign(aggregatedAnswers, prefixSuiteMap(entry.examId, results.answers || {}));
            Object.assign(aggregatedComparison, prefixSuiteMap(entry.examId, results.answerComparison || {}));
            Object.assign(aggregatedCorrectAnswers, prefixSuiteMap(entry.examId, results.correctAnswers || {}));
            Object.assign(aggregatedQuestionTypeMap, prefixSuiteMap(entry.examId, results.questionTypeMap || {}));
            mergeQuestionTypePerformance(aggregatedQuestionTypePerformance, results.questionTypePerformance || {});
            suiteEntries.push({
                examId: entry.examId,
                title: slot.title || entry.title || slot.dataset?.meta?.title || entry.examId,
                category: slot.category || entry.category || slot.dataset?.meta?.category || '',
                dataKey: slot.dataKey || entry.dataKey || entry.examId,
                duration: Math.max(0, Math.round(Number(slot.durationSeconds) || 0)),
                answers: results.answers || {},
                answerComparison: results.answerComparison || {},
                correctAnswers: results.correctAnswers || {},
                scoreInfo: results.scoreInfo || {},
                questionTypeMap: results.questionTypeMap || {},
                questionTypePerformance: results.questionTypePerformance || {},
                highlights: Array.isArray(draft.highlights) ? draft.highlights.slice() : [],
                noteText: typeof draft.noteText === 'string' ? draft.noteText : '',
                scrollY: Number.isFinite(Number(draft.scrollY)) ? Number(draft.scrollY) : 0,
                updatedAt: Number.isFinite(Number(draft.updatedAt)) ? Number(draft.updatedAt) : Date.now()
            });
        });

        const accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
        const scoreInfo = {
            correct: totalCorrect,
            total: totalQuestions,
            totalQuestions,
            accuracy,
            percentage: Math.round(accuracy * 100),
            source: 'unified_reading_inline_suite'
        };
        return {
            suiteSubmission: true,
            suiteEntries,
            results: {
                answers: aggregatedAnswers,
                answerComparison: aggregatedComparison,
                correctAnswers: aggregatedCorrectAnswers,
                questionTypeMap: aggregatedQuestionTypeMap,
                questionTypePerformance: aggregatedQuestionTypePerformance,
                scoreInfo
            },
            answers: aggregatedAnswers,
            answerComparison: aggregatedComparison,
            correctAnswers: aggregatedCorrectAnswers,
            questionTypeMap: aggregatedQuestionTypeMap,
            questionTypePerformance: aggregatedQuestionTypePerformance,
            scoreInfo,
            highlights: [],
            noteText: '',
            scrollY: global.scrollY || 0,
            elapsed: Math.max(0, Number(timerSnapshot.durationSeconds) || 0),
            timerSnapshot,
            updatedAt: latestUpdatedAt
        };
    }

    function clearCurrentAnswers() {
        document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
            input.checked = false;
        });
        document.querySelectorAll('input[type="text"], textarea').forEach((input) => {
            input.value = '';
        });
        document.querySelectorAll('select').forEach((select) => {
            select.selectedIndex = 0;
        });
        getDropzones().forEach((dropzone) => {
            clearDropzone(dropzone);
        });
    }

    function dispatchSimulationNavigate(direction, submissionSnapshot = null) {
        if (!state.simulationMode || !state.simulationCtx || state.readOnly) {
            return;
        }
        const snapshot = submissionSnapshot || buildSubmissionSnapshot();
        if (state.suite?.inline) {
            updateActiveSlotFromCurrentDom('navigate');
            const currentIndex = state.suite.currentIndex;
            const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
            const targetEntry = state.suite.sequence[targetIndex];
            if (targetEntry && targetEntry.examId) {
                activateSuiteSlot(targetEntry.examId).catch((error) => {
                    console.warn('[UnifiedReadingPage] inline simulation navigation failed:', error);
                });
            }
            return;
        }
        postMessage('SIMULATION_NAVIGATE', {
            direction: direction === 'prev' ? 'prev' : 'next',
            draft: {
                answers: snapshot.answers || {},
                highlights: Array.isArray(snapshot.highlights) ? snapshot.highlights : [],
                noteText: typeof snapshot.noteText === 'string' ? snapshot.noteText : '',
                scrollY: Number.isFinite(Number(snapshot.scrollY)) ? Number(snapshot.scrollY) : 0,
                updatedAt: Number.isFinite(Number(snapshot.updatedAt)) ? Number(snapshot.updatedAt) : Date.now()
            },
            draftUpdatedAt: Number.isFinite(Number(snapshot.updatedAt)) ? Number(snapshot.updatedAt) : Date.now(),
            resultSnapshot: snapshot.results,
            answers: snapshot.answers || {},
            highlights: Array.isArray(snapshot.highlights) ? snapshot.highlights : [],
            noteText: typeof snapshot.noteText === 'string' ? snapshot.noteText : '',
            scrollY: Number.isFinite(Number(snapshot.scrollY)) ? Number(snapshot.scrollY) : 0,
            elapsed: Number.isFinite(Number(snapshot.elapsed)) ? Number(snapshot.elapsed) : getPageElapsedSeconds(),
            timerSnapshot: snapshot.timerSnapshot || getPracticeTimerSnapshot()
        });
    }
    async function handleSubmit() {
        if (state.memorizeMode && !state.reviewMode && !state.simulationMode) {
            handleExitClick();
            return;
        }
        if (state.readOnly) {
            return;
        }
        const submissionSnapshot = state.suite?.inline
            ? buildInlineSuiteSubmissionSnapshot()
            : buildSubmissionSnapshot();
        if (state.simulationMode) {
            syncSimulationDraftSnapshot('submit');
        }
        const activeSlot = state.suite?.inline ? getActiveSuiteSlot() : null;
        const results = activeSlot?.lastResults || submissionSnapshot.results;
        const highlightSnapshot = state.suite?.inline
            ? (Array.isArray(activeSlot?.draft?.highlights) ? activeSlot.draft.highlights : [])
            : (Array.isArray(submissionSnapshot.highlights) ? submissionSnapshot.highlights : []);
        const postedResults = submissionSnapshot.results || results;
        state.lastResults = results;
        if (activeSlot) {
            activeSlot.lastResults = results;
        }
        renderResults(results);
        enterSubmittedReadOnlyState(state.simulationMode ? 'simulation-final-submit' : 'final-submit');
        await renderExplanations();
        applyHighlights(highlightSnapshot);
        enhanceReviewHighlights();
        updateNavStatuses(results);
        const messageType = state.simulationMode ? 'SIMULATION_SUBMIT' : 'PRACTICE_COMPLETE';
        const timing = resolvePracticeTiming(1, submissionSnapshot.timerSnapshot);
        postMessage(messageType, Object.assign({
            duration: timing.duration,
            startTime: new Date(timing.startTimeMs).toISOString(),
            endTime: new Date(timing.endTimeMs).toISOString(),
            effectiveEndTime: new Date(timing.effectiveEndTimeMs).toISOString(),
            effectiveEndTimeMs: timing.effectiveEndTimeMs,
            timerSnapshot: submissionSnapshot.timerSnapshot || getPracticeTimerSnapshot(),
            metadata: {
                examId: state.examId,
                examTitle: state.dataset?.meta?.title || '',
                title: state.dataset?.meta?.title || '',
                category: state.dataset?.meta?.category || '',
                frequency: state.dataset?.meta?.frequency || '',
                type: 'reading',
                examType: 'reading',
                practiceMode: state.suiteSessionId ? 'suite' : 'single',
                renderMode: 'unified-reading',
                dataKey: state.dataKey,
                markedQuestions: (typeof global.getPracticeMarkedQuestions === 'function')
                    ? global.getPracticeMarkedQuestions()
                    : []
            },
            answers: submissionSnapshot.answers || {},
            highlights: Array.isArray(submissionSnapshot.highlights) ? submissionSnapshot.highlights : [],
            noteText: typeof submissionSnapshot.noteText === 'string' ? submissionSnapshot.noteText : '',
            scrollY: Number.isFinite(Number(submissionSnapshot.scrollY)) ? Number(submissionSnapshot.scrollY) : 0
        }, state.suite?.inline ? {
            suiteSubmission: true,
            suiteEntries: Array.isArray(submissionSnapshot.suiteEntries) ? submissionSnapshot.suiteEntries : []
        } : {}, postedResults));
        if (state.simulationMode && state.simulationCtx && state.simulationCtx.isLast) {
            stopSimulationDraftSync();
            clearSimulationDraftMirror();
            state.simulationDraftFingerprint = '';
        }
    }

    function handleReset() {
        if (state.memorizeMode) {
            requestNormalPracticeRestart('memorize-start-test');
            return;
        }
        if (state.submitted && state.readOnlyReason === 'final-submit' && !state.suiteSessionId && !state.reviewMode) {
            resetToAnsweringPresentation();
            clearCurrentAnswers();
            requestNormalPracticeRestart('retake-after-submit');
            return;
        }
        if (state.readOnly || state.submitted) {
            return;
        }
        closeReviewHighlightDictionary();
        clearCurrentAnswers();
        if (dom.results) {
            dom.results.style.display = 'none';
            dom.results.innerHTML = '';
        }
        clearExplanations();
        setExitButtonVisible(false);
        updateNavStatuses();
    }

    function handleExitClick() {
        const inSuiteLikeMode = Boolean(state.suiteSessionId || state.reviewMode || state.suiteReviewMode);
        const hasEndlessMarker = /(?:^|[?&])endless(?:=|&|$)/i.test(global.location.search || '')
            || document.body?.dataset?.endlessMode === 'true'
            || global.__ENDLESS_PRACTICE_MODE__ === true;
        const opener = global.opener && !global.opener.closed ? global.opener : null;
        if (hasEndlessMarker && opener) {
            try {
                opener.postMessage({ type: 'ENDLESS_USER_EXIT' }, '*');
                if (typeof opener.stopEndlessPractice === 'function') {
                    opener.stopEndlessPractice();
                } else if (opener.AppActions && typeof opener.AppActions.stopEndlessPractice === 'function') {
                    opener.AppActions.stopEndlessPractice();
                }
            } catch (_) {
                // ignore endless callback failures
            }
        } else if (inSuiteLikeMode) {
            postMessage('SUITE_USER_EXIT', {
                reviewMode: state.reviewMode,
                suiteReviewMode: state.suiteReviewMode,
                submitted: state.submitted
            });
        }
        try {
            global.close();
        } catch (_) {
            // ignore close failures
        }
    }

    function attachActionListeners() {
        dom.submitBtn?.addEventListener('click', handleSubmit);
        dom.resetBtn?.addEventListener('click', handleReset);
        dom.exitBtn?.addEventListener('click', handleExitClick);
        document.addEventListener('change', () => updateNavStatuses());
        document.addEventListener('input', () => updateNavStatuses());
        document.addEventListener('drop', () => {
            global.setTimeout(() => updateNavStatuses(), 0);
        }, true);
    }

    function syncSuiteModeState() {
        const isSuiteMode = !!state.suiteSessionId;
        if (document.body && document.body.dataset) {
            document.body.dataset.suiteMode = isSuiteMode ? 'true' : 'false';
        }
        const candidateId = document.getElementById('candidate-id');
        if (candidateId) {
            const sourceId = state.suiteSessionId || state.sessionId || '';
            if (sourceId) {
                let hash = 0;
                String(sourceId).split('').forEach((char) => {
                    hash = ((hash << 5) - hash) + char.charCodeAt(0);
                    hash |= 0;
                });
                candidateId.textContent = String(Math.abs(hash) % 900000 + 100000);
                candidateId.hidden = false;
            } else {
                candidateId.textContent = '';
                candidateId.hidden = true;
            }
        }
        if (typeof global.updatePracticeSuiteModeUI === 'function') {
            try {
                global.updatePracticeSuiteModeUI(isSuiteMode);
            } catch (_) {
                // ignore sync errors between scripts
            }
        }
    }

    async function initializeInlineSimulationSuite(data = {}, options = {}) {
        const sequence = Array.isArray(data && data.suiteSequence) ? data.suiteSequence : [];
        if (!sequence.length) {
            return false;
        }
        const flowMode = data && typeof data.flowMode === 'string'
            ? data.flowMode.trim().toLowerCase()
            : (data && typeof data.suiteFlowMode === 'string' ? data.suiteFlowMode.trim().toLowerCase() : '');
        if (flowMode && flowMode !== 'simulation') {
            return false;
        }
        await ensureSuiteDatasets(sequence);
        mergeSuiteDraftPayload(data || {});
        const targetExamId = resolveSuiteTargetExamId(data || {}, options);
        if (!targetExamId) {
            return false;
        }
        const activated = await activateSuiteSlot(targetExamId, {
            skipSave: true,
            skipDraftSync: Boolean(options.skipDraftSync),
            silent: Boolean(options.silent)
        });
        if (activated) {
            const slot = getSuiteSlot(targetExamId);
            if (slot?.draft) {
                state.simulationDraftFingerprint = buildDraftFingerprint(slot.draft);
            }
            refreshSimulationDraftSyncLifecycle();
        }
        return activated;
    }

    async function handleIncoming(event) {
        const payload = event?.data;
        if (!payload || typeof payload !== 'object') {
            return;
        }
        const type = String(payload.type || payload.action || '').toUpperCase();
        const data = payload.data || {};
        if (type === 'INIT_SESSION' || type === 'INIT_EXAM_SESSION') {
            const initSignature = buildInitSignature(data);
            const isDuplicateInit = initSignature && initSignature === state.lastInitSignature;
            const incomingExamId = data && data.examId != null ? String(data.examId).trim() : '';
            const currentExamId = state.examId != null ? String(state.examId).trim() : '';
            const incomingSuiteSequence = normalizeSuiteSequence(data && data.suiteSequence);
            const incomingExamInSuiteSequence = Boolean(
                incomingExamId
                && incomingSuiteSequence.length
                && incomingSuiteSequence.some((entry) => entry.examId === incomingExamId)
            );
            if (incomingExamId && currentExamId && incomingExamId !== currentExamId && !incomingExamInSuiteSequence) {
                return;
            }
            if (isDuplicateInit && state.sessionReadySent) {
                return;
            }
            if (incomingExamId && !currentExamId) {
                state.examId = incomingExamId;
            }
            if (data.sessionId) {
                state.sessionId = data.sessionId;
            }
            if (data.suiteSessionId) {
                state.suiteSessionId = data.suiteSessionId;
            }
            applyPracticeMode(data.practiceMode || data.mode || '');
            const initTimerAnchorMs = Number(data.suiteTimerAnchorMs ?? data.globalTimerAnchorMs);
            if (Number.isFinite(initTimerAnchorMs) && initTimerAnchorMs > 0) {
                state.suiteTimerAnchorMs = Math.floor(initTimerAnchorMs);
                state.simulationGlobalAnchorMs = Math.floor(initTimerAnchorMs);
            }
            if (typeof data.suiteTimerMode === 'string') {
                const normalizedTimerMode = data.suiteTimerMode.trim().toLowerCase();
                if (normalizedTimerMode === 'countdown' || normalizedTimerMode === 'elapsed') {
                    state.suiteTimerMode = normalizedTimerMode;
                }
            }
            if (Number.isFinite(Number(data.suiteTimerLimitSeconds))) {
                state.suiteTimerLimitSeconds = Number(data.suiteTimerLimitSeconds);
            }
            const initPausedOffsetMs = Number(data.suiteTimerPausedOffsetMs ?? data.pausedOffsetMs);
            if (Number.isFinite(initPausedOffsetMs) && initPausedOffsetMs >= 0) {
                state.pagePausedOffsetMs = Math.max(0, initPausedOffsetMs);
            }
            const initPausedAtMs = Number(data.suiteTimerPausedAtMs ?? data.pausedAtMs);
            const initRunning = data.suiteTimerRunning !== false;
            interaction.timerRunning = initRunning;
            state.pagePausedAtMs = (!initRunning && Number.isFinite(initPausedAtMs) && initPausedAtMs > 0)
                ? Math.floor(initPausedAtMs)
                : null;
            if (data.reviewSessionId) {
                state.reviewSessionId = data.reviewSessionId;
            }
            if (Number.isInteger(data.reviewEntryIndex)) {
                state.reviewEntryIndex = data.reviewEntryIndex;
            }
            const initFlowMode = data && typeof data.suiteFlowMode === 'string'
                ? data.suiteFlowMode.trim().toLowerCase()
                : '';
            if (initFlowMode === 'simulation') {
                const rawIndex = Number(data.suiteSequenceIndex);
                const rawTotal = Number(data.suiteSequenceTotal);
                const currentIndex = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : 0;
                const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 3;
                const isLast = currentIndex >= total - 1;
                state.simulationMode = true;
                state.simulationContextReady = false;
                state.simulationCtx = {
                    currentIndex,
                    total,
                    isLast,
                    canPrev: currentIndex > 0,
                    canNext: !isLast,
                    flowMode: 'simulation',
                    examId: incomingExamId || currentExamId || null,
                    suiteSessionId: data.suiteSessionId || state.suiteSessionId || null,
                    suiteSequence: incomingSuiteSequence.map((entry) => ({ ...entry }))
                };
                if (incomingSuiteSequence.length) {
                    await initializeInlineSimulationSuite(Object.assign({}, data, {
                        flowMode: 'simulation',
                        suiteSequence: incomingSuiteSequence
                    }), {
                        skipDraftSync: true,
                        silent: true,
                        preferExistingActive: true
                    });
                }
            } else if (initFlowMode) {
                state.simulationMode = false;
                state.simulationContextReady = false;
                state.simulationCtx = null;
            }
            if (data.reviewMode) {
                state.reviewMode = true;
                if (data.readOnly !== false) {
                    enterSubmittedReadOnlyState('stationary-review');
                } else {
                    setReadOnlyMode(false);
                }
            }
            syncPrimaryActionButtons();
            refreshSimulationDraftSyncLifecycle();
            syncSuiteModeState();
            stopInitLoop();
            state.lastInitSignature = initSignature;
            if (state.memorizeMode && !state.reviewMode && !state.simulationMode) {
                renderMemorizeStudyLayer().catch(() => {});
            }
            sendSessionReady();
            return;
        }
        if (type === 'REPLAY_PRACTICE_RECORD') {
            const replaySignature = buildReplaySignature(data || {});
            if (replaySignature && replaySignature === state.lastReplaySignature) {
                return;
            }
            state.lastReplaySignature = replaySignature;
            applyReplayRecord(data || {}).catch(() => {});
            return;
        }
        if (type === 'REVIEW_CONTEXT') {
            applyReviewContext(data || {});
            return;
        }
        if (type === 'SUITE_NAVIGATE' && data.url) {
            const targetSuiteSessionId = typeof data.suiteSessionId === 'string' ? data.suiteSessionId.trim() : '';
            const currentSuiteSessionId = typeof state.suiteSessionId === 'string' ? state.suiteSessionId.trim() : '';
            if (targetSuiteSessionId && currentSuiteSessionId && targetSuiteSessionId !== currentSuiteSessionId) {
                return;
            }
            global.location.href = data.url;
            return;
        }
        if (type === 'SIMULATION_CONTEXT') {
            const contextExamId = data && data.examId != null ? String(data.examId).trim() : '';
            const currentExamId = state.examId != null ? String(state.examId).trim() : '';
            const contextSuiteSequence = normalizeSuiteSequence(data && data.suiteSequence);
            const contextExamInSuiteSequence = Boolean(
                contextExamId
                && contextSuiteSequence.length
                && contextSuiteSequence.some((entry) => entry.examId === contextExamId)
            );
            if (contextExamId && currentExamId && contextExamId !== currentExamId && !contextExamInSuiteSequence && !state.suite?.inline) {
                return;
            }
            const flowMode = data && typeof data.flowMode === 'string'
                ? data.flowMode.trim().toLowerCase()
                : 'simulation';
            if (flowMode !== 'simulation') {
                state.simulationMode = false;
                state.simulationContextReady = false;
                state.simulationCtx = null;
                stopSimulationDraftSync();
                clearSimulationDraftMirror();
                state.simulationDraftFingerprint = '';
                syncPrimaryActionButtons();
                return;
            }
            state.simulationMode = true;
            state.simulationContextReady = true;
            state.simulationCtx = data;
            if (contextExamId) {
                state.simulationCtx.examId = contextExamId;
            }
            if (contextSuiteSequence.length) {
                state.simulationCtx.suiteSequence = contextSuiteSequence.map((entry) => ({ ...entry }));
            }
            const simulationTimerAnchorMs = Number(data.globalTimerAnchorMs ?? data.suiteTimerAnchorMs);
            if (Number.isFinite(simulationTimerAnchorMs)) {
                state.simulationGlobalAnchorMs = simulationTimerAnchorMs;
                state.suiteTimerAnchorMs = simulationTimerAnchorMs;
            }
            if (typeof data.suiteTimerMode === 'string') {
                const normalizedTimerMode = data.suiteTimerMode.trim().toLowerCase();
                if (normalizedTimerMode === 'countdown' || normalizedTimerMode === 'elapsed') {
                    state.suiteTimerMode = normalizedTimerMode;
                }
            }
            if (Number.isFinite(Number(data.suiteTimerLimitSeconds))) {
                state.suiteTimerLimitSeconds = Number(data.suiteTimerLimitSeconds);
            }
            const timerSnapshot = data && data.timerSnapshot && typeof data.timerSnapshot === 'object'
                ? data.timerSnapshot
                : null;
            const snapshotPausedOffsetMs = Number(
                (timerSnapshot && timerSnapshot.pausedOffsetMs)
                ?? data.suiteTimerPausedOffsetMs
                ?? data.pausedOffsetMs
            );
            if (Number.isFinite(snapshotPausedOffsetMs) && snapshotPausedOffsetMs >= 0) {
                state.pagePausedOffsetMs = Math.max(0, snapshotPausedOffsetMs);
            }
            const snapshotRunning = timerSnapshot ? timerSnapshot.running : data.suiteTimerRunning;
            interaction.timerRunning = snapshotRunning !== false;
            const snapshotPausedAtMs = Number(
                (timerSnapshot && timerSnapshot.pausedAtMs)
                ?? data.suiteTimerPausedAtMs
                ?? data.pausedAtMs
            );
            state.pagePausedAtMs = (
                interaction.timerRunning === false
                && Number.isFinite(snapshotPausedAtMs)
                && snapshotPausedAtMs > 0
            ) ? Math.floor(snapshotPausedAtMs) : null;
            syncPrimaryActionButtons();
            renderTimer();
            const draftFromParent = data && data.draft && typeof data.draft === 'object'
                ? data.draft
                : null;
            const initializedInlineSuite = contextSuiteSequence.length
                ? await initializeInlineSimulationSuite(Object.assign({}, data, {
                    suiteSequence: contextSuiteSequence,
                    flowMode: 'simulation'
                }), {
                    skipDraftSync: true,
                    silent: true
                })
                : false;
            const draft = draftFromParent || (initializedInlineSuite ? null : restoreSimulationDraftMirror());
            if (draft && !initializedInlineSuite) {
                applyDraftToDom(draft);
                state.simulationDraftFingerprint = buildDraftFingerprint(draft);
                persistSimulationDraftMirror(cloneDraftSafely(draft));
            }
            refreshSimulationDraftSyncLifecycle();
            updateNavStatuses();
            return;
        }
        if (type === 'ENDLESS_COUNTDOWN') {
            var countdownSeconds = Number(data && data.seconds);
            if (Number.isFinite(countdownSeconds) && countdownSeconds > 0) {
                state.endlessCountdownSeconds = Math.ceil(countdownSeconds);
                state.endlessCountdownEndTime = Date.now() + state.endlessCountdownSeconds * 1000;
                var timer = document.getElementById('timer');
                if (timer) timer.classList.add('endless-countdown');
            }
            return;
        }
        if (type === 'ENDLESS_COUNTDOWN_TICK') {
            var tickSeconds = Number(data && data.seconds);
            if (Number.isFinite(tickSeconds)) {
                state.endlessCountdownSeconds = Math.max(0, Math.ceil(tickSeconds));
                state.endlessCountdownEndTime = Date.now() + state.endlessCountdownSeconds * 1000;
                var timerEl = document.getElementById('timer');
                if (timerEl) timerEl.classList.add('endless-countdown');
            }
            return;
        }
        if (type === 'ENDLESS_COUNTDOWN_END') {
            state.endlessCountdownSeconds = 0;
            state.endlessCountdownEndTime = null;
            var timerEnd = document.getElementById('timer');
            if (timerEnd) timerEnd.classList.remove('endless-countdown');
            return;
        }
        if (type === 'SUITE_FORCE_CLOSE') {
            state.simulationContextReady = false;
            stopSimulationDraftSync();
            clearSimulationDraftMirror();
            state.simulationDraftFingerprint = '';
            try {
                global.close();
            } catch (_) {
                // ignore
            }
        }
    }

    function attachMessageBridge() {
        global.addEventListener('message', handleIncoming);
    }

    function attachPracticeTimerBridge() {
        global.addEventListener(PRACTICE_TIMER_EVENT, (event) => {
            const detail = event && event.detail && typeof event.detail === 'object'
                ? event.detail
                : null;
            if (!detail || typeof detail.running !== 'boolean') {
                return;
            }
            syncPagePauseState(detail.running);
        });
    }

    async function bootstrap() {
        parseQuery();
        captureDom();
        const dataset = await ensureDataset();
        renderDataset(dataset);
        updateRedesignedSubHeader();
        buildQuestionNav();
        attachNavListeners();
        attachFloatingNavListeners();
        attachMemorizeLocatorListeners();
        attachDragDrop();
        attachPaneResizer();

        // Ensure drag items can return home when replaced or discarded
        function initDragPools() {
            document.querySelectorAll('.pool-items').forEach((pool, index) => {
                if (!pool.id) {
                    pool.id = `practice-pool-${index}`;
                }
            });
            document.querySelectorAll('.pool-items .drag-item').forEach((item) => {
                if (!item.dataset.originPool) {
                    const pool = item.closest('.pool-items');
                    if (pool?.id) {
                        item.dataset.originPool = pool.id;
                    }
                }
            });
        }
        initDragPools();

        attachUnifiedTimer();
        attachUnifiedPanels();
        attachSelectionHighlightToolbar();
        attachReviewHighlightDictionary();
        attachActionListeners();
        attachMessageBridge();
        attachPracticeTimerBridge();
        syncSuiteModeState();
        setExitButtonVisible(false);
        if (state.memorizeMode) {
            await renderMemorizeStudyLayer();
        }
        updateNavStatuses();
        refreshSimulationDraftSyncLifecycle();
        startInitLoop();
    }

    document.addEventListener('DOMContentLoaded', () => {
        bootstrap().catch((error) => {
            console.error('[UnifiedReadingPage] 初始化失败:', error);
            if (dom.groups) {
                dom.groups.innerHTML = `<div class="group"><h4>加载失败</h4><p>${error.message}</p></div>`;
            }
        });
    });
})(typeof window !== 'undefined' ? window : globalThis);
