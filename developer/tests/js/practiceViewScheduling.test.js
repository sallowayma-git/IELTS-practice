import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const schedulingSource = mainSource.slice(mainSource.indexOf('// Dashboard charts are independent'),
    mainSource.indexOf('// Phase 3: 练习记录视图更新'));

function loadScheduler(browser = true) {
    const frames = new Map();
    const timers = new Map();
    const warnings = [];
    let id = 0;
    const state = { active: true, generation: 1 };
    const window = browser ? {
        requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
        cancelAnimationFrame(handle) { frames.delete(handle); }
    } : {};
    const context = vm.createContext({ window,
        document: { getElementById() { return { classList: { contains() { return state.active; } } }; } },
        setTimeout(callback) { timers.set(++id, callback); return id; },
        clearTimeout(handle) { timers.delete(handle); },
        readBrowseProgressGeneration() { return state.generation; },
        console: { warn(...args) { warnings.push(args); } }
    });
    vm.runInContext(schedulingSource, context);
    const tick = queue => {
        const next = queue.entries().next().value;
        assert.ok(next, 'Expected queued callback');
        queue.delete(next[0]); next[1]();
    };
    return { context, state, frames, timers, warnings,
        paint: () => tick(frames), task: () => tick(timers) };
}

test('practice insights yield a paint and separate independent sections into tasks', () => {
    const scheduler = loadScheduler();
    const calls = [];
    scheduler.context.queuePracticeInsightsRender([() => calls.push('accuracy'), () => calls.push('trend'), () => calls.push('priority')]);
    assert.deepEqual(calls, []);
    scheduler.paint();
    assert.deepEqual(calls, []);
    scheduler.task(); assert.deepEqual(calls, ['accuracy']);
    scheduler.task(); assert.deepEqual(calls, ['accuracy', 'trend']);
    scheduler.task(); assert.deepEqual(calls, ['accuracy', 'trend', 'priority']);
    assert.equal(scheduler.timers.size, 0);
});

test('new snapshots cancel older queued work and navigation aborts stale insights', () => {
    const scheduler = loadScheduler();
    const calls = [];
    scheduler.context.queuePracticeInsightsRender([() => calls.push('old')]);
    scheduler.paint();
    scheduler.context.queuePracticeInsightsRender([() => calls.push('latest')]);
    assert.equal(scheduler.timers.size, 0);
    scheduler.paint();
    scheduler.state.generation++;
    scheduler.task();
    assert.deepEqual(calls, []);
    // Equivalent to activation sync detecting an unchanged records signature.
    scheduler.context.flushPracticeInsightsRender();
    scheduler.paint(); scheduler.task();
    assert.deepEqual(calls, ['latest']);
});

test('hidden practice insights resume on activation without needing new record data', () => {
    const scheduler = loadScheduler();
    const calls = [];
    scheduler.state.active = false;
    scheduler.context.queuePracticeInsightsRender([() => calls.push('latest')]);
    assert.equal(scheduler.frames.size, 0);
    scheduler.state.active = true;
    scheduler.context.flushPracticeInsightsRender();
    scheduler.paint();
    scheduler.state.active = false;
    scheduler.task();
    assert.deepEqual(calls, []);
    scheduler.state.active = true;
    scheduler.context.flushPracticeInsightsRender();
    scheduler.paint(); scheduler.task();
    assert.deepEqual(calls, ['latest']);
});

test('hidden full history rendering retains latest snapshot and flushes it on unchanged activation', () => {
    const scheduler = loadScheduler();
    const calls = [];
    scheduler.context.filterRealPracticeRecordsForView = records => records;
    scheduler.context.computePracticeSummaryFallback = records => ({ totalPracticed: records.length });
    scheduler.context.ensurePracticeDashboardView = () => ({ updateSummary(summary) { calls.push(summary.totalPracticed); } });
    scheduler.context.document.getElementById = id => id === 'practice-view'
        ? { classList: { contains() { return scheduler.state.active; } } }
        : null;
    const updateSource = mainSource.slice(mainSource.indexOf('function updatePracticeView('),
        mainSource.indexOf('function searchPracticeHistory('));
    vm.runInContext(updateSource, scheduler.context);
    scheduler.context.queuePracticeInsightsRender([() => calls.push('obsolete-chart')]);
    scheduler.paint();
    scheduler.state.active = false;
    scheduler.context.updatePracticeView([{ id: 'old' }], []);
    scheduler.context.updatePracticeView([{ id: 'new1' }, { id: 'new2' }], []);
    assert.deepEqual(calls, []);
    assert.equal(scheduler.timers.size, 0);
    scheduler.state.active = true;
    scheduler.context.flushPracticeViewSnapshot();
    assert.deepEqual(calls, [2]);
    scheduler.context.flushPracticeViewSnapshot();
    assert.deepEqual(calls, [2], 'The accepted snapshot must only flush once');
});

test('section failures do not prevent later sections and non-browser rendering stays synchronous', () => {
    const scheduler = loadScheduler();
    let completed = false;
    scheduler.context.queuePracticeInsightsRender([() => { throw new Error('chart failed'); }, () => { completed = true; }]);
    scheduler.paint(); scheduler.task(); scheduler.task();
    assert.equal(completed, true);
    assert.equal(scheduler.warnings.length, 1);
    const synchronous = loadScheduler(false);
    let immediate = false;
    synchronous.context.queuePracticeInsightsRender([() => { immediate = true; }]);
    assert.equal(immediate, true);
});

function loadStatistics(DateClass = Date) {
    const window = {};
    const context = vm.createContext({ window, Date: DateClass, console });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/views/legacyViewBundle.js'), 'utf8'), context);
    return window;
}

test('history date sorting parses each date once and preserves ordering including invalid dates', () => {
    let dateCount = 0;
    class CountingDate extends Date { constructor(...args) { super(...args); dateCount++; } }
    const window = loadStatistics(CountingDate);
    const records = Array.from({ length: 5000 }, (_, i) => ({ id: i, date: new Date(1700000000000 + ((i * 73) % 997) * 60000).toISOString() }));
    records.splice(100, 0, { id: 'invalid', date: 'invalid' });
    const expected = records.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const actual = window.PracticeStats.sortByDateDesc(records);
    assert.equal(dateCount, records.length);
    assert.deepEqual(Array.from(actual, row => row.id), expected.map(row => row.id));
    assert.equal(records[0].id, 0, 'Sorting must not reorder authoritative input');
});

test('type lookup preserves the original first matching title or id and unmatched records', () => {
    const window = loadStatistics();
    const exams = [{ id: 'earlier', title: 'shared', type: 'listening' }, { id: 'later', title: 'other', type: 'reading' }];
    const records = [{ id: 1, examId: 'later', title: 'shared' }, { id: 2, examId: 'later', title: 'different' },
        { id: 3, examId: 'unknown', title: 'unknown' }];
    const result = window.PracticeStats.filterByExamType(records, exams, 'reading');
    assert.deepEqual(Array.from(result, row => row.id), [2, 3]);
});

test('bounded recent trend selection matches complete stable sorting for all configured ranges', () => {
    const window = loadStatistics();
    const renderer = new window.PracticeTrendRenderer();
    renderer.records = Array.from({ length: 5000 }, (_, i) => ({
        date: i % 31 === 0 ? 'invalid' : new Date(Date.now() - ((i * 43) % 111) * 86400000).toISOString(),
        percentage: i % 103
    }));
    const all = renderer._selectPoints(null);
    for (const count of [10, 20]) {
        assert.equal(JSON.stringify(renderer._selectPoints({ mode: 'count', value: count })), JSON.stringify(all.slice(-count)));
    }
    for (const days of [7, 30]) {
        const cutoff = Date.now() - days * 86400000;
        const expected = all.filter(point => point.timestamp > 0 && point.timestamp >= cutoff);
        assert.equal(JSON.stringify(renderer._selectPoints({ mode: 'days', value: days })), JSON.stringify(expected));
    }
});
