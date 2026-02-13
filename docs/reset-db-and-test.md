# Очистка БД и тестирование (Windows)

## Вариант 1: Очистка данных без удаления файла БД

**Backend может быть запущен.** Удаляются все пользователи и связанные данные (чаты, сообщения, подписки). Схема таблиц сохраняется.

1. Откройте **cmd** или **PowerShell**.
2. Перейдите в папку backend:
   ```bat
   cd /d "d:\Локальные персональные чаты\backend"
   ```
3. Запустите скрипт:
   ```bat
   reset_and_test.bat
   ```
   Скрипт выполнит: очистка данных → миграции → тесты.

## Вариант 2: Полный сброс «с нуля» (удаление файла БД)

**Сначала остановите backend** (закройте окно с `run_backend.bat`, Celery и т.п.), иначе файл `db.sqlite3` будет занят и его не удастся удалить.

1. Закройте все процессы, использующие БД (runserver, Celery, Beat).
2. Откройте cmd и перейдите в backend:
   ```bat
   cd /d "d:\Локальные персональные чаты\backend"
   ```
3. Запустите:
   ```bat
   reset_db_full.bat
   ```
   Скрипт удалит `db.sqlite3`, применит миграции заново и запустит тесты.

## Ручные команды (если скрипты не подходят)

Из папки `backend` с активированным venv (или через `.\venv\Scripts\python.exe`):

```bat
:: Только очистка данных (без удаления файла)
.venv\Scripts\python.exe manage.py clear_all_data --no-input --no-backup

:: Миграции
.venv\Scripts\python.exe manage.py migrate

:: Тесты
.venv\Scripts\python.exe manage.py test apps.users apps.chats apps.files apps.payments --verbosity=2

:: Запуск сервера для проверки
.venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
```

## Проверка сервиса после сброса

1. Запустите backend: `run_backend.bat`.
2. Запустите frontend (если нужен): `run_frontend.bat`.
3. Откройте в браузере: http://127.0.0.1:8000 (API) и/или http://localhost:5173 (фронт).
4. Вход в отладочном режиме: номер из `AUTH_DEBUG_PHONES` (например `+71234567890`), код `123456`.
