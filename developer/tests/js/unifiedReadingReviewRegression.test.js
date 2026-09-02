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

async function testResponsiveAndDarkReviewPresentation(page) {
    await page.setContent(stripScripts(read('assets/generated/reading-exams/reading-practice-unified.html')));
    await page.evaluate(() => {
        const banner = document.getElementById('review-banner');
        banner.hidden = false;
        document.getElementById('review-assignment-title').textContent = 'A deliberately long historical reading assignment title';
        document.getElementById('review-passages').textContent = 'Passage One · Passage Two · Passage Three';
        document.getElementById('review-submitted-at').textContent = '2026/8/15 10:20:30';
        document.getElementById('review-score').textContent = '31 / 40';
        document.getElementById('review-accuracy').textContent = '78%';
        document.getElementById('review-completion').textContent = '36 / 40';
        document.getElementById('review-elapsed').textContent = '1:02:03';
        const candidateId = document.getElementById('candidate-id');
        candidateId.hidden = false;
        candidateId.textContent = '482731';
        document.getElementById('review-part-scores').innerHTML = [1, 2, 3].map((part) => `
            <div class="review-part-score" style="--review-progress:${part * 25}%">
                <span class="review-part-label">Part ${part}</span>
                <span class="review-part-score-value">${10 + part} / 13</span>
                <span class="review-part-result"><span>${70 + part}%</span><span>20:00</span></span>
            </div>
        `).join('');
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
                optionsDisplay: display('#settings-btn'),
                metricsColumns: getComputedStyle(document.querySelector('.review-metrics')).gridTemplateColumns,
                partColumns: getComputedStyle(document.getElementById('review-part-scores')).gridTemplateColumns
            };
        });
        assert.ok(layout.scrollWidth <= layout.clientWidth, `review layout must not overflow at ${width}px: ${JSON.stringify(layout)}`);
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
        if (width <= 480) {
            assert.equal(layout.metricsColumns.trim().split(/\s+/).length, 2, `phone metrics should reflow to two columns at ${width}px`);
            assert.equal(layout.partColumns.trim().split(/\s+/).length, 1, `phone part cards should stack at ${width}px`);
        }
    }

    await page.setViewportSize({ width: 1024, height: 900 });
    const contrast = await page.evaluate(() => {
        document.body.classList.add('dark-mode');
        const parseRgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (rgb) => {
            const channels = rgb.map((channel) => {
                const value = channel / 255;
                return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const ratio = (foreground, background) => {
            const lighter = Math.max(luminance(parseRgb(foreground)), luminance(parseRgb(background)));
            const darker = Math.min(luminance(parseRgb(foreground)), luminance(parseRgb(background)));
            return (lighter + 0.05) / (darker + 0.05);
        };
        const measure = (selector, backgroundSelector) => {
            const node = document.querySelector(selector);
            const background = document.querySelector(backgroundSelector);
            return ratio(getComputedStyle(node).color, getComputedStyle(background).backgroundColor);
        };
        return {
            title: measure('.review-assignment-title', '.review-banner'),
            metadata: measure('.review-scope', '.review-banner'),
            metric: measure('.review-metric dd', '.review-banner'),
            card: measure('.review-part-score-value', '.review-part-score')
        };
    });
    Object.entries(contrast).forEach(([label, ratio]) => {
        assert.ok(ratio >= 4.5, `${label} dark-mode contrast must be at least 4.5:1, received ${ratio}`);
    });
}

async function testReviewRuntimeBehaviors(page) {
    await page.evaluate(() => {
        document.body.classList.remove('dark-mode');
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
            notes: [{ id: 'note-1', title: 'Original title', body: '', quote: '', updatedAt: 1 }],
            noteOutlines: []
        });
        hooks.ensureReadingNotesUi();
        hooks.openNoteEditor('note-1');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const title = document.querySelector('#reading-note-editor [data-note-title]');
        const initiallyFocused = document.activeElement === title;
        title.value = 'Renamed note';
        title.dispatchEvent(new Event('input', { bubbles: true }));
        return {
            hasTitle: Boolean(title),
            initiallyFocused,
            savedTitle: hooks.getTestState().notes[0]?.title || ''
        };
    });
    assert.deepEqual(note, { hasTitle: true, initiallyFocused: true, savedTitle: 'Renamed note' });

    const completion = await page.evaluate(() => {
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
        hooks.renderResults(results, {
            submittedAtMs: Date.parse('2026-08-15T10:20:30.000Z'),
            durationSeconds: 60
        });
        return document.getElementById('review-completion').textContent;
    });
    assert.equal(completion, '1 / 3');

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
            submittedAt: document.getElementById('review-submitted-at').getAttribute('datetime'),
            elapsed: document.getElementById('review-elapsed').textContent,
            part: document.querySelector('#review-part-scores .review-part-label')?.textContent || '',
            title: document.getElementById('review-assignment-title').textContent
        };
    });
    assert.deepEqual(replay, {
        submittedAt: '2026-08-15T10:20:30.000Z',
        elapsed: '2:05',
        part: 'Part 2',
        title: 'Historical Part Two'
    });

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
        const renderedScore = document.getElementById('review-score').textContent;

        const projectedLegacyEntry = app._buildReviewReplayEntriesFromRecord({
            examId: 'projected-legacy-score',
            correctAnswers: 0,
            totalQuestions: 10,
            accuracy: 0.67,
            percentage: 67,
            duration: 0,
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
        const renderedSuiteTimestamp = document.getElementById('review-submitted-at').getAttribute('datetime');
        const renderedSuiteDuration = document.getElementById('review-elapsed').textContent;

        hooks.setTestState({
            examId: 'malformed-timestamp',
            dataKey: 'reading-p3',
            dataset: {
                meta: { title: 'Malformed timestamp recovery', category: 'P3' },
                questionGroups: [],
                questionOrder: ['q1'],
                answerKey: { q1: 'C' }
            },
            readOnly: false,
            submitted: false,
            reviewMode: false,
            reviewEntryIndex: 0
        });
        await hooks.applyReplayRecord({
            reviewEntryIndex: 0,
            readOnly: false,
            entry: {
                examId: 'malformed-timestamp',
                answers: { q1: 'C' },
                correctAnswerMap: { q1: 'C' },
                scoreInfo: { correct: 1, total: 1, totalQuestions: 1 },
                timestamp: 1e20,
                date: '2026-08-15T10:30:00.000Z',
                duration: 30
            }
        });
        const outOfRangeRecoveredTimestamp = document.getElementById('review-submitted-at').getAttribute('datetime');

        await hooks.applyReplayRecord({
            reviewEntryIndex: 0,
            readOnly: false,
            entry: {
                examId: 'malformed-timestamp',
                answers: { q1: 'C' },
                correctAnswerMap: { q1: 'C' },
                scoreInfo: { correct: 1, total: 1, totalQuestions: 1, timeSpent: 1200 },
                duration: 0,
                timestamp: '-1',
                date: '2026-08-15T10:35:00.000Z'
            }
        });

        return {
            hostScore: `${scoreEntry.scoreInfo.correct} / ${scoreEntry.scoreInfo.total}`,
            runtimeScore: `${scoreResults.scoreInfo.correct} / ${scoreResults.scoreInfo.total}`,
            renderedScore,
            projectedLegacyScore: `${projectedLegacyEntry.scoreInfo.correct} / ${projectedLegacyEntry.scoreInfo.total}`,
            projectedLegacyAccuracy: projectedLegacyEntry.scoreInfo.accuracy,
            projectedLegacyPercentage: projectedLegacyEntry.scoreInfo.percentage,
            projectedLegacyDuration: projectedLegacyEntry.duration,
            p1Timestamp: suiteEntries[0].endTime,
            p1Duration: suiteEntries[0].duration,
            p2Timestamp: p2Entry.endTime,
            p2Duration: p2Entry.duration,
            renderedSuiteTimestamp,
            renderedSuiteDuration,
            outOfRangeRecoveredTimestamp,
            signedRecoveredTimestamp: document.getElementById('review-submitted-at').getAttribute('datetime'),
            zeroProjectedDuration: document.getElementById('review-elapsed').textContent
        };
    });
    assert.deepEqual(hostReplay, {
        hostScore: '2 / 3',
        runtimeScore: '2 / 3',
        renderedScore: '2 / 3',
        projectedLegacyScore: '8 / 10',
        projectedLegacyAccuracy: 0.67,
        projectedLegacyPercentage: 67,
        projectedLegacyDuration: 1200,
        p1Timestamp: '2026-08-15T10:00:00.000Z',
        p1Duration: 600,
        p2Timestamp: '2026-08-15T10:20:00.000Z',
        p2Duration: 1200,
        renderedSuiteTimestamp: '2026-08-15T10:20:00.000Z',
        renderedSuiteDuration: '20:00',
        outOfRangeRecoveredTimestamp: '2026-08-15T10:30:00.000Z',
        signedRecoveredTimestamp: '2026-08-15T10:35:00.000Z',
        zeroProjectedDuration: '20:00'
    });
}

async function main() {
    const executablePath = resolveBrowserExecutable();
    const browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    try {
        await testResponsiveAndDarkReviewPresentation(page);
        await testReviewRuntimeBehaviors(page);
    } finally {
        await page.close();
        await browser.close();
    }
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'review completion, replay identity/timing, modal focus, note naming, dark mode, and narrow layouts covered'
    }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'fail', detail: error.stack || error.message }));
    process.exit(1);
});
