/**
 * Browse Controller - 题库浏览控制器
 * 
 * 职责：
 * 1. 管理浏览模式（默认模式、P1频率模式、P4频率模式）
 * 2. 动态渲染筛选按钮
 * 3. 实现频率筛选逻辑
 * 4. 状态管理和持久化
 */

(function (global) {
    'use strict';

    // ============================================================================
    // 数据结构定义
    // ============================================================================

    /**
     * 浏览模式配置
     * 
     * 设计原则：
     * - 消除特殊情况：P4的"全部"按钮通过配置统一处理
     * - 数据驱动：所有按钮和筛选逻辑由配置决定
     */
    const BROWSE_MODES = {
        // 默认模式：全部/阅读/听力
        'default': {
            id: 'default',
            filters: [
                { id: 'all', label: '全部', type: 'all' },
                { id: 'reading', label: '阅读', type: 'reading' },
                { id: 'listening', label: '听力', type: 'listening' }
            ],
            filterLogic: 'type-based'
        },

        // P1 频率模式：超高频/高频/中频
        'frequency-p1': {
            id: 'frequency-p1',
            basePath: 'ListeningPractice/100 P1',
            filters: [
                { id: 'ultra-high', label: '超高频', folder: 'P1 超高频（43）' },
                { id: 'high', label: '高频', folder: 'P1 高频（35）' },
                { id: 'medium', label: '中频', folder: 'P1 中频(48)' }
            ],
            filterLogic: 'folder-based',
            folderMap: {
                'ultra-high': ['P1 超高频（43）'],
                'high': ['P1 高频（35）'],
                'medium': ['P1 中频(48)']
            }
        },

        // P4 频率模式：全部/超高频/高频/中频
        'frequency-p4': {
            id: 'frequency-p4',
            basePath: 'ListeningPractice/100 P4',
            filters: [
                { id: 'all', label: '全部', folder: 'numbered' },
                { id: 'ultra-high', label: '超高频', folder: 'P4 超高频(51)' },
                { id: 'high', label: '高频', folder: 'P4 高频(52)' },
                { id: 'medium', label: '中频', folder: 'P4 中频(64)' }
            ],
            filterLogic: 'folder-based',
            folderMap: {
                'all': ['1-10', '11-20', '21-30', '31-40', '41-50',
                    '51-60', '61-70', '71-80', '81-90', '91-100'],
                'ultra-high': ['P4 超高频(51)'],
                'high': ['P4 高频(52)'],
                'medium': ['P4 中频(64)']
            }
        }
    };

    // ============================================================================
    // BrowseController 类
    // ============================================================================

    class BrowseController {
        constructor() {
            this.currentMode = 'default';
            this.activeFilter = 'all';
            this.buttonContainer = null;
        }

        /**
         * 初始化控制器
         * @param {string} containerId - 按钮容器的DOM ID
         */
        initialize(containerId = 'type-filter-buttons') {
            this.buttonContainer = document.getElementById(containerId);
            if (!this.buttonContainer) {
                console.warn('[BrowseController] 按钮容器未找到:', containerId);
                return false;
            }

            // 从全局状态恢复模式
            this.restoreMode();

            // 渲染初始按钮
            this.renderFilterButtons();

            return true;
        }

        /**
         * 设置浏览模式
         * @param {string} mode - 模式ID (default | frequency-p1 | frequency-p4)
         */
        setMode(mode) {
            if (!BROWSE_MODES[mode]) {
                console.warn('[BrowseController] 无效的模式:', mode);
                return;
            }

            this.currentMode = mode;
            this.activeFilter = 'all'; // 重置为默认筛选

            // 保存到全局状态
            this.saveMode();

            // 重新渲染按钮
            this.renderFilterButtons();

            // 应用筛选
            this.applyFilter(this.activeFilter);
        }

        /**
         * 获取当前模式配置
         * @returns {Object} 模式配置对象
         */
        getCurrentModeConfig() {
            return BROWSE_MODES[this.currentMode] || BROWSE_MODES.default;
        }

        /**
         * 渲染筛选按钮
         */
        renderFilterButtons() {
            if (!this.buttonContainer) {
                return;
            }

            const config = this.getCurrentModeConfig();

            // 清空现有按钮
            this.buttonContainer.innerHTML = '';

            // 生成新按钮
            config.filters.forEach(filter => {
                const button = document.createElement('button');
                button.className = 'btn btn-sm shui-filter-btn';
                button.textContent = filter.label;
                button.dataset.filterId = filter.id;

                // 设置激活状态
                if (filter.id === this.activeFilter) {
                    button.classList.add('active');
                }
                button.setAttribute('aria-pressed', filter.id === this.activeFilter ? 'true' : 'false');

                // 绑定点击事件
                button.addEventListener('click', () => {
                    this.handleFilterClick(filter.id);
                });

                this.buttonContainer.appendChild(button);
            });
        }

        /**
         * 处理筛选按钮点击
         * @param {string} filterId - 筛选器ID
         */
        handleFilterClick(filterId) {
            this.activeFilter = filterId;

            // 更新按钮激活状态
            this.updateButtonStates();

            // 应用筛选
            this.applyFilter(filterId);
        }

        /**
         * 更新按钮激活状态
         */
        updateButtonStates() {
            if (!this.buttonContainer) {
                return;
            }

            const buttons = this.buttonContainer.querySelectorAll('.btn');
            buttons.forEach(button => {
                const filterId = button.dataset.filterId;
                if (filterId === this.activeFilter) {
                    button.classList.add('active');
                    button.setAttribute('aria-pressed', 'true');
                } else {
                    button.classList.remove('active');
                    button.setAttribute('aria-pressed', 'false');
                }
            });
        }

        /**
         * 应用筛选
         * @param {string} filterId - 筛选器ID
         */
        applyFilter(filterId) {
            const config = this.getCurrentModeConfig();

            if (config.filterLogic === 'type-based') {
                // 默认模式：按类型筛选
                this.filterByType(filterId);
            } else if (config.filterLogic === 'folder-based') {
                // 频率模式：按文件夹筛选
                this.filterByFolder(filterId);
            }
        }

        /**
         * 按类型筛选（默认模式）
         * @param {string} type - 类型 (all | reading | listening)
         */
        filterByType(type) {
            // 调用全局的 filterByType 函数
            if (typeof global.filterByType === 'function') {
                global.filterByType(type);
            } else {
                console.warn('[BrowseController] filterByType 函数未定义');
            }
        }

        /**
         * 按文件夹筛选（频率模式）
         * @param {string} filterId - 筛选器ID
         */
        filterByFolder(filterId) {
            const config = this.getCurrentModeConfig();
            const basePath = global.__browsePath || config.basePath || null;
            const folders = config.folderMap[filterId];

            // 允许“全部”入口只按 basePath 过滤（frequency-p1 无全量按钮）
            const isAllFilter = filterId === 'all';
            if (!folders && !isAllFilter) {
                console.warn('[BrowseController] 未找到文件夹映射:', filterId);
                return;
            }

            // 获取题库索引
            const examIndex = this.getExamIndex();

            // 筛选题目
            const filtered = examIndex.filter(exam => {
                if (!exam || !exam.path) {
                    return false;
                }

                if (basePath && !exam.path.includes(basePath)) {
                    return false;
                }

                // “全部”仅做 basePath 过滤
                if (isAllFilter) {
                    return true;
                }

                // 检查路径是否包含任一目标文件夹
                return folders.some(folder => {
                    return exam.path.includes(folder);
                });
            });

            // 显示筛选结果
            this.displayFilteredExams(filtered);
        }



        /**
         * 获取题库索引
         * @returns {Array} 题库数组
         */
        getExamIndex() {
            // 优先使用全局状态服务
            if (typeof global.getExamIndexState === 'function') {
                return global.getExamIndexState();
            }

            // 回退到全局变量
            return Array.isArray(global.examIndex) ? global.examIndex : [];
        }

        /**
         * 显示筛选后的题目
         * @param {Array} exams - 题目数组
         */
        displayFilteredExams(exams) {
            // 更新筛选状态
            if (typeof global.setFilteredExamsState === 'function') {
                global.setFilteredExamsState(exams);
            }

            // 显示题目
            if (typeof global.displayExams === 'function') {
                global.displayExams(exams);
            }

            // 处理渲染后逻辑
            if (typeof global.handlePostExamListRender === 'function') {
                const category = global.getCurrentCategory ? global.getCurrentCategory() : 'all';
                const type = global.getCurrentExamType ? global.getCurrentExamType() : 'all';
                global.handlePostExamListRender(exams, { category, type });
            }
        }

        /**
         * 保存模式到全局状态
         */
        saveMode() {
            try {
                global.__browseFilterMode = this.currentMode;
            } catch (error) {
                console.warn('[BrowseController] 保存模式失败:', error);
            }
        }

        /**
         * 从全局状态恢复模式
         */
        restoreMode() {
            try {
                const savedMode = global.__browseFilterMode;
                if (savedMode && BROWSE_MODES[savedMode]) {
                    this.currentMode = savedMode;
                }
            } catch (error) {
                console.warn('[BrowseController] 恢复模式失败:', error);
            }
        }

        /**
         * 重置为默认模式
         */
        resetToDefault() {
            this.setMode('default');
        }

        // ============================================================================
        // Phase 2: 筛选状态管理迁移
        // ============================================================================

        /**
         * 设置浏览筛选状态
         * @param {string} category - 类别 (all, reading, listening)
         * @param {string} type - 类型 (all, reading, listening)
         */
        setBrowseFilterState(category, type) {
            if (global.appStateService) {
                global.appStateService.setBrowseFilter({ category, type });
            }
            this.updateBrowseTitle();
        }

        /**
         * 获取当前类别
         * @returns {string}
         */
        getCurrentCategory() {
            if (global.appStateService) {
                return global.appStateService.getBrowseFilter().category || 'all';
            }
            return 'all';
        }

        /**
         * 获取当前类型
         * @returns {string}
         */
        getCurrentExamType() {
            if (global.appStateService) {
                return global.appStateService.getBrowseFilter().type || 'all';
            }
            return 'all';
        }

        /**
         * 更新浏览标题
         */
        updateBrowseTitle() {
            const titleElement = document.getElementById('browse-title');
            if (!titleElement) return;

            const category = this.getCurrentCategory();
            const mode = this.currentMode;

            let title = '题库列表';

            if (mode === 'frequency-p1') {
                title = 'P1 频率模式';
            } else if (mode === 'frequency-p4') {
                title = 'P4 频率模式';
            } else {
                // 默认模式
                const map = {
                    'all': '全部题目',
                    'reading': '阅读理解',
                    'listening': '听力训练'
                };
                title = map[category] || '题库列表';
            }

            titleElement.textContent = title;
        }

        /**
         * 清除待处理的自动滚动
         */
        clearPendingBrowseAutoScroll() {
            if (global.browseStateManager) {
                global.browseStateManager.clearPendingScroll();
            }
        }

        /**
         * 应用筛选（统一入口）
         * @param {string} category 
         * @param {string} type 
         * @param {Object} options - 可选参数 { path, filterMode }
         */
        applyBrowseFilter(category, type, options = {}) {
            // 1. 更新状态
            this.setBrowseFilterState(category, type);

            // 2. 处理额外参数（path, filterMode）
            if (options.path) {
                global.__browsePath = options.path;
            }
            if (options.filterMode) {
                global.__browseFilterMode = options.filterMode;
            }

            // 3. 更新标题
            this.updateBrowseTitle();

            // 4. 调用 ExamActions.loadExamList 来执行真正的筛选和渲染
            // 这确保了所有逻辑（包括频率模式、置顶等）都由 ExamActions 统一处理
            if (global.ExamActions && typeof global.ExamActions.loadExamList === 'function') {
                global.ExamActions.loadExamList();
            } else if (typeof global.loadExamList === 'function') {
                global.loadExamList();
            } else {
                console.warn('[BrowseController] 无法加载题库列表: loadExamList 未定义');
            }
        }

        // ============================================================================
        // Phase 2: 全局实例迁移 (examListViewInstance)
        // ============================================================================

        getExamListView() {
            return this._examListViewInstance || null;
        }

        setExamListView(instance) {
            this._examListViewInstance = instance;
            return instance;
        }
    }
    // 导出到全局
    // ============================================================================

    global.BrowseController = BrowseController;
    global.BROWSE_MODES = BROWSE_MODES;

    // 创建全局实例
    global.browseController = new BrowseController();

    console.log('[BrowseController] 模块已加载');

})(window);
