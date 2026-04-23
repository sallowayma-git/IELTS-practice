(function initUnifiedReadingPage(global) {
    'use strict';

    const MESSAGE_SOURCE = 'practice_page';
    const INIT_RETRY_MS = 1500;
    const SIMULATION_DRAFT_SYNC_MS = 1200;
    const EXPLANATION_STYLE_ID = 'reading-explanation-style';
    const PRACTICE_TIMER_BRIDGE_KEY = '__IELTS_PRACTICE_TIMER__';
    const PRACTICE_TIMER_EVENT = 'practiceTimerStateChange';
    const EXPLANATION_SPLIT_KINDS = new Set([
        'single_choice',
        'multi_choice',
        'true_false_not_given',
        'yes_no_not_given'
    ]);
    const navStatus = new Map();
    const scriptCache = new Map();
    function getAnswerMatchCore() {
        const core = global.AnswerMatchCore;
        if (!core || typeof core !== 'object') {
            return null;
        }
        return core;
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
        readOnly: false,
        reviewContext: null,
        suiteReviewMode: false,
        pageStartTime: Date.now(),
        pagePausedAtMs: null,
        pagePausedOffsetMs: 0,
        simulationGlobalAnchorMs: null,
        suiteTimerAnchorMs: null,
        suiteTimerMode: null,
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
        left: null,
        groups: null,
        results: null,
        nav: null,
        submitBtn: null,
        resetBtn: null
    };

    function getPracticeTimerBridge() {
        return global[PRACTICE_TIMER_BRIDGE_KEY];
    }

    function getPracticeTimerSnapshot() {
        return getPracticeTimerBridge().getSnapshot();
    }

    function getPageElapsedSeconds() {
        const referenceNow = Number.isFinite(state.pagePausedAtMs)
            ? state.pagePausedAtMs
            : Date.now();
        return Math.max(
            0,
            Math.round((referenceNow - state.pageStartTime - state.pagePausedOffsetMs) / 1000)
        );
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

    function resolvePracticeTiming(minDurationSeconds = 0) {
        const snapshot = getPracticeTimerSnapshot();
        return {
            duration: Math.max(minDurationSeconds, Math.round(Number(snapshot.durationSeconds))),
            startTimeMs: Math.floor(Number(snapshot.effectiveStartTimeMs)),
            endTimeMs: Math.floor(Number(snapshot.effectiveEndTimeMs))
        };
    }

    function decodeParam(value) {
        if (!value) return '';
        try {
            return decodeURIComponent(value.replace(/\+/g, ' '));
        } catch (_) {
            return value;
        }
    }

    function parseQuery() {
        const params = new URLSearchParams(global.location.search);
        state.examId = decodeParam(params.get('examId')) || null;
        state.dataKey = decodeParam(params.get('dataKey')) || state.examId;
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
        const suiteTimerLimitSeconds = Number(params.get('suiteTimerLimitSeconds'));
        if (Number.isFinite(suiteTimerLimitSeconds) && suiteTimerLimitSeconds >= 0) {
            state.suiteTimerLimitSeconds = Math.floor(suiteTimerLimitSeconds);
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
        dom.left = document.getElementById('left');
        dom.groups = document.getElementById('question-groups');
        dom.results = document.getElementById('results');
        dom.nav = document.getElementById('question-nav');
        dom.submitBtn = document.getElementById('submit-btn');
        dom.resetBtn = document.getElementById('reset-btn');
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

    function clearExplanations() {
        document.querySelectorAll(
            '.reading-explanation-card, .reading-group-explanation, .reading-question-explanation, .reading-question-explanation-list'
        ).forEach((node) => node.remove());
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
        const lead = group.leadHtml ? `<div class="unified-group__lead">${group.leadHtml}</div>` : '';
        const questionIds = Array.isArray(group.questionIds) ? group.questionIds.join(',') : '';
        const allowOptionReuseFlag = resolveAllowOptionReuse(group);
        const allowOptionReuse = typeof allowOptionReuseFlag === 'boolean'
            ? ` data-allow-option-reuse="${allowOptionReuseFlag ? 'true' : 'false'}"`
            : '';
        return `
            <section class="unified-group" data-group-id="${group.groupId}" data-question-ids="${questionIds}"${allowOptionReuse}>
                ${lead}
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
            dom.subtitle.textContent = `统一阅读页 · ${dataset.meta?.category || ''} · ${questionCount} 题`;
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

    function buildQuestionNav() {
        if (!dom.nav) return;
        const order = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : [];
        dom.nav.innerHTML = order.map((questionId) => {
            const status = navStatus.get(questionId) || '';
            const label = displayLabel(questionId);
            return `<button class="q-item ${status}" data-question-id="${questionId}" type="button">${label}</button>`;
        }).join('');
    }

    function normalizeQuestionId(rawValue) {
        if (!rawValue) return null;
        const value = String(rawValue).trim().toLowerCase();
        const match = value.match(/q(\d+)/);
        return match ? `q${match[1]}` : null;
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

    function navClickHandler(event) {
        const button = event.target.closest('.q-item[data-question-id]');
        if (!button) return;
        const questionId = button.dataset.questionId;
        const target = findQuestionAnchor(questionId);
        if (target && typeof global.scrollToElement === 'function') {
            global.scrollToElement(target);
            return;
        }
        target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }

    function attachNavListeners() {
        dom.nav?.addEventListener('click', navClickHandler);
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
        const escaped = escapeSelector(questionId);
        const directByAnchor = groupEl.querySelector(`#${escaped}-anchor`);
        if (directByAnchor) {
            return directByAnchor.closest('.question-item, .tfng-item, .match-question-item, .question-row, .summary-completion')
                || directByAnchor.parentElement;
        }
        const inputByName = groupEl.querySelector(`[name="${escaped}"]`);
        if (inputByName) {
            return inputByName.closest('.question-item, .tfng-item, .match-question-item, .question-row, .summary-completion');
        }
        const byData = groupEl.querySelector(`[data-question="${escaped}"]`);
        if (byData) {
            return byData.closest('.question-item, .match-question-item, .paragraph-wrapper, .summary-completion') || byData.parentElement;
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
            const splitMode = EXPLANATION_SPLIT_KINDS.has(group.kind);

            if (splitMode) {
                const section = pickSectionForGroup(questionNumbers, 'per_question')
                    || pickSectionForGroup(questionNumbers, null);
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
        // practice-page-ui.js already manages drag boundaries and placing items.
        // We only need to ensure the dropzones have the correct structure initialized.
        getDropzones().forEach((dropzone, index) => {
            if (!dropzone.dataset.dropzoneId) {
                dropzone.dataset.dropzoneId = `dropzone-${index + 1}`;
            }
            ensureDropzoneHolder(dropzone);
            updateDropzoneState(dropzone);
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

    function splitAnswerTokens(rawValue) {
        if (Array.isArray(rawValue)) {
            return rawValue.map((item) => String(item == null ? '' : item).trim()).filter(Boolean);
        }
        const text = String(rawValue == null ? '' : rawValue).trim();
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
        setDropzoneAnswer(dropzone, value, value);
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
        const core = getAnswerMatchCore();
        if (Array.isArray(value)) {
            if (core && typeof core.splitAnswerTokens === 'function') {
                return core.splitAnswerTokens(value);
            }
            return value.map((entry) => canonicalizeAnswerToken(entry)).filter(Boolean);
        }
        if (value == null) return '';
        return canonicalizeAnswerToken(value);
    }

    function canonicalizeAnswerToken(value) {
        const core = getAnswerMatchCore();
        if (core && typeof core.normalizeToken === 'function') {
            return core.normalizeToken(value);
        }
        if (value == null) return '';
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
        if (core && typeof core.compareAnswers === 'function') {
            return core.compareAnswers(userAnswer, correctAnswer) === true;
        }
        const toTokens = (value) => {
            const source = Array.isArray(value) ? value : splitAnswerTokens(value);
            return Array.from(new Set(
                source.map((entry) => canonicalizeAnswerToken(entry)).filter(Boolean)
            ));
        };
        const actualTokens = toTokens(userAnswer);
        const expectedTokens = toTokens(correctAnswer);
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
        return Array.isArray(value) ? value.some(Boolean) : !!String(value || '').trim();
    }

    function buildResults() {
        const answers = collectAnswers();
        const answerKey = state.dataset?.answerKey || {};
        const questionOrder = Array.isArray(state.dataset?.questionOrder) ? state.dataset.questionOrder : Object.keys(answerKey);
        const answerComparison = {};
        const details = {};
        let correctCount = 0;
        let totalQuestions = 0;

        questionOrder.forEach((questionId) => {
            const userAnswer = answers[questionId] || '';
            const correctAnswer = answerKey[questionId];
            const isCorrect = compareAnswers(userAnswer, correctAnswer);
            const weight = questionWeight(correctAnswer);
            totalQuestions += weight;
            if (isCorrect) {
                correctCount += weight;
            }
            answerComparison[questionId] = {
                questionId,
                userAnswer,
                correctAnswer,
                isCorrect
            };
            details[questionId] = {
                questionId,
                userAnswer,
                correctAnswer,
                isCorrect
            };
        });

        const accuracy = totalQuestions > 0 ? correctCount / totalQuestions : 0;
        return {
            answers,
            answerComparison,
            correctAnswers: answerKey,
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

    function renderResults(results) {
        if (!dom.results) return;
        const rows = Object.values(results.answerComparison).map((entry) => {
            const label = displayLabel(entry.questionId);
            const userAnswer = Array.isArray(entry.userAnswer) ? entry.userAnswer.join(', ') : (entry.userAnswer || '未作答');
            const correctAnswer = Array.isArray(entry.correctAnswer) ? entry.correctAnswer.join(', ') : entry.correctAnswer;
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

            const valueList = Array.isArray(rawValue)
                ? rawValue.map((item) => String(item).trim()).filter(Boolean)
                : String(rawValue == null ? '' : rawValue).split(',').map((item) => item.trim()).filter(Boolean);
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

    function setReadOnlyMode(enabled) {
        state.readOnly = Boolean(enabled);
        document.body.classList.toggle('review-readonly-mode', state.readOnly);
        if (dom.submitBtn) {
            if (!dom.submitBtn.dataset.defaultLabel) {
                dom.submitBtn.dataset.defaultLabel = dom.submitBtn.textContent || 'Submit';
            }
            dom.submitBtn.disabled = state.readOnly;
            if (state.readOnly) {
                dom.submitBtn.textContent = '回顾模式';
            } else {
                dom.submitBtn.textContent = dom.submitBtn.dataset.defaultLabel;
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
            dom.submitBtn.dataset.defaultLabel = dom.submitBtn.textContent || 'Submit';
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
        if (!simulationEnabled || state.reviewMode) {
            if (dom.submitBtn) {
                dom.submitBtn.style.display = '';
                if (dom.submitBtn.dataset.defaultType) {
                    dom.submitBtn.setAttribute('type', dom.submitBtn.dataset.defaultType);
                }
                if (!state.readOnly) {
                    dom.submitBtn.textContent = dom.submitBtn.dataset.defaultLabel || 'Submit';
                }
            }
            if (dom.resetBtn) {
                dom.resetBtn.style.display = '';
                if (dom.resetBtn.dataset.defaultType) {
                    dom.resetBtn.setAttribute('type', dom.resetBtn.dataset.defaultType);
                }
                if (!state.readOnly) {
                    dom.resetBtn.textContent = dom.resetBtn.dataset.defaultLabel || 'Reset';
                }
                dom.resetBtn.disabled = state.readOnly;
            }
            return;
        }
        if (dom.resetBtn) {
            dom.resetBtn.style.display = '';
            dom.resetBtn.setAttribute('type', 'button');
            dom.resetBtn.textContent = '上一题';
            dom.resetBtn.disabled = state.readOnly || !ctx.canPrev;
        }
        if (dom.submitBtn) {
            dom.submitBtn.style.display = '';
            dom.submitBtn.setAttribute('type', 'button');
            dom.submitBtn.textContent = ctx.isLast ? 'Submit' : '下一题';
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
        if (dom.results) {
            dom.results.style.display = 'none';
            dom.results.innerHTML = '';
        }
        clearExplanations();
        updateNavStatuses();
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
        } else {
            state.reviewMode = true;
            setReadOnlyMode(data.readOnly !== false);
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
        state.lastResults = replayResults;
        state.submitted = true;
        renderResults(replayResults);
        await renderExplanations();
        updateNavStatuses(replayResults);
        setReadOnlyMode(data.readOnly !== false);
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
                return;
            } catch (_) {
                // try next candidate
            }
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
        return {
            answers,
            highlights: collectHighlights(),
            scrollY: global.scrollY || 0
        };
    }

    function syncSimulationDraftSnapshot(reason = 'periodic') {
        if (!state.simulationMode || state.readOnly || !state.suiteSessionId) {
            return;
        }
        const draft = collectCurrentDraft();
        const fingerprint = buildDraftFingerprint(draft);
        if (reason === 'periodic' && fingerprint && fingerprint === state.simulationDraftFingerprint) {
            return;
        }
        state.simulationDraftFingerprint = fingerprint;
        const mirroredDraft = cloneDraftSafely(draft);
        if (!mirroredDraft) {
            return;
        }
        persistSimulationDraftMirror(mirroredDraft);
        postMessage('SIMULATION_DRAFT_SYNC', {
            draft: mirroredDraft,
            elapsed: getPageElapsedSeconds()
        });
    }

    function refreshSimulationDraftSyncLifecycle() {
        const shouldSync = Boolean(
            state.simulationMode
            && state.simulationContextReady
            && !state.readOnly
            && state.suiteSessionId
            && state.examId
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
                    textInput.value = Array.isArray(value) ? value.join(', ') : (value || '');
                    return;
                }
                const namedTextFields = Array.from(
                    document.querySelectorAll(`input[name="${escapedId}"], textarea[name="${escapedId}"]`)
                ).filter((field) => field.type !== 'radio' && field.type !== 'checkbox');
                if (namedTextFields.length) {
                    const normalizedTextValue = Array.isArray(value) ? value.join(', ') : (value || '');
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
        if (typeof draft.scrollY === 'number') {
            global.scrollTo(0, draft.scrollY);
        }
    }

    function unwrapHighlights(root) {
        if (!root) return;
        root.querySelectorAll('.hl').forEach((highlight) => {
            const parent = highlight.parentNode;
            if (!parent) return;
            while (highlight.firstChild) {
                parent.insertBefore(highlight.firstChild, highlight);
            }
            parent.removeChild(highlight);
            parent.normalize();
        });
    }

    function resolveHighlightKind(node) {
        if (!(node instanceof HTMLElement)) {
            return 'highlight';
        }
        if (node.dataset && node.dataset.hlType === 'note') {
            return 'note';
        }
        return 'highlight';
    }

    function applyHighlightKind(node, kind = 'highlight') {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        node.classList.add('hl');
        if (kind === 'note') {
            node.dataset.hlType = 'note';
        } else {
            delete node.dataset.hlType;
        }
    }

    function resolveHighlightRoot(scope) {
        if (scope === 'left') return dom.left;
        return dom.groups;
    }

    function collectHighlights() {
        const records = [];
        const addScopeHighlights = (scope, root) => {
            if (!root) return;
            const seenByText = new Map();
            const fullText = String(root.textContent || '');
            const cursorByText = new Map();
            Array.from(root.querySelectorAll('.hl')).forEach((node) => {
                const text = String(node.textContent || '').trim();
                if (!text) return;
                const key = `${scope}::${text}`;
                const seen = seenByText.get(key) || 0;
                seenByText.set(key, seen + 1);
                let cursor = cursorByText.get(key) || 0;
                let hit = -1;
                for (let index = 0; index <= seen; index += 1) {
                    hit = fullText.indexOf(text, cursor);
                    if (hit < 0) break;
                    cursor = hit + text.length;
                }
                if (hit < 0) return;
                cursorByText.set(key, cursor);
                records.push({
                    scope,
                    text,
                    kind: resolveHighlightKind(node),
                    occurrence: seen,
                    startOffset: hit,
                    endOffset: hit + text.length,
                    before: fullText.slice(Math.max(0, hit - 20), hit),
                    after: fullText.slice(hit + text.length, hit + text.length + 20)
                });
            });
        };
        addScopeHighlights('left', dom.left);
        addScopeHighlights('groups', dom.groups);
        return records;
    }

    function resolveRangeFromOffsets(root, start, end) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        let offset = 0;
        let startNode = null;
        let endNode = null;
        let startOffset = 0;
        let endOffset = 0;
        while (node) {
            const text = node.textContent || '';
            const nextOffset = offset + text.length;
            if (!startNode && start >= offset && start <= nextOffset) {
                startNode = node;
                startOffset = Math.max(0, start - offset);
            }
            if (!endNode && end >= offset && end <= nextOffset) {
                endNode = node;
                endOffset = Math.max(0, end - offset);
            }
            if (startNode && endNode) {
                break;
            }
            offset = nextOffset;
            node = walker.nextNode();
        }
        if (!startNode || !endNode) {
            return null;
        }
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        return range;
    }

    function applyHighlightRecord(record) {
        if (!record || !record.text) return;
        const root = resolveHighlightRoot(record.scope);
        if (!root) return;
        const fullText = String(root.textContent || '');
        if (!fullText) return;
        const highlightKind = record.kind === 'note' ? 'note' : 'highlight';
        const normalizedRecordText = String(record.text || '').replace(/\s+/g, ' ').trim();
        const startOffset = Number(record.startOffset);
        const endOffset = Number(record.endOffset);
        if (
            Number.isFinite(startOffset)
            && Number.isFinite(endOffset)
            && endOffset > startOffset
            && startOffset >= 0
            && endOffset <= fullText.length
        ) {
            const segment = fullText.slice(startOffset, endOffset);
            const normalizedSegment = String(segment || '').replace(/\s+/g, ' ').trim();
            const offsetLooksValid = !normalizedRecordText
                || normalizedSegment === normalizedRecordText
                || normalizedSegment.includes(normalizedRecordText)
                || normalizedRecordText.includes(normalizedSegment);
            if (offsetLooksValid) {
                const offsetRange = resolveRangeFromOffsets(root, startOffset, endOffset);
                if (offsetRange && !offsetRange.collapsed) {
                    const offsetSpan = document.createElement('span');
                    applyHighlightKind(offsetSpan, highlightKind);
                    try {
                        offsetRange.surroundContents(offsetSpan);
                        return;
                    } catch (_) {
                        // fallback to text-based restore
                    }
                }
            }
        }
        let cursor = 0;
        let hit = -1;
        const requiredOccurrence = Number.isFinite(Number(record.occurrence)) ? Number(record.occurrence) : 0;
        for (let index = 0; index <= requiredOccurrence; index += 1) {
            hit = fullText.indexOf(record.text, cursor);
            if (hit < 0) break;
            cursor = hit + record.text.length;
        }
        if (hit < 0) {
            return;
        }
        const expectedBefore = String(record.before || '').trim();
        const expectedAfter = String(record.after || '').trim();
        if (expectedBefore && !fullText.slice(Math.max(0, hit - expectedBefore.length), hit).includes(expectedBefore)) {
            return;
        }
        if (expectedAfter && !fullText.slice(hit + record.text.length, hit + record.text.length + expectedAfter.length).includes(expectedAfter)) {
            return;
        }
        const range = resolveRangeFromOffsets(root, hit, hit + record.text.length);
        if (!range || range.collapsed) {
            return;
        }
        const span = document.createElement('span');
        applyHighlightKind(span, highlightKind);
        try {
            range.surroundContents(span);
        } catch (_) {
            // ignore malformed ranges
        }
    }

    function applyHighlights(records = []) {
        unwrapHighlights(dom.left);
        unwrapHighlights(dom.groups);
        if (!Array.isArray(records) || !records.length) {
            return;
        }
        records.forEach((record) => applyHighlightRecord(record));
    }

    function dispatchSimulationNavigate(direction) {
        if (!state.simulationMode || !state.simulationCtx || state.readOnly) {
            return;
        }
        postMessage('SIMULATION_NAVIGATE', {
            direction: direction === 'prev' ? 'prev' : 'next',
            draft: collectCurrentDraft(),
            resultSnapshot: buildResults(),
            elapsed: getPageElapsedSeconds()
        });
    }
    async function handleSubmit() {
        if (state.readOnly) {
            return;
        }
        if (state.simulationMode) {
            syncSimulationDraftSnapshot('submit');
        }
        if (state.simulationMode && state.simulationCtx && !state.simulationCtx.isLast) {
            dispatchSimulationNavigate('next');
            return;
        }
        const results = buildResults();
        state.lastResults = results;
        renderResults(results);
        await renderExplanations();
        updateNavStatuses(results);
        const messageType = state.simulationMode ? 'SIMULATION_SUBMIT' : 'PRACTICE_COMPLETE';
        const timing = resolvePracticeTiming(1);
        postMessage(messageType, Object.assign({
            duration: timing.duration,
            startTime: new Date(timing.startTimeMs).toISOString(),
            endTime: new Date(timing.endTimeMs).toISOString(),
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
            }
        }, results));
        if (state.simulationMode && state.simulationCtx && state.simulationCtx.isLast) {
            stopSimulationDraftSync();
            clearSimulationDraftMirror();
            state.simulationDraftFingerprint = '';
        }
    }

    function handleReset() {
        if (state.readOnly) {
            return;
        }
        if (state.simulationMode && state.simulationCtx) {
            if (state.simulationCtx.canPrev) {
                dispatchSimulationNavigate('prev');
            }
            return;
        }
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
        if (dom.results) {
            dom.results.style.display = 'none';
            dom.results.innerHTML = '';
        }
        clearExplanations();
        updateNavStatuses();
    }

    function attachActionListeners() {
        dom.submitBtn?.addEventListener('click', handleSubmit);
        dom.resetBtn?.addEventListener('click', handleReset);
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
        if (typeof global.updatePracticeSuiteModeUI === 'function') {
            try {
                global.updatePracticeSuiteModeUI(isSuiteMode);
            } catch (_) {
                // ignore sync errors between scripts
            }
        }
    }

    function handleIncoming(event) {
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
            if (incomingExamId && currentExamId && incomingExamId !== currentExamId) {
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
                    flowMode: 'simulation'
                };
            } else if (initFlowMode) {
                state.simulationMode = false;
                state.simulationContextReady = false;
                state.simulationCtx = null;
            }
            if (data.reviewMode) {
                state.reviewMode = true;
                setReadOnlyMode(data.readOnly !== false);
            }
            syncPrimaryActionButtons();
            refreshSimulationDraftSyncLifecycle();
            syncSuiteModeState();
            stopInitLoop();
            if (isDuplicateInit && state.sessionReadySent) {
                return;
            }
            state.lastInitSignature = initSignature;
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
            if (contextExamId && currentExamId && contextExamId !== currentExamId) {
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
            const elapsedSeconds = Number.isFinite(Number(data.elapsed)) ? Number(data.elapsed) : 0;
            state.pageStartTime = Date.now() - (elapsedSeconds * 1000);
            state.pagePausedAtMs = null;
            state.pagePausedOffsetMs = 0;
            syncPrimaryActionButtons();
            const draftFromParent = data && data.draft && typeof data.draft === 'object'
                ? data.draft
                : null;
            const draft = draftFromParent || restoreSimulationDraftMirror();
            if (draft) {
                applyDraftToDom(draft);
                state.simulationDraftFingerprint = buildDraftFingerprint(draft);
                persistSimulationDraftMirror(cloneDraftSafely(draft));
            }
            refreshSimulationDraftSyncLifecycle();
            updateNavStatuses();
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
        buildQuestionNav();
        attachNavListeners();
        attachDragDrop();

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

        attachActionListeners();
        attachMessageBridge();
        attachPracticeTimerBridge();
        syncSuiteModeState();
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
