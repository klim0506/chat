@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/3] Применяю миграции...
cd backend
python manage.py migrate
if errorlevel 1 ( echo Ошибка миграций. & cd .. & pause & exit /b 1 )
cd ..

echo [2/3] Запускаю бэкенд на http://127.0.0.1:8000 ...
start "Backend" cmd /k "cd /d "%~dp0backend" && set DJANGO_SETTINGS_MODULE=config.settings.dev && python manage.py runserver 0.0.0.0:8000"

echo [3/3] Запускаю фронтенд на http://localhost:5173 ...
start "Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo Готово. Открыты два окна: бэкенд (8000) и фронтенд (5173).
echo Закройте окна или выполните kill_backend_frontend.bat для остановки.
pause
