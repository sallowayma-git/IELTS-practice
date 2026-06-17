#!/bin/sh
set -eu

TOR_USER="${TOR_USER:-debian-tor}"
TORRC_DIR="/etc/tor/torrc.d"
BRIDGE_CONFIG="$TORRC_DIR/bridges.conf"

mkdir -p "$TORRC_DIR"
rm -f "$BRIDGE_CONFIG"

if [ -n "${TOR_BRIDGES:-}" ]; then
    {
        echo "UseBridges 1"
        echo "ClientTransportPlugin obfs4 exec /usr/bin/obfs4proxy"
        printf '%s\n' "$TOR_BRIDGES" | while IFS= read -r bridge; do
            bridge=$(printf '%s' "$bridge" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            [ -z "$bridge" ] && continue
            case "$bridge" in
                Bridge\ *) printf '%s\n' "$bridge" ;;
                obfs4:obfs4\ *) printf 'Bridge %s\n' "${bridge#obfs4:}" ;;
                obfs4://obfs4\ *) printf 'Bridge %s\n' "${bridge#obfs4://}" ;;
                *) printf 'Bridge %s\n' "$bridge" ;;
            esac
        done
    } > "$BRIDGE_CONFIG"
fi

mkdir -p /var/lib/tor/hidden_service
chown -R "$TOR_USER:$TOR_USER" /var/lib/tor
chmod 700 /var/lib/tor/hidden_service

exec "$@"
