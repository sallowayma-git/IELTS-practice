import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const source = name => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const runtime = [
    'data/v2/dataCatalog.js', 'data/v2/dataKernel.js',
    'data/practiceRecordSource.js', 'data/v2/readingVocabularyModel.js'
].map(source);
const appData = source('data/v2/appData.js');
const readerRuntime = [
    'components/readingVocabAnchors.js', 'components/readingVocabContent.js',
    'components/readingVocabReader.js'
].map(source);
const collection = {
    source: { kind: 'builtin', id: 'default' },
    article: { examId: 'undo-receipt-race', title: 'Undo receipt race' },
    word: { word: 'coral', meaning: 'An existing definition', note: 'Keep this note' },
    occurrence: {
        scopeId: 'passage/p-1', contentVersion: 'fixture-v1',
        quote: 'coral', startOffset: 0, endOffset: 5, before: '', after: ' here.'
    },
    at: '2026-09-08T02:00:00.000Z'
};

async function initialize(page, url, withReader = false) {
    await page.goto(url);
    for (const content of runtime) await page.addScriptTag({ content });
    if (withReader) {
        await page.evaluate(() => {
            window.undoBoundary = {};
            const prototype = window.__AppDataV2Internals.DataKernel.prototype;
            const mutate = prototype.mutate;
            prototype.mutate = async function (changes, options) {
                const receipt = await mutate.call(this, changes, options);
                if (window.undoBoundary.enabled && options.intent?.command === 'reading-removeOccurrence') {
                    window.undoBoundary.receipt = receipt;
                    window.undoBoundary.paused = true;
                    // Only pause delivery of a real, committed IndexedDB receipt.
                    // The other page can now commit before AppData's readback.
                    await new Promise(resolve => { window.undoBoundary.release = resolve; });
                }
                return receipt;
            };
        });
    }
    await page.addScriptTag({ content: appData });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
    if (withReader) {
        for (const content of readerRuntime) await page.addScriptTag({ content });
        await page.evaluate(() => ReadingVocabStore.init());
    }
}

test('occurrence undo uses its committed removal fence across concurrent readback changes', { timeout: 60_000 }, async t => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Occurrence undo integration</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    t.after(async () => {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const url = `http://127.0.0.1:${server.address().port}/`;

    for (const intervening of ['clearReading', 'replace', 'unrelatedCollection']) {
        await t.test(intervening, async t => {
            const context = await browser.newContext();
            t.after(() => context.close());
            const reader = await context.newPage();
            const writer = await context.newPage();
            await initialize(reader, url, true);
            await initialize(writer, url);
            const seeded = await reader.evaluate(async command => {
                const receipt = await ReadingVocabStore.mutate('collect', command);
                ReadingVocabReader.currentExamId = command.article.examId;
                ReadingVocabReader.currentSource = command.source;
                ReadingVocabReader.currentExam = { title: command.article.title };
                return receipt;
            }, collection);
            await reader.evaluate(() => {
                const occurrence = ReadingVocabStore.getByExam(ReadingVocabReader.currentExamId)[0].occurrences[0];
                window.undoBoundary.enabled = true;
                window.pendingRemoval = ReadingVocabReader.removeOccurrence(occurrence.id);
            });
            await reader.waitForFunction(() => window.undoBoundary.paused);
            const ownRevision = await reader.evaluate(() => window.undoBoundary.receipt.revisions['vocab.readingState']);

            await writer.evaluate(async ({ intervening, collection }) => {
                if (intervening === 'clearReading') {
                    await AppData.vocab.mutateReading('clearReading', {});
                } else if (intervening === 'replace') {
                    const current = await AppData.backups.export({ domains: ['vocab'] });
                    const plan = await AppData.backups.previewImport(current, { replace: true });
                    await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
                } else {
                    await AppData.vocab.mutateReading('collect', {
                        ...collection, article: { examId: 'another-article', title: 'Another article' },
                        word: { word: 'water', meaning: 'Water' }, occurrence: {
                            ...collection.occurrence, quote: 'water'
                        }
                    });
                }
            }, { intervening, collection });
            const fence = await reader.evaluate(async () => {
                window.undoBoundary.release();
                await window.pendingRemoval;
                const durable = await AppData.vocab.getReadingSnapshot();
                return { observed: ReadingVocabReader._undoOccurrence?.observed,
                    currentRevision: durable.revision, currentGeneration: durable.generation };
            });
            assert.equal(fence.observed.revision, ownRevision, 'undo must retain its own committed revision, not the newer readback revision');
            assert.equal(fence.observed.generation, seeded.generation, 'undo must retain the generation in which removal began');
            assert.ok(fence.currentRevision > ownRevision, 'the second page must commit in the removal/readback gap');
            if (intervening === 'replace') assert.notEqual(fence.currentGeneration, seeded.generation);

            const after = await reader.evaluate(async () => {
                await ReadingVocabReader.undoOccurrence();
                const durable = await AppData.vocab.getReadingSnapshot();
                return { snapshot: durable.snapshot, pendingUndo: !!ReadingVocabReader._undoOccurrence,
                    message: document.querySelector('#vocab-toast').textContent };
            });
            const coral = after.snapshot.reading.occurrences.filter(row => row.quote === 'coral');
            if (intervening === 'unrelatedCollection') {
                assert.equal(coral.length, 1, 'an unrelated acknowledged write must not block a valid undo');
                assert.equal(after.snapshot.reading.occurrences.filter(row => row.quote === 'water').length, 1);
                assert.equal(after.pendingUndo, false);
            } else {
                assert.equal(coral.length, 0, 'undo must not resurrect an occurrence after a newer clear or replacement');
                assert.equal(after.snapshot.reading.associations.length, 0);
                assert.equal(after.pendingUndo, true, 'failed undo retains its explicit recoverable state');
                assert.match(after.message, /撤销失败/);
            }
            const originalOwner = seeded.snapshot.lists['reading-highlights'].words[0];
            const owner = after.snapshot.lists['reading-highlights'].words.find(row => row.id === originalOwner.id);
            assert.deepEqual(owner, originalOwner, 'removal and undo must preserve the canonical word');
        });
    }
});
