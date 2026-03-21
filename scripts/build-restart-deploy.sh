#!/bin/bash
# Build + Restart Backend + Deploy — всё в одну команду
# Запуск: ./scripts/build-restart-deploy.sh  или  npm run deploy
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy-prod.sh"
