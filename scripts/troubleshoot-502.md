# 502 Bad Gateway и WebSocket — что проверить на сервере

Ошибки `POST /api/files/upload/ 502` и `WebSocket ... failed` означают: **nginx не получает ответ от бэкенда** (upstream `backend:8000`).

## 1. Зайти на сервер и проверить бэкенд

### Если бэкенд под systemd (как в deploy-prod.sh)

```bash
# Статус
sudo systemctl status pingychat-backend

# Если не active — перезапуск
sudo systemctl restart pingychat-backend

# Логи (искать ошибки при загрузке файлов / WS)
sudo journalctl -u pingychat-backend -n 100 --no-pager
```

### Если бэкенд в Docker (upstream backend:8000)

```bash
# Контейнер backend должен быть запущен
docker ps | grep backend

# Перезапуск контейнера бэкенда
docker compose restart backend
# или
docker restart <имя_контейнера_backend>

# Логи
docker compose logs backend --tail 100
# или
docker logs <имя_контейнера_backend> --tail 100
```

## 2. Проверить, слушает ли бэкенд порт 8000

```bash
sudo ss -tlnp | grep 8000
# или
sudo netstat -tlnp | grep 8000
```

Должна быть строка с `*:8000` или `127.0.0.1:8000`. Если пусто — процесс бэкенда не запущен или упал.

## 3. Как nginx обращается к бэкенду

В `docker/nginx/ssl.conf` указано:

- `set $backend_upstream backend:8000;`

Значит nginx ожидает хост с именем **backend** и порт 8000. Варианты:

- **Docker Compose:** сервис должен называться `backend` и быть в той же сети, что и nginx.
- **Без Docker:** в конфиге nginx на сервере обычно меняют на `127.0.0.1:8000` и перезапускают nginx.

Проверка с самого сервера (если бэкенд на этом же хосте):

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health/
# или просто
curl -I http://127.0.0.1:8000/
```

Если здесь 502/connection refused — проблема в бэкенде (не запущен, падает при старте или при запросе).

## 4. Типичные причины 502 при загрузке файла

- Бэкенд падает по таймауту (большой файл, долгая обработка) — в nginx уже стоят `proxy_read_timeout 300s` и `proxy_send_timeout 300s` для `/api/`.
- Бэкенд падает с исключением при обработке upload (место на диске, права на каталог загрузок, ошибка в коде) — смотреть логи (см. выше).
- Контейнер/процесс бэкенда завершился — перезапуск (см. п. 1).

## 5. После изменений

```bash
# Перезапуск nginx (если меняли конфиг)
sudo systemctl reload nginx
# или
docker compose exec nginx nginx -s reload
```

После перезапуска бэкенда повторно попробовать загрузку файла и открытие чата (WebSocket).
