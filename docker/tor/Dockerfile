# Tor — только SOCKS5 для обхода блокировок Telegram Gateway (open source).
FROM alpine:3.20
RUN apk add --no-cache tor netcat-openbsd su-exec \
    && mkdir -p /var/lib/tor \
    && chown tor:tor /var/lib/tor
COPY torrc /etc/tor/torrc
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 9050
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=12 \
    CMD nc -z 127.0.0.1 9050 || exit 1
ENTRYPOINT ["/entrypoint.sh"]
