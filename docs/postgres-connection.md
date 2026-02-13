# PostgreSQL для проекта

## Параметры базы
- Host: `localhost`
- Port: `5433`
- DB: `chatdb`
- User: `postgres`
- Password: `postgres`

## Запуск
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
