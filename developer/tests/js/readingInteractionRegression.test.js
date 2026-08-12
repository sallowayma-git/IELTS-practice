#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const require = createRequire(import.meta.url);

require(path.join(repoRoot, 'js', 'core', 'practiceCore.js'));
require(path.join(repoRoot, 'js', 'utils', 'answerMatchCore.js'));
const AnswerComparisonUtils = require(path.join(repoRoot, 'js', 'utils', 'answerComparisonUtils.js'));

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function resolveBrowserExecutable() {
    const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        path.join(repoRoot, 'developer', 'tests', 'e2e', '.pw-browsers', 'browsers', 'chromium_headless_shell-1194', 'chrome-win', 'headless_shell.exe')
    ];
    return candidates.find((candidate) => fs.existsSync(candidate));
}

function testAnswerDetailUnknownState() {
    const unknownEntries = AnswerComparisonUtils.getNormalizedEntries({
        answers: { q1: 'A' },
        correctAnswerMap: {}
    });
    assert.equal(unknownEntries.length, 1);
    assert.equal(unknownEntries[0].isCorrect, null, 'missing correct answers must remain unknown');
    assert.deepEqual(AnswerComparisonUtils.summariseEntries(unknownEntries), {
        total: 1,
        correct: 0,
        incorrect: 0,
        unanswered: 0,
        unknown: 1
    });

    const filteredEntries = AnswerComparisonUtils.getNormalizedEntries({
        answers: {
            q1: 'A',
            practiceSettings: 'timed',
            lastFocusElement: 'q1',
            nextExamId: 'reading-p2'
        },
        correctAnswerMap: { q1: 'A' }
    });
    assert.deepEqual(filteredEntries.map((entry) => entry.canonicalKey), ['q1']);
}

async function testBrowserInteractions() {
    const executablePath = resolveBrowserExecutable();
    const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
    const page = await browser.newPage();
    try {
        await page.setContent(`<!doctype html>
            <html><head></head><body>
                <header><div class="header-right"></div></header>
                <div id="highlight-root">alpha <span class="hl" data-note-id="note-1">repeat</span> middle <span class="hl" data-note-id="note-2">repeat</span> omega</div>
                <input type="checkbox" name="q8-9" value="A">
                <input type="checkbox" name="q8-9" value="B">
                <input type="checkbox" name="q8-9" value="C">
                <input type="checkbox" name="q12_40" value="A">
                <input type="checkbox" name="q12_40" value="B">
                <input type="checkbox" name="q12_40" value="C">
                <input type="radio" name="q1" value="A" checked>
                <div class="shell"><div id="left"></div><div id="divider"></div><div id="right"><div id="question-groups"></div></div></div>
                <div id="results"></div>
                <div id="question-nav"></div>
                <button id="submit-btn" type="button">Submit</button>
                <button id="reset-btn" type="button">Reset</button>
                <button id="exit-btn" type="button">Exit</button>
            </body></html>`);

        await page.addScriptTag({ content: read('js/runtime/readingHighlightShared.js') });
        const highlightSnapshot = await page.evaluate(() => {
            const root = document.getElementById('highlight-root');
            const shared = window.__READING_HIGHLIGHT_SHARED__;
            const first = shared.snapshotHighlights({ left: root });
            shared.restoreHighlights({ left: root }, first);
            const second = shared.snapshotHighlights({ left: root });
            return { first, second };
        });
        assert.equal(highlightSnapshot.first.length, 2, 'duplicate highlight text must snapshot both DOM ranges');
        assert.deepEqual(highlightSnapshot.first.map((entry) => entry.start), [6, 20]);
        assert.deepEqual(highlightSnapshot.first.map((entry) => entry.noteId), ['note-1', 'note-2']);
        assert.deepEqual(highlightSnapshot.second.map((entry) => entry.start), [6, 20]);
        assert.deepEqual(highlightSnapshot.second.map((entry) => entry.noteId), ['note-1', 'note-2']);

        await page.evaluate(() => {
            window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
        });
        await page.addScriptTag({ content: read('js/utils/answerSanitizer.js') });
        await page.addScriptTag({ content: read('js/utils/answerMatchCore.js') });
        await page.addScriptTag({ content: read('js/runtime/unifiedReadingPage.js') });

        const replayChecks = await page.evaluate(() => {
            const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
            hooks.setTestState({
                dataset: {
                    questionOrder: ['q8', 'q9', 'q12'],
                    answerKey: { q8: 'A', q9: 'C', q12: ['A', 'C'] },
                    questionGroups: [
                        { groupId: 'split', kind: 'multi_choice', questionIds: ['q8', 'q9'] },
                        { groupId: 'single', kind: 'multi_choice', questionIds: ['q12'] }
                    ]
                }
            });
            hooks.applyReplayAnswersToDom({
                q8: ['A', 'C'],
                q9: ['A', 'C'],
                q12: ['A', 'C']
            });
            return {
                split: Array.from(document.querySelectorAll('input[name="q8-9"]')).map((input) => input.checked),
                single: Array.from(document.querySelectorAll('input[name="q12_40"]')).map((input) => input.checked)
            };
        });
        assert.deepEqual(replayChecks.split, [true, false, true]);
        assert.deepEqual(replayChecks.single, [true, false, true]);

        const unknownPresentation = await page.evaluate(() => {
            const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
            hooks.captureDom();
            hooks.setTestState({
                dataset: {
                    meta: { category: 'P1' },
                    questionOrder: ['q1'],
                    answerKey: {},
                    questionGroups: []
                }
            });
            const results = {
                answers: { q1: 'A' },
                answerComparison: {
                    q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: '', isCorrect: null }
                },
                scoreInfo: { correct: 0, total: 1, totalQuestions: 1, percentage: 0 }
            };
            hooks.renderResults(results);
            hooks.updateNavStatuses(results);
            return {
                unknownCount: document.querySelectorAll('#results .result-unknown').length,
                incorrectCount: document.querySelectorAll('#results .result-incorrect').length,
                navStatus: Object.fromEntries(hooks.getTestState().navStatus).q1
            };
        });
        assert.deepEqual(unknownPresentation, {
            unknownCount: 1,
            incorrectCount: 0,
            navStatus: 'answered'
        });

        const suiteActivation = await page.evaluate(async () => {
            const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
            const makeDataset = (category, label) => ({
                meta: { category, title: label },
                passage: { blocks: [{ html: `<p>${label} passage</p>` }] },
                questionOrder: ['q1'],
                questionDisplayMap: { q1: category === 'P2' ? '14' : '1' },
                answerKey: { q1: 'A' },
                questionGroups: [{
                    groupId: `${category}-group`,
                    kind: 'multiple_choice',
                    questionIds: ['q1'],
                    bodyHtml: `<div class="group"><label><input id="slot-input" type="radio" name="q1" value="A"> A</label><div class="pool-items"><div class="drag-item" draggable="true">Choice</div></div></div>`
                }]
            });
            const p1 = makeDataset('P1', 'Part 1');
            const p2 = makeDataset('P2', 'Part 2');
            const p2Results = {
                answers: { q1: 'A' },
                answerComparison: {
                    q1: { questionId: 'q1', userAnswer: 'A', correctAnswer: 'A', isCorrect: true }
                },
                scoreInfo: { correct: 1, total: 1, totalQuestions: 1, percentage: 100 }
            };
            const emptyDraft = (answer) => ({
                answers: { q1: answer },
                highlights: [],
                notes: [],
                noteOutlines: [],
                markedQuestions: [],
                noteText: '',
                scrollY: 0,
                updatedAt: Date.now()
            });
            hooks.captureDom();
            hooks.setTestOverride('renderExplanations', () => {
                const marker = document.createElement('div');
                marker.className = 'reading-explanation-card test-explanation';
                document.getElementById('question-groups')?.appendChild(marker);
                return Promise.resolve();
            });
            hooks.setTestState({
                examId: 'p1',
                dataKey: 'p1',
                dataset: p1,
                suiteSessionId: 'suite-reading',
                simulationMode: true,
                simulationContextReady: true,
                reviewMode: true,
                submitted: true,
                readOnly: true,
                readOnlyReason: 'stationary-review',
                timerLocked: false,
                suite: {
                    inline: true,
                    activeExamId: 'p1',
                    currentIndex: 0,
                    sequence: [
                        { examId: 'p1', category: 'P1' },
                        { examId: 'p2', category: 'P2' }
                    ],
                    slotsByExamId: new Map([
                        ['p1', { examId: 'p1', dataKey: 'p1', dataset: p1, draft: emptyDraft('A'), navStatus: new Map(), lastResults: null }],
                        ['p2', { examId: 'p2', dataKey: 'p2', dataset: p2, draft: emptyDraft('A'), navStatus: new Map(), lastResults: p2Results }]
                    ])
                }
            });
            await hooks.activateSuiteSlot('p2', { skipSave: true, skipDraftSync: true, silent: true });
            const review = {
                disabled: document.getElementById('slot-input')?.disabled,
                draggable: document.querySelector('#question-groups .drag-item')?.getAttribute('draggable'),
                resultCorrect: document.querySelectorAll('#results .result-correct').length,
                explanationCount: document.querySelectorAll('#question-groups .test-explanation').length
            };

            hooks.setTestState({
                reviewMode: false,
                submitted: false,
                readOnly: false,
                readOnlyReason: '',
                timerLocked: true
            });
            await hooks.activateSuiteSlot('p1', { skipSave: true, skipDraftSync: true, silent: true });
            const timerLock = {
                disabled: document.getElementById('slot-input')?.disabled,
                draggable: document.querySelector('#question-groups .drag-item')?.getAttribute('draggable'),
                resultsHtml: document.getElementById('results')?.innerHTML
            };
            return { review, timerLock };
        });
        assert.deepEqual(suiteActivation.review, {
            disabled: true,
            draggable: 'false',
            resultCorrect: 1,
            explanationCount: 1
        });
        assert.equal(suiteActivation.timerLock.disabled, true);
        assert.equal(suiteActivation.timerLock.draggable, 'false');
        assert.equal(suiteActivation.timerLock.resultsHtml, '');

        const suiteActivationRace = await page.evaluate(async () => {
            const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
            const makeDataset = (examId, category, label) => ({
                meta: { category, title: label },
                passage: { blocks: [{ html: `<p>shared ${label} passage</p>` }] },
                questionOrder: ['q1'],
                questionDisplayMap: { q1: category === 'P2' ? '14' : '27' },
                answerKey: { q1: 'A' },
                questionGroups: [{
                    groupId: `${examId}-group`,
                    kind: 'multiple_choice',
                    questionIds: ['q1'],
                    bodyHtml: `<div class="group"><label><input id="${examId}-input" type="radio" name="q1" value="A"> A</label><label><input type="radio" name="q1" value="B"> B</label><div class="pool-items"><div class="drag-item" draggable="true">${label} choice</div></div></div>`
                }]
            });
            const makeResults = (answer, isCorrect) => ({
                answers: { q1: answer },
                answerComparison: {
                    q1: { questionId: 'q1', userAnswer: answer, correctAnswer: 'A', isCorrect }
                },
                scoreInfo: {
                    correct: isCorrect ? 1 : 0,
                    total: 1,
                    totalQuestions: 1,
                    percentage: isCorrect ? 100 : 0
                }
            });
            const makeDraft = (answer, noteId, scrollY) => ({
                answers: { q1: answer },
                highlights: [{ scope: 'left', text: 'shared', kind: 'note', noteId, occurrence: 0 }],
                notes: [],
                noteOutlines: [],
                markedQuestions: [],
                noteText: '',
                scrollY,
                updatedAt: Date.now()
            });
            const p2 = makeDataset('race-p2', 'P2', 'Race Part 2');
            const p3 = makeDataset('race-p3', 'P3', 'Race Part 3');
            const releases = {};
            const committedExplanations = [];

            window.__lastReadingScrollY = null;
            window.scrollTo = (_x, y) => {
                window.__lastReadingScrollY = Number(y);
            };
            hooks.setTestOverride('renderExplanations', ({ examId } = {}) => new Promise((resolve) => {
                releases[examId] = () => resolve(() => {
                    const marker = document.createElement('div');
                    marker.className = 'reading-explanation-card race-explanation';
                    marker.dataset.examId = examId;
                    marker.textContent = `${examId} explanation`;
                    document.getElementById('question-groups')?.appendChild(marker);
                    committedExplanations.push(examId);
                });
            }));
            hooks.captureDom();
            hooks.setTestState({
                examId: 'race-p2',
                dataKey: 'race-p2',
                dataset: p2,
                simulationMode: true,
                simulationContextReady: true,
                reviewMode: true,
                submitted: true,
                readOnly: true,
                readOnlyReason: 'stationary-review',
                timerLocked: false,
                suite: {
                    inline: true,
                    activating: false,
                    activationGeneration: 0,
                    activeExamId: 'race-p2',
                    currentIndex: 0,
                    sequence: [
                        { examId: 'race-p2', category: 'P2' },
                        { examId: 'race-p3', category: 'P3' }
                    ],
                    slotsByExamId: new Map([
                        ['race-p2', {
                            examId: 'race-p2',
                            dataKey: 'race-p2',
                            dataset: p2,
                            draft: makeDraft('A', 'race-note-p2', 202),
                            navStatus: new Map(),
                            lastResults: makeResults('A', true)
                        }],
                        ['race-p3', {
                            examId: 'race-p3',
                            dataKey: 'race-p3',
                            dataset: p3,
                            draft: makeDraft('B', 'race-note-p3', 303),
                            navStatus: new Map(),
                            lastResults: makeResults('B', false)
                        }]
                    ])
                }
            });

            const p2Activation = hooks.activateSuiteSlot('race-p2', {
                skipSave: true,
                skipDraftSync: true,
                silent: true
            });
            const p3Activation = hooks.activateSuiteSlot('race-p3', {
                skipSave: true,
                skipDraftSync: true,
                silent: true
            });
            if (typeof releases['race-p2'] !== 'function' || typeof releases['race-p3'] !== 'function') {
                throw new Error('controlled explanation promises were not registered');
            }

            releases['race-p3']();
            const p3Activated = await p3Activation;
            releases['race-p2']();
            const p2Activated = await p2Activation;
            const testState = hooks.getTestState();

            return {
                p2Activated,
                p3Activated,
                activeExamId: testState.activeExamId,
                suiteActivating: testState.suiteActivating,
                activationGeneration: testState.activationGeneration,
                title: document.title,
                checkedValue: document.querySelector('input[name="q1"]:checked')?.value || '',
                disabled: document.querySelector('input[name="q1"]')?.disabled,
                explanationExamIds: Array.from(document.querySelectorAll('.race-explanation')).map((node) => node.dataset.examId),
                committedExplanations,
                highlightNoteId: document.querySelector('#left .hl')?.dataset.noteId || '',
                resultCorrect: document.querySelectorAll('#results .result-correct').length,
                resultIncorrect: document.querySelectorAll('#results .result-incorrect').length,
                lastScrollY: window.__lastReadingScrollY
            };
        });
        assert.deepEqual(suiteActivationRace, {
            p2Activated: false,
            p3Activated: true,
            activeExamId: 'race-p3',
            suiteActivating: false,
            activationGeneration: 2,
            title: 'Race Part 3',
            checkedValue: 'B',
            disabled: true,
            explanationExamIds: ['race-p3'],
            committedExplanations: ['race-p3'],
            highlightNoteId: 'race-note-p3',
            resultCorrect: 0,
            resultIncorrect: 1,
            lastScrollY: 303
        });
    } finally {
        await page.close();
        await browser.close();
    }
}

async function main() {
    testAnswerDetailUnknownState();
    await testBrowserInteractions();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'reading duplicate highlights, grouped replay, unknown results and inline-suite locks covered'
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: 'fail', detail: error.stack || error.message }));
    process.exitCode = 1;
});
