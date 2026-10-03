import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../../../js/app.js', import.meta.url), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function harness() {
    const stats = deferred();
    const summaries = deferred();
    const calls = [];
    const errors = [];
    const window = {
        addEventListener() {},
        AppData: { practice: {
            getStats() { calls.push('canonical-stats'); return stats.promise; },
            list(options) { calls.push(`summaries:${options.projection}`); return summaries.promise; }
        } },
        resolveActiveLibraryIndex() { calls.push('active-index'); return Promise.resolve([{ id: 'exam-1', category: 'P1' }]); }
    };
    const context = vm.createContext({ window, document: { addEventListener() {} },
        console: { error(...args) { errors.push(args); }, warn() {} } });
    vm.runInContext(source, context);
    const app = vm.runInContext('new ExamSystemApp()', context);
    const rendered = [];
    app.updateStatElement = (id, value) => rendered.push([id, value]);
    app.updateCategoryStats = () => {};
    app.renderOverviewCards = () => {};
    return { app, stats, summaries, calls, errors, rendered };
}

async function flush() { for (let round = 0; round < 8; round++) await Promise.resolve(); }

test('startup begins both canonical stats and light summaries without waiting for either result', async () => {
    const h = harness();
    let ready = false;
    const initialization = h.app.loadInitialData().then(() => { ready = true; });
    assert.deepEqual(h.calls, ['canonical-stats', 'active-index', 'summaries:light']);
    h.summaries.resolve([{ examId: 'exam-1', accuracy: 80, startTime: '2026-01-01T12:00:00Z' }]);
    await flush();
    assert.ok(h.rendered.some(([id, value]) => id === 'completed-exams' && value === 1));
    assert.equal(ready, false, 'startup must still wait for the independent canonical stats read');
    h.stats.resolve({ totalPractices: 7, averageScore: 92 });
    await initialization;
    assert.equal(ready, true);
    assert.equal(h.app.userStats.totalPractices, 7, 'user statistics still come from getStats, not overview reconstruction');
    assert.equal(h.app.userStats.averageScore, 92);
    assert.equal(h.app.userStats.totalTimeSpent, 0, 'existing fallback fields remain populated');
    assert.equal(h.errors.length, 0);
});

test('overview failure cannot signal startup readiness while canonical stats are still pending', async () => {
    const h = harness();
    let ready = false;
    const initialization = h.app.loadInitialData().then(() => { ready = true; });
    const failure = new Error('summary read failed');
    h.summaries.reject(failure);
    await flush();
    assert.equal(ready, false);
    assert.equal(h.errors.length, 0, 'error handling runs after both initial reads settle');
    h.stats.resolve({ totalPractices: 9 });
    await initialization;
    assert.equal(h.app.userStats.totalPractices, 9);
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0][0], 'Failed to load initial data:');
    assert.equal(h.errors[0][1], failure);
});

test('concurrent failures retain the former canonical stats-first error priority', async () => {
    const h = harness();
    const initialization = h.app.loadInitialData();
    const statsFailure = new Error('canonical stats failed');
    h.summaries.reject(new Error('overview failed first'));
    await flush();
    h.stats.reject(statsFailure);
    await initialization;
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0][1], statsFailure);
});
