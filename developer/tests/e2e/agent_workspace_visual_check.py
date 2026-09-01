import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("AGENT_VISUAL_BASE_URL", "http://127.0.0.1:4175")
REPORT_DIR = Path(__file__).parent / "reports"
CASES = (("desktop", 1440, 900), ("tablet", 980, 720), ("mobile", 390, 844), ("small", 360, 640))

TAURI_AGENT_MOCK = """
() => {
  const outcome = {
    runId: 'run-m0-0001',
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
  window.__agentShouldFail = false;
  const invokeMock = async (command, args = {}) => {
    window.__agentCommandLog.push({ command, args });
    if (command === 'memory_context_preview') {
      return { ok: true, data: { entries: [], source: 'active_memory' }, error: null };
    }
    if (command === 'memory_catalog_list') {
      return { ok: true, data: { userId: 'local', entries: [], truncated: false }, error: null };
    }
    if (command === 'study_plan_get_latest') {
      return { ok: true, data: null, error: null };
    }
    if (command === 'background_job_status') {
      return { ok: true, data: [], error: null };
    }
    if (command === 'journal_get_daily') {
      return { ok: true, data: null, error: null };
    }
    if (command === 'agent_thread_list') {
      return { ok: true, data: [], error: null };
    }
    if (command === 'agent_approval_list') {
      return { ok: true, data: [], error: null };
    }
    if (command === 'agent_pick_workspace') {
      return { ok: true, data: {
        grantId: 'grant-m0',
        displayPath: 'C:\\\\IELTS Atlas\\\\study',
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
    report = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for name, width, height in CASES:
                page = browser.new_page(viewport={"width": width, "height": height})
                page.add_init_script(f"({TAURI_AGENT_MOCK})()")
                page.goto(f"{BASE_URL}/#/agent", wait_until="networkidle")
                page.wait_for_selector("[data-agent-console]")
                page.wait_for_selector(".agent-heartbeat")
                page.wait_for_selector(".agent-evolution-zone")
                # The advanced workbench lives in a collapsed details panel;
                # open it before asserting its internals.
                page.evaluate(
                    "document.querySelector('details[data-agent-workspace]')?.setAttribute('open', '')"
                )
                page.wait_for_selector("[data-agent-workspace] .agent-workspace-select")
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
                    page.locator(".agent-workspace-select").click()
                    page.wait_for_function(
                        "document.querySelector('.agent-workspace-select')?.innerText.includes('study')"
                    )
                    page.evaluate("window.__agentShouldFail = true")
                    page.locator(".agent-run-button").click()
                    page.wait_for_function(
                        "document.querySelector('.agent-icon-button')?.disabled && "
                        "document.querySelector('.agent-workspace-select')?.disabled"
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
                    expected_commands = [
                        "agent_pick_workspace", "agent_run", "agent_get_run", "agent_run", "agent_get_run"
                    ]
                    if commands != expected_commands:
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
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(REPORT_DIR / f"agent-{name}-current.png"), full_page=True)
                report.append({"name": name, "geometry": geometry})
                page.close()
        finally:
            browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
