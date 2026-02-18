@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/4] Применяю миграции...
cd backend
python manage.py migrate
if errorlevel 1 ( echo Ошибка миграций. & cd .. & pause & exit /b 1 )
cd ..

echo [2/4] Запускаю бэкенд на http://127.0.0.1:8000 ...
start "Backend" cmd /k "cd /d "%~dp0backend" && set "DJANGO_SETTINGS_MODULE=config.settings.dev" && python manage.py runserver 0.0.0.0:8000"

echo [3/4] Запускаю Celery worker...
start "Celery" cmd /k "cd /d "%~dp0backend" && set "DJANGO_SETTINGS_MODULE=config.settings.dev" && celery -A config worker -l info"

echo [4/4] Запускаю фронтенд на http://localhost:5173 ...
start "Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173/"

echo.
echo Готово. Открыты три окна: бэкенд (8000), Celery worker, фронтенд (5173).
echo Если используете PostgreSQL — перед start.bat запустите start_postgres.bat (или docker compose up -d db).
echo Для периодических задач запустите отдельно run_celery_beat.bat.
echo Закройте окна или выполните kill_backend_frontend.bat для остановки.
pause
