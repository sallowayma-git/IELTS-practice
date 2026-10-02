import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../../../js/presentation/emojiIconizer.js', import.meta.url), 'utf8');

function element(name = 'DIV', children = [], classes = []) {
    const node = { nodeType: 1, nodeName: name, children,
        classList: { contains: value => classes.includes(value) },
        appendChild(child) { this.children.push(child); child.parentNode = this; },
        setAttribute() {},
        replaceChild(fragment, child) {
            const index = this.children.indexOf(child);
            assert(index >= 0);
            this.children.splice(index, 1, ...fragment.children);
            fragment.children.forEach(node => { node.parentNode = this; });
            child.parentNode = null;
            child.isConnected = false;
        }
    };
    children.forEach(child => { child.parentNode = node; });
    return node;
}
function text(value = '📚 Book') { return { nodeType: 3, nodeValue: value }; }
function harness(body = element(), idle = true) {
    const callbacks = [];
    let notify;
    let replacements = 0;
    let walkers = 0;
    const document = { body, readyState: 'complete',
        createElement(name) { replacements += name === 'span' ? 1 : 0; return element(name); },
        createDocumentFragment() { return element('FRAGMENT'); },
        createTextNode: text,
        createTreeWalker(root, mask, filter) {
            walkers += 1;
            assert.equal(mask, 5);
            const nodes = [];
            function visit(node) {
                const accepted = filter.acceptNode(node);
                if (accepted === 2) return;
                if (accepted === 1) nodes.push(node);
                (node.children || []).forEach(visit);
            }
            (root.children || []).forEach(visit);
            let index = 0;
            return { nextNode: () => nodes[index++] || null };
        }
    };
    class MutationObserver {
        constructor(callback) { notify = callback; }
        observe() {}
        disconnect() {}
    }
    const window = { MutationObserver, performance: { now: () => 0 }, setTimeout(callback) { callbacks.push(callback); } };
    if (idle) window.requestIdleCallback = callback => callbacks.push(callback);
    vm.runInNewContext(source, { window, document, MutationObserver, Set });
    return { api: window.EmojiIconizer, document, callbacks, notify: records => notify(records),
        replacements: () => replacements, walkers: () => walkers,
        drain() {
            let count = 0;
            while (callbacks.length) {
                assert(++count < 100, 'work must terminate');
                callbacks.shift()();
            }
        }
    };
}

test('bootstrap defers cosmetic work and processes large subtrees in bounded slices', () => {
    const h = harness(element('BODY', Array.from({ length: 400 }, () => text())));
    assert.equal(h.replacements(), 0);
    assert.equal(h.callbacks.length, 1);
    h.callbacks.shift()();
    assert(h.replacements() > 0 && h.replacements() < 150);
    assert.equal(h.callbacks.length, 1);
    h.drain();
    assert.equal(h.replacements(), 400);
});

test('mutation bursts coalesce roots and prune code, SVG and generated icon subtrees', () => {
    const h = harness();
    h.drain();
    const child = element('SPAN', [text()]);
    const root = element('DIV', [child, element('CODE', [text()]), element('svg', [text()]),
        element('SPAN', [text()], ['ui-emoji-icon'])]);
    h.document.body.appendChild(root);
    const before = h.walkers();
    h.notify([{ type: 'childList', addedNodes: [child, root, root] }]);
    assert.equal(h.replacements(), 0);
    assert.equal(h.callbacks.length, 1);
    h.drain();
    assert.equal(h.replacements(), 1);
    assert.equal(h.walkers() - before, 1, 'nested added roots are scanned once');
});

test('character changes coalesce and explicit refresh remains synchronous', () => {
    const h = harness();
    h.drain();
    const node = text();
    h.document.body.appendChild(node);
    h.notify([{ type: 'characterData', target: node }, { type: 'characterData', target: node }]);
    assert.equal(h.replacements(), 0);
    h.drain();
    assert.equal(h.replacements(), 1);
    const root = element('DIV', [text()]);
    h.api.refresh(root);
    assert.equal(h.replacements(), 2);
});

test('editable content, detached roots and generated icon mutations are ignored', () => {
    const h = harness();
    h.drain();
    const editor = element('DIV', [text()]);
    editor.isContentEditable = true;
    const detached = element('DIV', [text()]);
    detached.isConnected = false;
    const icon = element('SPAN', [text()], ['ui-emoji-icon']);
    h.notify([{ type: 'childList', addedNodes: [editor, detached, icon] },
        { type: 'characterData', target: editor.children[0] }]);
    h.drain();
    assert.equal(h.replacements(), 0);
});

test('timer fallback batches work and disconnect cancels queued mutation processing', () => {
    const h = harness(element('BODY', [text()]), false);
    assert.equal(h.callbacks.length, 1);
    h.api.disconnect();
    h.drain();
    assert.equal(h.replacements(), 0);
});
