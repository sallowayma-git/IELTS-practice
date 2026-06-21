#!/bin/sh
set -eu
set -f

TOR_USER="${TOR_USER:-debian-tor}"
TORRC_DIR="/etc/tor/torrc.d"
BRIDGE_CONFIG="$TORRC_DIR/bridges.conf"
VALID_BRIDGES_FILE="$TORRC_DIR/bridges.valid"
BRIDGE_SOURCE_FILE="${TOR_BRIDGES_FILE:-/etc/tor/bridges.txt}"
MAX_BRIDGE_LINE_LENGTH=1200

is_valid_bridge_endpoint() {
    endpoint="$1"
    printf '%s\n' "$endpoint" | grep -Eq '^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):[0-9]{1,5}$' || return 1
    port="${endpoint##*:}"
    host="${endpoint%:*}"
    [ -n "$host" ] || return 1
    case "$port" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$port" -ge 1 ] 2>/dev/null && [ "$port" -le 65535 ] 2>/dev/null
}

is_valid_obfs4_bridge() {
    bridge="$1"
    [ "${#bridge}" -le "$MAX_BRIDGE_LINE_LENGTH" ] || return 1
    set -- $bridge
    [ "$#" -ge 4 ] || return 1
    [ "$1" = "obfs4" ] || return 1
    is_valid_bridge_endpoint "$2" || return 1
    [ "${#3}" -eq 40 ] || return 1
    case "$3" in
        *[!A-Fa-f0-9]*) return 1 ;;
    esac
    case " $* " in
        *" cert="*) return 0 ;;
        *) return 1 ;;
    esac
}

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

            if is_valid_obfs4_bridge "$bridge"; then
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
