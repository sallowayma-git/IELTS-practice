#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

async function waitForCondition(predicate, message, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.fail(message);
}

function createAppHarness(options = {}) {
    const messages = [];
    const syncCalls = [];
    const savedCompletions = [];
    const statusCalls = [];
    const cleanupCalls = [];
    const examIndex = [{
        id: 'reading-p1',
        title: 'Passage 1',
        type: 'reading',
        category: 'P1',
        frequency: 'high'
    }];
    let releaseSync = null;

    const storage = {
        async get(key, fallback = null) {
            if (key === 'exam_index' || key === 'active_exam_index_key') {
                return key === 'exam_index' ? examIndex : 'exam_index';
            }
            return fallback;
        },
        async set() {
            return true;
        }
    };
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandboxWindow = {
        console: quietConsole,
        storage,
        location: { href: 'http://localhost/' },
        document: { addEventListener() {}, removeEventListener() {} },
        addEventListener() {},
        removeEventListener() {},
        showMessage(message, type) {
            messages.push({ message, type });
        },
        syncPracticeRecords: options.syncRejects
            ? async () => {
                syncCalls.push({ forceRender: true });
                throw new Error('sync failed');
            }
            : async (syncOptions = {}) => {
                syncCalls.push(syncOptions);
                await new Promise((resolve) => {
                    releaseSync = resolve;
                });
                return true;
            },
        PracticeRecordAPI: {
            async saveCompletion(payload, context) {
                if (options.saveRejects) {
                    throw new Error('save failed');
                }
                savedCompletions.push({ payload, context });
                return {
                    id: 'saved-1',
                    examId: context.examId,
                    sessionId: context.sessionId
                };
            }
        },
        AchievementManager: {
            async check() {
                return true;
            }
        }
    };

    const sandbox = {
        window: sandboxWindow,
        document: sandboxWindow.document,
        storage,
        console: quietConsole,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);

    const app = {
        components: {},
        examWindows: new Map([
            ['reading-p1', { expectedSessionId: 'session-p1', sessionId: 'session-p1' }]
        ]),
        suiteExamMap: new Map(),
        currentSuiteSession: null,
        setState() {},
        getState() { return null; }
    };
    Object.assign(app, sandboxWindow.ExamSystemAppMixins.examSession);
    app.updateExamStatus = (examId, status) => {
        statusCalls.push({ examId, status });
    };
    app.cleanupExamSession = async (examId) => {
        cleanupCalls.push(examId);
        app.examWindows.delete(examId);
    };

    return {
        app,
        messages,
        syncCalls,
        savedCompletions,
        statusCalls,
        cleanupCalls,
        releaseSync: () => releaseSync && releaseSync()
    };
}

async function testCompletionWaitsForSyncAndDedupes() {
    const harness = createAppHarness();
    const completion = harness.app.handlePracticeComplete('reading-p1', {
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
        duration: 120,
        answers: { q1: 'A' }
    });

    await waitForCondition(
        () => harness.savedCompletions.length === 1,
        '第一次完成应保存一次'
    );
    assert.strictEqual(harness.savedCompletions.length, 1, '第一次完成应保存一次');
    assert.strictEqual(harness.statusCalls.length, 0, 'syncPracticeRecords 未完成前不应先标记完成');
    harness.releaseSync();
    await completion;

    assert.strictEqual(harness.syncCalls.length, 1, '完成后应等待一次同步');
    assert.strictEqual(harness.syncCalls[0].forceRender, true, '同步必须强制刷新');
    assert.strictEqual(harness.statusCalls.length, 1, '同步完成后才更新完成状态');
    assert.strictEqual(harness.messages[0].type, 'success', '保存和同步成功后才显示成功通知');

    await harness.app.handlePracticeComplete('reading-p1', {
        sessionId: 'session-p1',
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
        duration: 120
    });
    assert.strictEqual(harness.savedCompletions.length, 1, '相同 sessionId 的重复完成事件不应重复保存');
}

async function testSaveFailureShowsErrorOnly() {
    const harness = createAppHarness({ saveRejects: true });
    await harness.app.handlePracticeComplete('reading-p1', {
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
        duration: 120
    });

    assert.strictEqual(harness.statusCalls.length, 0, '保存失败不能标记题目完成');
    assert.strictEqual(harness.syncCalls.length, 0, '保存失败不能继续同步成功链路');
    assert.strictEqual(harness.messages.length, 1, '保存失败应给用户一个明确错误');
    assert.strictEqual(harness.messages[0].type, 'error');
    assert.match(harness.messages[0].message, /记录保存失败/);
}

async function testDurationDoesNotRenderNaN() {
    const harness = createAppHarness();
    await harness.app.showRealCompletionNotification('reading-p1', {
        scoreInfo: { correct: 1, total: 2, accuracy: 0.5, percentage: 50 }
    });

    assert.strictEqual(harness.messages.length, 1);
    assert(!harness.messages[0].message.includes('NaN'), '缺失 duration 时完成通知不能显示 NaN');
    assert(harness.messages[0].message.includes('用时: 0 分钟'));
}

async function main() {
    try {
        await testCompletionWaitsForSyncAndDedupes();
        await testSaveFailureShowsErrorOnly();
        await testDurationDoesNotRenderNaN();
        process.stdout.write(JSON.stringify({
            status: 'pass',
            detail: '单篇完成链路等待同步、按 session 去重，保存失败显示错误且通知不渲染 NaN'
        }));
    } catch (error) {
        process.stdout.write(JSON.stringify({
            status: 'fail',
            detail: error && error.stack ? error.stack : String(error)
        }));
        process.exit(1);
    }
}

main();
