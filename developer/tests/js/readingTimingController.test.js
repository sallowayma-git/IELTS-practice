import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const sources = ['services/readingTiming.js', 'runtime/readingTimingController.js']
    .map(file => fs.readFileSync(new URL(`../../../js/${file}`, import.meta.url), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
    let clock = 0;
    let pauseRestores = 0;
    const acquisitions = [];
    const saves = [];
    const retryTimers = [];
    let nextTimerId = 1;
    const events = new Map();
    const context = { sessionId: 'session-a', parentAttemptId: 'suite-a', sequenceIndex: 0,
        examId: 'p1', libraryConfigurationId: null, editable: true, running: true, timerInteractionRevision: 0,
        dataset: { questionOrder: ['q1', 'q2'], questionGroups: [{ questionIds: ['q1', 'q2'] }] },
        restorePause() { pauseRestores++; context.running = false; } };
    const row = snapshot => ({ snapshot: plain(snapshot), updatedAt: new Date(10000 + clock).toISOString() });
    const sandbox = { document: { visibilityState: 'visible', hasFocus: () => true,
        getElementById: () => null, addEventListener() {} },
        performance: { now: () => clock, timeOrigin: 10000 },
        crypto: { randomUUID: () => 'new-writer' }, setInterval() {},
        setTimeout(callback, delay) {
            const timer = { id: nextTimerId++, callback, delay };
            retryTimers.push(timer);
            return timer.id;
        },
        clearTimeout(id) {
            const index = retryTimers.findIndex(timer => timer.id === id);
            if (index >= 0) retryTimers.splice(index, 1);
        },
        addEventListener(type, callback) { events.set(type, callback); },
        AppData: { recovery: {
            async acquireReadingTiming(snapshot, previous) {
                acquisitions.push({ snapshot: plain(snapshot), previous: plain(previous) });
                await options.acquire?.(snapshot, previous, acquisitions.length);
                return row(snapshot);
            },
            async getReadingTiming() {
                return options.get?.();
            },
            async saveReadingTiming(snapshot) {
                saves.push(plain(snapshot));
                await options.save?.(snapshot, saves.length);
                return options.savedRow ? options.savedRow(row(snapshot)) : row(snapshot);
            }
        } } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    sources.forEach(source => vm.runInContext(source, sandbox));
    const controller = new sandbox.ReadingTimingController(() => ({ ...context }));
    return { controller, context, acquisitions, saves, retryTimers, events,
        get pauseRestores() { return pauseRestores; },
        advance(ms) { clock += ms; controller.refresh(); },
        async runNextRetry() {
            const timer = retryTimers.shift();
            assert.ok(timer, 'an acquisition retry should be scheduled');
            await timer.callback();
        },
        setRunning(running) { context.running = running; controller.refresh(); },
        interactTimer(running) { context.timerInteractionRevision++; context.running = running; controller.refresh(); },
        async move(examId, sequenceIndex, draft = null) {
            controller.stop();
            Object.assign(context, { examId, sequenceIndex });
            await controller.activate(draft);
        },
        draft({ examId = context.examId, sequenceIndex = context.sequenceIndex, paused = true } = {}) {
            const meter = new sandbox.ReadingTiming.Meter(context.dataset, {
                attemptId: `restored-${examId}`, examId, sequenceIndex,
                parentAttemptId: context.parentAttemptId, libraryConfigurationId: null, writer: 'old-writer'
            });
            meter.eligibility(true, 0); meter.select('q2', 0); meter.tick(2000);
            meter.value.paused = paused;
            return { readingTiming: plain(meter.snapshot()), updatedAt: 5000 };
        }
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('submission owns timing through a held real save return even if the caller still reports editable', async () => {
    const h = harness();
    await h.controller.activate();
    h.controller.select('q1');
    h.advance(1000);
    const held = deferred();
    const release = deferred();
    const save = h.controller.save.bind(h.controller);
    h.controller.save = async (...args) => {
        const result = await save(...args);
        if (args[0]?.meter.value.frozen) { held.resolve(); await release.promise; }
        return result;
    };
    const owner = {};
    const freezing = h.controller.freezeAll([], owner);
    await held.promise;
    const accepted = plain(h.controller.snapshot());
    h.controller.select('q2');
    h.advance(2000);
    h.setRunning(false);
    h.controller.stop();
    await h.controller.activate();
    assert.deepEqual(plain(h.controller.snapshot()), accepted);
    release.resolve();
    const frozen = await freezing;
    assert.deepEqual(plain(frozen[0].snapshot), accepted);
    assert.deepEqual(plain(frozen[0].snapshot), plain(h.controller.active.acknowledged));
    assert.equal(Object.isFrozen(frozen[0].snapshot.units), true);
    assert.throws(() => { frozen[0].snapshot.frozen = false; }, TypeError);
    h.controller.select('q2');
    assert.equal(h.controller.snapshot().frozen, true, 'handoff keeps ownership until an explicit definite-failure transition');
    assert.equal(h.controller.releaseSubmission({}), false);
    assert.equal(h.controller.releaseSubmission(owner), true);
    h.setRunning(true);
    h.controller.select('q2');
    h.advance(1000);
    assert.equal(h.controller.snapshot().frozen, false);
    assert.equal(h.controller.snapshot().totalMs, accepted.totalMs + 1000);
});

test('freeze awaits initial acquisition and includes restored inactive children in required order', async () => {
    const acquire = deferred();
    const h = harness({ acquire: (_snapshot, _previous, count) => count === 1 ? acquire.promise : undefined });
    const first = h.draft({ paused: false });
    const activating = h.controller.activate(first);
    const required = [
        { context: { ...h.context }, draft: first },
        { context: { ...h.context, examId: 'p2', sequenceIndex: 1 }, draft: h.draft({ examId: 'p2', sequenceIndex: 1 }) }
    ];
    const freezing = h.controller.freezeAll(required);
    h.advance(3000);
    acquire.resolve();
    const snapshots = await freezing;
    await activating;
    assert.equal(h.controller.active, null, 'late activation must not regain timing eligibility');
    assert.deepEqual(plain(snapshots.map(item => [item.snapshot.examId, item.snapshot.totalMs, item.snapshot.frozen])),
        [['p1', 2000, true], ['p2', 2000, true]]);
    assert.equal(h.acquisitions.length, 2);
    assert.equal(h.pauseRestores, 0, 'inactive restored pause cannot alter an accepted submission');
    for (const value of snapshots) assert.deepEqual(plain(value.snapshot), h.saves.find(item => item.attemptId === value.snapshot.attemptId));
});

test('a failed freeze drains sibling saves before editing or retry can resume', async () => {
    const held = deferred();
    const release = deferred();
    const h = harness({ async save(snapshot) {
        if (!snapshot.frozen) return;
        if (snapshot.examId === 'p1') throw new Error('Storage temporarily full');
        held.resolve();
        await release.promise;
    } });
    await h.controller.activate();
    const firstContext = { ...h.context };
    await h.move('p2', 1);
    const pending = h.controller.freezeAll([{ context: firstContext }, { context: { ...h.context } }]);
    const rejected = assert.rejects(pending, /Storage temporarily full/);
    await held.promise;
    h.controller.select('q2');
    h.advance(1000);
    assert.ok(h.controller.submission, 'a rejected sibling must not release a still-pending save');
    assert.equal(h.controller.snapshot().frozen, true);
    release.resolve();
    await rejected;
    assert.equal(h.controller.submission, null);
    h.controller.select('q2');
    assert.equal(h.controller.snapshot().frozen, false);
});

test('submission snapshots and late checkpoint failures stay bound to their original attempt', async () => {
    const held = deferred();
    const release = deferred();
    const h = harness({ async save(snapshot) {
        if (snapshot.parentAttemptId === 'suite-a' && snapshot.frozen) {
            held.resolve();
            await release.promise;
            throw new Error('Old attempt storage failure');
        }
    } });
    await h.controller.activate();
    const freezing = h.controller.freezeAll();
    const rejected = assert.rejects(freezing, { code: 'TIMING_SUBMISSION_STALE' });
    await held.promise;
    Object.assign(h.context, { sessionId: 'session-b', parentAttemptId: 'suite-b' });
    await h.controller.activate();
    h.advance(1000);
    const current = plain(h.controller.snapshot('p1'));
    release.resolve();
    await rejected;
    assert.equal(h.controller.error, '');
    assert.equal(h.controller.active.meter.value.parentAttemptId, 'suite-b');
    assert.deepEqual(plain(h.controller.snapshot('p1')), current);
    const frozen = await h.controller.freezeAll();
    assert.equal(frozen.length, 1);
    assert.equal(frozen[0].snapshot.parentAttemptId, 'suite-b');
});

test('a stale pageshow lookup cannot revoke ownership of a later active passage', async () => {
    const lookup = deferred();
    const h = harness({ get: () => lookup.promise });
    await h.controller.activate();
    const showing = h.events.get('pageshow')({ persisted: true });
    await h.move('p2', 1);
    lookup.resolve(null);
    await showing;
    assert.equal(h.controller.active.owned, true);
});

test('lost writers and mismatched acknowledgements cannot produce a submission snapshot', async () => {
    const lost = harness();
    await lost.controller.activate();
    lost.controller.active.owned = false;
    await assert.rejects(lost.controller.freezeAll(), { code: 'TIMING_STALE_WRITER' });
    lost.controller.select('q1');
    assert.equal(lost.controller.snapshot().frozen, true);

    const mismatch = harness({ savedRow(row) { row.snapshot.revision++; return row; } });
    await mismatch.controller.activate();
    await assert.rejects(mismatch.controller.freezeAll(), { code: 'TIMING_STALE_WRITER' });
});

test('revisiting a paused suite child preserves a later resume on another child', async () => {
    const h = harness();
    await h.controller.activate();
    h.advance(1000);
    h.setRunning(false);
    const first = plain(h.controller.snapshot());
    await h.move('p2', 1);
    assert.equal(h.context.running, false);
    h.setRunning(true);
    await h.move('p1', 0);
    assert.equal(h.context.running, true);
    assert.equal(h.pauseRestores, 0);
    h.advance(1000);
    assert.equal(h.controller.snapshot().paused, false);
    assert.equal(h.controller.snapshot().totalMs, first.totalMs + 1000);
});

test('restored pause applies once per attempt, including uncached inactive suite children', async () => {
    const h = harness();
    const firstDraft = h.draft();
    await h.controller.activate(firstDraft);
    assert.equal(h.context.running, false);
    h.advance(1000);
    assert.equal(h.controller.snapshot().totalMs, firstDraft.readingTiming.totalMs);
    h.setRunning(true);
    await h.move('p2', 1, h.draft({ examId: 'p2', sequenceIndex: 1 }));
    assert.equal(h.context.running, true);
    await h.move('p1', 0, firstDraft);
    await h.controller.activate(firstDraft);
    assert.equal(h.context.running, true);
    assert.equal(h.pauseRestores, 1);
});

test('a different restored attempt can still restore its own pause', async () => {
    const h = harness();
    await h.controller.activate();
    h.interactTimer(true);
    h.context.sessionId = 'session-b';
    h.context.parentAttemptId = 'suite-b';
    await h.controller.activate(h.draft());
    assert.equal(h.context.running, false);
    assert.equal(h.pauseRestores, 1);
});

test('an explicit resume survives repeated failed acquisition and a successful retry', async () => {
    const h = harness({ acquire(_snapshot, _previous, count) {
        if (count < 3) throw new Error('Storage temporarily full');
    } });
    h.context.running = false;
    const draft = h.draft();
    await h.controller.activate(draft);
    h.interactTimer(true);
    h.advance(2000);
    await h.controller.retry();
    assert.equal(h.controller.active, null);
    await h.controller.retry();
    assert.equal(h.context.running, true);
    assert.equal(h.pauseRestores, 0);
    assert.equal(h.controller.snapshot().attemptId, draft.readingTiming.attemptId);
    assert.equal(h.controller.snapshot().totalMs, draft.readingTiming.totalMs);
    h.advance(2000);
    assert.equal(h.controller.snapshot().paused, false);
    assert.equal(h.controller.snapshot().totalMs, draft.readingTiming.totalMs + 2000);
});

test('pending acquisition honors the latest timer action across repeated activation', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const h = harness({ acquire: () => pending });
    h.context.running = false;
    const draft = h.draft();
    const firstActivation = h.controller.activate(draft);
    h.interactTimer(true);
    const repeatedActivation = h.controller.activate(draft);
    h.advance(2000);
    release();
    await Promise.all([firstActivation, repeatedActivation]);
    assert.equal(h.acquisitions.length, 1);
    assert.equal(h.context.running, true);
    assert.equal(h.pauseRestores, 0);
    assert.equal(h.controller.snapshot().totalMs, draft.readingTiming.totalMs);
    h.advance(1000);
    assert.equal(h.controller.snapshot().totalMs, draft.readingTiming.totalMs + 1000);
});

test('pause restoration still applies after pending acquisition without a new timer action', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const h = harness({ acquire: () => pending });
    const draft = h.draft();
    const activation = h.controller.activate(draft);
    h.advance(2000);
    release();
    await activation;
    assert.equal(h.context.running, false);
    assert.equal(h.pauseRestores, 1);
    h.advance(2000);
    assert.equal(h.controller.snapshot().totalMs, draft.readingTiming.totalMs);
});

test('pause after a pending resume remains the latest explicit timer intent', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const h = harness({ acquire: () => pending });
    h.context.running = false;
    const draft = h.draft();
    const activation = h.controller.activate(draft);
    h.interactTimer(true);
    h.interactTimer(false);
    release();
    await activation;
    assert.equal(h.context.running, false);
    assert.equal(h.pauseRestores, 0);
    h.advance(2000);
    assert.equal(h.controller.snapshot().totalMs, draft.readingTiming.totalMs);
});

test('retry recovers initial acquisition with the original saved identity, groups and totals', async () => {
    const h = harness({ acquire(_snapshot, _previous, count) {
        if (count === 1) throw new Error('Storage temporarily full');
    } });
    const draft = h.draft();
    await h.controller.activate(draft);
    assert.equal(h.controller.active, null);
    assert.match(h.controller.error, /Storage temporarily full/);
    h.advance(3000);
    await h.controller.retry();
    assert.equal(h.acquisitions.length, 2);
    assert.deepEqual(h.acquisitions[1].previous, draft.readingTiming);
    const recovered = plain(h.controller.snapshot());
    assert.equal(recovered.attemptId, draft.readingTiming.attemptId);
    assert.deepEqual(recovered.units, draft.readingTiming.units);
    assert.equal(recovered.totalMs, draft.readingTiming.totalMs);
    assert.ok(recovered.partialReasons.includes('save-failed'));
    assert.equal(h.context.running, false);
    assert.equal(h.controller.error, '');
    h.setRunning(true);
    h.advance(1000);
    await h.controller.save();
    assert.equal(h.saves.at(-1).totalMs, draft.readingTiming.totalMs + 1000);
});

test('retry on a fresh attempt starts partial measurement only after acquisition succeeds', async () => {
    const h = harness({ acquire(_snapshot, _previous, count) {
        if (count < 3) throw new Error('Storage temporarily full');
    } });
    await h.controller.activate();
    h.advance(4000);
    await h.controller.retry();
    assert.equal(h.controller.active, null);
    await h.controller.retry();
    assert.equal(h.acquisitions.length, 3);
    assert.equal(h.controller.snapshot().totalMs, 0);
    assert.ok(h.controller.snapshot().partialReasons.includes('save-failed'));
    h.advance(1000);
    assert.equal(h.controller.snapshot().totalMs, 1000);
});

test('recoverable initial acquisition retries automatically with bounded backoff', async () => {
    const h = harness({ acquire(_snapshot, _previous, count) {
        if (count < 3) throw new Error('Storage temporarily full');
    } });
    await h.controller.activate();
    assert.equal(h.acquisitions.length, 1);
    assert.equal(h.retryTimers.length, 1);
    assert.equal(h.retryTimers[0].delay, 1000);

    await h.runNextRetry();
    assert.equal(h.acquisitions.length, 2);
    assert.equal(h.retryTimers.length, 1);
    assert.equal(h.retryTimers[0].delay, 2000);

    await h.runNextRetry();
    assert.equal(h.acquisitions.length, 3);
    assert.ok(h.controller.active);
    assert.equal(h.controller.failedActivation, null);
    assert.equal(h.retryTimers.length, 0);
});

test('automatic acquisition retry is cancelled when its passage becomes stale', async () => {
    const h = harness({ acquire() { throw new Error('Storage temporarily full'); } });
    await h.controller.activate();
    assert.equal(h.retryTimers.length, 1);
    h.context.examId = 'p2';
    h.context.sequenceIndex = 1;
    await h.runNextRetry();
    assert.equal(h.acquisitions.length, 1);
    assert.equal(h.controller.active, null);
    assert.equal(h.retryTimers.length, 0);
});

test('non-recoverable acquisition errors do not schedule an infinite retry loop', async () => {
    const h = harness({ acquire() {
        const error = new Error('Reading timing is already submitted');
        error.code = 'TIMING_FINALIZED';
        throw error;
    } });
    await h.controller.activate();
    assert.equal(h.acquisitions.length, 1);
    assert.equal(h.retryTimers.length, 0);
    assert.match(h.controller.error, /已经提交/);
});

test('retry ignores a failed acquisition after the active passage or editability changes', async () => {
    const h = harness({ acquire() { throw new Error('Storage temporarily full'); } });
    await h.controller.activate(h.draft());
    h.context.examId = 'p2';
    h.context.sequenceIndex = 1;
    await h.controller.retry();
    assert.equal(h.acquisitions.length, 1);
    h.context.examId = 'p1';
    h.context.sequenceIndex = 0;
    h.context.editable = false;
    await h.controller.retry();
    assert.equal(h.acquisitions.length, 1);
    assert.equal(h.controller.active, null);
});

test('retry still saves an acquired entry after a checkpoint failure', async () => {
    const h = harness({ save(_snapshot, count) {
        if (count === 1) throw new Error('Storage temporarily full');
    } });
    await h.controller.activate();
    h.advance(1000);
    await assert.rejects(h.controller.save(), /Storage temporarily full/);
    await h.controller.retry();
    assert.equal(h.acquisitions.length, 1);
    assert.equal(h.saves.length, 2);
    assert.equal(h.controller.error, '');
    assert.equal(h.controller.active.acknowledged.totalMs, 1000);
});

test('trusted pool pointer presses select their shared groups before any answer drop', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent(`<div id="right"><div id="question-groups">
            <section data-question-ids="q1,q2"><div class="drag-item" draggable="true"><span>Heading</span></div></section>
            <section data-question-ids="q3,q4"><div class="draggable-word" draggable="true"><span>Word</span></div></section>
            <section data-question-ids="q5,q6"><div class="card" draggable="true"><span>Card</span></div></section>
        </div></div><div id="left"><div class="paragraph-dropzone" data-question="q7">
            <div class="drag-item" draggable="true"><span>Assigned heading</span></div>
        </div></div>`);
        for (const source of sources) await page.addScriptTag({ content: source });
        await page.evaluate(async () => {
            let clock = 0;
            performance.now = () => clock;
            window.AppData = { recovery: {
                async acquireReadingTiming(snapshot) { return { snapshot, updatedAt: new Date().toISOString() }; },
                async saveReadingTiming(snapshot) { return { snapshot, updatedAt: new Date().toISOString() }; }
            } };
            window.controller = new ReadingTimingController(() => ({
                sessionId: 'pointer-session', examId: 'pointer-exam', libraryConfigurationId: null,
                editable: true, running: true, dataset: {
                    questionOrder: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
                    questionGroups: [{ questionIds: ['q1', 'q2'] }, { questionIds: ['q3', 'q4'] }, { questionIds: ['q5', 'q6'] }]
                }
            }));
            clearInterval(controller.interval);
            window.advanceTiming = () => { clock += 1000; controller.refresh(); return controller.snapshot(); };
            await controller.activate();
        });
        await page.locator('#question-groups .drag-item span').dispatchEvent('pointerdown');
        assert.equal((await page.evaluate(() => advanceTiming())).unallocatedMs, 1000);
        for (const [index, selector] of ['#question-groups .drag-item', '.draggable-word', '.card', '#left .drag-item'].entries()) {
            await page.locator(`${selector} span`).hover();
            await page.mouse.down();
            try {
                const measured = await page.evaluate(() => advanceTiming());
                assert.equal(measured.unallocatedMs, 1000);
                assert.deepEqual(measured.units.map(unit => unit.durationMs),
                    [0, 1, 2, 3].map(unitIndex => unitIndex <= index ? 1000 : 0));
            } finally { await page.mouse.up(); }
        }
    } finally { await browser.close(); }
});
