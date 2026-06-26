#!/bin/sh
set -eu

TOR_USER="${TOR_USER:-debian-tor}"
BASE_TORRC="/etc/tor/torrc"
BRIDGES_FILE="/etc/tor/webtunnel.local.txt"
RUNTIME_TORRC="/run/tor/business-torrc"

umask 077
mkdir -p /run/tor /var/lib/tor /var/lib/tor/hidden_service
chmod 700 /run/tor /var/lib/tor /var/lib/tor/hidden_service

if id "$TOR_USER" >/dev/null 2>&1; then
  chown -R "$TOR_USER:$TOR_USER" /run/tor /var/lib/tor
fi

if [ ! -s "$BRIDGES_FILE" ]; then
  echo "WebTunnel bridge file is missing or empty" >&2
  exit 1
fi

if ! command -v lyrebird >/dev/null 2>&1; then
  echo "lyrebird transport binary is missing" >&2
  exit 1
fi

{
  cat "$BASE_TORRC"
  printf '\nUseBridges 1\n'
  printf 'ClientTransportPlugin webtunnel exec /usr/local/bin/lyrebird\n'
  sed '/^[[:space:]]*$/d' "$BRIDGES_FILE" | while IFS= read -r bridge; do
    case "$bridge" in
      Bridge*) printf '%s\n' "$bridge" ;;
      *) printf 'Bridge %s\n' "$bridge" ;;
    esac
  done
} > "$RUNTIME_TORRC"

chmod 600 "$RUNTIME_TORRC"
if id "$TOR_USER" >/dev/null 2>&1; then
  chown "$TOR_USER:$TOR_USER" "$RUNTIME_TORRC"
fi

exec tor -f "$RUNTIME_TORRC"
