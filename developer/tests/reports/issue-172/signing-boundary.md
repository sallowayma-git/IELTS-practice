# Issue #172: signing and sidecar identity

The initial implementation prepared unsigned sidecars, then compiled the host
with their complete SHA-256. Windows/macOS bundling subsequently changed their
bytes while signing, so the installed host would reject its sidecar with
`BuildIdentityMismatch`. Although the underlying identity contract predated
#177, enabling this release path made the incompatibility a blocking integration
issue. A documentation-only acceptance caveat did not prevent publication.

## Repair

Release jobs import their platform certificate before invoking the sidecar
builder with `--sign`. The builder publishes the manifest only after signing,
signature verification, and the existing native smoke succeed.
The packaging action explicitly uses the installed, pinned Tauri CLI rather
than automatically downloading a floating major-version CLI.

- Windows signs the staged executable using the configured Authenticode
  certificate and timestamp service. Tauri skips an already validly signed
  external binary, preserving the bytes whose hash is embedded in the host.
  [Tauri CLI 2.11.4 Windows bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs#L280-L312).
- macOS passes the Developer ID signing identity to PyInstaller so both the
  embedded libraries and the final onefile executable are signed. Signing only
  the outer executable would not satisfy hardened-runtime library validation.
  The release overlay copies that executable to `Contents/MacOS` using
  `bundle.macOS.files`, instead of submitting it to Tauri's external-binary
  signing pass again. Tauri still signs and notarizes the enclosing application.
  [Tauri CLI 2.11.4 copy/sign ordering](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/app.rs#L91-L121).
- Linux and ordinary unsigned development builds retain the existing preparation
  path. The base `externalBin` configuration and runtime whole-file SHA-256
  enforcement remain unchanged.

## Mandatory final-artifact gate

After bundling, `verify_packaged_sidecar.py` checks both Windows installer
payloads (MSI administrative extraction and NSIS extraction) or the final signed
macOS `.app`. It runs the extracted/final host with `--verify-sidecar`, which
uses the same compiled identity and verification function as normal sidecar
startup, without initializing the GUI or user database. It then smokes that
exact sibling sidecar, with an independent report for each artifact.

Missing or ambiguous artifacts, mismatched bytes, diagnostic failure, startup
failure, and timeout all fail the consuming release job. `publish-release`
continues to depend on successful completion of the complete release matrix.
This gate also detects a future bundler change that re-signs the prepared file.

## Evidence boundary

`validation.json` remains the historical unsigned-Windows evidence for the
initial implementation. It does not validate this repair or a production-signed
release. Fresh repair validation is recorded in
[signing-fix-validation.json](signing-fix-validation.json). Production certificate
use, native macOS packaging/notarization, signed installed behavior, updater
verification, and a complete tag workflow still require their actual platform
evidence before #172 and #169 can close. The separate visual gate remains #175.
