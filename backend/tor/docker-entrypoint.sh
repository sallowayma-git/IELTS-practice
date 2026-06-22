#!/bin/sh
set -eu
set -f
umask 077

TOR_USER="${TOR_USER:-debian-tor}"
TORRC_DIR="/etc/tor/torrc.d"
RUNTIME_DIR="/run/tor"
BRIDGE_INCLUDE_CONFIG="$TORRC_DIR/bridges-runtime.conf"
LEGACY_BRIDGE_CONFIG="$TORRC_DIR/bridges.conf"
BRIDGE_CONFIG="$RUNTIME_DIR/bridges.conf"
VALID_BRIDGES_FILE="$RUNTIME_DIR/bridges.valid"
BRIDGE_SOURCE_FILE="${TOR_BRIDGES_FILE:-/etc/tor/bridges.txt}"
BRIDGE_ENCRYPTED_FILE="${TOR_BRIDGES_ENCRYPTED_FILE:-}"
BRIDGE_AGE_IDENTITY_FILE="${TOR_BRIDGES_AGE_IDENTITY_FILE:-}"
DECRYPTED_BRIDGES_FILE=""
MAX_BRIDGE_LINE_LENGTH=1200

cleanup_bridge_sensitive_files() {
    rm -f "$VALID_BRIDGES_FILE"
    if [ -n "$DECRYPTED_BRIDGES_FILE" ]; then
        rm -f "$DECRYPTED_BRIDGES_FILE"
    fi
}

trap cleanup_bridge_sensitive_files EXIT INT TERM HUP

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

prepare_bridge_source_file() {
    [ -n "$BRIDGE_ENCRYPTED_FILE" ] || return 0

    if [ -z "$BRIDGE_AGE_IDENTITY_FILE" ]; then
        echo "Encrypted Tor bridge file configured without an age identity file" >&2
        exit 1
    fi
    if ! command -v age >/dev/null 2>&1; then
        echo "age is required to decrypt the configured Tor bridge file" >&2
        exit 1
    fi
    if [ ! -r "$BRIDGE_ENCRYPTED_FILE" ]; then
        echo "Configured encrypted Tor bridge file is not readable" >&2
        exit 1
    fi
    if [ ! -r "$BRIDGE_AGE_IDENTITY_FILE" ]; then
        echo "Configured Tor bridge age identity file is not readable" >&2
        exit 1
    fi

    DECRYPTED_BRIDGES_FILE="$RUNTIME_DIR/bridges.decrypted"
    rm -f "$DECRYPTED_BRIDGES_FILE"
    if ! age --decrypt --identity "$BRIDGE_AGE_IDENTITY_FILE" --output "$DECRYPTED_BRIDGES_FILE" "$BRIDGE_ENCRYPTED_FILE" >/dev/null 2>&1; then
        rm -f "$DECRYPTED_BRIDGES_FILE"
        echo "Failed to decrypt the configured Tor bridge file" >&2
        exit 1
    fi
    chmod 600 "$DECRYPTED_BRIDGES_FILE"
    BRIDGE_SOURCE_FILE="$DECRYPTED_BRIDGES_FILE"
}

mkdir -p "$TORRC_DIR" "$RUNTIME_DIR"
chown root:"$TOR_USER" "$TORRC_DIR" "$RUNTIME_DIR" 2>/dev/null || true
chmod 750 "$TORRC_DIR" "$RUNTIME_DIR"
rm -f "$BRIDGE_INCLUDE_CONFIG" "$LEGACY_BRIDGE_CONFIG" "$VALID_BRIDGES_FILE" "$BRIDGE_CONFIG"

prepare_bridge_source_file

if [ -f "$BRIDGE_SOURCE_FILE" ]; then
    {
        while IFS= read -r bridge; do
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
        done < "$BRIDGE_SOURCE_FILE" | awk '!seen[$0]++'
    } > "$VALID_BRIDGES_FILE"
    chmod 600 "$VALID_BRIDGES_FILE"

    if [ -s "$VALID_BRIDGES_FILE" ]; then
        {
            echo "UseBridges 1"
            echo "ClientTransportPlugin obfs4 exec /usr/bin/obfs4proxy"
            cat "$VALID_BRIDGES_FILE"
        } > "$BRIDGE_CONFIG"
        chown "$TOR_USER:$TOR_USER" "$BRIDGE_CONFIG" 2>/dev/null || true
        chmod 600 "$BRIDGE_CONFIG"
        printf '%%include %s\n' "$BRIDGE_CONFIG" > "$BRIDGE_INCLUDE_CONFIG"
        chown "$TOR_USER:$TOR_USER" "$BRIDGE_INCLUDE_CONFIG" 2>/dev/null || true
        chmod 600 "$BRIDGE_INCLUDE_CONFIG"
    fi
fi
cleanup_bridge_sensitive_files

mkdir -p /var/lib/tor/hidden_service
chown -R "$TOR_USER:$TOR_USER" /var/lib/tor
chmod 700 /var/lib/tor/hidden_service

trap - EXIT INT TERM HUP
exec "$@"
