# PingyChat — платформа приватных чатов

PingyChat — мессенджер с входом по номеру телефона и доставкой сообщений в реальном времени. Основной клиент работает в браузере. Клиенты для Android и Windows подключены отдельными Git-подмодулями.

[Возможности](#возможности) · [Архитектура](#архитектура) · [Структура репозитория](#структура-репозитория) · [Быстрый запуск](#быстрый-запуск) · [Конфигурация](#конфигурация) · [Развёртывание](#развёртывание) · [Эксплуатация](#эксплуатация) · [Тестирование](#тестирование)

## Возможности

- Вход по одноразовому коду через SMS или Telegram. Управление активными сессиями и настройки приватности.
- Личные и групповые чаты. В группах есть роли, пригласительные ссылки и вступление с одобрением для закрытых чатов.
- Текст, вложения, голосовые и видеосообщения. Реакции, ответы, пересылка, закрепление и отметки о прочтении.
- Отложенные и повторяющиеся сообщения. Фоновые задачи выполняет Celery.
- Подписки, реферальные ссылки и звёзды для расширения лимита участников чата.
- В плане тестирования описан режим сквозного шифрования для личных чатов. При выпуске проверяйте его отдельно, включая вход с нескольких устройств. [План тестирования](TODO.md#13-e2ee-режим-для-личных-чатов)

Инструкции по работе с чатами, приглашениями и реферальной программой собраны в [пользовательской Wiki](WIKI.md).

## Архитектура

```mermaid
flowchart LR
    C["Веб-клиент и приложения"]
    N["Nginx"]
    F["Веб-сборка React / Vite"]
    A["Django / Daphne (ASGI)"]
    P[("PostgreSQL")]
    R[("Redis")]
    M[("Хранилище вложений")]
    B["Celery Beat"]
    W["Celery Worker"]
    I["SMS, Telegram, ЮKassa"]

    C -->|"HTTPS / WSS"| N
    N -->|"Статика и маршруты SPA"| F
    N -->|"/api/, /admin/, /ws/"| A
    A --> P
    A -->|"События и постановка задач"| R
    A --> M
    A --> I
    B -->|"Плановые задачи"| R
    R -->|"Очередь задач"| W
    W --> P
    W --> M
```

В production Nginx завершает TLS, отдаёт веб-сборку и проксирует HTTP API и WebSocket в Daphne. Django обрабатывает вход, права доступа, чаты, сообщения и файлы. PostgreSQL хранит данные приложения, включая аккаунты, чаты и историю сообщений. Redis обслуживает обмен событиями и очередь Celery. Вложения хранятся отдельно от БД. В Docker их том доступен Django и Celery Worker.

Например, при отправке сообщения Django проверяет доступ к чату и сохраняет данные, а подключённые клиенты получают обновление через WebSocket. Для отложенной отправки Beat ставит задачу в очередь, а Worker её выполняет. При диагностике действуйте по этому маршруту от клиента до хранилища или очереди.

## Структура репозитория

| Раздел | Назначение |
| --- | --- |
| [frontend/](frontend/) | Основной веб-клиент React/Vite, сборка интерфейса и браузерные тесты. |
| [backend/](backend/) | Django, HTTP API, ASGI/WebSocket, миграции и задачи Celery. |
| [Android](https://github.com/klim0506/private-chats-android), [Desktop](https://github.com/klim0506/private-chats-desktop) | Подмодули `android/` и `desktop/`. Основной репозиторий фиксирует ревизию каждого клиента. [Настройки подмодулей](.gitmodules) |
| [docs/](docs/), [WIKI.md](WIKI.md), [SECURITY.md](SECURITY.md), [TODO.md](TODO.md) | Документация, пользовательская справка, настройки безопасности, бэклог и план тестирования. |
| [scripts/](scripts/) | Вспомогательные сценарии разработки, тестирования и подготовки файлов для скачивания. |
| [docker-compose.yml](docker-compose.yml), [docker-compose.prod.yml](docker-compose.prod.yml) | Локальный HTTP-стек с Vite и серверный HTTPS-стек со статической веб-сборкой. |
| [nginx.conf](nginx.conf), [nginx.ssl.conf](nginx.ssl.conf), [pingychat.com.conf](pingychat.com.conf) | Прокси для разработки, шаблон Nginx для production Compose и конфигурация конкретного хоста. |
| [package.json](package.json), [src/](src/) | Корневые команды npm и отдельная конфигурация Next.js. Сборка основного веб-клиента выполняется из `frontend/`. |

Для сервера и веб-разработки достаточно обычного клона. Для работы с нативными клиентами получите доступ к их репозиториям и выполните `git submodule update --init --recursive`. Корневой `package.json` содержит команды `npm run android:build` и `npm run desktop:build`. Требования к сборке и подписыванию дистрибутивов смотрите в репозиториях самих клиентов.

В Git есть `main`, `dev` и ветки `release/*`. Для развёртывания зафиксируйте проверенный коммит выбранной ветки и сохраните SHA предыдущего выпуска для отката.

## Быстрый запуск

Нужны Git, доступ к закрытому репозиторию, Docker Desktop или Docker Engine и плагин Docker Compose с поддержкой `up --wait`.

```bash
git clone https://github.com/klim0506/chat.git
cd chat
```

Из корня репозитория создайте `backend/.env` из `backend/.env.example` при первом запуске. В PowerShell выполните `Copy-Item backend/.env.example backend/.env`, в Bash — `cp backend/.env.example backend/.env`.

Укажите `USE_SQLITE=False` в `backend/.env`. Запустите PostgreSQL и Redis, примените миграции, затем поднимите приложение.

```bash
docker compose up -d --wait db redis
docker compose run --rm --build backend python manage.py migrate
docker compose up -d --build
```

| Сервис | Адрес в разработке |
| --- | --- |
| Веб-клиент Vite | [http://localhost:5173](http://localhost:5173) |
| Django / Daphne | `http://localhost:8000`, WebSocket под `/ws/` |
| Nginx | [http://localhost](http://localhost) |
| PostgreSQL | `localhost:5433` с хоста, `db:5432` из контейнеров |
| Redis | `localhost:6379` с хоста, `redis:6379` из контейнеров |

`docker compose ps` показывает состояние сервисов, `docker compose logs -f` выводит логи, `docker compose down` останавливает стек с сохранением именованных томов. После подготовки БД можно поднять только нужные для разработки сервисы командой `docker compose up -d db redis backend frontend`.

### Разработка в Windows

Установите Python 3.12+ и Node.js 20+. Подготовьте `backend/.env`. Если Django запускается на хосте, а PostgreSQL и Redis — в Docker, выполните `docker compose up -d --wait db redis` и укажите в `backend/.env`:

```dotenv
USE_SQLITE=False
DATABASE_URL=postgres://postgres:postgres@localhost:5433/chatdb
REDIS_URL=redis://localhost:6379/0
```

Для локальной разработки на SQLite установите `USE_SQLITE=True` и оставьте Redis доступным. Для PostgreSQL и Redis на другом хосте укажите их адреса. Команды для Django выполняйте в PowerShell из корня репозитория.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DJANGO_SETTINGS_MODULE = 'config.settings.dev'
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

В другом терминале запустите клиент из папки `frontend/`.

```powershell
npm.cmd install
npm.cmd run dev
```

Для фоновых задач и расписания откройте два терминала в папке `backend/`. В каждом установите `$env:DJANGO_SETTINGS_MODULE = 'config.settings.dev'`. В первом выполните `.\.venv\Scripts\celery.exe -A config.celery worker --pool=solo -l info`, во втором — `.\.venv\Scripts\celery.exe -A config.celery beat -l info`. Останавливайте локальные процессы через `Ctrl+C`.

## Конфигурация

| Где задаётся | Параметры |
| --- | --- |
| `backend/.env` | `SECRET_KEY`, `USE_SQLITE`, `DATABASE_URL`, `REDIS_URL`, `CELERY_BROKER_URL`. Для публичного запуска также задайте `ALLOWED_HOSTS`, разрешённые источники фронтенда по шаблону выбранной версии и отключите отладку. |
| Вход по телефону | RedSMS использует `REDSMS_LOGIN`, `REDSMS_API_KEY`, `REDSMS_FROM`. Для Telegram предусмотрены `TELEGRAM_BOT_USERNAME` и `TELEGRAM_BOT_SECRET`, для Telegram Gateway — `TELEGRAM_GATEWAY_TOKEN`. Настройте и проверьте выбранный способ доставки на тестовом номере. |
| Оплата | `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY`. Перед включением платежей проверьте уведомления провайдера и изменение статуса подписки в тестовом окружении. |
| Окружение production Compose | `DOMAIN` задаёт имя для Nginx, `DB_PASSWORD` используется при создании PostgreSQL и в строке подключения. `PWA_INSTALL_ENABLED` передаётся в сборку веб-клиента как `VITE_PWA_INSTALL_ENABLED`. |
| Сборка Vite | Production Compose передаёт пустые `VITE_API_URL` и `VITE_WS_URL` для запросов к тому же домену. При раздельных доменах проверьте адреса API/WS, CORS и работу авторизации. |

Compose задаёт часть переменных прямо в `environment`. Они имеют приоритет над значениями из `backend/.env`. В частности, production Compose подставляет собственные `DATABASE_URL`, `REDIS_URL` и `CELERY_BROKER_URL`. Передавайте `DB_PASSWORD` явно, поскольку конфигурация содержит пароль по умолчанию. Для уже созданного тома пароль роли PostgreSQL меняется в самой БД, после чего обновляется конфигурация приложения. [Приоритет переменных Compose](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/)

## Развёртывание

### Как выбрать размещение

| Сценарий | Размещение |
| --- | --- |
| Первый публичный запуск или небольшая нагрузка | Один Linux VPS с Docker Compose. Публично доступны Nginx на 80/443 и SSH с ограничением доступа. PostgreSQL, Redis и Daphne остаются во внутренней сети. Для первоначальной оценки можно начать с 2–4 vCPU и 4–8 ГБ RAM. Объём SSD рассчитывайте по росту вложений, БД и логов. Пересмотрите ресурсы после замеров на реальной нагрузке. |
| Сервер с готовым Nginx и systemd | Nginx на хосте завершает TLS и раздаёт веб-сборку. Daphne, Celery Worker и Beat запускаются отдельными службами. Такой вариант подходит, когда веб-сервер уже обслуживает другие сайты. |
| Рост нагрузки или требования к восстановлению | Вынесите PostgreSQL с резервным копированием и Redis в закрытую сеть или управляемые сервисы. При нескольких экземплярах Django обеспечьте общее хранилище медиа и общий Redis. Масштабируйте Worker отдельно. Держите один экземпляр Beat на расписание, чтобы избежать повторной постановки задач. |

Для staging выделите отдельный домен, секреты, БД и хранилище. Если staging и production размещены на одном хосте, разведите имена проектов Compose и заведите общий входной прокси, чтобы сервисы могли работать без конфликта за 80/443. [Docker Compose в production](https://docs.docker.com/compose/how-tos/production/)

При выносе БД и Redis подготовьте собственный Compose override. Обновите адреса в `environment` для `backend`, `celery` и `celery-beat` и связанные зависимости `depends_on`. Проверьте подключение из каждого сервиса по закрытой сети.

### Docker Compose на Linux

Команды ниже рассчитаны на новую установку с выделенными портами 80/443. Направьте DNS-запись домена на сервер. Если опубликована запись AAAA, проверьте доступность по IPv6. Для проверки HTTP-01 Let's Encrypt должен иметь доступ к серверу на порту 80. [Проверки домена Let's Encrypt](https://letsencrypt.org/docs/challenge-types/)

1. Получите закрытый репозиторий под учётной записью с доступом на чтение и переключитесь на проверенный коммит. Подготовьте `backend/.env` на основе `backend/.env.production.example`, указанного в production Compose. Заполните уникальный `SECRET_KEY`, домен в `ALLOWED_HOSTS`, настройки входа и прочих используемых интеграций. Для доверенных источников CORS и CSRF укажите полный origin с `https://`, если он требуется в шаблоне выбранной версии. Проверьте `USE_SQLITE=False`, `DEBUG=False` и `AUTH_DEBUG=0`. Ограничьте доступ к `backend/.env`.
2. Создайте вне репозитория файл `$HOME/.config/pingychat/compose.env` с правами `600`. Его формат показан ниже. Задайте уникальный пароль PostgreSQL, например сгенерированный через `openssl rand -hex 32`. Это позволяет использовать его в URL подключения без экранирования специальных символов. Убедитесь, что ранее экспортированные `DOMAIN` и `DB_PASSWORD` в оболочке не перекрывают значения из файла.

   ```dotenv
   DOMAIN=chat.example.com
   DB_PASSWORD=ЗАМЕНИТЬ_НА_СЛУЧАЙНЫЙ_ПАРОЛЬ
   ```

3. Из корня репозитория в Bash выполните проверку конфигурации, поднимите БД и Redis, затем подготовьте Django. Разберите предупреждения `check --deploy` перед открытием доступа к сайту.

   ```bash
   dc() {
     docker compose --env-file "$HOME/.config/pingychat/compose.env" -f docker-compose.prod.yml "$@"
   }

   dc config --quiet
   dc up -d --wait db redis
   dc run --rm --build --no-deps backend python manage.py check --deploy
   dc run --rm --no-deps backend python manage.py migrate
   dc run --rm --no-deps backend python manage.py collectstatic --noinput
   ```

4. На новой установке получите сертификат для своего домена. Пока порт 80 свободен, используйте отдельный запуск Certbot. После запуска Nginx переключите продление на webroot, который смонтирован в Nginx и Certbot. Укажите свой домен и адрес электронной почты вместо примеров.

   ```bash
   dc run --rm --no-deps -p 80:80 --entrypoint certbot certbot \
     certonly --standalone --non-interactive --agree-tos \
     --email admin@example.com --cert-name chat.example.com -d chat.example.com

   dc up -d --build

   dc run --rm --no-deps --entrypoint certbot certbot \
     reconfigure --cert-name chat.example.com --webroot --webroot-path /var/www/certbot

   dc run --rm --no-deps --entrypoint certbot certbot renew --dry-run
   dc exec nginx nginx -t
   dc ps -a
   ```

   Статическую сборку кладёт в общий том сервис `frontend-build`. После успешной публикации файлов он должен завершиться с кодом 0. Если порт 80 занят хостовым Nginx, используйте установку с Nginx на хосте либо настройте HTTP-01 через уже работающий прокси. В репозитории также есть [init-letsencrypt.sh](init-letsencrypt.sh) для первичного выпуска на пустом томе. При повторном запуске он удаляет файлы сертификата и его продления для указанного домена. [Certbot: сертификаты и продление](https://eff-certbot.readthedocs.io/en/stable/using.html)

5. Проверьте HTTPS снаружи сервера, вход, переписку между двумя аккаунтами, загрузку и скачивание вложения и выполнение отложенной отправки. Убедитесь, что прямые ссылки на приватные файлы отклоняются, включая пути под `/media/`, поскольку production-шаблон проксирует этот префикс в Django. [Проверки Django перед выпуском](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)

### Установка с Nginx и systemd на хосте

1. Подготовьте Linux-сервер, PostgreSQL, Redis, рабочий каталог приложения и отдельного системного пользователя. Дайте ему доступ к окружению и записи в каталог медиа. Установите зависимости backend в виртуальное окружение и настройте `backend/.env` под адреса хоста.
2. С настройками `config.settings.prod` выполните `python manage.py check --deploy`, `python manage.py migrate` и `python manage.py collectstatic --noinput`. В `frontend/` установите зависимости и выполните `npm run build`. Опубликуйте содержимое `frontend/dist/` в корне сайта Nginx.
3. Создайте службы systemd для Daphne (`daphne -b 127.0.0.1 -p 8000 config.asgi:application`), Worker (`celery -A config.celery worker -l info`) и Beat (`celery -A config.celery beat -l info`). Укажите абсолютные пути к программам из виртуального окружения, рабочую папку backend и production-окружение каждой службы.
4. Настройте TLS, SPA fallback, `/api/`, `/admin/` и WebSocket `/ws/` с заголовками `Upgrade` и `Connection`. Для статики и вложений применяйте политику доступа проекта. Проверьте, что приватные файлы доступны через авторизованный или подписанный маршрут, а прямые ссылки на них отклоняются.
5. Файл [pingychat.com.conf](pingychat.com.conf) показывает конфигурацию конкретного хоста с привязками к его IP, путям и сертификатам. Для новой установки адаптируйте маршруты, используйте TLS 1.2/1.3 и выполните `nginx -t` перед перезагрузкой. [deploy-to-server.sh](deploy-to-server.sh) также привязан к конкретному хосту, ветке и службам. Перед использованием проверьте пути, наличие копируемых файлов и команды обновления.

## Эксплуатация

### Резервные копии и обновления

- Копируйте PostgreSQL, пользовательские вложения из `backend_media` и конфигурацию с секретами. Для переноса HTTPS сохраните также `certbot_conf` либо заново выпустите сертификат. Шифруйте резервные копии и храните их отдельно от сервера. Для согласованной копии БД и файлов используйте снимки или окно без записи.
- Для PostgreSQL в production Compose можно сделать логический дамп командой `dc exec -T db pg_dump -U postgres -Fc chatdb > chatdb.dump`. Запускайте её с правами доступа к файлам только для владельца и проверяйте код завершения. Регулярно восстанавливайте копии в отдельную БД и проверяйте вход, исторические сообщения и вложения. [Резервные копии PostgreSQL](https://www.postgresql.org/docs/16/app-pgdump.html)
- Перед обновлением сохраните SHA рабочей версии, снимите резервную копию и прогоните миграции на staging. Для Compose на сервере после переключения на новый SHA выполните `dc build`, подготовьте Django командами `migrate` и `collectstatic` из инструкции и выполните `dc up -d`. Убедитесь, что Nginx отдаёт файлы новой веб-сборки, и проведите проверку с двумя аккаунтами. При откате проверьте совместимость схемы со старой версией. Если нужна копия БД, согласуйте потерю записей между моментом копии и откатом и восстановите соответствующие вложения.
- Сохраняйте именованные тома при остановке или пересборке. Команда `docker compose down -v` удаляет тома проекта вместе с данными.

### Безопасность и мониторинг

- Держите БД, Redis и Daphne в закрытой сети. Ограничьте доступ к SSH, секретам и админке. Фильтруйте чувствительные данные в логах, включая одноразовые коды, токены и подписанные ссылки. [Рекомендации проекта](SECURITY.md)
- Контролируйте доступность HTTPS и WebSocket, ошибки API, доставку задач в Celery, диск, рост БД и медиа, возраст резервных копий и срок действия сертификата, который отдаёт Nginx.
- Certbot в production Compose регулярно проверяет продление. После обновления файлов сертификата перезагрузите конфигурацию командой `dc exec nginx nginx -s reload`. Для автоматической эксплуатации настройте перезагрузку Nginx после успешного продления и проверку фактически обслуживаемого сертификата. [Обработчики продления Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)

### Диагностика

| Симптом | Где смотреть |
| --- | --- |
| Сайт не открывается, ошибка TLS или 502 | DNS, порты 80/443, сертификат Nginx, `dc ps -a`, `dc logs --tail=100 nginx backend`. |
| HTML открывается, но интерфейс не загружается | Логи `frontend-build`, актуальность содержимого тома `frontend_dist`, HTTP-ответы для JS/CSS и кеш service worker. |
| Сообщения появляются только после перезагрузки | Ответ WebSocket с кодом 101, заголовки прокси, подключение Django к Redis и логи backend. |
| Не приходит код входа | Настройки выбранного провайдера, лимиты запросов и журналы доставки. |
| Отложенные сообщения не отправляются | `dc logs --tail=100 celery celery-beat`, доступность Redis и настройки брокера. |
| Ошибки миграций или подключения к БД | Состояние PostgreSQL, эффективный адрес БД, пароль роли и список миграций `dc exec backend python manage.py showmigrations`. Консоль БД открывается через `dc exec db psql -U postgres -d chatdb`. |
| Вложения не открываются | Том `backend_media`, права и доступность файлов, подписанный маршрут и ограничения загрузки в Nginx и приложении. |

## Тестирование

После настройки локального окружения запускайте проверки затронутого компонента.

```bash
docker compose exec backend python manage.py test
```

В `frontend/` доступны модульные тесты, генерация файлов для сценариев и браузерные тесты Playwright.

```bash
npm run test:unit
npm run create-fixtures
npm run test:e2e
```

Для двух аккаунтов используйте `E2E_USER_1_PHONE`, `E2E_USER_2_PHONE` и при необходимости `E2E_USER_1_CODE`, `E2E_USER_2_CODE`. E2E проверяют, в частности, открытие ссылки приглашения и перенаправление на вход. Для локальных проверок с тестовыми номерами можно задать `AUTH_DEBUG=1`, `AUTH_DEBUG_PHONES` и `AUTH_DEBUG_CODE`. Скрипт `python scripts/send-test-messages.py --api-url http://localhost:8000` отправляет тестовые сообщения. Для публичной среды оставляйте `AUTH_DEBUG=0`.

Перед выпуском войдите с двух аккаунтов, примите приглашение, обменяйтесь сообщениями без обновления страницы, отправьте вложение и отложенное сообщение. Проверьте повторное подключение после разрыва сети. Дополнительные сценарии собраны в [плане тестирования](TODO.md).
