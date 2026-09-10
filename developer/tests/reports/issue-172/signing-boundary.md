# Issue #172: signing and sidecar identity boundary

This note records a source-level acceptance limitation. It is not a fix or a
signed-release verification result.

## Evidence

- `developer/tests/ci/build_agent_runtime_sidecar.py:90` hashes the frozen sidecar;
  the builder runs its smoke check before writing the SHA-256 manifest at line 114.
- `src-tauri/build.rs:35` verifies those complete file bytes, then embeds that
  identity into the host at line 41. `src-tauri/src/cognitive_runtime.rs:2339`
  hashes the installed sidecar's complete file bytes and rejects a mismatch with
  `BuildIdentityMismatch`.
- In Tauri CLI v2.11.4, Windows bundling signs an unsigned external binary in place
  after host compilation. Already validly signed sidecars are skipped.
  [Official Windows bundler source, lines 280-312](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs#L280-L312).
  The default signing command invokes SignTool on that file.
  [Official signing implementation, lines 148-170](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/sign.rs#L148-L170).
- On macOS, the same version copies external binaries into the application bundle,
  adds them to its signing targets, and signs them before the application bundle.
  [Official macOS bundler source, lines 91-121](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/app.rs#L91-L121).
- Local observation on 2026-09-10: `Get-AuthenticodeSignature` reported `NotSigned`
  for `src-tauri/binaries/ielts-agent-runtime-x86_64-pc-windows-msvc.exe` after the
  native freeze.

## Interpretation and scope

Signing changes the file bytes after the host has embedded their earlier digest.
The source-level consequence is a mismatch when the installed signed sidecar is
validated. No production-signed artifact was built or launched to reproduce this
interaction; the local unsigned Windows packaging checks do not cover it.

The sidecar builder, `src-tauri/build.rs`, runtime hash verification, base Tauri
configuration, and release signing-overlay generator were unchanged from
`IELTS-WRITING-FEAT@7cea156319d20ed2f780bfa228686e427cbac8fd` during this review
(`git diff --exit-code` against that revision for those paths returned zero).
The #172 workflow patch preserves existing signing gates. This interaction is an
existing signing/identity contract defect exposed by restoring release preparation,
not a newly introduced hash-validation regression. Signed Windows and macOS
acceptance remains unverified and requires separate validation.
