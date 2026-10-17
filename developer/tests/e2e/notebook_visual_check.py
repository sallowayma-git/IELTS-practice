"""札记 (Notebook) route: daily prose entries and the v2 weekly reports.

Checks the learner-facing contract: dated entries read in reverse order,
only finished journal days are read (never today's open day), evidence opens
inline as footnotes, memories expose exactly 不准确 / 忘记, and none of the
retired workbench machinery (prompt box, run buttons) leaks in. Weekly
reports (notebook_weekly_mock.py): the live week first, then finished weeks;
each state says what it is; blocks render with accessible charts and links.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright
from notebook_weekly_mock import WEEKLY_MOCK
from visual_test_support import capture_state, wait_for_route_layout


BASE_URL = os.environ.get("NOTEBOOK_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (("desktop", 1440, 900), ("tablet", 768, 1024), ("mobile", 390, 844), ("small", 360, 640))

MOCK = r"""
(() => {
  // Real DailyJournal / JournalFacts envelope (crates/ielts-domain/src/journal.rs).
  const ZERO_CHANGES = { newCandidates: 0, promoted: 0, reinforced: 0, refined: 0, improved: 0, regressed: 0, contradicted: 0, superseded: 0 };
  const journalShell = (journalDate, facts) => ({
    id: 'journal-' + journalDate, userId: 'local', journalDate, version: 1, status: 'published',
    facts: { journalDate, timeSpentMs: 0, writingEvalSummary: { completed: 0, degraded: 0, averageBand: null },
             skillDeltas: [], memoryChanges: ZERO_CHANGES, coachFeedbackCount: 0, coachReaskCount: 0,
             sourceHash: 'source-hash-' + journalDate, todayObservationIds: [], memoryEvents: [], ...facts },
    sourceHash: 'source-hash-' + journalDate, renderedMarkdown: null, supersededBy: null,
    createdAt: journalDate + 'T23:00:00Z', updatedAt: journalDate + 'T23:00:00Z' });
  const withCatalogDefaults = (rows) => rows.map(row => ({ scope: 'activity:reading', confidenceBand: 'medium',
    supportCount: 1, contradictionCount: 0, firstSeen: row.lastSeen, pendingVerification: false, ...row }));
  const job = (id, jobKind, status, dedupeKey) => ({ id, jobKind, userId: 'local', status, priority: 0,
    scheduledAt: '2026-10-03T00:00:00Z', lockedAt: null, heartbeatAt: null, attempts: 1, maxAttempts: 3,
    dedupeKey, lastError: null, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' });
  const journals = {
    '2026-10-02': journalShell('2026-10-02', {
      attemptsCount: 3, timeSpentMs: 3120000,
      writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.5 },
      skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, evidenceCount: 3, trend: 'improving' },
                    { skillKey: 'reading.matching_headings', delta: -0.3, evidenceCount: 2, trend: 'recurring' }],
      coachFeedbackCount: 2,
      memoryEvents: [{ memoryId: 'mem-tfng', namespace: 'skill', canonicalKey: 'reading.tfng',
                       changeKind: 'reinforced', evidenceObservationIds: ['obs-tfng'] }] }),
    '2026-09-30': journalShell('2026-09-30', {
      attemptsCount: 1, timeSpentMs: 1260000,
      writingEvalSummary: { completed: 0, degraded: 0, averageBand: null }, skillDeltas: [] }),
  };
  // Week scenario: a fortnight-old first page, a long gap, then six practice days
  // (one of them quiet) so consecutive entries can be read side by side.
  if (window.__notebookWeek) {
    const day = (date, attempts, minutes, written, band, degraded, deltas, coach, reask, events = []) => {
      journals[date] = journalShell(date, {
        attemptsCount: attempts, timeSpentMs: minutes * 60000,
        writingEvalSummary: { completed: written, degraded, averageBand: band },
        skillDeltas: deltas.map(([skillKey, delta]) => ({ skillKey, delta, evidenceCount: 2,
                                                          trend: delta > 0 ? 'improving' : delta < 0 ? 'recurring' : 'steady' })),
        coachFeedbackCount: coach, coachReaskCount: reask, memoryEvents: events });
    };
    const tfng = (changeKind) => [{ memoryId: 'mem-tfng', namespace: 'skill', canonicalKey: 'reading.tfng',
                                     changeKind, evidenceObservationIds: ['obs-tfng'] }];
    Object.keys(journals).forEach(key => delete journals[key]);
    day('2026-09-20', 2, 41, 0, null, 0, [['reading.tfng', 0.3], ['reading.matching_headings', -0.2]], 1, 0);
    day('2026-09-28', 1, 18, 0, null, 0, [], 0, 0);
    day('2026-09-29', 0, 0, 1, 6, 0, [['writing.taskResponse', -0.2]], 0, 0);
    day('2026-09-30', 3, 52, 1, 6.5, 0, [['reading.tfng', 0.4], ['reading.matching_headings', -0.3]], 2, 1, tfng('improved'));
    day('2026-10-01', 2, 35, 0, null, 0, [['reading.short_answer', 0.5]], 0, 0);
    day('2026-10-02', 4, 71, 2, 6.5, 1, [['reading.tfng', 0.2], ['reading.yng', -0.4]], 3, 0, tfng('reinforced'));
    day('2026-10-03', 0, 0, 0, null, 0, [], 0, 0);
    day('2026-10-04', 1, 25, 0, null, 0, [['reading.matching_headings', 0.4]], 0, 2);
  }
  window.__notebookCalls = [];
  window.__catalog = withCatalogDefaults([
    { id: 'mem-tfng', canonicalKey: 'reading.tfng', statement: '判断题中，你常把“未提及”误判为“错误”。',
      sourceClass: 'observed', namespace: 'skill', status: 'active', version: 2,
      evidenceObservationIds: ['obs-tfng'], lastSeen: '2026-10-02T09:00:00Z' },
    { id: 'mem-pace', canonicalKey: 'pace.reading', statement: '阅读时，后半部分的节奏往往比前半部分慢。',
      sourceClass: 'observed', namespace: 'skill', status: 'active', version: 1,
      evidenceObservationIds: [], lastSeen: '2026-09-28T09:00:00Z' }
  ]);
  // The learner's own words: explicit preferences, never catalog memories.
  window.__preferences = [{ userId: 'local', preferenceKey: 'user_note.0a1b2c3d4e5f6071', scope: 'global',
    value: '先给我看例句，再讲规则', status: 'active', source: 'user', updatedAt: '2026-09-28T09:00:00Z' }];
  const invoke = async (command, args = {}) => {
    window.__notebookCalls.push({ command, args });
    if (window.__notebookEmpty && command !== 'memory_catalog_list') {
      if (command === 'background_job_status') return { ok: true, data: [] };
      if (command === 'journal_get_daily') return { ok: true, data: journalShell(args.query.journalDate, {}) };
      return { ok: true, data: null };
    }
    switch (command) {
      case 'background_job_status': if (window.__notebookWeek) return { ok: true, data: Object.keys(journals).map(date =>
        job('job-' + date, 'daily_journal', 'completed', 'daily_journal:local:' + date)) };
        return { ok: true, data: [
        job('j1', 'daily_journal', 'completed', 'daily_journal:local:2026-09-30'),
        job('j2', 'daily_dream', 'completed', 'daily_dream:local:2026-10-02'),
        job('j3', 'daily_journal', 'running', 'daily_journal:local:2026-10-03')
      ] };
      case 'journal_get_daily': return { ok: true, data: journals[args.query.journalDate] || journalShell(args.query.journalDate, {}) };
      case 'memory_catalog_list': return { ok: true, data: { userId: 'local',
        entries: window.__notebookEmpty ? [] : window.__catalog.filter(row => row.status === 'active'), truncated: false } };
      case 'weekly_report_current': return { ok: true, data: window.__weeklyReports(window.__weeklyScenario || 'live_final').current };
      case 'weekly_report_list': return { ok: true, data: window.__weeklyReports(window.__weeklyScenario || 'live_final').list };
      case 'learning_observations_get_by_ids': return { ok: true, data: { schemaVersion: 1, projectorKey: 'learning_observations',
        projectorVersion: 1, ledgerInputHash: 'ledger-hash-notebook', observationOutputHash: 'observation-hash-notebook',
        generatedAt: '2026-10-02T23:00:00Z', freshness: 'fresh', observations: [{
        id: 'obs-tfng', userId: 'local', observationType: 'question_outcome', namespace: 'reading', scopeKind: 'skill',
        scopeKey: 'reading.tfng', polarity: null, valueNum: null, valueText: '第 9 题改答后仍错误：原文没有提到价格变化。',
        payload: {}, confidence: 0.8, evidenceStrength: 0.7, observedAt: '2026-10-02',
        projectorKey: 'learning_observations', projectorVersion: 1, sourceFingerprint: 'fp-obs-tfng',
        sensitivity: 'normal', trust: 'deterministic_projection',
        evidence: [{ eventId: 'ev-tfng', evidenceRole: 'support', ordinal: 0 }] }], missingIds: [] } };
      case 'learning_events_get_evidence_by_ids': return { ok: true, data: { schemaVersion: 1, events: [{
        id: 'ev-tfng', userId: 'local', activity: 'reading', assetId: 'p1-high-01', attemptId: 'attempt-9',
        questionId: 'q9', skillKey: 'reading.tfng', eventType: 'reading_question_outcome', sourceKind: 'attempt', sourceId: 'attempt-9',
        occurredAt: '2026-10-02', payload: {}, contentHash: 'content-hash-ev-tfng', schemaVersion: 1,
        sensitivity: 'normal', trust: 'canonical_learning_truth' }], missingIds: [] } };
      case 'memory_record_feedback': return { ok: true, data: { id: 'feedback-notebook', memoryId: args.memoryId,
        feedbackKind: args.feedbackKind, userId: 'local', payload: {}, createdAt: '2026-10-02T23:00:00Z' } };
      case 'memory_list_explicit_preferences': return { ok: true, data: window.__notebookEmpty ? [] : window.__preferences };
      case 'memory_put_explicit_preference': {
        const { preferenceKey, scope = 'global', value } = args.input;
        if (/ignore previous instructions/i.test(value)) return { ok: false, error: { code: 'memory.preference_rejected',
          message: '这句话里有不能交给教练的内容（像指令、密钥或健康、性格类判断），不能保存为偏好。请换一种说法。', retryable: false } };
        const row = { userId: 'local', preferenceKey, scope, value: value.trim(), status: 'active', source: 'user', updatedAt: '2026-10-03T00:00:00Z' };
        const index = window.__preferences.findIndex(item => item.preferenceKey === preferenceKey);
        if (index >= 0) window.__preferences[index] = row; else window.__preferences.push(row);
        return { ok: true, data: row };
      }
      case 'memory_delete_explicit_preference': {
        const before = window.__preferences.length;
        window.__preferences = window.__preferences.filter(item => item.preferenceKey !== args.input.preferenceKey);
        return { ok: true, data: window.__preferences.length < before };
      }
      case 'memory_forget': {
        const row = window.__catalog.find(item => item.id === args.input.memoryId);
        if (!row || row.version !== args.input.expectedVersion) throw new Error('stale memory');
        row.status = 'deleted';
        return { ok: true, data: null };
      }
      default: return { ok: true, data: null };
    }
  };
  window.__TAURI__ = { core: { invoke } };
  window.__TAURI_INTERNALS__ = { invoke };
})();
"""


def read_page(page):
    return page.evaluate(
        """() => {
          const root = document.querySelector('[data-notebook]');
          return {
            viewport: innerWidth,
            scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            entries: [...root.querySelectorAll('[data-notebook-entry]')].map(node => node.dataset.notebookEntry),
            sections: [...root.querySelectorAll('.notebook-entry h3')].map(node => node.textContent.trim()),
            text: root.innerText,
            dailyText: [...root.querySelectorAll('[data-notebook-entry]')].map(node => node.innerText).join('\\n'),
            weeks: [...root.querySelectorAll('[data-notebook-week]')].map(node => node.dataset.notebookWeek),
            memories: [...root.querySelectorAll('[data-memory-id]')].map(node => ({
              id: node.dataset.memoryId,
              actions: [...node.querySelectorAll('button')].map(button => button.textContent.trim())
            })),
            machinery: root.querySelectorAll('textarea, .agent-heartbeat-card, .agent-run-button, [data-agent-console]').length,
            navActive: document.querySelector('.nav-item[aria-current=page]')?.textContent.trim(),
            journalDays: window.__notebookCalls.filter(call => call.command === 'journal_get_daily')
              .map(call => call.args.query.journalDate).sort()
          };
        }"""
    )


def assert_contract(name, data):
    if data["scrollWidth"] > data["viewport"] + 1:
        raise AssertionError(f"{name}: notebook overflows horizontally")
    if data["navActive"] != "札记":
        raise AssertionError(f"{name}: 札记 is not the active nav entry: {data['navActive']}")
    if data["entries"] != ["2026-10-02", "2026-09-30"]:
        raise AssertionError(f"{name}: entries are not reverse-chronological: {data['entries']}")
    if data["journalDays"] != ["2026-09-30", "2026-10-02"]:
        raise AssertionError(f"{name}: notebook read journals for unfinished days: {data['journalDays']}")
    for section in ("§观察", "§变化", "§下一步练习"):
        if section not in data["sections"]:
            raise AssertionError(f"{name}: missing section {section}: {data['sections']}")
    if "%" in data["dailyText"]:
        raise AssertionError(f"{name}: daily entries show fake precision")
    if data["weeks"] != ["2026-W42", "2026-W41", "2026-W40"]:
        raise AssertionError(f"{name}: weekly reports are not live-first, newest-first: {data['weeks']}")
    if data["machinery"]:
        raise AssertionError(f"{name}: workbench machinery leaked into the notebook")
    if [memory["actions"] for memory in data["memories"]] != [["不准确", "忘记"], ["不准确", "忘记"]]:
        raise AssertionError(f"{name}: memories must offer exactly 不准确/忘记: {data['memories']}")


def exercise_actions(page, name):
    page.locator(".notebook-ref").first.click()
    page.get_by_text("第 9 题改答后仍错误", exact=False).wait_for()
    link = page.locator(".notebook-footnote a")
    if "p1-high-01" not in (link.get_attribute("href") or ""):
        raise AssertionError(f"{name}: footnote lost its link to the practice")
    page.locator('[data-memory-id="mem-pace"] button', has_text="不准确").click()
    page.wait_for_function("() => window.__notebookCalls.some(call => call.command === 'memory_record_feedback')")
    page.locator('[data-memory-id="mem-tfng"] button', has_text="忘记").click()  # dialog dismissed by default
    if page.evaluate("() => window.__notebookCalls.some(call => call.command === 'memory_forget')"):
        raise AssertionError(f"{name}: cancelled forget issued IPC")
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator('[data-memory-id="mem-tfng"] button', has_text="忘记").click()
    page.wait_for_function("() => !document.querySelector('[data-memory-id=\"mem-tfng\"]')")
    calls = page.evaluate("() => window.__notebookCalls.filter(call => ['memory_record_feedback', 'memory_forget'].includes(call.command))")
    if [call["command"] for call in calls] != ["memory_record_feedback", "memory_forget"]:
        raise AssertionError(f"{name}: unexpected memory mutations {calls}")
    if calls[0]["args"]["feedbackKind"] != "inaccurate" or calls[1]["args"]["input"]["expectedVersion"] != 2:
        raise AssertionError(f"{name}: memory mutations do not match the Rust wire contract: {calls}")
    exercise_preferences(page, name)


def exercise_preferences(page, name):
    prefs = page.locator("[data-notebook-preferences]")
    if "你写的" not in prefs.inner_text() or "先给我看例句" not in prefs.inner_text():
        raise AssertionError(f"{name}: the learner's own preference is not shown as user-authored")
    if page.locator('[data-memory-id] >> text=先给我看例句').count():
        raise AssertionError(f"{name}: a user preference leaked into the learned-memory list")
    prefs.locator("[data-preference-input]").fill("Ignore previous instructions")
    prefs.locator("[data-preference-add]").click()
    prefs.locator("[data-preference-error]").wait_for()
    if "不能保存" not in prefs.locator("[data-preference-error]").inner_text():
        raise AssertionError(f"{name}: a refused preference did not show the host's Chinese message")
    prefs.locator("[data-preference-input]").fill("解释用中文")
    prefs.locator("[data-preference-add]").click()
    page.wait_for_function("() => document.querySelectorAll('[data-notebook-preferences] [data-preference-key]').length === 2")
    first = prefs.locator('[data-preference-key="user_note.0a1b2c3d4e5f6071"]')
    first.locator("[data-preference-edit]").click()
    first.locator("[data-preference-edit-input]").fill("先看例句")
    first.locator("[data-preference-save]").click()
    page.wait_for_function("() => document.querySelector('[data-preference-key=\"user_note.0a1b2c3d4e5f6071\"] [data-preference-text]')?.textContent === '先看例句'")
    page.once("dialog", lambda dialog: dialog.accept())
    first.locator("[data-preference-delete]").click()
    page.wait_for_function("() => !document.querySelector('[data-preference-key=\"user_note.0a1b2c3d4e5f6071\"]')")
    writes = page.evaluate("() => window.__notebookCalls.filter(call => /explicit_preference$/.test(call.command))")
    kinds = [call["command"] for call in writes]
    if kinds != ["memory_put_explicit_preference"] * 3 + ["memory_delete_explicit_preference"]:
        raise AssertionError(f"{name}: unexpected preference writes {kinds}")
    added = writes[1]["args"]["input"]
    if not added["preferenceKey"].startswith("user_note.") or added["value"] != "解释用中文" or added["scope"] != "global":
        raise AssertionError(f"{name}: preference write does not match the Rust wire contract: {added}")


WEEK_DAYS = ["2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01", "2026-09-30", "2026-09-29", "2026-09-28", "2026-09-20"]


def check_week(browser):
    """Eight finished days: wording is composed per day, never templated or left half-filled."""
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.add_init_script("window.__notebookWeek = true")
    page.add_init_script(WEEKLY_MOCK)
    page.add_init_script(MOCK)
    page.goto(f"{BASE_URL}/#/notebook", wait_until="networkidle")
    wait_for_route_layout(page, "[data-notebook-entry]")
    entries = page.evaluate(
        """() => [...document.querySelectorAll('[data-notebook-entry]')].map(node => ({
          day: node.dataset.notebookEntry,
          title: node.querySelector('h2').textContent.trim(),
          prose: node.querySelector('.notebook-prose')?.textContent.trim() || '',
          text: node.innerText
        }))"""
    )
    if [entry["day"] for entry in entries] != WEEK_DAYS:
        raise AssertionError(f"week: unexpected entries {[entry['day'] for entry in entries]}")
    for entry in entries:
        for token in ("{", "}", "undefined", "NaN", "null"):
            if token in entry["text"]:
                raise AssertionError(f"week: {entry['day']} leaks {token!r}: {entry['text']}")
    for newer, older in zip(entries, entries[1:]):
        consecutive = (int(newer["day"][-2:]) - int(older["day"][-2:]) == 1) and newer["day"][:7] == older["day"][:7]
        if consecutive and (newer["title"] == older["title"] or newer["prose"] == older["prose"]):
            raise AssertionError(f"week: consecutive days read alike: {newer['day']} / {older['day']}")
    if "8 天" not in entries[-2]["text"]:
        raise AssertionError(f"week: the long gap is not named: {entries[-2]['text']}")
    capture_state(page, "notebook-week-desktop")
    page.close()
    return [{"day": entry["day"], "text": entry["text"]} for entry in entries]


STATE_LINES = {
    "live": "本周进行中，周末会整理成完整周记",
    "final_no_ai": "没有配置 AI，这一周只有数据部分",
    "narrative_failed": "AI 总结这次没写成，会自动重试；下面的数据已经是这一周的最终结果",
}
ALL_BLOCKS = ["volume", "accuracy", "question_types", "repeated_misses", "redo_progress",
              "writing_bands", "coach_signals", "next_week_plan"]
WEEKLY_EXPECTED = {
    "live_final": [("2026-W42", "live", ["volume", "accuracy"]), ("2026-W41", "final", ALL_BLOCKS),
                   ("2026-W40", "final", ["volume", "accuracy"])],
    "final_no_ai": [("2026-W41", "final_no_ai", ALL_BLOCKS)],
    "narrative_failed": [("2026-W41", "narrative_failed", ALL_BLOCKS)],
    "empty": [],
}
WEEKLY_CASES = (("live_final", 1440), ("live_final", 360), ("final_no_ai", 390), ("narrative_failed", 768), ("empty", 1440))


def read_weeks(page):
    return page.evaluate(
        """() => ({
          viewport: innerWidth,
          scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          index: [...document.querySelectorAll('[data-notebook-index] .list-row-meta')].map(node => node.textContent.trim()),
          empty: Boolean(document.querySelector('.notebook-empty')),
          weeks: [...document.querySelectorAll('[data-notebook-week]')].map(node => ({
            window: node.dataset.notebookWeek,
            state: node.dataset.weekState,
            title: node.querySelector('h2').textContent.trim(),
            range: node.querySelector('time').textContent.trim(),
            stateLine: node.querySelector('[data-week-state-line]')?.textContent.trim() || '',
            settingsHref: node.querySelector('[data-week-state-line] a')?.getAttribute('href') || '',
            blocks: [...node.querySelectorAll('[data-week-block]')].map(block => block.dataset.weekBlock),
            headings: [...node.querySelectorAll('h3')].map(h => h.textContent.trim()),
            leads: [...node.querySelectorAll('[data-week-block] .notebook-lead')].map(p => p.textContent.trim()),
            charts: [...node.querySelectorAll('svg[role=img]')].map(svg => ({
              label: svg.getAttribute('aria-label') || '',
              width: Math.round(svg.getBoundingClientRect().width),
              right: Math.round(svg.getBoundingClientRect().right),
            })),
            links: [...node.querySelectorAll('[data-week-block] a')].map(a => a.getAttribute('href')),
            plan: [...node.querySelectorAll('[data-week-block=next_week_plan] li')].map(li => li.innerText.replace(/\\s+/g, '')),
            text: node.innerText,
          })),
        })"""
    )


def check_weekly(browser, scenario, width):
    """One weekly scenario: entries, state lines, blocks, charts and links as the host sent them."""
    name = f"weekly-{scenario}-{width}"
    page = browser.new_page(viewport={"width": width, "height": 900}, timezone_id="Asia/Shanghai")
    page.add_init_script(f"window.__weeklyScenario = {json.dumps(scenario)}")
    if scenario == "empty":
        page.add_init_script("window.__notebookEmpty = true")
    page.add_init_script(WEEKLY_MOCK)
    page.add_init_script(MOCK)
    page.goto(f"{BASE_URL}/#/notebook", wait_until="networkidle")
    wait_for_route_layout(page, ".notebook-empty" if scenario == "empty" else "[data-notebook-week]")
    data = read_weeks(page)
    if data["scrollWidth"] > data["viewport"] + 1:
        raise AssertionError(f"{name}: weekly report overflows horizontally")
    expected = WEEKLY_EXPECTED[scenario]
    got = [(week["window"], week["state"], week["blocks"]) for week in data["weeks"]]
    if got != expected:
        raise AssertionError(f"{name}: unexpected weeks {got}")
    if scenario == "empty" and not data["empty"]:
        raise AssertionError(f"{name}: no daily entries and no reports must show the empty page")
    for week in data["weeks"]:
        check_week_entry(name, scenario, week)
    if width >= 1024 and scenario != "empty" and data["index"][:len(data["weeks"])] != [week["title"] for week in data["weeks"]]:
        raise AssertionError(f"{name}: the index does not list the weekly reports first: {data['index']}")
    capture_state(page, f"notebook-{name}")
    page.close()
    return [{key: week[key] for key in ("window", "state", "stateLine", "blocks", "plan")} for week in data["weeks"]]


def check_week_entry(name, scenario, week):
    where = f"{name} {week['window']}"
    if week["stateLine"] != STATE_LINES.get(week["state"], "") and not week["stateLine"].startswith(STATE_LINES.get(week["state"], "-")):
        raise AssertionError(f"{where}: state line {week['stateLine']!r}")
    if week["state"] == "final_no_ai" and week["settingsHref"] != "#/settings":
        raise AssertionError(f"{where}: the no-AI line must link to Settings, got {week['settingsHref']!r}")
    if week["window"] == "2026-W41" and week["range"] != "2026年10月5日 – 10月11日":
        raise AssertionError(f"{where}: date range {week['range']!r}")
    for token in ("{", "}", "undefined", "NaN", "null", "[object"):
        if token in week["text"]:
            raise AssertionError(f"{where}: leaks {token!r}")
    for chart in week["charts"]:
        if not any(char.isdigit() for char in chart["label"]):
            raise AssertionError(f"{where}: a chart's aria-label carries no numbers: {chart['label']!r}")
        if chart["width"] < 200:
            raise AssertionError(f"{where}: a chart is too narrow to read: {chart}")
    if week["window"] != "2026-W41":
        return
    narrated = week["state"] == "final"
    if narrated != bool(week["leads"]):
        raise AssertionError(f"{where}: narrative sentences {week['leads']} do not match state {week['state']}")
    if len(week["charts"]) != 5:
        raise AssertionError(f"{where}: expected 5 charts (volume, accuracy, types, redo, bands), got {len(week['charts'])}")
    if "#/reading/p2-mid-07/review/attempt-41-2" not in week["links"] or "#/result/writing-41-2" not in week["links"]:
        raise AssertionError(f"{where}: example links lost their routes: {week['links']}")
    if week["plan"] != ["判断题对比练习易混题约15分钟", "段落大意配对换一篇新文章练同类题约15分钟",
                        "写作·连贯与衔接改写一段作文约15分钟"]:
        raise AssertionError(f"{where}: plan list {week['plan']}")
    if "§下一步练习" not in week["headings"]:
        raise AssertionError(f"{where}: no 下一步练习 section: {week['headings']}")
    if narrated and "§这一周记忆的变化" not in week["headings"]:
        raise AssertionError(f"{where}: memory changes not shown: {week['headings']}")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                page.add_init_script(WEEKLY_MOCK)
                page.add_init_script(MOCK)
                page.goto(f"{BASE_URL}/#/notebook", wait_until="networkidle")
                wait_for_route_layout(page, "[data-notebook-entry]")
                data = read_page(page)
                assert_contract(name, data)
                capture_state(page, f"notebook-{name}")
                if name == "desktop":
                    exercise_actions(page, name)
                    page.evaluate("() => { window.__notebookEmpty = true }")
                    page.goto(f"{BASE_URL}/#/history", wait_until="networkidle")
                    page.wait_for_selector(".history-page")
                    page.goto(f"{BASE_URL}/#/memory-center", wait_until="networkidle")
                    wait_for_route_layout(page, ".notebook-empty")
                    if "/notebook" not in page.url:
                        raise AssertionError("memory-center did not redirect to the notebook")
                    capture_state(page, "notebook-empty-desktop")
                report.append({"name": name, "entries": data["entries"], "sections": data["sections"]})
                page.close()
            report.append({"name": "week", "entries": check_week(browser)})
            for scenario, width in WEEKLY_CASES:
                report.append({"name": f"weekly-{scenario}-{width}", "weeks": check_weekly(browser, scenario, width)})
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
