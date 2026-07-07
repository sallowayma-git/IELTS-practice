#!/bin/sh
set -eu

TOR_USER="${TOR_USER:-debian-tor}"

mkdir -p /run/tor /var/lib/tor/hidden_service
chown -R "$TOR_USER:$TOR_USER" /run/tor /var/lib/tor
chmod 750 /run/tor
chmod 700 /var/lib/tor/hidden_service

exec "$@"
