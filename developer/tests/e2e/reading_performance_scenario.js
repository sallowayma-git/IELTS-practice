import assert from 'node:assert/strict';
export async function readingScenario(page, result, measure, baseline) {
    const words = Number(process.env.WORDS || 1000);
    result.words = words;
    await page.locator('nav button[data-view="more"]').click();
    await page.evaluate(() => AppEntry.ensureMoreToolsGroup());
    result.moreAssets = await page.evaluate(() => ({ reader: !!window.ReadingVocabReader,
        bookshelf: !!window.ReadingBookshelfStore, words: !!window.__EMBEDDED_WORDLISTS__, dictionary: !!window.DictionaryService }));
    if (!baseline) assert.deepEqual(result.moreAssets, { reader: false, bookshelf: false, words: false, dictionary: false });
    await measure('seedVocabularyMs', () => page.evaluate(async words => {
        const model = AppData.vocab.readingModel;
        const source = { kind: 'builtin', id: 'default' };
        const at = '2026-09-01T00:00:00.000Z';
        const examId = 'p2-low-08';
        let snapshot = model.createSnapshot();
        for (let i = 0; i < 100; i++) snapshot = model.recordVisit(snapshot, { source,
            article: { examId: i ? `perf-article-${i}` : examId, title: i ? `Article ${i}` : window.__READING_EXAM_MANIFEST__[examId].title }, at });
        for (let i = 0; i < words; i++) {
            const word = `word${i}`;
            const termId = model.termId(word);
            const article = snapshot.reading.articles[i % 100];
            const associationId = JSON.stringify(['association', article.id, termId]);
            snapshot.words.push({ id: `word-${i}`, word, meaning: `Meaning ${i}`, example: 'Example sentence.', createdAt: at });
            snapshot.reading.terms.push({ id: termId, normalizedTerm: word, wordRef: { listId: 'default', wordId: `word-${i}` }, createdAt: at });
            snapshot.reading.associations.push({ id: associationId, articleId: article.id, termId, manual: false, createdAt: at, updatedAt: at });
            for (let n = 0; n < 3; n++) {
                const anchor = { scopeId: 'passage-1', contentVersion: 'performance-fixture', startOffset: i * 100 + n * 20,
                    endOffset: i * 100 + n * 20 + word.length, quote: word, before: 'a ', after: ' example' };
                snapshot.reading.occurrences.push({ id: model.occurrenceId(article.id, termId, anchor), associationId, ...anchor, createdAt: at, updatedAt: at });
            }
        }
        model.validate(snapshot);
        window.__readingPerfSnapshot = snapshot;
        // Use the production V2 import boundary, including its checksum/CAS checks.
        const data = await AppData.backups.export();
        const stable = v => v && typeof v === 'object' ? Array.isArray(v) ? `[${v.map(stable).join(',')}]`
            : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
        const checksum = v => { let hash = 2166136261; for (const c of stable(v)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`; };
        for (const [key, value] of [['vocab.words', snapshot.words], ['vocab.readingState', { ...data.envelopes['vocab.readingState'].data, reading: snapshot.reading }]]) {
            Object.assign(data.envelopes[key], { state: 'present', data: value, checksum: checksum(value) });
        }
        data.checksum = checksum({ envelopes: data.envelopes, entities: data.entities });
        const plan = await AppData.backups.previewImport(data, { replace: true });
        await AppData.backups.commitImport(plan.id, { confirmDestructive: true });
    }, words));
    for (let i = 0; i < 3; i++) await measure(`queryAll${i}Ms`, () => page.evaluate(() => {
        const result = AppData.vocab.readingModel.query(__readingPerfSnapshot);
        if (result.distinctTermCount !== __readingPerfSnapshot.reading.terms.length || result.occurrenceCount !== result.distinctTermCount * 3) throw new Error('query lost data');
    }));
    await page.evaluate(() => ExternalBackupService.closeModal());
    await measure('bookshelfOpenMs', () => page.evaluate(async () => {
        await AppActions.openBookshelf({ fromView: 'more' });
        await ReadingBookshelfStore.init();
    }));
    if (!baseline && await page.evaluate(() => typeof AppData.vocab.getReadingBookshelf === 'function')) {
        await page.waitForFunction(() => document.querySelectorAll('.bookshelf-card').length === 20
            && [...document.querySelectorAll('.bookshelf-card')].every(card => card.querySelectorAll('.bookshelf-vocab-chip').length > 0));
        result.cachePaging = await page.evaluate(async () => {
            const before = __readingFullReads;
            const index = await AppData.vocab.getReadingBookshelf();
            const article = index.articles[0];
            const first = await AppData.vocab.getReadingArticleWords(article.articleId, 0);
            const second = await AppData.vocab.getReadingArticleWords(article.articleId, 1);
            if (first.words.length !== Math.min(10, article.wordCount)) throw new Error('first word page is not bounded');
            if (second.words.length !== Math.min(10, Math.max(0, article.wordCount - 10))) throw new Error('second page mismatch');
            return { fullReads: __readingFullReads - before, initialCards: document.querySelectorAll('.bookshelf-card').length,
                initialPreviewWords: document.querySelectorAll('.bookshelf-card .bookshelf-vocab-chip').length };
        });
        assert.equal(result.cachePaging.fullReads, 0);
        if (words >= 5000) {
            const card = page.locator('.bookshelf-card').first();
            const before = await card.locator('.bookshelf-vocab-chip').first().getAttribute('data-word');
            await card.locator('[data-action="word-page"][data-page="1"]').click();
            await page.waitForFunction(before => document.querySelector('.bookshelf-card .bookshelf-vocab-chip')?.dataset.word !== before, before);
            assert.equal(await card.locator('.bookshelf-vocab-chip').count(), 10);
            await card.locator('[data-action="word-page"][data-page="0"]').click();
            await page.waitForFunction(before => document.querySelector('.bookshelf-card .bookshelf-vocab-chip')?.dataset.word === before, before);
        }
        await measure('bookshelfWarmMs', () => page.evaluate(async () => { await ReadingBookshelfStore.init(); }));
        const cachedPage = await page.context().newPage();
        await cachedPage.goto(page.url());
        await cachedPage.waitForFunction(() => window.AppData);
        result.persistentCache = await cachedPage.evaluate(async () => {
            await AppData.ready;
            let fullReads = 0;
            const get = IDBObjectStore.prototype.get;
            IDBObjectStore.prototype.get = function(key) {
                if (this.name === 'documents' && ['vocab.words', 'vocab.lists', 'vocab.readingState'].includes(key)) fullReads++;
                return get.apply(this, arguments);
            };
            const index = await AppData.vocab.getReadingBookshelf();
            const words = await AppData.vocab.getReadingArticleWords(index.articles[0].articleId, 0);
            IDBObjectStore.prototype.get = get;
            return { fullReads, count: words.words.length, cards: index.articles.length };
        });
        assert.equal(result.persistentCache.fullReads, 0, 'another tab must reuse the persistent lightweight cache');
        await cachedPage.close();
        await page.locator('[data-action="load-more-cards"]').click();
        assert.equal(await page.locator('.bookshelf-card').count(), 40);
    }
    for (const suffix of ['Cold', 'Warm']) {
        await page.evaluate(() => BookshelfView.ensureReader());
        const start = performance.now();
        const opened = page.evaluate(async () => {
            await ReadingVocabReader.open('p2-low-08', { source: { kind: 'builtin', id: 'default' }, fromView: 'bookshelf' });
            if (!ReadingVocabReader.currentPayload) throw new Error('reader passage did not load');
        });
        await page.waitForFunction(() => window.ReadingVocabReader?.currentPayload
            && document.getElementById('vocab-passage-content')?.textContent.length > 100
            && !document.querySelector('#vocab-passage-content .vocab-loading-spinner'));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        result.metrics[`readerFirstPaint${suffix}Ms`] = Math.round((performance.now() - start) * 10) / 10;
        await opened;
        result.metrics[`readerOpen${suffix}Ms`] = Math.round((performance.now() - start) * 10) / 10;
        await page.evaluate(() => ReadingVocabReader.close());
    }
    await measure('notebookOpenMs', () => page.evaluate(async () => {
        await ReadingNotebookView.open({ fromView: 'bookshelf' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }));
    if (!baseline) {
        assert.equal(await page.locator('.reading-notebook-entry').count(), Math.min(words, 100));
        await page.locator('[data-action="notebook-load-more"]').click();
        assert.equal(await page.locator('.reading-notebook-entry').count(), Math.min(words, 200));
    }
    await measure('notebookSearchMs', () => page.evaluate(() => {
        ReadingNotebookView.state.searchQuery = 'word99'; ReadingNotebookView.render();
    }));
    await measure('vocabularyExportMs', () => page.evaluate(() => {
        const exported = AppData.vocab.readingModel.toPlainText(ReadingVocabStore._state.snapshot);
        if (exported.count !== __readingPerfSnapshot.reading.terms.length) throw new Error('export lost vocabulary');
    }));
    result.readingAssets = await page.evaluate(() => ({
        dictionaryLoaded: !!window.DictionaryService,
        originalPayloadRequests: performance.getEntriesByType('resource').filter(e => /reading-exams\/.+\.js/.test(e.name)).map(e => e.name),
        longTasks: __perfTasks.length, maxLongTaskMs: Math.max(0, ...__perfTasks)
    }));
    assert.equal(result.readingAssets.originalPayloadRequests.length, 1,
        'opening one article must not fetch other original texts');
    // The reading page itself must not load dictionaries until lookup is requested.
    const dictionaryPage = await page.context().newPage();
    await dictionaryPage.goto(new URL('assets/generated/reading-exams/reading-practice-unified.html?examId=p2-low-08', page.url()).href);
    await dictionaryPage.waitForFunction(() => window.AppData);
    // Isolate the production dictionary loader from the app shell.
    if (!baseline) {
        await dictionaryPage.waitForFunction(() => typeof window.ensureReadingDictionary === 'function');
        assert.equal(await dictionaryPage.evaluate(() => !!window.DictionaryService), false);
        await measure('firstDictionaryLookupMs', () => dictionaryPage.evaluate(async () => {
            await Promise.all([ensureReadingDictionary(), ensureReadingDictionary()]);
            if (!DictionaryService.lookup('apple').found) throw new Error('dictionary lookup failed');
        }));
        await measure('warmDictionaryLookupMs', () => dictionaryPage.evaluate(() => DictionaryService.lookup('apple')));
        result.dictionaryRequests = await dictionaryPage.evaluate(() => performance.getEntriesByType('resource').filter(e => /ecdict_reading/.test(e.name)).length);
        assert.equal(result.dictionaryRequests, 1);
    }
    await dictionaryPage.close();
}
