#!/usr/bin/env python3
"""Real HTTP/browser regression for interrupted practice history (issue #143)."""

from __future__ import annotations

import json
import os
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[3]
READING_EXAM_ID = "p1-high-05"
SAVED_EXAM_ID = "interrupted-history-saved-143"
SAVED_SESSION_ID = "interrupted-history-session-143"
SAVED_RECORD_ID = f"interrupted_{SAVED_SESSION_ID}"
HISTORY = "#interrupted-practice-history"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return


def ready(page: Page) -> None:
    page.wait_for_function("() => !!window.AppData && !!window.LicenseModal", timeout=60_000)
    page.evaluate("async () => { await window.AppData.ready; }")
    page.wait_for_function("() => window.app?.isInitialized === true", timeout=60_000)
    page.evaluate("async () => { await window.LicenseModal.accept(); }")
    page.wait_for_function("() => !document.getElementById('license-modal')?.classList.contains('show')")


def show_history(page: Page) -> None:
    page.locator("nav.main-nav button[data-view='practice']").click()
    page.wait_for_selector("#practice-view.active")
    page.wait_for_function("() => !!window.InterruptedPracticeHistory")
    page.evaluate("async () => { await window.app.components.practiceRecorder.ready; }")


def canonical_snapshot(page: Page) -> dict:
    return page.evaluate(
        """async () => {
            const stats = await window.AppData.practice.getStats();
            delete stats.lastUpdated;
            return {
                ids: (await window.AppData.practice.list({projection: 'light'})).map(r => r.id).sort(),
                stats,
                cards: ['total-practiced', 'avg-score', 'study-time', 'streak-days']
                    .map(id => document.getElementById(id).textContent.trim())
            };
        }"""
    )


def observe_timeout(page: Page, exam_id: str) -> str:
    """Advance the real recorder's inactivity clock; observe its own committed event."""
    session_id = page.evaluate(
        """async (examId) => {
            const recorder = window.app.components.practiceRecorder;
            if (!(recorder instanceof window.PracticeRecorder)) throw new Error('Fallback recorder');
            const session = recorder.activeSessions.get(examId);
            if (!session) throw new Error(`Missing active session: ${examId}`);
            window.__interruptedHistoryObserved = null;
            const onEnded = async (event) => {
                if (event.detail.examId !== examId) return;
                document.removeEventListener('practiceSessionEnded', onEnded);
                window.__interruptedHistoryObserved = {
                    detail: event.detail,
                    committedIds: (await window.AppData.recovery.listInterrupted()).map(r => r.id),
                    activeIds: (await window.AppData.recovery.listActiveSessions()).map(r => r.id)
                };
            };
            document.addEventListener('practiceSessionEnded', onEnded);
            session.startTime = new Date(Date.now() - 32 * 60 * 1000).toISOString();
            session.lastActivity = new Date(Date.now() - 31 * 60 * 1000).toISOString();
            await recorder.saveActiveSessions();
            recorder.checkSessionActivity(examId);
            return session.sessionId;
        }""",
        exam_id,
    )
    page.wait_for_function("() => window.__interruptedHistoryObserved !== null", timeout=15_000)
    observed = page.evaluate("() => window.__interruptedHistoryObserved")
    record_id = f"interrupted_{session_id}"
    assert observed["detail"]["reason"] == "timeout", observed
    assert observed["detail"]["interruptedRecordSaved"] is True, observed
    assert record_id in observed["committedIds"], observed
    assert f"active-session:{session_id}" not in observed["activeIds"], observed
    return record_id


def verify_fresh_details_and_type_filters(page: Page, url: str) -> None:
    """Reproduce PR #147's stale detail and retired-source filtering cases."""
    exam_id = "removed-source-147"
    session_id = "fresh-detail-session-147"
    record_id = f"interrupted_{session_id}"
    legacy_id = "legacy-page-type-147"

    # These neutral IDs/titles cannot supply a type through naming conventions or
    # the active library. The recorder must retain the start metadata itself.
    assert page.evaluate(
        """async () => !(await window.resolveActiveLibraryIndex()).some(record =>
            ['interrupted-history-saved-143', 'removed-source-147', 'retired-source-147'].includes(record.id))"""
    )
    page.evaluate(
        """async ({examId, sessionId}) => {
            const recorder = window.app.components.practiceRecorder;
            recorder.handleSessionStarted({
                examId, sessionId,
                metadata: {title: 'Fresh detail probe', type: 'listening', pageType: 'unified-listening'}
            });
            recorder.handleSessionProgress({examId, answers: {'1': 'stale-answer-147'}});
            await recorder.saveActiveSessions();
        }""",
        {"examId": exam_id, "sessionId": session_id},
    )
    assert observe_timeout(page, exam_id) == record_id
    assert page.evaluate(
        "async id => (await window.AppData.recovery.getInterrupted(id)).metadata.type", record_id
    ) == "listening"

    # An older recovery payload has no normalized type, only page provenance.
    page.evaluate(
        """async id => {
            await window.AppData.recovery.saveInterrupted({
                id, examId: 'retired-source-147', status: 'interrupted', reason: 'timeout',
                createdAt: new Date().toISOString(), answers: {},
                metadata: {examTitle: 'Legacy recovery', pageType: 'unified-reading'}
            });
        }""",
        legacy_id,
    )
    details = page.locator(f"{HISTORY} details[data-interrupted-id='{record_id}']")
    legacy_details = page.locator(f"{HISTORY} details[data-interrupted-id='{legacy_id}']")
    saved_details = page.locator(f"{HISTORY} details[data-interrupted-id='{SAVED_RECORD_ID}']")
    page.locator("#record-type-filter-buttons [data-filter-type='reading']").click()
    expect(legacy_details).to_be_visible()
    expect(saved_details).to_be_visible()
    expect(details).to_have_count(0)
    page.locator("#record-type-filter-buttons [data-filter-type='listening']").click()
    expect(details).to_be_visible()
    expect(legacy_details).to_have_count(0)
    expect(saved_details).to_have_count(0)
    assert details.evaluate("node => node.open") is False
    expect(details.locator("summary")).to_have_text("查看已保存答案")
    expect(details.locator("dd")).to_have_count(0)
    assert "stale-answer-147" not in details.text_content()

    # Tab B is a fresh AppData instance created after A rendered its collapsed
    # row. Opening A must query persisted data rather than its earlier list item.
    peer = page.context.new_page()
    peer.goto(url, wait_until="load", timeout=60_000)
    ready(peer)
    peer.evaluate(
        """async id => {
            const record = await window.AppData.recovery.getInterrupted(id);
            if (!record) throw new Error('Cross-tab update target is missing');
            await window.AppData.recovery.saveInterrupted({
                ...record, answers: {'1': 'fresh-answer-147'}
            });
        }""",
        record_id,
    )
    details.locator("summary").click()
    expect(details.locator("dd")).to_have_text("fresh-answer-147")
    assert "stale-answer-147" not in details.text_content()
    details.locator("summary").click()
    expect(details).not_to_have_attribute("open", "")
    peer.evaluate(
        "async id => { await window.AppData.recovery.discardInterrupted(id); }", record_id
    )
    details.locator("summary").click()
    expect(details).to_contain_text(re.compile(r"已.*(?:删除|过期)"))
    expect(details.locator("dd")).to_have_count(0)
    assert "stale-answer-147" not in details.text_content()
    assert "fresh-answer-147" not in details.text_content()
    peer.evaluate(
        "async id => { await window.AppData.recovery.discardInterrupted(id); }", legacy_id
    )
    peer.close()
    page.locator("#record-type-filter-buttons [data-filter-type='all']").click()
    expect(saved_details).to_be_visible()
    expect(details).to_have_count(0)
    expect(legacy_details).to_have_count(0)


def main() -> None:
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(REPO_ROOT))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(url, wait_until="load", timeout=60_000)
            ready(page)

            # A completed fixture makes exclusion from history/statistics and destructive
            # actions observable. Interrupted records below are created by the recorder.
            page.evaluate(
                """async () => {
                    await window.AppData.practice.completeAttempt({record: {
                        id: 'completed-history-control-143', examId: 'completed-control-143',
                        title: 'Completed control', type: 'reading', status: 'completed',
                        date: new Date().toISOString(), duration: 60,
                        totalQuestions: 2, correctAnswers: 1, accuracy: 0.5,
                        answers: {'1': 'control'}, correctAnswerMap: {'1': 'control'},
                        metadata: {isRealData: true, type: 'reading'}
                    }});
                }"""
            )
            show_history(page)
            expect(page.locator("#total-practiced")).to_have_text("1")
            baseline = canonical_snapshot(page)

            page.evaluate(
                """async ({examId, sessionId}) => {
                    const recorder = window.app.components.practiceRecorder;
                    recorder.startPracticeSession(examId, {
                        sessionId, title: 'Recorder timeout with saved answers', totalQuestions: 3,
                        type: 'reading'
                    });
                    recorder.handleSessionProgress({
                        examId, progress: {answeredQuestions: 1, totalQuestions: 3},
                        answers: {'1': 'saved-answer-143'}
                    });
                    await recorder.saveActiveSessions();
                }""",
                {"examId": SAVED_EXAM_ID, "sessionId": SAVED_SESSION_ID},
            )
            assert observe_timeout(page, SAVED_EXAM_ID) == SAVED_RECORD_ID
            assert page.evaluate(
                "async id => (await window.AppData.recovery.getInterrupted(id)).metadata.type", SAVED_RECORD_ID
            ) == "reading"
            saved_details = page.locator(f"{HISTORY} details[data-interrupted-id='{SAVED_RECORD_ID}']")
            saved_row = saved_details.locator("..")
            expect(saved_row).to_be_visible(timeout=15_000)
            expect(saved_row).to_contain_text("Recorder timeout with saved answers")
            expect(saved_row).to_contain_text("超时")
            assert canonical_snapshot(page) == baseline
            expect(saved_details.locator("summary")).to_have_text("查看已保存答案")
            expect(saved_details.locator("dd")).to_have_count(0)
            assert "saved-answer-143" not in saved_details.text_content()

            saved_details.locator("summary").click()
            expect(saved_details.locator("dd")).to_have_text("saved-answer-143")
            assert saved_row.locator("[data-action='replay'], [data-action='review'], .score, .accuracy").count() == 0
            assert "正确答案" not in saved_row.inner_text()
            assert "正确率" not in saved_row.inner_text()
            assert "得分" not in saved_row.inner_text()
            assert "回放" not in saved_row.inner_text()

            page.reload(wait_until="load")
            ready(page)
            show_history(page)
            expect(saved_row).to_be_visible(timeout=15_000)
            assert canonical_snapshot(page) == baseline

            verify_fresh_details_and_type_filters(page, url)
            assert canonical_snapshot(page) == baseline

            # Default reading inputs sync a separate draft. The timeout history must
            # honestly show an empty recorder snapshot rather than imply draft merging.
            page.locator("nav.main-nav button[data-view='browse']").click()
            page.wait_for_function("() => typeof window.app.openExam === 'function'")
            page.wait_for_function(
                "async examId => (await window.resolveActiveLibraryIndex()).some(r => r.id === examId)",
                arg=READING_EXAM_ID,
                timeout=60_000,
            )
            with page.expect_popup() as popup_info:
                page.evaluate("async examId => { await window.app.openExam(examId); }", READING_EXAM_ID)
            popup = popup_info.value
            popup.on("dialog", lambda dialog: dialog.accept())
            popup.wait_for_load_state("load")
            popup.locator("#question-groups input.blank").first.fill("draft-only-answer-143")
            page.wait_for_function(
                """async examId => (await window.AppData.recovery.listDrafts()).some(d =>
                    d.examId === examId && Object.values(d.answers || {}).includes('draft-only-answer-143'))""",
                arg=READING_EXAM_ID,
                timeout=20_000,
            )
            assert page.evaluate(
                "examId => Object.keys(window.app.components.practiceRecorder.activeSessions.get(examId).answers).length",
                READING_EXAM_ID,
            ) == 0
            show_history(page)
            empty_record_id = observe_timeout(page, READING_EXAM_ID)
            assert page.evaluate(
                "async id => (await window.AppData.recovery.getInterrupted(id)).metadata.type", empty_record_id
            ) == "reading"
            empty_details = page.locator(f"{HISTORY} details[data-interrupted-id='{empty_record_id}']")
            empty_row = empty_details.locator("..")
            expect(empty_row).to_be_visible(timeout=15_000)
            empty_details.locator("summary").click()
            expect(empty_details).to_contain_text("此记录没有保存的答案。阅读草稿单独保存")
            assert "draft-only-answer-143" not in empty_details.inner_text()
            popup.close()
            assert canonical_snapshot(page) == baseline

            screenshot_dir = os.environ.get("INTERRUPTED_HISTORY_SCREENSHOT_DIR")
            if screenshot_dir:
                output = Path(screenshot_dir)
                output.mkdir(parents=True, exist_ok=True)
                expect(page.get_by_text("正在打开题目:", exact=False)).to_be_hidden(timeout=15_000)
                saved_details.evaluate("node => { node.open = true; }")
                expect(saved_details.locator("dd")).to_have_text("saved-answer-143")
                page.locator(HISTORY).screenshot(path=str(output / "interrupted-history-desktop.png"))
                page.set_viewport_size({"width": 390, "height": 844})
                page.locator(HISTORY).screenshot(path=str(output / "interrupted-history-mobile.png"))
                assert page.locator(HISTORY).evaluate("node => node.scrollWidth <= node.clientWidth")
                page.set_viewport_size({"width": 1280, "height": 720})

            page.locator("#bulk-delete-btn").click()
            expect(page.locator("#history-list input[type='checkbox']")).to_have_count(1)
            expect(page.locator(f"{HISTORY} input[type='checkbox']")).to_have_count(0)
            expect(saved_row).to_be_visible()
            page.locator("#bulk-delete-btn").click()

            # Supplemental recovery fixtures must survive deletion and clearing history.
            before_clear = page.evaluate(
                """async () => {
                    await window.AppData.recovery.saveActiveSession({
                        id: 'active-session:preserved-143', sessionId: 'preserved-143',
                        examId: 'preserved-active-143', status: 'active',
                        lastActivity: new Date().toISOString()
                    });
                    await window.AppData.recovery.saveDraft({
                        id: 'preserved-draft-143', kind: 'reading_draft', answers: {'1': 'keep'}
                    });
                    await window.AppData.recovery.saveRejectedCompletion({id: 'preserved-rejected-143'});
                    return {
                        active: await window.AppData.recovery.listActiveSessions(),
                        drafts: await window.AppData.recovery.listDrafts(),
                        rejected: await window.AppData.recovery.listRejectedCompletions()
                    };
                }"""
            )
            saved_row.locator(".interrupted-history__delete").click()
            expect(saved_row).to_have_count(0)
            expect(empty_row).to_be_visible()
            assert page.evaluate(
                "async () => (await window.AppData.recovery.listInterrupted()).map(r => r.id)"
            ) == [empty_record_id]
            assert canonical_snapshot(page) == baseline
            page.locator("[data-index-action='clear-practice-data']").click()
            expect(empty_row).to_have_count(0)
            assert page.evaluate("async () => (await window.AppData.recovery.listInterrupted()).length") == 0
            after_clear = page.evaluate(
                """async () => ({
                    active: await window.AppData.recovery.listActiveSessions(),
                    drafts: await window.AppData.recovery.listDrafts(),
                    rejected: await window.AppData.recovery.listRejectedCompletions()
                })"""
            )
            assert after_clear == before_clear
            expect(page.locator("#total-practiced")).to_have_text("0")
            final_canonical = canonical_snapshot(page)
            assert final_canonical["ids"] == []
            assert final_canonical["stats"]["totalPractices"] == 0
            print(json.dumps({
                "status": "pass", "savedRecordId": SAVED_RECORD_ID,
                "emptyReadingRecordId": empty_record_id,
                "completedRecords": len(baseline["ids"]),
                "preservedDrafts": len(after_clear["drafts"]),
            }, ensure_ascii=False))
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
