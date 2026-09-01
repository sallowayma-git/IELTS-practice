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

    for (const width of [320, 375, 480, 520, 768, 960]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => {
            const timer = document.getElementById('timer').getBoundingClientRect();
            const controls = document.querySelector('.header-right').getBoundingClientRect();
            const candidate = document.getElementById('candidate-id');
            const candidateRect = candidate.getBoundingClientRect();
            const candidateContainer = candidate.parentElement.getBoundingClientRect();
            return {
                clientWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                timerRight: timer.right,
                controlsLeft: controls.left,
                candidateDisplay: getComputedStyle(candidate).display,
                candidateWidth: candidateRect.width,
                candidateWithinContainer: candidateRect.left >= candidateContainer.left - 0.5
                    && candidateRect.right <= candidateContainer.right + 0.5,
                metricsColumns: getComputedStyle(document.querySelector('.review-metrics')).gridTemplateColumns,
                partColumns: getComputedStyle(document.getElementById('review-part-scores')).gridTemplateColumns
            };
        });
        assert.ok(layout.scrollWidth <= layout.clientWidth, `review layout must not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.timerRight <= layout.controlsLeft + 0.5, `header controls must not cover the timer at ${width}px`);
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
