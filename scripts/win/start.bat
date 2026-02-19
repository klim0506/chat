@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."

echo [1/4] Applying migrations...
cd backend
python manage.py migrate
if errorlevel 1 ( echo Migration failed. & cd .. & pause & exit /b 1 )
cd ..

echo [2/4] Starting backend on http://127.0.0.1:8000 ...
start "Backend" cmd /k "cd /d "%~dp0..\..\backend" && set "DJANGO_SETTINGS_MODULE=config.settings.dev" && python manage.py runserver 0.0.0.0:8000"

echo [3/4] Starting Celery worker...
start "Celery" cmd /k "cd /d "%~dp0..\..\backend" && set "DJANGO_SETTINGS_MODULE=config.settings.dev" && celery -A config worker -l info"

echo [4/4] Starting frontend on http://localhost:5173 ...
start "Frontend" cmd /k "cd /d "%~dp0..\..\frontend" && npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173/"

echo.
echo Done. Backend (8000), Celery worker, Frontend (5173).
echo For PostgreSQL: run start_postgres.bat first, or: docker compose up -d db
echo For scheduled tasks: run run_celery_beat.bat separately.
echo To stop: run kill_backend_frontend.bat
pause
