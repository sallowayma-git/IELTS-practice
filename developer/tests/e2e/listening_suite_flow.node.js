#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reportDir = path.join(root, 'developer/tests/e2e/reports');
fs.mkdirSync(reportDir, { recursive: true });
const exams = [1, 2, 3, 4].map((part) => ({
    id: `listening-p${part}-suite-fixture`, title: `Listening Part ${part} fixture`,
    type: 'listening', category: `P${part}`, frequency: 'high', hasHtml: true,
    path: `ListeningPractice/P${part}/`, filename: 'suite-fixture.html'
}));

function fixture(part, options = {}) {
    const q = (part - 1) * 10 + 1;
    const tokenControl = options.answerControl === 'token' && part === 4;
    const accepted = options.literalAnswer ? [options.literalAnswer]
        : options.alternatives || [tokenControl ? 'A' : `answer${part}`];
    const answerControl = tokenControl
        ? `<div class="drop-zone" data-q="${q}" style="min-height:40px"></div>`
        : `<input ${options.answerControl === 'id' && part === 4 ? 'id' : 'name'}="q${q}" autocomplete="off">`;
    const readAnswer = tokenControl
        ? `const token=document.querySelector('.drop-zone .tag, .drop-zone .token');return token?.dataset.value || token?.textContent || '';`
        : `return document.querySelector('input').value;`;
    const clearAnswer = tokenControl
        ? `document.querySelector('.drop-zone').replaceChildren();`
        : `document.querySelector('input').value='';`;
    const config = !options.scoring ? `config:{questionList:[${q}],answerKey:{text:{q${q}:'answer${part}'}}},` : '';
    const finishControl = options.finishControl || '<button id="finish-btn">Finish</button>';
    const resultTable = options.scoring === 'table' || options.retainedTable ? `
        const report=document.createElement('div');report.hidden=true;report.id='fixture-results';document.body.appendChild(report);
        const generate=App.generateResultsTable.bind(App);
        const updateResults=()=>{report.innerHTML=generate();};
        ${options.scoring === 'table' ? "document.querySelector('input, .drop-zone').addEventListener('input',updateResults);" : ''}
        updateResults();
        const finish=App.finish.bind(App);App.finish=()=>{updateResults();finish();};
        ${options.scoring === 'table' ? 'delete App.generateResultsTable;' : ''}` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>Listening Part ${part}</title>
    <style>*{box-sizing:border-box}body{margin:0;font-family:system-ui}.header,.bottom-bar{display:flex;gap:16px;padding:16px}.shell{padding:24px}input{padding:10px}.q-nav-container{display:flex}</style></head><body>
    <header class="header"><h1>Listening Part ${part}</h1><span id="timer">00:00</span><div class="header-controls"></div></header>
    <main class="shell"><h2>Part ${part}</h2><p>Complete the notes.</p><label>Question ${q} ${answerControl}</label><textarea id="notes" aria-label="Notes"></textarea>
    <audio controls src="/__fixture.wav" preload="metadata"></audio><div class="match-slot" data-q="${q + 1}"></div></main>
    <footer class="bottom-bar"><div id="q-nav-container"><button class="q-nav-item" data-qnum="${q}">${q}</button></div><div class="bb-center"><button id="clear-btn">Reset</button><span id="fixture-completion-control">${finishControl}</span></div></footer>
    <script>function fixtureAnswer(){${readAnswer}}window.App={${config}state:{isReviewing:false},finishCalls:0,finish(){this.finishCalls++;this.state.isReviewing=true;document.querySelectorAll('input').forEach(input=>input.disabled=true);},generateResultsTable(){const answer=fixtureAnswer();return '<table class="results-table"><thead><tr><th>Question</th><th>Your answer</th><th>Correct answer</th><th>Result</th></tr></thead><tbody><tr><td>${q}</td><td>'+answer+'</td><td>${accepted.join(' / ')}</td><td>'+(${JSON.stringify(accepted)}.includes(answer)?'Correct':'Incorrect')+'</td></tr></tbody></table>';}};document.querySelector('#fixture-completion-control > *').addEventListener('click',()=>App.finish());document.getElementById('clear-btn').addEventListener('click',()=>{${clearAnswer}});${resultTable}</script></body></html>`;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__fixture.wav') {
        const wav = Buffer.alloc(44 + 80000);
        wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
        wav.write('data', 36); wav.writeUInt32LE(80000, 40);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Accept-Ranges', 'bytes');
        const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
        if (range) {
            const start = Number(range[1]);
            const end = Math.min(wav.length - 1, range[2] ? Number(range[2]) : wav.length - 1);
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`);
            res.setHeader('Content-Length', end - start + 1);
            res.end(wav.subarray(start, end + 1));
        } else { res.setHeader('Content-Length', wav.length); res.end(wav); }
        return;
    }
    const match = url.pathname.match(/^\/ListeningPractice\/P([1-4])\/suite-fixture.html$/);
    if (match) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture(Number(match[1]))); return; }
    const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
        const data = fs.readFileSync(target);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
        res.setHeader('Content-Type', (types[path.extname(target)] || 'application/octet-stream') + '; charset=utf-8');
        res.end(data);
    } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];

async function setup(fixtureOptions = null) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (fixtureOptions) await context.route('**/ListeningPractice/P*/suite-fixture.html*', async (route) => {
        const part = Number(new URL(route.request().url()).pathname.match(/\/P([1-4])\//)[1]);
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(part, fixtureOptions) });
    });
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(String(error))));
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60000 });
    await page.evaluate(async (items) => {
        await window.AppData.ready;
        await window.AppEntry.ensureSessionSuiteReady();
        window.resolveActiveLibraryIndex = async () => items;
        window.updateOverview(items);
        await window.PracticeTimerPreferences.save('listening', {
            mode: 'countdown', countdownMinutes: 40, limitEnabled: false, limitMinutes: 40, expiryAction: 'warn'
        });
    }, exams);
    return { context, page };
}

async function start(page, mode, fromOverview = false) {
    const popup = page.waitForEvent('popup');
    if (fromOverview) {
        await page.locator('#category-overview [data-action="start-suite-mode"][data-exam-type="listening"]').evaluate((button) => button.click());
        await page.locator('#suite-mode-selector-modal').waitFor();
        assert.match(await page.locator('#suite-mode-selector-modal h3').innerText(), /听力/);
        assert.match(await page.locator('#suite-frequency-scope option[value="custom"]').innerText(), /P4/);
        await page.locator('#suite-frequency-scope').selectOption('all');
        await page.locator(`[data-suite-flow-mode="${mode}"]`).click();
    } else {
        assert.equal(await page.evaluate((flowMode) => window.app.startSuitePractice({ type: 'listening', flowMode, frequencyScope: 'all' }), mode), true);
    }
    const suite = await popup;
    await suite.waitForSelector('.listening-suite-toolbar');
    await suite.waitForFunction(() => window.__listeningBridgeGetState?.().initialized === true);
    return suite;
}

function activeFrame(suite) { return suite.frameLocator('iframe:not([hidden])'); }
async function waitForSuiteReady(suite) {
    await suite.waitForSelector('.listening-suite-toolbar');
    await suite.waitForFunction(() => Array.from(document.querySelectorAll('iframe')).every((frame) =>
        frame.contentWindow.__listeningBridgeGetState?.().initialized
    ) && document.querySelector('iframe:not([hidden])')?.contentDocument.querySelector('#timer[data-timer-mode="countdown"]'));
}
async function reloadSuite(suite) {
    await suite.reload();
    await waitForSuiteReady(suite);
}
async function setDraftDeliveryPaused(page, paused) {
    await page.evaluate((hold) => {
        window.__originalSuiteDraftSync ||= window.app._handleSuiteDraftSync;
        window.app._handleSuiteDraftSync = hold ? () => false : window.__originalSuiteDraftSync;
    }, paused);
}
async function assertImmediateReloadRecovery(page, suite) {
    await waitForSuiteReady(suite);
    await activeFrame(suite).locator('input').fill('old saved answer');
    await page.waitForFunction(() => {
        const session = window.app.currentSuiteSession;
        return session.draftsByExam[session.activeExamId]?.answers.q1 === 'old saved answer';
    });
    // Hold asynchronous delivery to keep the host stale, then really reload without a pre-flush.
    await setDraftDeliveryPaused(page, true);
    await Promise.all([
        suite.waitForNavigation(),
        suite.evaluate(() => {
            const frame = document.querySelector('iframe:not([hidden])');
            const doc = frame.contentDocument;
            const input = doc.querySelector('input');
            input.value = 'new unsaved answer';
            input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
            doc.querySelector('#timer').click();
            doc.querySelector('#notes').value = 'Latest notes';
            window.location.reload();
        })
    ]);
    await waitForSuiteReady(suite);
    assert.equal(await activeFrame(suite).locator('input').inputValue(), 'new unsaved answer', 'immediate reload keeps the latest answer');
    assert.equal(await activeFrame(suite).locator('#notes').inputValue(), 'Latest notes', 'pagehide captures edits without an input event');
    assert.equal(await activeFrame(suite).locator('#timer').evaluate((timer) => timer.classList.contains('paused')), true,
        'immediate reload keeps the latest pause');
    const paused = await activeFrame(suite).locator('#timer').innerText();
    await suite.waitForTimeout(1400);
    assert.equal(await activeFrame(suite).locator('#timer').innerText(), paused);
    await setDraftDeliveryPaused(page, false);
    await page.waitForFunction(() => {
        const session = window.app.currentSuiteSession;
        return session.suiteTimerRunning === false
            && session.draftsByExam[session.activeExamId]?.answers.q1 === 'new unsaved answer';
    });
    await setDraftDeliveryPaused(page, true);
    await Promise.all([
        suite.waitForNavigation(),
        suite.evaluate(() => {
            document.querySelector('iframe:not([hidden])').contentDocument.querySelector('#timer').click();
            window.location.reload();
        })
    ]);
    await waitForSuiteReady(suite);
    assert.equal(await activeFrame(suite).locator('#timer').evaluate((timer) => timer.classList.contains('paused')), false,
        'immediate reload keeps the latest resume even while the host is stale');
    await setDraftDeliveryPaused(page, false);
    await page.waitForFunction(() => window.app.currentSuiteSession.suiteTimerRunning === true);
    await assertRunningCountdown(page, suite);
    assert.equal(await activeFrame(suite).locator('input').inputValue(), 'new unsaved answer');
}
async function assertRunningCountdown(page, suite) {
    assert.equal(await page.evaluate(() => window.app.currentSuiteSession.suiteTimerRunning), true,
        'the host must retain the running timer state');
    const timer = activeFrame(suite).locator('#timer[data-timer-mode="countdown"]');
    await timer.waitFor();
    assert.equal(await timer.evaluate((el) => el.classList.contains('paused')), false,
        'the restored timer must remain running');
    const before = await timer.innerText();
    await suite.waitForFunction((previous) => {
        const text = document.querySelector('iframe:not([hidden])')?.contentDocument.querySelector('#timer')?.textContent;
        const seconds = (value) => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
        return text && seconds(text) < seconds(previous);
    }, before, { timeout: 5000 });
}
async function records(page) { return page.evaluate(() => window.AppData.practice.list({ projection: 'detail' })); }
async function assertPreviousPartMessagesIgnored(page, suite) {
    await suite.evaluate((previousExamId) => {
        window.__lateSuiteReceiptObserved = false;
        window.__lateSuiteReceiptCloseCalls = 0;
        const close = window.close;
        window.close = function (...args) {
            window.__lateSuiteReceiptCloseCalls++;
            return close.apply(this, args);
        };
        window.addEventListener('message', ({ data }) => {
            if (data.type === 'PRACTICE_SUBMIT_ACK' && data.data?.examId === previousExamId) {
                window.__lateSuiteReceiptObserved = true;
            }
        });
    }, exams[2].id);
    assert.equal(await page.evaluate((previousExamId) => {
        const completion = window.__listeningSuiteCompletions[previousExamId];
        return Boolean(completion) && window.app._announcePracticeSubmitOutcome(
            previousExamId, completion, window.app.currentSuiteSession.windowRef, true
        );
    }, exams[2].id), true, 'deliver the actual P3 receipt after P4 is ready');
    await suite.waitForFunction(() => window.__lateSuiteReceiptObserved);
    assert.equal(await suite.evaluate(() => window.__lateSuiteReceiptCloseCalls), 0,
        'a delayed P3 receipt must not close unsubmitted P4');
    assert.equal(await activeFrame(suite).locator('input').isEnabled(), true);
    assert.equal((await records(page)).length, 0, 'the suite is still unfinished before submitting P4');

    // During navigation the old document can receive the next part's INIT and retry
    // its pending completion with the new session/token but the old answers/examId.
    const retry = await page.evaluate((previousExamId) => {
        const session = window.app.currentSuiteSession;
        const info = window.app.examWindows.get(session.activeExamId);
        return {
            data: { ...window.__listeningSuiteCompletions[previousExamId],
                sessionId: info.expectedSessionId, windowSessionToken: info.windowSessionToken },
            activeExamId: session.activeExamId,
            rejectedBefore: window.app._examMessageRejectionCounts?.get('suite-completion-binding-mismatch:PRACTICE_COMPLETE') || 0
        };
    }, exams[2].id);
    await suite.evaluate((data) => window.opener.postMessage({
        type: 'PRACTICE_COMPLETE', source: 'listening_record_bridge', data
    }, window.location.origin), retry.data);
    await page.waitForFunction(({ activeExamId, rejectedBefore }) =>
        (window.app._examMessageRejectionCounts?.get('suite-completion-binding-mismatch:PRACTICE_COMPLETE') || 0) > rejectedBefore
        || window.app.currentSuiteSession?.results.some(entry => entry.examId === activeExamId), retry);
    assert.equal(await page.evaluate((examId) => window.app.currentSuiteSession.results.some(entry => entry.examId === examId),
        retry.activeExamId), false, 'a rebound P3 retry must not submit P4');
    assert.equal((await records(page)).length, 0, 'a rebound retry must not finalize the suite');
}
async function waitForRecord(page) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const saved = await records(page);
        if (saved.length === 1) return saved;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The suite did not persist one aggregate record.');
}

try {
    {
        const { context, page } = await setup();
        let suite = await start(page, 'simulation', true);
        await suite.waitForFunction(() => Array.from(document.querySelectorAll('iframe')).length === 4
            && Array.from(document.querySelectorAll('iframe')).every((f) => f.contentWindow.__listeningBridgeGetState?.().initialized));
        assert.match(await activeFrame(suite).locator('#timer').innerText(), /^39:|^40:/);
        await reloadSuite(suite);
        await assertRunningCountdown(page, suite);
        await assertImmediateReloadRecovery(page, suite);
        await activeFrame(suite).locator('input').fill('answer1');
        await activeFrame(suite).locator('#notes').fill('Remember this part');
        await activeFrame(suite).locator('audio').evaluate(async (audio) => {
            if (audio.readyState < 1) await new Promise((resolve) => audio.addEventListener('loadedmetadata', resolve, { once: true }));
            audio.currentTime = 1;
            await audio.play();
        });
        await suite.locator('[data-suite-part="2"]').click();
        assert.equal(await suite.locator('iframe[hidden]').first().evaluate((frame) => frame.contentDocument.querySelector('audio').paused), true);
        await activeFrame(suite).locator('input').fill('answer2');
        await suite.locator('[data-suite-part="1"]').click();
        assert.equal(await activeFrame(suite).locator('input').inputValue(), 'answer1');
        assert.equal(await activeFrame(suite).locator('#notes').inputValue(), 'Remember this part');
        await activeFrame(suite).locator('#timer').click();
        const paused = await activeFrame(suite).locator('#timer').innerText();
        await suite.locator('[data-suite-part="3"]').click();
        assert.equal(await activeFrame(suite).locator('#timer').innerText(), paused);
        await activeFrame(suite).locator('input').fill('wrong');
        await suite.waitForTimeout(1400);
        await reloadSuite(suite);
        assert.equal(await suite.locator('[aria-current="step"]').innerText(), 'Part 3', 'reload resumes the active part');
        assert.equal(await page.evaluate(() => window.app.currentSuiteSession.suiteTimerRunning), false,
            'reload must preserve an explicit user pause');
        assert.equal(await activeFrame(suite).locator('#timer').evaluate((el) => el.classList.contains('paused')), true);
        await suite.waitForTimeout(1400);
        assert.equal(await activeFrame(suite).locator('#timer').innerText(), paused, 'a paused timer must stay frozen after reload');
        await suite.locator('[data-suite-part="1"]').click();
        assert.equal(await activeFrame(suite).locator('input').inputValue(), 'answer1', 'reload restores P1');
        assert.ok(await activeFrame(suite).locator('audio').evaluate((audio) => audio.currentTime) >= 1, 'reload restores audio position');
        await suite.locator('[data-suite-part="2"]').click();
        assert.equal(await activeFrame(suite).locator('input').inputValue(), 'answer2', 'reload restores P2');
        await suite.locator('[data-suite-part="4"]').click();
        await activeFrame(suite).locator('input').fill('answer4');
        await suite.screenshot({ path: path.join(reportDir, 'listening-suite-simulation.png') });
        await suite.setViewportSize({ width: 390, height: 844 });
        await suite.screenshot({ path: path.join(reportDir, 'listening-suite-mobile.png') });
        assert.equal(await activeFrame(suite).locator('#finish-btn').evaluate((button) => {
            const rect = button.getBoundingClientRect();
            return rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
        }), true, 'mobile submit remains visible');
        await page.evaluate(() => {
            const save = window.app._saveSuitePracticeRecord;
            window.listeningSuiteSaveAttempts = [];
            window.app._saveSuitePracticeRecord = async function (record) {
                window.listeningSuiteSaveAttempts.push(JSON.stringify(record));
                if (window.listeningSuiteSaveAttempts.length === 1) throw new Error('Injected transient suite persistence failure');
                return save.call(this, record);
            };
        });
        // LAN HTTP deployments do not expose crypto.randomUUID.
        await suite.evaluate(() => Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true }));
        await suite.locator('[data-suite-submit]').click();
        const saved = await waitForRecord(page);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].type, 'listening');
        assert.equal(saved[0].suiteEntries.length, 4);
        assert.equal(saved[0].correctAnswers, 3);
        assert.equal(saved[0].totalQuestions, 4);
        const attempts = await page.evaluate(() => window.listeningSuiteSaveAttempts);
        assert.ok(attempts.length >= 2);
        assert.equal(attempts[0], attempts[1], 'retry saves the same frozen aggregate');
        results.push({ mode: 'simulation', recordCount: saved.length, correct: saved[0].correctAnswers, parts: saved[0].suiteEntries.length });
        await context.close();
    }
    for (const mode of ['classic', 'stationary']) {
        const { context, page } = await setup();
        if (mode === 'stationary') {
            await page.evaluate(() => {
                const post = window.app._postExamMessage;
                window.app._postExamMessage = function (examId, target, type, payload) {
                    // Replaying submitted inputs must be safe before the navigation context arrives.
                    if (examId === 'listening-p1-suite-fixture' && type === 'REVIEW_CONTEXT' && payload.readOnly) {
                        setTimeout(() => post.call(this, examId, target, type, payload), 100);
                        return;
                    }
                    return post.call(this, examId, target, type, payload);
                };
            });
        }
        if (mode === 'classic') {
            await page.evaluate(() => {
                window.__listeningSuiteCompletions = {};
                window.addEventListener('message', ({ data }) => {
                    if (data.type === 'PRACTICE_COMPLETE' && data.data?.examId) {
                        window.__listeningSuiteCompletions[data.data.examId] = data.data;
                    }
                });
            });
        }
        const suite = await start(page, mode);
        await reloadSuite(suite);
        await assertRunningCountdown(page, suite);
        await assertImmediateReloadRecovery(page, suite);
        for (let part = 1; part <= 4; part++) {
            await suite.waitForFunction((expected) => window.__listeningBridgeGetState?.().initialized
                && window.__listeningBridgeGetState().examId === expected, exams[part - 1].id).catch(async (error) => {
                const host = await page.evaluate(() => {
                    const session = window.app.currentSuiteSession;
                    return { activeExamId: session?.activeExamId, currentIndex: session?.currentIndex,
                        results: session?.results?.map((entry) => entry.examId) };
                });
                const bridge = await suite.evaluate(() => window.__listeningBridgeGetState?.());
                error.message += '\n' + JSON.stringify({ mode, part, host, bridge });
                throw error;
            });
            if (mode === 'classic' && part === 4) await assertPreviousPartMessagesIgnored(page, suite);
            if (mode === 'stationary' && part === 2) {
                await activeFrame(suite).locator('input').fill('Unsubmitted P2 draft');
                await suite.locator('[data-suite-navigate="prev"]:enabled').click();
                await suite.waitForFunction((expected) => window.__listeningBridgeGetState?.().examId === expected, exams[0].id);
                await activeFrame(suite).locator('#listening-suite-review').waitFor();
                assert.equal(await activeFrame(suite).locator('input').inputValue(), 'answer1', 'review restores submitted P1');
                assert.equal(await activeFrame(suite).locator('input').isDisabled(), true, 'review is read-only');
                assert.match(await activeFrame(suite).locator('#listening-suite-review').innerText(), /answer1/);
                const submittedDraft = await page.evaluate(() => JSON.stringify(window.app.currentSuiteSession.draftsByExam['listening-p1-suite-fixture']));
                await activeFrame(suite).locator('#timer').click();
                await suite.locator('[data-suite-navigate="next"]:enabled').click();
                await suite.waitForFunction((expected) => window.__listeningBridgeGetState?.().initialized
                    && window.__listeningBridgeGetState().examId === expected, exams[1].id);
                await waitForSuiteReady(suite);
                assert.equal(await activeFrame(suite).locator('input').inputValue(), 'Unsubmitted P2 draft');
                assert.equal(await activeFrame(suite).locator('#timer').evaluate((timer) => timer.classList.contains('paused')), true,
                    'cached P2 drafts must not overwrite a newer pause from submitted P1');
                const paused = await activeFrame(suite).locator('#timer').innerText();
                await suite.waitForTimeout(1400);
                assert.equal(await activeFrame(suite).locator('#timer').innerText(), paused, 'the timer stays paused after review navigation');
                await suite.locator('[data-suite-navigate="prev"]:enabled').click();
                await activeFrame(suite).locator('#listening-suite-review').waitFor();
                await activeFrame(suite).locator('#timer').click();
                await reloadSuite(suite);
                await activeFrame(suite).locator('#listening-suite-review').waitFor();
                assert.equal(await activeFrame(suite).locator('#timer').evaluate((timer) => timer.classList.contains('paused')), false,
                    'a timer-only resume on submitted P1 survives immediate reload');
                await suite.locator('[data-suite-navigate="next"]:enabled').click();
                await suite.waitForFunction((expected) => window.__listeningBridgeGetState?.().initialized
                    && window.__listeningBridgeGetState().examId === expected, exams[1].id);
                assert.equal(await activeFrame(suite).locator('input').inputValue(), 'Unsubmitted P2 draft', 'returning from review restores the current draft');
                await assertRunningCountdown(page, suite);
                assert.equal(await page.evaluate(() => JSON.stringify(window.app.currentSuiteSession.draftsByExam['listening-p1-suite-fixture'])), submittedDraft,
                    'timer-only review changes do not rewrite the submitted answer draft');
            }
            await activeFrame(suite).locator('input').fill('answer' + part);
            if (mode === 'stationary' && part === 2) {
                await suite.evaluate(() => {
                    window.__suiteReplayObserved = false;
                    window.addEventListener('message', ({ data }) => {
                        if (data.type === 'REPLAY_PRACTICE_RECORD') window.__suiteReplayObserved = true;
                    });
                });
                await page.evaluate(() => window.app._sendSuiteReviewState(
                    window.app.currentSuiteSession, 'listening-p2-suite-fixture'
                ));
                await suite.waitForFunction(() => window.__suiteReplayObserved);
                assert.equal(await activeFrame(suite).locator('input').inputValue(), 'answer2', 'late replay cannot overwrite a newer answer');
            }
            await activeFrame(suite).locator('#finish-btn').click();
            if (mode === 'stationary') {
                await suite.locator('[data-suite-navigate="next"]:enabled').waitFor();
                assert.equal((await records(page)).length, 0, 'stationary keeps review before finishing');
                await suite.locator('[data-suite-navigate="next"]').click();
            }
        }
        const saved = await waitForRecord(page);
        assert.equal(saved[0].type, 'listening');
        assert.equal(saved[0].suiteEntries.length, 4);
        for (let part = 1; part <= 4; part++) {
            assert.equal(saved[0].suiteEntries[part - 1].answers[`q${(part - 1) * 10 + 1}`], `answer${part}`,
                'each part must retain its own submitted answers');
        }
        assert.equal(saved[0].correctAnswers, 4);
        if (mode === 'classic' && !suite.isClosed()) {
            await suite.waitForEvent('close', { timeout: 5000 });
        }
        results.push({ mode, recordCount: saved.length, correct: saved[0].correctAnswers, parts: saved[0].suiteEntries.length });
        await context.close();
    }
    for (const options of [
        { scoring: 'generated' },
        { scoring: 'generated', retainedTable: true },
        { scoring: 'table' },
        { scoring: 'table', reset: true },
        { scoring: 'table', answerControl: 'id' },
        { scoring: 'table', answerControl: 'token' },
        ...[
            ['0.5', '1/2', 'half'],
            ['10/11/2026', '10/11/26', 'November 10 2026']
        ].flatMap((alternatives) => [false, true].map((matchCore) => ({
            scoring: 'table', alternatives, matchCore,
            invalidAnswers: [alternatives.slice(0, 2).join(' / '), alternatives.slice(0, 2).reverse().join(' / ')]
        }))),
        ...[
            ['colour', 'color'],
            ['7.30', '7:30'],
            ['November 10', '10 November'],
            ['Room 101', '101'],
            ['Room 2', '2'],
            ['10 November 2026', '10/11/2026']
        ].flatMap((alternatives) => [false, true].map((matchCore) => ({ scoring: 'table', alternatives, matchCore }))),
        ...['1 / 2', '10 / 11 / 2026'].flatMap((literalAnswer) => [false, true].flatMap((matchCore) => [
            { scoring: 'table', literalAnswer, matchCore },
            { scoring: 'table', literalAnswer, matchCore, partialAnswer: true }
        ])),
        ...[
            ['1 / 2', 'half'],
            ['10 / 11 / 2026', 'November 10 2026']
        ].flatMap((pair) => [pair, pair.slice().reverse()].flatMap((alternatives) => [false, true].flatMap((matchCore) =>
            [false, true].map((partialAnswer) => ({ scoring: 'table', alternatives, matchCore, partialAnswer }))))),
        { finishControl: '<button id="finishBtn"><span>Done</span></button>' },
        { finishControl: '<button data-action="check"><span>Done</span></button>' },
        { finishControl: '<span role="button" tabindex="0" aria-label="Grade answers"><span>Done</span></span>' }
    ]) {
        const literalAnswer = options.literalAnswer || options.alternatives?.find((answer) => answer.includes(' / '));
        const components = literalAnswer ? literalAnswer.split(' / ') : [];
        const answers = options.invalidAnswers ? [...options.alternatives.slice(0, 2), ...options.invalidAnswers]
            : options.partialAnswer ? components
            : options.alternatives || (options.literalAnswer ? [options.literalAnswer] : []);
        const answerForPart = (part) => answers.length ? answers[(part - 1) % answers.length]
            : options.answerControl === 'token' && part === 4 ? 'A' : 'answer' + part;
        const expectedPartScore = (part) => options.partialAnswer || options.invalidAnswers?.includes(answerForPart(part)) ? 0 : 1;
        const { context, page } = await setup(options);
        const suite = await start(page, 'simulation');
        await waitForSuiteReady(suite);
        if ((options.alternatives || options.literalAnswer) && !options.matchCore) {
            await suite.evaluate(() => document.querySelectorAll('iframe').forEach((frame) => {
                delete frame.contentWindow.AnswerMatchCore;
            }));
        }
        for (let part = 1; part <= 4; part++) {
            await suite.locator(`[data-suite-part="${part}"]`).click();
            if (options.answerControl === 'token' && part === 4) {
                await activeFrame(suite).locator('.drop-zone').evaluate((slot) => {
                    const token = document.createElement('span');
                    token.className = 'token';
                    token.dataset.value = 'A';
                    token.textContent = 'Option A';
                    slot.appendChild(token);
                    slot.dispatchEvent(new Event('input', { bubbles: true }));
                });
            } else await activeFrame(suite).locator('input').fill(answerForPart(part));
        }
        const snapshots = await suite.evaluate(() => Array.from(document.querySelectorAll('iframe'), (frame) => ({
            snapshot: frame.contentWindow.__listeningBridgeSnapshot(),
            reviewing: frame.contentWindow.App.state.isReviewing,
            disabled: Boolean(frame.contentDocument.querySelector('input')?.disabled),
            finishCalls: frame.contentWindow.App.finishCalls
        })));
        assert.ok(snapshots.every(({ snapshot }, index) => snapshot?.scoreInfo.correct === expectedPartScore(index + 1) && snapshot.scoreInfo.total === 1),
            `suite snapshots score current answers for ${JSON.stringify(options)}: ${JSON.stringify(snapshots.map(({ snapshot }) => snapshot?.scoreInfo))}`);
        assert.ok(snapshots.every(({ reviewing, disabled, finishCalls }) => !reviewing && !disabled && finishCalls === 0),
            'scoring snapshots do not enter native review');
        if (options.answerControl || options.alternatives || options.literalAnswer) {
            const expected = answerForPart(4);
            assert.equal(snapshots[3].snapshot.answers.q31, expected);
            assert.equal(await activeFrame(suite).locator('#fixture-results tbody td').nth(3).textContent(), expectedPartScore(4) ? 'Correct' : 'Incorrect');
            if (options.alternatives || options.literalAnswer) {
                assert.equal(await activeFrame(suite).locator('body').evaluate(() => Boolean(window.AnswerMatchCore)), Boolean(options.matchCore));
            }
            if (options.literalAnswer) {
                assert.ok(snapshots.every(({ snapshot }) => Object.values(snapshot.answerComparison).every(
                    (entry) => JSON.stringify(entry.acceptedAnswers) === JSON.stringify([options.literalAnswer])
                )), 'numeric slash answers remain one accepted value in every part');
            }
            if (options.alternatives) {
                assert.ok(snapshots.every(({ snapshot }) => Object.values(snapshot.answerComparison).every(
                    (entry) => JSON.stringify(entry.acceptedAnswers) === JSON.stringify(options.alternatives)
                )), 'displayed alternatives remain separate accepted answers in every part');
                if (options.invalidAnswers) {
                    const probes = await activeFrame(suite).locator('body').evaluate((_, alternatives) => {
                        const correctCell = document.querySelector('#fixture-results tbody tr').cells[2];
                        const input = document.querySelector('input');
                        const displayed = correctCell.textContent;
                        const answer = input.value;
                        const spaced = alternatives.find((value) => value.includes('/')).replaceAll('/', ' / ');
                        const variants = [alternatives, [spaced, ...alternatives.slice(1)]];
                        const results = variants.flatMap((accepted) => {
                            const invalid = [accepted.slice(0, 2).join(' / '), accepted.slice(0, 2).reverse().join(' / ')];
                            const orders = [accepted, accepted.slice().reverse(), [accepted[0], accepted[2], accepted[1]]];
                            return orders.flatMap((order) => {
                                correctCell.textContent = order.join(' / ');
                                return [...accepted, ...invalid].map((value) => {
                                    input.value = value;
                                    const snapshot = window.__listeningBridgeSnapshot();
                                    return { order, value, expected: accepted.includes(value) ? 1 : 0,
                                        correct: snapshot.scoreInfo.correct, accepted: snapshot.answerComparison.q31.acceptedAnswers };
                                });
                            });
                        });
                        correctCell.textContent = displayed;
                        input.value = answer;
                        return results;
                    }, options.alternatives);
                    for (const probe of probes) {
                        assert.deepEqual(probe.accepted, probe.order, `complete numeric alternatives keep their boundaries: ${JSON.stringify(probe)}`);
                        assert.equal(probe.correct, probe.expected,
                            `current numeric and textual answers are scored independently: ${JSON.stringify(probe)}`);
                    }
                }
                const dateScores = await activeFrame(suite).locator('body').evaluate(() => {
                    const correctCell = document.querySelector('#fixture-results tbody tr').cells[2];
                    const displayed = correctCell.textContent;
                    const input = document.querySelector('input');
                    const answer = input.value;
                    correctCell.textContent = '10/11/2026';
                    const scores = ['10', '10/11/2026'].map((value) => {
                        input.value = value;
                        return window.__listeningBridgeSnapshot().scoreInfo.correct;
                    });
                    correctCell.textContent = displayed;
                    input.value = answer;
                    return scores;
                });
                assert.deepEqual(dateScores, [0, 1], 'a literal date is not split into accepted alternatives');
            }
            if (options.answerControl === 'id') {
                assert.equal(await activeFrame(suite).locator('#q31').getAttribute('name'), null);
                assert.equal(await activeFrame(suite).locator('#q31').getAttribute('data-q'), null);
            }
            for (const value of ['wrong', '', ...components, ...(options.invalidAnswers || [])]) {
                const snapshot = await activeFrame(suite).locator('body').evaluate((_, currentValue) => {
                    const input = document.querySelector('input');
                    if (input) input.value = currentValue;
                    else document.querySelector('.token').dataset.value = document.querySelector('.token').textContent = currentValue;
                    return window.__listeningBridgeSnapshot();
                }, value);
                assert.equal(snapshot.answers.q31, value, 'snapshots read edits that have not refreshed the native report');
                assert.equal(snapshot.scoreInfo.correct, 0, 'a retained Correct result cannot credit a changed or empty answer');
            }
            await activeFrame(suite).locator('body').evaluate((_, answer) => {
                const input = document.querySelector('input');
                if (input) input.value = answer;
                else {
                    const token = document.querySelector('.token');
                    delete token.dataset.value;
                    token.textContent = answer;
                }
            }, expected);
            const restored = await activeFrame(suite).locator('body').evaluate(() => window.__listeningBridgeSnapshot());
            assert.equal(restored.answers.q31, expected, 'tokens also support text-only values');
            assert.equal(restored.scoreInfo.correct, expectedPartScore(4));
        }
        if (options.retainedTable) {
            assert.equal(await activeFrame(suite).locator('#fixture-results tbody td').nth(1).textContent(), '',
                'the live generator scores current inputs even while the retained table is blank');
        }
        if (options.reset) {
            await activeFrame(suite).locator('#clear-btn').click();
            assert.equal(await activeFrame(suite).locator('input').inputValue(), '');
            assert.equal(await activeFrame(suite).locator('#fixture-results tbody td').nth(1).textContent(), 'answer4',
                'native Reset leaves stale result artifacts without dispatching an input event');
            const resetSnapshot = await activeFrame(suite).locator('body').evaluate(() => window.__listeningBridgeSnapshot());
            assert.equal(resetSnapshot.answers.q31, '', 'table-only snapshots read the current reset answer');
            assert.equal(resetSnapshot.scoreInfo.correct, 0, 'a stale correct result must not survive Reset');
        }
        if (options.finishControl) {
            const nativeState = await activeFrame(suite).locator('#fixture-completion-control span').last().evaluate((target) => {
                target.click();
                return { finishCalls: window.App.finishCalls, reviewing: window.App.state.isReviewing };
            });
            assert.deepEqual(nativeState, { finishCalls: 0, reviewing: false },
                'simulation intercepts native completion before review handlers');
        } else await suite.locator('[data-suite-submit]').click();
        const saved = await waitForRecord(page);
        assert.equal(saved[0].correctAnswers, options.reset ? 3 : [1, 2, 3, 4].reduce((sum, part) => sum + expectedPartScore(part), 0));
        assert.equal(saved[0].suiteEntries.length, 4);
        if (options.answerControl || options.alternatives || options.literalAnswer) {
            assert.equal(saved[0].suiteEntries[3].answers.q31, snapshots[3].snapshot.answers.q31,
                'the aggregate record preserves the current table-backed answer');
        }
        results.push({ compatibility: options.scoring || options.finishControl, retainedTable: options.retainedTable, reset: options.reset,
            answerControl: options.answerControl, alternatives: options.alternatives, matchCore: options.matchCore,
            literalAnswer: options.literalAnswer, partialAnswer: options.partialAnswer, invalidAnswers: options.invalidAnswers,
            recordCount: saved.length, correct: saved[0].correctAnswers });
        await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'pass', results }));
} finally {
    fs.writeFileSync(path.join(reportDir, 'listening-suite-flow-report.json'), JSON.stringify({ results, errors }, null, 2));
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
}
