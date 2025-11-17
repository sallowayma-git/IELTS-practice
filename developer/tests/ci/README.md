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
