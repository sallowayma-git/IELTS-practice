#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const examSessionSource = fs.readFileSync(path.join(root, 'js/app/examSessionMixin.js'), 'utf8');

function createTestContext() {
    const sandbox = { ExamSystemAppMixins: {} };
    const context = vm.createContext(sandbox);
    vm.runInContext(examSessionSource, context, { filename: 'examSessionMixin.js' });
    return Object.assign({}, sandbox.ExamSystemAppMixins.examSession);
}

async function testScoreFieldBoundaryConditions() {
    const mixin = createTestContext();

    // null, undefined, 0, explicit zero vs missing
    // Note: _deriveReplayScoreInfo fills in 0/0 defaults when no comparison exists
    const nullScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'null-score',
        scoreInfo: { correct: null, total: 10 }
    })[0];
    assert.strictEqual(
        nullScoreReplay.scoreInfo.correct,
        0,
        'null correct coerces to 0 via normalizeNonNegative + derive fallback'
    );
    assert.strictEqual(nullScoreReplay.scoreInfo.total, 10);

    const undefinedScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'undefined-score',
        scoreInfo: { correct: undefined, total: 10 }
    })[0];
    assert.strictEqual(
        undefinedScoreReplay.scoreInfo.correct,
        0,
        'undefined correct falls back to derived 0'
    );

    const explicitZeroReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'explicit-zero',
        scoreInfo: { correct: 0, total: 10 }
    })[0];
    assert.strictEqual(
        explicitZeroReplay.scoreInfo.correct,
        0,
        'explicit zero correct must be preserved as authoritative'
    );
    assert.strictEqual(explicitZeroReplay.scoreInfo.total, 10);

    const missingScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'missing-score',
        scoreInfo: { total: 10 }
    })[0];
    assert.strictEqual(
        missingScoreReplay.scoreInfo.correct,
        0,
        'missing correct falls back to derived 0'
    );
    assert.strictEqual(missingScoreReplay.scoreInfo.total, 10);

    // 0/0, 0/10, 10/0 combinations
    const zeroOverZeroReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'zero-over-zero',
        scoreInfo: { correct: 0, total: 0 }
    })[0];
    assert.strictEqual(zeroOverZeroReplay.scoreInfo.correct, 0);
    assert.strictEqual(zeroOverZeroReplay.scoreInfo.total, 0);

    const zeroOverTenReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'zero-over-ten',
        scoreInfo: { correct: 0, total: 10 }
    })[0];
    assert.strictEqual(zeroOverTenReplay.scoreInfo.correct, 0);
    assert.strictEqual(zeroOverTenReplay.scoreInfo.total, 10);

    const tenOverZeroReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'ten-over-zero',
        scoreInfo: { correct: 10, total: 0 }
    })[0];
    assert.strictEqual(
        tenOverZeroReplay.scoreInfo.correct,
        10,
        'correct > total must be accepted (validation is AppData concern)'
    );
    assert.strictEqual(tenOverZeroReplay.scoreInfo.total, 0);

    // Very large values (>1000)
    const largeScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'large-score',
        scoreInfo: { correct: 5000, total: 10000 }
    })[0];
    assert.strictEqual(largeScoreReplay.scoreInfo.correct, 5000);
    assert.strictEqual(largeScoreReplay.scoreInfo.total, 10000);

    // String vs number coercion
    const stringScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'string-score',
        scoreInfo: { correct: '8', total: '10' }
    })[0];
    assert.strictEqual(
        stringScoreReplay.scoreInfo.correct,
        8,
        'numeric string must coerce to number'
    );
    assert.strictEqual(stringScoreReplay.scoreInfo.total, 10);

    const whitespaceStringReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'whitespace-string',
        scoreInfo: { correct: '  8  ', total: '  10  ' }
    })[0];
    assert.strictEqual(
        whitespaceStringReplay.scoreInfo.correct,
        8,
        'numeric string with whitespace must trim and coerce'
    );
    assert.strictEqual(whitespaceStringReplay.scoreInfo.total, 10);

    const invalidStringReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'invalid-string',
        scoreInfo: { correct: 'abc', total: 10 }
    })[0];
    assert.strictEqual(
        invalidStringReplay.scoreInfo.correct,
        0,
        'non-numeric string must be rejected and fall back to derived 0'
    );

    // Negative values (should reject)
    const negativeCorrectReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'negative-correct',
        scoreInfo: { correct: -5, total: 10 }
    })[0];
    assert.strictEqual(
        negativeCorrectReplay.scoreInfo.correct,
        0,
        'negative correct must be rejected and fall back to derived 0'
    );

    const negativeTotalReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'negative-total',
        scoreInfo: { correct: 8, total: -10 }
    })[0];
    assert.strictEqual(
        negativeTotalReplay.scoreInfo.total,
        0,
        'negative total must be rejected and fall back to derived 0'
    );

    // Percentage/accuracy edge cases
    // 0%, 100%, 0.5%, 150% (invalid), negative
    const zeroPercentReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'zero-percent',
        scoreInfo: { percentage: 0 }
    })[0];
    assert.strictEqual(zeroPercentReplay.scoreInfo.percentage, 0);
    assert.strictEqual(zeroPercentReplay.scoreInfo.accuracy, 0);

    const hundredPercentReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'hundred-percent',
        scoreInfo: { percentage: 100 }
    })[0];
    assert.strictEqual(hundredPercentReplay.scoreInfo.percentage, 100);
    assert.strictEqual(hundredPercentReplay.scoreInfo.accuracy, 1);

    const halfPercentReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'half-percent',
        scoreInfo: { percentage: 0.5 }
    })[0];
    assert.strictEqual(halfPercentReplay.scoreInfo.percentage, 0.5);
    assert.strictEqual(
        halfPercentReplay.scoreInfo.accuracy,
        0.005,
        '0.5% must convert to 0.005 accuracy'
    );

    const invalidPercentReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'invalid-percent',
        scoreInfo: { percentage: 150 }
    })[0];
    assert.strictEqual(
        invalidPercentReplay.scoreInfo.percentage,
        0,
        'percentage > 100 must be rejected and fall back to derived 0'
    );

    const negativePercentReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'negative-percent',
        scoreInfo: { percentage: -10 }
    })[0];
    assert.strictEqual(
        negativePercentReplay.scoreInfo.percentage,
        0,
        'negative percentage must be rejected and fall back to derived 0'
    );

    // Accuracy: 0, 1, 0.5, 1.5 (denormalized), -0.1
    const zeroAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'zero-accuracy',
        scoreInfo: { accuracy: 0 }
    })[0];
    assert.strictEqual(zeroAccuracyReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(zeroAccuracyReplay.scoreInfo.percentage, 0);

    const oneAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'one-accuracy',
        scoreInfo: { accuracy: 1 }
    })[0];
    assert.strictEqual(oneAccuracyReplay.scoreInfo.accuracy, 1);
    assert.strictEqual(oneAccuracyReplay.scoreInfo.percentage, 100);

    const halfAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'half-accuracy',
        scoreInfo: { accuracy: 0.5 }
    })[0];
    assert.strictEqual(halfAccuracyReplay.scoreInfo.accuracy, 0.5);
    assert.strictEqual(halfAccuracyReplay.scoreInfo.percentage, 50);

    const denormalizedAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'denormalized-accuracy',
        scoreInfo: { accuracy: 80 }
    })[0];
    assert.strictEqual(
        denormalizedAccuracyReplay.scoreInfo.accuracy,
        0.8,
        'percent-form accuracy (>1, <=100) must normalize to ratio'
    );
    assert.strictEqual(denormalizedAccuracyReplay.scoreInfo.percentage, 80);

    const overNormalizedAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'over-normalized-accuracy',
        scoreInfo: { accuracy: 150 }
    })[0];
    assert.strictEqual(
        overNormalizedAccuracyReplay.scoreInfo.accuracy,
        0,
        'accuracy > 100 must be rejected and fall back to derived 0'
    );

    const negativeAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'negative-accuracy',
        scoreInfo: { accuracy: -0.1 }
    })[0];
    assert.strictEqual(
        negativeAccuracyReplay.scoreInfo.accuracy,
        0,
        'negative accuracy must be rejected and fall back to derived 0'
    );

    // Rounding: 0.005 → percentage?, 0.335 → 34% or 33%?
    const roundingEdgeCaseReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'rounding-edge',
        scoreInfo: { accuracy: 0.335 }
    })[0];
    assert.strictEqual(roundingEdgeCaseReplay.scoreInfo.accuracy, 0.335);
    assert.strictEqual(
        roundingEdgeCaseReplay.scoreInfo.percentage,
        34,
        '0.335 accuracy must round to 34% via Math.round'
    );

    const tinyAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'tiny-accuracy',
        scoreInfo: { accuracy: 0.005 }
    })[0];
    assert.strictEqual(tinyAccuracyReplay.scoreInfo.accuracy, 0.005);
    assert.strictEqual(
        tinyAccuracyReplay.scoreInfo.percentage,
        1,
        '0.005 accuracy must round to 1% via Math.round(0.5)'
    );

    // Math.round(0.8 * 100) vs stored 80
    const derivedPercentageReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'derived-percentage',
        scoreInfo: { accuracy: 0.8 }
    })[0];
    assert.strictEqual(
        derivedPercentageReplay.scoreInfo.percentage,
        80,
        'derived percentage must equal Math.round(0.8 * 100)'
    );

    const storedPercentageReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'stored-percentage',
        scoreInfo: { percentage: 80 }
    })[0];
    assert.strictEqual(
        storedPercentageReplay.scoreInfo.accuracy,
        0.8,
        'derived accuracy must equal 80 / 100'
    );

    // Counter combinations
    // Missing correct+total (both absent) - derive fills in 0/0
    const missingCountersReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'missing-counters',
        scoreInfo: {}
    })[0];
    assert.strictEqual(
        missingCountersReplay.scoreInfo.correct,
        0,
        'both counters missing falls back to derived 0'
    );
    assert.strictEqual(
        missingCountersReplay.scoreInfo.total,
        0,
        'both counters missing falls back to derived 0'
    );

    // Only correct, no total
    const onlyCorrectReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'only-correct',
        scoreInfo: { correct: 8 }
    })[0];
    assert.strictEqual(onlyCorrectReplay.scoreInfo.correct, 8);
    assert.strictEqual(
        onlyCorrectReplay.scoreInfo.total,
        0,
        'missing total falls back to derived 0'
    );

    // Only total, no correct
    const onlyTotalReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'only-total',
        scoreInfo: { total: 10 }
    })[0];
    assert.strictEqual(
        onlyTotalReplay.scoreInfo.correct,
        0,
        'missing correct falls back to derived 0'
    );
    assert.strictEqual(onlyTotalReplay.scoreInfo.total, 10);

    // Both zero (0/0)
    const bothZeroReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'both-zero',
        scoreInfo: { correct: 0, total: 0 }
    })[0];
    assert.strictEqual(bothZeroReplay.scoreInfo.correct, 0);
    assert.strictEqual(bothZeroReplay.scoreInfo.total, 0);

    console.log('✓ Score field boundary conditions passed');
}

async function testNestedStructureEdgeCases() {
    const mixin = createTestContext();

    // Missing rawData entirely
    const missingRawDataReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'missing-rawData',
        scoreInfo: { correct: 8, total: 10 }
    })[0];
    assert.strictEqual(missingRawDataReplay.scoreInfo.correct, 8);
    assert.strictEqual(missingRawDataReplay.scoreInfo.total, 10);

    // Missing realData entirely
    const missingRealDataReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'missing-realData',
        scoreInfo: { correct: 8, total: 10 }
    })[0];
    assert.strictEqual(missingRealDataReplay.scoreInfo.correct, 8);
    assert.strictEqual(missingRealDataReplay.scoreInfo.total, 10);

    // Missing scoreInfo at root
    const missingRootScoreInfoReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'missing-root-scoreInfo',
        correct: 8,
        total: 10
    })[0];
    assert.strictEqual(
        missingRootScoreInfoReplay.scoreInfo.correct,
        8,
        'legacy root aliases must work when scoreInfo is missing'
    );
    assert.strictEqual(missingRootScoreInfoReplay.scoreInfo.total, 10);

    // Missing scoreInfo at nested levels
    const missingNestedScoreInfoReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'missing-nested-scoreInfo',
        correct: 8,
        total: 10,
        realData: { correct: 5 }
    })[0];
    assert.strictEqual(
        missingNestedScoreInfoReplay.scoreInfo.correct,
        8,
        'root provenance must win when nested scoreInfo is missing'
    );

    // Empty object {} vs null vs undefined
    const emptyObjectReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'empty-object',
        scoreInfo: {}
    })[0];
    assert.strictEqual(
        emptyObjectReplay.scoreInfo.correct,
        0,
        'empty scoreInfo object falls back to derived 0'
    );

    const nullScoreInfoReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'null-scoreInfo',
        scoreInfo: null,
        correct: 8,
        total: 10
    })[0];
    assert.strictEqual(
        nullScoreInfoReplay.scoreInfo.correct,
        8,
        'null scoreInfo must fall back to root aliases'
    );

    const undefinedScoreInfoReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'undefined-scoreInfo',
        scoreInfo: undefined,
        correct: 8,
        total: 10
    })[0];
    assert.strictEqual(
        undefinedScoreInfoReplay.scoreInfo.correct,
        8,
        'undefined scoreInfo must fall back to root aliases'
    );

    // All nesting levels missing - derive fills in 0/0
    const completelyEmptyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'completely-empty'
    })[0];
    assert.strictEqual(
        completelyEmptyReplay.scoreInfo.correct,
        0,
        'completely empty entry falls back to derived 0'
    );
    assert.strictEqual(
        completelyEmptyReplay.scoreInfo.total,
        0,
        'completely empty entry falls back to derived 0'
    );

    console.log('✓ Nested structure edge cases passed');
}

async function testProvenanceMixingScenarios() {
    const mixin = createTestContext();

    // High-priority source has only accuracy, low-priority has only percentage (should NOT mix)
    const noMixingAccuracyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'no-mixing-accuracy',
        accuracy: 0.8,
        rawData: { percentage: 50 }
    })[0];
    assert.strictEqual(
        noMixingAccuracyReplay.scoreInfo.accuracy,
        0.8,
        'high-priority accuracy must be used'
    );
    assert.strictEqual(
        noMixingAccuracyReplay.scoreInfo.percentage,
        80,
        'percentage must derive from high-priority accuracy, not mix from low-priority'
    );

    // Accuracy from entry.scoreInfo, percentage from entry.rawData (should NOT mix)
    const noMixingNestedReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'no-mixing-nested',
        scoreInfo: { accuracy: 0.9 },
        rawData: { percentage: 50 }
    })[0];
    assert.strictEqual(noMixingNestedReplay.scoreInfo.accuracy, 0.9);
    assert.strictEqual(
        noMixingNestedReplay.scoreInfo.percentage,
        90,
        'percentage must derive from scoreInfo accuracy, not mix from rawData'
    );

    // Root metrics outrank nested scoreInfo within the same provenance. A
    // missing root sibling is derived instead of borrowed from nested data.
    const sameProvenanceMixReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'same-provenance-mix',
        accuracy: 0.9,
        scoreInfo: { percentage: 85 }
    })[0];
    assert.strictEqual(
        sameProvenanceMixReplay.scoreInfo.accuracy,
        0.9,
        'canonical root accuracy must outrank nested within same provenance'
    );
    assert.strictEqual(
        sameProvenanceMixReplay.scoreInfo.percentage,
        90,
        'percentage must derive from the root accuracy instead of nested scoreInfo'
    );

    // Counters at different provenances CAN mix (each counter resolved independently)
    const mixingCountersReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'mixing-counters',
        correctAnswers: 8,
        rawData: { totalQuestions: 20 }
    })[0];
    assert.strictEqual(mixingCountersReplay.scoreInfo.correct, 8);
    assert.strictEqual(
        mixingCountersReplay.scoreInfo.total,
        20,
        'counters resolve independently - correct from root, total from rawData'
    );

    // All fields at same provenance SHOULD mix
    const sameProvenanceCountersReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'same-provenance-counters',
        correctAnswers: 8,
        scoreInfo: { total: 10, accuracy: 0.8 }
    })[0];
    assert.strictEqual(
        sameProvenanceCountersReplay.scoreInfo.correct,
        8,
        'canonical root correct must be used'
    );
    assert.strictEqual(
        sameProvenanceCountersReplay.scoreInfo.total,
        10,
        'nested total within same provenance must be used'
    );
    assert.strictEqual(
        sameProvenanceCountersReplay.scoreInfo.accuracy,
        0.8,
        'nested accuracy within same provenance must be used'
    );

    console.log('✓ Provenance mixing scenarios passed');
}

async function testLegacyCompatibility() {
    const mixin = createTestContext();

    // Old field names: score vs correctAnswers
    const legacyScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'legacy-score',
        scoreInfo: { score: 8, total: 10 }
    })[0];
    assert.strictEqual(
        legacyScoreReplay.scoreInfo.correct,
        8,
        'legacy score alias must map to correct'
    );
    assert.strictEqual(legacyScoreReplay.scoreInfo.total, 10);

    // Canonical correctAnswers should outrank legacy score
    const canonicalOutranksLegacyReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'canonical-outranks',
        correctAnswers: 9,
        scoreInfo: { score: 5, total: 10 }
    })[0];
    assert.strictEqual(
        canonicalOutranksLegacyReplay.scoreInfo.correct,
        9,
        'canonical correctAnswers must outrank legacy score in scoreInfo'
    );

    // Non-standard combinations from v1 exports
    const v1ExportReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'v1-export',
        correct: 8,
        totalQuestions: 10,
        accuracy: 80
    })[0];
    assert.strictEqual(v1ExportReplay.scoreInfo.correct, 8);
    assert.strictEqual(v1ExportReplay.scoreInfo.total, 10);
    assert.strictEqual(
        v1ExportReplay.scoreInfo.accuracy,
        0.8,
        'percent-form accuracy from v1 must normalize'
    );

    console.log('✓ Legacy compatibility passed');
}

async function testGeneratedZeroProvenance() {
    const mixin = createTestContext();

    // A synthetic root zero without AppData's complete light-projection shape
    // is authored and must outrank nested scoreInfo.
    const explicitRootZeroesReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'explicit-root-zeroes',
        correctAnswers: 0,
        totalQuestions: 0,
        scoreInfo: { correct: 25, total: 40 }
    })[0];
    assert.strictEqual(explicitRootZeroesReplay.scoreInfo.correct, 0);
    assert.strictEqual(explicitRootZeroesReplay.scoreInfo.total, 0);

    // A zero quartet alone is not proof of an AppData projection. Without the
    // projection-only score:null field, stale rawData must not replace it.
    const explicitQuartetBeatsLowerDetailReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'explicit-quartet-beats-lower-detail',
        correctAnswers: 0,
        totalQuestions: 0,
        accuracy: 0,
        percentage: 0,
        rawData: { scoreInfo: { correct: 8, total: 10, accuracy: 0.8, percentage: 80 } }
    })[0];
    assert.strictEqual(explicitQuartetBeatsLowerDetailReplay.scoreInfo.correct, 0);
    assert.strictEqual(explicitQuartetBeatsLowerDetailReplay.scoreInfo.total, 0);
    assert.strictEqual(explicitQuartetBeatsLowerDetailReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(explicitQuartetBeatsLowerDetailReplay.scoreInfo.percentage, 0);

    // A nested legacy score is not projection evidence on its own. Without
    // AppData's matching root score field, the authored zero quartet wins.
    const authoredZeroQuartetWithLegacyScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'authored-zero-quartet-with-legacy-score',
        correctAnswers: 0,
        totalQuestions: 0,
        accuracy: 0,
        percentage: 0,
        scoreInfo: { score: 8, total: 10 }
    })[0];
    assert.strictEqual(authoredZeroQuartetWithLegacyScoreReplay.scoreInfo.correct, 0);
    assert.strictEqual(authoredZeroQuartetWithLegacyScoreReplay.scoreInfo.total, 0);
    assert.strictEqual(authoredZeroQuartetWithLegacyScoreReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(authoredZeroQuartetWithLegacyScoreReplay.scoreInfo.percentage, 0);

    // AppData projects the retained legacy score to the root as well. That
    // duplicated score field is the evidence that the root correct zero was
    // synthesized and that the nested legacy counters should be restored.
    const projectedLegacyScoreReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'projected-legacy-score',
        correctAnswers: 0,
        totalQuestions: 10,
        accuracy: 0,
        percentage: 0,
        score: 8,
        scoreInfo: { score: 8, total: 10 }
    })[0];
    assert.strictEqual(projectedLegacyScoreReplay.scoreInfo.correct, 8);
    assert.strictEqual(projectedLegacyScoreReplay.scoreInfo.total, 10);
    assert.strictEqual(projectedLegacyScoreReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(projectedLegacyScoreReplay.scoreInfo.percentage, 80);

    // Explicit root metric zeroes remain authoritative even when counters
    // could produce a different pair.
    const explicitMetricZeroesWithCountersReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'explicit-metric-zeroes-with-counters',
        correctAnswers: 8,
        totalQuestions: 10,
        accuracy: 0,
        percentage: 0
    })[0];
    assert.strictEqual(explicitMetricZeroesWithCountersReplay.scoreInfo.correct, 8);
    assert.strictEqual(explicitMetricZeroesWithCountersReplay.scoreInfo.total, 10);
    assert.strictEqual(explicitMetricZeroesWithCountersReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(explicitMetricZeroesWithCountersReplay.scoreInfo.percentage, 0);

    // Root zero metrics also outrank nested positives unless the containing
    // object matches AppData's generated summary shape.
    const rootZeroMetricBeatsNestedReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'root-zero-metric-beats-nested',
        accuracy: 0,
        percentage: 0,
        scoreInfo: { correct: 8, total: 10, accuracy: 0.8, percentage: 80 }
    })[0];
    assert.strictEqual(rootZeroMetricBeatsNestedReplay.scoreInfo.accuracy, 0);
    assert.strictEqual(rootZeroMetricBeatsNestedReplay.scoreInfo.percentage, 0);

    // Both root fields are resolved before nested scoreInfo, including an
    // explicit zero sibling.
    const rootPairReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'root-pair',
        accuracy: 0.8,
        percentage: 0,
        scoreInfo: { percentage: 80 }
    })[0];
    assert.strictEqual(rootPairReplay.scoreInfo.accuracy, 0.8);
    assert.strictEqual(rootPairReplay.scoreInfo.percentage, 0);

    // A corroborated nested zero authenticates the root zero as authored.
    const trueZeroReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'true-zero',
        correctAnswers: 0,
        scoreInfo: { correct: 0 }
    })[0];
    assert.strictEqual(
        trueZeroReplay.scoreInfo.correct,
        0,
        'a root zero corroborated by a nested zero must be preserved'
    );

    // A corroborated zero must also survive a stale positive at a lower
    // provenance.
    const corroboratedZeroBeatsLowerPositiveReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'corroborated-zero-beats-lower-positive',
        correctAnswers: 0,
        scoreInfo: { correct: 0 },
        rawData: { correct: 8 }
    })[0];
    assert.strictEqual(
        corroboratedZeroBeatsLowerPositiveReplay.scoreInfo.correct,
        0,
        'a corroborated zero must not be overridden by a lower-provenance alias'
    );

    // An uncorroborated root zero with no authored detail anywhere concedes 0.
    const isolatedRootZeroReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'isolated-root-zero',
        correctAnswers: 0,
        totalQuestions: 10
    })[0];
    assert.strictEqual(isolatedRootZeroReplay.scoreInfo.correct, 0);
    assert.strictEqual(isolatedRootZeroReplay.scoreInfo.total, 10);

    console.log('✓ Generated zero provenance passed');
}

async function testComplexProvenance() {
    const mixin = createTestContext();

    // Test all provenance layers with conflicting values
    const multiLayerReplay = mixin._buildReviewReplayEntriesFromRecord({
        examId: 'multi-layer',
        correctAnswers: 10,
        totalQuestions: 12,
        accuracy: 0.83,
        percentage: 83,
        scoreInfo: {
            correct: 9,
            total: 11,
            accuracy: 0.82,
            percentage: 82
        },
        realData: {
            correctAnswers: 8,
            totalQuestions: 10,
            accuracy: 0.8,
            percentage: 80,
            scoreInfo: {
                correct: 7,
                total: 9,
                accuracy: 0.78,
                percentage: 78
            }
        },
        rawData: {
            correctAnswers: 6,
            totalQuestions: 8,
            accuracy: 0.75,
            percentage: 75,
            scoreInfo: {
                correct: 5,
                total: 7,
                accuracy: 0.71,
                percentage: 71
            }
        }
    })[0];
    assert.strictEqual(
        multiLayerReplay.scoreInfo.correct,
        10,
        'root canonical correctAnswers must win over all nested sources'
    );
    assert.strictEqual(
        multiLayerReplay.scoreInfo.total,
        12,
        'root canonical totalQuestions must win over all nested sources'
    );
    assert.strictEqual(
        multiLayerReplay.scoreInfo.accuracy,
        0.83,
        'root canonical accuracy must win over nested scoreInfo'
    );
    assert.strictEqual(
        multiLayerReplay.scoreInfo.percentage,
        83,
        'root canonical percentage must win over nested scoreInfo'
    );

    console.log('✓ Complex provenance passed');
}

async function testParentAggregateBoundary() {
    const mixin = createTestContext();

    // An uncorroborated entry zero may keep probing its own provenance chain
    // (rawData/realData/scoreInfo) but must never cross into the aggregate
    // parent record's groups, even when the caller passes distinct
    // entry/record objects with isSuiteEntry=false.
    const zeroStaysZero = mixin._resolveReplaySourceScoreInfo(
        { examId: 'parent-boundary-entry', correctAnswers: 0 },
        { correct: 8, total: 10 },
        false,
        false
    );
    assert.strictEqual(
        zeroStaysZero.correct,
        0,
        'an uncorroborated entry zero must not import the parent record legacy correct count'
    );
    assert.strictEqual(
        zeroStaysZero.total,
        10,
        'a missing entry total may still fall back to the parent per field'
    );

    // An ordinary root zero also outranks stale detail within the entry's own
    // rawData chain; only a recognized AppData projection may descend.
    const explicitZeroBeatsEntryRawData = mixin._resolveReplaySourceScoreInfo(
        {
            examId: 'parent-boundary-chain-entry',
            correctAnswers: 0,
            rawData: { scoreInfo: { correct: 8, total: 10 } }
        },
        { correct: 3, total: 4 },
        false,
        false
    );
    assert.strictEqual(
        explicitZeroBeatsEntryRawData.correct,
        0,
        'an explicit root zero must not be replaced by stale entry rawData'
    );
    assert.strictEqual(explicitZeroBeatsEntryRawData.total, 10);

    // A corroborated zero is authored and needs no boundary protection, but
    // must also never be overridden by parent aggregate counters.
    const corroboratedZero = mixin._resolveReplaySourceScoreInfo(
        { examId: 'parent-boundary-corroborated', correctAnswers: 0, scoreInfo: { correct: 0 } },
        { correct: 8, total: 10 },
        false,
        false
    );
    assert.strictEqual(corroboratedZero.correct, 0);

    console.log('✓ Parent aggregate boundary passed');
}

async function run() {
    await testScoreFieldBoundaryConditions();
    await testNestedStructureEdgeCases();
    await testProvenanceMixingScenarios();
    await testLegacyCompatibility();
    await testGeneratedZeroProvenance();
    await testComplexProvenance();
    await testParentAggregateBoundary();
    console.log('\n✅ All score resolution boundary tests passed');
}

run().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
});
