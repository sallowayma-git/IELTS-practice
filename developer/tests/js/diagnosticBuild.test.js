import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiagnosticArtifacts } from '../../../scripts/diagnostic-build.mjs';
import { harness, read } from './helpers/diagnosticHarness.js';

function inputs() {
    const manifest = JSON.parse(read('assets/generated/diagnostics/build-manifest.json'));
    const bundleInputs = Object.fromEntries(Object.entries(manifest.mappings)
        .filter(([path]) => path.startsWith('js/bundles/')).map(([path, entries]) => [path, entries.map((entry) => entry.source)]));
    const renderedBundles = Object.fromEntries(Object.keys(bundleInputs).map((path) =>
        [path, read(path).replace(/^globalThis.AppDiagnosticBuild = [^\n]+\n/, '')]));
    const readSource = (path) => read(path).replace(/\r\n?/g, '\n').split('\n')
        .map((line) => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\s*$/, '\n');
    return { renderedBundles, bundleInputs, readSource };
}

test('identical build inputs reproduce the ID, inline hook, stamped bundles and private-path-free mapping', () => {
    const options = inputs();
    const first = buildDiagnosticArtifacts(options);
    const second = buildDiagnosticArtifacts(options);
    assert.deepEqual(first, second);
    for (const [file, content] of Object.entries({ ...first.generated, ...first.bundles })) assert.equal(read(file), content, file);
    const manifest = JSON.parse(first.generated['assets/generated/diagnostics/build-manifest.json']);
    for (const input of manifest.inputs) {
        assert.match(input.sha256, /^[a-f0-9]{64}$/);
        assert.doesNotMatch(input.path, /^(?:[a-z]:|\/|file:|https?:)/i);
    }
    for (const [bundle, entries] of Object.entries(manifest.mappings)) {
        const lines = (first.bundles[bundle] || first.generated[bundle]).split('\n');
        for (const entry of entries) {
            const original = options.readSource(entry.source).trimEnd().split('\n');
            assert.equal(lines[entry.startLine - 1], original[0], `${bundle} -> ${entry.source}:1`);
            assert.equal(lines[entry.endLine - 1], original.at(-1), `${bundle} -> ${entry.source}:end`);
            assert.equal(entry.sourceStartLine, 1);
            assert.doesNotMatch(entry.source, /^(?:[a-z]:|\/|file:|https?:)/i);
        }
    }
});

test('every emitted bundle retains its resource path and stack coordinates in diagnostics', () => {
    const manifest = JSON.parse(read('assets/generated/diagnostics/build-manifest.json'));
    const normalizer = harness({ install: false }).sandbox.AppDiagnosticContract.createNormalizer();
    for (const asset of Object.keys(manifest.mappings).filter(file => file.startsWith('js/bundles/'))) {
        const url = `https://private.invalid/app/${asset}?token=PRIVATE_TOKEN#PRIVATE_FRAGMENT`;
        const event = normalizer.normalize({ code: 'RESOURCE_LOAD_FAILED', resource: { url },
            error: { name: 'Error', stack: `Error\n    at load (${url}:123:7)` } });
        assert.equal(event.resource.path, asset);
        assert.equal(event.error.stack[0].path, asset);
        assert.equal(event.error.stack[0].line, 123);
        assert.equal(event.error.stack[0].column, 7);
        assert.doesNotMatch(JSON.stringify(event), /private\.invalid|PRIVATE_TOKEN|PRIVATE_FRAGMENT/);
    }
});

test('relevant emitted code, entry, style and build recipe changes alter the build ID', () => {
    const options = inputs();
    const first = buildDiagnosticArtifacts(options).metadata.buildId;
    const bundlePath = 'js/bundles/core-foundation.bundle.js';
    const changed = { ...options.renderedBundles, [bundlePath]: options.renderedBundles[bundlePath] + '\n// changed artifact\n' };
    assert.notEqual(buildDiagnosticArtifacts({ ...options, renderedBundles: changed }).metadata.buildId, first);
    for (const source of ['index.html', 'assets/generated/reading-exams/reading-practice-unified.html',
        'css/main.css', 'css/incident-center.css', 'scripts/diagnostic-build.mjs']) {
        assert.notEqual(buildDiagnosticArtifacts({ ...options, readSource(file) {
            return options.readSource(file) + (file === source ? '\n/* relevant change */\n' : '');
        } }).metadata.buildId, first, source);
    }
    const regenerated = buildDiagnosticArtifacts(options);
    assert.equal(buildDiagnosticArtifacts({ ...options, readSource(file) {
        return file === 'index.html' ? regenerated.generated[file] : options.readSource(file);
    } }).metadata.buildId, first, 'embedding the generated block cannot feed identity back into itself');
});

test('generated hook supports each practice context before its external dependencies', () => {
    const generated = buildDiagnosticArtifacts(inputs());
    const payload = generated.generated['assets/generated/diagnostics/bootstrap-inline.js'];
    assert.ok(payload.includes('function defineDiagnosticBootstrap'));
    assert.equal(/<\/script/i.test(payload), false);
    assert.equal(payload.includes('AppDiagnosticBootstrap.install('), false, 'entry generator chooses context and resources');
});

test('every diagnostic-bearing bundle independently supplies build provenance to exports', async () => {
    const options = inputs();
    const generated = buildDiagnosticArtifacts(options);
    const manifest = JSON.parse(generated.generated['assets/generated/diagnostics/build-manifest.json']);
    for (const [bundle, sources] of Object.entries(options.bundleInputs)) {
        if (!sources.includes('js/diagnostics/diagnosticExport.js')) continue;
        const h = harness({ install: false });
        delete h.sandbox.AppDiagnosticBuild;
        const lines = generated.bundles[bundle].split('\n');
        const contract = manifest.mappings[bundle].find((entry) => entry.source === 'js/diagnostics/diagnosticContract.js');
        h.evaluate(lines.slice(0, contract.endLine).join('\n'));
        h.run('js/diagnostics/diagnosticExport.js');
        const report = await h.sandbox.AppDiagnosticExport.snapshot();
        assert.equal(report.appVersion, generated.metadata.appVersion, bundle);
        assert.equal(report.buildId, generated.metadata.buildId, bundle);
        assert.equal(h.sandbox.AppDiagnosticBuild.mappingPath, 'assets/generated/diagnostics/build-manifest.json', bundle);
    }
});
