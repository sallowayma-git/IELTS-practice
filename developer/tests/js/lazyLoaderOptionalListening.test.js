#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/runtime/lazyLoader.js'), 'utf8');

const requestedScripts = [];
const head = {
    appendChild(script) {
        script.parentNode = head;
        requestedScripts.push(String(script.src || ''));
        queueMicrotask(() => script.onerror?.({ message: '404' }));
        return script;
    },
    removeChild(script) {
        script.parentNode = null;
        return script;
    }
};
const documentStub = {
    baseURI: 'https://example.test/app/index.html',
    head,
    querySelectorAll() { return []; },
    createElement(tagName) {
        assert.strictEqual(tagName, 'script');
        return { src: '', async: false, onload: null, onerror: null, parentNode: null };
    }
};
const quietConsole = {
    log() {},
    warn() {},
    error() {}
};
const windowStub = {
    document: documentStub,
    console: quietConsole,
    location: {
        origin: 'https://example.test',
        search: '',
        href: 'https://example.test/app/index.html'
    }
};
const sandbox = {
    window: windowStub,
    document: documentStub,
    console: quietConsole,
    URL,
    URLSearchParams,
    Promise,
    Set,
    queueMicrotask
};
sandbox.globalThis = windowStub;
vm.runInContext(source, vm.createContext(sandbox), { filename: 'js/runtime/lazyLoader.js' });

windowStub.AppLazyLoader.markProvided(['assets/generated/reading-exams/manifest.js']);
await windowStub.AppLazyLoader.ensureGroup('exam-data');
await windowStub.AppLazyLoader.ensureGroup('exam-data');
await Promise.all([
    windowStub.AppLazyLoader.ensureGroup('exam-data'),
    windowStub.AppLazyLoader.ensureGroup('exam-data')
]);

const manifestRequests = requestedScripts.filter((url) => url.includes('assets/generated/listening-exams/manifest.js'));
assert.strictEqual(manifestRequests.length, 1, '缺失的可选听力 manifest 在同一页面生命周期内只应探测一次');
assert.strictEqual(
    windowStub.__defaultListeningLibraryAvailabilityReason,
    'manifest-missing',
    '缺失 manifest 应稳定记录为不可用，而不是反复回到 pending'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'optional listening manifest failure is cached',
    manifestRequests: manifestRequests.length
}, null, 2));
