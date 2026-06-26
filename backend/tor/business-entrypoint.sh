#!/bin/sh
set -eu

mkdir -p /var/lib/tor/hidden_service /run/tor

tmp=/run/tor/bridges.normalized
conf=/run/tor/business-bridges.conf

awk '
  {
    line=$0
    sub(/#.*/, "", line)
    gsub(/^[ \t]+|[ \t]+$/, "", line)
    if (line == "") next
    sub(/^Bridge[ \t]+/, "", line)
    sub(/^obfs4:obfs4[ \t]+/, "obfs4 ", line)
    sub(/^obfs4:\/\/obfs4[ \t]+/, "obfs4 ", line)
    if (line ~ /^(cert=|iat-mode=)/ && current != "") {
      current=current " " line
      next
    }
    if (current != "") print current
    current=line
  }
  END {
    if (current != "") print current
  }
' /etc/tor/bridges.local.txt > "$tmp"

{
  echo "UseBridges 1"
  echo "ClientTransportPlugin obfs4 exec /usr/bin/obfs4proxy"
  while IFS= read -r bridge; do
    set -- $bridge
    [ "${1:-}" = "obfs4" ] || continue
    printf '%s\n' "${2:-}" | grep -Eq '^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):[0-9]{1,5}$' || continue
    printf '%s\n' "${3:-}" | grep -Eq '^[0-9A-Fa-f]{40}$' || continue
    has_cert=0
    for arg in "$@"; do
      case "$arg" in
        cert=*) has_cert=1 ;;
      esac
    done
    [ "$has_cert" -eq 1 ] || continue
    printf 'Bridge'
    for arg in "$@"; do
      printf ' %s' "$arg"
    done
    printf '\n'
  done < "$tmp"
} > "$conf"

bridge_count=$(grep -c '^Bridge ' "$conf" || true)
[ "$bridge_count" -gt 0 ] || {
  echo "No valid obfs4 bridges found in mounted bridge file" >&2
  exit 1
}

chown -R debian-tor:debian-tor /var/lib/tor /run/tor
chmod 700 /var/lib/tor/hidden_service
chmod 600 "$conf"

exec tor -f /etc/tor/torrc
