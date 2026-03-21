#!/bin/bash
# Поднять весь стек в Docker (Postgres, Redis, Tor, backend, celery, beat) и собрать фронт в /var/www.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Интерполяция ${POSTGRES_PASSWORD} в docker-compose.yml
if [ ! -f postgres.docker.env ]; then
  echo "Создайте postgres.docker.env с POSTGRES_PASSWORD=..." >&2
  exit 1
fi
ln -sf postgres.docker.env .env

docker compose build --parallel
docker compose up -d db redis telegram-tor backend celery celery-beat

echo "--- Сборка и копирование фронтенда в /var/www/pingychat.com/frontend ---"
docker compose --profile frontend run --rm frontend-build

echo "=== Готово. Nginx на хосте по-прежнему проксирует на 127.0.0.1:8000 и раздаёт статику из /var/www ==="
