#!/bin/bash
# Запуск prod Docker-стека с проверкой и очисткой портов 80/443
# Запускать из корня репозитория: bash scripts/docker-prod-start.sh
# Для освобождения портов может потребоваться root: sudo bash scripts/docker-prod-start.sh

set -e

if [ "$(id -u)" -ne 0 ] && command -v fuser >/dev/null 2>&1 && fuser 80/tcp >/dev/null 2>&1; then
  echo "Порт 80 занят. Для освобождения портов запустите с sudo: sudo bash scripts/docker-prod-start.sh"
  exit 1
fi

echo "=== Проверка портов 80 и 443 ==="

PORTS_BUSY=""
for port in 80 443; do
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnp 2>/dev/null | grep -q ":$port "; then
      PORTS_BUSY="$PORTS_BUSY $port"
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -i ":$port" >/dev/null 2>&1; then
      PORTS_BUSY="$PORTS_BUSY $port"
    fi
  elif command -v fuser >/dev/null 2>&1; then
    if fuser "$port/tcp" >/dev/null 2>&1; then
      PORTS_BUSY="$PORTS_BUSY $port"
    fi
  fi
done

if [ -n "$PORTS_BUSY" ]; then
  echo ""
  echo "Порты заняты:$PORTS_BUSY"
  echo ""
  echo "Процессы, использующие порты:"
  (ss -tlnp 2>/dev/null | grep -E ':80 |:443 ' || true) || \
  (lsof -i :80 -i :443 2>/dev/null || true) || \
  (fuser -v 80/tcp 443/tcp 2>&1 || true)
  echo ""
  read -p "Освободить порты (завершить эти процессы) и продолжить? Введите 'yes': " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Отменено."
    exit 1
  fi
  echo ""
  echo "Освобождаем порты..."
  for port in 80 443; do
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "$port/tcp" 2>/dev/null || true
    else
      echo "Установите fuser (psmisc) или завершите процессы вручную: kill \$(lsof -t -i:$port)"
      exit 1
    fi
  done
  sleep 2
  echo "Порты освобождены."
  echo ""
fi

echo "=== Запуск Docker-стека ==="
export DOMAIN="${DOMAIN:-pingy.com}"
export DB_PASSWORD="${DB_PASSWORD:-postgres}"

docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "Готово. Проверка: docker compose -f docker-compose.prod.yml ps"
