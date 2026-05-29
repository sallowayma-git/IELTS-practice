#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createHarness() {
    const calls = [];
    const records = [{ id: 'record-1', examId: 'reading-1', type: 'reading', score: 1 }];
    const stats = { totalPractices: 1 };
    const meta = new Map();

    const windowStub = {
        PracticeRecordAPI: {
            async list() {
                calls.push({ type: 'api.list' });
                return records.map(record => Object.assign({}, record));
            },
            async getById(id) {
                calls.push({ type: 'api.getById', id });
                return records.find(record => record.id === id) || null;
            },
            async readStats(options = {}) {
                calls.push({ type: 'api.readStats', fallback: options.fallback });
                return Object.assign({}, options.fallback || {}, stats);
            },
            async replace() {
                calls.push({ type: 'api.replace' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.replace');
            },
            async saveRecord() {
                calls.push({ type: 'api.saveRecord' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.saveRecord');
            },
            async deleteById() {
                calls.push({ type: 'api.deleteById' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.deleteById');
            },
            async deleteMany() {
                calls.push({ type: 'api.deleteMany' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.deleteMany');
            },
            async clear() {
                calls.push({ type: 'api.clear' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.clear');
            },
            async writeStats() {
                calls.push({ type: 'api.writeStats' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.writeStats');
            },
            async resetStats() {
                calls.push({ type: 'api.resetStats' });
                throw new Error('simpleStorageWrapper must not call PracticeRecordAPI.resetStats');
            }
        },
        dataRepositories: {
            settings: {
                async getAll() { return {}; },
                async saveAll() { return true; },
                async get() { return null; },
                async set() { return true; }
            },
            backups: {
                async list() { return []; },
                async saveAll() { return true; },
                async add() { return true; },
                async delete() { return true; },
                async clear() { return true; }
            },
            meta: {
                async get(key, fallback = null) {
                    calls.push({ type: 'meta.get', key });
                    return meta.has(key) ? meta.get(key) : fallback;
                },
                async set(key, value) {
                    calls.push({ type: 'meta.set', key, value });
                    meta.set(key, value);
                    return true;
                },
                async remove(key) {
                    calls.push({ type: 'meta.remove', key });
                    meta.delete(key);
                    return true;
                }
            }
        }
    };

    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        console: {
            log() {},
            warn() {},
            error() {}
        }
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/simpleStorageWrapper.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/utils/simpleStorageWrapper.js' });

    return {
        calls,
        records,
        stats,
        meta,
        wrapper: windowStub.simpleStorageWrapper
    };
}

async function assertRejectsWrite(label, operation, expectedPattern) {
    await assert.rejects(operation, expectedPattern, `${label} 必须 fail-fast`);
}

async function main() {
    const harness = createHarness();
    const { wrapper, calls, records, stats, meta } = harness;

    assert(wrapper, 'simpleStorageWrapper 应自动连接 dataRepositories');

    const listed = await wrapper.getPracticeRecords();
    assert.strictEqual(listed.length, 1, 'getPracticeRecords 应保留 PracticeRecordAPI.list 只读兼容');
    assert.strictEqual((await wrapper.get('practice_records', [])).length, 1, 'get(practice_records) 应保留只读兼容');
    assert.strictEqual((await wrapper.getById('record-1')).id, 'record-1', 'getById 应保留只读兼容');
    assert.strictEqual((await wrapper.get('user_stats', { totalPractices: 0 })).totalPractices, 1, 'get(user_stats) 应保留只读兼容');

    await assertRejectsWrite(
        'savePracticeRecords',
        () => wrapper.savePracticeRecords([{ id: 'next' }]),
        /SimpleStorageWrapper\.savePracticeRecords is disabled/
    );
    await assertRejectsWrite(
        'addPracticeRecord',
        () => wrapper.addPracticeRecord({ id: 'next' }),
        /SimpleStorageWrapper\.addPracticeRecord is disabled/
    );
    await assertRejectsWrite(
        'update',
        () => wrapper.update('record-1', { score: 2 }),
        /SimpleStorageWrapper\.update is disabled/
    );
    await assertRejectsWrite(
        'delete',
        () => wrapper.delete('record-1'),
        /SimpleStorageWrapper\.delete is disabled/
    );
    await assertRejectsWrite(
        'deletePracticeRecord',
        () => wrapper.deletePracticeRecord('record-1'),
        /SimpleStorageWrapper\.deletePracticeRecord is disabled/
    );
    await assertRejectsWrite(
        'deletePracticeRecords',
        () => wrapper.deletePracticeRecords(['record-1']),
        /SimpleStorageWrapper\.deletePracticeRecords is disabled/
    );
    await assertRejectsWrite(
        'set(practice_records)',
        () => wrapper.set('practice_records', []),
        /SimpleStorageWrapper\.set\(practice_records\) is disabled/
    );
    await assertRejectsWrite(
        'set(user_stats)',
        () => wrapper.set('user_stats', { totalPractices: 0 }),
        /SimpleStorageWrapper\.set\(user_stats\) is disabled/
    );
    await assertRejectsWrite(
        'remove(practice_records)',
        () => wrapper.remove('practice_records'),
        /SimpleStorageWrapper\.remove\(practice_records\) is disabled/
    );
    await assertRejectsWrite(
        'remove(user_stats)',
        () => wrapper.remove('user_stats'),
        /SimpleStorageWrapper\.remove\(user_stats\) is disabled/
    );

    await wrapper.set('unrelated_meta', { ok: true });
    assert.deepStrictEqual(meta.get('unrelated_meta'), { ok: true }, '非练习数据仍可走 meta repo 写入');
    await wrapper.remove('unrelated_meta');
    assert.strictEqual(meta.has('unrelated_meta'), false, '非练习数据仍可走 meta repo 删除');

    assert.strictEqual(records.length, 1, 'wrapper 练习数据写入口不能改变 records');
    assert.strictEqual(stats.totalPractices, 1, 'wrapper stats 写入口不能改变 stats');
    const writeCalls = calls.filter(call => /^api\.(replace|saveRecord|deleteById|deleteMany|clear|writeStats|resetStats)$/.test(call.type));
    assert.strictEqual(writeCalls.length, 0, 'wrapper 写入口不能调用 PracticeRecordAPI 写方法');

    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'SimpleStorageWrapper 练习数据只读兼容，公开写入口 fail-fast'
    }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({
        status: 'fail',
        detail: error && error.message ? error.message : String(error)
    }));
    process.exit(1);
});
