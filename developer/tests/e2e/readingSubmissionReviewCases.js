import assert from 'node:assert/strict';

async function assertAnswerEditingLocked(child) {
    const answer = child.locator('#question-groups input[name="q1"][value="B"]');
    assert.equal(await answer.isDisabled(), true, 'unconfirmed answers cannot be edited');
    assert.equal(await child.locator('#question-groups').evaluate(root => root.inert), true);
    await answer.scrollIntoViewIfNeeded();
    const box = await answer.boundingBox();
    assert.ok(box);
    await child.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await answer.isChecked(), false, 'a native click cannot change the pending snapshot');
    assert.equal(await child.locator('#question-groups input[name="q1"][value="A"]').isChecked(), true);
}

async function selectPassage(child, part, examId) {
    await child.locator(`#part-section-${part} .part-nav-name`).click();
    await child.waitForFunction(examId => {
        const state = __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
        return state.examId === examId && !state.suiteActivating;
    }, examId);
}

export async function runRejectedResubmission(host, child, outcome) {
    await host.evaluate(outcome => {
        window.reviewSubmissions = [];
        const original = window.app.handlePracticeComplete;
        window.app.handlePracticeComplete = function (examId, data, source, options) {
            reviewSubmissions.push(structuredClone(data));
            if (reviewSubmissions.length === 1) {
                if (outcome !== 'timeout') this._announcePracticeSubmitOutcome(examId, data, source, false,
                    { errorCode: 'QUOTA_EXCEEDED', operation: outcome === 'not-committed' ? outcome : 'unconfirmed' });
                return false; // No persistence on the first attempt.
            }
            return original.call(this, examId, data, source, options);
        };
    }, outcome);
    await child.locator('#question-groups input[name="q1"][value="A"]').check();
    await child.locator('#submit-btn').click();
    await host.waitForFunction(() => reviewSubmissions.length === 1);
    if (outcome === 'timeout') await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.expirePendingSubmission());
    const editable = outcome === 'not-committed';
    if (editable) {
        await child.waitForFunction(() => !__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionEditingLocked);
        await child.locator('.incident-notice').first().waitFor();
    } else {
        await child.locator('.incident-dialog').waitFor();
        await child.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true }).click();
    }
    if (editable) await child.locator('#question-groups input[name="q1"][value="B"]').check();
    else await assertAnswerEditingLocked(child);
    await child.locator('#submit-btn').click();
    await child.waitForFunction(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'submitted');
    const { messages, records } = await host.evaluate(async () => ({ messages: reviewSubmissions, records: await AppData.practice.list() }));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].answers.q1, 'A');
    assert.equal(messages[1].answers.q1, editable ? 'B' : 'A');
    assert.equal(messages[1].submissionId === messages[0].submissionId, !editable);
    assert.equal(messages[1].readingTiming.frozen, true);
    if (editable) assert.ok(messages[1].readingTiming.revision > messages[0].readingTiming.revision, 'edited timing is frozen again');
    else assert.deepEqual(messages[1].readingTiming, messages[0].readingTiming, 'reconciliation never refreezes timing');
    assert.equal(records.length, 1);
    assert.equal(records[0].answers.q1, editable ? 'B' : 'A');
    assert.equal(await child.locator(`#question-groups input[name="q1"][value="${editable ? 'B' : 'A'}"]`).isChecked(), true);
    assert.equal(await child.locator('#question-groups input[name="q1"][value="B"]').isDisabled(), true);
}

export async function runCommittedAcknowledgementLoss(host, child, suite) {
    await child.locator('#question-groups input[name="q1"][value="A"]').check();
    if (suite) await selectPassage(child, 3, 'p3-high-32');
    await host.evaluate(() => {
        window.reviewSubmissions = [];
        window.reviewCompleted = 0;
        const complete = window.app.handlePracticeComplete;
        window.app.handlePracticeComplete = async function (...args) {
            reviewSubmissions.push(structuredClone(args[1]));
            const result = await complete.apply(this, args);
            reviewCompleted++;
            return result;
        };
        window.reviewOriginalPost = window.app._postExamMessage;
        window.app._postExamMessage = function (examId, target, type, data) {
            if (type === 'PRACTICE_SUBMIT_ACK') return true; // The actual write and receipt both succeed.
            return reviewOriginalPost.call(this, examId, target, type, data);
        };
    });
    await child.locator('#submit-btn').click();
    await host.waitForFunction(() => reviewCompleted === 1);
    const saved = await host.evaluate(async () => AppData.practice.list());
    assert.equal(saved.length, 1, 'the first write really committed before the timeout');
    if (suite) assert.equal(await host.evaluate(() => window.app.currentSuiteSession.status), 'completed');
    await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.expirePendingSubmission());
    await child.locator('.incident-dialog').waitFor();
    await child.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true }).click();
    if (suite) await selectPassage(child, 1, 'p1-low-67');
    await assertAnswerEditingLocked(child);
    if (suite) await selectPassage(child, 3, 'p3-high-32');
    assert.equal(await child.locator('#submit-btn').getAttribute('aria-label'), '确认上次提交');
    await host.evaluate(() => { window.app._postExamMessage = reviewOriginalPost; });
    if (suite) await Promise.all([child.waitForEvent('close', { timeout: 5000 }), child.locator('#submit-btn').click()]);
    else {
        await child.locator('#submit-btn').click();
        await child.waitForFunction(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'submitted');
        assert.equal(await child.locator('#question-groups input[name="q1"][value="A"]').isChecked(), true);
    }
    await host.waitForFunction(() => reviewCompleted === 2);
    const { messages, records } = await host.evaluate(async () => ({ messages: reviewSubmissions, records: await AppData.practice.list() }));
    assert.equal(messages.length, 2);
    assert.equal(messages[1].submissionId, messages[0].submissionId);
    assert.deepEqual(messages[1].answers, messages[0].answers);
    assert.deepEqual(messages[1].suiteEntries, messages[0].suiteEntries);
    assert.deepEqual(messages[1].readingTiming, messages[0].readingTiming);
    assert.deepEqual(records, saved, 'receipt reconciliation neither replaces nor duplicates the committed record');
}

export async function runDelayedSuiteAcknowledgement(host, child, keepOpen) {
    await child.locator('#part-section-3 .part-nav-name').click();
    await child.waitForFunction(() => {
        const state = __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
        return state.examId === 'p3-high-32' && !state.suiteActivating;
    });
    await host.evaluate(() => {
        const original = window.app._postExamMessage;
        window.app._postExamMessage = function (examId, target, type, data) {
            if (type === 'PRACTICE_SUBMIT_ACK') {
                window.releaseReviewAck = () => original.call(this, examId, target, type, data);
                return true;
            }
            return original.call(this, examId, target, type, data);
        };
    });
    await child.locator('#submit-btn').click();
    await host.waitForFunction(() => typeof window.releaseReviewAck === 'function'
        && window.app.currentSuiteSession?.status === 'completed');
    assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 1);
    const releaseAck = await host.evaluateHandle(() => window.releaseReviewAck);
    assert.equal(await releaseAck.evaluate(fn => typeof fn), 'function');
    await child.locator('#part-section-1 .part-nav-name').click();
    await child.waitForFunction(() => {
        const state = __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
        return state.examId === 'p1-low-67' && !state.suiteActivating;
    });
    let closeSnapshot;
    let resolveClose;
    const finalized = new Promise(resolve => { resolveClose = resolve; });
    await child.exposeFunction('captureReviewClose', snapshot => { closeSnapshot = snapshot; resolveClose(); });
    await child.evaluate(keepOpen => {
        const original = window.close.bind(window);
        window.close = () => {
            const snapshot = { state: __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState(),
                rows: document.querySelectorAll('#results tbody tr').length };
            return window.captureReviewClose(snapshot).then(() => { if (!keepOpen) original(); });
        };
        if (keepOpen) {
            // Hold the real explanation script so results become visible while
            // the ACK is still awaiting asset loading in every hosting mode.
            const append = document.head.appendChild;
            document.head.appendChild = function (node) {
                if (node instanceof HTMLScriptElement && node.src.includes('/reading-explanations/p1-low-67.js')) {
                    document.head.appendChild = append;
                    window.releaseReviewExplanation = () => { append.call(this, node); };
                    return node;
                }
                return append.call(this, node);
            };
        }
    }, keepOpen);
    if (!keepOpen) {
        await Promise.all([child.waitForEvent('close', { timeout: 5000 }), releaseAck.evaluate(fn => fn())]);
    } else {
        await releaseAck.evaluate(fn => fn());
        await child.waitForFunction(() => typeof window.releaseReviewExplanation === 'function');
        assert.equal(await child.locator('#results tbody tr').count(), 13);
        assert.equal(closeSnapshot, undefined, 'visible results do not imply ACK finalization');
        await child.evaluate(() => window.releaseReviewExplanation());
        // Results precede asynchronous explanation loading and finalization.
        // Navigation must wait until the ACK continuation actually requests close.
        let deadline;
        try {
            await Promise.race([finalized, new Promise((_, reject) => {
                deadline = setTimeout(() => reject(new Error('ACK finalization did not request close')), 5000);
            })]);
        } finally { clearTimeout(deadline); }
        assert.equal(await child.locator('#results tbody tr').count(), 13);
        for (const [part, examId, rows] of [[3, 'p3-high-32', 14], [1, 'p1-low-67', 13]]) {
            await child.locator(`#part-section-${part} .part-nav-name`).click();
            await child.waitForFunction(examId => {
                const state = __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
                return state.examId === examId && !state.suiteActivating;
            }, examId);
            assert.equal(await child.locator('#results tbody tr').count(), rows);
        }
    }
    assert.ok(closeSnapshot, 'the original final submission requests immediate self-close');
    assert.equal(closeSnapshot.state.examId, 'p1-low-67');
    assert.equal(closeSnapshot.state.readOnly, true);
    assert.equal(closeSnapshot.state.submissionStatus, 'submitted');
    assert.equal(closeSnapshot.rows, 13, 'the active P1 shows its own results at finalization');
    assert.equal(await host.evaluate(async () => (await AppData.practice.list()).length), 1);
}
