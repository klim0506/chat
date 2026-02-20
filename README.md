# Pingy — платформа приватных чатов

React + Django + PostgreSQL + Redis + Celery. E2EE, PWA, i18n (RU/EN).

## Структура проекта

```
├── backend/          # Django API, WebSocket, Celery
├── frontend/         # Vite + React SPA
├── scripts/          # Утилиты и скрипты
│   ├── win/          # BAT-файлы для Windows (start.bat, run_backend.bat и т.д.)
│   ├── deploy-to-server.sh   # Деплой на прод-сервер
│   ├── init-letsencrypt.sh   # Настройка SSL (Let's Encrypt)
│   ├── run_servers.py        # Запуск backend/frontend (обход проблем путей)
│   ├── run_tests.py         # Запуск тестов backend/frontend
│   └── tsconfig.json        # TypeScript для скриптов
├── docker/           # Docker-конфигурации
│   └── nginx/        # Nginx: dev.conf, ssl.conf
├── docs/             # Документация, TODO, WIKI, дизайн-ассеты
├── docker-compose.yml
└── docker-compose.prod.yml
```

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

## Продакшн: запуск на сервере по SSH

Docker-стек с HTTPS (SSL из ISPmanager: `/var/www/httpd-cert/www-root/`).

### 1. Подключиться по SSH

```bash
ssh root@109.172.100.103
```

### 2. Скачать/обновить код из Git

**Первый раз (клон):**
```bash
cd /root
git clone -b release/v1-prod --depth 1 https://github.com/klim0506/chat.git chat-app
cd chat-app
```

**Обновление (залить последние изменения):**
```bash
cd /root/chat-app
git fetch origin
git pull origin release/v1-prod
```

### 3. Подготовить `backend/.env`

```bash
cd /root/chat-app   # или путь к репозиторию
cp backend/.env.production.example backend/.env
```

Отредактировать `backend/.env`:
- `SECRET_KEY` — сгенерировать: `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`
- `MESSAGE_ENCRYPTION_KEY` — сгенерировать: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- `ALLOWED_HOSTS=pingy.com,www.pingy.com`
- `CSRF_TRUSTED_ORIGINS=https://pingy.com,https://www.pingy.com`
- `CORS_ALLOWED_ORIGINS=https://pingy.com`
- `FRONTEND_URL=https://pingy.com`
- SMS, YooKassa, Telegram — по необходимости

### 4. Установить переменные и запустить

```bash
export DOMAIN=pingy.com
export DB_PASSWORD=твой_пароль_postgres

bash scripts/docker-prod-start.sh
```

Скрипт проверит порты 80 и 443; если они заняты — покажет процессы и попросит подтверждение («yes») перед их завершением. Либо запустите вручную:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 5. Первый запуск — миграции и статика

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
docker compose -f docker-compose.prod.yml exec backend python manage.py collectstatic --noinput
```

### 6. Проверка

```bash
docker compose -f docker-compose.prod.yml ps
curl -I https://pingy.com
```

Открыть в браузере: `https://pingy.com`.

### Полезные команды

```bash
# логи
docker compose -f docker-compose.prod.yml logs -f

# перезапуск nginx после обновления сертификата в ISPmanager
docker compose -f docker-compose.prod.yml restart nginx
```

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

**Windows:** запуск из корня: `scripts\win\start.bat` (backend, Celery, frontend). PostgreSQL: `scripts\win\start_postgres.bat`.

Важно: перед `run:all` должны быть доступны БД и Redis.

## Срок действия сессии по типу клиента
- **Веб** (браузер): refresh-токен 7 дней — нужно заново входить раз в неделю.
- **Android / десктоп**: при сборке задаётся `VITE_CLIENT_TYPE=android` или `VITE_CLIENT_TYPE=desktop`; refresh-токен выдаётся на 3 года (до явного выхода).

Фронт отправляет заголовок `X-Client` (из `VITE_CLIENT_TYPE` или `web` по умолчанию). Бэкенд при логине (`verify-code`) выставляет срок жизни refresh-токена в зависимости от этого заголовка.

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
# только core-сервисы без celery/nginx
npm run docker:up:core

# миграции вручную в Docker
docker compose exec backend python manage.py migrate

# подключение к Postgres
docker compose exec db psql -U postgres -d chatdb
```

Подробно по Postgres: `docs/postgres-connection.md`.
