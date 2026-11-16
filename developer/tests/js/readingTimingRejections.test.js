import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

let browser;
const server = http.createServer((_, response) => response.end('<!doctype html><title>Timing rejection evidence</title>'));
before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function fixture() {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const file of ['data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
        'services/readingTiming.js', 'core/vocabScheduler.js', 'core/practiceReviewScheduler.js',
        'data/v2/appData.js', 'diagnostics/diagnosticContract.js']) {
        await page.addScriptTag({ content: fs.readFileSync(new URL(`../../../js/${file}`, import.meta.url), 'utf8') });
    }
    await page.evaluate(async () => {
        await AppData.ready;
        const meter = new ReadingTiming.Meter({ questionOrder: ['q1', 'q2'], questionGroups: [] }, {
            attemptId: 'PRIVATE_ATTEMPT', examId: 'timing-exam', libraryConfigurationId: null, writer: 'PRIVATE_WRITER'
        });
        meter.eligibility(true, 0); meter.select('q1', 0); meter.tick(1000); meter.freeze(1000);
        window.saved = meter.snapshot();
        window.record = { id: 'PRIVATE_RECORD', sessionId: 'PRIVATE_SESSION', examId: 'timing-exam', type: 'reading',
            totalQuestions: 2, correctAnswers: 1, answers: { q1: 'PRIVATE_ANSWER' }, noteText: 'PRIVATE_NOTE',
            highlights: [{ text: 'PRIVATE_HIGHLIGHT' }], metadata: { libraryConfigurationId: null }, readingTiming: saved };
        window.complete = readingTiming => AppData.practice.completeAttempt({ operationId: 'PRIVATE_OPERATION',
            record: { ...record, readingTiming } });
    });
    return { page, context };
}

const cases = [
    ['seal writer', 'TIMING_STALE_WRITER', 'writer-mismatch'],
    ['seal unfrozen advanced snapshot', 'TIMING_STALE_WRITER', 'not-frozen'],
    ['seal frozen snapshot mismatch', 'TIMING_STALE_WRITER', 'snapshot-mismatch'],
    ['seal finalized other record', 'TIMING_STALE_WRITER', 'finalized-row-conflict'],
    ['seal immutable record', 'TIMING_FINALIZED', 'finalized-row-conflict'],
    ['seal writer before freeze and checksum', 'TIMING_STALE_WRITER', 'writer-mismatch'],
    ['seal finalized before writer and freeze', 'TIMING_STALE_WRITER', 'finalized-row-conflict'],
    ['save missing row', 'TIMING_STALE_WRITER', 'missing-row'],
    ['save writer', 'TIMING_STALE_WRITER', 'writer-mismatch'],
    ['save stale revision', 'TIMING_STALE_REVISION', 'stale-revision'],
    ['save same revision conflict', 'VALIDATION', 'snapshot-mismatch'],
    ['acquire conflicting draft', 'VALIDATION', 'snapshot-mismatch'],
    ['save finalized', 'TIMING_FINALIZED', 'finalized-row-conflict'],
    ['acquire finalized', 'TIMING_FINALIZED', 'finalized-row-conflict']
];
for (const [scenario, code, reason] of cases) test(`structured timing rejection: ${scenario}`, async () => {
    const { page, context } = await fixture();
    try {
        const result = await page.evaluate(async scenario => {
            if (scenario !== 'save missing row') await AppData.recovery.acquireReadingTiming(saved);
            const submitted = structuredClone(saved);
            if (scenario.includes('finalized') || scenario === 'seal immutable record') {
                await AppData.practice.completeAttempt({ operationId: 'existing-operation', record });
                if (scenario !== 'seal immutable record') record.id = 'PRIVATE_OTHER_RECORD';
            }
            if (scenario.includes('writer')) submitted.writer = 'PRIVATE_OTHER_WRITER';
            if (scenario.includes('unfrozen') || scenario.includes('before freeze') || scenario.includes('and freeze')) {
                submitted.frozen = false; submitted.revision++;
            }
            if (scenario === 'seal frozen snapshot mismatch' || scenario === 'seal immutable record') submitted.revision++;
            if (scenario === 'save stale revision') submitted.revision--;
            if (scenario === 'save same revision conflict' || scenario === 'acquire conflicting draft') submitted.frozen = false;
            const before = JSON.stringify({ timing: await AppData.recovery.getReadingTiming(saved.attemptId), records: await AppData.practice.list() });
            try {
                if (scenario.startsWith('seal')) await complete(submitted);
                else if (scenario === 'acquire conflicting draft') await AppData.recovery.acquireReadingTiming({ ...saved, writer: 'PRIVATE_NEXT' }, submitted);
                else if (scenario.startsWith('acquire')) await AppData.recovery.acquireReadingTiming(submitted);
                else await AppData.recovery.saveReadingTiming(submitted);
                return { rejected: false };
            } catch (error) {
                // The message is deliberately destroyed: evidence must come from structured data.
                error.message = 'PRIVATE_ANSWER PRIVATE_NOTE file:///PRIVATE_PATH';
                error.answers = 'PRIVATE_ANSWER'; error.details.writer = 'PRIVATE_WRITER';
                const event = AppDiagnosticContract.createNormalizer().normalize({ code: 'PRACTICE_SAVE_FAILED', error,
                    persistence: { operation: AppData.getOperationFailureState(error) } });
                const after = JSON.stringify({ timing: await AppData.recovery.getReadingTiming(saved.attemptId), records: await AppData.practice.list() });
                return { rejected: true, code: error.code, reason: error.details.timingReason, event, unchanged: before === after };
            }
        }, scenario);
        assert.equal(result.rejected, true); assert.equal(result.code, code); assert.equal(result.reason, reason);
        assert.equal(result.event.timingReason, reason); assert.equal(result.event.causeCode, code);
        assert.equal(result.unchanged, true, 'rejection cannot mutate timing or completed records');
        if (scenario.startsWith('seal')) assert.equal(result.event.persistence.operation, 'not-committed');
        assert.doesNotMatch(JSON.stringify(result.event), /PRIVATE_/);
    } finally { await context.close(); }
});

test('historical timing without a live row remains importable and immutable after completion', async () => {
    const { page, context } = await fixture();
    try {
        const result = await page.evaluate(async () => {
            const historical = { ...saved, frozen: false };
            const receipt = await complete(historical);
            const stored = await AppData.practice.get(record.id);
            let reason;
            try { await complete({ ...historical, revision: historical.revision + 1 }); }
            catch (error) { reason = error.details.timingReason; }
            return { committed: receipt.committed, timing: stored.readingTiming, reason,
                row: await AppData.recovery.getReadingTiming(saved.attemptId), count: (await AppData.practice.list()).length };
        });
        assert.equal(result.committed, true); assert.equal(result.timing.frozen, false);
        assert.equal(result.row, null); assert.equal(result.count, 1); assert.equal(result.reason, 'finalized-row-conflict');
    } finally { await context.close(); }
});
