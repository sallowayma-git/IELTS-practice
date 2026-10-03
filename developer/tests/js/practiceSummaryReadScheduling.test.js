import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const sources = ['dataCatalog.js', 'dataKernel.js'].map(file => fs.readFileSync(new URL(`../../../js/data/v2/${file}`, import.meta.url), 'utf8'));
function harness({ browser = true, scheduler = true } = {}) {
    let yields = 0;
    const window = { performance: { now: () => 0 },
        setTimeout(callback) { yields++; return setTimeout(callback, 0); } };
    if (browser) window.requestAnimationFrame = () => {};
    if (scheduler) window.scheduler = { async yield() { yields++; await new Promise(resolve => setTimeout(resolve, 0)); } };
    const context = vm.createContext({ window, console });
    for (const source of sources) vm.runInContext(source, context);
    vm.runInContext(`
        const { DataKernel, checksum } = window.__AppDataV2Internals;
        globalThis.rows = Array.from({ length: 301 }, (_, i) => {
            const data = { id: 'row-' + i, title: 'Row ' + i, duration: 20 };
            return { recordId: data.id, revision: 1, operationId: 'seed', updatedAt: '2026-10-02', data, checksum: checksum(data) };
        });
        rows[150].checksum = 'invalid';
        globalThis.kernel = new DataKernel(); kernel.state = 'ready';
        kernel.driver = { listEntities: async () => rows, close() {} };
    `, context);
    return { context, get yields() { return yields; } };
}

test('large summary read yields but only resolves a complete validated detached list', async () => {
    const h = harness();
    let settled = false;
    const pending = vm.runInContext("kernel.listEntities('practiceSummaries')", h.context);
    pending.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(settled, false, 'must not return partial results before validation completes');
    assert.ok(h.yields > 0);
    const result = await pending;
    assert.equal(result.length, 300);
    assert.equal(result[149].id, 'row-149'); assert.equal(result[150].id, 'row-151');
    assert.equal(result.at(-1).id, 'row-300');
    result[0].title = 'Caller mutation';
    assert.equal(vm.runInContext('rows[0].data.title', h.context), 'Row 0');
    assert.equal(vm.runInContext('kernel.state', h.context), 'ready');
});

test('timer fallback and withMeta preserve row metadata and corruption filtering', async () => {
    const h = harness({ scheduler: false });
    const result = await vm.runInContext("kernel.listEntities('practiceSummaries', { withMeta: true })", h.context);
    assert.equal(result.length, 300); assert.ok(h.yields >= 3);
    assert.equal(result[0].revision, 1); assert.equal(result[0].recordId, 'row-0');
    result[0].data.duration = 99;
    assert.equal(vm.runInContext('rows[0].data.duration', h.context), 20);
});

test('non-browser reads keep validation without adding timers', async () => {
    const h = harness({ browser: false });
    const result = await vm.runInContext("kernel.listEntities('practiceSummaries')", h.context);
    assert.equal(result.length, 300); assert.equal(h.yields, 0);
});
