import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class Element {
    constructor(tagName, document) {
        this.tagName = tagName;
        this.ownerDocument = document;
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.listeners = {};
        this._text = '';
        this._open = false;
        this.toggleQueued = false;
    }
    set open(value) {
        if (this._open === Boolean(value)) return;
        this._open = Boolean(value);
        if (this.toggleQueued) return;
        this.toggleQueued = true;
        queueMicrotask(() => {
            this.toggleQueued = false;
            this.listeners.toggle?.();
        });
    }
    get open() { return this._open; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_value) { throw new Error('Recovery data must never be rendered as HTML'); }
    set outerHTML(_value) { throw new Error('Recovery data must never be rendered as HTML'); }
    insertAdjacentHTML() { throw new Error('Recovery data must never be rendered as HTML'); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) {
        if (child.tagName === '#fragment') this.children.push(...child.children);
        else this.children.push(child);
        return child;
    }
    replaceChildren(...children) {
        this._text = '';
        this.children = [];
        children.forEach(child => this.appendChild(child));
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { this.listeners.click?.(); }
    querySelectorAll(selector) {
        assert.equal(selector, 'details[data-interrupted-id]');
        return descendants(this).filter(element => element.tagName === 'details'
            && Object.prototype.hasOwnProperty.call(element.dataset, 'interruptedId'));
    }
}

function descendants(element) {
    return element.children.flatMap(child => [child, ...descendants(child)]);
}

function matching(container, tag) {
    return descendants(container).filter(element => element.tagName === tag);
}

function flushDetails() {
    return new Promise(resolve => setImmediate(resolve));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function loadRenderer() {
    const document = {
        createElement(tag) { return new Element(tag, document); },
        createDocumentFragment() { return new Element('#fragment', document); }
    };
    const window = { document };
    vm.runInNewContext(fs.readFileSync(new URL('../../../js/components/interruptedPracticeHistory.js', import.meta.url), 'utf8'),
        { window }, { filename: 'interruptedPracticeHistory.js' });
    return { render: window.InterruptedPracticeHistory.render, container: document.createElement('section') };
}

function interrupted(overrides = {}) {
    return {
        id: 'interrupted-session-one',
        examId: 'reading-one',
        endTime: '2026-09-06T02:30:00.000Z',
        status: 'interrupted',
        reason: 'timeout',
        metadata: { examTitle: 'Reading one' },
        answers: { q1: 'My saved answer' },
        ...overrides
    };
}

test('reads exact-ID saved answers only on expansion without scored or replay controls', async () => {
    const { render, container } = loadRenderer();
    const record = interrupted({
        answers: { q1: 'My saved answer', q2: ['B', 'D'], q3: { userAnswer: 'own', correctAnswer: 'SECRET' },
            q4: { correctAnswer: 'SECRET' }, q5: '' },
        correctAnswers: { q1: 'SECRET' }, score: 99, percentage: 99
    });
    const reads = [];
    render({ container, records: [record], onLoadDetails: id => {
        reads.push(id);
        return { ...record, answers: { ...record.answers, q1: 'Fresh saved answer' } };
    } });
    await flushDetails();

    assert.match(container.textContent, /未完成 \/ 中断1 条/);
    assert.match(container.textContent, /30 天.*100 条/);
    assert.match(container.textContent, /Reading one中断/);
    assert.match(container.textContent, /中断原因：会话超时/);
    assert.equal(matching(container, 'time')[0].dateTime, '2026-09-06T02:30:00.000Z');
    assert.deepEqual(reads, [], 'collapsed rows do not read recovery details');
    assert.equal(matching(container, 'dd').length, 0);
    assert.equal(matching(container, 'summary')[0].textContent, '查看已保存答案');
    assert.doesNotMatch(container.textContent, /My saved answer/);

    matching(container, 'details')[0].open = true;
    await flushDetails();
    assert.deepEqual(reads, [record.id]);
    assert.deepEqual(matching(container, 'dt').map(element => element.textContent), ['题号 q1', '题号 q2', '题号 q3']);
    assert.deepEqual(matching(container, 'dd').map(element => element.textContent), ['Fresh saved answer', 'B, D', 'own']);
    assert.doesNotMatch(container.textContent, /SECRET|99|正确答案|正确率|回放|重做|继续练习/);
    assert.equal(matching(container, 'input').length, 0, 'interrupted records never acquire canonical bulk-selection controls');
    assert.equal(matching(container, 'summary')[0].textContent, '查看已保存答案（3）');
});

test('legacy answer arrays use user answers only and treat untrusted values as plain text', async () => {
    const { render, container } = loadRenderer();
    const title = '<img src=x onerror=alert(1)>';
    const answer = '<script>alert("saved")</script>';
    const record = interrupted({
        title,
        reason: '<b>custom interruption</b>',
        answers: [
            { questionId: '<q1>', userAnswer: answer, correctAnswer: 'SECRET', isCorrect: true },
            { questionId: 'q2', answer: 'Legacy saved response', correctAnswer: 'SECRET' },
            { questionId: 'q3', userAnswer: '', answer: 'Do not substitute', correctAnswer: 'SECRET' },
            { questionId: 'q4', correctAnswer: 'SECRET', isCorrect: true }
        ]
    });
    render({ container, records: [record], onLoadDetails: () => record });
    matching(container, 'details')[0].open = true;
    await flushDetails();

    assert.equal(matching(container, 'h4')[0].textContent, title);
    assert.deepEqual(matching(container, 'dd').map(element => element.textContent), [answer, 'Legacy saved response']);
    assert.deepEqual(matching(container, 'dt').map(element => element.textContent), ['题号 <q1>', '题号 q2']);
    assert.match(container.textContent, /<b>custom interruption<\/b>/);
    assert.equal(matching(container, 'script').length, 0);
    assert.equal(matching(container, 'img').length, 0);
    assert.doesNotMatch(container.textContent, /SECRET|Do not substitute/);
});

test('fresh empty answers explain the separate reading draft without using list-snapshot answers', async () => {
    const { render, container } = loadRenderer();
    render({ container, records: [interrupted()], onLoadDetails: () => interrupted({ answers: {} }) });
    const details = matching(container, 'details')[0];
    details.open = true;
    await flushDetails();
    assert.match(details.textContent, /查看已保存答案（0）/);
    assert.match(details.textContent, /此记录没有保存的答案/);
    assert.match(details.textContent, /阅读草稿单独保存，重新打开同一篇阅读可尝试恢复草稿/);
    assert.equal(matching(container, 'dd').length, 0);
    assert.doesNotMatch(details.textContent, /My saved answer/);
});

test('preserves expanded records across renders, refetches details and deletes the exact recovery ID', async () => {
    const { render, container } = loadRenderer();
    const removed = [];
    const first = interrupted();
    const second = interrupted({ id: 'interrupted-session-two', title: 'Reading two' });
    const reads = [];
    const options = { container, records: [first, second], onDelete: id => removed.push(id), onLoadDetails: id => {
        reads.push(id);
        return { ...second, answers: { q1: `Fresh load ${reads.length}` } };
    } };
    render(options);
    matching(container, 'details')[1].open = true;
    await flushDetails();
    render({ ...options, records: [second, first] });
    assert.deepEqual(matching(container, 'details').map(element => element.open), [true, false]);
    assert.equal(matching(container, 'dd').length, 0, 'rerender immediately drops previously loaded answers');
    await flushDetails();
    assert.deepEqual(reads, [second.id, second.id]);
    assert.deepEqual(matching(container, 'dd').map(element => element.textContent), ['Fresh load 2']);
    const button = matching(container, 'button')[0];
    assert.equal(button.type, 'button');
    assert.equal(button.attributes['aria-label'], '删除中断记录：Reading two');
    button.click();
    assert.deepEqual(removed, ['interrupted-session-two']);
    assert.equal(options.records.length, 2, 'renderer leaves persistence and state changes to the owner');
});

test('a record deleted or expired between list render and opening never displays stale answers', async () => {
    const { render, container } = loadRenderer();
    let currentRecord = interrupted();
    render({ container, records: [currentRecord], onLoadDetails: () => currentRecord });
    currentRecord = null;
    matching(container, 'details')[0].open = true;
    await flushDetails();
    assert.match(container.textContent, /已删除或超过保留期限/);
    assert.doesNotMatch(container.textContent, /My saved answer|此记录没有保存的答案/);
    assert.equal(matching(container, 'dd').length, 0);
    assert.equal(matching(container, 'li').length, 1, 'missing detail stays visible instead of silently refreshing the list');
});

test('detail failures remain explicit and retry reads only the same recovery record', async () => {
    const { render, container } = loadRenderer();
    const pending = deferred();
    const reads = [];
    let listRetries = 0;
    render({ container, records: [interrupted()], onRetry: () => { listRetries += 1; }, onLoadDetails: id => {
        reads.push(id);
        if (reads.length === 1) throw new Error('private detail failure');
        return pending.promise;
    } });
    matching(container, 'details')[0].open = true;
    await flushDetails();
    assert.match(container.textContent, /未完成记录详情读取失败/);
    assert.doesNotMatch(container.textContent, /My saved answer|private detail failure|此记录没有保存的答案/);
    assert.equal(matching(container, 'p').filter(element => element.attributes.role === 'alert').length, 1);
    const retry = matching(container, 'button')[0];
    assert.equal(retry.textContent, '重试读取答案');
    assert.equal(retry.type, 'button');
    retry.click();
    assert.match(container.textContent, /正在读取已保存答案/);
    assert.doesNotMatch(container.textContent, /读取失败|My saved answer/);
    pending.resolve(interrupted({ answers: { q2: 'Recovered on retry' } }));
    await flushDetails();
    assert.deepEqual(reads, ['interrupted-session-one', 'interrupted-session-one']);
    assert.deepEqual(matching(container, 'dd').map(element => element.textContent), ['Recovered on retry']);
    assert.equal(listRetries, 0, 'detail retry must not refresh away the row-level error');
});

test('closing and reopening invalidates in-flight responses and clears previously loaded answers', async () => {
    const { render, container } = loadRenderer();
    const requests = [deferred(), deferred(), deferred()];
    let reads = 0;
    render({ container, records: [interrupted()], onLoadDetails: () => requests[reads++].promise });
    const details = matching(container, 'details')[0];
    const summary = matching(details, 'summary')[0];
    details.open = true;
    await flushDetails();
    assert.match(details.textContent, /正在读取已保存答案/);
    summary.click();
    details.open = false;
    summary.click();
    details.open = true;
    requests[0].resolve(interrupted({ answers: { q1: 'Obsolete first response' } }));
    await flushDetails();
    assert.equal(reads, 2, 'rapid native close/reopen starts a fresh read');
    assert.doesNotMatch(details.textContent, /Obsolete first response|My saved answer/);
    requests[1].resolve(interrupted({ answers: { q1: 'Current second response' } }));
    await flushDetails();
    assert.match(details.textContent, /Current second response/);
    summary.click();
    details.open = false;
    assert.doesNotMatch(details.textContent, /Current second response/, 'summary activation clears answers before queued toggle');
    await flushDetails();
    details.open = true;
    await flushDetails();
    details.open = false;
    await flushDetails();
    requests[2].reject(new Error('old request failed after closing'));
    await flushDetails();
    assert.equal(details.textContent, '查看已保存答案', 'late failures cannot repopulate collapsed details');
});

test('rerender invalidates old detail responses while retained-open rows fetch current recovery state', async () => {
    const { render, container } = loadRenderer();
    const requests = [deferred(), deferred()];
    let reads = 0;
    const options = { container, records: [interrupted()], onLoadDetails: () => requests[reads++].promise };
    render(options);
    const detachedDetails = matching(container, 'details')[0];
    detachedDetails.open = true;
    await flushDetails();
    render(options);
    const currentDetails = matching(container, 'details')[0];
    assert.equal(currentDetails.open, true);
    await flushDetails();
    assert.equal(reads, 2);
    requests[1].resolve(null);
    await flushDetails();
    requests[0].resolve(interrupted({ answers: { q1: 'Stale detached response' } }));
    await flushDetails();
    assert.match(currentDetails.textContent, /已删除或超过保留期限/);
    assert.doesNotMatch(container.textContent, /Stale detached response|My saved answer/);
    assert.doesNotMatch(detachedDetails.textContent, /Stale detached response/);
    detachedDetails.open = false;
    await flushDetails();
    detachedDetails.open = true;
    await flushDetails();
    assert.equal(reads, 2, 'detached rows cannot start additional recovery reads');
});

test('read failure offers retry without displaying an empty success or stale record count', () => {
    const { render, container } = loadRenderer();
    let retries = 0;
    render({ container, records: [interrupted()], error: new Error('private backend detail'), onRetry: () => { retries += 1; } });
    assert.match(container.textContent, /读取失败/);
    assert.doesNotMatch(container.textContent, /暂无|private backend detail|Reading one/);
    assert.equal(matching(container, 'span')[0].textContent, '读取失败');
    assert.equal(matching(container, 'li').length, 0);
    assert.equal(matching(container, 'p').filter(element => element.attributes.role === 'alert').length, 1);
    const retry = matching(container, 'button')[0];
    assert.equal(retry.type, 'button');
    assert.equal(retry.textContent, '重试');
    retry.click();
    assert.equal(retries, 1);
    render({ container, records: [] });
    assert.match(container.textContent, /0 条/);
    assert.match(container.textContent, /暂无未完成 \/ 中断记录/);
    assert.equal(matching(container, 'button').length, 0);
});
