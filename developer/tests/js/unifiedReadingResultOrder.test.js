#!/usr/bin/env node
'use strict';

// 回归：提交结果表格（unifiedReadingPage.renderResults）必须按题号升序展示。
//
// 历史 bug：阅读文章内部 questionId 为 q1..q13，通过 questionDisplayMap 映射到全局
// 显示题号 14..26（q1->14、q10->23 … q13->26）。answerComparison 是对象，其键顺序在
// 持久化/回放等环节会被规范化为字符串字典序（q1,q10,q11,q12,q13,q2,…,q9）。
// renderResults 此前直接 Object.values(...) 输出，导致结果表格把显示题号 23–26
// 排到了 15 之前（截图顺序：14,23,24,25,26,15,…,22）。修复后 renderResults 在展示层
// 按显示题号数字稳定排序，无论键顺序如何都输出 14..26。

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const code = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function createClassList() {
    return { add() {}, remove() {}, toggle() {} };
}

function createContext() {
    function HTMLElement() {}
    function HTMLInputElement() {}
    HTMLInputElement.prototype = Object.create(HTMLElement.prototype);
    function HTMLTextAreaElement() {}
    HTMLTextAreaElement.prototype = Object.create(HTMLElement.prototype);
    function HTMLSelectElement() {}
    HTMLSelectElement.prototype = Object.create(HTMLElement.prototype);

    const timer = { textContent: '', style: {}, classList: createClassList() };
    const resultsEl = {
        innerHTML: '',
        style: {},
        classList: createClassList(),
        setAttribute() {},
        appendChild() {},
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };

    const document = {
        title: 'Unified Reading Result Order Test',
        referrer: 'http://localhost/',
        body: { dataset: {}, classList: createClassList() },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById(id) {
            if (id === 'timer') return timer;
            if (id === 'results') return resultsEl;
            return null;
        },
        createElement() {
            return {
                className: '',
                dataset: {},
                style: {},
                classList: createClassList(),
                appendChild() {},
                setAttribute() {},
                addEventListener() {},
                innerHTML: '',
                textContent: ''
            };
        },
        addEventListener() {},
        removeEventListener() {}
    };

    const window = {
        location: {
            href: 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=p2-high-09',
            search: '?examId=p2-high-09',
            protocol: 'http:'
        },
        history: { replaceState() {} },
        document,
        opener: null,
        parent: null,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        scrollTo() {},
        scrollY: 0,
        close() {},
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        HTMLElement,
        HTMLInputElement,
        HTMLTextAreaElement,
        HTMLSelectElement,
        CustomEvent: function CustomEvent(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        },
        CSS: { escape(value) { return String(value); } }
    };
    window.parent = window;

    const sandbox = {
        window,
        globalThis: window,
        document,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        HTMLElement,
        HTMLInputElement,
        HTMLTextAreaElement,
        HTMLSelectElement,
        CustomEvent: window.CustomEvent,
        CSS: window.CSS,
        location: window.location
    };
    sandbox.globalThis = window;

    return { context: vm.createContext(sandbox), window, document, resultsEl };
}

function loadProductionExam(examId) {
    const { context, window, resultsEl } = createContext();
    window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    window.__READING_EXAM_MANIFEST__ = {};
    let dataset = null;
    window.__READING_EXAM_DATA__ = {
        register(registeredId, payload) {
            if (registeredId === examId) dataset = payload;
        }
    };
    loadScript('js/utils/answerMatchCore.js', context);
    loadScript('js/runtime/unifiedReadingPage.js', context);
    loadScript(`assets/generated/reading-exams/${examId}.js`, context);
    const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
    assert(hooks, 'should expose unified reading page test hooks');
    assert(dataset, `${examId} production fixture should register`);
    hooks.captureDom();
    return { hooks, dataset, resultsEl };
}

// 模拟持久化往返：对象键按字符串字典序重排（规范化序列化的效果）。
function lexicographicallyReorder(source) {
    const reordered = {};
    Object.keys(source).sort().forEach((key) => {
        reordered[key] = source[key];
    });
    return reordered;
}

function renderedLabels(resultsEl) {
    const html = resultsEl.innerHTML || '';
    const labels = [];
    const buttonPattern = /data-result-question-id="[^"]+"[^>]*>([^<]*)<\/button>/g;
    let match = null;
    while ((match = buttonPattern.exec(html)) !== null) {
        labels.push(match[1].trim());
    }
    return labels;
}

const EXPECTED = ['14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26'];

function testNaturalOrderRendersAscending() {
    const { hooks, dataset, resultsEl } = loadProductionExam('p2-high-09');
    hooks.setTestState({ dataset });
    const results = hooks.buildResultsFromAnswers(dataset, {});
    hooks.renderResults(results);
    assert.deepStrictEqual(
        renderedLabels(resultsEl),
        EXPECTED,
        'natural questionOrder should render ascending display numbers'
    );
}

function testLexicographicKeysStillRenderAscending() {
    const { hooks, dataset, resultsEl } = loadProductionExam('p2-high-09');
    hooks.setTestState({ dataset });
    const results = hooks.buildResultsFromAnswers(dataset, {});

    // 先证明字典序键确实复现了截图里的乱序输入（14,23,24,25,26,15,…,22）。
    const lexKeys = Object.keys(lexicographicallyReorder(results.answerComparison));
    const lexDisplayOrder = lexKeys.map((key) => String(dataset.questionDisplayMap[key]));
    assert.deepStrictEqual(
        lexDisplayOrder,
        ['14', '23', '24', '25', '26', '15', '16', '17', '18', '19', '20', '21', '22'],
        'lexicographic object key order must reproduce the reported scrambled input'
    );

    const scrambled = Object.assign({}, results, {
        answerComparison: lexicographicallyReorder(results.answerComparison),
        scoreInfo: Object.assign({}, results.scoreInfo, {
            details: lexicographicallyReorder(results.scoreInfo.details)
        })
    });
    hooks.renderResults(scrambled);

    assert.deepStrictEqual(
        renderedLabels(resultsEl),
        EXPECTED,
        'results table must sort by display question number even when persisted keys are lexicographic'
    );
}

function testMixedLabelsRenderNumbersFirst() {
    const { hooks, resultsEl } = loadProductionExam('p2-high-09');
    const dataset = {
        questionOrder: ['q2', 'qb', 'q1', 'qa'],
        questionDisplayMap: { q1: '1', q2: '2', qa: 'A', qb: 'B' },
        answerKey: { q1: 'first', q2: 'second', qa: 'alpha', qb: 'beta' }
    };
    hooks.setTestState({ dataset });
    const results = hooks.buildResultsFromAnswers(dataset, {});
    const inputOrder = Object.keys(results.answerComparison);
    hooks.renderResults(results);

    assert.deepStrictEqual(
        renderedLabels(resultsEl),
        ['1', '2', 'A', 'B'],
        'numbered questions must precede unnumbered questions, which sort by question ID'
    );
    assert.deepStrictEqual(
        Object.keys(results.answerComparison),
        inputOrder,
        'rendering must preserve the input comparison order'
    );
}

const tests = [
    testNaturalOrderRendersAscending,
    testLexicographicKeysStillRenderAscending,
    testMixedLabelsRenderNumbersFirst
];

let passed = 0;
const failures = [];
for (const test of tests) {
    try {
        test();
        passed += 1;
    } catch (error) {
        failures.push({ name: test.name, message: error.message });
    }
}

if (failures.length) {
    failures.forEach((failure) => {
        console.error(`FAIL ${failure.name}: ${failure.message}`);
    });
    console.error(`${failures.length}/${tests.length} failed`);
    process.exit(1);
}

console.log(JSON.stringify({
    status: 'pass',
    detail: `${passed}/${tests.length} unified reading result-order checks passed`
}));
