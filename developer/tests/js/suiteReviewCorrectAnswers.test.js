#!/usr/bin/env node
/**
 * Regression: suite review must surface correct answers.
 *
 * Suite records persist `answerComparison` per question, but the entry
 * projection historically dropped `correctAnswerMap`. Review then rebuilt the
 * record with an empty correct-answer map, so every question rendered a blank
 * correct answer and `isCorrect: null`.
 *
 * Two defects had to be fixed together:
 *   (a) `_resolveReplayCorrectAnswerMap` never derived from `answerComparison`
 *       — this is what repairs already-stored records.
 *   (b) the `suiteEntries` projection omitted `correctAnswerMap`
 *       — this is what keeps new records self-describing.
 *
 * The safety property under all of it: when no correct answer is knowable,
 * review must degrade to `isCorrect: null`. It must never guess.
 */
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const code = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function createApp() {
    const documentStub = {
        addEventListener() {}, removeEventListener() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        createElement() { return { className: '', style: {} }; },
        dispatchEvent() { return true; }
    };
    const windowStub = {
        document: documentStub,
        addEventListener() {}, removeEventListener() {}, showMessage() {},
        location: { protocol: 'http:', origin: 'http://localhost', href: 'http://localhost/' },
        crypto: webcrypto,
        navigator: {},
        practiceConfig: { suite: {} }
    };
    const sandbox = {
        window: windowStub, document: documentStub, console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Math, URL, URLSearchParams, Uint8Array, Date, JSON,
        Object, Array, String, Number, Boolean, Set, Map, Promise
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    const app = {};
    Object.assign(app,
        windowStub.ExamSystemAppMixins.examSession,
        windowStub.ExamSystemAppMixins.suitePractice);
    return app;
}

function suiteRecord(entry) {
    return {
        id: 'record-1',
        examId: 'suite-1',
        title: '套题练习',
        suiteEntries: [Object.assign({ examId: 'reading-p1', rawData: {} }, entry)]
    };
}

const app = createApp();
let passed = 0;
function ok(label, fn) {
    fn();
    passed += 1;
    console.log(`  ok - ${label}`);
}

// Values are built inside the VM realm, so their prototypes differ from the
// host's. Round-trip through JSON before structural comparison.
function plain(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

console.log('suiteReviewCorrectAnswers');

// --- Stored records with no correctAnswerMap (the reported bug) -------------
ok('存量记录：从 answerComparison 反推正确答案', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A', q2: 'B' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true },
            q2: { userAnswer: 'B', correctAnswer: 'C', isCorrect: false }
        }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers), { q1: 'A', q2: 'C' });
    assert.strictEqual(built.answerComparison.q1.isCorrect, true);
    assert.strictEqual(built.answerComparison.q2.isCorrect, false);
    assert.strictEqual(built.answerComparison.q2.correctAnswer, 'C');
});

ok('新记录：显式 correctAnswerMap 直接生效', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers), { q1: 'A' });
});

ok('显式 correctAnswerMap 优先于 answerComparison 反推', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'AUTHORITATIVE' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'STALE' } }
    }))[0];
    assert.strictEqual(built.correctAnswers.q1, 'AUTHORITATIVE');
});

// --- Safety: never fabricate correctness ------------------------------------
ok('无任何来源时降级为 isCorrect: null，不瞎判对错', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A', q2: 'B' },
        answerComparison: {
            q1: { userAnswer: 'A' },
            q2: { userAnswer: 'B', correctAnswer: '' }
        }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers), {});
    assert.strictEqual(built.answerComparison.q1.isCorrect, null);
    assert.strictEqual(built.answerComparison.q2.isCorrect, null);
    assert.strictEqual(built.answerComparison.q2.correctAnswer, '');
});

ok('部分可推：只判定有来源的题', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A', q2: 'B' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'A' },
            q2: { userAnswer: 'B' }
        }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers), { q1: 'A' });
    assert.strictEqual(built.answerComparison.q1.isCorrect, true);
    assert.strictEqual(built.answerComparison.q2.isCorrect, null);
});

ok('空数组不被当作正确答案', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: [] },
        answerComparison: { q1: { userAnswer: [], correctAnswer: [] } }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers), {});
});

// --- Key normalization must not be bypassed ---------------------------------
ok('多选题数组正确答案可反推', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: ['A', 'B'] },
        answerComparison: { q1: { userAnswer: ['A', 'B'], correctAnswer: ['A', 'B'] } }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers).q1, ['A', 'B']);
});

ok('带 examId 前缀的复合键正确归一', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A' },
        answerComparison: { 'reading-p1::q1': { userAnswer: 'A', correctAnswer: 'Z' } }
    }))[0];
    assert.strictEqual(built.correctAnswers.q1, 'Z');
});

ok('他篇前缀的答案不被串用到本篇', () => {
    const built = app._buildReviewReplayEntriesFromRecord(suiteRecord({
        answers: { q1: 'A' },
        answerComparison: { 'other-exam::q1': { userAnswer: 'A', correctAnswer: 'WRONG' } }
    }))[0];
    assert.deepStrictEqual(plain(built.correctAnswers), {});
});

// --- Single-passage review must be unaffected -------------------------------
ok('单篇（非套题）回顾不受影响', () => {
    const built = app._buildReviewReplayEntriesFromRecord({
        id: 'record-2',
        examId: 'reading-solo',
        title: '单篇',
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true } },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    });
    assert.strictEqual(built.length, 1);
    assert.strictEqual(built[0].correctAnswers.q1, 'A');
    assert.strictEqual(built[0].answerComparison.q1.isCorrect, true);
});

ok('单篇无正确答案来源时同样降级为 null', () => {
    const built = app._buildReviewReplayEntriesFromRecord({
        id: 'record-3',
        examId: 'reading-solo',
        answers: { q1: 'A' },
        answerComparison: { q1: { userAnswer: 'A' } }
    });
    assert.deepStrictEqual(plain(built[0].correctAnswers), {});
    assert.strictEqual(built[0].answerComparison.q1.isCorrect, null);
});

console.log(`\n${passed} passed`);
