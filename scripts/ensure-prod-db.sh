#!/bin/bash
# На проде: создать БД (если нет), выдать права, применить миграции, перезапустить backend и celery.
# Запускать с sudo (для postgresql и systemctl). Репозиторий: корень chat/.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
ENV_FILE="$BACKEND/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

# Из .env достаём имя БД и пользователя (пароль не показываем)
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)"
if [ -z "$DATABASE_URL" ]; then
  DB_USER="chatapp"
  DB_NAME="chatdb"
else
  # postgres://USER:PASS@HOST:PORT/DBNAME
  DB_USER="$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')"
  DB_NAME="$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')"
  [ -z "$DB_USER" ] && DB_USER="chatapp"
  [ -z "$DB_NAME" ] && DB_NAME="chatdb"
fi

echo "=== Ensure prod DB: user=$DB_USER db=$DB_NAME ==="

# БД в Docker (см. docker-compose.db.yml) — создаётся контейнером, host postgres не трогаем
if echo "$DATABASE_URL" | grep -qE '(127\.0\.0\.1|localhost):5433'; then
  echo "--- PostgreSQL в Docker на :5433 — шаги через системного postgres пропущены ---"
else
  # 1) Создать БД, если нет (от postgres на хосте)
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || {
    echo "Creating database $DB_NAME (owner postgres)..."
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER postgres;"
  }

  # 2) Выдать владение и права на schema public пользователю приложения
  sudo -u postgres psql -c "ALTER DATABASE $DB_NAME OWNER TO $DB_USER;" 2>/dev/null || true
  sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER; GRANT CREATE ON SCHEMA public TO $DB_USER;" 2>/dev/null || true
fi

# 3) Миграции (от пользователя pingychat, т.к. .env и venv от него)
echo "Running migrations..."
cd "$BACKEND"
sudo -u pingychat .venv/bin/python manage.py migrate --no-input

# Ensure MEDIA_ROOT exists (when set to external path, e.g. /var/media/pingychat.com)
MEDIA_ROOT="$(grep -E '^MEDIA_ROOT=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
if [ -n "$MEDIA_ROOT" ] && [ ! -d "$MEDIA_ROOT" ]; then
  echo "Creating media directory: $MEDIA_ROOT"
  sudo mkdir -p "$MEDIA_ROOT"
  sudo chown pingychat:pingychat "$MEDIA_ROOT"
fi

echo "Collecting static files..."
sudo -u pingychat .venv/bin/python manage.py collectstatic --no-input

# 4) Перезапуск сервисов
echo "Restarting pingychat-backend and pingychat-celery..."
systemctl restart pingychat-backend pingychat-celery

echo "=== Done. Backend and Celery restarted. ==="
