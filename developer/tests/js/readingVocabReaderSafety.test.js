import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, openArticle } from './helpers/readingVocabReaderHarness.js';
import { chromium } from 'playwright';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

test('reading vocab reader preserves text boundaries and the active reading session', async t => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
        await t.test('stored and imported text never creates markup or event attributes; speak and delete preserve values', async () => {
            const attacks = [{
                id: 'id" onclick="window.__injected=true" data-extra="',
                word: '<img src=x onerror="window.__injected=true">',
                context: '</p><svg onload="window.__injected=true"></svg>',
                examTitle: '<iframe srcdoc="<script>parent.__injected=true</script>"></iframe>',
                examId: 'exam-a'
            }, {
                id: 'ordinary-id', word: 'research & development', context: 'A "quoted" context',
                examTitle: 'Ordinary exam', examId: 'exam-b'
            }, {
                id: "alternate-'\"-id", word: '&lt;svg onload=alert(1)&gt;',
                context: '&#34; & < >', examTitle: 'Title &amp; literal', examId: 'exam-c'
            }];
            {
                const page = await createPage(browser, { canonicalWords: attacks });
                try {
                    const state = await page.evaluate(async () => {
                        await ReadingVocabStore.init();
                        ReadingVocabReader.modalTab = 'all';
                        ReadingVocabReader.openModal();
                        const list = document.getElementById('vocab-list');
                        return {
                            ids: ReadingVocabStore.getAll().map(item => item.id),
                            unsafeNodes: list.querySelectorAll('img, svg, iframe, script, [onclick], [onload], [onerror], [data-extra]').length,
                            rows: [...list.querySelectorAll('.vocab-item')].map(row => ({
                                id: row.dataset.wordId, word: row.querySelector('.vocab-item__word').textContent,
                                speak: row.querySelector('.vocab-speak-btn').dataset.speakWord,
                                deleteId: row.querySelector('.vocab-delete-btn').dataset.delId,
                                context: row.querySelector('.vocab-item__context').textContent,
                                title: row.querySelector('.vocab-item__source').textContent
                            }))
                        };
                    });
                    assert.equal(state.unsafeNodes, 0, 'Canonical vocabulary must remain inert text');
                    assert.deepEqual(state.rows, attacks.map((item, index) => ({
                        id: state.ids[index], word: item.word, speak: item.word, deleteId: state.ids[index],
                        context: `"${item.context}"`, title: item.examTitle
                    })));
                    await page.locator('.vocab-speak-btn').first().click();
                    assert.deepEqual(await page.evaluate(() => window.__spokenWords), [attacks[0].word]);
                    await page.locator('.vocab-delete-btn').first().click();
                    await page.waitForFunction(() => ReadingVocabStore.getAll().length === 2);
                    assert.deepEqual(await page.evaluate(() => ReadingVocabStore.getAll().map(item => item.id)), state.ids.slice(1));
                    assert.equal(await page.evaluate(() => !!window.__injected), false);
                } finally { await page.close(); }
            }
        });

        await t.test('canonical snapshots replace stale mirrors without touching local vocabulary storage', async () => {
            const localWords = [{ id: 'old', word: 'stale' }, { id: 'new', word: 'current' }];
            for (const canonicalWords of [[], [localWords[1]]]) {
                const page = await createPage(browser, { localWords, canonicalWords });
                try {
                    const state = await page.evaluate(async () => {
                        const reads = [], writes = [];
                        const get = Storage.prototype.getItem;
                        const set = Storage.prototype.setItem;
                        Storage.prototype.getItem = function (key) { reads.push(key); return get.call(this, key); };
                        Storage.prototype.setItem = function (key, value) { writes.push(key); return set.call(this, key, value); };
                        await ReadingVocabStore.init();
                        const words = ReadingVocabStore.getAll().map(item => item.word);
                        Storage.prototype.getItem = get;
                        Storage.prototype.setItem = set;
                        return { words, reads, writes, local: JSON.parse(localStorage.getItem('ielts_reading_vocab_words_v1')), saves: __readingAuthority.calls };
                    });
                    assert.deepEqual(state, { words: canonicalWords.map(item => item.word), reads: [], writes: [], local: localWords, saves: [] });
                } finally { await page.close(); }
            }
        });

        await t.test('missing or failed canonical authority rejects initialization and never adopts the legacy mirror', async () => {
            const localWords = [{ id: 'legacy', word: 'preserved' }];
            for (const authority of ['missing', 'failed']) {
                const page = await createPage(browser, { localWords, authority });
                try {
                    const state = await page.evaluate(async () => {
                        let rejected = false;
                        try { await ReadingVocabStore.init(); } catch (_) { rejected = true; }
                        return { rejected, words: ReadingVocabStore.getAll(), local: JSON.parse(localStorage.getItem('ielts_reading_vocab_words_v1')), saves: __readingAuthority.calls };
                    });
                    assert.deepEqual(state, { rejected: true, words: [], local: localWords, saves: [] });
                } finally { await page.close(); }
            }
        });

        await t.test('manual collection waits for acknowledgement and failed retries preserve the entered word', async () => {
            const page = await createPage(browser);
            try {
                await openArticle(page);
                await page.evaluate(() => {
                    ReadingVocabReader.openModal();
                    __readingAuthority.defer = true;
                });
                await page.locator('#vocab-manual-input').fill('acknowledged');
                await page.locator('#vocab-manual-add-btn').click();
                await page.waitForFunction(() => __readingAuthority.pending.length === 1);
                assert.equal(await page.locator('#vocab-manual-input').inputValue(), 'acknowledged');
                assert.equal(await page.evaluate(() => ReadingVocabStore.getAll().length), 0);
                await page.evaluate(() => __readingAuthority.pending.shift().reject(new Error('Injected quota failure')));
                await page.waitForFunction(() => document.querySelector('#vocab-toast')?.textContent.includes('失败'));
                assert.equal(await page.locator('#vocab-manual-input').inputValue(), 'acknowledged');
                assert.equal(await page.evaluate(() => ReadingVocabStore.getAll().length), 0);
                await page.locator('#vocab-manual-add-btn').click();
                await page.waitForFunction(() => __readingAuthority.pending.length === 1);
                await page.evaluate(() => __readingAuthority.pending.shift().resolve());
                await page.waitForFunction(() => document.querySelector('#vocab-manual-input').value === '');
                assert.deepEqual(await page.evaluate(() => ({
                    words: ReadingVocabStore.getAll().map(item => item.word),
                    anchors: __readingAuthority.snapshot.reading.occurrences.length,
                    manual: __readingAuthority.snapshot.reading.associations[0].manual,
                    optimisticMarks: document.querySelectorAll('mark.vocab-highlight').length
                })), { words: ['acknowledged'], anchors: 0, manual: true, optimisticMarks: 0 });
            } finally { await page.close(); }
        });

        await t.test('selection failure removes the temporary mark and retry acknowledges one exact occurrence', async () => {
            const page = await createPage(browser);
            try {
                await openArticle(page, 'article', 'water water water');
                await page.evaluate(() => {
                    __readingAuthority.defer = true;
                    __selectText('#vocab-passage-content em', 'water', 1);
                    document.querySelector('#vocab-reader-body').dispatchEvent(new MouseEvent('mouseup'));
                });
                await page.waitForFunction(() => __readingAuthority.pending.length === 1);
                assert.equal(await page.evaluate(() => ReadingVocabStore.getAll().length), 0);
                await page.evaluate(() => __readingAuthority.pending.shift().reject(new Error('Injected transaction abort')));
                await page.waitForFunction(() => document.querySelector('#vocab-toast')?.textContent.includes('失败'));
                assert.equal(await page.locator('mark.vocab-highlight').count(), 0);
                assert.equal(await page.evaluate(() => __readingAuthority.snapshot.reading.occurrences.length), 0);
                assert.match(await page.locator('#vocab-toast').textContent(), /重新|重试/);
                await page.evaluate(() => {
                    __selectText('#vocab-passage-content em', 'water', 1);
                    document.querySelector('#vocab-reader-body').dispatchEvent(new MouseEvent('mouseup'));
                });
                await page.waitForFunction(() => __readingAuthority.pending.length === 1);
                await page.evaluate(() => __readingAuthority.pending.shift().resolve());
                await page.waitForFunction(() => ReadingVocabStore.getAll().length === 1);
                assert.equal(await page.locator('mark.vocab-highlight').count(), 1);
                const saved = await page.evaluate(() => __readingAuthority.snapshot.reading.occurrences[0]);
                assert.equal(saved.quote, 'water');
                assert.equal(saved.endOffset - saved.startOffset, 5);
                assert.equal(await page.evaluate(() => __readingAuthority.snapshot.reading.occurrences.length), 1);
                await page.evaluate(() => ReadingVocabReader.applyVocabHighlights());
                assert.equal(await page.locator('mark.vocab-highlight').count(), 1);
                assert.deepEqual(await page.evaluate(() => {
                    const mark = document.querySelector('#vocab-passage-content em mark');
                    return { text: mark.textContent, before: mark.previousSibling.textContent, after: mark.nextSibling.textContent };
                }), { text: 'water', before: 'water ', after: ' water' });
            } finally { await page.close(); }
        });

        await t.test('failed delete and clear preserve the visible collection until a durable retry succeeds', async () => {
            const page = await createPage(browser);
            try {
                await openArticle(page);
                await page.evaluate(async () => {
                    await ReadingVocabStore.add('retained', 'article', 'article');
                    ReadingVocabReader.openModal();
                    __readingAuthority.fault = 'Injected storage failure';
                });
                for (const button of ['.vocab-delete-btn', '#vocab-clear-btn']) {
                    await page.locator(button).click();
                    await page.waitForFunction(() => document.querySelector('#vocab-toast')?.textContent.includes('失败'));
                    assert.equal(await page.locator('.vocab-item').count(), 1);
                    assert.deepEqual(await page.evaluate(() => ReadingVocabStore.getAll().map(item => item.word)), ['retained']);
                }
                await page.evaluate(() => { __readingAuthority.fault = null; });
                await page.locator('#vocab-clear-btn').click();
                await page.waitForFunction(() => ReadingVocabStore.getAll().length === 0);
                assert.equal(await page.locator('.vocab-item').count(), 0);
            } finally { await page.close(); }
        });

        await t.test('identical exam IDs stay isolated by library and current-article clear preserves the other library', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    const a = { kind: 'imported', id: 'library-a' };
                    const b = { kind: 'imported', id: 'library-b' };
                    await ReadingVocabStore.init();
                    await ReadingVocabStore.add('apple', 'same-exam', 'Library A', '', null, a);
                    await ReadingVocabStore.add('apple', 'same-exam', 'Library B', '', null, b);
                    const before = {
                        all: ReadingVocabStore.getAll().length,
                        a: ReadingVocabStore.getByExam('same-exam', a).length,
                        b: ReadingVocabStore.getByExam('same-exam', b).length,
                        builtin: ReadingVocabStore.getByExam('same-exam').length
                    };
                    await ReadingVocabStore.clear('same-exam', a);
                    return { before, a: ReadingVocabStore.getByExam('same-exam', a).length, b: ReadingVocabStore.getByExam('same-exam', b).length };
                });
                assert.deepEqual(state, { before: { all: 1, a: 1, b: 1, builtin: 0 }, a: 0, b: 1 });
            } finally { await page.close(); }
        });

        await t.test('unsupported imported source cannot record a visit or collect builtin passage content', async () => {
            const page = await createPage(browser);
            try {
                await openArticle(page);
                await page.evaluate(async () => {
                    await ReadingVocabStore.add('retained', 'article', 'Builtin article');
                    window.__beforeUnsupported = __readingAuthority.calls.length;
                    await ReadingVocabReader.open('article', { source: { kind: 'imported', id: 'missing-library' } });
                    ReadingVocabReader.openModal();
                });
                assert.equal(await page.locator('#vocab-manual-input').isEnabled(), false);
                assert.equal(await page.locator('#vocab-manual-add-btn').isEnabled(), false);
                await page.evaluate(() => {
                    document.querySelector('#vocab-manual-input').value = 'not-collected';
                    document.querySelector('#vocab-manual-add-btn').click();
                });
                const state = await page.evaluate(() => ({
                    words: ReadingVocabStore.getAll().map(item => item.word),
                    payload: ReadingVocabReader.currentPayload,
                    writes: __readingAuthority.calls.length - __beforeUnsupported,
                    error: !!document.querySelector('.vocab-error-state'),
                    retainedInput: document.querySelector('#vocab-manual-input').value
                }));
                assert.deepEqual(state, { words: ['retained'], payload: null, writes: 0, error: true, retainedInput: 'not-collected' });
            } finally { await page.close(); }
        });

        await t.test('a failed source load retains the requested library and its recoverable occurrences', async () => {
            const page = await createPage(browser);
            try {
                await openArticle(page);
                const state = await page.evaluate(async () => {
                    const source = { kind: 'builtin', id: 'default' };
                    await ReadingVocabStore.add('retained', 'missing-builtin', 'Missing article', 'retained context', {
                        scopeId: 'passage/p-1', contentVersion: 'legacy-reader-v1',
                        quote: 'retained', text: 'retained', startOffset: 0, endOffset: 8, before: '', after: ' context'
                    }, source);
                    await ReadingVocabReader.open('article', { source: { kind: 'imported', id: 'unavailable-library' } });
                    await __queueOpen('missing-builtin', '__missing', 'missing-builtin.js', { source });
                    __finishScript('missing-builtin.js', 'missing-builtin', { error: true });
                    await __missing;
                    ReadingVocabReader.openModal();
                    return { source: ReadingVocabReader.currentSource,
                        unresolved: document.querySelectorAll('[data-anchor-status="unresolved"]').length,
                        words: ReadingVocabStore.getByExam('missing-builtin', source).map(row => row.word),
                        marks: document.querySelectorAll('mark.vocab-highlight').length };
                });
                assert.deepEqual(state, { source: { kind: 'builtin', id: 'default' }, unresolved: 1, words: ['retained'], marks: 0 });
            } finally { await page.close(); }
        });

        await t.test('exam badges render literal text while generated passage formatting remains intact', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    await __queueOpen('metadata', '__openMetadata');
                    __READING_EXAM_DATA__.register('metadata', {
                        meta: { title: 'Ordinary article', category: '<img src=x onerror="window.__injected=true">', frequency: '&lt;svg&gt; & "quoted"' },
                        passage: { blocks: [{ html: '<p><strong>A</strong> A sufficiently long <em>formatted</em> passage for reading.</p>' }] }
                    });
                    __pendingScripts.shift().onload();
                    await __openMetadata;
                    return {
                        category: document.querySelector('.vocab-badge--cat').textContent,
                        frequency: document.querySelector('.vocab-badge--freq').textContent,
                        unsafeNodes: document.querySelectorAll('#vocab-reader-badges img, #vocab-reader-badges [onerror]').length,
                        formatted: document.querySelector('#vocab-passage-content em').textContent
                    };
                });
                assert.deepEqual(state, { category: '<img src=x onerror="window.__injected=true">', frequency: '&lt;svg&gt; & "quoted"', unsafeNodes: 0, formatted: 'formatted' });
            } finally { await page.close(); }
        });

        await t.test('out-of-order exam success and failure cannot change the latest article or bookshelf', async () => {
            for (const error of [false, true]) {
                const page = await createPage(browser);
                try {
                    const state = await page.evaluate(async error => {
                        await __queueOpen('a', '__openA');
                        await __queueOpen('b', '__openB');
                        __finishScript('b.js', 'b');
                        await __openB;
                        __finishScript('a.js', 'a', { error });
                        await __openA;
                        return {
                            current: ReadingVocabReader.currentExamId, title: ReadingVocabReader.currentExam.title,
                            rendered: document.getElementById('vocab-reader-title').textContent,
                            passage: document.querySelector('#vocab-passage-content em')?.textContent,
                            error: !!document.querySelector('.vocab-error-state'), recorded: __recordedExams,
                            pending: __pendingScripts.map(script => script.src.split('/').pop())
                        };
                    }, error);
                    assert.deepEqual(state, { current: 'b', title: 'b', rendered: 'b', passage: 'b', error: false, recorded: ['b'], pending: ['b-explanation.js'] });
                } finally { await page.close(); }
            }
        });

        await t.test('explanations reset between articles and late translations cannot overwrite the latest article', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    await __queueOpen('a', '__openA');
                    __finishScript('a.js', 'a');
                    await __openA;
                    ReadingVocabReader.currentExplanation = { passageNotes: [{ label: 'Paragraph A', text: 'old cached translation' }] };
                    await __queueOpen('b', '__openB');
                    const cleared = ReadingVocabReader.currentPayload === null && ReadingVocabReader.currentExam?.title !== 'a' && ReadingVocabReader.currentExplanation === null;
                    __finishScript('b.js', 'b');
                    await __openB;
                    const before = document.getElementById('vocab-trans-text-p-1').textContent;
                    __finishScript('b-explanation.js', 'b', { explanation: true, title: 'B translation' });
                    await Promise.resolve();
                    await Promise.resolve();
                    __finishScript('a-explanation.js', 'a', { explanation: true, title: 'A translation' });
                    await Promise.resolve();
                    await Promise.resolve();
                    return { cleared, before, translation: document.getElementById('vocab-trans-text-p-1').textContent, current: ReadingVocabReader.currentExplanation.passageNotes[0].text };
                });
                assert.deepEqual(state, { cleared: true, before: '加载中...', translation: 'B translation', current: 'B translation' });
            } finally { await page.close(); }
        });

        await t.test('delayed selections belong to their opening and a new article resets the visible tab', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    await __queueOpen('a', '__openA');
                    __finishScript('a.js', 'a');
                    await __openA;
                    ReadingVocabReader.switchViewTab('questions');
                    const callbacks = [];
                    const setTimer = window.setTimeout;
                    window.setTimeout = callback => { callbacks.push(callback); return callbacks.length; };
                    const select = selector => {
                        const range = document.createRange();
                        range.selectNodeContents(document.querySelector(selector));
                        window.getSelection().removeAllRanges();
                        window.getSelection().addRange(range);
                    };
                    const queueCapture = () => document.getElementById('vocab-reader-body').dispatchEvent(new MouseEvent('mouseup'));
                    select('#vocab-passage-content em');
                    queueCapture();
                    await __queueOpen('b', '__openB');
                    __finishScript('b.js', 'b');
                    await __openB;
                    select('#vocab-passage-content em');
                    callbacks.shift()();
                    const staleCount = ReadingVocabStore.getAll().length;
                    queueCapture();
                    await callbacks.shift()();
                    const currentWords = ReadingVocabStore.getAll().map(item => ({ word: item.word, examId: item.examId }));
                    select('#vocab-passage-content strong');
                    queueCapture();
                    ReadingVocabReader.close();
                    callbacks.splice(0).forEach(callback => callback());
                    window.setTimeout = setTimer;
                    return {
                        staleCount, currentWords, afterCloseCount: ReadingVocabStore.getAll().length,
                        passageDisplay: document.getElementById('vocab-passage-section').style.display,
                        questionsDisplay: document.getElementById('vocab-questions-section').style.display
                    };
                });
                assert.deepEqual(state, { staleCount: 0, currentWords: [{ word: 'b', examId: 'b' }], afterCloseCount: 1, passageDisplay: 'block', questionsDisplay: 'block' });
            } finally { await page.close(); }
        });

        await t.test('close invalidates pending loads, errors and explanations, including reopening the same exam', async () => {
            for (const error of [false, true]) {
                const page = await createPage(browser);
                try {
                    const state = await page.evaluate(async error => {
                        await __queueOpen('a', '__openA');
                        ReadingVocabReader.openModal();
                        ReadingVocabReader.close();
                        const before = document.getElementById('vocab-passage-content').innerHTML;
                        __finishScript('a.js', 'a', { error });
                        await __openA;
                        return {
                            hidden: document.getElementById('reading-vocab-reader-overlay').classList.contains('is-hidden'),
                            unchanged: before === document.getElementById('vocab-passage-content').innerHTML,
                            recorded: __recordedExams, pending: __pendingScripts.length,
                            modalHidden: document.getElementById('vocab-modal').getAttribute('aria-hidden'),
                            modalActive: document.getElementById('vocab-modal').classList.contains('active')
                        };
                    }, error);
                    assert.deepEqual(state, { hidden: true, unchanged: true, recorded: [], pending: 0, modalHidden: 'true', modalActive: false });
                } finally { await page.close(); }
            }
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    await __queueOpen('a', '__openA');
                    __finishScript('a.js', 'a');
                    await __openA;
                    ReadingVocabReader.close();
                    const before = document.getElementById('vocab-trans-text-p-1').textContent;
                    __finishScript('a-explanation.js', 'a', { explanation: true, title: 'closed translation' });
                    await Promise.resolve();
                    await Promise.resolve();
                    const closedUnchanged = before === document.getElementById('vocab-trans-text-p-1').textContent;
                    __READING_EXAM_DATA__.clear();
                    await __queueOpen('a', '__oldOpen', 'old-a.js');
                    ReadingVocabReader.close();
                    await __queueOpen('a', '__newOpen', 'new-a.js');
                    __finishScript('new-a.js', 'a', { title: 'new article' });
                    await __newOpen;
                    __finishScript('old-a.js', 'a', { title: 'stale article' });
                    await __oldOpen;
                    return { closedUnchanged, title: document.getElementById('vocab-reader-title').textContent, recorded: __recordedExams };
                });
                assert.deepEqual(state, { closedUnchanged: true, title: 'new article', recorded: ['a', 'a'] });
            } finally { await page.close(); }
        });

        await t.test('error messages and retry IDs remain text; retry loads the intended exam', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    const id = "exam');window.__injected=true;//";
                    const scriptName = 'missing-<img src=x onerror=alert(1)>.js';
                    await __queueOpen(id, '__failed', scriptName, { fromPractice: true });
                    const script = __pendingScripts.shift();
                    // Preserve the raw malicious manifest text in the loader's error message.
                    script.onerror();
                    await __failed;
                    const errorText = document.querySelector('.vocab-error-state p').textContent;
                    const unsafeNodes = document.querySelectorAll('.vocab-error-state img, .vocab-error-state [onclick]').length;
                    document.querySelector('.vocab-error-state button').click();
                    for (let step = 0; step < 50 && !__pendingScripts.length; step++) await Promise.resolve();
                    return { errorText, unsafeNodes, current: ReadingVocabReader.currentExamId, retryCount: __pendingScripts.length, injected: !!window.__injected, back: document.querySelector('#vocab-reader-back-btn span').textContent };
                });
                assert.ok(state.errorText.includes('<img src=x onerror=alert(1)>'));
                assert.equal(state.unsafeNodes, 0);
                assert.equal(state.current, "exam');window.__injected=true;//");
                assert.equal(state.retryCount, 1);
                assert.equal(state.injected, false);
                assert.equal(state.back, '返回练习');
            } finally { await page.close(); }
        });
    } finally { await browser.close(); }
});
