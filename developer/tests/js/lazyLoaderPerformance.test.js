#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../../js/runtime/lazyLoader.js', import.meta.url), 'utf8');

function harness(base = 'https://example.test/app/index.html?v=42', supported = true) {
    const location = new URL(base);
    const links = [];
    const scripts = [];
    const head = {
        appendChild(node) {
            node.parentNode = head;
            (node.tagName === 'link' ? links : scripts).push(node);
            return node;
        },
        removeChild(node) { node.parentNode = null; }
    };
    const document = {
        baseURI: base,
        head,
        querySelectorAll() { return scripts.filter(node => node.parentNode); },
        createElement(tagName) {
            return {
                tagName, relList: { supports: () => supported },
                getAttribute(name) { return this[name]; }
            };
        }
    };
    const window = { document, location, console: { warn() {}, error() {} } };
    vm.runInNewContext(source, { window, document, URL, URLSearchParams, Set, Promise, console: window.console });
    return { loader: window.AppLazyLoader, links, scripts, head };
}

async function flush() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

test('dependency downloads are hinted together while practice executes before browse', async () => {
    const h = harness();
    const pending = h.loader.ensureGroup('browse-runtime');
    assert.deepEqual(h.links.map(node => node.href), [
        'https://example.test/app/js/bundles/practice.bundle.js?v=42',
        'https://example.test/app/js/bundles/browse.bundle.js?v=42'
    ]);
    assert.equal(h.scripts.length, 0, 'hints cannot execute modules');
    await flush();
    assert.equal(h.scripts.length, 1);
    assert.match(h.scripts[0].src, /practice\.bundle/);
    h.scripts[0].onload();
    await flush();
    assert.equal(h.scripts.length, 2);
    assert.match(h.scripts[1].src, /browse\.bundle/);
    h.scripts[1].onload();
    await pending;
    assert.equal(h.loader.getStatus('browse-view').loaded, true);
    assert.equal(h.loader.preloadGroup('browse-view'), 0, 'alias does not duplicate hints');
});

test('preloadGroup is fetch-only, deduplicates dependencies, and skips provided resources', () => {
    const h = harness();
    h.loader.markProvided(['js/bundles/practice.bundle.js']);
    assert.equal(h.loader.preloadGroup('session-suite'), 2);
    assert.equal(h.scripts.length, 0);
    assert.equal(h.loader.getStatus('session-suite').loaded, false);
    assert.equal(h.loader.preloadGroup('session-suite'), 0);
});

test('file packages and engines without preload support retain ordered script injection', async () => {
    for (const h of [harness('file:///Applications/app/index.html?v=42'), harness(undefined, false)]) {
        h.loader.registerGroup('ordered', ['first.js', 'second.js']);
        const pending = h.loader.ensureGroup('ordered');
        await flush();
        assert.equal(h.links.length, 0);
        assert.equal(h.scripts.length, 1);
        h.scripts[0].onload();
        await flush();
        assert.equal(h.scripts.length, 2);
        h.scripts[1].onload();
        await pending;
    }
});

test('equivalent versioned URLs share a single in-flight request', async () => {
    const h = harness();
    h.loader.registerGroup('relative', ['shared.js']);
    h.loader.registerGroup('absolute', ['https://example.test/app/shared.js?v=42']);
    const pending = Promise.all([h.loader.ensureGroup('relative'), h.loader.ensureGroup('absolute')]);
    await flush();
    assert.equal(h.scripts.length, 1);
    assert.equal(h.links.length, 1);
    let settled = false;
    pending.then(() => { settled = true; });
    await flush();
    assert.equal(settled, false, 'an existing loading script cannot count as loaded');
    h.scripts[0].onload();
    await pending;
});

test('shared resource failure rejects all callers and retry injects a fresh script', async () => {
    const h = harness();
    h.loader.registerGroup('relative', ['shared.js']);
    h.loader.registerGroup('absolute', ['https://example.test/app/shared.js?v=42']);
    const pending = Promise.allSettled([h.loader.ensureGroup('relative'), h.loader.ensureGroup('absolute')]);
    await flush();
    h.scripts[0].onerror();
    assert.deepEqual((await pending).map(result => result.status), ['rejected', 'rejected']);
    const retry = h.loader.ensureGroup('absolute');
    await flush();
    assert.equal(h.scripts.length, 2);
    h.scripts[1].onload();
    await retry;
});

test('synchronous insertion failure leaves resource retryable', async () => {
    const h = harness('file:///Applications/app/index.html');
    const append = h.head.appendChild;
    h.head.appendChild = () => { throw new Error('DOM insertion unavailable'); };
    await assert.rejects(h.loader.ensureGroup('theme-tools'));
    h.head.appendChild = append;
    const retry = h.loader.ensureGroup('theme-tools');
    await flush();
    assert.equal(h.scripts.length, 1);
    h.scripts[0].onload();
    await retry;
});
