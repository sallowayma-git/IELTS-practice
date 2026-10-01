import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredDiagnosticAssets = [
    'index.html', 'css/main.css', 'css/incident-center.css',
    'assets/generated/diagnostics/bootstrap-inline.js', 'assets/generated/diagnostics/build-manifest.json',
    'assets/generated/reading-exams/reading-practice-unified.html',
    'assets/generated/listening-exams/listening-practice-unified.html',
    ...['runtime-entry', 'core-foundation', 'ui-shell', 'legacy-app', 'browse', 'diagnostics', 'practice',
        'session', 'reading-page', 'practice-page-enhancer', 'listening-record-bridge', 'listening-wrapper',
        'vocabulary', 'reading-tools', 'reading-library', 'dictionary', 'more', 'theme']
        .map(name => `js/bundles/${name}.bundle.js`)
];

export function verifyDiagnosticRuntime(root) {
    const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
    for (const file of requiredDiagnosticAssets) assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
    const manifest = JSON.parse(read('assets/generated/diagnostics/build-manifest.json'));
    assert.match(manifest.buildId, /^sha256:[a-f0-9]{64}$/);
    for (const file of requiredDiagnosticAssets.filter(file => /\.(js|html)$/.test(file))) {
        assert.ok(Array.isArray(manifest.mappings?.[file]) && manifest.mappings[file].length,
            `${file}: missing source mappings`);
    }
    const inline = read('assets/generated/diagnostics/bootstrap-inline.js').trim();
    for (const entry of requiredDiagnosticAssets.filter(file => file.endsWith('.html'))) {
        const html = read(entry);
        assert.ok(html.includes(inline), `${entry}: early collector drift`);
        assert.ok(html.indexOf(inline) < html.search(/<script\b[^>]*\bsrc=/i), `${entry}: collector must precede dependencies`);
        assert.ok(html.includes(manifest.buildId), `${entry}: wrong build`);
    }
    let mappedSections = 0;
    for (const [bundle, mappings] of Object.entries(manifest.mappings)) {
        assert.ok(requiredDiagnosticAssets.includes(bundle) || bundle === 'templates/template_base.html');
        // Templates are generation inputs, never runtime release dependencies.
        if (bundle === 'templates/template_base.html' && !fs.existsSync(path.join(root, bundle))) continue;
        const source = read(bundle);
        const lines = source.split('\n');
        const markers = [...source.matchAll(/^\/\* ===== ((?:js|assets)\/[a-zA-Z0-9_./-]+) ===== \*\/$/gm)]
            .map(match => match[1]);
        assert.deepEqual(mappings.map(entry => entry.source), markers, `${bundle}: incomplete source mappings`);
        if (mappings.some(entry => /\/(diagnosticExport|bootstrapCollector)\.js$/.test(entry.source))) {
            assert.ok(source.includes(`"buildId":"${manifest.buildId}"`), `${bundle}: wrong build`);
        }
        for (const entry of mappings) {
            assert.match(entry.source, /^(js|assets)\/[a-zA-Z0-9_./-]+$/);
            assert.ok(!entry.source.includes('..'));
            assert.equal(lines[entry.startLine - 2], `/* ===== ${entry.source} ===== */`, `${bundle}: shifted mapping`);
            assert.ok(Number.isInteger(entry.startLine) && Number.isInteger(entry.endLine)
                && entry.endLine >= entry.startLine && entry.endLine <= lines.length);
            assert.equal(entry.sourceStartLine, 1);
            mappedSections++;
        }
    }
    assert.ok(read('js/bundles/ui-shell.bundle.js').includes('defineDiagnosticSettings'), 'settings prerequisite missing');
    for (const name of ['reading-page', 'practice-page-enhancer', 'listening-record-bridge', 'listening-wrapper']) {
        const bundle = read(`js/bundles/${name}.bundle.js`);
        for (const source of ['diagnosticExport', 'diagnosticChannel', 'operationDiagnostics']) {
            assert.ok(bundle.includes(`/* ===== js/diagnostics/${source}.js ===== */`), `${name}: missing ${source}`);
        }
    }
    return { buildId: manifest.buildId, requiredAssets: requiredDiagnosticAssets.length, mappedSections };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(JSON.stringify(verifyDiagnosticRuntime(path.resolve(process.argv[2] || '.'))));
}
