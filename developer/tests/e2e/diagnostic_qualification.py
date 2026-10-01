#!/usr/bin/env python3
"""C4 evidence gate. Run isolated suites and retain only allowlisted evidence fields."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

from e2e_runner import _terminate_process_tree

ROOT = Path(__file__).resolve().parents[3]
REPORTS = ROOT / 'developer/tests/e2e/reports'
MODES = ('file', 'http', 'subpath')
# Script, report, minimum cases per mode, acceptance areas, runtime-package capable.
# Feature suites remain owned by A1-C3; C4 requires their complete integrated run.
SUITES = [
    ('diagnostic_startup', 'diagnostic-startup-report.json', 16, [1, 2, 3, 5, 10, 11], True),
    ('diagnostic_export', 'diagnostic-export.json', 9, [6, 8, 10, 11], False),
    ('incident_notifications', 'incident-notifications-report.json', 21, [5, 8, 10, 11], False),
    ('diagnostic_settings', 'diagnostic-settings-results.json', 21, [9, 10, 11], True),
    ('operation_diagnostics', 'operation-diagnostics.json', 25, [3, 4, 8, 12], False),
    ('diagnostic_channel', 'diagnostic-channel-report.json', 10, [6, 7, 9, 11], False),
    ('reading_diagnostics', 'reading-diagnostics-report.json', 16, [1, 2, 3, 4, 6, 8, 12], True),
    ('listening_diagnostics', 'listening-diagnostics-report.json', 13, [1, 2, 4, 6, 8, 10, 12], True),
    ('diagnostic_acceptance', 'diagnostic-acceptance-report.json', 8, [2, 3, 5, 8, 9, 10, 11, 12], True),
]
LIMITATIONS = ['javascript-disabled', 'page-not-opened', 'process-crash', 'blocked-main-thread',
              'cross-origin-details', 'uninstrumented-or-inaccessible-pages', 'late-injection-earlier-errors',
              'legacy-child-draft-recovery', 'different-origin-or-unavailable-storage-coordination',
              'chromium-only-automated-browser-evidence']


def evidence_rows(payload, minimum: int, partial: bool = False, script: str | None = None) -> list[dict]:
    """Fail closed on partial/duplicate/unknown output; never retain error payloads."""
    rows = payload if isinstance(payload, list) else payload.get('results', payload.get('cases', []))
    if not isinstance(rows, list) or (not rows and not partial):
        raise ValueError('missing scenario evidence')
    evidence, identities = [], set()
    for row in rows:
        mode, scenario = row.get('mode'), row.get('scenario', row.get('fault'))
        if mode not in MODES or not isinstance(scenario, str) or not re.fullmatch(r'[a-z0-9-]{1,140}', scenario):
            raise ValueError('invalid scenario identity')
        if (mode, scenario) in identities:
            raise ValueError('duplicate scenario evidence')
        identities.add((mode, scenario))
        failed = row.get('passed') is False or row.get('status') in ('fail', 'failed') or (
            row.get('passed') is not True and row.get('status') != 'pass')
        if failed and not partial:
            raise ValueError('failed scenario')
        item = {'mode': mode, 'scenario': scenario, 'result': 'fail' if failed else 'pass'}
        # Retain a useful assertion location without publishing exception text,
        # absolute paths, fixture values or browser/console arguments.
        if failed and script and isinstance(row.get('error'), str):
            location = re.search(re.escape(script) + r'\.node\.js:(\d{1,5})(?=[:\s)]|$)', row['error'])
            if location:
                item['sourceLine'] = int(location.group(1))
        # Listening submission failures expose only fixed protocol checkpoints.
        # Never copy arbitrary browser state, identifiers or payload fields.
        checkpoint = row.get('submitCheckpoint')
        if failed and script == 'listening_diagnostics' and isinstance(checkpoint, dict):
            safe_checkpoint = {key: checkpoint[key] for key in
                               ('completionReceived', 'ackAttempted', 'nackAttempted')
                               if isinstance(checkpoint.get(key), bool)}
            if safe_checkpoint:
                item['submitCheckpoint'] = safe_checkpoint
        evidence.append(item)
    scenarios = [{row['scenario'] for row in evidence if row['mode'] == mode} for mode in MODES]
    if not partial and (any(len(items) < minimum for items in scenarios) or not all(items == scenarios[0] for items in scenarios)):
        raise ValueError('incomplete three-mode evidence')
    return evidence


def run_suite(suite, destination: Path, runtime: Path) -> dict:
    name, filename, minimum, criteria, packaged = suite
    report_dir = destination / 'raw' if packaged else REPORTS
    report_dir.mkdir(parents=True, exist_ok=True)
    report_file = report_dir / filename
    # A previously successful report cannot qualify a failed or interrupted run.
    report_file.unlink(missing_ok=True)
    env = dict(os.environ, DIAGNOSTIC_RUNTIME_ROOT=str(runtime), DIAGNOSTIC_REPORT_DIR=str(report_dir))
    started = time.monotonic()
    result = {'suite': name, 'acceptanceAreas': criteria, 'status': 'fail', 'cases': [], 'timeoutSeconds': 240}
    print(f'Diagnostics START {name}', flush=True)
    # Browser assertions may contain hostile fixtures. Keep raw output transient;
    # published evidence consists only of the fields validated by evidence_rows.
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(['node', str(ROOT / f'developer/tests/e2e/{name}.node.js')], cwd=ROOT,
                                   env=env, stdout=output, stderr=subprocess.STDOUT,
                                   start_new_session=os.name != 'nt',
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
        try:
            result['exitCode'] = process.wait(timeout=result['timeoutSeconds'])
        except subprocess.TimeoutExpired:
            _terminate_process_tree(process)
            result['exitCode'] = 124
        except BaseException:
            _terminate_process_tree(process)
            raise
    if result['exitCode'] == 0 and report_file.is_file():
        try:
            result['cases'] = evidence_rows(json.loads(report_file.read_text(encoding='utf-8')), minimum)
            result['status'] = 'pass'
        except (ValueError, TypeError, AttributeError):
            result['failure'] = 'invalid-or-incomplete-evidence'
    else:
        result['failure'] = 'timeout' if result['exitCode'] == 124 else 'suite-failed-or-report-missing'
        if report_file.is_file():
            try:
                result['cases'] = evidence_rows(json.loads(report_file.read_text(encoding='utf-8')), 0,
                                              partial=True, script=name)
            except (ValueError, TypeError, AttributeError):
                pass
    result['durationSeconds'] = round(time.monotonic() - started, 3)
    # Do not publish arbitrary browser errors or console arguments in raw reports.
    if report_file.exists():
        report_file.write_text(json.dumps({'results': result['cases']}, indent=2) + '\n', encoding='utf-8')
    (destination / f'{name}.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f"Diagnostics END {name}: {result['status']} ({len(result['cases'])} cases)", flush=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', action='store_true', help='Require an extracted runtime and run package-capable suites')
    args = parser.parse_args()
    if args.release and not os.environ.get('DIAGNOSTIC_RUNTIME_ROOT'):
        parser.error('--release requires DIAGNOSTIC_RUNTIME_ROOT; source fallback is forbidden')
    runtime = Path(os.environ.get('DIAGNOSTIC_RUNTIME_ROOT', ROOT)).resolve()
    destination = Path(os.environ.get('DIAGNOSTIC_EVIDENCE_DIR', REPORTS / 'diagnostics-source')).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--', '.',
                                        ':(exclude).codex-worktree-name'], cwd=ROOT, text=True).strip())
    manifest = json.loads((runtime / 'assets/generated/diagnostics/build-manifest.json').read_text(encoding='utf-8'))
    report = {'schemaVersion': 1, 'status': 'running', 'commit': head, 'workingTreeDirty': dirty, 'buildId': manifest['buildId'],
              'artifact': 'extracted-package' if args.release else 'source-checkout',
              'startedAt': datetime.now(timezone.utc).isoformat(), 'coverageLimitations': LIMITATIONS, 'suites': []}
    target = destination / 'acceptance.json'
    def save():
        target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    save()
    for suite in SUITES:
        if args.release and not suite[4]:
            continue
        try:
            result = run_suite(suite, destination, runtime)
        except Exception:
            result = {'suite': suite[0], 'acceptanceAreas': suite[3], 'status': 'fail', 'cases': [],
                      'failure': 'runner-error'}
        result['artifact'] = f'{suite[0]}.json'
        report['suites'].append(result)
        save()
    report['status'] = 'pass' if all(row['status'] == 'pass' for row in report['suites']) else 'fail'
    if subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() != head:
        report['status'] = 'fail'
        report['failure'] = 'revision-changed-during-run'
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    report['caseCount'] = sum(len(row['cases']) for row in report['suites'])
    report['criteriaCovered'] = sorted({criterion for row in report['suites'] if row['status'] == 'pass'
                                       for criterion in row['acceptanceAreas']})
    # The package pass supplements the full source gate; it does not claim the
    # source-only protocol tests were rerun from an archive without source files.
    if not args.release and report['criteriaCovered'] != list(range(1, 13)):
        report['status'] = 'fail'
    save()
    print(json.dumps({key: report[key] for key in ('status', 'commit', 'buildId', 'caseCount', 'criteriaCovered')}), flush=True)
    return 0 if report['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
