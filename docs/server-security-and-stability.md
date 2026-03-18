# Защита сервера и стабильность сервиса

Рекомендации по дополнительной защите и стабильной работе PingyChat на продакшене.

Архитектурное разнесение ярусов (edge → app → data) и сетевые правила — в [architecture-security-and-separation.md](architecture-security-and-separation.md).

## Уже реализовано в проекте

- **Django:** `SECRET_KEY`, `ALLOWED_HOSTS`, HSTS, secure cookies, X-Frame-Options, XSS/Content-Type заголовки, CSRF.
- **CORS:** явный список `CORS_ALLOWED_ORIGINS`, без `CORS_ALLOW_ALL_ORIGINS` в prod.
- **Rate limiting:** nginx (`api_limit` 30 r/s, `auth_limit` 5 r/m для send-code), DRF throttle на auth и webhook платежей.
- **Платежи:** опциональный `YOOKASSA_WEBHOOK_IP_ALLOWLIST` для приёма webhook только с IP YooKassa.
- **Fail2ban:** пример конфига для nginx auth в `scripts/fail2ban/nginx-http-auth.conf`.
- **Health check:** `GET /api/health/` — 200 при живом приложении; `?deep=1` — проверка БД (для балансировщика).

---

## 1. Защита на уровне ОС и сети

### Firewall (ufw)

```bash
# Разрешить только нужные порты
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Если БД/Redis на этом же хосте — не открывать их порты наружу (доступ только с localhost или внутренней сети).

### SSH

- Отключить вход по паролю: `PasswordAuthentication no`, использовать ключи.
- Менять стандартный порт SSH — по желанию (не забыть разрешить его в ufw).
- Ограничить пользователей: `AllowUsers deploy admin`.

### Обновления

- Регулярно: `apt update && apt upgrade` (или аналог), перезапуск только при необходимости.
- Следить за CVE для используемых пакетов (Python, nginx, PostgreSQL, Redis).

---

## 2. Защита приложения и админки

### Django admin по IP

Ограничить доступ к `/admin/` только с доверенных IP. В nginx (внутри `location /admin/`):

```nginx
include /etc/nginx/snippets/admin-ip-restrict.conf;
```

В `admin-ip-restrict.conf` (пример в `docker/nginx/snippets/admin-ip-restrict.conf.example`):

```nginx
allow 1.2.3.4;   # ваш офис/VPN
allow 10.0.0.0/8;
deny all;
```

После правок: `nginx -t && systemctl reload nginx`.

### Секреты и переменные

- `SECRET_KEY`, `MESSAGE_ENCRYPTION_KEY`, ключи БД, SMS, YooKassa, Telegram — только в переменных окружения (`.env`), не в коде.
- Файлы `.env` не должны попадать в git (уже в `.gitignore`).
- На проде не использовать `DEBUG=True` и не включать `AUTH_DEBUG`.

### YooKassa webhook

В проде задать белый список IP для webhook (документация YooKassa):

```bash
# В backend/.env
YOOKASSA_WEBHOOK_IP_ALLOWLIST=77.75.153.0/25,185.71.76.0/27
```

Проверка IP реализована в коде; без списка любой IP может слать запросы на URL webhook.

---

## 3. Fail2ban

Защита от перебора паролей и грубого флуда по логам.

- Установка: `apt install fail2ban`.
- Для nginx basic auth: скопировать `scripts/fail2ban/nginx-http-auth.conf` в `/etc/fail2ban/jail.d/`, при необходимости поправить `logpath`, затем `systemctl reload fail2ban`.

Можно добавить фильтры под свои логи (например, 401/403 по одному IP) и отдельные jail’ы.

---

## 4. Стабильность: процессы и перезапуски

### Gunicorn / Daphne

- Запускать несколько воркеров (по числу ядер или 2–4): например `gunicorn -w 4 -t 120 config.wsgi:application`.
- Таймаут больше, чем у nginx (у вас 300s для API), чтобы не резать долгие запросы раньше nginx.
- Daphne для WebSocket — отдельный процесс; при падении его должен перезапускать systemd/supervisor.

### Systemd (пример unit для бэкенда)

```ini
[Unit]
Description=PingyChat backend
After=network.target postgresql.service redis.service

[Service]
Type=notify
User=deploy
WorkingDirectory=/path/to/chat/backend
EnvironmentFile=/path/to/chat/backend/.env
ExecStart=/path/to/venv/bin/gunicorn -w 4 -t 120 --bind 127.0.0.1:8000 config.wsgi:application
ExecStartPost=/path/to/venv/bin/daphne -b 127.0.0.1 -p 8001 config.asgi:application
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Важно: `Restart=always` и корректный порядок (`After=...`) для БД и Redis.

### Docker

- В `docker-compose` для сервисов backend, celery задать `restart: unless-stopped` (или `always`).
- Ограничить ресурсы при необходимости: `deploy.resources.limits.memory`, `cpus`, чтобы один контейнер не положил хост.

---

## 5. Мониторинг и health check

- **Балансировщик:** настроить проверку `GET /api/health/` каждые 5–10 с. При не 200 или таймауте — убирать узел из балансировки (см. `docs/ha-multi-vm-deployment.md`).
- **Глубокий проверка:** `GET /api/health/?deep=1` — дополнительно проверяет доступ к БД; при 503 узел можно считать неготовым.
- Логи приложения и nginx хранить и при необходимости ротировать (logrotate); при 502 смотреть `scripts/troubleshoot-502.md`.

---

## 6. Резюме чек-листа

| Мера | Описание |
|------|----------|
| Firewall | ufw: только 22, 80, 443; БД/Redis не наружу |
| SSH | Ключи, при необходимости ограничение пользователей |
| Admin по IP | nginx allow/deny для `location /admin/` |
| Секреты | Только в .env, без DEBUG/AUTH_DEBUG на проде |
| YooKassa | Задать YOOKASSA_WEBHOOK_IP_ALLOWLIST |
| Fail2ban | Включить jail для nginx auth (и при необходимости свои фильтры) |
| Перезапуск | systemd/docker restart при падении backend/daphne/celery |
| Health | Использовать /api/health/ для LB и мониторинга |

Эти шаги дополняют уже настроенные в проекте безопасные заголовки, CORS, rate limiting и throttle на критичных эндпоинтах и помогают держать сервис стабильным и защищённым.
