#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

class FakeNode {
    constructor(type = 'node', text = '') {
        this.type = type;
        this.text = text;
        this.childNodes = [];
        this.parentNode = null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    removeChild(child) {
        const index = this.childNodes.indexOf(child);
        if (index >= 0) {
            this.childNodes.splice(index, 1);
            child.parentNode = null;
        }
        return child;
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }
}

class FakeElement extends FakeNode {
    constructor(tagName) {
        super('element');
        this.tagName = String(tagName).toUpperCase();
        this.className = '';
        this.dataset = {};
        this.style = {};
        this.attributes = new Map();
        this.innerHTMLWrites = [];
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) || null;
    }

    set innerHTML(value) {
        this.innerHTMLWrites.push(String(value));
        throw new Error('innerHTML must not be used by DOMBuilder.replaceContent for strings');
    }
}

function loadDomUtils() {
    const documentStub = {
        addEventListener() {},
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        createTextNode(value) {
            return new FakeNode('text', String(value));
        },
        createDocumentFragment() {
            return new FakeNode('fragment');
        }
    };
    const windowStub = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        getComputedStyle() {
            return {};
        }
    };
    const context = vm.createContext({
        window: windowStub,
        document: documentStub,
        Node: FakeNode,
        console: windowStub.console,
        Map,
        Array,
        Object,
        String,
        requestAnimationFrame(callback) {
            callback();
        }
    });
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/dom.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/utils/dom.js' });
    windowStub.DOM.adapter = windowStub.DOMAdapter;
    windowStub.DOM.window = windowStub;
    return windowStub.DOM;
}

function assertUnsafeAttributesSkipped(element) {
    assert.equal(element.getAttribute('onclick'), null);
    assert.equal(element.getAttribute('onerror'), null);
    assert.equal(element.getAttribute('srcdoc'), null);
    assert.equal(element.getAttribute('href'), null);
    assert.equal(element.getAttribute('formaction'), null);
    assert.equal(element.dataset.safeKey, 'ok');
    assert.equal(Object.prototype.hasOwnProperty.call(element.dataset, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(element.dataset, 'constructor'), false);
    assert.equal(element.style.color, 'red');
    assert.equal(element.style.backgroundImage, undefined);
    assert.equal(element.style.width, undefined);
    assert.equal(element.style.borderImage, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(element.style, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(element.style, 'constructor'), false);
}

function testCreateSkipsUnsafeAttributes() {
    const dom = loadDomUtils();
    const element = dom.create('a', {
        href: 'java\nscript:alert(1)',
        formaction: 'data:text/html,<script>alert(1)</script>',
        onclick: 'alert(1)',
        onerror() {},
        srcdoc: '<script>alert(1)</script>',
        dataset: {
            safeKey: 'ok',
            ['__proto__']: 'polluted'
        },
        style: {
            color: 'red',
            backgroundImage: 'url(java\nscript:alert(1))',
            width: 'expression(alert(1))',
            borderImage: 'url(data:image/svg+xml,<svg onload=alert(1)>)',
            constructor: 'polluted'
        }
    }, 'safe');

    assertUnsafeAttributesSkipped(element);
}

function testAdapterFallbackSkipsUnsafeAttributes() {
    const dom = loadDomUtils();
    const adapter = dom.adapter;
    dom.window.DOM = null;
    const element = adapter.create('a', {
        href: 'vbscript:msgbox(1)',
        formaction: 'javascript:alert(1)',
        onclick: 'alert(1)',
        srcdoc: '<script>alert(1)</script>',
        dataset: {
            safeKey: 'ok',
            constructor: 'polluted'
        },
        style: {
            color: 'red',
            backgroundImage: 'url(vbscript:msgbox(1))',
            width: 'expression(alert(1))',
            borderImage: 'url(data:text/html,<script>alert(1)</script>)',
            ['__proto__']: 'polluted'
        }
    }, 'safe');

    assertUnsafeAttributesSkipped(element);
}

function testReplaceContentTreatsStringsAsText() {
    const dom = loadDomUtils();
    const container = new FakeElement('div');
    dom.replaceContent(container, '<img src=x onerror=alert(1)>');

    assert.equal(container.innerHTMLWrites.length, 0);
    assert.equal(container.childNodes.length, 1);
    assert.equal(container.childNodes[0].type, 'text');
    assert.equal(container.childNodes[0].text, '<img src=x onerror=alert(1)>');
}

function testStyleManagerSkipsUnsafeValues() {
    const dom = loadDomUtils();
    const element = new FakeElement('div');
    dom.setStyle(element, {
        color: 'blue',
        backgroundImage: 'url(java\nscript:alert(1))',
        width: 'expression(alert(1))',
        borderImage: 'url(data:image/svg+xml,<svg onload=alert(1)>)',
        constructor: 'polluted'
    });

    assert.equal(element.style.color, 'blue');
    assert.equal(element.style.backgroundImage, undefined);
    assert.equal(element.style.width, undefined);
    assert.equal(element.style.borderImage, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(element.style, 'constructor'), false);
}

testReplaceContentTreatsStringsAsText();
testCreateSkipsUnsafeAttributes();
testAdapterFallbackSkipsUnsafeAttributes();
testStyleManagerSkipsUnsafeValues();

const domSource = fs.readFileSync(path.join(repoRoot, 'js/utils/dom.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'js/app.js'), 'utf8');
const legacySource = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');
for (const [label, source, functionName] of [
    ['DOMBuilder', domSource, 'isUnsafeStyleValue'],
    ['App fallback', appSource, 'isAppUnsafeStyleValue'],
    ['Legacy view', legacySource, 'isLegacyUnsafeStyleValue']
]) {
    assert(source.includes(functionName), `${label} must expose CSS style value filtering`);
    assert(source.includes('javascript:'), `${label} must reject javascript CSS URLs`);
    assert(source.includes('vbscript:'), `${label} must reject vbscript CSS URLs`);
    assert(source.includes('expression('), `${label} must reject legacy CSS expressions`);
    assert(source.includes('data:image/svg+xml'), `${label} must reject SVG data CSS URLs`);
}

console.log(JSON.stringify({
    status: 'pass',
    detail: 'DOMBuilder string and attribute guard tests passed'
}, null, 2));
