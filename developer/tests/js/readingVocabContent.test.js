import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const contentSource = fs.readFileSync(new URL('../../../js/components/readingVocabContent.js', import.meta.url), 'utf8');
const ids = ['p1-high-216', 'p2-high-192', 'p2-low-051', 'p1-high-101', 'p1-high-171', 'p1-high-229', 'p2-low-08'];
const assets = ids.map(id => {
    let payload;
    const global = { __READING_EXAM_DATA__: { register: (_key, value) => { payload = value; } } };
    vm.runInNewContext(fs.readFileSync(new URL(`../../../assets/generated/reading-exams/${id}.js`, import.meta.url), 'utf8'), {
        window: global, globalThis: global
    });
    return { id, payload };
});

test('passage normalization retains production content and assigns structural identities', async t => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage();
    await page.addScriptTag({ content: contentSource });
    try {
        await t.test('all seven regression assets retain every prose paragraph in source order', async () => {
            const results = await page.evaluate(assets => assets.map(({ id, payload }) => {
                const data = ReadingVocabContent.normalizePassage(payload.passage, payload.meta.title);
                const source = document.createElement('div');
                source.innerHTML = payload.passage.blocks.map(block => block.bodyHtml || block.html || '').join('\n');
                const rendered = document.createElement('div');
                rendered.innerHTML = data.blocks.map(block => block.html).join('\n');
                const expectedParagraphs = [...source.querySelectorAll('p')].map(node => node.textContent.trim())
                    .filter(text => text && !/^You should spend\b/.test(text));
                const allContent = document.createElement('div');
                allContent.innerHTML = data.subtitleHtml + rendered.innerHTML;
                return {
                    id, blockCount: data.blocks.length, ids: data.blocks.map(block => block.id),
                    expectedParagraphs,
                    actualParagraphs: [...allContent.querySelectorAll('p')].map(node => node.textContent.trim()).filter(Boolean),
                    labels: data.blocks.map(block => block.letter),
                    explicitLabels: data.blocks.map(block => block.explicitLabel),
                    instruction: data.instructionHtml, subtitle: data.subtitleHtml,
                    title: data.passageTitle,
                    stable: JSON.stringify(data) === JSON.stringify(ReadingVocabContent.normalizePassage(payload.passage, payload.meta.title))
                };
            }), assets);
            for (const result of results) {
                assert.ok(result.blockCount > 0, result.id);
                assert.deepEqual(result.actualParagraphs, result.expectedParagraphs, `${result.id} keeps all paragraphs in source order`);
                assert.equal(new Set(result.ids).size, result.ids.length, `${result.id} identities are unique`);
                assert.ok(result.ids.every(id => /^p-\d+$/.test(id)), result.id);
                assert.ok(result.stable, `${result.id} normalization is deterministic`);
                assert.match(result.instruction, /You should spend about 20 minutes/, result.id);
            }
            for (const id of ['p1-high-101', 'p1-high-171', 'p1-high-229']) {
                assert.ok(results.find(result => result.id === id).explicitLabels.every(value => !value), `${id} ordinary A sentences are not labels`);
            }
            assert.deepEqual(results.find(result => result.id === 'p2-high-192').labels, 'ABCDEFGHI'.split(''));
            assert.deepEqual(results.find(result => result.id === 'p2-low-051').labels, 'ABCDEFGH'.split(''));
            const petri = results.find(result => result.id === 'p2-low-08');
            assert.match(petri.subtitle, /<h5>A simple piece of scientific equipment/);
            assert.match(petri.instruction, /Questions 14–29/);
            assert.equal(petri.title, 'How the Petri dish supports scientific advances');
        });

        await t.test('mixed multi-block sources preserve wrappers, short prose, headings, lists, tables and figures', async () => {
            const result = await page.evaluate(() => {
                const passage = { blocks: [
                    { html: '<h3>Ordered source</h3><p><em>Opening subtitle</em></p><p>First.</p>' },
                    { bodyHtml: '<div class="paragraph-wrapper"><p><strong>A</strong> Wrapped first.</p><p>Wrapped second.</p></div>', html: '<p>Wrong precedence.</p>' },
                    { html: '<p>A normal sentence begins here.</p><h4>Interior heading</h4><p>After heading.</p><ul><li>List entry</li></ul>' },
                    { bodyHtml: '<table><tbody><tr><td>Table cell</td></tr></tbody></table><figure><img alt="Diagram" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><figcaption>Figure caption</figcaption></figure><h5>Final heading</h5>' }
                ] };
                const data = ReadingVocabContent.normalizePassage(passage);
                const root = document.createElement('div');
                root.innerHTML = data.blocks.map(block => block.html).join('\n');
                return {
                    text: root.textContent,
                    paragraphs: [...root.querySelectorAll('p')].map(node => node.textContent),
                    headings: [...root.querySelectorAll('h4, h5')].map(node => node.textContent),
                    structures: ['ul li', 'table td', 'figure img', 'figcaption'].map(selector => !!root.querySelector(selector)),
                    wrappers: data.blocks.filter(block => /Wrapped first/.test(block.html)).map(block => block.text),
                    ids: data.blocks.map(block => block.id),
                    ordinarySentenceExplicit: data.blocks.find(block => /A normal sentence/.test(block.html)).explicitLabel
                };
            });
            assert.deepEqual(result.paragraphs, ['First.', 'A Wrapped first.', 'Wrapped second.', 'A normal sentence begins here.', 'After heading.']);
            assert.deepEqual(result.headings, ['Interior heading', 'Final heading']);
            assert.deepEqual(result.structures, [true, true, true, true]);
            assert.deepEqual(result.wrappers, ['A Wrapped first.Wrapped second.']);
            assert.equal(result.ordinarySentenceExplicit, false);
            assert.equal(new Set(result.ids).size, result.ids.length);
            assert.doesNotMatch(result.text, /Wrong precedence/);
            const markers = ['First.', 'Wrapped first.', 'Wrapped second.', 'A normal sentence', 'Interior heading', 'After heading.', 'List entry', 'Table cell', 'Figure caption', 'Final heading'];
            assert.deepEqual(markers.map(marker => result.text.indexOf(marker)), markers.map(marker => result.text.indexOf(marker)).sort((a, b) => a - b));
        });

        await t.test('repeated labels and source IDs never become internal paragraph IDs', async () => {
            const result = await page.evaluate(() => ReadingVocabContent.normalizePassage({ blocks: [{ html: `
                <h3>Duplicate source labels</h3><p id="same"><strong>A</strong> First labelled paragraph.</p>
                <p id="same"><strong>A</strong> Second labelled paragraph.</p>
                <h4>B</h4><p>Third paragraph.</p><p>Continued third paragraph.</p>` }] }));
            assert.deepEqual(result.blocks.map(block => block.id), ['p-1', 'p-2', 'p-3']);
            assert.deepEqual(result.blocks.map(block => block.letter), ['A', 'A', 'B']);
            assert.equal(result.blocks[2].text, 'Third paragraph.Continued third paragraph.');
        });

        await t.test('a heading-only or image-only final source block remains visible', async () => {
            const result = await page.evaluate(() => {
                const data = ReadingVocabContent.normalizePassage({ blocks: [
                    { html: '<h3>Title</h3><p>Short.</p>' },
                    { bodyHtml: '<img alt="Last illustration" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' },
                    { html: '<h6>Closing note</h6>' }
                ] });
                return { count: data.blocks.length, html: data.blocks.map(block => block.html).join('') };
            });
            assert.equal(result.count, 3);
            assert.match(result.html, /<p>Short\.<\/p>.*Last illustration.*<h6>Closing note<\/h6>/);
        });
    } finally {
        await page.close();
        await browser.close();
    }
});
