#!/usr/bin/env python3
"""Screenshot the Notebook (/notebook) and Learner model (/reading/learner) pages.

    python developer/tests/e2e/notebook_preview.py

Starts the Vite dev server on port 4186 with the learner-model feature flag
set in the dev-server environment (test side only; production builds keep the
flag false). The Tauri commands are mocked in the page with an init script:
four weeks of finished journal days, weekly digests, a study plan, a memory
catalog and a learner review queue of twelve items.

    reports/notebook-dev.png          notebook, 1440x900, full page
    reports/notebook-dev-1024.png     notebook, 1024x768, full page
    reports/notebook-empty-dev.png    notebook with no journal days, 1440x900
    reports/learner-dev.png           learner model, 1440x900, full page

Prints the computed heights of the notebook index rows so the sticky rail
shows up as numbers, not guesses.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright

from design_system_preview import APP, REPORTS, VITE_BIN, stop_process, wait_for_server

PORT = 4186
BASE_URL = f"http://127.0.0.1:{PORT}"

MOCK = r"""
(() => {
  const scenario = window.__notebookScenario || 'full';
  const ZERO = { newCandidates: 0, promoted: 0, reinforced: 0, refined: 0, improved: 0,
                 regressed: 0, contradicted: 0, superseded: 0 };
  const dayList = [];
  const start = Date.UTC(2026, 8, 14);
  for (let i = 0; i < 28; i += 1) {
    const d = new Date(start + i * 86400000);
    dayList.push(d.toISOString().slice(0, 10));
  }
  const PRACTICE_DAYS = dayList.filter((_, i) => i % 4 !== 3);
  const TOPICS = [
    ['reading.tfng', 'writing.taskResponse', 'reading.matching_headings'],
    ['reading.short_answer', 'reading.yng', 'writing.coherence'],
    ['reading.summary_completion', 'writing.lexical', 'reading.tfng'],
    ['reading.matching_headings', 'writing.grammar', 'reading.multi_choice'],
  ];
  const journalShell = (journalDate, facts) => ({
    id: 'journal-' + journalDate, userId: 'local', journalDate, version: 1, status: 'published',
    facts: { journalDate, timeSpentMs: 0, writingEvalSummary: { completed: 0, degraded: 0, averageBand: null },
             skillDeltas: [], memoryChanges: ZERO, coachFeedbackCount: 0, coachReaskCount: 0,
             sourceHash: 'hash-' + journalDate, todayObservationIds: [], memoryEvents: [], ...facts },
    sourceHash: 'hash-' + journalDate, renderedMarkdown: null, supersededBy: null,
    createdAt: journalDate + 'T23:00:00Z', updatedAt: journalDate + 'T23:00:00Z' });

  const journals = {};
  if (scenario !== 'empty') {
    PRACTICE_DAYS.forEach((date, n) => {
      const topics = TOPICS[n % TOPICS.length];
      const writing = n % 3 === 0;
      const deltas = topics.map((key, k) => ({ skillKey: key, delta: ((n + k) % 3 === 0 ? -0.3 : 0.3), evidenceCount: 2 }));
      const events = (n % 2 === 0) ? [{ memoryId: 'mem-tfng', namespace: 'skill', canonicalKey: 'reading.tfng',
        changeKind: n > 14 ? 'improved' : 'reinforced', evidenceObservationIds: ['obs-tfng-' + (n % 3)] }] : [];
      journals[date] = journalShell(date, {
        attemptsCount: 1 + (n % 4), timeSpentMs: (20 + (n * 7) % 50) * 60000,
        writingEvalSummary: { completed: writing ? 1 : 0, degraded: 0, averageBand: writing ? 6.5 : null },
        skillDeltas: deltas, coachFeedbackCount: n % 3, coachReaskCount: n % 5 === 0 ? 1 : 0,
        memoryEvents: events });
    });
  }

  const WEEKS = [
    { window: '2026-W38', windowStart: '2026-09-14', windowEnd: '2026-09-20',
      observations: ['判断题里，未提及与错误仍然混在一起', '段落大意配对的干扰项命中率在下降', '写作的衔接词开始有意识地使用'],
      changes: ['判断题的正确率从四成回升到六成', '词汇资源的分数稳定在六分上下'],
      nextPractice: ['针对判断题做两组对照练习', '每周一篇小作文，重点看段落衔接'] },
    { window: '2026-W39', windowStart: '2026-09-21', windowEnd: '2026-09-27',
      observations: ['段落大意题的错误集中在细节型干扰项', '简答题开始能把原文的同义替换找出来'],
      changes: ['简答题的定位速度明显变快', '是非题仍然把作者观点当成事实'],
      nextPractice: ['练习是非题与判断题的边界', '做一套限时简答题'] },
    { window: '2026-W40', windowStart: '2026-09-28', windowEnd: '2026-10-04',
      observations: ['摘要填空的语法形式判断更稳定', '写作语法的错误集中在从句与时态'],
      changes: ['摘要填空的得分从五分提到六分半'],
      nextPractice: ['针对从句结构做一组语法修正', '摘要填空做两篇计时练习'] },
    { window: '2026-W41', windowStart: '2026-10-05', windowEnd: '2026-10-11',
      observations: ['判断题的证据定位已经能给出原文句子', '阅读整体节奏偏慢，后半部分容易赶时间'],
      changes: ['判断题的错误与未提及开始分开判断', '写作任务回应的分数持续上升'],
      nextPractice: ['阅读计时：每篇控制在二十分钟内', '继续练习段落大意配对'] },
  ];

  const job = (id, jobKind, status, dedupeKey) => ({ id, jobKind, userId: 'local', status, priority: 0,
    scheduledAt: '2026-10-03T00:00:00Z', lockedAt: null, heartbeatAt: null, attempts: 1, maxAttempts: 3,
    dedupeKey, lastError: null, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' });

  const catalog = scenario === 'empty' ? [] : [
    { id: 'mem-tfng', canonicalKey: 'reading.tfng', statement: '判断题中，你常把“未提及”误判为“错误”。',
      sourceClass: 'observed', namespace: 'skill', status: 'active', version: 2, scope: 'activity:reading',
      confidenceBand: 'medium', supportCount: 4, contradictionCount: 0, firstSeen: '2026-09-14T09:00:00Z',
      pendingVerification: false, evidenceObservationIds: ['obs-tfng-0'], lastSeen: '2026-10-02T09:00:00Z' },
    { id: 'mem-pref', canonicalKey: 'pref.examples', statement: '你更喜欢先看例句，再看规则讲解。',
      sourceClass: 'user_explicit', namespace: 'preference', status: 'active', version: 1, scope: 'activity:reading',
      confidenceBand: 'high', supportCount: 3, contradictionCount: 0, firstSeen: '2026-09-14T09:00:00Z',
      pendingVerification: false, evidenceObservationIds: [], lastSeen: '2026-09-28T09:00:00Z' },
    { id: 'mem-time', canonicalKey: 'pace.reading', statement: '阅读时，后半部分的节奏往往比前半部分慢一半。',
      sourceClass: 'observed', namespace: 'skill', status: 'active', version: 1, scope: 'activity:reading',
      confidenceBand: 'medium', supportCount: 2, contradictionCount: 0, firstSeen: '2026-10-01T09:00:00Z',
      pendingVerification: false, evidenceObservationIds: [], lastSeen: '2026-10-05T09:00:00Z' },
  ];

  const SKILLS = [
    ['reading.tfng', 'high', 'declining', 1, 2], ['reading.matching_headings', 'high', 'stable', 2, 2],
    ['reading.yng', 'medium', 'improving', 4, 3], ['reading.short_answer', 'medium', 'improving', 5, 4],
    ['reading.summary_completion', 'medium', 'stable', 3, 2], ['writing.taskResponse', 'low', 'improving', 6, 4],
    ['writing.coherence', 'high', 'insufficient_evidence', 1, 1], ['writing.lexical', 'low', 'stable', 7, 5],
  ];
  const PRIORITY = ['urgent', 'high', 'high', 'moderate', 'moderate', 'moderate', 'watch', 'watch', 'urgent', 'high', 'moderate', 'watch'];
  const REASONS = [['low_mastery_estimate', 'recent_errors'], ['high_uncertainty'], ['review_due'], ['needs_new_asset_transfer', 'recent_errors'],
    ['stability_check'], ['review_due', 'low_mastery_estimate'], ['high_uncertainty'], ['stability_check'], ['recent_errors'],
    ['needs_new_asset_transfer'], ['review_due'], ['stability_check']];
  const PROBES = ['novel_item', 'same_item_retention', 'contrastive_pair', 'coach_micro_drill', 'writing_rewrite'];
  const SKILL_KEYS = ['reading.tfng', 'reading.matching_headings', 'reading.yng', 'reading.short_answer', 'reading.summary_completion',
    'writing.taskResponse', 'writing.coherence', 'writing.lexical', 'reading.multi_choice', 'reading.sentence_completion',
    'writing.grammar', 'reading.flow_chart_completion'];
  const learnerStates = scenario === 'empty' ? [] : SKILLS.map(([skillKey, uncertaintyBand, trend, evidenceCount, distinctAssetCount], i) => ({
    skillKey, uncertaintyBand, trend, evidenceCount: evidenceCount * 3 + i, distinctAssetCount,
    nextReviewAt: new Date(Date.UTC(2026, 9, 12 + i, 9)).toISOString() }));
  const learnerNeeds = scenario === 'empty' ? [] : SKILL_KEYS.map((skillKey, i) => ({
    skillKey, priorityBand: PRIORITY[i], reasonCodes: REASONS[i], preferredProbe: PROBES[i % PROBES.length],
    evidenceCount: 2 + (i % 5), distinctAssetCount: 1 + (i % 3), avoidAssetIds: i % 2 ? ['p1-high-01'] : [],
    dueAt: new Date(Date.UTC(2026, 9, 11 + (i % 6), 8)).toISOString() }));

  const observations = (ids) => ids.map((id) => ({
    id, userId: 'local', observationType: 'question_outcome', namespace: 'reading', scopeKind: 'skill',
    scopeKey: 'reading.tfng', polarity: null, valueNum: null,
    valueText: '第 9 题改答后仍错误：原文没有提到价格变化。', payload: {}, confidence: 0.8, evidenceStrength: 0.7,
    observedAt: '2026-10-02', projectorKey: 'learning_observations', projectorVersion: 1, sourceFingerprint: 'fp-' + id,
    sensitivity: 'normal', trust: 'deterministic_projection', evidence: [{ eventId: 'ev-' + id, evidenceRole: 'support', ordinal: 0 }] }));
  const events = (ids) => ids.map((id) => ({
    id: 'ev-' + id, userId: 'local', activity: 'reading', assetId: 'p1-high-01', attemptId: 'attempt-9', questionId: 'q9',
    skillKey: 'reading.tfng', eventType: 'reading_question_outcome', sourceKind: 'attempt', sourceId: 'attempt-9',
    occurredAt: '2026-10-02', payload: {}, contentHash: 'hash-' + id, schemaVersion: 1, sensitivity: 'normal',
    trust: 'canonical_learning_truth' }));

  const invoke = async (command, args = {}) => {
    switch (command) {
      case 'background_job_status': return { ok: true, data: scenario === 'empty' ? [] :
        dayList.map((d) => job('job-' + d, 'daily_journal', 'completed', 'daily_journal:local:' + d)) };
      case 'journal_get_daily': return { ok: true, data: journals[args.query.journalDate] || journalShell(args.query.journalDate, {}) };
      case 'memory_catalog_list': return { ok: true, data: { userId: 'local', entries: catalog, truncated: false } };
      case 'weekly_digest_list': return { ok: true, data: scenario === 'empty' ? [] : WEEKS };
      case 'study_plan_get_latest': return { ok: true, data: { plan: { id: 'plan-1', userId: 'local', goal: '复习判断题边界', availableMinutes: 45,
        targetDate: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }, items: [
        { id: 'spi-1', planId: 'plan-1', skillProbe: { skillKey: 'reading.tfng', probeKind: 'contrastive_pair' },
          whyText: '用两组“错误 / 未提及”对照题，练习定位原文证据。', estimatedMinutes: 15, done: false, createdAt: '2026-10-01T00:00:00Z' },
        { id: 'spi-2', planId: 'plan-1', skillProbe: 'reading.matching_headings',
          whyText: '段落大意的干扰项要逐段排除。', estimatedMinutes: 10, done: false, createdAt: '2026-10-01T00:00:00Z' }
      ] } };
      case 'learning_observations_get_by_ids': return { ok: true, data: { schemaVersion: 1, projectorKey: 'learning_observations',
        projectorVersion: 1, ledgerInputHash: 'ledger', observationOutputHash: 'obs', generatedAt: '2026-10-02T23:00:00Z',
        freshness: 'fresh', observations: observations(args.ids || []), missingIds: [] } };
      case 'learning_events_get_evidence_by_ids': return { ok: true, data: { schemaVersion: 1,
        events: events(args.ids || []), missingIds: [] } };
      case 'learner_model_get_state': return { ok: true, data: { states: learnerStates } };
      case 'learner_model_get_review_needs': return { ok: true, data: { needs: learnerNeeds } };
      default: return { ok: true, data: null };
    }
  };
  window.__TAURI__ = { core: { invoke } };
  window.__TAURI_INTERNALS__ = { invoke };
})();
"""


def start_dev_server() -> subprocess.Popen:
    node = shutil.which("node")
    if node is None or not VITE_BIN.is_file():
        raise RuntimeError("node or apps/writing-vue/node_modules/vite is missing; run npm install first")
    REPORTS.mkdir(parents=True, exist_ok=True)
    log = (REPORTS / "notebook-vite.log").open("wb")
    env = {**os.environ, "VITE_FEATURE_LEARNER_MODEL_V1": "true"}
    return subprocess.Popen(
        [node, str(VITE_BIN), "--host", "127.0.0.1", "--port", str(PORT), "--strictPort"],
        cwd=APP,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )


def settle(page, selector: str) -> None:
    page.wait_for_selector(selector, timeout=60_000)
    page.evaluate("document.fonts.ready.then(() => true)")
    page.wait_for_timeout(400)


def capture(browser, scenario: str, filename: str, width: int, height: int, route: str, ready: str,
            metrics: dict, errors: list[str]) -> None:
    page = browser.new_page(viewport={"width": width, "height": height}, reduced_motion="reduce")
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.add_init_script(f"window.__notebookScenario = {json.dumps(scenario)};\n{MOCK}")
    page.goto(f"{BASE_URL}/#{route}", wait_until="domcontentloaded", timeout=60_000)
    settle(page, ready)
    if route == "/notebook" and scenario == "full":
        metrics[filename] = page.evaluate(
            """() => [...document.querySelectorAll('[data-notebook-index] .notebook-index__row')].map((node) => ({
              label: node.querySelector('.list-row-title')?.textContent.trim(),
              selected: node.classList.contains('is-selected'),
              height: Math.round(node.getBoundingClientRect().height),
            }))"""
        )
    page.screenshot(path=str(REPORTS / filename), full_page=True)
    page.close()


def main() -> int:
    errors: list[str] = []
    metrics: dict = {}
    process = None
    try:
        process = start_dev_server()
        wait_for_server(process, BASE_URL)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                capture(browser, "full", "notebook-dev.png", 1440, 900, "/notebook",
                        "[data-notebook][data-notebook-index], [data-notebook] .notebook-entry", metrics, errors)
                capture(browser, "full", "notebook-dev-1024.png", 1024, 768, "/notebook",
                        "[data-notebook] .notebook-entry", metrics, errors)
                capture(browser, "empty", "notebook-empty-dev.png", 1440, 900, "/notebook",
                        "[data-notebook] .notebook-empty", metrics, errors)
                capture(browser, "full", "learner-dev.png", 1440, 900, "/reading/learner",
                        ".learner-model-page .list-row", metrics, errors)
            finally:
                browser.close()
    except (RuntimeError, OSError) as error:
        print(f"notebook preview failed: {error}", file=sys.stderr)
        return 1
    finally:
        stop_process(process)
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    for line in errors:
        print(line, file=sys.stderr)
    for name in ("notebook-dev.png", "notebook-dev-1024.png", "notebook-empty-dev.png", "learner-dev.png"):
        print(f"wrote {REPORTS / name}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
