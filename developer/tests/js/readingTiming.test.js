import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const sandbox = {};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../../../js/services/readingTiming.js', import.meta.url), 'utf8'), sandbox);
const api = sandbox.ReadingTiming;
const plain = value => JSON.parse(JSON.stringify(value));
const dataset = { questionOrder: ['q1', 'q2', 'q7', 'q8'], questionGroups: [{ questionIds: ['q7', 'q8'] }] };
const identity = { attemptId: 'attempt-a', examId: 'reading-a', libraryConfigurationId: null, writer: 'writer-a' };
function harness(saved = null, source = identity) {
    const meter = new api.Meter(dataset, source, saved);
    let clock = 0;
    return { meter, value: () => plain(meter.snapshot()),
        start() { meter.eligibility(true, clock); },
        select(q) { meter.select(q, clock); },
        stop() { meter.eligibility(false, clock); },
        freeze() { meter.freeze(clock); },
        advance(ms) { while (ms > 0) { const step = Math.min(ms, 1000); clock += step; ms -= step; meter.tick(clock); } },
        gap(ms) { clock += ms; meter.tick(clock); },
        duration(q) { return meter.snapshot().units.find(unit => unit.questionIds.includes(q)).durationMs; }
    };
}

test('pre-selection time stays unallocated; revisits and cleared answers add intervals', () => {
    const h = harness(); h.start(); h.advance(12000); h.select('q1'); h.advance(4000);
    h.select('q2'); h.advance(3000); h.select('q1'); h.advance(6000);
    assert.equal(h.value().unallocatedMs, 12000);
    assert.equal(h.duration('q1'), 10000);
    assert.equal(h.duration('q2'), 3000);
    assert.equal(h.value().totalMs, 25000);
});
test('shared and overlapping authored groups have one disjoint unit', () => {
    const h = harness(); h.start(); h.select('q7'); h.advance(4000); h.select('q8'); h.advance(6000);
    assert.equal(h.duration('q7'), 10000);
    assert.equal(h.value().units.filter(unit => unit.kind === 'group').length, 1);
    assert.equal(h.value().totalMs, 10000);
    const map = api.mapping({ questionOrder: ['1', '2', '3'], questionGroups: [
        { questionIds: ['1', '2'] }, { questionIds: ['2', '3'] }] });
    assert.deepEqual(plain(map.units[0].questionIds), ['1', '2', '3']);
});
test('pause/background/review gates exclude gaps and resume without a stale selection', () => {
    const h = harness(); h.start(); h.select('q1'); h.advance(5000); h.stop(); h.advance(40000);
    h.select('q2'); h.start(); h.advance(2000); h.select('q1'); h.advance(3000); h.freeze(); h.advance(9000);
    assert.equal(h.duration('q1'), 8000);
    assert.equal(h.duration('q2'), 0);
    assert.equal(h.value().unallocatedMs, 2000);
    assert.equal(h.value().totalMs, 10000);
});
test('restoration includes closed totals once and never replays closed-page time', () => {
    const h = harness(); h.start(); h.select('q1'); h.advance(7000);
    const saved = h.value(); h.advance(2000);
    const restored = harness(saved, { ...identity, writer: 'writer-b' });
    restored.gap(60000); restored.start(); restored.advance(2000);
    assert.equal(restored.duration('q1'), 7000);
    assert.equal(restored.value().totalMs, 9000);
    const again = harness(restored.value());
    assert.equal(again.value().totalMs, 9000);
    assert.throws(() => harness(saved, { ...identity, libraryConfigurationId: 'other' }));
});
test('long unobserved gaps are omitted while normal subsecond checkpoints retain precision', () => {
    const h = harness(); h.start(); h.select('q1');
    for (let i = 0; i < 10; i++) h.advance(100.25);
    assert.equal(h.duration('q1'), 1002);
    h.gap(8000); h.advance(500);
    assert.equal(h.duration('q1'), 1002);
    assert.equal(h.value().unallocatedMs, 500);
    assert.deepEqual(h.value().partialReasons, ['unobserved-gap']);
});
test('unsupported membership and malformed records do not create zero-valued measurements', () => {
    const meter = new api.Meter({ questionOrder: ['q1', 'q2'], questionGroups: [{ questionIds: ['q1', 'missing'] }] }, identity);
    assert.deepEqual(plain(meter.snapshot().unsupportedQuestionIds), ['q1']);
    assert.ok(api.normalize(meter.snapshot()));
    const h = harness(); h.start(); h.advance(1000);
    for (const changed of [{ totalMs: 0 }, { unallocatedMs: -1 }, { version: 2 }, { libraryConfigurationId: undefined }, { revision: NaN }]) {
        assert.equal(api.normalize({ ...h.value(), ...changed }), null);
    }
    assert.match(sandbox.ReadingTimingView.render({ duration: 120 }), /不可用/);
    assert.doesNotMatch(sandbox.ReadingTimingView.render({ suiteEntries: [{ duration: 120 }] }), /已测总时长 0/);
    assert.equal(api.extract({ examId: 'another-exam', readingTiming: h.value() }), null);
    assert.equal(api.extract({ metadata: { libraryConfigurationId: 'another-library' }, readingTiming: h.value() }), null);
});
test('suite totals deduplicate exact attempts but retain repeated exams and source isolation', () => {
    const h = harness(); h.start(); h.select('q1'); h.advance(4000);
    const first = { readingTiming: h.value() };
    const second = { readingTiming: { ...h.value(), attemptId: 'second-slot' } };
    const otherLibrary = { readingTiming: { ...h.value(), libraryConfigurationId: 'other' } };
    const value = api.aggregate([first, first, second, otherLibrary, { duration: 999 }]);
    assert.equal(value.totalMs, 12000);
    assert.equal(value.measuredChildren, 3);
    assert.equal(value.unavailable, 1);
    assert.equal(value.partial, true);
});
test('frozen snapshots are idempotent and source durations remain separate', () => {
    const h = harness(); h.start(); h.select('q1'); h.advance(1234); h.freeze();
    const saved = h.value(); h.freeze(); h.advance(50000);
    assert.deepEqual(h.value(), saved);
    const summary = api.summary(saved);
    assert.equal(summary.totalMs, 1234);
    assert.equal(summary.units, undefined);
    assert.equal(api.format(999), '不足 1 秒');
    assert.equal(api.format(0), '0 秒');
});

test('conflicting copies of one child are unavailable instead of selecting an arbitrary duration', () => {
    const h = harness(); h.start(); h.select('q1'); h.advance(1000);
    const first = h.value();
    const conflicting = structuredClone(first);
    conflicting.units[0].durationMs = 0; conflicting.unallocatedMs = 1000;
    const total = api.aggregate([{ readingTiming: first }, { readingTiming: conflicting }, { readingTiming: first }]);
    assert.equal(total.totalMs, 0);
    assert.equal(total.measuredChildren, 0);
    assert.equal(total.unavailable, 1);
    assert.equal(total.partial, true);
});
