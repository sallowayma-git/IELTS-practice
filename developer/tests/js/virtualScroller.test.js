import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const virtualSource = fs.readFileSync(path.join(root, 'js/components/virtualScroller.js'), 'utf8');

test('shared virtual scroller keeps constructor identity on repeated group loads', () => {
    const window = {};
    const context = vm.createContext({ window });
    vm.runInContext(virtualSource, context);
    const original = window.VirtualScroller;
    vm.runInContext(virtualSource, context);
    assert.equal(window.VirtualScroller, original);
    const optimizerSource = fs.readFileSync(path.join(root, 'js/components/PerformanceOptimizer.js'), 'utf8');
    vm.runInContext(optimizerSource, context);
    assert.equal(window.VirtualScroller, original);
    let called = false;
    window.VirtualScroller = class { constructor() { called = true; } };
    window.PerformanceOptimizer.prototype.createVirtualScroller({}, [], () => {}, {});
    assert.equal(called, true);
});

test('history virtual grid bounds 5000 rows, reaches last selection, shrinks filters and cleans up', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<div id="history" style="width:100%;"></div>');
        await page.addScriptTag({ content: virtualSource });
        await page.addScriptTag({ path: path.join(root, 'js/views/legacyViewBundle.js') });
        for (const width of [1200, 600]) {
            await page.setViewportSize({ width, height: 900 });
            const result = await page.evaluate(async () => {
                const container = document.getElementById('history');
                const records = Array.from({ length: 5000 }, (_, i) => ({
                    id: `history-${i}`, title: `Record ${i}`, duration: 600,
                    date: '2026-01-01T00:00:00.000Z', percentage: 80
                }));
                const params = { container, records, bulkDeleteMode: true,
                    selectedRecords: new Set(['history-4999']),
                    scrollerOptions: { itemHeight: 100, containerHeight: 650 } };
                const scroller = PracticeHistoryRenderer.renderView(params).scroller;
                const initialCount = container.querySelectorAll('.history-item').length;
                const columns = scroller.itemsPerRow;
                scroller.scrollToIndex(4999);
                const last = container.querySelector('[data-record-id="history-4999"]');
                const lastVisible = Boolean(last && last.getBoundingClientRect().bottom <= container.getBoundingClientRect().bottom + 1);
                const lastSelected = Boolean(last?.querySelector('input').checked);
                const lastCount = container.querySelectorAll('.history-item').length;
                scroller.scrollToIndex(0);
                scroller.scrollToIndex(4999);
                const selectionAfterRecreate = container.querySelector('[data-record-id="history-4999"] input').checked;
                PracticeHistoryRenderer.renderView({ ...params, scroller,
                    records: records.slice(0, 3), selectedRecords: new Set(['history-2']) });
                const filteredCount = container.querySelectorAll('.history-item').length;
                const filteredSelected = Boolean(container.querySelector('[data-record-id="history-2"] input')?.checked);
                const filteredScrollTop = container.scrollTop;
                container.dispatchEvent(new Event('scroll'));
                const timerPending = scroller.scrollTimer !== null;
                scroller.destroy();
                await new Promise(resolve => setTimeout(resolve, 30));
                const cleanup = container.childElementCount === 0 && scroller.scrollTimer === null;
                scroller.destroy();
                scroller.recalculate();
                return { initialCount, lastCount, columns, lastVisible, lastSelected,
                    selectionAfterRecreate, filteredCount, filteredSelected, filteredScrollTop, timerPending, cleanup };
            });
            assert.equal(result.columns, width > 768 ? 2 : 1);
            assert.ok(result.initialCount > 0 && result.initialCount < 80, JSON.stringify(result));
            assert.ok(result.lastCount > 0 && result.lastCount < 80);
            assert.equal(result.lastVisible, true);
            assert.equal(result.lastSelected, true);
            assert.equal(result.selectionAfterRecreate, true);
            assert.equal(result.filteredCount, 3);
            assert.equal(result.filteredSelected, true);
            assert.equal(result.filteredScrollTop, 0);
            assert.equal(result.timerPending, true);
            assert.equal(result.cleanup, true);
        }
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
