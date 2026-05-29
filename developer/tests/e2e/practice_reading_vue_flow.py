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


async def install_api_stub(page) -> None:
    await page.add_init_script(
        f"""
        (() => {{
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
                  bodyHtml: '<div class="group"><h4>Questions 14</h4><label><input type="radio" name="q1" value="A"> A paragraph A</label><label><input type="radio" name="q1" value="B"> B paragraph B</label></div>'
                }},
                {{
                  groupId: 'group-text',
                  kind: 'summary_completion',
                  questionIds: ['q6'],
                  bodyHtml: '<div class="group"><h4>Question 19</h4><p>The arts and <input type="text" name="q6"> can work together.</p></div>'
                }},
                {{
                  groupId: 'group-checkbox',
                  kind: 'multi_choice',
                  questionIds: ['q10', 'q11'],
                  bodyHtml: '<div class="group"><h4>Questions 23 and 24</h4><label><input type="checkbox" name="q10_11" value="B"> B fresh perspective</label><label><input type="checkbox" name="q10_11" value="D"> D reactions to things</label><label><input type="checkbox" name="q10_11" value="E"> E global issues</label></div>'
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
            const analysisArtifacts = {{
              highlights,
              markedQuestions,
              analysisSignals,
              questionTimelineLite,
              singleAttemptAnalysisInput,
              singleAttemptAnalysis,
              singleAttemptAnalysisLlm: null
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
                source: 'practice_reading_session',
                details: comparison
              }},
              questionTypePerformance,
              highlights,
              markedQuestions,
              analysisSignals,
              questionTimelineLite,
              singleAttemptAnalysisInput,
              singleAttemptAnalysis,
              singleAttemptAnalysisLlm: null,
              analysisArtifacts,
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
                  singleAttemptAnalysisLlm: llmPatch,
                  analysisArtifacts: {{
                    ...lastSubmission.analysisArtifacts,
                    singleAttemptAnalysisLlm: llmPatch
                  }}
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
                return createSseResponse([
                  {{ event: 'start', data: {{ success: true, sessionId: body?.sessionId || '' }} }},
                  {{ event: 'error', data: {{ success: false, error: {{ code: 'network_error', message: 'simulated automatic review failure' }} }} }}
                ]);
              }}
              const response = buildCoachResponse(body);
              return createSseResponse([
                {{ event: 'start', data: {{ success: true, sessionId: body?.sessionId || '' }} }},
                {{ event: 'retrieval', data: {{ type: 'retrieval', data: {{ focusQuestionNumbers: body?.payload?.focusQuestionNumbers || [] }} }} }},
                {{ event: 'complete', data: {{ success: true, data: response }} }}
              ]);
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


async def run_flow() -> dict:
    ensure_bundle()
    entry_url = f"{DIST_ENTRY.as_uri()}#/"

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
        await page.locator('button[data-action="browse-category"][data-category="P2"]').click()
        await page.wait_for_selector('[data-reading-browse]', timeout=10000)
        await page.wait_for_selector(f'.exam-item[data-reading-asset-id="{ASSET_ID}"]', timeout=20000)
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
        await page.click('[data-view="browse"]')
        await page.wait_for_selector(f'.exam-item[data-reading-asset-id="{ASSET_ID}"]', timeout=20000)
        await page.locator(f'.exam-item[data-reading-asset-id="{ASSET_ID}"] button:has-text("开始练习")').click()

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

        legacy_shell_state = await page.evaluate(
            """() => ({
              dividerRole: document.getElementById('divider')?.getAttribute('role') || '',
              dividerValue: Number(document.getElementById('divider')?.getAttribute('aria-valuenow') || 0),
              hasAnswerControlsInBottomNav: Boolean(document.querySelector('#question-nav select, #question-nav input[type="text"], #question-nav input[type="checkbox"]')),
              submitCopy: document.getElementById('submit-btn')?.textContent?.trim() || ''
            })"""
        )
        if legacy_shell_state.get("dividerRole") != "separator" or not 0 <= legacy_shell_state.get("dividerValue", -1) <= 100:
            raise AssertionError(f"legacy_divider_contract_missing:{legacy_shell_state}")
        if legacy_shell_state.get("hasAnswerControlsInBottomNav") or legacy_shell_state.get("submitCopy") != "Submit":
            raise AssertionError(f"legacy_bottom_nav_contract_regressed:{legacy_shell_state}")
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

        await page.click('#settings-btn')
        await page.wait_for_selector('#settings-panel:visible', timeout=10000)
        await page.click('#settings-panel [data-size="large"]')
        await page.click('#settings-panel [data-mode="dark"]')
        settings_state = await page.evaluate(
            """() => ({
              large: document.querySelector('.reading-page')?.classList.contains('font-large') === true,
              dark: document.querySelector('.reading-page')?.classList.contains('dark-mode') === true
            })"""
        )
        if not settings_state.get("large") or not settings_state.get("dark"):
            raise AssertionError(f"settings_panel_not_applied:{settings_state}")
        await page.click('.overlay')
        await page.wait_for_selector('#settings-panel', state="hidden", timeout=10000)

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
        await page.click('#btnHL')
        await page.wait_for_selector('#left .hl:has-text("Art changes")', timeout=10000)
        await page.evaluate("() => window.scrollTo(0, 180)")
        await page.click('#left .hl')
        await page.wait_for_selector('#review-highlight-dictionary-bubble:visible', timeout=10000)
        await page.click('#review-highlight-dictionary-bubble .vocab-add')
        await page.wait_for_selector('#review-highlight-dictionary-bubble .vocab-add:has-text("已加入")', timeout=10000)
        await page.click('#note-btn')
        await page.wait_for_selector('#notes-panel:visible', timeout=10000)
        await page.fill('#notes-panel textarea', 'manual reading note')
        await page.click('.overlay')
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
        await page.click('[data-reading-llm-review-retry]')
        await page.wait_for_selector('[data-reading-llm-review-status="success"]', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-review-panel]', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-diagnosis="coach_review_primary_weakness"]', timeout=10000)
        await page.wait_for_selector('[data-reading-llm-action="coach_review_next_rule"]', timeout=10000)

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
        await page.click('button:has-text("询问教练")')
        await page.wait_for_selector('[data-reading-coach-answer]:has-text("Review question 14 evidence first.")', timeout=10000)
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

        await page.click('a:has-text("返回练习库")')
        await page.wait_for_url("**#/", timeout=10000)
        await page.click('[data-view="practice"]')
        await page.wait_for_selector('#history-list .history-item[data-record-id="reading-reading-session-e2e-1"]', timeout=10000)
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

        await page.click('a:has-text("返回练习库")')
        await page.wait_for_url("**#/", timeout=10000)
        await page.click('[data-view="settings"]')
        await page.wait_for_selector('#export-data-btn', timeout=10000)
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
            await page.click('[data-view="settings"]')
            await page.wait_for_selector('[data-reading-archive-import-input]', timeout=10000)
            await page.set_input_files('[data-reading-archive-import-input]', archive_path)
            await page.wait_for_selector('text=阅读记录导入完成：1 条，跳过 0 条', timeout=10000)
            await page.click('[data-view="practice"]')
            await page.wait_for_selector('#history-list .history-item[data-record-id="reading-reading-session-e2e-1"]', timeout=10000)
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
