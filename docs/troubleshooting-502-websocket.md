# Устранение ошибок 502 и WebSocket на web.pingychat.com

Если в браузере на https://web.pingychat.com видны:

- **502** на запросах к `/api/chats/...`, `/api/chats/.../members/`, `/api/chats/.../messages/` и т.д.
- **WebSocket connection to 'wss://web.pingychat.com/ws/...' failed**
- иногда **403** на один из ресурсов

это почти всегда значит, что **бэкенд (Daphne) не отвечает** на порту 8000. Nginx проксирует `/api/` и `/ws/` на `http://127.0.0.1:8000`; при недоступности upstream Nginx отдаёт 502, а WebSocket не устанавливается.

## 1. Проверить, что бэкенд запущен

На сервере:

```bash
systemctl status pingychat-backend
```

Должно быть `active (running)`. Если `failed` или `inactive` — сервис не работает.

## 2. Посмотреть логи бэкенда

```bash
sudo journalctl -u pingychat-backend -n 100 --no-pager
```

Типичные причины падения:

- **Ошибка подключения к БД** — проверить `DATABASE_URL` в `backend/.env`, что PostgreSQL запущен (`systemctl status postgresql`), база и пользователь существуют.
- **Ошибка Redis** — в прод-настройках часто используется Redis для channel layers; проверить `CHANNEL_LAYERS` и что Redis запущен (`systemctl status redis-server`).
- **Нет или неверный .env** — в systemd-юните указан `EnvironmentFile=/root/chat/chat-dev/backend/.env`; файл должен существовать и содержать как минимум `SECRET_KEY`, `DATABASE_URL`, `DJANGO_SETTINGS_MODULE` (в юните переопределён на `config.settings.prod`).
- **Исключение при старте приложения** — полный стек будет в логах `journalctl`.

## 3. Проверить, что порт 8000 слушается

```bash
ss -tlnp | grep 8000
# или
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/
```

Если порт не слушается — Daphne не запущен или упал. Если порт слушается, но `curl` даёт ошибку соединения — смотреть логи выше.

## 4. Запустить или перезапустить бэкенд

```bash
sudo systemctl start pingychat-backend
# или после исправления конфига/окружения:
sudo systemctl restart pingychat-backend
```

Убедиться, что зависимости запущены:

```bash
sudo systemctl start postgresql redis-server
sudo systemctl start pingychat-backend pingychat-celery
```

## 5. Проверить Nginx

Конфиг для web.pingychat.com должен проксировать `/api/` и `/ws/` на `http://127.0.0.1:8000`. Пример — `scripts/nginx-pingychat-ssl.conf`. Для WebSocket обязательны:

- `proxy_http_version 1.1`
- `proxy_set_header Upgrade $http_upgrade`
- `proxy_set_header Connection $connection_upgrade`

Переменная `$connection_upgrade` задаётся в `scripts/nginx-pingychat-limits.conf` (map). Убедиться, что этот include подключён на уровне http (например в `conf.d`).

После изменений:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 6. Отдельно про 403

Один запрос с 403 может быть:

- к другому домену или пути (например, сторонний скрипт/ресурс);
- к эндпоинту, который возвращает 403 по авторизации (например, нет или неверный токен);
- CORS/CSRF, если бэкенд всё же отвечает, но отклонил запрос.

Если при этом все запросы к `/api/` и `/ws/` дают 502, сначала устранить падение бэкенда (шаги 1–4); затем при необходимости разбирать оставшийся 403 по конкретному URL в DevTools.

## Краткий чеклист

| Проверка | Команда |
|----------|--------|
| Backend запущен | `systemctl status pingychat-backend` |
| Логи backend | `journalctl -u pingychat-backend -n 100` |
| Порт 8000 | `ss -tlnp \| grep 8000` или `curl -I http://127.0.0.1:8000/api/` |
| PostgreSQL | `systemctl status postgresql` |
| Redis | `systemctl status redis-server` |
| Перезапуск | `sudo systemctl restart pingychat-backend` |
