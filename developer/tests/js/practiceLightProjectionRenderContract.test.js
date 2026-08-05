#!/usr/bin/env node
/**
 * 练习记录 light 投影 <-> 渲染过滤 的跨文件契约测试。
 *
 * 复现的线上 bug：做完题后记录已写入，控制台打印「已从 AppData 加载 1 条练习摘要」，
 * 但练习记录页面一条都不显示。
 *
 *   - js/data/v2/appData.js `lightFromCanonical` 曾把缺失的 dataSource 回退成 `null`；
 *   - js/main.js `updatePracticeView` 渲染前按 `dataSource === 'real' || === undefined` 过滤；
 *   - `null` 两个都不匹配 => 记录被整条过滤掉 => 界面空白。
 *
 * 本文件用三层防线锁住这个语义：
 *   1. 投影层契约：light 投影产出的 dataSource 必须能通过"最严格的历史过滤条件"。
 *      断言写成"能否通过渲染过滤"，而不是硬编码 'real' 还是 undefined，
 *      这样投影侧无论选哪个合法值都算通过，只有 null 之类的哨兵值会失败。
 *   2. 跨文件端到端：真实 AppData 写入 -> 真实 light 投影读出 -> 真实
 *      js/main.js `updatePracticeView` 渲染，断言记录真的到达了 renderer。
 *      无论未来 light 投影或过滤条件怎么改，只要存进去的记录显示不出来就失败。
 *   3. 同类隐患静态守卫：light 投影里其他 `|| null` 回退字段，不允许出现
 *      只认 `=== undefined` 的下游消费方（反向同理）。
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const APP_DATA_SOURCE = 'js/data/v2/appData.js';
const MAIN_SOURCE = 'js/main.js';
const RECORD_SOURCE_MODULE = 'js/data/practiceRecordSource.js';
const ONBOARDING_SOURCE = 'js/components/onboardingTour.js';

/**
 * 历史上最严格的渲染过滤条件（js/main.js updatePracticeView 引爆此 bug 时的原文）。
 *
 * 故意保留这个"窄"版本作为投影层的契约：light 投影不允许产出任何需要下游放宽
 * 判断才能显示的哨兵值。放宽 main.js 的过滤只是补救，投影侧本身必须是干净的。
 */
const passesRenderFilter = (record) => Boolean(record)
    && (record.dataSource === 'real' || record.dataSource === undefined);

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createMemoryStorage() {
    const values = new Map();
    return {
        get length() { return values.size; },
        key(index) { return Array.from(values.keys())[index] ?? null; },
        getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); }
    };
}

/**
 * 加载真实 AppData 领域代码 + 内存 FakeKernel。
 * IDB-only 内核在 Node 没有 IndexedDB；FakeKernel 只替换持久层，light 投影 / completeAttempt
 * 仍走生产 appData.js，保证投影契约可在 CI 无浏览器时验证。
 */
function loadRealAppData() {
    const catalogSource = readSource('js/data/v2/dataCatalog.js');
    const appDataSource = readSource(APP_DATA_SOURCE);
    const recordSource = readSource(RECORD_SOURCE_MODULE);
    const clone = (value) => (value === undefined ? undefined : structuredClone(value));
    function stable(value) {
        if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }
    function checksum(value) {
        let hash = 0x811c9dc5;
        for (const char of stable(value)) {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 0x01000193);
        }
        return `fnv1a-${(hash >>> 0).toString(16)}`;
    }
    class AppDataError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    const catalogSandbox = { structuredClone };
    catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const shared = {
        docs: new Map(),
        entities: new Map([
            ['practiceSummaries', new Map()],
            ['practiceDetails', new Map()],
            ['practiceAnnotations', new Map()]
        ]),
        counter: 0
    };
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({
        schemaVersion: 2,
        revision,
        operationId,
        updatedAt: new Date().toISOString(),
        state,
        data: state === 'cleared' ? null : clone(data),
        checksum: checksum(state === 'cleared' ? null : data)
    });

    class Kernel {
        async initialize() {
            this.state = 'ready';
            this.backend = 'memory';
            return this;
        }
        async read(key, options = {}) {
            const entry = catalog.get(key);
            const value = shared.docs.get(key) || null;
            const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data;
            return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data);
        }
        async mutate(changes, options = {}) {
            const op = String(options.operationId || `doc-${++shared.counter}`);
            const revisions = {};
            for (const change of changes) {
                const old = shared.docs.get(change.logicalKey);
                if (change.expectedRevision !== undefined
                    && Number(change.expectedRevision) !== Number(old && old.revision || 0)) {
                    throw new AppDataError('CONFLICT', 'document revision');
                }
                const revision = Number(old && old.revision || 0) + 1;
                shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op));
                revisions[change.logicalKey] = revision;
            }
            return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async journalNoop(options = {}) {
            return {
                committed: true,
                operationId: options.operationId || `noop-${++shared.counter}`,
                revisions: {},
                derived: { status: 'ready', pending: [] },
                warnings: []
            };
        }
        async readEntity(store, recordId, options = {}) {
            const row = shared.entities.get(store).get(String(recordId)) || null;
            return options.withMeta ? clone(row) : row && clone(row.data);
        }
        async listEntities(store, options = {}) {
            if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable');
            const rows = Array.from(shared.entities.get(store).values());
            return options.withMeta ? clone(rows) : rows.map((row) => clone(row.data));
        }
        async mutateEntities(operations, options = {}) {
            const op = String(options.operationId || `entity-${++shared.counter}`);
            const revisions = {};
            for (const item of operations) {
                const rows = shared.entities.get(item.store);
                if (item.type === 'clear') {
                    rows.clear();
                    revisions[`${item.store}/*`] = 0;
                    continue;
                }
                const old = rows.get(String(item.recordId));
                if (item.expectedRevision !== undefined && item.expectedRevision !== null
                    && Number(item.expectedRevision) !== Number(old && old.revision || 0)) {
                    throw new AppDataError('CONFLICT', 'entity revision');
                }
                if (item.type === 'delete') {
                    rows.delete(String(item.recordId));
                    revisions[`${item.store}/${item.recordId}`] = Number(old && old.revision || 0) + 1;
                } else {
                    const row = {
                        recordId: String(item.recordId),
                        revision: Number(old && old.revision || 0) + 1,
                        operationId: op,
                        updatedAt: new Date().toISOString(),
                        data: clone(item.data),
                        checksum: checksum(item.data)
                    };
                    rows.set(row.recordId, row);
                    revisions[`${item.store}/${item.recordId}`] = row.revision;
                }
            }
            return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async exportSnapshot() {
            const envelopes = {};
            for (const [key, value] of shared.docs) {
                if (catalog.get(key).export === true) envelopes[key] = clone(value);
            }
            const entities = Object.fromEntries(
                Array.from(shared.entities, ([store, rows]) => [store, Array.from(rows.values()).map(clone)])
            );
            const snapshot = {
                format: 'ielts-atlas-data-v2',
                schemaVersion: 2,
                scope: 'full',
                envelopes,
                entities
            };
            snapshot.checksum = checksum({ envelopes, entities });
            return snapshot;
        }
        async installSnapshot(snapshot, options = {}) {
            for (const [key, value] of Object.entries(snapshot.envelopes || {})) shared.docs.set(key, clone(value));
            for (const [store, rows] of Object.entries(snapshot.entities || {})) {
                shared.entities.set(store, new Map(rows.map((row) => [String(row.recordId), clone(row)])));
            }
            return {
                committed: true,
                operationId: options.operationId || `install-${++shared.counter}`,
                revisions: {},
                derived: { status: 'ready', pending: [] },
                warnings: []
            };
        }
        onCommitted() { return () => {}; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }

    const internals = {
        DataKernel: Kernel,
        AppDataError,
        catalog,
        clone,
        checksum,
        randomId: (prefix) => `${prefix}-${++shared.counter}`,
        nowIso: () => new Date().toISOString(),
        makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId),
        validateEnvelope: (_entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data))
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        Date,
        JSON,
        Math,
        Map,
        Set,
        Promise,
        structuredClone,
        setTimeout,
        clearTimeout,
        __AppDataV2Internals: internals,
        localStorage: createMemoryStorage(),
        sessionStorage: createMemoryStorage()
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(recordSource, context, { filename: RECORD_SOURCE_MODULE });
    vm.runInContext(appDataSource, context, { filename: APP_DATA_SOURCE });
    return sandbox.AppData;
}

/**
 * 在 VM 里加载真实的 js/main.js 并暴露真实的 updatePracticeView。
 * 只 stub 渲染出口（PracticeHistoryRenderer）和最小 DOM，过滤逻辑本身是生产代码。
 *
 * 同时加载 js/data/practiceRecordSource.js —— 这是"什么算真实练习记录"的唯一权威判定，
 * 线上由 browse.bundle.js 与 main.js 同批提供（core-foundation 也内联同一份供投影器使用）。
 * 不加载它，main.js 会走"分类器缺失"的保底分支并放行全部记录，演示记录过滤将测不到。
 */
function loadRealPracticeView() {
    const renderedBatches = [];
    const summaries = [];
    const historyContainer = {
        id: 'history-list',
        innerHTML: '',
        addEventListener() {},
        contains() { return false; }
    };
    const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
    const sandbox = {
        console: quietConsole,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        // updatePracticeView 用到的少量顶层协作函数（真实实现在其他 bundle 成员里）。
        getBulkDeleteModeState: () => false,
        getSelectedRecordsState: () => new Set(),
        document: {
            addEventListener() {},
            getElementById(id) {
                return id === 'history-list' ? historyContainer : null;
            },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() {
                return {
                    style: {},
                    classList: { add() {}, remove() {} },
                    appendChild() {},
                    setAttribute() {}
                };
            }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.window.location = { origin: 'http://localhost' };
    sandbox.window.addEventListener = () => {};
    sandbox.window.PracticeHistoryRenderer = {
        renderView(options) {
            // Array.from：records 来自 VM realm，跨 realm 数组的原型不同，
            // 直接 slice() 会让 deepStrictEqual 因原型不一致而误报。
            renderedBatches.push(Array.from(options && Array.isArray(options.records) ? options.records : []));
            return { scroller: null };
        }
    };
    sandbox.window.PracticeDashboardView = null;
    // 汇总卡片（已练题数等）也读同一份过滤结果，一起观测。
    sandbox.window.PracticeStats = {
        calculateSummary(records) {
            summaries.push(Array.from(records));
            return { totalPracticed: records.length, averageScore: 0, totalStudyMinutes: 0, streak: 0 };
        },
        sortByDateDesc(records) {
            return records.slice().sort((left, right) => new Date(right.date) - new Date(left.date));
        }
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(readSource(RECORD_SOURCE_MODULE), context, { filename: RECORD_SOURCE_MODULE });
    vm.runInContext(readSource(MAIN_SOURCE), context, { filename: MAIN_SOURCE });
    assert.strictEqual(typeof sandbox.updatePracticeView, 'function',
        'js/main.js 必须暴露顶层 updatePracticeView，否则本测试的观测点已失效');
    assert.strictEqual(typeof sandbox.PracticeRecordSource?.isRealPracticeRecord, 'function',
        'PracticeRecordSource 必须已安装，否则 main.js 会走保底分支放行全部记录，过滤断言形同虚设');

    return {
        updatePracticeView: sandbox.updatePracticeView,
        recordSource: sandbox.PracticeRecordSource,
        renderedBatches,
        summaries,
        lastRenderedIds() {
            const last = renderedBatches.at(-1) || [];
            return Array.from(last, (record) => String(record && record.id || '')).sort();
        },
        lastSummaryIds() {
            const last = summaries.at(-1) || [];
            return Array.from(last, (record) => String(record && record.id || '')).sort();
        }
    };
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createManualClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        setTimeout(callback, delay = 0) {
            const id = nextId++;
            timers.set(id, { callback, dueAt: now + Number(delay || 0) });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        advance(milliseconds) {
            const target = now + milliseconds;
            while (true) {
                const due = Array.from(timers.entries())
                    .filter(([, timer]) => timer.dueAt <= target)
                    .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
                if (!due) break;
                const [id, timer] = due;
                timers.delete(id);
                now = timer.dueAt;
                timer.callback();
            }
            now = target;
        },
        pendingDelay(delay) {
            return Array.from(timers.values()).filter((timer) => timer.dueAt - now === delay).length;
        }
    };
}

function createOnboardingSandbox({ resolveIndex, completeAttempt, clock = null }) {
    const previewIds = new Set();
    const deletedIds = [];
    let refreshCount = 0;
    let queryCount = 0;
    const elementsById = new Map();
    const makeClassList = () => {
        const values = new Set();
        return {
            add(...names) { names.forEach((name) => values.add(name)); },
            remove(...names) { names.forEach((name) => values.delete(name)); },
            contains(name) { return values.has(name); }
        };
    };
    const makeElement = (tagName = 'div') => {
        const element = {
            tagName: String(tagName).toUpperCase(),
            style: {},
            dataset: {},
            classList: makeClassList(),
            children: [],
            innerHTML: '',
            offsetWidth: 320,
            offsetHeight: 160,
            appendChild(child) {
                this.children.push(child);
                child.parentNode = this;
                if (child.id) elementsById.set(child.id, child);
                return child;
            },
            remove() {
                if (this.parentNode) {
                    const index = this.parentNode.children.indexOf(this);
                    if (index >= 0) this.parentNode.children.splice(index, 1);
                    this.parentNode = null;
                }
                if (this.id) elementsById.delete(this.id);
            },
            addEventListener() {},
            removeEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            getBoundingClientRect() {
                return { top: 100, left: 100, right: 200, bottom: 140, width: 100, height: 40 };
            },
            scrollIntoView() {}
        };
        return element;
    };
    const body = makeElement('body');
    const documentElement = makeElement('html');
    documentElement.scrollTop = 0;
    const document = {
        body,
        documentElement,
        createElement: makeElement,
        getElementById(id) { return elementsById.get(id) || null; },
        querySelector() { queryCount += 1; return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {}
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        document,
        setTimeout: clock ? clock.setTimeout : setTimeout,
        clearTimeout: clock ? clock.clearTimeout : clearTimeout,
        requestAnimationFrame(callback) { callback(); },
        CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        innerWidth: 1280,
        innerHeight: 800,
        scrollY: 0,
        scrollTo() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        resolveActiveLibraryIndex: resolveIndex,
        syncPracticeRecords: async () => { refreshCount += 1; },
        PracticeRecordSource: {
            allowPreviewRecordId(id) { previewIds.add(String(id)); },
            clearPreviewRecordId(id) { previewIds.delete(String(id)); }
        },
        AppData: {
            ready: Promise.resolve(),
            preferences: {
                async getOnboarding() { return {}; },
                async setOnboarding() {}
            },
            practice: {
                completeAttempt,
                async delete({ recordId }) { deletedIds.push(String(recordId)); }
            }
        }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(readSource(ONBOARDING_SOURCE), context, { filename: ONBOARDING_SOURCE });
    sandbox.OnboardingTour.registerSteps([{
        id: 'review',
        activateView: null,
        subSteps: [{ id: 'inject', action: 'injectDemoRecord', target: null }]
    }]);
    return {
        api: sandbox.OnboardingTour,
        previewIds,
        deletedIds,
        body,
        getRefreshCount: () => refreshCount,
        getQueryCount: () => queryCount
    };
}

async function flushAsyncWork(turns = 4) {
    for (let index = 0; index < turns; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

async function flushPromiseWork(turns = 16) {
    for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

/** 提取 appData.js 里 lightFromCanonical 的函数体，用于静态字段分析。 */
function extractLightProjectionBody(source) {
    const match = source.match(/function lightFromCanonical\(source\)\s*\{[\s\S]*?\n    \}/);
    assert(match, 'appData.js 中必须存在 lightFromCanonical，静态守卫依赖它定位投影字段');
    return match[0];
}

/** 找出 light 投影里"取不到值就落到某个哨兵"的字段。 */
function classifyProjectionFallbacks(body) {
    const nullFallback = [];
    const undefinedFallback = [];
    for (const line of body.split('\n')) {
        const field = line.match(/^\s*([A-Za-z0-9_]+):\s*(.*)$/);
        if (!field) continue;
        const [, name, expression] = field;
        if (/(\|\||\?\?)\s*null\b/.test(expression) || /==\s*null\s*\?\s*null\b/.test(expression)) {
            nullFallback.push(name);
        }
        if (/(\|\||\?\?)\s*undefined\b/.test(expression)) {
            undefinedFallback.push(name);
        }
    }
    return { nullFallback, undefinedFallback };
}

function collectSourceFiles(directory, files = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            // bundles 是构建产物，源码守住即可，避免同一处问题重复报告。
            if (entry.name === 'node_modules' || entry.name === 'bundles') continue;
            collectSourceFiles(fullPath, files);
            continue;
        }
        if (entry.name.endsWith('.js')) files.push(fullPath);
    }
    return files;
}

// ---------------------------------------------------------------------------
// 1. 投影层契约：dataSource 语义
// ---------------------------------------------------------------------------

async function testLightProjectionDataSourcePassesRenderFilter() {
    const app = loadRealAppData();
    await app.ready;

    // 三种真实形态：显式 dataSource / 完全缺失 / 只在 metadata 里。
    await app.practice.completeAttempt({
        operationId: 'light-ds-explicit',
        record: {
            id: 'ds-explicit', sessionId: 'ds-explicit', examId: 'reading-explicit', type: 'reading',
            dataSource: 'real', totalQuestions: 4, correctAnswers: 3, duration: 90,
            date: '2026-07-20T10:00:00.000Z'
        }
    });
    await app.practice.completeAttempt({
        operationId: 'light-ds-absent',
        record: {
            id: 'ds-absent', sessionId: 'ds-absent', examId: 'reading-absent', type: 'reading',
            totalQuestions: 4, correctAnswers: 2, duration: 80,
            date: '2026-07-20T11:00:00.000Z'
        }
    });
    await app.practice.completeAttempt({
        operationId: 'light-ds-metadata',
        record: {
            id: 'ds-metadata', sessionId: 'ds-metadata', examId: 'reading-metadata', type: 'reading',
            metadata: { dataSource: 'real', examTitle: 'metadata only' },
            totalQuestions: 4, correctAnswers: 1, duration: 70,
            date: '2026-07-20T12:00:00.000Z'
        }
    });

    const listed = await app.practice.list({ projection: 'light' });
    const byId = new Map(listed.map((record) => [String(record.id), record]));

    const explicit = byId.get('ds-explicit');
    assert(explicit, 'practice.list light 必须包含显式带 dataSource 的记录');
    assert.strictEqual(explicit.dataSource, 'real',
        'light 投影必须原样保留记录自带的 dataSource');
    assert(passesRenderFilter(explicit),
        '带 dataSource: "real" 的记录必须能通过练习记录渲染过滤');

    const metadataOnly = byId.get('ds-metadata');
    assert(metadataOnly, 'practice.list light 必须包含仅 metadata 带 dataSource 的记录');
    assert.strictEqual(metadataOnly.dataSource, 'real',
        'light 投影必须从 metadata.dataSource 取出 dataSource');
    assert(passesRenderFilter(metadataOnly),
        '仅 metadata.dataSource 带值的记录必须能通过练习记录渲染过滤');

    const absent = byId.get('ds-absent');
    assert(absent, 'practice.list light 必须包含不带 dataSource 的记录');
    // 这是本 bug 的核心断言：不硬编码期望值，只要求"能被渲染"。
    // `|| null` 回退会在这里失败（null 既不是 'real' 也不是 undefined）。
    assert(passesRenderFilter(absent),
        'dataSource 缺失时 light 投影的回退值必须能通过渲染过滤'
        + `（'real' 或 undefined 均可，禁止 null 等哨兵值），实际得到 ${JSON.stringify(absent.dataSource)}`);
    assert.notStrictEqual(absent.dataSource, null,
        'light 投影禁止把缺失的 dataSource 写成 null：消费方按 === undefined 判缺失，null 会让记录整条消失');

    // practice.get 与 detail 投影共用同一条回退链，必须同样安全。
    const fetchedLight = await app.practice.get('ds-absent', { projection: 'light' });
    assert(passesRenderFilter(fetchedLight),
        'practice.get light 投影的 dataSource 回退必须与 practice.list 一致且可渲染');
    const fetchedDetail = await app.practice.get('ds-absent', { projection: 'detail' });
    assert(passesRenderFilter(fetchedDetail),
        'detail 投影复用 lightFromCanonical，dataSource 回退同样不得阻断渲染');

    // 全量投影不做回退，保持原样（缺失即缺失），确认没有反向污染权威数据。
    const canonical = await app.practice.get('ds-absent');
    assert(passesRenderFilter(canonical),
        '全量 canonical 记录本来就没有 dataSource，必须仍然可渲染');
}

async function testFalsyDataSourcesPreserveProjectionAndJudgement() {
    const app = loadRealAppData();
    await app.ready;
    const classifier = loadRealPracticeView().recordSource;
    const fixtures = [
        { id: 'top-false', record: { dataSource: false }, expected: false },
        { id: 'top-zero', record: { dataSource: 0 }, expected: false },
        { id: 'top-empty', record: { dataSource: '' }, expected: true },
        { id: 'top-null', record: { dataSource: null }, expected: true },
        { id: 'metadata-false', record: { metadata: { dataSource: false } }, expected: false },
        { id: 'metadata-zero', record: { metadata: { dataSource: 0 } }, expected: false },
        { id: 'metadata-empty', record: { metadata: { dataSource: '' } }, expected: true },
        { id: 'metadata-null', record: { metadata: { dataSource: null } }, expected: true },
        { id: 'top-demo', record: { dataSource: 'demo' }, expected: false },
        { id: 'top-e2e', record: { dataSource: 'e2e-seed' }, expected: false },
        { id: 'metadata-onboarding', record: { metadata: { source: 'onboarding-demo' } }, expected: false },
        {
            id: 'top-null-wins',
            record: { dataSource: null, metadata: { dataSource: 'demo' } },
            expected: true
        }
    ];

    for (const [index, fixture] of fixtures.entries()) {
        await app.practice.completeAttempt({
            operationId: `falsy-source-${fixture.id}`,
            record: buildFixtureRecord(fixture, index)
        });
    }

    for (const fixture of fixtures) {
        const projections = await Promise.all(['full', 'light', 'detail'].map((projection) => (
            app.practice.get(fixture.id, { projection })
        )));
        const hasTopDataSource = Object.prototype.hasOwnProperty.call(fixture.record, 'dataSource');
        const metadataHasDataSource = Object.prototype.hasOwnProperty.call(fixture.record.metadata || {}, 'dataSource');
        const expectedValue = hasTopDataSource
            ? fixture.record.dataSource
            : (metadataHasDataSource ? fixture.record.metadata.dataSource : undefined);

        for (const [index, projection] of projections.entries()) {
            const projectionName = ['full', 'light', 'detail'][index];
            assert.strictEqual(classifier.isRealPracticeRecord(projection), fixture.expected,
                `${fixture.id} 的 ${projectionName} isReal 结果必须一致`);
            if (hasTopDataSource || (metadataHasDataSource && projectionName !== 'full')) {
                assert(Object.prototype.hasOwnProperty.call(projection, 'dataSource'),
                    `${fixture.id} 的 ${projectionName} 投影必须保留显式 dataSource 属性`);
                assert.strictEqual(projection.dataSource, expectedValue,
                    `${fixture.id} 的 ${projectionName} 投影不得吞掉或改写 falsy dataSource`);
            }
            if (metadataHasDataSource) {
                assert.strictEqual(projection.metadata.dataSource, fixture.record.metadata.dataSource,
                    `${fixture.id} 的 ${projectionName} metadata.dataSource 必须原样保留`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 2. 跨文件端到端：存进去的记录必须显示出来
// ---------------------------------------------------------------------------

async function testStoredRecordsReachRenderedHistoryList() {
    const app = loadRealAppData();
    await app.ready;

    // 一条真实形态的练习记录：走 examSessionMixin / practiceRecorder 的字段布局。
    const realShapedRecord = {
        id: 'session-real-shape',
        sessionId: 'session-real-shape',
        examId: 'reading-p1-real',
        title: 'Reading P1 Real Shape',
        type: 'reading',
        category: 'P1',
        startTime: '2026-07-21T09:00:00.000Z',
        endTime: '2026-07-21T09:20:00.000Z',
        date: '2026-07-21T09:20:00.000Z',
        duration: 1200,
        totalQuestions: 13,
        correctAnswers: 11,
        accuracy: 11 / 13,
        percentage: 84.6,
        dataSource: 'real',
        isRealData: true,
        scoreInfo: { correct: 11, total: 13, accuracy: 11 / 13, percentage: 84.6, source: 'data_collector' },
        realData: { isRealData: true, answers: { q1: 'A' }, scoreInfo: { correct: 11, total: 13 } },
        metadata: { examTitle: 'Reading P1 Real Shape', category: 'P1' }
    };
    // 同批再放一条历史形态：没人写过 dataSource（迁移记录 / 老版本落库）。
    const unlabelledRecord = {
        id: 'session-unlabelled',
        sessionId: 'session-unlabelled',
        examId: 'reading-p2-unlabelled',
        title: 'Reading P2 Unlabelled',
        type: 'reading',
        date: '2026-07-21T10:00:00.000Z',
        duration: 900,
        totalQuestions: 13,
        correctAnswers: 7,
        percentage: 53.8
    };

    await app.practice.completeAttempt({ operationId: 'e2e-real-shape', record: realShapedRecord });
    await app.practice.completeAttempt({ operationId: 'e2e-unlabelled', record: unlabelledRecord });

    const summaries = await app.practice.list({ projection: 'light' });
    assert.strictEqual(summaries.length, 2,
        '两条记录都必须落进 practice.summaries light 投影');

    // 2a. 投影结果本身必须能通过渲染过滤（与 main.js 解耦的独立断言）。
    for (const summary of summaries) {
        assert(passesRenderFilter(summary),
            `存入的记录 ${summary.id} 的 light 投影必须能通过渲染过滤，`
            + `实际 dataSource=${JSON.stringify(summary.dataSource)}`);
    }

    // 2b. 真正跑一遍生产渲染入口：AppData 存进去的东西必须出现在历史列表里。
    // 这一层不复刻任何过滤条件，是"存了就必须能看见"的本质保护。
    const view = loadRealPracticeView();
    view.updatePracticeView(summaries, [
        { id: 'reading-p1-real', title: 'Reading P1 Real Shape', type: 'reading', category: 'P1' },
        { id: 'reading-p2-unlabelled', title: 'Reading P2 Unlabelled', type: 'reading', category: 'P2' }
    ]);

    assert.strictEqual(view.renderedBatches.length, 1,
        'updatePracticeView 必须把过滤后的记录交给 PracticeHistoryRenderer 渲染一次');
    assert.deepStrictEqual(
        view.lastRenderedIds(),
        ['session-real-shape', 'session-unlabelled'],
        '经 AppData.practice.completeAttempt 存入并以 light 投影读出的记录，必须全部出现在渲染列表中'
        + '（一条都不显示 = 用户线上遇到的空白练习记录页）'
    );
    assert.deepStrictEqual(
        view.lastSummaryIds(),
        ['session-real-shape', 'session-unlabelled'],
        '汇总卡片（已练题数/正确率）必须与历史列表看到同一批记录，不能被同一个过滤条件吃掉'
    );
}

async function testRenderFilterKeepsUnlabelledRecordsAfterProjectionChange() {
    // 防止过滤条件被再次收窄：直接把 light 投影可能产出的每种 dataSource 形态
    // 喂给真实 updatePracticeView，只允许"明确的非真实来源"被排除。
    const view = loadRealPracticeView();
    const app = loadRealAppData();
    await app.ready;

    await app.practice.completeAttempt({
        operationId: 'filter-shape-probe',
        record: { id: 'probe', sessionId: 'probe', examId: 'reading-probe', type: 'reading', date: '2026-07-22T09:00:00.000Z' }
    });
    const [projected] = await app.practice.list({ projection: 'light' });
    assert(projected, 'light 投影必须产出探针记录');

    // 用真实投影产出的形态克隆出多条记录，逐一确认它们都能显示。
    const shapes = [
        { id: 'shape-projected', record: { ...projected, id: 'shape-projected' } },
        { id: 'shape-real', record: { ...projected, id: 'shape-real', dataSource: 'real' } },
        { id: 'shape-absent', record: (() => { const next = { ...projected, id: 'shape-absent' }; delete next.dataSource; return next; })() }
    ];
    view.updatePracticeView(shapes.map((shape) => shape.record), []);
    assert.deepStrictEqual(
        view.lastRenderedIds(),
        ['shape-absent', 'shape-projected', 'shape-real'],
        'light 投影实际产出的 dataSource 形态（含缺失）必须全部通过 updatePracticeView 的渲染过滤'
    );
}

// ---------------------------------------------------------------------------
// 2b. 演示/种子记录：UI、stats、achievements 三处判定必须一致
//
// 修复的 bug：判定被复制成两套语义不同的实现 ——
//   - js/main.js 只看顶层 dataSource（排除 'demo' / 'e2e-seed'）；
//   - appData.js 投影器只看 metadata.source === 'onboarding-demo'。
// 于是 demo / e2e-seed 记录"在练习记录页看不见，却计入成绩统计和成就解锁"，
// 用户会看到自己没做过的题影响了正确率与成就。
//
// 本节的核心断言不是"某个具体值被排除"，而是**三处结论逐条一致**：
// 只要 UI 与两个投影器对同一条记录给出不同结论，测试就失败。
// ---------------------------------------------------------------------------

/** 演示/种子记录的各种真实形态（含两个维度的组合）。 */
const DEMO_RECORD_FIXTURES = Object.freeze([
    {
        id: 'demo-datasource',
        why: '顶层 dataSource: "demo"',
        record: { dataSource: 'demo' }
    },
    {
        id: 'demo-e2e-seed',
        why: '顶层 dataSource: "e2e-seed"（测试/夹具种子数据）',
        record: { dataSource: 'e2e-seed' }
    },
    {
        id: 'demo-onboarding-metadata',
        why: 'metadata.source: "onboarding-demo"（js/components/onboardingTour.js 注入的引导演示记录）',
        record: { metadata: { source: 'onboarding-demo', examTitle: '示例练习' } }
    },
    {
        id: 'demo-metadata-datasource',
        why: 'metadata.dataSource: "demo"（light 投影会把它提到顶层）',
        record: { metadata: { dataSource: 'demo' } }
    },
    {
        id: 'demo-both-dimensions',
        why: '两个维度同时标注为演示数据',
        record: { dataSource: 'demo', metadata: { source: 'onboarding-demo' } }
    }
]);

/** 必须被当作真实练习的形态 —— 尤其包含"dataSource 缺失"（曾被收窄导致整页空白）。 */
const REAL_RECORD_FIXTURES = Object.freeze([
    {
        id: 'real-explicit',
        why: '显式 dataSource: "real"',
        record: { dataSource: 'real' }
    },
    {
        id: 'real-absent',
        why: 'dataSource 完全缺失（迁移记录 / 套题聚合 / 听力桥接从不写该字段）',
        record: {}
    },
    {
        id: 'real-metadata-only',
        why: '仅 metadata.dataSource: "real"',
        record: { metadata: { dataSource: 'real' } }
    },
    {
        id: 'real-suite-source-label',
        why: 'metadata.source: "listening" —— 该字段被复用为内容类型标签，不得当成演示标记',
        record: { metadata: { source: 'listening' } }
    },
    {
        id: 'real-collector-source-label',
        why: 'metadata.source: "practice_page" —— 采集方式标签，不得当成演示标记',
        record: { metadata: { source: 'practice_page' } }
    },
    {
        id: 'real-empty-datasource',
        why: 'dataSource 为空串（历史脏数据），按缺失处理',
        record: { dataSource: '' }
    }
]);

function buildFixtureRecord(fixture, index) {
    const base = {
        id: fixture.id,
        sessionId: fixture.id,
        examId: `reading-${fixture.id}`,
        title: fixture.id,
        type: 'reading',
        // 每条给足 1 题 1 对：这样"是否计入"在 stats 上体现为可观测的数值差异。
        totalQuestions: 1,
        correctAnswers: 1,
        accuracy: 1,
        duration: 60,
        // 时间各不相同，保证成就解锁时间戳有确定顺序。
        date: `2026-07-2${index % 9}T09:00:00.000Z`,
        completedAt: `2026-07-2${index % 9}T09:00:00.000Z`
    };
    const merged = Object.assign(base, fixture.record);
    if (fixture.record.metadata) {
        merged.metadata = Object.assign({}, fixture.record.metadata);
    }
    return merged;
}

async function testDemoRecordsAreExcludedFromViewStatsAndAchievements() {
    const app = loadRealAppData();
    await app.ready;
    const view = loadRealPracticeView();

    const fixtures = [...REAL_RECORD_FIXTURES, ...DEMO_RECORD_FIXTURES];
    for (const [index, fixture] of fixtures.entries()) {
        await app.practice.completeAttempt({
            operationId: `demo-contract-${fixture.id}`,
            record: buildFixtureRecord(fixture, index)
        });
    }

    const realIds = REAL_RECORD_FIXTURES.map((fixture) => fixture.id).sort();
    const summaries = await app.practice.list({ projection: 'light' });
    assert.strictEqual(summaries.length, fixtures.length,
        '演示记录同样是权威数据，必须完整落库；排除只发生在展示与派生统计层');

    // --- 1) UI：练习记录列表与汇总卡片都不能出现演示记录 ---
    view.updatePracticeView(summaries, []);
    assert.deepStrictEqual(view.lastRenderedIds(), realIds,
        '练习记录列表必须只渲染真实记录：演示/种子记录要被排除，而所有真实形态'
        + '（含 dataSource 缺失）必须保留');
    assert.deepStrictEqual(view.lastSummaryIds(), realIds,
        '汇总卡片必须与历史列表看到同一批记录');

    // --- 2) stats 投影器：演示记录不得计入成绩统计 ---
    const stats = await app.practice.getStats();
    assert.strictEqual(stats.totalPractices, REAL_RECORD_FIXTURES.length,
        `practice.stats 只能统计真实记录：期望 ${REAL_RECORD_FIXTURES.length} 条，`
        + `实际 ${stats.totalPractices} 条（多出来的就是被计入的演示/种子记录 —— `
        + '用户会看到"我没做这些题，为什么成绩变了"）');
    assert.strictEqual(stats.totalQuestions, REAL_RECORD_FIXTURES.length,
        'practice.stats 的题目数同样不得包含演示记录的题目');
    assert.strictEqual(stats.correctAnswers, REAL_RECORD_FIXTURES.length,
        'practice.stats 的正确数同样不得包含演示记录的作答');

    // --- 3) achievements 投影器：演示记录不得推进成就解锁 ---
    // 6 条真实记录只够解锁 first_step；若把 5 条演示记录也算进去就是 11 条，
    // 会额外解锁 practice_bronze（累计 10 次练习）。用它当"是否混入"的探针。
    const achievements = await app.achievements.getAll();
    assert(achievements.first_step && achievements.first_step.unlockedAt,
        '真实记录必须能正常解锁成就（first_step）');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(achievements, 'practice_bronze'), false,
        'achievements.progress 不得把演示/种子记录计入练习次数：'
        + `只有 ${REAL_RECORD_FIXTURES.length} 条真实记录时 practice_bronze（10 次）必须仍未解锁`);
}

async function testDemoJudgementIsIdenticalAcrossViewStatsAndAchievements() {
    // 本次修复的核心契约：三处判定必须逐条一致。
    // 做法是对每条 fixture 单独观测三个消费方的结论，再互相比对 —— 不比对某个硬编码期望值，
    // 这样无论未来判定规则怎么变，只要三处出现分歧就立刻失败（正是当前 bug 的形态）。
    const view = loadRealPracticeView();
    const fixtures = [...REAL_RECORD_FIXTURES, ...DEMO_RECORD_FIXTURES];
    const disagreements = [];

    for (const [index, fixture] of fixtures.entries()) {
        // 每条 fixture 用独立的 AppData 实例，避免相互影响统计阈值。
        const app = loadRealAppData();
        await app.ready;
        await app.practice.completeAttempt({
            operationId: `judgement-${fixture.id}`,
            record: buildFixtureRecord(fixture, index)
        });

        const summaries = await app.practice.list({ projection: 'light' });
        assert.strictEqual(summaries.length, 1, `${fixture.id} 必须落库为唯一一条权威记录`);

        view.updatePracticeView(summaries, []);
        const inView = view.lastRenderedIds().includes(fixture.id);

        const stats = await app.practice.getStats();
        const inStats = stats.totalPractices === 1;

        const achievements = await app.achievements.getAll();
        const inAchievements = Boolean(achievements.first_step && achievements.first_step.unlockedAt);

        if (!(inView === inStats && inStats === inAchievements)) {
            disagreements.push(
                `${fixture.id}（${fixture.why}）: 列表=${inView} stats=${inStats} achievements=${inAchievements}`
            );
        }
    }

    assert.deepStrictEqual(disagreements, [],
        '“什么算真实练习记录”必须只有一份判定：练习记录列表、practice.stats、'
        + 'achievements.progress 对同一条记录的结论必须完全相同。\n'
        + '出现分歧意味着判定又被复制成了多套实现（这正是"记录看不见却计入统计"的成因）：\n'
        + disagreements.join('\n'));
}

async function testDemoJudgementHasSingleImplementation() {
    // 静态守卫：防止任何一方悄悄写回本地副本。
    // 判定实现必须只存在于 js/data/practiceRecordSource.js。
    const classifierSource = readSource(RECORD_SOURCE_MODULE);
    assert(classifierSource.includes('function isRealPracticeRecord'),
        `${RECORD_SOURCE_MODULE} 必须是判定的唯一实现处`);

    for (const [relativePath, mustReference] of [[MAIN_SOURCE, 'PracticeRecordSource'], [APP_DATA_SOURCE, 'PracticeRecordSource']]) {
        assert(readSource(relativePath).includes(mustReference),
            `${relativePath} 必须通过 ${mustReference} 复用统一判定，不得自建副本`);
    }

    // 旧的本地实现名不得复活（appData.js 的 isDemoRecord 只看 metadata.source）。
    assert(!readSource(APP_DATA_SOURCE).includes('function isDemoRecord'),
        'appData.js 不得恢复本地 isDemoRecord：它只看 metadata.source，与 UI 侧语义不一致');

    // main.js 不得再内联 dataSource 的逐值比较（这是旧 UI 判定的形态）。
    const mainSource = readSource(MAIN_SOURCE);
    const inlinedDataSourceComparison = mainSource
        .split('\n')
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
        .filter(({ line }) => /dataSource\s*===\s*['"]real['"]/.test(line));
    assert.deepStrictEqual(inlinedDataSourceComparison, [],
        'js/main.js 不得内联 `dataSource === "real"` 判定：必须走 PracticeRecordSource，'
        + '否则会与 stats/achievements 投影器再次分叉：\n'
        + inlinedDataSourceComparison.map((item) => `  ${MAIN_SOURCE}:${item.lineNumber} ${item.line}`).join('\n'));
}

async function testOnboardingPreviewIsViewOnly() {
    // 引导演示记录是唯一需要"看得见但不计入"的例外：
    // 它必须能在列表里渲染（引导要教用户认识那一行），但绝不能进 stats/achievements。
    // 例外只存在于视图层白名单，投影器读不到 —— 判定本身仍然只有一份。
    const app = loadRealAppData();
    await app.ready;
    const view = loadRealPracticeView();
    const DEMO_ID = 'demo-onboarding-record';

    await app.practice.completeAttempt({
        operationId: 'onboarding-preview-real',
        record: buildFixtureRecord({ id: 'real-alongside-demo', record: {} }, 1)
    });
    await app.practice.completeAttempt({
        operationId: 'onboarding-preview-demo',
        record: buildFixtureRecord({
            id: DEMO_ID,
            record: { metadata: { source: 'onboarding-demo', examTitle: '示例练习' } }
        }, 2)
    });

    const summaries = await app.practice.list({ projection: 'light' });

    // 未登记预览：演示记录必须不可见。
    view.updatePracticeView(summaries, []);
    assert.deepStrictEqual(view.lastRenderedIds(), ['real-alongside-demo'],
        '未登记预览许可时，引导演示记录必须与其他演示记录一样被排除');

    // 登记预览后：仅该 id 可见，其它演示记录仍被排除。
    view.recordSource.allowPreviewRecordId(DEMO_ID);
    assert.strictEqual(view.recordSource.isPreviewRecord({
        id: DEMO_ID,
        dataSource: 'demo',
        metadata: { source: 'demo' }
    }), false, '仅 id 匹配但没有 onboarding marker 的演示记录不得借用引导预览许可');
    assert.strictEqual(view.recordSource.isPreviewRecord({
        id: 'different-record',
        sessionId: DEMO_ID,
        metadata: { source: 'onboarding-demo' }
    }), false, '仅 sessionId 命中不得越权放行其它非真实记录');
    assert.strictEqual(view.recordSource.isPreviewRecord({
        id: DEMO_ID,
        metadata: { source: 'onboarding-demo' }
    }), true, 'preview 必须只放行 id 与 onboarding marker 同时匹配的记录');
    view.updatePracticeView(summaries, []);
    assert.deepStrictEqual(view.lastRenderedIds(), [DEMO_ID, 'real-alongside-demo'].sort(),
        '登记预览许可后，引导演示记录必须能在练习记录列表中渲染（引导步骤依赖这一行）');

    // 关键：预览许可绝不能泄漏到 stats / achievements。
    const stats = await app.practice.getStats();
    assert.strictEqual(stats.totalPractices, 1,
        '引导预览许可只影响渲染：practice.stats 必须仍然只统计那 1 条真实记录');
    assert.strictEqual(view.recordSource.isRealPracticeRecord(
        summaries.find((record) => String(record.id) === DEMO_ID)
    ), false, '预览许可不得改变"是否真实记录"的判定本身，否则投影器也会被污染');

    // 撤销许可后立即恢复排除（引导结束/跳过时调用）。
    view.recordSource.clearPreviewRecordId(DEMO_ID);
    view.updatePracticeView(summaries, []);
    assert.deepStrictEqual(view.lastRenderedIds(), ['real-alongside-demo'],
        '撤销预览许可后，引导演示记录必须立刻从练习记录列表消失');
}

async function testOnboardingStopCancelsPendingInjectionLifecycle() {
    const indexDeferred = createDeferred();
    let completeCalls = 0;
    const harness = createOnboardingSandbox({
        resolveIndex: () => indexDeferred.promise,
        completeAttempt: async () => { completeCalls += 1; }
    });

    harness.api.start(true);
    harness.api.stop();
    indexDeferred.resolve([]);
    await flushAsyncWork();

    assert.strictEqual(completeCalls, 0,
        'stop 后尚未开始的异步注入不得继续落库');
    assert.strictEqual(harness.previewIds.size, 0,
        'stop 必须立即撤销 onboarding preview 许可');
    assert(harness.deletedIds.includes('demo-onboarding-record'),
        'stop 必须走演示记录清理路径');
}

async function testOnboardingStopCompensatesInFlightWriteWithoutInjectionRefresh() {
    const writeDeferred = createDeferred();
    let completeCalls = 0;
    const harness = createOnboardingSandbox({
        resolveIndex: async () => [],
        completeAttempt: async () => {
            completeCalls += 1;
            return writeDeferred.promise;
        }
    });

    harness.api.start(true);
    await flushAsyncWork();
    assert.strictEqual(completeCalls, 1, '测试前置条件：注入写入必须已经在途');

    harness.api.stop();
    await flushAsyncWork();
    const refreshCountAfterStopCleanup = harness.getRefreshCount();
    writeDeferred.resolve();
    await flushAsyncWork(8);

    assert.strictEqual(harness.previewIds.size, 0,
        '在途写入完成后也不得恢复 preview 许可');
    assert(harness.deletedIds.filter((id) => id === 'demo-onboarding-record').length >= 2,
        'stop 清理早于在途写入完成时，写入链必须再做一次删除补偿');
    assert.strictEqual(harness.getRefreshCount(), refreshCountAfterStopCleanup,
        'tour 停止后，旧注入链不得继续刷新练习历史');
}

async function testOnboardingRapidRestartIsolatesRendererAndCancelsOldPolling() {
    const clock = createManualClock();
    const restartedIndex = createDeferred();
    let indexCalls = 0;
    const harness = createOnboardingSandbox({
        clock,
        resolveIndex: () => {
            indexCalls += 1;
            return indexCalls === 1 ? Promise.resolve([]) : restartedIndex.promise;
        },
        completeAttempt: async () => {}
    });

    harness.api.start(true);
    await flushPromiseWork();
    assert.strictEqual(clock.pendingDelay(120), 1,
        '测试前置条件：旧 lifecycle 必须已经进入 selector 轮询');

    const oldOverlay = harness.body.children.find((element) => element.className === 'onboarding-overlay');
    const oldTooltip = harness.body.children.find((element) => element.className === 'onboarding-tooltip');
    harness.api.stop();
    await flushPromiseWork();
    harness.api.start(true);
    await flushPromiseWork();

    const newOverlay = harness.body.children.find((element) =>
        element.className === 'onboarding-overlay' && element !== oldOverlay);
    const newTooltip = harness.body.children.find((element) =>
        element.className === 'onboarding-tooltip' && element !== oldTooltip);
    assert(oldOverlay && oldTooltip && newOverlay && newTooltip,
        'rapid restart 必须同时保留可区分的新旧 renderer 节点直到退出动画结束');
    assert.strictEqual(clock.pendingDelay(120), 0,
        'stop 必须立即取消旧 lifecycle 的 selector 定时器');

    const queriesAfterRestart = harness.getQueryCount();
    const refreshesAfterRestart = harness.getRefreshCount();
    clock.advance(300);
    await flushPromiseWork();

    assert(!harness.body.children.includes(oldOverlay) && !harness.body.children.includes(oldTooltip),
        '退出动画结束后必须删除旧 renderer 节点');
    assert(harness.body.children.includes(newOverlay) && harness.body.children.includes(newTooltip),
        '旧 destroy timer 绝不能删除 restart 创建的新 renderer 节点');

    clock.advance(5000);
    await flushPromiseWork();
    assert.strictEqual(harness.getQueryCount(), queriesAfterRestart,
        '旧 selector 轮询在 rapid restart 后不得继续查询 DOM');
    assert.strictEqual(harness.getRefreshCount(), refreshesAfterRestart,
        '旧注入链在 rapid restart 后不得继续刷新练习历史');
}

// ---------------------------------------------------------------------------
// 3. 同类隐患：其他 `|| null` 回退字段
// ---------------------------------------------------------------------------

async function testLightProjectionNullFallbacksHaveNoStrictUndefinedConsumers() {
    const body = extractLightProjectionBody(readSource(APP_DATA_SOURCE));
    const { nullFallback, undefinedFallback } = classifyProjectionFallbacks(body);

    assert(nullFallback.length > 0,
        '静态守卫必须至少识别出一个 null 回退字段，否则解析规则已与 appData.js 脱节');
    assert(
        !nullFallback.includes('dataSource'),
        'dataSource 不得回退为 null：消费方按 `=== undefined` 判缺失，null 会让记录整条不显示'
    );

    const files = collectSourceFiles(path.join(repoRoot, 'js'));
    const mismatches = [];
    for (const file of files) {
        const relative = path.relative(repoRoot, file).split(path.sep).join('/');
        const lines = readSource(relative).split('\n');
        lines.forEach((line, index) => {
            // null 回退字段 + 只认 undefined 的消费方 = 本 bug 的同构形态。
            for (const field of nullFallback) {
                if (new RegExp(`\\.${field}\\s*(===|!==)\\s*undefined`).test(line)) {
                    mismatches.push(`${relative}:${index + 1} [${field} 回退 null，但此处只判 undefined] ${line.trim()}`);
                }
            }
            // 反向形态：undefined 回退字段遇到只认 null 的消费方。
            for (const field of undefinedFallback) {
                if (new RegExp(`\\.${field}\\s*(===|!==)\\s*null`).test(line)) {
                    mismatches.push(`${relative}:${index + 1} [${field} 回退 undefined，但此处只判 null] ${line.trim()}`);
                }
            }
        });
    }

    assert.deepStrictEqual(mismatches, [],
        'light 投影的缺省哨兵与下游严格判等不一致，会重演"记录存进去但不显示"：\n'
        + mismatches.join('\n'));
}

// ---------------------------------------------------------------------------
// 4. bundle 同步：线上跑的是 bundle，不是源码
// ---------------------------------------------------------------------------

async function testBundledCopiesMatchSourceContract() {
    const sourceProjection = extractLightProjectionBody(readSource(APP_DATA_SOURCE));
    const bundleDirectory = path.join(repoRoot, 'js', 'bundles');
    const bundles = fs.readdirSync(bundleDirectory).filter((name) => name.endsWith('.bundle.js'));

    const projectionDrift = [];
    for (const name of bundles) {
        const source = fs.readFileSync(path.join(bundleDirectory, name), 'utf8');
        if (!source.includes('function lightFromCanonical')) continue;
        const bundled = extractLightProjectionBody(source);
        // bundle 内缩进不同，比较去掉行首空白后的语义文本。
        const strip = (text) => text.split('\n').map((line) => line.trim()).join('\n');
        if (strip(bundled) !== strip(sourceProjection)) {
            projectionDrift.push(`js/bundles/${name} 的 lightFromCanonical 与 ${APP_DATA_SOURCE} 不一致`);
        }
    }
    assert(bundles.some((name) => fs.readFileSync(path.join(bundleDirectory, name), 'utf8').includes('function lightFromCanonical')),
        '至少一个 bundle 必须内联 lightFromCanonical，否则本检查形同虚设');
    assert.deepStrictEqual(projectionDrift, [],
        'bundle 未重建：应用运行的是 bundle，源码修好但 bundle 仍是旧投影会继续丢记录：\n'
        + projectionDrift.join('\n'));

    // updatePracticeView 的过滤块同样必须与 main.js 同步。
    const mainFilter = readSource(MAIN_SOURCE)
        .match(/function updatePracticeView\([\s\S]*?\n    const stats = window\.PracticeStats;/);
    assert(mainFilter, 'js/main.js 中必须能定位 updatePracticeView 的过滤段落');
    const normalizedMainFilter = mainFilter[0].split('\n').map((line) => line.trim()).join('\n');
    const filterDrift = [];
    for (const name of bundles) {
        const source = fs.readFileSync(path.join(bundleDirectory, name), 'utf8');
        if (!source.includes('function updatePracticeView')) continue;
        const bundled = source.match(/function updatePracticeView\([\s\S]*?\n    const stats = window\.PracticeStats;/);
        if (!bundled) {
            filterDrift.push(`js/bundles/${name} 的 updatePracticeView 结构与 ${MAIN_SOURCE} 不同，无法比对`);
            continue;
        }
        if (bundled[0].split('\n').map((line) => line.trim()).join('\n') !== normalizedMainFilter) {
            filterDrift.push(`js/bundles/${name} 的 updatePracticeView 渲染过滤与 ${MAIN_SOURCE} 不一致`);
        }
    }
    assert.deepStrictEqual(filterDrift, [],
        'bundle 未重建：练习记录渲染过滤与源码不一致：\n' + filterDrift.join('\n'));
}

const tests = [
    ['light 投影的 dataSource 必须能通过渲染过滤', testLightProjectionDataSourcePassesRenderFilter],
    ['falsy dataSource 在 full/light/detail 中必须保值且 isReal 一致', testFalsyDataSourcesPreserveProjectionAndJudgement],
    ['存入的练习记录必须出现在渲染后的历史列表', testStoredRecordsReachRenderedHistoryList],
    ['light 投影产出的所有 dataSource 形态都不被渲染过滤吃掉', testRenderFilterKeepsUnlabelledRecordsAfterProjectionChange],
    ['演示/种子记录必须同时不显示、不计入统计、不计入成就', testDemoRecordsAreExcludedFromViewStatsAndAchievements],
    ['列表/统计/成就对每条记录的来源判定必须完全一致', testDemoJudgementIsIdenticalAcrossViewStatsAndAchievements],
    ['来源判定只允许有一份实现', testDemoJudgementHasSingleImplementation],
    ['引导演示记录的预览例外只影响渲染，不影响统计与成就', testOnboardingPreviewIsViewOnly],
    ['stop 必须取消尚未落库的 onboarding 异步注入', testOnboardingStopCancelsPendingInjectionLifecycle],
    ['stop 必须补偿在途写入且旧注入链不得继续刷新', testOnboardingStopCompensatesInFlightWriteWithoutInjectionRefresh],
    ['rapid stop/start 必须隔离 renderer 并取消旧 selector 轮询', testOnboardingRapidRestartIsolatesRendererAndCancelsOldPolling],
    ['light 投影的 null 回退字段不得遇到只认 undefined 的消费方', testLightProjectionNullFallbacksHaveNoStrictUndefinedConsumers],
    ['bundle 内联的投影与渲染过滤必须与源码同步', testBundledCopiesMatchSourceContract]
];

const results = [];
for (const [name, test] of tests) {
    try {
        await test();
        results.push({ name, status: 'pass' });
    } catch (error) {
        results.push({ name, status: 'fail', error: error.stack || error.message });
        console.log(JSON.stringify({ status: 'fail', detail: `${name} 失败`, results }, null, 2));
        process.exit(1);
    }
}

console.log(JSON.stringify({
    status: 'pass',
    detail: `${results.length}/${results.length} tests passed`,
    results
}, null, 2));
