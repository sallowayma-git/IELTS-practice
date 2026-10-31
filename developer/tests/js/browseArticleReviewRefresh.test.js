import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const contentTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml'
};

test('completing a reading attempt refreshes the visible Browse replay after a delayed queue read', {
    timeout: 90000
}, async (t) => {
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
        try {
            const body = fs.readFileSync(filename);
            response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream' });
            response.end(body);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?test_env=1`);
    await page.waitForFunction(() => window.app?.isInitialized === true, null, { timeout: 60000 });
    await page.evaluate(async () => {
        await window.AppData.ready;
        await window.LicenseModal.accept();
    });
    const closeLibrary = page.locator('[data-library-action="close"]');
    if (await closeLibrary.isVisible()) await closeLibrary.click();
    await page.locator('nav button[data-view="browse"]').click();
    await page.waitForSelector('#browse-view.active .exam-item');
    await page.evaluate(async () => {
        await filterByType('reading');
        await ensurePracticeRecordsSync('review-refresh-initial');
    });
    await page.waitForFunction(() => !window.__isBrowseUserResultsRequestInFlight(
        window.__getBrowseResultsRequestId()
    ));

    const examId = await page.locator('#browse-view .exam-item').first().getAttribute('data-exam-id');
    const card = page.locator(`#browse-view .exam-item[data-exam-id="${examId}"]`);
    assert.equal(await card.count(), 1, 'the reading card must already be displayed before completion');
    assert.equal(await card.locator('[data-action="browse-review"]').count(), 0);

    const { taskId, queueReads } = await page.evaluate(async examId => {
        const practice = window.AppData.practice;
        const loadReviewQueue = window.loadPracticeReviewQueue;
        let queueReads = 0;
        window.loadPracticeReviewQueue = async function () {
            queueReads += 1;
            // Delay the read and publication through the real, frozen AppData
            // facade, leaving time for an incorrectly ordered Browse repaint.
            await new Promise(resolve => setTimeout(resolve, 250));
            return loadReviewQueue();
        };
        try {
            await practice.completeAttempt({
                operationId: 'browse-review-refresh',
                record: {
                    id: 'browse-review-refresh', sessionId: 'browse-review-refresh',
                    examId, type: 'reading', title: 'Browse review refresh',
                    completedAt: new Date().toISOString(),
                    correctAnswers: 7, totalQuestions: 10,
                    answers: { q1: 'A' }
                }
            });
            await ensurePracticeRecordsSync('review-refresh-completion', {
                forceRender: true
            });
            return { taskId: window.getPracticeReviewTaskForExam({ id: examId })?.id, queueReads };
        } finally {
            window.loadPracticeReviewQueue = loadReviewQueue;
        }
    }, examId);

    assert.ok(taskId, 'the committed attempt must have an article review task');
    assert.equal(queueReads, 1, 'the completion sync must exercise one delayed review queue read');
    // No navigation, filter change, or explicit Browse render may be needed.
    await card.locator('[data-action="browse-review"]').waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await card.locator('[data-action="browse-review"]').getAttribute('data-review-task-id'), taskId);
});
