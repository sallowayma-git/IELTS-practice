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

function createHarness({ examIndex = [], records = [] } = {}) {
    const localStorageState = new Map();
    const documentStub = {
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; }
    };
    const windowStub = {
        localStorage: {
            getItem(key) {
                return localStorageState.has(key) ? localStorageState.get(key) : null;
            },
            setItem(key, value) {
                localStorageState.set(key, String(value));
            },
            removeItem(key) {
                localStorageState.delete(key);
            }
        },
        addEventListener() {},
        getExamIndexState() {
            return examIndex.slice();
        },
        getPracticeRecordsState() {
            return records.slice();
        }
    };

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        document: documentStub,
        localStorage: windowStub.localStorage,
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
    return { window: windowStub, localStorageState };
}

const results = [];
function recordResult(name, detail) {
    results.push({ name, passed: true, detail, timestamp: new Date().toISOString() });
}

function readPreferences(windowStub) {
    return JSON.parse(windowStub.localStorage.getItem('browse_view_preferences_v2') || '{}');
}

function testRecordMetadataBuildsAnchorWithoutCurrentExamIndex() {
    const { window } = createHarness({
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

    window.updateBrowseAnchorsFromRecords([record]);
    const prefs = readPreferences(window);
    assert(prefs.listAnchors, '应写入浏览锚点');
    assert(prefs.listAnchors['P1|reading'], '历史阅读记录应在当前题库不含该题时仍产生 P1|reading 锚点');
    assert.strictEqual(prefs.listAnchors['P1|reading'].examId, 'old-reading-p1');
    assert.strictEqual(prefs.listAnchors['P1|reading'].title, 'P1 Reading From Previous Library');

    recordResult('历史记录不依赖当前题库也能生成浏览锚点', prefs.listAnchors['P1|reading']);
}

function testExplicitMetadataOutranksCurrentExamIndex() {
    const { window } = createHarness({
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

    const info = window.resolveRecordExamInfo(record, window.getExamIndexState());
    assert.strictEqual(info.category, 'P2', '记录自身 metadata.category 必须优先于当前题库索引');
    assert.strictEqual(info.type, 'reading', '记录自身 metadata.examType 必须优先于当前题库索引');

    window.updateBrowseAnchorsFromRecords([record]);
    const prefs = readPreferences(window);
    assert(prefs.listAnchors['P2|reading'], '锚点 key 应来自历史记录自身 metadata');
    assert(!prefs.listAnchors['P4|listening'], '当前活动题库的同 id 元数据不能污染历史记录锚点');

    recordResult('历史记录 metadata 优先于当前题库索引', info);
}

function testLatestTimestampWinsPerFilter() {
    const { window } = createHarness();
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
    ]);

    const prefs = readPreferences(window);
    assert.strictEqual(prefs.listAnchors['P3|reading'].examId, 'new-p3', '同一筛选下应保留最新练习记录锚点');

    recordResult('浏览锚点按时间保留最新记录', prefs.listAnchors['P3|reading']);
}

function main() {
    try {
        testRecordMetadataBuildsAnchorWithoutCurrentExamIndex();
        testExplicitMetadataOutranksCurrentExamIndex();
        testLatestTimestampWinsPerFilter();
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

main();
