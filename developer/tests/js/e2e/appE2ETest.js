class AppE2ETestSuite {
    constructor(frame, { statusEl, statusTextEl, resultsTable }) {
        this.frame = frame;
        this.statusEl = statusEl;
        this.statusTextEl = statusTextEl;
        this.resultsTable = resultsTable;
        this.results = [];
        this.win = null;
        this.doc = null;
        this.originalPracticeRecords = null;
    }

    setStatus(message) {
        if (this.statusTextEl) {
            this.statusTextEl.textContent = message;
        }
    }

    async waitFor(condition, { timeout = 8000, interval = 50, description = '等待条件成立' } = {}) {
        const start = performance.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                try {
                    if (condition()) {
                        resolve();
                        return;
                    }
                } catch (error) {
                    reject(error);
                    return;
                }
                if (performance.now() - start >= timeout) {
                    reject(new Error(`${description} 超时 (${timeout}ms)`));
                    return;
                }
                setTimeout(check, interval);
            };
            check();
        });
    }

    recordResult(name, passed, details) {
        const result = { name, passed, details };
        this.results.push(result);

        if (!this.resultsTable) {
            return;
        }

        const row = document.createElement('tr');
        row.className = passed ? 'pass' : 'fail';

        const statusCell = document.createElement('td');
        statusCell.className = 'status';
        statusCell.textContent = passed ? '✅ 成功' : '❌ 失败';

        const nameCell = document.createElement('td');
        nameCell.textContent = name;

        const detailCell = document.createElement('td');
        detailCell.className = 'details';
        detailCell.textContent = this.formatDetails(details);

        row.appendChild(statusCell);
        row.appendChild(nameCell);
        row.appendChild(detailCell);
        this.resultsTable.appendChild(row);
    }

    formatDetails(details) {
        if (details === undefined || details === null) {
            return '';
        }
        if (typeof details === 'string') {
            return details;
        }
        try {
            return JSON.stringify(details, null, 2);
        } catch (_) {
            return String(details);
        }
    }

    async setup() {
        this.win = this.frame.contentWindow;
        this.doc = this.win.document;
        await this.waitFor(() => this.doc && this.doc.readyState === 'complete', {
            timeout: 10000,
            description: '主应用 DOM 加载完成'
        });
        await this.waitFor(() => this.win.app && this.win.app.isInitialized, {
            timeout: 15000,
            description: '主应用完成初始化'
        });

        if (this.win.simpleStorageWrapper && typeof this.win.simpleStorageWrapper.getPracticeRecords === 'function') {
            try {
                this.originalPracticeRecords = await this.win.simpleStorageWrapper.getPracticeRecords();
            } catch (error) {
                console.warn('[E2E] 备份练习记录失败:', error);
                this.originalPracticeRecords = null;
            }
        }
    }

    async teardown() {
        if (this.originalPracticeRecords && this.win?.simpleStorageWrapper) {
            try {
                await this.win.simpleStorageWrapper.savePracticeRecords(this.originalPracticeRecords);
                if (typeof this.win.syncPracticeRecords === 'function') {
                    await this.win.syncPracticeRecords();
                }
            } catch (error) {
                console.warn('[E2E] 恢复原始练习记录失败:', error);
            }
        }
        if (this.win && typeof this.win.showView === 'function') {
            try { this.win.showView('overview'); } catch (_) {}
        }
    }

    async run() {
        try {
            this.setStatus('正在等待应用初始化...');
            await this.setup();
            this.setStatus('应用已就绪，开始执行测试...');

            await this.testInitialization();
            await this.testOverviewRendering();
            await this.testBrowseNavigation();
            await this.testExamFiltering();
            await this.testSearchFunction();
            await this.testLegacyBridgeSynchronization();
            await this.testPracticeRecordsFlow();

            this.setStatus('全部测试执行完毕');
        } catch (error) {
            this.recordResult('测试套件初始化', false, error.message || String(error));
            this.setStatus('执行中断: ' + (error.message || error));
        } finally {
            await this.teardown();
            this.renderSummary();
        }
    }

    renderSummary() {
        const passed = this.results.filter(r => r.passed).length;
        const failed = this.results.length - passed;
        const summary = `已完成 ${this.results.length} 项测试 · ✅ ${passed} · ❌ ${failed}`;
        this.setStatus(summary);
    }

    async testInitialization() {
        const name = '应用初始化状态';
        try {
            const activeView = this.doc.querySelector('.view.active');
            const activeNav = this.doc.querySelector('.main-nav .nav-btn.active');
            const stats = {
                activeView: activeView ? activeView.id : null,
                activeNav: activeNav ? activeNav.getAttribute('data-view') : null,
                appInitialized: !!(this.win.app && this.win.app.isInitialized)
            };
            const passed = stats.appInitialized && stats.activeView === 'overview-view' && stats.activeNav === 'overview';
            this.recordResult(name, passed, stats);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testOverviewRendering() {
        const name = '概览视图渲染结构';
        try {
            await this.waitFor(() => this.doc.querySelectorAll('#category-overview .category-card').length >= 3, {
                timeout: 6000,
                description: '概览卡片渲染完成'
            });

            const browseButtons = Array.from(this.doc.querySelectorAll('#category-overview button[data-action="browse-category"]'));
            const randomButtons = Array.from(this.doc.querySelectorAll('#category-overview button[data-action="start-random-practice"]'));
            const allButtons = browseButtons.concat(randomButtons);

            const datasetSummary = allButtons.slice(0, 4).map((btn) => ({
                action: btn.dataset.action,
                category: btn.dataset.category,
                type: btn.dataset.type
            }));

            const hasDelegatedAttributes = allButtons.every((btn) => btn.dataset.action && btn.dataset.category && btn.dataset.type);
            const hasReadingEntry = browseButtons.some((btn) => btn.dataset.type === 'reading');
            const hasRandomEntry = randomButtons.length > 0;

            const details = {
                cardCount: this.doc.querySelectorAll('#category-overview .category-card').length,
                buttonCount: allButtons.length,
                sampleDatasets: datasetSummary
            };

            this.recordResult(name, hasDelegatedAttributes && hasReadingEntry && hasRandomEntry, details);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async ensureBrowseView() {
        if (!this.doc.getElementById('browse-view')?.classList.contains('active')) {
            if (typeof this.win.showView === 'function') {
                this.win.showView('browse');
            }
            await this.waitFor(() => this.doc.getElementById('browse-view')?.classList.contains('active'), {
                timeout: 4000,
                description: '切换到题库浏览视图'
            });
        }
    }

    async testBrowseNavigation() {
        const name = '切换到题库浏览视图';
        try {
            await this.ensureBrowseView();
            const activeNav = this.doc.querySelector('.main-nav .nav-btn.active');
            const details = {
                activeView: this.doc.getElementById('browse-view')?.classList.contains('active'),
                activeNav: activeNav ? activeNav.getAttribute('data-view') : null
            };
            const passed = details.activeView && details.activeNav === 'browse';
            this.recordResult(name, passed, details);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async waitForExamIndex() {
        await this.waitFor(() => Array.isArray(this.win.examIndex) && this.win.examIndex.length > 0, {
            timeout: 15000,
            description: '题库索引加载完成'
        });
    }

    async testExamFiltering() {
        const nameReading = '题库筛选 - 阅读分类';
        const nameListening = '题库筛选 - 听力分类';

        try {
            await this.ensureBrowseView();
            await this.waitForExamIndex();

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('reading');
            }
            await this.waitFor(() => Array.isArray(this.win.filteredExams) && this.win.filteredExams.length > 0 && this.win.filteredExams.every(exam => exam.type === 'reading'), {
                timeout: 5000,
                description: '阅读筛选结果'
            });

            const readingCards = this.doc.querySelectorAll('#exam-list-container .exam-item').length;
            this.recordResult(nameReading, readingCards === this.win.filteredExams.length && readingCards > 0, {
                filteredCount: this.win.filteredExams.length,
                renderedCards: readingCards
            });

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('listening');
            }
            await this.waitFor(() => Array.isArray(this.win.filteredExams) && this.win.filteredExams.length > 0 && this.win.filteredExams.every(exam => exam.type === 'listening'), {
                timeout: 5000,
                description: '听力筛选结果'
            });
            const listeningCards = this.doc.querySelectorAll('#exam-list-container .exam-item').length;
            this.recordResult(nameListening, listeningCards === this.win.filteredExams.length && listeningCards > 0, {
                filteredCount: this.win.filteredExams.length,
                renderedCards: listeningCards
            });
        } catch (error) {
            this.recordResult(nameReading, false, error.message || String(error));
            this.recordResult(nameListening, false, '依赖阅读筛选失败，未执行');
        }
    }

    async testSearchFunction() {
        const name = '题库搜索功能';
        try {
            await this.ensureBrowseView();
            await this.waitForExamIndex();

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('all');
            }
            if (typeof this.win.performSearch === 'function') {
                this.win.performSearch('ocean');
            } else if (typeof this.win.searchExams === 'function') {
                this.win.searchExams('ocean');
            }

            await this.waitFor(() => this.doc.querySelectorAll('#exam-list-container .exam-item').length > 0, {
                timeout: 4000,
                description: '搜索结果渲染'
            });

            const cards = Array.from(this.doc.querySelectorAll('#exam-list-container .exam-item'));
            const titles = cards.map(card => card.querySelector('h4')?.textContent || '');
            const normalized = titles.map(text => text.toLowerCase());
            const passed = titles.length > 0 && normalized.every(text => text.includes('ocean'));
            this.recordResult(name, passed, {
                matches: titles,
                matchCount: titles.length
            });

            if (typeof this.win.performSearch === 'function') {
                this.win.performSearch('');
            }
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testLegacyBridgeSynchronization() {
        const name = 'Legacy 状态桥同步';
        try {
            const bridge = this.win.LegacyStateBridge?.getInstance?.();
            if (!bridge) {
                this.recordResult(name, false, 'LegacyStateBridge 未加载');
                return;
            }

            const originalExamIndex = Array.isArray(this.win.examIndex) ? this.win.examIndex.slice() : [];
            const originalPractice = Array.isArray(this.win.practiceRecords) ? this.win.practiceRecords.slice() : [];

            const examSampleSize = originalExamIndex.length > 1 ? 1 : originalExamIndex.length;
            const examSample = examSampleSize > 0 ? originalExamIndex.slice(0, examSampleSize) : [];

            bridge.setExamIndex(examSample);
            await this.waitFor(() => {
                const state = this.win.app?.getState?.('exam.index');
                return Array.isArray(state) && state.length === examSample.length;
            }, { description: 'App exam state 接收 Legacy 更新' });
            const examState = this.win.app.getState('exam.index') || [];
            const examSynced = Array.isArray(examState) && examState.length === examSample.length;

            let practiceSynced = true;
            let practiceSampleSize = 0;
            if (originalPractice.length > 0) {
                practiceSampleSize = 1;
                const practiceSample = originalPractice.slice(0, practiceSampleSize);
                bridge.setPracticeRecords(practiceSample);
                await this.waitFor(() => {
                    const state = this.win.app?.getState?.('practice.records');
                    return Array.isArray(state) && state.length === practiceSample.length;
                }, { description: 'App practice state 接收 Legacy 更新' });
                const practiceState = this.win.app.getState('practice.records') || [];
                practiceSynced = Array.isArray(practiceState) && practiceState.length === practiceSample.length;
            }

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('reading');
            } else {
                throw new Error('filterByType 不可用');
            }
            await this.waitFor(() => {
                const filter = this.win.app?.getState?.('ui.browseFilter');
                return filter && filter.type === 'reading';
            }, { description: '浏览筛选通过桥接层同步' });
            const filter = this.win.app.getState('ui.browseFilter') || {};
            const filterSynced = filter.type === this.win.currentExamType && filter.category === this.win.currentCategory;

            bridge.setExamIndex(originalExamIndex);
            await this.waitFor(() => {
                const state = this.win.app?.getState?.('exam.index');
                return Array.isArray(state) && state.length === originalExamIndex.length;
            }, { description: 'App exam state 恢复原始数据' });

            bridge.setPracticeRecords(originalPractice);
            await this.waitFor(() => {
                const state = this.win.app?.getState?.('practice.records');
                return Array.isArray(state) && state.length === originalPractice.length;
            }, { description: 'App practice state 恢复原始数据' });

            if (typeof this.win.filterByType === 'function') {
                this.win.filterByType('all');
            }
            await this.waitFor(() => {
                const restored = this.win.app?.getState?.('ui.browseFilter');
                return restored && restored.type === 'all';
            }, { description: '浏览筛选恢复默认' });

            this.recordResult(name, examSynced && practiceSynced && filterSynced, {
                examSampleSize,
                practiceSampleSize,
                filterSnapshot: filter
            });
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }

    async testPracticeRecordsFlow() {
        const name = '练习记录同步流程';
        try {
            if (!this.win.simpleStorageWrapper || typeof this.win.simpleStorageWrapper.savePracticeRecords !== 'function') {
                this.recordResult(name, false, 'simpleStorageWrapper 不可用');
                return;
            }

            if (typeof this.win.showView === 'function') {
                this.win.showView('practice');
            }
            await this.waitFor(() => this.doc.getElementById('practice-view')?.classList.contains('active'), {
                timeout: 4000,
                description: '切换到练习记录视图'
            });

            await this.win.simpleStorageWrapper.savePracticeRecords([]);
            if (typeof this.win.syncPracticeRecords === 'function') {
                await this.win.syncPracticeRecords();
            }
            await this.waitFor(() => this.doc.getElementById('total-practiced')?.textContent === '0', {
                timeout: 4000,
                description: '清空练习记录'
            });

            const sampleRecord = {
                id: 'e2e-record',
                title: 'E2E 阅读测试题',
                type: 'reading',
                score: 85,
                percentage: 85,
                totalQuestions: 40,
                correctAnswers: 34,
                duration: 1800,
                date: new Date().toISOString(),
                dataSource: 'real'
            };

            await this.win.simpleStorageWrapper.savePracticeRecords([sampleRecord]);
            if (typeof this.win.syncPracticeRecords === 'function') {
                await this.win.syncPracticeRecords();
            }

            await this.waitFor(() => this.doc.getElementById('total-practiced')?.textContent === '1', {
                timeout: 5000,
                description: '新练习记录渲染'
            });

            const stats = {
                total: this.doc.getElementById('total-practiced')?.textContent,
                average: this.doc.getElementById('avg-score')?.textContent,
                studyTime: this.doc.getElementById('study-time')?.textContent,
                streak: this.doc.getElementById('streak-days')?.textContent
            };
            const passed = stats.total === '1' && stats.average === '85.0%' && stats.studyTime === '30';
            this.recordResult(name, passed, stats);
        } catch (error) {
            this.recordResult(name, false, error.message || String(error));
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const frame = document.getElementById('app-frame');
    const statusBadge = document.getElementById('suite-status');
    const statusText = document.getElementById('suite-status-text');
    const resultsTable = document.getElementById('test-results');

    if (!frame) {
        console.error('[E2E] 找不到应用 iframe');
        if (statusText) {
            statusText.textContent = '执行中断: 找不到测试 iframe 容器';
        }
        return;
    }

    const suite = new AppE2ETestSuite(frame, {
        statusEl: statusBadge,
        statusTextEl: statusText,
        resultsTable
    });

    if (typeof window.__bootstrapAppFrame !== 'function') {
        const message = '执行中断: 缺少应用加载引导函数';
        console.error('[E2E]', message);
        suite.recordResult('测试套件初始化', false, message);
        suite.setStatus(message);
        return;
    }

    window.__bootstrapAppFrame()
        .then(() => {
            const method = window.__APP_FRAME_LOAD_SOURCE__ || 'unknown';
            const baseHref = window.__APP_FRAME_BASE_HREF__ || '未推导';
            suite.recordResult('主应用加载通道', true, { source: method, baseHref });
            suite.run();
        })
        .catch((error) => {
            const message = error && error.message ? error.message : String(error || '未知错误');
            console.error('[E2E] 无法加载主应用:', message);
            suite.recordResult('测试套件初始化', false, message);
            suite.setStatus('执行中断: ' + message);
        });
});
