(function initUnifiedReadingPage(global) {
    'use strict';

    const MESSAGE_SOURCE = 'practice_page';
    const INIT_RETRY_MS = 1500;
    const SIMULATION_DRAFT_SYNC_MS = 1200;
    const PENDING_PRACTICE_MESSAGES_KEY = 'exam_system_pending_practice_messages_v1';
    const WINDOW_NAME_PENDING_PREFIX = '__exam_pending_practice_v1__';
    const LOCAL_API_INFO_STORAGE_KEY = 'exam_system_local_api_info_v1';
    const READING_COACH_API_PATH = '/api/reading/assistant/query/stream';
    const READING_COACH_STYLE_ID = 'reading-coach-style';
    const COACH_REQUEST_TIMEOUT_MS = 30000;
    const QUICK_ACTIONS = Object.freeze([
        { id: 'hint', label: '给我提示' },
        { id: 'explain', label: '解释这题' },
        { id: 'review', label: '复盘错题' },
        { id: 'similar', label: '推荐同类题' }
    ]);
    const EXPLANATION_STYLE_ID = 'reading-explanation-style';
    const ANALYSIS_STYLE_ID = 'reading-single-attempt-analysis-style';
    const EXPLANATION_SPLIT_KINDS = new Set([
        'single_choice',
        'multi_choice',
        'true_false_not_given',
        'yes_no_not_given'
    ]);
    const navStatus = new Map();
    const scriptCache = new Map();
    const pendingCoachBridgeRequests = new Map();
    const QUESTION_KIND_LABELS = {
        single_choice: '单选题',
        multi_choice: '多选题',
        true_false_not_given: '判断题（T/F/NG）',
        yes_no_not_given: '判断题（Y/N/NG）',
        sentence_completion: '句子填空',
        summary_completion: '摘要填空',
        table_completion: '表格填空',
        note_completion: '笔记填空',
        form_completion: '表单填空',
        flow_chart_completion: '流程图填空',
        matching: '匹配题',
        matching_headings: '标题匹配',
        matching_information: '信息匹配',
        matching_features: '特征匹配',
        matching_sentence_endings: '句尾匹配',
        short_answer: '简答题',
        diagram_label_completion: '图示标注',
        map_labeling: '地图标注',
        plan_map_diagram_labeling: '地图/图示标注',
        unknown: '未映射题型'
    };

    function formatQuestionKindLabel(kind) {
        const normalized = normalizeAnalysisLabel(kind, 'unknown');
        return QUESTION_KIND_LABELS[normalized] || normalized;
    }
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
        startTime: Date.now(),
        pageStartTime: Date.now(),
        simulationGlobalAnchorMs: null,
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
        interactionCount: 0,
        questionTimeline: new Map(),
        answerSnapshot: {},
        parentWindow: global.opener || global.parent || null,
        llmAnalysisStatus: 'idle',
        llmAnalysisMessage: '',
        llmAnalysisRequestId: 0,
        readingCoachStatus: 'idle',
        readingCoachError: '',
        readingCoachBusy: false,
        readingCoachRequestId: 0,
        readingCoachSnapshot: null,
        readingCoachTranscript: [],
        readingCoachUiReady: false,
        readingCoachOpen: false,
        readingCoachFabDragSuppressUntil: 0
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

    function decodeParam(value) {
        if (!value) return '';
        try {
            return decodeURIComponent(value.replace(/\+/g, ' '));
        } catch (_) {
            return value;
        }
    }

    function readLocalApiInfoFromStorage() {
        const stores = [global.sessionStorage, global.localStorage].filter(Boolean);
        for (let index = 0; index < stores.length; index += 1) {
            const store = stores[index];
            try {
                const raw = store.getItem(LOCAL_API_INFO_STORAGE_KEY);
                if (!raw) {
                    continue;
                }
                const parsed = JSON.parse(raw);
                const baseUrl = parsed && typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
                if (baseUrl) {
                    return baseUrl;
                }
            } catch (_) {
                // ignore malformed cache
            }
        }
        return null;
    }

    function clearLocalApiInfoCache() {
        [global.sessionStorage, global.localStorage].filter(Boolean).forEach((store) => {
            try {
                store.removeItem(LOCAL_API_INFO_STORAGE_KEY);
            } catch (_) {
                // ignore storage failures
            }
        });
    }

    function persistLocalApiInfo(baseUrl) {
        const normalized = typeof baseUrl === 'string' ? baseUrl.trim() : '';
        if (!normalized) {
            return;
        }
        const serialized = JSON.stringify({ baseUrl: normalized, updatedAt: Date.now() });
        [global.sessionStorage, global.localStorage].filter(Boolean).forEach((store) => {
            try {
                store.setItem(LOCAL_API_INFO_STORAGE_KEY, serialized);
            } catch (_) {
                // ignore storage failures
            }
        });
    }

    function resolveRuntimeParam(name) {
        try {
            const params = new URLSearchParams(global.location && global.location.search ? global.location.search : '');
            const value = params.get(name);
            return value && String(value).trim() ? String(value).trim() : '';
        } catch (_) {
            return '';
        }
    }

    function normalizeFlowMode(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }

    function isElectronRuntimeContext() {
        return resolveRuntimeParam('runtime') === 'electron';
    }

    function resolveSimulationSequence(rawIndex, rawTotal) {
        const currentIndex = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : 0;
        const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 3;
        const isLast = currentIndex >= total - 1;
        return { currentIndex, total, isLast, canPrev: currentIndex > 0, canNext: !isLast, flowMode: 'simulation' };
    }

    function applySimulationState(simulationCtx, ready) {
        state.simulationMode = true;
        state.simulationContextReady = !!ready;
        state.simulationCtx = simulationCtx;
    }

    function clearSimulationState(clearDraftMirror = false) {
        state.simulationMode = false;
        state.simulationContextReady = false;
        state.simulationCtx = null;
        if (clearDraftMirror) {
            stopSimulationDraftSync();
            clearSimulationDraftMirror();
            state.simulationDraftFingerprint = '';
        }
    }

    function syncReviewCursor(data = {}, indexKey = 'reviewEntryIndex') {
        if (data.reviewSessionId) state.reviewSessionId = data.reviewSessionId;
        if (Number.isInteger(data[indexKey])) state.reviewEntryIndex = data[indexKey];
    }

    function applyReviewMode(enabled, payload = {}, viewMode = null) {
        state.reviewMode = Boolean(enabled);
        if (typeof viewMode === 'string') state.reviewViewMode = viewMode;
        setReadOnlyMode(state.reviewMode ? payload.readOnly !== false : false);
    }

    function resolveReplayMarkedQuestions(payload = {}, entry = {}) {
        const metadataMarks = entry && entry.metadata && entry.metadata.markedQuestions;
        return Array.isArray(payload.markedQuestions)
            ? payload.markedQuestions
            : (Array.isArray(entry.markedQuestions) ? entry.markedQuestions : (Array.isArray(metadataMarks) ? metadataMarks : []));
    }

    function applyReplayMarkedQuestions(markedQuestions) {
        if (typeof global.setPracticeMarkedQuestions === 'function') {
            try { global.setPracticeMarkedQuestions(markedQuestions); } catch (_) {}
        }
    }

    function buildSessionReadyPayload() {
        return {
            url: global.location.href, pageType: 'unified-reading', title: state.dataset?.meta?.title || document.title,
            reviewMode: state.reviewMode, readOnly: state.readOnly, reviewSessionId: state.reviewSessionId, reviewEntryIndex: state.reviewEntryIndex
        };
    }

    function buildRequestInitPayload() { return { derivedExamId: state.examId, url: global.location.href, title: document.title }; }

    function parseQuery() {
        const params = new URLSearchParams(global.location.search);
        state.examId = decodeParam(params.get('examId')) || null;
        state.dataKey = decodeParam(params.get('dataKey')) || state.examId;
        const suiteSessionId = decodeParam(params.get('suiteSessionId')) || null;
        if (suiteSessionId) {
            state.suiteSessionId = suiteSessionId;
        }
        const queryFlowMode = normalizeFlowMode(decodeParam(params.get('suiteFlowMode')));
        if (queryFlowMode === 'simulation') {
            applySimulationState(
                resolveSimulationSequence(Number(params.get('suiteSequenceIndex')), Number(params.get('suiteSequenceTotal'))),
                false
            );
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

    function ensureAnalysisStyles() {
        if (document.getElementById(ANALYSIS_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = ANALYSIS_STYLE_ID;
        style.textContent = `
            .reading-kind-radar {
                margin: 14px 0 12px;
                padding: 12px;
                border: 1px solid rgba(148, 163, 184, 0.35);
                border-radius: 10px;
                background: rgba(248, 250, 252, 0.92);
            }
            .reading-kind-radar h5 {
                margin: 0 0 10px;
                font-size: 14px;
                color: #0f172a;
            }
            .reading-kind-radar__layout {
                display: grid;
                grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
                gap: 12px;
                align-items: center;
            }
            .reading-kind-radar__svg {
                width: 100%;
                max-width: 260px;
                height: auto;
            }
            .reading-kind-radar__legend {
                margin: 0;
                padding: 0;
                list-style: none;
                display: grid;
                gap: 6px;
            }
            .reading-kind-radar__legend-item {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                font-size: 12px;
                color: #1f2937;
            }
            .reading-kind-radar__legend-item strong {
                color: #0f172a;
                font-weight: 700;
            }
            .reading-kind-radar--empty p {
                margin: 0;
                color: #475569;
                font-size: 12px;
            }
            .reading-guidance-card {
                margin: 0 0 12px;
                padding: 12px;
                border: 1px solid rgba(148, 163, 184, 0.3);
                border-radius: 10px;
                background: rgba(248, 250, 252, 0.92);
                display: grid;
                gap: 8px;
            }
            .reading-guidance-card__head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
            }
            .reading-guidance-card h5 {
                margin: 0;
                font-size: 14px;
                color: #0f172a;
            }
            .reading-guidance-card__ai-review-btn {
                border: 1px solid rgba(14, 116, 144, 0.35);
                border-radius: 8px;
                background: rgba(14, 165, 233, 0.12);
                color: #075985;
                font-size: 12px;
                font-weight: 700;
                padding: 6px 10px;
                cursor: pointer;
                transition: background-color 0.2s ease, border-color 0.2s ease;
            }
            .reading-guidance-card__ai-review-btn:hover {
                background: rgba(14, 165, 233, 0.18);
                border-color: rgba(14, 116, 144, 0.5);
            }
            .reading-guidance-card__ai-review-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .reading-guidance-card__row {
                display: grid;
                gap: 6px;
            }
            .reading-guidance-card__label {
                font-size: 12px;
                color: #475569;
                font-weight: 600;
            }
            .reading-guidance-card ul {
                margin: 0;
                padding-left: 18px;
                color: #1f2937;
                font-size: 12px;
                display: grid;
                gap: 4px;
            }
            .reading-guidance-card__empty {
                margin: 0;
                font-size: 12px;
                color: #64748b;
            }
            .reading-guidance-card__status {
                margin: 0;
                font-size: 12px;
                color: #0e7490;
                min-height: 18px;
            }
            .reading-guidance-card__status--failed {
                color: #b91c1c;
            }
            .reading-guidance-card__status-line {
                display: inline-block;
                max-width: 100%;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .reading-guidance-card__status-line--flow {
                background-image: linear-gradient(
                    90deg,
                    rgba(14, 116, 144, 0.42) 0%,
                    rgba(14, 116, 144, 0.42) 34%,
                    rgba(255, 255, 255, 0.98) 48%,
                    rgba(14, 116, 144, 0.42) 62%,
                    rgba(14, 116, 144, 0.42) 100%
                );
                background-size: 260% 100%;
                background-position: -180% 50%;
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                color: transparent;
                animation: reading-status-flow 1.35s linear infinite;
            }
            .reading-guidance-card__status--failed .reading-guidance-card__status-line--flow {
                background-image: linear-gradient(
                    90deg,
                    rgba(185, 28, 28, 0.48) 0%,
                    rgba(185, 28, 28, 0.48) 34%,
                    rgba(255, 255, 255, 0.92) 48%,
                    rgba(185, 28, 28, 0.48) 62%,
                    rgba(185, 28, 28, 0.48) 100%
                );
            }
            .reading-guidance-card__status--degraded {
                color: #b45309;
            }
            @keyframes reading-status-flow {
                0% {
                    background-position: -180% 50%;
                }
                100% {
                    background-position: 180% 50%;
                }
            }
            @media (max-width: 640px) {
                .reading-kind-radar__layout {
                    grid-template-columns: 1fr;
                    justify-items: center;
                }
                .reading-kind-radar__legend {
                    width: 100%;
                }
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

    function getQuestionOrder(answers = {}) {
        const answerKey = state.dataset?.answerKey || {};
        const datasetOrder = Array.isArray(state.dataset?.questionOrder)
            ? state.dataset.questionOrder
            : [];
        const order = datasetOrder.length
            ? datasetOrder.slice()
            : Object.keys(answerKey);
        if (!order.length) {
            return Object.keys(answers || {});
        }
        return order;
    }

    function hasMeaningfulAnswer(value) {
        const normalized = normalizeAnswerValue(value);
        if (Array.isArray(normalized)) {
            return normalized.some((entry) => !!String(entry || '').trim());
        }
        return !!String(normalized || '').trim();
    }

    function buildAnswerFingerprint(value) {
        const normalized = normalizeAnswerValue(value);
        if (Array.isArray(normalized)) {
            return normalized
                .map((entry) => canonicalizeAnswerToken(entry))
                .filter(Boolean)
                .sort((left, right) => left.localeCompare(right, 'en'))
                .join('|');
        }
        return canonicalizeAnswerToken(normalized);
    }

    function ensureQuestionTimelineEntry(questionId) {
        if (state.questionTimeline.has(questionId)) {
            return state.questionTimeline.get(questionId);
        }
        const entry = {
            questionId,
            firstAnsweredAt: null,
            lastAnsweredAt: null,
            changeCount: 0,
            lastFingerprint: ''
        };
        state.questionTimeline.set(questionId, entry);
        return entry;
    }

    function trackAnswerTimeline(answers = {}, timestamp = Date.now()) {
        const questionOrder = getQuestionOrder(answers);
        questionOrder.forEach((questionId) => {
            const value = Object.prototype.hasOwnProperty.call(answers, questionId)
                ? answers[questionId]
                : '';
            const answered = hasMeaningfulAnswer(value);
            const fingerprint = answered ? buildAnswerFingerprint(value) : '';
            const previousFingerprint = Object.prototype.hasOwnProperty.call(state.answerSnapshot, questionId)
                ? state.answerSnapshot[questionId]
                : '';

            if (fingerprint === previousFingerprint) {
                return;
            }

            const timelineEntry = ensureQuestionTimelineEntry(questionId);
            if (previousFingerprint && previousFingerprint !== fingerprint) {
                timelineEntry.changeCount += 1;
            }
            if (answered && !timelineEntry.firstAnsweredAt) {
                timelineEntry.firstAnsweredAt = timestamp;
            }
            if (answered) {
                timelineEntry.lastAnsweredAt = timestamp;
            }
            timelineEntry.lastFingerprint = fingerprint;
            state.answerSnapshot[questionId] = fingerprint;
        });
    }

    function buildQuestionTimelineLite(questionOrder = []) {
        const orderedIds = Array.isArray(questionOrder) ? questionOrder.slice() : [];
        const knownIds = new Set(orderedIds);
        state.questionTimeline.forEach((_, questionId) => {
            if (!knownIds.has(questionId)) {
                orderedIds.push(questionId);
            }
        });
        return orderedIds.map((questionId) => {
            const entry = state.questionTimeline.get(questionId);
            const firstTimestamp = entry?.firstAnsweredAt;
            const lastTimestamp = entry?.lastAnsweredAt;
            const firstAnsweredAt = firstTimestamp != null && Number.isFinite(Number(firstTimestamp))
                ? new Date(Number(firstTimestamp)).toISOString()
                : null;
            const lastAnsweredAt = lastTimestamp != null && Number.isFinite(Number(lastTimestamp))
                ? new Date(Number(lastTimestamp)).toISOString()
                : null;
            return {
                questionId,
                firstAnsweredAt,
                lastAnsweredAt,
                changeCount: Number.isFinite(Number(entry?.changeCount)) ? Number(entry.changeCount) : 0
            };
        });
    }

    function buildAnalysisSignals(answerComparison = {}, questionTimelineLite = []) {
        const entries = Object.values(answerComparison || {});
        const questionCount = entries.length;
        const unansweredCount = entries.reduce((count, entry) => (
            hasMeaningfulAnswer(entry?.userAnswer) ? count : count + 1
        ), 0);
        const changedAnswerCount = questionTimelineLite.reduce((count, item) => (
            Number(item?.changeCount) > 0 ? count + 1 : count
        ), 0);
        const durationSeconds = Math.max(1, Math.round((Date.now() - state.startTime) / 1000));
        const durationMinutes = Math.max(durationSeconds / 60, 1);
        const interactionDensity = Number((state.interactionCount / durationMinutes).toFixed(4));
        return {
            questionCount,
            unansweredCount,
            changedAnswerCount,
            interactionDensity
        };
    }

    function normalizeQuestionKind(kind) {
        if (typeof kind !== 'string') {
            return 'unknown';
        }
        const normalized = kind.trim().toLowerCase();
        return normalized || 'unknown';
    }

    function buildQuestionTypePerformance(questionOrder = [], answerComparison = {}) {
        const groups = Array.isArray(state.dataset?.questionGroups) ? state.dataset.questionGroups : [];
        const questionTypeMap = new Map();
        groups.forEach((group) => {
            const kind = normalizeQuestionKind(group?.kind);
            const ids = Array.isArray(group?.questionIds) ? group.questionIds : [];
            ids.forEach((rawQuestionId) => {
                const normalizedQuestionId = normalizeQuestionId(rawQuestionId);
                if (!normalizedQuestionId) {
                    return;
                }
                if (!questionTypeMap.has(normalizedQuestionId) || questionTypeMap.get(normalizedQuestionId) === 'unknown') {
                    questionTypeMap.set(normalizedQuestionId, kind);
                }
            });
        });

        const result = {};
        questionOrder.forEach((questionId) => {
            const kind = questionTypeMap.get(questionId) || 'unknown';
            const comparisonEntry = answerComparison[questionId] || {};
            const weight = questionWeight(comparisonEntry.correctAnswer);
            if (!result[kind]) {
                result[kind] = {
                    total: 0,
                    correct: 0,
                    accuracy: 0,
                    questionIds: [],
                    kind
                };
            }
            result[kind].total += weight;
            if (comparisonEntry.isCorrect === true) {
                result[kind].correct += weight;
            }
            if (!result[kind].questionIds.includes(questionId)) {
                result[kind].questionIds.push(questionId);
            }
        });

        Object.keys(result).forEach((kind) => {
            const item = result[kind];
            item.accuracy = item.total > 0 ? item.correct / item.total : 0;
        });

        return result;
    }

    function recordInteraction() {
        if (state.readOnly) {
            return;
        }
        state.interactionCount += 1;
    }

    function buildResults(options = {}) {
        const answers = collectAnswers();
        const answerKey = state.dataset?.answerKey || {};
        const questionOrder = getQuestionOrder(answers);
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
        const questionTimelineLite = buildQuestionTimelineLite(questionOrder);
        const analysisSignals = buildAnalysisSignals(answerComparison, questionTimelineLite);
        const questionTypePerformance = buildQuestionTypePerformance(questionOrder, answerComparison);
        const resolvedDurationSec = Math.max(
            0,
            Math.round(Number(options.durationSec ?? getElapsedSeconds()) || 0)
        );
        const results = {
            answers,
            answerComparison,
            correctAnswers: answerKey,
            analysisSignals,
            questionTimelineLite,
            questionTypePerformance,
            scoreInfo: {
                correct: correctCount,
                total: totalQuestions,
                totalQuestions,
                accuracy,
                percentage: Math.round(accuracy * 100),
                duration: resolvedDurationSec,
                details,
                source: 'unified_reading_page'
            }
        };
        const analysisArtifacts = resolveSingleAttemptAnalysisArtifacts(results, questionOrder, {
            durationSec: resolvedDurationSec
        });
        results.questionTypePerformance = analysisArtifacts.questionTypePerformance || results.questionTypePerformance;
        results.singleAttemptAnalysisInput = analysisArtifacts.input;
        results.singleAttemptAnalysis = analysisArtifacts.analysis;
        results.realData = Object.assign({}, results.realData || {}, {
            singleAttemptAnalysisInput: analysisArtifacts.input,
            singleAttemptAnalysis: results.singleAttemptAnalysis,
            singleAttemptAnalysisLlm: results.singleAttemptAnalysisLlm || null,
            readingCoachSnapshot: state.readingCoachSnapshot || null,
            readingCoachTranscript: Array.isArray(state.readingCoachTranscript) ? state.readingCoachTranscript.slice() : []
        });
        results.readingCoachSnapshot = state.readingCoachSnapshot || null;
        results.readingCoachTranscript = Array.isArray(state.readingCoachTranscript) ? state.readingCoachTranscript.slice() : [];
        return results;
    }

    function roundRate(value, digits = 4) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return 0;
        }
        const factor = 10 ** digits;
        return Math.round(parsed * factor) / factor;
    }

    function clampRate(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 0;
        }
        if (parsed >= 1) {
            return 1;
        }
        return parsed;
    }

    function normalizeAnalysisLabel(value, fallback = 'unknown') {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
        return normalized || fallback;
    }

    function escapeHtml(value) {
        if (value == null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeQuestionTypePerformanceForAnalysis(rawPerformance = {}, summary = {}) {
        const source = rawPerformance && typeof rawPerformance === 'object' ? rawPerformance : {};
        const totalQuestions = Math.max(0, Number(summary.totalQuestions) || 0);
        const correctAnswers = Math.max(0, Number(summary.correctAnswers) || 0);
        const baseConfidence = clampRate(Number(summary.dataQualityConfidence) || 0.5);
        const normalized = {};
        Object.entries(source).forEach(([rawKind, rawEntry]) => {
            if (!rawEntry || typeof rawEntry !== 'object') {
                return;
            }
            const kind = normalizeAnalysisLabel(rawKind, 'unknown');
            const targetKind = kind === 'general' ? 'unknown' : kind;
            if (!normalized[targetKind]) {
                normalized[targetKind] = { total: 0, correct: 0, accuracy: 0 };
            }
            const parsedTotal = Math.max(0, Number(rawEntry.total ?? rawEntry.questionCount ?? rawEntry.count) || 0);
            const parsedCorrect = Math.max(0, Number(rawEntry.correct ?? rawEntry.correctAnswers ?? rawEntry.score) || 0);
            normalized[targetKind].total += parsedTotal;
            normalized[targetKind].correct += parsedCorrect;
        });
        let knownTotal = 0;
        let knownCorrect = 0;
        Object.entries(normalized).forEach(([kind, bucket]) => {
            if (kind === 'unknown') {
                return;
            }
            bucket.correct = Math.min(bucket.correct, bucket.total);
            bucket.accuracy = bucket.total > 0 ? bucket.correct / bucket.total : 0;
            knownTotal += bucket.total;
            knownCorrect += bucket.correct;
        });
        let unknownTotal = Math.max(0, Number(normalized.unknown?.total) || 0);
        let unknownCorrect = Math.max(0, Number(normalized.unknown?.correct) || 0);
        if (totalQuestions > 0) {
            unknownTotal = Math.max(unknownTotal, Math.max(totalQuestions - knownTotal, 0));
            unknownTotal = Math.min(totalQuestions, unknownTotal);
            unknownCorrect = Math.max(unknownCorrect, Math.max(correctAnswers - knownCorrect, 0));
        }
        if (unknownTotal > 0 || normalized.unknown) {
            unknownCorrect = Math.max(0, Math.min(unknownTotal, unknownCorrect));
            const missingKindRatio = totalQuestions > 0 ? clampRate(unknownTotal / totalQuestions) : 1;
            normalized.unknown = {
                total: unknownTotal,
                correct: unknownCorrect,
                accuracy: unknownTotal > 0 ? unknownCorrect / unknownTotal : 0,
                confidence: Math.max(0.2, Math.min(0.6, baseConfidence * (1 - missingKindRatio)))
            };
        } else {
            delete normalized.unknown;
        }
        return normalized;
    }

    function buildSingleAttemptDiagnosis(summary, byQuestionKind = []) {
        const diagnosis = [];
        const sortedByWeakness = byQuestionKind.slice().sort((left, right) => left.accuracy - right.accuracy || right.total - left.total);
        const weakest = sortedByWeakness[0] || null;
        const strongest = byQuestionKind.slice().sort((left, right) => right.accuracy - left.accuracy || right.total - left.total)[0] || null;
        const asPercent = (value) => `${Math.round(clampRate(value) * 100)}%`;

        if (weakest && weakest.total > 0 && weakest.accuracy < 0.7) {
            const weakestLabel = formatQuestionKindLabel(weakest.kind);
            diagnosis.push({
                code: 'weakest_question_kind',
                reason: `题型「${weakestLabel}」正确率 ${asPercent(weakest.accuracy)}（${weakest.correct}/${weakest.total}），是本次主要失分点。`,
                evidence: {
                    kind: weakest.kind,
                    total: weakest.total,
                    correct: weakest.correct,
                    accuracy: roundRate(weakest.accuracy),
                    confidence: roundRate(weakest.confidence)
                }
            });
        }
        if (summary.unansweredRate >= 0.15) {
            diagnosis.push({
                code: 'unanswered_ratio_high',
                reason: `未作答率 ${asPercent(summary.unansweredRate)}，说明时间分配偏紧。`,
                evidence: {
                    unansweredRate: roundRate(summary.unansweredRate)
                }
            });
        }
        if (summary.changedAnswerRate >= 0.3) {
            diagnosis.push({
                code: 'answer_instability',
                reason: `改答率 ${asPercent(summary.changedAnswerRate)}，临门一脚决策波动较大。`,
                evidence: {
                    changedAnswerRate: roundRate(summary.changedAnswerRate)
                }
            });
        }
        if (strongest && strongest.total > 0 && strongest.accuracy >= 0.8) {
            const strongestLabel = formatQuestionKindLabel(strongest.kind);
            diagnosis.push({
                code: 'strongest_question_kind',
                reason: `题型「${strongestLabel}」正确率 ${asPercent(strongest.accuracy)}（${strongest.correct}/${strongest.total}），可作为稳定得分点。`,
                evidence: {
                    kind: strongest.kind,
                    total: strongest.total,
                    correct: strongest.correct,
                    accuracy: roundRate(strongest.accuracy),
                    confidence: roundRate(strongest.confidence)
                }
            });
        }
        if (diagnosis.length < 2) {
            diagnosis.push({
                code: 'overall_accuracy',
                reason: `整体正确率 ${asPercent(summary.accuracy)}，建议继续按题型拆分复盘。`,
                evidence: {
                    accuracy: roundRate(summary.accuracy)
                }
            });
        }
        return diagnosis.slice(0, 4);
    }

    function buildSingleAttemptNextActions(summary, byQuestionKind = []) {
        const weakKinds = byQuestionKind
            .filter((entry) => entry.total > 0)
            .slice()
            .sort((left, right) => left.accuracy - right.accuracy || right.total - left.total);
        const nextActions = [];
        weakKinds.slice(0, 2).forEach((entry) => {
            const kindLabel = formatQuestionKindLabel(entry.kind);
            nextActions.push({
                type: 'targeted_drill',
                target: entry.kind,
                instruction: `题型「${kindLabel}」：做 8-12 题限时训练（每题 ≤ 75 秒），错题复盘只记录“定位句 + 排除依据”。`,
                evidence: {
                    kind: entry.kind,
                    total: entry.total,
                    correct: entry.correct,
                    accuracy: roundRate(entry.accuracy)
                }
            });
        });
        if (summary.changedAnswerRate >= 0.3 && weakKinds.length > 0) {
            const weakestLabel = formatQuestionKindLabel(weakKinds[0].kind);
            nextActions.push({
                type: 'decision_stability',
                target: weakKinds[0].kind,
                instruction: `题型「${weakestLabel}」：提交前最多改答 1 次，先补证据再改答案。`,
                evidence: {
                    changedAnswerRate: roundRate(summary.changedAnswerRate)
                }
            });
        }
        if (nextActions.length < 2 && weakKinds.length > 0) {
            const stableKind = weakKinds.slice().sort((left, right) => right.accuracy - left.accuracy || right.total - left.total)[0];
            const stableKindLabel = formatQuestionKindLabel(stableKind.kind);
            nextActions.push({
                type: 'maintain_strength',
                target: stableKind.kind,
                instruction: `题型「${stableKindLabel}」：每周保留 1 组混练，维持稳定命中率。`,
                evidence: {
                    kind: stableKind.kind,
                    accuracy: roundRate(stableKind.accuracy)
                }
            });
        }
        if (nextActions.length < 2) {
            nextActions.push({
                type: 'mapping_fix',
                target: 'unknown',
                instruction: '题型「unknown」：先补齐题型映射数据，再执行题型粒度训练。',
                evidence: {
                    unknownBucket: true
                }
            });
        }
        return nextActions.slice(0, 3);
    }

    function buildSingleAttemptAnalysisFromCanonicalInput(input = {}) {
        const normalizedInput = input && typeof input === 'object' ? input : {};
        const totalQuestions = Math.max(0, Number(normalizedInput.totalQuestions) || 0);
        const explicitQuestionCount = Math.max(0, Number(normalizedInput.analysisSignals?.questionCount) || 0);
        const analysisDenominator = explicitQuestionCount > 0
            ? explicitQuestionCount
            : (totalQuestions > 0 ? totalQuestions : 1);
        const accuracy = clampRate(Number(normalizedInput.accuracy) || 0);
        const durationSec = Math.max(0, Math.round(Number(normalizedInput.durationSec) || 0));
        const unansweredRate = clampRate((Number(normalizedInput.analysisSignals?.unansweredCount) || 0) / analysisDenominator);
        const changedAnswerRate = clampRate((Number(normalizedInput.analysisSignals?.changedAnswerCount) || 0) / analysisDenominator);
        const byQuestionKind = Object.entries(normalizedInput.questionTypePerformance || {})
            .map(([kind, bucket]) => {
                const total = Math.max(0, Number(bucket?.total) || 0);
                const correct = Math.max(0, Math.min(total, Number(bucket?.correct) || 0));
                return {
                    kind,
                    total,
                    correct,
                    accuracy: total > 0 ? correct / total : 0,
                    confidence: clampRate(Number(bucket?.confidence) || Number(normalizedInput.dataQuality?.confidence) || 0.5)
                };
            })
            .filter((entry) => entry.total > 0);
        const category = normalizedInput.category || normalizedInput.metadata?.category || null;
        const byPassageCategory = category ? [{
            category: String(category),
            total: totalQuestions,
            correct: Math.max(0, Number(normalizedInput.correctAnswers) || 0),
            accuracy,
            confidence: clampRate(Number(normalizedInput.dataQuality?.confidence) || 0.5)
        }] : [];
        return {
            summary: {
                accuracy: roundRate(accuracy),
                durationSec,
                unansweredRate: roundRate(unansweredRate),
                changedAnswerRate: roundRate(changedAnswerRate)
            },
            radar: {
                byQuestionKind,
                byPassageCategory
            },
            diagnosis: buildSingleAttemptDiagnosis({ accuracy, unansweredRate, changedAnswerRate }, byQuestionKind),
            nextActions: buildSingleAttemptNextActions({ accuracy, unansweredRate, changedAnswerRate }, byQuestionKind),
            confidence: roundRate(
                byQuestionKind.length > 0
                    ? byQuestionKind.reduce((sum, item) => sum + item.confidence, 0) / byQuestionKind.length
                    : clampRate(Number(normalizedInput.dataQuality?.confidence) || 0.5)
            )
        };
    }

    function resolveSingleAttemptAnalysisArtifacts(results = {}, questionOrder = [], options = {}) {
        const scoreInfo = results.scoreInfo && typeof results.scoreInfo === 'object' ? results.scoreInfo : {};
        const totalQuestions = Math.max(0, Number(scoreInfo.totalQuestions ?? scoreInfo.total ?? questionOrder.length) || 0);
        const correctAnswers = Math.max(0, Number(scoreInfo.correct) || 0);
        const accuracy = totalQuestions > 0
            ? (Number.isFinite(Number(scoreInfo.accuracy)) ? Number(scoreInfo.accuracy) : (correctAnswers / totalQuestions))
            : 0;
        const durationSec = Math.max(0, Math.round(Number(options.durationSec ?? scoreInfo.duration ?? getElapsedSeconds()) || 0));
        const category = state.dataset?.meta?.category || state.explanation?.category || null;
        const dataQuality = Object.assign({ confidence: 0.5 }, results.dataQuality || {});
        const rawQuestionTypePerformance = normalizeQuestionTypePerformanceForAnalysis(
            results.questionTypePerformance || {},
            { totalQuestions, correctAnswers, dataQualityConfidence: dataQuality.confidence }
        );
        const recordData = {
            examId: state.examId || null,
            sessionId: state.sessionId || null,
            type: 'reading',
            totalQuestions,
            correctAnswers,
            accuracy,
            duration: durationSec,
            answers: results.answers || {},
            answerComparison: results.answerComparison || {},
            questionTypePerformance: rawQuestionTypePerformance,
            questionTimelineLite: results.questionTimelineLite || [],
            analysisSignals: results.analysisSignals || {},
            category,
            metadata: {
                category,
                type: 'reading',
                examType: 'reading',
                dataQuality
            }
        };
        const coreAnalysis = global.PracticeCore && global.PracticeCore.analysis;
        if (
            coreAnalysis
            && typeof coreAnalysis.buildSingleAttemptAnalysisInput === 'function'
            && typeof coreAnalysis.buildSingleAttemptAnalysis === 'function'
        ) {
            const input = coreAnalysis.buildSingleAttemptAnalysisInput(recordData, {
                totalQuestions,
                correctAnswers,
                accuracy,
                durationSec,
                answerComparison: recordData.answerComparison,
                questionTypePerformance: recordData.questionTypePerformance,
                questionTimelineLite: recordData.questionTimelineLite,
                analysisSignals: recordData.analysisSignals,
                dataQuality,
                category
            });
            const analysis = coreAnalysis.buildSingleAttemptAnalysis(input);
            return {
                input,
                analysis,
                questionTypePerformance: input.questionTypePerformance || rawQuestionTypePerformance
            };
        }
        const input = {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            examId: recordData.examId,
            sessionId: recordData.sessionId,
            type: 'reading',
            category: category ? String(category) : null,
            totalQuestions,
            correctAnswers,
            accuracy: clampRate(accuracy),
            durationSec,
            dataQuality,
            analysisSignals: recordData.analysisSignals,
            questionTimelineLite: recordData.questionTimelineLite,
            questionTypePerformance: rawQuestionTypePerformance,
            unknownQuestions: Number(rawQuestionTypePerformance.unknown?.total) || 0,
            missingKindRatio: totalQuestions > 0
                ? clampRate((Number(rawQuestionTypePerformance.unknown?.total) || 0) / totalQuestions)
                : 1,
            confidence: Math.max(
                0.2,
                Math.min(
                    0.6,
                    clampRate(Number(dataQuality.confidence) || 0.5) * (1 - (totalQuestions > 0
                        ? clampRate((Number(rawQuestionTypePerformance.unknown?.total) || 0) / totalQuestions)
                        : 1))
                )
            )
        };
        return {
            input,
            analysis: buildSingleAttemptAnalysisFromCanonicalInput(input),
            questionTypePerformance: rawQuestionTypePerformance
        };
    }

    function buildRadarSvg(byQuestionKind = []) {
        const metrics = Array.isArray(byQuestionKind)
            ? byQuestionKind.filter((entry) => entry && Number(entry.total) > 0)
            : [];
        if (metrics.length === 0) {
            return '';
        }

        const cx = 130;
        const cy = 130;
        const radius = 92;
        const axisCount = metrics.length;
        const axes = metrics.map((entry, index) => {
            const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / axisCount);
            const axisX = cx + (radius * Math.cos(angle));
            const axisY = cy + (radius * Math.sin(angle));
            const valueRadius = radius * clampRate(Number(entry.accuracy));
            const valueX = cx + (valueRadius * Math.cos(angle));
            const valueY = cy + (valueRadius * Math.sin(angle));
            return {
                ...entry,
                axisX,
                axisY,
                valueX,
                valueY
            };
        });

        const levels = [0.25, 0.5, 0.75, 1];
        const gridPolygons = levels.map((level) => {
            const points = axes.map((axis) => {
                const x = cx + ((axis.axisX - cx) * level);
                const y = cy + ((axis.axisY - cy) * level);
                return `${roundRate(x, 2)},${roundRate(y, 2)}`;
            }).join(' ');
            return `<polygon points="${points}" fill="none" stroke="rgba(148,163,184,0.35)" stroke-width="1" />`;
        }).join('');

        const axisLines = axes.map((axis) => (
            `<line x1="${cx}" y1="${cy}" x2="${roundRate(axis.axisX, 2)}" y2="${roundRate(axis.axisY, 2)}" stroke="rgba(100,116,139,0.45)" stroke-width="1" />`
        )).join('');
        const dataPoints = axes.map((axis) => `${roundRate(axis.valueX, 2)},${roundRate(axis.valueY, 2)}`).join(' ');
        const labels = axes.map((axis) => {
            const labelX = cx + ((axis.axisX - cx) * 1.15);
            const labelY = cy + ((axis.axisY - cy) * 1.15);
            return `<text x="${roundRate(labelX, 2)}" y="${roundRate(labelY, 2)}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#0f172a">${escapeHtml(formatQuestionKindLabel(axis.kind))}</text>`;
        }).join('');

        return `
            <svg class="reading-kind-radar__svg" viewBox="0 0 260 260" aria-hidden="true">
                ${gridPolygons}
                ${axisLines}
                <polygon points="${dataPoints}" fill="rgba(14,116,144,0.2)" stroke="#0e7490" stroke-width="2" />
                ${axes.map((axis) => `<circle cx="${roundRate(axis.valueX, 2)}" cy="${roundRate(axis.valueY, 2)}" r="3" fill="#0e7490" />`).join('')}
                ${labels}
            </svg>
        `;
    }

    function renderSingleAttemptRadar(analysis) {
        const byQuestionKind = Array.isArray(analysis?.radar?.byQuestionKind) ? analysis.radar.byQuestionKind : [];
        const metrics = byQuestionKind.filter((entry) => entry && Number(entry.total) > 0 && normalizeAnalysisLabel(entry.kind) !== 'general');
        if (metrics.length === 0) {
            return `
                <section class="reading-kind-radar reading-kind-radar--empty">
                    <h5>题型雷达</h5>
                    <p>暂无题型维度数据（未携带 <code>singleAttemptAnalysis.radar.byQuestionKind</code>）。</p>
                </section>
            `;
        }

        const legend = metrics
            .map((entry) => (
                `<li class="reading-kind-radar__legend-item"><strong>${escapeHtml(formatQuestionKindLabel(entry.kind))}</strong><span>${Math.round(clampRate(Number(entry.accuracy)) * 100)}% · ${Number(entry.correct)}/${Number(entry.total)}</span></li>`
            ))
            .join('');

        return `
            <section class="reading-kind-radar">
                <h5>题型雷达</h5>
                <div class="reading-kind-radar__layout">
                    ${buildRadarSvg(metrics)}
                    <ul class="reading-kind-radar__legend">${legend}</ul>
                </div>
            </section>
        `;
    }

    function resolveAnalysisTextEntry(entry, preferredKeys = []) {
        if (typeof entry === 'string') {
            return entry.trim();
        }
        if (!entry || typeof entry !== 'object') {
            return '';
        }
        for (let i = 0; i < preferredKeys.length; i += 1) {
            const key = preferredKeys[i];
            if (typeof entry[key] === 'string' && entry[key].trim()) {
                return entry[key].trim();
            }
        }
        return '';
    }

    function mergeSingleAttemptAnalysis(stage1Analysis, llmAnalysis) {
        const base = stage1Analysis && typeof stage1Analysis === 'object'
            ? stage1Analysis
            : {
                summary: {},
                radar: { byQuestionKind: [], byPassageCategory: [] },
                diagnosis: [],
                nextActions: [],
                confidence: 0.5
            };
        if (!llmAnalysis || typeof llmAnalysis !== 'object') {
            return base;
        }
        const diagnosis = Array.isArray(llmAnalysis.diagnosis) ? llmAnalysis.diagnosis : [];
        const nextActions = Array.isArray(llmAnalysis.nextActions) ? llmAnalysis.nextActions : [];
        if (!diagnosis.length && !nextActions.length) {
            return base;
        }
        return Object.assign({}, base, {
            diagnosis: diagnosis.length ? diagnosis : (Array.isArray(base.diagnosis) ? base.diagnosis : []),
            nextActions: nextActions.length ? nextActions : (Array.isArray(base.nextActions) ? base.nextActions : []),
            confidence: Number.isFinite(Number(llmAnalysis.confidence))
                ? clampRate(Number(llmAnalysis.confidence))
                : base.confidence
        });
    }

    async function resolveLocalApiBaseUrl(options = {}) {
        const skipCache = Boolean(options.skipCache);
        const queryBaseUrl = resolveRuntimeParam('localApiBaseUrl');
        if (queryBaseUrl) {
            persistLocalApiInfo(queryBaseUrl);
            return queryBaseUrl;
        }
        if (global.electronAPI && typeof global.electronAPI.getLocalApiInfo === 'function') {
            try {
                const response = await global.electronAPI.getLocalApiInfo();
                const baseUrl = response?.data?.baseUrl || response?.baseUrl || null;
                const normalized = typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : null;
                if (normalized) {
                    persistLocalApiInfo(normalized);
                    return normalized;
                }
            } catch (_) {
                // ignore and continue to cache fallback
            }
        }
        if (!skipCache) {
            const cachedBaseUrl = readLocalApiInfoFromStorage();
            if (cachedBaseUrl) {
                return cachedBaseUrl;
            }
        }
        return null;
    }

    function ensureReadingCoachStyles() {
        if (!document || !document.head || typeof document.head.appendChild !== 'function') {
            return;
        }
        if (document.getElementById(READING_COACH_STYLE_ID)) {
            return;
        }
        const style = document.createElement('style');
        style.id = READING_COACH_STYLE_ID;
        style.textContent = `
            .reading-coach-fab {
                position: fixed;
                right: 16px;
                bottom: 20px;
                z-index: 9999;
                border: 0;
                border-radius: 999px;
                padding: 10px 14px;
                background: linear-gradient(135deg, #0f766e, #0e7490);
                color: #fff;
                font-size: 13px;
                font-weight: 700;
                box-shadow: 0 12px 24px rgba(15, 118, 110, 0.28);
                cursor: pointer;
                touch-action: none;
                user-select: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .reading-coach-panel {
                position: fixed;
                right: 16px;
                bottom: 70px;
                width: min(380px, calc(100vw - 24px));
                max-height: min(68vh, 560px);
                z-index: 9999;
                border-radius: 12px;
                border: 1px solid rgba(15, 23, 42, 0.12);
                background: rgba(255, 255, 255, 0.98);
                box-shadow: 0 22px 40px rgba(15, 23, 42, 0.24);
                display: none;
                overflow: hidden;
                touch-action: none;
            }
            .reading-coach-panel.is-open {
                display: flex;
                flex-direction: column;
            }
            .reading-coach-panel__header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.3);
                background: #f8fafc;
            }
            .reading-coach-panel__title {
                font-size: 13px;
                font-weight: 700;
                color: #0f172a;
            }
            .reading-coach-panel__close {
                border: 0;
                background: transparent;
                font-size: 16px;
                color: #334155;
                cursor: pointer;
            }
            .reading-coach-panel__status {
                padding: 8px 12px 0;
                font-size: 12px;
                color: #0f766e;
                min-height: 22px;
            }
            .reading-coach-panel__status.is-error {
                color: #b91c1c;
            }
            .reading-coach-panel__messages {
                flex: 1;
                overflow: auto;
                padding: 10px 12px;
                background: #f8fafc;
                display: grid;
                gap: 8px;
            }
            .reading-coach-msg {
                border-radius: 10px;
                padding: 8px 10px;
                font-size: 12px;
                line-height: 1.5;
                white-space: pre-wrap;
            }
            .reading-coach-msg.user {
                justify-self: end;
                background: #dbeafe;
                color: #1e3a8a;
            }
            .reading-coach-msg.assistant {
                justify-self: start;
                background: #fff;
                border: 1px solid rgba(148, 163, 184, 0.26);
                color: #0f172a;
            }
            .reading-coach-msg.error {
                border-color: rgba(185, 28, 28, 0.35);
                color: #991b1b;
            }
            .reading-coach-panel__actions,
            .reading-coach-panel__followups {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                padding: 8px 12px 0;
            }
            .reading-coach-chip {
                border: 1px solid rgba(15, 118, 110, 0.28);
                border-radius: 999px;
                background: #fff;
                color: #0f766e;
                font-size: 11px;
                font-weight: 600;
                padding: 4px 8px;
                cursor: pointer;
            }
            .reading-coach-chip:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }
            .reading-coach-panel__composer {
                display: flex;
                gap: 8px;
                padding: 10px 12px 12px;
                border-top: 1px solid rgba(148, 163, 184, 0.3);
                background: #fff;
            }
            .reading-coach-panel__input {
                flex: 1;
                border: 1px solid rgba(148, 163, 184, 0.45);
                border-radius: 8px;
                padding: 8px;
                font-size: 12px;
            }
            .reading-coach-panel__send {
                border: 0;
                border-radius: 8px;
                background: #0f766e;
                color: #fff;
                font-size: 12px;
                font-weight: 700;
                padding: 0 12px;
                cursor: pointer;
            }
            @media (max-width: 640px) {
                .reading-coach-panel {
                    right: 8px;
                    left: 8px;
                    width: auto;
                    max-height: 70vh;
                }
                .reading-coach-fab {
                    right: 10px;
                    bottom: 12px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function normalizeFloatingPosition(node) {
        if (!node || typeof node.getBoundingClientRect !== 'function') {
            return;
        }
        const rect = node.getBoundingClientRect();
        node.style.left = `${Math.max(0, rect.left)}px`;
        node.style.top = `${Math.max(0, rect.top)}px`;
        node.style.right = 'auto';
        node.style.bottom = 'auto';
    }

    function attachFloatingDrag(node, handle, options = {}) {
        if (!node || node.dataset.coachDragBound === '1') {
            return;
        }
        const dragHandle = handle || node;
        if (!dragHandle || typeof dragHandle.addEventListener !== 'function') {
            return;
        }
        let isDragging = false;
        let moved = false;
        let originLeft = 0;
        let originTop = 0;
        let startX = 0;
        let startY = 0;
        let nodeWidth = 0;
        let nodeHeight = 0;

        const onPointerMove = (event) => {
            if (!isDragging || !event) {
                return;
            }
            const currentX = Number(event.clientX);
            const currentY = Number(event.clientY);
            if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                return;
            }
            const deltaX = currentX - startX;
            const deltaY = currentY - startY;
            if (!moved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
                moved = true;
            }
            const maxLeft = Math.max(0, global.innerWidth - nodeWidth);
            const maxTop = Math.max(0, global.innerHeight - nodeHeight);
            const nextLeft = Math.min(maxLeft, Math.max(0, originLeft + deltaX));
            const nextTop = Math.min(maxTop, Math.max(0, originTop + deltaY));
            node.style.left = `${nextLeft}px`;
            node.style.top = `${nextTop}px`;
            if (typeof options.onDragMove === 'function') {
                options.onDragMove(nextLeft, nextTop, nodeWidth, nodeHeight);
            }
        };

        const stopDragging = () => {
            isDragging = false;
            try {
                global.removeEventListener('pointermove', onPointerMove);
                global.removeEventListener('pointerup', stopDragging);
                global.removeEventListener('pointercancel', stopDragging);
            } catch (_) {
                // ignore listener cleanup failures
            }
            if (moved && typeof options.onDragEnd === 'function') {
                options.onDragEnd();
            }
        };

        dragHandle.addEventListener('pointerdown', (event) => {
            if (!event) return;
            if (typeof event.button === 'number' && event.button !== 0) {
                return;
            }
            if (options.ignoreSelector && event.target && typeof event.target.closest === 'function') {
                const blocked = event.target.closest(options.ignoreSelector);
                if (blocked) {
                    return;
                }
            }
            normalizeFloatingPosition(node);
            const rect = node.getBoundingClientRect();
            originLeft = rect.left;
            originTop = rect.top;
            nodeWidth = rect.width;
            nodeHeight = rect.height;
            startX = Number(event.clientX) || rect.left;
            startY = Number(event.clientY) || rect.top;
            moved = false;
            isDragging = true;
            try {
                global.addEventListener('pointermove', onPointerMove);
                global.addEventListener('pointerup', stopDragging);
                global.addEventListener('pointercancel', stopDragging);
            } catch (_) {
                isDragging = false;
            }
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
        });

        node.dataset.coachDragBound = '1';
    }

    function syncReadingCoachPanelWithFab() {
        const fab = document.getElementById('reading-coach-fab');
        const panel = document.getElementById('reading-coach-panel');
        if (!fab || !panel || typeof fab.getBoundingClientRect !== 'function' || typeof panel.getBoundingClientRect !== 'function') {
            return;
        }
        normalizeFloatingPosition(fab);
        const fabRect = fab.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const spacing = 10;
        const maxLeft = Math.max(0, global.innerWidth - panelRect.width);
        const maxTop = Math.max(0, global.innerHeight - panelRect.height);
        const left = Math.min(maxLeft, Math.max(0, fabRect.left + fabRect.width - panelRect.width));
        const preferredTop = fabRect.top - panelRect.height - spacing;
        const fallbackTop = fabRect.top + fabRect.height + spacing;
        const top = preferredTop >= 0
            ? preferredTop
            : Math.min(maxTop, Math.max(0, fallbackTop));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    function setupReadingCoachDraggable() {
        const fab = document.getElementById('reading-coach-fab');

        attachFloatingDrag(fab, fab, {
            onDragMove: () => {
                syncReadingCoachPanelWithFab();
            },
            onDragEnd: () => {
                state.readingCoachFabDragSuppressUntil = Date.now() + 180;
            }
        });
        syncReadingCoachPanelWithFab();
    }

    function isReadingCoachAvailable() {
        if (state.submitted) {
            return true;
        }
        return Boolean(state.lastResults && state.lastResults.scoreInfo && Number.isFinite(Number(state.lastResults.scoreInfo.totalQuestions)));
    }

    function ensureReadingCoachUi() {
        if (!document || !document.body || typeof document.body.appendChild !== 'function') {
            return;
        }
        if (state.readingCoachUiReady) {
            return;
        }
        ensureReadingCoachStyles();
        if (!document.getElementById('reading-coach-fab')) {
            const fab = document.createElement('button');
            fab.id = 'reading-coach-fab';
            fab.className = 'reading-coach-fab';
            fab.type = 'button';
            fab.textContent = 'AI 教练';
            fab.addEventListener('click', () => {
                if (!isReadingCoachAvailable()) {
                    return;
                }
                if (state.readingCoachFabDragSuppressUntil > Date.now()) {
                    return;
                }
                state.readingCoachOpen = !state.readingCoachOpen;
                renderReadingCoachUi();
            });
            document.body.appendChild(fab);
        }
        if (!document.getElementById('reading-coach-panel')) {
            const panel = document.createElement('section');
            panel.id = 'reading-coach-panel';
            panel.className = 'reading-coach-panel';
            panel.innerHTML = `
                <header class="reading-coach-panel__header">
                    <span class="reading-coach-panel__title">Reading AI Coach V2</span>
                    <button id="reading-coach-close" class="reading-coach-panel__close" type="button" aria-label="关闭">×</button>
                </header>
                <div id="reading-coach-status" class="reading-coach-panel__status"></div>
                <div id="reading-coach-messages" class="reading-coach-panel__messages"></div>
                <div id="reading-coach-actions" class="reading-coach-panel__actions"></div>
                <div id="reading-coach-followups" class="reading-coach-panel__followups"></div>
                <div class="reading-coach-panel__composer">
                    <input id="reading-coach-input" class="reading-coach-panel__input" type="text" placeholder="问我：这题如何定位证据？" />
                    <button id="reading-coach-send" class="reading-coach-panel__send" type="button">发送</button>
                </div>
            `;
            document.body.appendChild(panel);

            const closeBtn = panel.querySelector('#reading-coach-close');
            closeBtn?.addEventListener('click', () => {
                state.readingCoachOpen = false;
                renderReadingCoachUi();
            });
            const sendBtn = panel.querySelector('#reading-coach-send');
            sendBtn?.addEventListener('click', () => {
                const input = panel.querySelector('#reading-coach-input');
                const value = input && typeof input.value === 'string' ? input.value : '';
                sendReadingCoachQuery(value, { action: 'chat', promptKind: 'freeform' });
                if (input) {
                    input.value = '';
                }
            });
            const input = panel.querySelector('#reading-coach-input');
            input?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const value = input.value || '';
                sendReadingCoachQuery(value, { action: 'chat', promptKind: 'freeform' });
                input.value = '';
            });
        }
        setupReadingCoachDraggable();
        if (!global.__readingCoachPanelSyncBound) {
            try {
                global.addEventListener('resize', () => {
                    syncReadingCoachPanelWithFab();
                });
                global.__readingCoachPanelSyncBound = true;
            } catch (_) {
                // ignore listener bind failures
            }
        }
        state.readingCoachUiReady = true;
        renderReadingCoachUi();
    }

    function getReadingCoachHistory() {
        return state.readingCoachTranscript
            .slice(-8)
            .map((entry) => ({
                role: entry.role === 'assistant' ? 'assistant' : 'user',
                content: String(entry.content || '')
            }))
            .filter((entry) => entry.content.trim());
    }

    function getSelectedContextForCoach() {
        const selection = global.getSelection ? global.getSelection() : null;
        const text = selection && typeof selection.toString === 'function'
            ? String(selection.toString() || '').trim()
            : '';
        if (!text) {
            return null;
        }
        let scope = 'passage';
        try {
            const anchorNode = selection.anchorNode;
            const parentEl = anchorNode && anchorNode.nodeType === 3 ? anchorNode.parentElement : anchorNode;
            if (parentEl && dom.groups && dom.groups.contains(parentEl)) {
                scope = 'question';
            }
        } catch (_) {
            // ignore selection scope fallback
        }
        return {
            text: text.slice(0, 500),
            scope
        };
    }

    function resolveCoachFocusQuestionNumbers() {
        const fromResults = state.lastResults && state.lastResults.answerComparison
            ? Object.values(state.lastResults.answerComparison)
                .filter((entry) => entry && entry.isCorrect === false)
                .slice(0, 2)
                .map((entry) => String(entry.questionId || '').replace(/^q/i, ''))
                .filter(Boolean)
            : [];
        if (fromResults.length) {
            return uniqueList(fromResults);
        }
        const active = document.activeElement;
        const activeName = active && typeof active.getAttribute === 'function'
            ? String(active.getAttribute('name') || active.id || '')
            : '';
        const match = activeName.match(/q(\\d+)/i);
        if (match && match[1]) {
            return [match[1]];
        }
        return [];
    }

    function uniqueList(values = []) {
        const seen = new Set();
        const output = [];
        values.forEach((item) => {
            const value = String(item || '').trim();
            if (!value || seen.has(value)) {
                return;
            }
            seen.add(value);
            output.push(value);
        });
        return output;
    }

    function appendReadingCoachMessage(role, content, extras = {}) {
        const entry = {
            id: `coach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            role: role === 'assistant' ? 'assistant' : 'user',
            content: String(content || ''),
            isError: Boolean(extras.isError),
            followUps: Array.isArray(extras.followUps) ? extras.followUps.slice(0, 3) : [],
            createdAt: Date.now()
        };
        state.readingCoachTranscript.push(entry);
        if (state.readingCoachTranscript.length > 40) {
            state.readingCoachTranscript = state.readingCoachTranscript.slice(-40);
        }
        return entry;
    }

    function resolveCoachPresetQuery(action, response = null) {
        const focusNumbers = resolveCoachFocusQuestionNumbers();
        const focusText = focusNumbers.length ? `（重点看 Q${focusNumbers.join(', Q')}）` : '';
        if (action === 'hint') {
            return `给我当前题目的提示，不要直接给答案${focusText}`.trim();
        }
        if (action === 'explain') {
            return `解释当前题该如何定位证据并排除干扰项${focusText}`.trim();
        }
        if (action === 'review') {
            return `请复盘我本次错题，按优先级给出训练建议${focusText}`.trim();
        }
        if (action === 'similar') {
            return `推荐与我薄弱题型类似的训练方向${focusText}`.trim();
        }
        if (typeof response === 'string' && response.trim()) {
            return response.trim();
        }
        return '';
    }

    function renderReadingCoachUi() {
        if (!state.readingCoachUiReady) return;
        const fab = document.getElementById('reading-coach-fab');
        const panel = document.getElementById('reading-coach-panel');
        const messagesEl = document.getElementById('reading-coach-messages');
        const statusEl = document.getElementById('reading-coach-status');
        const actionsEl = document.getElementById('reading-coach-actions');
        const followUpsEl = document.getElementById('reading-coach-followups');
        if (!panel || !messagesEl || !statusEl || !actionsEl || !followUpsEl) return;
        const available = isReadingCoachAvailable();
        if (fab) {
            fab.style.display = available ? 'inline-flex' : 'none';
        }
        if (!available) {
            state.readingCoachOpen = false;
            panel.classList.remove('is-open');
            return;
        }

        panel.classList.toggle('is-open', Boolean(state.readingCoachOpen));
        syncReadingCoachPanelWithFab();
        statusEl.textContent = state.readingCoachBusy
            ? 'AI 教练正在思考...'
            : (state.readingCoachError || '');
        statusEl.classList.toggle('is-error', Boolean(state.readingCoachError));

        if (!state.readingCoachTranscript.length) {
            messagesEl.innerHTML = '<div class=\"reading-coach-msg assistant\">你可以先问：这题怎么定位证据？</div>';
        } else {
            messagesEl.innerHTML = state.readingCoachTranscript
                .slice(-20)
                .map((entry) => `<div class=\"reading-coach-msg ${entry.role}${entry.isError ? ' error' : ''}\">${escapeHtml(entry.content)}</div>`)
                .join('');
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        actionsEl.innerHTML = QUICK_ACTIONS.map((item) => {
            return `<button type=\"button\" class=\"reading-coach-chip\" data-coach-action=\"${item.id}\" ${state.readingCoachBusy ? 'disabled' : ''}>${escapeHtml(item.label)}</button>`;
        }).join('');
        actionsEl.querySelectorAll('[data-coach-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = String(button.getAttribute('data-coach-action') || '').trim();
                if (action === 'review') {
                    state.readingCoachOpen = false;
                    renderReadingCoachUi();
                    triggerSingleAttemptLlmAnalysis(state.lastResults || null);
                    return;
                }
                const query = resolveCoachPresetQuery(action);
                if (query) {
                    sendReadingCoachQuery(query, {
                        action: action === 'similar' ? 'recommend_drills' : 'chat',
                        promptKind: 'preset'
                    });
                }
            });
        });

        const latestAssistant = [...state.readingCoachTranscript].reverse().find((entry) => entry.role === 'assistant' && Array.isArray(entry.followUps) && entry.followUps.length);
        const followUps = latestAssistant ? latestAssistant.followUps.slice(0, 3) : [];
        followUpsEl.innerHTML = followUps.map((item) => {
            return `<button type=\"button\" class=\"reading-coach-chip\" data-coach-followup=\"1\" ${state.readingCoachBusy ? 'disabled' : ''}>${escapeHtml(item)}</button>`;
        }).join('');
        followUpsEl.querySelectorAll('[data-coach-followup]').forEach((button) => {
            button.addEventListener('click', () => {
                const text = String(button.textContent || '').trim();
                if (text) {
                    sendReadingCoachQuery(text, { action: 'chat', promptKind: 'followup' });
                }
            });
        });
    }

    async function requestReadingCoachViaParentBridge(payload, options = {}) {
        const timeoutMs = Number.isFinite(Number(options.timeoutMs))
            ? Math.max(2000, Number(options.timeoutMs))
            : COACH_REQUEST_TIMEOUT_MS;
        const targets = resolveParentBridgeTargets();
        if (!targets.length) {
            const error = new Error('父页阅读教练桥不可用');
            error.code = 'analysis_bridge_unavailable';
            throw error;
        }
        const target = targets[0];
        const requestId = `coach_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return new Promise((resolve, reject) => {
            const timeoutId = global.setTimeout(() => {
                pendingCoachBridgeRequests.delete(requestId);
                const error = new Error('父页阅读教练请求超时');
                error.code = 'analysis_bridge_timeout';
                reject(error);
            }, timeoutMs);

            pendingCoachBridgeRequests.set(requestId, { resolve, reject, timeoutId });
            try {
                target.postMessage({
                    type: 'REQUEST_READING_COACH',
                    source: MESSAGE_SOURCE,
                    data: Object.assign({}, payload, { requestId })
                }, '*');
                state.parentWindow = target;
            } catch (error) {
                pendingCoachBridgeRequests.delete(requestId);
                global.clearTimeout(timeoutId);
                const wrapped = new Error('父页阅读教练消息发送失败');
                wrapped.code = 'analysis_bridge_post_failed';
                wrapped.cause = error;
                reject(wrapped);
            }
        });
    }

    function settleReadingCoachBridgeRequest(requestId, data) {
        const normalizedRequestId = requestId ? String(requestId).trim() : '';
        let resolvedRequestId = normalizedRequestId;
        if (!resolvedRequestId && pendingCoachBridgeRequests.size === 1) {
            resolvedRequestId = pendingCoachBridgeRequests.keys().next().value || '';
        }
        if (!resolvedRequestId || !pendingCoachBridgeRequests.has(resolvedRequestId)) {
            return false;
        }
        const pending = pendingCoachBridgeRequests.get(resolvedRequestId);
        pendingCoachBridgeRequests.delete(resolvedRequestId);
        try {
            global.clearTimeout(pending.timeoutId);
        } catch (_) {
            // ignore clear timeout failure
        }
        const outcome = normalizeBridgeAnalysisOutcome(data);
        if (!outcome.ok) {
            const error = new Error(outcome.message || '父页阅读教练请求失败');
            error.code = outcome.code || 'analysis_bridge_request_failed';
            pending.reject(error);
            return true;
        }
        pending.resolve(outcome.data);
        return true;
    }

    async function requestReadingCoachFromLocalApi(payload) {
        const baseUrl = await resolveLocalApiBaseUrl();
        if (!baseUrl) {
            const error = new Error('本地阅读教练服务不可用');
            error.code = 'local_api_unavailable';
            throw error;
        }
        const response = await fetch(`${baseUrl}${READING_COACH_API_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!response.ok) {
            const payloadError = await response.json().catch(() => ({}));
            const error = new Error(payloadError?.error?.message || payloadError?.message || `HTTP_${response.status}`);
            error.code = payloadError?.error?.code || 'reading_coach_request_failed';
            throw error;
        }

        if (!contentType.includes('text/event-stream') || !response.body) {
            const payloadData = await response.json().catch(() => ({}));
            if (!payloadData || payloadData.success === false || !payloadData.data) {
                const error = new Error(payloadData?.error?.message || payloadData?.message || '阅读教练返回格式无效');
                error.code = payloadData?.error?.code || 'invalid_response_format';
                throw error;
            }
            return payloadData.data;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let finalData = null;
        let streamError = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\\n\\n');
            buffer = blocks.pop() || '';
            blocks.forEach((block) => {
                const lines = block.split('\\n');
                let eventName = '';
                let dataLine = '';
                lines.forEach((line) => {
                    if (line.startsWith('event:')) {
                        eventName = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        dataLine += line.slice(5).trim();
                    }
                });
                let parsed = {};
                try {
                    parsed = dataLine ? JSON.parse(dataLine) : {};
                } catch (_) {
                    parsed = {};
                }
                if (eventName === 'error') {
                    streamError = new Error(parsed?.error?.message || parsed?.message || '阅读教练流式请求失败');
                    streamError.code = parsed?.error?.code || 'reading_coach_stream_failed';
                }
                if (eventName === 'complete') {
                    finalData = parsed?.data || null;
                }
            });
        }
        if (streamError) {
            throw streamError;
        }
        if (!finalData || typeof finalData !== 'object') {
            const error = new Error('阅读教练流式返回缺少 complete 数据');
            error.code = 'invalid_response_format';
            throw error;
        }
        return finalData;
    }

    async function requestReadingCoach(payload) {
        try {
            return await requestReadingCoachFromLocalApi(payload);
        } catch (error) {
            if (!isElectronRuntimeContext()) {
                throw error;
            }
            return requestReadingCoachViaParentBridge(payload, { timeoutMs: COACH_REQUEST_TIMEOUT_MS });
        }
    }

    async function appendAssistantTypewriter(response) {
        const fullText = String(response?.answer || '').trim();
        const assistantEntry = appendReadingCoachMessage('assistant', '', {
            followUps: Array.isArray(response?.followUps) ? response.followUps : []
        });
        if (!fullText) {
            assistantEntry.content = '当前没有可用回复，请换个问法再试。';
            renderReadingCoachUi();
            return;
        }
        const step = Math.max(1, Math.floor(fullText.length / 80));
        for (let index = 0; index < fullText.length; index += step) {
            assistantEntry.content = fullText.slice(0, index + step);
            renderReadingCoachUi();
            await new Promise((resolve) => global.setTimeout(resolve, 12));
        }
        assistantEntry.content = fullText;
        assistantEntry.followUps = Array.isArray(response?.followUps) ? response.followUps.slice(0, 3) : [];
        renderReadingCoachUi();
    }

    function buildReadingCoachRequestPayload(query, options = {}) {
        const normalizedQuery = String(query || '').trim();
        const selectedContext = getSelectedContextForCoach();
        const focusQuestionNumbers = resolveCoachFocusQuestionNumbers();
        const submitted = Boolean(options.forceSubmitted || isReadingCoachAvailable());
        const answerComparison = state.lastResults && state.lastResults.answerComparison
            ? state.lastResults.answerComparison
            : {};
        const wrongQuestions = [];
        const selectedAnswers = {};

        Object.values(answerComparison).forEach((entry) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }
            const questionNumber = String(entry.questionId || '').replace(/^q/i, '').trim();
            if (!questionNumber) {
                return;
            }
            const normalizedAnswer = normalizeAnswerValue(entry.userAnswer);
            const answerText = Array.isArray(normalizedAnswer)
                ? normalizedAnswer.filter(Boolean).join(' / ')
                : String(normalizedAnswer || '').trim();
            if (answerText) {
                selectedAnswers[questionNumber] = answerText;
            }
            if (entry.isCorrect === false) {
                wrongQuestions.push(questionNumber);
            }
        });

        return {
            examId: state.examId,
            query: normalizedQuery,
            locale: 'zh',
            surface: submitted ? 'review_workspace' : 'chat_widget',
            action: String(options.action || 'chat').trim() || 'chat',
            promptKind: String(options.promptKind || 'freeform').trim() || 'freeform',
            selectedText: selectedContext ? selectedContext.text : '',
            selectedContext,
            focusQuestionNumbers,
            history: getReadingCoachHistory(),
            attemptContext: {
                submitted,
                score: state.lastResults?.scoreInfo?.percentage || null,
                wrongQuestions,
                selectedAnswers
            }
        };
    }

    function normalizeCoachConfidenceToRate(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'high') return 0.86;
        if (normalized === 'low') return 0.42;
        return 0.66;
    }

    function buildSingleAttemptLlmFromCoachResponse(response) {
        const sections = Array.isArray(response?.answerSections) ? response.answerSections : [];
        const diagnosis = [];
        const nextActions = [];
        sections.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') return;
            const type = String(entry.type || '').trim().toLowerCase();
            const text = String(entry.text || '').trim();
            if (!text) return;
            if (type === 'next_step') {
                nextActions.push({
                    type: 'coach_next_step',
                    target: 'reading',
                    instruction: text,
                    evidence: []
                });
                return;
            }
            diagnosis.push({
                code: `coach_diag_${index + 1}`,
                reason: text,
                evidence: type === 'evidence' ? [text] : []
            });
        });
        if (!diagnosis.length) {
            const fallback = String(response?.answer || '').trim();
            if (fallback) {
                diagnosis.push({
                    code: 'coach_diag_fallback',
                    reason: fallback,
                    evidence: []
                });
            }
        }
        if (!nextActions.length && Array.isArray(response?.followUps)) {
            response.followUps
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 3)
                .forEach((text) => {
                    nextActions.push({
                        type: 'coach_followup',
                        target: 'reading',
                        instruction: text,
                        evidence: []
                    });
                });
        }
        return {
            diagnosis,
            nextActions,
            confidence: normalizeCoachConfidenceToRate(response?.confidence),
            model_trace: {
                source: 'reading_coach_v2',
                degraded: false
            }
        };
    }

    function applyCoachResponsePatch(response, extra = {}) {
        if (!response || typeof response !== 'object') {
            return;
        }
        state.readingCoachSnapshot = response;
        const transcript = state.readingCoachTranscript.slice();
        const lastResults = state.lastResults && typeof state.lastResults === 'object'
            ? state.lastResults
            : null;
        if (lastResults) {
            lastResults.readingCoachSnapshot = response;
            lastResults.readingCoachTranscript = transcript;
            if (extra.singleAttemptAnalysisLlm) {
                lastResults.singleAttemptAnalysisLlm = extra.singleAttemptAnalysisLlm;
            }
            lastResults.realData = Object.assign({}, lastResults.realData || {}, {
                readingCoachSnapshot: response,
                readingCoachTranscript: transcript,
                ...(extra.singleAttemptAnalysisLlm ? { singleAttemptAnalysisLlm: extra.singleAttemptAnalysisLlm } : {})
            });
        }
        postMessage('PRACTICE_COACH_PATCH', {
            examId: state.examId,
            sessionId: state.sessionId,
            readingCoachSnapshot: response,
            readingCoachTranscript: transcript,
            ...(extra.singleAttemptAnalysisLlm ? { singleAttemptAnalysisLlm: extra.singleAttemptAnalysisLlm } : {}),
            realData: {
                readingCoachSnapshot: response,
                readingCoachTranscript: transcript,
                ...(extra.singleAttemptAnalysisLlm ? { singleAttemptAnalysisLlm: extra.singleAttemptAnalysisLlm } : {})
            }
        });
    }

    async function sendReadingCoachQuery(query, options = {}) {
        const normalizedQuery = String(query || '').trim();
        if (!normalizedQuery || state.readingCoachBusy || !isReadingCoachAvailable()) {
            return null;
        }
        state.readingCoachBusy = true;
        state.readingCoachError = '';
        state.readingCoachStatus = 'running';
        state.readingCoachOpen = true;
        appendReadingCoachMessage('user', normalizedQuery);
        renderReadingCoachUi();

        const requestPayload = buildReadingCoachRequestPayload(normalizedQuery, options);

        try {
            const response = await requestReadingCoach(requestPayload);
            await appendAssistantTypewriter(response);
            applyCoachResponsePatch(response);
            state.readingCoachStatus = 'success';
            renderResults(state.lastResults || {});
            return response;
        } catch (error) {
            const message = String(error?.message || '阅读教练请求失败').trim() || '阅读教练请求失败';
            state.readingCoachError = message;
            state.readingCoachStatus = 'failed';
            appendReadingCoachMessage('assistant', `请求失败：${message}`, { isError: true });
            if (options && options.rethrowError) {
                throw error;
            }
            return null;
        } finally {
            state.readingCoachBusy = false;
            renderReadingCoachUi();
        }
    }

    function setLlmAnalysisStatus(status, message, options = {}) {
        state.llmAnalysisStatus = status || 'idle';
        state.llmAnalysisMessage = String(message || '').trim();
        if (options.render && state.lastResults) {
            renderResults(state.lastResults);
        }
    }

    async function requestSingleAttemptLlmAnalysis(results, onLog = null) {
        if (!results || typeof results !== 'object') {
            const error = new Error('分析请求参数不完整');
            error.code = 'invalid_request_payload';
            throw error;
        }
        const query = resolveCoachPresetQuery('review');
        if (!query) {
            const error = new Error('缺少复盘问题，无法发起 AI 分析');
            error.code = 'invalid_request_payload';
            throw error;
        }
        if (typeof onLog === 'function') {
            onLog('AI 正在复盘错题...');
        }
        const coachResponse = await requestReadingCoach(
            buildReadingCoachRequestPayload(query, {
                action: 'review_set',
                promptKind: 'preset',
                forceSubmitted: true
            })
        );
        return {
            llm: buildSingleAttemptLlmFromCoachResponse(coachResponse),
            coachResponse
        };
    }

    function isLikelyBridgeAnalysisPayload(value) {
        if (!isPlainObject(value)) {
            return false;
        }
        return Boolean(
            Array.isArray(value.diagnosis)
            || Array.isArray(value.nextActions)
            || Number.isFinite(Number(value.confidence))
            || isPlainObject(value.model_trace)
        );
    }

    function normalizeBridgeFailureMeta(meta = null, fallback = null) {
        const normalizedMeta = isPlainObject(meta) ? Object.assign({}, meta) : {};
        if (isPlainObject(fallback)) {
            Object.assign(normalizedMeta, fallback);
        }
        return Object.keys(normalizedMeta).length ? normalizedMeta : null;
    }

    function isSafeBridgeDiagnosticMessage(message) {
        const normalized = String(message || '').trim();
        if (!normalized) {
            return false;
        }
        if (normalized.length > 180) {
            return false;
        }
        return !/analysis_bridge|requestId|postMessage|timeoutId|reading_exam|PRACTICE_|[A-Za-z]+Error|Failed to fetch|http:\/\/|https:\/\/|file:\/\//i.test(normalized);
    }

    function pickFirstPlainObject(candidates = []) {
        for (let index = 0; index < candidates.length; index += 1) {
            if (isPlainObject(candidates[index])) {
                return candidates[index];
            }
        }
        return null;
    }

    function resolveBridgeAnalysisData(data) {
        if (!isPlainObject(data)) {
            return null;
        }
        const nestedCandidates = pickFirstPlainObject([data.data, data.result, data.analysis, data.llm]);
        if (nestedCandidates) {
            return nestedCandidates;
        }
        return isLikelyBridgeAnalysisPayload(data) ? data : null;
    }

    function buildInvalidBridgeOutcome(meta = null) {
        return {
            ok: false,
            code: 'analysis_bridge_invalid_response',
            message: '父页分析桥返回格式无效',
            meta: normalizeBridgeFailureMeta(meta, { stage: 'normalize_bridge_response' })
        };
    }

    function normalizeBridgeAnalysisOutcome(data) {
        if (!isPlainObject(data)) {
            return buildInvalidBridgeOutcome(null);
        }
        const errorBlock = isPlainObject(data.error) ? data.error : null;
        if (data.success === false || errorBlock) {
            return {
                ok: false,
                code: (errorBlock && errorBlock.code) || data.code || 'analysis_bridge_request_failed',
                message: (errorBlock && errorBlock.message) || data.message || '父页分析桥请求失败',
                meta: normalizeBridgeFailureMeta(data.meta, {
                    stage: 'bridge_response_error',
                    hasErrorBlock: Boolean(errorBlock)
                })
            };
        }
        const resolvedData = resolveBridgeAnalysisData(data);
        if (!resolvedData) {
            return buildInvalidBridgeOutcome(data.meta || null);
        }
        return {
            ok: true,
            data: resolvedData,
            meta: normalizeBridgeFailureMeta(data.meta, { stage: 'bridge_response_success' })
        };
    }

    function isWindowMessagingAvailable(target) {
        if (!target || typeof target.postMessage !== 'function') {
            return false;
        }
        try {
            if (typeof target.closed === 'boolean' && target.closed) {
                return false;
            }
        } catch (_) {
            // ignore cross-context closed checks
        }
        return true;
    }

    function resolveParentBridgeTargets() {
        const candidates = [
            state.parentWindow,
            (global.parent && global.parent !== global) ? global.parent : null,
            (global.opener && !global.opener.closed) ? global.opener : null
        ];
        const unique = [];
        const seen = new Set();
        candidates.forEach((target) => {
            if (!isWindowMessagingAvailable(target) || seen.has(target)) {
                return;
            }
            seen.add(target);
            unique.push(target);
        });
        return unique;
    }

    function formatLlmFailureStatusMessage(error) {
        if (error && typeof error.userMessage === 'string' && error.userMessage.trim()) {
            return error.userMessage.trim();
        }
        const code = String(error?.code || '').trim().toLowerCase();
        const rawMessage = String(error?.message || '').trim();
        if (code === 'coach_locked_until_submit') {
            return 'AI 复盘暂不可用：请先完成并提交本轮作答。';
        }
        if (code === 'local_api_unavailable') {
            return 'AI 复盘暂不可用：未发现本地服务，请确认客户端已完整启动后重试。';
        }
        if (code === 'reading_coach_ipc_failed' || code === 'reading_coach_request_failed' || code === 'reading_coach_stream_failed') {
            return 'AI 复盘暂不可用：教练服务请求失败，请稍后重试。';
        }
        if (code === 'invalid_response_format' || code === 'analysis_bridge_invalid_response') {
            return 'AI 复盘暂不可用：服务返回格式异常。';
        }
        if (code === 'analysis_bridge_invalid_request' || code === 'analysis_bridge_invalid_payload') {
            return 'AI 复盘暂不可用：请求参数不完整。';
        }
        if (code === 'analysis_bridge_timeout') {
            return 'AI 复盘暂不可用：主应用长时间未响应。';
        }
        if (code === 'analysis_bridge_unavailable') {
            return 'AI 复盘暂不可用：当前与主应用连接中断。';
        }
        if (rawMessage && isSafeBridgeDiagnosticMessage(rawMessage)) {
            return `AI 复盘暂不可用：${rawMessage}`;
        }
        return 'AI 复盘暂不可用，请稍后重试。';
    }

    async function triggerSingleAttemptLlmAnalysis(results) {
        if (!results || typeof results !== 'object') return;
        if (state.llmAnalysisStatus === 'running') return;
        setLlmAnalysisStatus('running', 'AI 正在复盘错题...', { render: true });
        try {
            const analysisResult = await requestSingleAttemptLlmAnalysis(results, (message) => {
                setLlmAnalysisStatus('running', message, { render: true });
            });
            const llmPatch = analysisResult && typeof analysisResult.llm === 'object'
                ? analysisResult.llm
                : {};
            const coachResponse = analysisResult && analysisResult.coachResponse && typeof analysisResult.coachResponse === 'object'
                ? analysisResult.coachResponse
                : null;
            results.singleAttemptAnalysisLlm = llmPatch;
            results.realData = Object.assign({}, results.realData || {}, {
                singleAttemptAnalysisLlm: llmPatch
            });
            if (coachResponse) {
                applyCoachResponsePatch(coachResponse, { singleAttemptAnalysisLlm: llmPatch });
            }
            setLlmAnalysisStatus('success', 'AI 复盘已更新', { render: false });
            renderResults(results);
        } catch (error) {
            setLlmAnalysisStatus('failed', formatLlmFailureStatusMessage(error), { render: true });
        }
    }

    function renderSingleAttemptGuidance(analysis, llmStatus = null) {
        const diagnosisList = Array.isArray(analysis?.diagnosis)
            ? analysis.diagnosis
                .map((entry) => resolveAnalysisTextEntry(entry, ['reason', 'message']))
                .filter(Boolean)
                .slice(0, 4)
            : [];
        const actionsList = Array.isArray(analysis?.nextActions)
            ? analysis.nextActions
                .map((entry) => resolveAnalysisTextEntry(entry, ['instruction', 'action']))
                .filter(Boolean)
                .slice(0, 3)
            : [];
        if (!diagnosisList.length && !actionsList.length) {
            return `
                <section class="reading-guidance-card">
                    <div class="reading-guidance-card__head">
                        <h5>本次分析指导</h5>
                        <button type="button" class="reading-guidance-card__ai-review-btn" data-action="coach-review-analysis" ${llmStatus?.status === 'running' ? 'disabled' : ''}>AI复盘错题</button>
                    </div>
                    <p class="reading-guidance-card__empty">暂无可用指导内容，请先完成一轮完整作答。</p>
                </section>
            `;
        }
        const diagnosisHtml = diagnosisList.length
            ? `<ul>${diagnosisList.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`
            : '<p class="reading-guidance-card__empty">暂无诊断结论。</p>';
        const actionsHtml = actionsList.length
            ? `<ul>${actionsList.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`
            : '<p class="reading-guidance-card__empty">暂无下一步动作。</p>';
        let statusHtml = '';
        if (llmStatus?.status === 'running' || llmStatus?.status === 'failed' || llmStatus?.status === 'success' || llmStatus?.status === 'degraded') {
            let extraClass = '';
            if (llmStatus?.status === 'failed') {
                extraClass = ' reading-guidance-card__status--failed';
            } else if (llmStatus?.status === 'degraded') {
                extraClass = ' reading-guidance-card__status--degraded';
            }
            const flowClass = llmStatus?.status === 'running' ? ' reading-guidance-card__status-line--flow' : '';
            statusHtml = `<p class="reading-guidance-card__status${extraClass}"><span class="reading-guidance-card__status-line${flowClass}">${escapeHtml(llmStatus.message || '模型正在联通...')}</span></p>`;
        }
        return `
            <section class="reading-guidance-card">
                <div class="reading-guidance-card__head">
                    <h5>本次分析指导</h5>
                    <button type="button" class="reading-guidance-card__ai-review-btn" data-action="coach-review-analysis" ${llmStatus?.status === 'running' ? 'disabled' : ''}>AI复盘错题</button>
                </div>
                ${statusHtml}
                <div class="reading-guidance-card__row">
                    <div class="reading-guidance-card__label">诊断结论</div>
                    ${diagnosisHtml}
                </div>
                <div class="reading-guidance-card__row">
                    <div class="reading-guidance-card__label">下一步动作</div>
                    ${actionsHtml}
                </div>
            </section>
        `;
    }

    function renderResults(results) {
        if (!dom.results) return;
        state.submitted = true;
        state.lastResults = results || state.lastResults;
        ensureAnalysisStyles();
        ensureReadingCoachUi();
        const hasCanonicalInput = results
            && results.singleAttemptAnalysisInput
            && typeof results.singleAttemptAnalysisInput === 'object'
            && Number.isFinite(Number(results.singleAttemptAnalysisInput.totalQuestions));
        const hasCanonicalAnalysis = results
            && results.singleAttemptAnalysis
            && typeof results.singleAttemptAnalysis === 'object'
            && results.singleAttemptAnalysis.radar
            && Array.isArray(results.singleAttemptAnalysis.radar.byQuestionKind);
        const analysisBundle = (hasCanonicalInput && hasCanonicalAnalysis)
            ? {
                input: results.singleAttemptAnalysisInput,
                analysis: results.singleAttemptAnalysis,
                questionTypePerformance: results.questionTypePerformance
            }
            : resolveSingleAttemptAnalysisArtifacts(results, getQuestionOrder(results.answers || {}));
        const mergedGuidanceAnalysis = mergeSingleAttemptAnalysis(
            analysisBundle.analysis,
            results.singleAttemptAnalysisLlm || results.realData?.singleAttemptAnalysisLlm || null
        );
        const radarSection = renderSingleAttemptRadar(analysisBundle.analysis);
        const guidanceSection = renderSingleAttemptGuidance(mergedGuidanceAnalysis, {
            status: state.llmAnalysisStatus,
            message: state.llmAnalysisMessage
        });
        if (results.readingCoachSnapshot && typeof results.readingCoachSnapshot === 'object') {
            state.readingCoachSnapshot = results.readingCoachSnapshot;
        }
        if (Array.isArray(results.readingCoachTranscript) && results.readingCoachTranscript.length) {
            state.readingCoachTranscript = results.readingCoachTranscript.slice(-40);
        }
        results.questionTypePerformance = analysisBundle.questionTypePerformance || results.questionTypePerformance;
        results.singleAttemptAnalysisInput = analysisBundle.input;
        results.singleAttemptAnalysis = analysisBundle.analysis;
        results.singleAttemptAnalysisLlm = results.singleAttemptAnalysisLlm || results.realData?.singleAttemptAnalysisLlm || null;
        results.realData = Object.assign({}, results.realData || {}, {
            singleAttemptAnalysisInput: analysisBundle.input,
            singleAttemptAnalysis: analysisBundle.analysis,
            singleAttemptAnalysisLlm: results.singleAttemptAnalysisLlm || null
        });
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
            ${radarSection}
            ${guidanceSection}
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
        const aiReviewButton = dom.results.querySelector('[data-action="coach-review-analysis"]');
        if (aiReviewButton) {
            aiReviewButton.addEventListener('click', () => {
                if (state.llmAnalysisStatus === 'running') {
                    return;
                }
                triggerSingleAttemptLlmAnalysis(results);
            }, { once: true });
        }
        renderReadingCoachUi();
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
            scoreInfo,
            readingCoachSnapshot: entry.readingCoachSnapshot || entry.realData?.readingCoachSnapshot || null,
            readingCoachTranscript: entry.readingCoachTranscript || entry.realData?.readingCoachTranscript || []
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
                postMessage('REVIEW_NAVIGATE', buildReviewNavigatePayload(direction, finalizeOnNext));
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
        state.llmAnalysisStatus = 'idle';
        state.llmAnalysisMessage = '';
        state.llmAnalysisRequestId += 1;
        state.readingCoachOpen = false;
        renderReadingCoachUi();
        clearExplanations();
        updateNavStatuses();
    }

    function applyReviewContext(data = {}) {
        if (isExamIdMismatched(data && data.examId)) {
            return;
        }
        state.reviewContext = data;
        state.suiteReviewMode = Boolean(data.suiteReviewMode);
        const viewMode = data.viewMode === 'answering' ? 'answering' : 'review';
        state.reviewViewMode = viewMode;
        syncReviewCursor(data, 'currentIndex');
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
            resetToAnsweringPresentation();
            applyReviewMode(false, data, viewMode);
        } else {
            applyReviewMode(true, data, viewMode);
        }
    }

    async function applyReplayRecord(data = {}) {
        const entry = data.entry && typeof data.entry === 'object' ? data.entry : data;
        if (isExamIdMismatched(entry && entry.examId)) {
            return;
        }
        const replayResults = buildReplayResults(entry);
        const replayMarks = resolveReplayMarkedQuestions(data, entry);
        syncReviewCursor(data, 'reviewEntryIndex');
        applyReviewMode(true, data, 'review');
        applyReplayAnswersToDom(replayResults.answers || {});
        state.lastResults = replayResults;
        state.submitted = true;
        renderResults(replayResults);
        await renderExplanations();
        updateNavStatuses(replayResults);
        applyReplayMarkedQuestions(replayMarks);
    }

    function normalizeId(value) { return value != null ? String(value).trim() : ''; }

    function isExamIdMismatched(incomingExamId) {
        const normalizedIncoming = normalizeId(incomingExamId);
        const normalizedCurrent = normalizeId(state.examId);
        return Boolean(normalizedIncoming && normalizedCurrent && normalizedIncoming !== normalizedCurrent);
    }

    function isPlainObject(value) {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    }

    function resolveIncomingType(payload) {
        if (!isPlainObject(payload)) {
            return '';
        }
        return String(payload.type || payload.messageType || payload.action || payload.event || '').toUpperCase();
    }

    function resolveIncomingData(payload) {
        if (!isPlainObject(payload)) {
            return {};
        }
        return pickFirstPlainObject([payload.data, payload.payload, payload.detail, payload.messageData]) || {};
    }

    function normalizeIncomingEnvelope(event) {
        const payload = event?.data;
        if (!isPlainObject(payload)) {
            return null;
        }
        return {
            payload,
            type: resolveIncomingType(payload),
            data: resolveIncomingData(payload)
        };
    }

    function resolveBridgeRequestId(data, payload) {
        if (isPlainObject(data) && data.requestId != null) {
            return String(data.requestId).trim();
        }
        if (isPlainObject(payload) && payload.requestId != null) {
            return String(payload.requestId).trim();
        }
        return '';
    }

    function buildAnalysisBridgeResponsePayload(payload, data) {
        const requestId = resolveBridgeRequestId(data, payload);
        const normalizedData = isPlainObject(data) ? data : {};
        const mergedData = Object.assign({}, normalizedData);
        if (!mergedData.requestId && requestId) {
            mergedData.requestId = requestId;
        }
        return {
            requestId,
            mergedData
        };
    }

    function safeJsonStringify(value, fallbackValue = '') { try { return JSON.stringify(value); } catch (_) { return fallbackValue; } }
    function safeJsonParse(value, fallbackValue = null) { try { return JSON.parse(value); } catch (_) { return fallbackValue; } }
    function getElapsedSeconds() { return Math.max(0, Math.round((Date.now() - state.pageStartTime) / 1000)); }

    function buildReviewNavigatePayload(direction, finalizeOnNext) {
        return {
            direction,
            sessionId: null,
            reviewSessionId: state.reviewSessionId || state.reviewContext?.reviewSessionId || null, suiteSessionId: state.suiteSessionId || state.reviewContext?.suiteSessionId || null,
            suiteReviewMode: state.suiteReviewMode === true, currentIndex: Number.isInteger(state.reviewContext?.currentIndex) ? state.reviewContext.currentIndex : state.reviewEntryIndex,
            finalizeOnNext: Boolean(finalizeOnNext)
        };
    }

    function buildEnvelope(type, payload) {
        return {
            type,
            data: Object.assign({
                examId: state.examId,
                sessionId: state.sessionId,
                suiteSessionId: state.suiteSessionId,
                source: MESSAGE_SOURCE
            }, payload || {}),
            source: MESSAGE_SOURCE
        };
    }

    function loadPendingPracticeMessages() {
        const stores = [global.localStorage, global.sessionStorage].filter(Boolean);
        let storageQueue = [];
        for (let index = 0; index < stores.length; index += 1) {
            const store = stores[index];
            try {
                const raw = store.getItem(PENDING_PRACTICE_MESSAGES_KEY);
                if (!raw) continue;
                const parsed = safeJsonParse(raw, null);
                if (Array.isArray(parsed)) {
                    storageQueue = parsed;
                    break;
                }
            } catch (_) {
                // ignore malformed payload
            }
        }
        let windowNameQueue = [];
        try {
            const rawWindowName = typeof global.name === 'string' ? global.name : '';
            if (rawWindowName.startsWith(WINDOW_NAME_PENDING_PREFIX)) {
                const parsed = safeJsonParse(rawWindowName.slice(WINDOW_NAME_PENDING_PREFIX.length), null);
                if (Array.isArray(parsed)) {
                    windowNameQueue = parsed;
                }
            }
        } catch (_) {
            // ignore malformed window.name payload
        }
        if (!storageQueue.length) {
            return windowNameQueue;
        }
        if (!windowNameQueue.length) {
            return storageQueue;
        }
        return storageQueue.concat(windowNameQueue);
    }

    function persistPendingPracticeMessages(messages) {
        const normalized = Array.isArray(messages) ? messages.slice(-10) : [];
        const serialized = JSON.stringify(normalized);
        [global.localStorage, global.sessionStorage].filter(Boolean).forEach((store) => {
            try {
                store.setItem(PENDING_PRACTICE_MESSAGES_KEY, serialized);
            } catch (_) {
                // ignore quota/storage errors
            }
        });
        try {
            const currentName = typeof global.name === 'string' ? global.name : '';
            if (!currentName || currentName.startsWith(WINDOW_NAME_PENDING_PREFIX)) {
                global.name = `${WINDOW_NAME_PENDING_PREFIX}${serialized}`;
            }
        } catch (_) {
            // ignore window.name write errors
        }
    }

    function appendPendingPracticeMessage(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return;
        }
        const existing = loadPendingPracticeMessages();
        const normalizedQueue = normalizePendingPracticeQueue(existing);
        const incomingKey = buildPendingMessageKey(envelope);
        const deduped = incomingKey
            ? normalizedQueue.filter((entry) => buildPendingMessageKey(entry.message) !== incomingKey)
            : normalizedQueue.slice();
        deduped.push({
            createdAt: Date.now(),
            message: envelope
        });
        persistPendingPracticeMessages(deduped);
    }

    function normalizePendingPracticeQueue(queue) {
        if (!Array.isArray(queue) || queue.length === 0) {
            return [];
        }
        const normalized = queue
            .map((entry) => {
                if (entry && typeof entry === 'object' && entry.message && typeof entry.message === 'object') {
                    return {
                        createdAt: Number(entry.createdAt) || Date.now(),
                        message: entry.message
                    };
                }
                if (entry && typeof entry === 'object') {
                    return {
                        createdAt: Date.now(),
                        message: entry
                    };
                }
                return null;
            })
            .filter(Boolean);

        const dedupedByKey = new Map();
        normalized.forEach((entry) => {
            const keyFromContract = buildPendingMessageKey(entry.message);
            let fallbackKey = '';
            if (!keyFromContract) {
                try {
                    fallbackKey = JSON.stringify(entry.message);
                } catch (_) {
                    fallbackKey = '';
                }
            }
            const key = keyFromContract || fallbackKey || `__pending_${entry.createdAt}`;
            const existing = dedupedByKey.get(key);
            if (!existing || Number(entry.createdAt) >= Number(existing.createdAt)) {
                dedupedByKey.set(key, entry);
            }
        });

        return Array.from(dedupedByKey.values()).sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    }

    function buildPendingMessageKey(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return '';
        }
        const type = typeof envelope.type === 'string' ? envelope.type.trim().toUpperCase() : '';
        const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
        const examId = data.examId != null ? String(data.examId).trim() : '';
        const sessionId = data.sessionId != null ? String(data.sessionId).trim() : '';
        const suiteSessionId = data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '';
        if (!type || !examId || !sessionId) {
            return '';
        }
        return `${type}|${examId}|${sessionId}|${suiteSessionId}`;
    }

    function clearPendingPracticeMessages() {
        [global.localStorage, global.sessionStorage].filter(Boolean).forEach((store) => {
            try {
                store.removeItem(PENDING_PRACTICE_MESSAGES_KEY);
            } catch (_) {
                // ignore storage errors
            }
        });
        try {
            const currentName = typeof global.name === 'string' ? global.name : '';
            if (currentName.startsWith(WINDOW_NAME_PENDING_PREFIX)) {
                global.name = '';
            }
        } catch (_) {
            // ignore window.name clear errors
        }
    }

    function drainPendingPracticeMessages(targetWindow) {
        if (!targetWindow || targetWindow === global) {
            return;
        }
        const queue = normalizePendingPracticeQueue(loadPendingPracticeMessages());
        if (queue.length === 0) {
            clearPendingPracticeMessages();
            return;
        }
        const envelopes = queue
            .map((entry) => entry.message)
            .filter(Boolean)
            .slice(-10);
        if (!envelopes.length) {
            clearPendingPracticeMessages();
            return;
        }

        for (let index = 0; index < envelopes.length; index += 1) {
            try {
                targetWindow.postMessage(envelopes[index], '*');
            } catch (_) {
                const remaining = envelopes.slice(index).map((message) => ({
                    createdAt: Date.now(),
                    message
                }));
                persistPendingPracticeMessages(remaining);
                return;
            }
        }

        clearPendingPracticeMessages();
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
                drainPendingPracticeMessages(target);
                return true;
            } catch (_) {
                // try next candidate
            }
        }
        const normalizedType = String(type || '').toUpperCase();
        if (normalizedType === 'PRACTICE_COMPLETE' || normalizedType === 'PRACTICE_COACH_PATCH') {
            appendPendingPracticeMessage(envelope);
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
        postMessage('SESSION_READY', buildSessionReadyPayload());
        state.sessionReadySent = true;
    }

    function buildInitSignature(data = {}) {
        return safeJsonStringify({
            examId: data.examId != null ? String(data.examId).trim() : '',
            sessionId: data.sessionId != null ? String(data.sessionId).trim() : '',
            suiteSessionId: data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '',
            reviewSessionId: data.reviewSessionId != null ? String(data.reviewSessionId).trim() : '',
            reviewEntryIndex: Number.isInteger(data.reviewEntryIndex) ? data.reviewEntryIndex : 0,
            reviewMode: Boolean(data.reviewMode),
            readOnly: Object.prototype.hasOwnProperty.call(data, 'readOnly') ? Boolean(data.readOnly) : null,
            suiteFlowMode: typeof data.suiteFlowMode === 'string' ? data.suiteFlowMode.trim().toLowerCase() : ''
        }, '');
    }

    function buildReplaySignature(data = {}) {
        const entry = data.entry && typeof data.entry === 'object' ? data.entry : {};
        return safeJsonStringify({
            examId: normalizeId(entry && entry.examId) || normalizeId(state.examId),
            reviewSessionId: data.reviewSessionId != null ? String(data.reviewSessionId).trim() : '',
            suiteSessionId: data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '',
            reviewEntryIndex: Number.isInteger(data.reviewEntryIndex) ? data.reviewEntryIndex : 0
        }, '');
    }

    function startInitLoop() {
        stopInitLoop();
        state.initTimer = setInterval(() => {
            if (state.sessionId) {
                stopInitLoop();
                return;
            }
            postMessage('REQUEST_INIT', buildRequestInitPayload());
        }, INIT_RETRY_MS);
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
        const serialized = safeJsonStringify(draft, '');
        if (serialized) {
            const parsed = safeJsonParse(serialized, null);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        }
        return {
            answers: draft.answers && typeof draft.answers === 'object' ? { ...draft.answers } : {},
            highlights: Array.isArray(draft.highlights) ? draft.highlights.slice() : [],
            scrollY: Number.isFinite(Number(draft.scrollY)) ? Number(draft.scrollY) : 0
        };
    }

    function buildDraftFingerprint(draft) {
        if (!draft || typeof draft !== 'object') {
            return '';
        }
        return safeJsonStringify(draft, '');
    }

    function withSimulationDraftStorage(accessor, fallbackValue = null) {
        const key = getSimulationDraftStorageKey();
        if (!key || !global.sessionStorage) return fallbackValue;
        try { return accessor(global.sessionStorage, key); } catch (_) { return fallbackValue; }
    }

    function persistSimulationDraftMirror(draft) {
        if (!draft) return;
        withSimulationDraftStorage((storage, key) => {
            storage.setItem(key, safeJsonStringify({
                draft,
                updatedAt: Date.now()
            }, ''));
            return true;
        }, false);
    }

    function restoreSimulationDraftMirror() {
        return withSimulationDraftStorage((storage, key) => {
            const raw = storage.getItem(key);
            if (!raw) return null;
            const parsed = safeJsonParse(raw, null);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            return parsed.draft && typeof parsed.draft === 'object'
                ? parsed.draft
                : null;
        }, null);
    }

    function clearSimulationDraftMirror() {
        withSimulationDraftStorage((storage, key) => (storage.removeItem(key), true), false);
    }

    function stopSimulationDraftSync() {
        if (state.simulationDraftSyncTimer) {
            clearInterval(state.simulationDraftSyncTimer);
            state.simulationDraftSyncTimer = null;
        }
    }

    function collectCurrentDraft() {
        return { answers: collectAnswers(), highlights: collectHighlights(), scrollY: global.scrollY || 0 };
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
            elapsed: getElapsedSeconds()
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
            elapsed: getElapsedSeconds()
        });
    }

    async function handleSubmit() {
        if (state.readOnly) {
            return;
        }
        const submitTimestamp = Date.now();
        trackAnswerTimeline(collectAnswers(), submitTimestamp);
        if (state.simulationMode) {
            syncSimulationDraftSnapshot('submit');
        }
        if (state.simulationMode && state.simulationCtx && !state.simulationCtx.isLast) {
            dispatchSimulationNavigate('next');
            return;
        }
        const durationSec = Math.max(1, Math.round((Date.now() - state.startTime) / 1000));
        const results = buildResults({ durationSec });
        const normalizedInput = results.singleAttemptAnalysisInput;
        const normalizedAnalysis = results.singleAttemptAnalysis;
        state.llmAnalysisStatus = 'idle';
        state.llmAnalysisMessage = '';
        results.readingCoachSnapshot = state.readingCoachSnapshot || results.readingCoachSnapshot || null;
        results.readingCoachTranscript = Array.isArray(state.readingCoachTranscript)
            ? state.readingCoachTranscript.slice()
            : (Array.isArray(results.readingCoachTranscript) ? results.readingCoachTranscript.slice() : []);
        state.lastResults = results;
        renderResults(results);
        await renderExplanations();
        updateNavStatuses(results);
        const messageType = state.simulationMode ? 'SIMULATION_SUBMIT' : 'PRACTICE_COMPLETE';
        postMessage(messageType, Object.assign({
            duration: durationSec,
            startTime: new Date(state.startTime).toISOString(),
            endTime: new Date().toISOString(),
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
                    : [],
                readingCoachSnapshot: results.readingCoachSnapshot || null,
                readingCoachTranscript: results.readingCoachTranscript || []
            },
            readingCoachSnapshot: results.readingCoachSnapshot || null,
            readingCoachTranscript: results.readingCoachTranscript || [],
            realData: Object.assign({}, results.realData || {}, {
                readingCoachSnapshot: results.readingCoachSnapshot || null,
                readingCoachTranscript: results.readingCoachTranscript || []
            })
        }, results));
        try {
            document.dispatchEvent(new CustomEvent('practiceSubmissionFinalized', {
                detail: {
                    status: 'final',
                    examId: state.examId,
                    sessionId: state.sessionId
                }
            }));
        } catch (_) {
            // ignore event dispatch failures
        }
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
        document.addEventListener('change', () => {
            recordInteraction();
            trackAnswerTimeline(collectAnswers(), Date.now());
            updateNavStatuses();
        });
        document.addEventListener('input', () => {
            recordInteraction();
            trackAnswerTimeline(collectAnswers(), Date.now());
            updateNavStatuses();
        });
        document.addEventListener('click', () => {
            recordInteraction();
        }, true);
        document.addEventListener('drop', () => {
            recordInteraction();
            global.setTimeout(() => {
                trackAnswerTimeline(collectAnswers(), Date.now());
                updateNavStatuses();
            }, 0);
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

    function resolveLegacyIndexUrl() {
        const href = global.location && typeof global.location.href === 'string'
            ? String(global.location.href)
            : '';
        if (!href.startsWith('file://')) {
            return '';
        }
        try {
            const decodedPath = decodeURIComponent(href.replace(/^file:\/\//, '').split(/[?#]/)[0]);
            const normalizedPath = decodedPath.replace(/\\/g, '/');
            const markers = ['/templates/', '/dist/writing/', '/apps/writing-vue/', '/assets/'];
            for (let i = 0; i < markers.length; i += 1) {
                const marker = markers[i];
                const markerIndex = normalizedPath.indexOf(marker);
                if (markerIndex > 0) {
                    return `file://${normalizedPath.slice(0, markerIndex)}/index.html`;
                }
            }
            const lastSlash = normalizedPath.lastIndexOf('/');
            if (lastSlash > 0) {
                return `file://${normalizedPath.slice(0, lastSlash + 1)}index.html`;
            }
        } catch (_) {
            return '';
        }
        return '';
    }

    function navigateToLegacyHome() {
        const runtimeLegacyHomeUrl = resolveRuntimeParam('legacyHomeUrl');
        if (global.electronAPI && typeof global.electronAPI.openLegacy === 'function') {
            try {
                global.electronAPI.openLegacy();
                return true;
            } catch (_) {
                // ignore and continue fallback
            }
        }
        if (runtimeLegacyHomeUrl) {
            try {
                if (global.location && typeof global.location.replace === 'function') {
                    global.location.replace(runtimeLegacyHomeUrl);
                } else if (global.location) {
                    global.location.href = runtimeLegacyHomeUrl;
                }
                return true;
            } catch (_) {
                // continue to file:// fallback
            }
        }
        const legacyIndexUrl = resolveLegacyIndexUrl();
        if (!legacyIndexUrl) {
            return false;
        }
        try {
            if (global.location && typeof global.location.replace === 'function') {
                global.location.replace(legacyIndexUrl);
            } else if (global.location) {
                global.location.href = legacyIndexUrl;
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function isEmbeddedPracticeContext() {
        return Boolean(!global.opener && global.parent && global.parent !== global);
    }

    function handleIncoming(event) {
        const envelope = normalizeIncomingEnvelope(event);
        if (!envelope) {
            return;
        }
        const { payload, type, data } = envelope;
        if (type === 'READING_COACH_RESULT') {
            const { requestId, mergedData } = buildAnalysisBridgeResponsePayload(payload, data);
            settleReadingCoachBridgeRequest(requestId, mergedData);
            return;
        }
        if (type === 'INIT_SESSION' || type === 'INIT_EXAM_SESSION') {
            const initSignature = buildInitSignature(data);
            const isDuplicateInit = initSignature && initSignature === state.lastInitSignature;
            const incomingExamId = normalizeId(data.examId);
            const currentExamId = normalizeId(state.examId);
            if (isExamIdMismatched(incomingExamId)) {
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
            syncReviewCursor(data, 'reviewEntryIndex');
            const initFlowMode = normalizeFlowMode(data.suiteFlowMode);
            if (initFlowMode === 'simulation') {
                applySimulationState(
                    resolveSimulationSequence(Number(data.suiteSequenceIndex), Number(data.suiteSequenceTotal)),
                    false
                );
            } else if (initFlowMode) {
                clearSimulationState(false);
            }
            if (data.reviewMode) {
                applyReviewMode(true, data);
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
            const targetSuiteSessionId = normalizeId(data.suiteSessionId);
            const currentSuiteSessionId = normalizeId(state.suiteSessionId);
            if (targetSuiteSessionId && currentSuiteSessionId && targetSuiteSessionId !== currentSuiteSessionId) {
                return;
            }
            global.location.href = data.url;
            return;
        }
        if (type === 'SIMULATION_CONTEXT') {
            if (isExamIdMismatched(data && data.examId)) {
                return;
            }
            const flowMode = normalizeFlowMode(data && data.flowMode) || 'simulation';
            if (flowMode !== 'simulation') {
                clearSimulationState(true);
                syncPrimaryActionButtons();
                return;
            }
            applySimulationState(data, true);
            if (Number.isFinite(Number(data.globalTimerAnchorMs))) {
                state.simulationGlobalAnchorMs = Number(data.globalTimerAnchorMs);
            }
            const elapsedSeconds = Number.isFinite(Number(data.elapsed)) ? Number(data.elapsed) : 0;
            state.pageStartTime = Date.now() - (elapsedSeconds * 1000);
            state.startTime = Number.isFinite(state.simulationGlobalAnchorMs)
                ? state.simulationGlobalAnchorMs
                : state.pageStartTime;
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
            clearSimulationState(true);
            if (isEmbeddedPracticeContext()) {
                postMessage('PRACTICE_EXIT', {
                    reason: 'suite_force_close'
                });
                return;
            }
            try {
                if (!navigateToLegacyHome()) {
                    global.close();
                }
            } catch (_) {
                // ignore
            }
        }
    }

    function attachMessageBridge() {
        global.addEventListener('message', handleIncoming);
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
        syncSuiteModeState();
        trackAnswerTimeline(collectAnswers(), Date.now());
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
