#!/usr/bin/env bash
# OTA channel release helper (GitHub prerelease `ota-stable` + optional mirror).
#
#   ensure                 create the channel release if missing
#   publish FILE...        upload FILEs, then dist/ota/ota.json(.sig) last, to
#                          GitHub and, when OTA_MIRROR_BUCKET is set, to an
#                          S3-compatible mirror (Tencent COS, Aliyun OSS, R2...)
#   mirror FILE...         upload FILEs to the mirror only (release installers;
#                          GitHub already hosts them in the versioned release)
#
# The channel is a prerelease so it never becomes "latest" and never shadows
# releases/latest/download/latest.json.
set -euo pipefail

TAG="${OTA_TAG:-ota-stable}"
OUT="${OTA_OUT:-dist/ota}"

ensure() {
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    gh release create "$TAG" --prerelease --latest=false \
      --title "OTA channel (stable)" \
      --notes "Signed OTA channel: ota.json, content packs and the updater manifest. Managed by CI; do not edit by hand."
  fi
}

mirror_upload() {
  local file="$1"
  [ -n "${OTA_MIRROR_BUCKET:-}" ] || return 0
  local prefix="${OTA_MIRROR_PREFIX:-stable}"
  local endpoint=()
  [ -n "${OTA_MIRROR_ENDPOINT:-}" ] && endpoint=(--endpoint-url "$OTA_MIRROR_ENDPOINT")
  aws s3 cp "$file" "s3://$OTA_MIRROR_BUCKET/$prefix/$(basename "$file")" "${endpoint[@]}" --only-show-errors
}

publish() {
  ensure
  # Payloads first, manifest last: a manifest never names a missing file.
  for file in "$@"; do
    gh release upload "$TAG" "$file" --clobber
    mirror_upload "$file"
  done
  for file in "$OUT/ota.json.sig" "$OUT/ota.json"; do
    [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
    mirror_upload "$file"
  done
  gh release upload "$TAG" "$OUT/ota.json.sig" "$OUT/ota.json" --clobber
}

case "${1:-}" in
  ensure) ensure ;;
  publish) shift; publish "$@" ;;
  mirror) shift; for file in "$@"; do mirror_upload "$file"; done ;;
  *) echo "usage: $0 ensure|publish FILE...|mirror FILE..." >&2; exit 2 ;;
esac
