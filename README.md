# Платформа приватных чатов

React + Django + PostgreSQL + Redis + Celery.

## Что в проекте
- `frontend` — веб-клиент (Vite, порт `5173`) с анимированными Lottie-реакциями на сообщения
- `backend` — API/WebSocket (Django + Daphne, порт `8000`)
- `db` — PostgreSQL 16 (`localhost:5433` -> контейнер `5432`)
- `redis` — Redis 7 (`localhost:6379`)
- `celery` — фоновые задачи
- `celery-beat` — планировщик фоновых задач
- `nginx` — прокси (порт `80`)

## Быстрый запуск через Docker

Запустите Docker Desktop или Docker Engine с плагином Compose. Все команды выполняйте из корня репозитория. Если `backend/.env` ещё нет, скопируйте `backend/.env.example`.

- В PowerShell выполните `Copy-Item backend/.env.example backend/.env`.
- В Bash выполните `cp backend/.env.example backend/.env`.

Укажите `USE_SQLITE=False` в `backend/.env`. Запустите PostgreSQL и Redis, примените миграции и поднимите остальные сервисы.

```bash
docker compose up -d --wait db redis
docker compose run --rm --build backend python manage.py migrate
docker compose up -d --build
```

Откройте [веб-клиент](http://localhost:5173). API доступен на `http://localhost:8000`, прокси Nginx — на `http://localhost`, PostgreSQL — на `localhost:5433`.

```bash
docker compose ps       # статус сервисов
docker compose logs -f  # логи
docker compose down     # остановка сервисов
```

## Запуск backend и frontend в Windows

Установите Python `3.12+` и Node.js `20+`. Подготовьте `backend/.env` по инструкции выше. Для запуска PostgreSQL и Redis в Docker выполните команду из корня репозитория.

```powershell
docker compose up -d --wait db redis
```

Укажите в `backend/.env` `USE_SQLITE=False`, `DATABASE_URL=postgres://postgres:postgres@localhost:5433/chatdb` и `REDIS_URL=redis://localhost:6379/0`. Если PostgreSQL и Redis уже работают отдельно, подставьте их адреса. Для разработки с SQLite установите `USE_SQLITE=True` и запустите Redis.

Установите зависимости, примените миграции и запустите Django.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DJANGO_SETTINGS_MODULE = 'config.settings.dev'
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

В отдельном терминале из корня репозитория запустите веб-клиент.

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Для фоновых задач запустите Celery Worker в отдельном терминале из папки `backend`.

```powershell
$env:DJANGO_SETTINGS_MODULE = 'config.settings.dev'
.\.venv\Scripts\celery.exe -A config.celery worker --pool=solo -l info
```

Для периодических задач запустите Celery Beat в ещё одном терминале из папки `backend`.

```powershell
$env:DJANGO_SETTINGS_MODULE = 'config.settings.dev'
.\.venv\Scripts\celery.exe -A config.celery beat -l info
```

Локальные процессы можно остановить сочетанием `Ctrl+C` в их терминалах.

## Переменные окружения backend
Скопируйте `backend/.env.example` в `backend/.env` и заполните:
- `SECRET_KEY`
- `DATABASE_URL` (для Docker-инфры: `postgres://postgres:postgres@localhost:5433/chatdb`)
- `REDIS_URL` (`redis://localhost:6379/0`)
- `REDSMS_LOGIN`, `REDSMS_API_KEY`, `REDSMS_FROM`
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_SECRET`
- `TELEGRAM_GATEWAY_TOKEN` (Telegram Gateway: коды в чат “Verification Codes” / @VerificationCodes)
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`

## E2E тестирование и скрипты

### Создание фикстур
```bash
cd frontend
npm run create-fixtures
```
Создаёт `public/e2e-fixtures/`: photo1–3.png, doc.pdf, audio.webm, video.webm.

### Отправка тестовых сообщений (fallback при отсутствии setInputFiles в MCP)
```bash
python scripts/send-test-messages.py [--api-url http://localhost:8000]
```
Требует в backend .env: `AUTH_DEBUG=1`, `AUTH_DEBUG_PHONES=+71234567890,+71111111111`, `AUTH_DEBUG_CODE=123456`.

### Playwright E2E
```bash
cd frontend
npm run test:e2e
```
Двухаккаунтные тесты: `E2E_USER_1_PHONE`, `E2E_USER_2_PHONE`, `E2E_USER_1_CODE`, `E2E_USER_2_CODE` (опционально).

Включает тесты пригласительных ссылок:
- вступление по ссылке (залогиненный пользователь);
- редирект на auth при неавторизованном;
- страница-подсказка при `/chat/join` без slug/code.

## Полезные команды

```bash
# только основные сервисы после подготовки .env и миграций
docker compose up -d db redis backend frontend

# миграции вручную в Docker
docker compose exec backend python manage.py migrate

# подключение к Postgres
docker compose exec db psql -U postgres -d chatdb
```

Подробно по Postgres: `docs/postgres-connection.md`.
