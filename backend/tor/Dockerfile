FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends age ca-certificates obfs4proxy tor \
    && rm -rf /var/lib/apt/lists/*

COPY torrc /etc/tor/torrc
COPY bridges.txt /etc/tor/bridges.txt
COPY docker-entrypoint.sh /usr/local/bin/tor-entrypoint
RUN chmod +x /usr/local/bin/tor-entrypoint

ENTRYPOINT ["tor-entrypoint"]
CMD ["tor", "-f", "/etc/tor/torrc"]
