#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'runtime', 'readingHighlightShared.js'), 'utf8');

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.className = '';
        this.parentNode = null;
        this.parentElement = null;
    }

    appendChild(node) {
        if (node.parentNode?.children) {
            const oldIndex = node.parentNode.children.indexOf(node);
            if (oldIndex >= 0) {
                node.parentNode.children.splice(oldIndex, 1);
            }
        }
        node.parentNode = this;
        node.parentElement = node instanceof FakeElement ? this : this;
        this.children.push(node);
        return node;
    }

    insertBefore(node, referenceNode) {
        node.parentNode = this;
        node.parentElement = node instanceof FakeElement ? this : this;
        const index = this.children.indexOf(referenceNode);
        if (index >= 0) {
            this.children.splice(index, 0, node);
        } else {
            this.children.push(node);
        }
        return node;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    matches() {
        return false;
    }

    closest() {
        return null;
    }

    querySelectorAll() {
        return [];
    }
}

class FakeTextNode {
    constructor(text, parent) {
        this.nodeValue = text;
        this.textContent = text;
        this.parentNode = parent;
        this.parentElement = parent;
    }

    splitText(offset) {
        const before = this.nodeValue.slice(0, offset);
        const after = this.nodeValue.slice(offset);
        this.nodeValue = before;
        this.textContent = before;
        const next = new FakeTextNode(after, this.parentNode);
        const siblings = this.parentNode?.children;
        const index = Array.isArray(siblings) ? siblings.indexOf(this) : -1;
        if (index >= 0) {
            siblings.splice(index + 1, 0, next);
        }
        return next;
    }
}

function loadReadingHighlightShared(text = 'target text') {
    const root = new FakeElement('div');
    const textNode = new FakeTextNode(text, root);
    root.children.push(textNode);
    root.__textNodes = [textNode];

    const context = {
        console,
        Element: FakeElement,
        HTMLElement: FakeElement,
        NodeFilter: {
            SHOW_TEXT: 4,
            FILTER_ACCEPT: 1,
            FILTER_REJECT: 2
        },
        document: {
            createElement(tagName) {
                return new FakeElement(tagName);
            },
            createTreeWalker(treeRoot) {
                const nodes = Array.isArray(treeRoot.__textNodes) ? treeRoot.__textNodes.slice() : [];
                let index = 0;
                return {
                    nextNode() {
                        return nodes[index++] || null;
                    }
                };
            },
            createRange() {
                return {
                    setStart() {},
                    setEnd() {}
                };
            }
        }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'readingHighlightShared.js' });
    return { api: context.__READING_HIGHLIGHT_SHARED__, root };
}

test('wrapTextMatches drops unsafe highlight class tokens and attributes', () => {
    const { api, root } = loadReadingHighlightShared('target text');
    const [highlight] = api.wrapTextMatches(root, 'target', {
        className: 'safe-token onclick=bad another_token !bad',
        attrs: {
            'data-question-id': 'q1',
            title: 'A'.repeat(300),
            onclick: 'alert(1)',
            style: 'background:url(javascript:alert(1))',
            href: 'javascript:alert(1)',
            '__proto__': 'pollute'
        }
    });

    assert(highlight, 'expected a highlight span');
    assert.equal(highlight.className, 'safe-token another_token');
    assert.equal(highlight.attributes.get('data-question-id'), 'q1');
    assert.equal(highlight.attributes.get('title').length, 256);
    assert.equal(highlight.attributes.has('onclick'), false);
    assert.equal(highlight.attributes.has('style'), false);
    assert.equal(highlight.attributes.has('href'), false);
    assert.equal(highlight.attributes.has('__proto__'), false);
});
