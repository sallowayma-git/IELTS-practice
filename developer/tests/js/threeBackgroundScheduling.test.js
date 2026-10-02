import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../../../js/presentation/threeBackground.js', import.meta.url), 'utf8');
function harness({ theme = 'floral-bloom', reducedMotion = false, hidden = false, readyState = 'complete', getPreference = async () => theme } = {}) {
    const frames = new Map();
    const timers = new Map();
    const listeners = new Map();
    const motionListeners = new Map();
    const windowListeners = new Map();
    let frameId = 0;
    let renders = 0;
    let disposed = 0;
    let created = 0;
    const preferencesSaved = [];
    const attributes = new Map();
    const motion = { matches: reducedMotion,
        addEventListener: (name, fn) => motionListeners.set(name, fn),
        removeEventListener: name => motionListeners.delete(name) };
    const document = { readyState, hidden,
        body: { classList: { add() {}, remove() {} }, setAttribute(name, value) { attributes.set(name, value); }, prepend(node) { node.parentNode = this; } },
        querySelector: () => null, getElementById: () => null,
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name) };
    const THREE = {
        WebGLRenderer: class {
            constructor() { created++; this.domElement = { setAttribute() {}, remove() { this.parentNode = null; } }; }
            setClearColor() {} setPixelRatio() {} setSize() {}
            render() { renders++; } dispose() { disposed++; }
        },
        Scene: class { add() {} }, OrthographicCamera: class {},
        Vector2: class { set() {} }, ShaderMaterial: class { dispose() {} },
        PlaneGeometry: class { dispose() {} }, Mesh: class { constructor(geometry) { this.geometry = geometry; } }
    };
    const window = { THREE, WebGLRenderingContext: class {}, innerWidth: 800, innerHeight: 600,
        matchMedia: () => motion,
        requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout(fn) { const id = ++frameId; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
        addEventListener: (name, fn) => windowListeners.set(name, fn),
        removeEventListener: name => windowListeners.delete(name),
        AppData: { ready: Promise.resolve(), preferences: {
            getThreeBackground: getPreference, setThreeBackground: async (value) => { preferencesSaved.push(value); }
        } } };
    vm.runInNewContext(source, { window, document, performance: { now: () => 100 }, console });
    return { window, frames, timers, attributes, preferencesSaved, motionListeners, listeners, document, motion, windowListeners,
        get created() { return created; }, get renders() { return renders; }, get disposed() { return disposed; },
        tick(now) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(now); },
        runTasks() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); } };
}
async function ready() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
async function initialize(h) {
    await ready();
    if (h.frames.size) h.tick(100);
    h.runTasks();
}

test('static default background renders once and creates no recurring frames', async () => {
    const h = harness(); await initialize(h);
    assert.equal(h.renders, 1);
    assert.equal(h.frames.size, 0);
    h.windowListeners.get('resize')();
    assert.equal(h.renders, 2);
    h.window.SHUIThreeBackground.refresh();
    assert.equal(h.renders, 3);
    assert.equal(h.frames.size, 0);
});

test('animated background stops hidden or reduced-motion frames and resumes one loop', async () => {
    const h = harness({ theme: 'misty-mountain' }); await initialize(h);
    assert.equal(h.frames.size, 1);
    h.tick(200); assert.equal(h.renders, 2); assert.equal(h.frames.size, 1);
    h.document.hidden = true; h.listeners.get('visibilitychange')();
    assert.equal(h.frames.size, 0);
    h.document.hidden = false; h.listeners.get('visibilitychange')();
    assert.equal(h.frames.size, 1);
    h.listeners.get('visibilitychange')(); assert.equal(h.frames.size, 1);
    h.motion.matches = true; h.motionListeners.get('change')();
    assert.equal(h.frames.size, 0);
    h.motion.matches = false; h.motionListeners.get('change')();
    assert.equal(h.frames.size, 1);
    const pendingFrame = [...h.frames.values()][0];
    h.window.SHUIThreeBackground.destroy();
    const renders = h.renders;
    pendingFrame(400); h.window.SHUIThreeBackground.refresh();
    assert.equal(h.renders, renders);
    assert.equal(h.frames.size, 0);
    assert.equal(h.motionListeners.size, 0);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.disposed, 1);
});

test('animated background initializes with no loop when motion reduced or page hidden', async () => {
    for (const options of [{ reducedMotion: true }, { hidden: true }]) {
        const h = harness({ theme: 'teal-ocean', ...options }); await initialize(h);
        assert.equal(h.renders, 1);
        assert.equal(h.frames.size, 0);
    }
});

test('startup WebGL initialization waits until the painted frame completes, then uses the saved theme', async () => {
    const h = harness({ theme: 'teal-ocean' });
    await ready();
    assert.equal(h.created, 0);
    assert.equal(typeof h.window.SHUIThreeBackground.destroy, 'function');
    h.tick(100);
    assert.equal(h.created, 0, 'WebGL construction must not block the animation frame');
    h.runTasks();
    assert.equal(h.created, 1);
    assert.equal(h.attributes.get('data-bg-theme'), 'teal-ocean');
});

test('explicit theme selection cancels queued startup work before and after its animation frame', async () => {
    for (const afterFrame of [false, true]) {
        const h = harness(); await ready();
        if (afterFrame) h.tick(100);
        h.window.switchBgTheme('misty-mountain');
        assert.equal(h.created, 1);
        assert.deepEqual(h.preferencesSaved, ['misty-mountain']);
        h.runTasks();
        assert.equal(h.created, 1);
        assert.equal(h.attributes.get('data-bg-theme'), 'misty-mountain');
        assert.equal(h.frames.size, 1, 'only the selected animated background owns a frame loop');
    }
});

test('destroying a queued startup background cancels WebGL construction', async () => {
    for (const afterFrame of [false, true]) {
        const h = harness(); await ready();
        if (afterFrame) h.tick(100);
        h.window.SHUIThreeBackground.destroy();
        h.runTasks();
        assert.equal(h.created, 0);
        assert.equal(h.frames.size, 0);
        assert.equal(h.window.SHUIThreeBackground, null);
    }
});

test('a theme selected during startup preferences wins over a later saved value or read failure', async () => {
    for (const rejected of [false, true]) {
        let resolveRead;
        let rejectRead;
        const preference = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
        const h = harness({ getPreference: () => preference }); await ready();
        h.window.switchBgTheme('teal-ocean');
        if (rejected) rejectRead(new Error('preference read failed'));
        else resolveRead('floral-bloom');
        await ready();
        h.runTasks();
        assert.equal(h.created, 1);
        assert.equal(h.attributes.get('data-bg-theme'), 'teal-ocean');
        assert.equal(h.frames.size, 1);
    }
});

test('saved non-WebGL theme is applied without queuing renderer construction', async () => {
    const h = harness({ theme: 'newjeans' }); await ready();
    assert.equal(h.created, 0);
    assert.equal(h.frames.size, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.attributes.get('data-bg-theme'), 'newjeans');
});

test('a theme selected before DOM readiness is not replaced by startup initialization', async () => {
    const h = harness({ readyState: 'loading' });
    h.window.switchBgTheme('teal-ocean');
    h.listeners.get('DOMContentLoaded')();
    await ready();
    h.runTasks();
    assert.equal(h.created, 1);
    assert.equal(h.attributes.get('data-bg-theme'), 'teal-ocean');
    assert.equal(h.frames.size, 1);
});
