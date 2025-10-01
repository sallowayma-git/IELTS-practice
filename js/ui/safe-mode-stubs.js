/**
 * Safe Mode UI Stub Components (Task 81)
 *
 * 在Safe Mode下提供最小化的空实现，防止ReferenceError
 * 这些组件在正常模式下会被真实组件替代
 */

console.log('[Safe Mode Stubs] Loading UI stub components...');

// ExamFilterBar stub
window.ExamFilterBar = class ExamFilterBar {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
    }

    render() {
        // Safe Mode下不渲染复杂的过滤栏
        if (window.__DEBUG__) console.debug('[ExamFilterBar Stub] render (no-op)');
    }

    update() {
        if (window.__DEBUG__) console.debug('[ExamFilterBar Stub] update (no-op)');
    }

    destroy() {
        if (window.__DEBUG__) console.debug('[ExamFilterBar Stub] destroy (no-op)');
    }

    setCategory() {}
    setType() {}
    setSearch() {}
};

// ExamList stub
window.ExamList = class ExamList {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.exams = [];
    }

    render(exams = []) {
        this.exams = exams || [];
        // Safe Mode下只渲染基本列表
        if (window.__DEBUG__) console.debug('[ExamList Stub] render (no-op)');
    }

    update() {
        if (window.__DEBUG__) console.debug('[ExamList Stub] update (no-op)');
    }

    destroy() {
        if (window.__DEBUG__) console.debug('[ExamList Stub] destroy (no-op)');
    }

    setExams() {}
    clear() {}
};

// Pagination stub
window.Pagination = class Pagination {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.currentPage = 1;
        this.totalPages = 1;
    }

    render() {
        // Safe Mode下不渲染分页控件
        if (window.__DEBUG__) console.debug('[Pagination Stub] render (no-op)');
    }

    update() {
        if (window.__DEBUG__) console.debug('[Pagination Stub] update (no-op)');
    }

    destroy() {
        if (window.__DEBUG__) console.debug('[Pagination Stub] destroy (no-op)');
    }

    setCurrentPage() {}
    setTotalPages() {}
};

// RecordStats stub
window.RecordStats = class RecordStats {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.stats = {
            total: 0,
            avgScore: 0,
            studyTime: 0,
            streakDays: 0
        };
    }

    render(records = []) {
        // Safe Mode下不渲染复杂统计
        if (window.__DEBUG__) console.debug('[RecordStats Stub] render (no-op)');
    }

    update() {
        if (window.__DEBUG__) console.debug('[RecordStats Stub] update (no-op)');
    }

    destroy() {
        if (window.__DEBUG__) console.debug('[RecordStats Stub] destroy (no-op)');
    }

    calculateStats() {
        return this.stats;
    }

    setStats() {}
};

// SettingsActions stub
window.SettingsActions = class SettingsActions {
    constructor(stores, options = {}) {
        this.stores = stores;
        this.options = options;
    }

    attach() {
        if (window.__DEBUG__) console.debug('[SettingsActions Stub] attach (no-op)');
    }

    detach() {
        if (window.__DEBUG__) console.debug('[SettingsActions Stub] detach (no-op)');
    }

    rebuildIndexes() {
        console.warn('[SettingsActions Stub] rebuildIndexes not available in Safe Mode');
    }

    restoreBackup() {
        console.warn('[SettingsActions Stub] restoreBackup not available in Safe Mode');
    }

    exportData() {
        console.warn('[SettingsActions Stub] exportData not available in Safe Mode');
    }

    importData() {
        console.warn('[SettingsActions Stub] importData not available in Safe Mode');
    }

    createManualBackup() {
        console.warn('[SettingsActions Stub] createManualBackup not available in Safe Mode');
    }
};

console.log('[Safe Mode Stubs] All UI stubs loaded successfully');