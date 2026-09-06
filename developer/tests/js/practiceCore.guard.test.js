#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sourcePath = path.join(repoRoot, 'js', 'core', 'practiceCore.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const forbidden = [
    'STORAGE_KEYS',
    'persistentStore',
    'global.storage',
    'dataRepositories',
    'repository',
    '__installRecordAPI',
    '__installInternalRepositories',
    'readMeta(',
    'writeMeta(',
    'routeStorageSet',
    'routeStorageRemove'
];

for (const marker of forbidden) {
    assert.strictEqual(source.includes(marker), false, `PracticeCore must not contain v1 marker: ${marker}`);
}

const windowStub = { console };
const context = vm.createContext({ window: windowStub, globalThis: windowStub, console, Date, Math, JSON });
vm.runInContext(source, context, { filename: 'js/core/practiceCore.js' });

const core = windowStub.PracticeCore;
assert.ok(core && core.__stable === true, 'PracticeCore must initialize');
assert.deepStrictEqual(
    Object.keys(core).sort(),
    ['__stable', 'contracts', 'ingestor', 'protocol', 'version'].sort(),
    'PracticeCore public surface must stay persistence-free'
);
assert.strictEqual(Object.isFrozen(core), true, 'PracticeCore public surface must be frozen');
assert.strictEqual(Object.prototype.hasOwnProperty.call(core, 'store'), false, 'PracticeCore.store must not exist');

const suiteEntry = JSON.parse(JSON.stringify(core.contracts.standardizeSuiteEntries([{
    examId: 'suite-annotation-fallback',
    markedQuestions: [],
    metadata: { markedQuestions: ['q2'] }
}])[0]));
assert.deepStrictEqual(suiteEntry.markedQuestions, ['q2'],
    'suite normalization must skip an empty root annotation array when metadata has saved values');
assert.deepStrictEqual(suiteEntry.metadata.markedQuestions, ['q2']);
const explicitEmpty = JSON.parse(JSON.stringify(core.contracts.resolveAnnotationState(
    { markedQuestions: [] },
    [{ markedQuestions: ['stale'] }]
)));
assert.deepStrictEqual(explicitEmpty.markedQuestions, [],
    'normal record annotation edits must retain explicit-empty semantics');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'PracticeCore exposes only contracts, protocol and ingestor'
}, null, 2));
