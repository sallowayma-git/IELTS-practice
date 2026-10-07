#!/usr/bin/env node
/**
 * 阅读练习复盘调度 —— 数据层契约。
 *
 * 这一层的不变量（任何改动都不得回退）：
 *   1. 完整 reviewState 只住在 practiceAnnotations 根级，既不进 practiceSummaries/Details，
 *      也不进 annotations.suiteEntries；
 *   2. 只有“新完成的、真实的、有错题的阅读记录”才自动入队；满分 / 听力 / 既有历史不入队；
 *   3. listReviewQueue 是读取时投影：只读 summaries + annotations，绝不加载 details；
 *   4. recordReviewOutcome 是 reviewState 的唯一推进入口，且对同一 reviewAttemptId 幂等；
 *   5. 导出/导入必须完整 round-trip 复盘状态。
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readSource = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const catalogSource = readSource('js/data/v2/dataCatalog.js');
const recordSource = readSource('js/data/practiceRecordSource.js');
const vocabSchedulerSource = readSource('js/core/vocabScheduler.js');
const practiceReviewSchedulerSource = readSource('js/core/practiceReviewScheduler.js');
const appDataSource = readSource('js/data/v2/appData.js');

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
}
function checksum(value) {
    let hash = 0x811c9dc5;
    for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
    return 'fnv1a-' + (hash >>> 0).toString(16);
}
function parseLegacyValue(value) { return clone(value); }
class AppDataError extends Error { constructor(code, message) { super(message); this.code = code; } }

const ENTITY_STORES = ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'];

function harness() {
    const catalogSandbox = { structuredClone };
    catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const shared = {
        docs: new Map(),
        entities: new Map(ENTITY_STORES.map((store) => [store, new Map()])),
        snapshotStoreReads: [],
        conflictOnce: false,
        counter: 0
    };
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({
        schemaVersion: 2, revision, operationId, updatedAt: new Date().toISOString(), state,
        data: state === 'cleared' ? null : clone(data),
        checksum: checksum(state === 'cleared' ? null : data)
    });
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async read(key, options = {}) {
            const entry = catalog.get(key);
            const value = shared.docs.get(key) || null;
            const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data;
            return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data);
        }
        async mutate(changes, options = {}) {
            const op = String(options.operationId || 'doc-' + (++shared.counter));
            const revisions = {};
            for (const change of changes) {
                const old = shared.docs.get(change.logicalKey);
                if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== Number((old && old.revision) || 0)) {
                    throw new AppDataError('CONFLICT', 'document revision');
                }
                const revision = Number((old && old.revision) || 0) + 1;
                shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op));
                revisions[change.logicalKey] = revision;
            }
            return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async journalNoop(options = {}) {
            return { committed: true, operationId: options.operationId || 'noop-' + (++shared.counter), revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
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
        async readPracticeSnapshot(recordIds = null, options = {}) {
            const stores = Array.isArray(options.stores) && options.stores.length ? options.stores : ENTITY_STORES;
            shared.snapshotStoreReads.push(stores.slice());
            const ids = recordIds === null || recordIds === undefined
                ? null
                : new Set((Array.isArray(recordIds) ? recordIds : [recordIds]).map(String));
            const result = {};
            for (const store of stores) {
                const rows = Array.from(shared.entities.get(store).values())
                    .filter((row) => !ids || ids.has(String(row.recordId)));
                result[store] = options.withMeta ? clone(rows) : rows.map((row) => clone(row.data));
            }
            return result;
        }
        async getEntityRevision(store, recordId, options = {}) {
            const row = shared.entities.get(store).get(String(recordId)) || null;
            const revision = Number((row && row.revision) || 0);
            return options.withPresence ? { revision, present: Boolean(row) } : revision;
        }
        async mutateEntities(operations, options = {}) {
            if (shared.conflictOnce) { shared.conflictOnce = false; throw new AppDataError('CONFLICT', 'forced entity conflict'); }
            const op = String(options.operationId || 'entity-' + (++shared.counter));
            const revisions = {};
            const next = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)]));
            for (const item of operations) {
                const rows = next.get(item.store);
                if (item.type === 'clear') { rows.clear(); continue; }
                const old = rows.get(String(item.recordId));
                if (item.expectedRevision !== undefined && item.expectedRevision !== null
                    && Number(item.expectedRevision) !== Number((old && old.revision) || 0)) {
                    throw new AppDataError('CONFLICT', 'entity revision');
                }
                if (item.type === 'delete') { rows.delete(String(item.recordId)); continue; }
                const row = {
                    recordId: String(item.recordId), revision: Number((old && old.revision) || 0) + 1,
                    operationId: op, updatedAt: new Date().toISOString(),
                    data: clone(item.data), checksum: checksum(item.data)
                };
                rows.set(row.recordId, row);
                revisions[item.store + '/' + item.recordId] = row.revision;
            }
            if (options.documentChanges?.length) await this.mutate(options.documentChanges, options);
            shared.entities = next;
            return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async exportSnapshot(options = {}) {
            const selected = Array.isArray(options.logicalKeys) ? new Set(options.logicalKeys) : null;
            const selectedEntities = Array.isArray(options.entityStores) ? new Set(options.entityStores) : null;
            const envelopes = {};
            for (const entry of catalog.list()) {
                const key = entry.logicalKey;
                if (entry.export !== true || (selected && !selected.has(key))) continue;
                envelopes[key] = shared.docs.has(key) ? clone(shared.docs.get(key)) : envelope(key, null, 'cleared', 1, 'snapshot-default');
            }
            const entities = {};
            for (const [store, rows] of shared.entities) {
                if (selectedEntities && !selectedEntities.has(store)) continue;
                entities[store] = Array.from(rows.values()).map(clone);
            }
            const snapshot = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: selected ? 'partial' : 'full', envelopes, entities };
            snapshot.checksum = checksum({ envelopes, entities });
            return snapshot;
        }
        async installSnapshot(snapshot, options = {}) {
            if (snapshot.checksum !== checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities })) {
                throw new AppDataError('VALIDATION', 'snapshot checksum');
            }
            const nextDocs = new Map(shared.docs);
            const nextEntities = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)]));
            for (const [key, value] of Object.entries(snapshot.envelopes)) nextDocs.set(key, clone(value));
            for (const [store, rows] of Object.entries(snapshot.entities)) {
                nextEntities.set(store, new Map(rows.map((row) => [String(row.recordId), clone(row)])));
            }
            shared.docs = nextDocs;
            shared.entities = nextEntities;
            return { committed: true, operationId: options.operationId || 'install-' + (++shared.counter), revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        onCommitted() { return () => {}; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }
    const internals = {
        DataKernel: Kernel, AppDataError, catalog, clone, checksum, parseLegacyValue,
        randomId: (prefix) => prefix + '-' + (++shared.counter),
        nowIso: () => new Date().toISOString(),
        makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId),
        validateEnvelope: (entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data))
    };
    const sandbox = {
        console, Date, JSON, Math, Map, Set, Promise, structuredClone,
        __AppDataV2Internals: internals,
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(recordSource, context, { filename: 'practiceRecordSource.js' });
    vm.runInContext(vocabSchedulerSource, context, { filename: 'vocabScheduler.js' });
    vm.runInContext(practiceReviewSchedulerSource, context, { filename: 'practiceReviewScheduler.js' });
    vm.runInContext(appDataSource, context, { filename: 'appData.js' });
    return { app: sandbox.AppData, shared, sandbox };
}

function storedLayer(shared, store, recordId) {
    const row = shared.entities.get(store).get(String(recordId));
    return row ? clone(row.data) : null;
}

function readingRecord(overrides = {}) {
    return Object.assign({
        id: 'reading-wrong',
        examId: 'p1-reading-01',
        sessionId: 'session-reading-wrong',
        title: 'Reading with mistakes',
        type: 'reading',
        startTime: '2026-09-01T00:00:00.000Z',
        endTime: '2026-09-01T00:20:00.000Z',
        completedAt: '2026-09-01T00:20:00.000Z',
        date: '2026-09-01T00:20:00.000Z',
        duration: 1200,
        totalQuestions: 10,
        correctAnswers: 7,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'C' }
    }, overrides);
}

async function expectFailure(task, message) {
    let error = null;
    try { await task(); } catch (caught) { error = caught; }
    assert(error, message);
    return error;
}

test('新完成阅读将自动评分写入轻量文章计划，不复制到练习事实或标注', async () => {
    const { app, shared } = harness(); await app.ready;
    await app.practice.completeAttempt({ operationId: 'op-init', record: readingRecord() });
    const state = await app.practice.getReviewState('reading-wrong');
    assert.equal(state.lastQuality, 'good');
    assert.equal(state.reviewCount, 1);
    assert.equal(state.interval, 1);
    assert.equal(state.nextReview, '2026-09-02T00:20:00.000Z');
    for (const store of ENTITY_STORES) assert.equal(storedLayer(shared, store, 'reading-wrong').reviewState, undefined);
    assert.equal(shared.docs.get('practice.reviewPlans').data[0].examId, 'p1-reading-01');
});

test('满分 / 听力 / 演示记录不自动入队', async () => {
    const { app, shared } = harness();
    await app.ready;
    await app.practice.completeAttempt({
        operationId: 'op-perfect',
        record: readingRecord({ id: 'reading-perfect', sessionId: 's-perfect', correctAnswers: 10 })
    });
    await app.practice.completeAttempt({
        operationId: 'op-listening',
        record: readingRecord({ id: 'listening-wrong', sessionId: 's-listening', type: 'listening', examId: 'p1-listening-01', title: 'Listening section' })
    });
    await app.practice.completeAttempt({
        operationId: 'op-demo',
        record: readingRecord({ id: 'demo-wrong', sessionId: 's-demo', metadata: { source: 'onboarding-demo' } })
    });

    for (const id of ['reading-perfect', 'listening-wrong', 'demo-wrong']) {
        const annotations = storedLayer(shared, 'practiceAnnotations', id);
        assert.strictEqual(annotations.reviewState, undefined, id + ' 不应自动初始化 reviewState');
    }
    const queue = await app.practice.listReviewQueue();
    assert.strictEqual(queue.records.length, 0, '不合格记录不得进入复盘队列');
});

test('既有记录再次落库既不新建也不重置 reviewState', async () => {
    const { app, shared } = harness();
    await app.ready;
    // 先造一条“既有历史”：满分记录不入队。
    await app.practice.completeAttempt({
        operationId: 'op-history',
        record: readingRecord({ id: 'history', sessionId: 's-history', correctAnswers: 10 })
    });
    // 同一 recordId 补写成有错题：这不是“新完成的练习”，不得追加入队。
    await app.practice.completeAttempt({
        operationId: 'op-history-2',
        record: readingRecord({ id: 'history', sessionId: 's-history', correctAnswers: 4 })
    });
    assert.strictEqual(storedLayer(shared, 'practiceAnnotations', 'history').reviewState, undefined,
        '既有历史记录不得因为补写而自动加入复盘队列');

    await app.practice.completeAttempt({ operationId: 'op-live', record: readingRecord() });
    const scheduled = await app.practice.recordReviewOutcome({
        recordId: 'reading-wrong', reviewAttemptId: 'attempt-1', quality: 'good', reviewedAt: '2026-09-02T00:00:00.000Z'
    });
    assert.strictEqual(scheduled.reviewState.reviewCount, 2);
    // 重新落库同一条记录（例如合并重试）不得把已推进的间隔打回初始值。
    await app.practice.completeAttempt({ operationId: 'op-live-2', record: readingRecord({ correctAnswers: 6 }) });
    const afterResave = await app.practice.getReviewState('reading-wrong');
    assert.strictEqual(afterResave.reviewCount, 2, '重新落库不得重置 reviewCount');
    assert.strictEqual(afterResave.nextReview, scheduled.reviewState.nextReview, '重新落库不得重置 nextReview');
});

test('导入数据里合法的 reviewState 被保留，非法的被丢弃且不阻断落库', async () => {
    const { app, shared } = harness();
    await app.ready;
    const validState = {
        schemaVersion: 1, algorithm: 'sm2-practice', algorithmVersion: 1,
        easeFactor: 2.36, interval: 6, repetitions: 2, reviewCount: 2, lapseCount: 1,
        lastReviewed: '2026-08-20T00:00:00.000Z', nextReview: '2026-08-26T00:00:00.000Z',
        lastQuality: 'good', lastReviewAttemptId: 'legacy-attempt', appliedReviewAttemptIds: ['legacy-attempt'], updatedAt: '2026-08-20T00:00:00.000Z'
    };
    await app.practice.completeAttempt({
        operationId: 'op-imported',
        record: readingRecord({ id: 'imported', sessionId: 's-imported', reviewState: validState })
    });
    assert.deepStrictEqual(storedLayer(shared, 'practiceAnnotations', 'imported').reviewState, validState,
        '导入的合法 reviewState 必须原样保留');

    await app.practice.completeAttempt({
        operationId: 'op-broken',
        record: readingRecord({ id: 'broken', examId: 'reading-broken', sessionId: 's-broken', reviewState: { schemaVersion: 99, easeFactor: 'nope' } })
    });
    const broken = storedLayer(shared, 'practiceAnnotations', 'broken');
    assert(broken, '非法 reviewState 不得阻断练习记录落库');
    assert(!broken.reviewState || broken.reviewState.schemaVersion === 1,
        '非法 reviewState 必须被丢弃或替换为合法初始状态');
    const queue = await app.practice.listReviewQueue({ now: '2026-09-05T00:00:00.000Z' });
    assert(queue.records.some((record) => record.id === 'imported'), '导入的合法状态应参与队列');
});

test('新套题每篇独立调度，状态不复制到套题或子篇标注', async () => {
    const { app, shared } = harness();
    await app.ready;
    await app.practice.finalizeSuite({
        operationId: 'op-suite',
        record: {
            id: 'suite-record',
            type: 'reading-suite',
            title: 'Suite attempt',
            completedAt: '2026-09-01T02:00:00.000Z',
            date: '2026-09-01T02:00:00.000Z',
            totalQuestions: 13,
            correctAnswers: 9,
            suiteEntries: [
                { examId: 'suite-part-1', scoreInfo: { correct: 5, total: 6 }, highlights: [{ id: 'h1' }], reviewState: { schemaVersion: 1, algorithm: 'sm2-practice', algorithmVersion: 1, easeFactor: 2.5, interval: 0, repetitions: 0, reviewCount: 0, lapseCount: 0, lastReviewed: null, nextReview: '2026-09-01T02:00:00.000Z', lastQuality: null, lastReviewAttemptId: null, updatedAt: '2026-09-01T02:00:00.000Z' } },
                { examId: 'suite-part-2', scoreInfo: { correct: 4, total: 7 } }
            ]
        }
    });
    const annotations = storedLayer(shared, 'practiceAnnotations', 'suite-record');
    const detail = storedLayer(shared, 'practiceDetails', 'suite-record');
    assert.equal(annotations.reviewState, undefined);
    const tasks = (await app.practice.listReviewQueue()).records;
    assert.equal(tasks.length, 2, '套题每篇独立入队');
    assert.deepEqual(Array.from(tasks, row => row.reviewState.lastQuality).sort(), ['easy', 'hard']);
    for (const entry of Object.values(annotations.suiteEntries || {})) {
        assert.strictEqual(entry.reviewState, undefined, 'suiteEntries 标注不得携带 reviewState');
    }
    for (const entry of detail.suiteEntries || []) {
        assert.strictEqual(entry.reviewState, undefined, 'detail 的子篇不得携带 reviewState');
    }
    // full 投影回灌（回放路径会这么做）不得把状态复制到子篇。
    const full = await app.practice.get('suite-record', { projection: 'full' });
    assert.equal(full.reviewState, undefined, '文章计划不复制到套题根级');
    for (const entry of full.suiteEntries) {
        assert.strictEqual(entry.reviewState, undefined, 'full 投影的子篇不得出现 reviewState');
    }
    await app.practice.finalizeSuite({ operationId: 'op-suite-replay', record: full });
    const replayed = storedLayer(shared, 'practiceAnnotations', 'suite-record');
    for (const entry of Object.values(replayed.suiteEntries || {})) {
        assert.strictEqual(entry.reviewState, undefined, 'full 投影回灌后子篇仍不得出现 reviewState');
    }
});

function initialReviewState() {
    return { schemaVersion: 1, algorithm: 'sm2-practice', algorithmVersion: 1, easeFactor: 2.5,
        interval: 0, repetitions: 0, reviewCount: 0, lapseCount: 0, lastReviewed: null,
        nextReview: '2026-09-01T00:20:00.000Z', lastQuality: null, lastReviewAttemptId: null,
        updatedAt: '2026-09-01T00:20:00.000Z' };
}

function daysBetween(fromIso, toIso) {
    return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000);
}

test('listReviewQueue 只读 summaries + annotations，且按到期/计划/错题数稳定排序', async () => {
    const { app, shared } = harness();
    await app.ready;
    const state = (nextReview, extra = {}) => Object.assign({
        schemaVersion: 1, algorithm: 'sm2-practice', algorithmVersion: 1,
        easeFactor: 2.5, interval: 1, repetitions: 1, reviewCount: 1, lapseCount: 0,
        lastReviewed: '2026-09-01T00:00:00.000Z', nextReview,
        lastQuality: 'good', lastReviewAttemptId: 'seed', updatedAt: '2026-09-01T00:00:00.000Z'
    }, extra);

    await app.practice.completeAttempt({ operationId: 'q-future', record: readingRecord({ id: 'future', sessionId: 's1', reviewState: state('2026-09-20T00:00:00.000Z') }) });
    await app.practice.completeAttempt({ operationId: 'q-overdue', record: readingRecord({ id: 'overdue', sessionId: 's2', reviewState: state('2026-09-01T00:00:00.000Z') }) });
    // 同一 nextReview：错题多的先做。
    await app.practice.completeAttempt({ operationId: 'q-due-a', record: readingRecord({ id: 'due-a', sessionId: 's3', correctAnswers: 9, reviewState: state('2026-09-05T00:00:00.000Z') }) });
    await app.practice.completeAttempt({ operationId: 'q-due-b', record: readingRecord({ id: 'due-b', sessionId: 's4', correctAnswers: 2, reviewState: state('2026-09-05T00:00:00.000Z') }) });

    shared.snapshotStoreReads.length = 0;
    const queue = await app.practice.listReviewQueue({ now: '2026-09-05T12:00:00.000Z' });
    assert.equal(shared.snapshotStoreReads.length, 0, '已初始化的队列不得扫描标注或详情');
    for (const stores of shared.snapshotStoreReads) {
        assert(!stores.includes('practiceDetails'), '复盘队列投影不得加载 practiceDetails: ' + JSON.stringify(stores));
    }
    assert.deepStrictEqual(Array.from(queue.records, (record) => record.id), ['overdue', 'due-b', 'due-a', 'future']);
    assert.deepStrictEqual(Array.from(queue.records, (record) => record.isDue), [true, true, true, false]);
    assert.strictEqual(queue.records[1].wrongCount, 8);
    assert.strictEqual(queue.records[0].suiteEntries, undefined, '队列投影不得带上 detail 字段');
    assert.strictEqual(queue.records[0].answers, undefined, '队列投影不得带上作答明细');
    assert.strictEqual(queue.stats.overdue, 1);
    assert.strictEqual(queue.stats.dueToday, 2);
    assert.strictEqual(queue.stats.dueNow, 3);
    assert.strictEqual(queue.stats.buckets.length, 7);
    assert.strictEqual(queue.stats.buckets[0].count, 3, '今日格子必须吃下逾期任务');
    assert.strictEqual(queue.stats.futureSevenDayTotal, 3, '未来 7 天总量不含 9-20 的任务');
});

test('三档评分的状态迁移、首次间隔与 EF 下限', async () => {
    const { app } = harness();
    await app.ready;
    await app.practice.completeAttempt({ operationId: 'grade-good', record: readingRecord({ id: 'good', examId: 'reading-good', sessionId: 'g1', reviewState: initialReviewState() }) });
    await app.practice.completeAttempt({ operationId: 'grade-easy', record: readingRecord({ id: 'easy', examId: 'reading-easy', sessionId: 'g2', reviewState: initialReviewState() }) });
    await app.practice.completeAttempt({ operationId: 'grade-hard', record: readingRecord({ id: 'hard', examId: 'reading-hard', sessionId: 'g3', reviewState: initialReviewState() }) });

    const good1 = (await app.practice.recordReviewOutcome({ recordId: 'good', reviewAttemptId: 'a1', quality: 'good', reviewedAt: '2026-09-02T01:00:00.000Z' })).reviewState;
    assert.strictEqual(good1.repetitions, 1);
    assert.strictEqual(good1.interval, 1, '第一次“基本掌握”间隔为 1 天');
    assert.strictEqual(good1.easeFactor, 2.5, 'q=4 不改变 EF');
    assert.strictEqual(good1.reviewCount, 1);
    assert.strictEqual(good1.lapseCount, 0);
    assert.strictEqual(good1.lastQuality, 'good');
    assert.strictEqual(good1.lastReviewed, '2026-09-02T01:00:00.000Z');
    assert.strictEqual(daysBetween(good1.lastReviewed, good1.nextReview), 1);

    const good2 = (await app.practice.recordReviewOutcome({ recordId: 'good', reviewAttemptId: 'a2', quality: 'good', reviewedAt: '2026-09-03T01:00:00.000Z' })).reviewState;
    assert.strictEqual(good2.repetitions, 2);
    assert.strictEqual(good2.interval, 6, '第二次“基本掌握”间隔为 6 天');

    const good3 = (await app.practice.recordReviewOutcome({ recordId: 'good', reviewAttemptId: 'a3', quality: 'good', reviewedAt: '2026-09-09T01:00:00.000Z' })).reviewState;
    assert.strictEqual(good3.repetitions, 3);
    assert.strictEqual(good3.interval, 15, '之后按 round(interval × EF) 扩展');
    assert.strictEqual(daysBetween(good3.lastReviewed, good3.nextReview), 15);

    const easy1 = (await app.practice.recordReviewOutcome({ recordId: 'easy', reviewAttemptId: 'e1', quality: 'easy', reviewedAt: '2026-09-02T01:00:00.000Z' })).reviewState;
    assert.strictEqual(easy1.repetitions, 2, '“已掌握”首评直接进入第二阶段');
    assert.strictEqual(easy1.interval, 6);
    assert.strictEqual(easy1.easeFactor, 2.6);

    let hardState = null;
    const hardEaseFactors = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        hardState = (await app.practice.recordReviewOutcome({
            recordId: 'hard', reviewAttemptId: 'h' + attempt, quality: 'hard',
            reviewedAt: '2026-09-0' + (attempt + 1) + 'T01:00:00.000Z'
        })).reviewState;
        hardEaseFactors.push(hardState.easeFactor);
        assert.strictEqual(hardState.repetitions, 0, '“仍不熟”必须把 repetitions 打回 0');
        assert.strictEqual(hardState.interval, 1, '“仍不熟”必须回到 1 天');
        assert.strictEqual(hardState.lapseCount, attempt);
    }
    assert.deepStrictEqual(hardEaseFactors.slice(0, 3).map((value) => Number(value.toFixed(2))), [2.18, 1.86, 1.54]);
    assert.strictEqual(hardState.easeFactor, 1.3, 'EF 必须夹在 1.3 下限');
});

test('同一 reviewAttemptId 只生效一次，冲突会重试而不重复推进', async () => {
    const { app, shared } = harness();
    await app.ready;
    await app.practice.completeAttempt({ operationId: 'idem-seed', record: readingRecord({ reviewState: initialReviewState() }) });

    const first = await app.practice.recordReviewOutcome({
        recordId: 'reading-wrong', reviewAttemptId: 'attempt-x', quality: 'good', reviewedAt: '2026-09-02T01:00:00.000Z'
    });
    assert.strictEqual(first.reviewState.reviewCount, 1);

    // 重复提交（跨标签页 / 连点 / 宿主重放 ACK）：同一 attempt 不得再推进一次。
    const duplicate = await app.practice.recordReviewOutcome({
        recordId: 'reading-wrong', reviewAttemptId: 'attempt-x', quality: 'easy', reviewedAt: '2026-09-04T01:00:00.000Z'
    });
    assert.strictEqual(duplicate.noop, true, '重复 attempt 必须是 noop');
    assert.strictEqual(duplicate.reviewState.reviewCount, 1);
    assert.strictEqual(duplicate.reviewState.nextReview, first.reviewState.nextReview);
    assert.strictEqual(duplicate.reviewState.lastQuality, 'good', '重复提交不得改写已记录的评分');

    // 不同 attempt 若携带更早的评分时间，说明旧标签页/旧回放的结果迟到。
    // 它不能把 lastReviewed、updatedAt 和 nextReview 一起倒退。
    const stale = await expectFailure(() => app.practice.recordReviewOutcome({
        recordId: 'reading-wrong', reviewAttemptId: 'attempt-stale', quality: 'hard',
        reviewedAt: '2026-09-01T12:00:00.000Z'
    }), '迟到的旧评分必须拒绝');
    assert.strictEqual(stale.code, 'CONFLICT');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await app.practice.getReviewState('reading-wrong'))),
        JSON.parse(JSON.stringify(first.reviewState)), '迟到评分不得改写当前计划');

    // 一次 CAS 冲突（另一个标签页刚写过）应由 retryMergeConflict 吞掉并重算，只推进一次。
    shared.conflictOnce = true;
    const retried = await app.practice.recordReviewOutcome({
        recordId: 'reading-wrong', reviewAttemptId: 'attempt-y', quality: 'good', reviewedAt: '2026-09-03T01:00:00.000Z'
    });
    assert.strictEqual(shared.conflictOnce, false, '强制冲突必须真的发生过');
    assert.strictEqual(retried.reviewState.reviewCount, 2, '冲突重试后只能推进一次');
    assert.strictEqual(retried.reviewState.interval, 6);
});

test('复盘结果的输入校验与显式 revision 冲突', async () => {
    const { app } = harness();
    await app.ready;
    await app.practice.completeAttempt({ operationId: 'valid-seed', record: readingRecord() });
    await app.practice.completeAttempt({
        operationId: 'unscheduled-seed',
        record: readingRecord({ id: 'unscheduled', examId: 'reading-unscheduled', sessionId: 's-unscheduled', correctAnswers: 10 })
    });

    await expectFailure(() => app.practice.recordReviewOutcome({ recordId: '', reviewAttemptId: 'a', quality: 'good' }), '缺 recordId 必须失败');
    await expectFailure(() => app.practice.recordReviewOutcome({ recordId: 'reading-wrong', reviewAttemptId: '', quality: 'good' }), '缺 reviewAttemptId 必须失败');
    await expectFailure(() => app.practice.recordReviewOutcome({ recordId: 'reading-wrong', reviewAttemptId: 'a', quality: 'perfect' }), '非法评分枚举必须失败');
    await expectFailure(() => app.practice.recordReviewOutcome({ recordId: 'reading-wrong', reviewAttemptId: 'a', quality: 'good', reviewedAt: 'not-a-date' }), '非法时间必须失败');
    await expectFailure(() => app.practice.recordReviewOutcome({ recordId: 'missing', reviewAttemptId: 'a', quality: 'good' }), '未知记录必须失败');
    const unscheduled = await expectFailure(
        () => app.practice.recordReviewOutcome({ recordId: 'unscheduled', reviewAttemptId: 'a', quality: 'good' }),
        '未入队的记录不得被评分'
    );
    assert.strictEqual(unscheduled.code, 'VALIDATION');

    const conflict = await expectFailure(
        () => app.practice.recordReviewOutcome({ recordId: 'reading-wrong', reviewAttemptId: 'a', quality: 'good', expectedRevision: 99 }),
        '显式 revision 不匹配必须抛 CONFLICT'
    );
    assert.strictEqual(conflict.code, 'CONFLICT');

    assert.strictEqual(await app.practice.getReviewState('unscheduled'), null, '未入队记录的状态读取应为 null');
    await expectFailure(() => app.practice.getReviewState('missing'), '未知记录读取状态必须失败');
    await expectFailure(() => app.practice.getReviewState(''), '空 id 读取状态必须失败');
});

test('标注同步不能伪造复盘状态', async () => {
    const { app, shared } = harness();
    await app.ready;
    await app.practice.completeAttempt({ operationId: 'annot-seed', record: readingRecord() });
    const before = await app.practice.getReviewState('reading-wrong');

    await app.practice.updateAnnotations({
        recordId: 'reading-wrong',
        examId: 'p1-reading-01',
        patch: {
            noteText: 'legit note',
            reviewState: {
                schemaVersion: 1, algorithm: 'sm2-practice', algorithmVersion: 1,
                easeFactor: 3, interval: 365, repetitions: 9, reviewCount: 9, lapseCount: 0,
                lastReviewed: '2026-09-02T00:00:00.000Z', nextReview: '2027-09-02T00:00:00.000Z',
                lastQuality: 'easy', lastReviewAttemptId: 'forged', updatedAt: '2026-09-02T00:00:00.000Z'
            }
        }
    });

    const after = await app.practice.getReviewState('reading-wrong');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)),
        'updateAnnotations 不得改动 reviewState');
    assert.strictEqual(storedLayer(shared, 'practiceAnnotations', 'reading-wrong').noteText, 'legit note',
        '标注内容本身仍应正常落库');
});

test('导出/导入完整 round-trip 复盘状态', async () => {
    const { app } = harness();
    await app.ready;
    await app.practice.completeAttempt({ operationId: 'roundtrip-seed', record: readingRecord() });
    const scheduled = (await app.practice.recordReviewOutcome({
        recordId: 'reading-wrong', reviewAttemptId: 'rt-1', quality: 'good', reviewedAt: '2026-09-02T01:00:00.000Z'
    })).reviewState;

    const snapshot = await app.backups.export();
    await app.practice.clear({ operationId: 'roundtrip-clear' });
    assert.strictEqual((await app.practice.listReviewQueue()).records.length, 0);

    const plan = await app.backups.previewImport(snapshot);
    await app.backups.commitImport(plan.id, { operationId: 'roundtrip-import', confirmDestructive: true });
    const restored = await app.practice.getReviewState('reading-wrong');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(scheduled)),
        '导入必须完整还原 reviewState');
    const queue = await app.practice.listReviewQueue({ now: '2026-09-30T00:00:00.000Z' });
    assert.strictEqual(queue.records.length, 1);
    assert.strictEqual(queue.records[0].reviewState.reviewCount, 2);
});


test('自动评分的 60% 和 80% 边界，非法成绩不能推进调度', () => {
    const { sandbox } = harness();
    const grade = sandbox.PracticeReviewScheduler.qualityFromScore;
    assert.equal(grade(59, 100), 'hard');
    assert.equal(grade(60, 100), 'good');
    assert.equal(grade(80, 100), 'good');
    assert.equal(grade(81, 100), 'easy');
    assert.equal(grade(4, 5), 'good');
    for (const [c, t] of [[-1, 10], [11, 10], [0, 0], [NaN, 10]]) assert.throws(() => grade(c, t));
});

test('同一考试 ID 去重，重做自动评分，满分重做仍推进已有计划', async () => {
    const { app, shared } = harness(); await app.ready;
    for (const [id, correct, day] of [['first', 5, '01'], ['second', 8, '02'], ['third', 10, '03']]) {
        await app.practice.completeAttempt({ operationId: id, record: readingRecord({ id, sessionId: id,
            correctAnswers: correct, completedAt: `2026-09-${day}T00:00:00.000Z`, date: `2026-09-${day}T00:00:00.000Z` }) });
    }
    let queue = await app.practice.listReviewQueue();
    assert.equal(queue.records.length, 1);
    assert.equal(queue.records[0].recordId, 'third');
    assert.equal(queue.records[0].correctAnswers, 10);
    assert.equal(queue.records[0].reviewState.reviewCount, 3);
    assert.equal(queue.records[0].reviewState.lastQuality, 'easy');
    await app.practice.completeAttempt({ operationId: 'third-resave', record: readingRecord({ id: 'third', sessionId: 'third' }) });
    assert.equal((await app.practice.getReviewState('third')).reviewCount, 3);
    shared.snapshotStoreReads.length = 0;
    queue = await app.practice.listReviewQueue();
    assert.equal(shared.snapshotStoreReads.length, 0, 'steady queue reads no entity snapshots');
    await app.practice.delete({ recordId: 'first' });
    assert.equal((await app.practice.listReviewQueue()).records.length, 1, '删除旧历史不删最新计划');
    await app.practice.delete({ recordId: 'third' });
    assert.equal((await app.practice.listReviewQueue()).records.length, 0, '删除最新记录同步删除计划');
});

test('相同考试 ID 在不同题库配置中保留独立计划与任务路由', async () => {
    const { app, shared } = harness(); await app.ready;
    const attempt = (id, libraryConfigurationId, day, correctAnswers = 6) => app.practice.completeAttempt({
        operationId: id,
        record: readingRecord({
            id,
            sessionId: id,
            correctAnswers,
            completedAt: `2026-09-${day}T00:00:00.000Z`,
            date: `2026-09-${day}T00:00:00.000Z`,
            metadata: { libraryConfigurationId }
        })
    });

    await attempt('library-a-first', 'library-a', '01');
    await attempt('library-b-first', 'library-b', '02');
    let queue = await app.practice.listReviewQueue();
    assert.equal(queue.records.length, 2, '跨题库的同名考试不得合并为一条计划');
    const byLibrary = new Map(queue.records.map((record) => [record.metadata.libraryConfigurationId, record]));
    const libraryA = byLibrary.get('library-a');
    const libraryB = byLibrary.get('library-b');
    assert(libraryA && libraryB, '队列摘要必须保留各自的题库来源');
    assert.equal(libraryA.recordId, 'library-a-first');
    assert.equal(libraryB.recordId, 'library-b-first');
    assert.notEqual(libraryA.reviewPlanId, libraryB.reviewPlanId, '持久化计划 ID 必须包含题库来源');
    assert.notEqual(libraryA.id, libraryB.id, 'UI 任务 ID 必须能分别路由两条同名计划');
    assert.equal((await app.practice.getReviewTask(libraryA.id)).recordId, 'library-a-first');
    assert.equal((await app.practice.getReviewTask(libraryB.id)).recordId, 'library-b-first');

    await attempt('library-a-redo', 'library-a', '03', 8);
    queue = await app.practice.listReviewQueue();
    const afterRedo = new Map(queue.records.map((record) => [record.metadata.libraryConfigurationId, record]));
    assert.equal(afterRedo.get('library-a').recordId, 'library-a-redo', '重做只更新同一题库的计划');
    assert.equal(afterRedo.get('library-a').reviewState.reviewCount, 2);
    assert.equal(afterRedo.get('library-b').recordId, 'library-b-first', '另一题库的计划保持不变');
    assert.equal(afterRedo.get('library-b').reviewState.reviewCount, 1);
    const plans = shared.docs.get('practice.reviewPlans').data;
    assert.deepEqual(new Set(plans.map((plan) => plan.libraryConfigurationId)), new Set(['library-a', 'library-b']));
});

test('旧文章计划从摘要来源迁移为复合 ID', async () => {
    const { app, shared } = harness(); await app.ready;
    await app.practice.completeAttempt({
        operationId: 'legacy-plan-seed',
        record: readingRecord({ metadata: { libraryConfigurationId: 'library-a' } })
    });
    const stored = shared.docs.get('practice.reviewPlans');
    const previousRevision = stored.revision;
    stored.data[0].id = stored.data[0].examId;
    delete stored.data[0].libraryConfigurationId;
    stored.checksum = checksum(stored.data);

    const queue = await app.practice.listReviewQueue();
    assert.equal(queue.records.length, 1);
    assert.equal(queue.records[0].reviewLibraryConfigurationId, 'library-a');
    assert.notEqual(queue.records[0].reviewPlanId, 'p1-reading-01');
    const migrated = shared.docs.get('practice.reviewPlans');
    assert.equal(migrated.revision, previousRevision + 1, '读取队列时应原子保存身份迁移');
    assert.equal(migrated.data[0].id, queue.records[0].reviewPlanId);
    assert.equal(migrated.data[0].libraryConfigurationId, 'library-a');
});

test('迟到的旧作答和旧回放评分不能替换或推进最新计划', async () => {
    const { app } = harness(); await app.ready;
    await app.practice.completeAttempt({ record: readingRecord({ id: 'newest', completedAt: '2026-09-10T00:00:00.000Z' }) });
    await app.practice.completeAttempt({ record: readingRecord({ id: 'older', completedAt: '2026-09-01T00:00:00.000Z' }) });
    const queue = await app.practice.listReviewQueue();
    assert.equal(queue.records[0].recordId, 'newest');
    const error = await expectFailure(() => app.practice.recordReviewOutcome({ recordId: 'older',
        reviewPlanId: queue.records[0].reviewPlanId, reviewAttemptId: 'stale', quality: 'easy' }), '旧回放评分必须拒绝');
    assert.equal(error.code, 'CONFLICT');
    assert.equal((await app.practice.getReviewState('newest')).reviewCount, 1);
});

test('套题汇总只迁移最新记录引用，子篇作答不重复计数', async () => {
    const { app } = harness(); await app.ready;
    const child = readingRecord({ id: 'child', sessionId: 'child', correctAnswers: 8 });
    await app.practice.completeAttempt({ record: child });
    const before = await app.practice.getReviewState('child');
    await app.practice.finalizeSuite({ childRecordIds: ['child'], record: { id: 'parent', type: 'reading',
        completedAt: child.completedAt, totalQuestions: 10, correctAnswers: 8, suiteEntries: [child] } });
    const queue = await app.practice.listReviewQueue();
    assert.equal(queue.records.length, 1);
    assert.equal(queue.records[0].recordId, 'parent');
    assert.equal(queue.records[0].reviewEntryIndex, 0);
    assert.equal(queue.records[0].reviewState.reviewCount, before.reviewCount);
    assert.equal(await app.practice.get('child'), null);
});
