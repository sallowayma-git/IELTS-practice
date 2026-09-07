#!/usr/bin/env node
/**
 * 复盘视图契约（历史卡片徽标 / 空状态 / 复盘节奏组件 / 组件偏好竞态）。
 *
 * 这些断言守住三件容易回退的事：
 *   1. 徽标与复盘入口只出现在真的有 reviewState 的记录上（听力/满分/旧历史保持原样）；
 *   2. "复盘节奏"只展示能由当前 reviewState 精确还原的量；
 *   3. 组件偏好是异步读出来的——晚到的偏好必须补一次重绘，否则用户会以为偏好没保存。
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bundleSource = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');

class Node {
    constructor(tag = 'div') {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.dataset = {};
        this.attributes = {};
        this.style = {
            properties: {},
            setProperty(name, value) { this.properties[name] = value; }
        };
        this._text = '';
        this._classes = new Set();
        this.disabled = false;
        this.listeners = new Map();
        this.classList = {
            add: (...names) => names.forEach((name) => this._classes.add(name)),
            remove: (...names) => names.forEach((name) => this._classes.delete(name)),
            toggle: (name, force) => {
                const next = force === undefined ? !this._classes.has(name) : Boolean(force);
                if (next) this._classes.add(name); else this._classes.delete(name);
                return next;
            },
            contains: (name) => this._classes.has(name)
        };
    }
    get className() { return Array.from(this._classes).join(' '); }
    set className(value) {
        this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
    }
    get textContent() {
        if (this.children.length === 0) return this._text;
        return this._text + this.children.map((child) => child.textContent).join('');
    }
    set textContent(value) {
        this._text = value == null ? '' : String(value);
        this.children.forEach((child) => { child.parentNode = null; });
        this.children = [];
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) {
        if (!child) return child;
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        if (child) child.parentNode = null;
        return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type) { this.listeners.delete(type); }
    matches() { return false; }
    closest() { return null; }
    getBoundingClientRect() { return { width: 320, height: 200 }; }
    descendants() {
        return this.children.flatMap((child) => [child, ...child.descendants()]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const wanted = String(selector).trim();
        return this.descendants().filter((node) => {
            if (wanted.startsWith('.')) return node._classes.has(wanted.slice(1));
            if (wanted.startsWith('[') && wanted.endsWith(']')) {
                const raw = wanted.slice(1, -1);
                const [name, value] = raw.split('=');
                const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
                if (value === undefined) return node.dataset[key] !== undefined;
                return String(node.dataset[key]) === value.replace(/^["']|["']$/g, '');
            }
            return node.tagName === wanted.toUpperCase();
        });
    }
}

function createHarness(options = {}) {
    const byId = new Map();
    const documentStub = {
        documentElement: new Node('html'),
        body: new Node('body'),
        createElement(tag) { return new Node(tag); },
        createTextNode(text) { const node = new Node('#text'); node.textContent = text; return node; },
        getElementById(id) { return byId.get(String(id)) || null; },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    documentStub.documentElement.classList.add('light');
    let resolvePreference = null;
    const preferenceGate = new Promise((resolve) => { resolvePreference = resolve; });
    const windowStub = {
        document: documentStub,
        innerWidth: 1280,
        devicePixelRatio: 1,
        addEventListener() {},
        removeEventListener() {},
        getComputedStyle() { return { getPropertyValue() { return ''; } }; },
        AppData: options.withPreferences === false ? undefined : {
            ready: Promise.resolve(),
            preferences: {
                getPracticeWidget() { return preferenceGate; },
                setPracticeWidget(value) { windowStub.__savedWidget = value; return Promise.resolve(); }
            }
        }
    };
    const sandbox = {
        window: windowStub, document: documentStub, console,
        Date, Math, JSON, Map, Set, Promise, Number, String, Boolean, Array, Object, RegExp,
        setTimeout, clearTimeout, isNaN, Node
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    vm.runInContext(bundleSource, context, { filename: 'js/views/legacyViewBundle.js' });
    return {
        window: windowStub,
        document: documentStub,
        registerElement(id, tag = 'div') {
            const node = new Node(tag);
            node.id = id;
            byId.set(id, node);
            return node;
        },
        resolvePreference(value) { resolvePreference(value); return preferenceGate; }
    };
}

function reviewQueue(entries) {
    return {
        byRecordId: new Map(entries.map((entry) => [String(entry.id), entry])),
        order: new Map(entries.map((entry, index) => [String(entry.id), index])),
        stats: null
    };
}

function reviewState(nextReview) {
    return {
        schemaVersion: 1, algorithm: 'sm2-practice', algorithmVersion: 1,
        easeFactor: 2.5, interval: 1, repetitions: 1, reviewCount: 1, lapseCount: 0,
        lastReviewed: null, nextReview, lastQuality: null, lastReviewAttemptId: null,
        updatedAt: nextReview
    };
}

test('徽标状态由 nextReview 与当天边界决定', () => {
    const harness = createHarness();
    const renderer = harness.window.PracticeHistoryRenderer;
    const now = new Date(2026, 8, 5, 12, 0, 0);
    const yesterday = new Date(2026, 8, 4, 9, 0, 0).toISOString();
    const earlierToday = new Date(2026, 8, 5, 8, 0, 0).toISOString();
    const laterToday = new Date(2026, 8, 5, 22, 0, 0).toISOString();
    const nextWeek = new Date(2026, 8, 12, 8, 0, 0).toISOString();

    assert.strictEqual(renderer.resolveReviewBadge(null, now), null, '没有复盘状态就没有徽标');
    assert.strictEqual(renderer.resolveReviewBadge({ reviewState: null }, now), null);
    assert.strictEqual(renderer.resolveReviewBadge({ reviewState: reviewState('not-a-date') }, now), null);
    assert.strictEqual(renderer.resolveReviewBadge({ reviewState: reviewState(yesterday) }, now).state, 'overdue');
    assert.strictEqual(renderer.resolveReviewBadge({ reviewState: reviewState(earlierToday) }, now).state, 'due');
    assert.strictEqual(renderer.resolveReviewBadge({ reviewState: reviewState(laterToday) }, now).state, 'scheduled');
    assert.strictEqual(renderer.resolveReviewBadge({ reviewState: reviewState(nextWeek) }, now).state, 'scheduled');
});

test('历史卡片：只有入队记录才带徽标与复盘入口', () => {
    const harness = createHarness();
    const renderer = harness.window.PracticeHistoryRenderer;
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    const queue = reviewQueue([{ id: 'r-review', reviewState: reviewState(future), wrongCount: 3 }]);

    const scheduled = renderer.createRecordNode(
        { id: 'r-review', title: '阅读 P1', date: '2026-09-01T00:00:00.000Z', duration: 600, percentage: 70 },
        { reviewQueue: queue }
    );
    const badges = scheduled.querySelectorAll('.record-review-badge');
    assert.strictEqual(badges.length, 1, '入队记录应有一个复盘徽标');
    assert.ok(badges[0].textContent.indexOf('下次复盘') >= 0);
    assert.strictEqual(scheduled.querySelectorAll('[data-record-action=review]').length, 1, '入队记录应有复盘入口');
    assert.strictEqual(scheduled.querySelectorAll('[data-record-action=delete]').length, 1, '删除入口必须保留');

    const listening = renderer.createRecordNode(
        { id: 'r-listening', title: '听力 S1', date: '2026-09-01T00:00:00.000Z', duration: 600, percentage: 70 },
        { reviewQueue: queue }
    );
    assert.strictEqual(listening.querySelectorAll('.record-review-badge').length, 0, '未入队记录不得有徽标');
    assert.strictEqual(listening.querySelectorAll('[data-record-action=review]').length, 0, '未入队记录不得有复盘入口');
    assert.strictEqual(listening.querySelectorAll('[data-record-action=delete]').length, 1, '普通历史行为不受影响');

    // 批量删除态下不渲染任何行内操作按钮（含复盘入口）。
    const bulk = renderer.createRecordNode(
        { id: 'r-review', title: '阅读 P1', date: '2026-09-01T00:00:00.000Z', duration: 600, percentage: 70 },
        { reviewQueue: queue, bulkDeleteMode: true }
    );
    assert.strictEqual(bulk.querySelectorAll('[data-record-action=review]').length, 0, '批量删除态不得出现复盘入口');
    assert.strictEqual(bulk.querySelectorAll('.record-review-badge').length, 1, '批量删除态仍可显示徽标');
});

test('空状态区分普通模式与复盘模式', () => {
    const harness = createHarness();
    const renderer = harness.window.PracticeHistoryRenderer;
    const normal = new Node('div');
    renderer.renderEmptyState(normal);
    assert.ok(normal.textContent.indexOf('暂无任何练习记录') >= 0);

    const review = new Node('div');
    renderer.renderEmptyState(review, { reviewMode: true });
    assert.ok(review.textContent.indexOf('暂无待复盘的阅读记录') >= 0);
    assert.ok(review.textContent.indexOf('自动加入复盘计划') >= 0, '复盘空状态应解释记录如何入队');
});

function registerReviewWidgetDom(harness) {
    const card = harness.registerElement('practice-custom-card');
    harness.registerElement('practice-custom-card-title');
    harness.registerElement('practice-review-due-today');
    harness.registerElement('practice-review-overdue');
    harness.registerElement('practice-review-completed');
    harness.registerElement('practice-review-load');
    harness.registerElement('practice-review-summary');
    return card;
}

test('复盘节奏组件展示今日/逾期/已完成与未来 7 天负荷', () => {
    const harness = createHarness();
    registerReviewWidgetDom(harness);
    const renderer = new harness.window.PracticePriorityRenderer({ defaultWidget: 'review' });
    renderer.activeWidget = 'review';
    const buckets = [
        { date: new Date(2026, 8, 5).toISOString(), dateKey: '2026-09-05', count: 4, includesOverdue: true },
        { date: new Date(2026, 8, 6).toISOString(), dateKey: '2026-09-06', count: 0, includesOverdue: false },
        { date: new Date(2026, 8, 7).toISOString(), dateKey: '2026-09-07', count: 2, includesOverdue: false },
        { date: new Date(2026, 8, 8).toISOString(), dateKey: '2026-09-08', count: 0, includesOverdue: false },
        { date: new Date(2026, 8, 9).toISOString(), dateKey: '2026-09-09', count: 1, includesOverdue: false },
        { date: new Date(2026, 8, 10).toISOString(), dateKey: '2026-09-10', count: 0, includesOverdue: false },
        { date: new Date(2026, 8, 11).toISOString(), dateKey: '2026-09-11', count: 0, includesOverdue: false }
    ];
    renderer.update([], [], {
        examType: 'all',
        reviewStats: { dueToday: 2, overdue: 2, dueNow: 4, completedToday: 3, total: 7, futureSevenDayTotal: 7, buckets }
    });

    assert.strictEqual(harness.document.getElementById('practice-review-due-today').textContent, '2');
    assert.strictEqual(harness.document.getElementById('practice-review-overdue').textContent, '2');
    assert.strictEqual(harness.document.getElementById('practice-review-completed').textContent, '3');
    assert.strictEqual(harness.document.getElementById('practice-custom-card-title').textContent, '复盘节奏');
    const columns = harness.document.getElementById('practice-review-load').children;
    assert.strictEqual(columns.length, 7, '应画出 7 天');
    assert.ok(columns[0].classList.contains('practice-review-load__column--today'));
    assert.ok(columns[0].title.indexOf('含逾期 2 条') >= 0, '今日格子应说明含逾期');
    const summary = harness.document.getElementById('practice-review-summary').textContent;
    assert.strictEqual(summary, '未来 7 天共 7 条复盘计划');
    assert.ok(summary.indexOf('原计划') < 0, '不得承诺无法从状态还原的分母');
});

test('没有复盘状态时复盘节奏显示空态而不是编造数字', () => {
    const harness = createHarness();
    registerReviewWidgetDom(harness);
    const renderer = new harness.window.PracticePriorityRenderer({ defaultWidget: 'review' });
    renderer.activeWidget = 'review';
    renderer.update([], [], { examType: 'all', reviewStats: null });
    assert.strictEqual(harness.document.getElementById('practice-review-due-today').textContent, '0');
    assert.strictEqual(harness.document.getElementById('practice-review-summary').textContent, '未来 7 天暂无复盘计划');
    assert.ok(harness.document.getElementById('practice-review-load').textContent.indexOf('暂无复盘计划') >= 0);
});

test('晚到的组件偏好会补一次重绘，用户显式选择后不再被覆盖', async () => {
    const harness = createHarness();
    registerReviewWidgetDom(harness);
    const renderer = new harness.window.PracticePriorityRenderer({});
    assert.strictEqual(renderer.activeWidget, 'heatmap', '偏好未就绪时先用默认组件');

    harness.resolvePreference('review');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(renderer.activeWidget, 'review', '偏好晚到必须补上并重绘');
    assert.strictEqual(harness.document.getElementById('practice-custom-card-title').textContent, '复盘节奏');

    const second = new harness.window.PracticePriorityRenderer({});
    assert.strictEqual(second.activeWidget, 'review', '偏好已就绪时构造即生效');

    const third = new harness.window.PracticePriorityRenderer({});
    third.setWidget('radar');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(third.activeWidget, 'radar', '用户显式选择不得被偏好回填覆盖');
    assert.strictEqual(harness.window.__savedWidget, 'radar', '显式选择应持久化');
});

// ---------------------------------------------------------------------------
// 复盘模式只收窄"显示哪些记录"，其余练习历史行为必须完全不变。
// 这里在 VM 里跑真实的 js/main.js updatePracticeView，只 stub 渲染出口。
// ---------------------------------------------------------------------------
function loadPracticeView(queueRecords) {
    const renderCalls = [];
    const historyContainer = { id: 'history-list', innerHTML: '', addEventListener() {}, contains() { return false; } };
    const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
    const elements = new Map();
    const sandbox = {
        console: quietConsole, setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set,
        getBulkDeleteModeState: () => false,
        getSelectedRecordsState: () => new Set(),
        document: {
            addEventListener() {},
            getElementById(id) {
                if (id === 'history-list') return historyContainer;
                return elements.get(id) || null;
            },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() { return { style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {} }; }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.window.location = { origin: 'http://localhost' };
    sandbox.window.addEventListener = () => {};
    sandbox.window.showMessage = () => {};
    sandbox.window.PracticeHistoryRenderer = {
        renderView(options) {
            renderCalls.push({
                ids: Array.from(options && Array.isArray(options.records) ? options.records : [], (record) => String(record.id)),
                reviewMode: options.reviewMode === true,
                hasQueue: Boolean(options.reviewQueue && options.reviewQueue.byRecordId)
            });
            return { scroller: null };
        }
    };
    sandbox.window.PracticeDashboardView = null;
    sandbox.window.PracticeStats = {
        calculateSummary(records) { return { totalPracticed: records.length, averageScore: 0, totalStudyMinutes: 0, streak: 0 }; },
        sortByDateDesc(records) { return records.slice().sort((left, right) => new Date(right.date) - new Date(left.date)); },
        filterByExamType(records, _index, examType) {
            return records.filter((record) => String(record.type || '').toLowerCase().indexOf(examType) >= 0);
        }
    };
    sandbox.window.AppData = {
        ready: Promise.resolve(),
        practice: {
            async listReviewQueue() {
                return {
                    generatedAt: '2026-09-05T00:00:00.000Z',
                    records: queueRecords.map((record) => Object.assign({}, record)),
                    stats: { dueToday: 1, overdue: 1, dueNow: 2, completedToday: 0, total: queueRecords.length, futureSevenDayTotal: queueRecords.length, buckets: [] }
                };
            }
        }
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/data/practiceRecordSource.js'), 'utf8'), context, { filename: 'practiceRecordSource.js' });
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8'), context, { filename: 'js/main.js' });
    assert.strictEqual(typeof sandbox.updatePracticeView, 'function', 'main.js 必须暴露 updatePracticeView');
    assert.strictEqual(typeof sandbox.window.togglePracticeReviewMode, 'function', 'main.js 必须暴露复盘模式开关');
    // 本测试只观测 updatePracticeView 的过滤/排序结果：把后台记录同步换成 no-op，
    // 避免真实同步管线在断言之后异步重绘，让结果依赖时序。
    sandbox.startPracticeRecordsSyncInBackground = () => {};
    return { sandbox, renderCalls, lastRender: () => renderCalls[renderCalls.length - 1] };
}

const VIEW_RECORDS = [
    { id: 'read-late', type: 'reading', title: '阅读逾期', date: '2026-09-01T00:00:00.000Z', totalQuestions: 10, correctAnswers: 4, percentage: 40 },
    { id: 'read-due', type: 'reading', title: '阅读到期', date: '2026-09-03T00:00:00.000Z', totalQuestions: 10, correctAnswers: 8, percentage: 80 },
    { id: 'read-clean', type: 'reading', title: '阅读满分', date: '2026-09-04T00:00:00.000Z', totalQuestions: 10, correctAnswers: 10, percentage: 100 },
    { id: 'listen-1', type: 'listening', title: '听力练习', date: '2026-09-02T00:00:00.000Z', totalQuestions: 10, correctAnswers: 5, percentage: 50 }
];

// 队列顺序刻意与"按时间倒序"不同：复盘模式必须采用队列顺序，而不是历史顺序。
const VIEW_QUEUE = [
    { id: 'read-late', reviewState: reviewState('2026-09-01T00:00:00.000Z'), wrongCount: 6, isDue: true },
    { id: 'read-due', reviewState: reviewState('2026-09-05T00:00:00.000Z'), wrongCount: 2, isDue: true }
];

test('复盘模式只显示入队记录并采用队列顺序，普通模式不受影响', async () => {
    const harness = loadPracticeView(VIEW_QUEUE);
    await harness.sandbox.window.refreshPracticeReviewQueue('test');

    harness.sandbox.updatePracticeView(VIEW_RECORDS, []);
    let render = harness.lastRender();
    assert.deepStrictEqual(render.ids, ['read-clean', 'read-due', 'listen-1', 'read-late'],
        '普通模式仍按时间倒序显示全部记录');
    assert.strictEqual(render.reviewMode, false);
    assert.strictEqual(render.hasQueue, true, '普通模式也要拿到队列，以便渲染徽标');

    harness.sandbox.window.togglePracticeReviewMode(true);
    harness.sandbox.updatePracticeView(VIEW_RECORDS, []);
    render = harness.lastRender();
    assert.deepStrictEqual(render.ids, ['read-late', 'read-due'], '复盘模式只显示入队记录且按队列顺序');
    assert.strictEqual(render.reviewMode, true);

    harness.sandbox.window.togglePracticeReviewMode(false);
    harness.sandbox.updatePracticeView(VIEW_RECORDS, []);
    render = harness.lastRender();
    assert.deepStrictEqual(render.ids, ['read-clean', 'read-due', 'listen-1', 'read-late'], '退出复盘模式必须完全恢复');
    assert.strictEqual(render.reviewMode, false);
});

test('复盘模式遵守考试类型筛选与搜索', async () => {
    const harness = loadPracticeView(VIEW_QUEUE);
    await harness.sandbox.window.refreshPracticeReviewQueue('test');
    harness.sandbox.window.togglePracticeReviewMode(true);

    harness.sandbox.window.getCurrentExamType = () => 'listening';
    harness.sandbox.updatePracticeView(VIEW_RECORDS, []);
    assert.deepStrictEqual(harness.lastRender().ids, [], '听力筛选下复盘队列为空（首版不支持听力复盘）');

    harness.sandbox.window.getCurrentExamType = () => 'reading';
    harness.sandbox.updatePracticeView(VIEW_RECORDS, []);
    assert.deepStrictEqual(harness.lastRender().ids, ['read-late', 'read-due']);

    harness.sandbox.searchPracticeHistory('逾期');
    harness.sandbox.updatePracticeView(VIEW_RECORDS, []);
    assert.deepStrictEqual(harness.lastRender().ids, ['read-late'], '搜索必须在复盘模式下继续生效');
});

// ---------------------------------------------------------------------------
// 待评分条：ACK 收齐后才出现，评分提交才写库，取消/刷新都不算完成。
// ---------------------------------------------------------------------------
function loadReviewFlow(options = {}) {
    const outcomes = [];
    const messages = [];
    const body = new Node('body');
    const documentStub = {
        body,
        createElement(tag) { return new Node(tag); },
        getElementById(id) {
            return body.descendants().find((node) => node.id === String(id)) || null;
        },
        addEventListener() {},
        removeEventListener() {}
    };
    const windowStub = {
        document: documentStub,
        showMessage(text, type) { messages.push({ text, type }); },
        AppData: {
            ready: Promise.resolve(),
            practice: {
                async getReviewState() { return options.reviewState === undefined ? reviewState('2026-09-05T00:00:00.000Z') : options.reviewState; },
                async get() { return options.record === undefined ? { id: 'record-1', examId: 'reading-p1' } : options.record; },
                async recordReviewOutcome(command) {
                    outcomes.push(command);
                    if (options.outcomeError) throw new Error(options.outcomeError);
                    return { committed: true, reviewState: reviewState('2026-09-12T00:00:00.000Z') };
                }
            }
        },
        app: {
            async openPracticeRecordReplay(record, opts) {
                windowStub.__replayCalls = windowStub.__replayCalls || [];
                windowStub.__replayCalls.push({ record, opts });
                if (options.replayError) throw new Error(options.replayError);
                return { sessionId: 'review-session-1' };
            }
        },
        refreshPracticeReviewQueue(trigger) { windowStub.__refreshCalls = (windowStub.__refreshCalls || 0) + 1; }
    };
    const sandbox = {
        window: windowStub, document: documentStub, console,
        Date, Math, JSON, Map, Set, Promise, Number, String, Boolean, Array, Object,
        setTimeout, clearTimeout
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(repoRoot, 'js/app/practiceReviewFlow.js'), 'utf8'), context, { filename: 'js/app/practiceReviewFlow.js' });
    return { flow: windowStub.PracticeReviewFlow, windowStub, documentStub, body, outcomes, messages };
}

function clickBanner(harness, dataset) {
    const bar = harness.documentStub.getElementById('practice-review-pending-bar');
    assert(bar, '待评分条应存在');
    const handler = bar.listeners.get('click');
    assert.strictEqual(typeof handler, 'function', '待评分条应绑定点击处理');
    const target = new Node('button');
    Object.assign(target.dataset, dataset);
    target.closest = (selector) => {
        const key = selector.replace(/^\[data-|\]$/g, '').replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
        return target.dataset[key] !== undefined ? target : null;
    };
    handler({ target, preventDefault() {} });
}

test('待评分条要收齐 ACK 才出现，评分提交才写库', async () => {
    const harness = loadReviewFlow();
    assert.strictEqual(harness.documentStub.getElementById('practice-review-pending-bar'), null,
        '未收到回执前不得出现待评分条');
    assert.strictEqual(harness.flow.getPending(), null);

    harness.flow.notifyAttemptApplied({ recordId: 'record-1', reviewAttemptId: 'attempt-1', title: '阅读 P1', entryCount: 1 });
    const bar = harness.documentStub.getElementById('practice-review-pending-bar');
    assert(bar, '收齐回执后应挂出待评分条');
    const buttons = bar.querySelectorAll('[data-review-quality]');
    assert.deepStrictEqual(Array.from(buttons, (button) => button.dataset.reviewQuality), ['hard', 'good', 'easy'],
        '必须提供三级反馈');
    assert.deepStrictEqual(Array.from(buttons, (button) => button.textContent), ['仍不熟', '基本掌握', '已掌握']);
    assert.strictEqual(harness.outcomes.length, 0, '挂出待评分条本身不得写库');

    clickBanner(harness, { reviewQuality: 'good' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(harness.outcomes.length, 1, '评分提交才写库');
    assert.strictEqual(harness.outcomes[0].recordId, 'record-1');
    assert.strictEqual(harness.outcomes[0].reviewAttemptId, 'attempt-1');
    assert.strictEqual(harness.outcomes[0].quality, 'good');
    assert.ok(harness.outcomes[0].reviewedAt, '必须带评分时间');
    assert.strictEqual(harness.documentStub.getElementById('practice-review-pending-bar'), null, '提交后待评分条应消失');
    assert.strictEqual(harness.flow.getPending(), null);
    assert.strictEqual(harness.windowStub.__refreshCalls, 1, '提交后应刷新复盘队列');
});

test('取消评分与提交失败都不记复盘', async () => {
    const cancelled = loadReviewFlow();
    cancelled.flow.notifyAttemptApplied({ recordId: 'record-1', reviewAttemptId: 'attempt-1' });
    clickBanner(cancelled, { reviewDismiss: 'true' });
    assert.strictEqual(cancelled.outcomes.length, 0, '取消评分不得写库');
    assert.strictEqual(cancelled.documentStub.getElementById('practice-review-pending-bar'), null);
    assert.strictEqual(cancelled.flow.getPending(), null, '取消后本轮作废，需重新进入复盘');

    const failed = loadReviewFlow({ outcomeError: '写库失败' });
    failed.flow.notifyAttemptApplied({ recordId: 'record-1', reviewAttemptId: 'attempt-1' });
    clickBanner(failed, { reviewQuality: 'hard' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(failed.outcomes.length, 1, '尝试过写库');
    assert(failed.flow.getPending(), '写库失败必须保留待评分条，让用户重试');
    assert(failed.documentStub.getElementById('practice-review-pending-bar'), '写库失败后待评分条仍在');
    assert(failed.messages.some((message) => message.type === 'error'), '写库失败应提示用户');
});

test('未入队记录不能发起复盘', async () => {
    const harness = loadReviewFlow({ reviewState: null });
    const started = await harness.flow.start('record-1');
    assert.strictEqual(started, null, '没有复盘计划的记录不得进入复盘');
    assert.strictEqual(harness.windowStub.__replayCalls, undefined, '不得打开回放窗口');
    assert(harness.messages.some((message) => message.type === 'warning'));

    const ok = loadReviewFlow();
    const session = await ok.flow.start('record-1');
    assert(session && session.reviewAttemptId, '入队记录应铸出 attempt 并打开回放');
    assert.strictEqual(ok.windowStub.__replayCalls.length, 1);
    assert.strictEqual(ok.windowStub.__replayCalls[0].opts.reviewAttemptId, session.reviewAttemptId,
        'attempt 必须随回放下发');
});
