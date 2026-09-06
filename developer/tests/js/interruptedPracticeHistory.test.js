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
        this.open = false;
    }
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

test('renders interrupted metadata and saved answers without scored or replay controls', () => {
    const { render, container } = loadRenderer();
    render({ container, records: [interrupted({
        answers: { q1: 'My saved answer', q2: ['B', 'D'], q3: { userAnswer: 'own', correctAnswer: 'SECRET' },
            q4: { correctAnswer: 'SECRET' }, q5: '' },
        correctAnswers: { q1: 'SECRET' }, score: 99, percentage: 99
    })] });

    assert.match(container.textContent, /未完成 \/ 中断1 条/);
    assert.match(container.textContent, /30 天.*100 条/);
    assert.match(container.textContent, /Reading one中断/);
    assert.match(container.textContent, /中断原因：会话超时/);
    assert.equal(matching(container, 'time')[0].dateTime, '2026-09-06T02:30:00.000Z');
    assert.deepEqual(matching(container, 'dt').map(element => element.textContent), ['题号 q1', '题号 q2', '题号 q3']);
    assert.deepEqual(matching(container, 'dd').map(element => element.textContent), ['My saved answer', 'B, D', 'own']);
    assert.doesNotMatch(container.textContent, /SECRET|99|正确答案|正确率|回放|重做|继续练习/);
    assert.equal(matching(container, 'input').length, 0, 'interrupted records never acquire canonical bulk-selection controls');
    assert.equal(matching(container, 'details')[0].open, false);
    assert.equal(matching(container, 'summary')[0].textContent, '查看已保存答案（3）');
});

test('legacy answer arrays use user answers only and treat untrusted values as plain text', () => {
    const { render, container } = loadRenderer();
    const title = '<img src=x onerror=alert(1)>';
    const answer = '<script>alert("saved")</script>';
    render({ container, records: [interrupted({
        title,
        reason: '<b>custom interruption</b>',
        answers: [
            { questionId: '<q1>', userAnswer: answer, correctAnswer: 'SECRET', isCorrect: true },
            { questionId: 'q2', answer: 'Legacy saved response', correctAnswer: 'SECRET' },
            { questionId: 'q3', userAnswer: '', answer: 'Do not substitute', correctAnswer: 'SECRET' },
            { questionId: 'q4', correctAnswer: 'SECRET', isCorrect: true }
        ]
    })] });

    assert.equal(matching(container, 'h4')[0].textContent, title);
    assert.deepEqual(matching(container, 'dd').map(element => element.textContent), [answer, 'Legacy saved response']);
    assert.deepEqual(matching(container, 'dt').map(element => element.textContent), ['题号 <q1>', '题号 q2']);
    assert.match(container.textContent, /<b>custom interruption<\/b>/);
    assert.equal(matching(container, 'script').length, 0);
    assert.equal(matching(container, 'img').length, 0);
    assert.doesNotMatch(container.textContent, /SECRET|Do not substitute/);
});

test('empty saved answers explain the separately stored reading draft', () => {
    const { render, container } = loadRenderer();
    render({ container, records: [interrupted({ answers: {} })] });
    const details = matching(container, 'details')[0];
    assert.match(details.textContent, /查看已保存答案（0）/);
    assert.match(details.textContent, /此记录没有保存的答案/);
    assert.match(details.textContent, /阅读草稿单独保存，重新打开同一篇阅读可尝试恢复草稿/);
    assert.equal(matching(container, 'dd').length, 0);
});

test('preserves expanded records across renders and deletes the exact recovery ID', () => {
    const { render, container } = loadRenderer();
    const removed = [];
    const first = interrupted();
    const second = interrupted({ id: 'interrupted-session-two', title: 'Reading two' });
    const options = { container, records: [first, second], onDelete: id => removed.push(id) };
    render(options);
    matching(container, 'details')[1].open = true;
    render({ ...options, records: [second, first] });
    assert.deepEqual(matching(container, 'details').map(element => element.open), [true, false]);
    const button = matching(container, 'button')[0];
    assert.equal(button.type, 'button');
    assert.equal(button.attributes['aria-label'], '删除中断记录：Reading two');
    button.click();
    assert.deepEqual(removed, ['interrupted-session-two']);
    assert.equal(options.records.length, 2, 'renderer leaves persistence and state changes to the owner');
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
