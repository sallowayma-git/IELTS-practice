(function initUnifiedReadingPage(global) {
    'use strict';

    const MESSAGE_SOURCE = 'practice_page';
    const INIT_RETRY_MS = 1500;
    const SIMULATION_DRAFT_SYNC_MS = 1200;
    const READING_DRAFT_SYNC_MS = 1500;
    const SUBMIT_ACK_TIMEOUT_MS = 10000;
    const NOTE_EDITOR_SAVE_DEBOUNCE_MS = 450;
    const NOTE_ROW_LONG_PRESS_MS = 100;
    const EXPLANATION_STYLE_ID = 'reading-explanation-style';
    const MEMORIZE_STYLE_ID = 'reading-memorize-style';
    const READING_NOTE_STYLE_ID = 'reading-note-style';
    const READING_DISPLAY_CONTROL_STYLE_ID = 'reading-display-control-style';
    const PRACTICE_TIMER_BRIDGE_KEY = '__IELTS_PRACTICE_TIMER__';
    const PRACTICE_TIMER_EVENT = 'practiceTimerStateChange';
    const READING_CANDIDATE_CODE_PATTERN = /^\d{6}$/;
    const HOST_MESSAGE_SOURCE = 'exam_host';
    let readingCandidateCodeCache = { mode: 'auto', customCode: '' };

    function deriveReferrerOrigin() {
        try {
            if (!document.referrer) return '';
            const parsed = new URL(document.referrer, global.location.href);
            // File-page refs do not provide a usable web origin, so bind them through
            // the opaque/file message-origin handling below instead of pinning file://.
            if (parsed.protocol === 'file:') return '';
            if (!parsed.origin || parsed.origin === 'null' || parsed.origin === 'file://') return '';
            return parsed.origin;
        } catch (_) {
            return '';
        }
    }
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
    const PART_ORDER = ['p1', 'p2', 'p3'];
    const navStatus = new Map();
    const scriptCache = new Map();
    const LOCATOR_HIGHLIGHT_SELECTOR = '.reading-locator-highlight, .reading-locator-block';
    const LOCATOR_OVERLAP_SELECTOR = '.reading-locator-overlap';
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
        timerExpired: false,
        timerExpiryHandled: false,
        timerLocked: false,
        ready: false,
        submitted: false,
        submissionStatus: 'draft',
        submissionId: '',
        submissionAckTimer: null,
        pendingSubmissionPresentation: null,
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
            activating: false,
            activationGeneration: 0
        },
        simulationDraftSyncTimer: null,
        simulationDraftFingerprint: '',
        readingDraftSyncTimer: null,
        readingDraftFingerprint: '',
        notes: [],
        noteOutlines: [],
        markedQuestions: [],
        activeNoteId: '',
        noteEditorPosition: null,
        noteUiInitialized: false,
        noteEditorSaveTimer: null,
        noteDrawerDirty: true,
        noteHighlightMetaDirty: true,
        noteEditorPendingSync: false,
        reviewRecordId: '',
        // 单篇阅读 final-submit 成功后，宿主通过 PRACTICE_RECORD_SAVED 回传的已存档
        // practice record id。持有该 id 时，笔记编辑在只读提交页仍然可写，并且
        // syncReadingAnnotation 会以该 recordId 发送 READING_ANNOTATION_SYNC，把
        // 结果页上的笔记改动持久化回已存档的练习记录。
        submittedRecordId: '',
        highlightVisibility: {
            locators: true,
            notes: true,
            highlights: true
        },
        questionNavCollapsed: false,
        lastInitSignature: '',
        lastReplaySignature: '',
        sessionReadySent: false,
        parentWindow: global.opener || global.parent || null,
        expectedParentOrigin: deriveReferrerOrigin(),
        parentOrigin: '',
        parentOriginIsOpaque: false,
        windowSessionToken: '',
        windowSessionIssuedAtMs: 0,
        windowSessionGeneration: 0
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
        keepToolbar: false,
        noteDragFrame: null,
        noteListDragging: false,
        noteSuppressClickUntil: 0
    };
    const testOverrides = {
        renderExplanations: null
    };

    function parseOptionalNumber(value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'string' && !value.trim()) {
            return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function parseOptionalNonNegativeInteger(value) {
        const numeric = parseOptionalNumber(value);
        if (!Number.isFinite(numeric) || numeric < 0) {
            return null;
        }
        return Math.floor(numeric);
    }

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

    function readReadingTimerPreferences() {
        const manager = global.PracticeTimerPreferences;
        if (manager && typeof manager.read === 'function') {
            return manager.read('reading');
        }
        return {
            version: 1,
            mode: 'elapsed',
            countdownMinutes: 60,
            limitEnabled: false,
            limitMinutes: 60,
            expiryAction: 'warn'
        };
    }

    function minutesToSeconds(value, fallbackMinutes = 60) {
        const manager = global.PracticeTimerPreferences;
        if (manager && typeof manager.minutesToSeconds === 'function') {
            return manager.minutesToSeconds(value);
        }
        const numeric = Number(value);
        const minutes = Number.isFinite(numeric)
            ? Math.min(240, Math.max(1, Math.round(numeric)))
            : fallbackMinutes;
        return minutes * 60;
    }

    function setTimerLockMode(enabled) {
        const locked = Boolean(enabled);
        state.timerLocked = locked;
        document.body.classList.toggle('timer-locked-mode', locked);
        document.querySelectorAll('input, textarea, select').forEach((control) => {
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
                control.disabled = locked || state.readOnly;
            }
        });
        if (dom.resetBtn) dom.resetBtn.disabled = locked || state.readOnly;
        document.querySelectorAll('#reading-note-drawer [data-note-outline-add], #reading-note-drawer [data-note-outline-toggle], #reading-note-drawer [data-note-outline-title], #reading-note-drawer [data-note-outline-delete], #reading-note-drawer [data-note-drag-handle], #reading-note-drawer [data-note-delete]').forEach((control) => {
            if ('disabled' in control) control.disabled = locked;
        });
        disableDragInteractions();
    }

    function handleTimerExpired(preferences) {
        if (state.timerExpiryHandled || state.submitted || state.readOnly || state.reviewMode || state.memorizeMode) {
            return;
        }
        state.timerExpiryHandled = true;
        const action = preferences && preferences.expiryAction ? preferences.expiryAction : 'warn';
        if (action === 'auto-submit') {
            global.setTimeout(() => {
                if (!state.submitted && !state.readOnly) {
                    handleSubmit();
                }
            }, 0);
            return;
        }
        if (action === 'lock') {
            setTimerLockMode(true);
        }
    }

    function hashReadingCandidateCode(sourceId) {
        const source = String(sourceId || '');
        if (!source) {
            return '';
        }
        let hash = 0;
        source.split('').forEach((char) => {
            hash = ((hash << 5) - hash) + char.charCodeAt(0);
            hash |= 0;
        });
        return String(Math.abs(hash) % 900000 + 100000);
    }

    function readReadingCandidateCodePreferences() {
        return { ...readingCandidateCodeCache };
    }

    async function loadReadingCandidateCodePreferences() {
        await global.AppData.ready;
        const stored = await global.AppData.preferences.getCandidateCode();
        const mode = stored?.mode === 'custom' ? 'custom' : 'auto';
        const customCode = typeof stored?.customCode === 'string' ? stored.customCode.replace(/\D/g, '').slice(0, 6) : '';
        readingCandidateCodeCache = { mode, customCode: READING_CANDIDATE_CODE_PATTERN.test(customCode) ? customCode : '' };
    }

    function resolveReadingCandidateCode() {
        const preferences = readReadingCandidateCodePreferences();
        if (preferences.mode === 'custom' && preferences.customCode) {
            return preferences.customCode;
        }
        return hashReadingCandidateCode(state.suiteSessionId || state.sessionId || '');
    }

    function renderTimer() {
        const timer = document.getElementById('timer');
        if (!timer) return;
        const preferences = readReadingTimerPreferences();
        var displaySeconds;
        var elapsed = getPageElapsedSeconds();
        var limitSeconds;
        const isSuiteTimer = Boolean(state.suiteSessionId);
        const suiteTimerMode = isSuiteTimer && state.suiteTimerMode === 'elapsed'
            ? 'elapsed'
            : (isSuiteTimer ? 'countdown' : '');
        const rawLimitSeconds = Number(state.suiteTimerLimitSeconds);
        if (Number.isFinite(rawLimitSeconds) && rawLimitSeconds > 0) {
            limitSeconds = Math.floor(rawLimitSeconds);
        } else if (state.suiteSessionId && state.suiteTimerMode === 'countdown') {
            limitSeconds = minutesToSeconds(60, 60);
        } else if (preferences.limitEnabled) {
            limitSeconds = minutesToSeconds(preferences.limitMinutes, 60);
        } else {
            limitSeconds = null;
        }
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
        } else if (suiteTimerMode === 'countdown') {
            displaySeconds = Math.max(0, Number(limitSeconds || 0) - elapsed);
            var suiteRemainingMinutes = Math.max(0, Math.ceil(displaySeconds / 60));
            timer.textContent = suiteRemainingMinutes + ' minutes remaining';
        } else if (suiteTimerMode === 'elapsed') {
            displaySeconds = elapsed;
            timer.textContent = formatTimerSeconds(displaySeconds);
        } else if (preferences.mode === 'countdown') {
            const countdownSeconds = minutesToSeconds(preferences.countdownMinutes, 60);
            displaySeconds = Math.max(0, countdownSeconds - elapsed);
            timer.textContent = formatTimerSeconds(displaySeconds);
        } else {
            displaySeconds = elapsed;
            timer.textContent = formatTimerSeconds(displaySeconds);
        }
        var hasEndlessCountdown = state.endlessCountdownEndTime && Number.isFinite(state.endlessCountdownEndTime);
        var countdownExpired = !isSuiteTimer && preferences.mode === 'countdown' && !hasEndlessCountdown && displaySeconds <= 0;
        var limitExpired = suiteTimerMode === 'countdown'
            ? Number.isFinite(Number(limitSeconds)) && Number(limitSeconds) > 0 && elapsed >= Number(limitSeconds)
            : (!isSuiteTimer && Number.isFinite(Number(limitSeconds)) && Number(limitSeconds) > 0 && elapsed >= Number(limitSeconds));
        var expired = Boolean(countdownExpired || limitExpired);
        state.timerExpired = expired;
        if (expired) {
            handleTimerExpired(preferences);
        }
        timer.classList.toggle('paused', !interaction.timerRunning && !hasEndlessCountdown);
        timer.classList.toggle('timer-expired', expired);
        if (timer.dataset) {
            timer.dataset.timerMode = suiteTimerMode || preferences.mode;
            timer.dataset.expiryAction = preferences.expiryAction;
        }
        timer.style.opacity = (interaction.timerRunning || hasEndlessCountdown) ? '1' : '0.5';
        var _warnRemaining = !hasEndlessCountdown
            && (
                suiteTimerMode === 'countdown'
                || (!isSuiteTimer && (
                    preferences.mode === 'countdown'
                    || (Number.isFinite(Number(limitSeconds)) && Number(limitSeconds) > 0)
                ))
            )
            && Number.isFinite(Number(displaySeconds))
            ? Math.max(0, Number(displaySeconds))
            : null;
        if (_warnRemaining !== null) {
            timer.classList.remove('countdown-warn-10', 'countdown-warn-5', 'countdown-expired');
            if (_warnRemaining <= 0) {
                timer.classList.add('countdown-expired');
                if (state.suiteTimerMode === 'countdown'
                    && Number.isFinite(rawLimitSeconds)
                    && rawLimitSeconds > 0
                    && !state.countdownExpiredAutoSubmit
                    && !state.submitted) {
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
        if (!canEditReadingNotes()) {
            toolbar.style.display = 'none';
            return;
        }
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
        if (!canEditReadingNotes()) {
            if (toolbar) toolbar.style.display = 'none';
            return;
        }
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
        if (kind === 'note') {
            const note = ensureNoteForHighlight(span, normalizeNoteText(span.textContent), { sync: false });
            if (note) openNoteEditor(note.id, { anchorNode: span, focusBody: true });
        }
        syncReadingAnnotation('highlight');
    }

    function removeSelectionHighlight() {
        const toolbar = document.getElementById('selbar');
        if (!canEditReadingNotes()) {
            if (toolbar) toolbar.style.display = 'none';
            return;
        }
        const selection = global.getSelection();
        let target = interaction.currentHighlightNode;
        if (!target && interaction.lastRange) {
            const ancestor = interaction.lastRange.commonAncestorContainer;
            target = ancestor.nodeType === Node.TEXT_NODE
                ? ancestor.parentElement?.closest('.hl')
                : ancestor.closest?.('.hl');
        }
        const removedNoteId = target instanceof HTMLElement ? String(target.dataset.noteId || '') : '';
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
        if (removedNoteId) deleteNote(removedNoteId, { sync: false });
        syncReadingAnnotation('unhighlight');
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
            if (!canEditReadingNotes()) return;
            let targetNode = interaction.currentHighlightNode;
            let text = '';

            if (targetNode) {
                if (targetNode.dataset.hlType !== 'note') {
                    targetNode.dataset.hlType = 'note';
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

            if (targetNode && text) {
                const note = ensureNoteForHighlight(targetNode, text);
                closeFloatingPanels();
                if (note) openNoteEditor(note.id, { anchorNode: targetNode, focusBody: true });
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
        dom.divider = document.querySelector('.shell > #divider');
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
        let requestUrl = url;
        try {
            const params = new URLSearchParams(global.location?.search || '');
            const assetVersion = String(params.get('v') || '').trim();
            if (assetVersion) {
                const resolved = new URL(url, document.baseURI);
                if (resolved.origin === global.location.origin) {
                    resolved.searchParams.set('v', assetVersion);
                    requestUrl = resolved.href;
                }
            }
        } catch (_) { }
        if (scriptCache.has(requestUrl)) {
            return scriptCache.get(requestUrl);
        }
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = requestUrl;
            script.defer = true;
            script.onload = () => resolve(true);
            script.onerror = () => reject(new Error(`reading_exam_script_failed:${requestUrl}`));
            document.head.appendChild(script);
        });
        scriptCache.set(requestUrl, promise);
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
        if (state.noteUiInitialized) {
            return formatNotesForLegacyText(state.notes);
        }
        const noteArea = document.querySelector('#notes-panel textarea');
        return noteArea ? String(noteArea.value || '') : '';
    }

    function setNotesText(value) {
        const noteArea = document.querySelector('#notes-panel textarea');
        if (noteArea) {
            noteArea.value = String(value || '');
        }
    }

    function generateNoteId() {
        return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function generateNoteOutlineId() {
        return `outline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function normalizeNoteText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function buildDefaultNoteTitle(quote = '') {
        const text = normalizeNoteText(quote);
        if (!text) return 'Untitled note';
        return text.length > 36 ? `${text.slice(0, 36)}...` : text;
    }

    function compareNoteOrder(a, b) {
        const orderA = Number.isFinite(Number(a?.order)) ? Number(a.order) : 0;
        const orderB = Number.isFinite(Number(b?.order)) ? Number(b.order) : 0;
        if (orderA !== orderB) return orderA - orderB;
        return Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
    }

    function normalizeNotes(rawNotes) {
        const seen = new Set();
        return (Array.isArray(rawNotes) ? rawNotes : []).map((entry, index) => {
            if (!entry || typeof entry !== 'object') return null;
            let id = entry.id != null ? String(entry.id).trim() : '';
            if (!id || seen.has(id)) id = generateNoteId();
            seen.add(id);
            const createdAt = Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now();
            return {
                id,
                title: entry.title != null ? String(entry.title) : '',
                body: entry.body != null ? String(entry.body) : '',
                quote: entry.quote != null ? String(entry.quote) : '',
                outlineId: entry.outlineId != null ? String(entry.outlineId).trim() : '',
                order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : index,
                createdAt,
                updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : createdAt
            };
        }).filter(Boolean);
    }

    function normalizeNoteOutlines(rawOutlines) {
        const seen = new Set();
        return (Array.isArray(rawOutlines) ? rawOutlines : []).map((entry, index) => {
            if (!entry || typeof entry !== 'object') return null;
            let id = entry.id != null ? String(entry.id).trim() : '';
            if (!id || seen.has(id)) id = generateNoteOutlineId();
            seen.add(id);
            const createdAt = Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now();
            return {
                id,
                title: String(entry.title || '').trim() || 'New outline',
                order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : index,
                collapsed: Boolean(entry.collapsed),
                createdAt,
                updatedAt: Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : createdAt
            };
        }).filter(Boolean).sort(compareNoteOrder);
    }

    function sanitizeNotesWithOutlines(rawNotes, rawOutlines) {
        const noteOutlines = normalizeNoteOutlines(rawOutlines);
        const validIds = new Set(noteOutlines.map((outline) => outline.id));
        const notes = normalizeNotes(rawNotes).map((note, index) => ({
            ...note,
            outlineId: validIds.has(note.outlineId) ? note.outlineId : '',
            order: Number.isFinite(Number(note.order)) ? Number(note.order) : index
        }));
        return { notes, noteOutlines };
    }

    function collectNotes() {
        return normalizeNotes(state.notes);
    }

    function collectNoteOutlines() {
        return normalizeNoteOutlines(state.noteOutlines);
    }

    function getNoteById(noteId) {
        const id = String(noteId || '').trim();
        return id ? state.notes.find((note) => note && note.id === id) || null : null;
    }

    function getValidNoteOutlineId(outlineId) {
        const id = String(outlineId || '').trim();
        return id && state.noteOutlines.some((outline) => outline.id === id) ? id : '';
    }

    function sortNotesForDrawer(notes = state.notes) {
        return (Array.isArray(notes) ? notes : []).filter(Boolean).slice().sort(compareNoteOrder);
    }

    function getNextNoteOrder(outlineId = '') {
        const id = getValidNoteOutlineId(outlineId);
        const matching = state.notes.filter((note) => (note?.outlineId || '') === id);
        return matching.length
            ? Math.max(...matching.map((note) => Number.isFinite(Number(note.order)) ? Number(note.order) : 0)) + 1
            : 0;
    }

    function formatNotesForLegacyText(notes = state.notes) {
        return normalizeNotes(notes).map((note) => {
            const parts = [`# ${String(note.title || '').trim() || 'Untitled note'}`];
            if (note.quote) parts.push(`> ${normalizeNoteText(note.quote)}`);
            if (note.body) parts.push(note.body);
            return parts.join('\n');
        }).join('\n\n');
    }

    function syncNotesToLegacyText() {
        setNotesText(formatNotesForLegacyText(state.notes));
    }

    function normalizeMarkedQuestions(rawQuestions) {
        const seen = new Set();
        return (Array.isArray(rawQuestions) ? rawQuestions : []).map((entry) => (
            normalizeQuestionId(entry) || String(entry || '').trim().toLowerCase()
        )).filter(Boolean).filter((entry) => {
            if (seen.has(entry)) return false;
            seen.add(entry);
            return true;
        });
    }

    function getCurrentMarkedQuestions() {
        let marks = [];
        let hostResolved = false;
        if (typeof global.getPracticeMarkedQuestions === 'function') {
            try {
                const raw = global.getPracticeMarkedQuestions();
                hostResolved = raw != null;
                marks = normalizeMarkedQuestions(raw);
            } catch (_) { marks = []; }
        }
        // 只有当 host 没有 give 出结果时（函数不存在或抛错）才回退到缓存；
        // 用户清空最后一个标记时 host 会返回 []，这是有效空集，不能再被 state.markedQuestions 复活，
        // 否则清空无法持久，并会在后续 draft/annotation sync 中重新写入旧标记。
        if (!hostResolved && !marks.length) {
            marks = normalizeMarkedQuestions(state.markedQuestions);
        }
        state.markedQuestions = marks.slice();
        return marks;
    }

    function buildEmptyDraft() {
        return {
            answers: {},
            highlights: [],
            noteText: '',
            notes: [],
            noteOutlines: [],
            markedQuestions: [],
            scrollY: 0,
            updatedAt: Date.now()
        };
    }

    function cloneDraftRecord(draft) {
        const source = draft && typeof draft === 'object' ? draft : {};
        return {
            answers: source.answers && typeof source.answers === 'object'
                ? { ...source.answers }
                : {},
            highlights: Array.isArray(source.highlights)
                ? source.highlights.slice()
                : [],
            noteText: typeof source.noteText === 'string'
                ? source.noteText
                : '',
            notes: normalizeNotes(source.notes),
            noteOutlines: normalizeNoteOutlines(source.noteOutlines),
            markedQuestions: normalizeMarkedQuestions(source.markedQuestions),
            scrollY: Number.isFinite(Number(source.scrollY))
                ? Number(source.scrollY)
                : 0,
            updatedAt: Number.isFinite(Number(source.updatedAt))
                ? Number(source.updatedAt)
                : null
        };
    }

    function shouldKeepBaseDraft(baseDraft, nextDraft) {
        const baseUpdatedAt = Number(baseDraft && baseDraft.updatedAt);
        const nextUpdatedAt = Number(nextDraft && nextDraft.updatedAt);
        return Number.isFinite(baseUpdatedAt)
            && baseUpdatedAt > 0
            && (!Number.isFinite(nextUpdatedAt) || nextUpdatedAt <= baseUpdatedAt);
    }

    function mergeDraft(baseDraft, nextDraft) {
        const base = cloneDraftRecord(baseDraft);
        const next = cloneDraftRecord(nextDraft);
        if (shouldKeepBaseDraft(base, next)) {
            return Object.assign(buildEmptyDraft(), base, {
                updatedAt: Number.isFinite(Number(base.updatedAt)) ? Number(base.updatedAt) : Date.now()
            });
        }
        const mergedUpdatedAt = Number.isFinite(Number(next.updatedAt))
            ? Number(next.updatedAt)
            : (Number.isFinite(Number(base.updatedAt)) ? Number(base.updatedAt) : Date.now());
        const merged = Object.assign(buildEmptyDraft(), base, next, {
            answers: next.answers && typeof next.answers === 'object'
                ? { ...next.answers }
                : { ...base.answers },
            highlights: Array.isArray(next.highlights)
                ? next.highlights.slice()
                : base.highlights.slice(),
            noteText: typeof next.noteText === 'string'
                ? next.noteText
                : base.noteText,
            notes: Array.isArray(nextDraft?.notes) ? normalizeNotes(next.notes) : normalizeNotes(base.notes),
            noteOutlines: Array.isArray(nextDraft?.noteOutlines)
                ? normalizeNoteOutlines(next.noteOutlines)
                : normalizeNoteOutlines(base.noteOutlines),
            markedQuestions: Array.isArray(nextDraft?.markedQuestions)
                ? normalizeMarkedQuestions(next.markedQuestions)
                : normalizeMarkedQuestions(base.markedQuestions),
            scrollY: Number.isFinite(Number(next.scrollY))
                ? Number(next.scrollY)
                : base.scrollY,
            updatedAt: mergedUpdatedAt
        });
        const sanitized = sanitizeNotesWithOutlines(merged.notes, merged.noteOutlines);
        merged.notes = sanitized.notes;
        merged.noteOutlines = sanitized.noteOutlines;
        return merged;
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

    function captureInlineSuiteDraftBeforeReinit(reason = 'reinit') {
        if (!state.suite?.inline || !state.suiteSessionId) {
            return null;
        }
        const draft = updateActiveSlotFromCurrentDom(reason);
        if (!draft) {
            return null;
        }
        persistSimulationDraftMirror(cloneDraftSafely(draft));
        return draft;
    }

    function shouldIgnoreInlineSuiteEnvelope(data = {}) {
        if (!state.suite?.inline) {
            return false;
        }
        const incomingExamId = data && data.examId != null ? String(data.examId).trim() : '';
        const currentExamId = state.suite?.activeExamId != null
            ? String(state.suite.activeExamId).trim()
            : (state.examId != null ? String(state.examId).trim() : '');
        if (incomingExamId && currentExamId && incomingExamId !== currentExamId) {
            return true;
        }
        const incomingSuiteSessionId = data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '';
        const currentSuiteSessionId = state.suiteSessionId != null ? String(state.suiteSessionId).trim() : '';
        if (state.sessionReadySent && incomingSuiteSessionId && currentSuiteSessionId && incomingSuiteSessionId !== currentSuiteSessionId) {
            return true;
        }
        const incomingSessionId = data && data.sessionId != null ? String(data.sessionId).trim() : '';
        const currentSessionId = state.sessionId != null ? String(state.sessionId).trim() : '';
        if (state.sessionReadySent && incomingSessionId && currentSessionId && incomingSessionId !== currentSessionId) {
            return true;
        }
        return false;
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
            notes: collectNotes(),
            noteOutlines: collectNoteOutlines(),
            markedQuestions: getCurrentMarkedQuestions(),
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

    function syncInlineSuiteIdentity() {
        if (!state.suite?.inline || !state.examId) {
            return;
        }
        try {
            document.body.dataset.examId = state.examId;
        } catch (_) {
            // ignore DOM dataset failures
        }
        try {
            if (!global.history || typeof global.history.replaceState !== 'function') {
                return;
            }
            const url = new URL(global.location.href);
            url.searchParams.set('examId', state.examId);
            url.searchParams.set('dataKey', state.dataKey || state.examId);
            if (Number.isInteger(state.suite.currentIndex)) {
                url.searchParams.set('suiteSequenceIndex', String(state.suite.currentIndex));
            }
            if (Array.isArray(state.suite.sequence) && state.suite.sequence.length) {
                url.searchParams.set('suiteSequenceTotal', String(state.suite.sequence.length));
            }
            global.history.replaceState(global.history.state, '', url.toString());
        } catch (_) {
            // keep navigation working even when URL mutation is unavailable
        }
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

    function isCurrentSuiteActivation(examId, activationGeneration) {
        return Boolean(
            state.suite?.inline
            && state.suite.activationGeneration === activationGeneration
            && state.suite.activeExamId === examId
            && state.examId === examId
        );
    }

    async function restoreActiveSuiteSlotPresentation(slot, activationGeneration) {
        const targetExamId = String(slot?.examId || '').trim();
        const isCurrentActivation = () => isCurrentSuiteActivation(targetExamId, activationGeneration);
        if (!isCurrentActivation()) {
            return false;
        }
        const shouldShowResults = Boolean(
            slot?.lastResults
            && (state.readOnly || state.reviewMode || state.submitted)
        );
        if (shouldShowResults) {
            renderResults(slot.lastResults);
            await renderExplanations({
                dataKey: slot.dataKey || targetExamId,
                examId: targetExamId,
                isCurrent: isCurrentActivation
            });
            if (!isCurrentActivation()) {
                return false;
            }
            applyHighlights(Array.isArray(slot.draft?.highlights) ? slot.draft.highlights : []);
            refreshNoteHighlightAttributes();
            restoreMissingNoteAnchors();
            applyMemorizeLocatorHighlights();
            enhanceReviewHighlights();
        }
        updateNavStatuses(shouldShowResults ? slot.lastResults : null);
        if (state.readOnly) {
            setReadOnlyMode(true, state.readOnlyReason);
        }
        if (state.timerLocked) {
            setTimerLockMode(true);
        } else {
            disableDragInteractions();
        }
        syncPrimaryActionButtons();
        return true;
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
        const activationGeneration = (Number(state.suite.activationGeneration) || 0) + 1;
        state.suite.activationGeneration = activationGeneration;
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
        interaction.currentHighlightNode = null;
        renderDataset(slot.dataset);
        refreshDynamicQuestionEnhancements();
        clearCurrentAnswers();
        applyDraftToDom(slot.draft || buildEmptyDraft());
        syncSimulationCtxForActiveSlot();
        syncInlineSuiteIdentity();
        state.simulationMode = true;
        state.simulationContextReady = true;
        try {
            await restoreActiveSuiteSlotPresentation(slot, activationGeneration);
        } finally {
            if (isCurrentSuiteActivation(targetExamId, activationGeneration)) {
                state.suite.activating = false;
            }
        }
        if (!isCurrentSuiteActivation(targetExamId, activationGeneration)) {
            return false;
        }
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

    function ensureReadingDisplayControlStyles() {
        if (document.getElementById(READING_DISPLAY_CONTROL_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = READING_DISPLAY_CONTROL_STYLE_ID;
        style.textContent = `
            .reading-display-toggle-group{display:inline-flex;align-items:center;gap:4px;padding:2px;border:1px solid #dbe4ef;border-radius:8px;background:#f8fafc}
            .reading-display-toggle{border:0;border-radius:6px;min-width:30px;height:28px;padding:0 8px;cursor:pointer;color:#64748b;background:transparent;font-size:12px;font-weight:700}
            .reading-display-toggle:hover{background:#eef2f7;color:#0f172a}.reading-display-toggle.is-on{background:#dbeafe;color:#1d4ed8}
            body.hide-reading-locators .reading-locator-highlight{background:transparent!important;box-shadow:none!important;outline:none!important}
            body.hide-reading-locators .reading-locator-overlap{text-decoration:none!important;outline:none!important}
            body.hide-reading-locators .reading-passage-locator-target.is-review-jump-target{background:transparent!important;outline:none!important}
            body.hide-reading-notes .hl[data-hl-type="note"],body.hide-reading-notes .hl[data-note-id]{background:transparent!important;color:inherit!important;box-shadow:none!important;outline:none!important;pointer-events:none}
            body.hide-reading-highlights .hl:not([data-hl-type="note"]):not([data-note-id]){background:transparent!important;color:inherit!important;box-shadow:none!important;outline:none!important}
            body.reading-question-nav-collapsed .practice-nav{display:none}
            body.dark-mode .reading-display-toggle-group{background:#1e293b;border-color:#475569;color:#cbd5e1}
        `;
        document.head.appendChild(style);
    }

    function saveReadingDisplayPreferences() {
        global.AppData.preferences.setReadingDisplay({
            highlightVisibility: state.highlightVisibility,
            questionNavCollapsed: state.questionNavCollapsed
        }).catch((error) => console.warn('[ReadingDisplay] 保存失败:', error));
    }

    async function loadReadingDisplayPreferences() {
        try {
            const saved = await global.AppData.preferences.getReadingDisplay();
            if (saved?.highlightVisibility) {
                state.highlightVisibility = {
                    locators: saved.highlightVisibility.locators !== false,
                    notes: saved.highlightVisibility.notes !== false,
                    highlights: saved.highlightVisibility.highlights !== false
                };
            }
            state.questionNavCollapsed = Boolean(saved?.questionNavCollapsed);
        } catch (_) { /* Ignore invalid preference payloads. */ }
        applyReadingDisplayState();
    }

    function applyReadingDisplayState() {
        if (!document.body) return;
        document.body.classList.toggle('hide-reading-locators', state.highlightVisibility.locators === false);
        document.body.classList.toggle('hide-reading-notes', state.highlightVisibility.notes === false);
        document.body.classList.toggle('hide-reading-highlights', state.highlightVisibility.highlights === false);
        document.body.classList.toggle('reading-question-nav-collapsed', state.questionNavCollapsed);
        document.querySelectorAll('[data-highlight-toggle]').forEach((button) => {
            const key = button.getAttribute('data-highlight-toggle');
            const enabled = state.highlightVisibility[key] !== false;
            button.classList.toggle('is-on', enabled);
            button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        });
        const navToggle = document.getElementById('reading-question-nav-toggle');
        if (navToggle) {
            const collapsed = state.questionNavCollapsed;
            // is-on means the question card bar is currently visible.
            navToggle.classList.toggle('is-on', !collapsed);
            navToggle.setAttribute('aria-pressed', collapsed ? 'false' : 'true');
            navToggle.title = collapsed ? '显示题卡' : '隐藏题卡';
            navToggle.textContent = 'Q';
        }
    }

    function ensureReadingDisplayControls() {
        ensureReadingDisplayControlStyles();
        // Remove the legacy floating bottom-right nav toggle if an older session left one behind.
        document.querySelectorAll('body > #reading-question-nav-toggle, body > .reading-question-nav-toggle').forEach((node) => {
            if (node.closest?.('.reading-display-toggle-group')) return;
            node.remove();
        });
        const headerRight = document.querySelector('.header-right');
        if (headerRight && !document.getElementById('reading-display-toggle-group')) {
            const group = document.createElement('div');
            group.id = 'reading-display-toggle-group';
            group.className = 'reading-display-toggle-group';
            group.setAttribute('aria-label', '阅读显示控制');
            group.innerHTML = [
                '<button type="button" class="reading-display-toggle" data-highlight-toggle="locators" title="显示/隐藏答案定位">A</button>',
                '<button type="button" class="reading-display-toggle" data-highlight-toggle="notes" title="显示/隐藏笔记高亮">N</button>',
                '<button type="button" class="reading-display-toggle" data-highlight-toggle="highlights" title="显示/隐藏普通高亮">H</button>',
                '<button type="button" class="reading-display-toggle" id="reading-question-nav-toggle" data-question-nav-toggle title="隐藏题卡" aria-pressed="true">Q</button>'
            ].join('');
            const settingsButton = document.getElementById('settings-btn');
            headerRight.insertBefore(group, settingsButton?.parentNode === headerRight ? settingsButton : null);
            group.addEventListener('click', (event) => {
                const target = event.target instanceof HTMLElement ? event.target : null;
                if (!target) return;
                const navButton = target.closest('[data-question-nav-toggle]');
                if (navButton) {
                    state.questionNavCollapsed = !state.questionNavCollapsed;
                    applyReadingDisplayState();
                    saveReadingDisplayPreferences();
                    return;
                }
                const button = target.closest('[data-highlight-toggle]');
                if (!button) return;
                const key = button.getAttribute('data-highlight-toggle');
                if (!Object.prototype.hasOwnProperty.call(state.highlightVisibility, key)) return;
                state.highlightVisibility[key] = state.highlightVisibility[key] === false;
                applyReadingDisplayState();
                saveReadingDisplayPreferences();
            });
        } else {
            // If the group already exists without the nav toggle (hot reload / partial DOM), attach it.
            const group = document.getElementById('reading-display-toggle-group');
            if (group && !document.getElementById('reading-question-nav-toggle')) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'reading-display-toggle';
                button.id = 'reading-question-nav-toggle';
                button.setAttribute('data-question-nav-toggle', '');
                button.title = '隐藏题卡';
                button.setAttribute('aria-pressed', 'true');
                button.textContent = 'Q';
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    state.questionNavCollapsed = !state.questionNavCollapsed;
                    applyReadingDisplayState();
                    saveReadingDisplayPreferences();
                });
                group.appendChild(button);
            }
        }
        applyReadingDisplayState();
    }

    function ensureReadingNoteStyles() {
        if (document.getElementById(READING_NOTE_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = READING_NOTE_STYLE_ID;
        style.textContent = `
            .hl[data-note-id]{position:relative;cursor:pointer;background:rgba(191,219,254,.78)!important;box-shadow:inset 0 -.52em rgba(147,197,253,.34)}
            .hl[data-note-id].reading-note-flash{outline:2px solid #60a5fa;outline-offset:2px}.reading-notes-btn{position:relative}
            .reading-note-count{position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:#16a34a;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:700;display:none}
            #reading-note-drawer{position:fixed;inset:0 0 0 auto;width:min(360px,92vw);background:#fff;border-left:1px solid #dbe4ef;box-shadow:-18px 0 36px rgba(15,23,42,.16);z-index:3600;transform:translateX(105%);transition:transform 180ms ease;display:flex;flex-direction:column}
            #reading-note-drawer.open{transform:translateX(0)}.reading-note-drawer-head,.reading-note-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #e2e8f0}
            .reading-note-drawer-title{display:flex;align-items:center;gap:8px}.reading-note-drawer-head h3,.reading-note-editor-head h3{margin:0;font-size:16px}.reading-note-list{padding:10px;overflow:auto;flex:1}
            .reading-note-outline{border:1px solid #dbeafe;border-radius:8px;margin-bottom:10px;overflow:hidden;background:#f8fbff}.reading-note-outline-head{display:grid;grid-template-columns:30px 1fr 30px;align-items:center;padding:5px;background:#eff6ff}.reading-note-outline.collapsed .reading-note-outline-body{display:none}
            .reading-note-outline-body,.reading-note-loose-list{min-height:26px;padding:4px 8px}.reading-note-row{display:grid;grid-template-columns:1fr 28px 30px;align-items:center;gap:4px;border-bottom:1px solid #edf2f7}.reading-note-row.dragging{opacity:.45}.reading-note-row.drag-over{box-shadow:inset 0 2px #2563eb}
            .reading-note-open,.reading-note-outline-title{border:0;background:transparent;color:#0f172a;text-align:left;padding:9px 6px;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.reading-note-open:hover{background:#eff6ff;color:#1d4ed8}
            .reading-note-close,.reading-note-delete,.reading-note-outline-toggle,.reading-note-outline-delete,.reading-note-drag-handle,.reading-note-outline-add{border:0;background:transparent;color:#64748b;cursor:pointer;width:30px;height:30px;border-radius:6px}.reading-note-outline-add{background:#eff6ff;color:#1d4ed8;font-size:18px}.reading-note-outline-title-input{min-width:0;border:1px solid #93c5fd;border-radius:5px;padding:6px}
            #reading-note-editor{position:fixed;z-index:3700;width:min(620px,calc(100vw - 24px));height:min(520px,calc(100vh - 24px));min-width:320px;min-height:320px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 22px 50px rgba(15,23,42,.22);display:none;flex-direction:column;overflow:hidden;resize:both}
            .reading-note-editor-head{cursor:move;background:#f8fafc;user-select:none}.reading-note-editor-body{display:flex;flex-direction:column;gap:10px;padding:14px;flex:1;min-height:0}.reading-note-quote{margin:0;color:#475569;background:#eff6ff;border-left:3px solid #60a5fa;padding:8px 10px;max-height:74px;overflow:auto}
            .reading-note-title,.reading-note-body{width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:9px 10px;box-sizing:border-box}.reading-note-title{font-weight:700}.reading-note-body{min-height:190px;resize:vertical;flex:1}
            body.dark-mode #reading-note-drawer,body.dark-mode #reading-note-editor{background:#1e293b;border-color:#475569;color:#e2e8f0}body.dark-mode .reading-note-open,body.dark-mode .reading-note-outline-title{color:#f8fafc}
            @media(max-width:520px){#reading-note-editor{inset:12px!important;width:calc(100vw - 24px);height:calc(100vh - 24px);min-width:0;min-height:0;resize:none}}
        `;
        document.head.appendChild(style);
    }

    function ensureReadingNotesButton() {
        let button = document.getElementById('notes-drawer-btn');
        if (button) return button;
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return null;
        button = document.createElement('button');
        button.id = 'notes-drawer-btn';
        button.type = 'button';
        button.className = 'header-btn reading-notes-btn';
        button.title = 'Notes';
        button.innerHTML = 'Notes<span class="reading-note-count" aria-hidden="true">0</span>';
        headerRight.insertBefore(button, headerRight.firstChild);
        button.addEventListener('click', (event) => { event.stopPropagation(); toggleNotesDrawer(); });
        return button;
    }

    function ensureReadingNotesUi() {
        ensureReadingNoteStyles();
        ensureReadingNotesButton();
        const legacyPanel = document.getElementById('notes-panel');
        const legacyButton = document.getElementById('note-btn');
        if (legacyPanel) { legacyPanel.style.display = 'none'; legacyPanel.setAttribute('aria-hidden', 'true'); }
        if (legacyButton) { legacyButton.style.display = 'none'; legacyButton.setAttribute('aria-hidden', 'true'); }
        let drawer = document.getElementById('reading-note-drawer');
        if (!drawer) {
            drawer = document.createElement('aside');
            drawer.id = 'reading-note-drawer';
            drawer.setAttribute('aria-hidden', 'true');
            drawer.innerHTML = '<div class="reading-note-drawer-head"><div class="reading-note-drawer-title"><h3>Notes</h3><button class="reading-note-outline-add" type="button" data-note-outline-add title="New outline">+</button></div><button class="reading-note-close" type="button" data-note-drawer-close>×</button></div><div class="reading-note-list" data-note-list></div>';
            document.body.appendChild(drawer);
            drawer.addEventListener('click', handleNoteDrawerClick);
            drawer.addEventListener('keydown', handleNoteDrawerKeydown);
            drawer.addEventListener('focusout', handleNoteDrawerFocusOut);
            drawer.addEventListener('dragstart', handleNoteDragStart);
            drawer.addEventListener('dragover', handleNoteDragOver);
            drawer.addEventListener('drop', handleNoteDrop);
            drawer.addEventListener('dragend', clearNoteDragIndicators);
        }
        let editor = document.getElementById('reading-note-editor');
        if (!editor) {
            editor = document.createElement('section');
            editor.id = 'reading-note-editor';
            editor.setAttribute('aria-hidden', 'true');
            editor.innerHTML = '<div class="reading-note-editor-head" data-note-drag-handle><h3>Note</h3><button class="reading-note-close" type="button" data-note-editor-close>×</button></div><div class="reading-note-editor-body"><p class="reading-note-quote" data-note-quote></p><input class="reading-note-title" data-note-title type="text" placeholder="Title"><textarea class="reading-note-body" data-note-body placeholder="Write your note"></textarea></div>';
            document.body.appendChild(editor);
            editor.addEventListener('click', (event) => { if (event.target.closest?.('[data-note-editor-close]')) closeNoteEditor(); });
            editor.querySelector('[data-note-title]')?.addEventListener('input', saveActiveNoteFromEditor);
            editor.querySelector('[data-note-body]')?.addEventListener('input', saveActiveNoteFromEditor);
            editor.querySelector('[data-note-title]')?.addEventListener('change', flushActiveNoteFromEditor);
            editor.querySelector('[data-note-body]')?.addEventListener('change', flushActiveNoteFromEditor);
            attachNoteEditorDrag(editor);
        }
        if (!state.noteUiInitialized) {
            state.noteUiInitialized = true;
            document.addEventListener('click', handleNoteHighlightClick, true);
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') { closeNoteEditor(); closeNotesDrawer(); }
            });
        }
        syncNotesToLegacyText();
        renderNotesDrawer();
        refreshNoteHighlightAttributes();
        return drawer;
    }

    function toggleNotesDrawer() {
        const drawer = ensureReadingNotesUi();
        if (drawer?.classList.contains('open')) closeNotesDrawer();
        else openNotesDrawer();
    }

    function openNotesDrawer() {
        const drawer = ensureReadingNotesUi();
        if (!drawer) return;
        state.noteDrawerDirty = true;
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        renderNotesDrawer();
    }

    function closeNotesDrawer() {
        const drawer = document.getElementById('reading-note-drawer');
        drawer?.classList.remove('open');
        drawer?.setAttribute('aria-hidden', 'true');
    }

    function renderNoteRow(note) {
        const title = String(note.title || '').trim() || 'Untitled note';
        const editable = canEditReadingNotes();
        const disabled = editable ? '' : ' disabled';
        return `<div class="reading-note-row" draggable="${editable}" data-note-row="${escapeHtml(note.id)}"><button class="reading-note-open" type="button" data-note-open="${escapeHtml(note.id)}" title="${escapeHtml(title)}">${escapeHtml(title)}</button><button class="reading-note-drag-handle" type="button" data-note-drag-handle="${escapeHtml(note.id)}" aria-label="Move note"${disabled}>⋮⋮</button><button class="reading-note-delete" type="button" data-note-delete="${escapeHtml(note.id)}" aria-label="Delete note"${disabled}>×</button></div>`;
    }

    function renderNotesDrawer() {
        const count = state.notes.length;
        const badge = document.querySelector('#notes-drawer-btn .reading-note-count');
        if (badge) { badge.textContent = String(count); badge.style.display = count ? 'block' : 'none'; }
        const list = document.querySelector('#reading-note-drawer [data-note-list]');
        if (!list || !state.noteDrawerDirty) return;
        const disabled = canEditReadingNotes() ? '' : ' disabled';
        const notesByOutline = new Map();
        sortNotesForDrawer().forEach((note) => {
            const outlineId = getValidNoteOutlineId(note.outlineId);
            const group = notesByOutline.get(outlineId) || [];
            group.push(note);
            notesByOutline.set(outlineId, group);
        });
        const outlinesHtml = collectNoteOutlines().map((outline) => {
            const notes = notesByOutline.get(outline.id) || [];
            return `<section class="reading-note-outline${outline.collapsed ? ' collapsed' : ''}" data-note-outline="${escapeHtml(outline.id)}"><div class="reading-note-outline-head"><button class="reading-note-outline-toggle" type="button" data-note-outline-toggle="${escapeHtml(outline.id)}"${disabled}>${outline.collapsed ? '›' : '⌄'}</button><button class="reading-note-outline-title" type="button" data-note-outline-title="${escapeHtml(outline.id)}"${disabled}>${escapeHtml(outline.title)}</button><button class="reading-note-outline-delete" type="button" data-note-outline-delete="${escapeHtml(outline.id)}"${disabled}>×</button></div><div class="reading-note-outline-body" data-note-drop-list="${escapeHtml(outline.id)}">${notes.map(renderNoteRow).join('')}</div></section>`;
        }).join('');
        const loose = (notesByOutline.get('') || []).map(renderNoteRow).join('');
        list.innerHTML = count || state.noteOutlines.length
            ? `${outlinesHtml}<div class="reading-note-loose-list" data-note-drop-list="">${loose}</div>`
            : '<div class="reading-note-empty">No notes yet.</div>';
        const add = document.querySelector('#reading-note-drawer [data-note-outline-add]');
        if (add) add.disabled = !canEditReadingNotes();
        state.noteDrawerDirty = false;
    }

    function handleNoteDrawerClick(event) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return;
        if (target.closest('[data-note-drawer-close]')) return closeNotesDrawer();
        if (target.closest('[data-note-outline-add]')) return createNoteOutline();
        const toggle = target.closest('[data-note-outline-toggle]');
        if (toggle) return toggleNoteOutline(toggle.getAttribute('data-note-outline-toggle'));
        const outlineDelete = target.closest('[data-note-outline-delete]');
        if (outlineDelete) return deleteNoteOutline(outlineDelete.getAttribute('data-note-outline-delete'));
        const outlineTitle = target.closest('[data-note-outline-title]');
        if (outlineTitle) return startRenameNoteOutline(outlineTitle.getAttribute('data-note-outline-title'));
        const noteDelete = target.closest('[data-note-delete]');
        if (noteDelete) return deleteNote(noteDelete.getAttribute('data-note-delete'));
        const noteOpen = target.closest('[data-note-open]');
        if (noteOpen) {
            const noteId = noteOpen.getAttribute('data-note-open');
            const anchor = findOrRestoreNoteHighlight(noteId);
            if (anchor) scrollNoteHighlightIntoView(anchor);
            openNoteEditor(noteId, { anchorNode: anchor });
        }
    }

    function upsertNote(rawNote, options = {}) {
        if (!canEditReadingNotes()) return null;
        const normalized = normalizeNotes([rawNote])[0];
        if (!normalized) return null;
        normalized.outlineId = getValidNoteOutlineId(normalized.outlineId);
        const index = state.notes.findIndex((note) => note.id === normalized.id);
        if (index >= 0) state.notes.splice(index, 1, { ...state.notes[index], ...normalized });
        else {
            if (!Number.isFinite(Number(rawNote?.order))) normalized.order = getNextNoteOrder(normalized.outlineId);
            state.notes.push(normalized);
        }
        state.noteDrawerDirty = true;
        state.noteHighlightMetaDirty = true;
        syncNotesToLegacyText();
        if (options.forceUi !== false) { renderNotesDrawer(); refreshNoteHighlightAttributes(normalized.id); }
        if (options.sync !== false) syncReadingAnnotation(options.reason || 'note');
        return getNoteById(normalized.id);
    }

    function setNotes(rawNotes, rawOutlines = [], options = {}) {
        const sanitized = sanitizeNotesWithOutlines(rawNotes, rawOutlines);
        state.notes = sanitized.notes;
        state.noteOutlines = sanitized.noteOutlines;
        if (!state.notes.length && options.legacyText) {
            const legacyText = String(options.legacyText || '');
            if (legacyText.trim()) {
                state.notes = normalizeNotes([{ id: generateNoteId(), title: 'Notes', body: legacyText, quote: '' }]);
            }
        }
        state.noteDrawerDirty = true;
        state.noteHighlightMetaDirty = true;
        ensureReadingNotesUi();
        syncNotesToLegacyText();
        renderNotesDrawer();
        refreshNoteHighlightAttributes();
        restoreMissingNoteAnchors();
    }

    function createNoteOutline() {
        if (!canEditReadingNotes()) return;
        const now = Date.now();
        state.noteOutlines.push({ id: generateNoteOutlineId(), title: 'New outline', order: state.noteOutlines.length, collapsed: false, createdAt: now, updatedAt: now });
        state.noteDrawerDirty = true;
        renderNotesDrawer();
        startRenameNoteOutline(state.noteOutlines[state.noteOutlines.length - 1].id);
        syncReadingAnnotation('note-outline-add');
    }

    function getNoteOutlineById(id) { return state.noteOutlines.find((outline) => outline.id === String(id || '')) || null; }

    function toggleNoteOutline(id) {
        if (!canEditReadingNotes()) return;
        const outline = getNoteOutlineById(id);
        if (!outline) return;
        outline.collapsed = !outline.collapsed;
        outline.updatedAt = Date.now();
        state.noteDrawerDirty = true;
        renderNotesDrawer();
        syncReadingAnnotation('note-outline-toggle');
    }

    function deleteNoteOutline(id) {
        if (!canEditReadingNotes()) return;
        const outlineId = String(id || '');
        state.noteOutlines = state.noteOutlines.filter((outline) => outline.id !== outlineId);
        state.notes.forEach((note) => { if (note.outlineId === outlineId) note.outlineId = ''; });
        state.noteDrawerDirty = true;
        renderNotesDrawer();
        syncReadingAnnotation('note-outline-delete');
    }

    function startRenameNoteOutline(id) {
        if (!canEditReadingNotes()) return;
        const outline = getNoteOutlineById(id);
        const button = document.querySelector(`[data-note-outline-title="${escapeSelector(id)}"]`);
        if (!outline || !button) return;
        const input = document.createElement('input');
        input.className = 'reading-note-outline-title-input';
        input.value = outline.title;
        input.setAttribute('data-note-outline-title-input', outline.id);
        button.replaceWith(input);
        input.focus(); input.select();
    }

    function commitRenameNoteOutline(input, cancel = false) {
        if (!(input instanceof HTMLInputElement) || input.dataset.committed === 'true') return;
        if (!canEditReadingNotes() && !cancel) cancel = true;
        input.dataset.committed = 'true';
        const outline = getNoteOutlineById(input.getAttribute('data-note-outline-title-input'));
        if (outline && !cancel) { outline.title = String(input.value || '').trim() || 'New outline'; outline.updatedAt = Date.now(); }
        state.noteDrawerDirty = true;
        renderNotesDrawer();
        if (!cancel) syncReadingAnnotation('note-outline-rename');
    }

    function handleNoteDrawerKeydown(event) {
        const input = event.target instanceof HTMLElement ? event.target.closest('[data-note-outline-title-input]') : null;
        if (input) {
            if (!canEditReadingNotes() && event.key !== 'Escape') return;
            if (event.key === 'Enter') { event.preventDefault(); commitRenameNoteOutline(input); }
            else if (event.key === 'Escape') { event.preventDefault(); commitRenameNoteOutline(input, true); }
            return;
        }
        const handle = event.target instanceof HTMLElement ? event.target.closest('[data-note-drag-handle]') : null;
        if (!handle || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        if (!canEditReadingNotes()) return;
        event.preventDefault();
        const note = getNoteById(handle.getAttribute('data-note-drag-handle'));
        if (!note) return;
        if (event.key === 'ArrowLeft') note.outlineId = '';
        else if (event.key === 'ArrowRight' && state.noteOutlines[0]) note.outlineId = state.noteOutlines[0].id;
        else {
            const siblings = sortNotesForDrawer().filter((item) => item.outlineId === note.outlineId);
            const index = siblings.findIndex((item) => item.id === note.id);
            const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
            if (targetIndex >= 0 && targetIndex < siblings.length) {
                const targetOrder = siblings[targetIndex].order;
                siblings[targetIndex].order = note.order;
                note.order = targetOrder;
            }
        }
        note.updatedAt = Date.now();
        state.noteDrawerDirty = true;
        renderNotesDrawer();
        syncReadingAnnotation('note-reorder');
    }

    function handleNoteDrawerFocusOut(event) {
        const input = event.target instanceof HTMLInputElement ? event.target.closest('[data-note-outline-title-input]') : null;
        if (input) commitRenameNoteOutline(input);
    }

    let draggedNoteId = '';
    function handleNoteDragStart(event) {
        if (!canEditReadingNotes()) return;
        const row = event.target instanceof HTMLElement ? event.target.closest('[data-note-row]') : null;
        if (!row) return;
        draggedNoteId = row.getAttribute('data-note-row') || '';
        row.classList.add('dragging');
        event.dataTransfer?.setData('text/plain', draggedNoteId);
    }

    function handleNoteDragOver(event) {
        if (!canEditReadingNotes()) return;
        const target = event.target instanceof HTMLElement ? event.target.closest('[data-note-row], [data-note-drop-list]') : null;
        if (!target) return;
        event.preventDefault();
        clearNoteDragIndicators();
        document.querySelector(`[data-note-row="${escapeSelector(draggedNoteId)}"]`)?.classList.add('dragging');
        target.classList.add('drag-over');
    }

    function handleNoteDrop(event) {
        if (!canEditReadingNotes()) return clearNoteDragIndicators();
        event.preventDefault();
        const note = getNoteById(draggedNoteId || event.dataTransfer?.getData('text/plain'));
        const row = event.target instanceof HTMLElement ? event.target.closest('[data-note-row]') : null;
        const list = event.target instanceof HTMLElement ? event.target.closest('[data-note-drop-list]') : null;
        if (!note || (!row && !list)) return clearNoteDragIndicators();
        const outlineId = getValidNoteOutlineId((list || row.closest('[data-note-drop-list]'))?.getAttribute('data-note-drop-list'));
        const siblings = sortNotesForDrawer().filter((item) => item.id !== note.id && (item.outlineId || '') === outlineId);
        const index = row ? Math.max(0, siblings.findIndex((item) => item.id === row.getAttribute('data-note-row'))) : siblings.length;
        siblings.splice(index < 0 ? siblings.length : index, 0, note);
        siblings.forEach((item, order) => { item.outlineId = outlineId; item.order = order; item.updatedAt = Date.now(); });
        state.noteDrawerDirty = true;
        clearNoteDragIndicators();
        renderNotesDrawer();
        syncReadingAnnotation('note-reorder');
    }

    function clearNoteDragIndicators() {
        document.querySelectorAll('.reading-note-row.dragging,.reading-note-row.drag-over,[data-note-drop-list].drag-over').forEach((node) => node.classList.remove('dragging', 'drag-over'));
        draggedNoteId = '';
    }

    function clampNoteEditorPosition(left, top) {
        const editor = document.getElementById('reading-note-editor');
        const margin = 12;
        const width = editor?.offsetWidth || 430;
        const height = editor?.offsetHeight || 330;
        return {
            left: Math.min(Math.max(margin, left), Math.max(margin, global.innerWidth - width - margin)),
            top: Math.min(Math.max(margin, top), Math.max(margin, global.innerHeight - height - margin))
        };
    }

    function positionNoteEditor(anchorNode = null) {
        const editor = document.getElementById('reading-note-editor');
        if (!editor) return;
        let left = Number(state.noteEditorPosition?.left);
        let top = Number(state.noteEditorPosition?.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) {
            const rect = anchorNode?.getBoundingClientRect?.();
            left = rect ? rect.left + Math.min(24, rect.width / 2) : (global.innerWidth - (editor.offsetWidth || 430)) / 2;
            top = rect ? rect.bottom + 10 : (global.innerHeight - (editor.offsetHeight || 330)) / 2;
        }
        const position = clampNoteEditorPosition(left, top);
        editor.style.left = `${Math.round(position.left)}px`;
        editor.style.top = `${Math.round(position.top)}px`;
        state.noteEditorPosition = position;
    }

    function canEditReadingNotes() {
        if (state.timerLocked) return false;
        const activePracticeCanEdit = Boolean(
            !state.readOnly
            && !state.memorizeMode
            && !state.submitted
        );
        const submittedRecordCanEdit = Boolean(
            state.submitted
            && state.submittedRecordId
            && !state.memorizeMode
        );
        return Boolean(state.reviewMode || activePracticeCanEdit || submittedRecordCanEdit);
    }

    function openNoteEditor(noteId, options = {}) {
        ensureReadingNotesUi();
        if (state.activeNoteId && state.activeNoteId !== noteId) flushActiveNoteFromEditor();
        const note = getNoteById(noteId);
        if (!note) return;
        state.activeNoteId = note.id;
        const editor = document.getElementById('reading-note-editor');
        const title = editor?.querySelector('[data-note-title]');
        const body = editor?.querySelector('[data-note-body]');
        const quote = editor?.querySelector('[data-note-quote]');
        if (!editor) return;
        const canEditNotes = canEditReadingNotes();
        if (title) { title.value = note.title || ''; title.disabled = !canEditNotes; }
        if (body) { body.value = note.body || ''; body.disabled = !canEditNotes; }
        if (quote) { quote.textContent = note.quote || ''; quote.style.display = note.quote ? '' : 'none'; }
        editor.style.display = 'flex';
        editor.setAttribute('aria-hidden', 'false');
        global.requestAnimationFrame(() => {
            positionNoteEditor(options.anchorNode || findNoteHighlight(note.id));
            (options.focusBody ? body : title)?.focus();
        });
    }

    function closeNoteEditor() {
        flushActiveNoteFromEditor();
        const editor = document.getElementById('reading-note-editor');
        if (editor) { editor.style.display = 'none'; editor.setAttribute('aria-hidden', 'true'); }
        state.activeNoteId = '';
    }

    function attachNoteEditorDrag(editor) {
        const handle = editor.querySelector('[data-note-drag-handle]');
        if (!handle) return;
        let drag = null;
        const move = (event) => {
            if (!drag) return;
            const next = clampNoteEditorPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
            editor.style.left = `${Math.round(next.left)}px`;
            editor.style.top = `${Math.round(next.top)}px`;
            state.noteEditorPosition = next;
        };
        const stop = () => {
            drag = null;
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', stop);
            document.removeEventListener('pointercancel', stop);
        };
        handle.addEventListener('pointerdown', (event) => {
            if (event.target.closest?.('button')) return;
            const rect = editor.getBoundingClientRect();
            drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', stop);
            document.addEventListener('pointercancel', stop);
            event.preventDefault();
        });
    }

    function clearNoteEditorSaveTimer() {
        if (state.noteEditorSaveTimer) global.clearTimeout(state.noteEditorSaveTimer);
        state.noteEditorSaveTimer = null;
    }

    function saveActiveNoteFromEditor() {
        if (!canEditReadingNotes()) return;
        const note = getNoteById(state.activeNoteId);
        if (!note) return;
        const editor = document.getElementById('reading-note-editor');
        const title = String(editor?.querySelector('[data-note-title]')?.value || '').trim();
        const body = String(editor?.querySelector('[data-note-body]')?.value || '');
        if (title === note.title && body === note.body) return;
        Object.assign(note, { title, body, updatedAt: Date.now() });
        state.noteDrawerDirty = true;
        state.noteHighlightMetaDirty = true;
        state.noteEditorPendingSync = true;
        syncNotesToLegacyText();
        clearNoteEditorSaveTimer();
        state.noteEditorSaveTimer = global.setTimeout(flushActiveNoteFromEditor, NOTE_EDITOR_SAVE_DEBOUNCE_MS);
    }

    function flushActiveNoteFromEditor() {
        if (!canEditReadingNotes()) return;
        const note = getNoteById(state.activeNoteId);
        if (!note) return;
        const editor = document.getElementById('reading-note-editor');
        const title = String(editor?.querySelector('[data-note-title]')?.value || '').trim();
        const body = String(editor?.querySelector('[data-note-body]')?.value || '');
        if (title === note.title && body === note.body && !state.noteEditorPendingSync) return;
        clearNoteEditorSaveTimer();
        state.noteEditorPendingSync = false;
        upsertNote({ ...note, title, body, updatedAt: Date.now() }, { forceUi: true, reason: 'note-edit' });
    }

    function createNoteAnchorSpan(note) {
        const span = document.createElement('span');
        span.className = 'hl';
        span.dataset.hlType = 'note';
        span.dataset.noteId = note.id;
        return span;
    }

    function shouldSkipNoteAnchorTextNode(node) {
        if (!node?.nodeValue?.trim()) return true;
        const element = node.parentElement;
        return Boolean(element?.closest?.('.hl') || getHighlightShared()?.isInsideExplanation?.(node));
    }

    function wrapNoteTextInRoot(root, note, quote) {
        const nodes = getHighlightShared()?.getTextNodes?.(root) || [];
        // 先统计整段里命中次数；saved highlight 缺失才会走到这条兜底路径，若同一引文
        // 多次出现，按“首次命中”绑定会静默定位到错误位置。这里要求全局唯一匹配才绑定，
        // 否则放弃恢复该笔记的锚点，而不是盲目绑到第一个重复位置。
        let matchNode = null;
        let matchIndex = -1;
        let totalMatches = 0;
        for (const node of nodes) {
            if (shouldSkipNoteAnchorTextNode(node)) continue;
            const value = String(node.nodeValue || '');
            let from = 0;
            let idx = value.indexOf(quote, from);
            while (idx >= 0) {
                totalMatches += 1;
                if (!matchNode) {
                    matchNode = node;
                    matchIndex = idx;
                }
                from = idx + quote.length;
                idx = value.indexOf(quote, from);
            }
        }
        if (totalMatches === 0 || totalMatches > 1 || !matchNode) {
            return null;
        }
        const range = document.createRange();
        range.setStart(matchNode, matchIndex); range.setEnd(matchNode, matchIndex + quote.length);
        const span = createNoteAnchorSpan(note);
        try { range.surroundContents(span); return span; } catch (_) { return null; }
    }

    function findRestorableNoteAnchor(note) {
        const quote = normalizeNoteText(note?.quote);
        if (!quote || quote.length < 2) return null;
        // 唯一性的判定需要在整篇 passage 范围内完成；逐 root 绑定会让跨 root
        // 的重复引文被误判为“当前 root 内唯一”。先聚合所有命中，再决定绑定。
        const roots = [dom.left, dom.groups].filter(Boolean);
        let totalMatches = 0;
        let matchRoot = null;
        for (const root of roots) {
            const nodes = getHighlightShared()?.getTextNodes?.(root) || [];
            for (const node of nodes) {
                if (shouldSkipNoteAnchorTextNode(node)) continue;
                const value = String(node.nodeValue || '');
                let from = 0;
                let idx = value.indexOf(quote, from);
                while (idx >= 0) {
                    totalMatches += 1;
                    if (!matchRoot) matchRoot = root;
                    from = idx + quote.length;
                    idx = value.indexOf(quote, from);
                }
            }
        }
        if (totalMatches !== 1 || !matchRoot) return null;
        return wrapNoteTextInRoot(matchRoot, note, quote);
    }

    function restoreMissingNoteAnchors() {
        let count = 0;
        state.notes.forEach((note) => {
            if (!findNoteHighlight(note.id) && findRestorableNoteAnchor(note)) count += 1;
        });
        if (count) { state.noteHighlightMetaDirty = true; refreshNoteHighlightAttributes(); }
        return count;
    }

    function ensureNoteForHighlight(highlightNode, quote = '', options = {}) {
        if (!(highlightNode instanceof HTMLElement)) return null;
        let note = getNoteById(highlightNode.dataset.noteId);
        if (!note && !canEditReadingNotes()) return null;
        if (!note) {
            const now = Date.now();
            note = upsertNote({
                id: highlightNode.dataset.noteId || generateNoteId(),
                title: '', body: '', quote: quote || normalizeNoteText(highlightNode.textContent),
                createdAt: now, updatedAt: now
            }, { sync: false });
        }
        if (note) {
            highlightNode.dataset.noteId = note.id;
            highlightNode.dataset.hlType = 'note';
            state.noteHighlightMetaDirty = true;
            refreshNoteHighlightAttributes(note.id);
            if (options.sync !== false) syncReadingAnnotation('note-anchor');
        }
        return note;
    }

    function ensureNoteAnchorsBeforeSnapshot() {
        document.querySelectorAll('.hl[data-hl-type="note"]').forEach((node) => {
            if (node instanceof HTMLElement && !node.dataset.noteId) {
                ensureNoteForHighlight(node, normalizeNoteText(node.textContent), { sync: false });
            }
        });
    }

    function findNoteHighlight(noteId) {
        const id = String(noteId || '').trim();
        return id ? document.querySelector(`.hl[data-note-id="${escapeSelector(id)}"]`) : null;
    }

    function findOrRestoreNoteHighlight(noteId) {
        const existing = findNoteHighlight(noteId);
        if (existing) return existing;
        const note = getNoteById(noteId);
        return note ? findRestorableNoteAnchor(note) : null;
    }

    function scrollNoteHighlightIntoView(node) {
        node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        node?.classList.add('reading-note-flash');
        global.setTimeout(() => node?.classList.remove('reading-note-flash'), 900);
    }

    function deleteNote(noteId, options = {}) {
        if (!canEditReadingNotes()) return;
        const id = String(noteId || '').trim();
        if (!id) return;
        state.notes = state.notes.filter((note) => note.id !== id);
        document.querySelectorAll(`.hl[data-note-id="${escapeSelector(id)}"]`).forEach((node) => {
            const parent = node.parentNode;
            if (!parent) return;
            while (node.firstChild) parent.insertBefore(node.firstChild, node);
            node.remove(); parent.normalize();
        });
        if (state.activeNoteId === id) { state.activeNoteId = ''; closeNoteEditor(); }
        state.noteDrawerDirty = true;
        state.noteHighlightMetaDirty = true;
        syncNotesToLegacyText();
        renderNotesDrawer();
        if (options.sync !== false) syncReadingAnnotation('note-delete');
    }

    function clearStructuredNotesForReset() {
        if (!canEditReadingNotes()) return;
        clearNoteEditorSaveTimer();
        state.noteEditorPendingSync = false;
        state.activeNoteId = '';
        state.notes = [];
        state.noteOutlines = [];
        state.noteDrawerDirty = true;
        state.noteHighlightMetaDirty = true;
        document.querySelectorAll('.hl[data-note-id], .hl[data-hl-type="note"]').forEach((node) => {
            const parent = node.parentNode;
            if (!parent) return;
            while (node.firstChild) parent.insertBefore(node.firstChild, node);
            node.remove();
            parent.normalize();
        });
        setNotesText('');
        const editor = document.getElementById('reading-note-editor');
        if (editor) {
            editor.querySelectorAll('input, textarea').forEach((field) => { field.value = ''; });
            editor.style.display = 'none';
            editor.setAttribute('aria-hidden', 'true');
        }
        closeNotesDrawer();
        renderNotesDrawer();
    }

    function refreshNoteHighlightAttributes(noteId = '') {
        if (!state.noteHighlightMetaDirty && !noteId) return;
        const selector = noteId ? `.hl[data-note-id="${escapeSelector(noteId)}"]` : '.hl[data-note-id]';
        document.querySelectorAll(selector).forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            const note = getNoteById(node.dataset.noteId);
            const title = String(note?.title || '').trim() || buildDefaultNoteTitle(node.textContent);
            node.dataset.hlType = 'note';
            node.title = `Note: ${title}`;
            node.setAttribute('role', 'button');
            node.tabIndex = 0;
            node.setAttribute('aria-label', `Open note: ${title}`);
        });
        state.noteHighlightMetaDirty = false;
    }

    function handleNoteHighlightClick(event) {
        const highlight = event.target instanceof HTMLElement ? event.target.closest('.hl[data-note-id]') : null;
        if (!highlight) return;
        event.preventDefault(); event.stopPropagation();
        openNoteEditor(highlight.dataset.noteId, { anchorNode: highlight });
    }

    function syncReadingAnnotation(reason = 'note') {
        if (!canEditReadingNotes()) return;
        const isSuiteReviewAnnotation = Boolean(
            state.simulationMode
            && state.suiteReviewMode
            && state.reviewMode
            && state.suiteSessionId
        );
        if (state.simulationMode && (!state.readOnly || isSuiteReviewAnnotation)) {
            syncSimulationDraftSnapshot(reason);
            return;
        }
        if (state.reviewMode) {
            postMessage('READING_ANNOTATION_SYNC', {
                examId: state.examId,
                recordId: state.reviewRecordId || null,
                reviewSessionId: state.reviewSessionId || null,
                sessionId: state.sessionId || null,
                windowSessionToken: state.windowSessionToken || null,
                annotations: {
                    highlights: collectHighlights(),
                    noteText: getNotesText(),
                    notes: collectNotes(),
                    noteOutlines: collectNoteOutlines(),
                    markedQuestions: getCurrentMarkedQuestions(),
                    scrollY: global.scrollY || 0
                },
                reason
            });
            return;
        }
        // 单篇 final-submit 后（submitted=true，reviewMode=false），宿主在保存练习
        // 记录后通过 PRACTICE_RECORD_SAVED 回传 recordId。持有该 id 时，结果页笔记
        // 改动需要以 READING_ANNOTATION_SYNC 直接写回已存档的练习记录，而非走草稿
        // 同步（草稿在提交时已被清除，且 draft 分支在此状态下会被跳过）。
        if (state.submitted && state.submittedRecordId && !state.memorizeMode) {
            postMessage('READING_ANNOTATION_SYNC', {
                examId: state.examId,
                recordId: state.submittedRecordId,
                reviewSessionId: null,
                sessionId: state.sessionId || null,
                windowSessionToken: state.windowSessionToken || null,
                annotations: {
                    highlights: collectHighlights(),
                    noteText: getNotesText(),
                    notes: collectNotes(),
                    noteOutlines: collectNoteOutlines(),
                    markedQuestions: getCurrentMarkedQuestions(),
                    scrollY: global.scrollY || 0
                },
                reason
            });
            return;
        }
        if (!state.readOnly && !state.submitted && !state.memorizeMode) {
            syncReadingDraftSnapshot(reason);
        }
    }

    async function ensureExplanationDataset(options = {}) {
        const targetDataKey = String(options.dataKey || state.dataKey || '').trim();
        const targetExamId = String(options.examId || state.examId || '').trim();
        const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : null;
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
        if (isCurrent && !isCurrent()) {
            return null;
        }
        const entry = manifest[targetDataKey] || manifest[targetExamId];
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
        if (isCurrent && !isCurrent()) {
            return null;
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
            .reading-locator-overlap { cursor:pointer; text-decoration:underline #dc2626 2px; text-underline-offset:3px; }
            .reading-locator-highlight.is-review-jump-target,.reading-locator-overlap.is-review-jump-target { outline:2px solid rgba(37,99,235,.45); outline-offset:2px; }
            .reading-locator-block { display:inline-block;width:1px;height:1em;overflow:hidden;opacity:0;pointer-events:none;vertical-align:baseline; }
            .reading-passage-locator-target.is-review-jump-target { border-radius:4px;outline:2px solid rgba(37,99,235,.38);background:rgba(96,165,250,.12); }
            .results-table .question-jump-btn { border:0;padding:0;background:transparent;color:#2563eb;font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:2px; }
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
        dom.left?.querySelectorAll('.reading-passage-locator-target').forEach((node) => node.classList.remove('reading-passage-locator-target', 'is-review-jump-target'));
        dom.left?.querySelectorAll(LOCATOR_OVERLAP_SELECTOR).forEach((node) => {
            node.classList.remove('reading-locator-overlap', 'is-review-jump-target');
            delete node.dataset.locatorOverlap;
        });
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

    function resolveGroupMarkup(group) {
        const primary = String(group?.bodyHtml || '').trim();
        const fallback = String(group?.leadHtml || group?.html || '').trim();
        const markup = primary || fallback;
        if (!markup) {
            return '';
        }
        // 检查是否有独立的 "group" class（不是 question-group 等）
        const hasGroupClass = /class\s*=\s*["'](?:[^"']*\s)?group(?:\s[^"']*)?["']/i.test(markup);
        if (hasGroupClass) {
            return markup;
        }
        return `<div class="group">${markup}</div>`;
    }

    function createGroupMarkup(group) {
        const questionIds = Array.isArray(group.questionIds) ? group.questionIds.join(',') : '';
        const allowOptionReuseFlag = resolveAllowOptionReuse(group);
        const allowOptionReuse = typeof allowOptionReuseFlag === 'boolean'
            ? ` data-allow-option-reuse="${allowOptionReuseFlag ? 'true' : 'false'}"`
            : '';
        const groupMarkup = resolveGroupMarkup(group);
        return `
            <section class="unified-group" data-group-id="${group.groupId}" data-question-ids="${questionIds}"${allowOptionReuse}>
                ${groupMarkup}
            </section>
        `;
    }

    function sanitizePassageHtml(markup) {
        const template = document.createElement('template');
        template.innerHTML = String(markup || '');
        template.content.querySelectorAll('#divider').forEach((node) => {
            node.remove();
        });
        return template.innerHTML;
    }

    function renderDataset(dataset) {
        clearExplanations();
        const passageHtml = (dataset.passage?.blocks || [])
            .map((block) => block?.bodyHtml || block?.html || '')
            .join('\n');
        const sanitizedPassageHtml = sanitizePassageHtml(passageHtml);
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
            dom.left.innerHTML = sanitizedPassageHtml;
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

    function getPartIndex(partKey) {
        return PART_ORDER.indexOf(partKey);
    }

    function getPartKeyFromCategory(category, fallbackIndex = 0) {
        const normalized = String(category || '').toUpperCase();
        if (normalized === 'P2') return 'p2';
        if (normalized === 'P3') return 'p3';
        if (normalized === 'P1') return 'p1';
        return PART_ORDER[Math.min(PART_ORDER.length - 1, Math.max(0, fallbackIndex))] || 'p1';
    }

    function getCurrentPartKey() {
        return getPartKeyFromCategory(state.dataset?.meta?.category || '', 0);
    }

    function getSuiteEntryPartKey(entry, index = 0) {
        const slot = entry?.examId ? getSuiteSlot(entry.examId) : null;
        return getPartKeyFromCategory(entry?.category || slot?.dataset?.meta?.category || '', index);
    }

    function getSuiteEntryForPart(partKey) {
        if (!state.suite?.inline || !Array.isArray(state.suite.sequence)) {
            return null;
        }
        const matchedEntry = state.suite.sequence.find((entry, index) => getSuiteEntryPartKey(entry, index) === partKey);
        if (matchedEntry) {
            return matchedEntry;
        }
        const index = getPartIndex(partKey);
        return index >= 0 ? (state.suite.sequence[index] || null) : null;
    }

    function resolveComparisonNavStatus(comparison, answered = false) {
        if (!comparison || typeof comparison !== 'object') {
            return answered ? 'answered' : '';
        }
        if (comparison.isCorrect === true) {
            return 'correct';
        }
        if (comparison.isCorrect === false) {
            return 'incorrect';
        }
        return answered ? 'answered' : '';
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
                const partKey = getPartKeyFromCategory(entry.category || dataset?.meta?.category || '', index);
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
                    const answered = hasAnswerInDataset(qId, answers, dataset);
                    if (answered && !status) {
                        status = 'answered';
                    }
                    if (answered) {
                        info[partKey].answeredCount += 1;
                    }
                    const comparison = slot?.lastResults?.answerComparison?.[qId];
                    if (comparison) {
                        status = resolveComparisonNavStatus(comparison, answered);
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
            const parsed = global.AppData?.recovery?.windowSession?.get('simulation');
            if (parsed) {
                if (Array.isArray(parsed.sequence)) sequenceExams = parsed.sequence;
                if (parsed.draftsByExam) draftsByExam = parsed.draftsByExam;
                if (Array.isArray(parsed.results)) {
                    parsed.results.forEach(res => {
                        if (res && res.examId) resultsByExam[res.examId] = res;
                    });
                }
            }
        } catch (_) {}

        const category = (state.dataset?.meta?.category || '').toUpperCase();
        const currentPart = getPartKeyFromCategory(category, 0);

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
                    status = resolveComparisonNavStatus(comparison[qId], answered);
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
                    status = resolveComparisonNavStatus(comparison[qId], answered);
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
                    status = resolveComparisonNavStatus(comparison[qId], answered);
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
        const canSwitchParts = state.suite?.inline || state.simulationMode;
        const p1Section = document.getElementById('part-section-1');
        if (p1Section) {
            const canSwitchToPart = canSwitchParts && currentPart !== 'p1';
            p1Section.dataset.part = 'p1';
            p1Section.classList.toggle('active', currentPart === 'p1');
            p1Section.classList.toggle('is-switchable', canSwitchToPart);
            p1Section.tabIndex = canSwitchToPart ? 0 : -1;
            p1Section.setAttribute('role', canSwitchToPart ? 'button' : 'group');
            p1Section.setAttribute('aria-label', canSwitchToPart ? 'Go to Part 1' : 'Part 1 questions');
            p1Section.setAttribute('aria-expanded', currentPart === 'p1' ? 'true' : 'false');
        }
        const p1Name = document.querySelector('#part-section-1 .part-nav-name');
        if (p1Name) {
            p1Name.classList.toggle('inactive', isSingleMode && currentPart !== 'p1');
        }
        const p2Section = document.getElementById('part-section-2');
        if (p2Section) {
            const canSwitchToPart = canSwitchParts && currentPart !== 'p2';
            p2Section.dataset.part = 'p2';
            p2Section.classList.toggle('active', currentPart === 'p2');
            p2Section.classList.toggle('is-switchable', canSwitchToPart);
            p2Section.tabIndex = canSwitchToPart ? 0 : -1;
            p2Section.setAttribute('role', canSwitchToPart ? 'button' : 'group');
            p2Section.setAttribute('aria-label', canSwitchToPart ? 'Go to Part 2' : 'Part 2 questions');
            p2Section.setAttribute('aria-expanded', currentPart === 'p2' ? 'true' : 'false');
        }
        const p2Name = document.querySelector('#part-section-2 .part-nav-name');
        if (p2Name) {
            p2Name.classList.toggle('inactive', isSingleMode && currentPart !== 'p2');
        }
        const p3Section = document.getElementById('part-section-3');
        if (p3Section) {
            const canSwitchToPart = canSwitchParts && currentPart !== 'p3';
            p3Section.dataset.part = 'p3';
            p3Section.classList.toggle('active', currentPart === 'p3');
            p3Section.classList.toggle('is-switchable', canSwitchToPart);
            p3Section.tabIndex = canSwitchToPart ? 0 : -1;
            p3Section.setAttribute('role', canSwitchToPart ? 'button' : 'group');
            p3Section.setAttribute('aria-label', canSwitchToPart ? 'Go to Part 3' : 'Part 3 questions');
            p3Section.setAttribute('aria-expanded', currentPart === 'p3' ? 'true' : 'false');
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
            navStatus.set(questionId, resolveComparisonNavStatus(entry, hasAnswer(questionId)));
        });
        buildQuestionNav();
        syncPrimaryActionButtons();
    }

    function scrollToQuestion(questionId) {
        if (!questionId) return;
        const target = findQuestionAnchor(questionId);
        if (target && typeof global.scrollToElement === 'function') {
            global.scrollToElement(target);
        } else {
            target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
        updateActiveQuestionHighlight(questionId);
    }

    function navigateToPart(partKey, options = {}) {
        const targetPartKey = PART_ORDER.includes(partKey) ? partKey : '';
        if (!targetPartKey) return;
        const questionId = options.questionId || '';
        const currentPartKey = getCurrentPartKey();

        if (targetPartKey === currentPartKey) {
            if (questionId) {
                scrollToQuestion(questionId);
            }
            return;
        }

        if (state.suite?.inline) {
            const targetExamId = options.examId || getSuiteEntryForPart(targetPartKey)?.examId || '';
            if (targetExamId) {
                activateSuiteSlot(targetExamId).then((activated) => {
                    if (activated && questionId) {
                        scrollToQuestion(questionId);
                    }
                }).catch((error) => {
                    console.warn('[UnifiedReadingPage] inline suite navigate failed:', error);
                });
            }
            return;
        }

        if (state.simulationMode) {
            const currentIndex = getPartIndex(currentPartKey);
            const targetIndex = getPartIndex(targetPartKey);
            if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
                return;
            }
            dispatchSimulationNavigate(targetIndex < currentIndex ? 'prev' : 'next', null, {
                targetIndex,
                targetPartKey
            });
        }
    }

    function attachNavListeners() {
        const handler = (event) => {
            const section = event.currentTarget;
            const column = event.target.closest('.q-column');
            const partKey = column?.dataset.part || section?.dataset.part || '';
            navigateToPart(partKey, {
                questionId: column?.dataset.questionId || '',
                examId: column?.dataset.examId || ''
            });
        };

        const keyboardHandler = (event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            navigateToPart(event.currentTarget.dataset.part || '');
        };
        
        document.getElementById('part-section-1')?.addEventListener('click', handler);
        document.getElementById('part-section-2')?.addEventListener('click', handler);
        document.getElementById('part-section-3')?.addEventListener('click', handler);
        document.getElementById('part-section-1')?.addEventListener('keydown', keyboardHandler);
        document.getElementById('part-section-2')?.addEventListener('keydown', keyboardHandler);
        document.getElementById('part-section-3')?.addEventListener('keydown', keyboardHandler);

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
                ? event.target.closest('.reading-locator-highlight[data-question-id],.reading-locator-overlap[data-question-id],.reading-locator-block[data-question-id]')
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
        const itemContainerSelector = '.question-item, .tfng-item, .match-question-item, .mc-question-item, .question-row, .summary-completion, .question-group, tr, li';
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
            return byData.closest('.question-item, .match-question-item, .mc-question-item, .question-row, .summary-completion, .paragraph-wrapper, .question-group, tr, li')
                || byData.parentElement;
        }
        const directByTarget = groupEl.querySelector(`#${escaped}-target`);
        if (directByTarget) {
            return directByTarget.closest('.question-item, .match-question-item, .mc-question-item, .question-row, .summary-completion, .question-group, p, li')
                || directByTarget.parentElement;
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

    async function renderExplanations(options = {}) {
        const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : null;
        if (isCurrent && !isCurrent()) {
            return false;
        }
        if (typeof testOverrides.renderExplanations === 'function') {
            const commitOverride = await testOverrides.renderExplanations(options);
            if (isCurrent && !isCurrent()) {
                return false;
            }
            if (typeof commitOverride === 'function') {
                commitOverride();
            }
            return true;
        }
        clearExplanations();
        const explanation = await ensureExplanationDataset(options);
        if (isCurrent && !isCurrent()) {
            return false;
        }
        if (!explanation) {
            return false;
        }
        renderPassageExplanations();
        renderQuestionExplanations();
        return true;
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

    function buildLocatorSnippetVariants(text) {
        const source = String(text || '').replace(/\s+/g, ' ').trim();
        if (!source) return [];
        return Array.from(new Set([
            source,
            source.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'),
            source.replace(/[‐‑‒–—―]/g, '-'),
            source.replace(/\s+-\s+/g, ' — '),
            source.replace(/\s+-\s+/g, ' – ')
        ])).filter(Boolean);
    }

    function normalizeLocatorComparableText(text) {
        return String(text || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function findPassageBlockForLocatorSnippet(snippet) {
        if (!dom.left || !snippet) return null;
        const variants = buildLocatorSnippetVariants(snippet).map(normalizeLocatorComparableText);
        return Array.from(dom.left.querySelectorAll('p, li, td, th, div')).filter((node) => {
            if (node.closest(EXPLANATION_NODE_SELECTOR) || node.classList.contains('reading-locator-highlight')) return false;
            if (node.tagName === 'DIV' && node.querySelector('p, li, td, th')) return false;
            const text = normalizeLocatorComparableText(node.textContent);
            return text.length >= 10 && variants.some((variant) => text.includes(variant));
        }).sort((a, b) => String(a.textContent || '').length - String(b.textContent || '').length)[0] || null;
    }

    function markOverlappingLocatorHighlight(questionId, snippet) {
        const variants = buildLocatorSnippetVariants(snippet).map(normalizeLocatorComparableText);
        const target = Array.from(dom.left?.querySelectorAll('.hl') || []).find((node) => {
            const text = normalizeLocatorComparableText(node.textContent);
            return text.length >= 12 && variants.some((variant) => text.includes(variant) || variant.includes(text));
        });
        if (!target) return null;
        target.classList.add('reading-locator-overlap');
        target.dataset.questionId = questionId;
        target.dataset.locatorOverlap = 'true';
        target.title = `Q${displayLabel(questionId)} 定位`;
        return target;
    }

    function createLocatorBlock(questionId, snippet) {
        const target = findPassageBlockForLocatorSnippet(snippet);
        if (!target) return null;
        const existing = target.querySelector(`.reading-locator-block[data-question-id="${escapeSelector(questionId)}"]`);
        if (existing) return existing;
        target.classList.add('reading-passage-locator-target');
        const marker = document.createElement('span');
        marker.className = 'reading-locator-block';
        marker.dataset.questionId = questionId;
        marker.setAttribute('aria-hidden', 'true');
        target.insertBefore(marker, target.firstChild);
        return marker;
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
        if ((!state.memorizeMode && !state.reviewMode && !state.submitted) || !dom.left) {
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
                let matches = [];
                for (const variant of buildLocatorSnippetVariants(snippet)) {
                    if (matches.length) break;
                    matches = shared.wrapTextMatches(dom.left, variant, {
                        className: 'reading-locator-highlight',
                        attrs: { 'data-question-id': questionId, title: `Q${displayLabel(questionId)} 定位` },
                        limit: 2,
                        skipSelector: '.hl, .reading-locator-highlight, .reading-locator-block'
                    });
                }
                if (!matches.length) {
                    const overlap = markOverlappingLocatorHighlight(questionId, snippet);
                    if (overlap) matches = [overlap];
                }
                if (!matches.length) {
                    const marker = createLocatorBlock(questionId, snippet);
                    if (marker) matches = [marker];
                }
                applied += matches.length;
            });
        });
        return applied;
    }

    function findLocatorAnchor(questionId) {
        const normalized = normalizeQuestionId(questionId);
        return Array.from(document.querySelectorAll('.reading-locator-highlight[data-question-id],.reading-locator-block[data-question-id],.reading-locator-overlap[data-question-id]'))
            .find((node) => normalizeQuestionId(node.dataset.questionId) === normalized) || null;
    }

    function applyLocatorHighlightsForQuestion(questionId) {
        const normalized = normalizeQuestionId(questionId);
        const snippets = buildMemorizeLocatorSnippets().get(normalized) || [];
        if (!normalized || !dom.left) return 0;
        const shared = getHighlightShared();
        for (const snippet of snippets) {
            for (const variant of buildLocatorSnippetVariants(snippet)) {
                const matches = shared?.wrapTextMatches?.(dom.left, variant, {
                    className: 'reading-locator-highlight',
                    attrs: { 'data-question-id': normalized, title: `Q${displayLabel(normalized)} 定位` },
                    limit: 1,
                    skipSelector: '.hl, .reading-locator-highlight, .reading-locator-block'
                }) || [];
                if (matches.length) return matches.length;
            }
            if (markOverlappingLocatorHighlight(normalized, snippet) || createLocatorBlock(normalized, snippet)) return 1;
        }
        return 0;
    }

    function jumpToQuestionEvidence(questionId) {
        if (!findLocatorAnchor(questionId)) applyLocatorHighlightsForQuestion(questionId);
        const locator = findLocatorAnchor(questionId);
        const target = locator || findQuestionAnchor(questionId);
        if (!target) return false;
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        const highlightTarget = locator?.classList.contains('reading-locator-block') ? locator.closest('.reading-passage-locator-target') : locator;
        highlightTarget?.classList.add('is-review-jump-target');
        global.setTimeout(() => highlightTarget?.classList.remove('is-review-jump-target'), 1800);
        return true;
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
        // 清除判卷残留的标记，避免重置后旧颜色残留
        dropzone.classList.remove('correct', 'wrong');
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
            value: item.dataset.heading || item.dataset.option || item.dataset.key || item.dataset.word || item.dataset.value || item.dataset.answerValue || item.textContent.trim(),
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
        // 作答阶段移除判卷残留的标记，避免旧颜色泄露
        dropzone.classList.remove('correct', 'wrong');
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
            const questionIds = resolveCheckboxQuestionIds(name);
            if (!questionIds.length) {
                return;
            }
            const sorted = values.slice().sort((left, right) => left.localeCompare(right, 'en'));
            if (questionIds.length === 1) {
                answers[questionIds[0]] = sorted.length > 1 ? sorted : (sorted[0] || '');
                return;
            }
            questionIds.forEach((questionId) => {
                answers[questionId] = sorted;
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

    function resolveCheckboxQuestionIds(name) {
        const questionIds = expandQuestionSequence(name);
        if (questionIds.length <= 1) {
            return questionIds;
        }
        const firstQuestionId = questionIds[0];
        const answerKey = state.dataset?.answerKey || {};
        const questionGroup = buildQuestionGroupLookup(state.dataset).get(firstQuestionId) || null;
        if (
            questionGroup
            && (questionGroup.kind === 'multi_choice' || questionGroup.kind === 'multiple_choice')
            && Array.isArray(questionGroup.questionIds)
            && questionGroup.questionIds.length === 1
            && Array.isArray(answerKey[firstQuestionId])
        ) {
            return [firstQuestionId];
        }
        return questionIds;
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
        const leadingOption = cleaned.match(/^([A-Za-z])[.)]\s+/);
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

    function buildQuestionGroupLookup(dataset) {
        const lookup = new Map();
        const groups = Array.isArray(dataset?.questionGroups) ? dataset.questionGroups : [];
        groups.forEach((group, index) => {
            if (!group || !Array.isArray(group.questionIds) || !group.questionIds.length) {
                return;
            }
            const normalizedIds = group.questionIds
                .map((entry) => normalizeQuestionId(entry))
                .filter(Boolean);
            if (!normalizedIds.length) {
                return;
            }
            const normalizedGroup = Object.assign({}, group, {
                groupId: group.groupId || `group-${index + 1}`,
                questionIds: normalizedIds
            });
            normalizedIds.forEach((questionId) => {
                lookup.set(questionId, normalizedGroup);
            });
        });
        return lookup;
    }

    function areAnswerTokensEquivalent(left, right) {
        const core = getAnswerMatchCore();
        if (core && typeof core.areTokensEquivalent === 'function') {
            return core.areTokensEquivalent(left, right);
        }
        const normalizedLeft = canonicalizeAnswerToken(left);
        const normalizedRight = canonicalizeAnswerToken(right);
        if (!normalizedLeft || !normalizedRight) {
            return false;
        }
        if (normalizedLeft === normalizedRight) {
            return true;
        }
        if (/^[A-Z]$/.test(normalizedLeft) || /^[A-Z]$/.test(normalizedRight)) {
            return false;
        }
        const looseLeft = String(normalizedLeft).toLowerCase().replace(/[^a-z0-9]+/g, '');
        const looseRight = String(normalizedRight).toLowerCase().replace(/[^a-z0-9]+/g, '');
        return !!looseLeft && looseLeft === looseRight;
    }

    function normalizeChoiceTokenList(value) {
        const rawTokens = Array.isArray(value)
            ? value.flatMap((entry) => splitAnswerTokens(entry))
            : splitAnswerTokens(value);
        const normalized = [];
        rawTokens.forEach((entry) => {
            const rawChoiceToken = String(entry ?? '').trim().toUpperCase();
            const token = /^[A-Z]$/.test(rawChoiceToken)
                ? rawChoiceToken
                : canonicalizeAnswerToken(entry);
            if (!token) {
                return;
            }
            if (!normalized.some((existing) => areAnswerTokensEquivalent(existing, token))) {
                normalized.push(token);
            }
        });
        return normalized.sort((left, right) => left.localeCompare(right, 'en'));
    }

    function collectGroupChoiceTokens(answers, questionIds) {
        const tokens = [];
        questionIds.forEach((questionId) => {
            normalizeChoiceTokenList(answers[questionId]).forEach((token) => {
                if (!tokens.some((existing) => areAnswerTokensEquivalent(existing, token))) {
                    tokens.push(token);
                }
            });
        });
        return tokens.sort((left, right) => left.localeCompare(right, 'en'));
    }

    function resolveSplitMultiChoiceSelection(answers, answerKey, questionGroup, targetQuestionId) {
        const questionIds = Array.isArray(questionGroup?.questionIds)
            ? questionGroup.questionIds.map((entry) => normalizeQuestionId(entry)).filter(Boolean)
            : [];
        const selectedTokens = collectGroupChoiceTokens(answers, questionIds);
        // 数量校验：用户选择数不能超过正确答案总数（如 5选2 最多选 2 个）。
        // 超选（如全选 A-E）视为整组错误，防止通过多选选项刷满分。
        const expectedCount = questionIds
            .map((questionId) => canonicalizeAnswerToken(answerKey[questionId]))
            .filter(Boolean)
            .length;
        const overSelected = expectedCount > 0 && selectedTokens.length > expectedCount;
        const remainingTokens = selectedTokens.slice();
        const assignments = new Map();

        questionIds.forEach((questionId) => {
            const expectedToken = canonicalizeAnswerToken(answerKey[questionId]);
            if (!expectedToken) {
                return;
            }
            const matchedIndex = remainingTokens.findIndex((token) => areAnswerTokensEquivalent(token, expectedToken));
            if (matchedIndex >= 0) {
                assignments.set(questionId, remainingTokens[matchedIndex]);
                remainingTokens.splice(matchedIndex, 1);
            }
        });

        questionIds.forEach((questionId) => {
            if (assignments.has(questionId)) {
                return;
            }
            const fallbackToken = remainingTokens.shift();
            if (fallbackToken) {
                assignments.set(questionId, fallbackToken);
            }
        });

        const normalizedTargetId = normalizeQuestionId(targetQuestionId) || targetQuestionId;
        const expectedToken = canonicalizeAnswerToken(answerKey[normalizedTargetId]);
        const assignedToken = assignments.get(normalizedTargetId) || '';
        return {
            // Review rows for split-key multi-choice still show the full selected set
            // so partial credit remains inspectable even though scoring is per expected token.
            displayUserAnswer: selectedTokens.length
                ? selectedTokens.slice()
                : (assignedToken || answers[normalizedTargetId] || ''),
            expectedToken,
            isCorrect: !overSelected
                && Boolean(assignedToken && expectedToken && areAnswerTokensEquivalent(assignedToken, expectedToken))
        };
    }

    function questionWeight(correctAnswer, questionGroup = null) {
        if (Array.isArray(correctAnswer)) {
            const normalized = normalizeAnswerValue(correctAnswer);
            const isMultiChoiceGroup = Boolean(
                questionGroup
                && (questionGroup.kind === 'multi_choice' || questionGroup.kind === 'multiple_choice')
                && Array.isArray(questionGroup.questionIds)
            );
            if (isMultiChoiceGroup && Array.isArray(normalized) && normalized.length > 0) {
                return normalized.length;
            }
            return 1;
        }
        return 1;
    }

    function hasAnswerInDataset(questionId, answers, dataset) {
        const value = answers[questionId];
        const tokens = splitAnswerTokens(value);
        if (tokens.length === 0) {
            return false;
        }
        // 拆分多选题组：一个 questionId 持有了整组的选中集合，
        // 需按组内期望数量判断是否真正作答完毕（如 5选2 需选满 2 个）。
        const normalizedQuestionId = normalizeQuestionId(questionId) || questionId;
        const questionGroup = buildQuestionGroupLookup(dataset).get(normalizedQuestionId) || null;
        const isSplitMultiChoiceGroup = Boolean(
            questionGroup
            && (questionGroup.kind === 'multi_choice' || questionGroup.kind === 'multiple_choice')
            && Array.isArray(questionGroup.questionIds)
            && questionGroup.questionIds.length > 1
        );
        if (isSplitMultiChoiceGroup) {
            const answerKey = dataset?.answerKey || {};
            const expectedCount = questionGroup.questionIds
                .map((id) => canonicalizeAnswerToken(answerKey[id]))
                .filter(Boolean)
                .length;
            if (expectedCount > 0) {
                return tokens.length >= expectedCount;
            }
        }
        return true;
    }

    function hasAnswer(questionId) {
        return hasAnswerInDataset(questionId, collectAnswers(), state.dataset);
    }

    function buildResultsFromAnswers(dataset, answers = {}) {
        const answerKey = dataset?.answerKey || {};
        const questionOrder = Array.isArray(dataset?.questionOrder) ? dataset.questionOrder : Object.keys(answerKey);
        const questionTypeMap = buildQuestionTypeMap(dataset);
        const questionGroupLookup = buildQuestionGroupLookup(dataset);
        const questionTypePerformance = {};
        const answerComparison = {};
        const details = {};
        let correctCount = 0;
        let totalQuestions = 0;

        questionOrder.forEach((questionId) => {
            const userAnswer = Object.prototype.hasOwnProperty.call(answers, questionId)
                ? answers[questionId]
                : '';
            const correctAnswer = answerKey[questionId];
            const normalizedQuestionId = normalizeQuestionId(questionId) || questionId;
            const questionGroup = questionGroupLookup.get(normalizedQuestionId) || null;
            const questionType = questionTypeMap[normalizedQuestionId] || 'other';
            const isMultiChoiceKind = (
                questionGroup
                && (questionGroup.kind === 'multi_choice' || questionGroup.kind === 'multiple_choice')
            );
            const isSplitMultiChoiceGroup = Boolean(
                isMultiChoiceKind
                && Array.isArray(questionGroup.questionIds)
                && questionGroup.questionIds.length > 1
            );
            const isSingleKeyMultiChoiceGroup = Boolean(
                isMultiChoiceKind
                && Array.isArray(questionGroup.questionIds)
                && questionGroup.questionIds.length === 1
                && Array.isArray(correctAnswer)
            );
            let displayUserAnswer = userAnswer;
            let isCorrect = compareAnswers(userAnswer, correctAnswer);
            let weight = questionWeight(correctAnswer, questionGroup);
            let partialCorrectCount = isCorrect ? weight : 0;

            if (isSplitMultiChoiceGroup) {
                const splitSelection = resolveSplitMultiChoiceSelection(answers, answerKey, questionGroup, normalizedQuestionId);
                displayUserAnswer = splitSelection.displayUserAnswer || userAnswer;
                if (!splitSelection.expectedToken) {
                    isCorrect = null;
                    partialCorrectCount = 0;
                } else {
                    isCorrect = splitSelection.isCorrect;
                    partialCorrectCount = isCorrect ? 1 : 0;
                }
                weight = 1;
            } else if (isSingleKeyMultiChoiceGroup) {
                const selectedTokens = normalizeChoiceTokenList(userAnswer);
                const expectedTokens = normalizeChoiceTokenList(correctAnswer);
                const matchedTokens = expectedTokens.filter((expectedToken) => (
                    selectedTokens.some((token) => areAnswerTokensEquivalent(token, expectedToken))
                ));
                displayUserAnswer = selectedTokens.length ? selectedTokens : userAnswer;
                partialCorrectCount = matchedTokens.length;
                isCorrect = expectedTokens.length > 0
                    && matchedTokens.length === expectedTokens.length
                    && selectedTokens.length === expectedTokens.length;
                weight = expectedTokens.length || 1;
            }

            if (!questionTypePerformance[questionType]) {
                questionTypePerformance[questionType] = {
                    total: 0,
                    correct: 0,
                    accuracy: 0
                };
            }
            totalQuestions += weight;
            questionTypePerformance[questionType].total += weight;
            if (partialCorrectCount > 0) {
                correctCount += partialCorrectCount;
                questionTypePerformance[questionType].correct += partialCorrectCount;
            }
            answerComparison[questionId] = {
                questionId,
                userAnswer: displayUserAnswer,
                correctAnswer,
                isCorrect,
                questionType,
                partialCorrectCount,
                weight
            };
            details[questionId] = {
                questionId,
                userAnswer: displayUserAnswer,
                correctAnswer,
                isCorrect,
                questionType,
                partialCorrectCount,
                weight
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
            const partial = Number(entry.partialCorrectCount) || 0;
            const weight = Number(entry.weight) || 1;
            const correctnessKnown = entry.isCorrect === true || entry.isCorrect === false;
            const isPartial = entry.isCorrect === false && partial > 0 && weight > 1;
            const status = entry.isCorrect === true
                ? '✓'
                : (isPartial ? `${partial}/${weight}` : (correctnessKnown ? '✗' : '—'));
            const statusClass = entry.isCorrect === true
                ? 'result-correct'
                : (isPartial ? 'result-partial' : (correctnessKnown ? 'result-incorrect' : 'result-unknown'));
            return `
                <tr>
                    <td><button type="button" class="question-jump-btn" data-result-question-id="${escapeHtml(entry.questionId)}" aria-label="跳转到题号 ${label} 的原文证据">${label}</button></td>
                    <td>${userAnswer}</td>
                    <td>${correctAnswer || ''}</td>
                    <td class="${statusClass}">${status}</td>
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
        dom.results.querySelectorAll?.('[data-result-question-id]').forEach((button) => {
            button.addEventListener('click', () => jumpToQuestionEvidence(button.dataset.resultQuestionId || ''));
        });
        applyResultsToQuestionArea(results);
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

    function applyResultsToQuestionArea(results) {
        if (!results || !results.answerComparison) {
            return;
        }
        const comparison = results.answerComparison;
        // 先清除所有旧标记，再按判卷结果重新标记。
        // 按 class 全局清除（不依赖容器选择器），确保 legacy 容器（.mcq/.location-options 等）
        // 的旧绿/红标记也被清理，避免 replay 不同记录时残留。
        document.querySelectorAll('.option-correct, .option-wrong, .drop-target-summary.correct, .drop-target-summary.wrong, .paragraph-dropzone.correct, .paragraph-dropzone.wrong, .match-dropzone.correct, .match-dropzone.wrong, [data-result-filled="true"]').forEach((node) => {
            node.classList.remove('correct', 'wrong', 'option-correct', 'option-wrong');
            if (node.dataset && node.dataset.resultFilled === 'true') {
                node.classList.remove('dropzone-filled');
                delete node.dataset.resultFilled;
            }
        });
        // 把 comparison 条目按 checkbox/radio 组聚合：组内任一拆分子题的正确答案
        // 都属于该组，避免拆分多选题时"正确选项在另一子题被当成用户错选"而标红。
        // 正确答案未知（legacy 记录无 correctAnswerMap，isCorrect 为 null）时跳过该组，
        // 避免把历史记录的所有选择都标红。
        const groupEntries = new Map();
        Object.values(comparison).forEach((entry) => {
            const questionId = entry.questionId;
            const inputNodes = collectChoiceInputsForQuestion(questionId);
            if (!inputNodes.length) {
                return; // 无 input 时走 dropzone 分支
            }
            const correctValues = (Array.isArray(entry.correctAnswer) ? entry.correctAnswer : [entry.correctAnswer])
                .map((value) => canonicalizeAnswerToken(value))
                .filter(Boolean);
            if (correctValues.length === 0) {
                return; // 正确答案未知，不标记对错
            }
            const groupKey = inputNodes[0].name || questionId;
            if (!groupEntries.has(groupKey)) {
                groupEntries.set(groupKey, {
                    inputs: inputNodes,
                    correctValues: new Set(),
                    userValues: new Set()
                });
            }
            const group = groupEntries.get(groupKey);
            correctValues.forEach((value) => group.correctValues.add(value));
            normalizeChoiceTokenList(entry.userAnswer)
                .forEach((value) => group.userValues.add(value));
        });
        groupEntries.forEach((group) => {
            group.inputs.forEach((input) => {
                const highlightTarget = resolveChoiceHighlightTarget(input);
                if (!highlightTarget) {
                    return;
                }
                const inputValue = canonicalizeAnswerToken(input.value);
                if (!inputValue) {
                    return;
                }
                if (group.correctValues.has(inputValue)) {
                    highlightTarget.classList.add('option-correct');
                } else if (input.checked || group.userValues.has(inputValue)) {
                    highlightTarget.classList.add('option-wrong');
                }
            });
        });
        // 剩余条目：dropzone（拖拽/表格非 input 类）单独处理
        Object.values(comparison).forEach((entry) => {
            const questionId = entry.questionId;
            if (collectChoiceInputsForQuestion(questionId).length) {
                return; // 已按组处理
            }
            // 正确答案未知（isCorrect 为 null）时跳过，避免历史记录被误标红
            if (entry.isCorrect === null || entry.isCorrect === undefined) {
                return;
            }
            const isCorrect = Boolean(entry.isCorrect);
            const aliases = resolveAnswerAliases(questionId);
            const selector = aliases.map((alias) => {
                const escaped = escapeSelector(alias);
                return [
                    `.drop-target-summary[data-question="${escaped}"]`,
                    `.paragraph-dropzone[data-question="${escaped}"]`,
                    `.match-dropzone[data-question="${escaped}"]`
                ].join(', ');
            }).join(', ');
            let dropzoneNode = null;
            if (selector) {
                try {
                    dropzoneNode = document.querySelector(selector);
                } catch (_) {
                    // ignore invalid selector
                }
            }
            if (dropzoneNode) {
                dropzoneNode.classList.add(isCorrect ? 'correct' : 'wrong');
                // 未作答的拖拽区：补上 filled 状态，让 wrong/correct 样式能生效
                if (!dropzoneNode.classList.contains('dropzone-filled')) {
                    dropzoneNode.classList.add('dropzone-filled');
                    dropzoneNode.dataset.resultFilled = 'true';
                }
            }
        });
    }

    function resolveChoiceHighlightTarget(input) {
        const explicitTarget = input.closest([
            'label',
            'td',
            '.heading-option',
            '.choice-option',
            '.answer-option',
            '.radio-option',
            '.checkbox-option',
            '.option-item'
        ].join(', '));
        if (explicitTarget) {
            return explicitTarget;
        }
        const parent = input.parentElement;
        if (!parent) {
            return null;
        }
        const siblingChoices = parent.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        return siblingChoices.length === 1 ? parent : null;
    }

    function collectChoiceInputsForQuestion(questionId) {
        const normalizedTarget = normalizeQuestionId(questionId);
        // 直接匹配
        let inputs = document.querySelectorAll(`input[type="checkbox"][name="${escapeSelector(questionId)}"], input[type="radio"][name="${escapeSelector(questionId)}"]`);
        if (inputs.length) {
            return Array.from(inputs);
        }
        // 扫描所有 checkbox/radio 组，匹配 name 展开后的题目序列
        const matched = [];
        document.querySelectorAll('input[type="checkbox"][name], input[type="radio"][name]').forEach((input) => {
            const name = input.name || '';
            const ids = expandQuestionSequence(name);
            if (ids.some((id) => normalizeQuestionId(id) === normalizedTarget)) {
                matched.push(input);
            }
        });
        if (matched.length) {
            return matched;
        }
        return [];
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
        const normalizedCorrectAnswers = normalizeReplayMap(entry.correctAnswerMap || (entry.realData && entry.realData.correctAnswerMap) || {});
        const rawComparison = normalizeReplayMap(entry.answerComparison || {});
        const questionIds = new Set([
            ...Object.keys(normalizedAnswers),
            ...Object.keys(normalizedCorrectAnswers),
            ...Object.keys(rawComparison),
            ...(Array.isArray(entry.allQuestionIds)
                ? entry.allQuestionIds.map((item) => normalizeReplayQuestionId(item)).filter(Boolean)
                : [])
        ]);

        const replayAnswers = {};
        questionIds.forEach((questionId) => {
            const rawEntry = rawComparison[questionId];
            const comparisonEntry = (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry))
                ? rawEntry
                : {};
            replayAnswers[questionId] = Object.prototype.hasOwnProperty.call(comparisonEntry, 'userAnswer')
                ? comparisonEntry.userAnswer
                : (Object.prototype.hasOwnProperty.call(normalizedAnswers, questionId) ? normalizedAnswers[questionId] : '');
        });

        const hasUsableCorrectAnswer = (questionId) => (
            Object.prototype.hasOwnProperty.call(normalizedCorrectAnswers, questionId)
            && splitAnswerTokens(normalizedCorrectAnswers[questionId]).length > 0
        );
        const replayGroupLookup = buildQuestionGroupLookup(state.dataset);
        const knownQuestionIds = Array.from(questionIds).filter((questionId) => {
            if (!hasUsableCorrectAnswer(questionId)) {
                return false;
            }
            const questionGroup = replayGroupLookup.get(questionId);
            const isSplitMultiChoiceGroup = Boolean(
                questionGroup
                && (questionGroup.kind === 'multi_choice' || questionGroup.kind === 'multiple_choice')
                && Array.isArray(questionGroup.questionIds)
                && questionGroup.questionIds.length > 1
            );
            return !isSplitMultiChoiceGroup
                || questionGroup.questionIds.every((groupQuestionId) => hasUsableCorrectAnswer(groupQuestionId));
        });
        if (knownQuestionIds.length > 0) {
            const replayResults = buildResultsFromAnswers(
                Object.assign({}, state.dataset || {}, {
                    answerKey: normalizedCorrectAnswers,
                    questionOrder: knownQuestionIds
                }),
                replayAnswers
            );
            const answerComparison = {};
            questionIds.forEach((questionId) => {
                answerComparison[questionId] = replayResults.answerComparison[questionId] || {
                    questionId,
                    userAnswer: replayAnswers[questionId],
                    correctAnswer: '',
                    isCorrect: null
                };
            });
            return {
                answers: replayAnswers,
                correctAnswers: normalizedCorrectAnswers,
                answerComparison,
                scoreInfo: Object.assign({}, entry.scoreInfo || {}, replayResults.scoreInfo)
            };
        }

        const normalizedComparison = {};
        questionIds.forEach((questionId) => {
            normalizedComparison[questionId] = {
                questionId,
                userAnswer: replayAnswers[questionId],
                correctAnswer: '',
                isCorrect: null
            };
        });

        const totalQuestions = questionIds.size;
        const scoreInfo = Object.assign({}, entry.scoreInfo || {});
        scoreInfo.correct = Number.isFinite(Number(scoreInfo.correct)) ? Number(scoreInfo.correct) : 0;
        scoreInfo.total = Number.isFinite(Number(scoreInfo.total)) ? Number(scoreInfo.total) : totalQuestions;
        scoreInfo.totalQuestions = Number.isFinite(Number(scoreInfo.totalQuestions)) ? Number(scoreInfo.totalQuestions) : scoreInfo.total;
        scoreInfo.accuracy = scoreInfo.totalQuestions > 0 ? scoreInfo.correct / scoreInfo.totalQuestions : 0;
        scoreInfo.percentage = Number.isFinite(Number(scoreInfo.percentage))
            ? Number(scoreInfo.percentage)
            : Math.round(scoreInfo.accuracy * 100);

        return {
            answers: replayAnswers,
            correctAnswers: normalizedCorrectAnswers,
            answerComparison: normalizedComparison,
            scoreInfo
        };
    }

    if (global.__IELTS_READING_PAGE_TEST_HOOKS__ === true) {
        global.__IELTS_UNIFIED_READING_PAGE_TEST__ = Object.assign(
            global.__IELTS_UNIFIED_READING_PAGE_TEST__ || {},
            {
                buildReplayResults,
                hasAnswerInDataset,
                normalizeChoiceTokenList,
                buildResultsFromAnswers,
                renderTimer,
                handleSubmit
            }
        );
    }

    function applyAnswersToDom(answers = {}) {
        if (!answers || typeof answers !== 'object') {
            return;
        }

        const groupedHandledQuestionIds = new Set();
        const groupedChoiceInputs = new Map();
        document.querySelectorAll('input[type="radio"][name], input[type="checkbox"][name]').forEach((input) => {
            const groupName = String(input.getAttribute('name') || '').trim();
            if (!groupName) return;
            const expandedQuestionIds = expandQuestionSequence(groupName);
            if (expandedQuestionIds.length <= 1) return;
            const questionIds = resolveCheckboxQuestionIds(groupName);
            if (!questionIds.length) return;
            const existing = groupedChoiceInputs.get(groupName) || {
                groupName,
                questionIds,
                inputs: []
            };
            existing.inputs.push(input);
            groupedChoiceInputs.set(groupName, existing);
        });

        groupedChoiceInputs.forEach((group) => {
            const mergedValues = [];
            const appendValues = (rawValue) => {
                splitAnswerTokens(rawValue).forEach((entry) => {
                    const normalized = canonicalizeAnswerToken(entry);
                    if (normalized) {
                        mergedValues.push(normalized);
                    }
                });
            };
            group.questionIds.forEach((questionId) => {
                groupedHandledQuestionIds.add(questionId);
                if (Object.prototype.hasOwnProperty.call(answers, questionId)) {
                    appendValues(answers[questionId]);
                }
            });
            if (Object.prototype.hasOwnProperty.call(answers, group.groupName)) {
                appendValues(answers[group.groupName]);
            }
            const normalizedValues = Array.from(new Set(mergedValues));
            group.inputs.forEach((input) => {
                const candidate = canonicalizeAnswerToken(
                    input.value || input.dataset?.option || input.dataset?.value || input.id || ''
                );
                input.checked = normalizedValues.some((value) => areAnswerTokensEquivalent(candidate, value));
            });
        });

        Object.entries(answers).forEach(([questionId, rawValue]) => {
            const normalizedId = normalizeReplayQuestionId(questionId);
            if (!normalizedId || groupedHandledQuestionIds.has(normalizedId)) return;
            if (applyDropzoneAnswer(normalizedId, rawValue)) {
                return;
            }
            const aliases = resolveAnswerAliases(normalizedId);
            const choiceFields = new Set();
            const textFields = new Set();
            const selectFields = new Set();
            aliases.forEach((alias) => {
                const escapedAlias = escapeSelector(alias);
                document.querySelectorAll(
                    `input[type="radio"][name="${escapedAlias}"], input[type="checkbox"][name="${escapedAlias}"]`
                ).forEach((field) => choiceFields.add(field));
                document.querySelectorAll([
                    `input[name="${escapedAlias}"]`,
                    `textarea[name="${escapedAlias}"]`,
                    `input[id="${escapedAlias}"]`,
                    `textarea[id="${escapedAlias}"]`,
                    `input[data-question-id="${escapedAlias}"]`,
                    `textarea[data-question-id="${escapedAlias}"]`
                ].join(', ')).forEach((field) => {
                    if (field.type !== 'radio' && field.type !== 'checkbox') {
                        textFields.add(field);
                    }
                });
                document.querySelectorAll([
                    `select[name="${escapedAlias}"]`,
                    `select[id="${escapedAlias}"]`,
                    `select[data-question-id="${escapedAlias}"]`
                ].join(', ')).forEach((field) => selectFields.add(field));
            });

            const normalizedValues = splitAnswerTokens(rawValue)
                .map((entry) => canonicalizeAnswerToken(entry))
                .filter(Boolean);
            choiceFields.forEach((input) => {
                const candidate = canonicalizeAnswerToken(
                    input.value || input.dataset?.option || input.dataset?.value || input.id || ''
                );
                input.checked = normalizedValues.some((value) => areAnswerTokensEquivalent(candidate, value));
            });

            const textValue = displayAnswerValue(rawValue, '');
            textFields.forEach((field) => {
                field.value = textValue;
            });
            selectFields.forEach((select) => {
                for (let index = 0; index < select.options.length; index += 1) {
                    if (compareAnswers(select.options[index].value, rawValue)) {
                        select.selectedIndex = index;
                        break;
                    }
                }
            });
        });
    }

    function applyReplayAnswersToDom(answers = {}) {
        applyAnswersToDom(answers);
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
                // review、普通进行中练习、以及已回传 recordId 的结果页允许编辑笔记；
                // 只读/计时锁定/背诵模式仍保持禁用，避免改动无法保存或破坏答题流程。
                const canEditNotes = canEditReadingNotes();
                if (
                    canEditNotes
                    && typeof control.closest === 'function'
                    && control.closest('#reading-note-editor, #reading-note-drawer')
                ) {
                    control.disabled = false;
                    return;
                }
                control.disabled = state.readOnly || state.timerLocked;
            }
        });
        renderNotesDrawer();
        syncPrimaryActionButtons();
        refreshSimulationDraftSyncLifecycle();
        enhanceReviewHighlights();
    }

    function disableDragInteractions() {
        const locked = Boolean(state.readOnly || state.timerLocked);
        document.querySelectorAll('.drag-item, .draggable-word, .card').forEach((item) => {
            if (!(item instanceof HTMLElement)) return;
            item.setAttribute('draggable', locked ? 'false' : 'true');
            item.classList.toggle('drag-item-locked', locked);
        });
    }

    function setExitButtonVisible(visible) {
        if (!dom.exitBtn) return;
        dom.exitBtn.style.display = visible ? 'block' : 'none';
    }

    function enterSubmittedReadOnlyState(reason = 'submit') {
        clearSubmissionAckTimer();
        state.submissionStatus = 'submitted';
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

    function clearSubmissionAckTimer() {
        if (state.submissionAckTimer) {
            clearTimeout(state.submissionAckTimer);
            state.submissionAckTimer = null;
        }
    }

    function createSubmissionId() {
        try {
            if (global.crypto && typeof global.crypto.randomUUID === 'function') {
                return global.crypto.randomUUID();
            }
        } catch (_) {
            // Fall through to a session-bound identifier.
        }
        return [state.sessionId || 'session', state.examId || 'exam', Date.now(), Math.random().toString(36).slice(2)].join(':');
    }

    function restoreDraftSubmissionState(submissionId = '') {
        if (state.submissionStatus === 'submitted') {
            return false;
        }
        if (submissionId && state.submissionId && submissionId !== state.submissionId) {
            return false;
        }
        clearSubmissionAckTimer();
        state.submissionStatus = 'draft';
        state.submitted = false;
        syncPrimaryActionButtons();
        return true;
    }

    function expirePendingSubmission(submissionId = '') {
        if (state.submissionStatus !== 'submitting') {
            return false;
        }
        return restoreDraftSubmissionState(submissionId || state.submissionId);
    }

    function beginSubmission(messageType, payload, presentation = null) {
        if (state.submissionStatus === 'submitting' || state.submissionStatus === 'submitted') {
            return false;
        }
        if (!state.submissionId) {
            state.submissionId = createSubmissionId();
        }
        state.submissionStatus = 'submitting';
        state.pendingSubmissionPresentation = presentation;
        syncPrimaryActionButtons();
        const delivered = postMessage(messageType, Object.assign({}, payload || {}, {
            submissionId: state.submissionId
        }));
        if (!delivered) {
            restoreDraftSubmissionState(state.submissionId);
            return false;
        }
        clearSubmissionAckTimer();
        state.submissionAckTimer = setTimeout(() => {
            expirePendingSubmission(state.submissionId);
        }, SUBMIT_ACK_TIMEOUT_MS);
        return true;
    }

    function matchesPendingSubmission(data = {}) {
        if (state.submissionStatus !== 'submitting') return false;
        const submissionId = data && data.submissionId != null ? String(data.submissionId).trim() : '';
        const sessionId = data && data.sessionId != null ? String(data.sessionId).trim() : '';
        const examId = data && data.examId != null ? String(data.examId).trim() : '';
        const suiteSessionId = data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '';
        if (!submissionId || submissionId !== state.submissionId) return false;
        if (!sessionId || !state.sessionId || sessionId !== String(state.sessionId)) return false;
        if (!examId || !state.examId || examId !== String(state.examId)) return false;
        if (state.suiteSessionId && suiteSessionId !== String(state.suiteSessionId)) return false;
        if (!state.suiteSessionId && suiteSessionId) return false;
        return true;
    }

    function capturePendingSubmissionOwnership(data = {}) {
        if (!matchesPendingSubmission(data)) return null;
        const generation = Number(state.windowSessionGeneration);
        return {
            parentWindow: state.parentWindow || null,
            examId: String(state.examId || ''),
            sessionId: String(state.sessionId || ''),
            suiteSessionId: String(state.suiteSessionId || ''),
            windowSessionToken: normalizeWindowSessionToken(state.windowSessionToken),
            windowSessionGeneration: Number.isInteger(generation) && generation > 0 ? generation : 0,
            submissionId: String(state.submissionId || ''),
            finalSuiteSubmission: Boolean(
                state.simulationMode
                && state.simulationCtx
                && state.simulationCtx.isLast
                && state.suiteSessionId
            )
        };
    }

    function retainsSubmissionOwnership(ownership) {
        if (!ownership || state.submissionStatus !== 'submitted') return false;
        const generation = Number(state.windowSessionGeneration);
        const currentGeneration = Number.isInteger(generation) && generation > 0 ? generation : 0;
        return Boolean(
            state.parentWindow === ownership.parentWindow
            && String(state.examId || '') === ownership.examId
            && String(state.sessionId || '') === ownership.sessionId
            && String(state.suiteSessionId || '') === ownership.suiteSessionId
            && normalizeWindowSessionToken(state.windowSessionToken) === ownership.windowSessionToken
            && currentGeneration === ownership.windowSessionGeneration
            && String(state.submissionId || '') === ownership.submissionId
        );
    }

    async function acceptSubmissionAcknowledgement(data = {}) {
        const ownership = capturePendingSubmissionOwnership(data);
        if (!ownership) {
            return false;
        }
        const presentation = state.pendingSubmissionPresentation;
        clearSubmissionAckTimer();
        enterSubmittedReadOnlyState(state.simulationMode ? 'simulation-final-submit' : 'final-submit');
        if (presentation && presentation.results) {
            state.lastResults = presentation.results;
            renderResults(presentation.results);
            await renderExplanations();
            if (!retainsSubmissionOwnership(ownership)) {
                return false;
            }
            applyHighlights(Array.isArray(presentation.highlights) ? presentation.highlights : []);
            refreshNoteHighlightAttributes();
            restoreMissingNoteAnchors();
            applyMemorizeLocatorHighlights();
            enhanceReviewHighlights();
            updateNavStatuses(presentation.results);
        }
        if (!retainsSubmissionOwnership(ownership)) {
            return false;
        }
        state.pendingSubmissionPresentation = null;
        if (ownership.finalSuiteSubmission) {
            stopSimulationDraftSync();
            clearSimulationDraftMirror();
            state.simulationDraftFingerprint = '';
            if (state.suiteSessionId && typeof global.close === 'function') {
                try {
                    global.close();
                } catch (_) {
                    // The host teardown remains the fallback when the browser refuses self-close.
                }
            }
        }
        return true;
    }

    if (global.__IELTS_READING_PAGE_TEST_HOOKS__ === true) {
        global.__IELTS_UNIFIED_READING_PAGE_TEST__ = Object.assign(
            global.__IELTS_UNIFIED_READING_PAGE_TEST__ || {},
            {
                buildReplayResults,
                hasAnswerInDataset,
                normalizeChoiceTokenList,
                mergeDraft,
                normalizeNotes,
                normalizeNoteOutlines,
                syncReadingAnnotation,
                mergeSuiteDraftPayload,
                captureInlineSuiteDraftBeforeReinit,
                shouldIgnoreInlineSuiteEnvelope,
                shouldAcceptWindowSessionMessage,
                adoptWindowSessionMessage,
                buildInitSignature,
                handleIncoming,
                initializeInlineSimulationSuite,
                activateSuiteSlot,
                buildResultsFromAnswers,
                applyAnswersToDom,
                applyReplayAnswersToDom,
                captureDom,
                renderResults,
                updateNavStatuses,
                renderTimer,
                handleSubmit,
                beginSubmission,
                acceptSubmissionAcknowledgement,
                expirePendingSubmission,
                restoreDraftSubmissionState,
                stopReadingDraftSync,
                stopSimulationDraftSync,
                getTestState() {
                    return {
                        examId: state.examId,
                        dataKey: state.dataKey,
                        sessionId: state.sessionId,
                        suiteSessionId: state.suiteSessionId,
                        simulationMode: state.simulationMode,
                        simulationContextReady: state.simulationContextReady,
                        simulationCtx: state.simulationCtx && typeof state.simulationCtx === 'object'
                            ? JSON.parse(JSON.stringify(state.simulationCtx))
                            : state.simulationCtx,
                        windowSessionToken: state.windowSessionToken,
                        windowSessionIssuedAtMs: state.windowSessionIssuedAtMs,
                        sessionReadySent: state.sessionReadySent,
                        lastInitSignature: state.lastInitSignature,
                        activeExamId: state.suite?.activeExamId || null,
                        currentIndex: state.suite?.currentIndex || 0,
                        suiteInline: Boolean(state.suite?.inline),
                        suiteActivating: Boolean(state.suite?.activating),
                        activationGeneration: Number(state.suite?.activationGeneration) || 0,
                        suiteTimerLimitSeconds: state.suiteTimerLimitSeconds,
                        reviewRecordId: state.reviewRecordId,
                        submittedRecordId: state.submittedRecordId,
                        submitted: state.submitted,
                        readOnly: state.readOnly,
                        reviewMode: state.reviewMode,
                        timerLocked: state.timerLocked,
                        submissionStatus: state.submissionStatus,
                        submissionId: state.submissionId,
                        parentOrigin: state.parentOrigin,
                        parentOriginIsOpaque: state.parentOriginIsOpaque,
                        expectedParentOrigin: state.expectedParentOrigin,
                        windowSessionToken: state.windowSessionToken,
                        notes: collectNotes(),
                        noteOutlines: collectNoteOutlines(),
                        markedQuestions: normalizeMarkedQuestions(state.markedQuestions),
                        navStatus: Array.from(navStatus.entries()),
                        suiteSequence: Array.isArray(state.suite?.sequence)
                            ? state.suite.sequence.map((entry) => ({ ...entry }))
                            : [],
                        slotsByExamId: state.suite?.slotsByExamId instanceof Map
                            ? Array.from(state.suite.slotsByExamId.entries()).map(([examId, slot]) => [
                                examId,
                                {
                                    ...slot,
                                    draft: slot?.draft ? cloneDraftSafely(slot.draft) : slot?.draft
                                }
                            ])
                            : []
                    };
                },
                setTestState(patch = {}) {
                    if (!patch || typeof patch !== 'object') {
                        return;
                    }
                    Object.entries(patch).forEach(([key, value]) => {
                        if (key === 'suite' || key === 'suiteSlots') {
                            return;
                        }
                        state[key] = value;
                    });
                    if (patch.suite && typeof patch.suite === 'object') {
                        Object.assign(state.suite, patch.suite);
                        if (Object.prototype.hasOwnProperty.call(patch.suite, 'slotsByExamId')) {
                            const slots = patch.suite.slotsByExamId;
                            if (slots instanceof Map) {
                                state.suite.slotsByExamId = slots;
                            } else if (Array.isArray(slots)) {
                                state.suite.slotsByExamId = new Map(slots);
                            } else if (slots && typeof slots === 'object') {
                                state.suite.slotsByExamId = new Map(Object.entries(slots));
                            }
                        }
                    }
                    if (Object.prototype.hasOwnProperty.call(patch, 'suiteSlots')) {
                        const slots = patch.suiteSlots;
                        if (slots instanceof Map) {
                            state.suite.slotsByExamId = slots;
                        } else if (Array.isArray(slots)) {
                            state.suite.slotsByExamId = new Map(slots);
                        } else if (slots && typeof slots === 'object') {
                            state.suite.slotsByExamId = new Map(Object.entries(slots));
                        }
                    }
                },
                setTestOverride(name, value) {
                    if (!Object.prototype.hasOwnProperty.call(testOverrides, name)) {
                        return;
                    }
                    testOverrides[name] = typeof value === 'function' ? value : null;
                }
            }
        );
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
                dom.submitBtn.disabled = state.readOnly || state.submissionStatus === 'submitting';
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
            dom.submitBtn.disabled = state.readOnly || state.submissionStatus === 'submitting';
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
                    examId: document.body.dataset.examId || state.examId || null,
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
        clearSubmissionAckTimer();
        state.lastResults = null;
        state.submitted = false;
        state.submissionStatus = 'draft';
        state.submissionId = '';
        state.pendingSubmissionPresentation = null;
        state.submittedRecordId = '';
        state.readOnly = false;
        state.timerLocked = false;
        state.timerExpired = false;
        state.timerExpiryHandled = false;
        closeReviewHighlightDictionary();
        if (dom.results) {
            dom.results.style.display = 'none';
            dom.results.innerHTML = '';
        }
        clearExplanations();
        document.body.classList.remove('review-readonly-mode');
        document.body.classList.remove('timer-locked-mode');
        // 清除判卷残留的绿/红标记，避免切回作答态后用户看到旧的对错反馈
        document.querySelectorAll('.option-correct, .option-wrong, .correct, .wrong, [data-result-filled="true"]').forEach((node) => {
            node.classList.remove('option-correct', 'option-wrong', 'correct', 'wrong');
            if (node.dataset && node.dataset.resultFilled === 'true') {
                node.classList.remove('dropzone-filled');
                delete node.dataset.resultFilled;
            }
        });
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
            // 进入 review 视图后，单篇 submitted 回传的 recordId 已不再适用，清空避免误用。
            state.submittedRecordId = '';
            if (data.readOnly !== false) {
                enterSubmittedReadOnlyState('stationary-review');
            } else {
                setReadOnlyMode(false);
            }
        }
    }

    async function applyReplayRecord(data = {}) {
        const entry = data.entry && typeof data.entry === 'object' ? data.entry : data;
        const replayData = entry.realData && typeof entry.realData === 'object' ? entry.realData : {};
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
                    : (Array.isArray(replayData.markedQuestions) ? replayData.markedQuestions : [])));
        state.reviewRecordId = String(data.recordId || entry.id || '').trim();
            // 进入 review 回放后，单篇 submitted 回传的 recordId 已不再适用，清空避免误用。
            state.submittedRecordId = '';
        if (data.reviewSessionId) {
            state.reviewSessionId = data.reviewSessionId;
        }
        if (Number.isInteger(data.reviewEntryIndex)) {
            state.reviewEntryIndex = data.reviewEntryIndex;
        }
        state.reviewMode = true;
        state.reviewViewMode = 'review';
        applyReplayAnswersToDom(replayResults.answers || {});
        const replayHighlights = Array.isArray(entry.highlights)
            ? entry.highlights
            : (Array.isArray(replayData.highlights) ? replayData.highlights : []);
        applyHighlights(replayHighlights);
        setNotes(
            Array.isArray(entry.notes) ? entry.notes : replayData.notes,
            Array.isArray(entry.noteOutlines) ? entry.noteOutlines : replayData.noteOutlines,
            { legacyText: typeof entry.noteText === 'string' ? entry.noteText : replayData.noteText }
        );
        state.markedQuestions = normalizeMarkedQuestions(replayMarks);
        enhanceReviewHighlights();
        if (Number.isFinite(Number(entry.scrollY))) {
            global.scrollTo(0, Number(entry.scrollY));
        }
        state.lastResults = replayResults;
        renderResults(replayResults);
        await renderExplanations();
        applyHighlights(replayHighlights);
        refreshNoteHighlightAttributes();
        restoreMissingNoteAnchors();
        applyMemorizeLocatorHighlights();
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
        const messageIssuedAtMs = Date.now();
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
                windowSessionToken: state.windowSessionToken || null,
                windowSessionGeneration: Number.isInteger(state.windowSessionGeneration) ? state.windowSessionGeneration : 0,
                messageIssuedAtMs,
                source: MESSAGE_SOURCE
            }, payload || {}),
            source: MESSAGE_SOURCE
        };
    }

    function normalizeWindowSessionToken(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function readMessageIssuedAtMs(data = {}) {
        const value = Number(data && (data.messageIssuedAtMs ?? data.timestamp));
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    }

    function readDraftUpdatedAt(draft = null) {
        if (!draft || typeof draft !== 'object') {
            return 0;
        }
        const value = Number(draft.updatedAt);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function shouldAcceptIncomingDraft(baseDraft = null, nextDraft = null, options = {}) {
        const baseUpdatedAt = readDraftUpdatedAt(baseDraft);
        const nextUpdatedAt = readDraftUpdatedAt(nextDraft);
        if (!nextDraft || typeof nextDraft !== 'object') {
            return false;
        }
        if (!baseUpdatedAt) {
            return true;
        }
        if (!nextUpdatedAt) {
            return Boolean(options.allowUntimedOverride);
        }
        return nextUpdatedAt >= baseUpdatedAt;
    }

    function shouldAcceptWindowSessionMessage(data = {}, sourceWindow = null) {
        const incomingToken = normalizeWindowSessionToken(data && data.windowSessionToken);
        const currentToken = normalizeWindowSessionToken(state.windowSessionToken);
        const incomingIssuedAtMs = readMessageIssuedAtMs(data);
        const currentIssuedAtMs = Number.isFinite(Number(state.windowSessionIssuedAtMs))
            ? Number(state.windowSessionIssuedAtMs)
            : 0;
        const incomingGeneration = Number(data && data.windowSessionGeneration);
        const currentGeneration = Number(state.windowSessionGeneration);

        if (sourceWindow && state.parentWindow && sourceWindow !== state.parentWindow && currentToken) {
            return false;
        }
        if (!incomingToken) {
            return !currentToken;
        }
        if (!currentToken) {
            return true;
        }
        if (incomingToken === currentToken) {
            return true;
        }
        if (Number.isInteger(incomingGeneration) && incomingGeneration > 0) {
            if (Number.isInteger(currentGeneration) && currentGeneration > 0) {
                return incomingGeneration > currentGeneration;
            }
            return true;
        }
        if (Number.isInteger(currentGeneration) && currentGeneration > 0) {
            return false;
        }
        // A timestamp alone cannot establish ordering when two registrations
        // occur in the same millisecond.  Without a generation, keep the
        // current token rather than allowing an ambiguous message to replace it.
        if (incomingIssuedAtMs && currentIssuedAtMs && incomingIssuedAtMs > currentIssuedAtMs) {
            return true;
        }
        return false;
    }

    function adoptWindowSessionMessage(data = {}, sourceWindow = null) {
        const incomingToken = normalizeWindowSessionToken(data && data.windowSessionToken);
        const incomingIssuedAtMs = readMessageIssuedAtMs(data);
        const incomingGeneration = Number(data && data.windowSessionGeneration);
        if (incomingToken) {
            state.windowSessionToken = incomingToken;
        }
        if (incomingIssuedAtMs > 0) {
            state.windowSessionIssuedAtMs = incomingIssuedAtMs;
        } else if (incomingToken && !state.windowSessionIssuedAtMs) {
            state.windowSessionIssuedAtMs = Date.now();
        }
        if (Number.isInteger(incomingGeneration) && incomingGeneration > 0) {
            state.windowSessionGeneration = incomingGeneration;
        }
    }

    function acceptHostInitMessage(event, envelope, data = {}) {
        if (!state.parentWindow || !event || event.source !== state.parentWindow) return false;
        if (!envelope || envelope.source !== HOST_MESSAGE_SOURCE) return false;
        const incomingOrigin = typeof event.origin === 'string' ? event.origin : '';
        const declaredOrigin = typeof data.parentOrigin === 'string' ? data.parentOrigin : '';
        const incomingToken = normalizeWindowSessionToken(data.windowSessionToken);
        if (!incomingToken) return false;
        // "file://" is not a usable postMessage target/origin pin.  Treat it the same
        // as an unbound referrer so file:// hosts can bind via opaque "null".
        const expectedParentOrigin = state.expectedParentOrigin
            && state.expectedParentOrigin !== 'file://'
            && !String(state.expectedParentOrigin).startsWith('file:')
            ? state.expectedParentOrigin
            : '';
        if (expectedParentOrigin) {
            if (incomingOrigin !== expectedParentOrigin || declaredOrigin !== expectedParentOrigin) {
                return false;
            }
            state.parentOrigin = expectedParentOrigin;
            state.parentOriginIsOpaque = false;
        } else if (global.location.protocol === 'file:') {
            // File pages can report either opaque "null" or "file://" for iframe
            // messages across Chromium platforms; never accept a web origin here.
            const trustedFileOrigin = (incomingOrigin === 'null' || incomingOrigin === 'file://')
                && (declaredOrigin === 'null' || declaredOrigin === '' || declaredOrigin === 'file://');
            if (!trustedFileOrigin) {
                return false;
            }
            state.parentOrigin = 'null';
            state.parentOriginIsOpaque = true;
        } else {
            const trustedWebOrigin = Boolean(incomingOrigin)
                && incomingOrigin !== 'null'
                && incomingOrigin !== 'file://'
                && declaredOrigin === incomingOrigin;
            if (!trustedWebOrigin) {
                return false;
            }
            state.parentOrigin = incomingOrigin;
            state.parentOriginIsOpaque = false;
        }
        return true;
    }

    function isTrustedHostMessage(event, envelope, data = {}) {
        if (!state.parentWindow || !event || event.source !== state.parentWindow) return false;
        if (!envelope || envelope.source !== HOST_MESSAGE_SOURCE) return false;
        const incomingOrigin = typeof event.origin === 'string' ? event.origin : '';
        if (state.parentOriginIsOpaque) {
            if (incomingOrigin !== 'null' && incomingOrigin !== 'file://') return false;
        } else if (!state.parentOrigin || incomingOrigin !== state.parentOrigin) {
            return false;
        }
        const expectedToken = normalizeWindowSessionToken(state.windowSessionToken);
        const incomingToken = normalizeWindowSessionToken(data.windowSessionToken);
        return Boolean(expectedToken && incomingToken && expectedToken === incomingToken);
    }

    function postMessage(type, payload) {
        const envelope = buildEnvelope(type, payload);
        const target = state.parentWindow;
        if (!target || target === global || typeof target.postMessage !== 'function') return false;
        const targetOrigin = state.parentOrigin && state.parentOrigin !== 'null'
            ? state.parentOrigin
            : (state.expectedParentOrigin || (global.location.protocol === 'file:' ? '*' : ''));
        if (!targetOrigin) return false;
        try {
            return target.postMessage(envelope, targetOrigin) !== false;
        } catch (_) {
            return false;
        }
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
            suiteTimerLimitSeconds: parseOptionalNonNegativeInteger(data && data.suiteTimerLimitSeconds),
            globalTimerAnchorMs: Number.isFinite(Number(data && data.globalTimerAnchorMs)) ? Number(data.globalTimerAnchorMs) : null,
            draftFingerprint: buildDraftFingerprint(data && data.draft)
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
        clearSubmissionAckTimer();
        state.submissionStatus = 'draft';
        state.submissionId = '';
        state.pendingSubmissionPresentation = null;
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

    function getSimulationDraftSessionName() {
        const suiteSessionId = state.suiteSessionId ? String(state.suiteSessionId).trim() : '';
        const examId = state.examId ? String(state.examId).trim() : '';
        if (!suiteSessionId || !examId) {
            return '';
        }
        return `simulation-draft:${suiteSessionId}:${examId}`;
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
                notes: normalizeNotes(draft.notes),
                noteOutlines: normalizeNoteOutlines(draft.noteOutlines),
                markedQuestions: normalizeMarkedQuestions(draft.markedQuestions),
                scrollY: Number.isFinite(Number(draft.scrollY)) ? Number(draft.scrollY) : 0
            };
        }
    }

    function buildDraftFingerprint(draft) {
        if (!draft || typeof draft !== 'object') {
            return '';
        }
        try {
            // updatedAt 每次调用都会刷新（Date.now()），若纳入指纹会让周期性比对永远不相等，
            // 导致空闲时每 1.5s 都会重复 POST/持久化草稿。只用稳定内容计算指纹。
            if ('updatedAt' in draft) {
                return JSON.stringify(Object.assign({}, draft, { updatedAt: null }));
            }
            return JSON.stringify(draft);
        } catch (_) {
            return '';
        }
    }

    function persistSimulationDraftMirror(draft) {
        const name = getSimulationDraftSessionName();
        if (!name || !global.AppData?.recovery?.windowSession || !draft) {
            return;
        }
        try {
            global.AppData.recovery.windowSession.save(name, {
                draft,
                updatedAt: Date.now()
            });
        } catch (_) {
            // AppData v2 recovery is best-effort during page teardown.
        }
    }

    function restoreSimulationDraftMirror() {
        const name = getSimulationDraftSessionName();
        if (!name || !global.AppData?.recovery?.windowSession) {
            return null;
        }
        try {
            const parsed = global.AppData.recovery.windowSession.get(name);
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
        const name = getSimulationDraftSessionName();
        if (!name || !global.AppData?.recovery?.windowSession) {
            return;
        }
        try {
            global.AppData.recovery.windowSession.discard(name);
        } catch (_) {
            // AppData v2 recovery is best-effort during page teardown.
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
            notes: collectNotes(),
            noteOutlines: collectNoteOutlines(),
            markedQuestions: getCurrentMarkedQuestions(),
            scrollY: global.scrollY || 0,
            updatedAt
        };
    }

    function canSyncReadingDraft() {
        return Boolean(
            !state.simulationMode
            && !state.reviewMode
            && !state.readOnly
            && !state.timerLocked
            && !state.submitted
            && !state.memorizeMode
            && state.examId
            && state.sessionId
            && state.windowSessionToken
        );
    }

    function syncReadingDraftSnapshot(reason = 'periodic') {
        if (!canSyncReadingDraft()) {
            return;
        }
        const draft = collectCurrentDraft();
        const fingerprint = buildDraftFingerprint(draft);
        if (reason === 'periodic' && fingerprint && fingerprint === state.readingDraftFingerprint) {
            return;
        }
        state.readingDraftFingerprint = fingerprint;
        const mirroredDraft = cloneDraftSafely(draft);
        if (!mirroredDraft) {
            return;
        }
        postMessage('READING_DRAFT_SYNC', {
            examId: state.examId,
            sessionId: state.sessionId || null,
            windowSessionToken: state.windowSessionToken || null,
            draft: mirroredDraft,
            draftUpdatedAt: Number.isFinite(Number(mirroredDraft.updatedAt)) ? Number(mirroredDraft.updatedAt) : Date.now(),
            elapsed: getPageElapsedSeconds(),
            timerSnapshot: getPracticeTimerSnapshot(),
            reason
        });
    }

    function stopReadingDraftSync() {
        if (state.readingDraftSyncTimer) {
            clearInterval(state.readingDraftSyncTimer);
            state.readingDraftSyncTimer = null;
        }
    }

    function refreshReadingDraftSyncLifecycle() {
        if (!canSyncReadingDraft()) {
            stopReadingDraftSync();
            return;
        }
        if (!state.readingDraftSyncTimer) {
            state.readingDraftSyncTimer = setInterval(() => {
                syncReadingDraftSnapshot('periodic');
            }, READING_DRAFT_SYNC_MS);
        }
        syncReadingDraftSnapshot('activate');
    }

    function flushReadingDraftOnLifecycle(reason = 'pagehide') {
        if (state.simulationMode && state.suiteSessionId) {
            syncSimulationDraftSnapshot(reason);
            return;
        }
        if (canSyncReadingDraft()) {
            syncReadingDraftSnapshot(reason);
            return;
        }
        // 草稿同步在 submitted/只读态被跳过；但单篇 final-submit 后若宿主已回传
        // submittedRecordId，结果页笔记改动仍需要落库——这里同步触发一次标注同步，
        // 防止页面在 450ms 防抖触发前关闭/隐藏而丢失 READING_ANNOTATION_SYNC。
        if (state.submitted && state.submittedRecordId && !state.memorizeMode && !state.reviewMode) {
            syncReadingAnnotation(reason);
        }
    }

    function syncSimulationDraftSnapshot(reason = 'periodic') {
        if (state.timerLocked) return;
        const isSuiteReviewAnnotation = Boolean(
            state.suiteReviewMode
            && state.reviewMode
            && state.suiteSessionId
        );
        if (!state.simulationMode || (state.readOnly && !isSuiteReviewAnnotation) || !state.suiteSessionId) {
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
            elapsed: getPageElapsedSeconds(),
            timerSnapshot: getPracticeTimerSnapshot(),
            reason
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
            applyAnswersToDom(draft.answers);
        }
        if (Array.isArray(draft.highlights)) {
            applyHighlights(draft.highlights);
        }
        setNotes(draft.notes, draft.noteOutlines, { legacyText: draft.noteText });
        state.markedQuestions = normalizeMarkedQuestions(draft.markedQuestions);
        if (typeof global.setPracticeMarkedQuestions === 'function') {
            try { global.setPracticeMarkedQuestions(state.markedQuestions); } catch (_) { /* ignore */ }
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
        ensureNoteAnchorsBeforeSnapshot();
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
            notes: collectNotes(),
            noteOutlines: collectNoteOutlines(),
            markedQuestions: getCurrentMarkedQuestions(),
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
                slot.navStatus.set(
                    questionId,
                    resolveComparisonNavStatus(
                        comparison,
                        hasAnswerInDataset(questionId, draft.answers || {}, slot.dataset)
                    )
                );
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
                notes: normalizeNotes(draft.notes),
                noteOutlines: normalizeNoteOutlines(draft.noteOutlines),
                markedQuestions: normalizeMarkedQuestions(draft.markedQuestions),
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
            notes: [],
            noteOutlines: [],
            markedQuestions: [],
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
            if (input.closest('#notes-panel, #reading-note-editor, #reading-note-drawer')) return;
            input.value = '';
        });
        document.querySelectorAll('select').forEach((select) => {
            select.selectedIndex = 0;
        });
        getDropzones().forEach((dropzone) => {
            clearDropzone(dropzone);
        });
        // 清除选择题/表格判卷残留的绿/红标记
        document.querySelectorAll('.option-correct, .option-wrong, .correct, .wrong').forEach((node) => {
            node.classList.remove('option-correct', 'option-wrong', 'correct', 'wrong');
        });
    }

    function dispatchSimulationNavigate(direction, submissionSnapshot = null, options = {}) {
        if (!state.simulationMode || !state.simulationCtx || state.readOnly) {
            return;
        }
        const snapshot = submissionSnapshot || buildSubmissionSnapshot();
        const requestedTargetIndex = Number(options.targetIndex);
        const hasRequestedTarget = options.targetIndex !== null
            && options.targetIndex !== undefined
            && Number.isInteger(requestedTargetIndex);
        if (state.suite?.inline) {
            updateActiveSlotFromCurrentDom('navigate');
            const currentIndex = state.suite.currentIndex;
            const targetIndex = hasRequestedTarget
                ? requestedTargetIndex
                : (direction === 'prev' ? currentIndex - 1 : currentIndex + 1);
            const targetEntry = state.suite.sequence[targetIndex];
            if (targetEntry && targetEntry.examId) {
                activateSuiteSlot(targetEntry.examId, { skipSave: true }).catch((error) => {
                    console.warn('[UnifiedReadingPage] inline simulation navigation failed:', error);
                });
            }
            return;
        }
        const payload = {
            direction: direction === 'prev' ? 'prev' : 'next',
            draft: {
                answers: snapshot.answers || {},
                highlights: Array.isArray(snapshot.highlights) ? snapshot.highlights : [],
                noteText: typeof snapshot.noteText === 'string' ? snapshot.noteText : '',
                notes: normalizeNotes(snapshot.notes),
                noteOutlines: normalizeNoteOutlines(snapshot.noteOutlines),
                markedQuestions: normalizeMarkedQuestions(snapshot.markedQuestions),
                scrollY: Number.isFinite(Number(snapshot.scrollY)) ? Number(snapshot.scrollY) : 0,
                updatedAt: Number.isFinite(Number(snapshot.updatedAt)) ? Number(snapshot.updatedAt) : Date.now()
            },
            draftUpdatedAt: Number.isFinite(Number(snapshot.updatedAt)) ? Number(snapshot.updatedAt) : Date.now(),
            resultSnapshot: snapshot.results,
            answers: snapshot.answers || {},
            highlights: Array.isArray(snapshot.highlights) ? snapshot.highlights : [],
            noteText: typeof snapshot.noteText === 'string' ? snapshot.noteText : '',
            notes: normalizeNotes(snapshot.notes),
            noteOutlines: normalizeNoteOutlines(snapshot.noteOutlines),
            markedQuestions: normalizeMarkedQuestions(snapshot.markedQuestions),
            scrollY: Number.isFinite(Number(snapshot.scrollY)) ? Number(snapshot.scrollY) : 0,
            elapsed: Number.isFinite(Number(snapshot.elapsed)) ? Number(snapshot.elapsed) : getPageElapsedSeconds(),
            timerSnapshot: snapshot.timerSnapshot || getPracticeTimerSnapshot()
        };
        if (hasRequestedTarget) {
            payload.targetIndex = requestedTargetIndex;
        }
        if (typeof options.targetPartKey === 'string' && options.targetPartKey) {
            payload.targetPartKey = options.targetPartKey;
        }
        postMessage('SIMULATION_NAVIGATE', payload);
    }
    async function handleSubmit() {
        if (state.memorizeMode && !state.reviewMode && !state.simulationMode) {
            handleExitClick();
            return;
        }
        if (state.readOnly || state.submissionStatus !== 'draft') {
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
        if (activeSlot) {
            activeSlot.lastResults = results;
        }
        const messageType = state.simulationMode ? 'SIMULATION_SUBMIT' : 'PRACTICE_COMPLETE';
        const timing = resolvePracticeTiming(1, submissionSnapshot.timerSnapshot);
        beginSubmission(messageType, Object.assign({
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
                    : normalizeMarkedQuestions(submissionSnapshot.markedQuestions)
            },
            answers: submissionSnapshot.answers || {},
            highlights: Array.isArray(submissionSnapshot.highlights) ? submissionSnapshot.highlights : [],
            noteText: typeof submissionSnapshot.noteText === 'string' ? submissionSnapshot.noteText : '',
            notes: normalizeNotes(submissionSnapshot.notes),
            noteOutlines: normalizeNoteOutlines(submissionSnapshot.noteOutlines),
            markedQuestions: normalizeMarkedQuestions(submissionSnapshot.markedQuestions),
            scrollY: Number.isFinite(Number(submissionSnapshot.scrollY)) ? Number(submissionSnapshot.scrollY) : 0
        }, state.suite?.inline ? {
            suiteSubmission: true,
            suiteEntries: Array.isArray(submissionSnapshot.suiteEntries) ? submissionSnapshot.suiteEntries : []
        } : {}, postedResults), {
            results,
            highlights: highlightSnapshot
        });
    }

    function handleReset() {
        if (state.memorizeMode) {
            requestNormalPracticeRestart('memorize-start-test');
            return;
        }
        if (state.submitted && state.readOnlyReason === 'final-submit' && !state.suiteSessionId && !state.reviewMode) {
            resetToAnsweringPresentation();
            clearCurrentAnswers();
            clearStructuredNotesForReset();
            requestNormalPracticeRestart('retake-after-submit');
            return;
        }
        if (state.readOnly || state.submitted) {
            return;
        }
        closeReviewHighlightDictionary();
        clearCurrentAnswers();
        clearStructuredNotesForReset();
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
                postMessage('ENDLESS_USER_EXIT', {});
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
            const candidateCode = resolveReadingCandidateCode();
            if (candidateCode) {
                candidateId.textContent = candidateCode;
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
        captureInlineSuiteDraftBeforeReinit('reinit');
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
        const sourceWindow = event && typeof event === 'object' ? (event.source || null) : null;
        if (type === 'INIT_SESSION' || type === 'INIT_EXAM_SESSION') {
            if (!acceptHostInitMessage(event, payload, data)) {
                return;
            }
            if (!shouldAcceptWindowSessionMessage(data, sourceWindow)) {
                return;
            }
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
            if (shouldIgnoreInlineSuiteEnvelope(data || {})) {
                return;
            }
            if (isDuplicateInit && state.sessionReadySent) {
                return;
            }
            adoptWindowSessionMessage(data, sourceWindow);
            if (incomingExamId && !currentExamId) {
                state.examId = incomingExamId;
            }
            if (data.sessionId && state.sessionId && String(data.sessionId) !== String(state.sessionId)) {
                clearSubmissionAckTimer();
                state.submissionStatus = 'draft';
                state.submissionId = '';
                state.pendingSubmissionPresentation = null;
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
            const initTimerLimitSeconds = parseOptionalNonNegativeInteger(data.suiteTimerLimitSeconds);
            if (initTimerLimitSeconds !== null) {
                state.suiteTimerLimitSeconds = initTimerLimitSeconds;
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
                // init 中的 review 模式同样不应沿用单篇 submitted 回传的 recordId。
                state.submittedRecordId = '';
                if (data.readOnly !== false) {
                    enterSubmittedReadOnlyState('stationary-review');
                } else {
                    setReadOnlyMode(false);
                }
            }
            const singleDraft = !state.simulationMode
                && !state.reviewMode
                && data
                && data.draft
                && typeof data.draft === 'object'
                ? data.draft
                : null;
            if (singleDraft) {
                applyDraftToDom(singleDraft);
                state.readingDraftFingerprint = buildDraftFingerprint(singleDraft);
            }
            syncPrimaryActionButtons();
            refreshSimulationDraftSyncLifecycle();
            refreshReadingDraftSyncLifecycle();
            syncSuiteModeState();
            stopInitLoop();
            state.lastInitSignature = initSignature;
            if (state.memorizeMode && !state.reviewMode && !state.simulationMode) {
                renderMemorizeStudyLayer().catch(() => {});
            }
            sendSessionReady();
            return;
        }
        if (!isTrustedHostMessage(event, payload, data)) {
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
        if (type === 'PRACTICE_SUBMIT_ACK') {
            await acceptSubmissionAcknowledgement(data || {});
            return;
        }
        if (type === 'PRACTICE_SUBMIT_FAILED') {
            if (matchesPendingSubmission(data || {})) {
                restoreDraftSubmissionState(String(data.submissionId || ''));
            }
            return;
        }
        if (type === 'VOCAB_HIGHLIGHT_SAVE_ACK' || type === 'VOCAB_HIGHLIGHT_SAVE_FAILED') {
            const dictionary = getReviewHighlightDictionary();
            if (dictionary && typeof dictionary.handleSaveOutcome === 'function') {
                dictionary.handleSaveOutcome(data || {}, type === 'VOCAB_HIGHLIGHT_SAVE_ACK');
            }
            return;
        }
        if (type === 'PRACTICE_RECORD_SAVED') {
            // 宿主在单篇阅读 final-submit 落库成功后回传已存档 recordId，
            // 用于支持结果页笔记改动的持久化（syncReadingAnnotation 的 submitted 分支）。
            const payloadExamId = data && data.examId != null ? String(data.examId).trim() : '';
            const currentExamId = state.examId != null ? String(state.examId).trim() : '';
            if (payloadExamId && currentExamId && payloadExamId !== currentExamId && !state.suite?.inline) {
                return;
            }
            const payloadSessionId = data && data.sessionId != null ? String(data.sessionId).trim() : '';
            const currentSessionId = state.sessionId != null ? String(state.sessionId).trim() : '';
            if (!payloadSessionId || !currentSessionId || payloadSessionId !== currentSessionId) {
                return;
            }
            const recordId = data && data.recordId != null ? String(data.recordId).trim() : '';
            state.submittedRecordId = recordId;
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
            if (!shouldAcceptWindowSessionMessage(data, sourceWindow)) {
                return;
            }
            const contextExamId = data && data.examId != null ? String(data.examId).trim() : '';
            const currentExamId = state.examId != null ? String(state.examId).trim() : '';
            const contextSuiteSequence = normalizeSuiteSequence(data && data.suiteSequence);
            const contextExamInSuiteSequence = Boolean(
                contextExamId
                && contextSuiteSequence.length
                && contextSuiteSequence.some((entry) => entry.examId === contextExamId)
            );
            if (shouldIgnoreInlineSuiteEnvelope(data || {})) {
                return;
            }
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
            adoptWindowSessionMessage(data, sourceWindow);
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
            const contextTimerLimitSeconds = parseOptionalNonNegativeInteger(data.suiteTimerLimitSeconds);
            if (contextTimerLimitSeconds !== null) {
                state.suiteTimerLimitSeconds = contextTimerLimitSeconds;
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

    function attachReadingDraftLifecycleHooks() {
        const flush = (reason) => {
            try {
                // 先把编辑器里未提交的笔记立刻刷出：review 页面 flushReadingDraftOnLifecycle
                // 会因 canSyncReadingDraft 直接 no-op，笔记只能靠 450ms 防抖提交，页面在
                // 防抖触发前关闭/隐藏就会丢失 READING_ANNOTATION_SYNC。这里同步触发一次，
                // review 路径在同步里发出最新的 note，正常阅读路径则继续走 draft 快照。
                if (typeof flushActiveNoteFromEditor === 'function') {
                    flushActiveNoteFromEditor();
                }
                flushReadingDraftOnLifecycle(reason);
            } catch (_) {
                // ignore draft flush failures during teardown
            }
        };
        global.addEventListener('pagehide', () => flush('pagehide'));
        global.addEventListener('beforeunload', () => flush('beforeunload'));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flush('visibilitychange');
            }
        });
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
        await loadReadingCandidateCodePreferences();
        if (global.PracticeTimerPreferences?.ready) await global.PracticeTimerPreferences.ready;
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

        initDragPools();

        attachUnifiedTimer();
        attachUnifiedPanels();
        ensureReadingNotesUi();
        ensureReadingDisplayControls();
        await loadReadingDisplayPreferences();
        attachSelectionHighlightToolbar();
        attachReviewHighlightDictionary();
        attachActionListeners();
        attachMessageBridge();
        attachPracticeTimerBridge();
        attachReadingDraftLifecycleHooks();
        syncSuiteModeState();
        setExitButtonVisible(false);
        if (state.memorizeMode) {
            await renderMemorizeStudyLayer();
        }
        updateNavStatuses();
        refreshSimulationDraftSyncLifecycle();
        refreshReadingDraftSyncLifecycle();
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
