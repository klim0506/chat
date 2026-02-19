@echo off
chcp 65001 >nul
cd /d "%~dp0..\..\frontend"
echo Starting frontend...
npm run dev
pause
