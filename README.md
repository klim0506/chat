# Платформа приватных чатов

React + Django + PostgreSQL. Чаты с авторизацией по SMS (RedSMS), подписками (YooKassa) и real-time сообщениями (WebSocket).

## Требования

- Docker и Docker Compose — или локально: Python 3.12+, Node 20+, PostgreSQL 16, Redis 7

## Запуск через Docker

```bash
docker compose up -d db redis
# Подождать ~10 сек, затем миграции (локально из backend):
cd backend && pip install -r requirements.txt && python manage.py migrate && cd ..
docker compose up -d backend celery celery-beat frontend
# Опционально: nginx на порту 80
docker compose up -d nginx
```

- Frontend: http://localhost:5173  
- Backend API: http://localhost:8000  
- Admin: http://localhost:8000/admin/

## Локальная разработка

### Запуск одной командой

**Windows:** дважды щёлкните по `start.bat` — откроются два окна (бэкенд и фронтенд), миграции применятся автоматически.

**Или из корня проекта:** `npm run run` — бэкенд и фронтенд в одном терминале (нужен `npm install` в корне для `concurrently`).

Остановка: закройте окна или выполните `kill_backend_frontend.bat`.

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
set DATABASE_URL=postgres://postgres:postgres@localhost:5432/chatdb
set REDIS_URL=redis://localhost:6379/0
set SECRET_KEY=dev-secret-key
python manage.py migrate
```
Если PostgreSQL не установлен или не запущен, в файле `backend/.env` укажите `USE_SQLITE=True` — тогда будет использоваться SQLite (файл `db.sqlite3`), миграции и сервер заработают без PostgreSQL.

```bash
python manage.py migrate
python manage.py runserver
```

В отдельных терминалах (нужны только если используете отложенные сообщения и фоновые задачи):
```bash
celery -A config.celery worker -l info
celery -A config.celery beat -l info
```
На Linux/macOS можно в одном процессе: `celery -A config worker -B -l info`. **На Windows** флаг `-B` не поддерживается — запустите worker и beat в двух терминалах (или используйте `run_celery.bat` и `run_celery_beat.bat`).

### Какие сервисы за что отвечают

| Сервис | Обязателен? | Назначение |
|--------|-------------|------------|
| **Backend** (runserver) | Да | API, чаты, авторизация, подписки |
| **Frontend** (npm run dev) | Да | Веб-интерфейс |
| **PostgreSQL** | Нет* | БД (*при USE_SQLITE=True используется SQLite) |
| **Redis** | Рекомендуется | SMS/Telegram коды, кэш, WebSocket, очередь Celery |
| **Celery worker** | Нет | Выполнение фоновых задач (отложенные сообщения и т.д.) |
| **Celery beat** | Нет | Расписание для Celery (когда запускать задачи) |
| **Nginx** | Только деплой | Прокси в продакшене |

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Откройте http://localhost:5173

### Если в браузере 500 или «Чат не найден» / «Не удалось загрузить чаты»

1. **Применить миграции** (после обновления кода с новыми полями, например фон чата):
   ```bash
   cd backend
   python manage.py migrate
   ```
2. **Перезапустить backend** (`python manage.py runserver` или через Docker).
3. Убедиться, что backend слушает порт **8000** — фронт на 5173 проксирует туда `/api` и `/ws`.

## Переменные окружения (backend)

Скопируйте `backend/.env.example` в `backend/.env`.

- `SECRET_KEY` — секрет Django  
- `DATABASE_URL` — postgres://user:pass@host:5432/dbname  
- `REDIS_URL` — redis://localhost:6379/0 (обязателен для входа по SMS и **для входа через Telegram**)  
- `REDSMS_LOGIN`, `REDSMS_API_KEY`, `REDSMS_FROM` — для SMS (RedSMS)  
- `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_SECRET` — для входа через Telegram (бот должен вызывать API подтверждения кода)  
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` — для платежей  
- `CORS_ALLOWED_ORIGINS` — разрешённые origin (через запятую)

## Деплой

**Пошаговая инструкция по развёртыванию по SSH (без Docker и Git):** [docs/deploy-ssh.md](docs/deploy-ssh.md) — архив, backend, frontend, nginx, Redis, Celery, systemd и типичные ошибки.

Кратко:  
2. Backend: `migrate`, `collectstatic`, запуск через Daphne. Celery worker + beat.  
3. Frontend: `npm run build`, раздача `dist/` через Nginx.  
4. Nginx: проксировать `/api/`, `/admin/`, `/media/`, `/ws/` на backend; `/` на фронт.  
5. В YooKassa указать webhook: `https://ваш-домен/api/payments/webhook/`
