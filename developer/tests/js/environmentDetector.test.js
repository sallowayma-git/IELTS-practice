import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/environmentDetector.js'), 'utf8');

function loadDetector({ search = '', hash = '', force = false } = {}) {
    const windowStub = {
        location: { search, hash },
        navigator: {
            userAgent: 'Mozilla/5.0 HeadlessChrome/140.0 Playwright'
        },
        __IELTS_FORCE_TEST_ENV__: force
    };
    vm.runInContext(source, vm.createContext({
        window: windowStub,
        globalThis: windowStub
    }), { filename: 'js/utils/environmentDetector.js' });
    return windowStub.EnvironmentDetector;
}

assert.strictEqual(
    loadDetector().isInTestEnvironment(),
    false,
    'automation user agents must run production synthetic-session policy by default'
);
assert.strictEqual(
    loadDetector({ search: '?test_env=1' }).isInTestEnvironment(),
    true,
    'explicit test_env query remains an opt-in'
);
assert.strictEqual(
    loadDetector({ force: true }).isInTestEnvironment(),
    true,
    'explicit runtime test flag remains an opt-in'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'test environment activation is explicit and not inferred from automation UA'
}));
