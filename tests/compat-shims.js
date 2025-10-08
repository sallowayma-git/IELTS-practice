/**
 * Back-compat API shims for test harness
 * 为旧测试期望的全局函数提供代理，确保测试能够正常运行
 *
 * 代理映射：
 * - loadLibrary/refreshExamLibrary/loadExamLibrary → App.stores.exams.refreshExams()
 * - showLibraryConfigListV2/createManualBackup/exportAllData/importData → 委托 App.ui.settings
 * - searchExams/filterByType/filterByCategory → 委托 App.ui.browser
 *
 * 验收标准：
 * - 测试页能检测到上述全局函数
 * - 调用不报错
 * - 功能正确代理到新实现
 */

(function() {
    'use strict';

    // 调试日志
    function debugLog(message, type = 'info') {
        if (window.__DEBUG__) {
            console.log(`[CompatShims] ${type.toUpperCase()}: ${message}`);
        }
    }

    /**
     * 显示弃用警告（仅在DEBUG模式）
     */
    function showDeprecationWarning(oldFunction, newAPI) {
        if (window.__DEBUG__) {
            console.warn(`[CompatShims] DEPRECATED: ${oldFunction} is deprecated. Use ${newAPI} instead.`);
        }
    }

    /**
     * 确保App和组件已就绪
     */
    function ensureAppReady() {
        if (!window.App || !window.App.isInitialized()) {
            throw new Error('App not ready for compatibility shims');
        }
        return window.App;
    }

    /**
     * 创建代理函数
     */
    function createProxy(oldName, newAPI, implementation) {
        return function(...args) {
            showDeprecationWarning(oldName, newAPI);
            try {
                return implementation.apply(this, args);
            } catch (error) {
                debugLog(`Proxy ${oldName} failed: ${error.message}`, 'error');
                throw error;
            }
        };
    }

    debugLog('Loading compatibility shims...');

    // ==================== 题库管理函数 ====================

    // loadLibrary → App.stores.exams.refreshExams()
    window.loadLibrary = createProxy(
        'loadLibrary',
        'App.stores.exams.refreshExams()',
        async function(force = false) {
            const app = ensureAppReady();
            const examStore = app.stores.exams || app.stores.examStore;

            if (examStore && typeof examStore.refreshExams === 'function') {
                debugLog('Refreshing exams through App.stores.exams');
                return await examStore.refreshExams(force);
            } else if (typeof loadLibrary === 'function') {
                // 回退到原始实现
                debugLog('Falling back to original loadLibrary implementation');
                return await loadLibrary(force);
            } else {
                throw new Error('No suitable loadLibrary implementation found');
            }
        }
    );

    // refreshExamLibrary → App.stores.exams.refreshExams()
    window.refreshExamLibrary = createProxy(
        'refreshExamLibrary',
        'App.stores.exams.refreshExams()',
        async function() {
            const app = ensureAppReady();
            const examStore = app.stores.exams || app.stores.examStore;

            if (examStore && typeof examStore.refreshExams === 'function') {
                debugLog('Refreshing exam library through App.stores.exams');
                return await examStore.refreshExams();
            } else {
                throw new Error('ExamStore refreshExams not available');
            }
        }
    );

    // loadExamLibrary → App.stores.exams.loadExams()
    window.loadExamLibrary = createProxy(
        'loadExamLibrary',
        'App.stores.exams.loadExams()',
        async function() {
            const app = ensureAppReady();
            const examStore = app.stores.exams || app.stores.examStore;

            if (examStore && typeof examStore.loadExams === 'function') {
                debugLog('Loading exam library through App.stores.exams');
                return await examStore.loadExams();
            } else {
                throw new Error('ExamStore loadExams not available');
            }
        }
    );

    // ==================== 设置面板函数 ====================

    // showLibraryConfigListV2 → App.ui.settingsPanel.showLibraryConfigListV2()
    window.showLibraryConfigListV2 = createProxy(
        'showLibraryConfigListV2',
        'App.ui.settingsPanel.showLibraryConfigListV2()',
        function() {
            const app = ensureAppReady();

            if (app.ui.settingsPanel && typeof app.ui.settingsPanel.showLibraryConfigListV2 === 'function') {
                debugLog('Showing library config through App.ui.settingsPanel');
                return app.ui.settingsPanel.showLibraryConfigListV2();
            } else if (typeof showLibraryConfigListV2 === 'function') {
                // 回退到原始实现
                debugLog('Falling back to original showLibraryConfigListV2 implementation');
                return showLibraryConfigListV2();
            } else {
                throw new Error('SettingsPanel showLibraryConfigListV2 not available');
            }
        }
    );

    // createManualBackup → 原始实现或SettingsPanel
    window.createManualBackup = createProxy(
        'createManualBackup',
        'SettingsPanel.createBackup()',
        async function() {
            if (typeof createManualBackup === 'function') {
                debugLog('Using original createManualBackup implementation');
                return await createManualBackup();
            } else {
                const app = ensureAppReady();
                if (app.ui.settingsPanel && typeof app.ui.settingsPanel.createBackup === 'function') {
                    debugLog('Creating backup through App.ui.settingsPanel');
                    return await app.ui.settingsPanel.createBackup();
                } else {
                    throw new Error('No suitable createManualBackup implementation found');
                }
            }
        }
    );

    // exportAllData → 原始实现或SettingsPanel
    window.exportAllData = createProxy(
        'exportAllData',
        'SettingsPanel.exportData()',
        async function() {
            if (typeof exportAllData === 'function') {
                debugLog('Using original exportAllData implementation');
                return await exportAllData();
            } else {
                const app = ensureAppReady();
                if (app.ui.settingsPanel && typeof app.ui.settingsPanel.exportData === 'function') {
                    debugLog('Exporting data through App.ui.settingsPanel');
                    return await app.ui.settingsPanel.exportData();
                } else {
                    throw new Error('No suitable exportAllData implementation found');
                }
            }
        }
    );

    // importData → 原始实现或SettingsPanel
    window.importData = createProxy(
        'importData',
        'SettingsPanel.importData()',
        async function() {
            if (typeof importData === 'function') {
                debugLog('Using original importData implementation');
                return await importData();
            } else {
                const app = ensureAppReady();
                if (app.ui.settingsPanel && typeof app.ui.settingsPanel.importData === 'function') {
                    debugLog('Importing data through App.ui.settingsPanel');
                    return await app.ui.settingsPanel.importData();
                } else {
                    throw new Error('No suitable importData implementation found');
                }
            }
        }
    );

    // showLibraryLoaderModal → 原始实现
    window.showLibraryLoaderModal = createProxy(
        'showLibraryLoaderModal',
        'Original implementation',
        function() {
            if (typeof showLibraryLoaderModal === 'function') {
                debugLog('Using original showLibraryLoaderModal implementation');
                return showLibraryLoaderModal();
            } else {
                throw new Error('showLibraryLoaderModal not available');
            }
        }
    );

    // ==================== 搜索和筛选函数 ====================

    // searchExams → App.ui.examBrowser.search()
    window.searchExams = createProxy(
        'searchExams',
        'App.ui.examBrowser.search()',
        function(query) {
            const app = ensureAppReady();
            const examBrowser = app.ui.examBrowser;

            if (examBrowser && typeof examBrowser.search === 'function') {
                debugLog('Searching exams through App.ui.examBrowser');
                return examBrowser.search(query);
            } else if (typeof searchExams === 'function') {
                // 回退到原始实现
                debugLog('Falling back to original searchExams implementation');
                return searchExams(query);
            } else {
                throw new Error('No suitable searchExams implementation found');
            }
        }
    );

    // filterByType → App.ui.examBrowser.setType()
    window.filterByType = createProxy(
        'filterByType',
        'App.ui.examBrowser.setType()',
        function(type) {
            const app = ensureAppReady();
            const examBrowser = app.ui.examBrowser;

            if (examBrowser && typeof examBrowser.setType === 'function') {
                debugLog('Filtering by type through App.ui.examBrowser');
                return examBrowser.setType(type);
            } else if (typeof filterByType === 'function') {
                // 回退到原始实现
                debugLog('Falling back to original filterByType implementation');
                return filterByType(type);
            } else {
                throw new Error('No suitable filterByType implementation found');
            }
        }
    );

    // filterByCategory → App.ui.examBrowser.setCategory()
    window.filterByCategory = createProxy(
        'filterByCategory',
        'App.ui.examBrowser.setCategory()',
        function(category) {
            const app = ensureAppReady();
            const examBrowser = app.ui.examBrowser;

            if (examBrowser && typeof examBrowser.setCategory === 'function') {
                debugLog('Filtering by category through App.ui.examBrowser');
                return examBrowser.setCategory(category);
            } else if (typeof filterByCategory === 'function') {
                // 回退到原始实现
                debugLog('Falling back to original filterByCategory implementation');
                return filterByCategory(category);
            } else {
                throw new Error('No suitable filterByCategory implementation found');
            }
        }
    );

    // ==================== 练习记录函数 ====================

    // filterRecordsByType → 原始实现
    window.filterRecordsByType = createProxy(
        'filterRecordsByType',
        'Original implementation',
        function(type) {
            if (typeof filterRecordsByType === 'function') {
                debugLog('Using original filterRecordsByType implementation');
                return filterRecordsByType(type);
            } else {
                throw new Error('filterRecordsByType not available');
            }
        }
    );

    // clearPracticeData → 原始实现
    window.clearPracticeData = createProxy(
        'clearPracticeData',
        'Original implementation',
        function() {
            if (typeof clearPracticeData === 'function') {
                debugLog('Using original clearPracticeData implementation');
                return clearPracticeData();
            } else {
                throw new Error('clearPracticeData not available');
            }
        }
    );

    // toggleBulkDelete → 原始实现
    window.toggleBulkDelete = createProxy(
        'toggleBulkDelete',
        'Original implementation',
        function() {
            if (typeof toggleBulkDelete === 'function') {
                debugLog('Using original toggleBulkDelete implementation');
                return toggleBulkDelete();
            } else {
                throw new Error('toggleBulkDelete not available');
            }
        }
    );

    // ==================== 主题和UI函数 ====================

    // showThemeSwitcherModal → 原始实现
    window.showThemeSwitcherModal = createProxy(
        'showThemeSwitcherModal',
        'Original implementation',
        function() {
            if (typeof showThemeSwitcherModal === 'function') {
                debugLog('Using original showThemeSwitcherModal implementation');
                return showThemeSwitcherModal();
            } else {
                throw new Error('showThemeSwitcherModal not available');
            }
        }
    );

    // hideThemeSwitcherModal → 原始实现
    window.hideThemeSwitcherModal = createProxy(
        'hideThemeSwitcherModal',
        'Original implementation',
        function() {
            if (typeof hideThemeSwitcherModal === 'function') {
                debugLog('Using original hideThemeSwitcherModal implementation');
                return hideThemeSwitcherModal();
            } else {
                throw new Error('hideThemeSwitcherModal not available');
            }
        }
    );

    // showDeveloperTeam → 原始实现
    window.showDeveloperTeam = createProxy(
        'showDeveloperTeam',
        'Original implementation',
        function() {
            if (typeof showDeveloperTeam === 'function') {
                debugLog('Using original showDeveloperTeam implementation');
                return showDeveloperTeam();
            } else {
                throw new Error('showDeveloperTeam not available');
            }
        }
    );

    // hideDeveloperTeam → 原始实现
    window.hideDeveloperTeam = createProxy(
        'hideDeveloperTeam',
        'Original implementation',
        function() {
            if (typeof hideDeveloperTeam === 'function') {
                debugLog('Using original hideDeveloperTeam implementation');
                return hideDeveloperTeam();
            } else {
                throw new Error('hideDeveloperTeam not available');
            }
        }
    );

    // ==================== 系统管理函数 ====================

    // clearCache → 原始实现
    window.clearCache = createProxy(
        'clearCache',
        'Original implementation',
        async function() {
            if (typeof clearCache === 'function') {
                debugLog('Using original clearCache implementation');
                return await clearCache();
            } else {
                throw new Error('clearCache not available');
            }
        }
    );

    // refreshExams → 原始实现
    window.refreshExams = createProxy(
        'refreshExams',
        'Original implementation',
        function() {
            if (typeof refreshExams === 'function') {
                debugLog('Using original refreshExams implementation');
                return refreshExams();
            } else {
                throw new Error('refreshExams not available');
            }
        }
    );

    // ==================== SettingsPanel API 暴露 ====================

    /**
     * SettingsPanel API for tests
     * 提供统一的设置面板访问接口
     */
    window.SettingsPanelAPI = {
        /**
         * 获取SettingsPanel实例
         */
        getInstance: function() {
            const app = ensureAppReady();
            return app.ui.settingsPanel;
        },

        /**
         * 创建备份
         */
        createBackup: async function() {
            const panel = this.getInstance();
            if (panel && typeof panel.createBackup === 'function') {
                return await panel.createBackup();
            }
            throw new Error('SettingsPanel createBackup not available');
        },

        /**
         * 导出数据
         */
        exportData: async function() {
            const panel = this.getInstance();
            if (panel && typeof panel.exportData === 'function') {
                return await panel.exportData();
            }
            throw new Error('SettingsPanel exportData not available');
        },

        /**
         * 导入数据
         */
        importData: async function() {
            const panel = this.getInstance();
            if (panel && typeof panel.importData === 'function') {
                return await panel.importData();
            }
            throw new Error('SettingsPanel importData not available');
        },

        /**
         * 显示题库配置
         */
        showLibraryConfig: function() {
            const panel = this.getInstance();
            if (panel && typeof panel.showLibraryConfig === 'function') {
                return panel.showLibraryConfig();
            }
            throw new Error('SettingsPanel showLibraryConfig not available');
        },

        /**
         * 显示题库配置列表
         */
        showLibraryConfigListV2: function() {
            const panel = this.getInstance();
            if (panel && typeof panel.showLibraryConfigListV2 === 'function') {
                return panel.showLibraryConfigListV2();
            }
            throw new Error('SettingsPanel showLibraryConfigListV2 not available');
        },

        /**
         * 切换题库配置
         */
        switchLibraryConfig: async function(configKey) {
            const panel = this.getInstance();
            if (panel && typeof panel.switchLibraryConfig === 'function') {
                return await panel.switchLibraryConfig(configKey);
            }
            throw new Error('SettingsPanel switchLibraryConfig not available');
        },

        /**
         * 删除题库配置
         */
        deleteLibraryConfig: async function(configKey) {
            const panel = this.getInstance();
            if (panel && typeof panel.deleteLibraryConfig === 'function') {
                return await panel.deleteLibraryConfig(configKey);
            }
            throw new Error('SettingsPanel deleteLibraryConfig not available');
        }
    };

    debugLog('Compatibility shims loaded successfully');

    // 向测试框架报告shims已就绪
    if (window.TestBaseline) {
        window.TestBaseline.compatShimsReady = true;
        debugLog('Compat shims ready flag set');
    }

})();