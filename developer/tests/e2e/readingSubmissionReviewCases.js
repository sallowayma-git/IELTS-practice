import assert from 'node:assert/strict';

export async function runEditedResubmission(host, child, outcome) {
    await host.evaluate(outcome => {
        window.reviewSubmissions = [];
        const original = window.app.handlePracticeComplete;
        window.app.handlePracticeComplete = function (examId, data, source, options) {
            reviewSubmissions.push(structuredClone(data));
            if (reviewSubmissions.length === 1) {
                if (outcome === 'nack') this._announcePracticeSubmitOutcome(examId, data, source, false,
                    { errorCode: 'QUOTA_EXCEEDED' });
                return false; // No persistence on the first attempt.
            }
            return original.call(this, examId, data, source, options);
        };
    }, outcome);
    await child.locator('#question-groups input[name="q1"][value="A"]').check();
    await child.locator('#submit-btn').click();
    await host.waitForFunction(() => reviewSubmissions.length === 1);
    if (outcome === 'timeout') await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.expirePendingSubmission());
    await child.locator('.incident-dialog').waitFor();
    await child.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true }).click();
    await child.locator('#question-groups input[name="q1"][value="B"]').check();
    await child.locator('#submit-btn').click();
    await child.waitForFunction(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().submissionStatus === 'submitted');
    const { messages, records } = await host.evaluate(async () => ({ messages: reviewSubmissions, records: await AppData.practice.list() }));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].answers.q1, 'A');
    assert.equal(messages[1].answers.q1, 'B');
    assert.notEqual(messages[1].submissionId, messages[0].submissionId);
    assert.equal(messages[1].readingTiming.frozen, true);
    assert.ok(messages[1].readingTiming.revision > messages[0].readingTiming.revision, 'edited timing is frozen again');
    assert.equal(records.length, 1);
    assert.equal(records[0].answers.q1, 'B');
    assert.equal(await child.locator('#question-groups input[name="q1"][value="B"]').isChecked(), true);
    assert.equal(await child.locator('#question-groups input[name="q1"][value="B"]').isDisabled(), true);
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
    await child.exposeFunction('captureReviewClose', snapshot => { closeSnapshot = snapshot; });
    await child.evaluate(keepOpen => {
        const original = window.close.bind(window);
        window.close = () => {
            const snapshot = { state: __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState(),
                rows: document.querySelectorAll('#results tbody tr').length };
            return window.captureReviewClose(snapshot).then(() => { if (!keepOpen) original(); });
        };
    }, keepOpen);
    if (!keepOpen) {
        await Promise.all([child.waitForEvent('close', { timeout: 5000 }), releaseAck.evaluate(fn => fn())]);
    } else {
        await releaseAck.evaluate(fn => fn());
        await child.waitForFunction(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().readOnly);
        await child.locator('#results tbody tr').first().waitFor();
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
