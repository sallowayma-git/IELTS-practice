import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../../../js/presentation/threeBackground.js', import.meta.url), 'utf8');
function harness({ theme = 'floral-bloom', reducedMotion = false, hidden = false } = {}) {
    const frames = new Map();
    const listeners = new Map();
    const motionListeners = new Map();
    const windowListeners = new Map();
    let frameId = 0;
    let renders = 0;
    let disposed = 0;
    const motion = { matches: reducedMotion,
        addEventListener: (name, fn) => motionListeners.set(name, fn),
        removeEventListener: name => motionListeners.delete(name) };
    const document = { readyState: 'complete', hidden,
        body: { classList: { add() {}, remove() {} }, setAttribute() {}, prepend(node) { node.parentNode = this; } },
        querySelector: () => null, getElementById: () => null,
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name) };
    const THREE = {
        WebGLRenderer: class {
            constructor() { this.domElement = { setAttribute() {}, remove() { this.parentNode = null; } }; }
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
        addEventListener: (name, fn) => windowListeners.set(name, fn),
        removeEventListener: name => windowListeners.delete(name),
        AppData: { ready: Promise.resolve(), preferences: {
            getThreeBackground: async () => theme, setThreeBackground: async () => {}
        } } };
    vm.runInNewContext(source, { window, document, performance: { now: () => 100 }, console });
    return { window, frames, motionListeners, listeners, document, motion, windowListeners,
        get renders() { return renders; }, get disposed() { return disposed; },
        tick(now) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(now); } };
}
async function ready() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('static default background renders once and creates no recurring frames', async () => {
    const h = harness(); await ready();
    assert.equal(h.renders, 1);
    assert.equal(h.frames.size, 0);
    h.windowListeners.get('resize')();
    assert.equal(h.renders, 2);
    h.window.SHUIThreeBackground.refresh();
    assert.equal(h.renders, 3);
    assert.equal(h.frames.size, 0);
});

test('animated background stops hidden or reduced-motion frames and resumes one loop', async () => {
    const h = harness({ theme: 'misty-mountain' }); await ready();
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
        const h = harness({ theme: 'teal-ocean', ...options }); await ready();
        assert.equal(h.renders, 1);
        assert.equal(h.frames.size, 0);
    }
});
