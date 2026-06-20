#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'app.js'), 'utf8');

function loadAppClass() {
    const windowStub = {
        CSS: {
            escape(value) {
                return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
            }
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        handleError() {},
        practiceConfig: {}
    };
    const documentStub = {
        addEventListener() {},
        getElementById() {
            return null;
        },
        createElement() {
            return {
                appendChild() {},
                set textContent(value) {
                    this._textContent = String(value);
                },
                get textContent() {
                    return this._textContent || '';
                }
            };
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
    const context = {
        window: windowStub,
        document: documentStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Date,
        Map,
        Set,
        Object,
        Array,
        String,
        Number,
        Math,
        Promise,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        setInterval() {
            return 1;
        },
        clearInterval() {},
        setTimeout(callback) {
            if (typeof callback === 'function') {
                callback();
            }
            return 1;
        }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(`${source}\nthis.ExamSystemApp = ExamSystemApp;`, context, { filename: 'js/app.js' });
    return context.ExamSystemApp;
}

const ExamSystemApp = loadAppClass();
const app = new ExamSystemApp();

assert.equal(app.calculateAverageAccuracy([]), 0);
assert.equal(app.calculateAverageAccuracy([{ accuracy: 'bad' }, { accuracy: Infinity }, { accuracy: -1 }]), 0);
assert.equal(app.calculateAverageAccuracy([
    { accuracy: 0.8 },
    { accuracy: '90' },
    { accuracy: 'bad' },
    { accuracy: null }
]), 85);

assert.equal(app.calculateStudyDays([]), 0);
assert.equal(app.calculateStudyDays([
    { startTime: 'not-a-date' },
    { startTime: null },
    { completedAt: '2026-06-20T10:00:00.000Z' },
    { timestamp: '2026-06-20T12:00:00.000Z' },
    { startTime: '2026-06-21T09:00:00.000Z' }
]), 2);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'app overview stats guard tests passed'
}, null, 2));
