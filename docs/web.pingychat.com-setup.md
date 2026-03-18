# Лендинг и Wiki на pingychat.com, приложение на https://web.pingychat.com

Схема: **pingychat.com** (и www) — лендинг (/) и Wiki (/wiki, /wiki/*); **web.pingychat.com** — только веб-приложение (вход, чаты, загрузки). Один и тот же SPA-билд отдаётся с обоих доменов; поведение выбирается в рантайме по `window.location.hostname`. Все ссылки «Войти», «Скачать», «Мессенджер» на лендинге и в Wiki ведут на https://web.pingychat.com. Клиенты Android/Desktop/iOS открывают только web.pingychat.com.

## Авторизация: куки и JWT, 30 дней

После входа на **web.pingychat.com** авторизация держится на этом браузере/устройстве **30 дней**:

- **Refresh-токен** сохраняется в **httpOnly-куке** (`refresh_token`, `Max-Age=30 дней`, `Secure`, `SameSite=Lax`). Кука отдаётся только при запросах на тот же сайт, недоступна из JavaScript (защита от XSS).
- **Access-токен (JWT)** приходит в теле ответа при логине и при обновлении по `/api/auth/refresh/`; фронт кладёт его в память и в заголовок `Authorization: Bearer <token>` для API. Срок жизни access — 1 час; при истечении клиент запрашивает новый по refresh (кука уходит автоматически с `credentials: true`).
- При открытии сайта без токенов в памяти фронт один раз вызывает `POST /api/auth/refresh/` (без тела); бэкенд читает refresh из куки и возвращает новый access + данные пользователя — сессия восстанавливается без повторного ввода кода.
- Срок «30 дней» задаётся в бэкенде: `REFRESH_COOKIE_MAX_AGE_DAYS=30` (по умолчанию; можно переопределить в `.env`). И срок жизни JWT refresh-токена для web, и срок жизни куки берутся из этой настройки.
- При явном выходе (logout) кука удаляется и сессия на сервере деактивируется.

## 1. Backend (.env)

В `backend/.env` должны быть:

- **FRONTEND_URL=https://web.pingychat.com** — ссылки-приглашения и редиректы ведут на поддомен.
- **ALLOWED_HOSTS** — включены `pingychat.com`, `www.pingychat.com`, `web.pingychat.com` при необходимости.
- **CSRF_TRUSTED_ORIGINS** и **CORS_ALLOWED_ORIGINS** — включён `https://web.pingychat.com` (и при необходимости маркетинговые домены).
- **REFRESH_COOKIE_MAX_AGE_DAYS** — опционально; по умолчанию 30 (дней хранения авторизации в браузере).

Готовый шаблон: `backend/.env.production.pingychat` (уже с web.pingychat.com).

## 2. DNS

- **Корень и www** — лендинг + Wiki: A-записи `@` и `www` → 109.172.100.103 (или ваш IP).
- **Поддомен web** — приложение: A-запись `web` → 109.172.100.103.

**Если web.pingychat.com не открывается:** на хосте в Nginx (или ISP Manager) должен быть отдельный server-блок с `server_name web.pingychat.com`, проксирующий на тот же upstream, что и основной сайт. Готовый конфиг с обоими доменами: `docker/nginx/ispmanager-pingychat.com.conf.backup` — скопировать на сервер и перезагрузить nginx.

| Тип  | Имя | Значение        |
|------|-----|-----------------|
| A    | @   | 109.172.100.103 |
| A    | www | 109.172.100.103 |
| A    | web | 109.172.100.103 |

Проверка: `ping pingychat.com`, `ping web.pingychat.com` — оба указывают на сервер.

## 3. SSL (HTTPS)

Один сертификат на все три хоста (проще всего):

```bash
sudo certbot certonly --nginx -d pingychat.com -d www.pingychat.com -d web.pingychat.com
```

Сертификаты: `/etc/letsencrypt/live/pingychat.com/` (или первый домен из списка). В Nginx для обоих server-блоков укажите те же `ssl_certificate` и `ssl_certificate_key`.

## 4. Nginx: два server-блока, один и тот же root

На **pingychat.com** и **web.pingychat.com** отдаётся один и тот же каталог с собранным SPA (один билд). Различие: на pingychat.com/www нет прокси к бэкенду (API/WS не используются); на web.pingychat.com — есть прокси к бэкенду.

### 4.1. pingychat.com и www — лендинг + Wiki (тот же SPA, без proxy)

`root` — тот же каталог, что и для приложения (например `/var/www/pingychat.com/frontend` или `/var/www/frontend`). SPA по hostname показывает только лендинг (/) и Wiki (/wiki/*); маршруты приложения на этом домене редиректят на web.pingychat.com.

```nginx
server {
    listen 443 ssl http2;
    server_name pingychat.com www.pingychat.com;

    ssl_certificate     /etc/letsencrypt/live/pingychat.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pingychat.com/privkey.pem;

    root /var/www/frontend;   # тот же каталог, что и для web
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Прокси к бэкенду не нужен: API и WebSocket на маркетинговом домене не вызываются.

### 4.2. web.pingychat.com — приложение (SPA + API/WS)

Тот же `root`; дополнительно — проксирование `/api/`, `/ws/`, `/media/`, `/admin/`, `/static/` на бэкенд.

```nginx
server {
    listen 443 ssl http2;
    server_name web.pingychat.com;

    ssl_certificate     /etc/letsencrypt/live/pingychat.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pingychat.com/privkey.pem;

    root /var/www/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /media/ { proxy_pass http://127.0.0.1:8000; }
    location /admin/ { proxy_pass http://127.0.0.1:8000; }
    location /static/ { proxy_pass http://127.0.0.1:8000; }
}
```

В проекте полный пример для Docker: `docker/nginx/ssl.conf` (два server-блока с `server_name pingychat.com www.pingychat.com` и `server_name web.pingychat.com`).

## 5. Сборка фронта (Vite)

Один билд для обоих доменов:

```bash
cd frontend
VITE_APP_URL=https://web.pingychat.com VITE_LANDING_AT_ROOT=true npm run build
```

Либо в `frontend/.env.production`:

```
VITE_APP_URL=https://web.pingychat.com
VITE_LANDING_AT_ROOT=true
```

Результат (`dist/`) копируется в один каталог (например `/var/www/frontend`), который указан как `root` в **обоих** server-блоках Nginx.

- **VITE_LANDING_AT_ROOT=true** — на web.pingychat.com корень `/` сразу редиректит в `/auth` или `/chats`; на pingychat.com SPA по hostname показывает лендинг на `/` и Wiki на `/wiki/*`.
- **VITE_APP_URL** — подставляется в canonical, og:url; используется как APP_BASE_URL для ссылок (вход, загрузки), если не задан **VITE_WEB_APP_URL**.
- **VITE_WEB_APP_URL** — базовый URL приложения (auth, чаты, загрузки). Если задан, все ссылки с лендинга ведут сюда; иначе используется VITE_APP_URL.
- **VITE_MARKETING_HOSTS** — через запятую хосты, на которых показывать лендинг и Wiki (по умолчанию `pingychat.com,www.pingychat.com`). При деплое на один домен можно задать его сюда.
- **VITE_ANDROID_APK_URL** — прямая ссылка на APK; если не задана, используется `APP_BASE_URL/downloads/android/Pingy.apk`. Задайте, если APK раздаётся с другого домена/CDN.

Поведение по домену реализовано во фронте: `frontend/src/lib/host.ts` (APP_BASE_URL, маркетинговые хосты, `isMarketingSite()`), маршруты в `App.tsx` разведены по hostname.

## 6. Клиенты (Android, Desktop, iOS)

Все клиенты должны открывать только **https://web.pingychat.com** (не pingychat.com). Android уже настроен так; для Desktop и iOS при наличии — проверить стартовый URL в конфиге/WebView.

## Итог

1. **DNS:** pingychat.com, www.pingychat.com, web.pingychat.com → ваш IP.  
2. **SSL:** один certbot на все три хоста.  
3. **Nginx:** два server — (1) pingychat.com + www → тот же root, без proxy; (2) web.pingychat.com → тот же root + proxy на бэкенд.  
4. **Backend .env:** FRONTEND_URL=https://web.pingychat.com, ALLOWED_HOSTS/CORS при необходимости с обоими доменами.  
5. **Фронт:** один билд, один деплой в один каталог; поведение по hostname (лендинг и Wiki на pingychat.com, приложение на web.pingychat.com).  
6. **Клиенты:** открывают только web.pingychat.com.

В итоге: лендинг и Wiki на https://pingychat.com (и www), приложение (вход, чаты, загрузки) на https://web.pingychat.com.

## Диагностика: 502 при оплате (POST /api/payments/subscribe/)

Если при нажатии «Оформить подписку» приходит **502 Bad Gateway**, бэкенд не смог создать платёж в YooKassa. Что проверить:

1. **Переменные YooKassa** в `backend/.env` на сервере:
   - `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY` заданы и соответствуют кабинете [YooKassa](https://yookassa.ru).
2. **Логи бэкенда** — при 502 в логах приложения теперь пишется полное исключение (например, ошибка авторизации, таймаут, недоступность API). Запуск через gunicorn/uwsgi: смотреть логи процесса (journalctl, supervisor, docker logs).
3. **Доступ с сервера к API YooKassa** — нет ли файрвола/прокси, блокирующего исходящие запросы к `api.yookassa.ru`.
4. **Статус YooKassa** — на [status.yookassa.ru](https://status.yookassa.ru) не должно быть сбоев.

После исправления конфигурации перезапустите бэкенд.

## Диагностика: WebSocket не подключается

Если в консоли браузера на web.pingychat.com видны ошибки вида **WebSocket connection to 'wss://web.pingychat.com/ws/notifications/' failed** или **.../ws/chat/... failed**, это почти всегда значит, что бэкенд (Daphne) не отвечает на порту 8000. Nginx проксирует `/ws/` на бэкенд; при недоступности upstream WebSocket не устанавливается.

Пошаговая диагностика и чеклист: **[Устранение ошибок 502 и WebSocket](troubleshooting-502-websocket.md)**.
