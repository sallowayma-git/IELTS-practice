# Issue #173: fresh-clone and source-ZIP setup evidence

The documented Windows setup passed from both independently downloaded source
paths at signed commit
[`a27a706d2ebc9293cafc98d8b78bc87232e4ec22`](https://github.com/sallowayma-git/IELTS-practice/commit/a27a706d2ebc9293cafc98d8b78bc87232e4ec22).
GitHub verifies that commit's signature. It changes only the README, release
runbook, and static-gate instructions on top of integrated base
`7ab167472aefca02d2b53bdfcd66bd5649b53626`.

[Structured validation](validation.json) records the source revision, documentation
blobs, commands, timestamps, successful exit codes, source acquisition, initial
states, native targets, executable hashes, and complete sidecar smoke metrics.
This evidence commit adds reports; the tested setup instructions and production
inputs remain unchanged.

## Independent source preparation

- **Fresh clone:** cloned the issue branch directly from GitHub over HTTPS with
  `--depth 1 --single-branch`, verified HEAD as the signed commit above, and
  confirmed an initially clean Git status.
- **GitHub source ZIP:** downloaded the immutable
  [commit archive](https://github.com/sallowayma-git/IELTS-practice/archive/a27a706d2ebc9293cafc98d8b78bc87232e4ec22.zip).
  All **1,396 files** matched the corresponding Git blob byte for byte before
  preparation. Only the archive's outer directory was removed during extraction.
  The extracted source had no `.git`; Git discovery was prevented from borrowing
  metadata from the enclosing validation workspace.
- Both directories initially lacked a sidecar executable, `target/`, `dist/`,
  frontend `node_modules`, and a Python virtual environment. The tracked Windows
  manifest was present; each successful freeze replaced it with the newly built
  executable's SHA-256.

Archive SHA-256:
`0555387e8f7df75e2c1400e33c0222313359474b2ac9ec659de4450135925c24`
(10,151,521 bytes).

Each path used its own Python 3.12 virtual environment, frontend dependency
installation, pinned Tauri CLI installation, native freeze, and native compilation
output. The installed native toolchain and Cargo download/registry cache were
available. No sidecar, frontend distribution, or compiled target was copied
between checkouts. Command durations describe successful invocations, not
cold-build performance benchmarks; intermediates remained in their respective
source directories.

## Commands and native results

The common preparation and build commands are those in the [README](../../../../README.md):

```text
python -m venv .tmp/venv
npm --prefix apps/writing-vue ci --no-fund --no-audit
npm install --global @tauri-apps/cli@2.11.4 --no-fund --no-audit
python -m pip install --disable-pip-version-check -r agent-runtime-python/requirements-build.lock -r agent-runtime-python/requirements.lock
python developer/tests/ci/build_agent_runtime_sidecar.py
tauri build --ci --no-bundle
```

The README's PowerShell environment selection was applied after venv creation.
Tool installation prefixes/caches were placed inside the validation workspace.
Both `pip check` runs passed, with no editable runtime-package installation or
source-path injection. The builder selected `x86_64-pc-windows-msvc` from the
native host. Dependency locks, Tauri build configuration, preparation/smoke
scripts, workflow inputs, and documented commands were checked against the
tested commit after execution.

| Check | Fresh clone | GitHub source ZIP |
| --- | --- | --- |
| Native freeze and full six-capability smoke | Passed on first freeze | Passed on first freeze |
| Windows cold start (unchanged 1,500 ms limit) | 985.035 ms | 697.204 ms |
| All size, process-tree RSS, and cold-start thresholds | Passed | Passed |
| Executable / published manifest SHA-256 | Matched | Matched |
| `tauri build --ci --no-bundle` | Passed | Passed |
| Release host `--verify-sidecar` | Passed | Passed |
| Release reading resources, exact SHA-256 bytes | 225/225 | 225/225 |

The host verification was invoked through Python `subprocess.run(..., check=True,
timeout=30)` to wait for the Windows GUI-subsystem executable and check its actual
exit code. `verify_reading_resources.py target/release/reading` checked the
resources copied into each release output. The built sidecar in each release
directory also matched that source's published manifest.

| Artifact SHA-256 | Fresh clone | GitHub source ZIP |
| --- | --- | --- |
| Sidecar | `4e575ba0f7f038edfb2559857327a0c5d60e3ec4434cc93da1a7041848341a20` | `7101fcaa5b4b4a0c56a4f49952477009204223820b932d7d7f640a1af4b3835d` |
| Release host | `5dc4b29f5b0224ce99a849eb1a969c098391e195e279fb299e0a629e4a5e5f88` | `e4488b0e6da78fc981d1f09e82960eaccc71fe075aaf13eb7459a44c7d3c074e` |

Environment: Windows 11 x64 (10.0.22631), Python 3.12.14, Rust 1.98.1,
Node.js 24.19.0, npm 10.8.2, Tauri CLI 2.11.4, Tauri driver 2.0.6,
WebView2/EdgeDriver 143.0.3650.96. The driver preparation script downloaded the
exact matching EdgeDriver and verified its Authenticode signature.

## Repository regressions

These commands ran in the original task workspace at the same signed commit,
using its existing compilation cache and verified matching sidecar/manifest.
They are separate from the two independent source builds above.

```text
npm --prefix apps/writing-vue run build
cargo check --workspace --locked
cargo test --workspace --locked
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

- Workspace check passed; workspace tests passed **507 tests across 52 suite
  results**, with **0 failed and 0 ignored**.
- The [static report](static-ci-report.json) passed **29/29** checks.
- The [native practice report](native-practice-report.json) passed **16/16** checks.
  Its recorded binary SHA-256 is the fresh-clone release host above. The gate
  used the verified matching drivers and explicitly selected that new host via
  `TAURI_APP_BINARY`.
- The static command completed before the native command began; the exact command timestamps are retained
  in `validation.json`. Git metadata recorded the tested commit and a clean task
  workspace when the native gate ran.

## Platform and integration boundary

This report establishes **Windows x64** fresh-clone/source-ZIP native freeze,
smoke, and release-executable build reproduction. The local build mode was
`--no-bundle`. macOS ARM64 and Linux x64 are documented native preparation paths;
their independent platform packaging evidence belongs to
[#172](https://github.com/sallowayma-git/IELTS-practice/issues/172):

- [Native acceptance run](https://github.com/sallowayma-git/IELTS-practice/actions/runs/34624179018):
  all three platform jobs and the required regression sequence passed.
- [Actual release shipping/workspace run](https://github.com/sallowayma-git/IELTS-practice/actions/runs/34624175205):
  both gates passed; production signing and publication jobs were skipped.
- Those runs tested `86ee69206633aac6e1ea3920e633e08da0a1cbb8`. Its tree
  `eec663eb30f7b5ea97373caaaebdfe28cfbabcc2` exactly matches integrated base
  `7ab167472aefca02d2b53bdfcd66bd5649b53626` from
  [PR #182](https://github.com/sallowayma-git/IELTS-practice/pull/182).

The setup agrees with the capability repair in
[#174](https://github.com/sallowayma-git/IELTS-practice/pull/174), CI preparation in
[#176](https://github.com/sallowayma-git/IELTS-practice/pull/176), and release
preparation/integrity follow-ups in
[#177](https://github.com/sallowayma-git/IELTS-practice/pull/177),
[#179](https://github.com/sallowayma-git/IELTS-practice/pull/179), and #182.
Parent [#169](https://github.com/sallowayma-git/IELTS-practice/issues/169) retains
the combined acceptance gate. These local results do not assert production
signing, notarization, or installed updater acceptance.
