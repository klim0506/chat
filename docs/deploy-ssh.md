# Быстрый деплой по SSH (без Docker и Git)

Развёртывание проекта на VPS по SSH: загрузка архива, бэкенд, фронтенд, nginx, Redis, Celery, systemd.

---

## Требования на сервере

- **ОС:** Linux (Ubuntu 20.04/22.04 или аналог)
- **Пакеты:** Python 3.12+, Node.js 18+, nginx, Redis, unzip

Установка недостающего (на сервере):

```bash
apt update
apt install -y python3 python3-venv python3-pip nodejs npm nginx redis-server unzip
```

---

## 1. Подготовка архива (на своём ПК)

В **корне проекта** (где лежат папки `backend`, `frontend` и файл `ТЕЛЕГА.ico`).

### Windows (PowerShell или Git Bash)

Обязательно включите **ТЕЛЕГА.ico** — без него сборка фронта упадёт.

```bash
tar --exclude=node_modules --exclude=backend/.venv --exclude=backend/__pycache__ --exclude="*/__pycache__" -czvf project.tar.gz backend frontend beautiful-vertical-landscape.jpg "ТЕЛЕГА.ico"
```

Если `tar` с кириллицей глючит, упакуйте вручную в ZIP: папки `backend`, `frontend`, файлы `beautiful-vertical-landscape.jpg` и `ТЕЛЕГА.ico`. Иконку потом можно загрузить отдельным архивом (см. ниже).

### Загрузка на сервер

```bash
scp project.tar.gz root@IP_СЕРВЕРА:/root/
```

Если используете ZIP и отдельно иконку:

```bash
scp project.zip root@IP_СЕРВЕРА:/root/
# Иконка отдельно (если не вошла в архив):
# Создайте telega.zip с одним файлом ТЕЛЕГА.ico и: scp telega.zip root@IP:/root/chat-app/
```

---

## 2. На сервере: распаковка

```bash
ssh root@IP_СЕРВЕРА
cd /root
mkdir -p chat-app
tar -xzf project.tar.gz -C chat-app
# Если был ZIP:
# unzip -o project.zip -d chat-app
ls -la chat-app/
# Должны быть: backend, frontend, beautiful-vertical-landscape.jpg, ТЕЛЕГА.ico
```

Если **ТЕЛЕГА.ico** не было в архиве — положите его в `/root/chat-app/` (отдельный ZIP распаковать в эту папку). Без него `npm run build` упадёт с ошибкой про `ТЕЛЕГА.ico?url`.

---

## 3. Backend

```bash
cd /root/chat-app/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Файл .env

Скопируйте и отредактируйте (или создайте из примера):

```bash
nano .env
```

**Обязательно:**

- `SECRET_KEY` — длинная случайная строка
- `ALLOWED_HOSTS=ваш-домен.ru,109.172.100.103` (или ваш IP)
- `DEBUG=False`
- `FRONTEND_URL=https://ваш-домен.ru` или `http://109.172.100.103`
- **`CORS_ALLOWED_ORIGINS`** — **без слэша в конце.** Правильно: `http://109.172.100.103`. Неправильно: `http://109.172.100.103/`
- БД: либо `USE_SQLITE=True`, либо `DATABASE_URL=postgres://...`
- `REDIS_URL=redis://localhost:6379/0` (для Celery и WebSocket)

Сохраните (Ctrl+O, Enter), выйдите (Ctrl+X).

### Миграции и статика

```bash
python manage.py migrate
python manage.py collectstatic --noinput
deactivate
```

---

## 4. Frontend

```bash
cd /root/chat-app/frontend
npm install
chmod +x node_modules/.bin/*
npm run build:prod
```

Если при сборке появляется **`Permission denied`** (архив с Windows не сохраняет права) — команда `chmod +x node_modules/.bin/*` исправляет это. Если команды `build:prod` нет — используйте `npm run build` или `npx vite build`. Должна появиться папка `dist/`.

---

## 5. Redis

Нужен для Celery и (при необходимости) для кэша/WebSocket.

```bash
systemctl enable redis-server
systemctl start redis-server
redis-cli ping
# Ответ: PONG
```

---

## 6. Nginx

Если на 80 порту висит **старый проект** (например, Apache или другой сайт), сначала остановите его:

```bash
systemctl stop apache2
systemctl disable apache2
# Или найдите, кто слушает 80: ss -tlnp | grep ':80 '
```

Создайте конфиг для чата:

```bash
nano /etc/nginx/sites-available/chat
```

Вставьте (подставьте свой `server_name` и при необходимости путь):

```nginx
server {
    listen 80;
    server_name 109.172.100.103;
    client_max_body_size 200M;

    root /root/chat-app/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }
    location /media/ {
        proxy_pass http://127.0.0.1:8000;
    }
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Подключите сайт и перезагрузите nginx:

```bash
ln -sf /etc/nginx/sites-available/chat /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## 7. Systemd: backend и Celery

### Backend (Daphne)

```bash
nano /etc/systemd/system/chat-backend.service
```

```ini
[Unit]
Description=Chat Django ASGI (Daphne)
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=/root/chat-app/backend
Environment="PATH=/root/chat-app/backend/.venv/bin"
ExecStart=/root/chat-app/backend/.venv/bin/daphne -b 127.0.0.1 -p 8000 config.asgi:application
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Celery worker

```bash
nano /etc/systemd/system/chat-celery.service
```

```ini
[Unit]
Description=Chat Celery Worker
After=network.target redis-server.service

[Service]
User=root
Group=root
WorkingDirectory=/root/chat-app/backend
Environment="PATH=/root/chat-app/backend/.venv/bin"
EnvironmentFile=/root/chat-app/backend/.env
ExecStart=/root/chat-app/backend/.venv/bin/celery -A config.celery worker -l info
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Celery beat

```bash
nano /etc/systemd/system/chat-celery-beat.service
```

```ini
[Unit]
Description=Chat Celery Beat
After=network.target redis-server.service

[Service]
User=root
Group=root
WorkingDirectory=/root/chat-app/backend
Environment="PATH=/root/chat-app/backend/.venv/bin"
EnvironmentFile=/root/chat-app/backend/.env
ExecStart=/root/chat-app/backend/.venv/bin/celery -A config.celery beat -l info
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Запуск и автозапуск

```bash
systemctl daemon-reload
systemctl enable chat-backend chat-celery chat-celery-beat
systemctl start chat-backend chat-celery chat-celery-beat
```

---

## 8. HTTPS (по желанию)

Только если у вас настроен домен (A-запись на IP сервера):

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.ru
```

В `.env` бэкенда после этого укажите `FRONTEND_URL=https://ваш-домен.ru` и `CORS_ALLOWED_ORIGINS=https://ваш-домен.ru` (без слэша в конце) и перезапустите backend: `systemctl restart chat-backend`.

---

## 9. Проверка, что всё работает

```bash
echo "=== Сервисы ==="
for s in chat-backend nginx redis-server chat-celery chat-celery-beat; do
  printf "  %-20s %s\n" "$s" "$(systemctl is-active $s 2>/dev/null || echo '—')"
done
echo ""
echo "=== Порты ==="
ss -tlnp | grep -E ':(80|6379|8000)\s'
echo ""
echo "=== Ответы ==="
printf "  API:   "; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/api/
printf "  Сайт: "; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/
printf "  Redis: "; redis-cli ping
```

Откройте в браузере: **http://109.172.100.103** (или ваш домен). Должна открыться страница входа чата.

---

## Частые ошибки и правки

| Проблема | Решение |
|--------|--------|
| `CORS_ALLOWED_ORIGINS ... should not have path` | В `.env` убрать слэш в конце: `http://109.172.100.103`, не `http://109.172.100.103/` |
| `EISDIR` при `vite build` (index.html) | В `index.html` убран `<link rel="canonical" href="/" />` — он приводил к попытке прочитать каталог. Используйте сборку из репозитория с этой правкой. |
| `Cannot find module 'path'` / `__dirname` в vite.config | В `tsconfig.node.json` добавлено `"types": ["node"]`, в devDependencies — `@types/node`. Выполнить `npm install`. |
| `Could not resolve ... ТЕЛЕГА.ico?url` | Файл `ТЕЛЕГА.ico` должен лежать в `/root/chat-app/` (рядом с `frontend`). Добавить в архив или загрузить отдельно и распаковать в chat-app. |
| Открывается старый сайт, а не чат | Остановить Apache (или другой веб-сервер на 80): `systemctl stop apache2`. Либо в nginx отключить старый site в `sites-enabled`. |
| `Unit chat-backend.service not found` | Создать unit-файлы вручную (см. раздел 7) и выполнить `systemctl daemon-reload`. |
| Redis: `Connection refused` | Установить и запустить: `apt install redis-server && systemctl start redis-server`. |
| `sh: 1: vite: Permission denied` (или `tsc: Permission denied`) | После распаковки архива с Windows у бинарников в `node_modules/.bin/` нет прав. Выполнить: `chmod +x node_modules/.bin/*`, затем снова `npm run build:prod`. |

---

## Краткая шпаргалка команд

- Остановить чат: `systemctl stop chat-celery-beat chat-celery chat-backend`
- Запустить чат: `systemctl start chat-backend chat-celery chat-celery-beat`
- Логи backend: `journalctl -u chat-backend -f`
- Логи Celery: `journalctl -u chat-celery -f`
