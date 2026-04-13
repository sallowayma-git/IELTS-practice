#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function deepClone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

async function main() {
    const state = new Map();
    const storage = {
        async get(key, fallback = undefined) {
            if (state.has(key)) {
                return deepClone(state.get(key));
            }
            return deepClone(fallback);
        },
        async set(key, value) {
            state.set(key, deepClone(value));
        }
    };

    const windowStub = {
        storage,
        showMessage() {},
        location: { href: 'http://localhost/index.html' },
        document: {
            title: 'IELTS Practice',
            addEventListener() {},
            removeEventListener() {},
            querySelectorAll() { return []; },
            dispatchEvent() { return true; }
        },
        addEventListener() {},
        removeEventListener() {},
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || null };
        }
    };

    const sandbox = {
        window: windowStub,
        storage,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Math,
        Date,
        JSON,
        Array,
        document: windowStub.document,
        CustomEvent: windowStub.CustomEvent
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);

    const mixins = windowStub.ExamSystemAppMixins;
    if (!mixins || !mixins.examSession) {
        throw new Error('未加载 examSession mixin');
    }

    let cleanupCalls = 0;
    let saveCalls = 0;
    const statusUpdates = [];

    const app = {
        components: {
            practiceRecorder: {
                async savePracticeRecord() {
                    saveCalls += 1;
                }
            }
        },
        setState() {},
        getState() { return null; },
        updateExamStatus(examId, status) {
            statusUpdates.push({ examId, status });
        },
        async cleanupExamSession() {
            cleanupCalls += 1;
        },
        showRealCompletionNotification() {}
    };

    Object.assign(app, mixins.examSession);
    app.updateExamStatus = function updateExamStatus(examId, status) {
        statusUpdates.push({ examId, status });
    };

    await app.handlePracticeComplete('reading-inline-1', {
        examId: 'reading-inline-1',
        sessionId: 'session-inline-1',
        scoreInfo: {
            correct: 3,
            total: 4,
            accuracy: 0.75,
            percentage: 75,
            source: 'unit-test'
        },
        answers: {
            q1: 'A'
        },
        interactions: []
    });

    assert.strictEqual(saveCalls, 1, '提交完成应写入一次练习记录');
    assert.strictEqual(cleanupCalls, 0, '提交完成后不应自动 cleanup，会话应保留到用户点击 Exit');
    assert.ok(
        statusUpdates.some((entry) => entry.examId === 'reading-inline-1' && entry.status === 'completed'),
        '提交完成后应更新状态为 completed'
    );

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'handlePracticeComplete 不会在提交后自动关闭会话，需由 PRACTICE_EXIT 触发退出'
    }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
