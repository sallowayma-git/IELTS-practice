# Static CI entrypoint

This directory contains the shipping Tauri 2 static gate and release verification
tools. The static suite also builds Vue, compiles Tauri, and runs Rust/Python tests;
it requires the native sidecar before it starts.

## Usage

On a fresh clone or source ZIP, follow the [README prerequisites](../../../README.md#开发前置)
first: native tools, frontend dependencies, Python 3.12, both Python dependency
locks, and `python developer/tests/ci/build_agent_runtime_sidecar.py`. The builder
must produce the host-matched executable and SHA-256 manifest; a stale manifest
alone is insufficient. No local Python package installation is needed by the
current independent smoke contract.

The suite currently invokes `npm.cmd`, so run it on Windows, from the repository
root and with the prepared Python environment on `PATH`. For the required pair,
also follow the [Windows native-flow preparation](../../../README.md#windows-必需回归)
to build the release host and configure Tauri/Edge drivers before running:

```powershell
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

Keep that order. The scripts generate `static-ci-report.json` and
`suite-practice-flow-report.json` under `developer/tests/e2e/reports/`; native
screenshots are stored alongside them. CI uploads these as validation evidence.
See the [release runbook](../../docs/phase10-release-runbook.md) for per-platform
freeze/packaging preparation and the separate release gates.
