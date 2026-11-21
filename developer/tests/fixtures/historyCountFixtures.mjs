export function grade(userAnswer, correctAnswer, isCorrect, weight = 1, partialCorrectCount = isCorrect ? weight : 0) {
    return { userAnswer, correctAnswer, isCorrect, weight, partialCorrectCount };
}

export function record(id, comparison, correct, total, extra = {}) {
    return {
        id, examId: id, type: 'reading', status: 'completed',
        startTime: '2026-11-21T10:00:00.000Z',
        answers: Object.fromEntries(Object.entries(comparison).map(([key, row]) => [key, row.userAnswer])),
        correctAnswerMap: Object.fromEntries(Object.entries(comparison).map(([key, row]) => [key, row.correctAnswer])),
        answerComparison: comparison,
        ...(correct === undefined ? {} : { correctAnswers: correct }),
        ...(total === undefined ? {} : { totalQuestions: total }),
        ...(correct === undefined || total === undefined ? {} : {
            scoreInfo: { correct, total, source: 'unified_reading_page', details: structuredClone(comparison) }
        }),
        highlights: [{ text: 'Synthetic annotation', start: 0, end: 20 }],
        notes: { q1: 'Keep this note' },
        ...extra
    };
}

// Synthetic source-level reproductions from #311; not the reporter's original record.
export function fixtures() {
    const split = record('split', {
        q1: grade('wrong', 'one', false), q2: grade('wrong', 'two', false), q3: grade('wrong', 'three', false),
        q7: grade('C', 'C, E', true), q8: grade('E', 'C, E', true),
        q9: grade('B', 'B, D', true), q10: grade('D', 'B, D', true)
    }, 4, 7);
    const partial = record('partial', { q11: grade(['A'], ['A', 'B', 'C', 'D'], false, 4, 1) }, 1, 4);
    return {
        allWrong: record('all-wrong', { q11: grade(['D', 'E', 'F'], ['A', 'B', 'C'], false, 3, 0) }, 0, 3),
        partial, split,
        suite: record('suite', {}, 5, 11, { suiteEntries: [split, partial] }),
        incompleteSuite: record('incomplete-suite', {}, undefined, undefined, { suiteEntries: [
            record('a', { q1: grade('A', 'A', true) }, 1, 1),
            { examId: 'b', totalQuestions: 10, answers: {} }
        ] }),
        nestedIncompleteSuite: record('nested-incomplete-suite', {}, undefined, 3, { suiteEntries: [
            { id: 'nested-child', suiteEntries: [
                record('known-wrong', { q1: grade('B', 'A', false) }, 0, 1),
                { examId: 'ungraded', totalQuestions: 1, answers: {} },
                { examId: 'unknown-size', answers: {} }
            ] }
        ] }),
        summary: record('summary', {}, 7, 10),
        ordinary: record('ordinary', { q1: grade('A', 'A', true), q2: grade('B', 'A', false), q3: grade('', 'A', false) }, 1, 3),
        unknown: record('unknown', { q1: { userAnswer: 'A', correctAnswer: '', isCorrect: null } }),
        duplicate: record('duplicate', { q7: grade('C', 'C, E', true), q8: grade('C', 'C, E', false) }, 1, 2)
    };
}
