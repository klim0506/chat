@echo off
chcp 65001 >nul
cd /d "%~dp0..\..\backend"

echo ============================================
echo  Full DB reset (delete db.sqlite3 + migrate)
echo  STOP the backend (runserver/Celery) first!
echo ============================================
pause

if exist db.sqlite3 (
    del db.sqlite3
    echo Deleted db.sqlite3
) else (
    echo db.sqlite3 not found, skipping delete.
)

echo Applying migrations...
.venv\Scripts\python.exe manage.py migrate
if errorlevel 1 ( echo migrate failed. & pause & exit /b 1 )

echo Running tests...
.venv\Scripts\python.exe manage.py test apps.users apps.chats apps.files apps.payments --verbosity=2
if errorlevel 1 ( echo tests failed. & pause & exit /b 1 )

echo Done. Start backend with run_backend.bat
pause
