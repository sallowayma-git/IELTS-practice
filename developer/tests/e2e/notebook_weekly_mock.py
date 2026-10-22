"""Weekly report v3 fixtures for the notebook e2e scripts.

`WEEKLY_MOCK` defines `window.__weeklyReports(scenario)` -> `{ current, list }`,
the payloads of `weekly_report_current` and `weekly_report_list`. Reports follow
crates/ielts-domain/src/weekly_report.rs (camelCase) and every block's data
follows the block contract: rates are 2dp fractions, days are local
"YYYY-MM-DD", priority bands / probes / skill keys are backend values.

The fixture source is developer/tests/dev-mock/weekly-reports.js -- the same
file the dev mock handlers read -- so the browser fixture and the JS fixture
cannot drift: one set of windows, facts, narratives and blocks.

Scenarios:
    live_final        this week live (no narrative) + two finished weeks (final)
    final_no_ai       one finished week, no model configured
    narrative_failed  one finished week whose narrative failed
    empty             nothing practised: current null, list empty

Window instants are written for UTC+8 local midnights; the scripts that check
date labels open their pages with timezone_id="Asia/Shanghai".
"""
from __future__ import annotations

import re
from pathlib import Path

_SOURCE = Path(__file__).resolve().parents[1] / "dev-mock" / "weekly-reports.js"
_STRIP_EXPORT = re.compile(r"^export\s+", re.MULTILINE)

WEEKLY_MOCK = "\n".join((
    "(() => {",
    _STRIP_EXPORT.sub("", _SOURCE.read_text(encoding="utf-8")),
    "  window.__weeklyReports = (scenario) => weeklyReports(scenario);",
    "})();",
))
