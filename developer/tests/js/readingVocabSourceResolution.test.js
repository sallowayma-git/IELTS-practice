import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createPage } from './helpers/readingVocabReaderHarness.js';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

test('reader resolves original libraries, preserves unavailable vocabulary, and opens the global notebook', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser);
    try {
        await page.route('https://reader.test/libraries/**', route => {
            const name = route.request().url().includes('/a/') ? 'Amber' : 'Beryl';
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${name}</title>
                <div id="passage"><h2>${name} article</h2><p>A ${name} passage belonging to its original library.</p></div>
                <div id="questions"><p>${name} question <input name="answer" value="unsafe"></p></div>
                <script>window.__importExecuted = true;</script>` });
        });
        await page.evaluate(() => {
            window.__sourceIndexes = Object.fromEntries(['a', 'b'].map(id => [id, [{
                id: 'shared', examId: 'shared', type: 'reading', title: `${id.toUpperCase()} title`,
                path: `libraries/${id}/`, filename: 'article.html', sourceKind: 'custom'
            }]]));
            AppData.library.getActive = async () => 'b';
            AppData.library.getIndex = async id => __sourceIndexes[id] || [];
            AppData.library.listConfigurations = async () => ['a', 'b'].map(id => ({ id, name: `Library ${id}` }));
            window.examIndex = __sourceIndexes.b;
            window.__READING_EXAM_DATA__ = { get: () => ({ meta: { title: 'Wrong built-in' },
                passage: { blocks: [{ html: '<p>Wrong built-in content</p>' }] } }), register() {} };
        });
        await page.evaluate(() => ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' } }));
        assert.match(await page.locator('#vocab-passage-content').innerText(), /Amber/);
        assert.match(await page.locator('#vocab-reader-badges').innerText(), /Library a · a/);
        assert.equal(await page.locator('#vocab-questions-content input').count(), 0);
        assert.equal(await page.evaluate(() => window.__importExecuted), undefined);
        await page.evaluate(() => ReadingVocabStore.add('amber', 'shared', 'A title', '', null, { kind: 'imported', id: 'a' }));
        await page.evaluate(() => ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'b' } }));
        assert.match(await page.locator('#vocab-passage-content').innerText(), /Beryl/);
        assert.equal(await page.locator('#vocab-fab-count').innerText(), '0');
        await page.evaluate(() => ReadingVocabStore.add('beryl', 'shared', 'B title', '', null, { kind: 'imported', id: 'b' }));
        const beforeReplacement = await page.evaluate(() => structuredClone(__readingAuthority.snapshot));
        await page.evaluate(async () => {
            __sourceIndexes.a[0].title = 'Replacement article';
            await ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' }, title: 'Replacement article' });
        });
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /文章已更改/);
        assert.equal(await page.locator('#vocab-reader-title').innerText(), 'A title');
        assert.equal(await page.locator('#vocab-fab-count').innerText(), '1');
        assert.equal(await page.evaluate(() => ReadingVocabReader.currentPayload), null);
        assert.deepEqual(await page.evaluate(() => __readingAuthority.snapshot), beforeReplacement);
        await page.evaluate(() => ReadingVocabReader.open('shared', {
            source: { kind: 'imported', id: 'b' },
            articleId: AppData.vocab.readingModel.articleId({ kind: 'imported', id: 'a' }, 'shared')
        }));
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /文章与题库来源不匹配/);
        assert.equal(await page.locator('#vocab-fab-count').innerText(), '0');
        assert.equal(await page.locator('#vocab-export-btn').isEnabled(), false);
        await page.evaluate(async () => {
            delete __sourceIndexes.a;
            await ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' }, fromView: 'bookshelf' });
        });
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /原题库或文章已移除/);
        assert.equal(await page.locator('#vocab-reader-title').innerText(), 'A title');
        assert.equal((await page.locator('#vocab-reader-back-btn').innerText()).trim(), '返回书架');
        assert.equal(await page.locator('#vocab-fab-count').innerText(), '1');
        await page.getByRole('button', { name: '查看已保存生词' }).click();
        assert.deepEqual(await page.locator('.vocab-item__word').allTextContents(), ['amber']);
        assert.equal(await page.locator('#vocab-export-btn').isEnabled(), true);
        assert.equal(await page.locator('#vocab-manual-add-btn').isEnabled(), false);
        await page.evaluate(() => ReadingVocabReader.openNotebook({ fromView: 'bookshelf' }));
        assert.equal(await page.locator('#vocab-modal').getAttribute('aria-hidden'), 'false');
        assert.deepEqual((await page.locator('.vocab-item__word').allTextContents()).sort(), ['amber', 'beryl']);
        assert.equal(await page.locator('#v-tab-current').isEnabled(), false);
        assert.equal(await page.locator('#vocab-clear-btn').isEnabled(), true);
        assert.equal(await page.evaluate(() => __readingAuthority.snapshot.reading.visits.length), 2);
    } finally {
        await page.close();
        await browser.close();
    }
});

test('rapid opens of the same examId retain only the latest imported source', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser);
    try {
        const state = await page.evaluate(async () => {
            const payloads = { a: 'Amber', b: 'Beryl' };
            AppData.library.listConfigurations = async () => ['a', 'b'].map(id => ({ id, name: id }));
            AppData.library.getIndex = async id => [{ id: 'shared', title: payloads[id], filename: `https://content.test/${id}.html` }];
            const pending = new Map();
            window.fetch = url => new Promise(resolve => pending.set(url, resolve));
            const first = ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' } });
            for (let step = 0; step < 50 && !pending.has('https://content.test/a.html'); step += 1) await Promise.resolve();
            const latest = ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'b' } });
            for (let step = 0; step < 50 && !pending.has('https://content.test/b.html'); step += 1) await Promise.resolve();
            for (const [id, promise] of [['b', latest], ['a', first]]) {
                pending.get(`https://content.test/${id}.html`)({ ok: true, text: async () => `<div id="passage"><p>This is ${payloads[id]} and its original article.</p></div>` });
                await promise;
            }
            return { source: ReadingVocabReader.currentSource.id,
                title: document.querySelector('#vocab-reader-title').textContent,
                passage: document.querySelector('#vocab-passage-content').textContent,
                visits: __readingAuthority.snapshot.reading.visits.length };
        });
        assert.equal(state.source, 'b');
        assert.equal(state.title, 'Beryl');
        assert.match(state.passage, /Beryl/);
        assert.doesNotMatch(state.passage, /Amber/);
        assert.equal(state.visits, 1);
    } finally {
        await page.close();
        await browser.close();
    }
});

test('initiating title is validated independently and normalized like the saved title', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser, { canonicalWords: [{ word: 'amber', examId: 'shared',
        examTitle: 'Original title', source: { kind: 'imported', id: 'a' } }] });
    let contentRequests = 0;
    try {
        await page.route('https://reader.test/original.html', route => {
            contentRequests += 1;
            return route.fulfill({ contentType: 'text/html', body: '<div id="passage"><p>The original amber article remains available for reading.</p></div>' });
        });
        await page.evaluate(() => {
            AppData.library.getIndex = async () => [{ id: 'shared', title: 'Original title', filename: 'original.html' }];
            AppData.library.listConfigurations = async () => [{ id: 'a' }];
        });
        const originalSnapshot = await page.evaluate(() => structuredClone(__readingAuthority.snapshot));
        await page.evaluate(() => ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' }, title: 'Stale initiating title' }));
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /文章已更改/);
        assert.equal(await page.locator('#vocab-reader-title').innerText(), 'Original title');
        assert.equal(contentRequests, 0);
        assert.deepEqual(await page.evaluate(() => __readingAuthority.snapshot), originalSnapshot);
        await page.evaluate(() => ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' }, title: '  Original\n  title  ' }));
        assert.equal(await page.locator('[data-source-unavailable]').count(), 0);
        assert.match(await page.locator('#vocab-passage-content').innerText(), /original amber article/);
        assert.equal(contentRequests, 1);
    } finally {
        await page.close();
        await browser.close();
    }
});

for (const [configurationShape, configurations] of [
    ['id', [{ id: 'a' }, { id: 'b' }]],
    ['key', [{ key: 'a' }, { key: 'b' }]],
    ['configId', [{ configId: 'a' }, { configId: 'b' }]],
    ['string', ['a', 'b']],
    ['id with legacy configId competitor', [{ id: 'a' }, { configId: 'b' }]],
    ['id with legacy string competitor', [{ id: 'a' }, 'b']]
]) test(`file-picker source and competing import key resolve ${configurationShape} configurations`, async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser);
    try {
        const state = await page.evaluate(async configurations => {
            const source = { kind: 'imported', id: 'a' };
            const exam = { id: 'shared', title: 'Original article', sourceKind: 'file-picker', importKey: 'reading:shared.html' };
            const url = URL.createObjectURL(new Blob(['<div id="passage"><p>The original session article with an amber specimen.</p></div>'], { type: 'text/html' }));
            let ambiguous = false;
            let resourceReads = 0;
            const indexReads = [];
            AppData.library.listConfigurations = async () => configurations;
            AppData.library.getIndex = async id => {
                indexReads.push(id);
                if (!['a', 'b'].includes(id)) throw new Error('Invalid configuration ID');
                return id === 'a' || ambiguous ? [exam] : [];
            };
            window.LibraryDiscovery = { resolveRuntimeResource: candidate => {
                if (Object.keys(candidate).join(',') !== 'importKey') throw new Error('Unsafe examId fallback');
                resourceReads += 1;
                return url;
            } };
            await ReadingVocabReader.open('shared', { source });
            const initialContent = document.querySelector('#vocab-passage-content').textContent;
            await ReadingVocabStore.add('amber', 'shared', exam.title, '', null, source);
            ambiguous = true;
            await ReadingVocabReader.open('shared', { source });
            ReadingVocabReader.openModal();
            URL.revokeObjectURL(url);
            return { initialContent, resourceReads, indexReads,
                unavailable: document.querySelector('[data-source-unavailable]').textContent,
                words: [...document.querySelectorAll('.vocab-item__word')].map(element => element.textContent),
                exportEnabled: !document.querySelector('#vocab-export-btn').disabled };
        }, configurations);
        assert.match(state.initialContent, /original session article/);
        assert.equal(state.resourceReads, 1);
        assert.deepEqual(state.indexReads, ['a', 'b', 'a', 'b']);
        assert.match(state.unavailable, /无法确认原文来源/);
        assert.deepEqual(state.words, ['amber']);
        assert.equal(state.exportEnabled, true);
    } finally {
        await page.close();
        await browser.close();
    }
});

test('imported passage is sanitized before normalization and keeps its original figure URLs', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser);
    const executedRequests = [];
    try {
        await page.route('https://reader.test/executed**', route => {
            executedRequests.push(route.request().url());
            return route.fulfill({ status: 204, body: '' });
        });
        await page.route('https://reader.test/content/**', route => {
            const url = route.request().url();
            if (!url.endsWith('article.html')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>' });
            return route.fulfill({ contentType: 'text/html', body: `<title>Original title</title><div id="passage">
                <h2>Original title</h2><p>A complete imported passage with a figure.</p>
                <img alt="Diagram" src="diagram.svg" onload="window.__importExecuted=true;fetch('/executed-load')">
                <img alt="Responsive diagram" src="fallback.svg" srcset="small.svg 1x, large.svg 2x" onerror="window.__importExecuted=true;fetch('/executed-responsive')">
                <img alt="Broken figure" src="/broken-import-image" onerror="window.__importExecuted=true;fetch('/executed-error')">
                <img alt="Unsafe URL" src="javascript:window.__importExecuted=true">
                <meta http-equiv="refresh" content="0;url=/executed-navigation"><base href="https://incorrect.test/">
                </div><div id="questions"><p>Questions with a figure <img alt="Question diagram" src="question.svg" onload="window.__importExecuted=true;fetch('/executed-question')"></p></div>` });
        });
        await page.route('https://reader.test/broken-import-image', route => route.fulfill({ status: 404, body: '' }));
        await page.evaluate(() => {
            AppData.library.getIndex = async () => [{ id: 'shared', title: 'Original title', path: 'content/', filename: 'article.html' }];
            AppData.library.listConfigurations = async () => [{ id: 'a', name: 'Original library' }];
        });
        await page.evaluate(() => ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' } }));
        await page.waitForFunction(() => [...document.querySelectorAll('#vocab-reader-body img')].every(image => image.complete));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.__importExecuted), undefined);
        assert.deepEqual(executedRequests, []);
        assert.equal(await page.locator('#vocab-reader-body [onload], #vocab-reader-body [onerror], #vocab-reader-body meta, #vocab-reader-body base').count(), 0);
        assert.equal(await page.getByAltText('Diagram', { exact: true }).getAttribute('src'), 'https://reader.test/content/diagram.svg');
        assert.equal(await page.getByAltText('Question diagram').getAttribute('src'), 'https://reader.test/content/question.svg');
        assert.equal(await page.getByAltText('Responsive diagram').getAttribute('srcset'), 'https://reader.test/content/small.svg 1x, https://reader.test/content/large.svg 2x');
        assert.equal(await page.getByAltText('Unsafe URL').getAttribute('src'), null);
        assert.equal(await page.evaluate(() => document.baseURI), 'https://reader.test/');
    } finally {
        await page.close();
        await browser.close();
    }
});

test('article source bindings prevent same-title replacement and ambiguous restored references', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser, { canonicalWords: [{ word: 'retained', examId: 'shared', examTitle: 'Original title', source: { kind: 'imported', id: 'a' } }] });
    const contentRequests = [];
    try {
        await page.route('https://reader.test/content/**', route => {
            contentRequests.push(route.request().url());
            return route.fulfill({ contentType: 'text/html', body: '<div id="passage"><p>An amber specimen remains in the original passage for collection.</p></div>' });
        });
        await page.evaluate(() => {
            window.__boundExam = { id: 'shared', title: 'Original title', sourceKind: 'custom', path: 'content/original/', filename: 'article.html' };
            AppData.library.getIndex = async () => [__boundExam];
            AppData.library.listConfigurations = async () => [{ id: 'a', name: 'Original library' }];
        });
        await page.evaluate(() => ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' } }));
        await page.evaluate(() => ReadingVocabReader.openModal());
        await page.locator('#vocab-manual-input').fill('manual');
        await page.locator('#vocab-manual-add-btn').click();
        await page.waitForFunction(() => ReadingVocabStore.getAll().some(row => row.word === 'manual'));
        const bindings = await page.evaluate(async () => {
            ReadingVocabReader.closeModal();
            __selectText('#vocab-passage-content', 'amber');
            await ReadingVocabReader.captureSelection();
            return { expected: AppData.vocab.readingModel.contentRef(__boundExam),
                saved: __readingAuthority.snapshot.reading.articles[0].contentRefs,
                collected: __readingAuthority.calls.filter(call => call.type === 'collect').map(call => call.command.article.contentRef) };
        });
        assert.deepEqual(bindings.saved, [bindings.expected]);
        assert.deepEqual(bindings.collected, [bindings.expected, bindings.expected]);
        await page.evaluate(async () => {
            __boundExam.path = 'content/replacement/';
            await ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' } });
            ReadingVocabReader.openModal();
        });
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /文章文件已更改或来源记录冲突/);
        assert.deepEqual((await page.locator('.vocab-item__word').allTextContents()).sort(), ['amber', 'manual', 'retained']);
        assert.equal(await page.locator('#vocab-export-btn').isEnabled(), true);
        assert.equal(contentRequests.length, 1);
        await page.evaluate(async () => {
            const model = AppData.vocab.readingModel;
            const incoming = model.recordVisit(model.createSnapshot(), { source: { kind: 'imported', id: 'a' },
                article: { examId: 'shared', title: 'Original title', contentRef: model.contentRef(__boundExam) }, at: '2026-09-08T02:00:00.000Z' });
            __readingAuthority.snapshot = model.merge(__readingAuthority.snapshot, incoming);
            __readingAuthority.revision += 1;
            __boundExam.path = 'content/original/';
            await ReadingVocabReader.open('shared', { source: { kind: 'imported', id: 'a' } });
        });
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /来源记录冲突/);
        assert.equal(contentRequests.length, 1);
        await page.evaluate(async () => {
            const model = AppData.vocab.readingModel;
            const expected = model.contentRef(__boundExam);
            __boundExam.id = 'unvisited';
            __boundExam.path = 'content/replacement/';
            await ReadingVocabReader.open('unvisited', { source: { kind: 'imported', id: 'a' }, contentRef: expected });
        });
        assert.match(await page.locator('[data-source-unavailable]').innerText(), /文章文件已更改/);
        assert.equal(contentRequests.length, 1);
        assert.equal(await page.evaluate(() => __readingAuthority.snapshot.reading.articles.some(row => row.examId === 'unvisited')), false);
    } finally {
        await page.close();
        await browser.close();
    }
});
