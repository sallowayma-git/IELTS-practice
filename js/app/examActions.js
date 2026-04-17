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
        'very-high': 4,
        '次高频': 4,
        'high': 3,
        '高频': 3,
        'medium': 2,
        'mid': 2,
        '中频': 2,
        'low': 1,
        '低频': 1
    };

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

    function applyExamSort(exams) {
        const list = Array.isArray(exams) ? exams.slice() : [];
        const mode = String(global.__browseSortMode || 'default').trim().toLowerCase();
        if (mode !== 'frequency-desc') {
            return list;
        }
        return list.sort((a, b) => {
            const rankDiff = resolveFrequencyRank(b) - resolveFrequencyRank(a);
            if (rankDiff !== 0) {
                return rankDiff;
            }
            const categoryA = String(a && a.category || '');
            const categoryB = String(b && b.category || '');
            const categoryDiff = categoryA.localeCompare(categoryB, 'zh-Hans-CN');
            if (categoryDiff !== 0) {
                return categoryDiff;
            }
            return String(a && a.title || '').localeCompare(String(b && b.title || ''), 'zh-Hans-CN');
        });
    }

    function applyBrowsePostFilters(exams) {
        const deduplicated = deduplicateExams(exams);
        return applyExamSort(deduplicated);
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

    function findExamById(examId) {
        const list = Array.isArray(global.examIndex)
            ? global.examIndex
            : (global.appStateService && typeof global.appStateService.getExamIndex === 'function'
                ? global.appStateService.getExamIndex()
                : []);
        return Array.isArray(list)
            ? list.find((item) => item && String(item.id) === String(examId))
            : null;
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

    function hideCustomSuiteSelectionPortal() {
        if (typeof document === 'undefined') {
            return;
        }
        const portal = document.getElementById('custom-suite-selection-portal');
        if (portal && portal.parentNode) {
            portal.parentNode.removeChild(portal);
        }
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
                title: entry.title || 'Untitled item',
                frequency: entry.frequency || 'Unknown frequency'
            };
        }).filter(Boolean);

        const pendingRows = categories
            .filter((category) => !pickedByCategory[category])
            .map((category) => ({
                category,
                title: category === currentCategory ? 'Select current category' : 'Pending selection',
                frequency: 'Pending'
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
                '<button type="button" class="suite-custom-selection__button suite-custom-selection__button--secondary" data-action="suite-custom-cancel">总取消</button>'
            ].join('')
            : '<button type="button" class="suite-custom-selection__button suite-custom-selection__button--secondary" data-action="suite-custom-cancel">总取消</button>';

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
            '<p class="suite-custom-selection__eyebrow">Suite selection</p>', 
            '<h3 class="suite-custom-selection__title-main">' + (isReady ? 'Confirm or cancel' : 'Continue selecting the next section') + '</h3>', 
            '</div>',
            '<div class="suite-custom-selection__progress">' + selectedCount + ' / ' + categories.length + '</div>',
            '</header>',
            '<div class="suite-custom-selection__body">',
            '<div class="suite-custom-selection__group">',
            '<div class="suite-custom-selection__group-title">Selected</div>', 
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
    }

    function refreshCustomSuiteSelectionPortal() {
        if (isCustomSuiteSelectionActive()) {
            renderCustomSuiteSelectionPortal();
        } else {
            hideCustomSuiteSelectionPortal();
        }
    }

    function handleCustomSuiteSelect(examId) {
        const draft = getCustomSuiteDraft();
        if (!draft || draft.status === 'ready') {
            return false;
        }

        const exam = findExamById(examId);
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

   // 鏍稿績鍔熻兘锛氬姞杞戒笌娓叉煋
   
    /**
     * 鍔犺浇骞舵覆鏌撻搴撳垪琛?
     */
    function loadExamList() {
        console.log('[ExamActions] loadExamList called');
        
        // 1. 棰戠巼妯″紡濮旀墭缁?BrowseController
        if (global.__browseFilterMode && global.__browseFilterMode !== 'default' && global.browseController) {
            try {
                if (!global.browseController.buttonContainer) {
                    global.browseController.initialize('type-filter-buttons');
                }
                if (global.browseController.currentMode !== global.__browseFilterMode) {
                    global.browseController.setMode(global.__browseFilterMode);
                } else {
                    const activeFilter = global.browseController.activeFilter || 'all';
                    global.browseController.applyFilter(activeFilter);
                }
                return;
            } catch (error) {
                console.warn('[Browse] 棰戠巼妯″紡鍒锋柊澶辫触锛屽洖閫€鍒伴粯璁ら€昏緫:', error);
            }
        }

        // 2. 鑾峰彇棰樺簱蹇収
        let examIndexSnapshot = [];
        if (global.appStateService) {
            examIndexSnapshot = global.appStateService.getExamIndex();
        } else if (typeof global.getExamIndexState === 'function') {
            examIndexSnapshot = global.getExamIndexState();
        } else {
            examIndexSnapshot = Array.isArray(global.examIndex) ? global.examIndex : [];
        }

        let examsToShow = Array.from(examIndexSnapshot);

        // 3. 鑾峰彇绛涢€夋潯浠?
        let activeCategory = 'all';
        let activeExamType = 'all';

        if (global.browseController) {
            activeCategory = global.browseController.getCurrentCategory();
            activeExamType = global.browseController.getCurrentExamType();
        } else {
            // 闄嶇骇鏀寔
            activeCategory = typeof global.getCurrentCategory === 'function' ? global.getCurrentCategory() : 'all';
            activeExamType = typeof global.getCurrentExamType === 'function' ? global.getCurrentExamType() : 'all';
        }

        // 4. 鎵ц绛涢€?
        // 浠呭湪棰戠巼妯″紡涓嬩娇鐢?basePath 杩囨护
        const isFrequencyMode = global.__browseFilterMode && global.__browseFilterMode !== 'default';
        const basePathFilter = isFrequencyMode && (typeof global.__browsePath === 'string' && global.__browsePath.trim())
            ? global.__browsePath.trim()
            : null;

        if (activeExamType !== 'all') {
            examsToShow = examsToShow.filter(exam => exam.type === activeExamType);
        }
        if (activeCategory !== 'all') {
            const filteredByCategory = examsToShow.filter(exam => exam.category === activeCategory);
            // 鍙湁鍦ㄦ湁绛涢€夌粨鏋滄垨涓嶆槸棰戠巼妯″紡鏃舵墠搴旂敤鍒嗙被杩囨护
            if (filteredByCategory.length > 0 || !basePathFilter) {
                examsToShow = filteredByCategory;
            }
        }
        // 鍙湁鍦ㄩ鐜囨ā寮忎笅鎵嶅簲鐢ㄨ矾寰勮繃婊?
        if (basePathFilter) {
            examsToShow = examsToShow.filter((exam) => {
                return typeof exam?.path === 'string' && exam.path.includes(basePathFilter);
            });
        }

        // 5. 鎵ц缃《閫昏緫
        if (activeCategory !== 'all' && activeExamType !== 'all') {
            const key = `${activeCategory}_${activeExamType}`;
            const preferred = preferredFirstExamByCategory[key];

            if (preferred) {
                // 浼樺厛閫氳繃 preferred.id 鍦ㄨ繃婊ゅ悗鐨?examsToShow 涓煡鎵?
                let preferredIndex = examsToShow.findIndex(exam => exam.id === preferred.id);

                // 濡傛灉澶辫触锛宖allback 鍒?preferred.title + currentCategory + currentExamType 鍖归厤
                if (preferredIndex === -1) {
                    preferredIndex = examsToShow.findIndex(exam =>
                        exam.title === preferred.title &&
                        exam.category === activeCategory &&
                        exam.type === activeExamType
                    );
                }

                if (preferredIndex > -1) {
                    const [item] = examsToShow.splice(preferredIndex, 1);
                    examsToShow.unshift(item);
                }
            }
        }

        examsToShow = applyBrowsePostFilters(examsToShow);
        const customSuiteDraft = getCustomSuiteDraft();
        const selectionMode = isCustomSuiteSelectionActive() ? 'custom-suite' : '';

        // 6. 鏇存柊鐘舵€佸苟娓叉煋
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

        // 7. 瑙﹀彂娓叉煋鍚庨挬瀛?
        if (typeof global.handlePostExamListRender === 'function') {
            global.handlePostExamListRender(examsToShow, { category: activeCategory, type: activeExamType });
        }

        return examsToShow;
    }

    /**
     * 閲嶇疆娴忚瑙嗗浘
     */
    function resetBrowseViewToAll() {
        // 1. 娓呴櫎棰戠巼妯″紡鏍囪锛堝叧閿慨澶嶏級
        if (typeof global.__browseFilterMode !== 'undefined') {
            global.__browseFilterMode = 'default';
        }
        if (typeof global.__browsePath !== 'undefined') {
            global.__browsePath = null;
        }

        // 2. 閲嶇疆 browseController 鍒伴粯璁ゆā寮?
        if (global.browseController) {
            global.browseController.clearPendingBrowseAutoScroll();

            // 鎭㈠榛樿妯″紡锛堟秷闄ら鐜囨ā寮忥級
            if (typeof global.browseController.resetToDefault === 'function') {
                global.browseController.resetToDefault();
            } else {
                // 闄嶇骇锛氭墜鍔ㄩ噸缃?
                global.browseController.currentMode = 'default';
                global.browseController.activeFilter = 'all';
            }

            const currentCategory = global.browseController.getCurrentCategory();
            const currentType = global.browseController.getCurrentExamType();

            if (currentCategory === 'all' && currentType === 'all') {
                if (global.setBrowseTitle) global.setBrowseTitle('题库列表');
                loadExamList();
                return;
            }

            global.browseController.setBrowseFilterState('all', 'all');
        } else {
            // 闄嶇骇
            if (typeof global.clearPendingBrowseAutoScroll === 'function') global.clearPendingBrowseAutoScroll();
            if (typeof global.setBrowseFilterState === 'function') global.setBrowseFilterState('all', 'all');
        }

        if (global.setBrowseTitle) global.setBrowseTitle('题库列表');
        loadExamList();
    }

    /**
     * 娓叉煋棰樺簱鍒楄〃 DOM
     */
    function displayExams(exams, options = {}) {
        // 1. 灏濊瘯浣跨敤 BrowseController 绠＄悊鐨?examListViewInstance
        let view = null;
        if (global.browseController && typeof global.browseController.getExamListView === 'function') {
            view = global.browseController.getExamListView();
            // 纭繚 LegacyExamListView 鑳借鍒涘缓锛堝垵濮嬪€间负 null锛?
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
            view.render(exams, {
                loadingSelector: '#browse-view .loading',
                selectionMode: options.selectionMode || '',
                customSuiteDraft: options.customSuiteDraft || null
            });
            setupExamActionHandlers();
            return;
        }

        // 2. 闄嶇骇锛氱洿鎺?DOM 鎿嶄綔 (浠?main.js 杩佺Щ)
        const container = document.getElementById('exam-list-container');
        if (!container) {
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        // 娓呴櫎 loading 鎸囩ず鍣?
        const loadingEl = document.querySelector('#browse-view .loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }

        const normalizedExams = Array.isArray(exams) ? exams : [];
        if (normalizedExams.length === 0) {
            renderEmptyState(container);
            return;
        }

        const list = document.createElement('div');
        list.className = 'exam-list';

        normalizedExams.forEach((exam) => {
            if (!exam) return;
            const item = createExamCard(exam, options);
            list.appendChild(item);
        });

        container.appendChild(list);
        setupExamActionHandlers();
    }

    /**
     * 娓叉煋绌虹姸鎬?
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
     * 鍒涘缓鍗曚釜棰樺簱鍗＄墖
     */
    function createExamCard(exam, options = {}) {
        const selectionMode = options.selectionMode || (isCustomSuiteSelectionActive() ? 'custom-suite' : '');
        const draft = options.customSuiteDraft || getCustomSuiteDraft();
        const currentCategory = getCustomSuiteCurrentCategory(draft);
        const examCategory = normalizeExamCategory(exam);
        const isSelecting = selectionMode === 'custom-suite' && !!draft && draft.status !== 'ready';
        const isSelected = !!draft && draft.pickedByCategory && draft.pickedByCategory[examCategory]
            && String(draft.pickedByCategory[examCategory].examId) === String(exam.id);
        const item = document.createElement('div');
        item.className = 'exam-item'
            + (isSelecting ? ' exam-item--suite-selecting' : '')
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

        const actions = document.createElement('div');
        actions.className = 'exam-actions';

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

            if (action === 'start' && typeof global.openExam === 'function') {
                global.openExam(examId);
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
            global.DOM.delegate('click', '[data-action="suite-custom-delete"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="suite-custom-confirm"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action="suite-custom-cancel"]', function (event) {
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

    async function ensureDataIntegrityManagerReady() {
        try {
            await ensureBrowseGroupReady();
        } catch (error) {
            console.warn('[ExamActions] 娴忚缁勯鍔犺浇澶辫触锛岀户缁皾璇曞鍑?', error);
        }

        if (!global.dataIntegrityManager && global.DataIntegrityManager) {
            try {
                global.dataIntegrityManager = new global.DataIntegrityManager();
            } catch (error) {
                console.warn('[ExamActions] 鍒濆鍖?DataIntegrityManager 澶辫触:', error);
            }
        }

        return global.dataIntegrityManager || null;
    }

    async function exportPracticeData() {
        try {
            if (global.dataIntegrityManager && typeof global.dataIntegrityManager.exportData === 'function') {
                global.dataIntegrityManager.exportData();
                try { global.showMessage && global.showMessage('导出完成', 'success'); } catch (_) { }
                return;
            }
        } catch (_) { }
        try {
            var records = (global.storage && storage.get) ? (await storage.get('practice_records', [])) : (global.getPracticeRecordsState ? global.getPracticeRecordsState() : []);
            var blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json; charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = 'practice-records.json';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            try { global.showMessage && global.showMessage('导出完成', 'success'); } catch (_) { }
        } catch (e) {
            try { global.showMessage && global.showMessage('导出失败: ' + (e && e.message || e), 'error'); } catch (_) { }
            console.error('[Export] failed', e);
        }
    }

    async function exportAllData() {
        var manager = null;
        try {
            manager = await ensureDataIntegrityManagerReady();
            if (manager && typeof manager.exportData === 'function') {
                await manager.exportData();
                try { global.showMessage && global.showMessage('鏁版嵁瀵煎嚭鎴愬姛', 'success'); } catch (_) { }
                return;
            }
        } catch (error) {
            console.error('[ExamActions] 鏁版嵁瀵煎嚭澶辫触:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('鏁版嵁瀵煎嚭澶辫触: ' + (error && error.message || error), 'error');
            }
            return;
        }

        if (typeof global.exportPracticeData === 'function') {
            return global.exportPracticeData();
        }
        if (typeof global.showMessage === 'function') {
            global.showMessage('Data manager module is unavailable.', 'warning');
        }
    }

    // ============================================================================
    // 瀵煎嚭鍒板叏灞€
    // ============================================================================

    global.ExamActions = {
        loadExamList,
        resetBrowseViewToAll,
        displayExams,
        setupExamActionHandlers,
        exportAllData,
        exportPracticeData,
        deduplicateExams,
        applyExamSort,
        applyBrowsePostFilters
    };

    global.loadExamList = loadExamList;
    global.resetBrowseViewToAll = resetBrowseViewToAll;
    global.displayExams = displayExams;
    global.setupExamActionHandlers = setupExamActionHandlers;
    global.exportAllData = exportAllData;
    global.exportPracticeData = exportPracticeData;

    console.log('[ExamActions] 妯″潡宸插姞杞?(Phase 2)');

})(typeof window !== 'undefined' ? window : this);






