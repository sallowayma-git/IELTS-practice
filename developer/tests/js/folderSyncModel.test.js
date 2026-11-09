import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
const context = vm.createContext({ crypto: webcrypto, TextEncoder });
vm.runInContext(fs.readFileSync(new URL('../../../js/data/v2/syncModel.js', import.meta.url), 'utf8'), context);
const m = context.FolderSyncModel, copy = value => JSON.parse(JSON.stringify(value));
const SPACE = 'space-test-0001';
function empty() { return { documents: {}, entities: Object.fromEntries(m.STORES.map(store => [store, []])) }; }
function record(id, note = '') { return { practiceSummaries: { id, examId: 'same-article', title: id },
    practiceDetails: { recordId: id, answers: { 1: 'yes' } }, practiceAnnotations: { recordId: id, note } }; }
function put(snapshot, id, value = record(id)) {
    for (const store of m.STORES) {
        snapshot.entities[store] = snapshot.entities[store].filter(row => row.recordId !== id);
        if (value) snapshot.entities[store].push({ recordId: id, data: copy(value[store]) });
    }
}
function client(snapshot = empty()) {
    const state = m.newState(SPACE); m.capture(state, snapshot, 'seed');
    return { state, snapshot: copy(snapshot) };
}
function apply(client, op) {
    m.receive(client.state, copy(op));
    client.snapshot = m.toSnapshot(client.state, client.snapshot); m.rememberMaterialized(client.state, client.snapshot);
}
function exchange(a, b) {
    const left = copy(a.state.pending), right = copy(b.state.pending);
    left.forEach(op => apply(b, op)); right.forEach(op => apply(a, op));
}
test('SHA-256 matches Node for canonical Unicode JSON and long input', () => {
    for (const value of ['', 'abc', { 中文: '✓'.repeat(300), a: [null, true, 42] }]) {
        assert.equal(m.digest(value), createHash('sha256').update(m.stable(value)).digest('hex'));
    }
});
test('independent offline attempts of one article union; repeats are idempotent', () => {
    const a = client(), b = client(); exchange(a, b);
    put(a.snapshot, 'attempt-A'); m.capture(a.state, a.snapshot, 'done-a');
    put(b.snapshot, 'attempt-B'); m.capture(b.state, b.snapshot, 'done-b');
    exchange(a, b); exchange(a, b);
    assert.deepEqual(copy(a.snapshot), copy(b.snapshot));
    assert.equal(a.snapshot.entities.practiceSummaries.length, 2);
    assert.equal(m.status(a.state).conflicts.length, 0);
});
test('causal updates work in reverse order without skipping unrelated earlier operations', () => {
    const a = client(), b = client(); exchange(a, b);
    put(a.snapshot, 'one'); m.capture(a.state, a.snapshot, 'one');
    put(a.snapshot, 'two'); m.capture(a.state, a.snapshot, 'two');
    put(a.snapshot, 'one', record('one', 'new')); m.capture(a.state, a.snapshot, 'edit');
    for (const op of [...a.state.pending].reverse()) apply(b, op);
    assert.equal(b.snapshot.entities.practiceSummaries.length, 2);
    assert.equal(b.snapshot.entities.practiceAnnotations.find(row => row.recordId === 'one').data.note, 'new');
});
test('concurrent notes preserve alternatives; resolution dominates on both devices', () => {
    const initial = empty(); put(initial, 'same');
    const a = client(initial), b = client(initial); exchange(a, b);
    put(a.snapshot, 'same', record('same', 'alpha')); m.capture(a.state, a.snapshot, 'edit-a');
    put(b.snapshot, 'same', record('same', 'beta')); m.capture(b.state, b.snapshot, 'edit-b');
    exchange(a, b);
    assert.equal(m.status(a.state).conflicts.length, 1);
    assert.deepEqual(copy(a.snapshot), copy(b.snapshot));
    const conflict = m.status(a.state).conflicts[0];
    const selected = conflict.versions.find(head => head.value.value.practiceAnnotations.note === 'beta');
    m.resolve(a.state, conflict.key, selected.id);
    const op = a.state.pending.at(-1); apply(a, op); apply(b, op);
    assert.equal(m.status(b.state).conflicts.length, 0);
    assert.equal(b.snapshot.entities.practiceAnnotations[0].data.note, 'beta');
});
test('different annotation fields merge and delete versus edit remains a conflict', () => {
    const initial = empty(); put(initial, 'same');
    const a = client(initial), b = client(initial); exchange(a, b);
    const left = record('same'), right = record('same');
    left.practiceAnnotations.markA = true; right.practiceAnnotations.markB = true;
    put(a.snapshot, 'same', left); put(b.snapshot, 'same', right);
    m.capture(a.state, a.snapshot, 'mark-a'); m.capture(b.state, b.snapshot, 'mark-b'); exchange(a, b);
    assert.equal(m.status(a.state).conflicts.length, 0);
    assert.equal(a.snapshot.entities.practiceAnnotations[0].data.markA, true);
    assert.equal(a.snapshot.entities.practiceAnnotations[0].data.markB, true);
    put(a.snapshot, 'same', null); m.capture(a.state, a.snapshot, 'delete');
    put(b.snapshot, 'same', record('same', 'offline edit')); m.capture(b.state, b.snapshot, 'edit'); exchange(a, b);
    assert.equal(m.status(a.state).conflicts.length, 1);
    assert.equal(a.snapshot.entities.practiceSummaries.length, 1);
});
test('all permutations of offline operations converge including tombstones', () => {
    const a = client(), b = client(); exchange(a, b);
    put(a.snapshot, 'A'); m.capture(a.state, a.snapshot, 'A');
    put(b.snapshot, 'B'); m.capture(b.state, b.snapshot, 'B');
    put(a.snapshot, 'A', null); m.capture(a.state, a.snapshot, 'delete-A');
    const ops = [...copy(a.state.pending), ...copy(b.state.pending)];
    let expected;
    for (let i = 0; i < 12; i++) {
        const c = client();
        const shuffled = [...ops].sort((x, y) => m.digest([i, x.id]).localeCompare(m.digest([i, y.id])));
        shuffled.forEach(op => apply(c, op)); shuffled.forEach(op => apply(c, op));
        const snapshot = m.stable(c.snapshot);
        if (!expected) expected = snapshot;
        assert.equal(snapshot, expected);
        assert.deepEqual(copy(c.snapshot.entities.practiceSummaries.map(row => row.recordId)), ['B']);
    }
});
test('independent vocabulary items union and review-state conflicts remain atomic', () => {
    const a = client(), b = client(); exchange(a, b);
    a.snapshot.documents['vocab.words'] = [{ id: 'a', word: 'apple' }];
    b.snapshot.documents['vocab.words'] = [{ id: 'b', word: 'boat' }];
    m.capture(a.state, a.snapshot, 'word-a'); m.capture(b.state, b.snapshot, 'word-b'); exchange(a, b);
    assert.equal(a.snapshot.documents['vocab.words'].length, 2);
    assert.equal(m.status(a.state).conflicts.length, 0);
});
test('same operation id with changed content, wrong space and prototype payload are rejected', () => {
    const a = client(), b = client(); exchange(a, b);
    put(a.snapshot, 'valid');
    m.capture(a.state, a.snapshot, 'valid');
    exchange(a, b);
    const changed = copy(a.state.pending[0]); changed.sourceId = 'tampered';
    assert.throws(() => apply(b, changed), /不同内容/);
    const wrong = copy(a.state.pending[0]); wrong.spaceId = 'different-space';
    assert.throws(() => apply(b, wrong), /当前数据空间/);
    const bad = JSON.parse('{"__proto__":{"bad":true}}');
    assert.throws(() => m.safeJson(bad), /不安全/);
});
test('large remote deletion is durably held for explicit approval', () => {
    const initial = empty();
    for (let i = 0; i < 120; i++) put(initial, 'bulk-' + i);
    const a = client(initial), b = client(initial); exchange(a, b);
    for (let i = 0; i < 120; i++) put(a.snapshot, 'bulk-' + i, null);
    m.capture(a.state, a.snapshot, 'bulk-delete');
    const deletion = a.state.pending.at(-1);
    apply(b, deletion);
    assert.equal(b.snapshot.entities.practiceSummaries.length, 120);
    assert.equal(m.status(b.state).blocked[0].count, 120);
    m.receive(b.state, deletion, true);
    b.snapshot = m.toSnapshot(b.state, b.snapshot);
    assert.equal(b.snapshot.entities.practiceSummaries.length, 0);
    assert.equal(m.status(b.state).blocked.length, 0);
});
