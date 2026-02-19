@echo off
chcp 65001 >nul
cd /d "%~dp0..\..\backend"
echo Applying migrations...
python manage.py migrate
if errorlevel 1 ( echo Migrate failed. & pause & exit /b 1 )
echo Starting backend on http://127.0.0.1:8000
python manage.py runserver 0.0.0.0:8000
pause
