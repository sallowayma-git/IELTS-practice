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

   // 核心功能：加载与渲染
   
    /**
     * 加载并渲染题库列表
     */
    function loadExamList() {
        console.log('[ExamActions] loadExamList called');
        
        // 1. 频率模式委托给 BrowseController
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
                console.warn('[Browse] 频率模式刷新失败，回退到默认逻辑:', error);
            }
        }

        // 2. 获取题库快照
        let examIndexSnapshot = [];
        if (global.appStateService) {
            examIndexSnapshot = global.appStateService.getExamIndex();
        } else if (typeof global.getExamIndexState === 'function') {
            examIndexSnapshot = global.getExamIndexState();
        } else {
            examIndexSnapshot = Array.isArray(global.examIndex) ? global.examIndex : [];
        }

        let examsToShow = Array.from(examIndexSnapshot);

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

        // 4. 执行筛选
        // 仅在频率模式下使用 basePath 过滤
        const isFrequencyMode = global.__browseFilterMode && global.__browseFilterMode !== 'default';
        const basePathFilter = isFrequencyMode && (typeof global.__browsePath === 'string' && global.__browsePath.trim())
            ? global.__browsePath.trim()
            : null;

        if (activeExamType !== 'all') {
            examsToShow = examsToShow.filter(exam => exam.type === activeExamType);
        }
        if (activeCategory !== 'all') {
            const filteredByCategory = examsToShow.filter(exam => exam.category === activeCategory);
            // 只有在有筛选结果或不是频率模式时才应用分类过滤
            if (filteredByCategory.length > 0 || !basePathFilter) {
                examsToShow = filteredByCategory;
            }
        }
        // 只有在频率模式下才应用路径过滤
        if (basePathFilter) {
            examsToShow = examsToShow.filter((exam) => {
                return typeof exam?.path === 'string' && exam.path.includes(basePathFilter);
            });
        }

        // 5. 执行置顶逻辑
        if (activeCategory !== 'all' && activeExamType !== 'all') {
            const key = `${activeCategory}_${activeExamType}`;
            const preferred = preferredFirstExamByCategory[key];

            if (preferred) {
                // 优先通过 preferred.id 在过滤后的 examsToShow 中查找
                let preferredIndex = examsToShow.findIndex(exam => exam.id === preferred.id);

                // 如果失败，fallback 到 preferred.title + currentCategory + currentExamType 匹配
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

    /**
     * 重置浏览视图
     */
    function resetBrowseViewToAll() {
        // 1. 清除频率模式标记（关键修复）
        if (typeof global.__browseFilterMode !== 'undefined') {
            global.__browseFilterMode = 'default';
        }
        if (typeof global.__browsePath !== 'undefined') {
            global.__browsePath = null;
        }

        // 2. 重置 browseController 到默认模式
        if (global.browseController) {
            global.browseController.clearPendingBrowseAutoScroll();

            // 恢复默认模式（消除频率模式）
            if (typeof global.browseController.resetToDefault === 'function') {
                global.browseController.resetToDefault();
            } else {
                // 降级：手动重置
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
            // 降级
            if (typeof global.clearPendingBrowseAutoScroll === 'function') global.clearPendingBrowseAutoScroll();
            if (typeof global.setBrowseFilterState === 'function') global.setBrowseFilterState('all', 'all');
        }

        if (global.setBrowseTitle) global.setBrowseTitle('题库列表');
        loadExamList();
    }

    /**
     * 渲染题库列表 DOM
     */
    function displayExams(exams, options = {}) {
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
            view.render(exams, {
                loadingSelector: '#browse-view .loading',
                selectionMode: options.selectionMode || '',
                customSuiteDraft: options.customSuiteDraft || null
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
            console.warn('[ExamActions] 浏览组预加载失败，继续尝试导出:', error);
        }

        if (!global.dataIntegrityManager && global.DataIntegrityManager) {
            try {
                global.dataIntegrityManager = new global.DataIntegrityManager();
            } catch (error) {
                console.warn('[ExamActions] 初始化 DataIntegrityManager 失败:', error);
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
                try { global.showMessage && global.showMessage('数据导出成功', 'success'); } catch (_) { }
                return;
            }
        } catch (error) {
            console.error('[ExamActions] 数据导出失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('数据导出失败: ' + (error && error.message || error), 'error');
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
    // 导出到全局
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

    console.log('[ExamActions] 模块已加载 (Phase 2)');

})(typeof window !== 'undefined' ? window : this);
