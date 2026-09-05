(function initPracticeReviewScheduler(global) {
    'use strict';

    if (global.PracticeReviewScheduler && global.PracticeReviewScheduler.__v2 === true) return;

    const vocabScheduler = global.VocabScheduler;
    if (!vocabScheduler
        || typeof vocabScheduler.calculateEaseFactor !== 'function'
        || typeof vocabScheduler.calculateNextReview !== 'function') {
        throw new Error('PracticeReviewScheduler requires VocabScheduler');
    }

    const QUALITY_VALUES = Object.freeze({ hard: 2, good: 4, easy: 5 });
    const VALID_QUALITIES = Object.freeze(Object.keys(QUALITY_VALUES));

    function validIso(value, label) {
        const time = new Date(value).getTime();
        if (!Number.isFinite(time)) throw new TypeError(`${label || 'date'} must be a valid date`);
        return new Date(time).toISOString();
    }

    function normalizeAppliedAttemptIds(value) {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw new TypeError('appliedReviewAttemptIds must be an array');
        const normalized = [];
        const seen = new Set();
        for (const rawAttemptId of value) {
            if (typeof rawAttemptId !== 'string') {
                throw new TypeError('appliedReviewAttemptIds must contain non-empty strings');
            }
            const attemptId = rawAttemptId.trim();
            if (!attemptId) throw new TypeError('appliedReviewAttemptIds must contain non-empty strings');
            if (seen.has(attemptId)) continue;
            seen.add(attemptId);
            normalized.push(attemptId);
        }
        return normalized;
    }

    function createInitialState(referenceTime) {
        const nextReview = validIso(referenceTime || new Date(), 'referenceTime');
        return {
            schemaVersion: 1,
            algorithm: 'sm2-practice',
            algorithmVersion: 1,
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
            reviewCount: 0,
            lapseCount: 0,
            lastReviewed: null,
            nextReview,
            lastQuality: null,
            lastReviewAttemptId: null,
            appliedReviewAttemptIds: [],
            updatedAt: nextReview
        };
    }

    function normalizeState(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('reviewState must be an object');
        }
        if (Number(input.schemaVersion) !== 1
            || input.algorithm !== 'sm2-practice'
            || Number(input.algorithmVersion) !== 1) {
            throw new TypeError('Unsupported practice review state');
        }
        const easeFactor = Number(input.easeFactor);
        const interval = Number(input.interval);
        const repetitions = Number(input.repetitions);
        const reviewCount = Number(input.reviewCount);
        const lapseCount = Number(input.lapseCount);
        if (!Number.isFinite(easeFactor) || easeFactor < 1.3 || easeFactor > 3) throw new TypeError('Invalid easeFactor');
        if (!Number.isFinite(interval) || interval < 0) throw new TypeError('Invalid interval');
        if (![repetitions, reviewCount, lapseCount].every((value) => Number.isInteger(value) && value >= 0)) {
            throw new TypeError('Invalid review counters');
        }
        const lastReviewed = input.lastReviewed == null ? null : validIso(input.lastReviewed, 'lastReviewed');
        const nextReview = validIso(input.nextReview, 'nextReview');
        const updatedAt = validIso(input.updatedAt || nextReview, 'updatedAt');
        const lastQuality = input.lastQuality == null ? null : String(input.lastQuality);
        if (lastQuality !== null && !VALID_QUALITIES.includes(lastQuality)) throw new TypeError('Invalid lastQuality');
        const normalizedLastAttemptId = input.lastReviewAttemptId == null
            ? ''
            : String(input.lastReviewAttemptId).trim();
        const lastReviewAttemptId = normalizedLastAttemptId || null;
        const appliedReviewAttemptIds = normalizeAppliedAttemptIds(input.appliedReviewAttemptIds);
        if (lastReviewAttemptId && !appliedReviewAttemptIds.includes(lastReviewAttemptId)) {
            appliedReviewAttemptIds.push(lastReviewAttemptId);
        }
        return {
            schemaVersion: 1,
            algorithm: 'sm2-practice',
            algorithmVersion: 1,
            easeFactor,
            interval,
            repetitions,
            reviewCount,
            lapseCount,
            lastReviewed,
            nextReview,
            lastQuality,
            lastReviewAttemptId,
            appliedReviewAttemptIds,
            updatedAt
        };
    }

    function scheduleOutcome(input, quality, reviewedAt, reviewAttemptId) {
        const current = normalizeState(input);
        const normalizedQuality = String(quality || '').toLowerCase();
        if (!VALID_QUALITIES.includes(normalizedQuality)) throw new TypeError('quality must be hard, good, or easy');
        const attemptId = String(reviewAttemptId || '').trim();
        if (!attemptId) throw new TypeError('reviewAttemptId is required');
        if (current.appliedReviewAttemptIds.includes(attemptId)) return current;
        const timestamp = validIso(reviewedAt || new Date(), 'reviewedAt');
        const nextEaseFactor = vocabScheduler.calculateEaseFactor(current.easeFactor, QUALITY_VALUES[normalizedQuality]);
        let repetitions;
        let interval;
        let lapseCount = current.lapseCount;

        if (normalizedQuality === 'hard') {
            repetitions = 0;
            interval = 1;
            lapseCount += 1;
        } else if (normalizedQuality === 'easy' && current.repetitions === 0) {
            repetitions = 2;
            interval = 6;
        } else if (current.repetitions === 0) {
            repetitions = 1;
            interval = 1;
        } else if (current.repetitions === 1) {
            repetitions = 2;
            interval = 6;
        } else {
            repetitions = current.repetitions + 1;
            interval = Math.max(1, Math.round(current.interval * nextEaseFactor));
        }

        return {
            schemaVersion: 1,
            algorithm: 'sm2-practice',
            algorithmVersion: 1,
            easeFactor: nextEaseFactor,
            interval,
            repetitions,
            reviewCount: current.reviewCount + 1,
            lapseCount,
            lastReviewed: timestamp,
            nextReview: vocabScheduler.calculateNextReview(interval, timestamp).toISOString(),
            lastQuality: normalizedQuality,
            lastReviewAttemptId: attemptId,
            appliedReviewAttemptIds: current.appliedReviewAttemptIds.concat(attemptId),
            updatedAt: timestamp
        };
    }

    global.PracticeReviewScheduler = Object.freeze({
        __v1: true,
        __v2: true,
        QUALITY_VALUES,
        VALID_QUALITIES,
        createInitialState,
        normalizeState,
        scheduleOutcome
    });
})(typeof window !== 'undefined' ? window : globalThis);
