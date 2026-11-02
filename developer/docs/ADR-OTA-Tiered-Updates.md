# ADR: Tiered OTA updates with mirror fallback

Status: accepted (2026-11-01)

## Decision

One signed channel manifest (`ota.json`) drives three update tiers. Every
download source is untrusted transport; the only trust root is the Tauri
updater public key compiled into the app.

| Tier | What changes | How it is applied | Restart |
|------|--------------|-------------------|---------|
| Content | Reading pack, writing topics | `.tar.gz` pack → app data → re-indexed into SQLite | No |
| App (OTA) | Rust core, Vue frontend, Python sidecar | Tauri updater, signed installer, passive install | Yes |
| Reinstall | Anything an in-place installer cannot migrate | Dialog links to download pages | Reinstall |

Rust is compiled into the executable, so "module" OTA is the Tauri updater
replacing the whole signed build (tens of MB) rather than hot-swapping
dynamic libraries: no ABI contract, no extra code-signing surface, no
antivirus heuristics on freshly written DLLs.

## Channel layout

The channel is the GitHub prerelease `ota-stable` (a prerelease never becomes
"latest", so `releases/latest/download/latest.json` keeps working):

```
ota.json, ota.json.sig       signed with `tauri signer sign`
latest.json                  Tauri updater manifest of the newest release
content-<id>-<version>.tar.gz
```

`ota.json` fields: `app.version`, `app.minOtaVersion` (older installs must
reinstall), `app.minSupportedVersion` (older installs are told the update is
required), `app.installerSignatures[]`, `app.notes`, `app.downloadPages[]`,
`content[]` (`id`, `version`, `minAppVersion`, `file`, `sha256`, `size`).
Unknown fields are ignored. Application releases copy installer signatures
from the verified `latest.json` into the signed policy. Before installation
the client refreshes that policy and requires both the selected version and
installer signature to match; absent policy/signatures fail closed.

Pack versions are UTC `YYYYMMDDHHMM`. Release builds stamp the bundled packs'
`ota-pack.json` with the release commit time, so content bundled in a newer
app always beats an older download. Versions only move forward: replaying an
old signed manifest cannot roll content back.

## Sources and mainland China

`src-tauri/ota/sources.json` lists URL templates: `{file}` for a mirror that
hosts files under their bare names, `{url}` for a proxy that wraps the GitHub
URL. The client probes every source for `ota.json` in parallel, keeps the
newest valid manifest (waiting 1.5 s after the first answer so a stale mirror
cannot hide a release), and downloads from the fastest source first, falling
back down the list. Self-hosters can drop an override at
`<app data>/ota/sources.json`.

Recommended mainland mirror: an S3-compatible bucket (Tencent COS, Aliyun OSS)
behind a CDN domain. Configure once:

| Kind | Name | Example |
|------|------|---------|
| variable | `OTA_MIRROR_TEMPLATE` | `https://ota.example.cn/stable/{file}` (baked into release builds) |
| variable | `OTA_MIRROR_BUCKET` | `ielts-ota-1250000000` |
| variable | `OTA_MIRROR_PREFIX` | `stable` |
| variable | `OTA_MIRROR_ENDPOINT` | `https://cos.ap-shanghai.myqcloud.com` |
| variable | `OTA_MIRROR_REGION` | `ap-shanghai` |
| secret | `OTA_MIRROR_ACCESS_KEY_ID` / `OTA_MIRROR_SECRET_ACCESS_KEY` | bucket write key |

Without the mirror variables the channel still works through GitHub and the
public GitHub proxies in the bundled list.

## Runbooks

- **Publish question updates:** edit the packs under `assets/`, merge, then run
  the *OTA content* workflow with the slots to publish. Reading packs must keep
  every existing exam (history rows point at them); the tool and the client
  both refuse a pack that drops one.
- **Ship an app release:** tag `vX.Y.Z` as before. `publish-release` now also
  signs and uploads `ota.json` + `latest.json` to the channel and mirrors the
  installers.
- **Force a reinstall:** before tagging, raise `minOtaVersion` in
  `src-tauri/ota/release-policy.json` to the new version (installs below it see
  the reinstall dialog). Raise `minSupportedVersion` to mark the update as
  required.

## Failure behaviour

- No updater key (dev builds): every tier reports "unconfigured".
- All sources down: the dialog shows each source's error; nothing changes.
- A pack fails its hash, marker or import: the previous pack stays active and
  the version directory is discarded.
- A downloaded pack fails at startup: it is deactivated and the bundled pack
  seeded instead. Only a broken bundled pack is fatal, as before.
