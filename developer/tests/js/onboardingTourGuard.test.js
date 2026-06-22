#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'components', 'onboardingTour.js'), 'utf8');

function loadHooks() {
    const queryCalls = [];
    const storage = new Map();
    const context = {
        console,
        Date,
        Number,
        Math,
        Set,
        String,
        Array,
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        document: {
            querySelector(selector) {
                queryCalls.push(selector);
                return { selector };
            },
            addEventListener() {},
            body: {
                appendChild() {},
                classList: { add() {}, remove() {} }
            }
        },
        setTimeout() {},
        requestAnimationFrame() {}
    };
    context.window = context;
    context.globalThis = context;
    const patchedSource = source.replace(
        '  const tour = new OnboardingTour();',
        [
            '  global.__OnboardingTourGuardHooks = {',
            '    normalizeOnboardingSteps,',
            '    normalizeOnboardingSelector,',
            '    safeQuerySelector,',
            '    truncateOnboardingText',
            '  };',
            '  const tour = new OnboardingTour();'
        ].join('\n')
    );
    vm.createContext(context);
    vm.runInContext(patchedSource, context, { filename: 'js/components/onboardingTour.js' });
    assert(context.__OnboardingTourGuardHooks, 'onboarding guard hooks should be available');
    return {
        hooks: context.__OnboardingTourGuardHooks,
        queryCalls,
        window: context
    };
}

test('custom onboarding steps are bounded before use', () => {
    const { hooks } = loadHooks();
    const steps = Array.from({ length: 150 }, (_, index) => ({
        id: `step-${index}`,
        target: `.${'x'.repeat(300)}`,
        title: 't'.repeat(1000),
        content: 'c'.repeat(1000),
        nextText: 'n'.repeat(200),
        position: 'not-a-position',
        activateView: 'javascript:alert(1)',
        offsetY: 999,
        subSteps: Array.from({ length: 25 }, () => ({
            id: 'sub',
            target: '#safe-target',
            title: 'sub-title',
            content: 'sub-content'
        }))
    }));

    const normalized = hooks.normalizeOnboardingSteps(steps, []);

    assert.equal(normalized.length, 100);
    assert.equal(normalized[0].target, null);
    assert.equal(normalized[0].title.length, 800);
    assert.equal(normalized[0].content.length, 800);
    assert.equal(normalized[0].nextText.length, 80);
    assert.equal(normalized[0].position, 'right');
    assert.equal(normalized[0].activateView, null);
    assert.equal(normalized[0].offsetY, 200);
    assert.equal(normalized[0].subSteps.length, 20);
});

test('safe onboarding selector rejects overlong selectors before querying DOM', () => {
    const { hooks, queryCalls } = loadHooks();

    assert.equal(hooks.safeQuerySelector(`.${'x'.repeat(300)}`), null);
    assert.deepEqual(queryCalls, []);

    const element = hooks.safeQuerySelector('#overview-view');
    assert.equal(element.selector, '#overview-view');
    assert.deepEqual(queryCalls, ['#overview-view']);
});

test('global registerSteps applies normalization limits', () => {
    const { window } = loadHooks();
    const steps = Array.from({ length: 120 }, (_, index) => ({
        id: `custom-${index}`,
        title: `Step ${index}`,
        content: 'content',
        target: '#ok'
    }));

    window.OnboardingTour.registerSteps(steps);

    assert.equal(window.OnboardingTour.getStatus().totalSteps, 100);
});
