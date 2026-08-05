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
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createHarness({ examIndex = [], records = [], initialBrowse = null, browseReadGate = null } = {}) {
    let persistedBrowse = initialBrowse ? structuredClone(initialBrowse) : null;
    let failNextWrite = false;
    const documentStub = {
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; }
    };
    const windowStub = {
        AppData: {
            ready: Promise.resolve(),
            preferences: {
                async getBrowse() {
                    if (browseReadGate) await browseReadGate;
                    return persistedBrowse ? structuredClone(persistedBrowse) : null;
                },
                async patchBrowse(value) {
                    if (failNextWrite) {
                        failNextWrite = false;
                        throw new Error('injected preference commit failure');
                    }
                    persistedBrowse = structuredClone(value);
                    return { committed: true };
                }
            }
        },
        addEventListener() {},
        failNextBrowsePreferenceWrite() { failNextWrite = true; }
    };

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        document: documentStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Array,
        Object,
        String,
        Number,
        RegExp,
        requestAnimationFrame(fn) {
            return fn();
        }
    };
    const context = vm.createContext(sandbox);
    loadScript('js/utils/BrowsePreferencesUtils.js', context);
    return { window: windowStub, examIndex, records };
}

const results = [];
function recordResult(name, detail) {
    results.push({ name, passed: true, detail, timestamp: new Date().toISOString() });
}

function readPreferences(windowStub) {
    return windowStub.getBrowseViewPreferences();
}

async function testRecordMetadataBuildsAnchorWithoutCurrentExamIndex() {
    const { window, examIndex } = createHarness({
        examIndex: [{
            id: 'unrelated-current-config-exam',
            title: 'Unrelated Current Config',
            category: 'P4',
            type: 'listening'
        }],
        records: []
    });
    const record = {
        id: 'old-reading-record',
        examId: 'old-reading-p1',
        title: 'P1 Reading From Previous Library',
        metadata: {
            examType: 'reading'
        },
        endTime: '2026-05-22T08:00:00.000Z'
    };

    window.updateBrowseAnchorsFromRecords([record], examIndex);
    await window.flushBrowsePreferenceWrites();
    const prefs = readPreferences(window);
    assert(prefs.listAnchors, '应写入浏览锚点');
    assert(prefs.listAnchors['P1|reading'], '历史阅读记录应在当前题库不含该题时仍产生 P1|reading 锚点');
    assert.strictEqual(prefs.listAnchors['P1|reading'].examId, 'old-reading-p1');
    assert.strictEqual(prefs.listAnchors['P1|reading'].title, 'P1 Reading From Previous Library');

    recordResult('历史记录不依赖当前题库也能生成浏览锚点', prefs.listAnchors['P1|reading']);
}

async function testExplicitMetadataOutranksCurrentExamIndex() {
    const { window, examIndex } = createHarness({
        examIndex: [{
            id: 'recorded-exam',
            title: 'Wrong Current Index Match',
            category: 'P4',
            type: 'listening'
        }],
        records: []
    });
    const record = {
        id: 'recorded-history',
        examId: 'recorded-exam',
        title: 'P2 Reading Historical Title',
        metadata: {
            category: 'P2',
            examType: 'reading'
        },
        timestamp: 1770000000000
    };

    const info = window.resolveRecordExamInfo(record, examIndex);
    assert.strictEqual(info.category, 'P2', '记录自身 metadata.category 必须优先于当前题库索引');
    assert.strictEqual(info.type, 'reading', '记录自身 metadata.examType 必须优先于当前题库索引');

    window.updateBrowseAnchorsFromRecords([record], examIndex);
    await window.flushBrowsePreferenceWrites();
    const prefs = readPreferences(window);
    assert(prefs.listAnchors['P2|reading'], '锚点 key 应来自历史记录自身 metadata');
    assert(!prefs.listAnchors['P4|listening'], '当前活动题库的同 id 元数据不能污染历史记录锚点');

    recordResult('历史记录 metadata 优先于当前题库索引', info);
}

async function testLatestTimestampWinsPerFilter() {
    const { window, examIndex } = createHarness();
    window.updateBrowseAnchorsFromRecords([
        {
            id: 'old',
            examId: 'old-p3',
            title: 'P3 Reading Old',
            metadata: { category: 'P3', examType: 'reading' },
            timestamp: 1700000000000
        },
        {
            id: 'new',
            examId: 'new-p3',
            title: 'P3 Reading New',
            metadata: { category: 'P3', examType: 'reading' },
            timestamp: 1800000000000
        }
    ], examIndex);
    await window.flushBrowsePreferenceWrites();

    const prefs = readPreferences(window);
    assert.strictEqual(prefs.listAnchors['P3|reading'].examId, 'new-p3', '同一筛选下应保留最新练习记录锚点');

    recordResult('浏览锚点按时间保留最新记录', prefs.listAnchors['P3|reading']);
}

async function testFailedPreferenceWriteDoesNotReplaceCommittedCache() {
    const { window } = createHarness();
    await window.flushBrowsePreferenceWrites();
    assert.strictEqual(window.getBrowseViewPreferences().autoScrollEnabled, true);

    window.failNextBrowsePreferenceWrite();
    const preview = window.saveBrowseViewPreferences({ autoScrollEnabled: false });
    assert.strictEqual(preview.autoScrollEnabled, false, 'UI preview may reflect the requested value');
    await window.flushBrowsePreferenceWrites();
    assert.strictEqual(window.getBrowseViewPreferences().autoScrollEnabled, true, 'failed commit must not become the cached fact');
    recordResult('偏好提交失败不会污染已提交缓存', { autoScrollEnabled: true });
}

async function testFirstReadCanAwaitPersistedPreferences() {
    let releaseRead;
    const browseReadGate = new Promise((resolve) => { releaseRead = resolve; });
    const { window } = createHarness({
        initialBrowse: {
            autoScrollEnabled: false,
            lastFilter: { category: 'P2', type: 'reading' },
            listAnchors: {
                'P2|reading': { examId: 'saved-reading', title: 'Saved Reading', timestamp: 1 }
            }
        },
        browseReadGate
    });

    assert.strictEqual(
        window.getBrowseViewPreferences().autoScrollEnabled,
        true,
        '同步兼容读取在 hydration 前仍可返回默认值'
    );
    let settled = false;
    const ready = window.whenBrowseViewPreferencesReady().then((preferences) => {
        settled = true;
        return preferences;
    });
    await Promise.resolve();
    assert.strictEqual(settled, false, '首次 UI 读取必须等待 AppData hydration');
    releaseRead();
    const hydrated = await ready;
    assert.strictEqual(hydrated.autoScrollEnabled, false, 'hydration 后必须返回持久化开关');
    assert.deepStrictEqual(
        structuredClone(hydrated.lastFilter),
        { category: 'P2', type: 'reading' },
        '首次筛选恢复必须使用持久化值'
    );
    assert.strictEqual(hydrated.listAnchors['P2|reading'].examId, 'saved-reading');
    recordResult('首次浏览状态等待 AppData hydration', hydrated);
}

async function main() {
    try {
        await testRecordMetadataBuildsAnchorWithoutCurrentExamIndex();
        await testExplicitMetadataOutranksCurrentExamIndex();
        await testLatestTimestampWinsPerFilter();
        await testFailedPreferenceWriteDoesNotReplaceCommittedCache();
        await testFirstReadCanAwaitPersistedPreferences();
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length,
            results
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results,
            stack: error.stack
        }, null, 2));
        process.exit(1);
    }
}

await main();
