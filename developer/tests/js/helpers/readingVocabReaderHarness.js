import fs from 'node:fs';

const source = name => fs.readFileSync(new URL(`../../../../js/${name}`, import.meta.url), 'utf8');
const modelSource = source('data/v2/readingVocabularyModel.js');
const contentSource = source('components/readingVocabContent.js');
const anchorsSource = source('components/readingVocabAnchors.js');
const readerSource = source('components/readingVocabReader.js');

export async function installReadingAuthority(page, { localWords = [], canonicalWords = [], authority = 'ready' } = {}) {
    await page.addScriptTag({ content: modelSource });
    await page.addScriptTag({ content: contentSource });
    await page.addScriptTag({ content: anchorsSource });
    await page.evaluate(({ localWords, canonicalWords, authority }) => {
        localStorage.setItem('ielts_reading_vocab_words_v1', JSON.stringify(localWords));
        const model = window.ReadingVocabularyModel;
        let snapshot = model.createSnapshot();
        for (const item of canonicalWords) {
            snapshot = model.collect(snapshot, {
                source: item.source || { kind: 'builtin', id: 'default' },
                article: { examId: item.examId || 'exam-a', title: item.examTitle || '' },
                word: { ...(item.id ? { id: item.id } : {}), word: item.word, meaning: 'Fixture definition', example: item.context || '' },
                at: '2026-09-08T01:00:00.000Z'
            });
        }
        const state = window.__readingAuthority = {
            snapshot, revision: 1, generation: 1, calls: [], reads: 0,
            fault: null, defer: false, pending: []
        };
        const result = () => structuredClone({ snapshot: state.snapshot, revision: state.revision, generation: state.generation });
        if (authority !== 'missing') {
            window.AppData = {
                ready: Promise.resolve(),
                library: { getActive: async () => null },
                vocab: {
                    readingModel: model,
                    getReadingSnapshot: async () => {
                        state.reads += 1;
                        if (authority === 'failed') throw new Error('Reading authority unavailable');
                        return result();
                    },
                    mutateReading: async (type, command, options) => {
                        state.calls.push(structuredClone({ type, command, options }));
                        if (state.defer) await new Promise((resolve, reject) => state.pending.push({ resolve, reject }));
                        if (state.fault) throw new Error(state.fault);
                        if (type === 'removeTermAssociations') {
                            for (const association of state.snapshot.reading.associations.filter(row => row.termId === command.termId)) {
                                state.snapshot = model.removeArticleTerm(state.snapshot, association);
                            }
                        } else if (type === 'clearReading') {
                            for (const article of state.snapshot.reading.articles) {
                                state.snapshot = model.clearArticle(state.snapshot, { articleId: article.id });
                            }
                        } else {
                            state.snapshot = model[type](state.snapshot, command);
                        }
                        if (type === 'collect') state.snapshot = model.recordVisit(state.snapshot, command);
                        if (type === 'recordVisit' || type === 'collect') window.__recordedExams.push(command.article.examId);
                        state.revision += 1;
                        return { ...result(), saved: true, added: true, changed: true,
                            revisions: { 'vocab.readingState': state.revision } };
                    }
                }
            };
        }
        window.__recordedExams = [];
    }, { localWords, canonicalWords, authority });
}

// Only persistence acknowledgement is mocked. Relationship updates, projection,
// range capture and DOM rendering all execute the production implementations.
export async function createPage(browser, { localWords = [], canonicalWords = [], authority = 'ready' } = {}) {
    const page = await browser.newPage();
    await page.route('https://reader.test/**', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>'
    }));
    await page.goto('https://reader.test/');
    await installReadingAuthority(page, { localWords, canonicalWords, authority });
    await page.evaluate(() => {
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
        window.__queueOpen = async (id, key = id, script = `${id}.js`, options = {}) => {
            window.__READING_EXAM_MANIFEST__[id] = { examId: id, script };
            window.__READING_EXPLANATION_MANIFEST__[id] = { examId: id, script: `${id}-explanation.js` };
            window[key] = window.ReadingVocabReader.open(id, options);
            for (let step = 0; step < 50; step += 1) {
                if (window.__pendingScripts.some(node => node.src.endsWith(`/${script}`))) return;
                await Promise.resolve();
            }
        };
        window.__finishScript = (scriptName, id, { error = false, explanation = false, title = id } = {}) => {
            const index = window.__pendingScripts.findIndex(script => script.src.endsWith(`/${scriptName}`));
            if (index < 0) throw new Error(`Missing pending script: ${scriptName}`);
            const [script] = window.__pendingScripts.splice(index, 1);
            if (error) return script.onerror();
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
        window.__selectText = (selector, word, occurrence = 0) => {
            const root = document.querySelector(selector);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                let position = -1;
                while ((position = node.textContent.indexOf(word, position + 1)) >= 0) {
                    if (occurrence-- > 0) continue;
                    const range = document.createRange();
                    range.setStart(node, position);
                    range.setEnd(node, position + word.length);
                    window.getSelection().removeAllRanges();
                    window.getSelection().addRange(range);
                    return;
                }
            }
            throw new Error(`Missing selection: ${word}`);
        };
    });
    await page.addScriptTag({ content: readerSource });
    return page;
}

export async function openArticle(page, id = 'article', title = id, options = {}) {
    await page.evaluate(async ({ id, title, options }) => {
        await ReadingVocabStore.init();
        await __queueOpen(id, '__open', `${id}.js`, options);
        __finishScript(`${id}.js`, id, { title });
        await __open;
    }, { id, title, options });
}
