#!/bin/bash
# Деплой prod: сборка фронта и публикация на сервер.
# Запускать из корня репозитория: ./scripts/deploy-prod.sh
# На сервере: при необходимости выполнять с sudo для копирования в /var/www.
set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DEST="${FRONTEND_DEST:-/var/www/pingychat.com/frontend}"

echo "=== PingyChat prod deploy ==="
echo "Repo root: $REPO_ROOT"
echo "Frontend dest: $FRONTEND_DEST"

cd "$REPO_ROOT"
USE_DOCKER_STACK=0
if [ -f "$REPO_ROOT/docker-compose.yml" ] && [ -f "$REPO_ROOT/postgres.docker.env" ] && command -v docker &>/dev/null; then
  USE_DOCKER_STACK=1
fi

if [ "$USE_DOCKER_STACK" = "1" ]; then
  echo "--- Docker stack: rebuild telegram-tor + backend/celery, миграции в entrypoint при старте backend ---"
  ln -sf postgres.docker.env .env
  docker compose build telegram-tor backend celery celery-beat
  docker compose up -d db redis telegram-tor backend celery celery-beat
  echo "--- Frontend (Docker build → $FRONTEND_DEST) ---"
  # Важно: всегда пересобирать образ фронта — иначе run использует старый dist из кэша Docker
  docker compose --profile frontend build frontend-build
  docker compose --profile frontend run --rm frontend-build
  echo "=== Deploy done (Docker) ==="
  exit 0
fi

# 0. На проде: БД (если нет), миграции, перезапуск backend/celery (systemd)
if [ -f "$REPO_ROOT/scripts/ensure-prod-db.sh" ] && [ -f "$REPO_ROOT/backend/.env" ] && command -v systemctl &>/dev/null && systemctl list-units --type=service --all 2>/dev/null | grep -q pingychat-backend; then
  echo "--- Ensuring prod DB and migrations ---"
  sudo bash "$REPO_ROOT/scripts/ensure-prod-db.sh"
elif [ -f "$REPO_ROOT/scripts/ensure-prod-db.sh" ] && [ ! -f "$REPO_ROOT/backend/.env" ]; then
  echo "--- Skipping DB ensure (backend/.env not found) ---"
fi

# (Optional) Collect Django admin/static even when systemd isn't configured
if [ -d "$REPO_ROOT/backend" ] && [ -f "$REPO_ROOT/backend/.env" ] && [ -x "$REPO_ROOT/backend/.venv/bin/python" ] && [ -f "$REPO_ROOT/backend/manage.py" ]; then
  echo "--- Collecting backend static (Django admin) ---"
  cd "$REPO_ROOT/backend"
  if [ -w "$REPO_ROOT/backend/staticfiles" ] 2>/dev/null; then
    .venv/bin/python manage.py collectstatic --no-input
  else
    sudo -u pingychat .venv/bin/python manage.py collectstatic --no-input
  fi
fi

# 1. Сборка фронтенда
echo "--- Building frontend ---"
cd "$REPO_ROOT/frontend"
if [ -f .env.production ]; then
  export $(grep -v '^#' .env.production | xargs)
fi
npm run build

# 2. Публикация статики
echo "--- Publishing frontend to $FRONTEND_DEST ---"
if [ ! -d "$REPO_ROOT/frontend/dist" ]; then
  echo "Error: frontend/dist not found after build"
  exit 1
fi
if [ -w "$(dirname "$FRONTEND_DEST")" ] 2>/dev/null; then
  mkdir -p "$FRONTEND_DEST"
  rsync -a --delete "$REPO_ROOT/frontend/dist/" "$FRONTEND_DEST/"
else
  sudo mkdir -p "$FRONTEND_DEST"
  sudo rsync -a --delete "$REPO_ROOT/frontend/dist/" "$FRONTEND_DEST/"
fi
echo "Frontend published."

# 3. Перезапуск бэкенда (если systemd доступен)
if command -v systemctl &>/dev/null && systemctl list-units --type=service --all 2>/dev/null | grep -q pingychat-backend; then
  echo "--- Restarting pingychat-backend ---"
  sudo systemctl restart pingychat-backend
  echo "Backend restarted."
else
  echo "--- Backend: restart manually if needed (e.g. sudo systemctl restart pingychat-backend) ---"
fi

echo "=== Deploy done ==="
