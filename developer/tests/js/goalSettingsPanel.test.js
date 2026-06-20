#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const windowStub = {};
const context = vm.createContext({
    window: windowStub,
    console: { log() {}, warn() {}, error() {}, info() {} },
    Number,
    Math,
    String,
    Array
});
const source = fs.readFileSync(path.join(repoRoot, 'js/components/goalSettingsPanel.js'), 'utf8');
vm.runInContext(source, context, { filename: 'js/components/goalSettingsPanel.js' });

function createContainer() {
    return {
        innerHTML: '',
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
}

const goals = Array.from({ length: 150 }, (_, index) => ({
    goal: {
        id: `goal-${index}`,
        type: 'practice_count',
        period: 'daily',
        target: 3,
        title: index === 0 ? '<img src=x onerror=alert(1)>' : `Goal ${index}`
    },
    current: index,
    percent: index,
    completed: false
}));

const container = createContainer();
const panel = new windowStub.GoalSettingsPanel({
    container,
    goalManager: {
        ready: true,
        getAllProgress() {
            return goals;
        },
        getStreak() {
            return {
                current: '<script>alert(1)</script>',
                best: 150,
                lastDate: null
            };
        },
        on() {},
        off() {}
    }
});

panel.render();

const cards = container.innerHTML.match(/class="goal-card(?:\s|")/g) || [];
assert.equal(cards.length, 100, 'goal settings panel should cap rendered goal cards');
assert(!container.innerHTML.includes('<img src=x'));
assert(!container.innerHTML.includes('<script>'));
assert(container.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));

console.log(JSON.stringify({
    status: 'pass',
    detail: 'goal settings panel tests passed'
}, null, 2));
