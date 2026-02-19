@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."

echo [1/4] Checking Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo Error: Docker not running or not installed.
    echo Install Docker Desktop and start it, then run this script again.
    pause
    exit /b 1
)

echo [2/4] Starting PostgreSQL (port 5433)...
docker compose up -d db
if errorlevel 1 (
    echo Error starting container.
    pause
    exit /b 1
)

echo Waiting for DB...
timeout /t 3 /nobreak >nul

echo [3/4] Switching backend to PostgreSQL in .env...
set ENV_FILE=backend\.env
powershell -NoProfile -Command ^
  "$c = Get-Content '%ENV_FILE%' -Raw; " ^
  "$c = $c -replace 'USE_SQLITE=True','USE_SQLITE=False'; " ^
  "$c = $c -replace 'DATABASE_URL=postgres://[^\"\r\n]*','DATABASE_URL=postgres://postgres:postgres@localhost:5433/chatdb'; " ^
  "Set-Content '%ENV_FILE%' -Value $c -NoNewline"

echo [4/4] Applying migrations...
cd backend
python manage.py migrate
if errorlevel 1 (
    echo Migration failed. Ensure deps installed: pip install -r requirements.txt
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo Done. PostgreSQL running, project switched to chatdb (localhost:5433).
echo Stop: docker compose stop db
echo Start app: start.bat
pause
