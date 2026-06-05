#!/usr/bin/env python3
"""Vue Practice Reading suite flow regression.

Covers the Vue-native suite path:
1. Practice Library creates a reading suite session through Practice API
2. Suite page renders P1/P2/P3 sequence and active passage state
3. each active passage opens the existing Vue reading page with suiteSessionId
4. submitting a passage calls the reading-suite passage endpoint, not legacy window flow
5. suite progress advances through all three passages and aggregates completion
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DIST_ENTRY = REPO_ROOT / "dist" / "writing" / "index.html"
LOCAL_API_BASE_URL = "http://127.0.0.1:3921"
SUITE_SESSION_ID = "suite-e2e-1"

try:
    from playwright.async_api import async_playwright  # type: ignore[import-untyped]
except ModuleNotFoundError:
    venv_dir = (REPO_ROOT / ".venv").resolve()
    venv_python = REPO_ROOT / ".venv" / "bin" / "python"
    current_prefix = Path(sys.prefix).resolve()
    if venv_python.exists() and current_prefix != venv_dir:
        completed = subprocess.run([str(venv_python), str(Path(__file__).resolve())], cwd=str(REPO_ROOT))
        raise SystemExit(completed.returncode)
    raise SystemExit(json.dumps({"status": "fail", "detail": "playwright_python_missing"}, ensure_ascii=False))


def ensure_bundle() -> None:
    source_paths = [
        REPO_ROOT / "apps" / "writing-vue" / "src" / "App.vue",
        REPO_ROOT / "apps" / "writing-vue" / "src" / "components" / "NavBar.vue",
        REPO_ROOT / "apps" / "writing-vue" / "src" / "main.js",
        REPO_ROOT / "apps" / "writing-vue" / "src" / "views" / "PracticeLibraryPage.vue",
        REPO_ROOT / "apps" / "writing-vue" / "src" / "views" / "PracticeReadingPage.vue",
        REPO_ROOT / "apps" / "writing-vue" / "src" / "views" / "PracticeReadingSuitePage.vue",
        REPO_ROOT / "apps" / "writing-vue" / "src" / "api" / "practice-client.js",
    ]
    if DIST_ENTRY.exists() and all(
        source.exists() and source.stat().st_mtime <= DIST_ENTRY.stat().st_mtime
        for source in source_paths
    ):
        return
    completed = subprocess.run(
        ["npm", "run", "build:writing"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = completed.stdout or completed.stderr or "unknown build failure"
        raise SystemExit(json.dumps({"status": "fail", "detail": f"build_failed: {detail.strip()}"}, ensure_ascii=False))


async def return_to_library(page, entry_url: str) -> None:
    exit_link = page.locator('a:has-text("返回练习库")').first
    target_href = await exit_link.get_attribute('href')
    if not target_href:
      raise AssertionError('suite_return_to_library_missing_href')
    target_url = await page.evaluate(
        """(href) => new URL(href, window.location.href).href""",
        target_href,
    )
    await exit_link.click()
    try:
        await page.wait_for_selector('[data-practice-reading-home]', timeout=5000, state="attached")
    except Exception:
        await page.goto(target_url)
        if not await page.locator('[data-practice-reading-home]').count():
            await page.goto('about:blank')
            await page.goto(entry_url)
    await page.wait_for_selector('[data-practice-reading-home]', timeout=20000, state="attached")


async def switch_library_view(page, view: str, ready_selector: str) -> None:
    await page.evaluate(
        """(targetView) => {
            const url = new URL(window.location.href);
            const hashUrl = new URL(url.hash.slice(1) || '/', url.origin);
            if (targetView === 'overview') {
                hashUrl.searchParams.delete('view');
            } else {
                hashUrl.searchParams.set('view', targetView);
            }
            window.location.hash = `#${hashUrl.pathname}${hashUrl.search}`;
        }""",
        view,
    )
    await page.wait_for_selector(ready_selector, timeout=10000)


async def install_api_stub(page) -> None:
    await page.add_init_script(
        f"""
        (() => {{
          const LOCAL_API_BASE_URL = '{LOCAL_API_BASE_URL}';
          const SUITE_SESSION_ID = '{SUITE_SESSION_ID}';
          const assets = [
            {{ id: 'p1-suite-e2e', activity: 'reading', title: 'Suite Passage 1', source: 'reading_exam', category: 'P1', payloadRef: 'p1-suite-e2e', metadata: {{ dataKey: 'p1-suite-e2e' }} }},
            {{ id: 'p2-suite-e2e', activity: 'reading', title: 'Suite Passage 2', source: 'reading_exam', category: 'P2', payloadRef: 'p2-suite-e2e', metadata: {{ dataKey: 'p2-suite-e2e' }} }},
            {{ id: 'p3-suite-e2e', activity: 'reading', title: 'Suite Passage 3', source: 'reading_exam', category: 'P3', payloadRef: 'p3-suite-e2e', metadata: {{ dataKey: 'p3-suite-e2e' }} }},
            {{ id: 'p1-custom-suite-e2e', activity: 'reading', title: 'Custom Suite Passage 1', source: 'reading_exam', category: 'P1', payloadRef: 'p1-custom-suite-e2e', metadata: {{ dataKey: 'p1-custom-suite-e2e' }} }},
            {{ id: 'p2-custom-suite-e2e', activity: 'reading', title: 'Custom Suite Passage 2', source: 'reading_exam', category: 'P2', payloadRef: 'p2-custom-suite-e2e', metadata: {{ dataKey: 'p2-custom-suite-e2e' }} }},
            {{ id: 'p3-custom-suite-e2e', activity: 'reading', title: 'Custom Suite Passage 3', source: 'reading_exam', category: 'P3', payloadRef: 'p3-custom-suite-e2e', metadata: {{ dataKey: 'p3-custom-suite-e2e' }} }}
          ];
          const writingAsset = {{ id: '7', activity: 'writing', title: 'Writing topic', source: 'writing_topic', category: 'education', difficulty: 3, payloadRef: '7', metadata: {{ taskType: 'task2' }} }};
          const clone = (value) => JSON.parse(JSON.stringify(value));
          const nowIso = () => new Date().toISOString();
          const suiteTimerAnchorMs = Date.now();
          const createJsonResponse = (payload, ok = true, status = 200) => ({{
            ok,
            status,
            headers: {{ get(name) {{ return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : ''; }} }},
            async json() {{ return payload; }},
            async text() {{ return JSON.stringify(payload); }}
          }});
          const createSseResponse = (events) => ({{
            ok: true,
            status: 200,
            headers: {{ get(name) {{ return String(name || '').toLowerCase() === 'content-type' ? 'text/event-stream' : ''; }} }},
            body: new ReadableStream({{
              start(controller) {{
                const encoder = new TextEncoder();
                events.forEach((item) => {{
                  controller.enqueue(encoder.encode(`event: ${{item.event}}\\n`));
                  controller.enqueue(encoder.encode(`data: ${{JSON.stringify(item.data)}}\\n\\n`));
                }});
                controller.close();
              }}
            }}),
            async json() {{ return {{}}; }},
            async text() {{ return ''; }}
          }});
          const parseJsonBody = (init) => {{
            try {{ return init && init.body ? JSON.parse(init.body) : {{}}; }} catch (_) {{ return {{}}; }}
          }};
          const buildSuiteSequence = (assetIds) => assetIds.map((assetId, index) => {{
            const asset = assets.find((item) => item.id === assetId);
            return {{
              index,
              assetId,
              examId: assetId,
              title: asset?.title || assetId,
              category: asset?.category || `P${{index + 1}}`,
              status: index === 0 ? 'active' : 'pending',
              sessionId: null,
              submittedAt: null,
              scoreInfo: null
            }};
          }});
          const resetSuite = (assetIds) => {{
            suite.sequence = buildSuiteSequence(assetIds);
            suite.currentIndex = 0;
            suite.status = 'active';
            suite.aggregate = {{ submittedPassages: 0, totalPassages: 3, correct: 0, totalQuestions: 0, accuracy: 0, percentage: 0, duration: 0 }};
            suite.completedAt = null;
          }};
          const suite = {{
            sessionId: SUITE_SESSION_ID,
            activity: 'reading',
            practiceMode: 'suite',
            status: 'active',
            flowMode: 'simulation',
            frequencyScope: 'all',
            timer: {{
              source: 'suite',
              anchorMs: suiteTimerAnchorMs,
              effectiveStartTimeMs: suiteTimerAnchorMs,
              mode: 'elapsed',
              limitSeconds: null,
              pausedOffsetMs: 0,
              pausedAtMs: null,
              running: true
            }},
            currentIndex: 0,
            totalPassages: 3,
            sequence: buildSuiteSequence(['p1-suite-e2e', 'p2-suite-e2e', 'p3-suite-e2e']),
            aggregate: {{ submittedPassages: 0, totalPassages: 3, correct: 0, totalQuestions: 0, accuracy: 0, percentage: 0, duration: 0 }},
            createdAt: nowIso(),
            updatedAt: nowIso(),
            completedAt: null
          }};
          const details = Object.fromEntries(assets.map((asset, index) => [asset.id, {{
            ...asset,
            payload: {{
              schemaVersion: 'ReadingExamSourceV1',
              examId: asset.id,
              meta: {{ title: asset.title, category: asset.category, frequency: 'suite', questionIntroHtml: '<h3>Question 1</h3>' }},
              passage: {{ blocks: [{{ blockId: `${{asset.id}}-passage`, kind: 'html', html: `<h2>${{asset.title}}</h2><p>Evidence for suite passage ${{index + 1}}.</p>` }}] }},
              questionGroups: [{{
                groupId: `${{asset.id}}-group`,
                kind: 'single_choice',
                questionIds: ['q1'],
                bodyHtml: '<div class="group"><label><input type="radio" name="q1" value="A"> A correct</label><label><input type="radio" name="q1" value="B"> B wrong</label></div>'
              }}],
              answerKey: {{ q1: 'A' }},
              questionOrder: ['q1'],
              questionDisplayMap: {{ q1: '1' }},
              questionCount: 1,
              interactionModel: {{
                q1: {{ questionId: 'q1', displayLabel: '1', control: 'radio', source: 'native_input', name: 'q1', options: [{{ value: 'A', label: 'A' }}, {{ value: 'B', label: 'B' }}] }}
              }}
            }}
          }}]));
          const recomputeSuite = () => {{
            const submitted = suite.sequence.filter((entry) => entry.status === 'submitted');
            const correct = submitted.reduce((sum, entry) => sum + Number(entry.scoreInfo?.correct || 0), 0);
            const totalQuestions = submitted.reduce((sum, entry) => sum + Number(entry.scoreInfo?.totalQuestions || 0), 0);
            const duration = submitted.reduce((sum, entry) => sum + Number(entry.scoreInfo?.duration || 0), 0);
            const accuracy = totalQuestions > 0 ? correct / totalQuestions : 0;
            suite.aggregate = {{ submittedPassages: submitted.length, totalPassages: 3, correct, totalQuestions, accuracy, percentage: Math.round(accuracy * 100), duration }};
            suite.updatedAt = nowIso();
            if (submitted.length === 3) {{
              suite.status = 'completed';
              suite.completedAt = suite.updatedAt;
            }}
          }};
          const submissionsBySessionId = new Map();
          const buildHistoryRecord = (submission) => {{
            const scoreInfo = submission?.scoreInfo || {{}};
            return {{
              id: `reading-${{submission.sessionId}}`,
              activity: 'reading',
              sessionId: submission.sessionId,
              assetId: submission.assetId,
              examId: submission.examId,
              title: submission.metadata?.title || submission.assetId,
              status: 'completed',
              submittedAt: submission.submittedAt,
              startTime: submission.startTime,
              endTime: submission.endTime,
              duration: Number(submission.duration || 0),
              score: Number(scoreInfo.correct || 0),
              totalQuestions: Number(scoreInfo.totalQuestions || scoreInfo.total || 0),
              correctAnswers: Number(scoreInfo.correct || 0),
              accuracy: Number(scoreInfo.accuracy || 0),
              metadata: {{ ...(submission.metadata || {{}}), historyRecordId: `reading-${{submission.sessionId}}` }}
            }};
          }};
          const getHistoryRecords = () => Array
            .from(submissionsBySessionId.values())
            .map((submission) => buildHistoryRecord(submission))
            .sort((left, right) => new Date(right.submittedAt || 0).getTime() - new Date(left.submittedAt || 0).getTime());
          const suiteLlmPatch = {{
            diagnosis: [
              {{ code: 'suite_ai_review_done', reason: 'SUITE_CANONICAL_PATCH_ONLY: 套题单篇复盘已持久化', evidence: [] }}
            ],
            nextActions: [
              {{ type: 'suite_next_rule', target: 'suite', instruction: 'SUITE_CANONICAL_PATCH_ONLY: 继续按证据句复盘下一篇', evidence: [] }}
            ],
            confidence: 0.82,
            model_trace: {{ source: 'reading_coach_v2', degraded: false }}
          }};
            const buildSubmission = (assetId, body) => {{
            const asset = details[assetId];
            const index = suite.sequence.findIndex((entry) => entry.assetId === assetId);
            const answer = String(body?.attempt?.answers?.q1 || '').trim();
            const highlights = Array.isArray(body?.attempt?.highlights) ? body.attempt.highlights : [];
            const correct = answer === 'A' ? 1 : 0;
            const sessionId = `reading-${{SUITE_SESSION_ID}}-p${{index + 1}}`;
            const endTime = body?.attempt?.endTime || nowIso();
            const analysisSignals = {{ questionCount: 1, unansweredCount: answer ? 0 : 1, changedAnswerCount: 0, interactionDensity: 1, markedQuestionCount: 0, highlightCount: highlights.length }};
            const questionTimelineLite = Array.isArray(body?.attempt?.questionTimelineLite) ? body.attempt.questionTimelineLite : [];
            const questionTypePerformance = {{ single_choice: {{ total: 1, correct, accuracy: correct, questionIds: ['q1'], kind: 'single_choice', confidence: 0.75 }} }};
            return {{
              sessionId,
              activity: 'reading',
              status: 'submitted',
              assetId,
              examId: assetId,
              submittedAt: endTime,
              startTime: body?.attempt?.startTime || null,
              endTime,
              duration: Number(body?.attempt?.durationSec || 30),
              readOnly: true,
              answers: {{ q1: answer }},
              correctAnswers: {{ q1: 'A' }},
              answerComparison: {{
                q1: {{ questionId: 'q1', displayLabel: '1', userAnswer: answer, correctAnswer: 'A', normalizedUserAnswer: [answer], normalizedCorrectAnswer: ['A'], isCorrect: answer === 'A', weight: 1, control: 'radio', source: 'native_input', questionKind: 'single_choice', matchMode: 'single' }}
              }},
              scoreInfo: {{ correct, total: 1, totalQuestions: 1, accuracy: correct, percentage: correct * 100, duration: Number(body?.attempt?.durationSec || 30), source: 'practice_reading_session' }},
              questionTypePerformance,
              highlights,
              markedQuestions: [],
              analysisSignals,
              questionTimelineLite,
              singleAttemptAnalysisInput: {{ version: '1.0.0', generatedAt: endTime, examId: assetId, sessionId, type: 'reading', category: asset.category, totalQuestions: 1, correctAnswers: correct, accuracy: correct, durationSec: Number(body?.attempt?.durationSec || 30), dataQuality: {{ confidence: 0.75, source: 'practice_reading_session' }}, analysisSignals, questionTimelineLite, questionTypePerformance, unknownQuestions: 0, missingKindRatio: 0, confidence: 0.75, markedQuestions: [], highlights }},
              singleAttemptAnalysis: {{ summary: {{ accuracy: correct, durationSec: Number(body?.attempt?.durationSec || 30), unansweredRate: answer ? 0 : 1, changedAnswerRate: 0 }}, radar: {{ byQuestionKind: [], byPassageCategory: [{{ category: asset.category, total: 1, correct, accuracy: correct, confidence: 0.75 }}] }}, diagnosis: [{{ type: 'suite_passage', severity: 'low', message: '套题单篇已提交。', evidence: {{ assetId }} }}], nextActions: [{{ type: 'continue_suite', target: asset.category, instruction: '继续完成下一篇。', evidence: {{ suiteSessionId: SUITE_SESSION_ID }} }}], confidence: 0.75 }},
              singleAttemptAnalysisLlm: null,
              coachContext: {{ submitted: true, score: correct * 100, wrongQuestions: answer === 'A' ? [] : ['1'], selectedAnswers: {{ '1': answer }} }},
              metadata: {{ examId: assetId, title: asset.title, category: asset.category, type: 'reading', renderMode: 'vue-reading', practiceMode: 'suite', suiteSessionId: SUITE_SESSION_ID, suitePassageIndex: index, suitePassageTotal: 3, timerSnapshot: body?.attempt?.timerSnapshot || null }},
              legacy: {{ eventType: 'PRACTICE_COMPLETE', renderMode: 'vue-reading', practiceMode: 'suite' }}
            }};
          }};
          const attachCoachResult = (requestBody) => {{
            const sessionId = String(requestBody?.sessionId || '').trim();
            const storedSubmission = submissionsBySessionId.get(sessionId);
            const response = {{
              coachVersion: 'suite-e2e',
              answer: 'Suite AI review persisted before navigation.',
              answerSections: [{{ type: 'review', text: 'Suite review is canonical.' }}],
              confidence: 'high',
              singleAttemptAnalysisLlm: suiteLlmPatch
            }};
            if (storedSubmission) {{
              const transcript = Array.isArray(storedSubmission.readingCoachTranscript)
                ? storedSubmission.readingCoachTranscript.slice()
                : [];
              transcript.push({{ role: 'assistant', content: response.answer, createdAt: nowIso(), snapshot: response }});
              submissionsBySessionId.set(sessionId, {{
                ...storedSubmission,
                readingCoachSnapshot: response,
                readingCoachTranscript: transcript,
                singleAttemptAnalysisLlm: suiteLlmPatch
              }});
            }}
            return response;
          }};
          window.electronAPI = {{
            getLocalApiInfo: async () => ({{ success: true, data: {{ baseUrl: LOCAL_API_BASE_URL }} }})
          }};
          window.__practiceReadingSuiteRequests = [];
          window.__practiceReadingSuiteFailNextState = false;
          window.__practiceReadingSuiteFailedStateLoads = 0;
          window.fetch = async (input, init = {{}}) => {{
            const url = typeof input === 'string' ? input : String(input && input.url ? input.url : '');
            if (!url.startsWith(LOCAL_API_BASE_URL)) {{
              throw new Error(`unexpected_fetch_url:${{url}}`);
            }}
            const parsed = new URL(url);
            const pathname = parsed.pathname;
            const method = String(init.method || 'GET').toUpperCase();
            const body = parseJsonBody(init);
            window.__practiceReadingSuiteRequests.push({{ method, pathname, search: parsed.search, body }});
            if (pathname === '/api/practice/assets' && method === 'GET') {{
              const activity = parsed.searchParams.get('activity');
              if (activity === 'reading') return createJsonResponse({{ success: true, data: {{ data: assets, total: assets.length, page: 1, limit: 48 }} }});
              if (activity === 'writing') return createJsonResponse({{ success: true, data: {{ data: [writingAsset], total: 1, page: 1, limit: 32 }} }});
              return createJsonResponse({{ success: true, data: {{ data: [writingAsset, ...assets], total: 4, page: 1, limit: 80 }} }});
            }}
            if (pathname.startsWith('/api/practice/assets/reading/') && method === 'GET') {{
              const assetId = decodeURIComponent(pathname.split('/').pop() || '');
              return createJsonResponse({{ success: true, data: clone(details[assetId]) }});
            }}
            if (pathname === '/api/practice/history' && method === 'GET') {{
              const data = getHistoryRecords();
              return createJsonResponse({{ success: true, data: {{ data, total: data.length, page: 1, limit: data.length || 5 }} }});
            }}
            if (pathname === '/api/practice/migration-status' && method === 'GET') {{
              return createJsonResponse({{ success: true, data: {{ defaultRenderer: 'vue', legacyDeletionAllowed: false, capabilities: [], electronEntrypoints: {{}} }} }});
            }}
            if (pathname === '/api/practice/reading-suite' && method === 'POST') {{
              suite.flowMode = String(body.flowMode || 'classic');
              suite.frequencyScope = String(body.frequencyScope || 'all');
              if (Array.isArray(body.sequence) && body.sequence.length === 3) {{
                resetSuite(body.sequence);
              }} else {{
                resetSuite(['p1-suite-e2e', 'p2-suite-e2e', 'p3-suite-e2e']);
              }}
              suite.sequence.forEach((entry, index) => {{
                if (index === 0) entry.status = 'active';
                if (index > 0) entry.status = 'pending';
              }});
              return createJsonResponse({{ success: true, data: clone(suite) }});
            }}
            if (pathname === `/api/practice/reading-suite/${{SUITE_SESSION_ID}}` && method === 'GET') {{
              if (window.__practiceReadingSuiteFailNextState) {{
                window.__practiceReadingSuiteFailNextState = false;
                window.__practiceReadingSuiteFailedStateLoads += 1;
                return createJsonResponse({{ success: false, error: 'suite_state_unavailable', message: 'synthetic suite state failure' }}, false, 503);
              }}
              return createJsonResponse({{ success: true, data: clone(suite) }});
            }}
            const sessionMatch = pathname.match(/^\\/api\\/practice\\/sessions\\/reading\\/([^/]+)$/);
            if (sessionMatch && method === 'GET') {{
              const sessionId = decodeURIComponent(sessionMatch[1]);
              const storedSubmission = submissionsBySessionId.get(sessionId);
              if (!storedSubmission) {{
                return createJsonResponse({{ success: false, error: 'practice_session_not_found', message: 'missing' }}, false, 404);
              }}
              return createJsonResponse({{ success: true, data: {{ sessionId, activity: 'reading', status: 'submitted', active: false, events: [], lastSequence: 0, submission: clone(storedSubmission), legacy: storedSubmission.legacy }} }});
            }}
            const submitMatch = pathname.match(new RegExp(`^/api/practice/reading-suite/${{SUITE_SESSION_ID}}/passages/([^/]+)$`));
            if (submitMatch && method === 'POST') {{
              const assetId = decodeURIComponent(submitMatch[1]);
              const index = suite.sequence.findIndex((entry) => entry.assetId === assetId);
              if (index !== suite.currentIndex) {{
                return createJsonResponse({{ success: false, error: 'reading_suite_passage_out_of_order', message: 'out of order' }}, false, 409);
              }}
              const submission = buildSubmission(assetId, body);
              suite.sequence[index].status = 'submitted';
              suite.sequence[index].sessionId = submission.sessionId;
              suite.sequence[index].submittedAt = submission.submittedAt;
              suite.sequence[index].scoreInfo = submission.scoreInfo;
              if (submission.metadata.timerSnapshot?.anchorMs) {{
                suite.timer = {{
                  ...suite.timer,
                  anchorMs: submission.metadata.timerSnapshot.anchorMs,
                  effectiveStartTimeMs: submission.metadata.timerSnapshot.effectiveStartTimeMs || submission.metadata.timerSnapshot.anchorMs,
                  mode: submission.metadata.timerSnapshot.mode || suite.timer.mode,
                  limitSeconds: submission.metadata.timerSnapshot.limitSeconds ?? suite.timer.limitSeconds,
                  pausedOffsetMs: submission.metadata.timerSnapshot.pausedOffsetMs || suite.timer.pausedOffsetMs,
                  pausedAtMs: submission.metadata.timerSnapshot.pausedAtMs || null,
                  running: submission.metadata.timerSnapshot.running !== false
                }};
              }}
              submissionsBySessionId.set(submission.sessionId, clone(submission));
              if (index + 1 < suite.sequence.length) {{
                suite.currentIndex = index + 1;
                suite.sequence[index + 1].status = 'active';
              }}
              recomputeSuite();
              return createJsonResponse({{ success: true, data: {{ sessionId: SUITE_SESSION_ID, activity: 'reading', status: suite.status, suiteSession: clone(suite), submission }} }});
            }}
            if (pathname === '/api/practice/coach/stream' && method === 'POST') {{
              const response = attachCoachResult(body);
              return createSseResponse([
                {{ event: 'start', data: {{ success: true, sessionId: body?.sessionId || '' }} }},
                {{ event: 'retrieval', data: {{ type: 'retrieval', data: {{ chunks: 2 }} }} }},
                {{ event: 'complete', data: {{ success: true, data: response }} }}
              ]);
            }}
            if (pathname === '/api/practice/coach' && method === 'POST') {{
              return createJsonResponse({{ success: true, data: attachCoachResult(body) }});
            }}
            throw new Error(`unhandled_local_api_request:${{method}}:${{pathname}}`);
          }};
        }})();
        """
    )


async def accept_license_modal(page) -> None:
    license_modal = page.locator("#license-modal.show")
    await license_modal.wait_for(state="visible", timeout=10000)
    await license_modal.locator('[data-index-action="accept-license"]').click()
    await page.wait_for_function(
        "() => !document.getElementById('license-modal')?.classList.contains('show')",
        timeout=10000,
    )
    accepted = await page.evaluate("() => window.localStorage.getItem('hasSeenGplLicense')")
    if accepted != "true":
        raise AssertionError(f"license_accept_not_persisted:{accepted}")


async def run_flow() -> dict:
    ensure_bundle()
    entry_url = f"{DIST_ENTRY.as_uri()}#/"

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=["--allow-file-access-from-files"])
        page = await browser.new_page()
        await install_api_stub(page)

        await page.goto(entry_url)
        await page.wait_for_selector('[data-practice-reading-home] h1:has-text("IELTS Atlas")', timeout=20000)
        await accept_license_modal(page)
        await page.locator('[data-start-reading-suite]').click()
        await page.wait_for_selector('#suite-mode-selector-modal.show', timeout=10000)
        await page.locator('#suite-frequency-scope').select_option('custom')
        await page.locator('[data-suite-flow-mode="classic"]').click()
        await page.wait_for_selector('[data-custom-suite-selection]', timeout=10000)
        await page.wait_for_selector('#browse-view.active', timeout=10000)
        for asset_id, category in [
            ("p1-custom-suite-e2e", "P1"),
            ("p2-custom-suite-e2e", "P2"),
            ("p3-custom-suite-e2e", "P3"),
        ]:
            await page.wait_for_selector(f'#browse-title:has-text("{category}")', timeout=10000)
            await page.locator(f'.exam-item[data-reading-asset-id="{asset_id}"] [data-action="start"]').click()
        await page.wait_for_selector('[data-custom-suite-confirm]:not([disabled])', timeout=10000)
        await page.locator('[data-custom-suite-confirm]').click()
        await page.wait_for_url(f"**#/reading-suite/{SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('[data-reading-suite-passage="p1-custom-suite-e2e"][data-reading-suite-current="true"]', timeout=10000)
        await return_to_library(page, DIST_ENTRY.as_uri())

        await page.locator('[data-start-reading-suite]').click()
        await page.wait_for_selector('#suite-mode-selector-modal.show', timeout=10000)
        await page.locator('#suite-frequency-scope').select_option('high_medium')
        await page.locator('[data-suite-flow-mode="simulation"]').click()

        await page.wait_for_url(f"**#/reading-suite/{SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('[data-reading-suite-page]', timeout=10000)
        await page.wait_for_selector('[data-reading-suite-passage="p1-suite-e2e"][data-reading-suite-current="true"]', timeout=10000)

        suite_timer_anchor = None
        for index, asset_id in enumerate(["p1-suite-e2e", "p2-suite-e2e", "p3-suite-e2e"], start=1):
            await page.locator('[data-reading-suite-start-current]').click()
            await page.wait_for_url(f"**#/reading/{asset_id}?suiteSessionId={SUITE_SESSION_ID}", timeout=10000)
            await page.wait_for_selector('[data-practice-reading-page]', timeout=10000)
            await page.wait_for_selector('[data-reading-suite-progress-mini]', timeout=10000)
            await page.wait_for_selector('#question-nav', timeout=10000)
            await page.wait_for_selector('#submit-btn', timeout=10000)
            timer_snapshot = await page.evaluate(
                """() => window.__IELTS_PRACTICE_TIMER__?.getSnapshot?.() || null"""
            )
            if not timer_snapshot or timer_snapshot.get("source") != "suite":
                raise AssertionError(f"suite_timer_bridge_missing:{timer_snapshot}")
            if timer_snapshot.get("mode") != "elapsed" or timer_snapshot.get("limitSeconds") is not None:
                raise AssertionError(f"suite_timer_mode_invalid:{timer_snapshot}")
            if not isinstance(timer_snapshot.get("anchorMs"), int):
                raise AssertionError(f"suite_timer_anchor_missing:{timer_snapshot}")
            if suite_timer_anchor is None:
                suite_timer_anchor = timer_snapshot.get("anchorMs")
            if timer_snapshot.get("anchorMs") != suite_timer_anchor:
                raise AssertionError(f"suite_timer_anchor_changed:{timer_snapshot}:{suite_timer_anchor}")
            bottom_nav_state = await page.evaluate(
                """() => ({
                  submitCopy: document.getElementById('submit-btn')?.textContent?.trim() || '',
                  hasAnswerControlsInBottomNav: Boolean(document.querySelector('#question-nav select, #question-nav input[type="text"], #question-nav input[type="checkbox"]'))
                })"""
            )
            if bottom_nav_state.get("submitCopy") != "Submit" or bottom_nav_state.get("hasAnswerControlsInBottomNav"):
                raise AssertionError(f"suite_reading_legacy_bottom_nav_regressed:{bottom_nav_state}")
            await page.locator('input[type="radio"][name="q1"][value="A"]').check()
            await page.click('#submit-btn')
            post_submit = await page.wait_for_function(
                f"""
                () => {{
                  const href = window.location.href;
                  if (document.querySelector('[data-reading-review-panel]')) {{
                    return 'review';
                  }}
                  if (href.includes('#/reading-suite/{SUITE_SESSION_ID}')) {{
                    return 'suite';
                  }}
                  if ({'true' if index < 3 else 'false'} && href.includes('#/reading/p{index + 1}-suite-e2e?suiteSessionId={SUITE_SESSION_ID}')) {{
                    return 'next-reading';
                  }}
                  return null;
                }}
                """,
                timeout=10000,
            )
            post_submit_state = await post_submit.json_value()
            if post_submit_state == 'review':
                await page.wait_for_selector('text=1 / 1 · 100%', timeout=10000)
                await page.wait_for_selector('[data-reading-llm-diagnosis="suite_ai_review_done"]', timeout=10000)
                await page.click('a:has-text("返回套题进度")')
                await page.wait_for_url(f"**#/reading-suite/{SUITE_SESSION_ID}", timeout=10000)
            elif post_submit_state == 'next-reading':
                await page.goto(f"{DIST_ENTRY.as_uri()}#/reading-suite/{SUITE_SESSION_ID}")
                await page.wait_for_url(f"**#/reading-suite/{SUITE_SESSION_ID}", timeout=10000)
            elif post_submit_state != 'suite':
                raise AssertionError(f"suite_submit_post_state_invalid:{post_submit_state}")
            await page.wait_for_selector(f'[data-reading-suite-passage="{asset_id}"].passage-row--submitted', timeout=10000)
            if index < 3:
                next_asset = f"p{index + 1}-suite-e2e"
                await page.wait_for_selector(f'[data-reading-suite-passage="{next_asset}"][data-reading-suite-current="true"]', timeout=10000)

        await page.wait_for_selector('[data-reading-suite-summary]:has-text("3/3")', timeout=10000)
        await page.wait_for_selector('[data-reading-suite-summary]:has-text("100%")', timeout=10000)

        await page.goto(f"{DIST_ENTRY.as_uri()}#/reading/p1-suite-e2e/review/reading-{SUITE_SESSION_ID}-p1?suiteSessionId={SUITE_SESSION_ID}")
        await page.wait_for_url(f"**#/reading/p1-suite-e2e/review/reading-{SUITE_SESSION_ID}-p1?suiteSessionId={SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('[data-reading-review-panel]', timeout=10000)
        await page.wait_for_selector('#review-nav-bar[data-review-index="0"][data-review-total="3"]', timeout=10000)
        first_review_nav_state = await page.evaluate(
            """() => ({
              prevDisabled: document.querySelector('#review-nav-bar [data-review-dir="prev"]')?.disabled === true,
              nextDisabled: document.querySelector('#review-nav-bar [data-review-dir="next"]')?.disabled === true,
              viewMode: document.getElementById('review-nav-bar')?.dataset.viewMode || ''
            })"""
        )
        if not first_review_nav_state.get("prevDisabled") or first_review_nav_state.get("nextDisabled") or first_review_nav_state.get("viewMode") != "review":
            raise AssertionError(f"suite_review_nav_first_state_invalid:{first_review_nav_state}")
        await page.locator('#review-nav-bar [data-review-dir="next"]').click()
        await page.wait_for_url(f"**#/reading/p2-suite-e2e/review/reading-{SUITE_SESSION_ID}-p2?suiteSessionId={SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('#review-nav-bar[data-review-index="1"][data-review-total="3"]', timeout=10000)
        await page.locator('#review-nav-bar [data-review-dir="prev"]').click()
        await page.wait_for_url(f"**#/reading/p1-suite-e2e/review/reading-{SUITE_SESSION_ID}-p1?suiteSessionId={SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('#review-nav-bar[data-review-index="0"][data-review-total="3"]', timeout=10000)
        await page.locator('a:has-text("返回套题进度")').click()
        await page.wait_for_url(f"**#/reading-suite/{SUITE_SESSION_ID}", timeout=10000)

        replay_counts_before = await page.evaluate(
            """() => ({
              failedSuiteStateLoads: window.__practiceReadingSuiteFailedStateLoads,
              p1SessionLoads: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/sessions/reading/reading-suite-e2e-1-p1' && item.method === 'GET').length
            })"""
        )
        await page.evaluate("() => { window.__practiceReadingSuiteFailNextState = true; }")
        await page.evaluate(
            f"""() => {{
              window.location.hash = '#/reading/p1-suite-e2e/review/reading-{SUITE_SESSION_ID}-p1?suiteSessionId={SUITE_SESSION_ID}';
            }}"""
        )
        await page.wait_for_url(f"**#/reading/p1-suite-e2e/review/reading-{SUITE_SESSION_ID}-p1?suiteSessionId={SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('[data-reading-review-panel]', timeout=10000)
        await page.wait_for_selector('text=1 / 1 · 100%', timeout=10000)
        is_readonly = await page.locator('input[type="radio"][name="q1"][value="A"]').is_disabled()
        if not is_readonly:
            raise AssertionError("suite_review_replay_not_readonly")

        await page.locator('a:has-text("返回套题进度")').click()
        await page.wait_for_url(f"**#/reading-suite/{SUITE_SESSION_ID}", timeout=10000)
        await return_to_library(page, DIST_ENTRY.as_uri())
        await switch_library_view(page, 'practice', '[data-reading-records]')
        await page.wait_for_selector('#history-list .history-item[data-record-id="reading-reading-suite-e2e-1-p1"]', timeout=10000)
        await page.locator('#history-list [data-record-action="details"][data-record-id="reading-reading-suite-e2e-1-p1"]').click()
        await page.wait_for_url(f"**#/reading/p1-suite-e2e/review/reading-{SUITE_SESSION_ID}-p1?suiteSessionId={SUITE_SESSION_ID}", timeout=10000)
        await page.wait_for_selector('[data-reading-review-panel]', timeout=10000)
        await page.wait_for_selector('a:has-text("返回套题进度")', timeout=10000)

        requests = await page.evaluate(
            """() => ({
              creates: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/reading-suite' && item.method === 'POST').length,
              createBodies: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/reading-suite' && item.method === 'POST').map((item) => item.body),
              submits: window.__practiceReadingSuiteRequests.filter((item) => item.pathname.includes('/api/practice/reading-suite/suite-e2e-1/passages/') && item.method === 'POST').map((item) => item.pathname),
              submitTimerSnapshots: window.__practiceReadingSuiteRequests.filter((item) => item.pathname.includes('/api/practice/reading-suite/suite-e2e-1/passages/') && item.method === 'POST').map((item) => item.body?.attempt?.timerSnapshot || null),
              coachSessions: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/coach/stream' && item.method === 'POST').map((item) => item.body && item.body.sessionId),
              coachPayloads: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/coach/stream' && item.method === 'POST').map((item) => item.body?.payload || null),
              failedSuiteStateLoads: window.__practiceReadingSuiteFailedStateLoads,
              replaySessionLoads: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/sessions/reading/reading-suite-e2e-1-p1' && item.method === 'GET').length,
              historyLoads: window.__practiceReadingSuiteRequests.filter((item) => item.pathname === '/api/practice/history' && item.method === 'GET').length,
              legacyCalls: window.__practiceReadingSuiteRequests.filter((item) => item.pathname.includes('legacy')).length
            })"""
        )
        if requests.get("creates") != 2:
            raise AssertionError(f"suite_create_count_invalid:{requests}")
        expected_custom_body = {
            "flowMode": "classic",
            "frequencyScope": "custom",
            "sequence": ["p1-custom-suite-e2e", "p2-custom-suite-e2e", "p3-custom-suite-e2e"],
        }
        expected_regular_body = {"flowMode": "simulation", "frequencyScope": "high_medium"}
        if requests.get("createBodies") != [expected_custom_body, expected_regular_body]:
            raise AssertionError(f"suite_create_preference_invalid:{requests}")
        if requests.get("submits") != [
            "/api/practice/reading-suite/suite-e2e-1/passages/p1-suite-e2e",
            "/api/practice/reading-suite/suite-e2e-1/passages/p2-suite-e2e",
            "/api/practice/reading-suite/suite-e2e-1/passages/p3-suite-e2e",
        ]:
            raise AssertionError(f"suite_submit_order_invalid:{requests}")
        submit_timer_snapshots = requests.get("submitTimerSnapshots") or []
        if len(submit_timer_snapshots) != 3:
            raise AssertionError(f"suite_submit_timer_count_invalid:{requests}")
        for snapshot in submit_timer_snapshots:
            if not snapshot or snapshot.get("source") != "suite" or snapshot.get("anchorMs") != suite_timer_anchor:
                raise AssertionError(f"suite_submit_timer_invalid:{snapshot}:{suite_timer_anchor}")
            if snapshot.get("mode") != "elapsed" or snapshot.get("limitSeconds") is not None:
                raise AssertionError(f"suite_submit_timer_mode_invalid:{snapshot}")
        if requests.get("coachSessions") != [
            "reading-suite-e2e-1-p1",
            "reading-suite-e2e-1-p2",
            "reading-suite-e2e-1-p3",
        ]:
            raise AssertionError(f"suite_auto_review_not_waited:{requests}")
        coach_payloads = requests.get("coachPayloads") or []
        if len(coach_payloads) != 3:
            raise AssertionError(f"suite_coach_payload_count_invalid:{requests}")
        for payload in coach_payloads:
            attempt_context = payload.get("attemptContext") or {}
            if payload.get("mode") != "suite" or payload.get("surface") != "review_workspace" or payload.get("action") != "review_set":
                raise AssertionError(f"suite_coach_route_invalid:{payload}")
            if attempt_context.get("analysisSignals", {}).get("questionCount") != 1:
                raise AssertionError(f"suite_coach_analysis_signals_missing:{payload}")
            timeline = attempt_context.get("questionTimelineLite") or []
            if not timeline or timeline[0].get("questionId") != "q1" or timeline[0].get("visitCount", 0) < 1 or not isinstance(timeline[0].get("elapsedMs"), int):
                raise AssertionError(f"suite_coach_timeline_missing:{payload}")
            if "single_choice" not in (attempt_context.get("questionTypePerformance") or {}):
                raise AssertionError(f"suite_coach_question_type_performance_missing:{payload}")
        if requests.get("failedSuiteStateLoads", 0) != replay_counts_before.get("failedSuiteStateLoads", 0) + 1:
            raise AssertionError(f"suite_review_replay_failed_state_not_exercised:{requests}")
        if requests.get("replaySessionLoads", 0) <= replay_counts_before.get("p1SessionLoads", 0):
            raise AssertionError(f"suite_review_replay_session_not_reloaded:{requests}")
        if requests.get("historyLoads", 0) < 1:
            raise AssertionError(f"suite_history_replay_not_exercised:{requests}")
        if requests.get("legacyCalls") != 0:
            raise AssertionError(f"legacy_calls_detected:{requests}")

        await browser.close()

    return {
        "status": "pass",
        "detail": "Vue 阅读套题链路完成创建、P1/P2/P3 推进、逐篇提交与聚合完成回归",
        "evidence": {
            "suiteSessionId": SUITE_SESSION_ID,
            "entry": str(DIST_ENTRY),
            "passages": ["p1-suite-e2e", "p2-suite-e2e", "p3-suite-e2e"],
            "reviewReplay": "suite 状态接口失败时已提交记录仍可回放",
        },
    }


def main() -> None:
    try:
        result = asyncio.run(run_flow())
    except AssertionError as exc:
        print(json.dumps({"status": "fail", "detail": str(exc)}, ensure_ascii=False))
        raise SystemExit(1)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"status": "fail", "detail": f"unexpected_error:{exc}"}, ensure_ascii=False))
        raise SystemExit(1)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
