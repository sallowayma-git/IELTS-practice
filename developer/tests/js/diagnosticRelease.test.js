import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { requiredDiagnosticAssets, verifyDiagnosticRuntime } from '../../../scripts/verify-diagnostic-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('release gate rejects missing runtime, stale builds and incomplete or shifted mappings', t => {
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
    for (const asset of ['assets/generated/listening-exams/listening-practice-unified.html',
        ...['vocabulary', 'reading-tools', 'reading-library', 'dictionary'].map(name => `js/bundles/${name}.bundle.js`)]) {
        fs.unlinkSync(path.join(fixture, asset));
        assert.throws(() => verifyDiagnosticRuntime(fixture), /ENOENT/, asset);
        fs.copyFileSync(path.join(root, asset), path.join(fixture, asset));
    }
    const bundle = path.join(fixture, 'js/bundles/listening-wrapper.bundle.js');
    const original = fs.readFileSync(bundle, 'utf8');
    fs.writeFileSync(bundle, original.replace(/"buildId":"sha256:[a-f0-9]{64}"/, '"buildId":"stale"'));
    assert.throws(() => verifyDiagnosticRuntime(fixture), /wrong build/);
    fs.writeFileSync(bundle, '\n' + original);
    assert.throws(() => verifyDiagnosticRuntime(fixture), /shifted mapping/);
    fs.writeFileSync(bundle, original);
    const manifestFile = path.join(fixture, 'assets/generated/diagnostics/build-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    for (const file of requiredDiagnosticAssets.filter(file => /\.(js|html)$/.test(file))) {
        const changed = structuredClone(manifest);
        delete changed.mappings[file];
        fs.writeFileSync(manifestFile, JSON.stringify(changed));
        assert.throws(() => verifyDiagnosticRuntime(fixture), /missing source mappings/, file);
    }
    const changed = structuredClone(manifest);
    changed.mappings['js/bundles/listening-wrapper.bundle.js'].pop();
    fs.writeFileSync(manifestFile, JSON.stringify(changed));
    assert.throws(() => verifyDiagnosticRuntime(fixture), /incomplete source mappings/);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.ok(verifyDiagnosticRuntime(fixture).mappedSections > 100);
});
