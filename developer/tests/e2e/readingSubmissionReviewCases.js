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

function assertImmutableSubmissionReplay(actual, expected, message) {
    const { messageIssuedAtMs: _actualTransportTime, ...actualSnapshot } = actual;
    const { messageIssuedAtMs: _expectedTransportTime, ...expectedSnapshot } = expected;
    assert.deepEqual(actualSnapshot, expectedSnapshot, message);
}

function incidentForEvent(child, selector, eventId) {
    return child.locator(selector).filter({ hasText: eventId });
}

async function dismissUnconfirmedIncident(child, eventId, { required = true } = {}) {
    const dialog = incidentForEvent(child, '.incident-dialog', eventId);
    if (required) await dialog.waitFor({ state: 'visible' });
    else if (!await dialog.isVisible()) return false;
    await dialog.getByRole('button', { name: '关闭提示（不代表已保存）', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    return true;
}

async function waitForSubmissionDiagnostic(child, { submissionId, code, operation, excludedEventIds = [] }, message) {
    const handle = await child.waitForFunction(({ submissionId, code, operation, excludedEventIds }) => {
        if (!submissionId) return false;
        const alias = AppDiagnostics.correlate({ submission: submissionId }).submission;
        const excluded = new Set(excludedEventIds);
        const event = [...AppDiagnostics.snapshot().events].reverse().find(entry => (
            entry.code === code
                && entry.action === 'submit'
                && entry.persistence?.operation === operation
                && entry.correlation?.submission === alias
                && !excluded.has(entry.eventId)
        ));
        return event ? { eventId: event.eventId, submissionId, code, operation } : false;
    }, { submissionId, code, operation, excludedEventIds });
    const event = await handle.jsonValue();
    await handle.dispose();
    assert.ok(event?.eventId, message);
    return event;
}

async function submissionTimeoutEventIds(child) {
    return child.evaluate(() => AppDiagnostics.snapshot().events.filter(event => (
        event.code === 'PRACTICE_CHANNEL_TIMEOUT'
            && event.action === 'submit'
            && event.persistence?.operation === 'unconfirmed'
    )).map(event => event.eventId));
}

async function waitForSubmittedOrNewTimeout(child, excludedEventIds, message) {
    const handle = await child.waitForFunction((excludedEventIds) => {
        const state = __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState();
        if (state.submissionStatus === 'submitted') {
            return state.submissionId ? { status: 'submitted', submissionId: state.submissionId } : false;
        }
        if (state.submissionStatus !== 'draft' || !state.submissionEditingLocked || !state.submissionId) {
            return false;
        }
        const alias = AppDiagnostics.correlate({ submission: state.submissionId }).submission;
        const excluded = new Set(excludedEventIds);
        const event = [...AppDiagnostics.snapshot().events].reverse().find(entry => (
            entry.code === 'PRACTICE_CHANNEL_TIMEOUT'
                && entry.action === 'submit'
                && entry.persistence?.operation === 'unconfirmed'
                && entry.correlation?.submission === alias
                && !excluded.has(entry.eventId)
        ));
        return event ? { status: 'timeout', submissionId: state.submissionId, eventId: event.eventId } : false;
    }, excludedEventIds);
    const resolution = await handle.jsonValue();
    await handle.dispose();
    assert.ok(resolution?.submissionId, message);
    assert.ok(resolution.status === 'submitted' || (resolution.status === 'timeout' && resolution.eventId), message);
    return resolution;
}

export async function expireOrObservePendingSubmissionTimeout(child, message) {
    const outcome = await child.evaluate(() => {
        const api = __IELTS_UNIFIED_READING_PAGE_TEST__;
        const before = api.getTestState();
        const submissionAlias = before.submissionId
            ? AppDiagnostics.correlate({ submission: before.submissionId }).submission
            : '';
        const expired = before.submissionStatus === 'submitting'
            ? api.expirePendingSubmission()
            : false;
        const after = api.getTestState();
        const timeoutEvent = [...AppDiagnostics.snapshot().events].reverse().find(event => (
            event.code === 'PRACTICE_CHANNEL_TIMEOUT'
                && event.action === 'submit'
                && event.persistence?.operation === 'unconfirmed'
                && event.correlation?.submission === submissionAlias
        ));
        return {
            beforeStatus: before.submissionStatus,
            beforeLocked: before.submissionEditingLocked,
            beforeSubmissionId: before.submissionId,
            expired,
            afterStatus: after.submissionStatus,
            afterLocked: after.submissionEditingLocked,
            afterSubmissionId: after.submissionId,
            timeoutEvent: timeoutEvent ? { eventId: timeoutEvent.eventId } : null
        };
    });
    assert.ok(outcome.beforeSubmissionId, `${message}: submission ID must be present`);
    assert.equal(outcome.afterSubmissionId, outcome.beforeSubmissionId, `${message}: submission ID must remain stable`);
    assert.ok(
        (outcome.beforeStatus === 'submitting' && outcome.expired === true)
            || (outcome.beforeStatus === 'draft' && outcome.beforeLocked === true && outcome.timeoutEvent),
        message
    );
    assert.ok(outcome.timeoutEvent?.eventId, `${message}: matching timeout evidence must be recorded`);
    assert.equal(outcome.afterStatus, 'draft', `${message}: submission must be restored to draft`);
    assert.equal(outcome.afterLocked, true, `${message}: unconfirmed answers must remain locked`);
    return { submissionId: outcome.afterSubmissionId, eventId: outcome.timeoutEvent.eventId };
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
        window.reviewCompleted = 0;
        window.reviewFirstOutcomeDelivered = null;
        window.reviewSecondAttemptStarted = false;
        window.reviewReleaseSecondAttempt = null;
        const original = window.app.handlePracticeComplete;
        window.app.handlePracticeComplete = async function (examId, data, source, options) {
            reviewSubmissions.push(structuredClone(data));
            try {
                if (reviewSubmissions.length === 1) {
                    if (outcome !== 'timeout') reviewFirstOutcomeDelivered = this._announcePracticeSubmitOutcome(
                        examId, data, source, false,
                        { errorCode: 'QUOTA_EXCEEDED', operation: outcome === 'not-committed' ? outcome : 'unconfirmed' }
                    );
                    return false; // No persistence on the first attempt.
                }
                if (outcome === 'timeout' && reviewSubmissions.length === 2) {
                    reviewSecondAttemptStarted = true;
                    await new Promise(resolve => { reviewReleaseSecondAttempt = resolve; });
                }
                return await original.call(this, examId, data, source, options);
            } finally {
                reviewCompleted++;
            }
        };
    }, outcome);
    await child.locator('#question-groups input[name="q1"][value="A"]').check();
    await child.locator('#submit-btn').click();
    await host.waitForFunction(() => reviewCompleted >= 1);
    const firstAttempt = await host.evaluate(() => ({
        submission: reviewSubmissions[0],
        outcomeDelivered: reviewFirstOutcomeDelivered
    }));
    assert.ok(firstAttempt.submission?.submissionId, 'the rejected submission must have a stable ID');
    let initialIncident;
    if (outcome === 'timeout') {
        initialIncident = await expireOrObservePendingSubmissionTimeout(
            child,
            'the timeout fixture must expire or observe expiry of the pending submission it created'
        );
    } else {
        assert.equal(firstAttempt.outcomeDelivered, true, 'the rejection fixture must deliver its NACK');
        initialIncident = await waitForSubmissionDiagnostic(child, {
            submissionId: firstAttempt.submission.submissionId,
            code: 'PRACTICE_SAVE_FAILED',
            operation: outcome === 'not-committed' ? 'not-committed' : 'unconfirmed'
        }, 'the rejection must record the exact expected submission diagnostic');
    }
    const editable = outcome === 'not-committed';
    const initialState = await child.evaluate(() => __IELTS_UNIFIED_READING_PAGE_TEST__.getTestState());
    assert.equal(initialState.submissionStatus, 'draft');
    assert.equal(initialState.submissionEditingLocked, !editable);
    if (editable) {
        await incidentForEvent(child, '.incident-notice', initialIncident.eventId).waitFor({ state: 'visible' });
    } else {
        await dismissUnconfirmedIncident(child, initialIncident.eventId);
    }
    if (editable) await child.locator('#question-groups input[name="q1"][value="B"]').check();
    else await assertAnswerEditingLocked(child);
    const priorTimeouts = await submissionTimeoutEventIds(child);
    await child.locator('#submit-btn').click();
    let forcedSecondIncident = null;
    if (outcome === 'timeout') {
        await host.waitForFunction(() => reviewSecondAttemptStarted && typeof reviewReleaseSecondAttempt === 'function');
        forcedSecondIncident = await expireOrObservePendingSubmissionTimeout(
            child,
            'the delayed second attempt must record a new timeout before its host write is released'
        );
        await host.evaluate(() => reviewReleaseSecondAttempt());
    }
    const [, secondResolution] = await Promise.all([
        host.waitForFunction(() => reviewCompleted >= 2),
        waitForSubmittedOrNewTimeout(
            child,
            priorTimeouts,
            'the second attempt must either receive its ACK or record a new matching timeout'
        )
    ]);
    if (forcedSecondIncident) assert.equal(secondResolution.eventId, forcedSecondIncident.eventId);
    let reconciled = false;
    if (secondResolution.status === 'timeout') {
        const committed = await host.evaluate(async () => AppData.practice.list());
        assert.equal(committed.length, 1, 'a timed-out second attempt must commit before reconciliation');
        // A repeat timeout for the same immutable submission may be grouped with
        // the already-dismissed incident, so no second dialog is required.
        await dismissUnconfirmedIncident(child, secondResolution.eventId, { required: false });
        const reconciliationTimeouts = await submissionTimeoutEventIds(child);
        await child.locator('#submit-btn').click();
        const [, reconciliation] = await Promise.all([
            host.waitForFunction(() => reviewCompleted >= 3),
            waitForSubmittedOrNewTimeout(
                child,
                reconciliationTimeouts,
                'receipt reconciliation must return the exact ACK for the committed submission'
            )
        ]);
        assert.equal(reconciliation.status, 'submitted', 'receipt reconciliation must not time out');
        assert.equal(reconciliation.submissionId, secondResolution.submissionId);
        reconciled = true;
    }
    const { messages, records } = await host.evaluate(async () => ({ messages: reviewSubmissions, records: await AppData.practice.list() }));
    assert.equal(messages.length, reconciled ? 3 : 2);
    assert.equal(messages[0].answers.q1, 'A');
    assert.equal(messages[1].answers.q1, editable ? 'B' : 'A');
    assert.equal(messages[1].submissionId === messages[0].submissionId, !editable);
    assert.equal(messages[1].readingTiming.frozen, true);
    if (editable) assert.ok(messages[1].readingTiming.revision > messages[0].readingTiming.revision, 'edited timing is frozen again');
    else assertImmutableSubmissionReplay(messages[1], messages[0], 'reconciliation preserves the original immutable submission');
    if (reconciled) assertImmutableSubmissionReplay(messages[2], messages[1], 'receipt reconciliation replays the committed snapshot exactly');
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
        window.reviewDroppedAcks = [];
        const complete = window.app.handlePracticeComplete;
        window.app.handlePracticeComplete = async function (...args) {
            window.reviewSubmissions.push(structuredClone(args[1]));
            try {
                return await complete.apply(this, args);
            } finally {
                window.reviewCompleted++;
            }
        };
        window.reviewOriginalPost = window.app._postExamMessage;
        window.app._postExamMessage = function (examId, target, type, data) {
            if (type === 'PRACTICE_SUBMIT_ACK') {
                window.reviewDroppedAcks.push(structuredClone(data));
                return true; // The actual write and receipt both succeed.
            }
            return reviewOriginalPost.call(this, examId, target, type, data);
        };
    });
    await child.locator('#submit-btn').click();
    await host.waitForFunction(() => window.reviewCompleted >= 1);
    const fixture = await host.evaluate(async () => ({
        submissions: window.reviewSubmissions,
        droppedAcks: window.reviewDroppedAcks,
        records: await AppData.practice.list()
    }));
    assert.equal(fixture.submissions.length, 1);
    assert.equal(fixture.droppedAcks.length, 1, 'the fixture must drop exactly one successful ACK');
    assert.equal(fixture.droppedAcks[0].submissionId, fixture.submissions[0].submissionId);
    const saved = fixture.records;
    assert.equal(saved.length, 1, 'the first write really committed before the timeout');
    if (suite) assert.equal(await host.evaluate(() => window.app.currentSuiteSession.status), 'completed');
    const timeoutIncident = await expireOrObservePendingSubmissionTimeout(
        child,
        'the lost-ACK fixture must expire or observe expiry of the pending submission it created'
    );
    assert.equal(timeoutIncident.submissionId, fixture.submissions[0].submissionId);
    await host.waitForFunction(() => reviewCompleted >= 1);
    await dismissUnconfirmedIncident(child, timeoutIncident.eventId);
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
    await host.waitForFunction(() => reviewCompleted >= 2);
    const { messages, droppedAcks, records } = await host.evaluate(async () => ({
        messages: reviewSubmissions,
        droppedAcks: reviewDroppedAcks,
        records: await AppData.practice.list()
    }));
    assert.equal(messages.length, 2);
    assert.equal(droppedAcks.length, 1, 'only the fixture ACK may be dropped');
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
