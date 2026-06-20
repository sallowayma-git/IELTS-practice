#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'components', 'onboardingTour.js'), 'utf8');

test('onboarding tour selector lookups are wrapped for invalid step config', () => {
    assert(
        source.includes('function safeQuerySelector(selector)') &&
        source.includes('try {') &&
        source.includes('return document.querySelector(String(selector));') &&
        source.includes('catch (_)'),
        'onboarding tour must keep a querySelector wrapper that catches invalid selectors'
    );

    const rawSelectorCalls = source
        .split('\n')
        .map((line, index) => ({ line: line.trim(), index: index + 1 }))
        .filter(({ line }) => line.includes('document.querySelector('));

    assert.deepEqual(
        rawSelectorCalls.map(({ line }) => line),
        ['return document.querySelector(String(selector));'],
        `unexpected raw document.querySelector call(s): ${rawSelectorCalls.map(({ index, line }) => `${index}: ${line}`).join('; ')}`
    );

    [
        'safeQuerySelector(selector)',
        'safeQuerySelector(viewSelector)',
        'safeQuerySelector(step.triggerElement)',
        'safeQuerySelector(subStep.target)',
        'safeQuerySelector(step.target)'
    ].forEach((needle) => {
        assert(source.includes(needle), `expected ${needle} to be used for tour selectors`);
    });
});
