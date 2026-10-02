// Real-browser verification of fetch-only hints, execution order, and transfer reuse.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const sourcePath = 'js/runtime/lazyLoader.js';
const latency = 180;
const results = [];
for (const mode of ['baseline', 'cold', 'intent']) {
    const baseline = mode === 'baseline';
    const loader = baseline ? execFileSync('git', ['show', `HEAD:${sourcePath}`], { encoding: 'utf8' }) : fs.readFileSync(sourcePath, 'utf8');
    const requests = [];
    const server = http.createServer((req, res) => {
        const name = new URL(req.url, 'http://localhost').pathname;
        if (name === '/fixture/loader.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(loader);
        if (name === '/fixture/first.js' || name === '/fixture/second.js') {
            requests.push({ name, time: performance.now() });
            return setTimeout(() => res.writeHead(200, {
                'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600'
            }).end(`window.execution.push(${JSON.stringify(name)});`), latency);
        }
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><script>window.execution=[];</script><script src="loader.js"></script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/fixture/index.html?v=perf`);
        await page.evaluate(() => AppLazyLoader.registerGroup('network-test', ['first.js', 'second.js']));
        if (mode === 'intent') {
            assert.equal(await page.evaluate(() => AppLazyLoader.preloadGroup('network-test')), 2);
            await page.waitForFunction(() => performance.getEntriesByType('resource').filter(r => /\/(first|second)\.js/.test(r.name)).length === 2);
            assert.deepEqual(await page.evaluate(() => execution), [], 'preloading must not execute modules');
        }
        const start = performance.now();
        await page.evaluate(() => AppLazyLoader.ensureGroup('network-test'));
        const loadMs = performance.now() - start;
        assert.deepEqual(await page.evaluate(() => execution), ['/fixture/first.js', '/fixture/second.js']);
        assert.equal(requests.length, 2, 'preload and injection must share cached transfers');
        const requestGapMs = requests[1].time - requests[0].time;
        if (!baseline) assert.ok(requestGapMs < latency / 2, `downloads serialized: ${requestGapMs}ms`);
        results.push({ mode, latencyMs: latency, requests: requests.length,
            requestGapMs: Math.round(requestGapMs), ensureGroupMs: Math.round(loadMs) });
    } finally {
        await browser.close(); await new Promise(resolve => server.close(resolve));
    }
}
console.log(JSON.stringify(results, null, 2));
