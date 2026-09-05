#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function createRuntime(preloadedScheduler) {
    const windowStub = preloadedScheduler
        ? { PracticeReviewScheduler: preloadedScheduler }
        : {};
    const context = vm.createContext({
        window: windowStub,
        globalThis: windowStub,
        Date,
        Math,
        Object,
        String,
        TypeError
    });

    function loadScript(relativePath) {
        vm.runInContext(
            fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
            context,
            { filename: relativePath }
        );
    }

    return { context, loadScript, windowStub };
}

function loadScheduler() {
    const runtime = createRuntime();
    runtime.loadScript('js/core/vocabScheduler.js');
    runtime.loadScript('js/core/practiceReviewScheduler.js');

    return runtime.windowStub.PracticeReviewScheduler;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

test('v2 upgrades a preloaded v1 scheduler and remains compatible with the v1 guard', () => {
    const legacyScheduler = Object.freeze({
        __v1: true,
        legacy: true
    });
    const runtime = createRuntime(legacyScheduler);
    runtime.loadScript('js/core/vocabScheduler.js');
    runtime.loadScript('js/core/practiceReviewScheduler.js');

    const upgradedScheduler = runtime.windowStub.PracticeReviewScheduler;
    assert.notEqual(upgradedScheduler, legacyScheduler);
    assert.equal(upgradedScheduler.__v1, true);
    assert.equal(upgradedScheduler.__v2, true);
    assert.equal(upgradedScheduler.legacy, undefined);

    vm.runInContext(`
        (function initLegacyScheduler(global) {
            if (global.PracticeReviewScheduler && global.PracticeReviewScheduler.__v1 === true) return;
            global.PracticeReviewScheduler = Object.freeze({ __v1: true, legacyOverride: true });
        })(typeof window !== 'undefined' ? window : globalThis);
    `, runtime.context, { filename: 'legacy-practiceReviewScheduler.js' });

    assert.equal(runtime.windowStub.PracticeReviewScheduler, upgradedScheduler);
    assert.equal(runtime.windowStub.PracticeReviewScheduler.legacyOverride, undefined);
});

test('replaying a good outcome leaves the scheduled state unchanged', () => {
    const scheduler = loadScheduler();
    const initial = scheduler.createInitialState('2026-09-01T08:00:00.000Z');
    const first = scheduler.scheduleOutcome(
        initial,
        'good',
        '2026-09-02T08:00:00.000Z',
        'attempt-good-1'
    );
    const replayInput = deepFreeze(clone(first));
    const replaySnapshot = clone(replayInput);
    const replay = scheduler.scheduleOutcome(
        replayInput,
        'good',
        '2026-09-10T08:00:00.000Z',
        'attempt-good-1'
    );

    assert.equal(first.reviewCount, 1);
    assert.equal(first.repetitions, 1);
    assert.equal(first.interval, 1);
    assert.equal(first.lapseCount, 0);
    assert.deepEqual(clone(replayInput), replaySnapshot);
    assert.deepEqual(clone(replay), replaySnapshot);
});

test('replaying a hard outcome does not add another lapse', () => {
    const scheduler = loadScheduler();
    const initial = scheduler.createInitialState('2026-09-01T08:00:00.000Z');
    const first = scheduler.scheduleOutcome(
        initial,
        'hard',
        '2026-09-02T08:00:00.000Z',
        'attempt-hard-1'
    );
    const replayInput = deepFreeze(clone(first));
    const replaySnapshot = clone(replayInput);
    const replay = scheduler.scheduleOutcome(
        replayInput,
        'hard',
        '2026-09-10T08:00:00.000Z',
        'attempt-hard-1'
    );

    assert.equal(first.reviewCount, 1);
    assert.equal(first.repetitions, 0);
    assert.equal(first.interval, 1);
    assert.equal(first.lapseCount, 1);
    assert.deepEqual(clone(replayInput), replaySnapshot);
    assert.deepEqual(clone(replay), replaySnapshot);
});

test('replaying an older hard attempt after a newer attempt remains idempotent', () => {
    const scheduler = loadScheduler();
    const initial = scheduler.createInitialState('2026-09-01T08:00:00.000Z');
    const first = scheduler.scheduleOutcome(
        initial,
        'hard',
        '2026-09-02T08:00:00.000Z',
        'attempt-a'
    );
    const second = scheduler.scheduleOutcome(
        first,
        'good',
        '2026-09-03T08:00:00.000Z',
        'attempt-b'
    );
    const replayInput = deepFreeze(clone(second));
    const replaySnapshot = clone(replayInput);
    const replay = scheduler.scheduleOutcome(
        replayInput,
        'hard',
        '2026-09-10T08:00:00.000Z',
        'attempt-a'
    );

    assert.equal(second.reviewCount, 2);
    assert.equal(second.lapseCount, 1);
    assert.equal(second.lastReviewAttemptId, 'attempt-b');
    assert.deepEqual(clone(second.appliedReviewAttemptIds), ['attempt-a', 'attempt-b']);
    assert.deepEqual(clone(replayInput), replaySnapshot);
    assert.deepEqual(clone(replay), replaySnapshot);
});

test('normalization migrates legacy attempt state and validates stored history', () => {
    const scheduler = loadScheduler();
    const initial = clone(scheduler.createInitialState('2026-09-01T08:00:00.000Z'));

    assert.deepEqual(initial.appliedReviewAttemptIds, []);

    delete initial.appliedReviewAttemptIds;
    initial.lastReviewAttemptId = 'legacy-attempt';
    const migrated = scheduler.normalizeState(initial);
    assert.deepEqual(clone(migrated.appliedReviewAttemptIds), ['legacy-attempt']);

    const legacyReplayInput = deepFreeze(clone(migrated));
    const legacyReplaySnapshot = clone(legacyReplayInput);
    const legacyReplay = scheduler.scheduleOutcome(
        legacyReplayInput,
        'hard',
        '2026-09-10T08:00:00.000Z',
        'legacy-attempt'
    );
    assert.deepEqual(clone(legacyReplayInput), legacyReplaySnapshot);
    assert.deepEqual(clone(legacyReplay), legacyReplaySnapshot);

    const normalized = scheduler.normalizeState({
        ...initial,
        lastReviewAttemptId: ' attempt-b ',
        appliedReviewAttemptIds: [' attempt-a ', 'attempt-a', 'attempt-b']
    });
    assert.deepEqual(clone(normalized.appliedReviewAttemptIds), ['attempt-a', 'attempt-b']);
    assert.equal(normalized.lastReviewAttemptId, 'attempt-b');

    assert.throws(
        () => scheduler.normalizeState({ ...initial, appliedReviewAttemptIds: 'attempt-a' }),
        /appliedReviewAttemptIds must be an array/
    );
    assert.throws(
        () => scheduler.normalizeState({ ...initial, appliedReviewAttemptIds: ['attempt-a', ' '] }),
        /appliedReviewAttemptIds must contain non-empty strings/
    );
    assert.throws(
        () => scheduler.normalizeState({ ...initial, appliedReviewAttemptIds: ['attempt-a', 2] }),
        /appliedReviewAttemptIds must contain non-empty strings/
    );
});
