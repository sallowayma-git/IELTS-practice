import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { requiredDiagnosticAssets, verifyDiagnosticRuntime } from '../../../scripts/verify-diagnostic-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('release gate validates emitted runtime and rejects missing wrapper, stale build and shifted mappings', t => {
    assert.ok(verifyDiagnosticRuntime(root).mappedSections > 100);
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-release-contract-'));
    t.after(() => {
        assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
        fs.rmSync(fixture, { recursive: true, force: true });
    });
    for (const file of requiredDiagnosticAssets) {
        fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
        fs.copyFileSync(path.join(root, file), path.join(fixture, file));
    }
    const wrapper = 'assets/generated/listening-exams/listening-practice-unified.html';
    fs.unlinkSync(path.join(fixture, wrapper));
    assert.throws(() => verifyDiagnosticRuntime(fixture), /ENOENT/);
    fs.copyFileSync(path.join(root, wrapper), path.join(fixture, wrapper));
    const bundle = path.join(fixture, 'js/bundles/listening-wrapper.bundle.js');
    const original = fs.readFileSync(bundle, 'utf8');
    fs.writeFileSync(bundle, original.replace(/"buildId":"sha256:[a-f0-9]{64}"/, '"buildId":"stale"'));
    assert.throws(() => verifyDiagnosticRuntime(fixture), /wrong build/);
    fs.writeFileSync(bundle, '\n' + original);
    assert.throws(() => verifyDiagnosticRuntime(fixture), /shifted mapping/);
});
