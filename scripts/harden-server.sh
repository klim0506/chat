#!/bin/bash
# Проверка и закрепление настроек безопасности сервера PingyChat.
# Запуск: sudo /root/chat/scripts/harden-server.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHAT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_ENV="$CHAT_DIR/backend/.env"

echo "=== Проверка безопасности PingyChat ==="

# 1. Права на .env (только владелец)
if [ -f "$BACKEND_ENV" ]; then
  perms=$(stat -c %a "$BACKEND_ENV" 2>/dev/null || stat -f %A "$BACKEND_ENV" 2>/dev/null)
  if [ "$perms" != "600" ]; then
    echo "[Исправляю] backend/.env: устанавливаю chmod 600"
    chown pingychat:pingychat "$BACKEND_ENV" 2>/dev/null || true
    chmod 600 "$BACKEND_ENV"
  else
    echo "[OK] backend/.env права 600"
  fi
else
  echo "[!] backend/.env не найден"
fi

# 2. Nginx: установка сниппета безопасности и limit_req (если ещё не стоят)
if [ -f "$CHAT_DIR/docker/nginx/snippets/pingychat-security.conf" ]; then
  if ! cmp -s "$CHAT_DIR/docker/nginx/snippets/pingychat-security.conf" /etc/nginx/snippets/pingychat-security.conf 2>/dev/null; then
    echo "[Исправляю] копирую pingychat-security.conf в /etc/nginx/snippets/"
    cp "$CHAT_DIR/docker/nginx/snippets/pingychat-security.conf" /etc/nginx/snippets/
  fi
fi
if [ -f "$CHAT_DIR/docker/nginx/conf.d/pingychat-limit-req.conf" ]; then
  if ! cmp -s "$CHAT_DIR/docker/nginx/conf.d/pingychat-limit-req.conf" /etc/nginx/conf.d/pingychat-limit-req.conf 2>/dev/null; then
    echo "[Исправляю] копирую pingychat-limit-req.conf в /etc/nginx/conf.d/"
    cp "$CHAT_DIR/docker/nginx/conf.d/pingychat-limit-req.conf" /etc/nginx/conf.d/
  fi
fi
if nginx -t 2>/dev/null; then
  echo "[OK] nginx конфиг корректен"
else
  echo "[!] nginx -t выдал ошибку, перезагрузка не выполнялась"
fi

# 3. PostgreSQL слушает только localhost
pg_listen=$(sudo -u postgres psql -t -c "SHOW listen_addresses;" 2>/dev/null | tr -d ' ')
if [ "$pg_listen" = "localhost" ] || [ "$pg_listen" = "127.0.0.1" ]; then
  echo "[OK] PostgreSQL listen_addresses = $pg_listen"
else
  echo "[!] PostgreSQL listen_addresses = $pg_listen (рекомендуется localhost)"
fi

# 4. Redis привязан к localhost
redis_bind=$(grep -E "^bind " /etc/redis/redis.conf 2>/dev/null | head -1 || true)
if echo "$redis_bind" | grep -q "127.0.0.1"; then
  echo "[OK] Redis bind 127.0.0.1"
else
  echo "[!] Redis: проверьте bind в /etc/redis/redis.conf (должен быть 127.0.0.1)"
fi

# 5. Fail2ban
if systemctl is-active --quiet fail2ban 2>/dev/null; then
  echo "[OK] fail2ban активен"
else
  echo "[!] Установите и включите fail2ban: apt install fail2ban && systemctl enable --now fail2ban"
fi

# 6. UFW
if command -v ufw >/dev/null 2>&1; then
  ufw_status=$(ufw status 2>/dev/null | head -1 || true)
  if echo "$ufw_status" | grep -q "active"; then
    echo "[OK] UFW активен"
  else
    echo "[!] Включите UFW: ufw allow 22,80,443 && ufw enable"
  fi
else
  echo "[!] Установите UFW: apt install ufw"
fi

# 7. SSH: напоминание про ключи
if [ -d /etc/ssh/sshd_config.d ]; then
  if grep -rq "PasswordAuthentication no" /etc/ssh/sshd_config.d/ 2>/dev/null; then
    echo "[OK] SSH: пароль отключён (только ключи)"
  else
    echo "[!] Рекомендуется вход только по ключу: см. scripts/install-ssh-keys-only.sh (сначала проверьте вход по ключу во втором терминале)"
  fi
fi

echo ""
echo "=== Готово. Ручные шаги см. в backend/SECURITY_CHECKLIST.md ==="
