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

   // 核心功能：加载与渲染
   
    /**
     * 加载并渲染题库列表
     */
    function loadExamList() {
        console.log('[ExamActions] loadExamList 被调用');

        // 确保 BrowseController 已初始化（用于管理筛选按钮状态）
        if (global.browseController && !global.browseController.buttonContainer) {
            try {
                global.browseController.initialize('type-filter-buttons');
            } catch (error) {
                console.warn('[Browse] BrowseController 自动初始化失败:', error);
            }
        }
        
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

        // 6. 更新状态并渲染
        if (global.appStateService) {
            global.appStateService.setFilteredExams(examsToShow);
        } else if (typeof global.setFilteredExamsState === 'function') {
            global.setFilteredExamsState(examsToShow);
        }

        displayExams(examsToShow);

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
    function displayExams(exams) {
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
            view.render(exams, { loadingSelector: '#browse-view .loading' });
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
            const item = createExamCard(exam);
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

        // Palette Improvement: Add Clear Search Button if search is active
        const searchInput = document.getElementById('exam-search-input');
        if (searchInput && searchInput.value.trim().length > 0) {
            const actions = document.createElement('div');
            actions.className = 'exam-list-empty-actions';

            const clearBtn = document.createElement('button');
            clearBtn.className = 'btn btn-secondary exam-list-empty-action';
            clearBtn.textContent = '清除搜索';
            clearBtn.onclick = function() {
                if (typeof global.clearSearch === 'function') {
                    global.clearSearch();
                    return;
                }
                var input = document.getElementById('exam-search-input');
                if (input) {
                    input.value = '';
                    input.focus();
                    if (typeof global.searchExams === 'function') {
                        global.searchExams('');
                    }
                }
            };

            actions.appendChild(clearBtn);
            empty.appendChild(actions);
        }

        container.appendChild(empty);
    }

    /**
     * 创建单个题库卡片
     */
    function createExamCard(exam) {
        const item = document.createElement('div');
        item.className = 'exam-item';
        if (exam.id) {
            item.dataset.examId = exam.id;
        }

        const info = document.createElement('div');
        info.className = 'exam-info';
        const infoContent = document.createElement('div');
        const title = document.createElement('h4');
        title.textContent = exam.title || '';
        const meta = document.createElement('div');
        meta.className = 'exam-meta';

        // 格式化元数据
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

        const actions = document.createElement('div');
        actions.className = 'exam-actions';

        const startBtn = document.createElement('button');
        startBtn.className = 'btn exam-item-action-btn';
        startBtn.type = 'button';
        startBtn.dataset.action = 'start';
        // Palette: Add aria-label for context
        startBtn.setAttribute('aria-label', '开始练习 ' + (exam.title || ''));
        if (exam.id) {
            startBtn.dataset.examId = exam.id;
        }
        startBtn.textContent = '开始练习';
        actions.appendChild(startBtn);

        // PDF 按钮
        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'btn btn-outline exam-item-action-btn';
        pdfBtn.type = 'button';
        pdfBtn.dataset.action = 'pdf';
        // Palette: Add aria-label for context
        pdfBtn.setAttribute('aria-label', '查看PDF ' + (exam.title || ''));
        if (exam.id) {
            pdfBtn.dataset.examId = exam.id;
        }
        pdfBtn.textContent = 'PDF';
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
            if (!action || !examId) {
                return;
            }

            event.preventDefault();

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
        } else if (typeof document !== 'undefined') {
            document.addEventListener('click', function (event) {
                var target = event.target.closest('[data-action]');
                if (!target) {
                    return;
                }

                var container = document.getElementById('exam-list-container');
                if (container && !container.contains(target)) {
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
            global.showMessage('数据管理模块未就绪', 'warning');
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
