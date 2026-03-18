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

# 1) Создать БД, если нет (от postgres)
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || {
  echo "Creating database $DB_NAME (owner postgres)..."
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER postgres;"
}

# 2) Выдать владение и права на schema public пользователю приложения
sudo -u postgres psql -c "ALTER DATABASE $DB_NAME OWNER TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER; GRANT CREATE ON SCHEMA public TO $DB_USER;" 2>/dev/null || true

# 3) Миграции (от пользователя pingychat, т.к. .env и venv от него)
echo "Running migrations..."
cd "$BACKEND"
sudo -u pingychat .venv/bin/python manage.py migrate --no-input

echo "Collecting static files..."
sudo -u pingychat .venv/bin/python manage.py collectstatic --no-input

# 4) Перезапуск сервисов
echo "Restarting pingychat-backend and pingychat-celery..."
systemctl restart pingychat-backend pingychat-celery

echo "=== Done. Backend and Celery restarted. ==="
