# PostgreSQL в продакшене

База на ноутбуке — это **только для разработки**. В проде БД должна быть на сервере или в облаке: тогда к ней могут подключаться backend, Celery и вы (для админки/бэкапов).

---

## Варианты размещения БД в проде

### 1. PostgreSQL в Docker на том же сервере (как в проекте)

В репозитории уже есть **`docker-compose.prod.yml`**: там контейнер `db` (PostgreSQL 16) поднимается на том же хосте, что и backend. Данные хранятся в Docker-томе `postgres_data`.

**Плюсы:** один сервер, одна команда `docker compose -f docker-compose.prod.yml up -d`, бэкапы через `pg_dump` из контейнера.  
**Минусы:** если сервер упадёт — падает и БД; масштабировать отдельно не получится.

**Что сделать:**
- На VPS/сервере: склонировать проект, задать `DB_PASSWORD` и переменные в `backend/.env`, запустить:
  ```bash
  export DOMAIN=ваш-домен.ru
  docker compose -f docker-compose.prod.yml up -d
  ```
- Backend и Celery подключаются к БД по внутреннему имени `db:5432` (см. `DATABASE_URL` в prod-композе).

Подробнее по шагам — в комментариях в начале `docker-compose.prod.yml` и в `scripts/init-letsencrypt.sh`.

---

### 2. Управляемый PostgreSQL в облаке

Создаёте инстанс PostgreSQL у провайдера, получаете хост, порт, логин и пароль. В проде в **`backend/.env`** указываете только:

```env
USE_SQLITE=False
DATABASE_URL=postgres://пользователь:пароль@хост-облака:5432/имя_базы
```

**Примеры провайдеров:**
- **Yandex Cloud** — Managed Service for PostgreSQL  
- **Selectel** — Managed PostgreSQL  
- **DigitalOcean** — Managed Databases (PostgreSQL)  
- **AWS** — RDS PostgreSQL  
- **Timeweb Cloud**, **REG.RU** и др. — у многих есть управляемая PostgreSQL

На сервере с приложением **контейнер `db` не поднимаете**: в `docker-compose.prod.yml` можно отключить сервис `db` и задать `DATABASE_URL` из облака в `environment` для `backend` и `celery`. Либо деплоите без Docker (по `docs/deploy-ssh.md`) и в `.env` на сервере прописываете облачный `DATABASE_URL`.

**Плюсы:** бэкапы, обновления и мониторинг часто включены; можно масштабировать БД отдельно от приложения.  
**Минусы:** платно, нужна настройка доступа (белый список IP или VPC).

---

### 3. PostgreSQL установлен на том же сервере (без Docker)

По инструкции **`docs/deploy-ssh.md`**: на VPS ставите PostgreSQL пакетом, создаёте базу и пользователя, в `backend/.env` на сервере указываете:

```env
USE_SQLITE=False
DATABASE_URL=postgres://пользователь:пароль@localhost:5432/chatdb
```

Миграции: `python manage.py migrate` на сервере. БД живёт рядом с приложением, без контейнера.

**Плюсы:** полный контроль, без облачных подписок.  
**Минусы:** бэкапы и обновления PostgreSQL настраиваете сами.

---

## Кратко

| Где БД сейчас | Где БД в проде |
|--------------|-----------------|
| На ноуте (Docker, порт 5433) | Только для разработки. В проде так делать нельзя. |
| В проде | Либо контейнер `db` на том же сервере (`docker-compose.prod.yml`), либо управляемая PostgreSQL в облаке, либо PostgreSQL, установленный на сервере по `deploy-ssh.md`. |

После выбора варианта в проде везде используйте один и тот же `DATABASE_URL` (и при необходимости один и тот же `DB_PASSWORD` в prod-композе).
