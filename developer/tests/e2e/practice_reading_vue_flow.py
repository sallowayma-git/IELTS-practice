#!/usr/bin/env python3
"""Vue Practice Reading flow regression.

Covers the new Vue reading chain with a mocked local Practice API:
1. Practice Library opens a reading asset in `/reading/:assetId`
2. the reading page renders passage, question groups, and answer sheet
3. native radio/text/checkbox inputs sync into the Vue answer state
4. dropzone-based legacy questions run through Vue-native drag/drop with an accessible select fallback
5. answer snapshot persists to sessionStorage
6. submit creates a Practice reading session and renders read-only review
7. AI coach is only available after submit and uses the submitted session id
8. Practice Library history can reopen the same submitted reading session without resubmitting
9. marked questions, answer changes, and analysis artifacts survive submit and replay
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DIST_ENTRY = REPO_ROOT / "dist" / "writing" / "index.html"
REPORT_DIR = REPO_ROOT / "developer" / "tests" / "e2e" / "reports"
LOCAL_API_BASE_URL = "http://127.0.0.1:3917"
ASSET_ID = "p2-low-148"

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


def entry_url_for(route: str = "/", run_id: int | None = None) -> str:
    normalized = route if route.startswith("/") else f"/{route}"
    suffix = f"?e2eBuild={run_id}" if run_id is not None else ""
    return f"{DIST_ENTRY.as_uri()}{suffix}#{normalized}"


async def install_api_stub(page) -> None:
    await page.add_init_script(
        f"""
        (() => {{
          window.__pageErrors = [];
          window.addEventListener('error', (event) => {{
            window.__pageErrors.push({{
              type: 'error',
              message: String(event?.message || ''),
              filename: String(event?.filename || ''),
              lineno: Number(event?.lineno || 0),
              colno: Number(event?.colno || 0)
            }});
          }});
          window.addEventListener('unhandledrejection', (event) => {{
            const reason = event?.reason;
            window.__pageErrors.push({{
              type: 'unhandledrejection',
              message: String(reason?.message || reason || '')
            }});
          }});
          const LOCAL_API_BASE_URL = '{LOCAL_API_BASE_URL}';
          Math.random = () => 0;
          window.__openedWindows = [];
          window.open = (url, name, features) => {{
            window.__openedWindows.push({{ url, name, features }});
            return {{ closed: false, focus() {{}} }};
          }};
          const readingAsset = {{
            id: '{ASSET_ID}',
            activity: 'reading',
            title: 'Why do we need the arts? 艺术的意义',
            source: 'reading_exam',
            category: 'P2',
            payloadRef: '{ASSET_ID}',
            metadata: {{ dataKey: '{ASSET_ID}', script: './p2-low-148.js', shuiPdf: 'assets/pdf/p2-low-148.pdf' }}
          }};
          const pdfOnlyReadingAsset = {{
            id: 'p2-pdf-only-e2e',
            activity: 'reading',
            title: 'PDF Only Reading Asset',
            source: 'reading_pdf',
            category: 'P2',
            payloadRef: '',
            metadata: {{ shuiPdf: 'assets/pdf/p2-pdf-only-e2e.pdf' }}
          }};
          const writingAsset = {{
            id: '7',
            activity: 'writing',
            title: 'Some people think homework should be optional.',
            source: 'writing_topic',
            category: 'education',
            difficulty: 3,
            payloadRef: '7',
            metadata: {{ taskType: 'task2' }}
          }};
          const readingDetail = {{
            ...readingAsset,
            payload: {{
              schemaVersion: 'ReadingExamSourceV1',
              examId: '{ASSET_ID}',
              meta: {{
                title: 'Why do we need the arts? 艺术的意义',
                category: 'P2',
                frequency: 'low',
                questionIntroHtml: '<h3>Questions</h3>'
              }},
              passage: {{
                blocks: [
                  {{
                    blockId: 'passage-main',
                    kind: 'html',
                    html: '<h2>READING PASSAGE 2</h2><h3>Why do we need the arts?</h3><p><strong>A</strong> Art changes how people see everyday experience.</p>'
                  }}
                ]
              }},
              questionGroups: [
                {{
                  groupId: 'group-radio',
                  kind: 'table_completion',
                  questionIds: ['q1'],
                  bodyHtml: '<div class="group"><h4>Questions 14</h4><div class="question-item"><div class="radio-options"><label><input type="radio" name="q1" value="A"> A paragraph A</label><label><input type="radio" name="q1" value="B"> B paragraph B</label></div></div></div>'
                }},
                {{
                  groupId: 'group-text',
                  kind: 'summary_completion',
                  questionIds: ['q6'],
                  bodyHtml: '<div class="group"><h4>Question 19</h4><div class="table-section"><table><thead><tr><th>Question</th><th>Answer</th><th>Context</th></tr></thead><tbody><tr><td>19</td><td><input class="blank" type="text" name="q6"></td><td>The arts and performance can work together.</td></tr></tbody></table></div><p class="summary-text">A summary blank <span class="drop-target-summary" data-question="q99"></span> remains inline.</p></div>'
                }},
                {{
                  groupId: 'group-checkbox',
                  kind: 'multi_choice',
                  questionIds: ['q10', 'q11'],
                  bodyHtml: '<div class="group"><h4>Questions 23 and 24</h4><div class="checkbox-options"><label><input type="checkbox" name="q10_11" value="B"> B fresh perspective</label><label><input type="checkbox" name="q10_11" value="D"> D reactions to things</label><label><input type="checkbox" name="q10_11" value="E"> E global issues</label></div></div>'
                }},
                {{
                  groupId: 'group-dropzone',
                  kind: 'matching',
                  questionIds: ['q12'],
                  bodyHtml: '<div class="group"><h4>Question 25</h4><div class="match-dropzone" data-question="q12"></div><div class="options-pool"><div class="drag-item" draggable="true" data-option="A">A individual experience</div><div class="drag-item" draggable="true" data-option="C">C unrelated to nature</div></div></div>'
                }}
              ],
              answerKey: {{ q1: 'A', q6: 'dancing', q10: 'B', q11: 'D', q12: 'C' }},
              questionOrder: ['q1', 'q6', 'q10', 'q11', 'q12'],
              questionDisplayMap: {{ q1: '14', q6: '19', q10: '23', q11: '24', q12: '25' }},
              questionCount: 5,
              reviewExplanations: {{
                schemaVersion: 'ReadingExplanationV1',
                examId: '{ASSET_ID}',
                meta: {{
                  examId: '{ASSET_ID}',
                  title: 'Why do we need the arts? 艺术的意义',
                  category: 'P2',
                  noteType: '总结'
                }},
                passageNotes: [
                  {{
                    label: 'Paragraph A',
                    text: 'OFFICIAL_PASSAGE_ONLY: Art changes how people inspect everyday evidence.'
                  }}
                ],
                questionExplanations: [
                  {{
                    sectionTitle: '1. 表格题（Question 14）',
                    mode: 'group',
                    questionRange: {{ start: 14, end: 14 }},
                    text: 'OFFICIAL_GROUP_ONLY: Q14 uses display-number mapping, not internal q1.',
                    items: [
                      {{
                        questionNumber: 14,
                        questionId: 'q1',
                        text: 'OFFICIAL_Q14_ONLY: This item should be shown through the group explanation.'
                      }}
                    ]
                  }},
                  {{
                    sectionTitle: '2. 多选题（Questions 23-24）',
                    mode: 'per_question',
                    questionRange: {{ start: 23, end: 24 }},
                    text: 'OFFICIAL_MULTI_GROUP_TEXT_SHOULD_NOT_REPLACE_PER_QUESTION',
                    items: [
                      {{
                        questionNumber: 23,
                        questionId: 'q10',
                        text: 'OFFICIAL_Q23_ONLY: Fresh perspective is supported by the question evidence.'
                      }},
                      {{
                        questionNumber: 24,
                        questionId: 'q11',
                        text: 'OFFICIAL_Q24_ONLY: Reactions to things is the second supported choice.'
                      }}
                    ]
                  }}
                ]
              }},
              interactionModel: {{
                q1: {{
                  questionId: 'q1',
                  displayLabel: '14',
                  control: 'radio',
                  source: 'native_input',
                  name: 'q1',
                  options: [{{ value: 'A', label: 'A' }}, {{ value: 'B', label: 'B' }}]
                }},
                q6: {{
                  questionId: 'q6',
                  displayLabel: '19',
                  control: 'text',
                  source: 'native_input',
                  name: 'q6'
                }},
                q10: {{
                  questionId: 'q10',
                  displayLabel: '23',
                  control: 'checkbox',
                  source: 'native_input',
                  name: 'q10_11',
                  options: [{{ value: 'B', label: 'B' }}, {{ value: 'D', label: 'D' }}, {{ value: 'E', label: 'E' }}]
                }},
                q11: {{
                  questionId: 'q11',
                  displayLabel: '24',
                  control: 'checkbox',
                  source: 'native_input',
                  name: 'q10_11',
                  options: [{{ value: 'B', label: 'B' }}, {{ value: 'D', label: 'D' }}, {{ value: 'E', label: 'E' }}]
                }},
                q12: {{
                  questionId: 'q12',
                  displayLabel: '25',
                  control: 'dragdrop',
                  source: 'dropzone',
                  name: 'q12',
                  allowOptionReuse: true,
                  options: [{{ value: 'A', label: 'A individual experience' }}, {{ value: 'C', label: 'C unrelated to nature' }}]
                }}
              }}
            }}
          }};

          const createHeaders = (contentType = 'application/json') => ({{
            get(name) {{
              return String(name || '').toLowerCase() === 'content-type' ? contentType : '';
            }}
          }});
          const createJsonResponse = (payload, ok = true, status = 200) => ({{
            ok,
            status,
            headers: createHeaders('application/json'),
            async json() {{ return payload; }},
            async text() {{ return JSON.stringify(payload); }}
          }});
          const encodeSse = (events) => events
            .map((entry) => `event: ${{entry.event}}\\ndata: ${{JSON.stringify(entry.data || {{}})}}\\n\\n`)
            .join('');
          const createSseResponse = (events, ok = true, status = 200) => {{
            const payload = encodeSse(events);
            const encoder = new TextEncoder();
            return {{
              ok,
              status,
              headers: createHeaders('text/event-stream'),
              body: new ReadableStream({{
                start(controller) {{
                  controller.enqueue(encoder.encode(payload));
                  controller.close();
                }}
              }}),
              async json() {{ return {{}}; }},
              async text() {{ return payload; }}
            }};
          }};
          const createDelayedSseResponse = (events, delayMs = 320, ok = true, status = 200) => {{
            const encoder = new TextEncoder();
            return {{
              ok,
              status,
              headers: createHeaders('text/event-stream'),
              body: new ReadableStream({{
                async start(controller) {{
                  for (const entry of events) {{
                    controller.enqueue(encoder.encode(encodeSse([entry])));
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                  }}
                  controller.close();
                }}
              }}),
              async json() {{ return {{}}; }},
              async text() {{ return encodeSse(events); }}
            }};
          }};
          const parseJsonBody = (init) => {{
            try {{
              return init && init.body ? JSON.parse(init.body) : {{}};
            }} catch (_) {{
              return {{}};
              }}
            }};
          const clone = (value) => JSON.parse(JSON.stringify(value));
          let lastSubmission = null;
          let lastDownloadedArchive = null;
          const readingHistoryRecords = [];
          const readingHistoryDetails = new Map();
          const upsertHistorySubmission = (submission) => {{
            lastSubmission = submission;
            const historyRecord = buildHistoryRecord(lastSubmission);
            readingHistoryRecords.splice(0, readingHistoryRecords.length, historyRecord);
            readingHistoryDetails.set(historyRecord.id, {{ ...historyRecord, submission: lastSubmission }});
            return historyRecord;
          }};
          const clearReadingHistory = () => {{
            lastSubmission = null;
            readingHistoryRecords.splice(0, readingHistoryRecords.length);
            readingHistoryDetails.clear();
          }};
          const buildReadingArchive = () => ({{
            schemaVersion: 'practice-history-archive.v1',
            activity: 'reading',
            exportedAt: '2026-05-21T00:04:00.000Z',
            count: readingHistoryRecords.length,
            submissions: readingHistoryRecords
              .map((record) => readingHistoryDetails.get(record.id)?.submission)
              .filter(Boolean)
              .map((submission) => clone(submission))
          }});
          const createObjectUrl = URL.createObjectURL.bind(URL);
          URL.createObjectURL = (blob) => {{
            if (blob && blob.type && String(blob.type).includes('application/json')) {{
              blob.text().then((text) => {{
                try {{
                  lastDownloadedArchive = JSON.parse(text);
                }} catch (_) {{
                  lastDownloadedArchive = null;
                }}
              }});
            }}
            return createObjectUrl(blob);
          }};
          window.__getPracticeReadingArchive = () => clone(lastDownloadedArchive);
          window.__clearPracticeReadingHistory = clearReadingHistory;
          window.__getPracticeReadingHistoryCount = () => readingHistoryRecords.length;
          const canonicalCoachLlmPatch = {{
            diagnosis: [
              {{
                code: 'coach_review_primary_weakness',
                reason: 'CANONICAL_PATCH_ONLY: 后端已归一化的错因',
                evidence: []
              }},
              {{
                code: 'coach_review_pattern',
                reason: 'CANONICAL_PATCH_ONLY: 后端已归一化的模式',
                evidence: []
              }},
              {{
                code: 'coach_review_q14',
                reason: 'CANONICAL_PATCH_ONLY: Q14 后端归一化诊断',
                evidence: []
              }}
            ],
            nextActions: [
              {{
                type: 'coach_review_thinking_plan',
                target: 'reading',
                instruction: 'CANONICAL_PATCH_ONLY: 后端已归一化的训练计划',
                evidence: []
              }},
              {{
                type: 'coach_review_next_rule',
                target: 'Q14',
                instruction: 'CANONICAL_PATCH_ONLY: Q14 后端归一化规则',
                evidence: []
              }}
            ],
            confidence: 0.86,
            model_trace: {{ source: 'reading_coach_v2', degraded: false }}
          }};
          const buildCoachFailureSnapshot = (failure) => ({{
            error: true,
            code: String(failure?.code || 'practice_coach_failed'),
            message: String(failure?.message || 'simulated automatic review failure')
          }});
          const attachCoachFailure = (requestBody, failure) => {{
            if (!lastSubmission) {{
              return null;
            }}
            const snapshot = buildCoachFailureSnapshot(failure);
            const transcript = Array.isArray(lastSubmission.readingCoachTranscript)
              ? lastSubmission.readingCoachTranscript.slice()
              : [];
            const query = String(requestBody?.payload?.query || '').trim();
            if (query) {{
              transcript.push({{ role: 'user', content: query, createdAt: '2026-05-21T00:02:00.000Z', surface: requestBody?.payload?.surface || null, action: requestBody?.payload?.action || null }});
            }}
            transcript.push({{ role: 'assistant', content: `阅读教练请求失败：${{snapshot.message}}`, createdAt: '2026-05-21T00:02:00.000Z', isError: true, snapshot }});
            lastSubmission = {{
              ...lastSubmission,
              readingCoachSnapshot: snapshot,
              readingCoachTranscript: transcript
            }};
            upsertHistorySubmission(lastSubmission);
            return snapshot;
          }};
          const buildHistoryRecord = (submission) => ({{
            id: `reading-${{submission.sessionId}}`,
            activity: 'reading',
            sessionId: submission.sessionId,
            assetId: submission.assetId,
            examId: submission.examId,
            title: readingDetail.title,
            status: 'completed',
            submittedAt: submission.submittedAt,
            startTime: submission.startTime,
            endTime: submission.endTime,
            duration: submission.duration,
            score: submission.scoreInfo.correct,
            totalQuestions: submission.scoreInfo.totalQuestions,
            correctAnswers: submission.scoreInfo.correct,
            accuracy: submission.scoreInfo.accuracy,
            metadata: {{ ...submission.metadata, historyRecordId: `reading-${{submission.sessionId}}` }}
          }});
          const buildSubmission = (requestBody) => {{
            const attempt = (requestBody && requestBody.attempt) || {{}};
            const answers = attempt.answers || {{}};
            const highlights = Array.isArray(attempt.highlights) ? attempt.highlights : [];
            const sessionId = 'reading-session-e2e-1';
            const comparison = {{
              q1: {{ questionId: 'q1', displayLabel: '14', userAnswer: answers.q1 || '', correctAnswer: 'A', normalizedUserAnswer: [answers.q1 || ''], normalizedCorrectAnswer: ['A'], isCorrect: answers.q1 === 'A', weight: 1, control: 'radio', source: 'native_input', questionKind: 'table_completion', matchMode: 'single' }},
              q6: {{ questionId: 'q6', displayLabel: '19', userAnswer: answers.q6 || '', correctAnswer: 'dancing', normalizedUserAnswer: [answers.q6 || ''], normalizedCorrectAnswer: ['dancing'], isCorrect: answers.q6 === 'dancing', weight: 1, control: 'text', source: 'native_input', questionKind: 'summary_completion', matchMode: 'single' }},
              q10: {{ questionId: 'q10', displayLabel: '23', userAnswer: answers.q10 || '', correctAnswer: 'B', normalizedUserAnswer: [answers.q10 || ''], normalizedCorrectAnswer: ['B'], isCorrect: answers.q10 === 'B', weight: 1, control: 'checkbox', source: 'native_input', questionKind: 'multi_choice', matchMode: 'single' }},
              q11: {{ questionId: 'q11', displayLabel: '24', userAnswer: answers.q11 || '', correctAnswer: 'D', normalizedUserAnswer: [answers.q11 || ''], normalizedCorrectAnswer: ['D'], isCorrect: answers.q11 === 'D', weight: 1, control: 'checkbox', source: 'native_input', questionKind: 'multi_choice', matchMode: 'single' }},
              q12: {{ questionId: 'q12', displayLabel: '25', userAnswer: answers.q12 || '', correctAnswer: 'C', normalizedUserAnswer: [answers.q12 || ''], normalizedCorrectAnswer: ['C'], isCorrect: answers.q12 === 'C', weight: 1, control: 'dragdrop', source: 'dropzone', questionKind: 'matching', matchMode: 'single' }}
            }};
            const correct = Object.values(comparison).filter((entry) => entry.isCorrect === true).length;
            const questionTimelineLite = Array.isArray(attempt.questionTimelineLite) ? attempt.questionTimelineLite : [];
            const markedQuestions = Array.isArray(attempt.markedQuestions) ? attempt.markedQuestions : [];
            const analysisSignals = {{
              questionCount: 5,
              unansweredCount: Object.values(answers).filter((value) => !String(value || '').trim()).length,
              changedAnswerCount: questionTimelineLite.filter((entry) => Number(entry.changeCount || 0) > 0).length,
              interactionDensity: Number(attempt.interactionCount || 0) / Math.max(Number(attempt.durationSec || 90) / 60, 1),
              markedQuestionCount: markedQuestions.length,
              highlightCount: highlights.length
            }};
            const questionTypePerformance = {{
              table_completion: {{ total: 1, correct: comparison.q1.isCorrect ? 1 : 0, accuracy: comparison.q1.isCorrect ? 1 : 0, questionIds: ['q1'], kind: 'table_completion', confidence: 0.75 }},
              summary_completion: {{ total: 1, correct: comparison.q6.isCorrect ? 1 : 0, accuracy: comparison.q6.isCorrect ? 1 : 0, questionIds: ['q6'], kind: 'summary_completion', confidence: 0.75 }},
              multi_choice: {{ total: 2, correct: (comparison.q10.isCorrect ? 1 : 0) + (comparison.q11.isCorrect ? 1 : 0), accuracy: ((comparison.q10.isCorrect ? 1 : 0) + (comparison.q11.isCorrect ? 1 : 0)) / 2, questionIds: ['q10', 'q11'], kind: 'multi_choice', confidence: 0.75 }},
              matching: {{ total: 1, correct: comparison.q12.isCorrect ? 1 : 0, accuracy: comparison.q12.isCorrect ? 1 : 0, questionIds: ['q12'], kind: 'matching', confidence: 0.75 }}
            }};
            const singleAttemptAnalysisInput = {{
              version: '1.0.0',
              generatedAt: requestBody?.attempt?.endTime || '2026-05-21T00:00:00.000Z',
              examId: '{ASSET_ID}',
              sessionId,
              type: 'reading',
              category: 'P2',
              totalQuestions: 5,
              correctAnswers: correct,
              accuracy: correct / 5,
              durationSec: Number(attempt.durationSec || 90),
              dataQuality: {{ confidence: 0.75, source: 'practice_reading_session' }},
              analysisSignals,
              questionTimelineLite,
              questionTypePerformance,
              unknownQuestions: 0,
              missingKindRatio: 0,
              confidence: 0.75,
              markedQuestions,
              highlights
            }};
            const singleAttemptAnalysis = {{
              summary: {{
                accuracy: correct / 5,
                durationSec: Number(attempt.durationSec || 90),
                unansweredRate: analysisSignals.unansweredCount / 5,
                changedAnswerRate: analysisSignals.changedAnswerCount / 5
              }},
              radar: {{
                byQuestionKind: Object.values(questionTypePerformance),
                byPassageCategory: [{{ category: 'P2', total: 5, correct, accuracy: correct / 5, confidence: 0.75 }}]
              }},
              diagnosis: [{{ type: 'stable_attempt', severity: 'low', message: '本次作答结构稳定，优先复盘错题证据和可迁移规则。', evidence: {{ accuracy: correct / 5 }} }}],
              nextActions: [{{ type: 'maintain_strength', target: 'mixed_review', instruction: '保留混合题复盘节奏，重点提炼本套题可复用的定位规则。', evidence: {{ accuracy: correct / 5 }} }}],
              confidence: 0.75
            }};
            const submission = {{
              sessionId,
              activity: 'reading',
              status: 'submitted',
              assetId: '{ASSET_ID}',
              examId: '{ASSET_ID}',
              submittedAt: requestBody?.attempt?.endTime || '2026-05-21T00:00:00.000Z',
              startTime: requestBody?.attempt?.startTime || null,
              endTime: requestBody?.attempt?.endTime || '2026-05-21T00:00:00.000Z',
              duration: Number(requestBody?.attempt?.durationSec || 90),
              readOnly: true,
              answers,
              correctAnswers: readingDetail.payload.answerKey,
              answerComparison: comparison,
              scoreInfo: {{
                correct,
                total: 5,
                totalQuestions: 5,
                accuracy: correct / 5,
                percentage: Math.round((correct / 5) * 100),
                duration: Number(requestBody?.attempt?.durationSec || 90),
                source: 'practice_reading_session'
              }},
              questionTypePerformance,
              highlights,
              markedQuestions,
              analysisSignals,
              questionTimelineLite,
              singleAttemptAnalysisInput,
              singleAttemptAnalysis,
              singleAttemptAnalysisLlm: null,
              coachContext: {{
                submitted: true,
                score: Math.round((correct / 5) * 100),
                wrongQuestions: Object.values(comparison).filter((entry) => entry.isCorrect === false).map((entry) => entry.displayLabel),
                selectedAnswers: {{ '14': answers.q1 || '', '19': answers.q6 || '', '23': answers.q10 || '', '24': answers.q11 || '', '25': answers.q12 || '' }}
              }},
              metadata: {{
                examId: '{ASSET_ID}',
                title: readingDetail.title,
                type: 'reading',
                renderMode: 'vue-reading',
                timerSnapshot: attempt.timerSnapshot || null,
                effectiveEndTime: attempt.effectiveEndTime || null,
                effectiveEndTimeMs: Number.isFinite(Number(attempt.effectiveEndTimeMs)) ? Number(attempt.effectiveEndTimeMs) : null,
                scrollY: Number.isFinite(Number(attempt.scrollY)) ? Number(attempt.scrollY) : 0
              }},
              legacy: {{ eventType: 'PRACTICE_COMPLETE', renderMode: 'vue-reading', practiceMode: 'single' }}
            }};
            return {{ sessionId, activity: 'reading', status: 'submitted', legacy: {{ provider: 'practice_reading', sessionId }}, submission }};
          }};

          window.electronAPI = {{
            getLocalApiInfo: async () => ({{
              success: true,
              data: {{ baseUrl: LOCAL_API_BASE_URL }}
            }})
          }};
          window.__practiceReadingRequests = [];
          window.__practiceTimerEventCount = 0;
          window.addEventListener('practiceTimerStateChange', () => {{
            window.__practiceTimerEventCount += 1;
          }});
          window.__practiceAutoReviewFailuresRemaining = 1;
          window.fetch = async (input, init = {{}}) => {{
            const url = typeof input === 'string' ? input : String(input && input.url ? input.url : '');
            if (!url.startsWith(LOCAL_API_BASE_URL)) {{
              throw new Error(`unexpected_fetch_url:${{url}}`);
            }}
            const parsed = new URL(url);
            const pathname = parsed.pathname;
            const method = String(init.method || 'GET').toUpperCase();
            const body = parseJsonBody(init);
            window.__practiceReadingRequests.push({{ method, pathname, search: parsed.search, body }});

            if (pathname === '/api/practice/assets' && method === 'GET') {{
              const activity = parsed.searchParams.get('activity');
              if (activity === 'reading') {{
                return createJsonResponse({{ success: true, data: {{ data: [pdfOnlyReadingAsset, readingAsset], total: 2, page: 1, limit: 48 }} }});
              }}
              if (activity === 'writing') {{
                return createJsonResponse({{ success: true, data: {{ data: [writingAsset], total: 1, page: 1, limit: 32 }} }});
              }}
              return createJsonResponse({{ success: true, data: {{ data: [writingAsset, pdfOnlyReadingAsset, readingAsset], total: 3, page: 1, limit: 80 }} }});
            }}

            if (pathname === '/api/practice/assets/reading/{ASSET_ID}' && method === 'GET') {{
              return createJsonResponse({{ success: true, data: readingDetail }});
            }}

            if (pathname === '/api/practice/history' && method === 'GET') {{
              const activity = parsed.searchParams.get('activity');
              const data = activity === 'reading' || !activity ? readingHistoryRecords : [];
              return createJsonResponse({{ success: true, data: {{ data, total: data.length, page: 1, limit: Number(parsed.searchParams.get('limit') || 5) }} }});
            }}

            if (pathname === '/api/practice/history' && method === 'DELETE') {{
              if ((parsed.searchParams.get('activity') || 'reading') === 'reading') {{
                const deletedCount = readingHistoryRecords.length;
                clearReadingHistory();
                return createJsonResponse({{ success: true, data: {{ deletedCount }} }});
              }}
              return createJsonResponse({{ success: true, data: {{ deletedCount: 0 }} }});
            }}

            if (pathname === '/api/practice/history/archive' && method === 'GET') {{
              if ((parsed.searchParams.get('activity') || 'reading') !== 'reading') {{
                return createJsonResponse({{ success: false, error: 'practice_history_archive_not_supported', message: 'unsupported' }}, false, 501);
              }}
              return createJsonResponse({{ success: true, data: buildReadingArchive() }});
            }}

            if (pathname === '/api/practice/history/archive/reading' && method === 'POST') {{
              const submissions = Array.isArray(body?.submissions) ? body.submissions : [];
              clearReadingHistory();
              submissions.forEach((submission) => upsertHistorySubmission(clone(submission)));
              return createJsonResponse({{ success: true, data: {{ importedCount: submissions.length, skippedCount: 0, total: readingHistoryRecords.length }} }});
            }}

            if (pathname === '/api/practice/history/reading/reading-reading-session-e2e-1' && method === 'GET') {{
              return createJsonResponse({{ success: true, data: readingHistoryDetails.get('reading-reading-session-e2e-1') || null }});
            }}

            if (pathname === '/api/practice/sessions/reading/reading-session-e2e-1' && method === 'GET') {{
              if (!lastSubmission) {{
                return createJsonResponse({{ success: false, error: 'practice_session_not_found', message: 'missing' }}, false, 404);
              }}
              return createJsonResponse({{ success: true, data: {{ sessionId: lastSubmission.sessionId, activity: 'reading', status: 'submitted', active: false, events: [], lastSequence: 0, submission: lastSubmission, legacy: lastSubmission.legacy }} }});
            }}

            if (pathname === '/api/practice/sessions' && method === 'POST') {{
              const created = buildSubmission(body);
              const historyRecord = upsertHistorySubmission(created.submission);
              return createJsonResponse({{ success: true, data: {{ ...created, historyRecord }} }});
            }}

            const buildCoachResponse = (requestBody) => {{
              const response = {{
                coachVersion: 'e2e',
                answer: 'Review question 14 evidence first.',
                answerSections: [
                  {{ type: 'reasoning', text: 'You changed Q14 because the paragraph keyword looked tempting.' }},
                  {{ type: 'next_step', text: 'Before choosing, map the question wording to one exact evidence sentence.' }}
                ],
                reviewOverall: {{
                  primaryWeakness: 'REVIEW_OVERALL_ONLY: 如果看到这句说明前端又在重建 patch',
                  patternSummary: 'REVIEW_OVERALL_ONLY: 不能作为 Vue 展示的 LLM 诊断',
                  teachingPlan: 'REVIEW_OVERALL_ONLY: 不能作为 Vue 展示的训练计划'
                }},
                reviewQuestionAnalyses: [
                  {{
                    questionNumber: '14',
                    likelyMistake: '只看到了 paragraph A 的表层关键词',
                    whyUserChoseWrong: '没有回到题干要求核对 arts 的具体作用',
                    whyCorrectAnswerWorks: '正确选项对应全文观点而不是局部词汇',
                    whyWrongAnswerFails: '错误选项只复用了词，不满足题干关系',
                    nextRule: 'REVIEW_ANALYSIS_ONLY: 不能作为 Vue 展示的下一步规则'
                  }}
                ],
                followUps: ['Show evidence'],
                confidence: 'high'
              }};
              const llmPatch = canonicalCoachLlmPatch;
              response.singleAttemptAnalysisLlm = llmPatch;
              if (lastSubmission) {{
                const transcript = Array.isArray(lastSubmission.readingCoachTranscript)
                  ? lastSubmission.readingCoachTranscript.slice()
                  : [];
                const query = String(requestBody?.payload?.query || '').trim();
                if (query) {{
                  transcript.push({{ role: 'user', content: query, createdAt: '2026-05-21T00:03:00.000Z', surface: requestBody?.payload?.surface || null, action: requestBody?.payload?.action || null }});
                }}
                transcript.push({{ role: 'assistant', content: response.answer, createdAt: '2026-05-21T00:03:00.000Z', snapshot: response }});
                lastSubmission = {{
                  ...lastSubmission,
                  readingCoachSnapshot: response,
                  readingCoachTranscript: transcript,
                  singleAttemptAnalysisLlm: llmPatch
                }};
                upsertHistorySubmission(lastSubmission);
              }}
              return response;
            }};

            if (pathname === '/api/practice/coach/stream' && method === 'POST') {{
              if (
                body?.payload?.promptKind === 'preset'
                && window.__practiceAutoReviewFailuresRemaining > 0
              ) {{
                window.__practiceAutoReviewFailuresRemaining -= 1;
                const failure = {{ code: 'practice_coach_failed', message: 'simulated automatic review failure' }};
                const snapshot = attachCoachFailure(body, failure) || buildCoachFailureSnapshot(failure);
                return createSseResponse([
                  {{ event: 'start', data: {{ success: true, sessionId: body?.sessionId || '' }} }},
                  {{ event: 'error', data: {{ success: false, error: {{ code: snapshot.code, message: snapshot.message }} }} }}
                ]);
              }}
              const response = buildCoachResponse(body);
              return createDelayedSseResponse([
                {{ event: 'start', data: {{ success: true, sessionId: body?.sessionId || '' }} }},
                {{ event: 'route', data: {{ type: 'route', data: {{ route: 'review_set', intent: 'review' }} }} }},
                {{ event: 'retrieval', data: {{ type: 'retrieval', data: {{ focusQuestionNumbers: body?.payload?.focusQuestionNumbers || [], chunkCount: 2 }} }} }},
                {{ event: 'generation_start', data: {{ type: 'generation_start', data: {{ model: 'e2e-review-model' }} }} }},
                {{ event: 'generation_complete', data: {{ type: 'generation_complete', data: {{ tokenCount: 128 }} }} }},
                {{ event: 'complete', data: {{ success: true, data: response }} }}
              ], 320);
            }}

            if (pathname === '/api/practice/coach' && method === 'POST') {{
              const response = buildCoachResponse(body);
              return createJsonResponse({{ success: true, data: response }});
            }}

            throw new Error(`unhandled_local_api_request:${{method}}:${{pathname}}`);
          }};
        }})();
        """
    )


async def switch_library_view(page, view: str, ready_selector: str) -> None:
    await page.evaluate(
        """(targetView) => {
            const navButton = document.querySelector(`[data-view="${targetView}"]`);
            if (navButton && typeof navButton.click === 'function') {
                navButton.click();
            }
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
    if view != "browse":
        await page.wait_for_selector(ready_selector, timeout=10000, state="attached")
    if view == "browse":
        await page.evaluate(
            """() => {
                if (window.app && typeof window.app.browseCategory === 'function') {
                    window.app.browseCategory('all', 'reading');
                }
                if (typeof window.loadExamList === 'function') {
                    try { window.loadExamList(); } catch (_) {}
                }
            }"""
        )
        await page.wait_for_timeout(1000)


async def return_to_library(page, entry_url: str) -> None:
    exit_button = page.locator('#exit-btn')
    target_href = await exit_button.get_attribute('href')
    if not target_href:
        raise AssertionError('return_to_library_missing_exit_href')
    target_url = await page.evaluate(
        """(href) => new URL(href, window.location.href).href""",
        target_href,
    )
    await exit_button.click()
    try:
        await page.wait_for_selector('[data-practice-reading-home]', timeout=5000, state="attached")
    except Exception:
        await page.goto(target_url)
        if not await page.locator('[data-practice-reading-home]').count():
            await page.goto('about:blank')
            await page.goto(entry_url)
    try:
        await page.wait_for_url("**#/", timeout=20000)
        await page.wait_for_selector('[data-practice-reading-home]', timeout=20000, state="attached")
        await page.wait_for_selector('[data-reading-overview]', timeout=20000, state="attached")
    except Exception as error:
        debug_state = await page.evaluate(
            """() => ({
                href: window.location.href,
                hash: window.location.hash,
                title: document.title,
                appHtml: document.getElementById('app')?.innerHTML?.slice(0, 500) || '',
                homePresent: Boolean(document.querySelector('[data-practice-reading-home]')),
                overviewPresent: Boolean(document.querySelector('[data-reading-overview]')),
                readingPagePresent: Boolean(document.querySelector('[data-practice-reading-page]')),
                exitHref: document.querySelector('#exit-btn')?.getAttribute('href') || '',
                pageErrors: Array.isArray(window.__pageErrors) ? window.__pageErrors.slice(-5) : []
            })"""
        )
        raise AssertionError(f"return_to_library_failed:{debug_state}") from error


async def accept_license_modal(page) -> None:
    license_modal = page.locator("#license-modal.show")
    await license_modal.wait_for(state="visible", timeout=10000)
    await license_modal.locator('[data-index-action="accept-license"]').click()
    await page.wait_for_function(
        "() => !document.getElementById('license-modal')?.classList.contains('show')",
        timeout=10000,
    )
    await page.wait_for_function(
        """
        () => {
          const modal = document.getElementById('license-modal');
          if (!modal) {
            return true;
          }
          const style = window.getComputedStyle(modal);
          return style.visibility === 'hidden' && Number(style.opacity) === 0 && style.pointerEvents === 'none';
        }
        """,
        timeout=10000,
    )
    accepted = await page.evaluate("() => window.localStorage.getItem('hasSeenGplLicense')")
    if accepted != "true":
        raise AssertionError(f"license_accept_not_persisted:{accepted}")


async def capture_acceptance_screenshot(page, screenshots: dict[str, str], key: str, selector: str, filename: str) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / filename
    target = page.locator(selector).first
    await target.wait_for(state="visible", timeout=10000)
    hidden_shell_state = await page.evaluate(
        """
        () => {
          const selectors = [
            '#license-modal',
            '#suite-mode-selector-modal',
            '#theme-switcher-modal',
            '#achievements-modal',
            '#fullscreen-clock-overlay'
          ];
          return selectors.map((selector) => {
            const node = document.querySelector(selector);
            if (!node) {
              return { selector, missing: true };
            }
            const style = window.getComputedStyle(node);
            return {
              selector,
              className: String(node.className || ''),
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              pointerEvents: style.pointerEvents
            };
          });
        }
        """
    )
    leaking_shells = [
        item for item in hidden_shell_state
        if not item.get("missing")
        and "show" not in str(item.get("className", "")).split()
        and "is-hidden" not in str(item.get("className", "")).split()
        and item.get("display") != "none"
        and item.get("visibility") != "hidden"
        and item.get("pointerEvents") != "none"
    ]
    if leaking_shells:
        raise AssertionError(f"acceptance_screenshot_hidden_shell_leak:{filename}:{leaking_shells}")
    await target.screenshot(path=str(path))
    if not path.exists() or path.stat().st_size <= 0:
        raise AssertionError(f"screenshot_missing_or_empty:{filename}")
    screenshots[key] = str(path)


async def run_flow() -> dict:
    ensure_bundle()
    run_id = DIST_ENTRY.stat().st_mtime_ns
    entry_url = entry_url_for("/", run_id)
    screenshots: dict[str, str] = {}

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"],
        )
        page = await browser.new_page()
        await install_api_stub(page)

        await page.goto(entry_url)
        await page.wait_for_selector('[data-practice-reading-home] h1:has-text("IELTS Atlas")', timeout=20000)
        await page.wait_for_selector('[data-reading-overview]', timeout=20000)
        await accept_license_modal(page)
        await capture_acceptance_screenshot(
            page,
            screenshots,
            "home",
            "[data-practice-reading-home]",
            "practice-reading-vue-home.png",
        )
        await page.goto(entry_url_for(f"/reading/{ASSET_ID}?mode=review", run_id))
        await page.wait_for_url(f"**#/reading/{ASSET_ID}?mode=memorize&practiceMode=memorize", timeout=10000)
        await page.wait_for_selector('.reading-page.reading-memorize-mode [data-practice-reading-page].memorize-mode', timeout=20000)
        await page.wait_for_selector('[data-reading-memorize-panel]', timeout=10000)
        legacy_memorize_state = await page.evaluate(
            """() => ({
              href: window.location.href,
              readOnly: Boolean(document.querySelector('.reading-page')?.classList.contains('reading-memorize-mode'))
                && Boolean(document.querySelector('[data-practice-reading-page]')?.classList.contains('memorize-mode')),
              hasPanel: Boolean(document.querySelector('[data-reading-memorize-panel]')),
              prefilledQ1: document.querySelector('[data-answer-question-id="q1"]')?.classList.contains('answered') === true,
              submitDisabled: document.getElementById('submit-btn')?.disabled === false
            })"""
        )
        if "mode=memorize" not in legacy_memorize_state.get("href", "") or "practiceMode=memorize" not in legacy_memorize_state.get("href", ""):
            raise AssertionError(f"legacy_memorize_query_not_normalized:{legacy_memorize_state}")
        if not legacy_memorize_state.get("readOnly") or not legacy_memorize_state.get("hasPanel") or not legacy_memorize_state.get("prefilledQ1"):
            raise AssertionError(f"legacy_memorize_mode_not_rendered:{legacy_memorize_state}")

        await page.goto(entry_url)
        await page.wait_for_selector('[data-practice-reading-home] h1:has-text("IELTS Atlas")', timeout=20000)
        await page.click('[data-view="more"]')
        await page.wait_for_selector('[data-action="open-reading-memorize"]', timeout=10000)
        await page.click('[data-action="open-reading-memorize"]')
        await page.wait_for_url(f"**#/reading/{ASSET_ID}?mode=memorize&practiceMode=memorize", timeout=10000)
        await page.wait_for_selector('.reading-page.reading-memorize-mode [data-practice-reading-page].memorize-mode', timeout=20000)
        await page.wait_for_selector('[data-reading-memorize-panel]', timeout=10000)

        await return_to_library(page, entry_url)
        await page.locator('button[data-action="browse-category"][data-category="P2"]').click()
        await page.wait_for_selector('#browse-view.active', timeout=10000)
        await page.wait_for_selector(f'.exam-item[data-reading-asset-id="{ASSET_ID}"]', timeout=20000)
        await capture_acceptance_screenshot(
            page,
            screenshots,
            "browse",
            "#browse-view",
            "practice-reading-vue-browse.png",
        )
        await page.locator(f'.exam-item[data-reading-asset-id="{ASSET_ID}"] button[data-action="pdf"]').click()
        opened_windows = await page.evaluate("() => window.__openedWindows || []")
        if not opened_windows or "assets/pdf/p2-low-148.pdf" not in opened_windows[0].get("url", ""):
            raise AssertionError(f"overview_pdf_button_failed:{opened_windows}")
        await page.wait_for_selector('.exam-item[data-reading-asset-id="p2-pdf-only-e2e"]', timeout=10000)
        await page.locator('.exam-item[data-reading-asset-id="p2-pdf-only-e2e"] button[data-action="start"]').click()
        pdf_only_state = await page.evaluate(
            """() => ({
              openedWindows: window.__openedWindows || [],
              href: window.location.href,
              pdfOnlyDetailGets: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/assets/reading/p2-pdf-only-e2e').length
            })"""
        )
        if len(pdf_only_state.get("openedWindows", [])) < 2 or "assets/pdf/p2-pdf-only-e2e.pdf" not in pdf_only_state.get("openedWindows", [])[-1].get("url", ""):
            raise AssertionError(f"pdf_only_start_did_not_open_pdf:{pdf_only_state}")
        if "#/reading/p2-pdf-only-e2e" in pdf_only_state.get("href", "") or pdf_only_state.get("pdfOnlyDetailGets") != 0:
            raise AssertionError(f"pdf_only_start_entered_empty_reading_page:{pdf_only_state}")

        await page.click('[data-view="overview"]')
        await page.wait_for_selector('[data-reading-overview]', timeout=10000)
        await page.locator('[data-start-reading-suite]').click()
        await page.wait_for_selector('#suite-mode-selector-modal:visible', timeout=10000)
        suite_selector_state = await page.evaluate(
            """() => ({
              classic: Boolean(document.querySelector('[data-suite-flow-mode="classic"]')),
              simulation: Boolean(document.querySelector('[data-suite-flow-mode="simulation"]')),
              stationary: Boolean(document.querySelector('[data-suite-flow-mode="stationary"]')),
              frequency: document.getElementById('suite-frequency-scope')?.value || ''
            })"""
        )
        if not suite_selector_state.get("classic") or not suite_selector_state.get("simulation") or not suite_selector_state.get("stationary") or not suite_selector_state.get("frequency"):
            raise AssertionError(f"suite_selector_contract_missing:{suite_selector_state}")
        await page.locator('#suite-mode-selector-modal [data-suite-flow-cancel="1"]').first.click()
        await page.wait_for_function(
            "() => !document.getElementById('suite-mode-selector-modal')?.classList.contains('show')",
            timeout=10000,
        )

        await page.locator('[data-action="start-endless-mode"]').click()
        await page.wait_for_url(f"**#/reading/{ASSET_ID}?mode=endless", timeout=10000)
        await page.wait_for_selector('[data-practice-reading-page]', timeout=20000)
        await page.wait_for_selector('h1:has-text("Why do we need the arts")', timeout=20000)
        endless_filter_state = await page.evaluate(
            """() => ({
              href: window.location.href,
              state: JSON.parse(window.sessionStorage.getItem('practice_reading_endless_state_v1') || 'null'),
              pdfOnlyDetailGets: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/assets/reading/p2-pdf-only-e2e').length
            })"""
        )
        endless_pool_ids = [entry.get("id") for entry in (endless_filter_state.get("state") or {}).get("pool", [])]
        if f"#/reading/{ASSET_ID}" not in endless_filter_state.get("href", "") or "mode=endless" not in endless_filter_state.get("href", ""):
            raise AssertionError(f"endless_did_not_start_payload_asset:{endless_filter_state}")
        if "p2-pdf-only-e2e" in endless_pool_ids or endless_filter_state.get("pdfOnlyDetailGets") != 0:
            raise AssertionError(f"endless_pool_included_pdf_only_asset:{endless_filter_state}")

        await page.goto(entry_url)
        await page.wait_for_selector('[data-practice-reading-home] h1:has-text("IELTS Atlas")', timeout=20000)
        await page.wait_for_selector('[data-reading-overview]', timeout=20000)
        await page.locator('button[data-action="start-random-practice"][data-category="P2"]').click()
        await page.wait_for_url(f"**#/reading/{ASSET_ID}", timeout=10000)
        await page.wait_for_selector('[data-practice-reading-page]', timeout=20000)
        await page.wait_for_selector('h1:has-text("Why do we need the arts")', timeout=20000)
        random_route_state = await page.evaluate(
            """() => ({
              requests: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/assets/reading/p2-low-148' && item.method === 'GET').length,
              href: window.location.href
            })"""
        )
        if random_route_state.get("requests", 0) < 1 or f"#/reading/{ASSET_ID}" not in random_route_state.get("href", ""):
            raise AssertionError(f"random_practice_route_failed:{random_route_state}")

        await page.goto(entry_url)
        await page.wait_for_selector('[data-practice-reading-home] h1:has-text("IELTS Atlas")', timeout=20000)
        await page.wait_for_selector('[data-reading-overview]', timeout=20000)
        await page.locator('button[data-action="browse-category"][data-category="P2"]').click()
        await page.wait_for_selector('#browse-view.active', timeout=10000)
        await page.wait_for_selector(f'.exam-item[data-reading-asset-id="{ASSET_ID}"]', timeout=20000)
        await page.locator(f'.exam-item[data-reading-asset-id="{ASSET_ID}"] button:has-text("开始练习")').click()
        browse_position_saved = await page.evaluate(
            """() => JSON.parse(window.localStorage.getItem('browse_view_preferences_v2') || '{}')"""
        )
        if browse_position_saved.get("lastAssetId") != ASSET_ID or browse_position_saved.get("autoScrollEnabled") is not True:
            raise AssertionError(f"browse_position_not_saved:{browse_position_saved}")

        await page.wait_for_url(f"**#/reading/{ASSET_ID}", timeout=10000)
        await page.wait_for_selector('[data-practice-reading-page]', timeout=20000)
        await page.wait_for_selector('h1:has-text("Why do we need the arts")', timeout=20000)
        await page.wait_for_selector('[data-question-group-id="group-radio"]', timeout=10000)
        await page.wait_for_selector('#settings-btn', timeout=10000)
        await page.wait_for_selector('#note-btn', timeout=10000)
        await page.wait_for_selector('#settings-panel', timeout=10000, state="attached")
        await page.wait_for_selector('#notes-panel', timeout=10000, state="attached")
        await page.wait_for_selector('#selbar', timeout=10000, state="attached")
        await page.wait_for_selector('#question-nav', timeout=10000)
        await page.wait_for_selector('#reset-btn', timeout=10000)
        await page.wait_for_selector('#submit-btn', timeout=10000)
        await page.wait_for_selector('.options-pool .drag-item[data-option="C"]', timeout=10000)
        await page.wait_for_selector('.match-dropzone[data-question="q12"]', timeout=10000)
        await capture_acceptance_screenshot(
            page,
            screenshots,
            "answer",
            ".reading-page",
            "practice-reading-vue-answer.png",
        )

        legacy_shell_state = await page.evaluate(
            """() => ({
              dividerRole: document.getElementById('divider')?.getAttribute('role') || '',
              dividerValue: Number(document.getElementById('divider')?.getAttribute('aria-valuenow') || 0),
              shellHeight: getComputedStyle(document.querySelector('.reading-workspace.shell')).height,
              shellBottom: document.querySelector('.reading-workspace.shell')?.getBoundingClientRect?.().bottom || 0,
              navPosition: getComputedStyle(document.querySelector('.practice-nav')).position,
              navBottom: getComputedStyle(document.querySelector('.practice-nav')).bottom,
              navTop: document.querySelector('.practice-nav')?.getBoundingClientRect?.().top || 0,
              rightPaddingTop: getComputedStyle(document.getElementById('right')).paddingTop,
              rightPaddingRight: getComputedStyle(document.getElementById('right')).paddingRight,
              timerCursor: getComputedStyle(document.getElementById('timer')).cursor,
              hasAnswerControlsInBottomNav: Boolean(document.querySelector('#question-nav select, #question-nav input[type="text"], #question-nav input[type="checkbox"]')),
              submitCopy: document.getElementById('submit-btn')?.textContent?.trim() || ''
            })"""
        )
        if legacy_shell_state.get("dividerRole") != "separator" or not 0 <= legacy_shell_state.get("dividerValue", -1) <= 100:
            raise AssertionError(f"legacy_divider_contract_missing:{legacy_shell_state}")
        if (
            legacy_shell_state.get("navPosition") != "fixed"
            or legacy_shell_state.get("navBottom") != "0px"
            or float(legacy_shell_state.get("shellBottom") or 0) > float(legacy_shell_state.get("navTop") or 0) + 1
        ):
            raise AssertionError(f"legacy_fixed_bottom_nav_layout_regressed:{legacy_shell_state}")
        if legacy_shell_state.get("rightPaddingTop") != "12px" or legacy_shell_state.get("rightPaddingRight") != "14px":
            raise AssertionError(f"legacy_right_pane_density_regressed:{legacy_shell_state}")
        if legacy_shell_state.get("timerCursor") != "pointer":
            raise AssertionError(f"legacy_timer_click_affordance_regressed:{legacy_shell_state}")
        if legacy_shell_state.get("hasAnswerControlsInBottomNav") or legacy_shell_state.get("submitCopy") != "Submit":
            raise AssertionError(f"legacy_bottom_nav_contract_regressed:{legacy_shell_state}")
        divider_resize_state = await page.evaluate(
            """async () => {
              const shell = document.querySelector('.reading-workspace.shell');
              const left = document.getElementById('left');
              const divider = document.getElementById('divider');
              if (!shell || !left || !divider) {
                return { ok: false, reason: 'missing-shell' };
              }
              const before = left.getBoundingClientRect().width;
              divider.focus();
              divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const after = left.getBoundingClientRect().width;
              return {
                ok: after > before + 20,
                before,
                after,
                gridTemplateColumns: getComputedStyle(shell).gridTemplateColumns,
                dividerWidth: getComputedStyle(divider).width,
                ariaValue: divider.getAttribute('aria-valuenow')
              };
            }"""
        )
        if not divider_resize_state.get("ok"):
            raise AssertionError(f"legacy_divider_resize_not_applied:{divider_resize_state}")
        timer_bridge_state = await page.evaluate(
            """() => ({
              hasBridge: Boolean(window.__IELTS_PRACTICE_TIMER__ && typeof window.__IELTS_PRACTICE_TIMER__.getSnapshot === 'function'),
              eventName: window.__IELTS_PRACTICE_TIMER__?.eventName || '',
              snapshot: window.__IELTS_PRACTICE_TIMER__?.getSnapshot?.() || null,
              eventCount: window.__practiceTimerEventCount || 0
            })"""
        )
        timer_snapshot = timer_bridge_state.get("snapshot") or {}
        if (
            not timer_bridge_state.get("hasBridge")
            or timer_bridge_state.get("eventName") != "practiceTimerStateChange"
            or timer_snapshot.get("source") != "local"
            or not isinstance(timer_snapshot.get("durationSeconds"), int)
        ):
            raise AssertionError(f"timer_bridge_missing:{timer_bridge_state}")
        await page.evaluate("() => window.__IELTS_PRACTICE_TIMER__.pause()")
        await page.wait_for_function("() => window.__IELTS_PRACTICE_TIMER__.getSnapshot().running === false", timeout=10000)
        await page.evaluate("() => window.__IELTS_PRACTICE_TIMER__.resume()")
        await page.wait_for_function("() => window.__IELTS_PRACTICE_TIMER__.getSnapshot().running === true", timeout=10000)
        await page.set_viewport_size({"width": 820, "height": 900})
        mobile_shell_state = await page.evaluate(
            """() => {
              const pageRoot = document.querySelector('.reading-page');
              const shell = document.querySelector('.reading-workspace.shell');
              const nav = document.querySelector('.practice-nav');
              const navControls = document.querySelector('.practice-nav .controls');
              const pageStyle = pageRoot ? getComputedStyle(pageRoot) : null;
              const shellStyle = shell ? getComputedStyle(shell) : null;
              const navStyle = nav ? getComputedStyle(nav) : null;
              const controlsStyle = navControls ? getComputedStyle(navControls) : null;
              return {
                pageHeight: pageStyle?.height || '',
                pageOverflowY: pageStyle?.overflowY || '',
                pagePaddingBottom: pageStyle?.paddingBottom || '',
                shellDisplay: shellStyle?.display || '',
                shellHeight: shellStyle?.height || '',
                shellOverflowY: shellStyle?.overflowY || '',
                navPosition: navStyle?.position || '',
                navBottom: navStyle?.bottom || '',
                navLeft: navStyle?.left || '',
                navRight: navStyle?.right || '',
                controlsWidth: controlsStyle?.width || '',
                controlsJustify: controlsStyle?.justifyContent || ''
              };
            }"""
        )
        if (
            mobile_shell_state.get("pageHeight") == "900px"
            or mobile_shell_state.get("pageOverflowY") == "hidden"
            or mobile_shell_state.get("pagePaddingBottom") != "112px"
            or mobile_shell_state.get("shellDisplay") != "block"
            or mobile_shell_state.get("shellOverflowY") != "visible"
            or mobile_shell_state.get("navPosition") != "fixed"
            or mobile_shell_state.get("navBottom") != "0px"
            or mobile_shell_state.get("navLeft") != "0px"
            or mobile_shell_state.get("navRight") != "0px"
            or mobile_shell_state.get("controlsJustify") != "flex-end"
        ):
            raise AssertionError(f"legacy_mobile_shell_scroll_model_regressed:{mobile_shell_state}")
        await page.set_viewport_size({"width": 1366, "height": 900})
        await page.wait_for_function(
            """() => getComputedStyle(document.querySelector('.reading-workspace.shell')).display === 'grid'""",
            timeout=10000,
        )

        await page.click('#settings-btn')
        await page.wait_for_selector('#settings-panel:visible', timeout=10000)
        await page.click('#settings-panel [data-size="large"]')
        await page.click('#settings-panel [data-mode="dark"]')
        settings_state = await page.evaluate(
            """() => ({
              large: document.querySelector('.reading-page')?.classList.contains('font-large') === true,
              dark: document.querySelector('.reading-page')?.classList.contains('dark-mode') === true,
              normalLabel: document.querySelector('#settings-panel [data-size="normal"]')?.textContent?.trim() || '',
              largeLabel: document.querySelector('#settings-panel [data-size="large"]')?.textContent?.trim() || '',
              xlargeLabel: document.querySelector('#settings-panel [data-size="xlarge"]')?.textContent?.trim() || '',
              normalFontSize: getComputedStyle(document.querySelector('#settings-panel [data-size="normal"]')).fontSize,
              largeFontSize: getComputedStyle(document.querySelector('#settings-panel [data-size="large"]')).fontSize,
              xlargeFontSize: getComputedStyle(document.querySelector('#settings-panel [data-size="xlarge"]')).fontSize
            })"""
        )
        if (
            not settings_state.get("large")
            or not settings_state.get("dark")
            or settings_state.get("normalLabel") != "A"
            or settings_state.get("largeLabel") != "A"
            or settings_state.get("xlargeLabel") != "A"
            or settings_state.get("normalFontSize") != "13.76px"
            or settings_state.get("largeFontSize") != "17.6px"
            or settings_state.get("xlargeFontSize") != "20px"
        ):
            raise AssertionError(f"settings_panel_not_applied:{settings_state}")
        await page.wait_for_function(
            """() => getComputedStyle(document.querySelector('.match-dropzone')).backgroundColor === 'rgb(30, 41, 59)'""",
            timeout=10000,
        )
        theme_styles = await page.evaluate(
            """() => {
              const pageRoot = document.querySelector('.reading-page');
              const header = document.querySelector('.reading-header.header');
              const group = document.querySelector('#question-groups .group');
              const navItem = document.querySelector('#question-nav .q-item');
              const dropzone = document.querySelector('.match-dropzone');
              const dragItem = document.querySelector('.options-pool .drag-item');
              const pageStyle = pageRoot ? getComputedStyle(pageRoot) : null;
              const headerStyle = header ? getComputedStyle(header) : null;
              const groupStyle = group ? getComputedStyle(group) : null;
              const navStyle = navItem ? getComputedStyle(navItem) : null;
              const dropzoneStyle = dropzone ? getComputedStyle(dropzone) : null;
              const dragItemStyle = dragItem ? getComputedStyle(dragItem) : null;
              return {
                pageBackground: pageStyle?.backgroundColor || '',
                headerBackground: headerStyle?.backgroundColor || '',
                groupBackground: groupStyle?.backgroundColor || '',
                navBackground: navStyle?.backgroundColor || '',
                dropzoneBackground: dropzoneStyle?.backgroundColor || '',
                dragItemBackground: dragItemStyle?.backgroundColor || ''
              };
            }"""
        )
        if (
            theme_styles.get("pageBackground") != "rgb(2, 6, 23)"
            or theme_styles.get("headerBackground") != "rgba(30, 41, 59, 0.94)"
            or theme_styles.get("groupBackground") != "rgb(30, 41, 59)"
            or theme_styles.get("navBackground") != "rgb(15, 23, 42)"
            or theme_styles.get("dropzoneBackground") != "rgb(30, 41, 59)"
            or theme_styles.get("dragItemBackground") != "rgb(51, 65, 85)"
        ):
            raise AssertionError(f"dark_mode_theme_skin_regressed:{theme_styles}")
        await page.click('.overlay')
        await page.wait_for_selector('#settings-panel', state="hidden", timeout=10000)
        await page.click('#settings-btn')
        await page.wait_for_selector('#settings-panel:visible', timeout=10000)
        await page.click('#settings-panel [data-mode="light"]')
        await page.click('.overlay')
        await page.wait_for_selector('#settings-panel', state="hidden", timeout=10000)
        await page.wait_for_function(
            """() => !document.querySelector('.reading-page')?.classList.contains('dark-mode')""",
            timeout=10000,
        )
        group_panel_style = await page.evaluate(
            """() => {
              const wrapper = document.querySelector('#question-groups .unified-group');
              const group = document.querySelector('#question-groups .group');
              const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
              const groupStyle = group ? getComputedStyle(group) : null;
              return {
                wrapperMarginBottom: wrapperStyle?.marginBottom || '',
                wrapperBorderRadius: wrapperStyle?.borderRadius || '',
                groupPaddingTop: groupStyle?.paddingTop || '',
                groupPaddingRight: groupStyle?.paddingRight || '',
                groupBorderRadius: groupStyle?.borderRadius || '',
                groupMarginBottom: groupStyle?.marginBottom || ''
              };
            }"""
        )
        if (
            group_panel_style.get("wrapperMarginBottom") != "16px"
            or group_panel_style.get("wrapperBorderRadius") != "4px"
            or group_panel_style.get("groupPaddingTop") != "18px"
            or group_panel_style.get("groupPaddingRight") != "22px"
            or group_panel_style.get("groupBorderRadius") != "4px"
            or group_panel_style.get("groupMarginBottom") != "0px"
        ):
            raise AssertionError(f"legacy_question_group_skin_regressed:{group_panel_style}")

        option_label_style = await page.evaluate(
            """() => {
              const radioLabel = document.querySelector('.radio-options label');
              const checkboxLabel = document.querySelector('.checkbox-options label');
              const radioInput = document.querySelector('.radio-options label input[type="radio"]');
              const checkboxInput = document.querySelector('.checkbox-options label input[type="checkbox"]');
              const radioStyle = radioLabel ? getComputedStyle(radioLabel) : null;
              const checkboxStyle = checkboxLabel ? getComputedStyle(checkboxLabel) : null;
              const radioInputStyle = radioInput ? getComputedStyle(radioInput) : null;
              const checkboxInputStyle = checkboxInput ? getComputedStyle(checkboxInput) : null;
              return {
                radioDisplay: radioStyle?.display || '',
                radioAlignItems: radioStyle?.alignItems || '',
                radioGap: radioStyle?.gap || '',
                radioMarginBottom: radioStyle?.marginBottom || '',
                radioCursor: radioStyle?.cursor || '',
                radioLineHeight: radioStyle?.lineHeight || '',
                checkboxDisplay: checkboxStyle?.display || '',
                checkboxAlignItems: checkboxStyle?.alignItems || '',
                checkboxGap: checkboxStyle?.gap || '',
                checkboxMarginBottom: checkboxStyle?.marginBottom || '',
                checkboxCursor: checkboxStyle?.cursor || '',
                radioInputMarginTop: radioInputStyle?.marginTop || '',
                radioInputFlexShrink: radioInputStyle?.flexShrink || '',
                radioInputCursor: radioInputStyle?.cursor || '',
                checkboxInputMarginTop: checkboxInputStyle?.marginTop || '',
                checkboxInputFlexShrink: checkboxInputStyle?.flexShrink || '',
                checkboxInputCursor: checkboxInputStyle?.cursor || ''
              };
            }"""
        )
        if (
            option_label_style.get("radioDisplay") != "flex"
            or option_label_style.get("radioAlignItems") != "flex-start"
            or option_label_style.get("radioGap") != "8px"
            or option_label_style.get("radioMarginBottom") != "12px"
            or option_label_style.get("radioCursor") != "pointer"
            or option_label_style.get("checkboxDisplay") != "flex"
            or option_label_style.get("checkboxAlignItems") != "flex-start"
            or option_label_style.get("checkboxGap") != "8px"
            or option_label_style.get("checkboxMarginBottom") != "12px"
            or option_label_style.get("checkboxCursor") != "pointer"
            or option_label_style.get("radioInputMarginTop") != "4px"
            or option_label_style.get("radioInputFlexShrink") != "0"
            or option_label_style.get("radioInputCursor") != "pointer"
            or option_label_style.get("checkboxInputMarginTop") != "4px"
            or option_label_style.get("checkboxInputFlexShrink") != "0"
            or option_label_style.get("checkboxInputCursor") != "pointer"
        ):
            raise AssertionError(f"legacy_option_label_layout_regressed:{option_label_style}")

        table_summary_style = await page.evaluate(
            """() => {
              const section = document.querySelector('.table-section');
              const table = document.querySelector('.table-section table');
              const head = document.querySelector('.table-section thead th');
              const cell = document.querySelector('.table-section tbody td');
              const blank = document.querySelector('.table-section input.blank[name="q6"]');
              const summary = document.querySelector('.drop-target-summary[data-question="q99"]');
              const sectionStyle = section ? getComputedStyle(section) : null;
              const tableStyle = table ? getComputedStyle(table) : null;
              const headStyle = head ? getComputedStyle(head) : null;
              const cellStyle = cell ? getComputedStyle(cell) : null;
              const blankStyle = blank ? getComputedStyle(blank) : null;
              const summaryStyle = summary ? getComputedStyle(summary) : null;
              return {
                sectionMarginTop: sectionStyle?.marginTop || '',
                sectionPaddingTop: sectionStyle?.paddingTop || '',
                sectionPaddingRight: sectionStyle?.paddingRight || '',
                sectionBorderRadius: sectionStyle?.borderRadius || '',
                sectionOverflowX: sectionStyle?.overflowX || '',
                tableMarginTop: tableStyle?.marginTop || '',
                tableLayout: tableStyle?.tableLayout || '',
                headBackground: headStyle?.backgroundColor || '',
                headTextAlign: headStyle?.textAlign || '',
                cellPaddingTop: cellStyle?.paddingTop || '',
                cellLineHeight: cellStyle?.lineHeight || '',
                blankDisplay: blankStyle?.display || '',
                blankMinWidth: blankStyle?.minWidth || '',
                blankMaxWidth: blankStyle?.maxWidth || '',
                blankPaddingTop: blankStyle?.paddingTop || '',
                blankPaddingRight: blankStyle?.paddingRight || '',
                blankBorderRadius: blankStyle?.borderRadius || '',
                summaryDisplay: summaryStyle?.display || '',
                summaryMinWidth: summaryStyle?.minWidth || '',
                summaryMinHeight: summaryStyle?.minHeight || '',
                summaryMarginLeft: summaryStyle?.marginLeft || '',
                summaryPaddingLeft: summaryStyle?.paddingLeft || '',
                summaryBorderTopWidth: summaryStyle?.borderTopWidth || '',
                summaryBorderLeftWidth: summaryStyle?.borderLeftWidth || '',
                summaryBorderBottomWidth: summaryStyle?.borderBottomWidth || '',
                summaryBorderBottomStyle: summaryStyle?.borderBottomStyle || '',
                summaryBorderRadius: summaryStyle?.borderRadius || '',
                summaryVerticalAlign: summaryStyle?.verticalAlign || '',
                summaryBoxShadow: summaryStyle?.boxShadow || ''
              };
            }"""
        )
        if (
            table_summary_style.get("sectionMarginTop") != "12px"
            or table_summary_style.get("sectionPaddingTop") != "10px"
            or table_summary_style.get("sectionPaddingRight") != "12px"
            or table_summary_style.get("sectionBorderRadius") != "8px"
            or table_summary_style.get("sectionOverflowX") != "auto"
            or table_summary_style.get("tableMarginTop") != "0px"
            or table_summary_style.get("tableLayout") != "fixed"
            or table_summary_style.get("headBackground") != "rgb(237, 242, 249)"
            or table_summary_style.get("headTextAlign") != "center"
            or table_summary_style.get("cellPaddingTop") != "10px"
            or table_summary_style.get("blankDisplay") != "inline-block"
            or table_summary_style.get("blankMinWidth") != "120px"
            or table_summary_style.get("blankMaxWidth") != "180px"
            or table_summary_style.get("blankPaddingTop") != "2px"
            or table_summary_style.get("blankPaddingRight") != "6px"
            or table_summary_style.get("blankBorderRadius") != "4px"
            or table_summary_style.get("summaryDisplay") != "inline-flex"
            or table_summary_style.get("summaryMinWidth") != "80px"
            or table_summary_style.get("summaryMinHeight") != "30px"
            or table_summary_style.get("summaryMarginLeft") != "4px"
            or table_summary_style.get("summaryPaddingLeft") != "8px"
            or table_summary_style.get("summaryBorderTopWidth") != "0px"
            or table_summary_style.get("summaryBorderLeftWidth") != "0px"
            or table_summary_style.get("summaryBorderBottomWidth") != "2px"
            or table_summary_style.get("summaryBorderBottomStyle") != "solid"
            or table_summary_style.get("summaryBorderRadius") != "4px 4px 0px 0px"
            or table_summary_style.get("summaryVerticalAlign") != "bottom"
            or table_summary_style.get("summaryBoxShadow") != "none"
        ):
            raise AssertionError(f"legacy_table_summary_skin_regressed:{table_summary_style}")

        await page.locator('input[type="radio"][name="q1"][value="A"]').check()
        await page.locator('input[type="radio"][name="q1"][value="B"]').check()
        await page.locator('input[type="radio"][name="q1"][value="A"]').check()
        await page.fill('input[type="text"][name="q6"]', 'dancing')
        await page.locator('input[type="checkbox"][name="q10_11"][value="B"]').check()
        await page.locator('input[type="checkbox"][name="q10_11"][value="D"]').check()
        await page.locator('.options-pool .drag-item[data-option="C"]').drag_to(
            page.locator('.match-dropzone[data-question="q12"]')
        )

        await page.wait_for_selector('[data-answer-question-id="q1"].answered', timeout=10000)
        await page.wait_for_selector('[data-answer-question-id="q6"].answered', timeout=10000)
        await page.wait_for_selector('[data-answer-question-id="q10"].answered', timeout=10000)
        await page.wait_for_selector('[data-answer-question-id="q11"].answered', timeout=10000)
        await page.wait_for_selector('[data-answer-question-id="q12"].answered', timeout=10000)
        await page.click('[data-answer-question-id="q6"] .q-item')
        nav_item_style = await page.evaluate(
            """() => {
              const item = document.querySelector('[data-answer-question-id="q6"] .q-item');
              const style = item ? getComputedStyle(item) : null;
              return {
                paddingLeft: style?.paddingLeft || '',
                paddingRight: style?.paddingRight || '',
                borderRadius: style?.borderRadius || '',
                minWidth: style?.minWidth || '',
                minHeight: style?.minHeight || '',
                borderColor: style?.borderColor || '',
                backgroundColor: style?.backgroundColor || '',
                color: style?.color || '',
                fontWeight: style?.fontWeight || ''
              };
            }"""
        )
        if (
            nav_item_style.get("paddingLeft") != "12px"
            or nav_item_style.get("paddingRight") != "12px"
            or nav_item_style.get("borderRadius") != "4px"
            or nav_item_style.get("minWidth") not in ("0px", "auto")
            or nav_item_style.get("minHeight") not in ("0px", "auto")
            or nav_item_style.get("borderColor") != "rgb(37, 99, 235)"
            or nav_item_style.get("backgroundColor") != "rgb(239, 246, 255)"
            or nav_item_style.get("color") != "rgb(37, 99, 235)"
            or nav_item_style.get("fontWeight") != "600"
        ):
            raise AssertionError(f"legacy_question_nav_item_skin_regressed:{nav_item_style}")
        bottom_control_style = await page.evaluate(
            """() => {
              const reset = document.getElementById('reset-btn');
              const submit = document.getElementById('submit-btn');
              const resetStyle = reset ? getComputedStyle(reset) : null;
              const submitStyle = submit ? getComputedStyle(submit) : null;
              return {
                resetRadius: resetStyle?.borderRadius || '',
                submitRadius: submitStyle?.borderRadius || '',
                submitBackground: submitStyle?.backgroundColor || ''
              };
            }"""
        )
        if (
            bottom_control_style.get("resetRadius") != "4px"
            or bottom_control_style.get("submitRadius") != "4px"
            or bottom_control_style.get("submitBackground") != "rgb(37, 99, 235)"
        ):
            raise AssertionError(f"legacy_bottom_controls_skin_regressed:{bottom_control_style}")
        await page.locator('[data-answer-question-id="q6"] .mark-question-button').click()
        await page.wait_for_selector('[data-answer-question-id="q6"] .mark-question-button.active', timeout=10000)

        answer_values = await page.evaluate(
            """() => ({
              q1: document.querySelector('input[type="radio"][name="q1"][value="A"]')?.checked ? 'A' : '',
              q6: document.querySelector('input[type="text"][name="q6"]')?.value || '',
              q10: document.querySelector('input[type="checkbox"][name="q10_11"][value="B"]')?.checked ? 'B' : '',
              q11: document.querySelector('input[type="checkbox"][name="q10_11"][value="D"]')?.checked ? 'D' : '',
              q12: document.querySelector('.match-dropzone[data-question="q12"]')?.dataset?.answerValue || '',
              q12Chip: document.querySelector('.match-dropzone[data-question="q12"] .dragdrop-chip-assigned')?.dataset?.answerValue || '',
              nativeQ12DropzoneValue: document.querySelector('.match-dropzone[data-question="q12"]')?.dataset?.answerValue || ''
            })"""
        )
        expected = {"q1": "A", "q6": "dancing", "q10": "B", "q11": "D", "q12": "C", "q12Chip": "C", "nativeQ12DropzoneValue": "C"}
        if answer_values != expected:
            raise AssertionError(f"answer_state_mismatch:{answer_values}")

        highlight_result = await page.evaluate(
            """() => {
              const walker = document.createTreeWalker(document.getElementById('left'), NodeFilter.SHOW_TEXT);
              let node = walker.nextNode();
              while (node && !(node.textContent || '').includes('Art changes')) {
                node = walker.nextNode();
              }
              if (!node) return { ok: false, reason: 'text_node_missing' };
              const start = (node.textContent || '').indexOf('Art changes');
              const range = document.createRange();
              range.setStart(node, start);
              range.setEnd(node, start + 'Art changes'.length);
              const selection = window.getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              document.dispatchEvent(new Event('selectionchange'));
              return { ok: true, text: selection.toString() };
            }"""
        )
        if not highlight_result.get("ok"):
            raise AssertionError(f"highlight_selection_failed:{highlight_result}")
        await page.wait_for_selector('#selbar:visible', timeout=10000)
        selbar_style = await page.evaluate(
            """() => {
              const bar = document.getElementById('selbar');
              const button = document.getElementById('btnHL');
              const barStyle = bar ? getComputedStyle(bar) : null;
              const buttonStyle = button ? getComputedStyle(button) : null;
              return {
                barBackground: barStyle?.backgroundColor || '',
                barColor: barStyle?.color || '',
                buttonBackground: buttonStyle?.backgroundColor || '',
                buttonColor: buttonStyle?.color || ''
              };
            }"""
        )
        if (
            selbar_style.get("barBackground") != "rgb(30, 41, 59)"
            or selbar_style.get("buttonBackground") != "rgba(0, 0, 0, 0)"
            or selbar_style.get("buttonColor") != "rgb(255, 255, 255)"
        ):
            raise AssertionError(f"selection_toolbar_skin_regressed:{selbar_style}")
        await page.click('#btnHL')
        await page.wait_for_selector('#left .hl:has-text("Art changes")', timeout=10000)
        highlight_style = await page.evaluate(
            """() => {
              const highlight = document.querySelector('#left .hl');
              const style = highlight ? getComputedStyle(highlight) : null;
              return {
                backgroundColor: style?.backgroundColor || '',
                color: style?.color || '',
                text: highlight?.textContent?.trim() || ''
              };
            }"""
        )
        if (
            highlight_style.get("text") != "Art changes"
            or highlight_style.get("backgroundColor") != "rgb(114, 54, 28)"
            or highlight_style.get("color") != "rgb(255, 255, 255)"
        ):
            raise AssertionError(f"highlight_skin_regressed:{highlight_style}")
        await page.evaluate("() => window.scrollTo(0, 180)")
        await page.click('#left .hl')
        await page.wait_for_selector('#review-highlight-dictionary-bubble:visible', timeout=10000)
        await page.click('#review-highlight-dictionary-bubble .vocab-add')
        await page.wait_for_selector('#review-highlight-dictionary-bubble .vocab-add:has-text("已加入")', timeout=10000)
        await page.click('#note-btn')
        await page.wait_for_selector('#notes-panel:visible', timeout=10000)
        await page.fill('#notes-panel textarea', 'manual reading note')
        await page.locator('.overlay').click(position={"x": 8, "y": 8})
        await page.wait_for_selector('#notes-panel', state="hidden", timeout=10000)

        await page.click('button:has-text("保存作答快照")')
        await page.wait_for_selector('text=作答快照已保存到当前会话', timeout=10000)
        snapshot = await page.evaluate(
            f"""() => JSON.parse(window.sessionStorage.getItem('practice_reading_answers_{ASSET_ID}') || 'null')"""
        )
        if not snapshot or snapshot.get("answers", {}).get("q12") != "C":
            raise AssertionError(f"snapshot_missing_or_invalid:{snapshot}")
        if "q6" not in snapshot.get("markedQuestions", []):
            raise AssertionError(f"snapshot_marked_questions_missing:{snapshot}")
        q1_timeline = next((item for item in snapshot.get("questionTimelineLite", []) if item.get("questionId") == "q1"), None)
        if not q1_timeline or q1_timeline.get("changeCount", 0) < 1:
            raise AssertionError(f"snapshot_timeline_missing_change:{snapshot}")

        await page.click('#submit-btn')
        await page.wait_for_selector('[data-reading-review-panel]', timeout=10000)
        await page.wait_for_selector('[data-reading-analysis-panel]', timeout=10000)
        await page.wait_for_selector('[data-analysis-diagnosis-type="stable_attempt"]', timeout=10000)
        await page.wait_for_selector('[data-analysis-action-type="maintain_strength"]', timeout=10000)
        await page.wait_for_selector('[data-reading-kind-performance] [data-analysis-kind="matching"]', timeout=10000)
        await page.wait_for_selector('text=5 / 5 · 100%', timeout=10000)
        await page.wait_for_selector('[data-review-question-id="q12"].review-correct', timeout=10000)
        await page.wait_for_selector('[data-reading-official-passage-explanations]:has-text("OFFICIAL_PASSAGE_ONLY")', timeout=10000)
        await page.wait_for_selector('[data-reading-official-explanations]:has-text("OFFICIAL_GROUP_ONLY")', timeout=10000)
        await page.wait_for_selector('[data-reading-official-question-explanation="q10"]:has-text("OFFICIAL_Q23_ONLY")', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-review-status="failed"]', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-review-retry]', timeout=10000)
        await page.wait_for_selector('[data-reading-coach-transcript] [data-reading-coach-message="assistant"]:has-text("simulated automatic review failure")', timeout=10000)
        failed_review_state = await page.evaluate(
            """() => {
              const cached = JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null');
              const transcript = Array.isArray(cached?.readingCoachTranscript) ? cached.readingCoachTranscript : [];
              return {
                snapshotError: cached?.readingCoachSnapshot?.error === true,
                snapshotCode: cached?.readingCoachSnapshot?.code || '',
                snapshotMessage: cached?.readingCoachSnapshot?.message || '',
                hasUserReviewTurn: transcript.some((entry) => entry.role === 'user' && entry.action === 'review_set' && entry.surface === 'review_workspace' && String(entry.content || '').includes('复盘')),
                hasAssistantErrorTurn: transcript.some((entry) => entry.role === 'assistant' && entry.isError === true && String(entry.content || '').includes('simulated automatic review failure') && entry.snapshot?.error === true),
                coachTranscriptText: document.querySelector('[data-reading-coach-transcript]')?.textContent || ''
              };
            }"""
        )
        if (
            not failed_review_state.get("snapshotError")
            or failed_review_state.get("snapshotCode") != "practice_coach_failed"
            or "simulated automatic review failure" not in failed_review_state.get("snapshotMessage", "")
            or not failed_review_state.get("hasUserReviewTurn")
            or not failed_review_state.get("hasAssistantErrorTurn")
            or "simulated automatic review failure" not in failed_review_state.get("coachTranscriptText", "")
        ):
            raise AssertionError(f"auto_review_failure_not_persisted:{failed_review_state}")
        await page.evaluate(
            """() => {
              const target = document.querySelector('[data-reading-llm-review-status]');
              window.__readingLlmReviewStatuses = [];
              window.__readingLlmReviewStatusObserver?.disconnect?.();
              const capture = () => {
                const text = target?.textContent?.replace(/\\s+/g, ' ').trim() || '';
                if (text && !window.__readingLlmReviewStatuses.includes(text)) {
                  window.__readingLlmReviewStatuses.push(text);
                }
              };
              if (target) {
                window.__readingLlmReviewStatusObserver = new MutationObserver(capture);
                window.__readingLlmReviewStatusObserver.observe(target, {
                  attributes: true,
                  childList: true,
                  characterData: true,
                  subtree: true
                });
                capture();
              }
            }"""
        )
        await page.click('[data-reading-llm-review-retry]')
        await page.wait_for_selector('[data-reading-llm-review-status="success"]', timeout=10000)
        llm_statuses = await page.evaluate(
            """() => window.__readingLlmReviewStatuses || []"""
        )
        for expected_status in (
            '正在判断问题意图...',
            'RAG 已检索 2 条证据...',
            '正在生成错因复盘...',
            '复盘生成完成，正在落库...',
        ):
            if not any(expected_status in status for status in llm_statuses):
                raise AssertionError(f"auto_review_stream_status_missing:{expected_status}:{llm_statuses}")
        await page.wait_for_selector('[data-reading-llm-review-panel]', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-diagnosis="coach_review_primary_weakness"]', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-action="coach_review_next_rule"]', timeout=10000)
        results_panel_style = await page.evaluate(
            """() => {
              const results = document.getElementById('results');
              const table = document.querySelector('#results .results-table');
              const resultsStyle = results ? getComputedStyle(results) : null;
              const tableStyle = table ? getComputedStyle(table) : null;
              return {
                display: resultsStyle?.display || '',
                borderRadius: resultsStyle?.borderRadius || '',
                paddingTop: resultsStyle?.paddingTop || '',
                marginTop: resultsStyle?.marginTop || '',
                tableMarginTop: tableStyle?.marginTop || '',
                cellTextAlign: getComputedStyle(document.querySelector('#results .results-table td'))?.textAlign || ''
              };
            }"""
        )
        if (
            results_panel_style.get("display") == "none"
            or results_panel_style.get("borderRadius") != "4px"
            or results_panel_style.get("paddingTop") != "18px"
            or results_panel_style.get("marginTop") != "18px"
            or results_panel_style.get("tableMarginTop") != "12px"
            or results_panel_style.get("cellTextAlign") != "center"
        ):
            raise AssertionError(f"legacy_results_panel_skin_regressed:{results_panel_style}")
        await capture_acceptance_screenshot(
            page,
            screenshots,
            "result",
            ".reading-page",
            "practice-reading-vue-result.png",
        )

        submit_request = await page.evaluate(
            """() => window.__practiceReadingRequests.find((item) => item.pathname === '/api/practice/sessions' && item.method === 'POST') || null"""
        )
        submit_attempt = (submit_request or {}).get("body", {}).get("attempt", {})
        if "q6" not in submit_attempt.get("markedQuestions", []):
            raise AssertionError(f"submit_marked_questions_missing:{submit_request}")
        submitted_q1_timeline = next((item for item in submit_attempt.get("questionTimelineLite", []) if item.get("questionId") == "q1"), None)
        if not submitted_q1_timeline or submitted_q1_timeline.get("changeCount", 0) < 1:
            raise AssertionError(f"submit_timeline_missing_change:{submit_request}")
        if submitted_q1_timeline.get("visitCount", 0) < 1 or not isinstance(submitted_q1_timeline.get("elapsedMs"), int) or not isinstance(submitted_q1_timeline.get("durationMs"), int):
            raise AssertionError(f"submit_timeline_ai_signals_missing:{submit_request}")
        if submit_attempt.get("interactionCount", 0) < 1:
            raise AssertionError(f"submit_interaction_count_missing:{submit_request}")
        submit_timer = submit_attempt.get("timerSnapshot") or {}
        if (
            submit_timer.get("source") != "local"
            or not isinstance(submit_timer.get("durationSeconds"), int)
            or not submit_attempt.get("effectiveEndTime")
            or not isinstance(submit_attempt.get("effectiveEndTimeMs"), int)
            or not isinstance(submit_attempt.get("scrollY"), int)
        ):
            raise AssertionError(f"submit_timer_metadata_missing:{submit_request}")
        submit_highlights = submit_attempt.get("highlights") or []
        if len(submit_highlights) != 1 or submit_highlights[0].get("scope") != "passage" or submit_highlights[0].get("text") != "Art changes":
            raise AssertionError(f"submit_highlights_missing:{submit_request}")
        if submit_highlights[0].get("kind") != "highlight" or submit_highlights[0].get("startOffset") is None or submit_highlights[0].get("occurrence") is None:
            raise AssertionError(f"submit_highlight_metadata_missing:{submit_request}")

        analysis_state = await page.evaluate(
            """() => ({
              markedCount: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.analysisSignals?.markedQuestionCount,
              changedCount: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.analysisSignals?.changedAnswerCount,
              q1VisitCount: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.questionTimelineLite?.find((item) => item.questionId === 'q1')?.visitCount,
              q1ElapsedMs: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.questionTimelineLite?.find((item) => item.questionId === 'q1')?.elapsedMs,
              highlightCount: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.analysisSignals?.highlightCount,
              highlightText: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.highlights?.[0]?.text,
              llmPrimaryWeakness: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.singleAttemptAnalysisLlm?.diagnosis?.[0]?.reason,
              llmNextRule: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.singleAttemptAnalysisLlm?.nextActions?.[1]?.instruction,
              timerSnapshotSource: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.metadata?.timerSnapshot?.source,
              effectiveEndTimeMs: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.metadata?.effectiveEndTimeMs,
              scrollY: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')?.metadata?.scrollY,
              llmPanelText: document.querySelector('[data-reading-llm-review-panel]')?.textContent || '',
              officialText: document.querySelector('[data-reading-official-explanations]')?.textContent || '',
              officialPassageText: document.querySelector('[data-reading-official-passage-explanations]')?.textContent || '',
              hasAnalysisPanel: Boolean(document.querySelector('[data-reading-analysis-panel]')),
              hasKindBars: Boolean(document.querySelector('[data-reading-kind-performance] [data-analysis-kind="matching"]')),
              hasLlmPanel: Boolean(document.querySelector('[data-reading-llm-review-panel]'))
            })"""
        )
        if analysis_state.get("markedCount") != 1 or analysis_state.get("changedCount", 0) < 1:
            raise AssertionError(f"analysis_snapshot_invalid:{analysis_state}")
        if analysis_state.get("q1VisitCount", 0) < 1 or not isinstance(analysis_state.get("q1ElapsedMs"), int):
            raise AssertionError(f"analysis_timeline_ai_signals_invalid:{analysis_state}")
        if analysis_state.get("highlightCount") != 1 or analysis_state.get("highlightText") != "Art changes":
            raise AssertionError(f"analysis_highlight_snapshot_invalid:{analysis_state}")
        if analysis_state.get("llmPrimaryWeakness") != "CANONICAL_PATCH_ONLY: 后端已归一化的错因":
            raise AssertionError(f"analysis_llm_snapshot_missing:{analysis_state}")
        if analysis_state.get("llmNextRule") != "CANONICAL_PATCH_ONLY: Q14 后端归一化规则":
            raise AssertionError(f"analysis_llm_next_rule_not_canonical:{analysis_state}")
        if analysis_state.get("timerSnapshotSource") != "local" or not isinstance(analysis_state.get("effectiveEndTimeMs"), int) or not isinstance(analysis_state.get("scrollY"), int):
            raise AssertionError(f"analysis_timer_metadata_invalid:{analysis_state}")
        if "CANONICAL_PATCH_ONLY: 后端已归一化的错因" not in analysis_state.get("llmPanelText", ""):
            raise AssertionError(f"analysis_llm_panel_not_canonical:{analysis_state}")
        if "REVIEW_OVERALL_ONLY" in analysis_state.get("llmPanelText", ""):
            raise AssertionError(f"analysis_llm_panel_used_review_overall:{analysis_state}")
        if "OFFICIAL_GROUP_ONLY" not in analysis_state.get("officialText", "") or "OFFICIAL_PASSAGE_ONLY" not in analysis_state.get("officialPassageText", ""):
            raise AssertionError(f"official_explanations_missing_after_submit:{analysis_state}")
        if "OFFICIAL_GROUP_ONLY" in analysis_state.get("llmPanelText", ""):
            raise AssertionError(f"official_explanation_leaked_into_llm_panel:{analysis_state}")
        if not analysis_state.get("hasAnalysisPanel") or not analysis_state.get("hasKindBars") or not analysis_state.get("hasLlmPanel"):
            raise AssertionError(f"analysis_panel_missing:{analysis_state}")

        readonly_state = await page.evaluate(
            """() => ({
              nativeRadioDisabled: document.querySelector('input[type="radio"][name="q1"][value="A"]')?.disabled === true,
              hasAnswerSelectInBottomNav: Boolean(document.querySelector('#question-nav select, #question-nav input[type="text"], #question-nav input[type="checkbox"]')),
              nativeDropzoneReadonly: document.querySelector('.match-dropzone[data-question="q12"] [data-dropzone-clear]')?.disabled === true,
              markedButtonReadonly: document.querySelector('[data-answer-question-id="q6"] .mark-question-button')?.disabled === true,
              submission: JSON.parse(window.sessionStorage.getItem('practice_reading_submission_p2-low-148') || 'null')
            })"""
        )
        if not readonly_state.get("nativeRadioDisabled") or readonly_state.get("hasAnswerSelectInBottomNav") or not readonly_state.get("nativeDropzoneReadonly") or not readonly_state.get("markedButtonReadonly"):
            raise AssertionError(f"review_not_readonly:{readonly_state}")
        if readonly_state.get("submission", {}).get("sessionId") != "reading-session-e2e-1":
            raise AssertionError(f"submission_snapshot_invalid:{readonly_state}")

        await page.wait_for_selector('[data-reading-coach-panel]', timeout=10000)
        await page.evaluate(
            """() => {
              const target = document.querySelector('[data-reading-coach-stream-status]');
              window.__readingCoachStreamStatuses = [];
              window.__readingCoachStreamStatusObserver?.disconnect?.();
              const capture = () => {
                const text = target?.textContent?.replace(/\\s+/g, ' ').trim() || '';
                if (text && !window.__readingCoachStreamStatuses.includes(text)) {
                  window.__readingCoachStreamStatuses.push(text);
                }
              };
              if (target) {
                window.__readingCoachStreamStatusObserver = new MutationObserver(capture);
                window.__readingCoachStreamStatusObserver.observe(target, {
                  attributes: true,
                  childList: true,
                  characterData: true,
                  subtree: true
                });
                capture();
              }
            }"""
        )
        await page.click('button:has-text("询问教练")')
        await page.wait_for_selector('[data-reading-coach-answer]:has-text("Review question 14 evidence first.")', timeout=10000)
        manual_statuses = await page.evaluate(
            """() => window.__readingCoachStreamStatuses || []"""
        )
        for expected_status in (
            '正在判断问题意图...',
            'RAG 已检索 2 条证据...',
            '正在生成教练回答...',
            '回答生成完成，正在同步记录...',
        ):
            if not any(expected_status in status for status in manual_statuses):
                raise AssertionError(f"manual_coach_stream_status_missing:{expected_status}:{manual_statuses}")
        coach_requests = await page.evaluate(
            """() => window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/coach/stream')"""
        )
        coach_fallback_requests = await page.evaluate(
            """() => window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/coach')"""
        )
        auto_review_requests = [item for item in coach_requests if item.get("body", {}).get("payload", {}).get("promptKind") == "preset"]
        auto_review_request = auto_review_requests[-1] if auto_review_requests else None
        manual_coach_request = next((item for item in coach_requests if item.get("body", {}).get("payload", {}).get("promptKind") == "freeform"), None)
        if coach_fallback_requests:
            raise AssertionError(f"coach_stream_fallback_unexpected:{coach_fallback_requests}")
        if len(auto_review_requests) < 2:
            raise AssertionError(f"auto_review_retry_missing:{coach_requests}")
        if not auto_review_request or auto_review_request.get("body", {}).get("sessionId") != "reading-session-e2e-1":
            raise AssertionError(f"auto_review_session_id_missing:{coach_requests}")
        if not manual_coach_request or manual_coach_request.get("body", {}).get("sessionId") != "reading-session-e2e-1":
            raise AssertionError(f"manual_coach_session_id_missing:{coach_requests}")
        auto_payload = auto_review_request.get("body", {}).get("payload", {})
        manual_payload = manual_coach_request.get("body", {}).get("payload", {})
        if any(
            item.get("body", {}).get("payload", {}).get("action") != "review_set"
            or item.get("body", {}).get("payload", {}).get("surface") != "review_workspace"
            for item in auto_review_requests
        ):
            raise AssertionError(f"auto_review_prompt_route_regressed:{coach_requests}")
        if manual_payload.get("action") != "chat" or manual_payload.get("surface") != "chat_widget":
            raise AssertionError(f"manual_coach_prompt_route_regressed:{coach_requests}")
        for label, payload in (("auto", auto_payload), ("manual", manual_payload)):
            attempt_context = payload.get("attemptContext") or {}
            if attempt_context.get("submitted") is not True:
                raise AssertionError(f"{label}_coach_attempt_context_not_submitted:{payload}")
            analysis_signals = attempt_context.get("analysisSignals") or {}
            if analysis_signals.get("questionCount") != 5 or analysis_signals.get("markedQuestionCount") != 1 or analysis_signals.get("highlightCount") != 1:
                raise AssertionError(f"{label}_coach_analysis_signals_missing:{payload}")
            timeline_q1 = next((item for item in attempt_context.get("questionTimelineLite") or [] if item.get("questionId") == "q1"), None)
            if not timeline_q1 or timeline_q1.get("visitCount", 0) < 1 or not isinstance(timeline_q1.get("elapsedMs"), int):
                raise AssertionError(f"{label}_coach_timeline_missing:{payload}")
            type_performance = attempt_context.get("questionTypePerformance") or {}
            if "matching" not in type_performance or not any((entry or {}).get("total", 0) > 0 for entry in type_performance.values()):
                raise AssertionError(f"{label}_coach_question_type_performance_missing:{payload}")
            if "q6" not in attempt_context.get("markedQuestions", []):
                raise AssertionError(f"{label}_coach_marked_questions_missing:{payload}")
        if auto_payload.get("mode") != "single" or manual_payload.get("mode") != "single":
            raise AssertionError(f"coach_mode_invalid:{coach_requests}")

        await page.click('#reset-btn')
        await page.wait_for_selector('text=已重置本篇练习，可重新作答。', timeout=10000)
        reset_recycle_state = await page.evaluate(
            """() => ({
              reviewPanelGone: !document.querySelector('[data-reading-review-panel]'),
              coachPanelGone: !document.querySelector('[data-reading-coach-panel]'),
              submitCopy: document.getElementById('submit-btn')?.textContent?.trim() || '',
              resetDisabled: document.getElementById('reset-btn')?.disabled === true,
              nativeRadioDisabled: document.querySelector('input[type="radio"][name="q1"][value="A"]')?.disabled === true,
              textValue: document.querySelector('input[type="text"][name="q6"]')?.value || '',
              q12: document.querySelector('.match-dropzone[data-question="q12"]')?.dataset?.answerValue || '',
              highlightCount: document.querySelectorAll('#left .hl').length,
              cachedSubmission: window.sessionStorage.getItem('practice_reading_submission_p2-low-148'),
              persistedHistoryCount: window.__getPracticeReadingHistoryCount ? window.__getPracticeReadingHistoryCount() : -1,
              submitPosts: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/sessions' && item.method === 'POST').length
            })"""
        )
        if (
            not reset_recycle_state.get("reviewPanelGone")
            or not reset_recycle_state.get("coachPanelGone")
            or reset_recycle_state.get("submitCopy") != "Submit"
            or reset_recycle_state.get("resetDisabled")
            or reset_recycle_state.get("nativeRadioDisabled")
            or reset_recycle_state.get("textValue")
            or reset_recycle_state.get("q12")
            or reset_recycle_state.get("highlightCount") != 0
            or reset_recycle_state.get("cachedSubmission") is not None
            or reset_recycle_state.get("persistedHistoryCount") != 1
            or reset_recycle_state.get("submitPosts") != 1
        ):
            raise AssertionError(f"submitted_reset_recycle_invalid:{reset_recycle_state}")
        await page.locator('input[type="radio"][name="q1"][value="A"]').check()
        await page.fill('input[type="text"][name="q6"]', 'second attempt')
        second_attempt_state = await page.evaluate(
            """() => ({
              q1Checked: document.querySelector('input[type="radio"][name="q1"][value="A"]')?.checked === true,
              q6Value: document.querySelector('input[type="text"][name="q6"]')?.value || '',
              answered: document.querySelector('[data-answer-question-id="q6"]')?.classList.contains('answered') === true
            })"""
        )
        if not second_attempt_state.get("q1Checked") or second_attempt_state.get("q6Value") != "second attempt" or not second_attempt_state.get("answered"):
            raise AssertionError(f"submitted_reset_recycle_not_editable:{second_attempt_state}")

        await return_to_library(page, entry_url)
        await page.locator('button[data-action="browse-category"][data-category="P2"]').click()
        await page.wait_for_selector('#browse-view.active', timeout=10000)
        await page.wait_for_selector(f'.exam-item[data-reading-asset-id="{ASSET_ID}"]', timeout=10000)
        browse_restore_state = await page.evaluate(
            f"""() => ({{
              activeView: document.querySelector('#browse-view')?.classList.contains('active') === true,
              targetPresent: Boolean(document.querySelector('.exam-item[data-reading-asset-id="{ASSET_ID}"]')),
              selectedCategory: document.getElementById('browse-title')?.textContent?.trim() || '',
              stored: JSON.parse(window.localStorage.getItem('browse_view_preferences_v2') || '{{}}')
            }})"""
        )
        if not browse_restore_state.get("activeView") or not browse_restore_state.get("targetPresent") or browse_restore_state.get("stored", {}).get("lastAssetId") != ASSET_ID:
            raise AssertionError(f"browse_position_not_restored:{browse_restore_state}")
        await page.click('[data-view="practice"]')
        await page.wait_for_selector('#history-list .history-item[data-record-id="reading-reading-session-e2e-1"]', timeout=10000)
        await page.locator('#record-type-filter-buttons [data-action-value="reading"]').click()
        record_filter_state = await page.evaluate(
            """() => ({
              activeValue: document.querySelector('#record-type-filter-buttons .shui-filter-btn.active')?.dataset?.actionValue || '',
              readingPressed: document.querySelector('#record-type-filter-buttons [data-action-value="reading"]')?.getAttribute('aria-pressed') || '',
              allPressed: document.querySelector('#record-type-filter-buttons [data-action-value="all"]')?.getAttribute('aria-pressed') || '',
              visibleRecords: document.querySelectorAll('#history-list .history-item').length
            })"""
        )
        if record_filter_state.get("activeValue") != "reading" or record_filter_state.get("readingPressed") != "true" or record_filter_state.get("allPressed") != "false" or record_filter_state.get("visibleRecords") != 1:
            raise AssertionError(f"history_record_filter_reading_inactive:{record_filter_state}")
        await page.locator('#record-type-filter-buttons [data-action-value="all"]').click()
        record_filter_reset_state = await page.evaluate(
            """() => ({
              activeValue: document.querySelector('#record-type-filter-buttons .shui-filter-btn.active')?.dataset?.actionValue || '',
              readingPressed: document.querySelector('#record-type-filter-buttons [data-action-value="reading"]')?.getAttribute('aria-pressed') || '',
              allPressed: document.querySelector('#record-type-filter-buttons [data-action-value="all"]')?.getAttribute('aria-pressed') || '',
              visibleRecords: document.querySelectorAll('#history-list .history-item').length
            })"""
        )
        if record_filter_reset_state.get("activeValue") != "all" or record_filter_reset_state.get("readingPressed") != "false" or record_filter_reset_state.get("allPressed") != "true" or record_filter_reset_state.get("visibleRecords") != 1:
            raise AssertionError(f"history_record_filter_all_inactive:{record_filter_reset_state}")
        await page.locator('#history-list [data-record-action="details"][data-record-id="reading-reading-session-e2e-1"]').click()

        await page.wait_for_url(f"**#/reading/{ASSET_ID}/review/reading-session-e2e-1", timeout=10000)
        await page.wait_for_selector('[data-reading-review-panel]', timeout=10000)
        await page.wait_for_selector('[data-reading-analysis-panel]', timeout=10000)
        await page.wait_for_selector('[data-answer-question-id="q6"] .mark-question-button.active:disabled', timeout=10000)
        await page.wait_for_selector('text=5 / 5 · 100%', timeout=10000)
        await page.wait_for_selector('[data-reading-official-passage-explanations]:has-text("OFFICIAL_PASSAGE_ONLY")', timeout=10000)
        await page.wait_for_selector('[data-reading-official-explanations]:has-text("OFFICIAL_GROUP_ONLY")', timeout=10000)
        replay_state = await page.evaluate(
            """() => ({
              q12: document.querySelector('.match-dropzone[data-question="q12"]')?.dataset?.answerValue || '',
              q12Dropzone: document.querySelector('.match-dropzone[data-question="q12"]')?.dataset?.answerValue || '',
              q12Chip: document.querySelector('.match-dropzone[data-question="q12"] .dragdrop-chip-assigned')?.dataset?.answerValue || '',
              reviewRowText: document.querySelector('[data-review-question-id="q12"]')?.textContent?.replace(/\s+/g, ' ').trim() || '',
              submissionQ12: window.__debugSubmission?.answers?.q12 || '',
              comparisonQ12: window.__debugSubmission?.answerComparison?.q12?.userAnswer || '',
              answerStateQ12: window.__debugAnswers?.q12 || '',
              interactionQ12: window.__debugPayload?.interactionModel?.q12?.control || '',
              questionOrder: Array.isArray(window.__debugPayload?.questionOrder) ? window.__debugPayload.questionOrder.slice() : [],
              hasAnswerSelectInBottomNav: Boolean(document.querySelector('#question-nav select, #question-nav input[type="text"], #question-nav input[type="checkbox"]')),
              markedRestored: document.querySelector('[data-answer-question-id="q6"] .mark-question-button')?.classList.contains('active') === true,
              highlightRestored: document.querySelector('#left .hl')?.textContent?.trim() || '',
              changedCount: document.querySelector('[data-reading-analysis-signals]')?.textContent?.includes('改答') === true,
              llmRestored: Boolean(document.querySelector('[data-reading-llm-review-panel] [data-reading-llm-diagnosis="coach_review_primary_weakness"]')),
              llmText: document.querySelector('[data-reading-llm-review-panel]')?.textContent || '',
              officialText: document.querySelector('[data-reading-official-explanations]')?.textContent || '',
              officialPassageText: document.querySelector('[data-reading-official-passage-explanations]')?.textContent || '',
              submitPosts: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/sessions' && item.method === 'POST').length,
              replayGets: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/sessions/reading/reading-session-e2e-1' && item.method === 'GET').length
            })"""
        )
        if replay_state.get("q12") != "C" or replay_state.get("q12Dropzone") != "C" or replay_state.get("hasAnswerSelectInBottomNav") or not replay_state.get("markedRestored") or replay_state.get("highlightRestored") != "Art changes" or not replay_state.get("changedCount") or not replay_state.get("llmRestored"):
            raise AssertionError(f"replay_not_restored:{replay_state}")
        if "CANONICAL_PATCH_ONLY: 后端已归一化的错因" not in replay_state.get("llmText", "") or "REVIEW_OVERALL_ONLY" in replay_state.get("llmText", ""):
            raise AssertionError(f"replay_llm_not_canonical:{replay_state}")
        if "OFFICIAL_GROUP_ONLY" not in replay_state.get("officialText", "") or "OFFICIAL_PASSAGE_ONLY" not in replay_state.get("officialPassageText", ""):
            raise AssertionError(f"replay_official_explanations_missing:{replay_state}")
        if replay_state.get("submitPosts") != 1 or replay_state.get("replayGets", 0) < 1:
            raise AssertionError(f"replay_used_wrong_api:{replay_state}")
        baseline_submit_posts = int(replay_state.get("submitPosts") or 0)
        await capture_acceptance_screenshot(
            page,
            screenshots,
            "replay",
            ".reading-page",
            "practice-reading-vue-replay.png",
        )

        await return_to_library(page, entry_url)
        await switch_library_view(page, "settings", "#settings-view")
        await page.wait_for_selector('#export-data-btn', timeout=10000)
        await capture_acceptance_screenshot(
            page,
            screenshots,
            "settings",
            "#settings-view",
            "practice-reading-vue-settings.png",
        )
        await page.click('#export-data-btn')
        await page.wait_for_selector('text=阅读记录导出完成：1 条', timeout=10000)
        archive = None
        for _ in range(20):
            archive = await page.evaluate(
                """() => window.__getPracticeReadingArchive ? window.__getPracticeReadingArchive() : null"""
            )
            if archive and archive.get("count") == 1:
                break
            await page.wait_for_timeout(100)
        if not archive or archive.get("count") != 1:
            raise AssertionError(f"archive_export_missing:{archive}")
        archived_submission = (archive.get("submissions") or [{}])[0]
        if archived_submission.get("sessionId") != "reading-session-e2e-1":
            raise AssertionError(f"archive_session_missing:{archive}")
        archived_llm = archived_submission.get("singleAttemptAnalysisLlm") or {}
        if (archived_llm.get("diagnosis") or [{}])[0].get("reason") != "CANONICAL_PATCH_ONLY: 后端已归一化的错因":
            raise AssertionError(f"archive_llm_patch_missing:{archive}")
        if (archived_submission.get("readingCoachSnapshot") or {}).get("answer") != "Review question 14 evidence first.":
            raise AssertionError(f"archive_coach_snapshot_missing:{archive}")
        archived_highlights = archived_submission.get("highlights") or []
        if len(archived_highlights) != 1 or archived_highlights[0].get("text") != "Art changes":
            raise AssertionError(f"archive_highlights_missing:{archive}")
        archived_metadata = archived_submission.get("metadata") or {}
        if (archived_metadata.get("timerSnapshot") or {}).get("source") != "local" or not isinstance(archived_metadata.get("effectiveEndTimeMs"), int) or not isinstance(archived_metadata.get("scrollY"), int):
            raise AssertionError(f"archive_timer_metadata_missing:{archive}")

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as archive_file:
            json.dump(archive, archive_file, ensure_ascii=False)
            archive_path = archive_file.name
        try:
            await page.evaluate(
                """() => window.__clearPracticeReadingHistory && window.__clearPracticeReadingHistory()"""
            )
            await page.goto(entry_url)
            await page.wait_for_selector('[data-practice-reading-home] h1:has-text("IELTS Atlas")', timeout=20000)
            cleared_count = await page.evaluate(
                """() => window.__getPracticeReadingHistoryCount ? window.__getPracticeReadingHistoryCount() : -1"""
            )
            if cleared_count != 0:
                raise AssertionError(f"archive_clear_precondition_failed:{cleared_count}")
            await switch_library_view(page, "settings", "#settings-view")
            await page.wait_for_selector('[data-reading-archive-import-input]', timeout=10000)
            await page.set_input_files('[data-reading-archive-import-input]', archive_path)
            await page.wait_for_function(
                """
                () => {
                  const requests = Array.isArray(window.__practiceReadingRequests) ? window.__practiceReadingRequests : [];
                  const importPosts = requests.filter((item) => item.pathname === '/api/practice/history/archive/reading' && item.method === 'POST').length;
                  const historyCount = window.__getPracticeReadingHistoryCount ? window.__getPracticeReadingHistoryCount() : -1;
                  return importPosts >= 1 && historyCount === 1;
                }
                """,
                timeout=10000,
            )
            await switch_library_view(page, "practice", "#practice-view")
            await page.wait_for_selector('#history-list .history-item[data-record-id="reading-reading-session-e2e-1"]', timeout=10000)
            await page.locator('#record-type-filter-buttons [data-action-value="reading"]').click()
            imported_filter_state = await page.evaluate(
                """() => ({
                  activeValue: document.querySelector('#record-type-filter-buttons .shui-filter-btn.active')?.dataset?.actionValue || '',
                  visibleRecords: document.querySelectorAll('#history-list .history-item').length
                })"""
            )
            if imported_filter_state.get("activeValue") != "reading" or imported_filter_state.get("visibleRecords") != 1:
                raise AssertionError(f"archive_import_history_filter_regressed:{imported_filter_state}")
            await page.locator('#history-list [data-record-action="details"][data-record-id="reading-reading-session-e2e-1"]').click()
            await page.wait_for_url(f"**#/reading/{ASSET_ID}/review/reading-session-e2e-1", timeout=10000)
            await page.wait_for_selector('[data-reading-review-panel]', timeout=10000)
            await page.wait_for_selector('[data-reading-llm-review-panel] [data-reading-llm-diagnosis="coach_review_primary_weakness"]', timeout=10000)
            await page.wait_for_selector('[data-reading-coach-answer]:has-text("Review question 14 evidence first.")', timeout=10000)
            imported_replay_state = await page.evaluate(
                """() => ({
                  q12: document.querySelector('.match-dropzone[data-question="q12"]')?.dataset?.answerValue || '',
                  markedRestored: document.querySelector('[data-answer-question-id="q6"] .mark-question-button')?.classList.contains('active') === true,
                  highlightRestored: document.querySelector('#left .hl')?.textContent?.trim() || '',
                  llmText: document.querySelector('[data-reading-llm-review-panel]')?.textContent || '',
                  coachText: document.querySelector('[data-reading-coach-answer]')?.textContent || '',
                  importPosts: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/history/archive/reading' && item.method === 'POST').length,
                  historyGets: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/history' && item.method === 'GET').length,
                  submitPosts: window.__practiceReadingRequests.filter((item) => item.pathname === '/api/practice/sessions' && item.method === 'POST').length
                })"""
            )
            if imported_replay_state.get("q12") != "C" or not imported_replay_state.get("markedRestored") or imported_replay_state.get("highlightRestored") != "Art changes":
                raise AssertionError(f"archive_import_replay_not_restored:{imported_replay_state}")
            if "CANONICAL_PATCH_ONLY: 后端已归一化的错因" not in imported_replay_state.get("llmText", ""):
                raise AssertionError(f"archive_import_llm_not_restored:{imported_replay_state}")
            if "Review question 14 evidence first." not in imported_replay_state.get("coachText", ""):
                raise AssertionError(f"archive_import_coach_not_restored:{imported_replay_state}")
            if imported_replay_state.get("importPosts") != 1 or imported_replay_state.get("submitPosts") != baseline_submit_posts or imported_replay_state.get("historyGets", 0) < 1:
                raise AssertionError(f"archive_import_used_wrong_api:{imported_replay_state}")
        finally:
            Path(archive_path).unlink(missing_ok=True)

        await browser.close()

    return {
        "status": "pass",
        "detail": "Vue 阅读页通过阅读总览进入、作答同步、提交评分复盘、AI 自动复盘、只读回放、archive 导入导出与 AI coach session 上下文回归",
        "evidence": {
            "assetId": ASSET_ID,
            "entry": str(DIST_ENTRY),
            "answered": expected,
            "screenshots": screenshots,
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
