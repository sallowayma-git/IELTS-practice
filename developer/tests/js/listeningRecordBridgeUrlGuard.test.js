#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/listeningRecordBridge.js'), 'utf8');

function createLocation(href) {
    const url = new URL(href);
    return {
        href: url.href,
        origin: url.origin,
        protocol: url.protocol,
        pathname: url.pathname
    };
}

function loadBridge(href, options = {}) {
    const listeners = {};
    const parentWindow = {
        messages: [],
        postMessage(message, targetOrigin) {
            this.messages.push({ message, targetOrigin });
        }
    };
    const document = {
        readyState: 'complete',
        title: 'Listening Test',
        referrer: '',
        body: {},
        documentElement: {},
        scripts: [],
        querySelectorAll() {
            return [];
        },
        querySelector() {
            return null;
        },
        addEventListener() {},
        createElement() {
            return { style: {}, appendChild() {}, remove() {} };
        }
    };
    const window = {
        location: createLocation(href),
        document,
        opener: options.withParent ? parentWindow : null,
        parent: null,
        addEventListener(type, handler) {
            listeners[type] = handler;
        },
        removeEventListener() {}
    };
    window.parent = window;
    const context = {
        URL,
        URLSearchParams,
        window,
        document,
        console: {
            log() {},
            warn() {},
            error() {}
        },
        Date,
        JSON,
        setTimeout() {
            return 1;
        },
        clearTimeout() {},
        setInterval() {
            return 1;
        },
        clearInterval() {},
        isFinite,
        DOMParser: undefined,
        MutationObserver: undefined
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'listeningRecordBridge.js' });
    return { window, parentWindow, listeners };
}

let bridge = loadBridge('http://localhost:3000/ListeningPractice/P2/index.html?examId=listening-custom_01:part.2');
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().examId,
    'listening-custom_01:part.2',
    'safe examId query values should be accepted'
);

bridge = loadBridge('http://localhost:3000/practice.html?examId=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().examId,
    'listening-unknown',
    'unsafe examId query values should be rejected'
);
assert.match(
    bridge.window.__listeningBridgeGetState().sessionId,
    /^listening-unknown_\d+$/,
    'session IDs derived from unsafe exam IDs should use a safe fallback'
);

bridge = loadBridge(`http://localhost:3000/practice.html?examId=${'A'.repeat(121)}`);
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().examId,
    'listening-unknown',
    'oversized examId query values should be rejected'
);

bridge = loadBridge(`http://localhost:3000/practice.html?src=${encodeURIComponent(`/ListeningPractice/${'x'.repeat(2050)}P3/index.html`)}`);
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().examId,
    'listening-unknown',
    'oversized src query values should not be scanned for exam IDs'
);

bridge = loadBridge(`http://localhost:3000/practice.html?src=${encodeURIComponent('/ListeningPractice/P4/index.html')}`);
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().examId,
    'listening-p4',
    'bounded src query values may still infer built-in part IDs'
);

bridge = loadBridge('http://localhost:3000/ListeningPractice/P1/index.html?examId=listening-p1', { withParent: true });
const initialState = bridge.window.__listeningBridgeGetState();
const initialSessionId = initialState.sessionId;
assert.strictEqual(initialState.examId, 'listening-p1');
assert.strictEqual(typeof bridge.listeners.message, 'function', 'bridge should register a message handler');
bridge.listeners.message({
    origin: 'http://localhost:3000',
    source: bridge.parentWindow,
    data: {
        type: 'INIT_SESSION',
        data: {
            examId: '<bad>',
            sessionId: 's'.repeat(200),
            suiteSessionId: 'suite with spaces',
            startTime: Date.now()
        }
    }
});
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().examId,
    'listening-p1',
    'unsafe INIT_SESSION examId values should not replace existing safe state'
);
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().sessionId,
    initialSessionId,
    'oversized INIT_SESSION sessionId values should not replace existing safe state'
);
assert.strictEqual(
    bridge.window.__listeningBridgeGetState().suiteSessionId,
    null,
    'unsafe INIT_SESSION suiteSessionId values should be rejected'
);

console.log('listeningRecordBridgeUrlGuard.test.js passed');
