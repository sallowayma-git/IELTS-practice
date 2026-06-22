#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createModalEnvironment() {
    const windowStub = {};
    const context = vm.createContext({
        window: windowStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        JSON,
        Date,
        Math,
        Number,
        Object,
        String,
        Array,
        parseInt
    });
    loadScript('js/components/practiceRecordModal.js', context);
    return {
        modal: windowStub.practiceRecordModal,
        window: windowStub
    };
}

function createModal() {
    return createModalEnvironment().modal;
}

function testMultiSuiteMetadataIsEscaped() {
    const modal = createModal();
    const html = modal.createModalHtml({
        id: 'record-1',
        multiSuite: true,
        metadata: {
            expectedSuiteCount: '<img src=x onerror=alert(1)>'
        },
        suiteEntries: [
            {
                title: 'Suite A',
                scoreInfo: {
                    correct: '<svg onload=alert(1)>',
                    total: '<iframe src=javascript:alert(1)>',
                    percentage: '<math href=javascript:alert(1)>'
                },
                answers: {}
            }
        ]
    });

    assert(!html.includes('<img src=x'));
    assert(!html.includes('<svg onload'));
    assert(!html.includes('<iframe src=javascript:'));
    assert(!html.includes('<math href=javascript:'));
    assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert(html.includes('&lt;svg onload=alert(1)&gt;'));
}

function testSummaryCountsAreNumericOnly() {
    const { modal, window } = createModalEnvironment();
    window.AnswerComparisonUtils = {
        getNormalizedEntries() {
            return [
                {
                    displayNumber: '1',
                    userAnswer: 'A',
                    correctAnswer: 'B',
                    isCorrect: false,
                    hasUserAnswer: true
                }
            ];
        },
        summariseEntries() {
            return {
                incorrect: '<img src=x onerror=alert(1)>',
                unanswered: '<svg onload=alert(1)>'
            };
        }
    };

    const html = modal.createModalHtml({
        id: 'record-2',
        metadata: {
            examTitle: 'Injected Summary'
        }
    });

    assert(!html.includes('<img src=x'));
    assert(!html.includes('<svg onload'));
    assert(html.includes('<span class="meta-value error-count">0</span>'));
    assert(html.includes('<span class="meta-value unanswered-count">0</span>'));
}

function testNormalizedEntriesAreBoundedAndTruncated() {
    const { modal, window } = createModalEnvironment();
    const longAnswer = `${'x'.repeat(260)}<script>alert(1)</script>`;
    window.AnswerComparisonUtils = {
        getNormalizedEntries() {
            return Array.from({ length: 520 }, (_, index) => ({
                displayNumber: `question-${index + 1}`,
                userAnswer: index === 0 ? 0 : longAnswer,
                correctAnswer: index === 0 ? false : longAnswer,
                isCorrect: index % 2 === 0,
                hasUserAnswer: true
            }));
        },
        summariseEntries(entries) {
            return {
                incorrect: entries.length,
                unanswered: 0
            };
        }
    };

    const html = modal.createModalHtml({
        id: 'record-bounded',
        metadata: {
            examTitle: 'Bounded normalized entries'
        }
    });

    const rows = html.match(/<tr class="answer-row/g) || [];
    assert.equal(rows.length, 500);
    assert(!html.includes(longAnswer));
    assert(!html.includes('<script>'));
    assert(html.includes('<td class="user-answer">0</td>'));
    assert(html.includes('<td class="correct-answer">False</td>'));
}

function testCircularLegacyComparisonDoesNotBreakModal() {
    const modal = createModal();
    const circular = {
        q1: {
            userAnswer: 'A',
            correctAnswer: 'A',
            isCorrect: true
        }
    };
    circular.self = circular;

    assert.doesNotThrow(() => modal.generateLegacyTableFromComparison(circular));
    const html = modal.generateLegacyTableFromComparison(circular);
    assert(html.includes('<td class="question-num">1</td>'));
    assert(html.includes('<td class="correct-answer" title="A">'));
    assert(!html.includes('self'));
}

function testDeepNestedAnswerValuesAreBounded() {
    const modal = createModal();
    let nested = 'final-answer';
    for (let index = 0; index < 2000; index += 1) {
        nested = [nested];
    }

    assert.doesNotThrow(() => modal.truncateAnswer(nested, 200));
    assert.equal(modal.truncateAnswer(nested, 200), '');
}

function testUnsafeMapKeysAreIgnored() {
    const modal = createModal();
    const pollutedComparison = JSON.parse('{"__proto__":{"userAnswer":"polluted","correctAnswer":"polluted"},"constructor":{"userAnswer":"ctor","correctAnswer":"ctor"},"q1":{"userAnswer":"A","correctAnswer":"B","isCorrect":false}}');
    const html = modal.generateLegacyTableFromComparison(pollutedComparison);
    const correctAnswers = modal.getLegacyCorrectAnswers({ answerComparison: pollutedComparison });

    assert(html.includes('<td class="question-num">1</td>'), 'safe entries should still render');
    assert(!html.includes('polluted'), 'unsafe __proto__ keys must not render');
    assert(!html.includes('ctor'), 'unsafe constructor keys must not render');
    assert.equal(Object.getPrototypeOf(correctAnswers), null, 'legacy correct answer maps should use a null prototype');
    assert.deepEqual(Object.keys(correctAnswers), ['q1']);
    assert.equal({}.polluted, undefined, 'unsafe keys must not pollute Object.prototype');
}

function testModalMapsAreBounded() {
    const modal = createModal();
    const oversized = {};
    for (let index = 0; index < 1105; index += 1) {
        oversized[`q${index}`] = { userAnswer: `A${index}`, correctAnswer: `B${index}` };
    }
    const normalized = modal.normalizeComparisonMap(oversized);

    assert.equal(Object.getPrototypeOf(normalized), null);
    assert.equal(Object.keys(normalized).length, 1000);
    assert.equal(normalized.q999.userAnswer, 'A999');
    assert.equal(normalized.q1000, undefined);
}

testMultiSuiteMetadataIsEscaped();
testSummaryCountsAreNumericOnly();
testNormalizedEntriesAreBoundedAndTruncated();
testCircularLegacyComparisonDoesNotBreakModal();
testDeepNestedAnswerValuesAreBounded();
testUnsafeMapKeysAreIgnored();
testModalMapsAreBounded();
console.log(JSON.stringify({
    status: 'pass',
    detail: 'practice record modal escaping tests passed'
}, null, 2));
