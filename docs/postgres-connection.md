# PostgreSQL для проекта

**Локальная разработка** — ниже. **Продакшен** (как разместить БД на сервере/в облаке): см. [postgres-production.md](postgres-production.md).

## Что нужно от вас (разработка)

Чтобы всё сделать автоматически одной командой:

1. **Установите и запустите Docker Desktop** (если ещё не установлен): [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. В корне проекта выполните: **`start_postgres.bat`**

Скрипт поднимет контейнер PostgreSQL, переключит `backend\.env` на использование БД и применит миграции. После этого запускайте приложение как обычно: `start.bat`.

Если хотите использовать **локально установленный PostgreSQL** (без Docker): установите PostgreSQL, создайте базу `chatdb` и пользователя `postgres`, в `backend\.env` укажите `USE_SQLITE=False` и `DATABASE_URL=postgres://postgres:ВАШ_ПАРОЛЬ@localhost:5432/chatdb` (порт 5432 — стандартный для локальной установки).

---

## Параметры базы (Docker)
- Host: `localhost`
- Port: `5433`
- DB: `chatdb`
- User: `postgres`
- Password: `postgres`

## Запуск вручную (только контейнер)
```bash
docker compose up -d db
```

## Подключиться к БД (через контейнер)
```bash
docker compose exec db psql -U postgres -d chatdb
```

## Быстрые команды просмотра
```bash
# список баз
docker compose exec db psql -U postgres -c "\l"

# список таблиц в chatdb
docker compose exec db psql -U postgres -d chatdb -c "\dt"

# посмотреть первые 20 строк таблицы
# замените <table_name> на нужную таблицу
docker compose exec db psql -U postgres -d chatdb -c "SELECT * FROM <table_name> LIMIT 20;"
```

## Строка подключения
```text
postgresql://postgres:postgres@localhost:5433/chatdb
```

## Остановка
```bash
docker compose stop db
```
