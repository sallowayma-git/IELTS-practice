"""Stateful Tauri mock for the unified History page (all activities)."""
import json


WRITING_STATISTICS = {
    "count": 3,
    "latest": {
        "score": {"taskResponse": 7.0, "coherence": 6.5, "lexical": 7.5, "grammar": 6.5},
        "taskType": "task2",
        "submittedAt": "2026-08-10T08:30:00Z",
    },
    "average": {"taskResponse": 6.5, "coherence": 6.5, "lexical": 7.0, "grammar": 7.0},
}


def install_history_mock(page, items, statistics=None):
    """list/delete/clear/export honour the same contract the Rust commands do.

    window.__historyItems is the live table; window.__historyCalls records every
    invoke so tests can assert the exact command + arguments.  `statistics` is
    the history_writing_statistics payload (default: no writing statistics).
    """
    script = r"""
    (() => {
      window.__historyItems = __ITEMS__;
      window.__historyCalls = [];
      window.__historyStatistics = __STATISTICS__;
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
      const filtered = (query) => window.__historyItems.filter((item) => {
        if (query.activity && item.activity !== query.activity) return false;
        if (query.taskType && item.taskType !== query.taskType) return false;
        if (query.search && !String(item.title || '').toLowerCase().includes(String(query.search).toLowerCase())) return false;
        return true;
      });
      const invoke = async (command, args = {}) => {
        window.__historyCalls.push({ command, args });
        if (command === 'list_history') {
          const query = args.query || {};
          // Like the real query: one newest-first order across every activity.
          const visible = filtered(query).sort(
            (left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)) || String(right.id).localeCompare(String(left.id))
          );
          const offset = Number(query.offset || 0);
          const limit = Number(query.limit || 20);
          return { ok: true, data: { items: visible.slice(offset, offset + limit), total: visible.length, limit, offset, nextCursor: null } };
        }
        if (command === 'history_writing_statistics') {
          return { ok: true, data: window.__historyStatistics };
        }
        if (command === 'delete_history_attempt') {
          const before = window.__historyItems.length;
          window.__historyItems = window.__historyItems.filter((item) => item.id !== args.attemptId);
          return { ok: true, data: before - window.__historyItems.length };
        }
        if (command === 'delete_history_attempts') {
          const ids = new Set(args.cmd?.attemptIds || []);
          const before = window.__historyItems.length;
          window.__historyItems = window.__historyItems.filter((item) => !ids.has(item.id));
          return { ok: true, data: before - window.__historyItems.length };
        }
        if (command === 'clear_history') {
          const activity = args.cmd?.activity || null;
          const before = window.__historyItems.length;
          window.__historyItems = window.__historyItems.filter((item) => activity && item.activity !== activity);
          return { ok: true, data: before - window.__historyItems.length };
        }
        if (command === 'export_history') {
          return { ok: true, data: { body: 'time,title\n2026-08-07,mock\n', format: 'csv' } };
        }
        return { ok: true, data: null };
      };
      window.__TAURI__.core = { invoke };
      window.__TAURI_INTERNALS__.invoke = invoke;
    })();
    """.replace("__ITEMS__", json.dumps(items, ensure_ascii=False)).replace(
        "__STATISTICS__",
        json.dumps(statistics or {"count": 0, "latest": None, "average": None}, ensure_ascii=False),
    )
    page.add_init_script(script)


def history_calls(page, command):
    return page.evaluate(
        "command => window.__historyCalls.filter((call) => call.command === command).map((call) => call.args)",
        command,
    )


def reading_item(index, title, score, **extra):
    return {
        "id": f"reading-{index}",
        "activity": "reading",
        "title": title,
        "status": "completed",
        "mode": "single",
        "submittedAt": f"2026-08-{10 - index:02d}T09:30:00.000Z",
        "durationMs": (index + 7) * 60_000,
        "scoreValue": score,
        "scoreScale": "ratio",
        "scoreLabel": "Accuracy",
        "scoreDisplay": f"{round(score * 100)}%",
        "taskType": "reading",
        "assetId": f"asset-{index}",
        "sessionId": f"session-{index}",
        **extra,
    }


def writing_item(index, title, band, task_type="task2", **extra):
    return {
        "id": f"writing-{index}",
        "activity": "writing",
        "title": title,
        "status": "completed",
        "mode": "single",
        "submittedAt": f"2026-08-{10 - index:02d}T08:30:00.000Z",
        "durationMs": 2_340_000,
        "scoreValue": band,
        "scoreScale": "band9",
        "scoreLabel": "Overall Band",
        "scoreDisplay": f"{band:.1f}",
        "taskType": task_type,
        **extra,
    }
