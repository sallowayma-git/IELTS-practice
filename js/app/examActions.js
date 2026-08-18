(function (global) {
    'use strict';

   // 配置与常量
   
    const preferredFirstExamByCategory = {
        'P1_reading': { id: 'p1-09', title: 'Listening to the Ocean 海洋探测' },
        'P2_reading': { id: 'p2-high-12', title: 'The fascinating world of attine ants 切叶蚁' },
        'P3_reading': { id: 'p3-high-11', title: 'The Fruit Book 果实之书' },
        'P1_listening': { id: 'listening-p3-01', title: 'Julia and Bob’s science project is due' },
        'P3_listening': { id: 'listening-p3-02', title: 'Climate change and allergies' }
    };

    const FREQUENCY_SORT_RANK = {
        'ultra-high': 5,
        '超高频': 5,
        'very-high': 2,
        '次高频': 2,
        'high': 3,
        '高频': 3,
        'medium': 2,
        'mid': 2,
        '中频': 2,
        'low': 1,
        '低频': 1
    };
    const CUSTOM_SUITE_PANEL_MARGIN = 12;
    let customSuitePortalPosition = null;

    function normalizeExamSignature(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function deduplicateExams(exams) {
        if (!Array.isArray(exams) || exams.length <= 1) {
            return Array.isArray(exams) ? exams : [];
        }
        const seen = new Set();
        const deduped = [];
        exams.forEach((exam) => {
            if (!exam) return;
            const signature = [
                normalizeExamSignature(exam.type),
                normalizeExamSignature(exam.category),
                normalizeExamSignature(exam.title)
            ].join('::');
            if (seen.has(signature)) {
                return;
            }
            seen.add(signature);
            deduped.push(exam);
        });
        return deduped;
    }

    function resolveFrequencyRank(exam) {
        const raw = String(exam && exam.frequency || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(FREQUENCY_SORT_RANK, raw)) {
            return FREQUENCY_SORT_RANK[raw];
        }
        return 0;
    }

    function resolveDifficultyScore(exam) {
        const score = Number(exam && exam.difficultyScore);
        return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
    }

    function compareByCategoryThenTitle(a, b) {
        const categoryA = String(a && a.category || '');
        const categoryB = String(b && b.category || '');
        const categoryDiff = categoryA.localeCompare(categoryB, 'zh-Hans-CN');
        if (categoryDiff !== 0) {
            return categoryDiff;
        }
        return String(a && a.title || '').localeCompare(String(b && b.title || ''), 'zh-Hans-CN');
    }

    function normalizeBrowseFrequencyFilter(value) {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'high' || raw === 'medium' || raw === 'low') {
            return raw;
        }
        return 'all';
    }

    function normalizeFrequencyBucket(exam) {
        const raw = String(exam && exam.frequency || '').trim().toLowerCase();
        if (!raw || raw === 'unknown' || raw === '未知频率') {
            return '';
        }
        if (raw === 'low' || raw === '低频') {
            return 'low';
        }
        if (raw === 'medium' || raw === 'mid' || raw === '中频' || raw === 'very-high' || raw === '次高频') {
            return 'medium';
        }
        if (raw === 'high' || raw === '高频' || raw === 'ultra-high' || raw === '超高频') {
            return 'high';
        }
        return '';
    }

    function applyBrowseFrequencyFilter(exams, frequencyFilter) {
        const list = Array.isArray(exams) ? exams.slice() : [];
        const filter = normalizeBrowseFrequencyFilter(
            frequencyFilter || global.__browseFrequencyFilter || 'all'
        );
        if (filter === 'all') {
            return list;
        }
        return list.filter((exam) => normalizeFrequencyBucket(exam) === filter);
    }

    function applyExamSort(exams, sortMode) {
        const list = Array.isArray(exams) ? exams.slice() : [];
        const mode = String(sortMode || global.__browseSortMode || 'default').trim().toLowerCase();
        if (mode === 'difficulty-desc') {
            return list.sort((a, b) => {
                const difficultyA = resolveDifficultyScore(a);
                const difficultyB = resolveDifficultyScore(b);
                if (difficultyA !== difficultyB) {
                    return difficultyB - difficultyA;
                }
                return compareByCategoryThenTitle(a, b);
            });
        }
        if (mode !== 'frequency-desc') {
            return list;
        }
        return list.sort((a, b) => {
            const rankDiff = resolveFrequencyRank(b) - resolveFrequencyRank(a);
            if (rankDiff !== 0) {
                return rankDiff;
            }
            return compareByCategoryThenTitle(a, b);
        });
    }

    function applyBrowsePostFilters(exams, sortMode, frequencyFilter) {
        const deduplicated = deduplicateExams(exams);
        const frequencyFiltered = applyBrowseFrequencyFilter(deduplicated, frequencyFilter);
        return applyExamSort(frequencyFiltered, sortMode);
    }

    function hasListeningEntries(exams) {
        return (Array.isArray(exams) ? exams : []).some((exam) => exam && exam.type === 'listening');
    }

    function normalizeUnavailableListeningFilter(activeCategory, activeExamType, examIndexSnapshot) {
        const listeningAvailable = typeof global.hasActiveListeningLibrary === 'function'
            ? global.hasActiveListeningLibrary(examIndexSnapshot)
            : hasListeningEntries(examIndexSnapshot);
        const isListeningFilter = activeExamType === 'listening'
            || (global.__browseFilterMode && global.__browseFilterMode !== 'default');
        if (listeningAvailable || !isListeningFilter) {
            return { activeCategory, activeExamType };
        }

        global.__browseFilterMode = 'default';
        global.__browsePath = null;
        if (global.browseController) {
            global.browseController.currentMode = 'default';
            global.browseController.activeFilter = 'all';
            if (typeof global.browseController.setBrowseFilterState === 'function') {
                global.browseController.setBrowseFilterState('all', 'all');
            }
            if (typeof global.browseController.renderFilterButtons === 'function') {
                global.browseController.renderFilterButtons();
            }
        } else if (typeof global.setBrowseFilterState === 'function') {
            global.setBrowseFilterState('all', 'all');
        }
        if (typeof global.setBrowseTitle === 'function') {
            global.setBrowseTitle('题库列表');
        }
        return { activeCategory: 'all', activeExamType: 'all' };
    }

    function filterExamsWithLegacyFallback(exams, state) {
        const inputList = Array.isArray(exams) ? exams : [];
        const safeState = state && typeof state === 'object' ? state : {};
        const activeCategory = String(safeState.activeCategory || safeState.category || 'all');
        const activeExamType = String(safeState.activeExamType || safeState.examType || 'all');
        const filterMode = String(safeState.browseFilterMode || safeState.filterMode || 'default');
        const sortMode = String(safeState.sortMode || safeState.browseSortMode || global.__browseSortMode || 'default');
        const frequencyFilter = normalizeBrowseFrequencyFilter(
            safeState.frequencyFilter || safeState.browseFrequencyFilter || global.__browseFrequencyFilter || 'all'
        );
        const isFrequencyMode = filterMode !== 'default';
        const basePathFilter = isFrequencyMode
            && typeof safeState.basePathFilter === 'string'
            && safeState.basePathFilter.trim()
            ? safeState.basePathFilter.trim()
            : (isFrequencyMode && typeof safeState.browsePath === 'string' && safeState.browsePath.trim()
                ? safeState.browsePath.trim()
                : null);
        const preferredMap = safeState.preferredFirstExamByCategory && typeof safeState.preferredFirstExamByCategory === 'object'
            ? safeState.preferredFirstExamByCategory
            : preferredFirstExamByCategory;
        let list = inputList.slice();

        if (activeExamType !== 'all') {
            list = list.filter(exam => exam.type === activeExamType);
        }
        if (activeCategory !== 'all') {
            const filteredByCategory = list.filter(exam => exam.category === activeCategory);
            if (filteredByCategory.length > 0 || !basePathFilter) {
                list = filteredByCategory;
            }
        }
        if (basePathFilter) {
            list = list.filter((exam) => typeof exam?.path === 'string' && exam.path.includes(basePathFilter));
        }

        if (activeCategory !== 'all' && activeExamType !== 'all') {
            const key = `${activeCategory}_${activeExamType}`;
            const preferred = preferredMap[key];
            if (preferred) {
                let preferredIndex = list.findIndex(exam => exam.id === preferred.id);
                if (preferredIndex === -1) {
                    preferredIndex = list.findIndex(exam =>
                        exam.title === preferred.title &&
                        exam.category === activeCategory &&
                        exam.type === activeExamType
                    );
                }
                if (preferredIndex > -1) {
                    const [item] = list.splice(preferredIndex, 1);
                    list.unshift(item);
                }
            }
        }

        return applyBrowsePostFilters(list, sortMode, frequencyFilter);
    }

    function formatFrequencyLabel(frequency) {
        const raw = String(frequency || '').trim().toLowerCase();
        if (!raw) {
            return '';
        }
        const map = {
            'ultra-high': '超高频',
            'very-high': '次高频',
            'high': '高频',
            'medium': '中频',
            'mid': '中频',
            'low': '低频',
            '超高频': '超高频',
            '次高频': '次高频',
            '高频': '高频',
            '中频': '中频',
            '低频': '低频'
        };
        return map[raw] || String(frequency);
    }

    function formatDifficultyLabel(score) {
        const value = Number(score);
        if (!Number.isFinite(value)) {
            return '';
        }
        return `难度 ${Number.isInteger(value) ? String(value) : String(value)}`;
    }

    global.formatFrequencyLabel = formatFrequencyLabel;
    global.formatDifficultyLabel = formatDifficultyLabel;

    if (typeof global.formatExamMetaText !== 'function') {
        global.formatExamMetaText = function formatExamMetaText(exam) {
            const parts = [];
            if (exam && typeof exam.sequenceNumber === 'number') {
                parts.push(String(exam.sequenceNumber));
            }
            if (exam && exam.category) {
                parts.push(exam.category);
            }
            if (exam && exam.type) {
                parts.push(exam.type);
            }
            if (exam && exam.type === 'reading' && exam.frequency) {
                parts.push(formatFrequencyLabel(exam.frequency));
            }
            if (exam && exam.type === 'reading') {
                const difficultyLabel = formatDifficultyLabel(exam.difficultyScore);
                if (difficultyLabel) {
                    parts.push(difficultyLabel);
                }
            }
            return parts.join(' | ');
        };
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getCustomSuiteDraft() {
        if (global.appStateService && typeof global.appStateService.getCustomSuiteDraft === 'function') {
            return global.appStateService.getCustomSuiteDraft();
        }
        if (typeof global.getCustomSuiteDraftState === 'function') {
            return global.getCustomSuiteDraftState();
        }
        return global.customSuiteDraft || null;
    }

    function isCustomSuiteSelectionActive() {
        const draft = getCustomSuiteDraft();
        return !!draft && draft.status && draft.status !== 'idle';
    }

    function getCustomSuiteCategories() {
        return ['P1', 'P2', 'P3'];
    }

    function normalizeExamCategory(exam) {
        return String(exam && exam.category || '').trim().toUpperCase();
    }

    function buildCustomSuiteEntry(exam) {
        if (!exam || typeof exam !== 'object') {
            return null;
        }
        return {
            examId: String(exam.id == null ? '' : exam.id),
            title: exam.title || '',
            category: normalizeExamCategory(exam),
            frequency: exam.frequency || '',
            type: exam.type || 'reading'
        };
    }

    function getCustomSuiteCurrentCategory(draft) {
        const categories = Array.isArray(draft && draft.categories) && draft.categories.length
            ? draft.categories
            : getCustomSuiteCategories();
        const stageIndex = Number.isInteger(draft && draft.stageIndex) ? draft.stageIndex : 0;
        if (!draft || draft.status === 'ready' || stageIndex >= categories.length) {
            return null;
        }
        return categories[Math.max(0, stageIndex)] || null;
    }

    function findExamById(examId, examIndex) {
        const list = Array.isArray(examIndex) ? examIndex : [];
        return list.find((item) => item && String(item.id) === String(examId)) || null;
    }

    function isReadingMemorizeBrowseMode() {
        return global.__readingMemorizeBrowseMode === true
            || String(global.__browseMemorizeFilterMode || '') === 'reading-memorize';
    }

    function clearReadingMemorizeBrowseMode() {
        if (typeof global.setReadingMemorizeBrowseMode === 'function') {
            global.setReadingMemorizeBrowseMode(false);
        } else {
            global.__readingMemorizeBrowseMode = false;
        }
        global.__browseMemorizeFilterMode = null;
        if (typeof global.syncReadingMemorizeBrowseModeUI === 'function') {
            global.syncReadingMemorizeBrowseModeUI();
        }
    }

    function isReadingMemorizeExam(exam) {
        if (global.isReadingMemorizeCandidate && global.isReadingMemorizeCandidate !== isReadingMemorizeExam) {
            try {
                return global.isReadingMemorizeCandidate(exam) === true;
            } catch (_) {
                // fallback below
            }
        }
        if (!exam || !exam.id) {
            return false;
        }
        if (exam.type && String(exam.type).toLowerCase() === 'listening') {
            return false;
        }
        if (String(exam.id).toLowerCase().indexOf('listening-') === 0) {
            return false;
        }
        if (exam.hasHtml === false) {
            return false;
        }
        const manifest = global.__READING_EXAM_MANIFEST__;
        const entry = manifest && manifest[exam.id];
        return !!(entry && entry.script);
    }

    function filterReadingMemorizeExams(exams) {
        return (Array.isArray(exams) ? exams : []).filter(isReadingMemorizeExam);
    }

    async function launchReadingMemorizeExam(examId, examIndex = null) {
        const list = Array.isArray(examIndex)
            ? examIndex
            : await global.resolveActiveLibraryIndex();
        const exam = findExamById(examId, list);
        if (!isReadingMemorizeExam(exam)) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('该题目无法使用统一阅读页背题，请选择有 HTML 数据的阅读题。', 'warning');
            }
            return;
        }
        const launchOptions = {
            practiceMode: 'memorize',
            target: 'tab',
            windowName: 'ielts-reading-memorize'
        };
        if (typeof global.syncReadingMemorizeBrowseModeUI === 'function') {
            global.syncReadingMemorizeBrowseModeUI();
        }
        if (global.app && typeof global.app.openExam === 'function') {
            global.app.openExam(examId, launchOptions);
            return;
        }
        if (typeof global.openExam === 'function') {
            global.openExam(examId, launchOptions);
            return;
        }
        if (global.AppActions && typeof global.AppActions.openExamWithFallback === 'function') {
            global.AppActions.openExamWithFallback(exam, 0, launchOptions);
            return;
        }
        if (typeof global.showMessage === 'function') {
            global.showMessage('打开阅读背题失败，题目启动模块未就绪。', 'error');
        }
    }

    function ensureCustomSuiteSelectionPortal() {
        if (typeof document === 'undefined' || !document.body) {
            return null;
        }
        let portal = document.getElementById('custom-suite-selection-portal');
        if (portal) {
            return portal;
        }
        portal = document.createElement('div');
        portal.id = 'custom-suite-selection-portal';
        portal.className = 'suite-custom-selection-portal';
        document.body.appendChild(portal);
        return portal;
    }

    function clampCustomSuitePanelPosition(x, y, width, height) {
        const viewportWidth = Math.max(
            document.documentElement ? document.documentElement.clientWidth : 0,
            global.innerWidth || 0
        );
        const viewportHeight = Math.max(
            document.documentElement ? document.documentElement.clientHeight : 0,
            global.innerHeight || 0
        );
        const maxX = Math.max(CUSTOM_SUITE_PANEL_MARGIN, viewportWidth - width - CUSTOM_SUITE_PANEL_MARGIN);
        const maxY = Math.max(CUSTOM_SUITE_PANEL_MARGIN, viewportHeight - height - CUSTOM_SUITE_PANEL_MARGIN);
        return {
            x: Math.min(Math.max(CUSTOM_SUITE_PANEL_MARGIN, x), maxX),
            y: Math.min(Math.max(CUSTOM_SUITE_PANEL_MARGIN, y), maxY)
        };
    }

    function applyCustomSuitePanelFloatingState(portal) {
        if (!portal || !customSuitePortalPosition) {
            return;
        }
        const panel = portal.querySelector('.suite-custom-selection__panel');
        if (!panel) {
            return;
        }
        const rect = panel.getBoundingClientRect();
        const width = rect.width || panel.offsetWidth || 380;
        const height = rect.height || panel.offsetHeight || 420;
        const clamped = clampCustomSuitePanelPosition(
            customSuitePortalPosition.x,
            customSuitePortalPosition.y,
            width,
            height
        );
        customSuitePortalPosition = clamped;
        panel.classList.add('suite-custom-selection__panel--floating');
        panel.style.left = clamped.x + 'px';
        panel.style.top = clamped.y + 'px';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
    }

    function setupCustomSuitePanelDrag(portal) {
        if (!portal) {
            return;
        }
        const panel = portal.querySelector('.suite-custom-selection__panel');
        const header = panel ? panel.querySelector('.suite-custom-selection__header') : null;
        if (!panel || !header || panel.dataset.dragEnabled === 'true') {
            return;
        }
        panel.dataset.dragEnabled = 'true';

        let dragging = false;
        let pointerId = null;
        let originX = 0;
        let originY = 0;
        let startX = 0;
        let startY = 0;

        const handlePointerMove = (event) => {
            if (!dragging || pointerId !== event.pointerId) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            const width = rect.width || panel.offsetWidth || 380;
            const height = rect.height || panel.offsetHeight || 420;
            const nextX = originX + (event.clientX - startX);
            const nextY = originY + (event.clientY - startY);
            const clamped = clampCustomSuitePanelPosition(nextX, nextY, width, height);
            customSuitePortalPosition = clamped;
            panel.style.left = clamped.x + 'px';
            panel.style.top = clamped.y + 'px';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
        };

        const stopDragging = (event) => {
            if (!dragging || (event && pointerId !== event.pointerId)) {
                return;
            }
            dragging = false;
            pointerId = null;
            panel.classList.remove('is-dragging');
            try { header.releasePointerCapture(event.pointerId); } catch (_) {}
            global.removeEventListener('pointermove', handlePointerMove);
            global.removeEventListener('pointerup', stopDragging);
            global.removeEventListener('pointercancel', stopDragging);
        };

        header.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) {
                return;
            }
            if (event.target && event.target.closest && event.target.closest('button,a,input,select,textarea,[data-action]')) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            const width = rect.width || panel.offsetWidth || 380;
            const height = rect.height || panel.offsetHeight || 420;
            const initial = clampCustomSuitePanelPosition(rect.left, rect.top, width, height);

            customSuitePortalPosition = initial;
            panel.classList.add('suite-custom-selection__panel--floating');
            panel.classList.add('is-dragging');
            panel.style.left = initial.x + 'px';
            panel.style.top = initial.y + 'px';
            panel.style.right = 'auto';
            panel.style.transform = 'none';

            dragging = true;
            pointerId = event.pointerId;
            originX = initial.x;
            originY = initial.y;
            startX = event.clientX;
            startY = event.clientY;

            try { header.setPointerCapture(pointerId); } catch (_) {}
            global.addEventListener('pointermove', handlePointerMove);
            global.addEventListener('pointerup', stopDragging);
            global.addEventListener('pointercancel', stopDragging);
            event.preventDefault();
        });
    }

    function hideCustomSuiteSelectionPortal() {
        if (typeof document === 'undefined') {
            return;
        }
        const portal = document.getElementById('custom-suite-selection-portal');
        if (portal && portal.parentNode) {
            portal.parentNode.removeChild(portal);
        }
        customSuitePortalPosition = null;
    }

    function renderCustomSuiteSelectionPortal() {
        const draft = getCustomSuiteDraft();
        if (!draft || draft.status === 'idle') {
            hideCustomSuiteSelectionPortal();
            return;
        }

        const portal = ensureCustomSuiteSelectionPortal();
        if (!portal) {
            return;
        }

        const categories = Array.isArray(draft.categories) && draft.categories.length
            ? draft.categories
            : getCustomSuiteCategories();
        const pickedByCategory = draft.pickedByCategory && typeof draft.pickedByCategory === 'object'
            ? draft.pickedByCategory
            : {};
        const selectedCount = Array.isArray(draft.pickedOrder) ? draft.pickedOrder.length : 0;
        const isReady = draft.status === 'ready' || selectedCount >= categories.length;
        const currentCategory = getCustomSuiteCurrentCategory(draft);
        const selectedRows = categories.map((category) => {
            const entry = pickedByCategory[category];
            if (!entry) {
                return null;
            }
            return {
                category,
                title: entry.title || '未命名题目',
                frequency: entry.frequency || '未知频率'
            };
        }).filter(Boolean);

        const pendingRows = categories
            .filter((category) => !pickedByCategory[category])
            .map((category) => ({
                category,
                title: category === currentCategory ? '请选择当前题型' : '待选中',
                frequency: '待选'
            }));

        const rowMarkup = (row, includeDelete) => {
            const deleteMarkup = includeDelete
                ? '<button type="button" class="suite-custom-selection__delete" data-action="suite-custom-delete" data-category="' + escapeHtml(row.category) + '" aria-label="删除 ' + escapeHtml(row.category) + '">删除</button>'
                : '';
            return [
                '<div class="suite-custom-selection__row' + (includeDelete ? ' suite-custom-selection__row--selected' : ' suite-custom-selection__row--pending') + '">',
                '<div class="suite-custom-selection__row-main">',
                '<span class="suite-custom-selection__title">' + escapeHtml(row.title) + '</span>',
                '<span class="suite-custom-selection__meta">' + escapeHtml(row.category) + '</span>',
                '<span class="suite-custom-selection__meta">' + escapeHtml(row.frequency) + '</span>',
                '</div>',
                deleteMarkup,
                '</div>'
            ].join('');
        };

        const footerButtons = isReady
            ? [
                '<button type="button" class="suite-custom-selection__button suite-custom-selection__button--primary" data-action="suite-custom-confirm">确认开始</button>',
                '<button type="button" class="suite-custom-selection__button suite-custom-selection__button--secondary" data-action="suite-custom-cancel">取消</button>'
            ].join('')
            : '<button type="button" class="suite-custom-selection__button suite-custom-selection__button--secondary" data-action="suite-custom-cancel">取消</button>';

        const selectedMarkup = selectedRows.length
            ? selectedRows.map((row) => rowMarkup(row, true)).join('')
            : '<div class="suite-custom-selection__empty">尚未选择题目</div>';
        const pendingMarkup = pendingRows.length
            ? pendingRows.map((row) => rowMarkup(row, false)).join('')
            : '';

        portal.innerHTML = [
            '<div class="suite-custom-selection__backdrop" aria-hidden="true"></div>',
            '<section class="suite-custom-selection__panel' + (isReady ? ' suite-custom-selection__panel--ready' : ' suite-custom-selection__panel--dock') + '" aria-live="polite">',
            '<header class="suite-custom-selection__header">',
            '<div>',
            '<p class="suite-custom-selection__eyebrow">套题自选</p>', 
            '<h3 class="suite-custom-selection__title-main">' + (isReady ? '确认开始或取消' : '继续选择下一题型') + '</h3>', 
            '</div>',
            '<div class="suite-custom-selection__progress">' + selectedCount + ' / ' + categories.length + '</div>',
            '</header>',
            '<div class="suite-custom-selection__body">',
            '<div class="suite-custom-selection__group">',
            '<div class="suite-custom-selection__group-title">已选</div>', 
            selectedMarkup,
            '</div>',
            '<div class="suite-custom-selection__group">',
            '<div class="suite-custom-selection__group-title">待选</div>',
            pendingMarkup || '<div class="suite-custom-selection__empty">暂无待选项</div>',
            '</div>',
            '</div>',
            '<footer class="suite-custom-selection__footer">',
            footerButtons,
            '</footer>',
            '</section>'
        ].join('');
        setupCustomSuitePanelDrag(portal);
        applyCustomSuitePanelFloatingState(portal);
    }

    function refreshCustomSuiteSelectionPortal() {
        if (isCustomSuiteSelectionActive()) {
            renderCustomSuiteSelectionPortal();
        } else {
            hideCustomSuiteSelectionPortal();
        }
    }

    async function handleCustomSuiteSelect(examId, examIndex = null) {
        const draft = getCustomSuiteDraft();
        if (!draft || draft.status === 'ready') {
            return false;
        }

        const list = Array.isArray(examIndex)
            ? examIndex
            : await global.resolveActiveLibraryIndex();
        const exam = findExamById(examId, list);
        if (!exam) {
            return false;
        }

        const currentCategory = getCustomSuiteCurrentCategory(draft);
        const examCategory = normalizeExamCategory(exam);
        if (currentCategory && examCategory && currentCategory !== examCategory) {
            return false;
        }

        const service = global.appStateService;
        let updatedDraft = null;
        if (service && typeof service.selectCustomSuiteExam === 'function') {
            updatedDraft = service.selectCustomSuiteExam(exam, {
                flowMode: draft.flowMode || 'classic',
                frequencyScope: draft.frequencyScope || 'custom'
            });
        } else if (typeof global.selectCustomSuiteExamState === 'function') {
            updatedDraft = global.selectCustomSuiteExamState(exam, {
                flowMode: draft.flowMode || 'classic',
                frequencyScope: draft.frequencyScope || 'custom'
            });
        }

        if (!updatedDraft) {
            return false;
        }

        if (updatedDraft.status === 'ready') {
            renderCustomSuiteSelectionPortal();
            return true;
        }

        const nextCategory = getCustomSuiteCurrentCategory(updatedDraft);
        if (nextCategory && typeof global.browseCategory === 'function') {
            global.browseCategory(nextCategory, 'reading');
        } else {
            renderCustomSuiteSelectionPortal();
        }

        return true;
    }

    function handleCustomSuiteDelete(category) {
        const normalizedCategory = String(category || '').trim().toUpperCase();
        if (!normalizedCategory) {
            return false;
        }

        const service = global.appStateService;
        let updatedDraft = null;
        if (service && typeof service.removeCustomSuiteSelection === 'function') {
            updatedDraft = service.removeCustomSuiteSelection(normalizedCategory);
        } else if (typeof global.removeCustomSuiteSelectionState === 'function') {
            updatedDraft = global.removeCustomSuiteSelectionState(normalizedCategory);
        }

        if (!updatedDraft) {
            return false;
        }

        const nextCategory = getCustomSuiteCurrentCategory(updatedDraft);
        if (nextCategory && typeof global.browseCategory === 'function') {
            global.browseCategory(nextCategory, 'reading');
        } else {
            refreshCustomSuiteSelectionPortal();
        }

        return true;
    }

    function handleCustomSuiteConfirm() {
        if (global.app && typeof global.app.confirmCustomSuiteSelection === 'function') {
            return global.app.confirmCustomSuiteSelection();
        }
        if (typeof global.confirmCustomSuiteSelectionState === 'function') {
            return global.confirmCustomSuiteSelectionState();
        }
        return false;
    }

    function handleCustomSuiteCancel() {
        if (global.app && typeof global.app.cancelCustomSuiteSelection === 'function') {
            return global.app.cancelCustomSuiteSelection();
        }
        if (typeof global.clearCustomSuiteDraftState === 'function') {
            global.clearCustomSuiteDraftState();
        }
        refreshCustomSuiteSelectionPortal();
        if (typeof global.resetBrowseViewToAll === 'function') {
            global.resetBrowseViewToAll();
        }
        return true;
    }

   // 核心功能：加载与渲染
   
    /**
     * 加载并渲染题库列表
     */
    function loadExamList(examIndex = []) {
        console.log('[ExamActions] loadExamList called');

        if (typeof global.setupBrowseControls === 'function') {
            try {
                global.setupBrowseControls();
            } catch (error) {
                console.warn('[ExamActions] 浏览控件绑定失败:', error);
            }
        }

        const memorizeSelectionActive = isReadingMemorizeBrowseMode();
        if (typeof global.syncReadingMemorizeBrowseModeUI === 'function') {
            global.syncReadingMemorizeBrowseModeUI();
        }

        // 1. 频率模式委托给 BrowseController
        if (!memorizeSelectionActive && global.__browseFilterMode && global.__browseFilterMode !== 'default' && global.browseController) {
            try {
                if (!global.browseController.buttonContainer) {
                    global.browseController.initialize('type-filter-buttons', examIndex);
                }
                if (global.browseController.currentMode !== global.__browseFilterMode) {
                    global.browseController.setMode(global.__browseFilterMode, examIndex);
                } else {
                    const activeFilter = global.browseController.activeFilter || 'all';
                    global.browseController.applyFilter(activeFilter, examIndex);
                }
                return;
            } catch (error) {
                console.warn('[Browse] 频率模式刷新失败，回退到默认逻辑:', error);
            }
        }

        // 2. 使用控制器边界传入的本次题库快照。
        const examIndexSnapshot = Array.isArray(examIndex) ? examIndex : [];

        // 3. 获取筛选条件
        let activeCategory = 'all';
        let activeExamType = 'all';

        if (global.browseController) {
            activeCategory = global.browseController.getCurrentCategory();
            activeExamType = global.browseController.getCurrentExamType();
        } else {
            // 降级支持
            activeCategory = typeof global.getCurrentCategory === 'function' ? global.getCurrentCategory() : 'all';
            activeExamType = typeof global.getCurrentExamType === 'function' ? global.getCurrentExamType() : 'all';
        }

        const normalizedFilter = normalizeUnavailableListeningFilter(activeCategory, activeExamType, examIndexSnapshot);
        activeCategory = normalizedFilter.activeCategory;
        activeExamType = normalizedFilter.activeExamType;
        if (memorizeSelectionActive) {
            activeCategory = 'all';
            activeExamType = 'reading';
            global.__browseFilterMode = 'default';
            global.__browsePath = null;
            if (global.browseController) {
                global.browseController.currentMode = 'default';
                global.browseController.activeFilter = 'reading';
            }
            if (typeof global.setBrowseFilterState === 'function') {
                global.setBrowseFilterState('all', 'reading');
            }
        }

        // 4. 执行筛选
        // 仅在频率模式下使用 basePath 过滤
        const isFrequencyMode = global.__browseFilterMode && global.__browseFilterMode !== 'default';
        const basePathFilter = isFrequencyMode && (typeof global.__browsePath === 'string' && global.__browsePath.trim())
            ? global.__browsePath.trim()
            : null;

        let examsToShow = filterExamsWithLegacyFallback(examIndexSnapshot, {
            activeCategory,
            activeExamType,
            browseFilterMode: global.__browseFilterMode,
            basePathFilter,
            browsePath: global.__browsePath,
            sortMode: global.__browseSortMode,
            preferredFirstExamByCategory
        });
        if (memorizeSelectionActive) {
            examsToShow = filterReadingMemorizeExams(examsToShow);
            if (typeof global.setBrowseTitle === 'function') {
                global.setBrowseTitle('阅读背题选题');
            }
        }
        const customSuiteDraft = getCustomSuiteDraft();
        const selectionMode = memorizeSelectionActive
            ? 'reading-memorize'
            : (isCustomSuiteSelectionActive() ? 'custom-suite' : '');

        // 6. 更新状态并渲染
        if (global.appStateService) {
            global.appStateService.setFilteredExams(examsToShow);
        } else if (typeof global.setFilteredExamsState === 'function') {
            global.setFilteredExamsState(examsToShow);
        }

        displayExams(examsToShow, {
            selectionMode,
            customSuiteDraft
        });
        refreshCustomSuiteSelectionPortal();

        // 7. 触发渲染后钩子
        if (typeof global.handlePostExamListRender === 'function') {
            global.handlePostExamListRender(examsToShow, { category: activeCategory, type: activeExamType });
        }

        return examsToShow;
    }

    let browseResetInteractionId = 0;

    function isBrowseResetCurrent(interactionId, renderRequestId) {
        if (interactionId !== browseResetInteractionId) {
            return false;
        }
        return renderRequestId == null
            || typeof global.__isBrowseResultsRequestCurrent !== 'function'
            || global.__isBrowseResultsRequestCurrent(renderRequestId);
    }

    function clearBrowseSearchUI() {
        if (global.browseStateManager && typeof global.browseStateManager.clearSearchState === 'function') {
            global.browseStateManager.clearSearchState();
            return;
        }
        const searchInput = document.getElementById('exam-search-input')
            || document.querySelector('.search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        const clearButton = document.getElementById('search-clear-btn');
        if (clearButton) {
            clearButton.hidden = true;
        }
    }

    function syncBrowseFilterUI(examIndex) {
        const controller = global.browseController;
        if (controller) {
            controller.currentMode = 'default';
            controller.activeFilter = 'all';
            if (typeof controller.renderFilterButtons === 'function') {
                controller.renderFilterButtons(Array.isArray(examIndex) ? examIndex : []);
            }
        }

        const typeContainer = document.getElementById('type-filter-buttons');
        if (typeContainer && typeof typeContainer.querySelectorAll === 'function') {
            typeContainer.querySelectorAll('.shui-segmented-btn').forEach((button) => {
                const filterId = button.dataset && (button.dataset.filterId || button.dataset.filterType);
                const active = filterId === 'all';
                if (button.classList && typeof button.classList.toggle === 'function') {
                    button.classList.toggle('active', active);
                }
                if (typeof button.setAttribute === 'function') {
                    button.setAttribute('aria-pressed', active ? 'true' : 'false');
                }
            });
        }

        global.__browseFrequencyFilter = 'all';
        if (typeof global.updateBrowseFrequencyButtons === 'function') {
            global.updateBrowseFrequencyButtons('all');
        } else {
            const frequencyContainer = document.getElementById('browse-frequency-filter-buttons');
            if (frequencyContainer && typeof frequencyContainer.querySelectorAll === 'function') {
                frequencyContainer.querySelectorAll('[data-frequency-filter]').forEach((button) => {
                    if (button.classList && typeof button.classList.remove === 'function') {
                        button.classList.remove('active');
                    }
                    if (typeof button.setAttribute === 'function') {
                        button.setAttribute('aria-pressed', 'false');
                    }
                });
            }
        }
    }

    async function prepareBrowseReset() {
        const pending = [];
        const manager = global.browseStateManager;
        if (manager && manager.ready && typeof manager.ready.then === 'function') {
            pending.push(Promise.resolve(manager.ready).catch((error) => {
                console.warn('[ExamActions] 等待浏览状态恢复失败:', error);
            }));
        }
        if (typeof global.setupBrowseControls === 'function') {
            pending.push(Promise.resolve().then(() => global.setupBrowseControls()).catch((error) => {
                console.warn('[ExamActions] 初始化浏览筛选控件失败:', error);
            }));
        }
        if (pending.length > 0) {
            await Promise.all(pending);
        }
    }

    async function persistBrowseFrequencyReset() {
        const preferences = global.AppData && global.AppData.preferences;
        if (!preferences || typeof preferences.patchBrowse !== 'function') {
            return;
        }
        try {
            await preferences.patchBrowse({ frequencyFilter: 'all' });
        } catch (error) {
            console.warn('[ExamActions] 持久化浏览频率重置失败:', error);
        }
    }

    function beginBrowseResetPersistence() {
        const pending = [persistBrowseFrequencyReset()];
        if (typeof global.flushBrowsePreferenceWrites === 'function') {
            pending.push(Promise.resolve().then(() => global.flushBrowsePreferenceWrites()).catch((error) => {
                console.warn('[ExamActions] 等待浏览筛选偏好写入失败:', error);
            }));
        }
        return Promise.all(pending);
    }

    function applyBrowseResetState(examIndex) {
        clearReadingMemorizeBrowseMode();
        global.__browseFilterMode = 'default';
        global.__browsePath = null;

        if (global.browseStateManager && typeof global.browseStateManager.resetToAllExams === 'function') {
            global.browseStateManager.resetToAllExams();
        } else {
            if (typeof global.setBrowseFilterState === 'function') {
                global.setBrowseFilterState('all', 'all');
            }
            clearBrowseSearchUI();
        }

        syncBrowseFilterUI(examIndex);
        if (typeof global.setBrowseTitle === 'function') {
            global.setBrowseTitle('题库列表');
        }
    }

    /**
     * 重置浏览视图。先解析活动题库快照，再一次性更新 UI/状态并交给
     * 全局 loadExamList 适配器渲染，避免 IIFE 内部默认 [] 覆盖列表。
     */
    async function performBrowseViewResetToAll() {
        const interactionId = ++browseResetInteractionId;
        if (global.__pendingBrowseFilter) {
            delete global.__pendingBrowseFilter;
        }
        const renderRequestId = typeof global.__beginBrowseResultsRequest === 'function'
            ? global.__beginBrowseResultsRequest()
            : null;

        if (global.browseController) {
            if (typeof global.browseController.filterInteractionId === 'number') {
                global.browseController.filterInteractionId += 1;
            }
            if (typeof global.browseController.clearPendingBrowseAutoScroll === 'function') {
                global.browseController.clearPendingBrowseAutoScroll();
            }
        } else if (typeof global.clearPendingBrowseAutoScroll === 'function') {
            global.clearPendingBrowseAutoScroll();
        }

        const resolver = typeof global.resolveActiveLibraryIndex === 'function'
            ? global.resolveActiveLibraryIndex
            : global.resolveActiveExamIndex;
        const indexPromise = typeof resolver === 'function'
            ? Promise.resolve().then(() => resolver.call(global)).then((resolved) => (
                Array.isArray(resolved) ? resolved : null
            )).catch((error) => {
                console.warn('[ExamActions] 重置浏览视图时无法预取活动题库:', error);
                return null;
            })
            : Promise.resolve(null);
        const [examIndex] = await Promise.all([
            indexPromise,
            prepareBrowseReset()
        ]);

        if (!isBrowseResetCurrent(interactionId, renderRequestId)) {
            return false;
        }

        applyBrowseResetState(examIndex);

        const globalLoader = global.loadExamList;
        if (typeof globalLoader === 'function' && globalLoader !== loadExamList) {
            // 空索引也交由适配器自行解析；绝不把 [] 当作重置结果渲染。
            const indexOverride = Array.isArray(examIndex) && examIndex.length > 0 ? examIndex : null;
            let renderPromise;
            try {
                renderPromise = Promise.resolve(globalLoader.call(global, indexOverride, renderRequestId));
            } catch (error) {
                renderPromise = Promise.reject(error);
            }
            const persistencePromise = beginBrowseResetPersistence();
            try {
                const result = await renderPromise;
                if (!isBrowseResetCurrent(interactionId, renderRequestId)) {
                    await persistencePromise;
                    return false;
                }
                if ((!Array.isArray(examIndex) || examIndex.length === 0)
                    && Array.isArray(result)) {
                    syncBrowseFilterUI(result);
                }
                await persistencePromise;
                if (!isBrowseResetCurrent(interactionId, renderRequestId)) {
                    return false;
                }
                return result;
            } catch (error) {
                console.warn('[ExamActions] 重置浏览视图加载失败:', error);
                await persistencePromise;
                return false;
            }
        }

        if (Array.isArray(examIndex) && examIndex.length > 0) {
            const result = loadExamList(examIndex);
            await beginBrowseResetPersistence();
            return result;
        }

        await beginBrowseResetPersistence();
        console.warn('[ExamActions] 全局题库加载适配器不可用，已跳过空数组渲染');
        return false;
    }

    async function resetBrowseViewToAll() {
        try {
            return await performBrowseViewResetToAll();
        } catch (error) {
            console.warn('[ExamActions] 重置浏览视图失败:', error);
            return false;
        }
    }

    /**
     * 渲染题库列表 DOM
     */
    function displayExams(exams, options = {}) {
        const effectiveOptions = Object.assign({}, options || {});
        if (!effectiveOptions.selectionMode && isReadingMemorizeBrowseMode()) {
            effectiveOptions.selectionMode = 'reading-memorize';
        }
        const renderExams = effectiveOptions.selectionMode === 'reading-memorize'
            ? filterReadingMemorizeExams(exams)
            : exams;
        // 1. 尝试使用 BrowseController 管理的 examListViewInstance
        let view = null;
        if (global.browseController && typeof global.browseController.getExamListView === 'function') {
            view = global.browseController.getExamListView();
            // 确保 LegacyExamListView 能被创建（初始值为 null）
            if (!view && typeof global.browseController.ensureExamListView === 'function') {
                view = global.browseController.ensureExamListView();
            }
        }

        if (!view && global.BrowseController && typeof global.BrowseController.getExamListView === 'function') {
            view = global.BrowseController.getExamListView();
        }

        if (!view && global.ensureExamListView) {
            view = global.ensureExamListView();
        }

        if (view) {
            view.render(renderExams, {
                loadingSelector: '#browse-view .loading',
                selectionMode: effectiveOptions.selectionMode || '',
                customSuiteDraft: effectiveOptions.customSuiteDraft || null
            });
            setupExamActionHandlers();
            return;
        }

        // 2. 降级：直接 DOM 操作 (从 main.js 迁移)
        const container = document.getElementById('exam-list-container');
        if (!container) {
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        // 清除 loading 指示器
        const loadingEl = document.querySelector('#browse-view .loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }

        const normalizedExams = Array.isArray(renderExams) ? renderExams : [];
        if (normalizedExams.length === 0) {
            renderEmptyState(container);
            return;
        }

        const list = document.createElement('div');
        list.className = 'exam-list';

        normalizedExams.forEach((exam) => {
            if (!exam) return;
            const item = createExamCard(exam, effectiveOptions);
            list.appendChild(item);
        });

        container.appendChild(list);
        setupExamActionHandlers();
    }

    /**
     * 渲染空状态
     */
    function renderEmptyState(container) {
        const empty = document.createElement('div');
        empty.className = 'exam-list-empty';
        empty.setAttribute('role', 'status');

        const icon = document.createElement('div');
        icon.className = 'exam-list-empty-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🔍';

        const text = document.createElement('p');
        text.className = 'exam-list-empty-text';
        text.textContent = '未找到匹配的题目';

        const hint = document.createElement('p');
        hint.className = 'exam-list-empty-hint';
        hint.textContent = '请调整筛选条件或搜索词后再试';

        empty.appendChild(icon);
        empty.appendChild(text);
        empty.appendChild(hint);
        container.appendChild(empty);
    }

    /**
     * 创建单个题库卡片
     */
    function createExamCard(exam, options = {}) {
        const selectionMode = options.selectionMode || (isCustomSuiteSelectionActive() ? 'custom-suite' : '');
        const draft = options.customSuiteDraft || getCustomSuiteDraft();
        const currentCategory = getCustomSuiteCurrentCategory(draft);
        const examCategory = normalizeExamCategory(exam);
        const isSelecting = selectionMode === 'custom-suite' && !!draft && draft.status !== 'ready';
        const isMemorizeSelecting = selectionMode === 'reading-memorize';
        const isSelected = !!draft && draft.pickedByCategory && draft.pickedByCategory[examCategory]
            && String(draft.pickedByCategory[examCategory].examId) === String(exam.id);
        const item = document.createElement('div');
        item.className = 'exam-item'
            + (isSelecting ? ' exam-item--suite-selecting' : '')
            + (isMemorizeSelecting ? ' exam-item--memorize-selecting' : '')
            + (isSelected ? ' exam-item--suite-selected' : '');
        if (exam.id) {
            item.dataset.examId = exam.id;
        }
        if (isSelecting) {
            item.dataset.action = 'suite-custom-select';
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
        }

        const info = document.createElement('div');
        info.className = 'exam-info';
        const infoContent = document.createElement('div');
        const title = document.createElement('h4');
        title.textContent = exam.title || '';
        const meta = document.createElement('div');
        meta.className = 'exam-meta';

        let metaText = '';
        if (typeof global.formatExamMetaText === 'function') {
            metaText = global.formatExamMetaText(exam);
        } else {
            metaText = `${exam.category || ''} | ${exam.type || ''}`;
        }

        meta.textContent = metaText;
        infoContent.appendChild(title);
        infoContent.appendChild(meta);
        info.appendChild(infoContent);

        if (isSelecting && currentCategory) {
            const selectBadge = document.createElement('div');
            selectBadge.className = 'suite-custom-selection-badge';
            selectBadge.textContent = `${currentCategory} 待选`;
            info.appendChild(selectBadge);
        }
        if (isMemorizeSelecting) {
            const selectBadge = document.createElement('div');
            selectBadge.className = 'suite-custom-selection-badge';
            selectBadge.textContent = '背题模式';
            info.appendChild(selectBadge);
        }

        const actions = document.createElement('div');
        actions.className = 'exam-actions';

        if (isMemorizeSelecting) {
            const selectBtn = document.createElement('button');
            selectBtn.className = 'btn exam-item-action-btn';
            selectBtn.type = 'button';
            selectBtn.dataset.action = 'reading-memorize-select';
            if (exam.id) {
                selectBtn.dataset.examId = exam.id;
            }
            selectBtn.textContent = '选择背题';
            actions.appendChild(selectBtn);
            item.appendChild(info);
            item.appendChild(actions);
            return item;
        }

        const startBtn = document.createElement('button');
        startBtn.className = 'btn exam-item-action-btn';
        startBtn.type = 'button';
        startBtn.dataset.action = 'start';
        if (exam.id) {
            startBtn.dataset.examId = exam.id;
        }
        startBtn.textContent = '开始练习';
        if (isSelecting) {
            startBtn.disabled = true;
            startBtn.setAttribute('aria-disabled', 'true');
        }
        actions.appendChild(startBtn);

        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'btn btn-outline exam-item-action-btn';
        pdfBtn.type = 'button';
        pdfBtn.dataset.action = 'pdf';
        if (exam.id) {
            pdfBtn.dataset.examId = exam.id;
        }
        pdfBtn.textContent = 'PDF';
        if (isSelecting) {
            pdfBtn.disabled = true;
            pdfBtn.setAttribute('aria-disabled', 'true');
        }
        actions.appendChild(pdfBtn);

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    }

    // ============================================================================
    // 事件处理与工具
    // ============================================================================

    var examActionHandlersConfigured = false;

    function setupExamActionHandlers() {
        if (examActionHandlersConfigured) {
            return;
        }

        var invoke = function (target, event) {
            var action = target.dataset.action;
            var examId = target.dataset.examId;
            var category = target.dataset.category || target.dataset.examCategory || '';

            if (!action) {
                return;
            }

            event.preventDefault();

            if (action === 'suite-custom-select') {
                handleCustomSuiteSelect(examId);
                return;
            }

            if (action === 'suite-custom-delete') {
                handleCustomSuiteDelete(category);
                return;
            }

            if (action === 'suite-custom-confirm') {
                handleCustomSuiteConfirm();
                return;
            }

            if (action === 'suite-custom-cancel') {
                handleCustomSuiteCancel();
                return;
            }

            if (!examId) {
                return;
            }

            if (action === 'reading-memorize-select') {
                launchReadingMemorizeExam(examId);
                return;
            }

            if (action === 'start') {
                if (global.app && typeof global.app.openExam === 'function') {
                    global.app.openExam(examId);
                    return;
                }
                if (typeof global.openExam === 'function') {
                    global.openExam(examId);
                }
                return;
            }

            if (action === 'pdf' && typeof global.viewPDF === 'function') {
                global.viewPDF(examId);
                return;
            }

            if (action === 'generate' && typeof global.generateHTML === 'function') {
                global.generateHTML(examId);
            }
        };

        var hasDomDelegate = typeof global !== 'undefined'
            && global.DOM
            && typeof global.DOM.delegate === 'function';

        var invokeCustomSuiteSelectionFromKeyboard = function (target, event) {
            if (!event || event.repeat || (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar')) {
                return;
            }
            invoke(target, event);
        };

        if (hasDomDelegate) {
            global.DOM.delegate('click', '[data-action="start"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="pdf"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="generate"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="suite-custom-select"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('keydown', '[data-action="suite-custom-select"]', function (event) {
                invokeCustomSuiteSelectionFromKeyboard(this, event);
            });
            global.DOM.delegate('click', '[data-action="suite-custom-delete"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="suite-custom-confirm"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="suite-custom-cancel"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="reading-memorize-select"]', function (event) {
                invoke(this, event);
            });
        } else if (typeof document !== 'undefined') {
            document.addEventListener('click', function (event) {
                var target = event.target.closest('[data-action]');
                if (!target) {
                    return;
                }

                var container = document.getElementById('exam-list-container');
                if (container && !container.contains(target) && !document.getElementById('custom-suite-selection-portal')?.contains(target)) {
                    return;
                }

                invoke(target, event);
            });
            document.addEventListener('keydown', function (event) {
                var target = event.target && event.target.closest
                    ? event.target.closest('[data-action="suite-custom-select"]')
                    : null;
                if (!target) {
                    return;
                }

                var container = document.getElementById('exam-list-container');
                if (container && !container.contains(target)) {
                    return;
                }

                invokeCustomSuiteSelectionFromKeyboard(target, event);
            });
        }

        examActionHandlersConfigured = true;
        try { console.log('[ExamActions] 考试操作按钮事件委托已设置'); } catch (_) { }
    }
    function ensureBrowseGroupReady() {
        if (typeof global.ensureBrowseGroup === 'function') {
            return global.ensureBrowseGroup();
        }
        if (global.AppEntry && typeof global.AppEntry.ensureBrowseGroup === 'function') {
            return global.AppEntry.ensureBrowseGroup();
        }
        if (global.AppLazyLoader && typeof global.AppLazyLoader.ensureGroup === 'function') {
            return global.AppLazyLoader.ensureGroup('browse-view');
        }
        return Promise.resolve();
    }

    async function exportPracticeData() {
        try {
            var snapshot = await global.AppData.backups.export({ domains: ['practice'] });
            var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json; charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = 'ielts-atlas-practice-v2.json';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            try { global.showMessage && global.showMessage('导出完成', 'success'); } catch (_) { }
        } catch (e) {
            try { global.showMessage && global.showMessage('导出失败: ' + (e && e.message || e), 'error'); } catch (_) { }
            console.error('[Export] failed', e);
        }
    }

    async function exportAllData() {
        try {
            var snapshot = await global.AppData.backups.export();
            var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json; charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'ielts-atlas-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
            document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor); URL.revokeObjectURL(url);
            try { await global.AppData.backups.recordExport({ type: 'full-v2', checksum: snapshot.checksum }); } catch (historyError) { console.warn('[ExamActions] 导出历史记录失败:', historyError); }
            try { global.showMessage && global.showMessage('数据导出成功', 'success'); } catch (_) { }
            return snapshot;
        } catch (error) {
            console.error('[ExamActions] 数据导出失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('数据导出失败: ' + (error && error.message || error), 'error');
            }
            return;
        }

        return null;
        if (typeof global.showMessage === 'function') {
            global.showMessage('Data manager module is unavailable.', 'warning');
        }
    }

    function renderExamListView(exams, options = {}) {
        if (typeof document === 'undefined') {
            return false;
        }
        const container = document.getElementById('exam-list-container');
        if (!container) {
            return false;
        }
        displayExams(exams, options);
        return true;
    }

    // ============================================================================
    // 导出到全局
    // ============================================================================

    global.ExamFilterService = Object.assign({}, global.ExamFilterService || {}, {
        filterExams: filterExamsWithLegacyFallback
    });
    global.ExamListView = Object.assign({}, global.ExamListView || {}, {
        render: renderExamListView,
        createExamCard,
        renderEmptyState
    });
    global.CustomSuiteSelection = Object.assign({}, global.CustomSuiteSelection || {}, {
        getDraft: getCustomSuiteDraft,
        isActive: isCustomSuiteSelectionActive,
        normalizeExamCategory,
        getCurrentCategory: getCustomSuiteCurrentCategory,
        render: renderCustomSuiteSelectionPortal,
        refresh: refreshCustomSuiteSelectionPortal,
        hide: hideCustomSuiteSelectionPortal,
        select: handleCustomSuiteSelect,
        remove: handleCustomSuiteDelete,
        confirm: handleCustomSuiteConfirm,
        cancel: handleCustomSuiteCancel
    });

    global.ExamActions = {
        loadExamList,
        resetBrowseViewToAll,
        displayExams,
        setupExamActionHandlers,
        exportAllData,
        exportPracticeData,
        deduplicateExams,
        applyExamSort,
        applyBrowsePostFilters,
        applyBrowseFrequencyFilter,
        normalizeBrowseFrequencyFilter,
        launchReadingMemorizeExam,
        isReadingMemorizeBrowseMode,
        isReadingMemorizeExam
    };

    // 全局 loadExamList 由 main.js 的适配器持有（无参时自解析题库索引）；
    // 此处仅通过 global.ExamActions.loadExamList 暴露，避免覆盖后无参调用拿到空数组。
    global.resetBrowseViewToAll = resetBrowseViewToAll;
    global.displayExams = displayExams;
    global.setupExamActionHandlers = setupExamActionHandlers;
    global.exportAllData = exportAllData;
    global.exportPracticeData = exportPracticeData;
    global.launchReadingMemorizeExam = launchReadingMemorizeExam;

    console.log('[ExamActions] 模块已加载 (Phase 2)');

})(typeof window !== 'undefined' ? window : this);
