"""札记 (Notebook) route: consolidation output as dated prose, nothing more.

Checks the learner-facing contract: dated entries read in reverse order,
only finished journal days are read (never today's open day), evidence opens
inline as footnotes, memories expose exactly 不准确 / 忘记, and none of the
retired workbench machinery (stat tiles, prompt box, run buttons) leaks in.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright
from visual_test_support import capture_state, wait_for_route_layout


BASE_URL = os.environ.get("NOTEBOOK_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (("desktop", 1440, 900), ("tablet", 768, 1024), ("mobile", 390, 844), ("small", 360, 640))

MOCK = r"""
(() => {
  const journals = {
    '2026-10-02': { id: 'journal-1002', journalDate: '2026-10-02', status: 'published', facts: {
      journalDate: '2026-10-02', attemptsCount: 3, timeSpentMs: 3120000,
      writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.5 },
      skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, evidenceCount: 3 },
                    { skillKey: 'reading.matching_headings', delta: -0.3, evidenceCount: 2 }],
      coachFeedbackCount: 2,
      memoryEvents: [{ memoryId: 'mem-tfng', namespace: 'skill', canonicalKey: 'reading.tfng',
                       changeKind: 'reinforced', evidenceObservationIds: ['obs-tfng'] }]
    }, unresolvedQuestions: ['NOT GIVEN 与 FALSE 的边界仍然模糊'] },
    '2026-09-30': { id: 'journal-0930', journalDate: '2026-09-30', status: 'published', facts: {
      journalDate: '2026-09-30', attemptsCount: 1, timeSpentMs: 1260000,
      writingEvalSummary: { completed: 0, degraded: 0, averageBand: null }, skillDeltas: [] } }
  };
  window.__notebookCalls = [];
  window.__catalog = [
    { id: 'mem-tfng', canonicalKey: 'reading.tfng', statement: '判断题中，你常把“未提及”误判为“错误”。',
      sourceClass: 'observed', namespace: 'skill', status: 'active', version: 2,
      evidenceObservationIds: ['obs-tfng'], lastSeen: '2026-10-02T09:00:00Z' },
    { id: 'mem-pref', canonicalKey: 'pref.examples', statement: '你更喜欢先看例句，再看规则讲解。',
      sourceClass: 'user_explicit', namespace: 'preference', status: 'active', version: 1,
      evidenceObservationIds: [], lastSeen: '2026-09-28T09:00:00Z' }
  ];
  const invoke = async (command, args = {}) => {
    window.__notebookCalls.push({ command, args });
    if (window.__notebookEmpty && command !== 'memory_catalog_list') {
      return { ok: true, data: command === 'background_job_status' ? [] : null };
    }
    switch (command) {
      case 'background_job_status': return { ok: true, data: [
        { id: 'j1', jobKind: 'daily_journal', status: 'completed', dedupeKey: 'daily_journal:local:2026-09-30' },
        { id: 'j2', jobKind: 'daily_dream', status: 'completed', dedupeKey: 'daily_dream:local:2026-10-02' },
        { id: 'j3', jobKind: 'daily_journal', status: 'running', dedupeKey: 'daily_journal:local:2026-10-03' }
      ] };
      case 'journal_get_daily': return { ok: true, data: journals[args.query.journalDate] || null };
      case 'memory_catalog_list': return { ok: true, data: { userId: 'local',
        entries: window.__notebookEmpty ? [] : window.__catalog.filter(row => row.status === 'active'), truncated: false } };
      case 'study_plan_get_latest': return { ok: true, data: { plan: { id: 'plan-1' }, items: [
        { id: 'spi-1', planId: 'plan-1', skillProbe: { skillKey: 'reading.tfng', probeKind: 'contrastive_pair' },
          whyText: '用两组“错误 / 未提及”对照题，练习定位原文证据。', estimatedMinutes: 15, done: false },
        { id: 'spi-2', planId: 'plan-1', skillProbe: 'reading.matching_headings',
          whyText: '已完成的项不再出现。', estimatedMinutes: 10, done: true }
      ] } };
      case 'learning_observations_get_by_ids': return { ok: true, data: { observations: [{
        id: 'obs-tfng', userId: 'local', observationType: 'question_outcome', observedAt: '2026-10-02',
        scopeKey: 'reading.tfng', valueText: '第 9 题改答后仍错误：原文没有提到价格变化。',
        evidence: [{ eventId: 'ev-tfng', evidenceRole: 'support', ordinal: 0 }] }], missingIds: [], freshness: 'fresh' } };
      case 'learning_events_get_evidence_by_ids': return { ok: true, data: { events: [{
        id: 'ev-tfng', userId: 'local', activity: 'reading', assetId: 'p1-high-01', attemptId: 'attempt-9',
        questionId: 'q9', eventType: 'reading_question_outcome', sourceKind: 'attempt', sourceId: 'attempt-9',
        occurredAt: '2026-10-02', payload: {} }], missingIds: [] } };
      case 'memory_record_feedback': return { ok: true, data: { feedbackKind: args.feedbackKind } };
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
    if "已完成的项不再出现" in data["text"] or "%" in data["text"]:
        raise AssertionError(f"{name}: notebook shows finished plan items or fake precision")
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
    page.locator('[data-memory-id="mem-pref"] button', has_text="不准确").click()
    page.wait_for_function("() => window.__notebookCalls.some(call => call.command === 'memory_record_feedback')")
    page.locator('[data-memory-id="mem-tfng"] button', has_text="忘记").click()  # dialog dismissed by default
    if page.evaluate("() => window.__notebookCalls.some(call => call.command === 'memory_forget')"):
        raise AssertionError(f"{name}: cancelled forget issued IPC")
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator('[data-memory-id="mem-tfng"] button', has_text="忘记").click()
    page.wait_for_function("() => !document.querySelector('[data-memory-id=\"mem-tfng\"]')")
    calls = page.evaluate("() => window.__notebookCalls.filter(call => call.command.startsWith('memory_') && call.command !== 'memory_catalog_list')")
    if [call["command"] for call in calls] != ["memory_record_feedback", "memory_forget"]:
        raise AssertionError(f"{name}: unexpected memory mutations {calls}")
    if calls[0]["args"]["feedbackKind"] != "inaccurate" or calls[1]["args"]["input"]["expectedVersion"] != 2:
        raise AssertionError(f"{name}: memory mutations do not match the Rust wire contract: {calls}")


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
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
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
