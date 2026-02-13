@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/4] Clearing database (all data)...
.venv\Scripts\python.exe manage.py clear_all_data --no-input --no-backup
if errorlevel 1 ( echo clear_all_data failed. & exit /b 1 )

echo [2/4] Applying migrations...
.venv\Scripts\python.exe manage.py migrate
if errorlevel 1 ( echo migrate failed. & exit /b 1 )

echo [3/4] Running tests...
.venv\Scripts\python.exe manage.py test apps.users apps.chats apps.files apps.payments --verbosity=2
if errorlevel 1 ( echo tests failed. & exit /b 1 )

echo [4/4] All done. Start backend with run_backend.bat to verify.
exit /b 0
