#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/core/resourceCore.js'), 'utf8');

let fetchCount = 0;
const windowStub = {
    location: {
        href: 'http://127.0.0.1:3000/',
        origin: 'http://127.0.0.1:3000',
        protocol: 'http:'
    },
    LibraryDiscovery: {
        resolveRuntimeResource() {
            return 'chrome-extension://example-extension/paper.html';
        }
    }
};

const context = vm.createContext({
    window: windowStub,
    localStorage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    },
    fetch() {
        fetchCount += 1;
        throw new Error('unexpected fetch');
    },
    console: {
        warn() {},
        error() {},
        log() {}
    }
});

vm.runInContext(source, context, { filename: 'js/core/resourceCore.js' });

const result = await windowStub.ResourceCore.resolveResource({ type: 'reading' }, 'html');
assert.equal(result.url, '');
assert.equal(fetchCount, 0, 'untrusted special-protocol URLs must be rejected before probing');

assert(
    source.includes('function resolveProbeBypassUrl') &&
    source.includes("currentProtocol === 'file:'") &&
    source.includes("protocol === currentProtocol") &&
    source.includes("['app:', 'chrome-extension:', 'capacitor:', 'ionic:'].includes(protocol)") &&
    source.includes('return Boolean(resolveProbeBypassUrl(url))'),
    'resource probe bypass must be limited to the current local/container protocol'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'resource core probe bypass guard passed'
}, null, 2));
