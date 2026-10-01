# Phase 10 Tauri Release Runbook

The shipping product is the Tauri 2 application. Electron, Fastify, and the root
`file://` host are not release inputs.

## Required repository secrets

- `TAURI_SIGNING_PRIVATE_KEY`: Tauri updater signing private key or key path.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password for the private key.
- `TAURI_UPDATER_PUBKEY`: the matching encoded public key embedded in release builds.
- `WINDOWS_CERTIFICATE`: base64 PKCS#12 Authenticode certificate.
- `WINDOWS_CERTIFICATE_PASSWORD`: PKCS#12 password.
- `WINDOWS_CERTIFICATE_THUMBPRINT`: 40-character SHA-1 certificate thumbprint.
- `APPLE_CERTIFICATE`: base64 Developer ID Application PKCS#12 certificate.
- `APPLE_CERTIFICATE_PASSWORD`: PKCS#12 password.
- `APPLE_SIGNING_IDENTITY`: Developer ID Application identity.
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`: notarization credentials.

Optional repository variable:

- `TAURI_UPDATE_ENDPOINT`: HTTPS URL for `latest.json`. When unset, releases use
  `https://github.com/sallowayma-git/IELTS-practice/releases/latest/download/latest.json`.
- `WINDOWS_TIMESTAMP_URL`: HTTPS Authenticode timestamp service. This variable is
  required for Windows releases.

The private key must never be committed. A release fails before build if the private
key or updater public key is missing. Development builds remain explicitly
unconfigured and cannot download updates.

## Local sidecar and gate prerequisites

For a clean clone or GitHub source ZIP, complete the [README setup](../../README.md#开发前置)
first: native system dependencies, Rust stable, Node/npm, the pinned Tauri CLI,
and an isolated Python 3.12 environment of the matching native architecture.
Run all commands from the repository root, using that same Python environment.

```text
npm --prefix apps/writing-vue ci --no-fund --no-audit
npm install --global @tauri-apps/cli@2.11.4 --no-fund --no-audit
python -m pip install --disable-pip-version-check -r agent-runtime-python/requirements-build.lock -r agent-runtime-python/requirements.lock
python developer/tests/ci/build_agent_runtime_sidecar.py --target <host-target>
```

Replace `<host-target>` with the matching row below. Omitting `--target` detects
the supported host automatically; it does not default every platform to Windows.
Cross-platform freezing is rejected, including running an x64 Python interpreter
for the macOS ARM64 target.

| Native host | Python architecture | Sidecar and Rust target | Production sidecar option |
| --- | --- | --- | --- |
| Windows x64 | x64 | `x86_64-pc-windows-msvc` | `--sign` |
| macOS Apple Silicon | arm64 | `aarch64-apple-darwin` | `--sign` |
| Linux x64 (release runner: Ubuntu 22.04) | x64 | `x86_64-unknown-linux-gnu` | none |

The builder freezes and smokes the native executable before publishing
`src-tauri/binaries/ielts-agent-runtime-<host-target>[.exe]` and
`ielts-agent-runtime-<host-target>.sha256`. Keep the pair together. An existing
manifest alone is not a prepared sidecar. Tauri's `build.rs` must continue to
verify the executable's SHA-256 against the manifest. Rebuild after runtime or
lock-file changes; never patch the manifest to bypass a failed build or smoke.
The current independent smoke contract does not import the source package, so
no editable package installation or `PYTHONPATH` override is required.

For local validation, omit `--sign`, then run `tauri build --ci --no-bundle`.
For workspace tests, generate the frontend with
`npm --prefix apps/writing-vue run build` before `cargo test --workspace --locked`.
Sidecar preparation precedes every Tauri dev/build, workspace compilation, and
static suite that compiles Tauri. The [Windows regression instructions](../../README.md#windows-必需回归)
also install `tauri-driver` 2.0.6, download the matching EdgeDriver, and set the
explicit freshly built host path before the required static-then-native sequence.
Those local gates currently require Windows; native macOS/Linux packaging uses
the platform jobs below.

Each consuming CI/release job prepares its own sidecar: `tauri-ci.yml` static and
workspace jobs, `release.yml` shipping and workspace jobs, and each native release
matrix job. Job `needs` dependencies do not transfer files. A transferred artifact
would still need the matching platform/architecture, executable, and manifest.
Production Windows/macOS jobs import their certificates first and pass `--sign`:
the builder signs and verifies the staged bytes before hashing and smoking them.
Linux produces its native executable and manifest without that option. Existing
host signing, notarization, bundle, and updater verification remain required.

The release sibling [#172 acceptance](https://github.com/sallowayma-git/IELTS-practice/issues/172)
links the [three-platform native run](https://github.com/sallowayma-git/IELTS-practice/actions/runs/34624179018)
and the [actual release shipping/workspace gates](https://github.com/sallowayma-git/IELTS-practice/actions/runs/34624175205),
tested at `86ee69206633aac6e1ea3920e633e08da0a1cbb8` and integrated with the identical
tree at `7ab167472aefca02d2b53bdfcd66bd5649b53626`. These are unsigned development
acceptance results. A local Windows reproduction does not establish macOS/Linux
reproduction or production release readiness.

## Release

Before creating a version tag, run the complete release gates on the candidate
branch:

```powershell
gh workflow run release.yml --ref <candidate-branch>
```

A manual run executes the same `shipping-gate` and `rust-test` jobs as a tag
release. Both jobs prepare a fresh Windows sidecar in their own workspace before
Tauri compilation. The shipping job runs the static suite, shared visual assertion
tests, all 17 visual scripts, and the packaged native practice flow; the workspace
job then runs the complete Rust test suite. Reports, screenshots, native driver
diagnostics, the tested host, and its matching sidecar are uploaded as evidence.

Manual runs have read-only repository permissions and skip the complete signing,
release attachment, and publication jobs, including when dispatched on a tag.
Only a `v*` tag push can enter those jobs. Passing a manual run establishes the
shipping and workspace gates; production signatures, notarization, signed bundle
and updater verification, and installed update/restart acceptance still require
their actual release evidence.

1. Set the same semantic version in `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `apps/writing-vue/package.json`.
2. Complete the local sidecar, release host build, and Windows driver preparation
   above, then run the required gates in order:

   ```powershell
   python developer/tests/ci/run_static_suite.py
   python developer/tests/e2e/suite_practice_flow.py
   ```

3. Push an annotated `vX.Y.Z` tag. The tag must match all three shipping versions.
4. The release workflow builds Windows, macOS arm64, and Linux bundles. Each job
   first freezes its matching native sidecar and manifest, then verifies an
   installable package and every updater artifact's matching `.sig`
   before it can complete. With `createUpdaterArtifacts: true`, Tauri 2 signs the
   Windows `.exe`/`.msi` and Linux `.AppImage`/`.deb`/`.rpm` files directly;
   macOS uses `.app.tar.gz`. Windows/Linux v1-compatible wrappers are not release
   inputs. The pinned [Tauri CLI signing implementation](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/bundle.rs)
   defines these artifacts.
5. Windows additionally passes `signtool verify`; macOS passes strict `codesign`
   verification and Gatekeeper `spctl` assessment after notarization.
6. The release remains draft until `latest.json` contains signed HTTPS entries for
   Windows, Linux, and macOS. Only then does the workflow publish it.

## Install and restart

The Settings update dialog calls Rust commands only. Rust checks the configured
endpoint, downloads the archive, verifies its signature, installs it, and marks the
current process as restart-ready. The restart command rejects calls unless install
completed successfully in that process. A failed download, signature check, or
install leaves the current installation running.

## Rollback

Do not enable arbitrary updater downgrades. That turns an old signed artifact into a
replay attack.

Rollback is a forward release of stable code:

1. Branch from the last known-good source commit or revert the faulty changes.
2. Increment to a version higher than the faulty release in all three shipping
   version files.
3. Run both shipping gates and publish the new signed tag normally.
4. Keep the faulty GitHub release available for audit, but remove it from the active
   update channel only after the forward rollback release is published.

Clients on the faulty version receive the stable code as a normal monotonic update;
signature verification and updater anti-downgrade protection remain intact.
