import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync(new URL('../../../js/presentation/app-actions.js', import.meta.url), 'utf8');
function harness(saveData = false) {
    const buttons = new Map(['practice', 'browse', 'more'].map(view => [view, {
        handlers: new Map(), addEventListener(name, fn) { this.handlers.set(name, fn); }
    }]));
    const hints = [];
    const loads = [];
    const document = { readyState: 'complete',
        querySelector(selector) {
            const view = /data-view="(\w+)"/.exec(selector)?.[1];
            return buttons.get(view) || null;
        }, getElementById() { return null; }, addEventListener() {} };
    const window = { document, navigator: { connection: { saveData } },
        addEventListener() {}, AppLazyLoader: {
            preloadGroup(name) { hints.push(name); },
            ensureGroup(name) { loads.push(name); return Promise.resolve(); }
        } };
    vm.runInNewContext(source, { window, document, console, setTimeout, clearTimeout });
    return { window, buttons, hints, loads };
}
test('hover and keyboard focus fetch navigation modules without executing them', () => {
    const h = harness();
    for (const button of h.buttons.values()) {
        button.handlers.get('pointerenter')(); button.handlers.get('focus')();
    }
    assert.deepEqual(h.loads, []);
    assert.deepEqual(h.hints, ['practice-suite', 'practice-suite', 'browse-runtime', 'browse-runtime', 'more-tools', 'more-tools']);
});
test('save-data skips speculative navigation transfers', () => {
    const h = harness(true);
    h.buttons.get('browse').handlers.get('focus')();
    assert.deepEqual(h.hints, []); assert.deepEqual(h.loads, []);
});
test('explicit ready APIs still execute requested modules', async () => {
    const h = harness();
    await h.window.AppActions.preloadBrowseView();
    await h.window.AppActions.ensurePracticeSuite();
    assert.deepEqual(h.loads, ['browse-runtime', 'practice-suite']);
});
