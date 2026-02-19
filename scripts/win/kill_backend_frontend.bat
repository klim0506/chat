@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo Stopping processes on ports 8000 (backend) and 5173 (frontend)...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
  echo Killing PID %%a (port 8000)
  taskkill /F /PID %%a 2>nul
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
  echo Killing PID %%a (port 5173)
  taskkill /F /PID %%a 2>nul
)

echo Done. You can run run_backend.bat and run_frontend.bat again.
pause
