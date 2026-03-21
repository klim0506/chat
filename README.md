# PingyChat

Платформа приватных чатов: веб-приложение, десктоп (Tauri), Android.

## Требования

- **Backend:** Python 3.11+, PostgreSQL, Redis
- **Frontend:** Node.js 18+, npm

## Запуск в режиме разработки

### Быстрый старт (Windows)

Из корня `chat-dev`:

```powershell
npm run dev
```

Скрипт останавливает зависшие процессы на портах 8000 и 5173, запускает бэкенд, дожидается его готовности и запускает фронтенд.

### Backend (отдельно)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # заполнить SECRET_KEY, DATABASE_URL и др.
```

Создать БД и применить миграции:

```bash
createdb chatdb   # или через psql
.venv/bin/python manage.py migrate
```

Запуск (Django + Daphne, порт 8000):

```bash
.venv/bin/python manage.py runserver
# или ASGI:
.venv/bin/daphne -b 127.0.0.1 -p 8000 config.asgi:application
```

Celery (опционально, для фоновых задач):

```bash
.venv/bin/celery -A config worker -l INFO
```

### Frontend (отдельно)

```bash
cd frontend
npm install
npm run dev
```

Приложение откроется по адресу из вывода Vite (обычно http://localhost:5173). API запросы проксируются на бэкенд через `vite.config` или переменную `VITE_API_URL`.

---

## Запуск на продакшене (сервер)

На сервере бэкенд и воркеры запускаются через systemd.

### 1. Подготовка окружения

- Установить PostgreSQL и Redis, создать пользователя БД (например `chatapp`) и базу `chatdb`.
- В `backend/.env` задать `DATABASE_URL`, `SECRET_KEY`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` и остальные переменные (см. `backend/.env.production.example`).
- Создать пользователя ОС `pingychat`, разложить репозиторий (например в `/root/chat`), в `backend/` под пользователем `pingychat` создать venv и установить зависимости.

### 2. Установка systemd-юнитов

```bash
sudo ./scripts/install-systemd-units.sh
```

Копирует в systemd: `pingychat-backend`, `pingychat-celery` (и при наличии — `pingychat-celery-beat`). В юнитах указаны `WorkingDirectory` и `EnvironmentFile` на `backend/.env`.

### 3. БД и миграции (один раз или после смены БД)

Скрипт создаёт базу, выдаёт права пользователю из `DATABASE_URL`, применяет миграции и перезапускает backend и celery:

```bash
sudo ./scripts/ensure-prod-db.sh
```

Запускать из корня репозитория. При каждом деплое этот шаг можно не вызывать отдельно — он встроен в `deploy-prod.sh`.

### 4. Запуск и автозапуск сервисов

```bash
sudo systemctl start pingychat-backend pingychat-celery
sudo systemctl enable pingychat-backend pingychat-celery
```

Проверка:

```bash
systemctl status pingychat-backend pingychat-celery
```

Бэкенд слушает `127.0.0.1:8000`. Доступ снаружи — через Nginx (прокси на 8000) и раздачу статики фронта из `/var/www/pingychat.com/frontend` (или аналог).

**Две ВМ (приложение и БД раздельно, Docker):** пошаговая схема и команды — [docs/deploy-stage2-two-vm.md](docs/deploy-stage2-two-vm.md) (`docker-compose.data-node.yml`, `docker-compose.app-node.yml`).

### 5. Деплой новой сборки фронта и перезапуск backend

Из корня репозитория:

```bash
./scripts/deploy-prod.sh
```

Скрипт по шагам:

1. При наличии systemd и `pingychat-backend` — вызывает `ensure-prod-db.sh` (БД, миграции, перезапуск backend и celery).
2. Собирает фронт: `cd frontend && npm run build`.
3. Копирует `frontend/dist/` в каталог прода (по умолчанию `/var/www/pingychat.com/frontend`, задаётся переменной `FRONTEND_DEST`).
4. Перезапускает `pingychat-backend`.

При необходимости копирование в `/var/www` выполнять с `sudo` (скрипт сам использует sudo при нехватке прав).

---

## Документация

| Раздел | Файл |
|--------|------|
| Сборка **Windows** (десктоп) и **Android** (команды, CI, артефакты) | [docs/build-windows-and-android.md](docs/build-windows-and-android.md) |
| Этап 2: две ВМ (Docker, приватная сеть) | [docs/deploy-stage2-two-vm.md](docs/deploy-stage2-two-vm.md) |
| Настройка сайта (pingychat.com, web.pingychat.com, Nginx, SSL) | [docs/web.pingychat.com-setup.md](docs/web.pingychat.com-setup.md) |
| Ошибки 502 и WebSocket на продакшене | [docs/troubleshooting-502-websocket.md](docs/troubleshooting-502-websocket.md) |
| Релиз на прод (чеклист, CI, подпись) | [docs/production-release-guide.md](docs/production-release-guide.md) |
| Сборка десктопа (Windows, macOS, Linux) | [docs/desktop-build-mac-windows.md](docs/desktop-build-mac-windows.md) |
| Установщики и раздача по платформам | [docs/installers-all-platforms.md](docs/installers-all-platforms.md) |
