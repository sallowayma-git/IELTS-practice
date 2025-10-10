(function (global) {
    'use strict';

    const VIEW_SELECTOR = '.view';
    const ACTIVE_CLASS = 'active';

    function getStateService() {
        if (global.AppStateService && typeof global.AppStateService.getInstance === 'function') {
            return global.AppStateService.getInstance({
                legacyAdapter: global.LegacyStateAdapter ? global.LegacyStateAdapter.getInstance() : null
            });
        }
        if (global.appStateService) {
            return global.appStateService;
        }
        return null;
    }

    function ensureMessage(message, type) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type);
            return;
        }
        if (typeof console !== 'undefined') {
            const level = type === 'error' ? 'error' : (type === 'warning' ? 'warn' : 'log');
            console[level]('[LegacyFallback]', message);
        }
    }

    function showViewFallback(viewName) {
        const views = document.querySelectorAll(VIEW_SELECTOR);
        views.forEach((view) => {
            if (!view) return;
            if (view.id === `${viewName}-view` || view.dataset.view === viewName) {
                view.classList.add(ACTIVE_CLASS);
            } else {
                view.classList.remove(ACTIVE_CLASS);
            }
        });
    }

    function renderExamListFallback(exams) {
        const container = document.getElementById('exam-list-container');
        if (!container) {
            return;
        }
        container.innerHTML = '';
        const list = Array.isArray(exams) ? exams : [];
        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'legacy-empty-state';
            empty.textContent = '题库暂时为空，请稍后重试。';
            container.appendChild(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        list.forEach((exam) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'legacy-exam-item';
            item.dataset.examId = exam.id;
            item.textContent = `${exam.title || exam.id} (${exam.type || '未知'})`;
            item.addEventListener('click', () => {
                if (typeof global.openExam === 'function') {
                    global.openExam(exam.id);
                } else {
                    ensureMessage(`无法打开 ${exam.title || exam.id}`, 'warning');
                }
            });
            fragment.appendChild(item);
        });
        container.appendChild(fragment);
    }

    function renderPracticeOverviewFallback(records) {
        const normalized = Array.isArray(records) ? records : [];
        const totalEl = document.getElementById('total-practiced');
        const avgEl = document.getElementById('avg-score');
        const timeEl = document.getElementById('study-time');
        if (totalEl) totalEl.textContent = normalized.length;
        if (avgEl) {
            const average = normalized.reduce((sum, record) => sum + (record.percentage || 0), 0);
            avgEl.textContent = normalized.length ? Math.round(average / normalized.length) + '%' : '0%';
        }
        if (timeEl) {
            const totalSeconds = normalized.reduce((sum, record) => sum + (record.duration || 0), 0);
            timeEl.textContent = Math.round(totalSeconds / 60);
        }
    }

    function runSmokeCheck(mode, service) {
        const result = {
            mode,
            timestamp: new Date().toISOString(),
            hasService: !!service,
            hasMessageCenter: typeof global.getMessageCenter === 'function',
            examCount: service ? service.getExamIndex().length : (Array.isArray(global.examIndex) ? global.examIndex.length : 0),
            recordCount: service ? service.getPracticeRecords().length : (Array.isArray(global.practiceRecords) ? global.practiceRecords.length : 0)
        };
        global.__legacySmokeReport = result;
        if (typeof console !== 'undefined') {
            console.log('[LegacySmoke]', result);
        }
        return result;
    }

    function bootstrapFallbackRuntime() {
        if (global.__legacyFallbackBootstrapped) {
            return;
        }
        global.__legacyFallbackBootstrapped = true;

        const stateService = getStateService();
        if (!stateService) {
            runSmokeCheck('no-service', null);
            return;
        }

        if (typeof global.loadExamList === 'function' && typeof global.updatePracticeView === 'function') {
            runSmokeCheck('primary-runtime', stateService);
            return;
        }

        ensureMessage('正在使用降级模式渲染页面', 'warning');
        showViewFallback('overview');
        renderExamListFallback(stateService.getExamIndex());
        renderPracticeOverviewFallback(stateService.getPracticeRecords());
        runSmokeCheck('fallback-runtime', stateService);
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootstrapFallbackRuntime);
        } else {
            bootstrapFallbackRuntime();
        }
    }

    global.LegacyFallback = {
        bootstrap: bootstrapFallbackRuntime,
        showView: showViewFallback,
        renderExamList: () => {
            const service = getStateService();
            renderExamListFallback(service ? service.getExamIndex() : []);
        },
        smoke: () => runSmokeCheck('manual', getStateService())
    };
})(typeof window !== 'undefined' ? window : this);
