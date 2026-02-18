@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/4] Проверка Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo Ошибка: Docker не запущен или не установлен.
    echo Установите Docker Desktop и запустите его, затем снова запустите этот скрипт.
    pause
    exit /b 1
)

echo [2/4] Запуск PostgreSQL (порт 5433)...
docker compose up -d db
if errorlevel 1 (
    echo Ошибка запуска контейнера.
    pause
    exit /b 1
)

echo Ожидание готовности БД...
timeout /t 3 /nobreak >nul

echo [3/4] Переключение backend на PostgreSQL в .env...
set ENV_FILE=backend\.env
powershell -NoProfile -Command ^
  "$c = Get-Content '%ENV_FILE%' -Raw; " ^
  "$c = $c -replace 'USE_SQLITE=True','USE_SQLITE=False'; " ^
  "$c = $c -replace 'DATABASE_URL=postgres://[^\"\r\n]*','DATABASE_URL=postgres://postgres:postgres@localhost:5433/chatdb'; " ^
  "Set-Content '%ENV_FILE%' -Value $c -NoNewline"

echo [4/4] Применение миграций...
cd backend
python manage.py migrate
if errorlevel 1 (
    echo Ошибка миграций. Проверьте, что в backend установлены зависимости: pip install -r requirements.txt
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo Готово. PostgreSQL запущен, проект переключён на БД chatdb (localhost:5433).
echo Данные хранятся в Docker-томе. Остановить: docker compose stop db
echo Запуск приложения: start.bat
pause
