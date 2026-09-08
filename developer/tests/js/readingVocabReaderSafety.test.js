import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readerSource = fs.readFileSync(path.join(repoRoot, 'js/components/readingVocabReader.js'), 'utf8');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

async function createPage(browser, { localWords = [], canonicalWords, canonicalResult } = {}) {
    const page = await browser.newPage();
    await page.route('https://reader.test/**', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>'
    }));
    await page.goto('https://reader.test/');
    await page.evaluate(({ localWords, canonicalWords, canonicalResult }) => {
        localStorage.setItem('ielts_reading_vocab_words_v1', JSON.stringify(localWords));
        window.__savedWords = [];
        if (canonicalWords !== undefined || canonicalResult !== undefined) {
            window.AppData = {
                ready: Promise.resolve(),
                vocab: {
                    listReadingWords: async options => options?.withMeta && canonicalResult !== undefined
                        ? canonicalResult : (canonicalWords ?? canonicalResult.data),
                    saveReadingWords: async words => window.__savedWords.push(words)
                }
            };
        }
        window.__recordedExams = [];
        window.ReadingBookshelfStore = { recordExamUsed: id => window.__recordedExams.push(id) };
        window.__spokenWords = [];
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        Object.defineProperty(window, 'speechSynthesis', {
            value: { cancel() {}, speak: utterance => window.__spokenWords.push(utterance.text) }
        });
        window.__READING_EXAM_MANIFEST__ = {};
        window.__READING_EXPLANATION_MANIFEST__ = {};
        window.__pendingScripts = [];
        const appendChild = document.head.appendChild.bind(document.head);
        document.head.appendChild = node => {
            if (node.tagName === 'SCRIPT' && node.src) {
                window.__pendingScripts.push(node);
                return node;
            }
            return appendChild(node);
        };
        window.__queueOpen = (id, key = id, script = `${id}.js`, options = {}) => {
            window.__READING_EXAM_MANIFEST__[id] = { examId: id, script };
            window.__READING_EXPLANATION_MANIFEST__[id] = { examId: id, script: `${id}-explanation.js` };
            window[key] = window.ReadingVocabReader.open(id, options);
        };
        window.__finishScript = (scriptName, id, { error = false, explanation = false, title = id } = {}) => {
            const index = window.__pendingScripts.findIndex(script => script.src.endsWith(`/${scriptName}`));
            if (index < 0) throw new Error(`Missing pending script: ${scriptName}`);
            const [script] = window.__pendingScripts.splice(index, 1);
            if (error) {
                script.onerror();
                return;
            }
            if (explanation) {
                window.__READING_EXPLANATION_DATA__.register(id, {
                    passageNotes: [{ label: 'Paragraph A', text: title }]
                });
            } else {
                window.__READING_EXAM_DATA__.register(id, {
                    meta: { title },
                    passage: { blocks: [{ html: `<div class="paragraph-wrapper"><p><strong>A</strong> This is the <em>${title}</em> passage with enough text for reading.</p></div>` }] },
                    questionGroups: [{ bodyHtml: `<p>Questions for ${title}</p>` }]
                });
            }
            script.onload();
        };
    }, { localWords, canonicalWords, canonicalResult });
    await page.addScriptTag({ content: readerSource });
    return page;
}

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
                examTitle: 'Ordinary exam', examId: 'exam-a'
            }, {
                id: "alternate-'\"-id", word: '&lt;svg onload=alert(1)&gt;',
                context: '&#34; & < >', examTitle: 'Title &amp; literal', examId: 'exam-a'
            }];
            for (const source of ['local', 'canonical']) {
                const page = await createPage(browser, source === 'local'
                    ? { localWords: attacks } : { canonicalWords: attacks });
                try {
                    const state = await page.evaluate(async () => {
                        await ReadingVocabStore.init();
                        ReadingVocabReader.modalTab = 'all';
                        ReadingVocabReader.openModal();
                        const list = document.getElementById('vocab-list');
                        return {
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
                    assert.equal(state.unsafeNodes, 0, `${source} vocabulary must remain inert text`);
                    assert.deepEqual(state.rows, attacks.map(item => ({
                        id: item.id, word: item.word, speak: item.word, deleteId: item.id,
                        context: `"${item.context}"`, title: item.examTitle
                    })));
                    await page.locator('.vocab-speak-btn').first().click();
                    assert.deepEqual(await page.evaluate(() => window.__spokenWords), [attacks[0].word]);
                    await page.locator('.vocab-delete-btn').first().click();
                    assert.deepEqual(await page.evaluate(() => ReadingVocabStore.getAll().map(item => item.id)), attacks.slice(1).map(item => item.id));
                    assert.equal(await page.evaluate(() => !!window.__injected), false);
                } finally { await page.close(); }
            }
        });

        await t.test('canonical empty and smaller vocab lists replace stale local mirrors without saving them back', async () => {
            const localWords = [{ id: 'old', word: 'stale' }, { id: 'new', word: 'current' }];
            for (const canonicalWords of [[], [localWords[1]]]) {
                const page = await createPage(browser, { localWords, canonicalResult: { data: canonicalWords, envelope: { revision: 2 } } });
                try {
                    const state = await page.evaluate(async () => {
                        await ReadingVocabStore.init();
                        return { words: ReadingVocabStore.getAll(), local: JSON.parse(localStorage.getItem('ielts_reading_vocab_words_v1')), saves: window.__savedWords };
                    });
                    assert.deepEqual(state, { words: canonicalWords, local: canonicalWords, saves: [] });
                } finally { await page.close(); }
            }
        });

        await t.test('absent canonical metadata preserves the only local copy when migration has failed', async () => {
            const localWords = [{ id: 'legacy', word: 'preserved' }];
            const page = await createPage(browser, { localWords, canonicalResult: { data: [], envelope: null } });
            try {
                const state = await page.evaluate(async () => {
                    await ReadingVocabStore.init();
                    return { words: ReadingVocabStore.getAll(), local: JSON.parse(localStorage.getItem('ielts_reading_vocab_words_v1')), saves: window.__savedWords };
                });
                assert.deepEqual(state, { words: localWords, local: localWords, saves: [] });
            } finally { await page.close(); }
        });

        await t.test('exam badges render literal text while generated passage formatting remains intact', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    __queueOpen('metadata', '__openMetadata');
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
                        __queueOpen('a', '__openA');
                        __queueOpen('b', '__openB');
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
                    __queueOpen('a', '__openA');
                    __finishScript('a.js', 'a');
                    await __openA;
                    ReadingVocabReader.currentExplanation = { passageNotes: [{ label: 'Paragraph A', text: 'old cached translation' }] };
                    __queueOpen('b', '__openB');
                    const cleared = ReadingVocabReader.currentPayload === null && ReadingVocabReader.currentExam === null && ReadingVocabReader.currentExplanation === null;
                    __finishScript('b.js', 'b');
                    await __openB;
                    const before = document.getElementById('vocab-trans-text-A').textContent;
                    __finishScript('b-explanation.js', 'b', { explanation: true, title: 'B translation' });
                    await Promise.resolve();
                    await Promise.resolve();
                    __finishScript('a-explanation.js', 'a', { explanation: true, title: 'A translation' });
                    await Promise.resolve();
                    await Promise.resolve();
                    return { cleared, before, translation: document.getElementById('vocab-trans-text-A').textContent, current: ReadingVocabReader.currentExplanation.passageNotes[0].text };
                });
                assert.deepEqual(state, { cleared: true, before: '加载中...', translation: 'B translation', current: 'B translation' });
            } finally { await page.close(); }
        });

        await t.test('delayed selections belong to their opening and a new article resets the visible tab', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    __queueOpen('a', '__openA');
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
                    __queueOpen('b', '__openB');
                    __finishScript('b.js', 'b');
                    await __openB;
                    select('#vocab-passage-content em');
                    callbacks.shift()();
                    const staleCount = ReadingVocabStore.getAll().length;
                    queueCapture();
                    callbacks.shift()();
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
                        __queueOpen('a', '__openA');
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
                    __queueOpen('a', '__openA');
                    __finishScript('a.js', 'a');
                    await __openA;
                    ReadingVocabReader.close();
                    const before = document.getElementById('vocab-trans-text-A').textContent;
                    __finishScript('a-explanation.js', 'a', { explanation: true, title: 'closed translation' });
                    await Promise.resolve();
                    await Promise.resolve();
                    const closedUnchanged = before === document.getElementById('vocab-trans-text-A').textContent;
                    __READING_EXAM_DATA__.clear();
                    __queueOpen('a', '__oldOpen', 'old-a.js');
                    ReadingVocabReader.close();
                    __queueOpen('a', '__newOpen', 'new-a.js');
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
                    __queueOpen(id, '__failed', scriptName, { fromPractice: true });
                    const script = __pendingScripts.shift();
                    // Preserve the raw malicious manifest text in the loader's error message.
                    script.onerror();
                    await __failed;
                    const errorText = document.querySelector('.vocab-error-state p').textContent;
                    const unsafeNodes = document.querySelectorAll('.vocab-error-state img, .vocab-error-state [onclick]').length;
                    document.querySelector('.vocab-error-state button').click();
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
