# Issue #172 validation

The results below describe the initial implementation at `7bdf6c08713dfb0f641b870372350cee26f73a14`.
The subsequent signing/identity repair is described in [signing-boundary.md](signing-boundary.md):
release sidecars are signed before their identity is embedded, and a mandatory
gate verifies the final host/sidecar pair before publication. Historical results
below do not constitute validation of that repair.

[signing-fix-validation.json](signing-fix-validation.json) records the repair's
tested code blobs: 45 release checks, the required static 28/28 then native
16/16 regression sequence, fresh Windows freeze/smoke, rebuilt unsigned MSI/NSIS
payload checks, and actual-host rejection of changed, mismatched, or missing
sidecars. Production signing and native macOS acceptance remain pending.

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

- Windows production signing and updater verification remain pending; see [signing-boundary.md](signing-boundary.md) for the repair and final-artifact gate. No production-signed artifact is covered by the historical results above.
- macOS ARM64 and Linux x86_64 native freeze, smoke, packaging, and release verification remain pending.
- The separate visual-regression gate is tracked in [#175](https://github.com/sallowayma-git/IELTS-practice/issues/175).

Keep [#172](https://github.com/sallowayma-git/IELTS-practice/issues/172) and parent [#169](https://github.com/sallowayma-git/IELTS-practice/issues/169) open until their complete acceptance evidence is available. Existing signing, updater, bundle, visual, and publish gates are preserved.
