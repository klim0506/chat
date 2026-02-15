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

## Быстрый запуск через Docker (рекомендуется)

Требования: Docker Desktop + Docker Compose.

1. Поднять все сервисы:
```bash
npm run docker:up
```

2. Проверить статус:
```bash
npm run docker:ps
```

3. Логи:
```bash
npm run docker:logs
```

4. Остановить:
```bash
npm run docker:down
```

Доступ:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- Nginx: `http://localhost`
- PostgreSQL: `localhost:5433`

## Запуск через командную строку (локально)

Требования:
- Python `3.12+`
- Node.js `20+`
- PostgreSQL `16+` (или SQLite)
- Redis `7+`

### 1) Инфраструктура
Вариант A: локально установленный PostgreSQL и Redis.

Вариант B (проще): поднять только инфраструктуру в Docker:
```bash
docker compose up -d db redis
```

### 2) Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 3) Frontend
В отдельном терминале:
```bash
cd frontend
npm install
npm run dev
```

### 4) Фоновые сервисы (Celery)
Ещё в двух терминалах:
```bash
cd backend
.venv\Scripts\activate
celery -A config.celery worker -l info
```

```bash
cd backend
.venv\Scripts\activate
celery -A config.celery beat -l info
```

### Запуск всех локальных процессов одной командой
Из корня проекта:
```bash
npm run run:all
```

Важно: перед `run:all` должны быть доступны БД и Redis.

## Переменные окружения backend
Скопируйте `backend/.env.example` в `backend/.env` и заполните:
- `SECRET_KEY`
- `DATABASE_URL` (для Docker-инфры: `postgres://postgres:postgres@localhost:5433/chatdb`)
- `REDIS_URL` (`redis://localhost:6379/0`)
- `REDSMS_LOGIN`, `REDSMS_API_KEY`, `REDSMS_FROM`
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_SECRET`
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
# только core-сервисы без celery/nginx
npm run docker:up:core

# миграции вручную в Docker
docker compose exec backend python manage.py migrate

# подключение к Postgres
docker compose exec db psql -U postgres -d chatdb
```

Подробно по Postgres: `docs/postgres-connection.md`.
