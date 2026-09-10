# Issue #172 validation

The release workflow now prepares a matching native sidecar in each consuming job before Tauri compilation. Each job installs both pinned Python dependency locks, freezes and smokes its own executable, and uploads the resulting manifest and smoke report. The release matrix explicitly binds Windows x86_64, macOS ARM64, and Linux x86_64 targets to their Python architectures.

[validation.json](validation.json) records the signed implementation revision, tested workflow and test-file Git blobs, generated artifact hashes, commands, and gate results. Testing preceded that implementation commit on identical code; this evidence is added in a separate documentation commit.

| Local Windows verification | Result |
| --- | --- |
| Fresh sidecar preparation | Python 3.12 environment with both locks; no pre-existing final executable or manifest. Full rebuild passed all six capability checks and all smoke thresholds. |
| Artifact integrity | Executable, manifest, and smoke report share SHA-256 `455559b812d893494846fa304534fb085ca2bbe4946d9c3d68062c5959adb169`. |
| Required static suite | 28/28 checks, including 429 Python runtime tests and 15 release-contract tests. |
| Windows release packaging | Tauri CLI 2.11.4 generated MSI and NSIS installers; both passed bundle file validation. |
| Required native desktop flow | 16/16 checks against the newly built release executable. This exercises the release application with staged resources; it does not install either installer. |
| Rust workspace | 507 passed, 0 failed, 0 ignored across 52 suite results. |

The required regression commands ran in order: `python developer/tests/ci/run_static_suite.py`, then `python developer/tests/e2e/suite_practice_flow.py`. The release application was built between them to prepare the native flow prerequisite. The full workspace command was `cargo test --workspace --locked`.

Two initial attempts did not pass and remain recorded in the JSON report:

- The first sidecar smoke measured 1,999.962 ms against the existing 1,500 ms cold-start budget. An unchanged full rebuild passed at 1,119.612 ms.
- The first native flow timed out waiting for the workspace label after the folder picker. An unchanged full rerun passed all 16 checks using the same release executable.

No thresholds or flow assertions were changed. The new workflow tests also reject the original release workflow: three missing-preparation failures and one native-matrix failure.

## Release acceptance remains open

These are local unsigned Windows packaging and regression results. They do not claim a passing tag-release workflow, installed/signed release acceptance, or overall CI success.

- Windows operating-system signing and updater verification remain pending. [signing-boundary.md](signing-boundary.md) records a pre-existing signing/sidecar-hash interaction found through source inspection; no production-signed artifact was tested.
- macOS ARM64 and Linux x86_64 native freeze, smoke, packaging, and release verification remain pending.
- The separate visual-regression gate is tracked in [#175](https://github.com/sallowayma-git/IELTS-practice/issues/175).

Keep [#172](https://github.com/sallowayma-git/IELTS-practice/issues/172) and parent [#169](https://github.com/sallowayma-git/IELTS-practice/issues/169) open until their complete acceptance evidence is available. Existing signing, updater, bundle, visual, and publish gates are preserved.
