import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

export function harness({ early = false, install = true } = {}) {
    const listeners = new Map();
    const output = [];
    const nodes = [];
    function element(tagName) {
        const events = new Map();
        const node = { tagName, style: {}, children: [], attributes: {},
            appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
            removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; },
            setAttribute(key, value) { this.attributes[key] = value; },
            getAttribute(key) { return this.attributes[key] || this[key] || null; },
            addEventListener(type, fn) { events.set(type, fn); },
            emit(type) { return events.get(type)?.({ target: this }); },
            focus() { this.focused = true; }, select() { this.selected = true; },
            click() { this.emit('click'); }
        };
        nodes.push(node);
        return node;
    }
    const document = { baseURI: 'https://private.internal/app/index.html?token=secret', readyState: early ? 'loading' : 'complete',
        createElement: element, head: element('head'), body: early ? null : element('body'),
        querySelectorAll() { return []; },
        getElementById(id) { return nodes.find((node) => node.id === id) || null; },
        addEventListener(type, fn, options) { add('document:' + type, fn, options); }
    };
    function add(type, fn, options) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push({ fn, options });
    }
    const sandbox = { document, URL, URLSearchParams, Blob, DOMException, setTimeout, clearTimeout,
        console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace'].map((method) =>
            [method, (...args) => output.push({ method, args })])),
        location: { protocol: 'https:', pathname: '/app/index.html', origin: 'https://private.internal', search: '?token=secret' },
        addEventListener: add,
        AppDiagnosticBuild: { appVersion: '0.6.3', buildId: 'sha256:' + '1'.repeat(64) }
    };
    sandbox.window = sandbox;
    const realm = vm.createContext(sandbox);
    const run = (file) => vm.runInContext(read(file), realm, { filename: file });
    run('js/diagnostics/diagnosticContract.js');
    run('js/diagnostics/bootstrapCollector.js');
    let collector;
    if (install) collector = sandbox.AppDiagnosticBootstrap.install({ context: 'main', requiredResources: ['js/bundles/core-foundation.bundle.js'] });
    return { sandbox, document, nodes, listeners, output, realm, run, collector, element,
        emit(type, event = {}) { for (const { fn } of listeners.get(type) || []) fn(event); },
        evaluate(source) { return vm.runInContext(source, realm); }
    };
}
