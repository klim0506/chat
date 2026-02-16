#!/bin/bash
# ─── Automated Let's Encrypt SSL certificate setup ─────────────────────
#
# Usage:
#   export DOMAIN=example.com
#   export EMAIL=admin@example.com   # optional, for renewal notices
#   bash init-letsencrypt.sh
#
# This script:
#   1. Creates a temporary self-signed certificate so nginx can start
#   2. Starts nginx + certbot containers
#   3. Requests a real Let's Encrypt certificate
#   4. Reloads nginx with the real certificate
#
# After first run, certbot will auto-renew every 12 hours via
# the certbot service in docker-compose.prod.yml.

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
DOMAIN="${DOMAIN:?Set DOMAIN env var (e.g. export DOMAIN=example.com)}"
EMAIL="${EMAIL:-}"
STAGING="${STAGING:-0}"  # Set to 1 to use Let's Encrypt staging (for testing)

RSA_KEY_SIZE=4096
DATA_PATH="./certbot"

echo "──────────────────────────────────────────────"
echo "  Let's Encrypt setup for: $DOMAIN"
echo "──────────────────────────────────────────────"

# ─── 1. Create dummy certificate so nginx can start ──────────────────
echo "[1/4] Creating temporary self-signed certificate..."

docker compose -f "$COMPOSE_FILE" run --rm --entrypoint "" certbot sh -c "
  mkdir -p /etc/letsencrypt/live/$DOMAIN &&
  openssl req -x509 -nodes -newkey rsa:2048 \
    -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out    /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj   '/CN=localhost'
"

# ─── 2. Start nginx (it will use the dummy cert) ────────────────────
echo "[2/4] Starting nginx..."

docker compose -f "$COMPOSE_FILE" up -d nginx

# Wait for nginx to be ready
sleep 5

# ─── 3. Delete dummy cert and request real one ──────────────────────
echo "[3/4] Requesting real certificate from Let's Encrypt..."

docker compose -f "$COMPOSE_FILE" run --rm --entrypoint "" certbot sh -c "
  rm -rf /etc/letsencrypt/live/$DOMAIN &&
  rm -rf /etc/letsencrypt/archive/$DOMAIN &&
  rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf
"

# Build certbot command
CERTBOT_CMD="certbot certonly --webroot -w /var/www/certbot"
CERTBOT_CMD="$CERTBOT_CMD -d $DOMAIN"
CERTBOT_CMD="$CERTBOT_CMD --rsa-key-size $RSA_KEY_SIZE"
CERTBOT_CMD="$CERTBOT_CMD --agree-tos"
CERTBOT_CMD="$CERTBOT_CMD --non-interactive"

if [ -n "$EMAIL" ]; then
  CERTBOT_CMD="$CERTBOT_CMD --email $EMAIL"
else
  CERTBOT_CMD="$CERTBOT_CMD --register-unsafely-without-email"
fi

if [ "$STAGING" = "1" ]; then
  CERTBOT_CMD="$CERTBOT_CMD --staging"
  echo "  (using Let's Encrypt STAGING — cert won't be trusted by browsers)"
fi

docker compose -f "$COMPOSE_FILE" run --rm --entrypoint "" certbot sh -c "$CERTBOT_CMD"

# ─── 4. Reload nginx with real certificate ──────────────────────────
echo "[4/4] Reloading nginx with real certificate..."

docker compose -f "$COMPOSE_FILE" exec nginx nginx -s reload

echo ""
echo "══════════════════════════════════════════════"
echo "  SSL certificate installed successfully!"
echo ""
echo "  Now start the full stack:"
echo "    docker compose -f $COMPOSE_FILE up -d"
echo ""
echo "  Your site is live at: https://$DOMAIN"
echo "══════════════════════════════════════════════"
