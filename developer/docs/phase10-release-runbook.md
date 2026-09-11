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
2. Run the required gates in order:

   ```powershell
   python developer/tests/ci/run_static_suite.py
   python developer/tests/e2e/suite_practice_flow.py
   ```

3. Push an annotated `vX.Y.Z` tag. The tag must match all three shipping versions.
4. The release workflow builds Windows, macOS arm64, and Linux bundles. Each job
   verifies an installable package and every updater artifact's matching `.sig`
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
