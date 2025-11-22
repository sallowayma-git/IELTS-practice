(function initExamActionProxies(global) {
    'use strict';

    function ensureBrowse() {
        if (global.AppEntry && typeof global.AppEntry.ensureBrowseGroup === 'function') {
            return global.AppEntry.ensureBrowseGroup();
        }
        if (global.AppLazyLoader && typeof global.AppLazyLoader.ensureGroup === 'function') {
            return global.AppLazyLoader.ensureGroup('browse-view');
        }
        return Promise.resolve();
    }

    function createProxy(targetName) {
        return function proxy() {
            var args = Array.prototype.slice.call(arguments);
            return ensureBrowse().then(function () {
                var impl = global['__legacy' + targetName] || global[targetName];
                if (impl && impl !== proxy && typeof impl === 'function') {
                    return impl.apply(global, args);
                }
                return undefined;
            });
        };
    }

    if (typeof global.loadExamList !== 'function') {
        global.loadExamList = createProxy('LoadExamList');
    }

    if (typeof global.resetBrowseViewToAll !== 'function') {
        global.resetBrowseViewToAll = createProxy('ResetBrowseViewToAll');
    }

    // --- Exam action bindings (migrated from main.js) ---
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
            global.DOM.delegate('click', '[data-action=\"start\"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action=\"pdf\"]', function (event) {
                invoke(this, event);
            });
            global.DOM.delegate('click', '[data-action=\"generate\"]', function (event) {
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

    global.setupExamActionHandlers = setupExamActionHandlers;
    global.exportPracticeData = exportPracticeData;
})(typeof window !== 'undefined' ? window : this);
