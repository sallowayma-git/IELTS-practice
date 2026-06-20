#!/bin/sh
set -eu

TOR_USER="${TOR_USER:-debian-tor}"
TORRC_DIR="/etc/tor/torrc.d"
BRIDGE_CONFIG="$TORRC_DIR/bridges.conf"
VALID_BRIDGES_FILE="$TORRC_DIR/bridges.valid"
BRIDGE_SOURCE_FILE="${TOR_BRIDGES_FILE:-/etc/tor/bridges.txt}"

mkdir -p "$TORRC_DIR"
rm -f "$BRIDGE_CONFIG" "$VALID_BRIDGES_FILE"

if [ -f "$BRIDGE_SOURCE_FILE" ] || [ -n "${TOR_BRIDGES:-}" ]; then
    {
        {
            [ -f "$BRIDGE_SOURCE_FILE" ] && cat "$BRIDGE_SOURCE_FILE"
            [ -n "${TOR_BRIDGES:-}" ] && printf '%s\n' "$TOR_BRIDGES"
        } | while IFS= read -r bridge; do
            bridge=$(printf '%s' "$bridge" | sed 's/#.*$//;s/^[[:space:]]*//;s/[[:space:]]*$//')
            [ -z "$bridge" ] && continue
            bridge=$(printf '%s' "$bridge" | sed 's/^Bridge[[:space:]][[:space:]]*//')
            case "$bridge" in
                obfs4:obfs4\ *) bridge="${bridge#obfs4:}" ;;
                obfs4://obfs4\ *) bridge="${bridge#obfs4://}" ;;
                obfs4\ *) ;;
                *) continue ;;
            esac

            if printf '%s\n' "$bridge" | grep -Eq '^obfs4[[:space:]]+[^[:space:]]+[[:space:]]+[A-Fa-f0-9]{40}[[:space:]].*cert='; then
                printf 'Bridge %s\n' "$bridge"
            fi
        done | awk '!seen[$0]++'
    } > "$VALID_BRIDGES_FILE"

    if [ -s "$VALID_BRIDGES_FILE" ]; then
        {
            echo "UseBridges 1"
            echo "ClientTransportPlugin obfs4 exec /usr/bin/obfs4proxy"
            cat "$VALID_BRIDGES_FILE"
        } > "$BRIDGE_CONFIG"
    fi
fi
rm -f "$VALID_BRIDGES_FILE"

mkdir -p /var/lib/tor/hidden_service
chown -R "$TOR_USER:$TOR_USER" /var/lib/tor
chmod 700 /var/lib/tor/hidden_service

exec "$@"
