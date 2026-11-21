import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { fixtures, record } from '../fixtures/historyCountFixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

test('shipped history counts survive IndexedDB detail/full projections, export, reopen and reload', { timeout: 120000 }, async () => {
    const server = http.createServer((request, response) => {
        const filename = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
        if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
        try {
            const body = fs.readFileSync(filename);
            response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }).end(body);
        }
        catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    let phase = 'startup';
    const browserErrors = [];
    try {
        browser = await chromium.launch({ headless: true, ...(process.env.HISTORY_BROWSER_CHANNEL ? { channel: process.env.HISTORY_BROWSER_CHANNEL } : {}) });
        const page = await browser.newPage();
        page.on('console', message => {
            if (message.type() === 'error') browserErrors.push(message.text());
        });
        page.on('pageerror', error => browserErrors.push(error.stack || error.message));
        const ready = async () => {
            await page.waitForFunction(() => window.app?.isInitialized === true);
            await page.evaluate(async () => {
                await AppData.ready;
                await LicenseModal.accept();
                await AppLazyLoader.ensureGroup('browse-runtime');
                await AppLazyLoader.ensureGroup('practice-suite');
            });
        };
        const url = process.env.HISTORY_ACCESS_MODE === 'file'
            ? pathToFileURL(path.join(root, 'index.html')).href : `http://127.0.0.1:${server.address().port}/index.html`;
        await page.goto(url);
        await ready();
        const source = fixtures();
        source.noGrade = { id: 'no-grade', examId: 'no-grade', type: 'reading', totalQuestions: 10 };
        source.emptyUngraded = record('empty-ungraded', {});
        source.emptyZero = record('empty-zero', {}, 0, 0);
        source.emptyDenominator = record('empty-denominator', {}, undefined, 0);
        source.normalized = structuredClone(source.partial);
        source.normalized.id = source.normalized.examId = 'normalized';
        delete source.normalized.scoreInfo.details;
        const before = await page.evaluate(async inputs => {
            inputs.normalized.answerComparison = PracticeCore.contracts.normalizeAnswerComparison(inputs.normalized.answerComparison);
            for (const record of Object.values(inputs)) await AppData.practice.completeAttempt({ record, operationId: `history-count-${record.id}` });
            const records = {};
            for (const input of Object.values(inputs)) records[input.id] = await AppData.practice.get(input.id, { projection: 'full' });
            return records;
        }, source);
        const expected = { 'all-wrong': 3, partial: 3, split: 3, suite: 6, summary: 3, ordinary: 2, unknown: '未知', duplicate: 1,
            'no-grade': '未知', normalized: 3, 'empty-ungraded': '未知', 'empty-zero': 0, 'empty-denominator': 0 };
        const emptyScores = { 'empty-ungraded': '未知', 'empty-zero': '0/0', 'empty-denominator': '0/0' };
        for (const [id, missed] of Object.entries(expected)) {
            for (const projection of ['detail', 'full']) {
                phase = `${id}/${projection}`;
                const result = await page.evaluate(async ({ id, projection }) => {
                    const record = await AppData.practice.get(id, { projection });
                    const snapshot = JSON.stringify(record);
                    practiceRecordModal.show(record);
                    return {
                        count: document.querySelector('.error-count')?.textContent,
                        replayUnchanged: JSON.stringify(practiceRecordModal.currentRecord) === snapshot,
                        unchanged: JSON.stringify(record) === snapshot,
                        counts: AnswerComparisonUtils.resolveRecordCounts(record),
                        annotationsPresent: Boolean(record.highlights)
                    };
                }, { id, projection });
                assert.equal(result.count, String(missed), `${id}/${projection}`);
                if (id in emptyScores) assert.equal(await page.locator('.score-highlight').textContent(), emptyScores[id]);
                assert.equal(result.replayUnchanged, true);
                assert.equal(result.unchanged, true);
                if (id === 'partial' || id === 'normalized') {
                    assert.equal(result.counts.unanswered, 3);
                    assert.equal(result.annotationsPresent, projection === 'full');
                    assert.equal(await page.locator('.answer-row.partial').textContent().then(text => text.includes('1/4')), true);
                }
            }
            phase = `${id}/export`;
            const [download] = await Promise.all([
                page.waitForEvent('download'),
                page.evaluate(id => practiceRecordModal.exportSingle(id), id)
            ]);
            assert.equal(await download.failure(), null, `${id}: Markdown download failed`);
            assert.ok(fs.readFileSync(await download.path(), 'utf8').length > 0);
            await page.evaluate(id => practiceRecordModal.showById(id), id);
            assert.equal(await page.locator('.error-count').textContent(), String(missed));
            if (id in emptyScores) assert.equal(await page.locator('.score-highlight').textContent(), emptyScores[id]);
        }
        if (process.env.HISTORY_SCREENSHOT) {
            await page.evaluate(() => practiceRecordModal.showById('partial'));
            await page.screenshot({ path: process.env.HISTORY_SCREENSHOT });
        }
        await page.reload();
        await ready();
        for (const [id, missed] of Object.entries(expected)) {
            phase = `${id}/reload`;
            await page.evaluate(id => practiceRecordModal.showById(id), id);
            assert.equal(await page.locator('.error-count').textContent(), String(missed), `reload/${id}`);
            if (id in emptyScores) assert.equal(await page.locator('.score-highlight').textContent(), emptyScores[id]);
            const after = await page.evaluate(id => AppData.practice.get(id, { projection: 'full' }), id);
            assert.deepEqual(after, before[id], `stored grade, snapshot and annotations changed for ${id}`);
        }
        console.log(JSON.stringify({ browser: browser.version(), channel: process.env.HISTORY_BROWSER_CHANNEL || 'chromium',
            mode: process.env.HISTORY_ACCESS_MODE || 'http', records: Object.keys(expected).length, projections: ['detail', 'full'] }));
    } catch (error) {
        console.error(JSON.stringify({ phase, browserErrors: browserErrors.slice(-20) }));
        console.error(error);
        throw error;
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
