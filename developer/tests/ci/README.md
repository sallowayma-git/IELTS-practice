# Static CI entrypoint

This directory contains tooling that emulates the minimum CI checks for the
IELTS practice application.  The current focus is validating the static test
harness before running heavier manual validation.

## Usage

```bash
python developer/tests/ci/run_static_suite.py
```

The script generates `developer/tests/e2e/reports/static-ci-report.json` with a
machine-readable summary that can be uploaded by future CI/CD jobs.

Diagnostics integration is part of `python developer/tests/e2e/e2e_runner.py`.
Run `python developer/tests/e2e/diagnostic_qualification.py` for the focused
three-mode matrix. `qualify_reading_release.py` now qualifies reading and
diagnostics from a freshly extracted runtime on both Windows and Linux CI.
See [the acceptance matrix and evidence contract](../../docs/diagnostic-acceptance.md).
