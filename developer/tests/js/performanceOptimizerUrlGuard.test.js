#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/components/PerformanceOptimizer.js'), 'utf8');

const context = {
    URL,
    console: {
        log() {},
        warn() {},
        error() {}
    },
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) {
        return setTimeout(callback, 0);
    },
    cancelAnimationFrame(id) {
        clearTimeout(id);
    },
    performance: {
        now() {
            return 0;
        }
    },
    document: {
        baseURI: 'http://localhost:3000/index.html',
        createElement() {
            return { style: {}, appendChild() {}, remove() {} };
        }
    },
    window: {
        location: {
            href: 'http://localhost:3000/index.html',
            origin: 'http://localhost:3000',
            protocol: 'http:'
        },
        addEventListener() {},
        removeEventListener() {}
    }
};
context.window.window = context.window;
context.window.document = context.document;
context.window.performance = context.performance;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'PerformanceOptimizer.js' });

const resolveTrustedImagePreloadUrl = context.resolveTrustedImagePreloadUrl;
assert.strictEqual(typeof resolveTrustedImagePreloadUrl, 'function', 'resolver should be available');

assert.strictEqual(
    resolveTrustedImagePreloadUrl('/assets/example.png'),
    'http://localhost:3000/assets/example.png',
    'same-origin image paths should be accepted'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('https://example.test/image.png'),
    '',
    'cross-origin image URLs should be rejected'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('javascript:alert(1)'),
    '',
    'javascript URLs should be rejected'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('data:image/png;base64,QUJD'),
    'data:image/png;base64,QUJD',
    'valid base64 image data URLs should be accepted'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    '',
    'SVG data URLs should be rejected'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('data:text/html;base64,PGltZyBzcmM9eCBvbmVycm9yPWFsZXJ0KDEpPg=='),
    '',
    'HTML data URLs should be rejected'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('data:image/png;base64,QUJD<script>'),
    '',
    'image data URLs with non-base64 suffixes should be rejected'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl('data:image/png;base64,'),
    '',
    'empty data image payloads should be rejected'
);
assert.strictEqual(
    resolveTrustedImagePreloadUrl(`data:image/png;base64,${'A'.repeat(1024 * 1024)}`),
    '',
    'oversized data image payloads should be rejected'
);

console.log('performanceOptimizerUrlGuard.test.js passed');
