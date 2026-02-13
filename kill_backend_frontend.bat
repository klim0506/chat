@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Останавливаю процессы на портах 8000 (бэкенд) и 5173 (фронтенд)...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
  echo Завершаю PID %%a ^(порт 8000^)
  taskkill /F /PID %%a 2>nul
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
  echo Завершаю PID %%a ^(порт 5173^)
  taskkill /F /PID %%a 2>nul
)

echo Готово. Можно запускать run_backend.bat и run_frontend.bat
pause
