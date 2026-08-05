#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const origin = 'http://localhost/';
const scriptPaths = [
    'js/data/practiceRecordSource.js',
    'js/data/v2/dataCatalog.js',
    'js/data/v2/dataKernel.js',
    'js/data/v2/appData.js'
];

async function bootstrap(page) {
    await page.goto(origin);
    for (const relativePath of scriptPaths) {
        await page.addScriptTag({ path: path.join(repoRoot, relativePath) });
    }
    await page.waitForFunction(() => Boolean(window.AppData));
    await page.evaluate(async () => { await window.AppData.ready; });
}

function makeRecords(prefix, count, heavy = false) {
    return Array.from({ length: count }, (_, index) => {
        const noteCount = heavy ? 40 : 8;
        const highlightCount = heavy ? 80 : 16;
        const notes = Array.from({ length: noteCount }, (_, noteIndex) => ({
            id: `${prefix}-note-${index}-${noteIndex}`,
            body: `note ${index}/${noteIndex} ${'n'.repeat(64)}`,
            quote: `quote ${index}/${noteIndex}`
        }));
        const highlights = Array.from({ length: highlightCount }, (_, highlightIndex) => ({
            id: `${prefix}-highlight-${index}-${highlightIndex}`,
            noteId: notes[highlightIndex % notes.length].id,
            text: `highlight ${index}/${highlightIndex} ${'h'.repeat(48)}`,
            start: highlightIndex * 5,
            end: highlightIndex * 5 + 12
        }));
        const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString();
        return {
            id: `${prefix}-record-${index}`,
            sessionId: `${prefix}-session-${index}`,
            examId: `${prefix}-exam-${index}`,
            title: `${prefix} ${index}`,
            type: 'reading',
            date: timestamp,
            startTime: timestamp,
            endTime: timestamp,
            duration: 1800 + index,
            totalQuestions: 40,
            correctAnswers: 36,
            accuracy: 0.9,
            answers: { q1: 'A', q2: 'B' },
            correctAnswerMap: { q1: 'A', q2: 'C' },
            highlights,
            notes,
            noteOutlines: [{ id: `${prefix}-outline-${index}`, title: `Outline ${index}`, order: 0 }],
            metadata: { examTitle: `${prefix} ${index}`, category: 'P3', frequency: 'high', type: 'reading' }
        };
    });
}

function launchOptions() {
    const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
    return executablePath ? { headless: true, executablePath } : { headless: true };
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext();
await context.route(`${origin}**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>v2 stress</title>' });
});

try {
    const page = await context.newPage();
    await bootstrap(page);
    await page.evaluate(() => window.AppData.practice.clear({ operationId: 'browser-stress-clear' }));

    const records = makeRecords('browser', 48, true);
    const replaceStarted = performance.now();
    await page.evaluate(async (items) => {
        await Promise.all(items.map((record) => window.AppData.practice.completeAttempt({
            operationId: `browser-stress-${record.id}`,
            record
        })));
    }, records);
    const writeMs = performance.now() - replaceStarted;

    const listStarted = performance.now();
    const listed = await page.evaluate(() => window.AppData.practice.list({ projection: 'full' }));
    const listMs = performance.now() - listStarted;
    assert.strictEqual(listed.length, records.length, 'v2 IndexedDB write changed record count');
    assert(listed.every((record) => record && record.highlights.length === 80 && record.notes.length === 40), 'full v2 projection lost annotation data');

    const light = await page.evaluate(() => window.AppData.practice.list({ projection: 'light' }));
    assert.strictEqual(light.length, records.length, 'light projection changed record count');
    assert(light.every((record) => !Object.prototype.hasOwnProperty.call(record, 'highlights')), 'light projection leaked annotations');

    await page.evaluate(() => window.AppData.practice.delete({ recordId: 'browser-record-0', operationId: 'browser-stress-delete' }));
    const afterDelete = await page.evaluate(() => window.AppData.practice.list({ projection: 'full' }));
    assert.strictEqual(afterDelete.length, records.length - 1, 'deleted v2 record remained in full list');
    assert(afterDelete.every(Boolean), 'full v2 list returned a null row after deletion');

    await page.reload();
    await bootstrap(page);
    const reloaded = await page.evaluate(() => window.AppData.practice.list({ projection: 'full' }));
    assert.strictEqual(reloaded.length, afterDelete.length, 'reload changed v2 record count');
    assert.strictEqual(reloaded.find((record) => record.id === 'browser-record-1').highlights.length, 80, 'reload changed annotation contents');

    const secondPage = await context.newPage();
    await bootstrap(secondPage);
    const crossTabStarted = performance.now();
    await Promise.all([
        page.evaluate(async (items) => Promise.all(items.map((record) => window.AppData.practice.completeAttempt({
            operationId: `browser-tab-a-${record.id}`, record
        }))), makeRecords('tab-a', 12)),
        secondPage.evaluate(async (items) => Promise.all(items.map((record) => window.AppData.practice.completeAttempt({
            operationId: `browser-tab-b-${record.id}`, record
        }))), makeRecords('tab-b', 12))
    ]);
    const crossTabMs = performance.now() - crossTabStarted;
    const [firstTab, secondTab] = await Promise.all([
        page.evaluate(() => window.AppData.practice.list({ projection: 'light' })),
        secondPage.evaluate(() => window.AppData.practice.list({ projection: 'light' }))
    ]);
    await secondPage.close();
    assert.strictEqual(firstTab.length, afterDelete.length + 24, 'first v2 tab lost cross-tab records');
    assert.strictEqual(secondTab.length, afterDelete.length + 24, 'second v2 tab lost cross-tab records');

    const maxMs = 10000;
    assert(writeMs < maxMs, `v2 IndexedDB writes exceeded ${maxMs}ms`);
    assert(listMs < maxMs, `v2 full projection exceeded ${maxMs}ms`);
    assert(crossTabMs < maxMs, `v2 cross-tab writes exceeded ${maxMs}ms`);
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: {
            records: records.length,
            highlightsPerRecord: 80,
            notesPerRecord: 40,
            writeMs: Math.round(writeMs * 100) / 100,
            listMs: Math.round(listMs * 100) / 100,
            crossTabRecords: firstTab.length,
            crossTabMs: Math.round(crossTabMs * 100) / 100
        }
    }));
} finally {
    await context.close();
    await browser.close();
}
