#!/bin/sh
set -eu

TOR_USER="${TOR_USER:-debian-tor}"
TORRC_DIR="/etc/tor/torrc.d"
BRIDGE_CONFIG="$TORRC_DIR/bridges.conf"
BRIDGE_SOURCE_FILE="${TOR_BRIDGES_FILE:-/etc/tor/bridges.txt}"

mkdir -p "$TORRC_DIR"
rm -f "$BRIDGE_CONFIG"

if [ -f "$BRIDGE_SOURCE_FILE" ] || [ -n "${TOR_BRIDGES:-}" ]; then
    {
        echo "UseBridges 1"
        echo "ClientTransportPlugin obfs4 exec /usr/bin/obfs4proxy"
        {
            [ -f "$BRIDGE_SOURCE_FILE" ] && cat "$BRIDGE_SOURCE_FILE"
            [ -n "${TOR_BRIDGES:-}" ] && printf '%s\n' "$TOR_BRIDGES"
        } | while IFS= read -r bridge; do
            bridge=$(printf '%s' "$bridge" | sed 's/#.*$//;s/^[[:space:]]*//;s/[[:space:]]*$//')
            [ -z "$bridge" ] && continue
            case "$bridge" in
                Bridge\ *) printf '%s\n' "$bridge" ;;
                obfs4:obfs4\ *) printf 'Bridge %s\n' "${bridge#obfs4:}" ;;
                obfs4://obfs4\ *) printf 'Bridge %s\n' "${bridge#obfs4://}" ;;
                *) printf 'Bridge %s\n' "$bridge" ;;
            esac
        done | awk '!seen[$0]++'
    } > "$BRIDGE_CONFIG"
fi

mkdir -p /var/lib/tor/hidden_service
chown -R "$TOR_USER:$TOR_USER" /var/lib/tor
chmod 700 /var/lib/tor/hidden_service

exec "$@"
