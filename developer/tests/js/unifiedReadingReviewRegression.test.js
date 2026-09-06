#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

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

function stripScripts(html) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

async function testResponsiveHeaderPresentation(page) {
    await page.setContent(stripScripts(read('assets/generated/reading-exams/reading-practice-unified.html')));
    await page.evaluate(() => {
        const candidateId = document.getElementById('candidate-id');
        candidateId.hidden = false;
        candidateId.textContent = '482731';
    });

    for (const width of [320, 360, 361, 375, 400, 401, 480, 481, 520, 768, 960]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => {
            const timer = document.getElementById('timer').getBoundingClientRect();
            const controls = document.querySelector('.header-right').getBoundingClientRect();
            const candidate = document.getElementById('candidate-id');
            const candidateRect = candidate.getBoundingClientRect();
            const candidateContainer = candidate.parentElement.getBoundingClientRect();
            const display = (selector) => getComputedStyle(document.querySelector(selector)).display;
            return {
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                timerRight: timer.right,
                timerDisplay: display('#timer'),
                timerWidth: timer.width,
                controlsLeft: controls.left,
                candidateDisplay: getComputedStyle(candidate).display,
                candidateWidth: candidateRect.width,
                candidateWithinContainer: candidateRect.left >= candidateContainer.left - 0.5
                    && candidateRect.right <= candidateContainer.right + 0.5,
                connectionDisplay: display('#connection-indicator'),
                messagesDisplay: display('#messages-indicator'),
                brandDisplay: display('.ielts-brand'),
                notesDisplay: display('#notes-drawer-btn'),
                optionsDisplay: display('#settings-btn')
            };
        });
        assert.ok(layout.scrollWidth <= layout.clientWidth, `header layout must not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.timerRight <= layout.controlsLeft + 0.5, `header controls must not cover the timer at ${width}px`);
        assert.notEqual(layout.timerDisplay, 'none', `timer must remain visible at ${width}px`);
        assert.ok(layout.timerWidth > 0, `timer must retain visible width at ${width}px`);
        assert.notEqual(layout.notesDisplay, 'none', `Notes must remain visible at ${width}px`);
        assert.notEqual(layout.optionsDisplay, 'none', `Options must remain visible at ${width}px`);
        assert.equal(layout.connectionDisplay === 'none', width <= 480, `connection indicator breakpoint mismatch at ${width}px`);
        assert.equal(layout.messagesDisplay === 'none', width <= 400, `messages indicator breakpoint mismatch at ${width}px`);
        assert.equal(layout.brandDisplay === 'none', width <= 360, `IELTS wordmark breakpoint mismatch at ${width}px`);
        if (width <= 520) {
            assert.notEqual(layout.candidateDisplay, 'none', `candidate code must remain displayed at ${width}px`);
            assert.ok(layout.candidateWidth > 0, `candidate code must retain visible width at ${width}px`);
            assert.ok(layout.candidateWithinContainer, `candidate code must not be clipped at ${width}px`);
        }
    }
}

async function testReviewRuntimeBehaviors(page) {
    await page.evaluate(() => {
        window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    });
    await page.addScriptTag({ content: read('js/utils/answerSanitizer.js') });
    await page.addScriptTag({ content: read('js/utils/answerMatchCore.js') });
    await page.addScriptTag({ content: read('js/runtime/unifiedReadingPage.js') });
    await page.addScriptTag({ content: read('js/app/examSessionMixin.js') });

    const modal = await page.evaluate(() => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        hooks.captureDom();
        hooks.attachUnifiedPanels();
        document.getElementById('settings-btn').click();
        return {
            open: document.getElementById('settings-panel').classList.contains('is-open'),
            headerInert: document.querySelector('.header').inert,
            focusedId: document.activeElement.id
        };
    });
    assert.deepEqual(modal, { open: true, headerInert: true, focusedId: 'options-title' });

    await page.keyboard.press('Shift+Tab');
    const reverseTab = await page.evaluate(() => {
        const panel = document.getElementById('settings-panel');
        const focusable = Array.from(panel.querySelectorAll('button:not([disabled]),[tabindex]:not([tabindex="-1"])'))
            .filter((node) => node.getClientRects().length > 0);
        return {
            activeIsLast: document.activeElement === focusable[focusable.length - 1],
            activeInside: panel.contains(document.activeElement)
        };
    });
    assert.deepEqual(reverseTab, { activeIsLast: true, activeInside: true }, 'Shift+Tab from the modal title must wrap to the last control');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'options-close-btn', 'Tab from the final modal control must wrap to the first control');
    await page.keyboard.press('Escape');
    const closedModal = await page.evaluate(() => ({
        hidden: document.getElementById('settings-panel').hidden,
        headerInert: document.querySelector('.header').inert,
        focusedId: document.activeElement.id
    }));
    assert.deepEqual(closedModal, { hidden: true, headerInert: false, focusedId: 'settings-btn' });

    const draftAction = await page.evaluate(() => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        document.getElementById('question-groups').innerHTML = `
            <label><input id="draft-radio" type="radio" name="q1" value="A" checked> A</label>
            <div id="draft-drop" class="paragraph-dropzone" data-answer-value="B" data-answer-label="B">
                <div class="dropped-items"><span>B</span></div>
            </div>
        `;
        hooks.setTestState({
            submissionStatus: 'draft',
            readOnly: false,
            readOnlyReason: '',
            submitted: false,
            reviewMode: false,
            memorizeMode: false,
            timerLocked: false,
            suiteSessionId: null,
            notes: [{ id: 'draft-note', title: 'Draft note', body: 'Keep until cleared', quote: '', updatedAt: 1 }],
            noteOutlines: [{ id: 'draft-outline', title: 'Draft outline', order: 0 }]
        });
        hooks.attachActionListeners();
        hooks.syncPrimaryActionButtons();
        return {
            clearHidden: document.getElementById('options-clear-answers').hidden,
            clearDisabled: document.getElementById('options-clear-answers').disabled,
            footerDisplay: document.getElementById('reset-btn').style.display
        };
    });
    assert.deepEqual(draftAction, { clearHidden: false, clearDisabled: false, footerDisplay: 'none' });

    await page.locator('#settings-btn').click();
    await page.locator('#options-clear-answers').click();
    const clearedDraft = await page.evaluate(() => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const dropzone = document.getElementById('draft-drop');
        const testState = hooks.getTestState();
        return {
            radioChecked: document.getElementById('draft-radio').checked,
            dropValue: dropzone.dataset.answerValue,
            droppedChildren: dropzone.querySelector('.dropped-items').childElementCount,
            notes: testState.notes.length,
            outlines: testState.noteOutlines.length
        };
    });
    assert.deepEqual(clearedDraft, {
        radioChecked: false,
        dropValue: '',
        droppedChildren: 0,
        notes: 0,
        outlines: 0
    }, 'the visible Options action must clear answers and structured notes through handleReset');
    await page.keyboard.press('Escape');

    const actionVisibility = await page.evaluate(() => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const base = {
            submissionStatus: 'draft',
            readOnly: false,
            readOnlyReason: '',
            submitted: false,
            reviewMode: false,
            memorizeMode: false,
            timerLocked: false,
            suiteSessionId: null
        };
        const scenarios = {
            draft: {},
            submitting: { submissionStatus: 'submitting' },
            readOnly: { readOnly: true },
            submitted: { submitted: true, readOnly: true, submissionStatus: 'submitted' },
            memorize: { memorizeMode: true },
            review: { reviewMode: true, readOnly: true }
        };
        return Object.fromEntries(Object.entries(scenarios).map(([name, patch]) => {
            hooks.setTestState({ ...base, ...patch });
            hooks.syncPrimaryActionButtons();
            return [name, {
                clearHidden: document.getElementById('options-clear-answers').hidden,
                footerDisplay: document.getElementById('reset-btn').style.display
            }];
        }));
    });
    assert.deepEqual(actionVisibility, {
        draft: { clearHidden: false, footerDisplay: 'none' },
        submitting: { clearHidden: true, footerDisplay: 'none' },
        readOnly: { clearHidden: true, footerDisplay: 'none' },
        submitted: { clearHidden: true, footerDisplay: 'none' },
        memorize: { clearHidden: true, footerDisplay: '' },
        review: { clearHidden: true, footerDisplay: '' }
    });
    await page.evaluate(() => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        hooks.setTestState({
            submissionStatus: 'draft',
            readOnly: false,
            submitted: false,
            reviewMode: false,
            memorizeMode: false,
            timerLocked: false
        });
        hooks.syncPrimaryActionButtons();
        document.getElementById('question-groups').innerHTML = '';
    });

    const note = await page.evaluate(async () => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        hooks.setTestState({
            readOnly: false,
            submitted: false,
            reviewMode: false,
            memorizeMode: false,
            notes: [{ id: 'note-1', title: 'Original title', body: '', quote: 'A quoted passage from the article for verification', updatedAt: 1 }],
            noteOutlines: []
        });
        hooks.ensureReadingNotesUi();
        hooks.openNoteEditor('note-1');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const titleInput = document.querySelector('#reading-note-editor [data-note-title]');
        const body = document.querySelector('#reading-note-editor [data-note-body]');
        const focusedBody = document.activeElement === body;
        body.value = 'Edited note body';
        body.dispatchEvent(new Event('input', { bubbles: true }));
        return {
            hasTitleInput: Boolean(titleInput),
            focusedBody,
            savedTitle: hooks.getTestState().notes[0]?.title || '',
            savedBody: hooks.getTestState().notes[0]?.body || ''
        };
    });
    assert.deepEqual(note, { hasTitleInput: false, focusedBody: true, savedTitle: 'Original title', savedBody: 'Edited note body' });

    const noteNaming = await page.evaluate(async () => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const q = (count) => 'q'.repeat(count);
        hooks.setTestState({
            readOnly: false,
            submitted: false,
            reviewMode: false,
            memorizeMode: false,
            notes: [
                { id: 'note-long', title: '', body: '', quote: q(40), updatedAt: 1 },
                { id: 'note-exact36', title: '', body: '', quote: q(36), updatedAt: 2 },
                { id: 'note-at37', title: '', body: '', quote: q(37), updatedAt: 3 },
                { id: 'note-empty', title: '', body: '', quote: '', updatedAt: 4 },
                { id: 'note-custom', title: 'Custom kept title', body: '', quote: q(10), updatedAt: 5 }
            ],
            noteOutlines: []
        });
        hooks.ensureReadingNotesUi();
        hooks.openNoteEditor('note-long');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        // The drawer only repaints when dirty; editing the open note's body
        // marks it so the next ensureReadingNotesUi() renders the rows.
        const body = document.querySelector('#reading-note-editor [data-note-body]');
        body.value = 'Body edit to mark the drawer dirty';
        body.dispatchEvent(new Event('input', { bubbles: true }));
        hooks.ensureReadingNotesUi();
        const row = (id) => document.querySelector(`#reading-note-drawer [data-note-open="${id}"]`);
        const legacyText = String(document.querySelector('#notes-panel textarea')?.value || '');
        const blocks = legacyText.split('\n\n');
        return {
            longTitle: row('note-long')?.textContent || '',
            longTooltip: row('note-long')?.getAttribute('title') || '',
            exact36Title: row('note-exact36')?.textContent || '',
            at37Title: row('note-at37')?.textContent || '',
            emptyQuoteTitle: row('note-empty')?.textContent || '',
            customTitleTitle: row('note-custom')?.textContent || '',
            exportHeadings: blocks.map((block) => block.split('\n')[0]),
            longQuoteLine: blocks[0]?.split('\n')[1] || ''
        };
    });
    assert.deepEqual(noteNaming, {
        longTitle: `${'q'.repeat(36)}...`,
        longTooltip: `${'q'.repeat(36)}...`,
        exact36Title: 'q'.repeat(36),
        at37Title: `${'q'.repeat(36)}...`,
        emptyQuoteTitle: 'Untitled note',
        customTitleTitle: 'Custom kept title',
        exportHeadings: [
            `# ${'q'.repeat(36)}...`,
            `# ${'q'.repeat(36)}`,
            `# ${'q'.repeat(36)}...`,
            '# Untitled note',
            '# Custom kept title'
        ],
        longQuoteLine: `> ${'q'.repeat(40)}`
    }, 'quote-derived note titles must apply the 36-char truncation, ellipsis, and Untitled-note fallback in both the drawer and the legacy export');

    const grading = await page.evaluate(() => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const dataset = {
            meta: { title: 'Partial multi-select' },
            questionGroups: [{ groupId: 'split', kind: 'multi_choice', questionIds: ['q11', 'q12', 'q13'] }],
            questionOrder: ['q11', 'q12', 'q13'],
            answerKey: { q11: 'C', q12: 'D', q13: 'E' }
        };
        hooks.setTestState({ dataset, reviewMode: false, reviewEntryIndex: 0 });
        const results = hooks.buildResultsFromAnswers(dataset, {
            q11: ['C'], q12: ['C'], q13: ['C']
        });
        hooks.renderResults(results);
        return {
            summary: document.querySelector('#results p')?.textContent || '',
            rows: document.querySelectorAll('#results .results-table tbody tr').length
        };
    });
    assert.equal(grading.rows, 3, 'renderResults must build one comparison row per question');
    assert.ok(grading.summary.includes('1 / 3'), `results summary must report the score, received: ${grading.summary}`);

    const replay = await page.evaluate(async () => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const dataset = {
            meta: { title: 'Fallback title' },
            questionGroups: [],
            questionOrder: ['q1'],
            answerKey: { q1: 'A' }
        };
        hooks.setTestOverride('renderExplanations', () => Promise.resolve());
        hooks.setTestState({
            examId: 'historical-part-two',
            dataset,
            readOnly: false,
            submitted: false,
            reviewMode: false,
            reviewEntryIndex: 0
        });
        await hooks.applyReplayRecord({
            reviewEntryIndex: 1,
            readOnly: false,
            entry: {
                examId: 'historical-part-two',
                title: 'Historical Part Two',
                answers: { q1: 'A' },
                correctAnswerMap: { q1: 'A' },
                allQuestionIds: ['q1'],
                scoreInfo: { correct: 1, total: 1, totalQuestions: 1, percentage: 100 },
                timestamp: '2026-08-15T10:20:30.000Z',
                duration: 125
            }
        });
        return {
            resultsVisible: document.getElementById('results').style.display !== 'none',
            rows: document.querySelectorAll('#results .results-table tbody tr').length
        };
    });
    assert.deepEqual(replay, { resultsVisible: true, rows: 1 }, 'replay must render the comparison table without the removed review banner');

    const hostReplay = await page.evaluate(async () => {
        const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const app = Object.assign({}, window.ExamSystemAppMixins.examSession);
        const scoreDataset = {
            meta: { title: 'Canonical root score', category: 'P1' },
            questionGroups: [],
            questionOrder: ['q1', 'q2', 'q3'],
            answerKey: { q1: 'A' }
        };
        const scoreEntry = app._buildReviewReplayEntriesFromRecord({
            examId: 'canonical-root-score',
            title: 'Canonical root score',
            answers: { q1: 'A', q2: 'B', q3: 'C' },
            correctAnswerMap: { q1: 'A' },
            correctAnswers: 2,
            totalQuestions: 3,
            accuracy: 2 / 3,
            percentage: 67
        })[0];
        hooks.setTestState({
            examId: 'canonical-root-score',
            dataKey: 'reading-p1',
            dataset: scoreDataset,
            readOnly: false,
            submitted: false,
            reviewMode: false,
            reviewEntryIndex: 0
        });
        const scoreResults = hooks.buildReplayResults(scoreEntry);
        await hooks.applyReplayRecord({ reviewEntryIndex: 0, readOnly: false, entry: scoreEntry });

        const projectedLegacyEntry = app._buildReviewReplayEntriesFromRecord({
            examId: 'projected-legacy-score',
            correctAnswers: 0,
            totalQuestions: 10,
            accuracy: 0.67,
            percentage: 67,
            score: 8,
            duration: 1200,
            scoreInfo: { score: 8, total: 10, accuracy: 67, timeSpent: 1200 }
        })[0];

        const suiteEntries = app._buildReviewReplayEntriesFromRecord({
            endTime: '2026-08-15T10:40:00.000Z',
            duration: 3600,
            correctAnswers: 2,
            totalQuestions: 2,
            suiteEntries: [
                {
                    examId: 'reading-p1',
                    date: '2026-08-15T10:00:00.000Z',
                    durationSeconds: 600,
                    answers: { q1: 'A' },
                    correctAnswerMap: { q1: 'A' },
                    correctAnswers: 1,
                    totalQuestions: 1
                },
                {
                    examId: 'reading-p2',
                    title: 'Legacy suite P2',
                    date: '2026-08-15T10:20:00.000Z',
                    answers: { q1: 'B' },
                    correctAnswerMap: { q1: 'B' },
                    scoreInfo: { correct: 1, total: 1, timeSpent: 1200 }
                }
            ]
        });
        const p2Entry = suiteEntries[1];
        const p2Dataset = {
            meta: { title: 'Legacy suite P2', category: 'P2' },
            questionGroups: [],
            questionOrder: ['q1'],
            answerKey: { q1: 'B' }
        };
        hooks.setTestState({
            examId: 'reading-p2',
            dataKey: 'reading-p2',
            dataset: p2Dataset,
            readOnly: false,
            submitted: false,
            reviewMode: false,
            reviewEntryIndex: 1
        });
        await hooks.applyReplayRecord({ reviewEntryIndex: 1, readOnly: false, entry: p2Entry });

        return {
            hostScore: `${scoreEntry.scoreInfo.correct} / ${scoreEntry.scoreInfo.total}`,
            runtimeScore: `${scoreResults.scoreInfo.correct} / ${scoreResults.scoreInfo.total}`,
            projectedLegacyScore: `${projectedLegacyEntry.scoreInfo.correct} / ${projectedLegacyEntry.scoreInfo.total}`,
            projectedLegacyAccuracy: projectedLegacyEntry.scoreInfo.accuracy,
            projectedLegacyPercentage: projectedLegacyEntry.scoreInfo.percentage,
            projectedLegacyDuration: projectedLegacyEntry.duration,
            p1Timestamp: suiteEntries[0].endTime,
            p1Duration: suiteEntries[0].duration,
            p2Timestamp: p2Entry.endTime,
            p2Duration: p2Entry.duration,
            replayRows: document.querySelectorAll('#results .results-table tbody tr').length
        };
    });
    assert.deepEqual(hostReplay, {
        hostScore: '2 / 3',
        runtimeScore: '2 / 3',
        projectedLegacyScore: '8 / 10',
        projectedLegacyAccuracy: 0.67,
        projectedLegacyPercentage: 67,
        projectedLegacyDuration: 1200,
        p1Timestamp: '2026-08-15T10:00:00.000Z',
        p1Duration: 600,
        p2Timestamp: '2026-08-15T10:20:00.000Z',
        p2Duration: 1200,
        replayRows: 1
    });
}

async function main() {
    const executablePath = resolveBrowserExecutable();
    const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    try {
        await testResponsiveHeaderPresentation(page);
        await testReviewRuntimeBehaviors(page);
    } finally {
        await page.close();
        await browser.close();
    }
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'results-table grading, replay smoke, host-side replay entry projection, modal focus, quote-based note naming (36-char truncation, ellipsis, Untitled-note fallback, drawer and export) with preserved titles and body focus, and narrow header layouts covered'
    }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'fail', detail: error.stack || error.message }));
    process.exit(1);
});
