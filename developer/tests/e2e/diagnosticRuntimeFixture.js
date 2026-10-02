import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const runtimeRoot = path.resolve(process.env.DIAGNOSTIC_RUNTIME_ROOT || checkout);
export const reportRoot = path.resolve(process.env.DIAGNOSTIC_REPORT_DIR || path.join(checkout, 'developer/tests/e2e/reports'));

// Only disposable copies are faulted. Release callers supply a fresh extraction;
// this helper has no fallback to the checkout when a runtime asset is missing.
export async function runtimeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-diagnostic-acceptance-'));
    for (const item of ['index.html', 'css', 'js/bundles', 'assets/vendor', 'assets/images', 'assets/generated/diagnostics']) {
        fs.mkdirSync(path.dirname(path.join(root, item)), { recursive: true });
        fs.cpSync(path.join(runtimeRoot, item), path.join(root, item), { recursive: true });
    }
    const server = http.createServer((request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/app\//, '/');
            const file = path.resolve(root, '.' + pathname);
            if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
            const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
            const body = fs.readFileSync(file);
            response.writeHead(200, { 'Content-Type': type[path.extname(file)] || 'application/octet-stream' });
            response.end(body);
        } catch (_) { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    return {
        root,
        modes: [['file', pathToFileURL(root + path.sep).href], ['http', origin + '/'], ['subpath', origin + '/app/']],
        async close() {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
            assert.ok(path.basename(root).startsWith('ielts-diagnostic-acceptance-'));
            fs.rmSync(root, { recursive: true, force: true });
        }
    };
}
