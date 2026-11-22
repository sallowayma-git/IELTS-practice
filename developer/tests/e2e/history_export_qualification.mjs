import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { fixtures, grade, record } from '../fixtures/historyCountFixtures.mjs';

// Run against an unmodified checkout. Affected mode confirms known failures;
// it never turns them into product acceptance passes.
const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeRoot = path.resolve(process.env.HISTORY_RUNTIME_ROOT || harnessRoot);
const expectation = process.env.HISTORY_EXPECTATION || 'repaired';
assert.ok(['affected', 'repaired'].includes(expectation));
const repaired = expectation === 'repaired';
const channel = process.env.HISTORY_BROWSER_CHANNEL || 'chrome';
const mode = process.env.HISTORY_ACCESS_MODE || 'http';
assert.ok(['http', 'file'].includes(mode));
const output = path.resolve(process.env.HISTORY_EVIDENCE_DIR || path.join(harnessRoot,
    'developer/tests/e2e/reports/history-export-qualification', `${expectation}-${channel}-${mode}`));
fs.mkdirSync(output, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: runtimeRoot, encoding: 'utf8' }).trim();
const dirtyRuntime = execFileSync('git', ['diff', 'HEAD', '--name-only', '--',
    'index.html', 'js', 'css', 'assets', 'templates', 'scripts'], { cwd: runtimeRoot, encoding: 'utf8' }).trim();
assert.equal(dirtyRuntime, '', 'qualification requires an unmodified tracked runtime');
const manifestPath = path.join(runtimeRoot, 'assets/generated/diagnostics/build-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const source = fixtures();
delete source.incompleteSuite;
delete source.nestedIncompleteSuite;
source.sentinel = record('unrelated-sentinel', { q1: grade('keep', 'keep', true) }, 1, 1);
const inputs = Object.values(source);
const expectedCounts = repaired
    ? { 'all-wrong': '3', partial: '3', split: '3', suite: '6', summary: '3', ordinary: '2', unknown: '未知', duplicate: '1' }
    : { 'all-wrong': '1', partial: '1', split: '3', suite: '4', summary: '0', ordinary: '1', unknown: '0', duplicate: '1' };
const evidence = {
    schemaVersion: 1, issue: 314, capturedAt: new Date().toISOString(),
    commit, buildId: manifest.buildId, channel, mode, expectation,
    productAcceptance: repaired ? 'pending' : 'fail: known count/export defects remain',
    fixtureProvenance: 'Synthetic controlled records from #315/#317; not the original reporter record',
    fixtureSha256: sha256(JSON.stringify(inputs)), records: {},
    originalThreeToTen: 'unresolved: no original record or artifact identity was supplied',
};
fs.writeFileSync(path.join(output, 'synthetic-records.json'), JSON.stringify(inputs, null, 2) + '\n');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const filename = path.resolve(runtimeRoot, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!filename.startsWith(runtimeRoot + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }).end(body);
    }
    catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let phase = 'startup';
const externalRequests = new Set();
try {
    browser = await chromium.launch({ channel, headless: true });
    evidence.browserVersion = browser.version();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('request', request => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests.add(url.origin);
    });
    const ready = async () => {
        await page.waitForFunction(() => window.app?.isInitialized === true);
        await page.evaluate(async () => { await AppData.ready; await LicenseModal.accept(); });
    };
    await page.goto(mode === 'file' ? pathToFileURL(path.join(runtimeRoot, 'index.html')).href
        : `http://127.0.0.1:${server.address().port}/index.html`);
    await ready();
    evidence.loadedBuildId = await page.evaluate(() => window.AppDiagnosticBuild?.buildId);
    assert.equal(evidence.loadedBuildId, manifest.buildId, 'page must execute the identified build');
    const before = await page.evaluate(async inputs => {
        for (const record of inputs) await AppData.practice.completeAttempt({ record, operationId: `issue-314-${record.id}` });
        return Object.fromEntries(await Promise.all(inputs.map(async record =>
            [record.id, await AppData.practice.get(record.id, { projection: 'full' })])));
    }, inputs);
    const download = async action => {
        const [result] = await Promise.all([page.waitForEvent('download'), action()]);
        assert.equal(await result.failure(), null);
        return fs.readFileSync(await result.path(), 'utf8');
    };
    phase = 'cold overview export';
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('script[src*="browse.bundle.js"]'))), false);
    const coldMarkdown = await download(() => page.evaluate(() => AppActions.exportPracticeMarkdown()));
    fs.writeFileSync(path.join(output, 'cold-overview.md'), coldMarkdown);
    assert.ok(!coldMarkdown.includes('答题详情生成失败'));
    assert.equal(coldMarkdown.includes('| 7 | C | C, E | ✓ |'), repaired);
    assert.equal(coldMarkdown.includes('| 1 | A | N/A | Unknown |'), repaired);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('script[src*="browse.bundle.js"]'))), false);
    evidence.coldOverview = { browseUnloaded: true, groupedVerdictCorrect: repaired,
        unknownVerdictPreserved: repaired, downloadSha256: sha256(coldMarkdown) };
    await page.evaluate(async () => { await AppLazyLoader.ensureGroup('browse-runtime'); await AppLazyLoader.ensureGroup('practice-suite'); });
    const snapshot = async () => {
        await page.waitForFunction(() => {
            const modal = document.getElementById('practice-record-modal');
            return modal?.classList.contains('show') && getComputedStyle(modal).opacity === '1'
                && getComputedStyle(modal).visibility !== 'hidden' && modal.getBoundingClientRect().width > 0;
        });
        return page.evaluate(() => ({
        score: document.querySelector('.score-highlight')?.textContent,
        count: document.querySelector('.error-count')?.textContent,
        knownWrong: document.querySelector('.incorrect-count')?.textContent ?? null,
        knownBlank: document.querySelector('.unanswered-count')?.textContent ?? null,
        unknown: document.querySelector('.unknown-count')?.textContent ?? null,
        rows: Array.from(document.querySelectorAll('.answer-row')).map(row => ({
            question: row.querySelector('.question-num')?.textContent,
            correct: row.querySelector('.correct-answer')?.textContent,
            answer: row.querySelector('.user-answer')?.textContent,
            // Icon enhancement may replace the glyph with an SVG after render.
            // Compare the semantic class; partial-credit text carries the score.
            result: row.classList.contains('partial') ? row.querySelector('.result-icon')?.textContent
                : ['correct', 'incorrect', 'unanswered', 'unknown'].find(state => row.classList.contains(state)),
            className: row.className,
        })),
        }));
    };
    for (const input of inputs.filter(input => input.id !== 'unrelated-sentinel')) {
        const id = input.id;
        const item = evidence.records[id] = { projections: {}, savedGrade: {
            correct: before[id].correctAnswers ?? null, total: before[id].totalQuestions ?? null,
        } };
        for (const projection of ['detail', 'full']) {
            phase = `${id}/${projection}`;
            const unchanged = await page.evaluate(async ({ id, projection }) => {
                const record = await AppData.practice.get(id, { projection });
                const before = JSON.stringify(record);
                practiceRecordModal.show(record);
                new MarkdownExporter().generateRecordMarkdown(record);
                return before === JSON.stringify(record) && before === JSON.stringify(practiceRecordModal.currentRecord);
            }, { id, projection });
            assert.equal(unchanged, true, `${phase}: display mutated grading/replay input`);
            const view = await snapshot();
            assert.equal(view.count, expectedCounts[id], phase);
            if (id === 'split') {
                assert.equal(view.score, '4/7');
                for (const question of ['7', '8', '9', '10']) assert.ok(view.rows.some(row =>
                    row.question === question && row.className === 'answer-row correct'), `${phase}/q${question}`);
            }
            item.projections[projection] = view;
        }
        phase = `${id}/download`;
        const markdown = await download(() => page.evaluate(id => practiceRecordModal.exportSingle(id), id));
        fs.writeFileSync(path.join(output, `${id}.md`), markdown);
        item.exportRows = markdown.split('\n').filter(line => /^\| \d/.test(line));
        if (id === 'split') for (const question of ['7', '8', '9', '10']) {
            const row = item.exportRows.find(line => line.startsWith(`| ${question} |`));
            assert.ok(row?.endsWith(repaired ? '| ✓ |' : '| ✗ |'), row);
        }
        if (id === 'unknown') assert.ok(item.exportRows[0]?.endsWith(repaired ? '| Unknown |' : '| ✗ |'));
        if (id === 'partial') assert.ok(item.exportRows[0]?.endsWith(repaired ? '| Partial 1/4 |' : '| ✗ |'));
        item.downloadSha256 = sha256(markdown);
        await page.locator('#practice-record-modal .modal-close').click();
        await page.locator('#practice-record-modal').waitFor({ state: 'detached' });
        await page.evaluate(id => practiceRecordModal.showById(id), id);
        item.reopened = await snapshot();
        assert.deepEqual(item.reopened, item.projections.full);
        if (['split', 'partial', 'summary'].includes(id)) await page.screenshot({ path: path.join(output, `${id}.png`) });
    }
    phase = 'reload';
    await page.reload();
    await ready();
    await page.evaluate(async () => { await AppLazyLoader.ensureGroup('browse-runtime'); await AppLazyLoader.ensureGroup('practice-suite'); });
    for (const input of inputs) {
        const id = input.id;
        const after = await page.evaluate(id => AppData.practice.get(id, { projection: 'full' }), id);
        assert.deepEqual(after, before[id], `${id}: saved record changed`);
        if (id === 'unrelated-sentinel') continue;
        await page.evaluate(id => practiceRecordModal.showById(id), id);
        evidence.records[id].reloaded = await snapshot();
        assert.deepEqual(evidence.records[id].reloaded, evidence.records[id].projections.full);
        evidence.records[id].storedRecordUnchanged = true;
    }
    evidence.sync = await page.evaluate(async () => ({
        available: Boolean(AppData.folderSync),
        storedEnabled: AppData.folderSync ? (await AppData.folderSync.status()).enabled : false,
        serviceEnabled: window.FolderSyncService?.getStatus().enabled ?? false,
        bound: window.FolderSyncService?.getStatus().bound ?? false,
        completedSyncs: window.FolderSyncService?.getStatus().completedSyncs ?? 0,
    }));
    assert.equal(evidence.sync.storedEnabled, false);
    assert.equal(evidence.sync.serviceEnabled, false);
    assert.equal(evidence.sync.bound, false);
    assert.equal(evidence.sync.completedSyncs, 0);
    assert.deepEqual([...externalRequests], [], 'qualification must remain local');
    evidence.loadedBundles = await page.evaluate(() => Array.from(document.scripts)
        .map(script => script.getAttribute('src')).filter(src => src?.includes('/bundles/')));
    evidence.unrelatedRecordUnchanged = true;
    evidence.persistedRecords = inputs.length;
    evidence.externalRequests = [];
    evidence.status = repaired ? 'passed' : 'known failures reproduced';
    if (repaired) evidence.productAcceptance = 'pass for controlled fixtures on this artifact';
} catch (error) {
    evidence.status = 'harness failed';
    evidence.failure = { phase, message: error.message };
    process.exitCode = 1;
} finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ commit, buildId: evidence.buildId, channel, mode, status: evidence.status,
        browserVersion: evidence.browserVersion, failure: evidence.failure }));
}
