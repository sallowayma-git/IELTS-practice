import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../../js/runtime/dictionaryLoader.js', import.meta.url), 'utf8');
function harness() {
    const scripts = [];
    const window = {};
    const document = {
        currentScript: { src: 'https://example.test/sub/js/bundles/reading-page.bundle.js?v=42' },
        baseURI: 'https://example.test/sub/assets/generated/reading-exams/page.html',
        head: { appendChild(script) { scripts.push(script); } },
        createElement() { return { remove() { this.removed = true; } }; }
    };
    vm.runInNewContext(source, { window, document, URL, Promise, Error });
    return { window, scripts };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test('dictionary remains unloaded until requested, shares concurrent requests, and resolves nested URLs', async () => {
    const { window, scripts } = harness();
    assert.equal(scripts.length, 0);
    const first = window.ensureReadingDictionary();
    const second = window.ensureReadingDictionary();
    assert.equal(first, second);
    assert.equal(scripts[0].src, 'https://example.test/sub/assets/wordlists/ielts_core.bundle.js?v=42');
    window.__EMBEDDED_WORDLISTS__ = { ielts_core: [] }; scripts[0].onload(); await tick();
    window.__LOCAL_DICTIONARIES__ = { ecdict: {} }; scripts[1].onload(); await tick();
    window.DictionaryService = { lookup() {} }; scripts[2].onload();
    assert.equal(await first, window.DictionaryService);
    await window.ensureReadingDictionary();
    assert.equal(scripts.length, 3);
});
test('failed dictionary requests can retry without fetching an already loaded wordlist', async () => {
    const { window, scripts } = harness();
    const first = window.ensureReadingDictionary();
    window.__EMBEDDED_WORDLISTS__ = { ielts_core: [] }; scripts[0].onload(); await tick();
    scripts[1].onerror();
    await assert.rejects(first, /词典加载失败/);
    assert.equal(scripts[1].removed, true);
    const retry = window.ensureReadingDictionary(); await tick();
    assert.match(scripts[2].src, /ecdict_reading/);
    window.__LOCAL_DICTIONARIES__ = { ecdict: {} }; scripts[2].onload(); await tick();
    window.DictionaryService = {}; scripts[3].onload(); await retry;
    assert.equal(scripts.filter(script => script.src.includes('ielts_core')).length, 1);
});
