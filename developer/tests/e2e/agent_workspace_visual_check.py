import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from visual_test_support import flagged_preview


# The workbench is a developer route (/dev/agent) that only exists in builds
# with VITE_FEATURE_AGENT_WORKSPACE_V1=true, so this check serves its own.
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (("desktop", 1440, 900), ("tablet", 980, 720), ("mobile", 390, 844), ("small", 360, 640))

TAURI_AGENT_MOCK = """
() => {
  const outcome = {
    runId: 'run-m0-0001',
    runKind: 'workspace',
    content: '已读取学习记录，并生成一份可执行的复盘建议。',
    model: 'fake-agent-model',
    actualModel: 'fake-agent-model',
    rounds: 2,
    toolCalls: 1,
    latencyMs: 34,
    retryCount: 1,
    promptHash: 'prompt-hash-m0',
    usage: { inputTokens: 21, outputTokens: 13 },
    providerRequestId: 'provider-request-m0'
  };
  const run = {
    id: outcome.runId,
    providerId: 'fake-provider',
    model: 'requested-model',
    runKind: 'workspace',
    status: 'completed',
    rounds: 2,
    toolCallCount: 1,
    result: {
      actualModel: outcome.actualModel,
      latencyMs: outcome.latencyMs,
      retryCount: outcome.retryCount,
      promptHash: outcome.promptHash,
      usage: outcome.usage,
      providerRequestId: outcome.providerRequestId
    },
    error: null,
    createdAt: '2026-08-11T08:00:00Z',
    updatedAt: '2026-08-11T08:00:01Z',
    completedAt: '2026-08-11T08:00:01Z',
    toolCalls: [{
      runId: outcome.runId,
      callId: 'call-read-1',
      sequence: 1,
      round: 1,
      toolName: 'read_file',
      status: 'succeeded',
      arguments: { path: 'reading-notes.md' },
      result: { path: 'reading-notes.md', bytes: 128, sha256: 'file-hash' },
      error: null,
      startedAt: '2026-08-11T08:00:00Z',
      completedAt: '2026-08-11T08:00:00Z'
    }]
  };
  const failedRun = {
    id: 'run-m0-failed',
    providerId: 'fake-provider',
    model: 'requested-model-must-not-become-actual',
    runKind: 'workspace',
    status: 'failed',
    rounds: 1,
    toolCallCount: 0,
    result: {
      actualModel: null,
      latencyMs: 12,
      retryCount: 0,
      promptHash: 'prompt-hash-m0',
      usage: null,
      providerRequestId: 'provider-request-failed'
    },
    error: { code: 'agent.provider_failed', message: 'Provider unavailable for M0 test.', retryable: true },
    createdAt: '2026-08-11T08:00:00Z',
    updatedAt: '2026-08-11T08:00:01Z',
    completedAt: '2026-08-11T08:00:01Z',
    toolCalls: []
  };
  window.__agentCommandLog = [];
  localStorage.setItem('memoryCenter.lastVisitAt', '2026-08-01T00:00:00Z');
  window.__memoryCatalog = ['archive', 'feedback', 'forget'].map(name => ({
    id: `mem-${name}`, canonicalKey: `knowledge.reading.${name}`,
    statement: `记忆 ${name} 的正文`, sourceClass: 'observed', namespace: 'knowledge',
    scope: 'activity:reading', status: 'active', version: 1,
    confidenceBand: 'medium', supportCount: 2, contradictionCount: 0,
    evidenceObservationIds: ['obs-evidence'], firstSeen: '2026-08-11T08:00:00Z',
    lastSeen: '2026-08-11T08:00:00Z', pendingVerification: false
  }));
  window.__agentShouldFail = false;
  const invokeMock = async (command, args = {}) => {
    window.__agentCommandLog.push({ command, args });
    if (command === 'memory_context_preview') {
      return { ok: true, data: { userId: 'local', activity: 'reading', entries: [], truncated: false }, error: null };
    }
    if (command === 'learning_observations_get_by_ids') {
      if (JSON.stringify(args.ids) !== '["obs-evidence"]') throw new Error('unexpected observation IDs');
      return { ok: true, data: { schemaVersion: 1, projectorKey: 'learning_observations', projectorVersion: 1,
        ledgerInputHash: 'ledger-hash-m0', observationOutputHash: 'observation-hash-m0',
        generatedAt: '2026-08-11T08:00:00Z', freshness: 'fresh', observations: [{
        id: 'obs-evidence', userId: 'local', observationType: 'reading_error', namespace: 'reading',
        scopeKind: 'activity', scopeKey: 'activity:reading', polarity: null, valueNum: null,
        valueText: '判断题中遗漏了原文限定条件。', payload: {}, confidence: 0.8, evidenceStrength: 0.7,
        observedAt: '2026-08-11T08:00:00Z', projectorKey: 'learning_observations', projectorVersion: 1,
        sourceFingerprint: 'fp-obs-evidence', sensitivity: 'normal', trust: 'deterministic_projection',
        evidence: [{ eventId: 'event-evidence', evidenceRole: 'support', ordinal: 0 }]
      }], missingIds: [] }, error: null };
    }
    if (command === 'learning_events_get_evidence_by_ids') {
      if (JSON.stringify(args.ids) !== '["event-evidence"]') throw new Error('unexpected event IDs');
      return { ok: true, data: { schemaVersion: 1, events: [{
        id: 'event-evidence', userId: 'local', eventType: 'reading_question_outcome',
        occurredAt: '2026-08-11T08:00:00Z', sourceKind: 'attempt', sourceId: 'attempt-evidence',
        activity: 'reading', assetId: 'asset-evidence', attemptId: 'attempt-evidence',
        questionId: 'question-evidence', skillKey: null, payload: { answer: 'TRUE', correct: false },
        contentHash: 'content-hash-event-evidence', schemaVersion: 1, sensitivity: 'normal',
        trust: 'canonical_learning_truth'
      }], missingIds: [] }, error: null };
    }
    if (command === 'memory_catalog_list') {
      if (window.__memoryCatalogFailOnce) {
        window.__memoryCatalogFailOnce = false;
        return { ok: false, data: null, error: { code: 'memory.catalog_unavailable', message: 'catalog unavailable' } };
      }
      return { ok: true, data: { userId: 'local',
        entries: window.__memoryCatalog.filter(row => row.status !== 'deleted'), truncated: false }, error: null };
    }
    if (command === 'memory_archive' || command === 'memory_forget') {
      if (window.__memoryMutationFailOnce) {
        window.__memoryMutationFailOnce = false;
        return { ok: false, data: null, error: { code: 'memory.conflict', message: 'mutation rejected' } };
      }
      const row = window.__memoryCatalog.find(row => row.id === args.input.memoryId);
      if (!row || row.version !== args.input.expectedVersion) throw new Error('stale memory');
      row.status = command === 'memory_archive' ? 'archived' : 'deleted';
      row.version += 1;
      if (command === 'memory_forget') { row.statement = '[deleted]'; row.evidenceObservationIds = []; }
      return { ok: true, data: null, error: null };
    }
    if (command === 'memory_record_feedback') {
      if (!['accurate', 'inaccurate'].includes(args.feedbackKind)) throw new Error('bad feedback kind');
      const row = window.__memoryCatalog.find(row => row.id === args.memoryId);
      if (args.feedbackKind === 'inaccurate') { row.status = 'archived'; row.version += 1; }
      return { ok: true, data: { id: 'feedback-m0', memoryId: args.memoryId, feedbackKind: args.feedbackKind, userId: 'local', payload: {}, createdAt: '2026-08-11T08:00:00Z' }, error: null };
    }
    if (command === 'study_plan_get_latest') {
      return { ok: true, data: null, error: null };
    }
    if (command === 'background_job_status') {
      return { ok: true, data: [], error: null };
    }
    if (command === 'journal_get_daily') {
      // The backend always returns a journal for a day (it builds one on demand).
      const journalDate = args.query?.journalDate || '2026-08-11';
      return { ok: true, data: { id: 'journal-empty-' + journalDate, userId: 'local', journalDate, version: 1,
        status: 'published', facts: { journalDate, attemptsCount: 0, timeSpentMs: 0,
          writingEvalSummary: { completed: 0, degraded: 0, averageBand: null }, skillDeltas: [],
          memoryChanges: { newCandidates: 0, promoted: 0, reinforced: 0, refined: 0, improved: 0, regressed: 0, contradicted: 0, superseded: 0 },
          coachFeedbackCount: 0, coachReaskCount: 0, sourceHash: 'source-hash-empty', todayObservationIds: [], memoryEvents: [] },
        sourceHash: 'source-hash-empty', renderedMarkdown: null, supersededBy: null,
        createdAt: '2026-08-11T08:00:00Z', updatedAt: '2026-08-11T08:00:00Z' }, error: null };
    }
    if (command === 'agent_thread_list') {
      return { ok: true, data: [], error: null };
    }
    if (command === 'agent_approval_list') {
      return { ok: true, data: [], error: null };
    }
    if (command === 'agent_get_workspace') {
      return { ok: true, data: {
        grantId: 'grant-m0',
        displayPath: 'C:\\\\IELTS Atlas\\\\agent-workspace',
        expiresAt: '2026-08-11T08:15:00Z'
      }, error: null };
    }
    if (command === 'agent_run') {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (window.__agentShouldFail) {
        return { ok: false, data: null, error: {
          code: 'agent.provider_failed', message: 'Provider unavailable for M0 test.', retryable: true,
          context: { runId: failedRun.id }, causeId: 'cause-m0-failed'
        }};
      }
      return { ok: true, data: outcome, error: null };
    }
    if (command === 'agent_get_run') {
      return { ok: true, data: args.runId === failedRun.id ? failedRun : run, error: null };
    }
    throw new Error(`unexpected command: ${command}`);
  };
  window.__TAURI__ = { core: { invoke: invokeMock } };
  window.__TAURI_INTERNALS__ = { invoke: invokeMock };
}
"""


def main():
    with flagged_preview(VITE_FEATURE_AGENT_WORKSPACE_V1=True) as base_url:
        run_checks(base_url)


def run_checks(base_url):
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                page.add_init_script(f"({TAURI_AGENT_MOCK})()")
                page.goto(f"{base_url}/#/dev/agent", wait_until="networkidle")
                page.wait_for_selector("[data-agent-console]")
                page.wait_for_selector(".agent-heartbeat")
                page.wait_for_selector(".agent-evolution-zone")
                # The advanced workbench lives in a collapsed details panel;
                # open it before asserting its internals.
                page.evaluate(
                    "document.querySelector('details[data-agent-workspace]')?.setAttribute('open', '')"
                )
                page.wait_for_selector("[data-agent-workspace-path]")
                geometry = page.evaluate(
                    """
                    () => {
                      const root = document.querySelector('[data-agent-console]');
                      const advanced = document.querySelector('details[data-agent-workspace]');
                      const workbench = advanced?.querySelector('.agent-workbench');
                      const prompt = advanced?.querySelector('.agent-prompt-panel');
                      const run = advanced?.querySelector('.agent-run-panel');
                      const nav = document.querySelector('.nav-links');
                      return {
                        viewport: [innerWidth, innerHeight],
                        documentScrollWidth: document.documentElement.scrollWidth,
                        bodyScrollWidth: document.body.scrollWidth,
                        rootWidth: root?.getBoundingClientRect().width,
                        workbenchWidth: workbench?.getBoundingClientRect().width,
                        columns: workbench ? getComputedStyle(workbench).gridTemplateColumns : '',
                        promptHeight: prompt?.getBoundingClientRect().height,
                        runHeight: run?.getBoundingClientRect().height,
                        heartbeatCards: document.querySelectorAll('.agent-heartbeat-card').length,
                        planZone: !!document.querySelector('.agent-plan-zone'),
                        evoTabs: document.querySelectorAll('.agent-evo-tabs button').length,
                        navScrollWidth: nav?.scrollWidth,
                        navClientWidth: nav?.clientWidth
                      };
                    }
                    """
                )
                if geometry["documentScrollWidth"] > width + 1 or geometry["bodyScrollWidth"] > width + 1:
                    raise AssertionError(
                        f"{name}: page horizontal overflow "
                        f"{geometry['documentScrollWidth']}/{geometry['bodyScrollWidth']} > {width}"
                    )
                if name == "mobile":
                    if geometry["heartbeatCards"] < 4 or not geometry["planZone"] or geometry["evoTabs"] < 6:
                        raise AssertionError(
                            f"mobile: console zones incomplete (cards={geometry['heartbeatCards']}, "
                            f"plan={geometry['planZone']}, tabs={geometry['evoTabs']})"
                        )
                    page.wait_for_function(
                        "document.querySelector('[data-agent-workspace-path]')?.innerText.includes('agent-workspace')"
                    )
                    page.evaluate("window.__agentShouldFail = true")
                    page.locator(".agent-run-button").click()
                    page.wait_for_function(
                        "document.querySelector('.agent-run-button')?.disabled"
                    )
                    page.wait_for_function(
                        "document.querySelector('.agent-page-header__status')?.innerText.includes('运行失败')"
                    )
                    failed_metadata = page.locator(".agent-output-metadata").inner_text()
                    failed_output = page.locator(".agent-output-panel p").inner_text()
                    if "run-m0-failed" not in failed_metadata or "未返回" not in failed_metadata:
                        raise AssertionError("mobile: failed SQLite run was not hydrated truthfully")
                    if "Provider unavailable for M0 test." not in failed_output:
                        raise AssertionError("mobile: original Agent error was masked during hydration")

                    page.evaluate("window.__agentShouldFail = false")
                    page.locator(".agent-run-button").click()
                    page.wait_for_function(
                        "document.querySelector('.agent-page-header__status')?.innerText.includes('已完成')"
                    )
                    command_log = page.evaluate("window.__agentCommandLog")
                    commands = [item["command"] for item in command_log]
                    expected_initialization = [
                        "memory_catalog_list", "background_job_status", "agent_approval_list",
                        "agent_thread_list", "study_plan_get_latest", "journal_get_daily",
                        "agent_get_workspace",
                    ]
                    expected_commands = [
                        "agent_get_workspace", "agent_run", "agent_get_run",
                        "agent_get_workspace", "agent_run", "agent_get_run"
                    ]
                    # Independent mount reads may resolve in either order. User actions
                    # must automatically renew, then hydrate each failed/successful run once.
                    if sorted(commands[:7]) != sorted(expected_initialization) or commands[7:] != expected_commands:
                        raise AssertionError(f"mobile: unexpected Agent command sequence {commands}")
                    geometry["interaction"] = {
                        "selected": page.locator(".agent-file-row").nth(0).evaluate(
                            "element => element.classList.contains('is-selected')"
                        ),
                        "status": page.locator(".agent-page-header__status").inner_text(),
                        "output": page.locator(".agent-output-panel p").inner_text(),
                        "runId": page.locator(".agent-run-count").inner_text(),
                        "tool": page.locator(".agent-run-steps").inner_text(),
                        "metadata": page.locator(".agent-output-metadata").inner_text(),
                        "commands": commands,
                    }
                    if "复盘建议" not in geometry["interaction"]["output"]:
                        raise AssertionError("mobile: final Agent output was not rendered")
                    if "read_file" not in geometry["interaction"]["tool"]:
                        raise AssertionError("mobile: hydrated tool call was not rendered")
                    if "fake-agent-model" not in geometry["interaction"]["metadata"]:
                        raise AssertionError("mobile: trace metadata was not rendered")
                    # Real button interactions, with a stateful IPC fixture.
                    # SQLite propagation/atomicity is tested separately in Rust.
                    page.locator('.agent-evo-tabs button').filter(has_text='近期变化').click()
                    if '记忆 archive 的正文' not in page.locator('.agent-evolution-zone').inner_text():
                        raise AssertionError('recent changes fixture must contain the original statement')
                    page.locator('.agent-evo-tabs button').filter(has_text='系统观察').click()
                    page.locator('[data-memory-id="mem-archive"]').get_by_role('button', name='归档', exact=True).click()
                    page.wait_for_function("document.querySelector('[data-memory-id=\"mem-archive\"]') === null")
                    page.locator('.agent-evo-tabs button').filter(has_text='已归档').click()
                    archived = page.locator('[data-memory-id="mem-archive"]')
                    archived.wait_for()
                    if '记忆 archive 的正文' not in archived.inner_text() or '证据 2' not in archived.inner_text():
                        raise AssertionError('archive lost its visible content/evidence')
                    archived.get_by_role('button', name='查看证据', exact=True).click()
                    archived.get_by_text('已读取 1 条关联观察。', exact=True).wait_for()
                    evidence_text = archived.inner_text()
                    if '判断题中遗漏了原文限定条件。' not in evidence_text or 'event-evidence' not in evidence_text:
                        raise AssertionError('archive did not render its original observation and event source')
                    evidence_link = archived.get_by_role('link', name='查看这次练习', exact=True)
                    if 'asset-evidence' not in (evidence_link.get_attribute('href') or ''):
                        raise AssertionError('evidence drawer lost the canonical practice navigation')
                    evidence_commands = page.evaluate("window.__agentCommandLog.filter(x => x.command.startsWith('learning_')).map(x => x.command)")
                    if evidence_commands != ['learning_observations_get_by_ids', 'learning_events_get_evidence_by_ids']:
                        raise AssertionError(f'unexpected evidence reads: {evidence_commands}')
                    if page.evaluate("window.__memoryCatalog.find(x => x.id === 'mem-archive').evidenceObservationIds") != ['obs-evidence']:
                        raise AssertionError('archive changed the observation evidence identifiers')
                    archived.get_by_role('button', name='永久遗忘', exact=True).click()  # default dismiss
                    if page.evaluate("window.__agentCommandLog.some(x => x.command === 'memory_forget')"):
                        raise AssertionError('cancelled forget must not issue IPC')
                    page.once('dialog', lambda dialog: dialog.accept())
                    archived.get_by_role('button', name='永久遗忘', exact=True).click()
                    page.wait_for_function("document.querySelector('[data-memory-id=\"mem-archive\"]') === null")
                    page.locator('.agent-evo-tabs button').filter(has_text='近期变化').click()
                    if '记忆 archive 的正文' in page.locator('.agent-evolution-zone').inner_text():
                        raise AssertionError('forgotten statement retained in recent changes')
                    page.locator('.agent-evo-tabs button').filter(has_text='系统观察').click()
                    feedback_card = page.locator('[data-memory-id="mem-feedback"]')
                    feedback_card.get_by_role('button', name='准确', exact=True).click()
                    page.wait_for_function("document.querySelector('.agent-inline-status')?.innerText.includes('准确')")
                    feedback_card.get_by_role('button', name='不准确', exact=True).click()
                    page.wait_for_function("document.querySelector('[data-memory-id=\"mem-feedback\"]') === null")
                    mutations = page.evaluate("window.__agentCommandLog.filter(x => ['memory_archive','memory_forget','memory_record_feedback'].includes(x.command))")
                    if [x['command'] for x in mutations] != ['memory_archive','memory_forget','memory_record_feedback','memory_record_feedback']:
                        raise AssertionError(f'unexpected lifecycle commands: {mutations}')
                    if mutations[0]['args']['input']['expectedVersion'] != 1 or mutations[1]['args']['input']['expectedVersion'] != 2:
                        raise AssertionError('archive/forget must use authoritative refreshed versions')
                    if [x['args']['feedbackKind'] for x in mutations[2:]] != ['accurate','inaccurate']:
                        raise AssertionError('feedback verdicts do not match Rust wire schema')
                    geometry['memoryLifecycle'] = mutations
                    # A rejected write keeps the source visible. A committed write
                    # followed by a failed read clears stale text and retries reads only.
                    active_forget = page.locator('[data-memory-id="mem-forget"]')
                    page.evaluate('window.__memoryMutationFailOnce = true')
                    page.once('dialog', lambda dialog: dialog.accept())
                    active_forget.get_by_role('button', name='永久遗忘', exact=True).click()
                    page.wait_for_function("document.querySelector('.agent-inline-error')?.innerText.includes('mutation rejected')")
                    if '记忆 forget 的正文' not in active_forget.inner_text():
                        raise AssertionError('rejected mutation must retain the original card')
                    page.evaluate('window.__memoryCatalogFailOnce = true')
                    page.once('dialog', lambda dialog: dialog.accept())
                    active_forget.get_by_role('button', name='永久遗忘', exact=True).click()
                    retry = page.locator('[data-memory-retry]')
                    retry.wait_for()
                    if '操作已保存' not in page.locator('.agent-inline-error').inner_text():
                        raise AssertionError('committed mutation misreported as failed')
                    if '记忆 forget 的正文' in page.locator('.agent-evolution-zone').inner_text():
                        raise AssertionError('failed catalog read retained forgotten text')
                    before_retry = page.evaluate("window.__agentCommandLog.filter(x => x.command === 'memory_forget').length")
                    retry.click()
                    page.wait_for_function("document.querySelector('[data-memory-retry]') === null")
                    if page.evaluate("window.__agentCommandLog.filter(x => x.command === 'memory_forget').length") != before_retry:
                        raise AssertionError('read recovery repeated the mutation')
                    page.locator('.agent-evo-tabs button').filter(has_text='已归档').click()
                    feedback_archived = page.locator('[data-memory-id="mem-feedback"]')
                    page.once('dialog', lambda dialog: dialog.accept())
                    feedback_archived.get_by_role('button', name='永久遗忘', exact=True).click()
                    page.wait_for_function("document.querySelector('[data-memory-id=\"mem-feedback\"]') === null")
                    last_forget = page.evaluate("window.__agentCommandLog.filter(x => x.command === 'memory_forget').at(-1)")
                    if last_forget['args']['input']['expectedVersion'] != 2:
                        raise AssertionError('feedback/forget must use the updated version')
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(REPORT_DIR / f"agent-{name}-current.png"), full_page=True)
                report.append({"name": name, "geometry": geometry})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
